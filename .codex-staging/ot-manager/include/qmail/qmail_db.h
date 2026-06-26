/**
 * qmail_db.h - SQLite Database Layer for QMail
 *
 * Manages persistent storage for emails, contacts, tells, servers.
 * Uses SQLite amalgamation (third_party/sqlite3.c).
 */

#ifndef QMAIL_DB_H
#define QMAIL_DB_H

#include "qmail/qmail_types.h"

/* Forward macro: qmail_pool_consumed_row_t (declared below in CONTACT CRUD
 * section) needs QMAIL_LOCKER_KEY_MAX_LEN, but the original #define lives
 * in the LOCKER POOL section further down. Defining it here keeps both
 * sites consistent and avoids reordering the file. */
#ifndef QMAIL_LOCKER_KEY_MAX_LEN
#define QMAIL_LOCKER_KEY_MAX_LEN  16
#endif

// ============================================================================
// DATABASE LIFECYCLE
// ============================================================================

/**
 * Open the QMail database and create schema if needed.
 *
 * @param db_path  Path to the SQLite database file
 * @return RESULT_SUCCESS on success
 */
result_t qmail_db_open(const char *db_path);

/**
 * Close the QMail database.
 */
void qmail_db_close(void);

/**
 * Check if the database is open.
 */
bool qmail_db_is_open(void);

// ============================================================================
// CONTACT CRUD
// ============================================================================

result_t qmail_db_contact_add(const qmail_contact_t *contact);
result_t qmail_db_contact_sync(const qmail_contact_t *contact);
result_t qmail_db_contact_get(uint32_t serial_number, qmail_contact_t *contact_out);
result_t qmail_db_contact_get_by_address(const char *address, qmail_contact_t *contact_out);
result_t qmail_db_contact_delete(uint32_t serial_number);
result_t qmail_db_contact_list(qmail_contact_t **contacts_out, int *count_out);
void qmail_db_contact_list_free(qmail_contact_t *contacts, int count);

/**
 * Record a send to a recipient: increment send_count and set last_sent_at.
 * If no contact row exists for `serial_number`, inserts a minimal stub row
 * (denomination + auto_address from the args, send_count=1, names blank)
 * so the recipient appears in future contact and popular-contacts queries.
 * Called from the send orchestrator once per recipient on a successful send.
 *
 * @param serial_number  Recipient's SN (qmail_recipient_entry_t.serial_number).
 * @param denomination   Recipient's denomination (for stub inserts).
 * @param auto_address   Recipient's address string (may be empty; used for stub insert only).
 * @param sent_at        Unix timestamp of the send.
 */
result_t qmail_db_contact_record_send(uint32_t serial_number,
                                       int8_t denomination,
                                       const char *auto_address,
                                       int64_t sent_at);

/**
 * List contacts ordered for the "most likely recipient" dropdown:
 * is_favorite DESC, send_count DESC, last_sent_at DESC, updated_at DESC.
 * Caller must free with qmail_db_contact_list_free().
 *
 * @param limit          Max rows to return.
 */
result_t qmail_db_contact_list_popular(int limit,
                                        qmail_contact_t **contacts_out,
                                        int *count_out);

/**
 * Set the is_favorite flag for a contact. Also bumps updated_at.
 * Returns RESULT_NOT_FOUND if no row exists for serial_number.
 */
result_t qmail_db_contact_set_favorite(uint32_t serial_number, bool is_favorite);

// ============================================================================
// EMAIL CRUD
// ============================================================================

result_t qmail_db_email_insert(const qmail_email_t *email);
result_t qmail_db_email_get(const uint8_t email_id[QMAIL_GUID_SIZE], qmail_email_t *email_out);
result_t qmail_db_email_delete(const uint8_t email_id[QMAIL_GUID_SIZE]);
result_t qmail_db_email_mark_read(const uint8_t email_id[QMAIL_GUID_SIZE], bool is_read);
result_t qmail_db_email_mark_star(const uint8_t email_id[QMAIL_GUID_SIZE], bool is_starred);
result_t qmail_db_email_list(int folder, int limit, int offset,
                              qmail_email_t **emails_out, int *count_out);

/**
 * Sort modes for qmail_db_email_list_sorted:
 *   0 = newest first (default, by received_timestamp DESC)
 *   1 = unread first (is_read ASC, then received_timestamp DESC)
 *   2 = highest paying first (inbox_fee DESC, then received_timestamp DESC)
 *   3 = starred first (is_starred DESC, then received_timestamp DESC)
 */
#define QMAIL_SORT_NEWEST       0
#define QMAIL_SORT_UNREAD       1
#define QMAIL_SORT_HIGHEST_FEE  2
#define QMAIL_SORT_STARRED      3

