/**
 * qmail_upload_files.h - Upload-only primitive (no Tell)
 *
 * Phase 2 of the QMail refactor (docs/opu.qmail_commands.refactor.plan.txt
 * §B1) extracts the upload phase from qmail_upload_orchestrator into a
 * standalone primitive. The orchestrator itself becomes a thin compose
 * over qmail_upload_files() + qmail_send_tells().
 *
 * Splitting upload from tell lets the new /upload (upload-only) and
 * /tell endpoints run each phase independently while still sharing one
 * canonical implementation per phase.
 */

#ifndef QMAIL_UPLOAD_FILES_H
#define QMAIL_UPLOAD_FILES_H

#include "qmail/qmail_types.h"
#include "qmail/qmail_locker_pool.h"
#include "core_transport.h"
#include "encryption_key.h"

/**
 * Inputs to the upload-only primitive. Owned by the caller for the
 * lifetime of the call.
 */
typedef struct {
    /* Required. */
    const char *wallet_path;       /* Identity coin source */

    /* Email body source — exactly one of these must be non-NULL/non-zero. */
    const char     *email_file;    /* Path to a .qmail file on disk */
    const uint8_t  *email_data;    /* Or pre-encoded CBDF buffer */
    size_t          email_data_len;

    /* Optional attachments. Comma/semicolon separated paths.
     * Will be removed once the new /upload endpoint passes a typed array. */
    const char *attachments;

    /* Optional recipient lists. Used at upload time ONLY for:
     *   1. Inbox-fee budgeting (so the funded lockers cover per-recipient
     *      fees set in the contacts table).
     *   2. Telling /tell what the original recipient set was, if the
     *      caller doesn't re-supply them.
     *   3. (Future) CBDF metadata stamping when /upload builds the CBDF
     *      itself — Phase 3.
     * /upload does NOT send any Tell. These fields are advisory at
     * upload time. */
    const char *to;
    const char *cc;
    const char *bcc;

    /* Optional. If supplied, used as the email's GUID. If NULL, one is
     * generated and returned in artifacts->file_guid. */
    const uint8_t *file_guid;

    /* Storage duration in weeks. Defaults to 4 if <= 0. */
    int duration_weeks;

    /* Optional async task id for progress updates. NULL disables progress. */
    const char *task_id;
} qmail_upload_files_options_t;

/**
 * Artifacts produced by the upload phase that the tell phase needs.
 *
 * The caller is responsible for the lifetime of this struct (typically
 * stack-allocated). Holds NO heap pointers — locker codes are inline,
 * server locations are inline, encryption key is copied by value.
 */
typedef struct {
    /* Email identity */
    uint8_t  file_guid[QMAIL_GUID_SIZE];

    /* Sender identity (mirrors what the tell preamble must use) */
    int8_t   sender_denomination;
    uint32_t sender_serial_number;
    uint8_t  sender_ans[RAIDA_COUNT][AN_LENGTH];
    uint8_t  device_id;

    /* Server locations for tell metadata. valid_server_count is the
     * number of servers that uploaded ALL files successfully. */
    int                      valid_server_count;
    qmail_server_location_t  server_locs[QMAIL_MAX_SERVERS];
    uint8_t                  per_server_lockers[QMAIL_MAX_SERVERS][16];

    /* Inbox-fee locker (funded payment for the tell). All-zero if not
     * acquired (sync fallback). */
    uint8_t  inbox_fee_locker[16];
    bool     inbox_fee_acquired;

    /* Aggregated upload roll-up */
    uint64_t total_group_size;
    uint32_t body_size;
    int      file_count;
    int      upload_successes;
    int      upload_failures;

    /* Tell file manifest. New beta records list private meta (file_type 0)
     * first, body/content (file_type 1) second, then attachments. */
    uint8_t  manifest_version;
    uint8_t  file_entry_size;
    uint16_t manifest_len;
    uint8_t  manifest_flags;
    qmail_file_manifest_entry_t manifest_files[QMAIL_TELL_MANIFEST_MAX_FILES];
    uint8_t  manifest_bytes[QMAIL_TELL_MANIFEST_MAX_LEN];

    /* Encryption key for the tell phase. Copied by value so tells can
     * outlive the orchestrator's stack frame. */
    raida_encryption_key_t enc_key;

    /* Pool warnings the orchestrator surfaces to its caller */
    bool used_sync_fallback;
    bool low_balance_warning;

    /* Locker pool acquisition record. The tell phase confirms it
     * (lockers consumed) on success or releases it (lockers returned
     * to pool) on a no-recipient path. Embedded by value — no
     * pointer ownership. */
    qmail_pool_acquire_result_t pool_acq;

    /* Best-effort error message on failure */
    char error_message[256];
} qmail_upload_artifacts_t;

typedef struct {
    uint8_t  is_paged;
    uint16_t total_pages_estimate;
} qmail_attachment_page_plan_t;

size_t qmail_upload_legacy_max_file_bytes(void);
bool qmail_upload_file_uses_large_pages(int file_index, size_t file_size);
result_t qmail_upload_preplan_attachment_size(
    size_t attachment_size,
    qmail_attachment_page_plan_t *plan);
result_t qmail_upload_preplan_attachment_path(
    const char *path,
    qmail_attachment_page_plan_t *plan,
    size_t *size_out);

/**
 * Upload all files (email body + attachments) to the QMail RAIDA storage
 * network. Phase 1 keeps file_type 1 capped at QMAIL_CBDF_BODY_MAX_BYTES and
 * on legacy CMD_QMAIL_UPLOAD; only oversized attachments use
 * CMD_QMAIL_UPLOAD_LARGE_PAGE. Does NOT send any Tell.
 *
 * Pool semantics (Q18(a) split-commit):
 *   - On RESULT_SUCCESS, the storage lockers have already been CONFIRMED
 *     (the upload spent them).
 *   - The inbox-fee locker, if acquired, is left RESERVED and stamped
 *     with the file_guid. The caller MUST eventually either:
 *       a. call qmail_send_tells() — confirms the inbox-fee on success,
 *          releases on no-recipients, OR
 *       b. call qmail_upload_artifacts_confirm() — releases the
 *          inbox-fee back to AVAILABLE so the funding is recyclable.
 *   - On failure, all acquired pool resources are released.
 *
 * Populates artifacts->* with the data the tell phase needs.
 */
result_t qmail_upload_files(const qmail_upload_files_options_t *options,
                            core_transport_t *transport_iface,
                            qmail_upload_artifacts_t *artifacts);

/**
 * Finalize an upload-only flow (no Tell).
 *
 * qmail_upload_files() has already confirmed the storage lockers.
 * This helper recycles the inbox-fee locker back to AVAILABLE so the
 * funding is reusable on the next acquire (Q18(a): no Tell, no fee
 * sunk).
 *
 * Used by:
 *   - The orchestrator's compose path when options->to is NULL.
 *   - The new /upload endpoint when the caller doesn't chain into
 *     qmail_send_tells().
 */
void qmail_upload_artifacts_confirm(qmail_upload_artifacts_t *artifacts,
                                    const char *wallet_path_for_replenish);

#endif /* QMAIL_UPLOAD_FILES_H */
