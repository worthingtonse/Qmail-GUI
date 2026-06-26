/**
 * api_handlers_qmail_object_transfer.c - Durable Object Transfer v1 REST API
 */

#include "api_handlers.h"
#include "api_handlers_qmail_utils.h"
#include "qmail/qmail_transfer_manager.h"
#include "utils.h"
#include <errno.h>

static bool require_method(http_request_t *request,
                           http_response_t *response,
                           const char *method,
                           const char *rid) {
    if (strcmp(request->method, method) == 0) return true;
    api_qmail_error_response_with_rid(
        response, "Method not allowed", 405, rid);
    strcpy(response->status_message, "Method Not Allowed");
    return false;
}

static bool parse_u64(const char *text, uint64_t *out) {
    char *end = NULL;
    unsigned long long value;
    if (!text || !text[0] || text[0] == '-') return false;
    errno = 0;
    value = strtoull(text, &end, 10);
    if (errno == ERANGE || !end || *end != '\0') return false;
    *out = (uint64_t)value;
    return true;
}

static bool optional_u64(http_request_t *request,
                         http_response_t *response,
                         const char *name,
                         uint64_t default_value,
                         uint64_t *out,
                         const char *rid) {
    const char *value = http_request_get_param(request, name);
    if (!value || !value[0]) {
        *out = default_value;
        return true;
    }
    if (parse_u64(value, out)) return true;
    char message[160];
    snprintf(message, sizeof(message), "Invalid %s", name);
    api_qmail_error_response_with_rid(response, message, 400, rid);
    return false;
}

static bool optional_u32(http_request_t *request,
                         http_response_t *response,
                         const char *name,
                         uint32_t default_value,
                         uint32_t *out,
                         const char *rid) {
    const char *value = http_request_get_param(request, name);
    if (!value || !value[0]) {
        *out = default_value;
        return true;
    }
    if (http_param_parse_uint32(value, out)) return true;
    char message[160];
    snprintf(message, sizeof(message), "Invalid %s", name);
    api_qmail_error_response_with_rid(response, message, 400, rid);
    return false;
}

static bool bounded_u32(http_request_t *request,
                        http_response_t *response,
                        const char *name,
                        uint32_t default_value,
                        uint32_t maximum,
                        uint32_t *out,
                        const char *rid) {
    if (!optional_u32(request, response, name, default_value, out, rid)) {
        return false;
    }
    if (*out <= maximum) return true;
    char message[160];
    snprintf(message, sizeof(message), "%s is out of range", name);
    api_qmail_error_response_with_rid(response, message, 400, rid);
    return false;
}

static void add_u64_string(json_builder_t *jb,
                           const char *key,
                           uint64_t value) {
    char text[32];
#ifdef _WIN32
    snprintf(text, sizeof(text), "%I64u", (unsigned long long)value);
#else
    snprintf(text, sizeof(text), "%llu", (unsigned long long)value);
#endif
    json_add_string(jb, key, text);
}

