/**
 * src/qmail/qmail_upload_orchestrator.c - QMail multi-file funded upload/tell orchestrator.
 *
 * Uploads multiple files (email + attachments) via CMD 70 (UPLOAD).
 * Each file is striped (RAID-5) and uploaded to all QMail servers in parallel.
 * If recipients are provided, sends Tell (CMD 71) to beacon servers.
 */

#include "qmail/qmail_send.h"
#include "qmail/qmail_upload_files.h"
#include "qmail/qmail_send_tells.h"
#include "qmail/qmail_receipt.h"
#include "qmail/qmail_commands.h"
#include "qmail/qmail_preamble.h"
#include "qmail/qmail_servers.h"
#include "qmail/qmail_health.h"
#include "qmail/qmail_striping.h"
#include "qmail/qmail_crypto.h"
#include "qmail/qmail_db.h"
#include "qmail/qmail_contacts.h"
#include "qmail/qmail_users.h"
#include "qmail/qmail_locker_pool.h"
#include "qmail/qmail_object_transfer.h"
#include "qmail/qmail_send_object_transfer.h"
#include "encryption_key.h"
#include "executor.h"
#include "raida_status.h"
#include "coin_utils.h"
#include "transport.h"
#include "wallet.h"
#include "logging.h"
#include "results.h"
#include "utils.h"
#include "filesystem.h"
#include "task_manager.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <time.h>
#include <stdarg.h>

#ifdef _WIN32
#define strtok_r strtok_s
#define strdup _strdup
#endif

/* Max attachments: file_type 0x0A..0xFF. QMail beta also uploads
 * file_type 0x00 (private meta) and file_type 0x01 (body/content). */
#define UPLOAD_MAX_ATTACHMENTS (QMAIL_TELL_MANIFEST_MAX_FILES - 2)
#define UPLOAD_MAX_FILES (2 + UPLOAD_MAX_ATTACHMENTS) /* meta + body + attachments */
#define UPLOAD_PROTOCOL_MAX_BODY_SIZE 65535u
#define UPLOAD_PROTOCOL_CHALLENGE_SIZE 16u
#define UPLOAD_PROTOCOL_TERMINATOR_SIZE 2u
#define UPLOAD_WIRE_HEADER_SIZE 38u
#define UPLOAD_FIXED_BODY_BYTES \
    (UPLOAD_PROTOCOL_CHALLENGE_SIZE + QMAIL_PREAMBLE_SIZE + \
     UPLOAD_WIRE_HEADER_SIZE + UPLOAD_PROTOCOL_TERMINATOR_SIZE)
#define UPLOAD_MAX_STRIPE_BYTES \
    (UPLOAD_PROTOCOL_MAX_BODY_SIZE - UPLOAD_FIXED_BODY_BYTES)
#define UPLOAD_LARGE_PAGE_TIMEOUT_MS 60000u
#define UPLOAD_ESTIMATE_DATA_STRIPES 2u

// ============================================================================
// PROGRESS HELPER
// ============================================================================

/** Update async task progress if task_id is set */
static void upload_progress(const char *task_id, int percent, const char *fmt, ...) {
    if (!task_id || !task_id[0]) return;
    char msg[256];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);
    task_update_progress(task_id, percent, msg);
}

static const char *receipt_kind_from_recipient_type(uint8_t recipient_type) {
    switch (recipient_type) {
        case QMAIL_RECIPIENT_CC: return "cc";
        case QMAIL_RECIPIENT_BC: return "bcc";
        default:                 return "to";
    }
}

static bool qmail_beacon_valid(uint8_t beacon_id) {
    return beacon_id < RAIDA_COUNT;
}

static uint8_t qmail_recipient_primary_beacon(const recipient_with_beacon_t *recipient) {
    if (!recipient || !qmail_beacon_valid(recipient->beacon_raida)) {
        return QMAIL_BEACON_RAIDA_ID;
    }
    if (recipient->beacon_raida == QMAIL_SECONDARY_BEACON_RAIDA_ID &&
        recipient->secondary_beacon_raida == QMAIL_SECONDARY_BEACON_RAIDA_ID) {
        return QMAIL_BEACON_RAIDA_ID;
    }
    return recipient->beacon_raida;
}

static uint8_t qmail_recipient_secondary_beacon(const recipient_with_beacon_t *recipient) {
    if (!recipient || !qmail_beacon_valid(recipient->secondary_beacon_raida)) {
        return QMAIL_SECONDARY_BEACON_RAIDA_ID;
    }
    return recipient->secondary_beacon_raida;
}

static bool qmail_tell_status_is_invalid_recipient(uint8_t status) {
    return status == RAIDA_STATUS_COIN_NOT_FOUND ||
           status == RAIDA_STATUS_INVALID_SN_OR_DENOMINATION;
}

static bool qmail_beacon_in_list(uint8_t beacon_id,
                                 const uint8_t *beacons,
                                 int beacon_count) {
    if (!beacons || beacon_count <= 0) return false;
    for (int i = 0; i < beacon_count; i++) {
        if (beacons[i] == beacon_id) return true;
    }
    return false;
}

static bool qmail_recipient_delivered_by_fallback(
    const recipient_with_beacon_t *recipient,
    const uint8_t *accepted_fallback_beacons,
    int accepted_fallback_count) {
    if (!recipient) return false;
    return qmail_beacon_in_list(qmail_recipient_secondary_beacon(recipient),
                                accepted_fallback_beacons,
                                accepted_fallback_count);
}

static bool receipt_row_matches_recipient(const qmail_receipt_recipient_t *row,
                                          const recipient_with_beacon_t *recipient) {
    if (!row || !recipient) return false;
    return row->serial_number == recipient->entry.serial_number
        && row->beacon_raida == qmail_recipient_primary_beacon(recipient)
        && strcmp(row->kind,
                  receipt_kind_from_recipient_type(recipient->entry.recipient_type)) == 0;
}

static bool receipt_row_is_targeted(const qmail_receipt_recipient_t *row,
                                    const recipient_with_beacon_t *recipients,
                                    int recipient_count) {
    for (int i = 0; i < recipient_count; i++) {
        if (receipt_row_matches_recipient(row, &recipients[i])) return true;
    }
    return false;
}

static uint8_t upload_manifest_flags_for_file_type(uint8_t file_type) {
    if (file_type == QMAIL_FILE_META) return QMAIL_FILE_MANIFEST_FLAG_META;
    if (file_type == QMAIL_FILE_BODY) return QMAIL_FILE_MANIFEST_FLAG_BODY;
    if (file_type >= QMAIL_FILE_ATTACHMENT_1) return QMAIL_FILE_MANIFEST_FLAG_ATTACHMENT;
    return 0;
}

static bool upload_file_type_uses_large_pages(uint8_t file_type,
                                              size_t file_size) {
    return file_type >= QMAIL_FILE_ATTACHMENT_1 &&
           file_size > qmail_upload_legacy_max_file_bytes();
}

static void fill_manifest_entry(qmail_file_manifest_entry_t *entry,
                                uint8_t file_type,
                                uint64_t original_size,
                                uint32_t crc32) {
    if (!entry) return;
    memset(entry, 0, sizeof(*entry));
    entry->file_type = file_type;
    entry->file_flags = upload_manifest_flags_for_file_type(file_type);
    utils_write_u64_be(entry->original_size, original_size);
    utils_write_u32_be(entry->crc32, crc32);
}

static result_t fill_manifest_v2_entry(
    uint8_t out[QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE],
    uint8_t file_type,
    const uint8_t object_id[QMAIL_OT_ID_SIZE],
    uint64_t generation,
    uint64_t original_size,
    const uint8_t logical_hash[QMAIL_OT_HASH_SIZE]) {
    qmail_ot_manifest_v2_entry_t entry;
    memset(&entry, 0, sizeof(entry));
    entry.file_type = file_type;
    entry.file_flags = upload_manifest_flags_for_file_type(file_type);
    entry.storage_protocol = QMAIL_OT_STORAGE_PROTOCOL_V1;
    entry.hash_algorithm = QMAIL_OT_HASH_SHA256;
    memcpy(entry.object_id, object_id, QMAIL_OT_ID_SIZE);
    entry.generation = generation;
    entry.original_size = original_size;
    memcpy(entry.object_hash, logical_hash, QMAIL_OT_HASH_SIZE);
    return qmail_ot_serialize_manifest_v2_entry(&entry, out);
}

