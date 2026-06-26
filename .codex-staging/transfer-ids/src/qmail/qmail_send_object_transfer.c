/**
 * qmail_send_object_transfer.c - Durable striped Object Transfer send stage
 */

#include "qmail/qmail_send_object_transfer.h"
#include "qmail/qmail_striping.h"
#include "crypto.h"
#include "logging.h"
#include "platform.h"
#include "sha256_util.h"
#include "task_manager.h"
#include "utils.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#define qmail_mkdir(path) _mkdir(path)
#else
#include <sys/stat.h>
#define qmail_mkdir(path) mkdir(path, 0700)
#endif

#define SEND_STRIPE_BLOCK_BYTES (1024u * 1024u)
#define SEND_SETTLE_GRACE_MS 3000u
#define SEND_POLL_MS 100u

static result_t ensure_directory(const char *path) {
    char copy[QMAIL_TRANSFER_PATH_MAX];
    char *cursor;
    if (!path || !path[0] || strlen(path) >= sizeof(copy)) {
        return RESULT_INVALID_PARAM;
    }
    snprintf(copy, sizeof(copy), "%s", path);
    cursor = copy;
#ifdef _WIN32
    if (copy[0] && copy[1] == ':') cursor = copy + 2;
#endif
    while (*cursor) {
        if ((*cursor == '/' || *cursor == '\\') && cursor > copy) {
            char saved = *cursor;
            *cursor = '\0';
            qmail_mkdir(copy);
            *cursor = saved;
        }
        cursor++;
    }
    qmail_mkdir(copy);
    return RESULT_SUCCESS;
}

static result_t logical_hash(const qmail_send_object_upload_options_t *options,
                             uint8_t hash[QMAIL_OT_HASH_SIZE]) {
    if (options->source_data) {
        return crypto_sha256(options->source_data, options->source_size, hash);
    }
    uint64_t size = 0;
    result_t result = sha256_file(options->source_path, hash, &size);
    if (result != RESULT_SUCCESS || size != (uint64_t)options->source_size) {
        return RESULT_FILE_ERROR;
    }
    return RESULT_SUCCESS;
}

static void close_files(FILE *files[QMAIL_MAX_SERVERS], int count) {
    for (int i = 0; i < count; ++i) {
        if (files[i]) {
            fclose(files[i]);
            files[i] = NULL;
        }
    }
}

static void remove_files(char paths[QMAIL_MAX_SERVERS][QMAIL_TRANSFER_PATH_MAX],
                         int count) {
    for (int i = 0; i < count; ++i) {
        if (paths[i][0]) remove(paths[i]);
    }
}

