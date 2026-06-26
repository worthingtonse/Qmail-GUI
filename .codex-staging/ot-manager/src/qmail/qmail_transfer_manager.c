/**
 * qmail_transfer_manager.c - Durable Object Transfer v1 state machine
 */

#include "qmail/qmail_transfer_manager.h"
#include "qmail/qmail_crypto.h"
#include "qmail/qmail_db.h"
#include "qmail/qmail_locker_pool.h"
#include "qmail/qmail_transfer_store.h"
#include "qmail/qmail_users.h"
#include "filesystem.h"
#include "logging.h"
#include "raida_status.h"
#include "sha256_util.h"
#include "task_manager.h"
#include "utils.h"
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#include <process.h>
#else
#include <pthread.h>
#endif

#define TRANSFER_RETRY_LIMIT 4
#define TRANSFER_RETRY_DELAY_MS 250
#define TRANSFER_OPERATION_RETRY_LIMIT 4
#define TRANSFER_STATUS_PAGE_RANGES 256
#define TRANSFER_DEFAULT_CHUNK (1024u * 1024u)
#define TRANSFER_RANGE_COUNT_MAX 4000000u

typedef struct {
    qmail_transfer_record_t record;
    qmail_ot_command_context_t command_context;
    raida_encryption_key_t identity_key;
    qmail_encryption_state_t encryption_state;
    core_transport_t *transport;
} transfer_execution_t;

typedef struct {
    transfer_execution_t *execution;
    qmail_transfer_range_t *ranges;
    size_t range_count;
    size_t next_index;
    mutex_t mutex;
    bool failed;
    bool cancelled;
    int last_result;
    uint8_t last_status;
    char error[QMAIL_TRANSFER_ERROR_MAX];
} transfer_batch_t;

typedef struct {
    transfer_batch_t *batch;
    bool upload;
} transfer_range_worker_args_t;

static core_transport_t *s_transport = NULL;
static bool s_initialized = false;
static volatile bool s_shutdown = false;
static mutex_t s_active_mutex;
static bool s_active_mutex_ready = false;
static uint8_t s_active_ids[64][QMAIL_OT_ID_SIZE];
static int s_active_count = 0;

static bool bytes_zero(const uint8_t *value, size_t size) {
    if (!value) return true;
    for (size_t i = 0; i < size; ++i) {
        if (value[i] != 0) return false;
    }
    return true;
}

static void random_nonzero(uint8_t out[QMAIL_OT_ID_SIZE]) {
    do {
        platform_random_bytes(out, QMAIL_OT_ID_SIZE);
    } while (bytes_zero(out, QMAIL_OT_ID_SIZE));
}

static uint64_t random_request_id(void) {
    uint64_t value = 0;
    do {
        platform_random_bytes((uint8_t *)&value, sizeof(value));
    } while (value == 0);
    return value;
}

static void id_to_hex(const uint8_t id[QMAIL_OT_ID_SIZE], char out[33]) {
    utils_bytes_to_hex(id, QMAIL_OT_ID_SIZE, out);
}

static int transfer_progress(const qmail_transfer_record_t *record) {
    if (!record || record->total_size == 0) return 0;
    if (record->completed_bytes >= record->total_size) return 100;
    long double ratio =
        (long double)record->completed_bytes / (long double)record->total_size;
    uint64_t percent = (uint64_t)(ratio * 100.0L);
    return percent > 100 ? 100 : (int)percent;
}

static bool status_retryable(uint8_t status) {
    return status == 0 ||
           status == RAIDA_STATUS_PAYMENT_PROCESSING ||
           status == RAIDA_STATUS_TRANSFER_INCOMPLETE ||
           status == RAIDA_STATUS_INTERNAL ||
           status == RAIDA_STATUS_NETWORK;
}

static void update_task(const qmail_transfer_record_t *record,
                        const char *message) {
    char operation_hex[33];
    char object_hex[33];
    char fragment[512];
    if (!record || !record->task_id[0]) return;
    id_to_hex(record->operation_id, operation_hex);
    id_to_hex(record->object_id, object_hex);
#ifdef _WIN32
    snprintf(fragment, sizeof(fragment),
             "\"operation_id\":\"%s\",\"object_id\":\"%s\","
             "\"direction\":\"%s\",\"state\":\"%s\","
             "\"completed_bytes\":\"%I64u\",\"total_bytes\":\"%I64u\","
             "\"raida_id\":%u",
             operation_hex, object_hex,
             qmail_transfer_direction_string(record->direction),
             qmail_transfer_state_string(record->state),
             (unsigned long long)record->completed_bytes,
             (unsigned long long)record->total_size,
             record->raida_id);
#else
    snprintf(fragment, sizeof(fragment),
             "\"operation_id\":\"%s\",\"object_id\":\"%s\","
             "\"direction\":\"%s\",\"state\":\"%s\","
             "\"completed_bytes\":\"%llu\",\"total_bytes\":\"%llu\","
             "\"raida_id\":%u",
             operation_hex, object_hex,
             qmail_transfer_direction_string(record->direction),
             qmail_transfer_state_string(record->state),
             (unsigned long long)record->completed_bytes,
             (unsigned long long)record->total_size,
             record->raida_id);
#endif
    task_update_with_data(record->task_id, transfer_progress(record),
                          message ? message : "Transferring object", fragment);
}

static bool active_register(const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    bool registered = false;
    mutex_lock(&s_active_mutex);
    for (int i = 0; i < s_active_count; ++i) {
        if (memcmp(s_active_ids[i], operation_id, QMAIL_OT_ID_SIZE) == 0) {
            mutex_unlock(&s_active_mutex);
            return false;
        }
    }
    if (s_active_count < (int)(sizeof(s_active_ids) / sizeof(s_active_ids[0]))) {
        memcpy(s_active_ids[s_active_count++], operation_id, QMAIL_OT_ID_SIZE);
        registered = true;
    }
    mutex_unlock(&s_active_mutex);
    return registered;
}

static void active_unregister(const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    mutex_lock(&s_active_mutex);
    for (int i = 0; i < s_active_count; ++i) {
        if (memcmp(s_active_ids[i], operation_id, QMAIL_OT_ID_SIZE) == 0) {
            s_active_count--;
            if (i != s_active_count) {
                memcpy(s_active_ids[i], s_active_ids[s_active_count],
                       QMAIL_OT_ID_SIZE);
            }
            break;
        }
    }
    mutex_unlock(&s_active_mutex);
}

static int active_count(void) {
    int count;
    mutex_lock(&s_active_mutex);
    count = s_active_count;
    mutex_unlock(&s_active_mutex);
    return count;
}

static bool operation_cancelled(const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    qmail_transfer_record_t record;
    if (qmail_transfer_store_get(operation_id, &record) != RESULT_SUCCESS) {
        return true;
    }
    return record.cancel_requested;
}

static bool operation_should_stop(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    return s_shutdown || operation_cancelled(operation_id);
}

static result_t setup_execution(qmail_transfer_record_t *record,
                                transfer_execution_t *execution) {
    exec_config_t config;
    qmail_identity_t identity;
    result_t result;
    if (!record || !execution || !s_transport) return RESULT_INVALID_PARAM;
    memset(execution, 0, sizeof(*execution));
    execution->record = *record;
    execution->transport = s_transport;

    result = qmail_identity_load_key(NULL, &execution->identity_key, &identity);
    if (result != RESULT_SUCCESS || !execution->identity_key.valid ||
        !identity.valid) {
        return RESULT_NOT_FOUND;
    }
    exec_config_init(&config);
    result = qmail_setup_encryption(
        record->wallet_path, execution->identity_key.serial_number,
        &config, &execution->encryption_state);
    if (result != RESULT_SUCCESS || !execution->encryption_state.enc_key.valid) {
        return result;
    }
    execution->command_context.identity_key = &execution->identity_key;
    execution->command_context.device_id = 1;
    execution->command_context.enc_key = &execution->encryption_state.enc_key;
    execution->command_context.timeout_ms = 60000;
    return RESULT_SUCCESS;
}

static bool command_ok(result_t result,
                       const qmail_ot_command_result_t *command_result) {
    return result == RESULT_SUCCESS && command_result &&
           command_result->transport_success &&
           command_result->signature_valid &&
           command_result->status_success;
}

static void command_error(char *out, size_t out_size,
                          result_t result,
                          const qmail_ot_command_result_t *command_result,
                          const char *operation) {
    if (!out || out_size == 0) return;
    if (command_result && command_result->status_code) {
        snprintf(out, out_size, "%s rejected by RAIDA %u (status %u)",
                 operation, command_result->raida_id,
                 command_result->status_code);
    } else if (command_result && command_result->error_message[0]) {
        snprintf(out, out_size, "%s failed: %s",
                 operation, command_result->error_message);
    } else {
        snprintf(out, out_size, "%s failed (%s)",
                 operation, result_to_string(result));
    }
}