static void receipt_recount_tell_summary(qmail_receipt_t *receipt) {
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

// ============================================================================
// BACKGROUND REPLENISH
// ============================================================================

#ifdef _WIN32
#include <process.h>
static unsigned __stdcall pool_replenish_thread(void *arg) {
    char *wp = (char *)arg;
    qmail_pool_replenish(wp);
    free(wp);
    return 0;
}
#else
#include <pthread.h>
static void *pool_replenish_thread(void *arg) {
    char *wp = (char *)arg;
    qmail_pool_replenish(wp);
    free(wp);
    return NULL;
}
#endif

static void trigger_background_replenish(const char *wallet_path) {
    char *wp_copy = strdup(wallet_path);
    if (!wp_copy) return;
#ifdef _WIN32
    uintptr_t h = _beginthreadex(NULL, 0, pool_replenish_thread, wp_copy, 0, NULL);
    if (h) CloseHandle((HANDLE)h);
    else free(wp_copy);
    return;
#else
    pthread_t tid;
    if (pthread_create(&tid, NULL, pool_replenish_thread, wp_copy) == 0)
        pthread_detach(tid);
    else
        free(wp_copy);
#endif
}

// ============================================================================
// HELPERS
// ============================================================================

static void update_max_inbox_fee_for_list(const char *addresses, uint8_t type,
                                          int *max_fee_cc) {
    if (!addresses || !addresses[0] || !max_fee_cc || !qmail_db_is_open()) return;

    recipient_with_beacon_t tmp_recips[QMAIL_MAX_RECIPIENTS];
    int tmp_count = qmail_parse_recipients(addresses, type, tmp_recips, QMAIL_MAX_RECIPIENTS);
    for (int i = 0; i < tmp_count; i++) {
        qmail_contact_t ct;
        if (qmail_db_contact_get(tmp_recips[i].entry.serial_number, &ct) == RESULT_SUCCESS) {
            if ((int)ct.inbox_fee > *max_fee_cc) {
                *max_fee_cc = (int)ct.inbox_fee;
            }
        }
    }
}

/**
 * Select the sender's identity coin from the Mail wallet.
 *
 * For QMail sending, the preamble coin identity is embedded in the email
 * header as the sender. The server enforces that the header sender matches
 * the preamble coin. So we MUST use the actual mailbox identity coin —
 * not just any coin with the best pown score.
 */
static result_t select_identity(int8_t *denom_out, uint32_t *sn_out,
                                 uint8_t an_out[RAIDA_COUNT][AN_LENGTH],
                                 raida_encryption_key_t *key_out) {
    raida_encryption_key_t key;
    qmail_identity_t identity;
    result_t res = qmail_identity_load_key(NULL, &key, &identity);
    if (res != RESULT_SUCCESS || !key.valid) {
        log_warn(LOG_CAT_COMMAND,
                 "QMail Upload: mailbox identity coin not found in Mail wallet");
        return RESULT_NOT_FOUND;
    }

    if (!identity.valid) {
        log_warn(LOG_CAT_COMMAND,
                 "QMail Upload: mailbox identity is not registered (%s)",
                 qmail_identity_error_string(identity.error_code));
        return RESULT_NOT_FOUND;
    }

    log_info(LOG_CAT_COMMAND,
             "QMail Upload: using mailbox identity coin DN%d.%u from Mail wallet",
             key.denomination, key.serial_number);
    *denom_out = key.denomination;
    *sn_out = key.serial_number;
    memcpy(an_out, key.ans, sizeof(key.ans));
    if (key_out) {
        *key_out = key;
    }
    return RESULT_SUCCESS;
}

/** Read a file into a newly allocated buffer. Caller must free. */
static uint8_t *read_file_to_buffer(const char *path, size_t *size_out) {
    size_t size = 0;
    if (!fs_get_file_size_size_t(path, &size)) return NULL;

    FILE *f = fopen(path, "rb");
    if (!f) return NULL;

    uint8_t *buf = (uint8_t *)malloc(size);
    if (!buf) { fclose(f); return NULL; }

    if (fread(buf, 1, size, f) != size) {
        free(buf);
        fclose(f);
        return NULL;
    }

    fclose(f);
    *size_out = size;
    return buf;
}

static void upload_free_inputs(char *att_buf, uint8_t *email_file_data) {
    free(att_buf);
    free(email_file_data);
}

static result_t upload_split_cbdf_document(const uint8_t *data,
                                           size_t data_len,
                                           const uint8_t **meta_data,
                                           size_t *meta_len,
                                           const uint8_t **body_data,
                                           size_t *body_len) {
    if (!data || data_len < 5 || !meta_data || !meta_len ||
        !body_data || !body_len) {
        return RESULT_INVALID_PARAM;
    }

    const uint8_t *p = data;
    const uint8_t *end = data + data_len;
    uint16_t pair_count = (uint16_t)p[0] | ((uint16_t)p[1] << 8);
    p += 2;

    for (uint16_t i = 0; i < pair_count; i++) {
        if (p + 2 > end) return RESULT_INVALID_PARAM;
        uint8_t value_len = p[1];
        p += 2;
        if (p + value_len > end) return RESULT_INVALID_PARAM;
        p += value_len;
    }

    if (p + 3 > end || p[0] != 0x1C || p[1] != 0x1C || p[2] != 0x02) {
        return RESULT_INVALID_PARAM;
    }

    *meta_data = data;
    *meta_len = (size_t)(p - data);
    *body_data = p;
    *body_len = (size_t)(end - p);
    return RESULT_SUCCESS;
}

static size_t upload_stripe_size_for(size_t file_size, int data_stripes) {
    if (data_stripes <= 0 || file_size > SIZE_MAX / 8) return SIZE_MAX;

    size_t total_bits = file_size * 8;
    size_t bits_per_stripe =
        (total_bits + (size_t)data_stripes - 1) / (size_t)data_stripes;
    return (bits_per_stripe + 7) / 8;
}

static size_t upload_legacy_capacity_for_data_stripes(size_t data_stripes) {
    if (data_stripes == 0) {
        return 0;
    }
    if (UPLOAD_MAX_STRIPE_BYTES > SIZE_MAX / data_stripes) {
        return SIZE_MAX;
    }
    return UPLOAD_MAX_STRIPE_BYTES * data_stripes;
}

size_t qmail_upload_legacy_max_file_bytes(void) {
    /*
     * CBDF key4 is emitted before qmail_upload_files() picks its final healthy
     * server set, so the public large-page decision must not depend on the
     * theoretical 25-server maximum.  Use the minimum planned data stripe count:
     * files above this threshold page through cmd75 instead of forcing the
     * dynamic server selector to find a large legacy cmd70 stripe set.
     */
    return upload_legacy_capacity_for_data_stripes(UPLOAD_ESTIMATE_DATA_STRIPES);
}

bool qmail_upload_file_uses_large_pages(int file_index, size_t file_size) {
    return file_index > 0 &&
           file_size > qmail_upload_legacy_max_file_bytes();
}

result_t qmail_upload_preplan_attachment_size(
    size_t attachment_size,
    qmail_attachment_page_plan_t *plan) {
    if (!plan) return RESULT_INVALID_PARAM;

    memset(plan, 0, sizeof(*plan));
    if (!qmail_upload_file_uses_large_pages(1, attachment_size)) {
        return RESULT_SUCCESS;
    }

    if ((uint64_t)UPLOAD_ESTIMATE_DATA_STRIPES >
        UINT64_MAX / (uint64_t)QMAIL_UPLOAD_PAGE_SIZE) {
        return RESULT_INVALID_PARAM;
    }

    uint64_t chunk_capacity =
        (uint64_t)UPLOAD_ESTIMATE_DATA_STRIPES *
        (uint64_t)QMAIL_UPLOAD_PAGE_SIZE;
    uint64_t total_pages =
        ((uint64_t)attachment_size + chunk_capacity - 1u) / chunk_capacity;
    if (total_pages == 0) total_pages = 1;
    if (total_pages > UINT16_MAX) total_pages = UINT16_MAX;

    plan->is_paged = 1;
    plan->total_pages_estimate = (uint16_t)total_pages;
    return RESULT_SUCCESS;
}

result_t qmail_upload_preplan_attachment_path(
    const char *path,
    qmail_attachment_page_plan_t *plan,
    size_t *size_out) {
    if (!path || !path[0] || !plan) return RESULT_INVALID_PARAM;

    size_t size = 0;
    if (!fs_get_file_size_size_t(path, &size)) {
        return RESULT_FILE_ERROR;
    }
    if (size_out) *size_out = size;
    return qmail_upload_preplan_attachment_size(size, plan);
}

static int required_data_stripes_for_files(const size_t *file_sizes,
                                           int file_count) {
    if (!file_sizes || file_count <= 0) return -1;

    int required = 2; /* Preserve the existing minimum: 2 data + 1 parity. */
    for (int f = 0; f < file_count; f++) {
        int file_required = -1;
        for (int data_stripes = 1; data_stripes < QMAIL_MAX_SERVERS; data_stripes++) {
            if (upload_stripe_size_for(file_sizes[f], data_stripes) <=
                UPLOAD_MAX_STRIPE_BYTES) {
                file_required = data_stripes;
                break;
            }
        }
        if (file_required < 0) return -1;
        if (file_required > required) required = file_required;
    }

    return required;
}

static int required_data_stripes_for_upload_plan(const uint8_t *file_types,
                                                 const size_t *file_sizes,
                                                 int file_count) {
    if (!file_types || !file_sizes || file_count <= 0) return -1;

    size_t legacy_file_sizes[UPLOAD_MAX_FILES] = {0};
    int legacy_file_count = 0;
    for (int f = 0; f < file_count; f++) {
        if (upload_file_type_uses_large_pages(file_types[f], file_sizes[f]))
            continue;
        legacy_file_sizes[legacy_file_count++] = file_sizes[f];
    }

    return required_data_stripes_for_files(legacy_file_sizes, legacy_file_count);
}

static bool upload_server_list_contains(const uint8_t *indices, int count,
                                        uint8_t raida_id) {
    for (int i = 0; i < count; i++) {
        if (indices[i] == raida_id) return true;
    }
    return false;
}

static bool receipt_row_delivered_by_fallback(
    const qmail_receipt_recipient_t *row,
    const recipient_with_beacon_t *recipients,
    int recipient_count,
    const uint8_t *accepted_fallback_beacons,
    int accepted_fallback_count,
    uint8_t *delivered_beacon_out) {
    if (!row || !recipients || !accepted_fallback_beacons) return false;
    for (int i = 0; i < recipient_count; i++) {
        if (!receipt_row_matches_recipient(row, &recipients[i])) continue;

        uint8_t fb = qmail_recipient_secondary_beacon(&recipients[i]);
        if (qmail_beacon_in_list(fb, accepted_fallback_beacons,
                                 accepted_fallback_count)) {
            if (delivered_beacon_out) *delivered_beacon_out = fb;
            return true;
        }
    }
    return false;
}

static int append_configured_servers(uint8_t *selected, int selected_count,
                                     int target_count) {
    uint8_t configured[QMAIL_MAX_SERVERS];
    int configured_count = 0;
    qmail_servers_get_indices(configured, &configured_count);

    for (int i = 0; i < configured_count &&
                    selected_count < target_count &&
                    selected_count < QMAIL_MAX_SERVERS; i++) {
        if (!upload_server_list_contains(selected, selected_count, configured[i])) {
            selected[selected_count++] = configured[i];
        }
    }

    return selected_count;
}

// ============================================================================
// PARALLEL UPLOAD SUPPORT (duplicated from qmail_send.c — small, may diverge)
// ============================================================================

typedef struct {
    qmail_upload_context_t per_server[QMAIL_MAX_SERVERS];
    int raida_to_position[RAIDA_COUNT];
} parallel_upload_ctx_t;

typedef struct {
    qmail_upload_large_page_context_t per_server[QMAIL_MAX_SERVERS];
    int raida_to_position[RAIDA_COUNT];
} parallel_large_upload_ctx_t;

/**
 * Body builder for parallel uploads (CMD 70, 38-byte header).
 * Called per-RAIDA by executor; maps raida_id to the correct stripe.
 */
static result_t upload_build_body(uint8_t raida_id,
                                  uint8_t **body, size_t *body_size,
                                  void *user_data) {
    parallel_upload_ctx_t *pctx = (parallel_upload_ctx_t *)user_data;
    int pos = pctx->raida_to_position[raida_id];
    if (pos < 0) return RESULT_INVALID_PARAM;

    const qmail_upload_context_t *ctx = &pctx->per_server[pos];
    size_t data_len = ctx->stripe_size;
    if (data_len > UPLOAD_MAX_STRIPE_BYTES) {
        log_error(LOG_CAT_COMMAND,
                  "QMail Upload: stripe too large for 16-bit request header: %zu bytes",
                  data_len);
        return RESULT_INVALID_PARAM;
    }
    size_t total = QMAIL_PREAMBLE_SIZE + 38 + data_len;

    *body = (uint8_t *)calloc(total, 1);
    if (!*body) return RESULT_MEMORY_ERROR;
    *body_size = total;

    uint8_t *p = *body;
    size_t off = 0;

    /* Preamble (32 bytes) */
    off += qmail_write_preamble(p + off, ctx->denomination, ctx->serial_number,
                                 ctx->device_id, ctx->an);

    /* Upload header (38 bytes) */
    memcpy(p + off, ctx->file_guid, 16);   off += 16;
    memcpy(p + off, ctx->locker_code, 16);  off += 16;
    p[off++] = ctx->file_type;
    p[off++] = ctx->duration;
    utils_write_u32_be(p + off, (uint32_t)data_len);  off += 4;

    /* Stripe data */
    if (ctx->stripe_data && data_len > 0) {
        memcpy(p + off, ctx->stripe_data, data_len);
    }

    return RESULT_SUCCESS;
}

/**
 * Body builder for parallel large uploads (CMD 75).
 * The actual wire-format body is built by qmail_upload.c so the standalone
 * command and orchestrator share one cmd-75 layout.
 */
static result_t upload_large_page_build_body(uint8_t raida_id,
                                             uint8_t **body, size_t *body_size,
                                             void *user_data) {
    parallel_large_upload_ctx_t *pctx = (parallel_large_upload_ctx_t *)user_data;
    int pos = pctx->raida_to_position[raida_id];
    if (pos < 0) return RESULT_INVALID_PARAM;

    return qmail_upload_large_page_build_request_body(&pctx->per_server[pos],
                                                      body,
                                                      body_size);
}

static result_t upload_large_page_to_servers(
    const uint8_t file_guid[QMAIL_GUID_SIZE],
    const uint8_t per_server_lockers[QMAIL_MAX_SERVERS][16],
    uint8_t file_type,
    uint8_t duration,
    int8_t denom,
    uint32_t sn,
    uint8_t ans[RAIDA_COUNT][AN_LENGTH],
    const uint8_t *server_indices,
    int upload_count,
    int data_stripe_count,
    uint8_t *stripes[QMAIL_MAX_SERVERS],
    const size_t stripe_sizes[QMAIL_MAX_SERVERS],
    uint8_t *parity,
    size_t parity_size,
    uint16_t page_number,
    exec_config_t *upload_config,
    int file_index,
    bool server_upload_ok[QMAIL_MAX_SERVERS],
    qmail_upload_artifacts_t *artifacts,
    int *successes_out) {
    if (!file_guid || !per_server_lockers || !server_indices || !stripes ||
        !stripe_sizes || !parity || !upload_config || !server_upload_ok ||
        !artifacts || !successes_out) {
        return RESULT_INVALID_PARAM;
    }

    parallel_large_upload_ctx_t *pctx =
        (parallel_large_upload_ctx_t *)calloc(1, sizeof(parallel_large_upload_ctx_t));
    if (!pctx) return RESULT_MEMORY_ERROR;

    for (int i = 0; i < RAIDA_COUNT; i++) pctx->raida_to_position[i] = -1;

    for (int i = 0; i < upload_count; i++) {
        uint8_t rid = server_indices[i];
        pctx->raida_to_position[rid] = i;

        qmail_upload_large_page_context_t *uctx = &pctx->per_server[i];
        memcpy(uctx->file_guid, file_guid, QMAIL_GUID_SIZE);
        memcpy(uctx->locker_code, per_server_lockers[i], 16);
        uctx->file_type = file_type;
        uctx->duration = duration;
        uctx->page_number = page_number;
        uctx->denomination = denom;
        uctx->serial_number = sn;
        memcpy(uctx->an, ans[rid], AN_LENGTH);
        uctx->device_id = 1;

        if (i < data_stripe_count) {
            uctx->page_data = stripes[i];
            uctx->page_size = stripe_sizes[i];
        } else {
            uctx->page_data = parity;
            uctx->page_size = parity_size;
        }
    }

    exec_results_t exec_results;
    exec_results_init(&exec_results);

    result_t exec_res = executor_run(CMD_GROUP_QMAIL,
                                     CMD_QMAIL_UPLOAD_LARGE_PAGE,
                                     upload_large_page_build_body,
                                     pctx,
                                     upload_config,
                                     &exec_results);
    if (exec_res != RESULT_SUCCESS) {
        log_error(LOG_CAT_COMMAND,
                  "QMail large upload file %d page %u: executor_run failed (%d)",
                  file_index + 1, page_number, exec_res);
    }

    int successes = 0;
    for (int i = 0; i < upload_count; i++) {
        uint8_t rid = server_indices[i];
        raida_result_t *rr = &exec_results.results[rid];
        uint8_t status = rr->has_response ? rr->response.status : 0;
        if (rr->success && raida_status_is_success(status)) {
            successes++;
            log_debug(LOG_CAT_COMMAND,
                      "QMail large upload file %d page %u RAIDA %2d: success (status=0x%02X)",
                      file_index + 1, page_number, rid, status);
        } else {
            server_upload_ok[i] = false;
            log_warn(LOG_CAT_COMMAND,
                     "QMail large upload file %d page %u RAIDA %2d: failed (status=0x%02X)",
                     file_index + 1, page_number, rid, status);
        }
    }

    artifacts->upload_successes += successes;
    artifacts->upload_failures += (upload_count - successes);
    *successes_out = successes;

    exec_results_free(&exec_results);
    free(pctx);
    return exec_res;
}

static result_t upload_large_source_pages(
    const uint8_t *memory_data,
    const char *file_path,
    size_t source_size,
    const uint8_t file_guid[QMAIL_GUID_SIZE],
    const uint8_t per_server_lockers[QMAIL_MAX_SERVERS][16],
    uint8_t file_type,
    uint8_t duration,
    int8_t denom,
    uint32_t sn,
    uint8_t ans[RAIDA_COUNT][AN_LENGTH],
    const uint8_t *server_indices,
    int upload_count,
    int data_stripe_count,
    exec_config_t *upload_config,
    int file_index,
    int file_count,
    const char *task_id,
    bool server_upload_ok[QMAIL_MAX_SERVERS],
    qmail_upload_artifacts_t *artifacts,
    uint32_t *crc_out) {
    if ((!memory_data && !file_path) || source_size == 0 || !crc_out ||
        data_stripe_count <= 0) {
        return RESULT_INVALID_PARAM;
    }

    if ((size_t)data_stripe_count > SIZE_MAX / QMAIL_UPLOAD_PAGE_SIZE) {
        return RESULT_INVALID_PARAM;
    }
    size_t chunk_capacity = (size_t)data_stripe_count * QMAIL_UPLOAD_PAGE_SIZE;
    uint64_t total_pages =
        ((uint64_t)source_size + (uint64_t)chunk_capacity - 1u) /
        (uint64_t)chunk_capacity;
    if (total_pages == 0 || total_pages > QMAIL_MAX_PAGES) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "File %d requires %llu pages; cmd-75 supports at most %u",
                 file_index + 1,
                 (unsigned long long)total_pages,
                 (unsigned)QMAIL_MAX_PAGES);
        return RESULT_INVALID_PARAM;
    }

    FILE *fp = NULL;
    uint8_t *chunk_buf = NULL;
    if (!memory_data) {
        fp = fopen(file_path, "rb");
        if (!fp) return RESULT_FILE_ERROR;
        chunk_buf = (uint8_t *)malloc(chunk_capacity);
        if (!chunk_buf) {
            fclose(fp);
            return RESULT_MEMORY_ERROR;
        }
    }

    uint32_t crc = utils_crc32_init();
    size_t offset = 0;
    uint32_t page = 0;

    while (offset < source_size) {
        size_t remaining = source_size - offset;
        size_t chunk_len = remaining < chunk_capacity ? remaining : chunk_capacity;
        const uint8_t *chunk_data = NULL;

        if (memory_data) {
            chunk_data = memory_data + offset;
        } else {
            size_t got = fread(chunk_buf, 1, chunk_len, fp);
            if (got != chunk_len) {
                free(chunk_buf);
                fclose(fp);
                return RESULT_FILE_ERROR;
            }
            chunk_data = chunk_buf;
        }

        crc = utils_crc32_update(crc, chunk_data, chunk_len);

        uint8_t *stripes[QMAIL_MAX_SERVERS] = {NULL};
        size_t stripe_sizes[QMAIL_MAX_SERVERS] = {0};
        result_t res = qmail_stripe_split(chunk_data, chunk_len,
                                          data_stripe_count,
                                          stripes,
                                          stripe_sizes);
        if (res != RESULT_SUCCESS) {
            free(chunk_buf);
            if (fp) fclose(fp);
            return res;
        }

        uint8_t *parity = NULL;
        size_t parity_size = 0;
        res = qmail_stripe_parity((const uint8_t **)stripes,
                                  stripe_sizes,
                                  data_stripe_count,
                                  &parity,
                                  &parity_size);
        if (res != RESULT_SUCCESS) {
            for (int i = 0; i < data_stripe_count; i++) qmail_stripe_free(stripes[i]);
            free(chunk_buf);
            if (fp) fclose(fp);
            return res;
        }

        int file_start = 5 + (85 * file_index / file_count);
        int file_end = 5 + (85 * (file_index + 1) / file_count);
        int file_span = file_end - file_start;
        int percent = file_start +
            (int)(((uint64_t)file_span * (uint64_t)(page + 1)) / total_pages);
        upload_progress(task_id, percent,
                        "Uploading file %d/%d page %u/%llu",
                        file_index + 1, file_count, page + 1,
                        (unsigned long long)total_pages);

        int successes = 0;
        res = upload_large_page_to_servers(file_guid,
                                           per_server_lockers,
                                           file_type,
                                           duration,
                                           denom,
                                           sn,
                                           ans,
                                           server_indices,
                                           upload_count,
                                           data_stripe_count,
                                           stripes,
                                           stripe_sizes,
                                           parity,
                                           parity_size,
                                           (uint16_t)page,
                                           upload_config,
                                           file_index,
                                           server_upload_ok,
                                           artifacts,
                                           &successes);

        for (int i = 0; i < data_stripe_count; i++) qmail_stripe_free(stripes[i]);
        qmail_stripe_free(parity);

        if (res != RESULT_SUCCESS || successes < data_stripe_count) {
            snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                     "Insufficient large-page uploads for file %d page %u: %d/%d succeeded",
                     file_index + 1, page + 1, successes, upload_count);
            free(chunk_buf);
            if (fp) fclose(fp);
            return RESULT_ERROR;
        }

        offset += chunk_len;
        page++;
    }

    free(chunk_buf);
    if (fp) fclose(fp);
    *crc_out = utils_crc32_finish(crc);
    return RESULT_SUCCESS;
}

