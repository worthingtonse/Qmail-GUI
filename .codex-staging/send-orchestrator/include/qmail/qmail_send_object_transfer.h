/**
 * qmail_send_object_transfer.h - Multi-server upload stage for QMail sends
 */

#ifndef QMAIL_SEND_OBJECT_TRANSFER_H
#define QMAIL_SEND_OBJECT_TRANSFER_H

#include "qmail/qmail_types.h"
#include "qmail/qmail_transfer_manager.h"
#include "results.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *wallet_path;
    const char *source_path;
    const uint8_t *source_data;
    size_t source_size;
    const uint8_t *object_id;
    uint8_t file_type;
    uint64_t target_generation;
    uint64_t retention_seconds;
    const uint8_t *server_indices;
    int server_count;
    int data_stripe_count;
    const char *const *locker_keys;
    const bool *server_enabled;
    const char *task_id;
    int file_index;
    int file_count;
} qmail_send_object_upload_options_t;

typedef struct {
    uint8_t logical_hash[QMAIL_OT_HASH_SIZE];
    bool server_ok[QMAIL_MAX_SERVERS];
    uint64_t stripe_sizes[QMAIL_MAX_SERVERS];
    int completed_count;
    int failed_count;
} qmail_send_object_upload_result_t;

result_t qmail_send_object_upload(
    const qmail_send_object_upload_options_t *options,
    qmail_send_object_upload_result_t *result);

#endif /* QMAIL_SEND_OBJECT_TRANSFER_H */