static void add_transfer(json_builder_t *jb,
                         const qmail_transfer_record_t *record) {
    char operation_id[33];
    char transfer_id[33];
    char object_id[33];
    char object_hash[65];
    api_qmail_guid_to_hex(record->operation_id, operation_id);
    api_qmail_guid_to_hex(record->transfer_id, transfer_id);
    api_qmail_guid_to_hex(record->object_id, object_id);
    utils_bytes_to_hex(record->object_hash, QMAIL_OT_HASH_SIZE, object_hash);

    json_add_string(jb, "operation_id", operation_id);
    json_add_string(jb, "task_id", record->task_id);
    json_add_string(jb, "direction",
                    qmail_transfer_direction_string(record->direction));
    json_add_string(jb, "state",
                    qmail_transfer_state_string(record->state));
    json_add_int(jb, "raida_id", record->raida_id);
    json_add_string(jb, "transfer_id", transfer_id);
    json_add_string(jb, "object_id", object_id);
    json_add_int(jb, "file_type", record->file_type);
    json_add_int(jb, "requested_storage_class",
                 record->requested_storage_class);
    json_add_int(jb, "storage_class", record->storage_class);
    add_u64_string(jb, "generation", record->generation);
    add_u64_string(jb, "target_generation", record->target_generation);
    add_u64_string(jb, "total_bytes", record->total_size);
    add_u64_string(jb, "completed_bytes", record->completed_bytes);
    int progress = 0;
    if (record->total_size > 0) {
        if (record->completed_bytes >= record->total_size) {
            progress = 100;
        } else {
            long double ratio = (long double)record->completed_bytes /
                                (long double)record->total_size;
            progress = (int)(ratio * 100.0L);
        }
    }
    json_add_int(jb, "progress", progress);
    json_add_int(jb, "chunk_bytes", (int)record->accepted_chunk);
    json_add_int(jb, "max_parallel", record->max_parallel);
    add_u64_string(jb, "expires_at", record->expires_at);
    json_add_string(jb, "object_hash", object_hash);
    json_add_bool(jb, "cancel_requested", record->cancel_requested);
    json_add_int(jb, "last_result", record->last_result);
    json_add_int(jb, "last_status", record->last_status);
    if (record->error_message[0]) {
        json_add_string(jb, "error", record->error_message);
    }
    if (record->direction == QMAIL_TRANSFER_DIRECTION_DOWNLOAD) {
        json_add_string(jb, "destination_path", record->destination_path);
        if (record->state != QMAIL_TRANSFER_STATE_COMPLETED) {
            json_add_string(jb, "temporary_path", record->temporary_path);
        }
    } else if (record->direction == QMAIL_TRANSFER_DIRECTION_UPLOAD) {
        json_add_string(jb, "source_path", record->source_path);
    }
    json_add_int64(jb, "created_at", record->created_at);
    json_add_int64(jb, "updated_at", record->updated_at);
}

static void send_transfer_response(http_response_t *response,
                                   const qmail_transfer_record_t *record,
                                   const char *message,
                                   const char *rid) {
    json_builder_t jb;
    api_qmail_success_response(&jb, message);
    api_qmail_add_request_id(&jb, rid);
    add_transfer(&jb, record);
    json_object_end(&jb);
    http_response_set_json(response, &jb);
}

static bool parse_operation_id(http_request_t *request,
                               http_response_t *response,
                               uint8_t operation_id[QMAIL_OT_ID_SIZE],
                               const char *rid) {
    return api_qmail_require_guid_param_with_rid(
        request, response, "operation_id",
        "operation_id is required", "Invalid operation_id",
        operation_id, rid);
}

static bool begin_wallet_request(http_request_t *request,
                                 http_response_t *response,
                                 char wallet_path[QMAIL_TRANSFER_PATH_MAX],
                                 const char *rid) {
    core_transport_t *transport = NULL;
    return api_qmail_begin_request_with_rid(
        request, response, wallet_path, QMAIL_TRANSFER_PATH_MAX,
        &transport, NULL, 400, NULL, rid) == RESULT_SUCCESS;
}

