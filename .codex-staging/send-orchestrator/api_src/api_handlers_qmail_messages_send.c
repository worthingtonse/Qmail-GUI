/**
 * api_handlers_qmail_messages_send.c - QMail send-side message endpoints
 *
 * Three endpoints land here, in three commits:
 *   3.3  /api/qmail/net/messages/upload           (upload-only, async)
 *   3.4  /api/qmail/net/messages/tell             (NEW tell-only,    async)
 *   3.5  /api/qmail/net/messages/upload_and_tell  (NEW compose,      async)
 *
 * Lives in its own translation unit beside the receive-side handlers in
 * api_handlers_qmail_messages.c so send-side changes stay isolated.
 *
 * The two key contracts (Phase 3 plan):
 *   - Receipts are mandatory. /upload refuses with 500 if no Mail wallet.
 *   - GUID-conflict on /upload returns 409.
 */

#include "api_handlers.h"
#include "api_handlers_qmail_utils.h"
#include "qmail/qmail_cbdf.h"
#include "qmail/qmail_crypto.h"
#include "qmail/qmail_send.h"
#include "qmail/qmail_upload_files.h"
#include "qmail/qmail_send_tells.h"
#include "qmail/qmail_receipt.h"
#include "qmail/qmail_object_transfer.h"
#include "qmail/qmail_contacts.h"
#include "qmail/qmail_commands.h"
#include "qmail/qmail_locker_pool.h"
#include "qmail/qmail_users.h"
#include "encryption_key.h"
#include "platform.h"
#include "utils.h"

/* g_config.servers[] is the REST-side mirror of the per-RAIDA endpoint
 * table; we use it instead of including transport.h directly because
 * transport.h conflicts with raida_task.h's raida_stats_t typedef. */

#ifdef _WIN32
#include <process.h>
#include <windows.h>
#else
#include <pthread.h>
#endif
#include <time.h>

extern void *transport_get_default(void);

/*
 * Validate every recipient in a comma/semicolon-separated list up front,
 * synchronously, before the send task is created. This turns the late,
 * generic "No recipients resolved" failure into an immediate, specific
 * 400 that names the offending address and why it is invalid.
 *
 * Each address must satisfy qmail_address_validate() (starts with '@',
 * ends in a denomination TLD, has >= 2 dots, and decodes to a valid
 * serial number). On the first bad token, writes a user-facing reason to
 * `err` and returns false. An empty/NULL list is treated as "nothing to
 * validate here" (the caller separately enforces at-least-one recipient).
 */
