/**
 * qmail_receipt.c - Per-email receipt files (Phase 3)
 *
 * Owns:
 *   - Path resolution and directory creation
 *   - Atomic save (write tmp, rename)
 *   - Load + parse a receipt's JSON into qmail_receipt_t
 *   - In-place mutation helpers (e.g. update one recipient row)
 *
 * The JSON parser embedded in this file is purpose-built for the
 * receipt schema. It does NOT handle arbitrary JSON; it walks the
 * known structure. Callers always pass receipts written by
 * qmail_receipt_save() so the input is well-formed.
 */

#include "qmail/qmail_receipt.h"
#include "qmail/qmail_object_transfer.h"
#include "qmail/qmail_users.h"
#include "wallet.h"
#include "platform.h"
#include "logging.h"
#include "results.h"
#include "utils.h"
#include "api/api_rest.h"        /* file_exists, create_directory_recursive */
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

#ifdef _WIN32
#include <io.h>
#include <direct.h>
#define qmail_snprintf _snprintf_s
#else
#include <unistd.h>
#endif

extern bool file_exists(const char *path);
extern result_t create_directory(const char *path);
extern result_t create_directory_recursive(const char *path);

// ============================================================================
// STATUS STRINGS
// ============================================================================

const char *qmail_rcpt_status_to_string(qmail_rcpt_status_t s) {
    switch (s) {
        case QMAIL_RCPT_STATUS_QUEUED:       return "queued";
        case QMAIL_RCPT_STATUS_SENDING:      return "sending";
        case QMAIL_RCPT_STATUS_SENT:         return "sent";
        case QMAIL_RCPT_STATUS_FAILED:       return "failed";
        case QMAIL_RCPT_STATUS_RETRY_QUEUED: return "retry_queued";
        default:                             return "queued";
    }
}

qmail_rcpt_status_t qmail_rcpt_status_from_string(const char *s) {
    if (!s) return QMAIL_RCPT_STATUS_QUEUED;
    if (strcmp(s, "sending") == 0)      return QMAIL_RCPT_STATUS_SENDING;
    if (strcmp(s, "sent") == 0)         return QMAIL_RCPT_STATUS_SENT;
    if (strcmp(s, "failed") == 0)       return QMAIL_RCPT_STATUS_FAILED;
    if (strcmp(s, "retry_queued") == 0) return QMAIL_RCPT_STATUS_RETRY_QUEUED;
    return QMAIL_RCPT_STATUS_QUEUED;
}

// ============================================================================
// MAIL WALLET DISCOVERY (Q22(a) — required for receipts)
// ============================================================================

result_t qmail_receipt_get_mail_wallet_path(char *out, size_t out_size) {
    return qmail_identity_get_mail_wallet_path(NULL, out, out_size);
}

// ============================================================================
// PATH RESOLUTION
// ============================================================================

static void guid_to_hex(const uint8_t guid[QMAIL_GUID_SIZE], char *hex33) {
    static const char *kHex = "0123456789abcdef";
    for (int i = 0; i < QMAIL_GUID_SIZE; i++) {
        hex33[i * 2]     = kHex[(guid[i] >> 4) & 0xF];
        hex33[i * 2 + 1] = kHex[guid[i] & 0xF];
    }
    hex33[QMAIL_GUID_SIZE * 2] = '\0';
}

result_t qmail_receipt_path(const char *wallet_path,
                            const uint8_t file_guid[QMAIL_GUID_SIZE],
                            char *out, size_t out_size) {
    if (!wallet_path || !file_guid || !out) return RESULT_INVALID_PARAM;
    char hex[QMAIL_GUID_SIZE * 2 + 1];
    guid_to_hex(file_guid, hex);
    int n = snprintf(out, out_size, "%s%sReceipts%s%s.json",
                     wallet_path, PATH_SEPARATOR_STR,
                     PATH_SEPARATOR_STR, hex);
    if (n < 0 || (size_t)n >= out_size) return RESULT_ERROR;
    return RESULT_SUCCESS;
}

result_t qmail_receipt_ensure_dir(const char *wallet_path) {
    if (!wallet_path) return RESULT_INVALID_PARAM;
    char dir[MAX_PATH_LEN];
    int n = snprintf(dir, sizeof(dir), "%s%sReceipts",
                     wallet_path, PATH_SEPARATOR_STR);
    if (n < 0 || (size_t)n >= sizeof(dir)) return RESULT_ERROR;
    return create_directory_recursive(dir);
}

bool qmail_receipt_exists(const char *wallet_path,
                          const uint8_t file_guid[QMAIL_GUID_SIZE]) {
    char path[MAX_PATH_LEN];
    if (qmail_receipt_path(wallet_path, file_guid, path, sizeof(path)) != RESULT_SUCCESS)
        return false;
    return file_exists(path);
}

// ============================================================================
// JSON ESCAPE HELPER (for save)
// ============================================================================

static void write_escaped(FILE *f, const char *s) {
    if (!s) { fputs("\"\"", f); return; }
    fputc('"', f);
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        switch (*p) {
            case '"':  fputs("\\\"", f); break;
            case '\\': fputs("\\\\", f); break;
            case '\n': fputs("\\n", f);  break;
            case '\r': fputs("\\r", f);  break;
            case '\t': fputs("\\t", f);  break;
            default:
                if (*p < 0x20) fprintf(f, "\\u%04x", *p);
                else fputc(*p, f);
        }
    }
    fputc('"', f);
}

// ============================================================================
// SAVE
// ============================================================================

static bool receipt_bytes_zero(const uint8_t *value, size_t size) {
    if (!value) return true;
    for (size_t i = 0; i < size; ++i) {
        if (value[i] != 0) return false;
    }
    return true;
}