// ============================================================================
// PRIMITIVE: qmail_upload_files — upload-only, no Tell
// ============================================================================
//
// Phase 2 of the QMail refactor extracts the upload phase from the legacy
// orchestrator into a callable primitive. The new /upload endpoint will
// call this directly. /upload_and_tell calls this and then qmail_send_tells.
//
// On RESULT_SUCCESS, artifacts->pool_acq holds an unconfirmed pool
// acquisition. The caller must either:
//   (a) call qmail_send_tells (which confirms or releases internally), OR
//   (b) call qmail_upload_artifacts_confirm to keep the lockers + replenish.
//
// On any non-success return the pool has already been released and the
// artifacts struct's contents are not meaningful (except error_message).

result_t qmail_upload_files(const qmail_upload_files_options_t *options,
                            core_transport_t *transport_iface,
                            qmail_upload_artifacts_t *artifacts) {
    if (!options || !transport_iface || !artifacts) return RESULT_INVALID_PARAM;

    memset(artifacts, 0, sizeof(*artifacts));

    /* Validate required fields: need EXACTLY ONE of {email_file, email_data}.
     * Supplying both is ambiguous — the legacy code silently preferred
     * email_data; we now reject the combination so the caller picks. */
    bool use_buffer = (options->email_data != NULL && options->email_data_len > 0);
    bool use_file   = (options->email_file != NULL && options->email_file[0] != '\0');
    if (!use_buffer && !use_file) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Missing required fields: email_file or email_data");
        return RESULT_INVALID_PARAM;
    }
    if (use_buffer && use_file) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "email_file and email_data are mutually exclusive");
        return RESULT_INVALID_PARAM;
    }
    if (!options->wallet_path) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Missing required field: wallet_path");
        return RESULT_INVALID_PARAM;
    }

    /* 1. Build and validate file list: private meta + body + attachments.
     *    The incoming email_data/email_file is a complete CBDF document. Split
     *    it at the meta/body boundary so file_type=0 can be fetched first
     *    without downloading the body or attachments. */
    const char *file_paths[UPLOAD_MAX_FILES] = {0};
    const uint8_t *file_memory_data[UPLOAD_MAX_FILES] = {0};
    size_t file_memory_sizes[UPLOAD_MAX_FILES] = {0};
    uint8_t file_types[UPLOAD_MAX_FILES] = {0};
    int file_count = 0;

    uint8_t *email_file_data = NULL;
    const uint8_t *email_document = options->email_data;
    size_t email_document_len = options->email_data_len;
    if (use_file) {
        email_file_data = read_file_to_buffer(options->email_file, &email_document_len);
        if (!email_file_data) {
            snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                     "Failed to read email file: %s", options->email_file);
            return RESULT_FILE_ERROR;
        }
        email_document = email_file_data;
    }

    const uint8_t *meta_data = NULL;
    const uint8_t *body_data = NULL;
    size_t meta_len = 0;
    size_t body_len = 0;
    result_t split_res = upload_split_cbdf_document(email_document,
                                                    email_document_len,
                                                    &meta_data, &meta_len,
                                                    &body_data, &body_len);
    if (split_res != RESULT_SUCCESS) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Email data is not a split-ready CBDF document");
        upload_free_inputs(NULL, email_file_data);
        return split_res;
    }

    file_memory_data[file_count] = meta_data;
    file_memory_sizes[file_count] = meta_len;
    file_types[file_count++] = QMAIL_FILE_META;

    file_memory_data[file_count] = body_data;
    file_memory_sizes[file_count] = body_len;
    file_types[file_count++] = QMAIL_FILE_BODY;

    char *att_buf = NULL;
    if (options->attachments && options->attachments[0]) {
        att_buf = strdup(options->attachments);
        if (!att_buf) {
            upload_free_inputs(NULL, email_file_data);
            return RESULT_MEMORY_ERROR;
        }
        char *saveptr = NULL;
        char *token = strtok_r(att_buf, ",;", &saveptr);
        while (token) {
            while (*token == ' ') token++;
            if (*token) {
                if (file_count >= UPLOAD_MAX_FILES) {
                    snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                             "Too many attachments: maximum is %d", UPLOAD_MAX_ATTACHMENTS);
                    upload_free_inputs(att_buf, email_file_data);
                    return RESULT_INVALID_PARAM;
                }
                file_paths[file_count++] = token;
                file_types[file_count - 1] =
                    (uint8_t)(QMAIL_FILE_ATTACHMENT_1 + (file_count - 3));
            }
            token = strtok_r(NULL, ",;", &saveptr);
        }
    }

    size_t planned_file_sizes[UPLOAD_MAX_FILES] = {0};
    for (int i = 0; i < file_count; i++) {
        if (file_memory_data[i]) planned_file_sizes[i] = file_memory_sizes[i];
    }

    /* Validate all files and capture sizes before choosing stripe count. */
    for (int i = 0; i < file_count; i++) {
        if (file_memory_data[i]) continue;
        if (!fs_get_file_size_size_t(file_paths[i], &planned_file_sizes[i])) {
            snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                     "File not found or not readable: %s", file_paths[i]);
            upload_free_inputs(att_buf, email_file_data);
            return RESULT_FILE_ERROR;
        }
    }

    const size_t legacy_max_file_size = qmail_upload_legacy_max_file_bytes();

    /* The CBDF body/content object (file_type 1) is NEVER paged in Phase 1: it is
     * fetched first by the recipient to display the inbox and it cannot describe
     * its own paging. It is size-limited and always uploaded as a legacy cmd-70
     * single object. Reject an oversized body up front (this also fixes a latent
     * bug where an oversized body would be routed to cmd-75 paging that the
     * receiver cannot download). The check is against the FINAL encoded file_type-1
     * payload, not just the typed text. */
    if (planned_file_sizes[1] > QMAIL_CBDF_BODY_MAX_BYTES) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Email body is %zu bytes; the maximum is %u. Move large content "
                 "into an attachment.",
                 planned_file_sizes[1], (unsigned)QMAIL_CBDF_BODY_MAX_BYTES);
        upload_free_inputs(att_buf, email_file_data);
        return RESULT_INVALID_PARAM;
    }

    bool needs_large_upload = false;
    int required_data_stripes = 2;
    int required_server_count = required_data_stripes + 1; /* +1 parity */

    log_info(LOG_CAT_COMMAND, "QMail Upload: %d file(s) validated", file_count);
    upload_progress(options->task_id, 1, "Validated %d file(s) for upload", file_count);

    /* 2. Choose enough servers to keep each striped upload packet under the
     * legacy 16-bit request-body limit. Healthy servers stay first so, when
     * one extra configured server is needed, it becomes parity if unhealthy. */
    uint8_t server_indices[QMAIL_MAX_SERVERS];
    int healthy_server_count =
        qmail_health_get_healthy_servers(server_indices, QMAIL_MAX_SERVERS);
    int server_count = healthy_server_count;

    if (server_count < required_server_count) {
        int before = server_count;
        server_count = append_configured_servers(server_indices, server_count,
                                                 required_server_count);
        if (server_count > before) {
            log_info(LOG_CAT_COMMAND,
                     "QMail Upload: expanded upload server set from %d healthy to %d configured servers to keep stripes under %u bytes",
                     before, server_count, (unsigned)UPLOAD_MAX_STRIPE_BYTES);
        }
    }

    if (healthy_server_count < required_data_stripes) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Too few healthy QMail servers (%d), need at least %d data servers",
                 healthy_server_count, required_data_stripes);
        upload_free_inputs(att_buf, email_file_data);
        return RESULT_ERROR;
    }

    if (server_count < required_server_count) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Largest upload file requires at least %d data stripes (%d QMail servers); only %d servers are configured/available",
                 required_data_stripes, required_server_count, server_count);
        upload_free_inputs(att_buf, email_file_data);
        return RESULT_ERROR;
    }

    int data_stripe_count = server_count - 1;  /* Reserve 1 for parity */

    log_info(LOG_CAT_COMMAND,
             "QMail Upload: using Object Transfer v1 on %d servers "
             "(%d data + 1 parity; %d healthy)",
             server_count, data_stripe_count, healthy_server_count);

    /* 3. Select identity coin from wallet */
    int8_t denom;
    uint32_t sn;
    uint8_t ans[RAIDA_COUNT][AN_LENGTH];
    raida_encryption_key_t identity_key;
    encryption_key_init(&identity_key);
    if (select_identity(&denom, &sn, ans, &identity_key) != RESULT_SUCCESS) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "No mailbox identity coin available in Mail wallet");
        upload_free_inputs(att_buf, email_file_data);
        return RESULT_NOT_FOUND;
    }

    if (!coin_denomination_is_valid(denom)) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Invalid denomination %d from identity coin", denom);
        upload_free_inputs(att_buf, email_file_data);
        return RESULT_INVALID_PARAM;
    }

    log_info(LOG_CAT_COMMAND, "QMail Upload: identity coin denom=%d sn=%u", denom, sn);
    upload_progress(options->task_id, 3, "Identity resolved, acquiring locker codes");

    /* 4. Upload count = selected server count */
    int upload_count = server_count;

    /* 5. Use the caller-provided GUID when present so CBDF/upload/tell agree. */
    uint8_t file_guid[QMAIL_GUID_SIZE];
    if (options->file_guid) {
        memcpy(file_guid, options->file_guid, QMAIL_GUID_SIZE);
    } else {
        qmail_crypto_generate_guid(file_guid);
    }
    memcpy(artifacts->file_guid, file_guid, QMAIL_GUID_SIZE);

    /* Stash sender identity into artifacts now so the tell phase can use it */
    artifacts->sender_denomination  = denom;
    artifacts->sender_serial_number = sn;
    memcpy(artifacts->sender_ans, ans, sizeof(ans));
    artifacts->device_id = 1;

    char guid_hex[33];
    utils_bytes_to_hex(file_guid, QMAIL_GUID_SIZE, guid_hex);
    log_info(LOG_CAT_COMMAND, "QMail Upload: email_id=%s", guid_hex);

    /* 6. Duration */
    int duration_weeks = options->duration_weeks > 0 ? options->duration_weeks : 4;
    uint8_t duration = (uint8_t)qmail_weeks_to_duration(duration_weeks);

    /* 7. Executor config with protocol-level encryption (AES-128-CTR).
     *
     * Use the Mail identity coin for QMail upload encryption. A previous
     * version selected an arbitrary payment-wallet coin here, but locker
     * pool replenishment can change those coins while a send is in flight,
     * leaving the executor with stale ANs and causing RAIDA 0x22 rejects.
     * The Mail identity coin is stable for the lifetime of the send. */
    exec_config_t upload_config;
    exec_config_init(&upload_config);
    upload_config.transport = TRANSPORT_TCP;
    upload_config.mode = EXEC_MODE_PARALLEL;
    upload_config.timeout_ms = needs_large_upload ? UPLOAD_LARGE_PAGE_TIMEOUT_MS : 30000;
    upload_config.transport_iface = transport_iface;
    upload_config.include_only = server_indices;
    upload_config.include_count = upload_count;
    upload_config.early_finish_count = upload_count > 1 ? upload_count - 1 : 0;
    upload_config.early_finish_grace_ms = 3000;

    qmail_encryption_state_t enc_state;
    qmail_apply_encryption_key(&identity_key, &upload_config, &enc_state);
    /* Copy the encryption key into artifacts by value so the tell phase
     * can use it after this function's stack frame is gone. */
    memcpy(&artifacts->enc_key, &enc_state.enc_key, sizeof(artifacts->enc_key));
    log_debug(LOG_CAT_COMMAND, "QMail encryption: using Mail identity key DN%d.%u",
              identity_key.denomination, identity_key.serial_number);

    /* 8. Acquire funded locker codes from pool (or fund synchronously). */
    int inbox_fee_cc = 0;
    /* Determine max inbox fee across all intended recipients (best-effort lookup).
     * The recipient lists are advisory at upload time — see qmail_upload_files.h. */
    update_max_inbox_fee_for_list(options->to,  QMAIL_RECIPIENT_TO, &inbox_fee_cc);
    update_max_inbox_fee_for_list(options->cc,  QMAIL_RECIPIENT_CC, &inbox_fee_cc);
    update_max_inbox_fee_for_list(options->bcc, QMAIL_RECIPIENT_BC, &inbox_fee_cc);

    result_t pool_res = qmail_pool_acquire_for_send(options->wallet_path,
                                                     upload_count, inbox_fee_cc,
                                                     &artifacts->pool_acq);
    if (pool_res != RESULT_SUCCESS) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Failed to acquire funded locker codes from pool");
        upload_free_inputs(att_buf, email_file_data);
        return pool_res;
    }

    /* Stamp every acquired row with the file_guid so the Phase 8
     * reclamation sweep can match a stuck row back to a specific
     * email's receipt. */
    qmail_pool_stamp_file_guid(&artifacts->pool_acq, file_guid);

    /* Convert key strings to 16-byte null-padded locker codes for the wire */
    uint64_t total_group_size = 0;
    uint64_t file_sizes[UPLOAD_MAX_FILES] = {0};
    uint8_t file_hashes[UPLOAD_MAX_FILES][QMAIL_OT_HASH_SIZE] = {{0}};
    bool server_upload_ok[QMAIL_MAX_SERVERS];
    for (int i = 0; i < QMAIL_MAX_SERVERS; i++) server_upload_ok[i] = true;

    /* per_server_lockers is consumed during the upload loop (built into the
     * upload contexts). The same lockers are also stashed in artifacts so
     * the tell phase can reference them when building the file header. */
    uint8_t per_server_lockers[QMAIL_MAX_SERVERS][16];
    for (int i = 0; i < upload_count; i++) {
        memset(per_server_lockers[i], 0, 16);
        size_t klen = strlen(artifacts->pool_acq.upload_keys[i]);
        if (klen > 16) klen = 16;
        memcpy(per_server_lockers[i], artifacts->pool_acq.upload_keys[i], klen);
        memcpy(artifacts->per_server_lockers[i], per_server_lockers[i], 16);
    }

    /* Stash the inbox-fee locker too, if the pool acquired one */
    if (artifacts->pool_acq.inbox_fee_acquired
        && artifacts->pool_acq.inbox_fee_key[0]) {
        size_t flen = strlen(artifacts->pool_acq.inbox_fee_key);
        if (flen > 16) flen = 16;
        memset(artifacts->inbox_fee_locker, 0, 16);
        memcpy(artifacts->inbox_fee_locker, artifacts->pool_acq.inbox_fee_key, flen);
        artifacts->inbox_fee_acquired = true;
    }

    const char *locker_keys[QMAIL_MAX_SERVERS] = {0};
    for (int i = 0; i < upload_count; ++i) {
        locker_keys[i] = artifacts->pool_acq.upload_keys[i];
    }
    uint64_t retention_seconds =
        (uint64_t)duration_weeks * 7u * 24u * 60u * 60u;

    for (int f = 0; f < file_count; f++) {
        size_t file_size = planned_file_sizes[f];
        file_sizes[f] = (uint64_t)file_size;
        if (UINT64_MAX - total_group_size < (uint64_t)file_size) {
            snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                     "Upload file-size total overflow");
            qmail_pool_release(&artifacts->pool_acq);
            upload_free_inputs(att_buf, email_file_data);
            return RESULT_INVALID_PARAM;
        }
        total_group_size += (uint64_t)file_size;

        upload_progress(options->task_id, 5 + (85 * f / file_count),
                        "Uploading file %d/%d with Object Transfer v1",
                        f + 1, file_count);
        qmail_send_object_upload_options_t object_options;
        qmail_send_object_upload_result_t object_result;
        memset(&object_options, 0, sizeof(object_options));
        object_options.wallet_path = options->wallet_path;
        object_options.source_path = file_memory_data[f] ? NULL : file_paths[f];
        object_options.source_data = file_memory_data[f];
        object_options.source_size = file_size;
        object_options.object_id = file_guid;
        object_options.file_type = file_types[f];
        object_options.target_generation = 1;
        object_options.retention_seconds = retention_seconds;
        object_options.server_indices = server_indices;
        object_options.server_count = upload_count;
        object_options.data_stripe_count = data_stripe_count;
        object_options.locker_keys = locker_keys;
        object_options.server_enabled = server_upload_ok;
        object_options.task_id = options->task_id;
        object_options.file_index = f;
        object_options.file_count = file_count;

        result_t object_status =
            qmail_send_object_upload(&object_options, &object_result);
        memcpy(file_hashes[f], object_result.logical_hash,
               QMAIL_OT_HASH_SIZE);
        int successes = 0;
        for (int i = 0; i < upload_count; ++i) {
            server_upload_ok[i] =
                server_upload_ok[i] && object_result.server_ok[i];
            if (object_result.server_ok[i]) successes++;
        }
        artifacts->upload_successes += successes;
        artifacts->upload_failures += upload_count - successes;
        upload_progress(options->task_id, 5 + (85 * (f + 1) / file_count),
                        "File %d/%d committed on %d/%d servers",
                        f + 1, file_count, successes, upload_count);
        if (object_status != RESULT_SUCCESS || successes < data_stripe_count) {
            snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                     "Object Transfer upload failed for file %d: %d/%d "
                     "servers committed",
                     f + 1, successes, upload_count);
            qmail_pool_release(&artifacts->pool_acq);
            upload_free_inputs(att_buf, email_file_data);
            return object_status == RESULT_SUCCESS ? RESULT_ERROR
                                                   : object_status;
        }
    }

    /* 9. Build server location entries for Tell (only servers that succeeded on ALL files).
     *    These go into artifacts->server_locs for the tell phase. */
    int valid_server_count = 0;

    for (int i = 0; i < upload_count; i++) {
        if (!server_upload_ok[i]) continue;

        raida_server_t srv;
        if (transport_get_server(server_indices[i], &srv) != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND, "QMail Upload: transport_get_server(%d) failed",
                     server_indices[i]);
            continue;
        }

        qmail_server_location_t *loc = &artifacts->server_locs[valid_server_count];
        uint8_t *raw = loc->raw_entry;
        memset(raw, 0, 32);
        raw[0] = (uint8_t)i;                              /* stripe_index */
        raw[1] = (i < data_stripe_count) ? 0 : 1;          /* stripe_type */
        raw[2] = server_indices[i];                         /* stripe_id[0] = server_id */

        /* IPv4-mapped address: 10×0x00 + 2×0xFF + 4 IP bytes */
        unsigned int a, b, c, d;
        if (sscanf(srv.ip_address, "%u.%u.%u.%u", &a, &b, &c, &d) == 4) {
            raw[20] = 0xFF;
            raw[21] = 0xFF;
            raw[22] = (uint8_t)a;
            raw[23] = (uint8_t)b;
            raw[24] = (uint8_t)c;
            raw[25] = (uint8_t)d;
        }
        raw[26] = (uint8_t)(srv.port >> 8);
        raw[27] = (uint8_t)(srv.port & 0xFF);

        loc->stripe_index = (uint8_t)i;
        loc->server_id    = server_indices[i];
        memcpy(artifacts->per_server_lockers[valid_server_count],
               per_server_lockers[i], QMAIL_LOCKER_CODE_SIZE);
        valid_server_count++;
    }

    /* Common-server invariant: the per-file loop already checked that each
     * file individually got at least data_stripe_count successes, but a
     * file-A-fails-server-1 + file-B-fails-server-2 pattern can leave the
     * INTERSECTION below threshold. The Tell metadata cites a single
     * server set shared by all files, so if the intersection is too small
     * the email is unrecoverable on the recipient side. Fail now before
     * publishing a Tell that points at an under-served stripe set. */
    if (valid_server_count < data_stripe_count) {
        snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                 "Insufficient common-server set: %d servers succeeded on all "
                 "files, need %d for recovery",
                 valid_server_count, data_stripe_count);
        log_error(LOG_CAT_COMMAND, "QMail Upload: %s", artifacts->error_message);
        qmail_pool_release(&artifacts->pool_acq);
        upload_free_inputs(att_buf, email_file_data);
        return RESULT_ERROR;
    }

    /* Populate the rest of the artifacts roll-up */
    artifacts->valid_server_count   = valid_server_count;
    artifacts->total_group_size     = total_group_size;
    artifacts->body_size            = (uint32_t)file_sizes[1];
    artifacts->file_count           = file_count;
    artifacts->used_sync_fallback   = artifacts->pool_acq.used_sync_fallback;
    artifacts->low_balance_warning  = artifacts->pool_acq.low_balance_warning;
    artifacts->manifest_version     = QMAIL_TELL_MANIFEST_VERSION_2;
    artifacts->file_entry_size      = QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE;
    artifacts->manifest_len         =
        (uint16_t)(file_count * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE);
    artifacts->manifest_flags       = QMAIL_TELL_MANIFEST_FLAG_FOOTER_REMOVED;
    for (int f = 0; f < file_count; f++) {
        if (fill_manifest_v2_entry(
                artifacts->manifest_bytes +
                    (size_t)f * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE,
                file_types[f], file_guid, 1, file_sizes[f], file_hashes[f])
            != RESULT_SUCCESS) {
            snprintf(artifacts->error_message, sizeof(artifacts->error_message),
                     "Could not serialize Tell manifest v2");
            qmail_pool_release(&artifacts->pool_acq);
            upload_free_inputs(att_buf, email_file_data);
            return RESULT_ERROR;
        }
    }

    /* Confirm storage lockers immediately. The upload phase has succeeded
     * and the storage funding has been used. The inbox-fee locker (if
     * acquired) stays RESERVED so qmail_send_tells() can either confirm
     * it (success) or release it (no recipients / unrecoverable). This
     * is the Q18(a) split-commit semantics. */
    qmail_pool_confirm_storage_only(&artifacts->pool_acq);

    upload_progress(options->task_id, 90, "Upload complete: %d/%d servers ready for Tell",
                    valid_server_count, upload_count);

    log_info(LOG_CAT_COMMAND, "QMail Upload: upload done — %d server locations ready, "
             "%llu total bytes across %d files.",
             valid_server_count, (unsigned long long)total_group_size, file_count);

    /* Phase 3: write the per-email receipt under <Mail>/Receipts/<guid>.json.
     * Receipts are non-secret — sender_ans and enc_key are deliberately
     * NOT serialized. /tell rehydrates identity from the wallet later.
     *
     * If the Mail wallet isn't configured the receipt is skipped with a
     * warning; the orchestrator's compose path still works for legacy
     * callers that don't need receipts. The new Phase 3 endpoints will
     * refuse the request earlier when the Mail wallet is missing. */
    char mail_wallet[MAX_PATH_LEN];
    if (qmail_receipt_get_mail_wallet_path(mail_wallet, sizeof(mail_wallet))
        == RESULT_SUCCESS) {
        qmail_receipt_t receipt;
        qmail_receipt_init(&receipt, mail_wallet, file_guid, options->task_id);
        receipt.upload_started_at = receipt.created_at;
        qmail_receipt_apply_upload_artifacts(&receipt, artifacts, true);
        /* Per-file receipt rows. The orchestrator already knows file_paths[] +
         * file sizes per index, but we don't keep stripe-level results — just
         * the per-file roll-up. Per-stripe detail is a Phase 8 enhancement. */
        for (int f = 0; f < file_count && f < QMAIL_RECEIPT_MAX_FILES; f++) {
            qmail_receipt_file_t *fe = &receipt.upload_files[f];
            if (file_types[f] == QMAIL_FILE_META) {
                strcpy(fe->role, "meta");
            } else if (file_types[f] == QMAIL_FILE_BODY) {
                strcpy(fe->role, "body");
            } else {
                strcpy(fe->role, "attachment");
            }
            fe->file_type = file_types[f];
            const char *src = file_memory_data[f] ? fe->role : file_paths[f];
            if (src) {
                strncpy(fe->source, src, sizeof(fe->source) - 1);
            }
            fe->size_bytes        = file_sizes[f];
            fe->stripes_uploaded  = valid_server_count;
            fe->stripes_failed    = upload_count - valid_server_count;
            strcpy(fe->status, "success");

            /* Per-stripe detail — needed by /tell from a receipt so it can
             * rebuild the server map without re-running the upload phase.
             * Only populate for the first file; the locker map is per-server
             * not per-file, so storing it once is enough. */
            if (f == 0) {
                fe->stripe_count = 0;
                for (int i = 0; i < upload_count
                                && fe->stripe_count < QMAIL_MAX_SERVERS; i++) {
                    if (!server_upload_ok[i]) continue;
                    qmail_receipt_stripe_t *s = &fe->stripes[fe->stripe_count++];
                    s->stripe_index = i;
                    s->server_id    = server_indices[i];
                    s->stripe_size  = 0;   /* not retained past loop */
                    s->is_parity    = (i >= data_stripe_count);
                    /* Locker code: store the original key string from the
                     * pool acquisition (e.g. "ABCD-1234-WXYZ"), not the
                     * 16-byte derived form. /tell needs the original to
                     * rebuild the wire format. */
                    if (artifacts->pool_acq.upload_keys[i][0]) {
                        strncpy(s->locker_code, artifacts->pool_acq.upload_keys[i],
                                sizeof(s->locker_code) - 1);
                    }
                    s->ok = true;
                }
            }
        }
        receipt.upload_file_count = (file_count > QMAIL_RECEIPT_MAX_FILES)
                                  ? QMAIL_RECEIPT_MAX_FILES : file_count;

        /* qmail_receipt_apply_upload_artifacts() already persisted the
         * manifest, total size, and inbox-fee key needed by deferred Tell. */
        result_t rs = qmail_receipt_save(&receipt);
        if (rs != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND, "QMail Upload: receipt save failed (%s)",
                     result_to_string(rs));
        } else {
            char guid_hex_log[QMAIL_GUID_SIZE * 2 + 1];
            utils_bytes_to_hex(file_guid, QMAIL_GUID_SIZE, guid_hex_log);
            log_info(LOG_CAT_COMMAND, "QMail Upload: receipt saved (%s)", guid_hex_log);
        }
    } else {
        log_warn(LOG_CAT_COMMAND,
                 "QMail Upload: no Mail wallet configured, skipping receipt");
    }

    upload_free_inputs(att_buf, email_file_data);
    return RESULT_SUCCESS;
}

