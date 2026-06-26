/**
 * qmail_receive.c - Receive Email Orchestrator
 *
 * Flow: download stripes in parallel -> recover missing -> reassemble -> store
 * Server count and stripe count are determined at runtime.
 */

#include "qmail/qmail_receive.h"
#include "qmail/qmail_commands.h"
#include "qmail/qmail_preamble.h"
#include "qmail/qmail_servers.h"
#include "qmail/qmail_striping.h"
#include "qmail/qmail_crypto.h"
#include "qmail/qmail_cbdf.h"
#include "qmail/qmail_db.h"
#include "qmail/qmail_users.h"
#include "qmail/qmail_object_transfer.h"
#include "qmail/qmail_receive_object_transfer.h"
#include "encryption_key.h"
#include "executor.h"
#include "filesystem.h"
#include "raida_status.h"
#include "logging.h"
#include "results.h"
#include "utils.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <time.h>
#include <errno.h>

extern result_t create_directory_recursive(const char *path);

#define QMAIL_ATTACHMENT_STORE_DIR "QMail_Attachments"

// ============================================================================
// PARALLEL DOWNLOAD SUPPORT
// ============================================================================

/** Context for parallel stripe downloads across multiple QMail servers */
typedef struct {
    /* Per-server download contexts (indexed by position in notification->servers) */
    qmail_download_context_t per_server[QMAIL_MAX_SERVERS];
    /* RAIDA index -> server position mapping (-1 if not targeted) */
    int raida_to_position[RAIDA_COUNT];
} parallel_download_ctx_t;

static result_t parallel_download_build_body(uint8_t raida_id,
                                             uint8_t **body, size_t *body_size,
                                             void *user_data);

static result_t append_bytes(uint8_t **buf, size_t *len, size_t *cap,
                             const uint8_t *data, size_t data_len) {
    if (!buf || !len || !cap || (!data && data_len > 0)) return RESULT_INVALID_PARAM;
    if (data_len == 0) return RESULT_SUCCESS;

    if (*len > SIZE_MAX - data_len) return RESULT_MEMORY_ERROR;
    size_t need = *len + data_len;
    if (need > *cap) {
        size_t new_cap = (*cap > 0) ? *cap : 4096;
        while (new_cap < need) {
            if (new_cap > SIZE_MAX / 2) {
                new_cap = need;
                break;
            }
            new_cap *= 2;
        }
        uint8_t *tmp = (uint8_t *)realloc(*buf, new_cap);
        if (!tmp) return RESULT_MEMORY_ERROR;
        *buf = tmp;
        *cap = new_cap;
    }

    memcpy(*buf + *len, data, data_len);
    *len += data_len;
    return RESULT_SUCCESS;
}

static int notification_data_stripe_count(const qmail_tell_notification_t *notification) {
    if (!notification) return 0;

    int parity_index = -1;
    int data_count = 0;
    int max_data_index = -1;
    int server_count = notification->server_count;
    if (server_count > QMAIL_MAX_SERVERS) server_count = QMAIL_MAX_SERVERS;

    for (int i = 0; i < server_count; i++) {
        int stripe_idx = notification->servers[i].stripe_index;
        if (stripe_idx < 0 || stripe_idx >= QMAIL_MAX_SERVERS) continue;

        if (notification->servers[i].stripe_type == 1) {
            if (parity_index < 0 || stripe_idx < parity_index)
                parity_index = stripe_idx;
        } else {
            data_count++;
            if (stripe_idx > max_data_index) max_data_index = stripe_idx;
        }
    }

    if (parity_index > 0) return parity_index;
    if (max_data_index >= 0 && max_data_index + 1 > data_count)
        return max_data_index + 1;
    return data_count;
}

static bool notification_has_manifest_v1(const qmail_tell_notification_t *notification) {
    return notification &&
           notification->manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 &&
           notification->file_count > 0 &&
           notification->file_count <= QMAIL_TELL_MANIFEST_MAX_FILES &&
           notification->file_entry_size == QMAIL_TELL_MANIFEST_ENTRY_SIZE &&
           notification->manifest_len ==
               (uint16_t)(notification->file_count * notification->file_entry_size);
}

static bool notification_has_revised_manifest(
        const qmail_tell_notification_t *notification) {
    return notification &&
           notification->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2 &&
           notification->file_count > 0 &&
           notification->file_count <= QMAIL_TELL_MANIFEST_MAX_FILES &&
           notification->file_entry_size == QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE &&
           notification->manifest_len ==
               (uint16_t)(notification->file_count *
                          notification->file_entry_size);
}

static bool notification_revised_entry(
        const qmail_tell_notification_t *notification,
        int index,
        qmail_ot_manifest_v2_entry_t *entry) {
    if (!notification_has_revised_manifest(notification) || !entry ||
        index < 0 || index >= notification->file_count) {
        return false;
    }
    return qmail_ot_parse_manifest_v2_entry(
               notification->manifest_bytes +
                   (size_t)index * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE,
               entry) == RESULT_SUCCESS;
}

static bool revised_entry_is_meta_or_body(
        const qmail_ot_manifest_v2_entry_t *entry) {
    return entry &&
           ((entry->file_flags & QMAIL_FILE_MANIFEST_FLAG_META) ||
            (entry->file_flags & QMAIL_FILE_MANIFEST_FLAG_BODY) ||
            entry->file_type == QMAIL_FILE_META ||
            entry->file_type == QMAIL_FILE_BODY);
}

static bool notification_find_revised_entry(
        const qmail_tell_notification_t *notification,
        uint8_t required_flag,
        uint8_t fallback_file_type,
        qmail_ot_manifest_v2_entry_t *entry_out) {
    if (!notification_has_revised_manifest(notification) || !entry_out) {
        return false;
    }
    for (int i = 0; i < notification->file_count; ++i) {
        qmail_ot_manifest_v2_entry_t entry;
        if (!notification_revised_entry(notification, i, &entry)) return false;
        if ((entry.file_flags & required_flag) ||
            entry.file_type == fallback_file_type) {
            *entry_out = entry;
            return true;
        }
    }
    return false;
}

static const qmail_file_manifest_entry_t *notification_body_entry(
        const qmail_tell_notification_t *notification) {
    if (!notification_has_manifest_v1(notification)) return NULL;
    for (int i = 0; i < notification->file_count; i++) {
        const qmail_file_manifest_entry_t *entry = &notification->files[i];
        if ((entry->file_flags & QMAIL_FILE_MANIFEST_FLAG_BODY) ||
            entry->file_type == QMAIL_FILE_BODY) {
            return entry;
        }
    }
    for (int i = 0; i < notification->file_count; i++) {
        const qmail_file_manifest_entry_t *entry = &notification->files[i];
        if ((entry->file_flags & QMAIL_FILE_MANIFEST_FLAG_META) ||
            entry->file_type == QMAIL_FILE_META) {
            continue;
        }
        return entry;
    }
    return NULL;
}

static const qmail_file_manifest_entry_t *notification_meta_entry(
        const qmail_tell_notification_t *notification) {
    if (!notification_has_manifest_v1(notification)) return NULL;
    for (int i = 0; i < notification->file_count; i++) {
        const qmail_file_manifest_entry_t *entry = &notification->files[i];
        if ((entry->file_flags & QMAIL_FILE_MANIFEST_FLAG_META) ||
            entry->file_type == QMAIL_FILE_META) {
            return entry;
        }
    }
    return NULL;
}

static bool notification_entry_is_meta_or_body(
        const qmail_file_manifest_entry_t *entry) {
    if (!entry) return false;
    return (entry->file_flags & QMAIL_FILE_MANIFEST_FLAG_META) ||
           (entry->file_flags & QMAIL_FILE_MANIFEST_FLAG_BODY) ||
           entry->file_type == QMAIL_FILE_META ||
           entry->file_type == QMAIL_FILE_BODY;
}

static int notification_manifest_attachment_count(
        const qmail_tell_notification_t *notification) {
    int count = 0;
    if (notification_has_manifest_v1(notification)) {
        for (int i = 0; i < notification->file_count; i++) {
            const qmail_file_manifest_entry_t *entry = &notification->files[i];
            if (notification_entry_is_meta_or_body(entry) ||
                entry->file_type < QMAIL_FILE_ATTACHMENT_1) {
                continue;
            }
            count++;
        }
    } else if (notification_has_revised_manifest(notification)) {
        for (int i = 0; i < notification->file_count; ++i) {
            qmail_ot_manifest_v2_entry_t entry;
            if (!notification_revised_entry(notification, i, &entry)) return 0;
            if (revised_entry_is_meta_or_body(&entry) ||
                entry.file_type < QMAIL_FILE_ATTACHMENT_1) {
                continue;
            }
            count++;
        }
    }
    return count;
}

static bool qmail_receive_invalid_filename_char(char ch) {
    switch (ch) {
    case '\\':
    case '/':
    case ':':
    case '*':
    case '?':
    case '"':
    case '<':
    case '>':
    case '|':
        return true;
    default:
        return false;
    }
}

static void qmail_receive_apply_attachment_filename(const char *metadata_name,
                                                    char *name,
                                                    size_t name_size,
                                                    char *extension,
                                                    size_t extension_size) {
    if (name && name_size > 0) name[0] = '\0';
    if (extension && extension_size > 0) extension[0] = '\0';
    if (!metadata_name || !metadata_name[0] || !name || name_size == 0) return;

    const char *base = metadata_name;
    for (const char *p = metadata_name; *p; p++) {
        if (*p == '/' || *p == '\\') base = p + 1;
    }

    size_t out = 0;
    for (const char *p = base; *p && out + 1 < name_size; p++) {
        unsigned char ch = (unsigned char)*p;
        if (ch < 32 || ch == 127 || qmail_receive_invalid_filename_char(*p)) continue;
        name[out++] = *p;
    }
    name[out] = '\0';

    while (out > 0 && (name[out - 1] == ' ' || name[out - 1] == '.')) {
        name[--out] = '\0';
    }
    if (out == 0 || !extension || extension_size == 0) return;

    const char *dot = strrchr(name, '.');
    if (dot && dot != name && dot[1] != '\0') {
        size_t ext_len = strlen(dot + 1);
        if (ext_len >= extension_size) ext_len = extension_size - 1;
        memcpy(extension, dot + 1, ext_len);
        extension[ext_len] = '\0';
    }
}