result_t qmail_transfer_query_capabilities(
    const char *wallet_path,
    uint8_t raida_id,
    qmail_transfer_capabilities_t *capabilities_out) {
    qmail_transfer_record_t record;
    transfer_execution_t execution;
    qmail_ot_object_capabilities_request_t request;
    qmail_ot_command_result_t command_result;
    result_t result;
    if (!s_initialized || !capabilities_out || raida_id >= RAIDA_COUNT) {
        return RESULT_INVALID_PARAM;
    }
    memset(capabilities_out, 0, sizeof(*capabilities_out));
    memset(&record, 0, sizeof(record));
    record.raida_id = raida_id;
    snprintf(record.wallet_path, sizeof(record.wallet_path), "%s",
             wallet_path ? wallet_path : "");
    result = setup_execution(&record, &execution);
    if (result != RESULT_SUCCESS) return result;
    memset(&request, 0, sizeof(request));
    request.common.request_id = random_request_id();
    qmail_ot_command_result_init(&command_result);
    result = qmail_ot_cmd_object_capabilities(
        &execution.command_context, &request, raida_id,
        execution.transport, &command_result);
    if (!command_ok(result, &command_result)) {
        qmail_ot_command_result_free(&command_result);
        return result == RESULT_SUCCESS ? RESULT_ERROR : result;
    }
    capabilities_out->capabilities =
        command_result.response.payload.object_capabilities;
    capabilities_out->class_count =
        capabilities_out->capabilities.class_count;
    if (capabilities_out->class_count >
        QMAIL_TRANSFER_STORAGE_CLASS_MAX) {
        qmail_ot_command_result_free(&command_result);
        return RESULT_ERROR;
    }
    for (uint16_t i = 0; i < capabilities_out->class_count; ++i) {
        result = qmail_ot_parse_storage_class_entry(
            command_result.data, command_result.data_length, i,
            &capabilities_out->classes[i]);
        if (result != RESULT_SUCCESS) {
            qmail_ot_command_result_free(&command_result);
            return result;
        }
    }
    qmail_ot_command_result_free(&command_result);
    return RESULT_SUCCESS;
}

static result_t set_record_state(qmail_transfer_record_t *record,
                                 qmail_transfer_state_t state,
                                 int last_result,
                                 uint8_t last_status,
                                 const char *error) {
    if (!record) return RESULT_INVALID_PARAM;
    record->state = state;
    record->last_result = last_result;
    record->last_status = last_status;
    record->updated_at = (int64_t)time(NULL);
    snprintf(record->error_message, sizeof(record->error_message), "%s",
             error ? error : "");
    return qmail_transfer_store_save(record);
}

static result_t make_ranges(uint64_t total_size,
                            uint32_t chunk_size,
                            qmail_transfer_range_t **ranges_out,
                            size_t *count_out) {
    if (!ranges_out || !count_out || total_size == 0 || chunk_size == 0) {
        return RESULT_INVALID_PARAM;
    }
    uint64_t count64 = (total_size + chunk_size - 1u) / chunk_size;
    if (count64 > TRANSFER_RANGE_COUNT_MAX ||
        count64 > SIZE_MAX / sizeof(qmail_transfer_range_t)) {
        return RESULT_MEMORY_ERROR;
    }
    size_t count = (size_t)count64;
    qmail_transfer_range_t *ranges =
        (qmail_transfer_range_t *)calloc(count, sizeof(*ranges));
    if (!ranges) return RESULT_MEMORY_ERROR;
    for (size_t i = 0; i < count; ++i) {
        uint64_t offset = (uint64_t)i * chunk_size;
        uint64_t remaining = total_size - offset;
        ranges[i].offset = offset;
        ranges[i].length = remaining > chunk_size ? chunk_size : remaining;
    }
    *ranges_out = ranges;
    *count_out = count;
    return RESULT_SUCCESS;
}

static result_t append_split_range(qmail_transfer_range_t **ranges,
                                   size_t *count,
                                   size_t *capacity,
                                   uint64_t offset,
                                   uint64_t length,
                                   uint32_t chunk_size) {
    while (length > 0) {
        if (*count >= TRANSFER_RANGE_COUNT_MAX) return RESULT_MEMORY_ERROR;
        if (*count == *capacity) {
            size_t next = *capacity == 0 ? 64 : *capacity * 2;
            if (next > TRANSFER_RANGE_COUNT_MAX) {
                next = TRANSFER_RANGE_COUNT_MAX;
            }
            qmail_transfer_range_t *grown =
                (qmail_transfer_range_t *)realloc(
                    *ranges, next * sizeof(**ranges));
            if (!grown) return RESULT_MEMORY_ERROR;
            *ranges = grown;
            *capacity = next;
        }
        uint64_t part = length > chunk_size ? chunk_size : length;
        (*ranges)[*count].offset = offset;
        (*ranges)[*count].length = part;
        (*ranges)[*count].state = 0;
        (*ranges)[*count].retries = 0;
        (*count)++;
        offset += part;
        length -= part;
    }
    return RESULT_SUCCESS;
}

static result_t reconcile_upload_ranges(
    transfer_execution_t *execution,
    qmail_transfer_range_t **ranges_out,
    size_t *range_count_out,
    uint64_t *completed_out,
    bool *committed_out) {
    qmail_transfer_range_t *missing = NULL;
    size_t missing_count = 0;
    size_t missing_capacity = 0;
    uint64_t missing_bytes = 0;
    uint64_t cursor = 0;
    bool more = true;
    result_t result = RESULT_SUCCESS;
    *committed_out = false;

    while (more) {
        qmail_ot_object_transfer_status_request_t request;
        qmail_ot_command_result_t command_result;
        memset(&request, 0, sizeof(request));
        request.common.request_id = random_request_id();
        memcpy(request.transfer_id, execution->record.transfer_id,
               QMAIL_OT_ID_SIZE);
        request.cursor = cursor;
        request.range_mode = 0;
        request.max_ranges = TRANSFER_STATUS_PAGE_RANGES;
        qmail_ot_command_result_init(&command_result);
        result = qmail_ot_cmd_object_transfer_status(
            &execution->command_context, &request,
            execution->record.raida_id, execution->transport,
            &command_result);
        if (!command_ok(result, &command_result)) {
            qmail_ot_command_result_free(&command_result);
            free(missing);
            return result == RESULT_SUCCESS ? RESULT_ERROR : result;
        }
        qmail_ot_object_transfer_status_response_t *status =
            &command_result.response.payload.object_transfer_status;
        if (memcmp(status->transfer_id, execution->record.transfer_id,
                   QMAIL_OT_ID_SIZE) != 0 ||
            status->total_size != execution->record.total_size ||
            status->target_generation != execution->record.target_generation) {
            qmail_ot_command_result_free(&command_result);
            free(missing);
            return RESULT_ERROR;
        }
        if (status->transfer_state == 2) {
            *committed_out = true;
            qmail_ot_command_result_free(&command_result);
            break;
        }
        if (status->transfer_state == 3 || status->transfer_state == 4) {
            qmail_ot_command_result_free(&command_result);
            free(missing);
            return RESULT_ERROR;
        }
        for (uint16_t i = 0; i < status->range_count; ++i) {
            qmail_ot_range_entry_t entry;
            result = qmail_ot_parse_range_entry(
                command_result.data, command_result.data_length, i, &entry);
            if (result != RESULT_SUCCESS ||
                entry.offset > execution->record.total_size ||
                entry.length > execution->record.total_size - entry.offset ||
                entry.length >
                    execution->record.total_size - missing_bytes) {
                qmail_ot_command_result_free(&command_result);
                free(missing);
                return RESULT_ERROR;
            }
            result = append_split_range(
                &missing, &missing_count, &missing_capacity,
                entry.offset, entry.length, execution->record.accepted_chunk);
            if (result != RESULT_SUCCESS) {
                qmail_ot_command_result_free(&command_result);
                free(missing);
                return result;
            }
            missing_bytes += entry.length;
        }
        more = (status->response_flags & 1u) != 0;
        uint64_t next_cursor = status->next_cursor;
        if (more && (next_cursor == 0 || next_cursor == cursor)) {
            qmail_ot_command_result_free(&command_result);
            free(missing);
            return RESULT_ERROR;
        }
        cursor = next_cursor;
        qmail_ot_command_result_free(&command_result);
    }

    *ranges_out = missing;
    *range_count_out = missing_count;
    *completed_out = execution->record.total_size - missing_bytes;
    return RESULT_SUCCESS;
}

static bool seek_file(FILE *file, uint64_t offset) {
    if (!file || offset > (uint64_t)INT64_MAX) return false;
#ifdef _WIN32
    return _fseeki64(file, (__int64)offset, SEEK_SET) == 0;
#else
    return fseeko(file, (off_t)offset, SEEK_SET) == 0;
#endif
}

