/**
 * qmail_transfer_manager.h - Durable QMail Object Transfer v1 operations
 */

#ifndef QMAIL_TRANSFER_MANAGER_H
#define QMAIL_TRANSFER_MANAGER_H

#include "core_transport.h"
#include "qmail/qmail_object_transfer.h"
#include "results.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define QMAIL_TRANSFER_PATH_MAX 4096
#define QMAIL_TRANSFER_ERROR_MAX 256
#define QMAIL_TRANSFER_LOCAL_PARALLEL_MAX 16
#define QMAIL_TRANSFER_STORAGE_CLASS_MAX 64

typedef enum {
    QMAIL_TRANSFER_DIRECTION_UPLOAD = 1,
    QMAIL_TRANSFER_DIRECTION_DOWNLOAD = 2,
    QMAIL_TRANSFER_DIRECTION_DELETE = 3
} qmail_transfer_direction_t;

typedef enum {
    QMAIL_TRANSFER_STATE_CREATED = 0,
    QMAIL_TRANSFER_STATE_HASHING = 1,
    QMAIL_TRANSFER_STATE_BEGINNING = 2,
    QMAIL_TRANSFER_STATE_UPLOADING = 3,
    QMAIL_TRANSFER_STATE_COMMITTING = 4,
    QMAIL_TRANSFER_STATE_QUERYING = 5,
    QMAIL_TRANSFER_STATE_DOWNLOADING = 6,
    QMAIL_TRANSFER_STATE_VERIFYING = 7,
    QMAIL_TRANSFER_STATE_COMPLETED = 8,
    QMAIL_TRANSFER_STATE_PAUSED = 9,
    QMAIL_TRANSFER_STATE_CANCELLING = 10,
    QMAIL_TRANSFER_STATE_CANCELLED = 11,
    QMAIL_TRANSFER_STATE_FAILED = 12
} qmail_transfer_state_t;

typedef struct {
    uint8_t operation_id[QMAIL_OT_ID_SIZE];
    qmail_transfer_direction_t direction;
    qmail_transfer_state_t state;
    uint8_t raida_id;
    uint8_t transfer_id[QMAIL_OT_ID_SIZE];
    uint8_t object_id[QMAIL_OT_ID_SIZE];
    uint8_t locker_code[QMAIL_OT_ID_SIZE];
    char locker_key[17];
    uint8_t file_type;
    uint8_t operation;
    uint16_t requested_storage_class;
    uint16_t storage_class;
    uint64_t requested_retention_seconds;
    uint64_t accepted_retention_seconds;
    uint64_t expected_generation;
    uint64_t target_generation;
    uint64_t generation;
    uint64_t total_size;
    uint64_t completed_bytes;
    uint32_t preferred_chunk;
    uint32_t accepted_chunk;
    uint32_t requested_range;
    uint32_t recommended_range;
    uint16_t max_parallel;
    uint64_t expires_at;
    uint8_t object_hash[QMAIL_OT_HASH_SIZE];
    char source_path[QMAIL_TRANSFER_PATH_MAX];
    char destination_path[QMAIL_TRANSFER_PATH_MAX];
    char temporary_path[QMAIL_TRANSFER_PATH_MAX];
    char wallet_path[QMAIL_TRANSFER_PATH_MAX];
    char task_id[64];
    bool cancel_requested;
    bool locker_consumed;
    bool begin_request_frozen;
    int retry_count;
    int last_result;
    uint8_t last_status;
    char error_message[QMAIL_TRANSFER_ERROR_MAX];
    int64_t created_at;
    int64_t updated_at;
} qmail_transfer_record_t;

typedef struct {
    uint64_t offset;
    uint64_t length;
    int state;
    int retries;
} qmail_transfer_range_t;

typedef struct {
    const char *source_path;
    const char *wallet_path;
    uint8_t raida_id;
    uint8_t file_type;
    const uint8_t *object_id;
    const char *locker_key;
    uint64_t requested_retention_seconds;
    uint16_t storage_class;
    uint32_t preferred_chunk;
    uint8_t operation;
    uint64_t expected_generation;
    uint64_t target_generation;
} qmail_transfer_upload_options_t;

typedef struct {
    const char *destination_path;
    const char *wallet_path;
    uint8_t raida_id;
    uint8_t file_type;
    const uint8_t *object_id;
    uint64_t generation;
    uint32_t preferred_range;
} qmail_transfer_download_options_t;

typedef struct {
    const char *wallet_path;
    uint8_t raida_id;
    uint8_t file_type;
    const uint8_t *object_id;
    uint64_t expected_generation;
    uint64_t target_generation;
} qmail_transfer_delete_options_t;

typedef struct {
    qmail_ot_object_capabilities_response_t capabilities;
    qmail_ot_storage_class_entry_t classes[QMAIL_TRANSFER_STORAGE_CLASS_MAX];
    uint16_t class_count;
} qmail_transfer_capabilities_t;

/**
 * Initialize the durable manager and resume non-terminal operations.
 * db_path must be the same qmail.db path used by the QMail database layer.
 */
result_t qmail_transfer_manager_init(const char *db_path,
                                     core_transport_t *transport);
void qmail_transfer_manager_shutdown(void);

result_t qmail_transfer_create_upload(
    const qmail_transfer_upload_options_t *options,
    qmail_transfer_record_t *record_out);
result_t qmail_transfer_create_download(
    const qmail_transfer_download_options_t *options,
    qmail_transfer_record_t *record_out);
result_t qmail_transfer_create_delete(
    const qmail_transfer_delete_options_t *options,
    qmail_transfer_record_t *record_out);

result_t qmail_transfer_get(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_record_t *record_out);
result_t qmail_transfer_resume(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]);
result_t qmail_transfer_cancel(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]);

result_t qmail_transfer_query_capabilities(
    const char *wallet_path,
    uint8_t raida_id,
    qmail_transfer_capabilities_t *capabilities_out);

const char *qmail_transfer_state_string(qmail_transfer_state_t state);
const char *qmail_transfer_direction_string(qmail_transfer_direction_t direction);

#endif /* QMAIL_TRANSFER_MANAGER_H */
