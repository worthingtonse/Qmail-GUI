/**
 * qmail_receipt.h - Per-email receipt files
 *
 * Phase 3 of the QMail refactor. Each email gets one receipt document at:
 *   <Mail-wallet-root>/Receipts/<file_guid_hex>.json
 *
 * The receipt is the canonical record of what happened to a single email
 * across both phases:
 *   - upload section: written by qmail_upload_files() — file list,
 *     server map, per-stripe locker codes, status.
 *   - tell section: written by qmail_send_tells() — per-recipient
 *     status table, summary counts.
 *
 * Mutation pattern: load → mutate → save (atomic via tmp+rename). Saves
 * are cheap; receipts are small (a few KB even with 50 recipients).
 *
 * SECURITY (Finding 3 from the Phase 2 review):
 *   The receipt MUST NOT contain authentication secrets. Specifically:
 *     - NO sender_ans (per-RAIDA AN bytes — a bearer token).
 *     - NO enc_key.ans (encryption-coin per-RAIDA AN bytes).
 *   Receipts hold only IDs, status, locker codes, and metadata. /tell
 *   rehydrates wallet identity + encryption from the wallet at run time.
 */

#ifndef QMAIL_RECEIPT_H
#define QMAIL_RECEIPT_H

#include "qmail/qmail_types.h"
#include "qmail/qmail_upload_files.h"
#include <stdint.h>
#include <stdbool.h>

#define QMAIL_RECEIPT_SCHEMA_VERSION 1

#define QMAIL_RECEIPT_MAX_FILES        QMAIL_MAX_SERVERS  /* email + attachments */
#define QMAIL_RECEIPT_MAX_RECIPIENTS   QMAIL_MAX_RECIPIENTS

/* Fixed-size path buffer for receipt fields. MUST NOT use MAX_PATH_LEN —
 * api_rest.h redefines MAX_PATH_LEN to 4096 (vs. platform.h's 512), so the
 * struct ends up with different layouts in different translation units
 * depending on header order. See bug #18.
 *
 * Sized to 4096 to match the REST-side wallet_path buffer; longer than
 * platform.h's 512 but harmless on the worker side (paths are copied with
 * strncpy and clamped). */
#define QMAIL_RECEIPT_PATH_LEN  4096

/* Tell-side per-recipient status. Mirrors the receipt JSON's
 * "tell.recipients[].status" string. */
typedef enum {
    QMAIL_RCPT_STATUS_QUEUED       = 0,
    QMAIL_RCPT_STATUS_SENDING      = 1,
    QMAIL_RCPT_STATUS_SENT         = 2,
    QMAIL_RCPT_STATUS_FAILED       = 3,
    QMAIL_RCPT_STATUS_RETRY_QUEUED = 4
} qmail_rcpt_status_t;

const char *qmail_rcpt_status_to_string(qmail_rcpt_status_t s);
qmail_rcpt_status_t qmail_rcpt_status_from_string(const char *s);

/* Per-stripe upload outcome — one row per (file, server) pair. */
typedef struct {
    int      stripe_index;
    int      server_id;
    int      stripe_size;
    char     locker_code[QMAIL_LOCKER_KEY_MAX_LEN];
    int64_t  expires_at;       /* 0 if not known */
    bool     is_parity;
    bool     ok;
    char     error[64];        /* empty on success */
} qmail_receipt_stripe_t;

typedef struct {
    char     role[16];                              /* "email" | "attachment" */
    int      file_type;                             /* 0x01 email, 0x0A+ attach */
    char     source[QMAIL_RECEIPT_PATH_LEN];        /* "body" or path */
    uint64_t size_bytes;
    qmail_receipt_stripe_t stripes[QMAIL_MAX_SERVERS];
    int      stripe_count;
    int      stripes_uploaded;
    int      stripes_failed;
    char     status[16];                            /* "success" | "failed" */
} qmail_receipt_file_t;

/* Tell-side per-recipient row. */
typedef struct {
    char     address[QMAIL_MAX_ADDRESS_LEN];
    char     kind[8];                               /* "to"|"cc"|"bcc" */
    uint32_t serial_number;
    int8_t   denomination;
    int      beacon_raida;
    qmail_rcpt_status_t status;
    int      attempts;
    char     last_error[256];
    int      tell_command_code;                     /* CMD_QMAIL_TELL = 71 */
    int64_t  started_at;
    int64_t  finished_at;
} qmail_receipt_recipient_t;