static result_t read_file_range(const char *path,
                                uint64_t offset,
                                uint32_t length,
                                uint8_t **data_out) {
    if (!path || !data_out || length == 0) return RESULT_INVALID_PARAM;
    FILE *file = fopen(path, "rb");
    if (!file) return RESULT_FILE_ERROR;
    uint8_t *data = (uint8_t *)malloc(length);
    if (!data) {
        fclose(file);
        return RESULT_MEMORY_ERROR;
    }
    if (!seek_file(file, offset) || fread(data, 1, length, file) != length) {
        free(data);
        fclose(file);
        return RESULT_FILE_ERROR;
    }
    fclose(file);
    *data_out = data;
    return RESULT_SUCCESS;
}

static result_t write_file_range(const char *path,
                                 uint64_t offset,
                                 const uint8_t *data,
                                 uint32_t length) {
    if (!path || !data || length == 0) return RESULT_INVALID_PARAM;
    FILE *file = fopen(path, "r+b");
    if (!file) return RESULT_FILE_ERROR;
    if (!seek_file(file, offset) || fwrite(data, 1, length, file) != length ||
        fflush(file) != 0) {
        fclose(file);
        return RESULT_FILE_ERROR;
    }
    fclose(file);
    return RESULT_SUCCESS;
}

static void batch_fail(transfer_batch_t *batch,
                       int result,
                       uint8_t status,
                       const char *message) {
    mutex_lock(&batch->mutex);
    if (!batch->failed) {
        batch->failed = true;
        batch->last_result = result;
        batch->last_status = status;
        snprintf(batch->error, sizeof(batch->error), "%s",
                 message ? message : "Range transfer failed");
    }
    mutex_unlock(&batch->mutex);
}

static bool batch_next(transfer_batch_t *batch,
                       qmail_transfer_range_t *range_out) {
    bool found = false;
    mutex_lock(&batch->mutex);
    if (!batch->failed && !batch->cancelled &&
        batch->next_index < batch->range_count) {
        *range_out = batch->ranges[batch->next_index++];
        found = true;
    }
    mutex_unlock(&batch->mutex);
    return found;
}

static void batch_note_cancelled(transfer_batch_t *batch) {
    mutex_lock(&batch->mutex);
    batch->cancelled = true;
    mutex_unlock(&batch->mutex);
}

static result_t upload_one_range(transfer_execution_t *execution,
                                 const qmail_transfer_range_t *range,
                                 int *retries_out,
                                 uint8_t *status_out,
                                 char *error,
                                 size_t error_size) {
    uint8_t *data = NULL;
    result_t result;
    if (range->length == 0 || range->length > UINT32_MAX) {
        return RESULT_INVALID_PARAM;
    }
    result = read_file_range(
        execution->record.source_path, range->offset,
        (uint32_t)range->length, &data);
    if (result != RESULT_SUCCESS) return result;

    qmail_ot_object_put_range_request_t request;
    memset(&request, 0, sizeof(request));
    request.common.request_id = random_request_id();
    memcpy(request.transfer_id, execution->record.transfer_id, QMAIL_OT_ID_SIZE);
    request.offset = range->offset;
    request.data_length = (uint32_t)range->length;
    request.hash_algorithm = QMAIL_OT_HASH_SHA256;
    result = sha256_digest(data, (size_t)range->length, request.range_hash);
    if (result != RESULT_SUCCESS) {
        free(data);
        return result;
    }

    for (int attempt = 0; attempt < TRANSFER_RETRY_LIMIT; ++attempt) {
        qmail_ot_command_result_t command_result;
        qmail_ot_command_result_init(&command_result);
        result = qmail_ot_cmd_object_put_range(
            &execution->command_context, &request, data, (size_t)range->length,
            execution->record.raida_id, execution->transport, &command_result);
        *retries_out = attempt;
        *status_out = command_result.status_code;
        if (command_ok(result, &command_result)) {
            qmail_ot_object_put_range_response_t *response =
                &command_result.response.payload.object_put_range;
            bool matches =
                memcmp(response->transfer_id, request.transfer_id,
                       QMAIL_OT_ID_SIZE) == 0 &&
                response->offset == request.offset &&
                response->data_length == request.data_length;
            qmail_ot_command_result_free(&command_result);
            free(data);
            return matches ? RESULT_SUCCESS : RESULT_ERROR;
        }
        command_error(error, error_size, result, &command_result, "PUT_RANGE");
        bool server_rejected =
            result == RESULT_SUCCESS && command_result.transport_success &&
            command_result.signature_valid && !command_result.status_success;
        qmail_ot_command_result_free(&command_result);
        if (server_rejected) break;
        platform_sleep_ms(TRANSFER_RETRY_DELAY_MS << attempt);
    }
    free(data);
    return result == RESULT_SUCCESS ? RESULT_ERROR : result;
}

static result_t download_one_range(transfer_execution_t *execution,
                                   const qmail_transfer_range_t *range,
                                   int *retries_out,
                                   uint8_t *status_out,
                                   char *error,
                                   size_t error_size) {
    if (range->length == 0 || range->length > UINT32_MAX) {
        return RESULT_INVALID_PARAM;
    }
    qmail_ot_object_get_range_request_t request;
    memset(&request, 0, sizeof(request));
    request.common.request_id = random_request_id();
    memcpy(request.object_id, execution->record.object_id, QMAIL_OT_ID_SIZE);
    request.file_type = execution->record.file_type;
    request.generation = execution->record.generation;
    request.offset = range->offset;
    request.requested_length = (uint32_t)range->length;

    result_t result = RESULT_ERROR;
    for (int attempt = 0; attempt < TRANSFER_RETRY_LIMIT; ++attempt) {
        qmail_ot_command_result_t command_result;
        qmail_ot_command_result_init(&command_result);
        result = qmail_ot_cmd_object_get_range(
            &execution->command_context, &request,
            execution->record.raida_id, execution->transport, &command_result);
        *retries_out = attempt;
        *status_out = command_result.status_code;
        if (command_ok(result, &command_result)) {
            qmail_ot_object_get_range_response_t *response =
                &command_result.response.payload.object_get_range;
            bool matches =
                memcmp(response->object_id, request.object_id,
                       QMAIL_OT_ID_SIZE) == 0 &&
                response->file_type == request.file_type &&
                response->hash_algorithm == QMAIL_OT_HASH_SHA256 &&
                response->generation == request.generation &&
                response->offset == request.offset &&
                response->data_length == range->length &&
                response->total_size == execution->record.total_size &&
                memcmp(response->object_hash, execution->record.object_hash,
                       QMAIL_OT_HASH_SIZE) == 0 &&
                command_result.data_length == range->length;
            if (matches) {
                result = write_file_range(
                    execution->record.temporary_path, range->offset,
                    command_result.data, response->data_length);
            } else {
                result = RESULT_ERROR;
            }
            qmail_ot_command_result_free(&command_result);
            if (result == RESULT_SUCCESS) return RESULT_SUCCESS;
        } else {
            command_error(error, error_size, result, &command_result,
                          "GET_RANGE");
            bool server_rejected =
                result == RESULT_SUCCESS && command_result.transport_success &&
                command_result.signature_valid && !command_result.status_success;
            qmail_ot_command_result_free(&command_result);
            if (server_rejected) break;
        }
        platform_sleep_ms(TRANSFER_RETRY_DELAY_MS << attempt);
    }
    return result == RESULT_SUCCESS ? RESULT_ERROR : result;
}

static void *range_worker(void *arg) {
    transfer_range_worker_args_t *worker =
        (transfer_range_worker_args_t *)arg;
    transfer_batch_t *batch = worker->batch;
    qmail_transfer_range_t range;
    while (batch_next(batch, &range)) {
        if (operation_should_stop(batch->execution->record.operation_id)) {
            batch_note_cancelled(batch);
            break;
        }
        qmail_transfer_store_mark_range_inflight(
            batch->execution->record.operation_id, range.offset);
        int retries = 0;
        uint8_t status = 0;
        char error[QMAIL_TRANSFER_ERROR_MAX] = {0};
        result_t result = worker->upload
            ? upload_one_range(batch->execution, &range, &retries,
                               &status, error, sizeof(error))
            : download_one_range(batch->execution, &range, &retries,
                                 &status, error, sizeof(error));
        if (result == RESULT_SUCCESS) {
            qmail_transfer_store_mark_range_complete(
                batch->execution->record.operation_id,
                range.offset, range.length);
            qmail_transfer_record_t progress;
            if (qmail_transfer_store_get(
                    batch->execution->record.operation_id,
                    &progress) == RESULT_SUCCESS) {
                update_task(&progress, worker->upload
                    ? "Uploading object ranges"
                    : "Downloading object ranges");
            }
        } else {
            qmail_transfer_store_mark_range_failed(
                batch->execution->record.operation_id,
                range.offset, retries + 1, error);
            batch_fail(batch, result, status,
                       error[0] ? error : "Range transfer failed");
            break;
        }
    }
    return NULL;
}