void api_handle_qmail_object_capabilities(http_request_t *request,
                                           http_response_t *response,
                                           void *user_data) {
    (void)user_data;
    char rid[API_QMAIL_RID_LEN];
    char wallet_path[QMAIL_TRANSFER_PATH_MAX];
    uint32_t raida_id;
    api_qmail_generate_rid(rid);
    if (!require_method(request, response, "GET", rid) ||
        !bounded_u32(request, response, "raida_id", 0,
                     RAIDA_COUNT - 1, &raida_id, rid) ||
        !begin_wallet_request(request, response, wallet_path, rid)) {
        return;
    }

    qmail_transfer_capabilities_t result;
    result_t command_result = qmail_transfer_query_capabilities(
        wallet_path, (uint8_t)raida_id, &result);
    if (command_result != RESULT_SUCCESS) {
        api_qmail_result_error_response_with_rid(
            response, "Capability query failed", 502, command_result, rid);
        return;
    }

    json_builder_t jb;
    api_qmail_success_response(&jb, "Object Transfer capabilities");
    api_qmail_add_request_id(&jb, rid);
    json_add_int(&jb, "raida_id", (int)raida_id);
    json_add_int(&jb, "capability_schema",
                 result.capabilities.capability_schema);
    json_add_int(&jb, "protocol_min", result.capabilities.protocol_min);
    json_add_int(&jb, "protocol_max", result.capabilities.protocol_max);
    json_add_int(&jb, "transport_flags", result.capabilities.transport_flags);
    json_add_int64(&jb, "server_flags",
                   (int64_t)result.capabilities.server_flags);
    json_add_int64(&jb, "preferred_chunk_bytes",
                   (int64_t)result.capabilities.preferred_chunk);
    json_add_int64(&jb, "max_chunk_bytes",
                   (int64_t)result.capabilities.max_chunk);
    json_add_int64(&jb, "max_download_range_bytes",
                   (int64_t)result.capabilities.max_download_range);
    json_add_int64(&jb, "max_active_transfers",
                   (int64_t)result.capabilities.max_active_transfers);
    json_add_int(&jb, "max_parallel",
                 result.capabilities.max_parallel_transfer);
    add_u64_string(&jb, "max_object_bytes",
                   result.capabilities.max_object_global);
    add_u64_string(&jb, "generated_at", result.capabilities.generated_at);
    add_u64_string(&jb, "expires_at", result.capabilities.expires_at);
    json_add_int(&jb, "payment_mode", result.capabilities.payment_mode);
    json_key(&jb, "storage_classes");
    json_array_begin(&jb);
    for (uint16_t i = 0; i < result.class_count; ++i) {
        const qmail_ot_storage_class_entry_t *entry = &result.classes[i];
        json_object_begin(&jb);
        json_add_int(&jb, "class_id", entry->class_id);
        json_add_int(&jb, "media_type", entry->media_type);
        json_add_int(&jb, "class_flags", entry->class_flags);
        add_u64_string(&jb, "max_object_bytes", entry->max_object);
        add_u64_string(&jb, "capacity_bytes", entry->capacity_bytes);
        add_u64_string(&jb, "available_bytes", entry->available_bytes);
        add_u64_string(&jb, "max_retention_seconds",
                       entry->max_retention_seconds);
        json_add_int64(&jb, "price_schedule_id",
                       (int64_t)entry->price_schedule_id);
        json_object_end(&jb);
    }
    json_array_end(&jb);
    json_object_end(&jb);
    http_response_set_json(response, &jb);
}

void api_handle_qmail_object_upload_begin(http_request_t *request,
                                           http_response_t *response,
                                           void *user_data) {
    (void)user_data;
    char rid[API_QMAIL_RID_LEN];
    char wallet_path[QMAIL_TRANSFER_PATH_MAX];
    uint32_t raida_id, file_type, storage_class, preferred_chunk, operation;
    uint64_t retention, expected_generation, target_generation;
    uint8_t object_id[QMAIL_OT_ID_SIZE];
    const uint8_t *object_id_ptr = NULL;
    api_qmail_generate_rid(rid);
    if (!require_method(request, response, "POST", rid)) return;
    const char *source_path = http_request_get_param(request, "source_path");
    if (!source_path || !source_path[0]) {
        api_qmail_error_response_with_rid(
            response, "source_path is required", 400, rid);
        return;
    }
    if (!bounded_u32(request, response, "raida_id", 0, RAIDA_COUNT - 1,
                     &raida_id, rid) ||
        !bounded_u32(request, response, "file_type", 2, UINT8_MAX,
                     &file_type, rid) ||
        !bounded_u32(request, response, "storage_class", 0, UINT16_MAX,
                     &storage_class, rid) ||
        !optional_u32(request, response, "preferred_chunk_bytes", 0,
                      &preferred_chunk, rid) ||
        !bounded_u32(request, response, "operation", 0, 1,
                     &operation, rid) ||
        !optional_u64(request, response, "retention_seconds", 0,
                      &retention, rid) ||
        !optional_u64(request, response, "expected_generation", 0,
                      &expected_generation, rid) ||
        !optional_u64(request, response, "target_generation", 0,
                      &target_generation, rid) ||
        !begin_wallet_request(request, response, wallet_path, rid)) {
        return;
    }
    const char *object_hex = http_request_get_param(request, "object_id");
    if (object_hex && object_hex[0]) {
        if (!api_qmail_hex_to_guid(object_hex, object_id)) {
            api_qmail_error_response_with_rid(
                response, "Invalid object_id", 400, rid);
            return;
        }
        object_id_ptr = object_id;
    }
    const char *locker_key = http_request_get_param(request, "locker_key");
    if (operation == 0 && expected_generation != 0) {
        api_qmail_error_response_with_rid(
            response, "Create requires expected_generation=0", 400, rid);
        return;
    }
    if (operation == 1 &&
        (!object_id_ptr || !locker_key || !locker_key[0])) {
        api_qmail_error_response_with_rid(
            response,
            "Replacement requires object_id and the original locker_key",
            400, rid);
        return;
    }

    qmail_transfer_upload_options_t options;
    memset(&options, 0, sizeof(options));
    options.source_path = source_path;
    options.wallet_path = wallet_path;
    options.raida_id = (uint8_t)raida_id;
    options.file_type = (uint8_t)file_type;
    options.object_id = object_id_ptr;
    options.locker_key = locker_key;
    options.requested_retention_seconds = retention;
    options.storage_class = (uint16_t)storage_class;
    options.preferred_chunk = preferred_chunk;
    options.operation = (uint8_t)operation;
    options.expected_generation = expected_generation;
    options.target_generation = target_generation;

    qmail_transfer_record_t record;
    result_t result = qmail_transfer_create_upload(&options, &record);
    if (result != RESULT_SUCCESS) {
        api_qmail_result_error_response_with_rid(
            response, "Could not create upload", 400, result, rid);
        return;
    }
    response->status_code = 202;
    strcpy(response->status_message, "Accepted");
    send_transfer_response(
        response, &record, "Object upload accepted", rid);
}