static void write_stripe(FILE *f, const qmail_receipt_stripe_t *s) {
    char operation_id[QMAIL_OT_ID_SIZE * 2 + 1] = {0};
    if (!receipt_bytes_zero(s->operation_id, QMAIL_OT_ID_SIZE)) {
        utils_bytes_to_hex(s->operation_id, QMAIL_OT_ID_SIZE, operation_id);
    }
    fprintf(f, "{");
    fprintf(f, "\"stripe_index\":%d,", s->stripe_index);
    fprintf(f, "\"server_id\":%d,",   s->server_id);
    fprintf(f, "\"stripe_size\":%" PRIu64 ",", s->stripe_size);
    fprintf(f, "\"stripe_type\":\"%s\",", s->is_parity ? "parity" : "data");
    fprintf(f, "\"operation_id\":"); write_escaped(f, operation_id); fputc(',', f);
    fprintf(f, "\"task_id\":");      write_escaped(f, s->task_id); fputc(',', f);
    fprintf(f, "\"locker_code\":");  write_escaped(f, s->locker_code); fputc(',', f);
    fprintf(f, "\"expires_at\":%lld,", (long long)s->expires_at);
    fprintf(f, "\"status\":\"%s\"", s->ok ? "ok" : "failed");
    if (!s->ok && s->error[0]) {
        fprintf(f, ",\"error\":");
        write_escaped(f, s->error);
    }
    fprintf(f, "}");
}

static void write_file_entry(FILE *f, const qmail_receipt_file_t *fe) {
    fprintf(f, "{");
    fprintf(f, "\"role\":");      write_escaped(f, fe->role);   fputc(',', f);
    fprintf(f, "\"file_type\":%d,", fe->file_type);
    fprintf(f, "\"source\":");    write_escaped(f, fe->source); fputc(',', f);
    fprintf(f, "\"size_bytes\":%" PRIu64 ",", fe->size_bytes);
    fprintf(f, "\"stripes\":[");
    for (int i = 0; i < fe->stripe_count; i++) {
        if (i > 0) fputc(',', f);
        write_stripe(f, &fe->stripes[i]);
    }
    fprintf(f, "],");
    fprintf(f, "\"stripes_uploaded\":%d,", fe->stripes_uploaded);
    fprintf(f, "\"stripes_failed\":%d,",   fe->stripes_failed);
    fprintf(f, "\"status\":");    write_escaped(f, fe->status);
    fprintf(f, "}");
}

static void write_manifest_file_entry(FILE *f,
                                      const qmail_file_manifest_entry_t *entry) {
    fprintf(f, "{");
    fprintf(f, "\"file_type\":%u,", (unsigned)entry->file_type);
    fprintf(f, "\"flags\":%u,", (unsigned)entry->file_flags);
    fprintf(f, "\"size_bytes\":%" PRIu64 ",",
            utils_read_u64_be(entry->original_size));
    fprintf(f, "\"crc32\":%u", utils_read_u32_be(entry->crc32));
    fprintf(f, "}");
}

static void write_manifest_v2_file_entry(
    FILE *f, const uint8_t bytes[QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE]) {
    qmail_ot_manifest_v2_entry_t entry;
    char object_id[QMAIL_OT_ID_SIZE * 2 + 1];
    char object_hash[QMAIL_OT_HASH_SIZE * 2 + 1];
    if (qmail_ot_parse_manifest_v2_entry(bytes, &entry) != RESULT_SUCCESS) {
        fputs("{}", f);
        return;
    }
    utils_bytes_to_hex(entry.object_id, QMAIL_OT_ID_SIZE, object_id);
    utils_bytes_to_hex(entry.object_hash, QMAIL_OT_HASH_SIZE, object_hash);
    fprintf(f, "{");
    fprintf(f, "\"file_type\":%u,", (unsigned)entry.file_type);
    fprintf(f, "\"flags\":%u,", (unsigned)entry.file_flags);
    fprintf(f, "\"storage_protocol\":%u,", (unsigned)entry.storage_protocol);
    fprintf(f, "\"hash_algorithm\":%u,", (unsigned)entry.hash_algorithm);
    fprintf(f, "\"object_id\":\"%s\",", object_id);
    fprintf(f, "\"generation\":%" PRIu64 ",", entry.generation);
    fprintf(f, "\"size_bytes\":%" PRIu64 ",", entry.original_size);
    fprintf(f, "\"object_hash\":\"%s\"", object_hash);
    fprintf(f, "}");
}

static void write_upload_manifest(FILE *f, const qmail_receipt_t *receipt) {
    fprintf(f, "{");
    fprintf(f, "\"version\":%u,", (unsigned)receipt->upload_manifest_version);
    fprintf(f, "\"file_count\":%u,", (unsigned)receipt->upload_manifest_file_count);
    fprintf(f, "\"entry_size\":%u,", (unsigned)receipt->upload_manifest_entry_size);
    fprintf(f, "\"manifest_len\":%u,", (unsigned)receipt->upload_manifest_len);
    fprintf(f, "\"flags\":%u,", (unsigned)receipt->upload_manifest_flags);
    fprintf(f, "\"files\":[");
    for (int i = 0; i < receipt->upload_manifest_file_count
                    && i < QMAIL_TELL_MANIFEST_MAX_FILES; i++) {
        if (i > 0) fputc(',', f);
        if (receipt->upload_manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
            write_manifest_v2_file_entry(
                f, receipt->upload_manifest_bytes +
                   (size_t)i * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE);
        } else {
            write_manifest_file_entry(f, &receipt->upload_manifest_files[i]);
        }
    }
    fprintf(f, "]}");
}

static void write_recipient(FILE *f, const qmail_receipt_recipient_t *r) {
    fprintf(f, "{");
    fprintf(f, "\"address\":");        write_escaped(f, r->address); fputc(',', f);
    fprintf(f, "\"kind\":");           write_escaped(f, r->kind);    fputc(',', f);
    fprintf(f, "\"serial_number\":%u,", r->serial_number);
    fprintf(f, "\"denomination\":%d,",  (int)r->denomination);
    fprintf(f, "\"beacon_raida\":%d,",  r->beacon_raida);
    fprintf(f, "\"status\":\"%s\",",    qmail_rcpt_status_to_string(r->status));
    fprintf(f, "\"attempts\":%d,",      r->attempts);
    fprintf(f, "\"last_error\":");      write_escaped(f, r->last_error); fputc(',', f);
    fprintf(f, "\"tell_command_code\":%d,", r->tell_command_code);
    fprintf(f, "\"started_at\":%lld,",  (long long)r->started_at);
    fprintf(f, "\"finished_at\":%lld",  (long long)r->finished_at);
    fprintf(f, "}");
}