static result_t run_range_batch(transfer_execution_t *execution,
                                qmail_transfer_range_t *ranges,
                                size_t range_count,
                                bool upload,
                                bool *cancelled_out,
                                int *last_result_out,
                                uint8_t *last_status_out,
                                char *error_out,
                                size_t error_size) {
    transfer_batch_t batch;
    memset(&batch, 0, sizeof(batch));
    batch.execution = execution;
    batch.ranges = ranges;
    batch.range_count = range_count;
    if (mutex_init(&batch.mutex) != RESULT_SUCCESS) return RESULT_ERROR;

    uint16_t parallel = execution->record.max_parallel;
    if (parallel == 0) parallel = 1;
    if (parallel > QMAIL_TRANSFER_LOCAL_PARALLEL_MAX) {
        parallel = QMAIL_TRANSFER_LOCAL_PARALLEL_MAX;
    }
    if ((size_t)parallel > range_count) parallel = (uint16_t)range_count;
    if (parallel == 0) {
        mutex_destroy(&batch.mutex);
        return RESULT_SUCCESS;
    }

    thread_t threads[QMAIL_TRANSFER_LOCAL_PARALLEL_MAX];
    transfer_range_worker_args_t args[QMAIL_TRANSFER_LOCAL_PARALLEL_MAX];
    memset(threads, 0, sizeof(threads));
    for (uint16_t i = 0; i < parallel; ++i) {
        args[i].batch = &batch;
        args[i].upload = upload;
        if (thread_create(&threads[i], range_worker, &args[i]) != RESULT_SUCCESS) {
            batch_fail(&batch, RESULT_ERROR, 0,
                       "Failed to create range worker");
            break;
        }
    }
    thread_join_all(threads, parallel);
    *cancelled_out = batch.cancelled;
    *last_result_out = batch.last_result;
    *last_status_out = batch.last_status;
    snprintf(error_out, error_size, "%s", batch.error);
    bool failed = batch.failed;
    mutex_destroy(&batch.mutex);
    return failed ? RESULT_ERROR : RESULT_SUCCESS;
}

static void finish_failed(qmail_transfer_record_t *record,
                          qmail_transfer_state_t state,
                          result_t result,
                          uint8_t status,
                          const char *message) {
    if (record->direction == QMAIL_TRANSFER_DIRECTION_UPLOAD &&
        state == QMAIL_TRANSFER_STATE_FAILED &&
        !record->locker_consumed && record->locker_key[0]) {
        qmail_db_locker_pool_release(record->locker_key);
    }
    set_record_state(record, state, result, status, message);
    if (record->task_id[0]) {
        if (state == QMAIL_TRANSFER_STATE_PAUSED) {
            update_task(record, message);
        } else {
            task_fail(record->task_id, message ? message : "Transfer failed");
        }
    }
}

static result_t abort_upload(transfer_execution_t *execution) {
    qmail_ot_object_abort_request_t request;
    qmail_ot_command_result_t command_result;
    memset(&request, 0, sizeof(request));
    request.common.request_id = random_request_id();
    memcpy(request.transfer_id, execution->record.transfer_id, QMAIL_OT_ID_SIZE);
    qmail_ot_command_result_init(&command_result);
    result_t result = qmail_ot_cmd_object_abort(
        &execution->command_context, &request, execution->record.raida_id,
        execution->transport, &command_result);
    qmail_ot_command_result_free(&command_result);
    return result;
}

