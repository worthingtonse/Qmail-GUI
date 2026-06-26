/**
 * qmail_transfer_store_test.c - Durable transfer-store regression tests
 */

#include "qmail/qmail_transfer_store.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition, message) do { \
    if (!(condition)) { \
        fprintf(stderr, "FAIL: %s (line %d)\n", message, __LINE__); \
        goto cleanup; \
    } \
} while (0)

static void fill_id(uint8_t id[QMAIL_OT_ID_SIZE], uint8_t seed) {
    for (size_t i = 0; i < QMAIL_OT_ID_SIZE; ++i) {
        id[i] = (uint8_t)(seed + i);
    }
}

int main(void) {
    const char *db_path = "qmail_transfer_store_test.db";
    qmail_transfer_record_t record;
    qmail_transfer_record_t loaded;
    qmail_transfer_record_t *resumable = NULL;
    qmail_transfer_range_t ranges[2];
    qmail_transfer_range_t *pending = NULL;
    size_t pending_count = 0;
    int resumable_count = 0;
    int exit_code = 1;

    remove(db_path);
    memset(&record, 0, sizeof(record));
    fill_id(record.operation_id, 1);
    fill_id(record.transfer_id, 33);
    fill_id(record.object_id, 65);
    record.direction = QMAIL_TRANSFER_DIRECTION_UPLOAD;
    record.state = QMAIL_TRANSFER_STATE_UPLOADING;
    record.raida_id = 7;
    record.file_type = 2;
    record.requested_storage_class = 7;
    record.storage_class = 9;
    record.total_size = UINT64_MAX - 2u;
    record.expected_generation = UINT64_MAX - 10u;
    record.target_generation = UINT64_MAX - 9u;
    record.requested_retention_seconds = UINT64_MAX - 8u;
    record.begin_request_frozen = true;
    record.created_at = 100;
    record.updated_at = 101;
    snprintf(record.wallet_path, sizeof(record.wallet_path), "test-wallet");

    CHECK(qmail_transfer_store_open(db_path) == RESULT_SUCCESS,
          "open transfer store");
    CHECK(qmail_transfer_store_insert(&record) == RESULT_SUCCESS,
          "insert transfer");
    CHECK(qmail_transfer_store_get(record.operation_id, &loaded)
              == RESULT_SUCCESS,
          "load transfer");
    CHECK(loaded.total_size == record.total_size,
          "preserve uint64 total_size");
    CHECK(loaded.expected_generation == record.expected_generation,
          "preserve uint64 generation");
    CHECK(loaded.requested_retention_seconds ==
              record.requested_retention_seconds,
          "preserve uint64 retention");
    CHECK(loaded.begin_request_frozen,
          "preserve frozen begin request");
    CHECK(loaded.requested_storage_class == 7 &&
              loaded.storage_class == 9,
          "preserve requested and accepted storage classes");

    memset(ranges, 0, sizeof(ranges));
    ranges[0].offset = UINT64_C(0x100000000);
    ranges[0].length = UINT64_C(0x200000);
    ranges[1].offset = UINT64_C(0x100200000);
    ranges[1].length = UINT64_C(0x100000);
    CHECK(qmail_transfer_store_replace_ranges(
              record.operation_id, ranges, 2, 0) == RESULT_SUCCESS,
          "replace ranges");
    CHECK(qmail_transfer_store_list_pending_ranges(
              record.operation_id, &pending, &pending_count) == RESULT_SUCCESS,
          "list pending ranges");
    CHECK(pending_count == 2, "pending range count");
    CHECK(pending[0].offset == ranges[0].offset,
          "preserve offset above 4 GiB");
    free(pending);
    pending = NULL;

    CHECK(qmail_transfer_store_mark_range_inflight(
              record.operation_id, ranges[0].offset) == RESULT_SUCCESS,
          "mark range in flight");
    qmail_transfer_store_close();

    CHECK(qmail_transfer_store_open(db_path) == RESULT_SUCCESS,
          "reopen transfer store");
    CHECK(qmail_transfer_store_list_pending_ranges(
              record.operation_id, &pending, &pending_count) == RESULT_SUCCESS,
          "load ranges after restart");
    CHECK(pending_count == 2 && pending[0].state == 0,
          "restart resets in-flight ranges");
    free(pending);
    pending = NULL;

    CHECK(qmail_transfer_store_mark_range_complete(
              record.operation_id, ranges[0].offset, ranges[0].length)
              == RESULT_SUCCESS,
          "complete first range");
    CHECK(qmail_transfer_store_mark_range_complete(
              record.operation_id, ranges[0].offset, ranges[0].length)
              == RESULT_SUCCESS,
          "duplicate completion is idempotent");
    CHECK(qmail_transfer_store_get(record.operation_id, &loaded)
              == RESULT_SUCCESS,
          "reload progress");
    CHECK(loaded.completed_bytes == ranges[0].length,
          "completion increments progress once");

    CHECK(qmail_transfer_store_request_cancel(record.operation_id)
              == RESULT_SUCCESS,
          "request cancellation");
    CHECK(qmail_transfer_store_get(record.operation_id, &loaded)
              == RESULT_SUCCESS,
          "load cancellation");
    CHECK(loaded.cancel_requested &&
              loaded.state == QMAIL_TRANSFER_STATE_CANCELLING,
          "persist cancellation state");

    CHECK(qmail_transfer_store_list_resumable(
              &resumable, &resumable_count) == RESULT_SUCCESS,
          "list resumable transfers");
    CHECK(resumable_count == 1, "resumable transfer count");
    CHECK(memcmp(resumable[0].operation_id, record.operation_id,
                 QMAIL_OT_ID_SIZE) == 0,
          "resumable transfer identity");

    exit_code = 0;
    printf("qmail_transfer_store_test: PASS\n");

cleanup:
    free(pending);
    free(resumable);
    qmail_transfer_store_close();
    if (exit_code == 0) {
        remove(db_path);
        remove("qmail_transfer_store_test.db-shm");
        remove("qmail_transfer_store_test.db-wal");
    } else {
        fprintf(stderr, "Preserved failing database: %s\n", db_path);
    }
    return exit_code;
}