/* Top-level receipt struct (in-memory representation of the JSON file). */
typedef struct {
    /* Header */
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    char     request_id[16];                        /* correlation id */
    int      version;                               /* schema version */
    int64_t  created_at;
    int64_t  updated_at;
    char     wallet_path[QMAIL_RECEIPT_PATH_LEN];

    /* Sender identity (NON-secret subset only) */
    uint32_t sender_serial_number;
    int8_t   sender_denomination;
    char     sender_email[QMAIL_MAX_ADDRESS_LEN];

    /* Upload phase */
    char     upload_status[16];                     /* "in_progress"|"success"|"failed" */
    int64_t  upload_started_at;
    int64_t  upload_finished_at;
    qmail_receipt_file_t upload_files[QMAIL_RECEIPT_MAX_FILES];
    int      upload_file_count;
    int      upload_servers_total;
    int      upload_servers_ok;
    int      upload_servers_fail;
    /* Subject + preview kept on the receipt so /tell can stamp the
     * sent-folder DB row without round-tripping the caller. */
    char     subject[QMAIL_MAX_SUBJECT_LEN];
    char     body_preview[256];
    /* Phase 3.4: data needed to rebuild qmail_send_tells inputs from a
     * receipt without re-running the upload phase. */
    uint64_t upload_total_group_size;               /* sum across files */
    uint8_t  upload_manifest_version;
    uint8_t  upload_manifest_file_count;
    uint8_t  upload_manifest_entry_size;
    uint16_t upload_manifest_len;
    uint8_t  upload_manifest_flags;
    qmail_file_manifest_entry_t upload_manifest_files[QMAIL_TELL_MANIFEST_MAX_FILES];
    uint8_t  upload_manifest_bytes[QMAIL_TELL_MANIFEST_MAX_LEN];
    char     upload_inbox_fee_locker[QMAIL_LOCKER_KEY_MAX_LEN];
    bool     upload_inbox_fee_acquired;

    /* Tell phase */
    char     tell_status[16];                       /* "not_started"|"in_progress"|"success"|"partial"|"failed" */
    int64_t  tell_started_at;
    int64_t  tell_finished_at;
    qmail_receipt_recipient_t tell_recipients[QMAIL_RECEIPT_MAX_RECIPIENTS];
    int      tell_recipient_count;
    int      tell_summary_total;
    int      tell_summary_queued;
    int      tell_summary_sending;
    int      tell_summary_sent;
    int      tell_summary_failed;
    int      tell_summary_retry_queued;
} qmail_receipt_t;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Discover the Mail wallet path from the wallet registry. Receipts live
 * under <Mail>/Receipts/. Returns RESULT_NOT_FOUND if no Mail wallet is
 * configured (Q22(a) — endpoints requiring receipts should refuse).
 *
 * @param out      Output buffer for the path.
 * @param out_size Size of out.
 */
result_t qmail_receipt_get_mail_wallet_path(char *out, size_t out_size);

/**
 * Build the canonical receipt path for a given file_guid under a wallet.
 *
 * Path is `<wallet>/Receipts/<32-hex>.json`. The Receipts directory is
 * NOT created here; call qmail_receipt_ensure_dir() once at startup or
 * before the first save.
 *
 * @param wallet_path  Full path to the wallet root (e.g. .../Wallets/Mail).
 * @param file_guid    16-byte GUID.
 * @param out          Output buffer for the path.
 * @param out_size     Size of out.
 * @return RESULT_SUCCESS on success.
 */
result_t qmail_receipt_path(const char *wallet_path,
                            const uint8_t file_guid[QMAIL_GUID_SIZE],
                            char *out, size_t out_size);

/**
 * Ensure the wallet's Receipts directory exists. Creates it if missing.
 */
result_t qmail_receipt_ensure_dir(const char *wallet_path);

/**
 * Returns true if a receipt file already exists for this file_guid.
 * Used by /upload to enforce GUID uniqueness (HTTP 409 on collision).
 */
bool qmail_receipt_exists(const char *wallet_path,
                          const uint8_t file_guid[QMAIL_GUID_SIZE]);

/**
 * Load a receipt from disk. Returns RESULT_NOT_FOUND if no receipt
 * exists for this file_guid. Returns RESULT_ERROR on parse failure.
 *
 * The receipt struct is large (~30 KB) — caller stack-allocates or
 * heap-allocates per its own preference.
 */
result_t qmail_receipt_load(const char *wallet_path,
                            const uint8_t file_guid[QMAIL_GUID_SIZE],
                            qmail_receipt_t *out);

/**
 * Atomically save a receipt. Writes to <path>.tmp, then renames. Updates
 * receipt->updated_at to now. Caller is responsible for the contents
 * being accurate before the call — qmail_receipt_save() does no
 * validation beyond schema version.
 */
result_t qmail_receipt_save(const qmail_receipt_t *receipt);

/**
 * Initialize a fresh receipt with the standard header fields filled in.
 * Caller fills the sender, upload, and tell sections.
 *
 * @param request_id  8-char hex correlation id (or NULL for none).
 */
void qmail_receipt_init(qmail_receipt_t *receipt,
                        const char *wallet_path,
                        const uint8_t file_guid[QMAIL_GUID_SIZE],
                        const char *request_id);

/**
 * Helper: load the raw JSON bytes for the GET /api/qmail/receipts
 * endpoint. Caller must free *out_bytes. Returns RESULT_NOT_FOUND if
 * the receipt doesn't exist.
 */
result_t qmail_receipt_load_raw(const char *wallet_path,
                                const uint8_t file_guid[QMAIL_GUID_SIZE],
                                char **out_bytes, size_t *out_len);

// ============================================================================
// CONVENIENCE: build receipt header from upload artifacts
// ============================================================================

/**
 * Populate the upload section of a freshly-init'd receipt from the
 * artifacts produced by qmail_upload_files(). Does NOT save — caller
 * adds file detail (sources, sizes, statuses) and then saves.
 */
void qmail_receipt_apply_upload_artifacts(qmail_receipt_t *receipt,
                                          const qmail_upload_artifacts_t *art,
                                          bool upload_succeeded);

/**
 * Update the recipient row matching (file_guid, beacon_raida, serial_number)
 * with a new status. Used by qmail_send_tells() to record per-recipient
 * outcomes during the tell loop, and by the qmail_pending_tells retry
 * worker when a deferred tell finally resolves.
 *
 * Loads, mutates, saves atomically. If the receipt or matching row is
 * missing, returns RESULT_NOT_FOUND.
 */
result_t qmail_receipt_update_recipient(const char *wallet_path,
                                        const uint8_t file_guid[QMAIL_GUID_SIZE],
                                        uint32_t serial_number,
                                        int beacon_raida,
                                        qmail_rcpt_status_t new_status,
                                        const char *last_error);

#endif /* QMAIL_RECEIPT_H */