static result_t run_upload(qmail_transfer_record_t *record) {
    transfer_execution_t execution;
    qmail_transfer_capabilities_t capabilities;
    result_t result = setup_execution(record, &execution);
    if (result != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "QMail identity or encryption key is unavailable");
        return result;
    }

    result = qmail_transfer_query_capabilities(
        record->wallet_path, record->raida_id, &capabilities);
    if (result != RESULT_SUCCESS ||
        capabilities.capabilities.protocol_min > QMAIL_OT_PROTOCOL_VERSION ||
        capabilities.capabilities.protocol_max < QMAIL_OT_PROTOCOL_VERSION ||
        (capabilities.capabilities.server_flags & 1u) == 0 ||
        (capabilities.capabilities.transport_flags & 1u) == 0) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "Object Transfer capability query failed");
        return result;
    }

    set_record_state(record, QMAIL_TRANSFER_STATE_HASHING, RESULT_SUCCESS, 0, "");
    update_task(record, "Hashing source file");
    uint64_t source_size = 0;
    uint8_t source_hash[QMAIL_OT_HASH_SIZE];
    result = sha256_file(record->source_path, source_hash, &source_size);
    if (result != RESULT_SUCCESS || source_size == 0) {
        finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, result, 0,
                      "Failed to hash source file");
        return result;
    }
    if (record->begin_request_frozen) {
        if (source_size != record->total_size ||
            memcmp(source_hash, record->object_hash,
                   QMAIL_OT_HASH_SIZE) != 0) {
            finish_failed(record, QMAIL_TRANSFER_STATE_FAILED,
                          RESULT_ERROR, 0,
                          "Source file changed after upload began");
            return RESULT_ERROR;
        }
    } else {
        if (source_size > capabilities.capabilities.max_object_global ||
            capabilities.capabilities.max_chunk == 0) {
            finish_failed(record, QMAIL_TRANSFER_STATE_FAILED,
                          RESULT_INVALID_PARAM, 0,
                          "Source exceeds the server object limit");
            return RESULT_INVALID_PARAM;
        }
        uint32_t preferred_chunk = record->preferred_chunk
            ? record->preferred_chunk
            : capabilities.capabilities.preferred_chunk;
        if (preferred_chunk == 0 ||
            preferred_chunk > capabilities.capabilities.max_chunk) {
            preferred_chunk = capabilities.capabilities.max_chunk;
        }
        record->preferred_chunk = preferred_chunk;
        record->total_size = source_size;
        memcpy(record->object_hash, source_hash, sizeof(source_hash));
        record->begin_request_frozen = true;
        record->updated_at = (int64_t)time(NULL);
        if (qmail_transfer_store_save(record) != RESULT_SUCCESS) {
            finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                          RESULT_ERROR, 0,
                          "Could not freeze the upload request");
            return RESULT_ERROR;
        }
    }
    if (s_shutdown) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                      RESULT_CANCELLED, 0,
                      "Upload paused for application shutdown");
        return RESULT_CANCELLED;
    }
    if (s_shutdown) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                      RESULT_CANCELLED, 0,
                      "Object deletion paused for application shutdown");
        return RESULT_CANCELLED;
    }
    if (operation_cancelled(record->operation_id)) {
        finish_failed(record, QMAIL_TRANSFER_STATE_CANCELLED,
                      RESULT_CANCELLED, 0, "Upload cancelled");
        return RESULT_CANCELLED;
    }

    set_record_state(record, QMAIL_TRANSFER_STATE_BEGINNING, RESULT_SUCCESS, 0, "");
    update_task(record, "Beginning object transfer");
    qmail_ot_object_begin_request_t begin;
    memset(&begin, 0, sizeof(begin));
    begin.common.request_id = random_request_id();
    memcpy(begin.transfer_id, record->transfer_id, QMAIL_OT_ID_SIZE);
    memcpy(begin.object_id, record->object_id, QMAIL_OT_ID_SIZE);
    memcpy(begin.locker_code, record->locker_code, QMAIL_OT_ID_SIZE);
    begin.file_type = record->file_type;
    begin.requested_retention_seconds = record->requested_retention_seconds;
    begin.hash_algorithm = QMAIL_OT_HASH_SHA256;
    begin.operation = record->operation;
    begin.storage_class = record->requested_storage_class;
    begin.preferred_chunk = record->preferred_chunk;
    begin.total_size = record->total_size;
    begin.expected_generation = record->expected_generation;
    begin.target_generation = record->target_generation;
    memcpy(begin.object_hash, record->object_hash, QMAIL_OT_HASH_SIZE);

    qmail_ot_command_result_t command_result;
    qmail_ot_command_result_init(&command_result);
    char error[QMAIL_TRANSFER_ERROR_MAX] = {0};
    for (int attempt = 0; attempt < TRANSFER_RETRY_LIMIT; ++attempt) {
        result = qmail_ot_cmd_object_begin(
            &execution.command_context, &begin, record->raida_id,
            execution.transport, &command_result);
        if (command_ok(result, &command_result)) break;
        command_error(error, sizeof(error), result, &command_result,
                      "OBJECT_BEGIN");
        bool rejected = result == RESULT_SUCCESS &&
                        command_result.transport_success &&
                        command_result.signature_valid &&
                        !command_result.status_success;
        if (rejected && !status_retryable(command_result.status_code)) break;
        platform_sleep_ms(TRANSFER_RETRY_DELAY_MS << attempt);
    }
    if (!command_ok(result, &command_result)) {
        uint8_t status = command_result.status_code;
        qmail_ot_command_result_free(&command_result);
        finish_failed(record,
                      status_retryable(status)
                        ? QMAIL_TRANSFER_STATE_PAUSED
                        : QMAIL_TRANSFER_STATE_FAILED,
                      result, status, error);
        return result == RESULT_SUCCESS ? RESULT_ERROR : result;
    }
    qmail_ot_object_begin_response_t *begin_response =
        &command_result.response.payload.object_begin;
    if (memcmp(begin_response->transfer_id, record->transfer_id,
               QMAIL_OT_ID_SIZE) != 0 ||
        begin_response->accepted_chunk == 0 ||
        begin_response->hash_algorithm != QMAIL_OT_HASH_SHA256 ||
        begin_response->operation != record->operation ||
        begin_response->accepted_chunk > record->preferred_chunk ||
        (record->requested_storage_class != 0 &&
         begin_response->storage_class !=
            record->requested_storage_class) ||
        begin_response->base_generation != record->expected_generation ||
        (record->requested_retention_seconds != 0 &&
         begin_response->accepted_retention_seconds !=
            record->requested_retention_seconds) ||
        begin_response->target_generation != record->target_generation) {
        qmail_ot_command_result_free(&command_result);
        finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, RESULT_ERROR, 0,
                      "OBJECT_BEGIN response does not match the request");
        return RESULT_ERROR;
    }
    record->accepted_chunk = begin_response->accepted_chunk;
    record->max_parallel = begin_response->max_parallel;
    if (record->max_parallel == 0) record->max_parallel = 1;
    if (record->max_parallel > capabilities.capabilities.max_parallel_transfer) {
        record->max_parallel = capabilities.capabilities.max_parallel_transfer;
    }
    record->storage_class = begin_response->storage_class;
    record->expires_at = begin_response->expires_at;
    record->accepted_retention_seconds =
        begin_response->accepted_retention_seconds;
    record->last_status = command_result.status_code;
    record->updated_at = (int64_t)time(NULL);
    qmail_ot_command_result_free(&command_result);
    if (!record->locker_consumed && record->locker_key[0]) {
        result_t consume_result =
            qmail_db_locker_pool_consume(record->locker_key);
        if (consume_result == RESULT_SUCCESS ||
            consume_result == RESULT_NOT_FOUND) {
            record->locker_consumed = true;
        } else {
            qmail_transfer_store_save(record);
            finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                          consume_result, 0,
                          "Storage locker state could not be finalized");
            return consume_result;
        }
    }
    if (qmail_transfer_store_save(record) != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                      RESULT_ERROR, 0,
                      "Negotiated upload state could not be persisted");
        return RESULT_ERROR;
    }
    execution.record = *record;

    qmail_transfer_range_t *ranges = NULL;
    size_t range_count = 0;
    uint64_t completed = 0;
    bool committed = false;
    result = reconcile_upload_ranges(
        &execution, &ranges, &range_count, &completed, &committed);
    if (result != RESULT_SUCCESS) {
        result = make_ranges(record->total_size, record->accepted_chunk,
                             &ranges, &range_count);
        completed = 0;
    }
    if (result != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "Failed to create upload ranges");
        return result;
    }
    if (committed) {
        record->completed_bytes = record->total_size;
        record->generation = record->target_generation;
        set_record_state(record, QMAIL_TRANSFER_STATE_COMPLETED,
                         RESULT_SUCCESS, 250, "");
        update_task(record, "Object upload completed");
        task_complete(record->task_id, "Object upload completed");
        free(ranges);
        return RESULT_SUCCESS;
    }
    result = qmail_transfer_store_replace_ranges(
        record->operation_id, ranges, range_count, completed);
    if (result != RESULT_SUCCESS) {
        free(ranges);
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "Upload ranges could not be persisted");
        return result;
    }
    record->completed_bytes = completed;
    set_record_state(record, QMAIL_TRANSFER_STATE_UPLOADING, RESULT_SUCCESS, 0, "");
    execution.record = *record;

    bool cancelled = false;
    int batch_result = RESULT_SUCCESS;
    uint8_t batch_status = 0;
    error[0] = '\0';
    result = run_range_batch(&execution, ranges, range_count, true,
                             &cancelled, &batch_result, &batch_status,
                             error, sizeof(error));
    free(ranges);
    qmail_transfer_store_get(record->operation_id, record);
    if (s_shutdown) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                      RESULT_CANCELLED, 0,
                      "Upload paused for application shutdown");
        return RESULT_CANCELLED;
    }
    if (cancelled || operation_cancelled(record->operation_id)) {
        abort_upload(&execution);
        finish_failed(record, QMAIL_TRANSFER_STATE_CANCELLED,
                      RESULT_CANCELLED, 0, "Upload cancelled");
        return RESULT_CANCELLED;
    }
    if (result != RESULT_SUCCESS) {
        finish_failed(record,
                      status_retryable(batch_status)
                        ? QMAIL_TRANSFER_STATE_PAUSED
                        : QMAIL_TRANSFER_STATE_FAILED,
                      (result_t)batch_result, batch_status,
                      error[0] ? error : "Upload paused after a range failure");
        return result;
    }

    set_record_state(record, QMAIL_TRANSFER_STATE_COMMITTING, RESULT_SUCCESS, 0, "");
    update_task(record, "Committing object");
    qmail_ot_object_commit_request_t commit;
    memset(&commit, 0, sizeof(commit));
    commit.common.request_id = random_request_id();
    memcpy(commit.transfer_id, record->transfer_id, QMAIL_OT_ID_SIZE);
    commit.total_size = record->total_size;
    commit.hash_algorithm = QMAIL_OT_HASH_SHA256;
    memcpy(commit.object_hash, record->object_hash, QMAIL_OT_HASH_SIZE);
    qmail_ot_command_result_init(&command_result);
    error[0] = '\0';
    for (int attempt = 0; attempt < TRANSFER_RETRY_LIMIT; ++attempt) {
        result = qmail_ot_cmd_object_commit(
            &execution.command_context, &commit, record->raida_id,
            execution.transport, &command_result);
        if (command_ok(result, &command_result)) break;
        command_error(error, sizeof(error), result, &command_result,
                      "OBJECT_COMMIT");
        bool rejected = result == RESULT_SUCCESS &&
                        command_result.transport_success &&
                        command_result.signature_valid &&
                        !command_result.status_success;
        if (rejected && !status_retryable(command_result.status_code)) break;
        platform_sleep_ms(TRANSFER_RETRY_DELAY_MS << attempt);
    }
    if (!command_ok(result, &command_result)) {
        uint8_t status = command_result.status_code;
        qmail_ot_command_result_free(&command_result);
        finish_failed(record,
                      status_retryable(status)
                        ? QMAIL_TRANSFER_STATE_PAUSED
                        : QMAIL_TRANSFER_STATE_FAILED,
                      result, status, error);
        return result == RESULT_SUCCESS ? RESULT_ERROR : result;
    }
    qmail_ot_object_commit_response_t *commit_response =
        &command_result.response.payload.object_commit;
    bool commit_matches =
        memcmp(commit_response->object_id, record->object_id,
               QMAIL_OT_ID_SIZE) == 0 &&
        commit_response->file_type == record->file_type &&
        commit_response->object_state == 1 &&
        commit_response->storage_class == record->storage_class &&
        commit_response->hash_algorithm == QMAIL_OT_HASH_SHA256 &&
        commit_response->generation == record->target_generation &&
        commit_response->total_size == record->total_size &&
        memcmp(commit_response->object_hash, record->object_hash,
               QMAIL_OT_HASH_SIZE) == 0;
    uint8_t status = command_result.status_code;
    qmail_ot_command_result_free(&command_result);
    if (!commit_matches) {
        finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, RESULT_ERROR, status,
                      "OBJECT_COMMIT response does not match the object");
        return RESULT_ERROR;
    }
    record->generation = record->target_generation;
    record->completed_bytes = record->total_size;
    set_record_state(record, QMAIL_TRANSFER_STATE_COMPLETED,
                     RESULT_SUCCESS, status, "");
    update_task(record, "Object upload completed");
    task_complete(record->task_id, "Object upload completed");
    return RESULT_SUCCESS;
}

static result_t query_object_info(transfer_execution_t *execution,
                                  qmail_ot_object_info_response_t *info_out,
                                  uint8_t *status_out,
                                  char *error,
                                  size_t error_size) {
    qmail_ot_object_info_request_t request;
    qmail_ot_command_result_t command_result;
    memset(&request, 0, sizeof(request));
    request.common.request_id = random_request_id();
    memcpy(request.object_id, execution->record.object_id, QMAIL_OT_ID_SIZE);
    request.file_type = execution->record.file_type;
    request.generation = execution->record.generation;
    qmail_ot_command_result_init(&command_result);
    result_t result = qmail_ot_cmd_object_info(
        &execution->command_context, &request, execution->record.raida_id,
        execution->transport, &command_result);
    *status_out = command_result.status_code;
    if (!command_ok(result, &command_result)) {
        command_error(error, error_size, result, &command_result, "OBJECT_INFO");
        qmail_ot_command_result_free(&command_result);
        return result == RESULT_SUCCESS ? RESULT_ERROR : result;
    }
    *info_out = command_result.response.payload.object_info;
    qmail_ot_command_result_free(&command_result);
    return RESULT_SUCCESS;
}