result_t qmail_db_email_list_sorted(int folder, int limit, int offset,
                                     int sort_mode,
                                     qmail_email_t **emails_out, int *count_out);

void qmail_db_email_list_free(qmail_email_t *emails, int count);

// ============================================================================
// FULL-TEXT SEARCH
// ============================================================================

result_t qmail_db_email_search(const char *query, int limit,
                                qmail_email_t **emails_out, int *count_out);

// ============================================================================
// RECEIVED TELLS (pending downloads)
// ============================================================================

result_t qmail_db_tell_insert(const qmail_tell_notification_t *tell);
result_t qmail_db_tell_is_downloaded(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                      bool *downloaded_out);
result_t qmail_db_tell_mark_downloaded(const uint8_t file_guid[QMAIL_GUID_SIZE]);
result_t qmail_db_tell_get_pending(qmail_tell_notification_t **tells_out, int *count_out);

/* Fetch a single stored received-tell by GUID regardless of downloaded state.
 * Returns RESULT_NOT_FOUND if no row exists. Used by the on-demand attachment
 * download (the email may already be downloaded=1). */
result_t qmail_db_tell_get_by_guid(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                   qmail_tell_notification_t *notif_out);
void qmail_db_tell_list_free(qmail_tell_notification_t *tells, int count);

// ============================================================================
// SENT EMAILS (tracking)
// ============================================================================

/**
 * Insert a sent-email tracking row, project it into the Sent folder, and add
 * one qmail_email_contacts row per recipient.
 * `recipients` is the legacy human-readable summary stored in the
 * qmail_sent_emails.recipients TEXT column for display compatibility.
 * `sender_sn` / `sender_denomination` populate the qmail_emails sender fields
 * so sent-folder rows have the same shape as inbox rows.
 * `entries` / `entry_count` populates qmail_email_contacts keyed by file_guid
 * (BLOB matches the email_id column type) so callers can see every TO/CC/BCC
 * that received the message.
 *
 * Either of `entries` may be NULL with `entry_count` = 0, in which case only
 * the tracking row and Sent folder row are written.
 */
result_t qmail_db_sent_insert(const uint8_t file_guid[QMAIL_GUID_SIZE],
                               const char *subject,
                               const char *recipients,
                               const char *body_preview,
                               int64_t timestamp,
                               uint32_t sender_sn,
                               int8_t sender_denomination,
                               const qmail_recipient_entry_t *entries,
                               int entry_count);

/**
 * One row of the sent-payments report. Owns no heap memory; safe to memcpy.
 * `subject`, `recipients`, `body_preview` are NUL-terminated; long values
 * are truncated to the buffer size (sufficient for a list view).
 */
typedef struct {
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    char     subject[256];
    char     recipients[1024];
    char     body_preview[256];
    int64_t  timestamp;
} qmail_sent_row_t;

/**
 * List rows from qmail_sent_emails, newest first (ORDER BY timestamp DESC).
 * Caller must free(*rows_out). total_out may be NULL.
 */
result_t qmail_db_sent_list(int limit, int offset,
                             qmail_sent_row_t **rows_out, int *count_out,
                             int *total_out);

/**
 * One consumed locker_pool row attached to a specific email. funded_amount
 * is the CC value, pool_type is QMAIL_POOL_TYPE_UPLOAD or _INBOX_FEE.
 */
typedef struct {
    char     locker_key[QMAIL_LOCKER_KEY_MAX_LEN + 1];
    int      pool_type;
    int      funded_amount;
    int64_t  consumed_at;
} qmail_pool_consumed_row_t;

/**
 * List CONSUMED (status = QMAIL_POOL_STATUS_CONSUMED) locker_pool rows whose
 * file_guid matches. Used by the sent-payments report to attach every locker
 * code that actually paid for a given email. Caller must free(*rows_out).
 */
result_t qmail_db_locker_pool_list_consumed_for_guid(
    const uint8_t file_guid[QMAIL_GUID_SIZE],
    qmail_pool_consumed_row_t **rows_out,
    int *count_out);

// ============================================================================
// ATTACHMENTS
// ============================================================================

/**
 * Insert an attachment record for an email.
 */
result_t qmail_db_attachment_insert(const qmail_attachment_t *attachment);

/**
 * List attachments for an email (metadata only, no data_blob).
 * Caller must free with qmail_db_attachment_list_free().
 */
result_t qmail_db_attachment_list(const uint8_t email_id[QMAIL_GUID_SIZE],
                                   qmail_attachment_t **attachments_out, int *count_out);