void api_handle_qmail_object_download_begin(http_request_t *request,
                                             http_response_t *response,
                                             void *user_data) {
    (void)user_data;
    char rid[API_QMAIL_RID_LEN];
    char wallet_path[QMAIL_TRANSFER_PATH_MAX];
    uint32_t raida_id, file_type, preferred_range;
    uint64_t generation;
    uint8_t object_id[QMAIL_OT_ID_SIZE];
    api_qmail_generate_rid(rid);
    if (!require_method(request, response, "POST", rid)) return;
    const char *destination =
        http_request_get_param(request, "destination_path");
    if (!destination || !destination[0]) {
        api_qmail_error_response_with_rid(
            response, "destination_path is required", 400, rid);
        return;
    }
    if (!api_qmail_require_guid_param_with_rid(
            request, response, "object_id", "object_id is required",
            "Invalid object_id", object_id, rid) ||
        !bounded_u32(request, response, "raida_id", 0, RAIDA_COUNT - 1,
                     &raida_id, rid) ||
        !bounded_u32(request, response, "file_type", 2, UINT8_MAX,
                     &file_type, rid) ||
        !optional_u32(request, response, "preferred_range_bytes", 0,
                      &preferred_range, rid) ||
        !optional_u64(request, response, "generation", 0,
                      &generation, rid) ||
        !begin_wallet_request(request, response, wallet_path, rid)) {
        return;
    }

    qmail_transfer_download_options_t options;
    memset(&options, 0, sizeof(options));
    options.destination_path = destination;
    options.wallet_path = wallet_path;
    options.raida_id = (uint8_t)raida_id;
    options.file_type = (uint8_t)file_type;
    options.object_id = object_id;
    options.generation = generation;
    options.preferred_range = preferred_range;

    qmail_transfer_record_t record;
    result_t result = qmail_transfer_create_download(&options, &record);
    if (result != RESULT_SUCCESS) {
        api_qmail_result_error_response_with_rid(
            response, "Could not create download", 400, result, rid);
        return;
    }
    response->status_code = 202;
    strcpy(response->status_message, "Accepted");
    send_transfer_response(
        response, &record, "Object download accepted", rid);
}

void api_handle_qmail_object_transfer_status(http_request_t *request,
                                              http_response_t *response,
                                              void *user_data) {
    (void)user_data;
    char rid[API_QMAIL_RID_LEN];
    uint8_t operation_id[QMAIL_OT_ID_SIZE];
    api_qmail_generate_rid(rid);
    if (!require_method(request, response, "GET", rid) ||
        !parse_operation_id(request, response, operation_id, rid)) {
        return;
    }
    qmail_transfer_record_t record;
    result_t result = qmail_transfer_get(operation_id, &record);
    if (result != RESULT_SUCCESS) {
        api_qmail_result_error_response_with_rid(
            response, "Transfer not found", 404, result, rid);
        return;
    }
    send_transfer_response(response, &record, NULL, rid);
}