static result_t run_download(qmail_transfer_record_t *record) {
    transfer_execution_t execution;
    qmail_transfer_capabilities_t capabilities;
    result_t result = setup_execution(record, &execution);
    if (result != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "QMail identity or encryption key is unavailable");
        return result;
    }
    result = qmail_transfer_query_capabilities(
        record->wallet_path, record->raida_id, &capabilities);
    if (result != RESULT_SUCCESS ||
        capabilities.capabilities.protocol_min > QMAIL_OT_PROTOCOL_VERSION ||
        capabilities.capabilities.protocol_max < QMAIL_OT_PROTOCOL_VERSION ||
        (capabilities.capabilities.server_flags & 1u) == 0 ||
        (capabilities.capabilities.transport_flags & 1u) == 0) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "Object Transfer capability query failed");
        return result;
    }
    set_record_state(record, QMAIL_TRANSFER_STATE_QUERYING, RESULT_SUCCESS, 0, "");
    update_task(record, "Querying object information");
    qmail_ot_object_info_response_t info;
    uint8_t status = 0;
    char error[QMAIL_TRANSFER_ERROR_MAX] = {0};
    result = query_object_info(&execution, &info, &status, error, sizeof(error));
    if (result != RESULT_SUCCESS ||
        memcmp(info.object_id, record->object_id, QMAIL_OT_ID_SIZE) != 0 ||
        info.file_type != record->file_type ||
        info.object_state != 1 ||
        info.hash_algorithm != QMAIL_OT_HASH_SHA256 ||
        (record->generation != 0 &&
         info.generation != record->generation) ||
        info.total_size == 0) {
        finish_failed(record,
                      result != RESULT_SUCCESS && status_retryable(status)
                        ? QMAIL_TRANSFER_STATE_PAUSED
                        : QMAIL_TRANSFER_STATE_FAILED,
                      result, status,
                      error[0] ? error : "Object information is invalid");
        return result == RESULT_SUCCESS ? RESULT_ERROR : result;
    }
    if (s_shutdown) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                      RESULT_CANCELLED, 0,
                      "Download paused for application shutdown");
        return RESULT_CANCELLED;
    }
    if (operation_cancelled(record->operation_id)) {
        finish_failed(record, QMAIL_TRANSFER_STATE_CANCELLED,
                      RESULT_CANCELLED, 0, "Download cancelled");
        return RESULT_CANCELLED;
    }
    record->generation = info.generation;
    record->total_size = info.total_size;
    record->storage_class = info.storage_class;
    record->expires_at = info.expires_at;
    record->recommended_range = info.recommended_length;
    memcpy(record->object_hash, info.object_hash, QMAIL_OT_HASH_SIZE);
    uint32_t range_size = record->requested_range;
    if (range_size == 0) range_size = info.recommended_length;
    if (range_size == 0) range_size = capabilities.capabilities.preferred_chunk;
    if (range_size == 0) range_size = TRANSFER_DEFAULT_CHUNK;
    if (range_size > capabilities.capabilities.max_download_range) {
        range_size = capabilities.capabilities.max_download_range;
    }
    if (range_size == 0) {
        finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, RESULT_ERROR, 0,
                      "Server advertised an invalid download range");
        return RESULT_ERROR;
    }
    record->accepted_chunk = range_size;
    record->max_parallel = capabilities.capabilities.max_parallel_transfer;
    if (record->max_parallel == 0) record->max_parallel = 1;
    record->updated_at = (int64_t)time(NULL);
    if (qmail_transfer_store_save(record) != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                      RESULT_ERROR, 0,
                      "Pinned download metadata could not be persisted");
        return RESULT_ERROR;
    }
    execution.record = *record;

    bool temp_exists = platform_file_exists(record->temporary_path);
    if (!temp_exists) {
        FILE *temp = fopen(record->temporary_path, "w+b");
        if (!temp) {
            finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, RESULT_FILE_ERROR, 0,
                          "Cannot create the temporary download file");
            return RESULT_FILE_ERROR;
        }
        fclose(temp);
        qmail_transfer_range_t *new_ranges = NULL;
        size_t new_count = 0;
        result = make_ranges(record->total_size, range_size,
                             &new_ranges, &new_count);
        if (result == RESULT_SUCCESS) {
            result = qmail_transfer_store_replace_ranges(
                record->operation_id, new_ranges, new_count, 0);
            if (result == RESULT_SUCCESS) record->completed_bytes = 0;
        }
        free(new_ranges);
        if (result != RESULT_SUCCESS) {
            finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, result, 0,
                          "Cannot create download ranges");
            return result;
        }
    } else {
        qmail_transfer_store_reset_inflight(record->operation_id);
    }

    qmail_transfer_range_t *ranges = NULL;
    size_t range_count = 0;
    result = qmail_transfer_store_list_pending_ranges(
        record->operation_id, &ranges, &range_count);
    if (result != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "Cannot load pending download ranges");
        return result;
    }
    if (range_count == 0 && record->completed_bytes < record->total_size) {
        result = make_ranges(record->total_size, range_size,
                             &ranges, &range_count);
        if (result == RESULT_SUCCESS) {
            result = qmail_transfer_store_replace_ranges(
                record->operation_id, ranges, range_count, 0);
            record->completed_bytes = 0;
        }
        if (result != RESULT_SUCCESS) {
            free(ranges);
            finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, result, 0,
                          "Cannot recover download ranges");
            return result;
        }
    }
    set_record_state(record, QMAIL_TRANSFER_STATE_DOWNLOADING, RESULT_SUCCESS, 0, "");
    execution.record = *record;
    bool cancelled = false;
    int batch_result = RESULT_SUCCESS;
    uint8_t batch_status = 0;
    result = run_range_batch(&execution, ranges, range_count, false,
                             &cancelled, &batch_result, &batch_status,
                             error, sizeof(error));
    free(ranges);
    qmail_transfer_store_get(record->operation_id, record);
    if (s_shutdown) {
        record->cancel_requested = false;
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED,
                      RESULT_CANCELLED, 0,
                      "Download paused for application shutdown");
        return RESULT_CANCELLED;
    }
    if (cancelled || operation_cancelled(record->operation_id)) {
        remove(record->temporary_path);
        finish_failed(record, QMAIL_TRANSFER_STATE_CANCELLED,
                      RESULT_CANCELLED, 0,
                      "Download cancelled");
        return RESULT_CANCELLED;
    }
    if (result != RESULT_SUCCESS) {
        finish_failed(record,
                      status_retryable(batch_status)
                        ? QMAIL_TRANSFER_STATE_PAUSED
                        : QMAIL_TRANSFER_STATE_FAILED,
                      (result_t)batch_result, batch_status,
                      error[0] ? error : "Download paused after a range failure");
        return result;
    }

    set_record_state(record, QMAIL_TRANSFER_STATE_VERIFYING, RESULT_SUCCESS, 0, "");
    update_task(record, "Verifying downloaded object");
    uint8_t downloaded_hash[QMAIL_OT_HASH_SIZE];
    uint64_t downloaded_size = 0;
    result = sha256_file(record->temporary_path, downloaded_hash, &downloaded_size);
    if (result != RESULT_SUCCESS || downloaded_size != record->total_size ||
        memcmp(downloaded_hash, record->object_hash, QMAIL_OT_HASH_SIZE) != 0) {
        remove(record->temporary_path);
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, RESULT_ERROR, 0,
                      "Downloaded object failed SHA-256 verification; retrying");
        return RESULT_ERROR;
    }
    result = fs_atomic_rename(record->temporary_path, record->destination_path);
    if (result != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "Verified download could not be moved to its destination");
        return result;
    }
    record->completed_bytes = record->total_size;
    set_record_state(record, QMAIL_TRANSFER_STATE_COMPLETED,
                     RESULT_SUCCESS, 250, "");
    update_task(record, "Object download completed");
    task_complete(record->task_id, "Object download completed");
    return RESULT_SUCCESS;
}