result_t qmail_receipt_save(const qmail_receipt_t *receipt) {
    if (!receipt) return RESULT_INVALID_PARAM;

    char path[MAX_PATH_LEN];
    if (qmail_receipt_path(receipt->wallet_path, receipt->file_guid,
                           path, sizeof(path)) != RESULT_SUCCESS) {
        return RESULT_ERROR;
    }

    /* Make sure the Receipts directory exists. Cheap on the hot path. */
    qmail_receipt_ensure_dir(receipt->wallet_path);

    char tmp_path[MAX_PATH_LEN];
    int n = snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", path);
    if (n < 0 || (size_t)n >= sizeof(tmp_path)) return RESULT_ERROR;

    FILE *f = fopen(tmp_path, "wb");
    if (!f) {
        log_error(LOG_CAT_GENERAL, "qmail_receipt_save: cannot open %s", tmp_path);
        return RESULT_FILE_ERROR;
    }

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    guid_to_hex(receipt->file_guid, guid_hex);

    int64_t now = (int64_t)time(NULL);

    fprintf(f, "{");
    fprintf(f, "\"version\":%d,", QMAIL_RECEIPT_SCHEMA_VERSION);
    fprintf(f, "\"file_guid\":\"%s\",", guid_hex);
    fprintf(f, "\"request_id\":");   write_escaped(f, receipt->request_id); fputc(',', f);
    fprintf(f, "\"created_at\":%lld,", (long long)receipt->created_at);
    fprintf(f, "\"updated_at\":%lld,", (long long)now);
    fprintf(f, "\"wallet_path\":");  write_escaped(f, receipt->wallet_path); fputc(',', f);
    fprintf(f, "\"sender\":{");
    fprintf(f,   "\"serial_number\":%u,",  receipt->sender_serial_number);
    fprintf(f,   "\"denomination\":%d,",   (int)receipt->sender_denomination);
    fprintf(f,   "\"email\":");            write_escaped(f, receipt->sender_email);
    fprintf(f, "},");

    /* Upload section */
    fprintf(f, "\"upload\":{");
    fprintf(f,   "\"status\":");      write_escaped(f, receipt->upload_status); fputc(',', f);
    fprintf(f,   "\"started_at\":%lld,",  (long long)receipt->upload_started_at);
    fprintf(f,   "\"finished_at\":%lld,", (long long)receipt->upload_finished_at);
    fprintf(f,   "\"subject\":");     write_escaped(f, receipt->subject); fputc(',', f);
    fprintf(f,   "\"body_preview\":"); write_escaped(f, receipt->body_preview); fputc(',', f);
    fprintf(f,   "\"files\":[");
    for (int i = 0; i < receipt->upload_file_count; i++) {
        if (i > 0) fputc(',', f);
        write_file_entry(f, &receipt->upload_files[i]);
    }
    fprintf(f,   "],");
    fprintf(f,   "\"servers\":{");
    fprintf(f,     "\"total\":%d,", receipt->upload_servers_total);
    fprintf(f,     "\"ok\":%d,",    receipt->upload_servers_ok);
    fprintf(f,     "\"fail\":%d",   receipt->upload_servers_fail);
    fprintf(f,   "},");
    fprintf(f,   "\"total_group_size\":%" PRIu64 ",",
                  receipt->upload_total_group_size);
    fprintf(f,   "\"manifest\":");
    write_upload_manifest(f, receipt);
    fputc(',', f);
    fprintf(f,   "\"inbox_fee_acquired\":%s,",
                  receipt->upload_inbox_fee_acquired ? "true" : "false");
    fprintf(f,   "\"inbox_fee_locker\":");
    write_escaped(f, receipt->upload_inbox_fee_locker);
    fprintf(f, "},");

    /* Tell section */
    fprintf(f, "\"tell\":{");
    fprintf(f,   "\"status\":");      write_escaped(f, receipt->tell_status); fputc(',', f);
    fprintf(f,   "\"started_at\":%lld,",  (long long)receipt->tell_started_at);
    fprintf(f,   "\"finished_at\":%lld,", (long long)receipt->tell_finished_at);
    fprintf(f,   "\"recipients\":[");
    for (int i = 0; i < receipt->tell_recipient_count; i++) {
        if (i > 0) fputc(',', f);
        write_recipient(f, &receipt->tell_recipients[i]);
    }
    fprintf(f,   "],");
    fprintf(f,   "\"summary\":{");
    fprintf(f,     "\"total\":%d,",         receipt->tell_summary_total);
    fprintf(f,     "\"queued\":%d,",        receipt->tell_summary_queued);
    fprintf(f,     "\"sending\":%d,",       receipt->tell_summary_sending);
    fprintf(f,     "\"sent\":%d,",          receipt->tell_summary_sent);
    fprintf(f,     "\"failed\":%d,",        receipt->tell_summary_failed);
    fprintf(f,     "\"retry_queued\":%d",   receipt->tell_summary_retry_queued);
    fprintf(f,   "}");
    fprintf(f, "}");

    fprintf(f, "}");

    fflush(f);
    fclose(f);

    /* Atomic rename. On Windows, rename fails if destination exists, so
     * remove first. */
#ifdef _WIN32
    remove(path);
#endif
    if (rename(tmp_path, path) != 0) {
        log_error(LOG_CAT_GENERAL, "qmail_receipt_save: rename %s -> %s failed",
                  tmp_path, path);
        remove(tmp_path);
        return RESULT_FILE_ERROR;
    }
    return RESULT_SUCCESS;
}

// ============================================================================
// LOAD — schema-aware JSON parser
// ============================================================================
//
// Parses well-formed JSON written by qmail_receipt_save(). Tolerates
// reordering of object keys but assumes the document structure is the
// receipt schema. Skips unknown keys.