/**
 * Get a single attachment including its data (for INTERNAL) or file_path (for EXTERNAL).
 * Caller must free data_blob with qmail_attachment_free().
 */
result_t qmail_db_attachment_get(int64_t attachment_id, qmail_attachment_t *attachment_out);

/**
 * Update an attachment row's storage state (PENDING -> EXTERNAL on on-demand
 * download). storage_mode is a qmail_storage_mode_t value.
 */
result_t qmail_db_attachment_update_storage(int64_t attachment_id,
                                            int storage_mode,
                                            const char *file_path,
                                            size_t size_bytes);

/**
 * Free a list returned by qmail_db_attachment_list.
 */
void qmail_db_attachment_list_free(qmail_attachment_t *attachments, int count);

// ============================================================================
// FOLDER MANAGEMENT
// ============================================================================

/**
 * Move email to a folder. Auto-sets is_trashed when folder == QMAIL_FOLDER_TRASH.
 */
result_t qmail_db_email_move(const uint8_t email_id[QMAIL_GUID_SIZE], int folder);

/**
 * Soft-delete: set is_trashed=1 and folder=TRASH.
 */
result_t qmail_db_email_trash(const uint8_t email_id[QMAIL_GUID_SIZE]);

/**
 * Permanent delete: only works if already trashed. Removes email + attachments.
 */
result_t qmail_db_email_delete_permanent(const uint8_t email_id[QMAIL_GUID_SIZE]);

/**
 * Get per-folder counts (total and unread).
 */
typedef struct {
    int total;
    int unread;
} qmail_folder_count_t;

result_t qmail_db_folder_counts(qmail_folder_count_t counts[6]);

// ============================================================================
// RECEIVED TELL MANAGEMENT
// ============================================================================

/**
 * Dismiss/trash a received tell notification by its DB row ID.
 */
result_t qmail_db_tell_trash(int64_t tell_id);

// ============================================================================
// PENDING TELLS (outgoing tell retry queue)
// ============================================================================

/**
 * Insert a failed outgoing tell into the retry queue.
 */
result_t qmail_db_pending_tell_insert(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                       uint32_t recipient_sn,
                                       int8_t recipient_denomination,
                                       uint8_t beacon_raida,
                                       const uint8_t *context_blob,
                                       size_t context_blob_size,
                                       const char *error_message);

/**
 * List pending tells, optionally filtered by status ("pending", "sent", "failed").
 * Pass NULL or "" for status_filter to list all.
 * Caller must free(*rows_out) when done.
 */
result_t qmail_db_pending_tell_list(const char *status_filter,
                                     qmail_pending_tell_row_t **rows_out,
                                     int *count_out);

/**
 * Update a pending tell's status (increments retry_count).
 */
result_t qmail_db_pending_tell_update_status(int64_t tell_id,
                                              const char *new_status,
                                              const char *error_message);

/**
 * Update existing pending/failed retry rows for one email/beacon pair.
 * Used when a manual /tell retry succeeds or refreshes a failed beacon,
 * so the retry worker does not later send a stale duplicate Tell.
 */
result_t qmail_db_pending_tell_update_by_file_beacon(
    const uint8_t file_guid[QMAIL_GUID_SIZE],
    uint8_t beacon_raida,
    const char *new_status,
    const uint8_t *context_blob,
    size_t context_blob_size,
    const char *error_message,
    int *updated_count);

/**
 * Reset a failed tell back to 'pending' for retry.
 * Returns RESULT_NOT_FOUND if tell doesn't exist or isn't in 'failed' status.
 */
result_t qmail_db_pending_tell_reset_to_pending(int64_t tell_id);

/**
 * Delete all tells with status 'sent'. Returns count of deleted rows.
 */
result_t qmail_db_pending_tell_clear_sent(int *deleted_count);

/**
 * Get the serialized tell_context_blob for re-sending.
 * Caller must free(*blob_out).
 */
result_t qmail_db_pending_tell_get_context(int64_t tell_id,
                                            uint8_t **blob_out,
                                            size_t *blob_size_out);

// ============================================================================
// NOTIFICATIONS (received tells with sender contact info)
// ============================================================================

/**
 * List recent received tell notifications with sender contact lookup.
 * Caller must free(*rows_out).
 */
result_t qmail_db_notifications_list(qmail_notification_row_t **rows_out,
                                      int *count_out,
                                      int limit);

// ============================================================================
// PAYMENT (locker code and payment status from received tells)
// ============================================================================

/**
 * Get payment info for a received email (locker code + payment status).
 * payment_status: 0=unclaimed, 1=claimed, 2=failed, 3=refunded
 */