static bool api_qmail_validate_recipient_list(const char *list, const char *field,
                                              char *err, size_t err_size) {
    if (!list || list[0] == '\0') return true;

    char buf[QMAIL_MAX_RECIPIENT_LIST_LEN];
    strncpy(buf, list, sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';

    char *saveptr = NULL;
    char *token = strtok_r(buf, ",;", &saveptr);
    while (token) {
        /* Trim surrounding whitespace. */
        while (*token == ' ' || *token == '\t') token++;
        char *end = token + strlen(token) - 1;
        while (end > token && (*end == ' ' || *end == '\t')) *end-- = '\0';

        if (*token) {
            char reason[160];
            if (qmail_address_validate(token, NULL, NULL,
                                       reason, sizeof(reason)) != RESULT_SUCCESS) {
                if (err && err_size) {
                    snprintf(err, err_size, "Invalid %s address \"%s\": %s",
                             field, token, reason);
                }
                return false;
            }
        }
        token = strtok_r(NULL, ",;", &saveptr);
    }
    return true;
}

static uint8_t api_manifest_flags_for_file_type(uint8_t file_type) {
    if (file_type == QMAIL_FILE_META) return QMAIL_FILE_MANIFEST_FLAG_META;
    if (file_type == QMAIL_FILE_BODY) return QMAIL_FILE_MANIFEST_FLAG_BODY;
    if (file_type >= QMAIL_FILE_ATTACHMENT_1) return QMAIL_FILE_MANIFEST_FLAG_ATTACHMENT;
    return 0;
}

static void api_fill_manifest_entry(qmail_file_manifest_entry_t *entry,
                                    uint8_t file_type,
                                    uint64_t original_size,
                                    uint32_t crc32) {
    if (!entry) return;
    memset(entry, 0, sizeof(*entry));
    entry->file_type = file_type;
    entry->file_flags = api_manifest_flags_for_file_type(file_type);
    utils_write_u64_be(entry->original_size, original_size);
    utils_write_u32_be(entry->crc32, crc32);
}

/* /tell is async, but the decision to start it must be serialized in this
 * process. Otherwise two near-simultaneous HTTP requests can both observe
 * tell.status="not_started" before either worker has a chance to update the
 * receipt. The receipt remains the observable source of truth for the GUI. */
#ifdef _WIN32
static CRITICAL_SECTION s_tell_claim_lock;
static volatile LONG s_tell_claim_init_state = 0;

static void qmail_tell_claim_lock(void) {
    if (InterlockedCompareExchange(&s_tell_claim_init_state, 1, 0) == 0) {
        InitializeCriticalSection(&s_tell_claim_lock);
        InterlockedExchange(&s_tell_claim_init_state, 2);
    } else {
        while (InterlockedCompareExchange(&s_tell_claim_init_state, 2, 2) != 2) {
            Sleep(0);
        }
    }
    EnterCriticalSection(&s_tell_claim_lock);
}

static void qmail_tell_claim_unlock(void) {
    LeaveCriticalSection(&s_tell_claim_lock);
}
#else
static pthread_once_t s_tell_claim_once = PTHREAD_ONCE_INIT;
static pthread_mutex_t s_tell_claim_lock;

static void qmail_tell_claim_init_once(void) {
    pthread_mutex_init(&s_tell_claim_lock, NULL);
}

static void qmail_tell_claim_lock(void) {
    pthread_once(&s_tell_claim_once, qmail_tell_claim_init_once);
    pthread_mutex_lock(&s_tell_claim_lock);
}

static void qmail_tell_claim_unlock(void) {
    pthread_mutex_unlock(&s_tell_claim_lock);
}
#endif

// ============================================================================
// /api/qmail/net/messages/upload — upload-only async
// ============================================================================

/* Worker thread state. Holds everything needed to run qmail_upload_files()
 * + qmail_upload_artifacts_confirm() without the request thread.
 *
 * The CBDF buffer (built from the body or read from a path) is heap-owned
 * here; the thread frees it on its way out. */
typedef struct {
    char     task_id[64];
    char     wallet_path[MAX_PATH_LEN];

    /* Input — exactly one of these is set. Other slots stay zeroed. */
    char     email_file[MAX_PATH_LEN];   /* legacy path-on-disk mode */
    uint8_t *email_data;                 /* in-memory CBDF (heap, owned) */
    size_t   email_data_len;

    /* Attachments: comma/semicolon-joined for qmail_upload_files's existing
     * `attachments` field. Built up on the request thread before the
     * worker starts. */
    char     attachments[MAX_PATH_LEN * 4];
    int      attachment_count;
    char     attachment_names[QMAIL_CBDF_MAX_ATTACHMENT_NAMES][QMAIL_CBDF_ATTACHMENT_NAME_MAX + 1];
    int      attachment_name_count;
    uint8_t  attachment_is_paged[QMAIL_CBDF_MAX_ATTACHMENT_NAMES];
    uint16_t attachment_total_pages[QMAIL_CBDF_MAX_ATTACHMENT_NAMES];

    /* Optional CBDF metadata stamping recipients. NOT used to send Tell —
     * Tell is the /tell endpoint's job. */
    char     to [QMAIL_MAX_RECIPIENT_LIST_LEN];
    char     cc [QMAIL_MAX_RECIPIENT_LIST_LEN];
    char     bcc[QMAIL_MAX_RECIPIENT_LIST_LEN];

    char     subject[QMAIL_MAX_SUBJECT_LEN];
    char     body_preview[256];

    int      duration_weeks;

    uint8_t  file_guid[QMAIL_GUID_SIZE];
    bool     has_file_guid;
} upload_args_t;

static void qmail_upload_args_add_attachment_name_span(upload_args_t *a,
                                                       const char *path,
                                                       size_t path_len) {
    if (!a || !path || path_len == 0) return;
    if (a->attachment_name_count >= QMAIL_CBDF_MAX_ATTACHMENT_NAMES) return;

    size_t base = 0;
    for (size_t i = 0; i < path_len; i++) {
        if (path[i] == '/' || path[i] == '\\') base = i + 1;
    }
    if (base >= path_len) base = 0;

    size_t name_len = path_len - base;
    if (name_len > QMAIL_CBDF_ATTACHMENT_NAME_MAX)
        name_len = QMAIL_CBDF_ATTACHMENT_NAME_MAX;

    char *dst = a->attachment_names[a->attachment_name_count];
    if (name_len > 0) {
        memcpy(dst, path + base, name_len);
    } else {
        memcpy(dst, "attachment", 10);
        name_len = 10;
    }
    dst[name_len] = '\0';
    a->attachment_name_count++;
}

static result_t qmail_upload_args_append_attachment_span(upload_args_t *a,
                                                        const char *path,
                                                        size_t path_len,
                                                        char *err,
                                                        size_t err_size) {
    if (!a || !path || path_len == 0) return RESULT_INVALID_PARAM;
    if (a->attachment_count >= QMAIL_CBDF_MAX_ATTACHMENT_NAMES) {
        if (err && err_size) {
            snprintf(err, err_size, "Too many attachments: maximum is %d",
                     QMAIL_CBDF_MAX_ATTACHMENT_NAMES);
        }
        return RESULT_INVALID_PARAM;
    }
    if (path_len >= MAX_PATH_LEN) {
        if (err && err_size) {
            snprintf(err, err_size, "Attachment path is too long");
        }
        return RESULT_INVALID_PARAM;
    }

    char path_buf[MAX_PATH_LEN];
    memcpy(path_buf, path, path_len);
    path_buf[path_len] = '\0';

    qmail_attachment_page_plan_t page_plan;
    result_t plan_res =
        qmail_upload_preplan_attachment_path(path_buf, &page_plan, NULL);
    if (plan_res != RESULT_SUCCESS) {
        if (err && err_size) {
            snprintf(err, err_size, "Attachment not found or not readable: %s",
                     path_buf);
        }
        return plan_res;
    }

    size_t used = strlen(a->attachments);
    size_t separator = used > 0 ? 1 : 0;
    size_t overhead = separator + 1; /* separator plus null terminator */
    if (used > sizeof(a->attachments) - overhead ||
        path_len > sizeof(a->attachments) - used - overhead) {
        if (err && err_size) {
            snprintf(err, err_size, "Attachment list is too long");
        }
        return RESULT_INVALID_PARAM;
    }

    if (separator) a->attachments[used++] = ',';
    memcpy(a->attachments + used, path, path_len);
    used += path_len;
    a->attachments[used] = '\0';

    int idx = a->attachment_count;
    a->attachment_is_paged[idx] = page_plan.is_paged;
    a->attachment_total_pages[idx] = page_plan.total_pages_estimate;
    a->attachment_count++;

    qmail_upload_args_add_attachment_name_span(a, path_buf, strlen(path_buf));
    return RESULT_SUCCESS;
}

static result_t qmail_upload_args_append_legacy_attachments(upload_args_t *a,
                                                           const char *legacy,
                                                           char *err,
                                                           size_t err_size) {
    const char *next = legacy;
    while (next && *next) {
        while (*next == ',' || *next == ';') next++;

        const char *scan = next;
        while (*scan && *scan != ',' && *scan != ';') scan++;

        const char *start = next;
        const char *end = scan;
        while (start < end &&
               (*start == ' ' || *start == '\t' || *start == '\r' || *start == '\n')) {
            start++;
        }
        while (end > start &&
               (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\r' || end[-1] == '\n')) {
            end--;
        }

        if (end > start) {
            result_t res =
                qmail_upload_args_append_attachment_span(a, start,
                                                         (size_t)(end - start),
                                                         err, err_size);
            if (res != RESULT_SUCCESS) return res;
        }

        next = *scan ? scan + 1 : scan;
    }
    return RESULT_SUCCESS;
}

static result_t qmail_upload_args_resolve_attachments(http_request_t *request,
                                                      upload_args_t *a,
                                                      char *err,
                                                      size_t err_size) {
    const char *att_paths[QMAIL_CBDF_MAX_ATTACHMENT_NAMES];
    int n_atts = http_request_get_param_multi(request, "attachment_file_path",
                                               att_paths, QMAIL_CBDF_MAX_ATTACHMENT_NAMES);
    if (n_atts > 0) {
        for (int i = 0; i < n_atts; i++) {
            if (!att_paths[i] || !att_paths[i][0]) continue;
            result_t res =
                qmail_upload_args_append_attachment_span(a, att_paths[i],
                                                         strlen(att_paths[i]),
                                                         err, err_size);
            if (res != RESULT_SUCCESS) return res;
        }
        return RESULT_SUCCESS;
    }

    const char *legacy = http_request_get_param(request, "attachments");
    if (legacy) {
        return qmail_upload_args_append_legacy_attachments(a, legacy,
                                                           err, err_size);
    }
    return RESULT_SUCCESS;
}

static int qmail_upload_args_attachment_name_ptrs(const upload_args_t *a,
                                                  const char *names[],
                                                  int max_names) {
    if (!a || !names || max_names <= 0) return 0;
    int count = a->attachment_name_count;
    if (count > max_names) count = max_names;
    for (int i = 0; i < count; i++) names[i] = a->attachment_names[i];
    return count;
}

static bool qmail_upload_args_has_paged_attachment(const upload_args_t *a) {
    if (!a) return false;
    for (int i = 0; i < a->attachment_count; i++) {
        if (a->attachment_is_paged[i]) return true;
    }
    return false;
}
#ifdef _WIN32
static unsigned __stdcall upload_thread_func(void *arg) {
#else
static void *upload_thread_func(void *arg) {
#endif
    upload_args_t *a = (upload_args_t *)arg;

    log_info(LOG_CAT_COMMAND,
             "QMail upload thread: task=%s cbdf=%zu bytes",
             a->task_id, a->email_data_len);

    core_transport_t *transport = (core_transport_t *)transport_get_default();
    if (!transport) {
        task_fail(a->task_id, "Transport not initialized");
        goto cleanup;
    }

    /* Translate to the upload-files primitive's options struct. The
     * recipient lists are advisory at upload time — used for CBDF
     * stamping (already done above) and for inbox-fee budgeting. */
    qmail_upload_files_options_t opts;
    memset(&opts, 0, sizeof(opts));
    opts.wallet_path     = a->wallet_path;
    opts.email_file      = a->email_file[0] ? a->email_file : NULL;
    opts.email_data      = a->email_data;
    opts.email_data_len  = a->email_data_len;
    opts.attachments     = a->attachments[0] ? a->attachments : NULL;
    opts.file_guid       = a->has_file_guid ? a->file_guid : NULL;
    opts.duration_weeks  = a->duration_weeks;
    opts.task_id         = a->task_id;
    opts.to              = a->to [0] ? a->to  : NULL;
    opts.cc              = a->cc [0] ? a->cc  : NULL;
    opts.bcc             = a->bcc[0] ? a->bcc : NULL;

    qmail_upload_artifacts_t artifacts;
    result_t r = qmail_upload_files(&opts, transport, &artifacts);
    if (r != RESULT_SUCCESS) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Upload failed: %s — %s",
                 result_to_string(r),
                 artifacts.error_message[0] ? artifacts.error_message : "unknown error");
        task_fail(a->task_id, msg);
        log_error(LOG_CAT_COMMAND, "QMail upload task=%s: %s", a->task_id, msg);
        goto cleanup;
    }

    /* Phase 3: stamp subject + body_preview AND seed tell.recipients[] in
     * the receipt so /tell can later resolve recipients from the receipt
     * without the caller having to re-supply them. The receipt was
     * created by qmail_upload_files() on success. */
    bool wanted_tell = (a->to[0] || a->cc[0] || a->bcc[0]);
    bool defer_tell_lock = false;
    char mail_wallet[MAX_PATH_LEN];
    if (qmail_receipt_get_mail_wallet_path(mail_wallet, sizeof(mail_wallet))
        == RESULT_SUCCESS) {
        qmail_receipt_t receipt;
        if (qmail_receipt_load(mail_wallet, artifacts.file_guid, &receipt)
            == RESULT_SUCCESS) {
            if (a->subject[0])
                strncpy(receipt.subject, a->subject, sizeof(receipt.subject) - 1);
            if (a->body_preview[0])
                strncpy(receipt.body_preview, a->body_preview,
                        sizeof(receipt.body_preview) - 1);

            /* Seed tell.recipients[] from the upload-time recipient hints
             * if any were supplied. Status stays "queued" — /tell will
             * advance them when it actually fires Tell. */
            recipient_with_beacon_t parsed[QMAIL_MAX_RECIPIENTS];
            int n = 0;
            if (a->to[0])
                n += qmail_parse_recipients(a->to, QMAIL_RECIPIENT_TO,
                                            parsed + n, QMAIL_MAX_RECIPIENTS - n);
            if (a->cc[0])
                n += qmail_parse_recipients(a->cc, QMAIL_RECIPIENT_CC,
                                            parsed + n, QMAIL_MAX_RECIPIENTS - n);
            if (a->bcc[0])
                n += qmail_parse_recipients(a->bcc, QMAIL_RECIPIENT_BC,
                                            parsed + n, QMAIL_MAX_RECIPIENTS - n);
            if (n > 0) {
                receipt.tell_recipient_count = 0;
                for (int i = 0; i < n
                                && receipt.tell_recipient_count < QMAIL_RECEIPT_MAX_RECIPIENTS;
                     i++) {
                    qmail_receipt_recipient_t *rc =
                        &receipt.tell_recipients[receipt.tell_recipient_count++];
                    memset(rc, 0, sizeof(*rc));
                    rc->serial_number     = parsed[i].entry.serial_number;
                    rc->denomination      = parsed[i].entry.denomination;
                    rc->beacon_raida      = parsed[i].beacon_raida;
                    rc->status            = QMAIL_RCPT_STATUS_QUEUED;
                    rc->tell_command_code = CMD_QMAIL_TELL;
                    switch (parsed[i].entry.recipient_type) {
                        case QMAIL_RECIPIENT_CC: strcpy(rc->kind, "cc");  break;
                        case QMAIL_RECIPIENT_BC: strcpy(rc->kind, "bcc"); break;
                        default:                 strcpy(rc->kind, "to");  break;
                    }
                }
                receipt.tell_summary_total  = receipt.tell_recipient_count;
                receipt.tell_summary_queued = receipt.tell_recipient_count;
                strcpy(receipt.tell_status, "not_started");
            }
            result_t save_rc = qmail_receipt_save(&receipt);
            if (save_rc != RESULT_SUCCESS) {
                log_error(LOG_CAT_COMMAND,
                          "QMail upload task=%s: receipt update failed (%s)",
                          a->task_id, result_to_string(save_rc));
            } else if (n > 0) {
                defer_tell_lock = true;
            }
        }
    }

    if (wanted_tell && !defer_tell_lock) {
        qmail_upload_artifacts_confirm(&artifacts, a->wallet_path);
        task_fail(a->task_id,
                  "Upload completed, but receipt recipient update failed; "
                  "Tell cannot run from this upload");
        goto cleanup;
    }

    /* If recipients were saved to the receipt, keep the inbox-fee locker
     * RESERVED so the later /tell can confirm it. A true upload-only call
     * has no deferred Tell, so the funding recycles to AVAILABLE. */
    if (!defer_tell_lock) {
        qmail_upload_artifacts_confirm(&artifacts, a->wallet_path);
    } else {
        log_info(LOG_CAT_COMMAND,
                 "QMail upload task=%s: deferred Tell locker kept reserved",
                 a->task_id);
    }

    /* Build the task-completion data JSON. */
    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    api_qmail_guid_to_hex(artifacts.file_guid, guid_hex);

    char data_json[512];
    snprintf(data_json, sizeof(data_json),
             "{\"file_guid\":\"%s\",\"upload_successes\":%d,"
             "\"upload_failures\":%d,\"used_sync_fallback\":%s,"
             "\"low_balance_warning\":%s}",
             guid_hex, artifacts.upload_successes, artifacts.upload_failures,
             artifacts.used_sync_fallback   ? "true" : "false",
             artifacts.low_balance_warning  ? "true" : "false");
    task_complete_with_data(a->task_id,
                            defer_tell_lock
                              ? "Upload completed; Tell pending"
                              : "Upload completed (no Tell)",
                            data_json);

    log_info(LOG_CAT_COMMAND,
             "QMail upload task=%s: complete (guid=%s, %d/%d servers OK)",
             a->task_id, guid_hex, artifacts.upload_successes,
             artifacts.valid_server_count);

cleanup:
    free(a->email_data);
    free(a);
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

void api_handle_qmail_upload(http_request_t *request, http_response_t *response,
                              void *user_data) {
    (void)user_data;

    char rid[API_QMAIL_RID_LEN];
    api_qmail_generate_rid(rid);
    uint64_t t_start = platform_time_ms();

    /* 1. Mail wallet must exist — receipts depend on it (Q22(a)). */
    char mail_wallet[MAX_PATH_LEN];
    if (qmail_receipt_get_mail_wallet_path(mail_wallet, sizeof(mail_wallet))
        != RESULT_SUCCESS) {
        log_error(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: no Mail wallet", rid);
        api_qmail_error_response_with_rid(response,
            "No Mail wallet configured (required for receipts)", 500, rid);
        return;
    }

    /* 2. Resolve body source. Current upload inputs (mutually exclusive):
     *      body                   — inline text
     *      plain_text_qmail_path  — path to .txt the server reads
     *      email_file             — legacy path to a prebuilt .qmail
     *    Only one may be supplied. */
    const char *body                  = http_request_get_param(request, "body");
    const char *plain_text_qmail_path = http_request_get_param(request, "plain_text_qmail_path");
    const char *email_file            = http_request_get_param(request, "email_file");
    int n_sources = (body ? 1 : 0) + (plain_text_qmail_path ? 1 : 0) + (email_file ? 1 : 0);
    if (n_sources == 0) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: missing body source", rid);
        api_qmail_error_response_with_rid(response,
            "Missing body source: supply one of body, plain_text_qmail_path, or email_file",
            400, rid);
        return;
    }
    if (n_sources > 1) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: %d body sources supplied", rid, n_sources);
        api_qmail_error_response_with_rid(response,
            "body, plain_text_qmail_path and email_file are mutually exclusive",
            400, rid);
        return;
    }

    log_info(LOG_CAT_COMMAND, "UPLOAD rid=%s entry: source=%s",
             rid, body ? "body" : (plain_text_qmail_path ? "plain_text_qmail_path" : "email_file"));

    /* 3. Optional file_guid override. If supplied AND a receipt already
     *    exists for that guid → 409. (Q15: v1 treats GUIDs as immutable.) */
    const char *file_guid_hex = http_request_get_param(request, "file_guid");
    uint8_t suggested_guid[QMAIL_GUID_SIZE];
    bool have_guid = false;
    if (file_guid_hex && file_guid_hex[0]) {
        if (!api_qmail_hex_to_guid(file_guid_hex, suggested_guid)) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: invalid file_guid", rid);
            api_qmail_error_response_with_rid(response,
                "Invalid file_guid format (expected 32 hex chars)", 400, rid);
            return;
        }
        if (qmail_receipt_exists(mail_wallet, suggested_guid)) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: file_guid conflict", rid);
            api_qmail_error_response_with_rid(response,
                "A receipt already exists for that file_guid", 409, rid);
            return;
        }
        have_guid = true;
    }

    /* 4. Optional CBDF metadata stamping recipients (collected, not parsed
     *    here — Tell-side parsing happens on the worker). */
    upload_args_t *a = (upload_args_t *)calloc(1, sizeof(*a));
    if (!a) {
        log_error(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: alloc failed", rid);
        api_qmail_error_response_with_rid(response, "Memory allocation failed", 500, rid);
        return;
    }

    result_t rcp;
    rcp = api_qmail_collect_recipient_param(request, "to",  a->to,  sizeof(a->to));
    if (rcp != RESULT_SUCCESS && rcp != RESULT_NOT_FOUND) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: to list too long", rid);
        api_qmail_error_response_with_rid(response, "Recipient list too long", 400, rid);
        free(a);
        return;
    }
    rcp = api_qmail_collect_recipient_param(request, "cc",  a->cc,  sizeof(a->cc));
    if (rcp != RESULT_SUCCESS && rcp != RESULT_NOT_FOUND) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: cc list too long", rid);
        api_qmail_error_response_with_rid(response, "CC list too long", 400, rid);
        free(a);
        return;
    }
    rcp = api_qmail_collect_recipient_param(request, "bcc", a->bcc, sizeof(a->bcc));
    if (rcp != RESULT_SUCCESS && rcp != RESULT_NOT_FOUND) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: bcc list too long", rid);
        api_qmail_error_response_with_rid(response, "BCC list too long", 400, rid);
        free(a);
        return;
    }

    /* Validate any recipients supplied (recipients are optional on /upload,
     * so an empty list is fine — the helper no-ops on empty). */
    {
        char addr_err[256];
        if (!api_qmail_validate_recipient_list(a->to,  "To",  addr_err, sizeof(addr_err)) ||
            !api_qmail_validate_recipient_list(a->cc,  "Cc",  addr_err, sizeof(addr_err)) ||
            !api_qmail_validate_recipient_list(a->bcc, "Bcc", addr_err, sizeof(addr_err))) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: %s", rid, addr_err);
            api_qmail_error_response_with_rid(response, addr_err, 400, rid);
            free(a);
            return;
        }
    }

    /* 5. Wallet path + transport prologue. */
    char wallet_path[MAX_PATH_LEN];
    core_transport_t *transport = NULL;
    if (api_qmail_begin_request_with_rid(request, response, wallet_path, sizeof(wallet_path),
                                 &transport, "Invalid wallet_path", 400,
                                 "Transport not initialized", rid) != RESULT_SUCCESS) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: wallet/transport prologue", rid);
        free(a);
        return;
    }
    strncpy(a->wallet_path, wallet_path, sizeof(a->wallet_path) - 1);

    const char *subject = http_request_get_param(request, "subject");
    if (subject) strncpy(a->subject, subject, sizeof(a->subject) - 1);

    a->duration_weeks = http_param_int_clamped(request, "duration", 4, 1, 520);

    /* 6. Resolve attachments. Repeated attachment_file_path params keep
     *    attachment filenames in the same order as upload file types. */
    {
        char att_err[512] = {0};
        result_t att_res =
            qmail_upload_args_resolve_attachments(request, a,
                                                  att_err, sizeof(att_err));
        if (att_res != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: %s", rid,
                     att_err[0] ? att_err : "Invalid attachment list");
            api_qmail_error_response_with_rid(response,
                att_err[0] ? att_err : "Invalid attachment list", 400, rid);
            free(a);
            return;
        }
    }

    /* 7. Build the body. Three paths converge into a heap CBDF buffer or
     *    an email_file path. */
    uint8_t *cbdf_data = NULL;
    size_t   cbdf_len  = 0;

    if (email_file) {
        /* Legacy path-on-disk mode — pass through to upload_files. */
        FILE *f = fopen(email_file, "rb");
        if (!f) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: email_file not readable", rid);
            api_qmail_error_response_with_rid(response,
                "email_file not found or not readable", 400, rid);
            free(a);
            return;
        }
        fclose(f);
        if (qmail_upload_args_has_paged_attachment(a)) {
            log_warn(LOG_CAT_COMMAND,
                     "UPLOAD rid=%s exit: email_file mode with paged attachment",
                     rid);
            api_qmail_error_response_with_rid(response,
                "email_file mode cannot add paging metadata for large attachments; use body or plain_text_qmail_path",
                400, rid);
            free(a);
            return;
        }
        strncpy(a->email_file, email_file, sizeof(a->email_file) - 1);
    } else {
        /* body OR plain_text_qmail_path → CBDF in memory.
         * For plain_text_qmail_path we slurp the file as the body text. */
        char *body_buf = NULL;
        size_t body_len = 0;
        bool body_owned = false;

        if (body) {
            body_len = strlen(body);
            body_buf = (char *)body;  /* not owned */
        } else {
            FILE *f = fopen(plain_text_qmail_path, "rb");
            if (!f) {
                log_warn(LOG_CAT_COMMAND,
                         "UPLOAD rid=%s exit: plain_text_qmail_path not readable", rid);
                api_qmail_error_response_with_rid(response,
                    "plain_text_qmail_path not found or not readable", 400, rid);
                free(a);
                return;
            }
            fseek(f, 0, SEEK_END);
            long size = ftell(f);
            fseek(f, 0, SEEK_SET);
            if (size <= 0 || size > QMAIL_CBDF_BODY_MAX_BYTES) {
                fclose(f);
                log_warn(LOG_CAT_COMMAND,
                         "UPLOAD rid=%s exit: plain_text_qmail_path size=%ld invalid",
                         rid, size);
                api_qmail_error_response_with_rid(response,
                    "plain_text_qmail_path is empty or too large (max 512 KB)", 400, rid);
                free(a);
                return;
            }
            body_buf = (char *)malloc((size_t)size + 1);
            if (!body_buf) {
                fclose(f);
                log_error(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: body alloc failed", rid);
                api_qmail_error_response_with_rid(response,
                    "Memory allocation failed", 500, rid);
                free(a);
                return;
            }
            size_t got = fread(body_buf, 1, (size_t)size, f);
            fclose(f);
            if (got != (size_t)size) {
                free(body_buf);
                log_error(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: short read on plain_text_qmail_path",
                          rid);
                api_qmail_error_response_with_rid(response,
                    "Failed to read plain_text_qmail_path", 500, rid);
                free(a);
                return;
            }
            body_buf[size] = '\0';
            body_len = (size_t)size;
            body_owned = true;
        }

        /* Resolve sender identity for the From field of the CBDF. */
        raida_encryption_key_t enc_key;
        if (api_qmail_select_enc_key_with_rid(wallet_path, 0, response, &enc_key,
                                     "No encryption key available (empty wallet?)", rid)
            != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: no encryption key", rid);
            if (body_owned) free(body_buf);
            free(a);
            return;
        }

        /* Parse recipients for CBDF metadata stamping (NOT for Tell). */
        recipient_with_beacon_t recipients_ext[QMAIL_MAX_RECIPIENTS];
        int to_count = 0, cc_count = 0;
        if (a->to[0]) {
            to_count = qmail_parse_recipients(a->to, QMAIL_RECIPIENT_TO,
                                              recipients_ext, QMAIL_MAX_RECIPIENTS);
        }
        if (a->cc[0]) {
            cc_count = qmail_parse_recipients(a->cc, QMAIL_RECIPIENT_CC,
                                              &recipients_ext[to_count],
                                              QMAIL_MAX_RECIPIENTS - to_count);
        }
        qmail_recipient_entry_t to_entries[QMAIL_MAX_RECIPIENTS];
        qmail_recipient_entry_t cc_entries[QMAIL_MAX_RECIPIENTS];
        for (int i = 0; i < to_count; i++) to_entries[i] = recipients_ext[i].entry;
        for (int i = 0; i < cc_count; i++) cc_entries[i] = recipients_ext[to_count + i].entry;

        /* GUID: caller-supplied or generated. */
        uint8_t file_guid[QMAIL_GUID_SIZE];
        if (have_guid) memcpy(file_guid, suggested_guid, QMAIL_GUID_SIZE);
        else           qmail_crypto_generate_guid(file_guid);
        memcpy(a->file_guid, file_guid, QMAIL_GUID_SIZE);
        a->has_file_guid = true;

        /* Body preview for the receipt. */
        size_t pv = body_len < sizeof(a->body_preview) - 1
                    ? body_len : sizeof(a->body_preview) - 1;
        memcpy(a->body_preview, body_buf, pv);
        a->body_preview[pv] = '\0';

        /* CBDF From must identify the sender's mailbox, not the protocol
         * cipher key. enc_key may be a spendable wallet coin (funding,
         * change source) whose SN has nothing to do with the sender's
         * identity — using it leaks the wrong SN into the email body and
         * forces receivers to override via Tell sender_sn. Prefer the
         * Mail identity snapshot; fall back to enc_key only if there is
         * no registered identity (unregistered client). */
        qmail_identity_t from_identity;
        qmail_identity_snapshot(&from_identity);

        const char *attachment_name_ptrs[QMAIL_CBDF_MAX_ATTACHMENT_NAMES];
        int attachment_name_count =
            qmail_upload_args_attachment_name_ptrs(a, attachment_name_ptrs,
                                                   QMAIL_CBDF_MAX_ATTACHMENT_NAMES);

        qmail_cbdf_params_t p;
        memset(&p, 0, sizeof(p));
        p.file_guid           = file_guid;
        p.subject             = subject;
        p.body                = body_buf;
        p.meta_file_type_set   = true;
        p.meta_file_type       = QMAIL_CBDF_META_TYPE_QMAIL;
        p.attachment_count      = a->attachment_count;
        p.attachment_names      = attachment_name_ptrs;
        p.attachment_name_count = attachment_name_count;
        p.attachment_is_paged   = a->attachment_is_paged;
        p.attachment_total_pages = a->attachment_total_pages;
        p.attachment_page_info_count = a->attachment_count;
        if (from_identity.valid) {
            p.from_denomination  = from_identity.denomination;
            p.from_serial_number = from_identity.serial_number;
        } else {
            p.from_denomination  = enc_key.denomination;
            p.from_serial_number = enc_key.serial_number;
        }
        p.to_recipients       = to_entries;
        p.to_count            = to_count;
        p.cc_recipients       = cc_entries;
        p.cc_count            = cc_count;

        log_debug(LOG_CAT_COMMAND, "UPLOAD rid=%s call: qmail_cbdf_encode", rid);
        result_t cr = qmail_cbdf_encode(&p, &cbdf_data, &cbdf_len);
        if (body_owned) free(body_buf);

        if (cr != RESULT_SUCCESS) {
            log_error(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: CBDF encode failed (%s)",
                      rid, result_to_string(cr));
            api_qmail_error_response_with_rid(response, "CBDF encoding failed", 500, rid);
            free(a);
            return;
        }

        if (cbdf_len > (size_t)QMAIL_CBDF_BODY_MAX_BYTES) {
            log_warn(LOG_CAT_COMMAND,
                     "UPLOAD rid=%s exit: CBDF body size=%zu exceeds max=%u",
                     rid, cbdf_len, (unsigned)QMAIL_CBDF_BODY_MAX_BYTES);
            free(cbdf_data);
            api_qmail_error_response_with_rid(response,
                "CBDF body is too large (max 512 KB)", 400, rid);
            free(a);
            return;
        }

        log_info(LOG_CAT_COMMAND,
                 "UPLOAD rid=%s: CBDF encoded %zu bytes (%s mode)",
                 rid, cbdf_len, body ? "body" : "plain_text_qmail_path");
    }

    /* email_file mode does not build a CBDF here, so assign the GUID now
     * instead of making the caller wait for the background worker. */
    if (!a->has_file_guid) {
        if (have_guid) memcpy(a->file_guid, suggested_guid, QMAIL_GUID_SIZE);
        else           qmail_crypto_generate_guid(a->file_guid);
        a->has_file_guid = true;
    }

    /* 8. Generate the task id — also serves as the upload's request_id.
     *    If the caller provided a file_guid that didn't already conflict
     *    we keep using it; otherwise the API has generated one. */
    char task_id[64];
    rest_task_generate_id(task_id, sizeof(task_id));
    task_create(task_id, "QMail upload (no Tell) task created");
    strncpy(a->task_id, task_id, sizeof(a->task_id) - 1);
    a->email_data     = cbdf_data;       /* heap, ownership transfers */
    a->email_data_len = cbdf_len;

    /* 9. Spawn worker. */
    log_debug(LOG_CAT_COMMAND, "UPLOAD rid=%s call: spawn upload_thread_func task=%s",
              rid, task_id);
#ifdef _WIN32
    HANDLE thread = (HANDLE)_beginthreadex(NULL, 0, upload_thread_func, a, 0, NULL);
    if (!thread) {
        log_error(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: thread create failed", rid);
        task_fail(task_id, "Failed to create upload thread");
        free(a->email_data);
        free(a);
        api_qmail_error_response_with_rid(response,
            "Failed to start upload thread", 500, rid);
        return;
    }
    CloseHandle(thread);
#else
    pthread_t tid;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    if (pthread_create(&tid, &attr, upload_thread_func, a) != 0) {
        pthread_attr_destroy(&attr);
        log_error(LOG_CAT_COMMAND, "UPLOAD rid=%s exit: pthread_create failed", rid);
        task_fail(task_id, "Failed to create upload thread");
        free(a->email_data);
        free(a);
        api_qmail_error_response_with_rid(response,
            "Failed to start upload thread", 500, rid);
        return;
    }
    pthread_attr_destroy(&attr);
#endif

    /* 10. Return immediately with task_id + the file_guid so the GUI can
     *     start polling the receipt right away. */
    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    if (a->has_file_guid) {
        api_qmail_guid_to_hex(a->file_guid, guid_hex);
    } else {
        guid_hex[0] = '\0';
    }

    json_builder_t jb;
    json_success_response(&jb, "qmail-upload");
    api_qmail_add_request_id(&jb, rid);
    json_add_task_poll_fields(&jb, task_id);
    if (guid_hex[0]) json_add_string(&jb, "file_guid", guid_hex);
    json_add_int(&jb, "duration", a->duration_weeks);
    json_add_string(&jb, "message",
                    "Upload started (no Tell) — poll /api/system/tasks for status, "
                    "or GET /api/qmail/receipts?guid=... for receipt detail");
    json_object_end(&jb);
    http_response_set_json(response, &jb);

    log_info(LOG_CAT_COMMAND,
             "UPLOAD rid=%s result: task=%s guid=%s duration=%d elapsed=%llums",
             rid, task_id, guid_hex[0] ? guid_hex : "(none)", a->duration_weeks,
             (unsigned long long)(platform_time_ms() - t_start));
}

// ============================================================================
// /api/qmail/net/messages/tell — tell-only async
// ============================================================================
//
// Loads the receipt for a given file_guid and fires Tell to each unique
// beacon RAIDA covering its recipient list. The receipt provides:
//   - file_guid + sender SN/denom
//   - server map + per-server lockers (rebuilt into qmail_upload_artifacts_t)
//   - inbox_fee_locker key
//   - tell.recipients[] (seeded by /upload from optional to/cc/bcc)
//
// Encryption identity is rehydrated from the wallet at run time (Q19a) —
// receipts never contain encryption secrets.
//
// Q25(a/b): if the receipt's tell.status is already "success" or "partial"
//           or "in_progress" → 409 (already-told, no re-Tell).
//           If the request supplies to/cc/bcc when the receipt already
//           has tell.recipients[] → 409 (no override allowed v1).

typedef struct {
    char    task_id[64];
    char    wallet_path[MAX_PATH_LEN];
    uint8_t file_guid[QMAIL_GUID_SIZE];
} tell_args_t;

static void api_qmail_receipt_recount_tell(qmail_receipt_t *receipt) {
    int q = 0, sg = 0, st = 0, fa = 0, rq = 0;
    if (!receipt) return;

    for (int i = 0; i < receipt->tell_recipient_count; i++) {
        switch (receipt->tell_recipients[i].status) {
            case QMAIL_RCPT_STATUS_QUEUED:       q++;  break;
            case QMAIL_RCPT_STATUS_SENDING:      sg++; break;
            case QMAIL_RCPT_STATUS_SENT:         st++; break;
            case QMAIL_RCPT_STATUS_FAILED:       fa++; break;
            case QMAIL_RCPT_STATUS_RETRY_QUEUED: rq++; break;
        }
    }
    receipt->tell_summary_total        = receipt->tell_recipient_count;
    receipt->tell_summary_queued       = q;
    receipt->tell_summary_sending      = sg;
    receipt->tell_summary_sent         = st;
    receipt->tell_summary_failed       = fa;
    receipt->tell_summary_retry_queued = rq;
}

/* Claim the receipt before spawning the worker. Allowed starts are:
 *   - not_started: first Tell attempt.
 *   - failed/partial: manual retry after a previous attempt left unsent rows.
 * Success and in_progress are rejected so duplicate requests are observable
 * and do not send duplicate Tells. */
static result_t api_qmail_claim_tell_receipt(const char *mail_wallet,
                                             const uint8_t file_guid[QMAIL_GUID_SIZE],
                                             qmail_receipt_t *receipt_out,
                                             int *target_count_out,
                                             char *message,
                                             size_t message_size,
                                             int *http_status_out) {
    if (!mail_wallet || !file_guid || !receipt_out || !target_count_out)
        return RESULT_INVALID_PARAM;

    if (message && message_size > 0) message[0] = '\0';
    if (http_status_out) *http_status_out = 500;
    *target_count_out = 0;

    qmail_tell_claim_lock();

    qmail_receipt_t receipt;
    result_t r = qmail_receipt_load(mail_wallet, file_guid, &receipt);
    if (r != RESULT_SUCCESS) {
        qmail_tell_claim_unlock();
        return r;
    }

    if (strcmp(receipt.upload_status, "success") != 0) {
        if (message)
            snprintf(message, message_size,
                     "Upload is not complete; current upload status is %s",
                     receipt.upload_status);
        if (http_status_out) *http_status_out = 409;
        qmail_tell_claim_unlock();
        return RESULT_PERMISSION_DENIED;
    }

    if (receipt.tell_recipient_count == 0) {
        if (message)
            snprintf(message, message_size,
                     "Receipt has no recipients; call /upload with to/cc/bcc first");
        if (http_status_out) *http_status_out = 400;
        qmail_tell_claim_unlock();
        return RESULT_INVALID_PARAM;
    }

    if (strcmp(receipt.tell_status, "in_progress") == 0) {
        if (message)
            snprintf(message, message_size,
                     "Tell already in progress; poll /api/qmail/receipts for status");
        if (http_status_out) *http_status_out = 409;
        qmail_tell_claim_unlock();
        return RESULT_PERMISSION_DENIED;
    }
    if (strcmp(receipt.tell_status, "success") == 0) {
        if (message)
            snprintf(message, message_size,
                     "Tell already complete for this email");
        if (http_status_out) *http_status_out = 409;
        qmail_tell_claim_unlock();
        return RESULT_PERMISSION_DENIED;
    }
    if (strcmp(receipt.tell_status, "not_started") != 0
        && strcmp(receipt.tell_status, "failed") != 0
        && strcmp(receipt.tell_status, "partial") != 0) {
        if (message)
            snprintf(message, message_size,
                     "Tell cannot start from status %s", receipt.tell_status);
        if (http_status_out) *http_status_out = 409;
        qmail_tell_claim_unlock();
        return RESULT_PERMISSION_DENIED;
    }

    int targets = 0;
    int64_t now_ts = (int64_t)time(NULL);
    for (int i = 0; i < receipt.tell_recipient_count; i++) {
        qmail_receipt_recipient_t *rc = &receipt.tell_recipients[i];
        if (rc->status == QMAIL_RCPT_STATUS_SENT) continue;

        targets++;
        rc->status = QMAIL_RCPT_STATUS_SENDING;
        if (rc->started_at == 0) rc->started_at = now_ts;
        rc->finished_at = 0;
    }

    if (targets == 0) {
        if (message)
            snprintf(message, message_size,
                     "No recipients need Tell; all receipt rows are already sent");
        if (http_status_out) *http_status_out = 409;
        qmail_tell_claim_unlock();
        return RESULT_PERMISSION_DENIED;
    }

    strcpy(receipt.tell_status, "in_progress");
    receipt.tell_started_at = now_ts;
    receipt.tell_finished_at = 0;
    api_qmail_receipt_recount_tell(&receipt);

    r = qmail_receipt_save(&receipt);
    if (r == RESULT_SUCCESS) {
        *receipt_out = receipt;
        *target_count_out = targets;
    }

    qmail_tell_claim_unlock();
    return r;
}

static void api_qmail_mark_tell_failed(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                       const char *error_message) {
    char mail_wallet[MAX_PATH_LEN];
    if (qmail_receipt_get_mail_wallet_path(mail_wallet, sizeof(mail_wallet))
        != RESULT_SUCCESS) {
        return;
    }

    qmail_tell_claim_lock();

    qmail_receipt_t receipt;
    if (qmail_receipt_load(mail_wallet, file_guid, &receipt) != RESULT_SUCCESS) {
        qmail_tell_claim_unlock();
        return;
    }

    int64_t now_ts = (int64_t)time(NULL);
    for (int i = 0; i < receipt.tell_recipient_count; i++) {
        qmail_receipt_recipient_t *rc = &receipt.tell_recipients[i];
        if (rc->status == QMAIL_RCPT_STATUS_SENT) continue;
        rc->status = QMAIL_RCPT_STATUS_FAILED;
        if (rc->started_at == 0) rc->started_at = now_ts;
        rc->finished_at = now_ts;
        if (error_message) {
            strncpy(rc->last_error, error_message, sizeof(rc->last_error) - 1);
            rc->last_error[sizeof(rc->last_error) - 1] = '\0';
        }
    }

    api_qmail_receipt_recount_tell(&receipt);
    receipt.tell_finished_at = now_ts;
    if (receipt.tell_summary_sent == receipt.tell_recipient_count) {
        strcpy(receipt.tell_status, "success");
    } else if (receipt.tell_summary_sent > 0) {
        strcpy(receipt.tell_status, "partial");
    } else {
        strcpy(receipt.tell_status, "failed");
    }
    qmail_receipt_save(&receipt);

    qmail_tell_claim_unlock();
}

/* Build the per-RAIDA AN array for the sender identity by re-reading the
 * Mail wallet. Fails if the identity coin can't be located. */
static result_t rehydrate_sender_ans(const char *mail_wallet,
                                     uint32_t serial_number,
                                     int8_t  *denom_out,
                                     uint8_t  ans_out[RAIDA_COUNT][AN_LENGTH]) {
    raida_encryption_key_t key;
    encryption_key_init(&key);
    result_t r = encryption_key_select_by_sn(mail_wallet, serial_number, &key);
    if (r != RESULT_SUCCESS || !key.valid) return RESULT_NOT_FOUND;
    if (denom_out) *denom_out = key.denomination;
    memcpy(ans_out, key.ans, RAIDA_COUNT * AN_LENGTH);
    return RESULT_SUCCESS;
}

#ifdef _WIN32
static unsigned __stdcall tell_thread_func(void *arg) {
#else
static void *tell_thread_func(void *arg) {
#endif
    tell_args_t *a = (tell_args_t *)arg;

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    api_qmail_guid_to_hex(a->file_guid, guid_hex);
    log_info(LOG_CAT_COMMAND, "QMail tell thread: task=%s guid=%s",
             a->task_id, guid_hex);

    core_transport_t *transport = (core_transport_t *)transport_get_default();
    if (!transport) {
        api_qmail_mark_tell_failed(a->file_guid, "Transport not initialized");
        task_fail(a->task_id, "Transport not initialized");
        goto cleanup;
    }

    /* 1. Load the receipt. */
    char mail_wallet[MAX_PATH_LEN];
    if (qmail_receipt_get_mail_wallet_path(mail_wallet, sizeof(mail_wallet))
        != RESULT_SUCCESS) {
        task_fail(a->task_id, "No Mail wallet configured");
        goto cleanup;
    }
    qmail_receipt_t receipt;
    result_t r = qmail_receipt_load(mail_wallet, a->file_guid, &receipt);
    if (r != RESULT_SUCCESS) {
        task_fail(a->task_id, "Receipt not found for that file_guid");
        goto cleanup;
    }

    if (receipt.tell_recipient_count == 0) {
        api_qmail_mark_tell_failed(a->file_guid,
                                   "Receipt has no recipients for Tell");
        task_fail(a->task_id,
                  "Receipt has no recipients — supply to/cc/bcc on /upload");
        goto cleanup;
    }

    /* 2. Rehydrate sender identity. The receipt has SN/denom; we re-read
     *    the per-RAIDA ANs from the Mail wallet because they are NOT
     *    serialized in the receipt (Finding 3 of Phase 2 review). */
    int8_t  denom = receipt.sender_denomination;
    uint8_t sender_ans[RAIDA_COUNT][AN_LENGTH];
    if (rehydrate_sender_ans(mail_wallet, receipt.sender_serial_number,
                              &denom, sender_ans) != RESULT_SUCCESS) {
        api_qmail_mark_tell_failed(a->file_guid,
                                   "Sender identity coin not found in Mail wallet");
        task_fail(a->task_id, "Sender identity coin not found in Mail wallet");
        goto cleanup;
    }

    /* 3. Rehydrate the encryption key. encryption_key_select with
     *    exclude_sn = sender_sn picks ANY available key that is NOT the
     *    sender identity coin (privacy-preserving — same policy as the
     *    orchestrator's qmail_setup_encryption). */
    raida_encryption_key_t enc_key;
    encryption_key_init(&enc_key);
    result_t er = encryption_key_select(a->wallet_path, receipt.sender_serial_number,
                                         &enc_key);
    if (er != RESULT_SUCCESS || !enc_key.valid)
        er = encryption_key_select_any_wallet(receipt.sender_serial_number, &enc_key);
    if (er != RESULT_SUCCESS || !enc_key.valid)
        er = encryption_key_select_any_wallet(0, &enc_key);
    if (er != RESULT_SUCCESS || !enc_key.valid) {
        api_qmail_mark_tell_failed(a->file_guid,
                                   "No encryption key available for tell");
        task_fail(a->task_id, "No encryption key available for tell");
        goto cleanup;
    }

    /* 4. Rebuild qmail_upload_artifacts_t from the receipt. The artifacts
     *    struct is NOT a real upload's pool acquisition — it's a synthetic
     *    one whose pool_acq holds the receipt-saved inbox-fee key. */
    qmail_upload_artifacts_t art;
    memset(&art, 0, sizeof(art));
    memcpy(art.file_guid, receipt.file_guid, QMAIL_GUID_SIZE);
    art.sender_denomination  = denom;
    art.sender_serial_number = receipt.sender_serial_number;
    memcpy(art.sender_ans, sender_ans, sizeof(sender_ans));
    art.device_id            = 1;
    art.total_group_size     = receipt.upload_total_group_size;
    art.file_count           = receipt.upload_file_count;
    art.upload_successes     = receipt.upload_servers_ok;
    art.upload_failures      = receipt.upload_servers_fail;
    memcpy(&art.enc_key, &enc_key, sizeof(art.enc_key));

    if ((receipt.upload_manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 ||
         receipt.upload_manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) &&
        receipt.upload_manifest_file_count > 0 &&
        ((receipt.upload_manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 &&
          receipt.upload_manifest_entry_size ==
              QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE) ||
         (receipt.upload_manifest_version == QMAIL_TELL_MANIFEST_VERSION_2 &&
          receipt.upload_manifest_entry_size ==
              QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE)) &&
        receipt.upload_manifest_len <= QMAIL_TELL_MANIFEST_MAX_LEN) {
        art.file_count       = receipt.upload_manifest_file_count;
        uint64_t body_len    = 0;
        if (receipt.upload_manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
            for (int i = 0; i < receipt.upload_manifest_file_count
                            && i < QMAIL_TELL_MANIFEST_MAX_FILES; i++) {
                qmail_ot_manifest_v2_entry_t me;
                if (qmail_ot_parse_manifest_v2_entry(
                        receipt.upload_manifest_bytes +
                            (size_t)i * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE,
                        &me) == RESULT_SUCCESS &&
                    (me.file_type == QMAIL_FILE_BODY ||
                     (me.file_flags & QMAIL_FILE_MANIFEST_FLAG_BODY))) {
                    body_len = me.original_size;
                    break;
                }
            }
        } else {
            for (int i = 0; i < receipt.upload_manifest_file_count
                            && i < QMAIL_TELL_MANIFEST_MAX_FILES; i++) {
                const qmail_file_manifest_entry_t *me =
                    &receipt.upload_manifest_files[i];
                if (me->file_type == QMAIL_FILE_BODY ||
                    (me->file_flags & QMAIL_FILE_MANIFEST_FLAG_BODY)) {
                    body_len = utils_read_u64_be(me->original_size);
                    break;
                }
            }
        }
        if (body_len == 0) {
            if (receipt.upload_manifest_version ==
                QMAIL_TELL_MANIFEST_VERSION_2) {
                qmail_ot_manifest_v2_entry_t me;
                if (qmail_ot_parse_manifest_v2_entry(
                        receipt.upload_manifest_bytes, &me) == RESULT_SUCCESS) {
                    body_len = me.original_size;
                }
            } else {
                body_len = utils_read_u64_be(
                    receipt.upload_manifest_files[0].original_size);
            }
        }
        art.body_size        = body_len <= UINT32_MAX
                             ? (uint32_t)body_len
                             : 0;
        art.manifest_version = receipt.upload_manifest_version;
        art.file_entry_size  = receipt.upload_manifest_entry_size;
        art.manifest_len     = receipt.upload_manifest_len;
        art.manifest_flags   = receipt.upload_manifest_flags;
        if (art.manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
            memcpy(art.manifest_bytes, receipt.upload_manifest_bytes,
                   art.manifest_len);
        } else {
            memcpy(art.manifest_files, receipt.upload_manifest_files,
                   art.manifest_len);
        }
    } else if (receipt.upload_file_count > 0) {
        art.file_count       = receipt.upload_file_count;
        uint64_t body_len    = 0;
        for (int i = 0; i < receipt.upload_file_count
                        && i < QMAIL_RECEIPT_MAX_FILES; i++) {
            const qmail_receipt_file_t *fe = &receipt.upload_files[i];
            if (fe->file_type == QMAIL_FILE_BODY ||
                strcmp(fe->role, "body") == 0) {
                body_len = fe->size_bytes;
                break;
            }
        }
        if (body_len == 0) body_len = receipt.upload_files[0].size_bytes;
        art.body_size        = (body_len > 0 && body_len <= UINT32_MAX)
                             ? (uint32_t)body_len
                             : 0;
        art.manifest_version = QMAIL_TELL_MANIFEST_VERSION_1;
        art.file_entry_size  = QMAIL_TELL_MANIFEST_ENTRY_SIZE;
        art.manifest_len     = (uint16_t)(art.file_count *
                                          QMAIL_TELL_MANIFEST_ENTRY_SIZE);
        art.manifest_flags   = QMAIL_TELL_MANIFEST_FLAG_FOOTER_REMOVED;
        for (int i = 0; i < art.file_count && i < QMAIL_TELL_MANIFEST_MAX_FILES; i++) {
            const qmail_receipt_file_t *fe = &receipt.upload_files[i];
            uint8_t file_type = 0;
            if (strcmp(fe->role, "meta") == 0) {
                file_type = QMAIL_FILE_META;
            } else if (strcmp(fe->role, "body") == 0) {
                file_type = QMAIL_FILE_BODY;
            } else if (fe->file_type == QMAIL_FILE_BODY ||
                       fe->file_type >= QMAIL_FILE_ATTACHMENT_1) {
                file_type = (uint8_t)fe->file_type;
            } else {
                file_type = (uint8_t)((i == 0)
                                    ? QMAIL_FILE_BODY
                                    : (QMAIL_FILE_ATTACHMENT_1 + (i - 1)));
            }
            api_fill_manifest_entry(&art.manifest_files[i], file_type,
                                    fe->size_bytes, 0);
        }
    }

    /* Server map + per-server lockers from the receipt's upload.files[0].stripes[]. */
    int srvs = 0;
    if (receipt.upload_file_count > 0) {
        const qmail_receipt_file_t *fe0 = &receipt.upload_files[0];
        for (int i = 0; i < fe0->stripe_count && srvs < QMAIL_MAX_SERVERS; i++) {
            const qmail_receipt_stripe_t *s = &fe0->stripes[i];
            if (!s->ok) continue;

            qmail_server_location_t *loc = &art.server_locs[srvs];
            uint8_t *raw = loc->raw_entry;
            memset(raw, 0, 32);
            raw[0] = (uint8_t)s->stripe_index;
            raw[1] = s->is_parity ? 1 : 0;
            raw[2] = (uint8_t)s->server_id;
            if (s->server_id >= 0 && s->server_id < RAIDA_COUNT) {
                const rest_raida_server_t *srv = &g_config.servers[s->server_id];
                unsigned int A,B,C,D;
                if (sscanf(srv->ip_address, "%u.%u.%u.%u", &A,&B,&C,&D) == 4) {
                    raw[20] = 0xFF; raw[21] = 0xFF;
                    raw[22] = (uint8_t)A; raw[23] = (uint8_t)B;
                    raw[24] = (uint8_t)C; raw[25] = (uint8_t)D;
                }
                raw[26] = (uint8_t)(srv->port >> 8);
                raw[27] = (uint8_t)(srv->port & 0xFF);
            }
            loc->stripe_index = (uint8_t)s->stripe_index;
            loc->server_id    = (uint8_t)s->server_id;

            /* Per-server upload locker — rebuild the 16-byte form by
             * copying the receipt's saved key string (zero-padded). */
            memset(art.per_server_lockers[srvs], 0, 16);
            size_t klen = strlen(s->locker_code);
            if (klen > 16) klen = 16;
            memcpy(art.per_server_lockers[srvs], s->locker_code, klen);

            srvs++;
        }
    }
    art.valid_server_count = srvs;

    if (srvs < 1) {
        api_qmail_mark_tell_failed(a->file_guid,
                                   "Receipt has no usable server locations");
        task_fail(a->task_id, "Receipt has no usable server locations");
        goto cleanup;
    }

    /* Inbox-fee locker — populated only if /upload acquired one. The
     * pool_acq.inbox_fee_key is the same string we stored in the
     * receipt. */
    if (receipt.upload_inbox_fee_acquired
        && receipt.upload_inbox_fee_locker[0]) {
        strncpy(art.pool_acq.inbox_fee_key,
                receipt.upload_inbox_fee_locker,
                sizeof(art.pool_acq.inbox_fee_key) - 1);
        art.pool_acq.inbox_fee_acquired = true;
        art.inbox_fee_acquired = true;
        size_t flen = strlen(receipt.upload_inbox_fee_locker);
        if (flen > 16) flen = 16;
        memcpy(art.inbox_fee_locker, receipt.upload_inbox_fee_locker, flen);
    }
    /* upload_keys[] is left empty in pool_acq because /tell does NOT
     * touch storage lockers — those were already confirmed at /upload
     * time. The split-commit primitives only act on the inbox-fee key. */
    art.pool_acq.upload_count = 0;

    /* 5. Build the recipient list for qmail_send_tells from the receipt's
     *    seeded tell.recipients[]. */
    recipient_with_beacon_t parsed[QMAIL_MAX_RECIPIENTS];
    int n = 0;
    for (int i = 0; i < receipt.tell_recipient_count
                    && n < QMAIL_MAX_RECIPIENTS; i++) {
        const qmail_receipt_recipient_t *rc = &receipt.tell_recipients[i];
        if (rc->status == QMAIL_RCPT_STATUS_SENT) continue;
        parsed[n].entry.serial_number = rc->serial_number;
        parsed[n].entry.denomination  = rc->denomination;
        if      (strcmp(rc->kind, "cc")  == 0) parsed[n].entry.recipient_type = QMAIL_RECIPIENT_CC;
        else if (strcmp(rc->kind, "bcc") == 0) parsed[n].entry.recipient_type = QMAIL_RECIPIENT_BC;
        else                                    parsed[n].entry.recipient_type = QMAIL_RECIPIENT_TO;
        parsed[n].beacon_raida = (uint8_t)rc->beacon_raida;
        parsed[n].secondary_beacon_raida = QMAIL_SECONDARY_BEACON_RAIDA_ID;
        /* Carry the address from the receipt so a downstream record_send
         * stub-insert has a non-NULL auto_address. */
        strncpy(parsed[n].auto_address, rc->address,
                sizeof(parsed[n].auto_address) - 1);
        parsed[n].auto_address[sizeof(parsed[n].auto_address) - 1] = '\0';
        n++;
    }
    if (n == 0) {
        char data_json[128];
        snprintf(data_json, sizeof(data_json),
                 "{\"file_guid\":\"%s\",\"beacons\":0,\"tell_successes\":0,"
                 "\"tell_failures\":0,\"all_accepted\":true}",
                 guid_hex);
        task_complete_with_data(a->task_id,
                                "Tell skipped: all recipients already sent",
                                data_json);
        goto cleanup;
    }

    qmail_send_tells_options_t opts;
    memset(&opts, 0, sizeof(opts));
    opts.artifacts       = &art;
    opts.recipients      = parsed;
    opts.recipient_count = n;
    opts.subject         = receipt.subject[0]      ? receipt.subject      : NULL;
    opts.body_preview    = receipt.body_preview[0] ? receipt.body_preview : NULL;
    opts.wallet_path     = a->wallet_path;
    opts.task_id         = a->task_id;

    qmail_send_tells_result_t out;
    result_t tr = qmail_send_tells(&opts, transport, &out);
    if (tr != RESULT_SUCCESS) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Tell failed: %s — %s",
                 result_to_string(tr),
                 out.error_message[0] ? out.error_message : "unknown error");
        api_qmail_mark_tell_failed(a->file_guid, msg);
        task_fail(a->task_id, msg);
        goto cleanup;
    }

    char data_json[512];
    snprintf(data_json, sizeof(data_json),
             "{\"file_guid\":\"%s\",\"beacons\":%d,\"tell_successes\":%d,"
             "\"tell_failures\":%d,\"all_accepted\":%s}",
             guid_hex, out.beacon_count, out.tell_successes, out.tell_failures,
             out.all_accepted ? "true" : "false");
    task_complete_with_data(a->task_id,
                            out.all_accepted
                              ? "Tell complete: all beacons accepted"
                              : "Tell complete: some beacons failed (queued for retry)",
                            data_json);

cleanup:
    free(a);
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

void api_handle_qmail_tell(http_request_t *request, http_response_t *response,
                           void *user_data) {
    (void)user_data;

    char rid[API_QMAIL_RID_LEN];
    api_qmail_generate_rid(rid);
    uint64_t t_start = platform_time_ms();

    /* 1. Mail wallet must exist. */
    char mail_wallet[MAX_PATH_LEN];
    if (qmail_receipt_get_mail_wallet_path(mail_wallet, sizeof(mail_wallet))
        != RESULT_SUCCESS) {
        log_error(LOG_CAT_COMMAND, "TELL rid=%s exit: no Mail wallet", rid);
        api_qmail_error_response_with_rid(response,
            "No Mail wallet configured (required for receipts)", 500, rid);
        return;
    }

    /* 2. file_guid required. */
    uint8_t file_guid[QMAIL_GUID_SIZE];
    if (!api_qmail_require_guid_param_with_rid(request, response, "file_guid",
            "Missing required parameter: file_guid",
            "Invalid file_guid format (expected 32 hex chars)",
            file_guid, rid)) {
        log_warn(LOG_CAT_COMMAND, "TELL rid=%s exit: missing/invalid file_guid", rid);
        return;
    }

    const char *guid_hex_dbg = http_request_get_param(request, "file_guid");
    log_info(LOG_CAT_COMMAND, "TELL rid=%s entry: file_guid=%s",
             rid, guid_hex_dbg ? guid_hex_dbg : "(null)");

    /* 3. Q25(a): reject override — no to/cc/bcc on /tell in v1. The
     *    receipt's tell.recipients[] (seeded by /upload) is the source. */
    if (http_request_get_param(request, "to")
        || http_request_get_param(request, "cc")
        || http_request_get_param(request, "bcc")) {
        log_warn(LOG_CAT_COMMAND, "TELL rid=%s exit: recipient override rejected", rid);
        api_qmail_error_response_with_rid(response,
            "Recipient overrides are not allowed; recipients come from the receipt",
            409, rid);
        return;
    }

    /* 4. Wallet path + transport prologue (transport just for sanity check). */
    char wallet_path[MAX_PATH_LEN];
    core_transport_t *transport = NULL;
    if (api_qmail_begin_request_with_rid(request, response, wallet_path, sizeof(wallet_path),
                                 &transport, "Invalid wallet_path", 400,
                                 "Transport not initialized", rid) != RESULT_SUCCESS) {
        log_warn(LOG_CAT_COMMAND, "TELL rid=%s exit: wallet/transport prologue", rid);
        return;
    }

    /* 5. Claim the receipt synchronously before the async worker starts.
     *    This makes duplicate /tell calls deterministic: a second request
     *    sees in_progress and gets 409, while failed/partial receipts can be
     *    retried for the recipients that are not already sent. */
    log_debug(LOG_CAT_COMMAND, "TELL rid=%s call: api_qmail_claim_tell_receipt", rid);
    qmail_receipt_t receipt;
    int target_count = 0;
    char claim_message[256];
    int claim_http = 500;
    result_t claim_r = api_qmail_claim_tell_receipt(mail_wallet, file_guid,
                                                     &receipt, &target_count,
                                                     claim_message,
                                                     sizeof(claim_message),
                                                     &claim_http);
    if (claim_r == RESULT_NOT_FOUND) {
        log_warn(LOG_CAT_COMMAND, "TELL rid=%s exit: receipt not found", rid);
        api_qmail_error_response_with_rid(response,
            "Receipt not found for that file_guid", 404, rid);
        return;
    }
    if (claim_r != RESULT_SUCCESS) {
        log_warn(LOG_CAT_COMMAND, "TELL rid=%s exit: claim rejected http=%d (%s)",
                 rid, claim_http, claim_message[0] ? claim_message : "no detail");
        api_qmail_error_response_with_rid(response,
            claim_message[0] ? claim_message : "Tell could not be started",
            claim_http, rid);
        return;
    }

    /* 6. Spawn worker. */
    tell_args_t *a = (tell_args_t *)calloc(1, sizeof(*a));
    if (!a) {
        log_error(LOG_CAT_COMMAND, "TELL rid=%s exit: alloc failed (rolling back claim)", rid);
        api_qmail_mark_tell_failed(file_guid, "Memory allocation failed");
        api_qmail_error_response_with_rid(response, "Memory allocation failed", 500, rid);
        return;
    }
    strncpy(a->wallet_path, wallet_path, sizeof(a->wallet_path) - 1);
    memcpy(a->file_guid, file_guid, QMAIL_GUID_SIZE);

    char task_id[64];
    rest_task_generate_id(task_id, sizeof(task_id));
    task_create(task_id, "QMail tell task created");
    strncpy(a->task_id, task_id, sizeof(a->task_id) - 1);

    log_debug(LOG_CAT_COMMAND, "TELL rid=%s call: spawn tell_thread_func task=%s targets=%d",
              rid, task_id, target_count);
#ifdef _WIN32
    HANDLE thread = (HANDLE)_beginthreadex(NULL, 0, tell_thread_func, a, 0, NULL);
    if (!thread) {
        log_error(LOG_CAT_COMMAND,
                  "TELL rid=%s exit: thread create failed (rolling back claim)", rid);
        task_fail(task_id, "Failed to create tell thread");
        api_qmail_mark_tell_failed(file_guid, "Failed to create tell thread");
        free(a);
        api_qmail_error_response_with_rid(response,
            "Failed to start tell thread", 500, rid);
        return;
    }
    CloseHandle(thread);
#else
    pthread_t tid;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    if (pthread_create(&tid, &attr, tell_thread_func, a) != 0) {
        pthread_attr_destroy(&attr);
        log_error(LOG_CAT_COMMAND,
                  "TELL rid=%s exit: pthread_create failed (rolling back claim)", rid);
        task_fail(task_id, "Failed to create tell thread");
        api_qmail_mark_tell_failed(file_guid, "Failed to create tell thread");
        free(a);
        api_qmail_error_response_with_rid(response,
            "Failed to start tell thread", 500, rid);
        return;
    }
    pthread_attr_destroy(&attr);
#endif

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    api_qmail_guid_to_hex(file_guid, guid_hex);

    json_builder_t jb;
    json_success_response(&jb, "qmail-tell");
    api_qmail_add_request_id(&jb, rid);
    json_add_task_poll_fields(&jb, task_id);
    json_add_string(&jb, "file_guid", guid_hex);
    json_add_int(&jb, "recipient_count", target_count);
    json_add_int(&jb, "receipt_recipient_count", receipt.tell_recipient_count);
    json_add_string(&jb, "message",
                    "Tell started — poll /api/system/tasks for status, "
                    "or GET /api/qmail/receipts?guid=... for receipt detail");
    json_object_end(&jb);
    http_response_set_json(response, &jb);

    log_info(LOG_CAT_COMMAND,
             "TELL rid=%s result: task=%s targets=%d total_rcpts=%d elapsed=%llums",
             rid, task_id, target_count, receipt.tell_recipient_count,
             (unsigned long long)(platform_time_ms() - t_start));
}

// ============================================================================
// /api/qmail/net/messages/upload_and_tell — convenience compose, async
// ============================================================================
//
// Replaces the legacy /send. Accepts the same inputs as /upload PLUS
// requires at least one of to/cc/bcc — the recipient list is mandatory
// here because the whole point is to also send a Tell. Internally runs
// qmail_upload_files() then qmail_send_tells() back-to-back (one task,
// one task_id, the GUI sees both phases progress).
//
// Encryption + identity work like /upload (resolved at handler time).
// Pool semantics use the split-commit primitives directly: storage
// confirmed at upload, inbox-fee confirmed at tell. Same external
// behavior as the legacy orchestrator's compose.

typedef struct {
    upload_args_t  upload;        /* reused — same input shape */
    char            subject[QMAIL_MAX_SUBJECT_LEN];
} upload_and_tell_args_t;

#ifdef _WIN32
static unsigned __stdcall upload_and_tell_thread_func(void *arg) {
#else
static void *upload_and_tell_thread_func(void *arg) {
#endif
    upload_and_tell_args_t *aa = (upload_and_tell_args_t *)arg;
    upload_args_t *a = &aa->upload;

    log_info(LOG_CAT_COMMAND,
             "QMail upload_and_tell thread: task=%s cbdf=%zu bytes",
             a->task_id, a->email_data_len);

    core_transport_t *transport = (core_transport_t *)transport_get_default();
    if (!transport) {
        task_fail(a->task_id, "Transport not initialized");
        goto cleanup;
    }

    /* Phase 1: upload */
    qmail_upload_files_options_t upopts;
    memset(&upopts, 0, sizeof(upopts));
    upopts.wallet_path     = a->wallet_path;
    upopts.email_file      = a->email_file[0] ? a->email_file : NULL;
    upopts.email_data      = a->email_data;
    upopts.email_data_len  = a->email_data_len;
    upopts.attachments     = a->attachments[0] ? a->attachments : NULL;
    upopts.file_guid       = a->has_file_guid ? a->file_guid : NULL;
    upopts.duration_weeks  = a->duration_weeks;
    upopts.task_id         = a->task_id;
    upopts.to              = a->to [0] ? a->to  : NULL;
    upopts.cc              = a->cc [0] ? a->cc  : NULL;
    upopts.bcc             = a->bcc[0] ? a->bcc : NULL;

    qmail_upload_artifacts_t art;
    result_t r = qmail_upload_files(&upopts, transport, &art);
    if (r != RESULT_SUCCESS) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Upload phase failed: %s — %s",
                 result_to_string(r),
                 art.error_message[0] ? art.error_message : "unknown error");
        task_fail(a->task_id, msg);
        goto cleanup;
    }

    /* Phase 2: tell. Recipients come from the same to/cc/bcc strings the
     * upload used (qmail_send_tells parses them itself when no pre-parsed
     * array is supplied). */
    qmail_send_tells_options_t tlopts;
    memset(&tlopts, 0, sizeof(tlopts));
    tlopts.artifacts    = &art;
    tlopts.to           = a->to [0] ? a->to  : NULL;
    tlopts.cc           = a->cc [0] ? a->cc  : NULL;
    tlopts.bcc          = a->bcc[0] ? a->bcc : NULL;
    tlopts.subject      = aa->subject[0]      ? aa->subject       : NULL;
    tlopts.body_preview = a->body_preview[0]  ? a->body_preview   : NULL;
    tlopts.wallet_path  = a->wallet_path;
    tlopts.task_id      = a->task_id;

    qmail_send_tells_result_t tlout;
    result_t tr = qmail_send_tells(&tlopts, transport, &tlout);
    if (tr != RESULT_SUCCESS) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Tell phase failed: %s — %s",
                 result_to_string(tr),
                 tlout.error_message[0] ? tlout.error_message : "unknown error");
        task_fail(a->task_id, msg);
        goto cleanup;
    }

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    api_qmail_guid_to_hex(art.file_guid, guid_hex);

    char data_json[512];
    snprintf(data_json, sizeof(data_json),
             "{\"file_guid\":\"%s\",\"upload_successes\":%d,"
             "\"upload_failures\":%d,\"beacons\":%d,\"tell_successes\":%d,"
             "\"tell_failures\":%d,\"all_accepted\":%s}",
             guid_hex, art.upload_successes, art.upload_failures,
             tlout.beacon_count, tlout.tell_successes, tlout.tell_failures,
             tlout.all_accepted ? "true" : "false");
    task_complete_with_data(a->task_id,
                            tlout.all_accepted
                              ? "Upload + Tell complete: all beacons accepted"
                              : "Upload + Tell complete: some beacons failed (queued for retry)",
                            data_json);