typedef struct {
    const char *p;       /* cursor */
    const char *end;
} jp_t;

static void jp_skip_ws(jp_t *j) {
    while (j->p < j->end && isspace((unsigned char)*j->p)) j->p++;
}

static bool jp_eat(jp_t *j, char c) {
    jp_skip_ws(j);
    if (j->p < j->end && *j->p == c) { j->p++; return true; }
    return false;
}

static bool jp_string(jp_t *j, char *out, size_t out_size) {
    jp_skip_ws(j);
    if (j->p >= j->end || *j->p != '"') return false;
    j->p++;
    size_t i = 0;
    while (j->p < j->end && *j->p != '"') {
        if (*j->p == '\\' && j->p + 1 < j->end) {
            j->p++;
            char esc = *j->p++;
            char ch;
            switch (esc) {
                case 'n': ch = '\n'; break;
                case 'r': ch = '\r'; break;
                case 't': ch = '\t'; break;
                case 'b': ch = '\b'; break;
                case 'f': ch = '\f'; break;
                case '"': ch = '"';  break;
                case '\\': ch = '\\'; break;
                case '/': ch = '/'; break;
                case 'u':
                    /* Skip 4 hex digits — receipts rarely contain
                     * unicode escapes, and we don't need full decoding
                     * for round-trip identity. */
                    if (j->p + 4 <= j->end) j->p += 4;
                    ch = '?';
                    break;
                default: ch = esc; break;
            }
            if (i + 1 < out_size) out[i++] = ch;
        } else {
            if (i + 1 < out_size) out[i++] = *j->p;
            j->p++;
        }
    }
    if (j->p >= j->end || *j->p != '"') return false;
    j->p++;
    if (i < out_size) out[i] = '\0';
    else if (out_size > 0) out[out_size - 1] = '\0';
    return true;
}

static bool jp_int64(jp_t *j, int64_t *out) {
    jp_skip_ws(j);
    char *end = NULL;
    long long v = strtoll(j->p, &end, 10);
    if (end == j->p) return false;
    j->p = end;
    *out = (int64_t)v;
    return true;
}

static bool jp_uint64(jp_t *j, uint64_t *out) {
    jp_skip_ws(j);
    char *end = NULL;
    unsigned long long v = strtoull(j->p, &end, 10);
    if (end == j->p) return false;
    j->p = end;
    *out = (uint64_t)v;
    return true;
}

static bool jp_int(jp_t *j, int *out) {
    int64_t v;
    if (!jp_int64(j, &v)) return false;
    *out = (int)v;
    return true;
}

/* Skip the JSON value at the cursor (object, array, string, number,
 * literal). Used to bypass keys we don't care about. */
static bool jp_skip_value(jp_t *j) {
    jp_skip_ws(j);
    if (j->p >= j->end) return false;
    char c = *j->p;
    if (c == '{' || c == '[') {
        char open = c;
        char close = (c == '{') ? '}' : ']';
        int depth = 0;
        bool in_string = false;
        while (j->p < j->end) {
            char d = *j->p;
            if (in_string) {
                if (d == '\\' && j->p + 1 < j->end) { j->p += 2; continue; }
                if (d == '"') in_string = false;
            } else {
                if (d == '"') in_string = true;
                else if (d == open)  depth++;
                else if (d == close) { depth--; if (depth == 0) { j->p++; return true; } }
            }
            j->p++;
        }
        return false;
    }
    if (c == '"') {
        char tmp[4];
        return jp_string(j, tmp, 0); /* parse and discard; out_size=0 means write nothing */
    }
    /* Number / true / false / null — eat until ',' '}' ']' or whitespace */
    while (j->p < j->end) {
        char d = *j->p;
        if (d == ',' || d == '}' || d == ']' || isspace((unsigned char)d)) break;
        j->p++;
    }
    return true;
}

/* Hex char -> nibble. */
static int hex_nibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
    if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
    return -1;
}

static bool guid_from_hex(const char *hex, uint8_t guid[QMAIL_GUID_SIZE]) {
    for (int i = 0; i < QMAIL_GUID_SIZE; i++) {
        int hi = hex_nibble(hex[i * 2]);
        int lo = hex_nibble(hex[i * 2 + 1]);
        if (hi < 0 || lo < 0) return false;
        guid[i] = (uint8_t)((hi << 4) | lo);
    }
    return true;
}

/* For each key in the current object, look up by name and dispatch to
 * a value parser. Unknown keys are skipped. The cursor is positioned
 * right after the opening '{' on entry; on success it is positioned
 * right after the matching '}'. */
typedef bool (*key_handler_fn)(jp_t *j, const char *key, void *ctx);

static bool jp_walk_object(jp_t *j, key_handler_fn handler, void *ctx) {
    if (!jp_eat(j, '{')) return false;
    jp_skip_ws(j);
    if (jp_eat(j, '}')) return true;
    while (j->p < j->end) {
        char key[64];
        if (!jp_string(j, key, sizeof(key))) return false;
        if (!jp_eat(j, ':')) return false;
        if (!handler(j, key, ctx)) return false;
        jp_skip_ws(j);
        if (jp_eat(j, ',')) continue;
        if (jp_eat(j, '}')) return true;
        return false;
    }
    return false;
}

