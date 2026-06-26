/**
 * qmail_receipt_transfer_ids_test.c - Receipt transfer-ID persistence
 */

#include "qmail/qmail_receipt.h"
#include "qmail/qmail_users.h"
#include "platform.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#define test_mkdir(path) _mkdir(path)
#define test_rmdir(path) _rmdir(path)
#else
#include <sys/stat.h>
#include <unistd.h>
#define test_mkdir(path) mkdir(path, 0700)
#define test_rmdir(path) rmdir(path)
#endif

#define CHECK(condition, message) do { \
    if (!(condition)) { \
        fprintf(stderr, "FAIL: %s (line %d)\n", message, __LINE__); \
        goto cleanup; \
    } \
} while (0)

bool file_exists(const char *path) {
    FILE *file = fopen(path, "rb");
    if (!file) return false;
    fclose(file);
    return true;
}

result_t create_directory(const char *path) {
    test_mkdir(path);
    return RESULT_SUCCESS;
}

result_t create_directory_recursive(const char *path) {
    test_mkdir(path);
    return RESULT_SUCCESS;
}

result_t qmail_identity_get_mail_wallet_path(const char *wallets_path,
                                             char *out,
                                             size_t out_size) {
    (void)wallets_path;
    if (out && out_size > 0) out[0] = '\0';
    return RESULT_NOT_FOUND;
}

int main(void) {
    const char *wallet = "qmail_receipt_transfer_ids_wallet";
    char receipts_dir[256];
    char receipt_path[512];
    qmail_receipt_t receipt;
    qmail_receipt_t loaded;
    uint8_t guid[QMAIL_GUID_SIZE];
    int exit_code = 1;

    for (size_t i = 0; i < sizeof(guid); ++i) guid[i] = (uint8_t)(i + 1);
    snprintf(receipts_dir, sizeof(receipts_dir), "%s%sReceipts",
             wallet, PATH_SEPARATOR_STR);
    test_mkdir(wallet);
    test_mkdir(receipts_dir);
    CHECK(qmail_receipt_path(wallet, guid, receipt_path,
                             sizeof(receipt_path)) == RESULT_SUCCESS,
          "build receipt path");
    remove(receipt_path);

    qmail_receipt_init(&receipt, wallet, guid, "outer-task");
    strcpy(receipt.upload_status, "success");
    receipt.upload_file_count = 1;
    qmail_receipt_file_t *file = &receipt.upload_files[0];
    strcpy(file->role, "attachment");
    file->file_type = QMAIL_FILE_ATTACHMENT_1;
    file->size_bytes = UINT64_C(0x100000123);
    file->stripe_count = 1;
    file->stripes_uploaded = 1;
    strcpy(file->status, "success");

    qmail_receipt_stripe_t *stripe = &file->stripes[0];
    stripe->stripe_index = 2;
    stripe->server_id = 7;
    stripe->stripe_size = UINT64_C(0x100000001);
    stripe->ok = true;
    stripe->expires_at = INT64_C(2000000000);
    strcpy(stripe->task_id, "transfer-task-0123456789");
    strcpy(stripe->locker_code, "LOCKER-KEY");
    for (size_t i = 0; i < QMAIL_OT_ID_SIZE; ++i) {
        stripe->operation_id[i] = (uint8_t)(0xa0u + i);
    }

    CHECK(qmail_receipt_save(&receipt) == RESULT_SUCCESS,
          "save receipt");
    CHECK(qmail_receipt_load(wallet, guid, &loaded) == RESULT_SUCCESS,
          "load receipt");
    CHECK(loaded.upload_file_count == 1, "file count");
    const qmail_receipt_stripe_t *loaded_stripe =
        &loaded.upload_files[0].stripes[0];
    CHECK(loaded.upload_files[0].stripe_count == 1, "stripe count");
    CHECK(memcmp(loaded_stripe->operation_id, stripe->operation_id,
                 QMAIL_OT_ID_SIZE) == 0,
          "operation_id round trip");
    CHECK(strcmp(loaded_stripe->task_id, stripe->task_id) == 0,
          "task_id round trip");
    CHECK(loaded_stripe->stripe_size == stripe->stripe_size,
          "64-bit stripe size round trip");

    exit_code = 0;

cleanup:
    remove(receipt_path);
    test_rmdir(receipts_dir);
    test_rmdir(wallet);
    return exit_code;
}