void api_handle_qmail_object_transfer_resume(http_request_t *request,
                                              http_response_t *response,
                                              void *user_data) {
    (void)user_data;
    char rid[API_QMAIL_RID_LEN];
    uint8_t operation_id[QMAIL_OT_ID_SIZE];
    api_qmail_generate_rid(rid);
    if (!require_method(request, response, "POST", rid) ||
        !parse_operation_id(request, response, operation_id, rid)) {
        return;
    }
    result_t result = qmail_transfer_resume(operation_id);
    if (result != RESULT_SUCCESS) {
        api_qmail_result_error_response_with_rid(
            response, "Transfer could not be resumed",
            result == RESULT_NOT_FOUND ? 404 : 409, result, rid);
        return;
    }
    qmail_transfer_record_t record;
    qmail_transfer_get(operation_id, &record);
    send_transfer_response(response, &record, "Transfer resumed", rid);
}

void api_handle_qmail_object_transfer_cancel(http_request_t *request,
                                              http_response_t *response,
                                              void *user_data) {
    (void)user_data;
    char rid[API_QMAIL_RID_LEN];
    uint8_t operation_id[QMAIL_OT_ID_SIZE];
    api_qmail_generate_rid(rid);
    if (!require_method(request, response, "POST", rid) ||
        !parse_operation_id(request, response, operation_id, rid)) {
        return;
    }
    result_t result = qmail_transfer_cancel(operation_id);
    if (result != RESULT_SUCCESS) {
        api_qmail_result_error_response_with_rid(
            response, "Transfer could not be cancelled",
            result == RESULT_NOT_FOUND ? 404 : 409, result, rid);
        return;
    }
    qmail_transfer_record_t record;
    qmail_transfer_get(operation_id, &record);
    send_transfer_response(
        response, &record, "Cancellation requested", rid);
}

void api_handle_qmail_object_delete(http_request_t *request,
                                     http_response_t *response,
                                     void *user_data) {
    (void)user_data;
    char rid[API_QMAIL_RID_LEN];
    char wallet_path[QMAIL_TRANSFER_PATH_MAX];
    uint8_t object_id[QMAIL_OT_ID_SIZE];
    uint32_t raida_id, file_type;
    uint64_t expected_generation, target_generation;
    api_qmail_generate_rid(rid);
    if (!require_method(request, response, "POST", rid) ||
        !api_qmail_require_guid_param_with_rid(
            request, response, "object_id", "object_id is required",
            "Invalid object_id", object_id, rid) ||
        !bounded_u32(request, response, "raida_id", 0, RAIDA_COUNT - 1,
                     &raida_id, rid) ||
        !bounded_u32(request, response, "file_type", 2, UINT8_MAX,
                     &file_type, rid) ||
        !optional_u64(request, response, "expected_generation", 0,
                      &expected_generation, rid) ||
        !optional_u64(request, response, "target_generation", 0,
                      &target_generation, rid) ||
        !begin_wallet_request(request, response, wallet_path, rid)) {
        return;
    }
    if (target_generation <= expected_generation) {
        api_qmail_error_response_with_rid(
            response,
            "target_generation must be greater than expected_generation",
            400, rid);
        return;
    }

    qmail_transfer_delete_options_t options;
    memset(&options, 0, sizeof(options));
    options.wallet_path = wallet_path;
    options.raida_id = (uint8_t)raida_id;
    options.file_type = (uint8_t)file_type;
    options.object_id = object_id;
    options.expected_generation = expected_generation;
    options.target_generation = target_generation;

    qmail_transfer_record_t record;
    result_t result = qmail_transfer_create_delete(&options, &record);
    if (result != RESULT_SUCCESS) {
        api_qmail_result_error_response_with_rid(
            response, "Could not create object deletion", 400, result, rid);
        return;
    }
    response->status_code = 202;
    strcpy(response->status_message, "Accepted");
    send_transfer_response(
        response, &record, "Object deletion accepted", rid);
}
