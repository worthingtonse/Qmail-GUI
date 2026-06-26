/**
 * qmail_transfer_store.h - Internal durable range store
 */

#ifndef QMAIL_TRANSFER_STORE_H
#define QMAIL_TRANSFER_STORE_H

#include "qmail/qmail_transfer_manager.h"

result_t qmail_transfer_store_open(const char *db_path);
void qmail_transfer_store_close(void);

result_t qmail_transfer_store_insert(const qmail_transfer_record_t *record);
result_t qmail_transfer_store_get(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_record_t *record_out);
result_t qmail_transfer_store_save(const qmail_transfer_record_t *record);
result_t qmail_transfer_store_set_state(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_state_t state,
    int last_result,
    uint8_t last_status,
    const char *error_message);
result_t qmail_transfer_store_request_cancel(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]);
result_t qmail_transfer_store_list_resumable(
    qmail_transfer_record_t **records_out,
    int *count_out);

result_t qmail_transfer_store_replace_ranges(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    const qmail_transfer_range_t *ranges,
    size_t range_count,
    uint64_t completed_bytes);
result_t qmail_transfer_store_list_pending_ranges(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_range_t **ranges_out,
    size_t *count_out);
result_t qmail_transfer_store_mark_range_inflight(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    uint64_t offset);
result_t qmail_transfer_store_mark_range_complete(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    uint64_t offset,
    uint64_t length);
result_t qmail_transfer_store_mark_range_failed(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    uint64_t offset,
    int retries,
    const char *error_message);
result_t qmail_transfer_store_reset_inflight(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]);

#endif /* QMAIL_TRANSFER_STORE_H */