/* ---- stripe handler ---- */
static bool stripe_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_stripe_t *s = (qmail_receipt_stripe_t *)ctx;
    if (strcmp(key, "stripe_index") == 0) return jp_int(j, &s->stripe_index);
    if (strcmp(key, "server_id") == 0)    return jp_int(j, &s->server_id);
    if (strcmp(key, "stripe_size") == 0)  return jp_uint64(j, &s->stripe_size);
    if (strcmp(key, "stripe_type") == 0) {
        char buf[16];
        if (!jp_string(j, buf, sizeof(buf))) return false;
        s->is_parity = (strcmp(buf, "parity") == 0);
        return true;
    }
    if (strcmp(key, "operation_id") == 0) {
        char hex[QMAIL_OT_ID_SIZE * 2 + 1];
        if (!jp_string(j, hex, sizeof(hex))) return false;
        if (hex[0] == '\0') return true;
        if (strlen(hex) != QMAIL_OT_ID_SIZE * 2) return false;
        utils_hex_to_bytes(hex, s->operation_id, QMAIL_OT_ID_SIZE);
        return true;
    }
    if (strcmp(key, "task_id") == 0)
        return jp_string(j, s->task_id, sizeof(s->task_id));
    if (strcmp(key, "locker_code") == 0)
        return jp_string(j, s->locker_code, sizeof(s->locker_code));
    if (strcmp(key, "expires_at") == 0)   return jp_int64(j, &s->expires_at);
    if (strcmp(key, "status") == 0) {
        char buf[16];
        if (!jp_string(j, buf, sizeof(buf))) return false;
        s->ok = (strcmp(buf, "ok") == 0);
        return true;
    }
    if (strcmp(key, "error") == 0)        return jp_string(j, s->error, sizeof(s->error));
    return jp_skip_value(j);
}

/* ---- file handler ---- */
typedef struct {
    qmail_receipt_file_t *fe;
} file_ctx_t;

static bool file_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_file_t *fe = ((file_ctx_t *)ctx)->fe;
    if (strcmp(key, "role") == 0)        return jp_string(j, fe->role, sizeof(fe->role));
    if (strcmp(key, "file_type") == 0)   return jp_int(j, &fe->file_type);
    if (strcmp(key, "source") == 0)      return jp_string(j, fe->source, sizeof(fe->source));
    if (strcmp(key, "size_bytes") == 0)  return jp_uint64(j, &fe->size_bytes);
    if (strcmp(key, "stripes_uploaded") == 0) return jp_int(j, &fe->stripes_uploaded);
    if (strcmp(key, "stripes_failed") == 0)   return jp_int(j, &fe->stripes_failed);
    if (strcmp(key, "status") == 0)      return jp_string(j, fe->status, sizeof(fe->status));
    if (strcmp(key, "stripes") == 0) {
        if (!jp_eat(j, '[')) return false;
        jp_skip_ws(j);
        if (jp_eat(j, ']')) return true;
        while (j->p < j->end && fe->stripe_count < QMAIL_MAX_SERVERS) {
            qmail_receipt_stripe_t *s = &fe->stripes[fe->stripe_count];
            memset(s, 0, sizeof(*s));
            if (!jp_walk_object(j, stripe_handler, s)) return false;
            fe->stripe_count++;
            jp_skip_ws(j);
            if (jp_eat(j, ',')) continue;
            if (jp_eat(j, ']')) return true;
            return false;
        }
        return false;
    }
    return jp_skip_value(j);
}

/* ---- upload manifest handler ---- */
typedef struct {
    qmail_file_manifest_entry_t *entry;
} manifest_file_ctx_t;

typedef struct {
    qmail_ot_manifest_v2_entry_t *entry;
} manifest_v2_file_ctx_t;

static bool manifest_file_handler(jp_t *j, const char *key, void *ctx) {
    qmail_file_manifest_entry_t *entry = ((manifest_file_ctx_t *)ctx)->entry;
    if (strcmp(key, "file_type") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        entry->file_type = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "flags") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        entry->file_flags = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "size_bytes") == 0) {
        uint64_t v; if (!jp_uint64(j, &v)) return false;
        utils_write_u64_be(entry->original_size, v);
        return true;
    }
    if (strcmp(key, "crc32") == 0) {
        int64_t v; if (!jp_int64(j, &v)) return false;
        utils_write_u32_be(entry->crc32, (uint32_t)v);
        return true;
    }
    return jp_skip_value(j);
}

static bool manifest_v2_file_handler(jp_t *j, const char *key, void *ctx) {
    qmail_ot_manifest_v2_entry_t *entry =
        ((manifest_v2_file_ctx_t *)ctx)->entry;
    if (strcmp(key, "file_type") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        entry->file_type = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "flags") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        entry->file_flags = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "storage_protocol") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        entry->storage_protocol = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "hash_algorithm") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        entry->hash_algorithm = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "object_id") == 0) {
        char hex[QMAIL_OT_ID_SIZE * 2 + 1];
        if (!jp_string(j, hex, sizeof(hex)) ||
            strlen(hex) != QMAIL_OT_ID_SIZE * 2) return false;
        utils_hex_to_bytes(hex, entry->object_id, QMAIL_OT_ID_SIZE);
        return true;
    }
    if (strcmp(key, "generation") == 0) {
        return jp_uint64(j, &entry->generation);
    }
    if (strcmp(key, "size_bytes") == 0) {
        return jp_uint64(j, &entry->original_size);
    }
    if (strcmp(key, "object_hash") == 0) {
        char hex[QMAIL_OT_HASH_SIZE * 2 + 1];
        if (!jp_string(j, hex, sizeof(hex)) ||
            strlen(hex) != QMAIL_OT_HASH_SIZE * 2) return false;
        utils_hex_to_bytes(hex, entry->object_hash, QMAIL_OT_HASH_SIZE);
        return true;
    }
    return jp_skip_value(j);
}