static result_t stage_stripes(
    const qmail_send_object_upload_options_t *options,
    char paths[QMAIL_MAX_SERVERS][QMAIL_TRANSFER_PATH_MAX],
    uint64_t sizes[QMAIL_MAX_SERVERS]) {
    char data_root[MAX_PATH_LEN];
    char object_hex[QMAIL_OT_ID_SIZE * 2 + 1];
    char directory[QMAIL_TRANSFER_PATH_MAX];
    FILE *outputs[QMAIL_MAX_SERVERS] = {0};
    FILE *source = NULL;
    uint8_t *block = NULL;
    size_t offset = 0;
    result_t result = RESULT_SUCCESS;

    platform_get_client_data_dir(data_root);
    utils_bytes_to_hex(options->object_id, QMAIL_OT_ID_SIZE, object_hex);
    if (snprintf(directory, sizeof(directory), "%s%sObjectTransfers%s%s",
                 data_root, PATH_SEPARATOR_STR, PATH_SEPARATOR_STR, object_hex)
        >= (int)sizeof(directory)) {
        return RESULT_INVALID_PARAM;
    }
    result = ensure_directory(directory);
    if (result != RESULT_SUCCESS) return result;

    for (int i = 0; i < options->server_count; ++i) {
        int written = snprintf(paths[i], QMAIL_TRANSFER_PATH_MAX,
                               "%s%sf%03u-s%02d.bin",
                               directory, PATH_SEPARATOR_STR,
                               (unsigned)options->file_type, i);
        if (written < 0 || written >= QMAIL_TRANSFER_PATH_MAX) {
            result = RESULT_INVALID_PARAM;
            goto cleanup;
        }
        outputs[i] = fopen(paths[i], "wb");
        if (!outputs[i]) {
            result = RESULT_FILE_ERROR;
            goto cleanup;
        }
    }

    if (!options->source_data) {
        source = fopen(options->source_path, "rb");
        if (!source) {
            result = RESULT_FILE_ERROR;
            goto cleanup;
        }
    }

    if ((size_t)options->data_stripe_count >
        SIZE_MAX / SEND_STRIPE_BLOCK_BYTES) {
        result = RESULT_INVALID_PARAM;
        goto cleanup;
    }
    size_t block_capacity =
        (size_t)options->data_stripe_count * SEND_STRIPE_BLOCK_BYTES;
    block = (uint8_t *)malloc(block_capacity);
    if (!block) {
        result = RESULT_MEMORY_ERROR;
        goto cleanup;
    }

    while (offset < options->source_size) {
        size_t remaining = options->source_size - offset;
        size_t length = remaining < block_capacity ? remaining : block_capacity;
        const uint8_t *data = options->source_data
            ? options->source_data + offset : block;
        if (source && fread(block, 1, length, source) != length) {
            result = RESULT_FILE_ERROR;
            goto cleanup;
        }

        uint8_t *stripes[QMAIL_MAX_SERVERS] = {0};
        size_t stripe_sizes[QMAIL_MAX_SERVERS] = {0};
        uint8_t *parity = NULL;
        size_t parity_size = 0;
        result = qmail_stripe_split(data, length,
                                    options->data_stripe_count,
                                    stripes, stripe_sizes);
        if (result == RESULT_SUCCESS) {
            result = qmail_stripe_parity((const uint8_t **)stripes,
                                         stripe_sizes,
                                         options->data_stripe_count,
                                         &parity, &parity_size);
        }
        if (result != RESULT_SUCCESS) {
            for (int i = 0; i < options->data_stripe_count; ++i) {
                qmail_stripe_free(stripes[i]);
            }
            qmail_stripe_free(parity);
            goto cleanup;
        }

        for (int i = 0; i < options->server_count; ++i) {
            const uint8_t *stripe = i < options->data_stripe_count
                ? stripes[i] : parity;
            size_t stripe_size = i < options->data_stripe_count
                ? stripe_sizes[i] : parity_size;
            if (fwrite(stripe, 1, stripe_size, outputs[i]) != stripe_size) {
                result = RESULT_FILE_ERROR;
                break;
            }
            sizes[i] += stripe_size;
        }
        for (int i = 0; i < options->data_stripe_count; ++i) {
            qmail_stripe_free(stripes[i]);
        }
        qmail_stripe_free(parity);
        if (result != RESULT_SUCCESS) goto cleanup;
        offset += length;
    }

cleanup:
    free(block);
    if (source) fclose(source);
    close_files(outputs, options->server_count);
    if (result != RESULT_SUCCESS) remove_files(paths, options->server_count);
    return result;
}

static bool transfer_finished(const qmail_transfer_record_t *record) {
    return record &&
           (record->state == QMAIL_TRANSFER_STATE_COMPLETED ||
            record->state == QMAIL_TRANSFER_STATE_CANCELLED ||
            record->state == QMAIL_TRANSFER_STATE_FAILED ||
            (record->state == QMAIL_TRANSFER_STATE_PAUSED &&
             record->retry_count >= 4));
}

static void capture_transfer_record(
        qmail_send_object_upload_result_t *result,
        int server_index,
        const qmail_transfer_record_t *record) {
    if (!result || !record ||
        server_index < 0 || server_index >= QMAIL_MAX_SERVERS) {
        return;
    }
    result->operation_created[server_index] = true;
    memcpy(result->operation_ids[server_index], record->operation_id,
           QMAIL_OT_ID_SIZE);
    snprintf(result->task_ids[server_index],
             sizeof(result->task_ids[server_index]), "%s", record->task_id);
    result->expires_at[server_index] = record->expires_at;
}