result_t qmail_db_tell_get_payment_info(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                         uint8_t locker_code_out[16],
                                         int *payment_status_out);

/**
 * Update payment status for a received email.
 */
result_t qmail_db_tell_update_payment_status(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                              int payment_status);

// ============================================================================
// DRAFTS
// ============================================================================

/**
 * List drafts with pagination. total_out may be NULL.
 * Caller must free with qmail_db_email_list_free().
 */
result_t qmail_db_drafts_list(int limit, int offset,
                               qmail_email_t **emails_out, int *count_out,
                               int *total_out);

/**
 * Save a new draft. Sets folder=DRAFTS automatically.
 * Reuses qmail_db_email_insert internally.
 */
result_t qmail_db_draft_save(qmail_email_t *email);

/**
 * Update an existing draft's subject and/or body.
 * Pass NULL for fields you don't want to change.
 * Returns RESULT_NOT_FOUND if email_id doesn't exist or isn't a draft.
 */
result_t qmail_db_draft_update(const uint8_t email_id[QMAIL_GUID_SIZE],
                                const char *subject,
                                const char *body,
                                size_t body_len);

/**
 * Replace the recipient list for a draft.
 */
result_t qmail_db_draft_update_recipients(const uint8_t email_id[QMAIL_GUID_SIZE],
                                           const qmail_recipient_entry_t *recipients,
                                           int recipient_count);

// ============================================================================
// STATISTICS
// ============================================================================

int qmail_db_count_emails(int folder);
int qmail_db_count_unread(void);
int qmail_db_count_contacts(void);

// ============================================================================
// LOCKER POOL (pre-funded locker codes for send)
// ============================================================================

/** Max locker key string length (fits in 16-byte protocol field) */
#define QMAIL_LOCKER_KEY_MAX_LEN  16

/** Pool type constants */
#define QMAIL_POOL_TYPE_UPLOAD    0   /**< 1 CC per server for storage */
#define QMAIL_POOL_TYPE_INBOX_FEE 1   /**< Variable CC for recipient inbox fee */

/** Pool status constants */
#define QMAIL_POOL_STATUS_AVAILABLE 0
#define QMAIL_POOL_STATUS_RESERVED  1
#define QMAIL_POOL_STATUS_CONSUMED  2
#define QMAIL_POOL_STATUS_LIMBO     3

/**
 * Insert a funded locker code into the pool.
 * @param initial_status  QMAIL_POOL_STATUS_AVAILABLE (0) for pool pre-fill,
 *                        QMAIL_POOL_STATUS_CONSUMED (2) for sync-funded codes
 */
result_t qmail_db_locker_pool_insert(const char *locker_key, int pool_type,
                                      int funded_amount, int initial_status);

/**
 * Atomically acquire up to max_count available locker codes of the given type
 * with funded_amount >= min_amount. Marks them as reserved.
 * Returns key strings in keys_out, count in count_out.
 */
result_t qmail_db_locker_pool_acquire(int pool_type, int min_amount,
                                       int max_count,
                                       char keys_out[][QMAIL_LOCKER_KEY_MAX_LEN],
                                       int *count_out);

/**
 * Stamp a RESERVED locker_pool row with the file_guid it was acquired for.
 * Idempotent — safe to call after acquire even on rows funded synchronously.
 * Used by the split-commit flow (Phase 2 hardening) so the reclamation
 * sweep (Phase 8) can match a stuck row back to a specific email.
 *
 * @param locker_key  The locker key of the row to stamp.
 * @param file_guid   16-byte GUID. NULL clears the stamp.
 */
result_t qmail_db_locker_pool_stamp_file_guid(const char *locker_key,
                                              const uint8_t *file_guid);

/**
 * Mark a reserved locker as consumed (after successful send).
 */
result_t qmail_db_locker_pool_consume(const char *locker_key);

/**
 * Release a reserved locker back to available (on send failure).
 */
result_t qmail_db_locker_pool_release(const char *locker_key);

/**
 * Move all reserved lockers into limbo during startup recovery.
 * count_out receives the number of rows moved and may be NULL.
 */
result_t qmail_db_locker_pool_move_reserved_to_limbo(int *count_out);

/**
 * Count pool entries by type and status.
 */
int qmail_db_locker_pool_count(int pool_type, int status);

/**
 * Sum funded CC value for pool entries by type and status.
 */
int qmail_db_locker_pool_value(int pool_type, int status);

/**
 * Delete consumed entries older than max_age_seconds.
 */
result_t qmail_db_locker_pool_cleanup(int max_age_seconds);

#endif /* QMAIL_DB_H */