// ============================================================================
// PRIMITIVE: qmail_upload_artifacts_confirm — finalize an upload-only flow
// ============================================================================
//
// Used by the orchestrator's compose path when there are no recipients
// (legacy "upload-only" semantics) and by the new /upload endpoint
// when the caller does NOT chain into qmail_send_tells().
//
// qmail_upload_files() has already confirmed the storage lockers. The
// inbox-fee locker, if acquired, is still RESERVED — the right move is
// to release it so the funding recycles back to the pool. Q18(a)
// semantics: no Tell happened, no inbox fee should be sunk.
//
// Triggers a background pool replenish.

void qmail_upload_artifacts_confirm(qmail_upload_artifacts_t *artifacts,
                                    const char *wallet_path_for_replenish) {
    if (!artifacts) return;
    /* Storage was already confirmed inside qmail_upload_files(). Recycle
     * the inbox-fee locker — no Tell will fire for this email. */
    qmail_pool_release_inbox_fee(&artifacts->pool_acq);
    if (wallet_path_for_replenish && wallet_path_for_replenish[0]) {
        trigger_background_replenish(wallet_path_for_replenish);
    }
}

// ============================================================================
// PRIMITIVE: qmail_send_tells — Tell-only phase
// ============================================================================
//
// Given the artifacts of a completed upload + a recipient list, send Tell
// to each unique beacon RAIDA. Failed tells fall through to the
// qmail_pending_tells retry queue.
//
// Recipients can be supplied either pre-parsed (preferred for the new
// /tell endpoint) or as semicolon-separated strings (used by the
// orchestrator's compose path).
//
// Always confirms or releases the pool acquisition before returning.