static bool manifest_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_t *r = (qmail_receipt_t *)ctx;
    if (strcmp(key, "version") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        r->upload_manifest_version = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "file_count") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        if (v < 0 || v > QMAIL_TELL_MANIFEST_MAX_FILES) return false;
        r->upload_manifest_file_count = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "entry_size") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        r->upload_manifest_entry_size = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "manifest_len") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        if (v < 0 || v > QMAIL_TELL_MANIFEST_MAX_LEN) return false;
        r->upload_manifest_len = (uint16_t)v;
        return true;
    }
    if (strcmp(key, "flags") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        r->upload_manifest_flags = (uint8_t)v;
        return true;
    }
    if (strcmp(key, "files") == 0) {
        if (!jp_eat(j, '[')) return false;
        jp_skip_ws(j);
        if (jp_eat(j, ']')) {
            r->upload_manifest_file_count = 0;
            return true;
        }
        int parsed = 0;
        while (j->p < j->end && parsed < QMAIL_TELL_MANIFEST_MAX_FILES) {
            if (r->upload_manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
                qmail_ot_manifest_v2_entry_t entry;
                memset(&entry, 0, sizeof(entry));
                manifest_v2_file_ctx_t fctx = { .entry = &entry };
                if (!jp_walk_object(j, manifest_v2_file_handler, &fctx) ||
                    qmail_ot_serialize_manifest_v2_entry(
                        &entry, r->upload_manifest_bytes +
                        (size_t)parsed * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE)
                        != RESULT_SUCCESS) {
                    return false;
                }
            } else {
                qmail_file_manifest_entry_t *entry =
                    &r->upload_manifest_files[parsed];
                memset(entry, 0, sizeof(*entry));
                manifest_file_ctx_t fctx = { .entry = entry };
                if (!jp_walk_object(j, manifest_file_handler, &fctx)) {
                    return false;
                }
            }
            parsed++;
            jp_skip_ws(j);
            if (jp_eat(j, ',')) continue;
            if (jp_eat(j, ']')) {
                r->upload_manifest_file_count = (uint8_t)parsed;
                return true;
            }
            return false;
        }
        return false;
    }
    return jp_skip_value(j);
}

/* ---- recipient handler ---- */
static bool recipient_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_recipient_t *r = (qmail_receipt_recipient_t *)ctx;
    if (strcmp(key, "address") == 0)       return jp_string(j, r->address, sizeof(r->address));
    if (strcmp(key, "kind") == 0)          return jp_string(j, r->kind, sizeof(r->kind));
    if (strcmp(key, "serial_number") == 0) {
        int64_t v; if (!jp_int64(j, &v)) return false;
        r->serial_number = (uint32_t)v;
        return true;
    }
    if (strcmp(key, "denomination") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        r->denomination = (int8_t)v;
        return true;
    }
    if (strcmp(key, "beacon_raida") == 0)  return jp_int(j, &r->beacon_raida);
    if (strcmp(key, "status") == 0) {
        char buf[16];
        if (!jp_string(j, buf, sizeof(buf))) return false;
        r->status = qmail_rcpt_status_from_string(buf);
        return true;
    }
    if (strcmp(key, "attempts") == 0)      return jp_int(j, &r->attempts);
    if (strcmp(key, "last_error") == 0)    return jp_string(j, r->last_error, sizeof(r->last_error));
    if (strcmp(key, "tell_command_code") == 0) return jp_int(j, &r->tell_command_code);
    if (strcmp(key, "started_at") == 0)    return jp_int64(j, &r->started_at);
    if (strcmp(key, "finished_at") == 0)   return jp_int64(j, &r->finished_at);
    return jp_skip_value(j);
}

/* ---- sender handler ---- */
static bool sender_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_t *r = (qmail_receipt_t *)ctx;
    if (strcmp(key, "serial_number") == 0) {
        int64_t v; if (!jp_int64(j, &v)) return false;
        r->sender_serial_number = (uint32_t)v;
        return true;
    }
    if (strcmp(key, "denomination") == 0) {
        int v; if (!jp_int(j, &v)) return false;
        r->sender_denomination = (int8_t)v;
        return true;
    }
    if (strcmp(key, "email") == 0)
        return jp_string(j, r->sender_email, sizeof(r->sender_email));
    return jp_skip_value(j);
}

/* ---- upload section handler ---- */
static bool upload_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_t *r = (qmail_receipt_t *)ctx;
    if (strcmp(key, "status") == 0)        return jp_string(j, r->upload_status, sizeof(r->upload_status));
    if (strcmp(key, "started_at") == 0)    return jp_int64(j, &r->upload_started_at);
    if (strcmp(key, "finished_at") == 0)   return jp_int64(j, &r->upload_finished_at);
    if (strcmp(key, "subject") == 0)       return jp_string(j, r->subject, sizeof(r->subject));
    if (strcmp(key, "body_preview") == 0)  return jp_string(j, r->body_preview, sizeof(r->body_preview));
    if (strcmp(key, "files") == 0) {
        if (!jp_eat(j, '[')) return false;
        jp_skip_ws(j);
        if (jp_eat(j, ']')) return true;
        while (j->p < j->end && r->upload_file_count < QMAIL_RECEIPT_MAX_FILES) {
            qmail_receipt_file_t *fe = &r->upload_files[r->upload_file_count];
            memset(fe, 0, sizeof(*fe));
            file_ctx_t fctx = { .fe = fe };
            if (!jp_walk_object(j, file_handler, &fctx)) return false;
            r->upload_file_count++;
            jp_skip_ws(j);
            if (jp_eat(j, ',')) continue;
            if (jp_eat(j, ']')) return true;
            return false;
        }
        return false;
    }
    if (strcmp(key, "servers") == 0) {
        /* Parse the small inner object inline. */
        if (!jp_eat(j, '{')) return false;
        while (j->p < j->end) {
            char k[16];
            if (!jp_string(j, k, sizeof(k))) return false;
            if (!jp_eat(j, ':')) return false;
            int v;
            if (!jp_int(j, &v)) return false;
            if (strcmp(k, "total") == 0) r->upload_servers_total = v;
            else if (strcmp(k, "ok") == 0) r->upload_servers_ok = v;
            else if (strcmp(k, "fail") == 0) r->upload_servers_fail = v;
            jp_skip_ws(j);
            if (jp_eat(j, ',')) continue;
            if (jp_eat(j, '}')) return true;
            return false;
        }
        return false;
    }
    if (strcmp(key, "total_group_size") == 0) {
        return jp_uint64(j, &r->upload_total_group_size);
    }
    if (strcmp(key, "manifest") == 0)
        return jp_walk_object(j, manifest_handler, r);
    if (strcmp(key, "inbox_fee_acquired") == 0) {
        /* "true" or "false" — read raw token. */
        jp_skip_ws(j);
        if (j->p < j->end && *j->p == 't') {
            r->upload_inbox_fee_acquired = true;
            return jp_skip_value(j);
        }
        r->upload_inbox_fee_acquired = false;
        return jp_skip_value(j);
    }
    if (strcmp(key, "inbox_fee_locker") == 0)
        return jp_string(j, r->upload_inbox_fee_locker, sizeof(r->upload_inbox_fee_locker));
    return jp_skip_value(j);
}