static void qmail_receive_sanitize_extension(const char *extension,
                                             char *out,
                                             size_t out_size) {
    if (!out || out_size == 0) return;
    out[0] = '\0';

    if (!extension || !extension[0]) {
        strncpy(out, "bin", out_size - 1);
        out[out_size - 1] = '\0';
        return;
    }

    size_t off = 0;
    for (const char *p = extension; *p && off + 1 < out_size; p++) {
        unsigned char ch = (unsigned char)*p;
        if ((ch >= 'a' && ch <= 'z') ||
            (ch >= 'A' && ch <= 'Z') ||
            (ch >= '0' && ch <= '9')) {
            out[off++] = (char)ch;
        }
    }
    out[off] = '\0';

    if (out[0] == '\0') {
        strncpy(out, "bin", out_size - 1);
        out[out_size - 1] = '\0';
    }
}

static result_t qmail_receive_external_attachment_path(
        const qmail_attachment_t *att,
        char file_path[QMAIL_ATTACHMENT_PATH_LEN]) {
    if (!att || !file_path) return RESULT_INVALID_PARAM;

    char client_data[MAX_PATH_LEN];
    platform_get_client_data_dir(client_data);

    char root_dir[QMAIL_ATTACHMENT_PATH_LEN];
    int n = snprintf(root_dir, sizeof(root_dir), "%s%s%s",
                     client_data, PATH_SEPARATOR_STR, QMAIL_ATTACHMENT_STORE_DIR);
    if (n < 0 || (size_t)n >= sizeof(root_dir)) return RESULT_FILE_ERROR;

    result_t dir_res = create_directory_recursive(root_dir);
    if (dir_res != RESULT_SUCCESS) return dir_res;

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    utils_bytes_to_hex(att->email_id, QMAIL_GUID_SIZE, guid_hex);

    char msg_dir[QMAIL_ATTACHMENT_PATH_LEN];
    n = snprintf(msg_dir, sizeof(msg_dir), "%s%s%s",
                 root_dir, PATH_SEPARATOR_STR, guid_hex);
    if (n < 0 || (size_t)n >= sizeof(msg_dir)) return RESULT_FILE_ERROR;

    dir_res = create_directory_recursive(msg_dir);
    if (dir_res != RESULT_SUCCESS) return dir_res;

    char ext[sizeof(att->extension)];
    qmail_receive_sanitize_extension(att->extension, ext, sizeof(ext));
    n = snprintf(file_path, QMAIL_ATTACHMENT_PATH_LEN, "%s%s%02X.%s",
                 msg_dir, PATH_SEPARATOR_STR, att->file_type, ext);
    return n < 0 || n >= QMAIL_ATTACHMENT_PATH_LEN
        ? RESULT_FILE_ERROR : RESULT_SUCCESS;
}

static result_t qmail_receive_write_external_attachment(qmail_attachment_t *att,
                                                        const uint8_t *data,
                                                        size_t data_len) {
    if (!att || (!data && data_len > 0)) return RESULT_INVALID_PARAM;

    char file_path[QMAIL_ATTACHMENT_PATH_LEN];
    result_t path_result =
        qmail_receive_external_attachment_path(att, file_path);
    if (path_result != RESULT_SUCCESS) return path_result;

    char tmp_path[QMAIL_ATTACHMENT_PATH_LEN];
    int n = snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", file_path);
    if (n < 0 || (size_t)n >= sizeof(tmp_path)) return RESULT_FILE_ERROR;

    FILE *fp = fopen(tmp_path, "wb");
    if (!fp) {
        log_error(LOG_CAT_COMMAND,
                  "QMail RECEIVE: cannot create attachment file %s (errno=%d: %s)",
                  tmp_path, errno, strerror(errno));
        return RESULT_FILE_ERROR;
    }

    if (data_len > 0 && fwrite(data, 1, data_len, fp) != data_len) {
        log_error(LOG_CAT_COMMAND,
                  "QMail RECEIVE: failed writing attachment file %s (errno=%d: %s)",
                  tmp_path, errno, strerror(errno));
        fclose(fp);
        remove(tmp_path);
        return RESULT_FILE_ERROR;
    }

    if (fclose(fp) != 0) {
        log_error(LOG_CAT_COMMAND,
                  "QMail RECEIVE: failed closing attachment file %s (errno=%d: %s)",
                  tmp_path, errno, strerror(errno));
        remove(tmp_path);
        return RESULT_FILE_ERROR;
    }

    result_t rename_res = fs_atomic_rename(tmp_path, file_path);
    if (rename_res != RESULT_SUCCESS) {
        remove(tmp_path);
        return rename_res;
    }

    att->storage_mode = QMAIL_STORAGE_EXTERNAL;
    att->data_blob = NULL;
    att->data_size = 0;
    att->size_bytes = data_len;
    strncpy(att->file_path, file_path, sizeof(att->file_path) - 1);
    att->file_path[sizeof(att->file_path) - 1] = '\0';
    return RESULT_SUCCESS;
}

