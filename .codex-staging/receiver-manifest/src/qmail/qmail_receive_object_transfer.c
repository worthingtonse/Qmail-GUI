/**
 * qmail_receive_object_transfer.c - Revised-manifest object receiver
 */

#include "qmail/qmail_receive_object_transfer.h"
#include "qmail/qmail_transfer_manager.h"
#include "logging.h"
#include "platform.h"
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

#define RECEIVE_STRIPE_BLOCK_BYTES (1024u * 1024u)
#define RECEIVE_SETTLE_GRACE_MS 3000u
#define RECEIVE_POLL_MS 100u

static void set_error(char *out, size_t out_size, const char *message) {
    if (out && out_size > 0) {
        snprintf(out, out_size, "%s", message ? message : "");
    }
}

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

static bool transfer_finished(const qmail_transfer_record_t *record) {
    return record &&
           (record->state == QMAIL_TRANSFER_STATE_COMPLETED ||
            record->state == QMAIL_TRANSFER_STATE_CANCELLED ||
            record->state == QMAIL_TRANSFER_STATE_FAILED ||
            (record->state == QMAIL_TRANSFER_STATE_PAUSED &&
             record->retry_count >= 4));
}

static size_t stripe_bytes_for_logical_chunk(size_t logical_size,
                                             int data_stripe_count) {
    if (logical_size == 0 || data_stripe_count <= 0 ||
        logical_size > SIZE_MAX / 8u) {
        return 0;
    }
    size_t total_bits = logical_size * 8u;
    size_t bits_per_stripe =
        (total_bits + (size_t)data_stripe_count - 1u) /
        (size_t)data_stripe_count;
    return (bits_per_stripe + 7u) / 8u;
}

static uint64_t expected_staged_stripe_size(uint64_t original_size,
                                            int data_stripe_count) {
    uint64_t logical_block =
        (uint64_t)data_stripe_count * RECEIVE_STRIPE_BLOCK_BYTES;
    uint64_t full_blocks = original_size / logical_block;
    uint64_t remainder = original_size % logical_block;
    uint64_t total = full_blocks * RECEIVE_STRIPE_BLOCK_BYTES;
    if (remainder > 0) {
        size_t final_bytes = stripe_bytes_for_logical_chunk(
            (size_t)remainder, data_stripe_count);
        total += (uint64_t)final_bytes;
    }
    return total;
}

static bool recoverable(const bool completed[QMAIL_MAX_SERVERS],
                        int data_stripe_count,
                        int parity_stripe_index) {
    int data_completed = 0;
    for (int i = 0; i < data_stripe_count; ++i) {
        if (completed[i]) data_completed++;
    }
    return data_completed == data_stripe_count ||
           (data_completed == data_stripe_count - 1 &&
            parity_stripe_index >= 0 &&
            completed[parity_stripe_index]);
}