result_t qmail_send_tells(const qmail_send_tells_options_t *options,
                          core_transport_t *transport_iface,
                          qmail_send_tells_result_t *out_result) {
    if (!options || !transport_iface || !out_result) return RESULT_INVALID_PARAM;
    if (!options->artifacts) return RESULT_INVALID_PARAM;

    memset(out_result, 0, sizeof(*out_result));

    qmail_upload_artifacts_t *art = options->artifacts;

    /* 1. Resolve the recipient list.
     *    Either the caller passed a pre-parsed array, or we parse from
     *    semicolon-separated to/cc/bcc strings. */
    recipient_with_beacon_t local_recipients[QMAIL_MAX_RECIPIENTS];
    const recipient_with_beacon_t *recipients = NULL;
    int total_recipients = 0;

    if (options->recipients && options->recipient_count > 0) {
        recipients       = options->recipients;
        total_recipients = options->recipient_count;
    } else {
        upload_progress(options->task_id, 91, "Resolving recipients");

        if (options->to) {
            int n = qmail_parse_recipients(options->to, QMAIL_RECIPIENT_TO,
                                           local_recipients, QMAIL_MAX_RECIPIENTS);
            total_recipients += n;
        }
        if (options->cc) {
            total_recipients += qmail_parse_recipients(options->cc, QMAIL_RECIPIENT_CC,
                                                       &local_recipients[total_recipients],
                                                       QMAIL_MAX_RECIPIENTS - total_recipients);
        }
        if (options->bcc) {
            total_recipients += qmail_parse_recipients(options->bcc, QMAIL_RECIPIENT_BC,
                                                       &local_recipients[total_recipients],
                                                       QMAIL_MAX_RECIPIENTS - total_recipients);
        }
        recipients = local_recipients;
    }

    if (total_recipients == 0) {
        /* No recipients to notify — this is a caller error per Finding 4
         * of the Phase 2 review. Storage was already confirmed inside
         * qmail_upload_files(). Recycle the inbox-fee so the funding
         * doesn't sit RESERVED indefinitely (Q18(a)).
         *
         * The orchestrator's legacy compose path catches the
         * "options->to == NULL" case BEFORE calling this function and
         * routes it through qmail_upload_artifacts_confirm() instead,
         * so callers seeing this error genuinely supplied bad input. */
        log_warn(LOG_CAT_COMMAND, "QMail Tell: no recipients resolved");
        qmail_pool_release_inbox_fee(&art->pool_acq);
        if (options->wallet_path) {
            trigger_background_replenish(options->wallet_path);
        }
        snprintf(out_result->error_message, sizeof(out_result->error_message),
                 "No recipients resolved");
        return RESULT_INVALID_PARAM;
    }

    log_info(LOG_CAT_COMMAND, "QMail Tell: %d recipient(s) resolved", total_recipients);

    /* 2. Collect unique beacon RAIDAs across the recipient list. */
    uint8_t unique_beacons[QMAIL_MAX_RECIPIENTS];
    int unique_beacon_count = 0;
    for (int i = 0; i < total_recipients; i++) {
        uint8_t br = qmail_recipient_primary_beacon(&recipients[i]);
        bool found = false;
        for (int j = 0; j < unique_beacon_count; j++) {
            if (unique_beacons[j] == br) { found = true; break; }
        }
        if (!found) {
            unique_beacons[unique_beacon_count++] = br;
        }
    }

    char guid_hex[33];
    utils_bytes_to_hex(art->file_guid, QMAIL_GUID_SIZE, guid_hex);
    log_info(LOG_CAT_COMMAND, "QMail Tell: %d unique beacon(s), email_id=%s",
             unique_beacon_count, guid_hex);
    upload_progress(options->task_id, 93, "Building Tell notification for %d beacon(s)",
                    unique_beacon_count);

    /* 2b. Phase 3: load the receipt (if any) and seed the tell.recipients
     *      array with one row per parsed recipient, status=queued. The
     *      receipt was created by qmail_upload_files(); /tell from a
     *      receipt that doesn't exist still works — we just skip per-row
     *      updates with a warning. */
    char mail_wallet_for_receipt[MAX_PATH_LEN];
    bool have_receipt = false;
    qmail_receipt_t receipt;
    if (qmail_receipt_get_mail_wallet_path(mail_wallet_for_receipt,
                                            sizeof(mail_wallet_for_receipt))
        == RESULT_SUCCESS) {
        result_t rl = qmail_receipt_load(mail_wallet_for_receipt, art->file_guid,
                                          &receipt);
        if (rl == RESULT_SUCCESS) {
            have_receipt = true;
            int64_t now_ts = (int64_t)time(NULL);
            receipt.tell_started_at = now_ts;
            strcpy(receipt.tell_status, "in_progress");
            receipt.tell_finished_at = 0;

            if (receipt.tell_recipient_count == 0) {
                for (int i = 0; i < total_recipients
                                && receipt.tell_recipient_count < QMAIL_RECEIPT_MAX_RECIPIENTS; i++) {
                    qmail_receipt_recipient_t *rc =
                        &receipt.tell_recipients[receipt.tell_recipient_count++];
                    memset(rc, 0, sizeof(*rc));
                    /* Seed with what we know: SN, denom, beacon, kind. The
                     * `address` field is not in recipient_with_beacon_t —
                     * leave empty for now; can be filled later via contact
                     * lookup. */
                    rc->serial_number = recipients[i].entry.serial_number;
                    rc->denomination  = recipients[i].entry.denomination;
                    rc->beacon_raida  = qmail_recipient_primary_beacon(&recipients[i]);
                    strcpy(rc->kind,
                           receipt_kind_from_recipient_type(
                               recipients[i].entry.recipient_type));
                    rc->status = QMAIL_RCPT_STATUS_SENDING;
                    rc->started_at = now_ts;
                    rc->tell_command_code = CMD_QMAIL_TELL;
                }
            } else {
                /* /tell retries pass only the not-yet-sent recipients. Keep
                 * existing sent rows intact, and mark only the targeted rows
                 * as sending so the GUI can watch retry progress. */
                for (int i = 0; i < total_recipients; i++) {
                    bool found = false;
                    for (int j = 0; j < receipt.tell_recipient_count; j++) {
                        qmail_receipt_recipient_t *rc = &receipt.tell_recipients[j];
                        if (!receipt_row_matches_recipient(rc, &recipients[i])) continue;
                        found = true;
                        if (rc->status != QMAIL_RCPT_STATUS_SENT) {
                            rc->status = QMAIL_RCPT_STATUS_SENDING;
                            if (rc->started_at == 0) rc->started_at = now_ts;
                            rc->finished_at = 0;
                        }
                        break;
                    }
                    if (!found && receipt.tell_recipient_count < QMAIL_RECEIPT_MAX_RECIPIENTS) {
                        qmail_receipt_recipient_t *rc =
                            &receipt.tell_recipients[receipt.tell_recipient_count++];
                        memset(rc, 0, sizeof(*rc));
                        rc->serial_number = recipients[i].entry.serial_number;
                        rc->denomination  = recipients[i].entry.denomination;
                        rc->beacon_raida  = qmail_recipient_primary_beacon(&recipients[i]);
                        strcpy(rc->kind,
                               receipt_kind_from_recipient_type(
                                   recipients[i].entry.recipient_type));
                        rc->status = QMAIL_RCPT_STATUS_SENDING;
                        rc->started_at = now_ts;
                        rc->tell_command_code = CMD_QMAIL_TELL;
                    }
                }
            }
            receipt_recount_tell_summary(&receipt);
            qmail_receipt_save(&receipt);
        } else if (rl != RESULT_NOT_FOUND) {
            log_warn(LOG_CAT_COMMAND,
                     "QMail Tell: receipt load failed (%s) — proceeding without receipt update",
                     result_to_string(rl));
        }
    }

    /* 3. Build the file header once — same metadata shipped to every
     *    beacon for this email. The server validates that the blob's
     *    sender identity matches the preamble identity. */
    if (art->manifest_len > QMAIL_TELL_MANIFEST_MAX_LEN) {
        snprintf(out_result->error_message, sizeof(out_result->error_message),
                 "Tell manifest is too large");
        return RESULT_INVALID_PARAM;
    }
    if (art->manifest_len > 0) {
        bool v1 = art->manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 &&
                  art->file_entry_size == QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE;
        bool v2 = art->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2 &&
                  art->file_entry_size == QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE;
        if ((!v1 && !v2) || art->file_count <= 0 ||
            art->manifest_len !=
                (uint16_t)(art->file_count * art->file_entry_size)) {
            snprintf(out_result->error_message,
                     sizeof(out_result->error_message),
                     "Tell manifest metadata is invalid");
            return RESULT_INVALID_PARAM;
        }
    }
    uint32_t body_size = art->body_size;
    qmail_file_header_t file_hdr;
    memset(&file_hdr, 0, sizeof(file_hdr));
    memcpy(file_hdr.email_id, art->file_guid, 16);
    file_hdr.sender_coin_id[0] = 0x00;
    file_hdr.sender_coin_id[1] = 0x06;
    file_hdr.sender_denomination = (uint8_t)art->sender_denomination;
    utils_write_u32_be(file_hdr.sender_serial_number, art->sender_serial_number);
    file_hdr.sender_device_id = art->device_id;
    utils_write_u32_be(file_hdr.timestamp, (uint32_t)time(NULL));
    file_hdr.tell_type = QMAIL_TELL_NEW_EMAIL;
    file_hdr.stripe_count = (uint8_t)art->valid_server_count;
    if (art->valid_server_count > 0) {
        memcpy(file_hdr.locker_code, art->per_server_lockers[0], 16);
    }
    utils_write_u32_be(file_hdr.total_file_size, body_size);
    file_hdr.version = 0x02;
    if ((art->manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 ||
         art->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) &&
        art->manifest_len > 0) {
        file_hdr.reserved[0] = art->manifest_version;
        file_hdr.reserved[1] = (uint8_t)art->file_count;
        file_hdr.reserved[2] = art->file_entry_size;
        utils_write_u16_be(file_hdr.reserved + 3, art->manifest_len);
        file_hdr.reserved[5] = art->manifest_flags;
    }

    /* 4. Send Tell to each unique beacon. */
    int tell_successes = 0;
    int tell_failures  = 0;

    for (int b = 0; b < unique_beacon_count && b < QMAIL_MAX_RECIPIENTS; b++) {
        uint8_t beacon_id = unique_beacons[b];

        qmail_tell_context_t tell_ctx;
        memset(&tell_ctx, 0, sizeof(tell_ctx));
        memcpy(tell_ctx.file_guid, art->file_guid, QMAIL_GUID_SIZE);

        /* Per-recipient locker: funded inbox-fee key (beacon PEEKs this to
         * verify payment). Falls back to the first upload locker. */
        memset(tell_ctx.locker_code, 0, 16);
        if (art->inbox_fee_acquired) {
            memcpy(tell_ctx.locker_code, art->inbox_fee_locker, 16);
        } else if (art->valid_server_count > 0) {
            memcpy(tell_ctx.locker_code, art->per_server_lockers[0], 16);
        }

        /* Beacon payment locker: funded inbox-fee key from pool */
        memset(tell_ctx.beacon_payment_locker, 0, 16);
        if (art->inbox_fee_acquired) {
            memcpy(tell_ctx.beacon_payment_locker, art->inbox_fee_locker, 16);
        }

        tell_ctx.total_file_size = body_size;
        tell_ctx.timestamp       = (uint32_t)time(NULL);
        tell_ctx.tell_type       = QMAIL_TELL_NEW_EMAIL;
        tell_ctx.denomination    = art->sender_denomination;
        tell_ctx.serial_number   = art->sender_serial_number;
        memcpy(tell_ctx.an, art->sender_ans[beacon_id], AN_LENGTH);
        tell_ctx.device_id       = art->device_id;

        /* Filter recipients to those whose beacon == this beacon */
        tell_ctx.recipient_count = 0;
        for (int i = 0; i < total_recipients; i++) {
            if (qmail_recipient_primary_beacon(&recipients[i]) == beacon_id) {
                tell_ctx.recipients[tell_ctx.recipient_count++] = recipients[i].entry;
            }
        }

        /* Server locations (same for every beacon) */
        tell_ctx.server_count = art->valid_server_count;
        memcpy(tell_ctx.servers, art->server_locs,
               (size_t)art->valid_server_count * sizeof(qmail_server_location_t));

        /* Current notification block */
        tell_ctx.notification_block.header = file_hdr;
        memcpy(tell_ctx.notification_block.servers, art->server_locs,
               (size_t)art->valid_server_count * sizeof(qmail_server_location_t));
        tell_ctx.notification_block.manifest_version = art->manifest_version;
        tell_ctx.notification_block.file_count       = (uint8_t)art->file_count;
        tell_ctx.notification_block.file_entry_size  = art->file_entry_size;
        tell_ctx.notification_block.manifest_len     = art->manifest_len;
        tell_ctx.notification_block.manifest_flags   = art->manifest_flags;
        if (art->manifest_len > 0) {
            if (art->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
                memcpy(tell_ctx.notification_block.manifest_bytes,
                       art->manifest_bytes, art->manifest_len);
            } else {
                memcpy(tell_ctx.notification_block.files,
                       art->manifest_files, art->manifest_len);
            }
        }

        /* Encryption: BUG-11 made encryption mandatory; pass through the
         * key copied into the artifacts at upload time. */
        tell_ctx.enc_key = &art->enc_key;

        raida_result_t tell_result;
        memset(&tell_result, 0, sizeof(tell_result));
        result_t tell_res = qmail_cmd_tell(&tell_ctx, beacon_id, transport_iface, &tell_result);

        uint8_t tell_status = tell_result.has_response ? tell_result.response.status : 0;
        bool tell_accepted = (tell_res == RESULT_SUCCESS && tell_result.success &&
                              raida_status_is_success(tell_status));
        uint8_t accepted_beacon = beacon_id;
        uint8_t accepted_fallback_beacons[QMAIL_MAX_RECIPIENTS];
        int accepted_fallback_count = 0;
        bool used_fallback_beacon = false;
        char final_tell_error[128] = {0};

        if (!tell_accepted) {
            if (tell_result.success && !raida_status_is_success(tell_status)) {
                snprintf(final_tell_error, sizeof(final_tell_error),
                         "rejected: status 0x%02X", tell_status);
            } else {
                snprintf(final_tell_error, sizeof(final_tell_error),
                         "transport: %s", tell_result.error_message);
            }

            if (!(tell_result.success &&
                  tell_ctx.recipient_count == 1 &&
                  qmail_tell_status_is_invalid_recipient(tell_status))) {
                uint8_t fallback_beacons[QMAIL_MAX_RECIPIENTS];
                int fallback_count = 0;
                for (int ri = 0; ri < total_recipients; ri++) {
                    if (qmail_recipient_primary_beacon(&recipients[ri]) != beacon_id) {
                        continue;
                    }
                    uint8_t fb = qmail_recipient_secondary_beacon(&recipients[ri]);
                    if (!qmail_beacon_valid(fb) || fb == beacon_id) {
                        continue;
                    }
                    bool found = false;
                    for (int fi = 0; fi < fallback_count; fi++) {
                        if (fallback_beacons[fi] == fb) {
                            found = true;
                            break;
                        }
                    }
                    if (!found && fallback_count < QMAIL_MAX_RECIPIENTS) {
                        fallback_beacons[fallback_count++] = fb;
                    }
                }

                if (fallback_count > 0) {
                    bool all_fallbacks_accepted = true;
                    uint8_t last_fallback_status = 0;
                    for (int fi = 0; fi < fallback_count; fi++) {
                        uint8_t fallback_id = fallback_beacons[fi];
                        qmail_tell_context_t fallback_ctx = tell_ctx;
                        fallback_ctx.recipient_count = 0;
                        memcpy(fallback_ctx.an, art->sender_ans[fallback_id], AN_LENGTH);

                        for (int ri = 0; ri < total_recipients; ri++) {
                            if (qmail_recipient_primary_beacon(&recipients[ri]) == beacon_id &&
                                qmail_recipient_secondary_beacon(&recipients[ri]) == fallback_id &&
                                fallback_ctx.recipient_count < QMAIL_MAX_RECIPIENTS) {
                                fallback_ctx.recipients[fallback_ctx.recipient_count++] =
                                    recipients[ri].entry;
                            }
                        }

                        if (fallback_ctx.recipient_count == 0) {
                            continue;
                        }

                        raida_result_t fallback_result;
                        memset(&fallback_result, 0, sizeof(fallback_result));
                        result_t fallback_res = qmail_cmd_tell(&fallback_ctx, fallback_id,
                                                               transport_iface,
                                                               &fallback_result);
                        uint8_t fallback_status = fallback_result.has_response
                                                ? fallback_result.response.status : 0;
                        bool fallback_accepted =
                            (fallback_res == RESULT_SUCCESS && fallback_result.success &&
                             raida_status_is_success(fallback_status));
                        last_fallback_status = fallback_status;

                        log_info(LOG_CAT_COMMAND,
                                 "TELL fallback to beacon RAIDA %2d: %s "
                                 "(status=0x%02X, accepted=%d, %d recipients; primary=%d)",
                                 fallback_id, result_to_string(fallback_res),
                                 fallback_status, fallback_accepted,
                                 fallback_ctx.recipient_count, beacon_id);

                        if (fallback_accepted) {
                            accepted_beacon = fallback_id;
                            used_fallback_beacon = true;
                            accepted_fallback_beacons[accepted_fallback_count++] =
                                fallback_id;
                        } else {
                            all_fallbacks_accepted = false;
                            if (fallback_result.success &&
                                !raida_status_is_success(fallback_status)) {
                                snprintf(final_tell_error, sizeof(final_tell_error),
                                         "primary %d failed; fallback %d rejected: status 0x%02X",
                                         beacon_id, fallback_id, fallback_status);
                            } else {
                                snprintf(final_tell_error, sizeof(final_tell_error),
                                         "primary %d failed; fallback %d transport: %s",
                                         beacon_id, fallback_id,
                                         fallback_result.error_message);
                            }
                        }

                        raida_result_free(&fallback_result);
                    }

                    if (all_fallbacks_accepted) {
                        tell_accepted = true;
                        tell_status = last_fallback_status;
                        tell_res = RESULT_SUCCESS;
                        final_tell_error[0] = '\0';
                    }
                }
            }
        }

        log_info(LOG_CAT_COMMAND, "TELL to beacon RAIDA %2d: %s (status=0x%02X, accepted=%d, "
                 "%d recipients)", beacon_id, result_to_string(tell_res), tell_status,
                 tell_accepted, tell_ctx.recipient_count);
        if (used_fallback_beacon) {
            log_info(LOG_CAT_COMMAND,
                     "TELL primary RAIDA %2d failed; fallback RAIDA %2d accepted",
                     beacon_id, accepted_beacon);
        }

        int tell_progress = 93 + (6 * (b + 1) / unique_beacon_count);
        upload_progress(options->task_id, tell_progress,
                        "Tell beacon %d: %s", beacon_id,
                        tell_accepted ? "accepted" : "failed");

        /* Record per-beacon outcome for the caller's structured result */
        qmail_tell_per_beacon_t *pb = &out_result->per_beacon[b];
        pb->beacon_raida    = tell_accepted ? accepted_beacon : beacon_id;
        pb->recipient_count = tell_ctx.recipient_count;
        pb->accepted        = tell_accepted;
        pb->raida_status    = tell_status;
        if (tell_accepted) {
            pb->error_message[0] = '\0';
        } else {
            snprintf(pb->error_message, sizeof(pb->error_message),
                     "%s", final_tell_error[0] ? final_tell_error : "Tell failed");
        }

        /* Phase 3: mark every recipient on this beacon with the outcome. */
        if (have_receipt) {
            int64_t now_ts = (int64_t)time(NULL);
            for (int i = 0; i < receipt.tell_recipient_count; i++) {
                qmail_receipt_recipient_t *rc = &receipt.tell_recipients[i];
                if (rc->beacon_raida != beacon_id) continue;
                if (!receipt_row_is_targeted(rc, recipients, total_recipients)) continue;
                uint8_t delivered_beacon = accepted_beacon;
                bool row_delivered = tell_accepted;
                if (!row_delivered && used_fallback_beacon) {
                    row_delivered = receipt_row_delivered_by_fallback(
                        rc, recipients, total_recipients,
                        accepted_fallback_beacons, accepted_fallback_count,
                        &delivered_beacon);
                } else if (used_fallback_beacon) {
                    receipt_row_delivered_by_fallback(
                        rc, recipients, total_recipients,
                        accepted_fallback_beacons, accepted_fallback_count,
                        &delivered_beacon);
                }

                qmail_rcpt_status_t row_status = row_delivered
                    ? QMAIL_RCPT_STATUS_SENT
                    : (qmail_db_is_open() ? QMAIL_RCPT_STATUS_RETRY_QUEUED
                                          : QMAIL_RCPT_STATUS_FAILED);
                rc->status      = row_status;
                if (row_delivered && used_fallback_beacon &&
                    delivered_beacon != beacon_id) {
                    rc->beacon_raida = delivered_beacon;
                }
                rc->attempts++;
                if (rc->started_at == 0) rc->started_at = now_ts;
                if (row_status == QMAIL_RCPT_STATUS_SENT
                    || row_status == QMAIL_RCPT_STATUS_FAILED) {
                    rc->finished_at = now_ts;
                }
                if (row_delivered) {
                    rc->last_error[0] = '\0';
                } else {
                    snprintf(rc->last_error, sizeof(rc->last_error),
                             "%s", pb->error_message);
                }
            }
        }

        if (tell_accepted) {
            tell_successes++;
            if (qmail_db_is_open()) {
                int updated = 0;
                qmail_db_pending_tell_update_by_file_beacon(
                    art->file_guid, beacon_id, "sent",
                    NULL, 0, NULL, &updated);
                if (updated > 0) {
                    log_info(LOG_CAT_COMMAND,
                             "Marked %d stale pending tell(s) sent for beacon %d",
                             updated, beacon_id);
                }
            }
        } else {
            tell_failures++;

            /* Surface the FIRST failure as the result-level error message */
            if (out_result->error_message[0] == '\0') {
                snprintf(out_result->error_message, sizeof(out_result->error_message),
                         "Tell to RAIDA %d failed: %s", beacon_id, pb->error_message);
            }

            /* Queue for retry: serialize the tell context (with enc_key
             * blanked so we don't persist a stack pointer) into the
             * pending-tells table. The retry worker re-fetches an
             * encryption key on each attempt. */
            if (qmail_db_is_open()) {
                qmail_tell_context_t db_ctx = tell_ctx;
                db_ctx.enc_key = NULL;
                if (used_fallback_beacon) {
                    db_ctx.recipient_count = 0;
                    for (int ri = 0; ri < total_recipients; ri++) {
                        if (qmail_recipient_primary_beacon(&recipients[ri]) != beacon_id) {
                            continue;
                        }
                        if (qmail_recipient_delivered_by_fallback(
                                &recipients[ri], accepted_fallback_beacons,
                                accepted_fallback_count)) {
                            continue;
                        }
                        if (db_ctx.recipient_count < QMAIL_MAX_RECIPIENTS) {
                            db_ctx.recipients[db_ctx.recipient_count++] =
                                recipients[ri].entry;
                        }
                    }
                }

                if (db_ctx.recipient_count == 0) {
                    log_info(LOG_CAT_COMMAND,
                             "No failed recipients remain to queue for beacon %d",
                             beacon_id);
                    raida_result_free(&tell_result);
                    continue;
                }

                int updated = 0;
                result_t up = qmail_db_pending_tell_update_by_file_beacon(
                    art->file_guid, beacon_id, "pending",
                    (const uint8_t *)&db_ctx, sizeof(db_ctx),
                    pb->error_message, &updated);
                if (up == RESULT_SUCCESS && updated > 0) {
                    log_info(LOG_CAT_COMMAND,
                             "Refreshed %d pending tell(s) for beacon %d",
                             updated, beacon_id);
                } else {
                    qmail_db_pending_tell_insert(
                        art->file_guid,
                        db_ctx.recipient_count == 1
                            ? db_ctx.recipients[0].serial_number : 0,
                        db_ctx.recipient_count == 1
                            ? db_ctx.recipients[0].denomination : 0,
                        beacon_id,
                        (const uint8_t *)&db_ctx, sizeof(db_ctx),
                        pb->error_message);
                    log_info(LOG_CAT_COMMAND,
                             "Queued pending tell for beacon %d (%d recipient%s)",
                             beacon_id, db_ctx.recipient_count,
                             db_ctx.recipient_count == 1 ? "" : "s");
                }
            }
        }

        raida_result_free(&tell_result);
    }

    out_result->beacon_count    = unique_beacon_count;
    out_result->tell_successes  = tell_successes;
    out_result->tell_failures   = tell_failures;
    out_result->all_accepted    = (tell_successes == unique_beacon_count);

    /* 4b. Phase 3: finalize and save the receipt. Recompute summary
     *      counts from the per-recipient statuses in the table — that's
     *      the canonical source. */
    if (have_receipt) {
        int q=0, sg=0, st=0, fa=0, rq=0;
        for (int i = 0; i < receipt.tell_recipient_count; i++) {
            switch (receipt.tell_recipients[i].status) {
                case QMAIL_RCPT_STATUS_QUEUED:       q++;  break;
                case QMAIL_RCPT_STATUS_SENDING:      sg++; break;
                case QMAIL_RCPT_STATUS_SENT:         st++; break;
                case QMAIL_RCPT_STATUS_FAILED:       fa++; break;
                case QMAIL_RCPT_STATUS_RETRY_QUEUED: rq++; break;
            }
        }
        receipt.tell_summary_total        = receipt.tell_recipient_count;
        receipt.tell_summary_queued       = q;
        receipt.tell_summary_sending      = sg;
        receipt.tell_summary_sent         = st;
        receipt.tell_summary_failed       = fa;
        receipt.tell_summary_retry_queued = rq;
        receipt.tell_finished_at          = (int64_t)time(NULL);
        if (st == receipt.tell_recipient_count)        strcpy(receipt.tell_status, "success");
        else if (fa == receipt.tell_recipient_count)   strcpy(receipt.tell_status, "failed");
        else if (st > 0 || rq > 0 || fa > 0)           strcpy(receipt.tell_status, "partial");
        else                                            strcpy(receipt.tell_status, "in_progress");

        /* Stash subject/body_preview from the legacy compose path so a
         * receipt-driven /tell from the new endpoint can rebuild the
         * Sent DB row without round-tripping the caller. */
        if (options->subject)
            strncpy(receipt.subject, options->subject, sizeof(receipt.subject) - 1);
        if (options->body_preview)
            strncpy(receipt.body_preview, options->body_preview, sizeof(receipt.body_preview) - 1);

        result_t rs = qmail_receipt_save(&receipt);
        if (rs != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND, "QMail Tell: receipt save failed (%s)",
                     result_to_string(rs));
        }
    }

    /* 5. Record Sent row after upload success, even if some tells failed.
     *    Records every TO/CC/BCC recipient so the user can see everyone who
     *    received money. Recipient details live in qmail_email_contacts
     *    keyed by file_guid; a flat "to ; cc ; bcc" string is also stored in
     *    qmail_sent_emails.recipients for display compatibility. */
    if (qmail_db_is_open() && (options->to || options->cc || options->bcc)) {
        char recipients_str[QMAIL_MAX_RECIPIENT_LIST_LEN] = "";
        size_t off = 0;
        if (options->to && options->to[0]) {
            int n = snprintf(recipients_str + off, sizeof(recipients_str) - off,
                             "%s", options->to);
            if (n > 0) off += (size_t)n;
        }
        if (options->cc && options->cc[0] && off < sizeof(recipients_str)) {
            int n = snprintf(recipients_str + off, sizeof(recipients_str) - off,
                             "%scc:%s", off ? " ; " : "", options->cc);
            if (n > 0) off += (size_t)n;
        }
        if (options->bcc && options->bcc[0] && off < sizeof(recipients_str)) {
            snprintf(recipients_str + off, sizeof(recipients_str) - off,
                     "%sbcc:%s", off ? " ; " : "", options->bcc);
        }

        /* Project the typed recipient list (recipient_with_beacon_t carries
         * an entry plus the routing beacon — we only need the entry for DB
         * storage). */
        qmail_recipient_entry_t entries[QMAIL_MAX_RECIPIENTS];
        int entry_count = 0;
        for (int r = 0; r < total_recipients && entry_count < QMAIL_MAX_RECIPIENTS; r++) {
            entries[entry_count++] = recipients[r].entry;
        }

        int64_t now_ts = (int64_t)time(NULL);
        result_t sent_res = qmail_db_sent_insert(art->file_guid,
                             options->subject ? options->subject : "",
                             recipients_str,
                             options->body_preview ? options->body_preview : "",
                             now_ts,
                             art->sender_serial_number,
                             art->sender_denomination,
                             entries, entry_count);
        if (sent_res == RESULT_SUCCESS) {
            log_info(LOG_CAT_COMMAND,
                     "QMail Tell: sent record added to DB (%d recipients)", entry_count);

            /* Phase 1 popular-recipients: bump send_count / last_sent_at for
             * each recipient. Auto-creates a stub contact row for SNs not yet
             * in qmail_contacts so they appear in the compose dropdown next
             * time. Pulled from recipients[] (not entries[]) so we carry the
             * address through for the stub-insert path. Gated on sent_insert
             * success so the counters can't drift from the sent-email log.
             * Per-helper failures stay best-effort. */
            int rec_limit = entry_count;
            if (rec_limit > total_recipients) rec_limit = total_recipients;
            for (int r = 0; r < rec_limit; r++) {
                qmail_db_contact_record_send(recipients[r].entry.serial_number,
                                              recipients[r].entry.denomination,
                                              recipients[r].auto_address,
                                              now_ts);
            }
        } else {
            log_warn(LOG_CAT_COMMAND,
                     "QMail Tell: sent_insert failed (%s); skipping popularity bump",
                     result_to_string(sent_res));
        }
    }

    /* 6. Inbox-fee disposition + replenish.
     *    Storage lockers were already confirmed inside qmail_upload_files().
     *    Per the rule above the function: as soon as we've attempted every
     *    beacon (some accepted, some queued for retry), the inbox-fee is
     *    "spent on our side" and the retry worker uses the same locker
     *    key — so confirm here regardless of how many beacons succeeded.
     *    The explicit no-recipients case (above) takes the release path. */
    qmail_pool_confirm_inbox_fee(&art->pool_acq);
    if (options->wallet_path) {
        trigger_background_replenish(options->wallet_path);
    }

    upload_progress(options->task_id, 100, "Upload and Tell complete: %d/%d beacons OK",
                    tell_successes, unique_beacon_count);

    return RESULT_SUCCESS;
}