static result_t download_reassemble_file(const qmail_tell_notification_t *notification,
                                         core_transport_t *transport_iface,
                                         const raida_encryption_key_t *enc_key,
                                         uint8_t file_type,
                                         size_t original_len,
                                         bool verify_crc,
                                         uint32_t expected_crc,
                                         uint8_t **out_data,
                                         size_t *out_len,
                                         int *stripes_downloaded_out,
                                         int *stripes_recovered_out,
                                         char *error_out,
                                         size_t error_out_size) {
    if (!notification || !transport_iface || !enc_key || !enc_key->valid ||
        !out_data || !out_len) {
        return RESULT_INVALID_PARAM;
    }

    *out_data = NULL;
    *out_len = 0;
    if (stripes_downloaded_out) *stripes_downloaded_out = 0;
    if (stripes_recovered_out) *stripes_recovered_out = 0;

    int download_count = notification->server_count;
    if (download_count > QMAIL_MAX_SERVERS) download_count = QMAIL_MAX_SERVERS;
    if (download_count <= 0) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size, "No servers in tell notification");
        return RESULT_ERROR;
    }

    int data_stripe_count = notification_data_stripe_count(notification);
    if (data_stripe_count <= 0 || data_stripe_count > QMAIL_MAX_SERVERS) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size, "Invalid data stripe count");
        return RESULT_ERROR;
    }

    parallel_download_ctx_t *pctx =
        (parallel_download_ctx_t *)calloc(1, sizeof(parallel_download_ctx_t));
    if (!pctx) return RESULT_MEMORY_ERROR;

    for (int i = 0; i < RAIDA_COUNT; i++) pctx->raida_to_position[i] = -1;

    bool active[QMAIL_MAX_SERVERS] = {false};
    bool got_any_for_pos[QMAIL_MAX_SERVERS] = {false};
    int include_count = 0;

    for (int i = 0; i < download_count; i++) {
        uint8_t server_raida = notification->servers[i].server_id;
        if (server_raida >= RAIDA_COUNT) {
            log_warn(LOG_CAT_COMMAND,
                     "QMail download: invalid server_id %d at position %d, skipping",
                     server_raida, i);
            continue;
        }

        pctx->raida_to_position[server_raida] = i;
        active[i] = true;
        include_count++;

        qmail_download_context_t *dl_ctx = &pctx->per_server[i];
        memcpy(dl_ctx->file_guid, notification->file_guid, QMAIL_GUID_SIZE);
        memcpy(dl_ctx->locker_code, notification->locker_code, 16);
        dl_ctx->file_type = file_type;
        dl_ctx->version = 0x02;
        dl_ctx->bytes_per_page = 0;
        dl_ctx->page_number = 0;
        dl_ctx->denomination = enc_key->denomination;
        dl_ctx->serial_number = enc_key->serial_number;
        memcpy(dl_ctx->an, enc_key->ans[server_raida], AN_LENGTH);
        dl_ctx->device_id = 1;
    }

    if (include_count == 0) {
        free(pctx);
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size, "No valid servers to download from");
        return RESULT_ERROR;
    }

    uint8_t *downloaded_stripes[QMAIL_MAX_SERVERS] = {NULL};
    size_t downloaded_sizes[QMAIL_MAX_SERVERS] = {0};
    size_t downloaded_caps[QMAIL_MAX_SERVERS] = {0};
    bool stripe_ok[QMAIL_MAX_SERVERS] = {false};
    bool page_limit_reached = false;

    for (uint32_t page = 0; page < QMAIL_MAX_PAGES; page++) {
        uint8_t page_raidas[QMAIL_MAX_SERVERS];
        int page_count = 0;
        for (int i = 0; i < download_count; i++) {
            if (!active[i]) continue;
            uint8_t server_raida = notification->servers[i].server_id;
            if (server_raida >= RAIDA_COUNT) continue;
            pctx->per_server[i].page_number = page;
            page_raidas[page_count++] = server_raida;
        }
        if (page_count == 0) break;

        exec_config_t config;
        exec_config_init(&config);
        config.transport = TRANSPORT_TCP;
        config.mode = EXEC_MODE_PARALLEL;
        config.timeout_ms = 30000;
        config.transport_iface = transport_iface;
        config.include_only = page_raidas;
        config.include_count = page_count;
        config.early_finish_count = 0;
        config.early_finish_grace_ms = 0;

        qmail_encryption_state_t page_enc_state;
        qmail_apply_encryption_key(enc_key, &config, &page_enc_state);

        exec_results_t exec_results;
        exec_results_init(&exec_results);

        log_info(LOG_CAT_COMMAND,
                 "QMail receive: downloading file_type=0x%02X page=%u from %d servers",
                 file_type, page, page_count);

        result_t exec_res = executor_run(CMD_GROUP_QMAIL, CMD_QMAIL_DOWNLOAD,
                                         parallel_download_build_body, pctx,
                                         &config, &exec_results);
        if (exec_res != RESULT_SUCCESS) {
            log_warn(LOG_CAT_COMMAND,
                     "QMail download file_type=0x%02X page=%u executor failed (%s)",
                     file_type, page, result_to_string(exec_res));
        }

        for (int i = 0; i < download_count; i++) {
            if (!active[i]) continue;
            uint8_t server_raida = notification->servers[i].server_id;
            int stripe_idx = notification->servers[i].stripe_index;
            if (server_raida >= RAIDA_COUNT ||
                stripe_idx < 0 || stripe_idx >= QMAIL_MAX_SERVERS) {
                active[i] = false;
                continue;
            }

            raida_result_t *rr = &exec_results.results[server_raida];
            uint8_t dl_status = rr->has_response ? rr->response.status : 0;
            if (rr->success && raida_status_is_success(dl_status) &&
                rr->has_response && rr->response.body_len > 10 && rr->response.body) {
                size_t stripe_len = rr->response.body_len - 10;
                result_t ar = append_bytes(&downloaded_stripes[stripe_idx],
                                           &downloaded_sizes[stripe_idx],
                                           &downloaded_caps[stripe_idx],
                                           rr->response.body + 8, stripe_len);
                if (ar != RESULT_SUCCESS) {
                    exec_results_free(&exec_results);
                    for (int s = 0; s < QMAIL_MAX_SERVERS; s++) free(downloaded_stripes[s]);
                    free(pctx);
                    return ar;
                }
                got_any_for_pos[i] = true;
                stripe_ok[stripe_idx] = true;

                if (stripe_len < QMAIL_DOWNLOAD_PAGE_SIZE) {
                    active[i] = false;
                }
            } else {
                if (!got_any_for_pos[i]) {
                    log_warn(LOG_CAT_COMMAND,
                             "QMail download stripe %d type=0x%02X from RAIDA %2d failed on page %u: status=0x%02X %s",
                             stripe_idx, file_type, server_raida, page,
                             dl_status, rr->error_message);
                }
                active[i] = false;
            }
        }

        exec_results_free(&exec_results);
    }

    for (int i = 0; i < download_count; i++) {
        if (active[i]) {
            page_limit_reached = true;
            break;
        }
    }

    free(pctx);

    if (page_limit_reached) {
        for (int s = 0; s < QMAIL_MAX_SERVERS; s++) free(downloaded_stripes[s]);
        if (error_out && error_out_size) {
            snprintf(error_out, error_out_size,
                     "Download exceeded QMail page limit (%u pages of %u bytes)",
                     (unsigned)QMAIL_MAX_PAGES,
                     (unsigned)QMAIL_DOWNLOAD_PAGE_SIZE);
        }
        log_error(LOG_CAT_COMMAND,
                  "QMail download file_type=0x%02X exceeded page limit (%u pages)",
                  file_type, (unsigned)QMAIL_MAX_PAGES);
        return RESULT_ERROR;
    }

    int success_count = 0;
    int parity_stripe_idx = -1;
    for (int i = 0; i < download_count; i++) {
        int stripe_idx = notification->servers[i].stripe_index;
        if (stripe_idx < 0 || stripe_idx >= QMAIL_MAX_SERVERS) continue;
        if (stripe_ok[stripe_idx]) {
            success_count++;
            if (notification->servers[i].stripe_type == 1)
                parity_stripe_idx = stripe_idx;
        }
    }
    if (stripes_downloaded_out) *stripes_downloaded_out = success_count;

    if (success_count < data_stripe_count) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size,
                     "Insufficient stripes for file_type 0x%02X: %d/%d downloaded",
                     file_type, success_count, data_stripe_count);
        for (int i = 0; i < QMAIL_MAX_SERVERS; i++) free(downloaded_stripes[i]);
        return RESULT_ERROR;
    }

    const uint8_t *data_stripes[QMAIL_MAX_SERVERS] = {NULL};
    size_t data_sizes[QMAIL_MAX_SERVERS] = {0};
    uint8_t *recovered_stripe = NULL;
    int missing_data = -1;
    int missing_count = 0;

    for (int si = 0; si < data_stripe_count; si++) {
        if (stripe_ok[si]) {
            data_stripes[si] = downloaded_stripes[si];
            data_sizes[si] = downloaded_sizes[si];
        } else {
            missing_data = si;
            missing_count++;
        }
    }

    if (missing_count > 1) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size,
                     "Missing %d data stripes for file_type 0x%02X",
                     missing_count, file_type);
        for (int i = 0; i < QMAIL_MAX_SERVERS; i++) free(downloaded_stripes[i]);
        return RESULT_ERROR;
    }

    if (missing_count == 1 && parity_stripe_idx >= 0 && stripe_ok[parity_stripe_idx]) {
        size_t recovered_size = 0;
        result_t rec_res = qmail_stripe_recover(data_stripes, data_sizes,
                                                 data_stripe_count,
                                                 downloaded_stripes[parity_stripe_idx],
                                                 downloaded_sizes[parity_stripe_idx],
                                                 missing_data,
                                                 &recovered_stripe, &recovered_size);
        if (rec_res == RESULT_SUCCESS) {
            data_stripes[missing_data] = recovered_stripe;
            data_sizes[missing_data] = recovered_size;
            if (stripes_recovered_out) *stripes_recovered_out = 1;
            log_info(LOG_CAT_COMMAND,
                     "QMail: recovered missing stripe %d for file_type=0x%02X",
                     missing_data, file_type);
        } else {
            if (error_out && error_out_size)
                snprintf(error_out, error_out_size,
                         "Failed to recover missing stripe %d for file_type 0x%02X",
                         missing_data, file_type);
            for (int i = 0; i < QMAIL_MAX_SERVERS; i++) free(downloaded_stripes[i]);
            return RESULT_ERROR;
        }
    } else if (missing_count == 1) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size,
                     "Missing data stripe %d and no parity for file_type 0x%02X",
                     missing_data, file_type);
        for (int i = 0; i < QMAIL_MAX_SERVERS; i++) free(downloaded_stripes[i]);
        return RESULT_ERROR;
    }

    if (original_len == 0 && data_sizes[0] > 0) {
        original_len = data_sizes[0] * (size_t)data_stripe_count;
    }

    uint8_t *reassembled = NULL;
    size_t reassembled_len = 0;
    result_t reas_res = qmail_stripe_reassemble(data_stripes, data_sizes,
                                                 data_stripe_count,
                                                 original_len,
                                                 &reassembled, &reassembled_len);

    for (int i = 0; i < QMAIL_MAX_SERVERS; i++) free(downloaded_stripes[i]);
    free(recovered_stripe);

    if (reas_res != RESULT_SUCCESS || !reassembled) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size,
                     "Stripe reassembly failed for file_type 0x%02X", file_type);
        return RESULT_ERROR;
    }

    if (verify_crc && utils_crc32(reassembled, reassembled_len) != expected_crc) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size,
                     "CRC mismatch for file_type 0x%02X", file_type);
        free(reassembled);
        return RESULT_ERROR;
    }

    *out_data = reassembled;
    *out_len = reassembled_len;
    return RESULT_SUCCESS;
}

/*
 * Download + RAID-5/XOR-reassemble ONE page (page_number) of a cmd-75 paged
 * object into out_page/out_page_len. Each page is an independent striped chunk
 * (NOT a slice of one continuous stripe file), so we recover/reassemble per page.
 * Returns RESULT_SUCCESS with the page's exact bytes, or RESULT_ERROR on failure
 * (caller treats FILE_NOT_EXIST / insufficient stripes as "page missing here").
 */