cleanup:
    free(a->email_data);
    free(aa);
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

void api_handle_qmail_upload_and_tell(http_request_t *request,
                                       http_response_t *response,
                                       void *user_data) {
    (void)user_data;

    char rid[API_QMAIL_RID_LEN];
    api_qmail_generate_rid(rid);
    uint64_t t_start = platform_time_ms();

    /* 1. Mail wallet must exist. */
    char mail_wallet[MAX_PATH_LEN];
    if (qmail_receipt_get_mail_wallet_path(mail_wallet, sizeof(mail_wallet))
        != RESULT_SUCCESS) {
        log_error(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: no Mail wallet", rid);
        api_qmail_error_response_with_rid(response,
            "No Mail wallet configured (required for receipts)", 500, rid);
        return;
    }

    /* 2. Body source — same rules as /upload. */
    const char *body                  = http_request_get_param(request, "body");
    const char *plain_text_qmail_path = http_request_get_param(request, "plain_text_qmail_path");
    const char *email_file            = http_request_get_param(request, "email_file");
    int n_sources = (body ? 1 : 0) + (plain_text_qmail_path ? 1 : 0) + (email_file ? 1 : 0);
    if (n_sources == 0) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: missing body source", rid);
        api_qmail_error_response_with_rid(response,
            "Missing body source: supply one of body, plain_text_qmail_path, or email_file",
            400, rid);
        return;
    }
    if (n_sources > 1) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: %d body sources",
                 rid, n_sources);
        api_qmail_error_response_with_rid(response,
            "body, plain_text_qmail_path and email_file are mutually exclusive",
            400, rid);
        return;
    }

    log_info(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s entry: source=%s",
             rid, body ? "body" : (plain_text_qmail_path ? "plain_text_qmail_path" : "email_file"));

    /* 3. Optional file_guid — same rules as /upload. */
    const char *file_guid_hex = http_request_get_param(request, "file_guid");
    uint8_t suggested_guid[QMAIL_GUID_SIZE];
    bool have_guid = false;
    if (file_guid_hex && file_guid_hex[0]) {
        if (!api_qmail_hex_to_guid(file_guid_hex, suggested_guid)) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: invalid file_guid", rid);
            api_qmail_error_response_with_rid(response,
                "Invalid file_guid format (expected 32 hex chars)", 400, rid);
            return;
        }
        if (qmail_receipt_exists(mail_wallet, suggested_guid)) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: file_guid conflict", rid);
            api_qmail_error_response_with_rid(response,
                "A receipt already exists for that file_guid", 409, rid);
            return;
        }
        have_guid = true;
    }

    /* 4. Recipients — REQUIRED here (this is the whole point of /upload_and_tell). */
    upload_and_tell_args_t *aa =
        (upload_and_tell_args_t *)calloc(1, sizeof(*aa));
    if (!aa) {
        log_error(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: alloc failed", rid);
        api_qmail_error_response_with_rid(response, "Memory allocation failed", 500, rid);
        return;
    }
    upload_args_t *a = &aa->upload;

    result_t rcp;
    rcp = api_qmail_collect_recipient_param(request, "to",  a->to,  sizeof(a->to));
    if (rcp != RESULT_SUCCESS && rcp != RESULT_NOT_FOUND) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: to list too long", rid);
        api_qmail_error_response_with_rid(response, "Recipient list too long", 400, rid);
        free(aa);
        return;
    }
    rcp = api_qmail_collect_recipient_param(request, "cc",  a->cc,  sizeof(a->cc));
    if (rcp != RESULT_SUCCESS && rcp != RESULT_NOT_FOUND) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: cc list too long", rid);
        api_qmail_error_response_with_rid(response, "CC list too long", 400, rid);
        free(aa);
        return;
    }
    rcp = api_qmail_collect_recipient_param(request, "bcc", a->bcc, sizeof(a->bcc));
    if (rcp != RESULT_SUCCESS && rcp != RESULT_NOT_FOUND) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: bcc list too long", rid);
        api_qmail_error_response_with_rid(response, "BCC list too long", 400, rid);
        free(aa);
        return;
    }
    if (!a->to[0] && !a->cc[0] && !a->bcc[0]) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: no recipients", rid);
        api_qmail_error_response_with_rid(response,
            "At least one recipient required (to/cc/bcc)", 400, rid);
        free(aa);
        return;
    }

    /* 4b. Validate every recipient address synchronously so bad input
     * (missing '@', garbage, unknown words, wrong TLD) fails fast with a
     * specific 400 instead of the late generic "No recipients resolved". */
    {
        char addr_err[256];
        if (!api_qmail_validate_recipient_list(a->to,  "To",  addr_err, sizeof(addr_err)) ||
            !api_qmail_validate_recipient_list(a->cc,  "Cc",  addr_err, sizeof(addr_err)) ||
            !api_qmail_validate_recipient_list(a->bcc, "Bcc", addr_err, sizeof(addr_err))) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: %s", rid, addr_err);
            api_qmail_error_response_with_rid(response, addr_err, 400, rid);
            free(aa);
            return;
        }
    }

    /* 5. Wallet path + transport prologue. */
    char wallet_path[MAX_PATH_LEN];
    core_transport_t *transport = NULL;
    if (api_qmail_begin_request_with_rid(request, response, wallet_path, sizeof(wallet_path),
                                 &transport, "Invalid wallet_path", 400,
                                 "Transport not initialized", rid) != RESULT_SUCCESS) {
        log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: wallet/transport prologue", rid);
        free(aa);
        return;
    }
    strncpy(a->wallet_path, wallet_path, sizeof(a->wallet_path) - 1);

    const char *subject = http_request_get_param(request, "subject");
    if (subject) {
        strncpy(aa->subject, subject, sizeof(aa->subject) - 1);
        strncpy(a->subject, subject, sizeof(a->subject) - 1);
    }

    a->duration_weeks = http_param_int_clamped(request, "duration", 4, 1, 520);

    /* 6. Resolve attachments. Same as /upload. */
    {
        char att_err[512] = {0};
        result_t att_res =
            qmail_upload_args_resolve_attachments(request, a,
                                                  att_err, sizeof(att_err));
        if (att_res != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: %s", rid,
                     att_err[0] ? att_err : "Invalid attachment list");
            api_qmail_error_response_with_rid(response,
                att_err[0] ? att_err : "Invalid attachment list", 400, rid);
            free(aa);
            return;
        }
    }

    /* 7. Build the body - same logic as /upload. */
    uint8_t *cbdf_data = NULL;
    size_t   cbdf_len  = 0;

    if (email_file) {
        FILE *f = fopen(email_file, "rb");
        if (!f) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: email_file not readable", rid);
            api_qmail_error_response_with_rid(response,
                "email_file not found or not readable", 400, rid);
            free(aa);
            return;
        }
        fclose(f);
        if (qmail_upload_args_has_paged_attachment(a)) {
            log_warn(LOG_CAT_COMMAND,
                     "UPLOAD_TELL rid=%s exit: email_file mode with paged attachment",
                     rid);
            api_qmail_error_response_with_rid(response,
                "email_file mode cannot add paging metadata for large attachments; use body or plain_text_qmail_path",
                400, rid);
            free(aa);
            return;
        }
        strncpy(a->email_file, email_file, sizeof(a->email_file) - 1);
    } else {
        char *body_buf = NULL;
        size_t body_len = 0;
        bool body_owned = false;

        if (body) {
            body_len = strlen(body);
            body_buf = (char *)body;
        } else {
            FILE *f = fopen(plain_text_qmail_path, "rb");
            if (!f) {
                log_warn(LOG_CAT_COMMAND,
                         "UPLOAD_TELL rid=%s exit: plain_text_qmail_path not readable", rid);
                api_qmail_error_response_with_rid(response,
                    "plain_text_qmail_path not found or not readable", 400, rid);
                free(aa);
                return;
            }
            fseek(f, 0, SEEK_END);
            long size = ftell(f);
            fseek(f, 0, SEEK_SET);
            if (size <= 0 || size > QMAIL_CBDF_BODY_MAX_BYTES) {
                fclose(f);
                log_warn(LOG_CAT_COMMAND,
                         "UPLOAD_TELL rid=%s exit: plain_text_qmail_path size=%ld invalid",
                         rid, size);
                api_qmail_error_response_with_rid(response,
                    "plain_text_qmail_path is empty or too large (max 512 KB)", 400, rid);
                free(aa);
                return;
            }
            body_buf = (char *)malloc((size_t)size + 1);
            if (!body_buf) {
                fclose(f);
                log_error(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: body alloc failed", rid);
                api_qmail_error_response_with_rid(response,
                    "Memory allocation failed", 500, rid);
                free(aa);
                return;
            }
            size_t got = fread(body_buf, 1, (size_t)size, f);
            fclose(f);
            if (got != (size_t)size) {
                free(body_buf);
                log_error(LOG_CAT_COMMAND,
                          "UPLOAD_TELL rid=%s exit: short read on plain_text_qmail_path", rid);
                api_qmail_error_response_with_rid(response,
                    "Failed to read plain_text_qmail_path", 500, rid);
                free(aa);
                return;
            }
            body_buf[size] = '\0';
            body_len = (size_t)size;
            body_owned = true;
        }

        raida_encryption_key_t enc_key;
        if (api_qmail_select_enc_key_with_rid(wallet_path, 0, response, &enc_key,
                                     "No encryption key available (empty wallet?)", rid)
            != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: no encryption key", rid);
            if (body_owned) free(body_buf);
            free(aa);
            return;
        }

        recipient_with_beacon_t recipients_ext[QMAIL_MAX_RECIPIENTS];
        int to_count = 0, cc_count = 0;
        if (a->to[0])
            to_count = qmail_parse_recipients(a->to, QMAIL_RECIPIENT_TO,
                                              recipients_ext, QMAIL_MAX_RECIPIENTS);
        if (a->cc[0])
            cc_count = qmail_parse_recipients(a->cc, QMAIL_RECIPIENT_CC,
                                              &recipients_ext[to_count],
                                              QMAIL_MAX_RECIPIENTS - to_count);
        qmail_recipient_entry_t to_entries[QMAIL_MAX_RECIPIENTS];
        qmail_recipient_entry_t cc_entries[QMAIL_MAX_RECIPIENTS];
        for (int i = 0; i < to_count; i++) to_entries[i] = recipients_ext[i].entry;
        for (int i = 0; i < cc_count; i++) cc_entries[i] = recipients_ext[to_count + i].entry;

        uint8_t file_guid[QMAIL_GUID_SIZE];
        if (have_guid) memcpy(file_guid, suggested_guid, QMAIL_GUID_SIZE);
        else           qmail_crypto_generate_guid(file_guid);
        memcpy(a->file_guid, file_guid, QMAIL_GUID_SIZE);
        a->has_file_guid = true;

        size_t pv = body_len < sizeof(a->body_preview) - 1
                    ? body_len : sizeof(a->body_preview) - 1;
        memcpy(a->body_preview, body_buf, pv);
        a->body_preview[pv] = '\0';

        /* See the UPLOAD path above for why CBDF From must come from the
         * Mail identity snapshot rather than enc_key. */
        qmail_identity_t from_identity;
        qmail_identity_snapshot(&from_identity);

        const char *attachment_name_ptrs[QMAIL_CBDF_MAX_ATTACHMENT_NAMES];
        int attachment_name_count =
            qmail_upload_args_attachment_name_ptrs(a, attachment_name_ptrs,
                                                   QMAIL_CBDF_MAX_ATTACHMENT_NAMES);

        qmail_cbdf_params_t p;
        memset(&p, 0, sizeof(p));
        p.file_guid           = file_guid;
        p.subject             = subject;
        p.body                = body_buf;
        p.meta_file_type_set   = true;
        p.meta_file_type       = QMAIL_CBDF_META_TYPE_QMAIL;
        p.attachment_count      = a->attachment_count;
        p.attachment_names      = attachment_name_ptrs;
        p.attachment_name_count = attachment_name_count;
        p.attachment_is_paged   = a->attachment_is_paged;
        p.attachment_total_pages = a->attachment_total_pages;
        p.attachment_page_info_count = a->attachment_count;
        if (from_identity.valid) {
            p.from_denomination  = from_identity.denomination;
            p.from_serial_number = from_identity.serial_number;
        } else {
            p.from_denomination  = enc_key.denomination;
            p.from_serial_number = enc_key.serial_number;
        }
        p.to_recipients       = to_entries;
        p.to_count            = to_count;
        p.cc_recipients       = cc_entries;
        p.cc_count            = cc_count;

        log_debug(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s call: qmail_cbdf_encode", rid);
        result_t cr = qmail_cbdf_encode(&p, &cbdf_data, &cbdf_len);
        if (body_owned) free(body_buf);

        if (cr != RESULT_SUCCESS) {
            log_error(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: CBDF encode failed (%s)",
                      rid, result_to_string(cr));
            api_qmail_error_response_with_rid(response,
                "CBDF encoding failed", 500, rid);
            free(aa);
            return;
        }

        if (cbdf_len > (size_t)QMAIL_CBDF_BODY_MAX_BYTES) {
            log_warn(LOG_CAT_COMMAND,
                     "UPLOAD_TELL rid=%s exit: CBDF body size=%zu exceeds max=%u",
                     rid, cbdf_len, (unsigned)QMAIL_CBDF_BODY_MAX_BYTES);
            free(cbdf_data);
            api_qmail_error_response_with_rid(response,
                "CBDF body is too large (max 512 KB)", 400, rid);
            free(aa);
            return;
        }

        log_info(LOG_CAT_COMMAND,
                 "UPLOAD_TELL rid=%s: CBDF encoded %zu bytes (%s mode)",
                 rid, cbdf_len, body ? "body" : "plain_text_qmail_path");
    }

    /* email_file mode bypasses CBDF generation, so make the GUID visible
     * in the immediate async response before the worker starts. */
    if (!a->has_file_guid) {
        if (have_guid) memcpy(a->file_guid, suggested_guid, QMAIL_GUID_SIZE);
        else           qmail_crypto_generate_guid(a->file_guid);
        a->has_file_guid = true;
    }

    /* 8. Spawn worker. */
    char task_id[64];
    rest_task_generate_id(task_id, sizeof(task_id));
    task_create(task_id, "QMail upload+tell task created");
    strncpy(a->task_id, task_id, sizeof(a->task_id) - 1);
    a->email_data     = cbdf_data;
    a->email_data_len = cbdf_len;

    log_debug(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s call: spawn upload_and_tell_thread_func task=%s",
              rid, task_id);
#ifdef _WIN32
    HANDLE thread = (HANDLE)_beginthreadex(NULL, 0,
                                           upload_and_tell_thread_func, aa, 0, NULL);
    if (!thread) {
        log_error(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: thread create failed", rid);
        task_fail(task_id, "Failed to create upload+tell thread");
        free(a->email_data);
        free(aa);
        api_qmail_error_response_with_rid(response,
            "Failed to start upload+tell thread", 500, rid);
        return;
    }
    CloseHandle(thread);
#else
    pthread_t tid;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    if (pthread_create(&tid, &attr, upload_and_tell_thread_func, aa) != 0) {
        pthread_attr_destroy(&attr);
        log_error(LOG_CAT_COMMAND, "UPLOAD_TELL rid=%s exit: pthread_create failed", rid);
        task_fail(task_id, "Failed to create upload+tell thread");
        free(a->email_data);
        free(aa);
        api_qmail_error_response_with_rid(response,
            "Failed to start upload+tell thread", 500, rid);
        return;
    }
    pthread_attr_destroy(&attr);
#endif

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    if (a->has_file_guid) api_qmail_guid_to_hex(a->file_guid, guid_hex);
    else                  guid_hex[0] = '\0';

    json_builder_t jb;
    json_success_response(&jb, "qmail-upload-and-tell");
    api_qmail_add_request_id(&jb, rid);
    json_add_task_poll_fields(&jb, task_id);
    if (guid_hex[0]) json_add_string(&jb, "file_guid", guid_hex);
    json_add_int(&jb, "duration", a->duration_weeks);
    json_add_string(&jb, "message",
                    "Upload+Tell started — poll /api/system/tasks for status, "
                    "or GET /api/qmail/receipts?guid=... for receipt detail");
    json_object_end(&jb);
    http_response_set_json(response, &jb);

    log_info(LOG_CAT_COMMAND,
             "UPLOAD_TELL rid=%s result: task=%s guid=%s duration=%d elapsed=%llums",
             rid, task_id, guid_hex[0] ? guid_hex : "(none)", a->duration_weeks,
             (unsigned long long)(platform_time_ms() - t_start));
}