/* ---- tell section handler ---- */
static bool tell_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_t *r = (qmail_receipt_t *)ctx;
    if (strcmp(key, "status") == 0)       return jp_string(j, r->tell_status, sizeof(r->tell_status));
    if (strcmp(key, "started_at") == 0)   return jp_int64(j, &r->tell_started_at);
    if (strcmp(key, "finished_at") == 0)  return jp_int64(j, &r->tell_finished_at);
    if (strcmp(key, "recipients") == 0) {
        if (!jp_eat(j, '[')) return false;
        jp_skip_ws(j);
        if (jp_eat(j, ']')) return true;
        while (j->p < j->end && r->tell_recipient_count < QMAIL_RECEIPT_MAX_RECIPIENTS) {
            qmail_receipt_recipient_t *rc = &r->tell_recipients[r->tell_recipient_count];
            memset(rc, 0, sizeof(*rc));
            if (!jp_walk_object(j, recipient_handler, rc)) return false;
            r->tell_recipient_count++;
            jp_skip_ws(j);
            if (jp_eat(j, ',')) continue;
            if (jp_eat(j, ']')) return true;
            return false;
        }
        return false;
    }
    if (strcmp(key, "summary") == 0) {
        if (!jp_eat(j, '{')) return false;
        while (j->p < j->end) {
            char k[24];
            if (!jp_string(j, k, sizeof(k))) return false;
            if (!jp_eat(j, ':')) return false;
            int v;
            if (!jp_int(j, &v)) return false;
            if (strcmp(k, "total") == 0)              r->tell_summary_total = v;
            else if (strcmp(k, "queued") == 0)        r->tell_summary_queued = v;
            else if (strcmp(k, "sending") == 0)       r->tell_summary_sending = v;
            else if (strcmp(k, "sent") == 0)          r->tell_summary_sent = v;
            else if (strcmp(k, "failed") == 0)        r->tell_summary_failed = v;
            else if (strcmp(k, "retry_queued") == 0)  r->tell_summary_retry_queued = v;
            jp_skip_ws(j);
            if (jp_eat(j, ',')) continue;
            if (jp_eat(j, '}')) return true;
            return false;
        }
        return false;
    }
    return jp_skip_value(j);
}

/* ---- top-level handler ---- */
static bool top_handler(jp_t *j, const char *key, void *ctx) {
    qmail_receipt_t *r = (qmail_receipt_t *)ctx;
    if (strcmp(key, "version") == 0)      return jp_int(j, &r->version);
    if (strcmp(key, "file_guid") == 0) {
        char hex[QMAIL_GUID_SIZE * 2 + 1];
        if (!jp_string(j, hex, sizeof(hex))) return false;
        return guid_from_hex(hex, r->file_guid);
    }
    if (strcmp(key, "request_id") == 0)   return jp_string(j, r->request_id, sizeof(r->request_id));
    if (strcmp(key, "created_at") == 0)   return jp_int64(j, &r->created_at);
    if (strcmp(key, "updated_at") == 0)   return jp_int64(j, &r->updated_at);
    if (strcmp(key, "wallet_path") == 0)  return jp_string(j, r->wallet_path, sizeof(r->wallet_path));
    if (strcmp(key, "sender") == 0)       return jp_walk_object(j, sender_handler, r);
    if (strcmp(key, "upload") == 0)       return jp_walk_object(j, upload_handler, r);
    if (strcmp(key, "tell") == 0)         return jp_walk_object(j, tell_handler, r);
    return jp_skip_value(j);
}

// ============================================================================
// LOAD / LOAD_RAW
// ============================================================================

result_t qmail_receipt_load_raw(const char *wallet_path,
                                const uint8_t file_guid[QMAIL_GUID_SIZE],
                                char **out_bytes, size_t *out_len) {
    if (!wallet_path || !file_guid || !out_bytes || !out_len) return RESULT_INVALID_PARAM;
    *out_bytes = NULL;
    *out_len = 0;

    char path[MAX_PATH_LEN];
    if (qmail_receipt_path(wallet_path, file_guid, path, sizeof(path)) != RESULT_SUCCESS)
        return RESULT_ERROR;

    FILE *f = fopen(path, "rb");
    if (!f) return RESULT_NOT_FOUND;

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size <= 0 || size > 4 * 1024 * 1024) { fclose(f); return RESULT_ERROR; }

    char *buf = (char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); return RESULT_MEMORY_ERROR; }
    size_t got = fread(buf, 1, (size_t)size, f);
    fclose(f);
    if (got != (size_t)size) { free(buf); return RESULT_FILE_ERROR; }
    buf[size] = '\0';

    *out_bytes = buf;
    *out_len = (size_t)size;
    return RESULT_SUCCESS;
}

result_t qmail_receipt_load(const char *wallet_path,
                            const uint8_t file_guid[QMAIL_GUID_SIZE],
                            qmail_receipt_t *out) {
    if (!out) return RESULT_INVALID_PARAM;
    char *bytes = NULL;
    size_t len = 0;
    result_t r = qmail_receipt_load_raw(wallet_path, file_guid, &bytes, &len);
    if (r != RESULT_SUCCESS) return r;

    memset(out, 0, sizeof(*out));
    jp_t j = { .p = bytes, .end = bytes + len };
    bool ok = jp_walk_object(&j, top_handler, out);
    free(bytes);
    if (!ok) {
        log_error(LOG_CAT_GENERAL, "qmail_receipt_load: parse failed");
        return RESULT_ERROR;
    }
    /* Always trust the loaded file_guid against the caller's. */
    if (memcmp(out->file_guid, file_guid, QMAIL_GUID_SIZE) != 0) {
        log_error(LOG_CAT_GENERAL,
                  "qmail_receipt_load: file_guid mismatch in %s", out->wallet_path);
        return RESULT_ERROR;
    }
    return RESULT_SUCCESS;
}