result_t qmail_send_object_upload(
    const qmail_send_object_upload_options_t *options,
    qmail_send_object_upload_result_t *result) {
    char paths[QMAIL_MAX_SERVERS][QMAIL_TRANSFER_PATH_MAX] = {{0}};
    bool created[QMAIL_MAX_SERVERS] = {0};
    qmail_transfer_record_t *operations = NULL;
    uint64_t threshold_at = 0;
    if (!options || !result || !options->wallet_path ||
        (!options->source_data && !options->source_path) ||
        options->source_size == 0 || !options->object_id ||
        !options->server_indices || !options->locker_keys ||
        options->server_count < 2 ||
        options->server_count > QMAIL_MAX_SERVERS ||
        options->data_stripe_count <= 0 ||
        options->data_stripe_count >= options->server_count) {
        return RESULT_INVALID_PARAM;
    }
    memset(result, 0, sizeof(*result));
    operations = (qmail_transfer_record_t *)calloc(
        (size_t)options->server_count, sizeof(*operations));
    if (!operations) return RESULT_MEMORY_ERROR;

    result_t status = logical_hash(options, result->logical_hash);
    if (status != RESULT_SUCCESS) {
        free(operations);
        return status;
    }
    status = stage_stripes(options, paths, result->stripe_sizes);
    if (status != RESULT_SUCCESS) {
        free(operations);
        return status;
    }

    for (int i = 0; i < options->server_count; ++i) {
        if (options->server_enabled && !options->server_enabled[i]) {
            remove(paths[i]);
            continue;
        }
        qmail_transfer_upload_options_t upload;
        memset(&upload, 0, sizeof(upload));
        upload.source_path = paths[i];
        upload.wallet_path = options->wallet_path;
        upload.raida_id = options->server_indices[i];
        upload.file_type = options->file_type;
        upload.object_id = options->object_id;
        upload.locker_key = options->locker_keys[i];
        upload.requested_retention_seconds = options->retention_seconds;
        upload.target_generation = options->target_generation;
        status = qmail_transfer_create_upload(&upload, &operations[i]);
        if (status == RESULT_SUCCESS) {
            created[i] = true;
            capture_transfer_record(result, i, &operations[i]);
        } else {
            remove(paths[i]);
            result->failed_count++;
        }
    }

    for (;;) {
        int completed = 0;
        int finished = 0;
        for (int i = 0; i < options->server_count; ++i) {
            if (!created[i]) {
                finished++;
                continue;
            }
            qmail_transfer_record_t record;
            if (qmail_transfer_get(operations[i].operation_id, &record)
                != RESULT_SUCCESS) {
                continue;
            }
            operations[i] = record;
            capture_transfer_record(result, i, &record);
            if (record.state == QMAIL_TRANSFER_STATE_COMPLETED) {
                if (!result->server_ok[i]) {
                    result->server_ok[i] = true;
                    remove(paths[i]);
                }
                completed++;
                finished++;
            } else if (transfer_finished(&record)) {
                finished++;
            }
        }
        result->completed_count = completed;
        result->failed_count = options->server_count - completed;

        if (completed >= options->data_stripe_count) {
            if (finished == options->server_count) break;
            if (threshold_at == 0) threshold_at = platform_time_ms();
            if (platform_time_ms() - threshold_at >= SEND_SETTLE_GRACE_MS) {
                for (int i = 0; i < options->server_count; ++i) {
                    if (created[i] && !result->server_ok[i] &&
                        !transfer_finished(&operations[i])) {
                        qmail_transfer_cancel(operations[i].operation_id);
                    }
                }
                break;
            }
        } else if (finished == options->server_count) {
            break;
        }

        if (options->task_id && options->file_count > 0) {
            int base = 5 + (85 * options->file_index / options->file_count);
            int end = 5 + (85 * (options->file_index + 1) / options->file_count);
            int span = end - base;
            int progress = base +
                span * completed / options->server_count;
            task_update_progress(options->task_id, progress,
                                 "Uploading object-transfer stripes");
        }
        platform_sleep_ms(SEND_POLL_MS);
    }

    for (int i = 0; i < options->server_count; ++i) {
        if (!created[i] || result->server_ok[i]) continue;
        qmail_transfer_record_t record;
        if (qmail_transfer_get(operations[i].operation_id, &record)
            == RESULT_SUCCESS) {
            operations[i] = record;
            capture_transfer_record(result, i, &record);
            log_warn(LOG_CAT_COMMAND,
                     "QMail object upload file_type=%u RAIDA %u did not commit: %s",
                     options->file_type, options->server_indices[i],
                     record.error_message[0] ? record.error_message
                                             : qmail_transfer_state_string(record.state));
        }
    }

    status = result->completed_count >= options->data_stripe_count
        ? RESULT_SUCCESS : RESULT_ERROR;
    free(operations);
    return status;
}