// ============================================================================
// LEGACY ENTRY POINT: qmail_upload_orchestrator — thin compose
// ============================================================================
//
// The classic upload+tell entry point used by /api/qmail/net/messages/upload
// and /api/qmail/net/messages/send. Now a thin compose over the two
// primitives above. External behavior is unchanged.
//
// New code (Phase 3 endpoints) should call qmail_upload_files() and
// qmail_send_tells() directly so the upload and tell phases can be
// observed and triggered separately.

result_t qmail_upload_orchestrator(const qmail_upload_options_t *options,
                                   core_transport_t *transport_iface,
                                   qmail_send_result_t *result) {
    if (!options || !transport_iface || !result) return RESULT_INVALID_PARAM;

    memset(result, 0, sizeof(*result));

    /* Translate the legacy options struct to the upload-primitive options. */
    qmail_upload_files_options_t upload_opts;
    memset(&upload_opts, 0, sizeof(upload_opts));
    upload_opts.wallet_path     = options->wallet_path;
    upload_opts.email_file      = options->email_file;
    upload_opts.email_data      = options->email_data;
    upload_opts.email_data_len  = options->email_data_len;
    upload_opts.attachments     = options->attachments;
    upload_opts.file_guid       = options->file_guid;
    upload_opts.duration_weeks  = options->duration_weeks;
    upload_opts.task_id         = options->task_id;
    upload_opts.to              = options->to;
    upload_opts.cc              = options->cc;
    upload_opts.bcc             = options->bcc;

    qmail_upload_artifacts_t artifacts;
    result_t res = qmail_upload_files(&upload_opts, transport_iface, &artifacts);
    if (res != RESULT_SUCCESS) {
        /* The primitive already released the pool on its failure paths. */
        memcpy(result->file_guid, artifacts.file_guid, QMAIL_GUID_SIZE);
        strncpy(result->error_message, artifacts.error_message,
                sizeof(result->error_message) - 1);
        return res;
    }

    /* Mirror upload-side roll-up into the legacy result. */
    memcpy(result->file_guid, artifacts.file_guid, QMAIL_GUID_SIZE);
    result->upload_successes    = artifacts.upload_successes;
    result->upload_failures     = artifacts.upload_failures;
    result->used_sync_fallback  = artifacts.used_sync_fallback;
    result->low_balance_warning = artifacts.low_balance_warning;

    /* Upload-only path (legacy: when `to` is NULL the orchestrator
     * skipped Tell). Confirm pool + replenish + return. */
    if (!options->to) {
        log_info(LOG_CAT_COMMAND, "QMail Upload: no recipients, skipping Tell");
        qmail_upload_artifacts_confirm(&artifacts, options->wallet_path);
        result->tell_success = false;
        result->success      = true;
        return RESULT_SUCCESS;
    }

    /* Tell phase — compose. The primitive confirms or releases the pool. */
    qmail_send_tells_options_t tell_opts;
    memset(&tell_opts, 0, sizeof(tell_opts));
    tell_opts.artifacts    = &artifacts;
    tell_opts.to           = options->to;
    tell_opts.cc           = options->cc;
    tell_opts.bcc          = options->bcc;
    tell_opts.subject      = options->subject;
    tell_opts.body_preview = options->body_preview;
    tell_opts.wallet_path  = options->wallet_path;
    tell_opts.task_id      = options->task_id;

    qmail_send_tells_result_t tell_out;
    result_t tres = qmail_send_tells(&tell_opts, transport_iface, &tell_out);

    /* Special case: tells can return INVALID_PARAM only when the
     * recipient list parsed to zero valid entries. The legacy
     * orchestrator treated that as "upload-only success with
     * tell_success=false", not as a hard failure. Preserve that. The
     * tell primitive has already released the inbox-fee locker. */
    if (tres == RESULT_INVALID_PARAM
        && tell_out.error_message[0] != '\0'
        && strstr(tell_out.error_message, "No recipients") != NULL) {
        log_warn(LOG_CAT_COMMAND, "QMail Upload: %s — treating as upload-only",
                 tell_out.error_message);
        result->tell_success = false;
        result->success      = true;
        return RESULT_SUCCESS;
    }

    if (tres != RESULT_SUCCESS) {
        strncpy(result->error_message, tell_out.error_message,
                sizeof(result->error_message) - 1);
        return tres;
    }

    result->tell_success = tell_out.all_accepted;
    if (!tell_out.all_accepted && result->error_message[0] == '\0') {
        strncpy(result->error_message, tell_out.error_message,
                sizeof(result->error_message) - 1);
    }
    result->success = true;
    return RESULT_SUCCESS;
}