static result_t download_one_page(const qmail_tell_notification_t *notification,
                                  core_transport_t *transport_iface,
                                  const raida_encryption_key_t *enc_key,
                                  uint8_t file_type,
                                  uint32_t page_number,
                                  int data_stripe_count,
                                  size_t page_original_len,
                                  uint8_t **out_page,
                                  size_t *out_page_len) {
    *out_page = NULL;
    *out_page_len = 0;

    int download_count = notification->server_count;
    if (download_count > QMAIL_MAX_SERVERS) download_count = QMAIL_MAX_SERVERS;
    if (download_count <= 0) return RESULT_ERROR;

    parallel_download_ctx_t *pctx =
        (parallel_download_ctx_t *)calloc(1, sizeof(parallel_download_ctx_t));
    if (!pctx) return RESULT_MEMORY_ERROR;
    for (int i = 0; i < RAIDA_COUNT; i++) pctx->raida_to_position[i] = -1;

    uint8_t page_raidas[QMAIL_MAX_SERVERS];
    int page_count = 0;
    for (int i = 0; i < download_count; i++) {
        uint8_t server_raida = notification->servers[i].server_id;
        if (server_raida >= RAIDA_COUNT) continue;
        pctx->raida_to_position[server_raida] = i;
        qmail_download_context_t *dl_ctx = &pctx->per_server[i];
        memcpy(dl_ctx->file_guid, notification->file_guid, QMAIL_GUID_SIZE);
        memcpy(dl_ctx->locker_code, notification->locker_code, 16);
        dl_ctx->file_type = file_type;
        dl_ctx->version = 0x02;
        dl_ctx->bytes_per_page = 0;        /* server chooses max page size */
        dl_ctx->page_number = page_number; /* the page FILE to fetch */
        dl_ctx->denomination = enc_key->denomination;
        dl_ctx->serial_number = enc_key->serial_number;
        memcpy(dl_ctx->an, enc_key->ans[server_raida], AN_LENGTH);
        dl_ctx->device_id = 1;
        page_raidas[page_count++] = server_raida;
    }
    if (page_count == 0) { free(pctx); return RESULT_ERROR; }

    exec_config_t config;
    exec_config_init(&config);
    config.transport = TRANSPORT_TCP;
    config.mode = EXEC_MODE_PARALLEL;
    config.timeout_ms = 30000;
    config.transport_iface = transport_iface;
    config.include_only = page_raidas;
    config.include_count = page_count;
    config.early_finish_count = 0;
    config.early_finish_grace_ms = 0;

    qmail_encryption_state_t page_enc_state;
    qmail_apply_encryption_key(enc_key, &config, &page_enc_state);

    exec_results_t exec_results;
    exec_results_init(&exec_results);
    (void)executor_run(CMD_GROUP_QMAIL, CMD_QMAIL_DOWNLOAD,
                       parallel_download_build_body, pctx,
                       &config, &exec_results);

    /* Collect this page's per-server stripes (one stripe per server position). */
    uint8_t *stripes[QMAIL_MAX_SERVERS] = {NULL};
    size_t   stripe_sizes[QMAIL_MAX_SERVERS] = {0};
    bool     stripe_ok[QMAIL_MAX_SERVERS] = {false};
    int parity_stripe_idx = -1;

    for (int i = 0; i < download_count; i++) {
        uint8_t server_raida = notification->servers[i].server_id;
        int stripe_idx = notification->servers[i].stripe_index;
        if (server_raida >= RAIDA_COUNT ||
            stripe_idx < 0 || stripe_idx >= QMAIL_MAX_SERVERS) continue;

        raida_result_t *rr = &exec_results.results[server_raida];
        uint8_t dl_status = rr->has_response ? rr->response.status : 0;
        if (rr->success && raida_status_is_success(dl_status) &&
            rr->has_response && rr->response.body_len > 10 && rr->response.body) {
            size_t slen = rr->response.body_len - 10;  /* hdr(8) + terminator(2) */
            uint8_t *copy = (uint8_t *)malloc(slen ? slen : 1);
            if (!copy) {
                exec_results_free(&exec_results);
                for (int s = 0; s < QMAIL_MAX_SERVERS; s++) free(stripes[s]);
                free(pctx);
                return RESULT_MEMORY_ERROR;
            }
            if (slen) memcpy(copy, rr->response.body + 8, slen);
            free(stripes[stripe_idx]);
            stripes[stripe_idx] = copy;
            stripe_sizes[stripe_idx] = slen;
            stripe_ok[stripe_idx] = true;
            if (notification->servers[i].stripe_type == 1)
                parity_stripe_idx = stripe_idx;
        }
    }
    exec_results_free(&exec_results);
    free(pctx);

    /* Need at least data_stripe_count data stripes (RAID-5 tolerates 1 missing). */
    int have_data = 0, missing_data = -1, missing_count = 0;
    for (int si = 0; si < data_stripe_count; si++) {
        if (stripe_ok[si]) have_data++;
        else { missing_data = si; missing_count++; }
    }
    if (missing_count > 1) {
        for (int s = 0; s < QMAIL_MAX_SERVERS; s++) free(stripes[s]);
        return RESULT_ERROR;
    }

    const uint8_t *data_stripes[QMAIL_MAX_SERVERS] = {NULL};
    size_t data_sizes[QMAIL_MAX_SERVERS] = {0};
    for (int si = 0; si < data_stripe_count; si++) {
        data_stripes[si] = stripes[si];
        data_sizes[si] = stripe_sizes[si];
    }

    uint8_t *recovered = NULL;
    if (missing_count == 1) {
        if (parity_stripe_idx < 0 || !stripe_ok[parity_stripe_idx]) {
            for (int s = 0; s < QMAIL_MAX_SERVERS; s++) free(stripes[s]);
            return RESULT_ERROR;
        }
        size_t rsz = 0;
        result_t rr2 = qmail_stripe_recover(data_stripes, data_sizes,
                                            data_stripe_count,
                                            stripes[parity_stripe_idx],
                                            stripe_sizes[parity_stripe_idx],
                                            missing_data, &recovered, &rsz);
        if (rr2 != RESULT_SUCCESS) {
            for (int s = 0; s < QMAIL_MAX_SERVERS; s++) free(stripes[s]);
            return RESULT_ERROR;
        }
        data_stripes[missing_data] = recovered;
        data_sizes[missing_data] = rsz;
    }

    uint8_t *page_bytes = NULL;
    size_t page_bytes_len = 0;
    result_t reas = qmail_stripe_reassemble(data_stripes, data_sizes,
                                            data_stripe_count,
                                            page_original_len,
                                            &page_bytes, &page_bytes_len);
    for (int s = 0; s < QMAIL_MAX_SERVERS; s++) free(stripes[s]);
    free(recovered);
    if (reas != RESULT_SUCCESS || !page_bytes) {
        free(page_bytes);
        return RESULT_ERROR;
    }

    *out_page = page_bytes;
    *out_page_len = page_bytes_len;
    return RESULT_SUCCESS;
}

/*
 * Download a cmd-75 PAGED attachment, streaming each page directly to the
 * external attachment file (bounded memory ~= one page), verifying the
 * whole-file CRC32 incrementally. total_pages is DERIVED by the caller from the
 * manifest original_size + data_stripe_count + QMAIL_DOWNLOAD_PAGE_SIZE. On success, sets att's
 * external storage fields. On failure, removes the temp file.
 */
static result_t download_paged_attachment_to_file(
        const qmail_tell_notification_t *notification,
        core_transport_t *transport_iface,
        const raida_encryption_key_t *enc_key,
        qmail_attachment_t *att,
        uint8_t file_type,
        size_t original_len,
        bool verify_crc,
        uint32_t expected_crc) {
    int data_stripe_count = notification_data_stripe_count(notification);
    if (data_stripe_count <= 0 || data_stripe_count > QMAIL_MAX_SERVERS)
        return RESULT_ERROR;

    size_t chunk_capacity = (size_t)data_stripe_count * QMAIL_DOWNLOAD_PAGE_SIZE;
    if (chunk_capacity == 0 || original_len == 0) return RESULT_ERROR;
    uint64_t total_pages = ((uint64_t)original_len + chunk_capacity - 1) /
                           (uint64_t)chunk_capacity;
    if (total_pages == 0 || total_pages > QMAIL_MAX_PAGES) return RESULT_ERROR;

    /* Build the external file path + temp path (same layout as the buffer writer). */
    char client_data[MAX_PATH_LEN];
    platform_get_client_data_dir(client_data);
    char root_dir[QMAIL_ATTACHMENT_PATH_LEN];
    int n = snprintf(root_dir, sizeof(root_dir), "%s%s%s",
                     client_data, PATH_SEPARATOR_STR, QMAIL_ATTACHMENT_STORE_DIR);
    if (n < 0 || (size_t)n >= sizeof(root_dir)) return RESULT_FILE_ERROR;
    if (create_directory_recursive(root_dir) != RESULT_SUCCESS) return RESULT_FILE_ERROR;

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    utils_bytes_to_hex(att->email_id, QMAIL_GUID_SIZE, guid_hex);
    char msg_dir[QMAIL_ATTACHMENT_PATH_LEN];
    n = snprintf(msg_dir, sizeof(msg_dir), "%s%s%s",
                 root_dir, PATH_SEPARATOR_STR, guid_hex);
    if (n < 0 || (size_t)n >= sizeof(msg_dir)) return RESULT_FILE_ERROR;
    if (create_directory_recursive(msg_dir) != RESULT_SUCCESS) return RESULT_FILE_ERROR;

    char ext[sizeof(att->extension)];
    qmail_receive_sanitize_extension(att->extension, ext, sizeof(ext));
    char file_path[QMAIL_ATTACHMENT_PATH_LEN];
    n = snprintf(file_path, sizeof(file_path), "%s%s%02X.%s",
                 msg_dir, PATH_SEPARATOR_STR, att->file_type, ext);
    if (n < 0 || (size_t)n >= sizeof(file_path)) return RESULT_FILE_ERROR;
    char tmp_path[QMAIL_ATTACHMENT_PATH_LEN];
    n = snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", file_path);
    if (n < 0 || (size_t)n >= sizeof(tmp_path)) return RESULT_FILE_ERROR;

    FILE *fp = fopen(tmp_path, "wb");
    if (!fp) return RESULT_FILE_ERROR;

    log_info(LOG_CAT_COMMAND,
             "QMail RECEIVE: paged attachment 0x%02X: original_len=%zu "
             "data_stripe_count=%d chunk_capacity=%zu total_pages=%llu",
             file_type, original_len, data_stripe_count, chunk_capacity,
             (unsigned long long)total_pages);

    uint32_t crc = utils_crc32_init();
    size_t written = 0;

    for (uint32_t page = 0; page < (uint32_t)total_pages; page++) {
        size_t page_original_len = chunk_capacity;
        size_t remaining = original_len - (size_t)page * chunk_capacity;
        if (remaining < chunk_capacity) page_original_len = remaining;

        uint8_t *page_bytes = NULL;
        size_t page_bytes_len = 0;
        result_t pr = download_one_page(notification, transport_iface, enc_key,
                                        file_type, page, data_stripe_count,
                                        page_original_len,
                                        &page_bytes, &page_bytes_len);
        if (pr != RESULT_SUCCESS || !page_bytes) {
            log_warn(LOG_CAT_COMMAND,
                     "QMail RECEIVE: paged attachment 0x%02X page %u unavailable",
                     file_type, page);
            free(page_bytes);
            fclose(fp);
            remove(tmp_path);
            return RESULT_ERROR;
        }
        /* Trim to the exact logical page length (final page may be shorter). */
        size_t use = page_bytes_len < page_original_len ? page_bytes_len
                                                        : page_original_len;
        if (use > 0 && fwrite(page_bytes, 1, use, fp) != use) {
            free(page_bytes);
            fclose(fp);
            remove(tmp_path);
            return RESULT_FILE_ERROR;
        }
        crc = utils_crc32_update(crc, page_bytes, use);
        written += use;
        free(page_bytes);
    }

    if (fclose(fp) != 0) { remove(tmp_path); return RESULT_FILE_ERROR; }

    if (verify_crc && utils_crc32_finish(crc) != expected_crc) {
        log_warn(LOG_CAT_COMMAND,
                 "QMail RECEIVE: paged attachment 0x%02X CRC mismatch", file_type);
        remove(tmp_path);
        return RESULT_ERROR;
    }

    if (fs_atomic_rename(tmp_path, file_path) != RESULT_SUCCESS) {
        remove(tmp_path);
        return RESULT_FILE_ERROR;
    }

    att->storage_mode = QMAIL_STORAGE_EXTERNAL;
    att->data_blob = NULL;
    att->data_size = 0;
    att->size_bytes = written;
    strncpy(att->file_path, file_path, sizeof(att->file_path) - 1);
    att->file_path[sizeof(att->file_path) - 1] = '\0';
    return RESULT_SUCCESS;
}