static result_t run_delete(qmail_transfer_record_t *record) {
    transfer_execution_t execution;
    result_t result = setup_execution(record, &execution);
    if (result != RESULT_SUCCESS) {
        finish_failed(record, QMAIL_TRANSFER_STATE_PAUSED, result, 0,
                      "QMail identity or encryption key is unavailable");
        return result;
    }
    if (operation_cancelled(record->operation_id)) {
        finish_failed(record, QMAIL_TRANSFER_STATE_CANCELLED,
                      RESULT_CANCELLED, 0, "Object deletion cancelled");
        return RESULT_CANCELLED;
    }
    set_record_state(record, QMAIL_TRANSFER_STATE_COMMITTING, RESULT_SUCCESS, 0, "");
    qmail_ot_object_delete_request_t request;
    qmail_ot_command_result_t command_result;
    memset(&request, 0, sizeof(request));
    request.common.request_id = random_request_id();
    memcpy(request.object_id, record->object_id, QMAIL_OT_ID_SIZE);
    request.file_type = record->file_type;
    request.expected_generation = record->expected_generation;
    request.target_generation = record->target_generation;
    qmail_ot_command_result_init(&command_result);
    result = qmail_ot_cmd_object_delete(
        &execution.command_context, &request, record->raida_id,
        execution.transport, &command_result);
    if (!command_ok(result, &command_result)) {
        char error[QMAIL_TRANSFER_ERROR_MAX];
        command_error(error, sizeof(error), result, &command_result,
                      "OBJECT_DELETE");
        uint8_t status = command_result.status_code;
        qmail_ot_command_result_free(&command_result);
        finish_failed(record, status_retryable(status)
                                    ? QMAIL_TRANSFER_STATE_PAUSED
                                    : QMAIL_TRANSFER_STATE_FAILED,
                      result, status, error);
        return result == RESULT_SUCCESS ? RESULT_ERROR : result;
    }
    qmail_ot_object_delete_response_t *response =
        &command_result.response.payload.object_delete;
    bool matches =
        memcmp(response->object_id, record->object_id, QMAIL_OT_ID_SIZE) == 0 &&
        response->file_type == record->file_type &&
        response->object_state == 2 &&
        response->tombstone_generation == record->target_generation;
    uint8_t status = command_result.status_code;
    qmail_ot_command_result_free(&command_result);
    if (!matches) {
        finish_failed(record, QMAIL_TRANSFER_STATE_FAILED, RESULT_ERROR, status,
                      "OBJECT_DELETE response does not match the request");
        return RESULT_ERROR;
    }
    record->generation = record->target_generation;
    set_record_state(record, QMAIL_TRANSFER_STATE_COMPLETED,
                     RESULT_SUCCESS, status, "");
    update_task(record, "Object deletion completed");
    task_complete(record->task_id, "Object deletion completed");
    return RESULT_SUCCESS;
}

static void *operation_worker(void *arg) {
    uint8_t operation_id[QMAIL_OT_ID_SIZE];
    memcpy(operation_id, arg, QMAIL_OT_ID_SIZE);
    free(arg);
    qmail_transfer_record_t record;
    if (qmail_transfer_store_get(operation_id, &record) == RESULT_SUCCESS) {
        if (record.task_id[0]) {
            char status[32], message[256];
            int progress;
            if (task_get_status(record.task_id, status, sizeof(status),
                                &progress, message, sizeof(message))
                != RESULT_SUCCESS) {
                task_create(record.task_id, "Resuming object transfer");
            }
        }
        for (;;) {
            if (record.direction == QMAIL_TRANSFER_DIRECTION_UPLOAD) {
                run_upload(&record);
            } else if (record.direction == QMAIL_TRANSFER_DIRECTION_DOWNLOAD) {
                run_download(&record);
            } else if (record.direction == QMAIL_TRANSFER_DIRECTION_DELETE) {
                run_delete(&record);
            }
            if (s_shutdown ||
                qmail_transfer_store_get(operation_id, &record)
                    != RESULT_SUCCESS ||
                record.state != QMAIL_TRANSFER_STATE_PAUSED ||
                record.cancel_requested ||
                record.retry_count >= TRANSFER_OPERATION_RETRY_LIMIT) {
                break;
            }
            record.retry_count++;
            record.updated_at = (int64_t)time(NULL);
            if (qmail_transfer_store_save(&record) != RESULT_SUCCESS) break;
            update_task(&record, "Retrying object transfer");
            platform_sleep_ms(
                1000u << (record.retry_count > 4 ? 4 : record.retry_count));
        }
    }
    active_unregister(operation_id);
    return NULL;
}

#ifdef _WIN32
static unsigned __stdcall operation_worker_windows(void *arg) {
    operation_worker(arg);
    return 0;
}
#endif

static result_t spawn_operation(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    if (!active_register(operation_id)) return RESULT_ERROR;
    uint8_t *argument = (uint8_t *)malloc(QMAIL_OT_ID_SIZE);
    if (!argument) {
        active_unregister(operation_id);
        return RESULT_MEMORY_ERROR;
    }
    memcpy(argument, operation_id, QMAIL_OT_ID_SIZE);
#ifdef _WIN32
    uintptr_t thread = _beginthreadex(
        NULL, 0, operation_worker_windows, argument, 0, NULL);
    if (!thread) {
        free(argument);
        active_unregister(operation_id);
        return RESULT_ERROR;
    }
    CloseHandle((HANDLE)thread);
#else
    pthread_t thread;
    if (pthread_create(&thread, NULL, operation_worker, argument) != 0) {
        free(argument);
        active_unregister(operation_id);
        return RESULT_ERROR;
    }
    pthread_detach(thread);
#endif
    return RESULT_SUCCESS;
}

static result_t initialize_new_record(qmail_transfer_record_t *record,
                                      qmail_transfer_direction_t direction,
                                      uint8_t raida_id,
                                      uint8_t file_type,
                                      const char *wallet_path) {
    if (!record || raida_id >= RAIDA_COUNT) return RESULT_INVALID_PARAM;
    memset(record, 0, sizeof(*record));
    random_nonzero(record->operation_id);
    random_nonzero(record->object_id);
    record->direction = direction;
    record->state = QMAIL_TRANSFER_STATE_CREATED;
    record->raida_id = raida_id;
    record->file_type = file_type;
    record->max_parallel = 1;
    record->created_at = record->updated_at = (int64_t)time(NULL);
    snprintf(record->wallet_path, sizeof(record->wallet_path), "%s",
             wallet_path ? wallet_path : "");
    rest_task_generate_id(record->task_id, sizeof(record->task_id));
    if (task_create(record->task_id, "Preparing object transfer")
        != RESULT_SUCCESS) {
        return RESULT_FILE_ERROR;
    }
    return RESULT_SUCCESS;
}

result_t qmail_transfer_create_upload(
    const qmail_transfer_upload_options_t *options,
    qmail_transfer_record_t *record_out) {
    qmail_transfer_record_t record;
    if (!s_initialized || !options || !options->source_path ||
        !options->wallet_path || options->raida_id >= RAIDA_COUNT ||
        options->operation > 1 ||
        (options->operation == 0 && options->expected_generation != 0) ||
        (options->operation == 1 &&
         (!options->object_id ||
          bytes_zero(options->object_id, QMAIL_OT_ID_SIZE) ||
          !options->locker_key || !options->locker_key[0]))) {
        return RESULT_INVALID_PARAM;
    }
    if (!platform_file_exists(options->source_path)) {
        return RESULT_FILE_ERROR;
    }
    result_t result = initialize_new_record(
        &record, QMAIL_TRANSFER_DIRECTION_UPLOAD,
        options->raida_id, options->file_type, options->wallet_path);
    if (result != RESULT_SUCCESS) return result;
    random_nonzero(record.transfer_id);
    if (options->object_id && !bytes_zero(options->object_id, QMAIL_OT_ID_SIZE)) {
        memcpy(record.object_id, options->object_id, QMAIL_OT_ID_SIZE);
    }
    record.requested_retention_seconds =
        options->requested_retention_seconds;
    record.requested_storage_class = options->storage_class;
    record.storage_class = options->storage_class;
    record.preferred_chunk = options->preferred_chunk;
    record.operation = options->operation;
    record.expected_generation = options->expected_generation;
    record.target_generation = options->target_generation;
    if (record.target_generation == 0) {
        if (record.expected_generation == UINT64_MAX) {
            task_fail(record.task_id, "Invalid target generation");
            return RESULT_INVALID_PARAM;
        }
        record.target_generation = record.expected_generation + 1;
    }
    if (record.target_generation <= record.expected_generation) {
        task_fail(record.task_id, "Invalid target generation");
        return RESULT_INVALID_PARAM;
    }
    int source_written = snprintf(
        record.source_path, sizeof(record.source_path), "%s",
        options->source_path);
    if (source_written < 0 ||
        (size_t)source_written >= sizeof(record.source_path)) {
        task_fail(record.task_id, "Upload source path is too long");
        return RESULT_INVALID_PARAM;
    }

    qmail_pool_acquire_result_t acquisition;
    memset(&acquisition, 0, sizeof(acquisition));
    if (options->locker_key && options->locker_key[0]) {
        if (strlen(options->locker_key) > QMAIL_OT_ID_SIZE) {
            task_fail(record.task_id, "Storage locker key is too long");
            return RESULT_INVALID_PARAM;
        }
        snprintf(record.locker_key, sizeof(record.locker_key), "%s",
                 options->locker_key);
        record.locker_consumed = true;
    } else {
        if (record.operation == 1) {
            task_fail(record.task_id,
                      "Replacement requires the original storage locker key");
            return RESULT_INVALID_PARAM;
        }
        result = qmail_pool_acquire_for_send(
            options->wallet_path, 1, 0, &acquisition);
        if (result != RESULT_SUCCESS || acquisition.upload_count != 1) {
            task_fail(record.task_id, "No funded storage locker is available");
            return result == RESULT_SUCCESS ? RESULT_ERROR : result;
        }
        snprintf(record.locker_key, sizeof(record.locker_key), "%s",
                 acquisition.upload_keys[0]);
        qmail_pool_stamp_file_guid(&acquisition, record.object_id);
    }
    size_t locker_length = strlen(record.locker_key);
    if (locker_length > QMAIL_OT_ID_SIZE) locker_length = QMAIL_OT_ID_SIZE;
    memcpy(record.locker_code, record.locker_key, locker_length);
    record.total_size = 0;

    result = qmail_transfer_store_insert(&record);
    if (result != RESULT_SUCCESS) {
        if (acquisition.upload_count > 0) qmail_pool_release(&acquisition);
        task_fail(record.task_id, "Failed to persist the transfer");
        return result;
    }
    result = spawn_operation(record.operation_id);
    if (result != RESULT_SUCCESS) {
        set_record_state(&record, QMAIL_TRANSFER_STATE_PAUSED,
                         result, 0, "Transfer worker could not start");
    }
    if (record_out) *record_out = record;
    return RESULT_SUCCESS;
}