result_t qmail_receive_object_download(
    const qmail_tell_notification_t *notification,
    const qmail_ot_manifest_v2_entry_t *entry,
    const char *wallet_path,
    const char *destination_path,
    qmail_receive_object_result_t *result,
    char *error_out,
    size_t error_out_size) {
    qmail_transfer_record_t operations[QMAIL_MAX_SERVERS];
    bool created[QMAIL_MAX_SERVERS] = {0};
    bool rejected[QMAIL_MAX_SERVERS] = {0};
    bool completed_by_index[QMAIL_MAX_SERVERS] = {0};
    char paths[QMAIL_MAX_SERVERS][QMAIL_TRANSFER_PATH_MAX] = {{0}};
    const char *stripe_paths[QMAIL_MAX_SERVERS] = {0};
    char data_root[MAX_PATH_LEN];
    char object_hex[QMAIL_OT_ID_SIZE * 2 + 1];
    char attempt_hex[17];
    char directory[QMAIL_TRANSFER_PATH_MAX];
    uint8_t attempt[8];
    int data_stripe_count;
    int parity_stripe_index = -1;
    int server_count;
    int created_count = 0;
    int completed_count = 0;
    uint64_t threshold_at = 0;
    uint64_t expected_stripe_size;
    result_t status = RESULT_SUCCESS;

    if (result) memset(result, 0, sizeof(*result));
    if (!notification || !entry || !wallet_path || !wallet_path[0] ||
        !destination_path ||
        notification->manifest_version != QMAIL_TELL_MANIFEST_VERSION_2 ||
        entry->storage_protocol != QMAIL_OT_STORAGE_PROTOCOL_V1 ||
        entry->hash_algorithm != QMAIL_OT_HASH_SHA256 ||
        entry->original_size == 0) {
        return RESULT_INVALID_PARAM;
    }
    data_stripe_count = 0;
    server_count = notification->server_count;
    if (server_count > QMAIL_MAX_SERVERS) server_count = QMAIL_MAX_SERVERS;
    for (int i = 0; i < server_count; ++i) {
        int stripe_index = notification->servers[i].stripe_index;
        if (stripe_index < 0 || stripe_index >= QMAIL_MAX_SERVERS) continue;
        if (notification->servers[i].stripe_type == 1) {
            parity_stripe_index = stripe_index;
        } else if (stripe_index + 1 > data_stripe_count) {
            data_stripe_count = stripe_index + 1;
        }
    }
    if (parity_stripe_index > 0) {
        data_stripe_count = parity_stripe_index;
    }
    if (data_stripe_count <= 0 ||
        data_stripe_count >= QMAIL_MAX_SERVERS ||
        (parity_stripe_index >= 0 &&
         parity_stripe_index != data_stripe_count)) {
        set_error(error_out, error_out_size,
                  "The revised-manifest stripe geometry is invalid");
        return RESULT_ERROR;
    }
    expected_stripe_size =
        expected_staged_stripe_size(entry->original_size, data_stripe_count);

    platform_get_client_data_dir(data_root);
    utils_bytes_to_hex(entry->object_id, QMAIL_OT_ID_SIZE, object_hex);
    platform_random_bytes(attempt, sizeof(attempt));
    utils_bytes_to_hex(attempt, sizeof(attempt), attempt_hex);
    if (snprintf(directory, sizeof(directory),
                 "%s%sObjectTransfers%sReceive%s%s%sg%llu-f%03u-%s",
                 data_root, PATH_SEPARATOR_STR, PATH_SEPARATOR_STR,
                 PATH_SEPARATOR_STR, object_hex, PATH_SEPARATOR_STR,
                 (unsigned long long)entry->generation,
                 (unsigned)entry->file_type, attempt_hex)
        >= (int)sizeof(directory) ||
        ensure_directory(directory) != RESULT_SUCCESS) {
        set_error(error_out, error_out_size,
                  "The object-transfer receive directory could not be created");
        return RESULT_FILE_ERROR;
    }

    memset(operations, 0, sizeof(operations));
    for (int i = 0; i < server_count; ++i) {
        int stripe_index = notification->servers[i].stripe_index;
        uint8_t raida_id = notification->servers[i].server_id;
        if (stripe_index < 0 || stripe_index >= QMAIL_MAX_SERVERS ||
            raida_id >= RAIDA_COUNT || created[stripe_index]) {
            continue;
        }
        if (snprintf(paths[stripe_index], sizeof(paths[stripe_index]),
                     "%s%ss%02d-r%02u.bin", directory, PATH_SEPARATOR_STR,
                     stripe_index, (unsigned)raida_id)
            >= (int)sizeof(paths[stripe_index])) {
            continue;
        }
        qmail_transfer_download_options_t options;
        memset(&options, 0, sizeof(options));
        options.destination_path = paths[stripe_index];
        options.wallet_path = wallet_path;
        options.raida_id = raida_id;
        options.file_type = entry->file_type;
        options.object_id = entry->object_id;
        options.generation = entry->generation;
        status = qmail_transfer_create_download(&options,
                                                &operations[stripe_index]);
        if (status == RESULT_SUCCESS) {
            created[stripe_index] = true;
            created_count++;
        } else {
            paths[stripe_index][0] = '\0';
        }
    }
    if (created_count < data_stripe_count) {
        set_error(error_out, error_out_size,
                  "Too few revised-manifest stripe downloads could be started");
        status = RESULT_ERROR;
        goto cleanup;
    }

    for (;;) {
        int finished_count = 0;
        completed_count = 0;
        for (int stripe_index = 0; stripe_index < QMAIL_MAX_SERVERS;
            ++stripe_index) {
            if (!created[stripe_index]) continue;
            if (rejected[stripe_index]) {
                finished_count++;
                continue;
            }
            qmail_transfer_record_t record;
            if (qmail_transfer_get(operations[stripe_index].operation_id,
                                   &record) != RESULT_SUCCESS) {
                continue;
            }
            operations[stripe_index] = record;
            if (record.state == QMAIL_TRANSFER_STATE_COMPLETED) {
                if (record.total_size != expected_stripe_size) {
                    qmail_transfer_cancel(record.operation_id);
                    rejected[stripe_index] = true;
                    remove(paths[stripe_index]);
                    paths[stripe_index][0] = '\0';
                    finished_count++;
                    continue;
                }
                completed_by_index[stripe_index] = true;
                completed_count++;
                finished_count++;
            } else if (transfer_finished(&record)) {
                finished_count++;
            }
        }

        if (recoverable(completed_by_index, data_stripe_count,
                        parity_stripe_index)) {
            if (finished_count == created_count) break;
            if (threshold_at == 0) threshold_at = platform_time_ms();
            if (platform_time_ms() - threshold_at >= RECEIVE_SETTLE_GRACE_MS) {
                for (int i = 0; i < QMAIL_MAX_SERVERS; ++i) {
                    if (created[i] && !completed_by_index[i] &&
                        !transfer_finished(&operations[i])) {
                        qmail_transfer_cancel(operations[i].operation_id);
                    }
                }
                break;
            }
        } else if (finished_count == created_count) {
            break;
        }
        platform_sleep_ms(RECEIVE_POLL_MS);
    }

    if (!recoverable(completed_by_index, data_stripe_count,
                     parity_stripe_index)) {
        set_error(error_out, error_out_size,
                  "Not enough revised-manifest stripes could be downloaded");
        status = RESULT_ERROR;
        goto cleanup;
    }
    for (int i = 0; i < QMAIL_MAX_SERVERS; ++i) {
        if (completed_by_index[i]) stripe_paths[i] = paths[i];
    }
    {
        int recovered = 0;
        status = qmail_receive_object_reconstruct(
            stripe_paths, data_stripe_count, parity_stripe_index,
            entry->original_size, entry->object_hash, destination_path,
            &recovered, error_out, error_out_size);
        if (result) {
            result->stripes_downloaded = completed_count;
            result->stripes_recovered = recovered;
        }
    }

cleanup:
    for (int i = 0; i < QMAIL_MAX_SERVERS; ++i) {
        if (created[i] && !completed_by_index[i] &&
            !transfer_finished(&operations[i])) {
            qmail_transfer_cancel(operations[i].operation_id);
        }
        if (paths[i][0]) remove(paths[i]);
    }
    return status;
}