/**
 * Body builder for parallel downloads.
 * Called per-RAIDA by executor; maps raida_id to the correct download context.
 */
static result_t parallel_download_build_body(uint8_t raida_id,
                                              uint8_t **body, size_t *body_size,
                                              void *user_data) {
    parallel_download_ctx_t *pctx = (parallel_download_ctx_t *)user_data;
    int pos = pctx->raida_to_position[raida_id];
    if (pos < 0) {
        /* This RAIDA is not a target server — should not happen with include_only */
        return RESULT_INVALID_PARAM;
    }

    const qmail_download_context_t *ctx = &pctx->per_server[pos];

    /* 32 (preamble) + 37 (guid+locker+type+bpp+page[3]) = 69 */
    size_t total = QMAIL_PREAMBLE_SIZE + 37;

    *body = (uint8_t *)calloc(total, 1);
    if (!*body) return RESULT_MEMORY_ERROR;
    *body_size = total;

    uint8_t *p = *body;
    size_t off = 0;

    /* Preamble (32 bytes after challenge) */
    off += qmail_write_preamble(p + off, ctx->denomination, ctx->serial_number,
                                 ctx->device_id, ctx->an);

    /* File GUID (16 bytes) */
    memcpy(p + off, ctx->file_guid, 16);
    off += 16;

    /* Locker Code (16 bytes) */
    memcpy(p + off, ctx->locker_code, 16);
    off += 16;

    /* Params (5 bytes): file_type(1) + bytes_per_page(1) + page_number(3 BE) */
    p[off++] = ctx->file_type;
    p[off++] = 0; /* bytes_per_page: 0 = max page size (server decides) */
    p[off++] = 0x00; /* reserved high byte */
    p[off++] = (uint8_t)((ctx->page_number >> 8) & 0xFF);
    p[off++] = (uint8_t)(ctx->page_number & 0xFF);

    log_debug(LOG_CAT_COMMAND, "DOWNLOAD2 parallel: RAIDA %2d sn=%u type=%d page=%u",
              raida_id, ctx->serial_number, ctx->file_type, ctx->page_number);

    return RESULT_SUCCESS;
}

static result_t download_revised_object_to_memory(
        const qmail_tell_notification_t *notification,
        const qmail_ot_manifest_v2_entry_t *entry,
        const char *wallet_path,
        uint8_t **data_out,
        size_t *data_size_out,
        int *stripes_downloaded_out,
        int *stripes_recovered_out,
        char *error_out,
        size_t error_out_size) {
    char client_data[MAX_PATH_LEN];
    char object_hex[QMAIL_OT_ID_SIZE * 2 + 1];
    uint8_t suffix[8];
    char suffix_hex[17];
    char path[QMAIL_ATTACHMENT_PATH_LEN];
    FILE *file = NULL;
    uint8_t *data = NULL;

    if (!notification || !entry || !wallet_path || !wallet_path[0] ||
        !data_out || !data_size_out || entry->original_size > SIZE_MAX) {
        return RESULT_INVALID_PARAM;
    }
    *data_out = NULL;
    *data_size_out = 0;
    if (stripes_downloaded_out) *stripes_downloaded_out = 0;
    if (stripes_recovered_out) *stripes_recovered_out = 0;

    platform_get_client_data_dir(client_data);
    utils_bytes_to_hex(entry->object_id, QMAIL_OT_ID_SIZE, object_hex);
    platform_random_bytes(suffix, sizeof(suffix));
    utils_bytes_to_hex(suffix, sizeof(suffix), suffix_hex);
    if (snprintf(path, sizeof(path),
                 "%s%sObjectTransfers%sReconstructed%s%s-f%03u-%s.bin",
                 client_data, PATH_SEPARATOR_STR, PATH_SEPARATOR_STR,
                 PATH_SEPARATOR_STR, object_hex,
                 (unsigned)entry->file_type, suffix_hex)
        >= (int)sizeof(path)) {
        return RESULT_INVALID_PARAM;
    }

    qmail_receive_object_result_t object_result;
    result_t status = qmail_receive_object_download(
        notification, entry, wallet_path, path, &object_result,
        error_out, error_out_size);
    if (status != RESULT_SUCCESS) return status;

    size_t size = (size_t)entry->original_size;
    data = (uint8_t *)malloc(size ? size : 1);
    if (!data) {
        remove(path);
        return RESULT_MEMORY_ERROR;
    }
    file = fopen(path, "rb");
    if (!file || (size > 0 && fread(data, 1, size, file) != size)) {
        if (file) fclose(file);
        free(data);
        remove(path);
        if (error_out && error_out_size) {
            snprintf(error_out, error_out_size,
                     "The reconstructed revised-manifest object could not be read");
        }
        return RESULT_FILE_ERROR;
    }
    if (fclose(file) != 0) {
        free(data);
        remove(path);
        return RESULT_FILE_ERROR;
    }
    remove(path);

    *data_out = data;
    *data_size_out = size;
    if (stripes_downloaded_out) {
        *stripes_downloaded_out = object_result.stripes_downloaded;
    }
    if (stripes_recovered_out) {
        *stripes_recovered_out = object_result.stripes_recovered;
    }
    return RESULT_SUCCESS;
}


// ============================================================================
// PUBLIC API
// ============================================================================