result_t qmail_transfer_create_download(
    const qmail_transfer_download_options_t *options,
    qmail_transfer_record_t *record_out) {
    qmail_transfer_record_t record;
    if (!s_initialized || !options || !options->destination_path ||
        !options->wallet_path || options->raida_id >= RAIDA_COUNT ||
        !options->object_id ||
        bytes_zero(options->object_id, QMAIL_OT_ID_SIZE)) {
        return RESULT_INVALID_PARAM;
    }
    result_t result = initialize_new_record(
        &record, QMAIL_TRANSFER_DIRECTION_DOWNLOAD,
        options->raida_id, options->file_type, options->wallet_path);
    if (result != RESULT_SUCCESS) return result;
    memcpy(record.object_id, options->object_id, QMAIL_OT_ID_SIZE);
    record.generation = options->generation;
    record.requested_range = options->preferred_range;
    int destination_written = snprintf(
        record.destination_path, sizeof(record.destination_path), "%s",
        options->destination_path);
    if (destination_written < 0 ||
        (size_t)destination_written >= sizeof(record.destination_path)) {
        task_fail(record.task_id, "Download destination path is too long");
        return RESULT_INVALID_PARAM;
    }
    char operation_hex[33];
    id_to_hex(record.operation_id, operation_hex);
    int written = snprintf(record.temporary_path, sizeof(record.temporary_path),
                           "%s.%s.qmail.part",
                           record.destination_path, operation_hex);
    if (written < 0 || (size_t)written >= sizeof(record.temporary_path)) {
        task_fail(record.task_id, "Download destination path is too long");
        return RESULT_INVALID_PARAM;
    }
    result = qmail_transfer_store_insert(&record);
    if (result != RESULT_SUCCESS) {
        task_fail(record.task_id, "Failed to persist the transfer");
        return result;
    }
    result = spawn_operation(record.operation_id);
    if (result != RESULT_SUCCESS) {
        set_record_state(&record, QMAIL_TRANSFER_STATE_PAUSED,
                         result, 0, "Transfer worker could not start");
    }
    if (record_out) *record_out = record;
    return RESULT_SUCCESS;
}

result_t qmail_transfer_create_delete(
    const qmail_transfer_delete_options_t *options,
    qmail_transfer_record_t *record_out) {
    qmail_transfer_record_t record;
    if (!s_initialized || !options || !options->wallet_path ||
        options->raida_id >= RAIDA_COUNT ||
        !options->object_id ||
        bytes_zero(options->object_id, QMAIL_OT_ID_SIZE) ||
        options->target_generation <= options->expected_generation) {
        return RESULT_INVALID_PARAM;
    }
    result_t result = initialize_new_record(
        &record, QMAIL_TRANSFER_DIRECTION_DELETE,
        options->raida_id, options->file_type, options->wallet_path);
    if (result != RESULT_SUCCESS) return result;
    memcpy(record.object_id, options->object_id, QMAIL_OT_ID_SIZE);
    record.expected_generation = options->expected_generation;
    record.target_generation = options->target_generation;
    result = qmail_transfer_store_insert(&record);
    if (result != RESULT_SUCCESS) return result;
    result = spawn_operation(record.operation_id);
    if (result != RESULT_SUCCESS) {
        set_record_state(&record, QMAIL_TRANSFER_STATE_PAUSED,
                         result, 0, "Delete worker could not start");
    }
    if (record_out) *record_out = record;
    return RESULT_SUCCESS;
}

result_t qmail_transfer_get(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_record_t *record_out) {
    return qmail_transfer_store_get(operation_id, record_out);
}

result_t qmail_transfer_resume(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    qmail_transfer_record_t record;
    result_t result = qmail_transfer_store_get(operation_id, &record);
    if (result != RESULT_SUCCESS) return result;
    if (record.state != QMAIL_TRANSFER_STATE_PAUSED) {
        return RESULT_INVALID_PARAM;
    }
    record.cancel_requested = false;
    record.retry_count = 0;
    record.state = QMAIL_TRANSFER_STATE_PAUSED;
    record.error_message[0] = '\0';
    record.updated_at = (int64_t)time(NULL);
    result = qmail_transfer_store_save(&record);
    if (result != RESULT_SUCCESS) return result;
    qmail_transfer_store_reset_inflight(operation_id);
    return spawn_operation(operation_id);
}

result_t qmail_transfer_cancel(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    return qmail_transfer_store_request_cancel(operation_id);
}

result_t qmail_transfer_manager_init(const char *db_path,
                                     core_transport_t *transport) {
    if (!db_path || !transport || !transport->send_packet) {
        return RESULT_INVALID_PARAM;
    }
    if (s_initialized) return RESULT_SUCCESS;
    if (!s_active_mutex_ready) {
        if (mutex_init(&s_active_mutex) != RESULT_SUCCESS) return RESULT_ERROR;
        s_active_mutex_ready = true;
    }
    result_t result = qmail_transfer_store_open(db_path);
    if (result != RESULT_SUCCESS) return result;
    s_transport = transport;
    s_shutdown = false;
    s_initialized = true;

    qmail_transfer_record_t *records = NULL;
    int count = 0;
    if (qmail_transfer_store_list_resumable(&records, &count) == RESULT_SUCCESS) {
        for (int i = 0; i < count; ++i) {
            if (records[i].state == QMAIL_TRANSFER_STATE_CANCELLING) {
                records[i].cancel_requested = true;
                qmail_transfer_store_save(&records[i]);
            }
            spawn_operation(records[i].operation_id);
        }
    }
    free(records);
    log_info(LOG_CAT_COMMAND,
             "QMail Object Transfer manager initialized; resumed %d operation(s)",
             count);
    return RESULT_SUCCESS;
}

void qmail_transfer_manager_shutdown(void) {
    if (!s_initialized) return;
    s_shutdown = true;
    while (active_count() > 0) {
        platform_sleep_ms(50);
    }
    qmail_transfer_store_close();
    s_transport = NULL;
    s_initialized = false;
    if (s_active_mutex_ready) {
        mutex_destroy(&s_active_mutex);
        s_active_mutex_ready = false;
    }
}

const char *qmail_transfer_state_string(qmail_transfer_state_t state) {
    switch (state) {
        case QMAIL_TRANSFER_STATE_CREATED: return "created";
        case QMAIL_TRANSFER_STATE_HASHING: return "hashing";
        case QMAIL_TRANSFER_STATE_BEGINNING: return "beginning";
        case QMAIL_TRANSFER_STATE_UPLOADING: return "uploading";
        case QMAIL_TRANSFER_STATE_COMMITTING: return "committing";
        case QMAIL_TRANSFER_STATE_QUERYING: return "querying";
        case QMAIL_TRANSFER_STATE_DOWNLOADING: return "downloading";
        case QMAIL_TRANSFER_STATE_VERIFYING: return "verifying";
        case QMAIL_TRANSFER_STATE_COMPLETED: return "completed";
        case QMAIL_TRANSFER_STATE_PAUSED: return "paused";
        case QMAIL_TRANSFER_STATE_CANCELLING: return "cancelling";
        case QMAIL_TRANSFER_STATE_CANCELLED: return "cancelled";
        case QMAIL_TRANSFER_STATE_FAILED: return "failed";
    }
    return "unknown";
}

const char *qmail_transfer_direction_string(qmail_transfer_direction_t direction) {
    switch (direction) {
        case QMAIL_TRANSFER_DIRECTION_UPLOAD: return "upload";
        case QMAIL_TRANSFER_DIRECTION_DOWNLOAD: return "download";
        case QMAIL_TRANSFER_DIRECTION_DELETE: return "delete";
    }
    return "unknown";
}