// ============================================================================
// INIT / ARTIFACTS APPLY
// ============================================================================

void qmail_receipt_init(qmail_receipt_t *receipt,
                        const char *wallet_path,
                        const uint8_t file_guid[QMAIL_GUID_SIZE],
                        const char *request_id) {
    if (!receipt) return;
    memset(receipt, 0, sizeof(*receipt));
    if (file_guid) memcpy(receipt->file_guid, file_guid, QMAIL_GUID_SIZE);
    if (wallet_path)
        strncpy(receipt->wallet_path, wallet_path, sizeof(receipt->wallet_path) - 1);
    if (request_id)
        strncpy(receipt->request_id, request_id, sizeof(receipt->request_id) - 1);
    receipt->version    = QMAIL_RECEIPT_SCHEMA_VERSION;
    receipt->created_at = (int64_t)time(NULL);
    receipt->updated_at = receipt->created_at;
    strcpy(receipt->upload_status, "in_progress");
    strcpy(receipt->tell_status,   "not_started");
}

void qmail_receipt_apply_upload_artifacts(qmail_receipt_t *receipt,
                                          const qmail_upload_artifacts_t *art,
                                          bool upload_succeeded) {
    if (!receipt || !art) return;

    /* Sender identity (NON-secret subset only — sender_ans EXCLUDED) */
    receipt->sender_serial_number = art->sender_serial_number;
    receipt->sender_denomination  = art->sender_denomination;
    /* sender_email is filled by the caller from the wallet's identity */

    /* Upload-side roll-up */
    receipt->upload_servers_total = art->upload_successes + art->upload_failures;
    receipt->upload_servers_ok    = art->upload_successes;
    receipt->upload_servers_fail  = art->upload_failures;
    receipt->upload_finished_at   = (int64_t)time(NULL);
    strcpy(receipt->upload_status, upload_succeeded ? "success" : "failed");
    receipt->upload_total_group_size = art->total_group_size;
    receipt->upload_manifest_version = art->manifest_version;
    receipt->upload_manifest_file_count = (uint8_t)art->file_count;
    receipt->upload_manifest_entry_size = art->file_entry_size;
    receipt->upload_manifest_len = art->manifest_len;
    receipt->upload_manifest_flags = art->manifest_flags;
    if (art->manifest_len > 0 && art->manifest_len <= QMAIL_TELL_MANIFEST_MAX_LEN) {
        if (art->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
            memcpy(receipt->upload_manifest_bytes, art->manifest_bytes,
                   art->manifest_len);
        } else {
            memcpy(receipt->upload_manifest_files, art->manifest_files,
                   art->manifest_len);
        }
    }

    receipt->upload_inbox_fee_acquired = art->inbox_fee_acquired;
    receipt->upload_inbox_fee_locker[0] = '\0';
    if (art->inbox_fee_acquired) {
        if (art->pool_acq.inbox_fee_key[0]) {
            strncpy(receipt->upload_inbox_fee_locker,
                    art->pool_acq.inbox_fee_key,
                    sizeof(receipt->upload_inbox_fee_locker) - 1);
        } else {
            size_t copy_len = sizeof(receipt->upload_inbox_fee_locker) - 1;
            if (copy_len > QMAIL_LOCKER_CODE_SIZE) copy_len = QMAIL_LOCKER_CODE_SIZE;
            memcpy(receipt->upload_inbox_fee_locker,
                   art->inbox_fee_locker,
                   copy_len);
            receipt->upload_inbox_fee_locker[copy_len] = '\0';
        }
    }
}

// ============================================================================
// PER-RECIPIENT UPDATE (used by the retry worker)
// ============================================================================

result_t qmail_receipt_update_recipient(const char *wallet_path,
                                        const uint8_t file_guid[QMAIL_GUID_SIZE],
                                        uint32_t serial_number,
                                        int beacon_raida,
                                        qmail_rcpt_status_t new_status,
                                        const char *last_error) {
    qmail_receipt_t receipt;
    result_t r = qmail_receipt_load(wallet_path, file_guid, &receipt);
    if (r != RESULT_SUCCESS) return r;

    int64_t now_ts = (int64_t)time(NULL);
    int matches = 0;
    for (int i = 0; i < receipt.tell_recipient_count; i++) {
        qmail_receipt_recipient_t *rc = &receipt.tell_recipients[i];
        if (rc->beacon_raida == beacon_raida
            && (serial_number == 0 || rc->serial_number == serial_number)) {
            matches++;
            rc->status = new_status;
            rc->attempts++;
            if (last_error) {
                strncpy(rc->last_error, last_error, sizeof(rc->last_error) - 1);
                rc->last_error[sizeof(rc->last_error) - 1] = '\0';
            } else if (new_status == QMAIL_RCPT_STATUS_SENT) {
                rc->last_error[0] = '\0';
            }
            if (new_status == QMAIL_RCPT_STATUS_SENDING && rc->started_at == 0)
                rc->started_at = now_ts;
            if (new_status == QMAIL_RCPT_STATUS_SENT || new_status == QMAIL_RCPT_STATUS_FAILED)
                rc->finished_at = now_ts;
        }
    }
    if (matches == 0) return RESULT_NOT_FOUND;

    /* Recompute summary */
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

    /* Roll up tell.status. */
    if (st == receipt.tell_recipient_count) {
        strcpy(receipt.tell_status, "success");
        receipt.tell_finished_at = now_ts;
    } else if (fa == receipt.tell_recipient_count) {
        strcpy(receipt.tell_status, "failed");
        receipt.tell_finished_at = now_ts;
    } else if (st > 0 || fa > 0 || rq > 0) {
        strcpy(receipt.tell_status, "partial");
    } else {
        strcpy(receipt.tell_status, "in_progress");
    }

    return qmail_receipt_save(&receipt);
}