result_t qmail_receive_email(const qmail_tell_notification_t *notification,
                              core_transport_t *transport_iface,
                              const char *wallet_path,
                              qmail_receive_result_t *result) {
    if (!notification || !transport_iface || !result) {
        return RESULT_INVALID_PARAM;
    }

    memset(result, 0, sizeof(qmail_receive_result_t));
    memcpy(result->email_id, notification->file_guid, QMAIL_GUID_SIZE);
    result->sender_sn = notification->sender_sn;
    result->sender_denomination = notification->sender_denomination;

    char guid_hex[33];
    utils_bytes_to_hex(notification->file_guid, 16, guid_hex);
    log_info(LOG_CAT_COMMAND, "QMail RECEIVE: starting download of email %s (Sender SN: %u)",
             guid_hex, notification->sender_sn);

    bool revised_manifest =
        notification_has_revised_manifest(notification);
    char resolved_wallet[MAX_PATH_LEN] = {0};
    const char *receive_wallet = wallet_path;
    if (revised_manifest && (!receive_wallet || !receive_wallet[0])) {
        if (qmail_identity_get_mail_wallet_path(
                NULL, resolved_wallet, sizeof(resolved_wallet))
            != RESULT_SUCCESS) {
            snprintf(result->error_message, sizeof(result->error_message),
                     "The Mail wallet path is unavailable for object download");
            return RESULT_NOT_FOUND;
        }
        receive_wallet = resolved_wallet;
    }

    /* Use the Mail identity coin as the download encryption/auth key.
     * The selectable wallet keys (e.g. funding coins in Default/Bank) can
     * be consumed by Make Change or rotated by locker-pool replenish; the
     * local AN cache then diverges from the RAIDA and every download
     * stripe is rejected with 0x22. The Mail identity coin is the only
     * key guaranteed to stay in lock-step with the RAIDA, and the upload
     * path already stamps it in packet headers — there is no privacy
     * boundary left to protect by excluding it here. */
    raida_encryption_key_t identity_key;
    encryption_key_init(&identity_key);
    qmail_identity_t identity;
    result_t key_res = qmail_identity_load_key(NULL, &identity_key, &identity);
    if (key_res != RESULT_SUCCESS || !identity_key.valid) {
        snprintf(result->error_message, sizeof(result->error_message),
                 "No Mail identity key available for download");
        return RESULT_NOT_FOUND;
    }

    exec_config_t tmp_config;
    exec_config_init(&tmp_config);
    qmail_encryption_state_t enc_state;
    qmail_apply_encryption_key(&identity_key, &tmp_config, &enc_state);

    int8_t denomination = enc_state.enc_key.denomination;
    uint32_t serial_number = enc_state.enc_key.serial_number;

    log_info(LOG_CAT_COMMAND,
        "QMail RECEIVE: using encryption key DN%d.%u for download",
        denomination, serial_number);

    uint8_t *reassembled = NULL;
    size_t reassembled_len = 0;
    uint8_t *body_object = NULL;
    size_t body_object_len = 0;
    int body_stripes_downloaded = 0;
    int body_stripes_recovered = 0;
    const qmail_file_manifest_entry_t *meta_entry = notification_meta_entry(notification);
    const qmail_file_manifest_entry_t *body_entry = notification_body_entry(notification);
    qmail_ot_manifest_v2_entry_t revised_meta_entry;
    qmail_ot_manifest_v2_entry_t revised_body_entry;
    bool has_revised_meta = revised_manifest &&
        notification_find_revised_entry(
            notification, QMAIL_FILE_MANIFEST_FLAG_META,
            QMAIL_FILE_META, &revised_meta_entry);
    bool has_revised_body = revised_manifest &&
        notification_find_revised_entry(
            notification, QMAIL_FILE_MANIFEST_FLAG_BODY,
            QMAIL_FILE_BODY, &revised_body_entry);
    bool split_meta = revised_manifest ? has_revised_meta : (meta_entry != NULL);
    bool crc_present =
        notification_has_manifest_v1(notification) &&
        ((notification->manifest_flags & QMAIL_TELL_MANIFEST_FLAG_CRC32_PRESENT) != 0);

    if (revised_manifest) {
        const qmail_ot_manifest_v2_entry_t *first_entry =
            split_meta ? &revised_meta_entry :
            (has_revised_body ? &revised_body_entry : NULL);
        if (!first_entry) {
            snprintf(result->error_message, sizeof(result->error_message),
                     "The revised manifest does not contain an email object");
            return RESULT_ERROR;
        }
        int first_downloaded = 0;
        int first_recovered = 0;
        result_t object_result = download_revised_object_to_memory(
            notification, first_entry, receive_wallet,
            &reassembled, &reassembled_len,
            &first_downloaded, &first_recovered,
            result->error_message, sizeof(result->error_message));
        if (object_result != RESULT_SUCCESS) return object_result;
        result->stripes_downloaded += first_downloaded;
        result->stripes_recovered += first_recovered;
    } else if (split_meta) {
        size_t meta_original_len = (size_t)utils_read_u64_be(meta_entry->original_size);
        uint32_t meta_crc = utils_read_u32_be(meta_entry->crc32);
        int meta_stripes_downloaded = 0;
        int meta_stripes_recovered = 0;

        result_t meta_res = download_reassemble_file(notification, transport_iface,
                                                     &enc_state.enc_key,
                                                     meta_entry->file_type,
                                                     meta_original_len,
                                                     crc_present,
                                                     meta_crc,
                                                     &reassembled,
                                                     &reassembled_len,
                                                     &meta_stripes_downloaded,
                                                     &meta_stripes_recovered,
                                                     result->error_message,
                                                     sizeof(result->error_message));
        if (meta_res != RESULT_SUCCESS) {
            return meta_res;
        }
        result->stripes_downloaded += meta_stripes_downloaded;
        result->stripes_recovered += meta_stripes_recovered;
    } else {
        uint8_t body_file_type = QMAIL_FILE_BODY;
        size_t body_original_len = notification->total_file_size;
        uint32_t body_crc = 0;

        if (body_entry) {
            body_file_type = body_entry->file_type;
            body_original_len = (size_t)utils_read_u64_be(body_entry->original_size);
            body_crc = utils_read_u32_be(body_entry->crc32);
        }

        result_t body_res = download_reassemble_file(notification, transport_iface,
                                                     &enc_state.enc_key,
                                                     body_file_type,
                                                     body_original_len,
                                                     crc_present,
                                                     body_crc,
                                                     &reassembled,
                                                     &reassembled_len,
                                                     &body_stripes_downloaded,
                                                     &body_stripes_recovered,
                                                     result->error_message,
                                                     sizeof(result->error_message));
        if (body_res != RESULT_SUCCESS) {
            return body_res;
        }
        result->stripes_downloaded += body_stripes_downloaded;
        result->stripes_recovered += body_stripes_recovered;
    }

    /* Parse reassembled data as CBDF (Compact Binary Document Format).
     * Format: [pair_count:2 LE] [key:1][len:1][value:N]... [0x1C][0x1C][0x02][body...EOF]
     * Keys: 1=GUID(16), 2=Subject(var), 3=AttachmentName(var,repeated),
     *        12=NumAttachments(1), 13=To(7,repeated), 14=CC(7,repeated),
     *        19=From(7), 25=Timestamp(4 LE) */
    const uint8_t *p = reassembled;
    const uint8_t *end = reassembled + reassembled_len;
    bool cbdf_ok = false;
    int attachment_count = 0;
    char attachment_names[QMAIL_CBDF_MAX_ATTACHMENT_NAMES][QMAIL_CBDF_ATTACHMENT_NAME_MAX + 1];
    int attachment_name_count = 0;
    uint8_t meta_file_type = QMAIL_CBDF_META_TYPE_QMAIL;
    /* CBDF key 4 (Total Pages) per attachment, in occurrence order: the n-th key 4
     * maps to attachment file index n. Value > 0 marks a cmd-75 PAGED attachment;
     * the authoritative page count is DERIVED on download from the manifest. */
    uint16_t attachment_total_pages[QMAIL_CBDF_MAX_ATTACHMENT_NAMES] = {0};
    int attachment_page_count = 0;

    /* CBDF keys 13 (TO) and 14 (CC) carry one mailbox per recipient. Accumulate
     * them here, then copy into the qmail_email_t before db insert so
     * qmail_email_contacts gets one row per recipient. BCC is not encoded in
     * CBDF — each BCC recipient sees only their own copy under TO/CC. */
    qmail_recipient_entry_t cbdf_recipients[QMAIL_MAX_RECIPIENTS];
    int cbdf_recipient_count = 0;
    uint8_t sender_denomination = notification->sender_denomination;

    /* Need at least 2 bytes for pair count */
    if (reassembled_len < 5) {
        log_error(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF data too short (%zu bytes)", reassembled_len);
        free(reassembled);
        snprintf(result->error_message, sizeof(result->error_message), "CBDF data too short");
        return RESULT_ERROR;
    }

    /* Read pair count (2 bytes, little-endian) */
    uint16_t pair_count = (uint16_t)p[0] | ((uint16_t)p[1] << 8);
    p += 2;

    log_info(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF pair_count=%u", pair_count);

    for (uint16_t i = 0; i < pair_count && p + 2 <= end; i++) {
        uint8_t key_id = *p++;
        uint8_t value_len = *p++;

        if (p + value_len > end) {
            log_error(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF key 0x%02X value_len %u overflows", key_id, value_len);
            break;
        }

        switch (key_id) {
        case QMAIL_CBDF_KEY_META_FILE_TYPE: /* Meta File Type - 1 byte (key 0) */
            if (value_len >= 1) meta_file_type = p[0];
            break;

        case 1: /* GUID - 16 bytes (informational, we already have it from the tell) */
            break;

        case 2: { /* Subject - variable length UTF-8 */
            size_t copy_len = value_len;
            if (copy_len >= QMAIL_MAX_SUBJECT_LEN)
                copy_len = QMAIL_MAX_SUBJECT_LEN - 1;
            memcpy(result->subject, p, copy_len);
            result->subject[copy_len] = '\0';
            break;
        }

        case QMAIL_CBDF_KEY_TOTAL_PAGES: /* Attachment Total Pages - 2 bytes LE (key 4) */
            /* Presence marks a paged (cmd-75) attachment; n-th key 4 -> attachment
             * index n. Value is a best-effort estimate; the actual page count is
             * derived from the manifest on download. */
            if (value_len >= 2 &&
                attachment_page_count < QMAIL_CBDF_MAX_ATTACHMENT_NAMES) {
                attachment_total_pages[attachment_page_count++] =
                    (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
            }
            break;

        case QMAIL_CBDF_ATTACHMENT_NAME_KEY: /* Attachment filename - variable length, repeated */
            if (attachment_name_count < QMAIL_CBDF_MAX_ATTACHMENT_NAMES) {
                size_t copy_len = value_len;
                if (copy_len > QMAIL_CBDF_ATTACHMENT_NAME_MAX)
                    copy_len = QMAIL_CBDF_ATTACHMENT_NAME_MAX;
                memcpy(attachment_names[attachment_name_count], p, copy_len);
                attachment_names[attachment_name_count][copy_len] = '\0';
                attachment_name_count++;
            }
            break;
        case 12: /* Number of Attachments - 1 byte */
            if (value_len >= 1)
                attachment_count = p[0];
            break;

        case 13: /* To mailbox - 7 bytes (repeated per recipient) */
            if (value_len == 7 && cbdf_recipient_count < QMAIL_MAX_RECIPIENTS) {
                /* Mailbox layout (see write_mailbox in qmail_cbdf.c):
                 *   p[0..1] = coin_group, p[2] = denomination,
                 *   p[3..6] = serial_number (little-endian). */
                qmail_recipient_entry_t *r = &cbdf_recipients[cbdf_recipient_count++];
                r->denomination   = (int8_t)p[2];
                r->serial_number  = (uint32_t)p[3] | ((uint32_t)p[4] << 8) |
                                    ((uint32_t)p[5] << 16) | ((uint32_t)p[6] << 24);
                r->recipient_type = QMAIL_RECIPIENT_TO;
                log_info(LOG_CAT_COMMAND,
                         "QMail RECEIVE: CBDF To recipient SN=%u (pair %u)",
                         r->serial_number, i);
            }
            break;

        case 14: /* CC mailbox - 7 bytes (repeated per recipient) */
            if (value_len == 7 && cbdf_recipient_count < QMAIL_MAX_RECIPIENTS) {
                qmail_recipient_entry_t *r = &cbdf_recipients[cbdf_recipient_count++];
                r->denomination   = (int8_t)p[2];
                r->serial_number  = (uint32_t)p[3] | ((uint32_t)p[4] << 8) |
                                    ((uint32_t)p[5] << 16) | ((uint32_t)p[6] << 24);
                r->recipient_type = QMAIL_RECIPIENT_CC;
                log_info(LOG_CAT_COMMAND,
                         "QMail RECEIVE: CBDF CC recipient SN=%u (pair %u)",
                         r->serial_number, i);
            }
            break;

        case 19: /* From mailbox - 7 bytes */
            if (value_len == 7) {
                /* Extract sender denomination and serial number from the encrypted body. */
                uint8_t from_denomination = p[2];
                uint32_t from_sn = (uint32_t)p[3] | ((uint32_t)p[4] << 8) |
                                   ((uint32_t)p[5] << 16) | ((uint32_t)p[6] << 24);
                if (from_sn != notification->sender_sn) {
                    log_warn(LOG_CAT_COMMAND,
                             "QMail RECEIVE: CBDF From SN=%u differs from Tell sender_sn=%u; "
                             "using Tell sender_sn",
                             from_sn, notification->sender_sn);
                } else {
                    sender_denomination = from_denomination;
                    result->sender_denomination = sender_denomination;
                    log_info(LOG_CAT_COMMAND,
                             "QMail RECEIVE: CBDF From SN=%u denomination=%u",
                             from_sn, (unsigned)sender_denomination);
                }
            }
            break;

        case 25: /* Timestamp - 4 bytes (Unix epoch, little-endian) */
            if (value_len == 4) {
                uint32_t ts = (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
                              ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
                log_info(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF timestamp=%u", ts);
            }
            break;

        default:
            log_info(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF unknown key 0x%02X len=%u", key_id, value_len);
            break;
        }

        p += value_len;
    }

    if (split_meta) {
        if ((revised_manifest && !has_revised_body) ||
            (!revised_manifest && !body_entry)) {
            log_error(LOG_CAT_COMMAND,
                      "QMail RECEIVE: split Tell has private meta but no body entry");
            free(reassembled);
            snprintf(result->error_message, sizeof(result->error_message),
                     "Tell manifest missing body object");
            return RESULT_ERROR;
        }

        result_t body_res;
        if (revised_manifest) {
            body_res = download_revised_object_to_memory(
                notification, &revised_body_entry, receive_wallet,
                &body_object, &body_object_len,
                &body_stripes_downloaded, &body_stripes_recovered,
                result->error_message, sizeof(result->error_message));
        } else {
            size_t body_original_len =
                (size_t)utils_read_u64_be(body_entry->original_size);
            uint32_t body_crc = utils_read_u32_be(body_entry->crc32);
            body_res = download_reassemble_file(
                notification, transport_iface, &enc_state.enc_key,
                body_entry->file_type, body_original_len,
                crc_present, body_crc,
                &body_object, &body_object_len,
                &body_stripes_downloaded, &body_stripes_recovered,
                result->error_message, sizeof(result->error_message));
        }
        if (body_res != RESULT_SUCCESS) {
            free(reassembled);
            return body_res;
        }
        result->stripes_downloaded += body_stripes_downloaded;
        result->stripes_recovered += body_stripes_recovered;

        p = body_object;
        end = body_object + body_object_len;
    }

    /* Expect two 0x1C file separators then 0x02 STX */
    if (p + 3 <= end && p[0] == 0x1C && p[1] == 0x1C && p[2] == 0x02) {
        p += 3; /* skip FS, FS, STX */

        /* Everything from here to EOF is the body */
        size_t body_len = (size_t)(end - p);
        result->body_len = body_len;
        result->body = (char *)malloc(body_len + 1);
        if (result->body) {
            memcpy(result->body, p, body_len);
            result->body[body_len] = '\0';
        }
        cbdf_ok = true;
        log_info(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF parsed OK, body=%zu bytes, attachments=%d, attachment_names=%d, meta_type=%d, key4_pages_entries=%d",
                 body_len, attachment_count, attachment_name_count,
                 (int)meta_file_type, attachment_page_count);
    } else {
        log_error(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF missing FS/FS/STX separators at offset %td",
                  split_meta ? (p - body_object) : (p - reassembled));
    }

    if (!cbdf_ok) {
        /* Legacy fallback: keep raw visible content for old test data. In
         * split-meta mode the visible content is body_object; reassembled is
         * the private meta payload and must not be exposed as the body. */
        const uint8_t *raw_body = split_meta ? body_object : reassembled;
        size_t raw_body_len = split_meta ? body_object_len : reassembled_len;
        result->body_len = raw_body_len;
        result->body = (char *)malloc(raw_body_len + 1);
        if (result->body) {
            if (raw_body_len > 0) memcpy(result->body, raw_body, raw_body_len);
            result->body[raw_body_len] = '\0';
        }
        strncpy(result->subject, "(CBDF Parse Error)", QMAIL_MAX_SUBJECT_LEN - 1);
        log_error(LOG_CAT_COMMAND, "QMail RECEIVE: CBDF parse failed, stored raw data as body");
    }

    free(body_object);
    free(reassembled);

    int expected_attachment_count = attachment_count;
    if (attachment_name_count > expected_attachment_count)
        expected_attachment_count = attachment_name_count;

    int manifest_attachment_count = notification_manifest_attachment_count(notification);
    if (expected_attachment_count > 0 &&
        manifest_attachment_count < expected_attachment_count) {
        log_warn(LOG_CAT_COMMAND,
                 "QMail RECEIVE: CBDF reports %d attachment(s), but Tell manifest has %d; "
                 "leaving tell pending",
                 expected_attachment_count, manifest_attachment_count);
        snprintf(result->error_message, sizeof(result->error_message),
                 "Attachment manifest incomplete (%d expected, %d available)",
                 expected_attachment_count, manifest_attachment_count);
        return RESULT_ERROR;
    }

    /* Store in database */
    if (qmail_db_is_open() && result->body) {
        qmail_email_t email;
        memset(&email, 0, sizeof(email));
        memcpy(email.email_id, notification->file_guid, QMAIL_GUID_SIZE);
        strncpy(email.subject, result->subject, QMAIL_MAX_SUBJECT_LEN - 1);
        email.body = result->body;
        email.body_len = result->body_len;
        email.received_timestamp = (int64_t)time(NULL);
        /* Sender's send time travels in the tell notification (PING/PEEK).
         * Store it so the inbox can show when the mail was SENT, not merely
         * when we downloaded it. 0 if the tell carried no timestamp. */
        email.sent_timestamp = (int64_t)notification->timestamp;
        email.sender_sn = notification->sender_sn;
        email.sender_denomination = sender_denomination;
        email.folder = QMAIL_FOLDER_INBOX;

        /* Forward CBDF-parsed recipients into the email row so
         * qmail_db_email_insert populates qmail_email_contacts. */
        email.recipient_count = cbdf_recipient_count;
        for (int r = 0; r < cbdf_recipient_count; r++) {
            email.recipients[r] = cbdf_recipients[r];
        }

        result_t db_res = qmail_db_email_insert(&email);
        /* Don't free email.body — it's owned by result */
        email.body = NULL;

        if (db_res != RESULT_SUCCESS) {
            log_error(LOG_CAT_COMMAND, "QMail RECEIVE: failed to insert email into DB (%d)", db_res);
        } else {
            log_info(LOG_CAT_COMMAND, "QMail RECEIVE: email stored in INBOX. Subject: '%.32s...'",
                     result->subject);

            if (notification_has_manifest_v1(notification) ||
                notification_has_revised_manifest(notification)) {
                bool all_manifest_attachments_stored = true;
                int stored_attachments = 0;

                /* ATTACHMENT ON DEMAND: do NOT download attachment bytes at tell
                 * time. Insert one PENDING metadata row per attachment (name,
                 * extension, type, original size). The user downloads the bytes
                 * later by clicking the attachment, which calls
                 * /api/qmail/attachment/download (qmail_receive_attachment_on_demand).
                 * This keeps the inbox responsive, avoids forced large/unwanted
                 * downloads, and means a slow/failed attachment never blocks or
                 * un-settles the email itself. */
                for (int mi = 0; mi < notification->file_count; mi++) {
                    uint8_t entry_file_type = 0;
                    uint64_t entry_original_size = 0;
                    bool meta_or_body = false;
                    if (revised_manifest) {
                        qmail_ot_manifest_v2_entry_t entry;
                        if (!notification_revised_entry(
                                notification, mi, &entry)) {
                            all_manifest_attachments_stored = false;
                            continue;
                        }
                        entry_file_type = entry.file_type;
                        entry_original_size = entry.original_size;
                        meta_or_body = revised_entry_is_meta_or_body(&entry);
                    } else {
                        const qmail_file_manifest_entry_t *entry =
                            &notification->files[mi];
                        entry_file_type = entry->file_type;
                        entry_original_size =
                            utils_read_u64_be(entry->original_size);
                        meta_or_body =
                            notification_entry_is_meta_or_body(entry);
                    }
                    if (meta_or_body) continue;
                    if (entry_file_type < QMAIL_FILE_ATTACHMENT_1) {
                        log_warn(LOG_CAT_COMMAND,
                                 "QMail RECEIVE: skipping manifest file_type 0x%02X",
                                 entry_file_type);
                        continue;
                    }
                    if (entry_original_size > SIZE_MAX) {
                        all_manifest_attachments_stored = false;
                        continue;
                    }
                    size_t attachment_original_len =
                        (size_t)entry_original_size;

                    qmail_attachment_t att;
                    memset(&att, 0, sizeof(att));
                    memcpy(att.email_id, notification->file_guid, QMAIL_GUID_SIZE);
                    att.file_type = entry_file_type;

                    int attachment_index =
                        (int)(entry_file_type - QMAIL_FILE_ATTACHMENT_1);
                    if (attachment_index >= 0 && attachment_index < attachment_name_count &&
                        attachment_names[attachment_index][0]) {
                        qmail_receive_apply_attachment_filename(
                            attachment_names[attachment_index],
                            att.name, sizeof(att.name),
                            att.extension, sizeof(att.extension));
                    }
                    if (!att.name[0]) {
                        snprintf(att.name, sizeof(att.name), "Attachment %d", attachment_index + 1);
                        strncpy(att.extension, "bin", sizeof(att.extension) - 1);
                    }

                    /* PENDING: metadata only, bytes not yet downloaded. size_bytes
                     * is the manifest original_size so the GUI can show the size
                     * on the download link. */
                    att.storage_mode = QMAIL_STORAGE_PENDING;
                    att.data_blob = NULL;
                    att.data_size = 0;
                    att.size_bytes = attachment_original_len;
                    att.file_path[0] = '\0';

                    result_t ai = qmail_db_attachment_insert(&att);
                    if (ai != RESULT_SUCCESS) {
                        log_warn(LOG_CAT_COMMAND,
                                 "QMail RECEIVE: failed to store attachment metadata file_type 0x%02X (%s)",
                                 entry_file_type, result_to_string(ai));
                        all_manifest_attachments_stored = false;
                    } else {
                        stored_attachments++;
                        log_info(LOG_CAT_COMMAND,
                                 "QMail RECEIVE: registered PENDING attachment %d file_type=0x%02X size=%zu name='%.48s' (download on demand)",
                                 stored_attachments, entry_file_type,
                                 attachment_original_len, att.name);
                    }
                }

                if (all_manifest_attachments_stored) {
                    qmail_db_tell_mark_downloaded(notification->file_guid);
                } else {
                    snprintf(result->error_message, sizeof(result->error_message),
                             "One or more attachments could not be downloaded");
                    return RESULT_ERROR;
                }
            } else {
                qmail_db_tell_mark_downloaded(notification->file_guid);
            }
        }
    }

    result->success = true;
    log_info(LOG_CAT_COMMAND, "QMail RECEIVE: successfully reassembled email (GUID: %s)", guid_hex);
    return RESULT_SUCCESS;
}

/* ON-DEMAND attachment download. Called when the user clicks a PENDING
 * attachment (via /api/qmail/attachment/download). Reconstructs the tell from
 * the stored received-tell row, downloads the one requested file_type
 * (paged or legacy), writes it to the external attachment file, and updates the
 * attachment DB row from PENDING -> EXTERNAL. The bytes are only fetched here,
 * never at tell-receive time. */
result_t qmail_receive_attachment_on_demand(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                            uint8_t file_type,
                                            core_transport_t *transport_iface,
                                            int64_t attachment_id,
                                            char *error_out,
                                            size_t error_out_size) {
    if (!file_guid || !transport_iface) return RESULT_INVALID_PARAM;
    if (error_out && error_out_size) error_out[0] = '\0';

    /* 1. Reconstruct the tell (server locations + manifest). */
    qmail_tell_notification_t notif;
    result_t tr = qmail_db_tell_get_by_guid(file_guid, &notif);
    if (tr != RESULT_SUCCESS) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size, "No stored tell for this email");
        return tr;
    }

    /* 2. Find the manifest entry for the requested file_type. */
    const qmail_file_manifest_entry_t *entry = NULL;
    qmail_ot_manifest_v2_entry_t revised_entry;
    bool revised_manifest = notification_has_revised_manifest(&notif);
    bool revised_entry_found = false;
    if (notification_has_manifest_v1(&notif)) {
        for (int i = 0; i < notif.file_count; i++) {
            if (notif.files[i].file_type == file_type) {
                entry = &notif.files[i];
                break;
            }
        }
    } else if (revised_manifest) {
        for (int i = 0; i < notif.file_count; ++i) {
            qmail_ot_manifest_v2_entry_t candidate;
            if (!notification_revised_entry(&notif, i, &candidate)) break;
            if (candidate.file_type == file_type &&
                !revised_entry_is_meta_or_body(&candidate)) {
                revised_entry = candidate;
                revised_entry_found = true;
                break;
            }
        }
    }
    if (!entry && !revised_entry_found) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size,
                     "Attachment file_type 0x%02X not in tell manifest", file_type);
        return RESULT_NOT_FOUND;
    }

    uint64_t original_size = revised_entry_found
        ? revised_entry.original_size
        : utils_read_u64_be(entry->original_size);
    if (original_size > SIZE_MAX) {
        if (error_out && error_out_size) {
            snprintf(error_out, error_out_size,
                     "Attachment is too large for this client build");
        }
        return RESULT_ERROR;
    }
    size_t original_len = (size_t)original_size;

    /* 3. Load the attachment row (for name/extension used in the external path). */
    qmail_attachment_t att;
    memset(&att, 0, sizeof(att));
    if (qmail_db_attachment_get(attachment_id, &att) != RESULT_SUCCESS) {
        if (error_out && error_out_size)
            snprintf(error_out, error_out_size, "Attachment row %lld not found",
                     (long long)attachment_id);
        return RESULT_NOT_FOUND;
    }

    result_t dl_res;
    if (revised_entry_found) {
        char mail_wallet[MAX_PATH_LEN];
        char file_path[QMAIL_ATTACHMENT_PATH_LEN];
        if (qmail_identity_get_mail_wallet_path(
                NULL, mail_wallet, sizeof(mail_wallet)) != RESULT_SUCCESS) {
            qmail_attachment_free(&att);
            if (error_out && error_out_size) {
                snprintf(error_out, error_out_size,
                         "The Mail wallet path is unavailable");
            }
            return RESULT_NOT_FOUND;
        }
        dl_res = qmail_receive_external_attachment_path(&att, file_path);
        if (dl_res == RESULT_SUCCESS) {
            qmail_receive_object_result_t object_result;
            dl_res = qmail_receive_object_download(
                &notif, &revised_entry, mail_wallet, file_path,
                &object_result, error_out, error_out_size);
        }
        if (dl_res == RESULT_SUCCESS) {
            att.storage_mode = QMAIL_STORAGE_EXTERNAL;
            att.data_blob = NULL;
            att.data_size = 0;
            att.size_bytes = original_len;
            strncpy(att.file_path, file_path, sizeof(att.file_path) - 1);
            att.file_path[sizeof(att.file_path) - 1] = '\0';
        }
    } else {
        uint32_t expected_crc = utils_read_u32_be(entry->crc32);
        bool crc_present =
            (notif.manifest_flags & QMAIL_TELL_MANIFEST_FLAG_CRC32_PRESENT) != 0;
        raida_encryption_key_t identity_key;
        encryption_key_init(&identity_key);
        qmail_identity_t identity;
        result_t key_res =
            qmail_identity_load_key(NULL, &identity_key, &identity);
        if (key_res != RESULT_SUCCESS || !identity_key.valid) {
            qmail_attachment_free(&att);
            if (error_out && error_out_size) {
                snprintf(error_out, error_out_size,
                         "No Mail identity key available");
            }
            return RESULT_NOT_FOUND;
        }
        exec_config_t tmp_config;
        exec_config_init(&tmp_config);
        qmail_encryption_state_t enc_state;
        qmail_apply_encryption_key(&identity_key, &tmp_config, &enc_state);

        /* Legacy manifest-v1 page geometry remains fixed by its wire contract. */
        int data_stripe_count = notification_data_stripe_count(&notif);
        size_t chunk_capacity = (data_stripe_count > 0)
            ? (size_t)data_stripe_count * QMAIL_DOWNLOAD_PAGE_SIZE : 0;
        uint64_t total_pages = (chunk_capacity && original_len)
            ? ((uint64_t)original_len + chunk_capacity - 1) /
                  chunk_capacity
            : 1;
        bool is_paged = total_pages > 1;

        log_info(LOG_CAT_COMMAND,
                 "QMail RECEIVE (on-demand): legacy file_type=0x%02X "
                 "original_size=%zu data_stripe_count=%d total_pages=%llu -> %s",
                 file_type, original_len, data_stripe_count,
                 (unsigned long long)total_pages,
                 is_paged ? "PAGED (cmd-75)" : "single object (cmd-70)");

        if (is_paged) {
            dl_res = download_paged_attachment_to_file(
                &notif, transport_iface, &enc_state.enc_key,
                &att, file_type, original_len, crc_present, expected_crc);
        } else {
            uint8_t *attachment_data = NULL;
            size_t attachment_len = 0;
            int sd = 0, sr = 0;
            char dle[256] = {0};
            dl_res = download_reassemble_file(
                &notif, transport_iface, &enc_state.enc_key,
                file_type, original_len, crc_present, expected_crc,
                &attachment_data, &attachment_len, &sd, &sr,
                dle, sizeof(dle));
            if (dl_res == RESULT_SUCCESS) {
                dl_res = qmail_receive_write_external_attachment(
                    &att, attachment_data, attachment_len);
                free(attachment_data);
            } else if (dle[0] && error_out && error_out_size) {
                snprintf(error_out, error_out_size, "%s", dle);
            }
        }
    }

    if (dl_res != RESULT_SUCCESS) {
        qmail_attachment_free(&att);
        if (error_out && error_out_size && !error_out[0])
            snprintf(error_out, error_out_size,
                     "Attachment download failed (%s)", result_to_string(dl_res));
        return dl_res;
    }

    /* 6. Persist the now-EXTERNAL attachment row (path + size set by the writer). */
    result_t upd = qmail_db_attachment_update_storage(
        attachment_id, QMAIL_STORAGE_EXTERNAL, att.file_path, att.size_bytes);
    if (upd != RESULT_SUCCESS) {
        log_warn(LOG_CAT_COMMAND,
                 "QMail RECEIVE (on-demand): downloaded but failed to update row %lld (%s)",
                 (long long)attachment_id, result_to_string(upd));
        /* The file is on disk; leave it. Report success of the download. */
    }

    log_info(LOG_CAT_COMMAND,
             "QMail RECEIVE (on-demand): stored attachment %lld file_type=0x%02X size=%zu path=%s",
             (long long)attachment_id, file_type, att.size_bytes, att.file_path);
    qmail_attachment_free(&att);
    return RESULT_SUCCESS;
}
