/**
 * api_handlers_qmail_utils.c - Shared helper implementations
 *
 * See docs/api_file_reduction_plan.txt §3 for rationale.
 */

#include "api_handlers_qmail_utils.h"
#include "qmail/qmail_object_transfer.h"
#include "utils.h"
#include <stdio.h>

// ============================================================================
// GUID / HEX CONVERSION
// ============================================================================

void api_qmail_guid_to_hex(const uint8_t guid[QMAIL_GUID_SIZE], char *hex_out) {
    for (int i = 0; i < QMAIL_GUID_SIZE; i++) {
        sprintf(hex_out + (i * 2), "%02x", guid[i]);
    }
    hex_out[QMAIL_GUID_SIZE * 2] = '\0';
}

bool api_qmail_hex_to_guid(const char *hex, uint8_t guid_out[QMAIL_GUID_SIZE]) {
    if (!hex || strlen(hex) != QMAIL_GUID_SIZE * 2) return false;
    for (int i = 0; i < QMAIL_GUID_SIZE; i++) {
        unsigned int byte;
        if (sscanf(hex + (i * 2), "%02x", &byte) != 1) return false;
        guid_out[i] = (uint8_t)byte;
    }
    return true;
}

bool api_qmail_parse_guid_or_error_with_rid(http_response_t *response,
                                            const char *hex,
                                            const char *missing_msg,
                                            const char *invalid_msg,
                                            uint8_t guid_out[QMAIL_GUID_SIZE],
                                            const char *rid) {
    if (!hex || !hex[0]) {
        const char *msg = missing_msg ? missing_msg : "Missing required GUID parameter";
        if (rid && rid[0]) {
            api_qmail_error_response_with_rid(response, msg, 400, rid);
        } else {
            json_error_response_from_string(response, msg, 400);
        }
        return false;
    }

    if (!api_qmail_hex_to_guid(hex, guid_out)) {
        const char *msg = invalid_msg ? invalid_msg : "Invalid GUID format";
        if (rid && rid[0]) {
            api_qmail_error_response_with_rid(response, msg, 400, rid);
        } else {
            json_error_response_from_string(response, msg, 400);
        }
        return false;
    }

    return true;
}

bool api_qmail_parse_guid_or_error(http_response_t *response,
                                   const char *hex,
                                   const char *missing_msg,
                                   const char *invalid_msg,
                                   uint8_t guid_out[QMAIL_GUID_SIZE]) {
    return api_qmail_parse_guid_or_error_with_rid(response, hex,
                                                   missing_msg, invalid_msg,
                                                   guid_out, NULL);
}

bool api_qmail_require_guid_param_with_rid(http_request_t *request,
                                           http_response_t *response,
                                           const char *param_name,
                                           const char *missing_msg,
                                           const char *invalid_msg,
                                           uint8_t guid_out[QMAIL_GUID_SIZE],
                                           const char *rid) {
    const char *hex = http_request_get_param(request, param_name);
    return api_qmail_parse_guid_or_error_with_rid(response, hex,
                                                   missing_msg, invalid_msg,
                                                   guid_out, rid);
}

bool api_qmail_require_guid_param(http_request_t *request,
                                  http_response_t *response,
                                  const char *param_name,
                                  const char *missing_msg,
                                  const char *invalid_msg,
                                  uint8_t guid_out[QMAIL_GUID_SIZE]) {
    return api_qmail_require_guid_param_with_rid(request, response, param_name,
                                                  missing_msg, invalid_msg,
                                                  guid_out, NULL);
}

// ============================================================================
// REQUEST PROLOGUE
// ============================================================================

result_t api_qmail_begin_request_with_rid(http_request_t *request,
                                          http_response_t *response,
                                          char *wallet_path, size_t wallet_path_len,
                                          core_transport_t **out_transport,
                                          const char *wallet_err_msg, int wallet_err_code,
                                          const char *transport_err_msg,
                                          const char *rid) {
    if (resolve_wallet_path(request, wallet_path, wallet_path_len) != RESULT_SUCCESS) {
        const char *msg = wallet_err_msg ? wallet_err_msg : "Invalid wallet_path";
        int code = wallet_err_code ? wallet_err_code : 400;
        if (rid && rid[0]) {
            api_qmail_error_response_with_rid(response, msg, code, rid);
        } else {
            json_error_response_from_string(response, msg, code);
        }
        return RESULT_ERROR;
    }

    core_transport_t *transport = transport_adapter_get();
    if (!transport) {
        const char *msg = transport_err_msg ? transport_err_msg : "Transport not initialized";
        if (rid && rid[0]) {
            api_qmail_error_response_with_rid(response, msg, 500, rid);
        } else {
            json_error_response_from_string(response, msg, 500);
        }
        return RESULT_ERROR;
    }

    if (out_transport) *out_transport = transport;
    return RESULT_SUCCESS;
}

result_t api_qmail_begin_request(http_request_t *request,
                                 http_response_t *response,
                                 char *wallet_path, size_t wallet_path_len,
                                 core_transport_t **out_transport,
                                 const char *wallet_err_msg, int wallet_err_code,
                                 const char *transport_err_msg) {
    return api_qmail_begin_request_with_rid(request, response,
                                             wallet_path, wallet_path_len,
                                             out_transport,
                                             wallet_err_msg, wallet_err_code,
                                             transport_err_msg, NULL);
}

result_t api_qmail_begin_existing_wallet_request_with_rid(http_request_t *request,
                                                          http_response_t *response,
                                                          char *wallet_path, size_t wallet_path_len,
                                                          core_transport_t **out_transport,
                                                          const char *wallet_err_msg, int wallet_err_code,
                                                          const char *wallet_not_found_msg,
                                                          const char *transport_err_msg,
                                                          const char *rid) {
    if (api_qmail_begin_request_with_rid(request, response,
                                          wallet_path, wallet_path_len,
                                          out_transport,
                                          wallet_err_msg, wallet_err_code,
                                          transport_err_msg, rid) != RESULT_SUCCESS) {
        return RESULT_ERROR;
    }

    if (!directory_exists(wallet_path)) {
        const char *msg = wallet_not_found_msg ? wallet_not_found_msg : "Wallet not found";
        if (rid && rid[0]) {
            api_qmail_error_response_with_rid(response, msg, 404, rid);
        } else {
            json_error_response_from_string(response, msg, 404);
        }
        return RESULT_NOT_FOUND;
    }

    return RESULT_SUCCESS;
}

result_t api_qmail_begin_existing_wallet_request(http_request_t *request,
                                                 http_response_t *response,
                                                 char *wallet_path, size_t wallet_path_len,
                                                 core_transport_t **out_transport,
                                                 const char *wallet_err_msg, int wallet_err_code,
                                                 const char *wallet_not_found_msg,
                                                 const char *transport_err_msg) {
    return api_qmail_begin_existing_wallet_request_with_rid(request, response,
                                                             wallet_path, wallet_path_len,
                                                             out_transport,
                                                             wallet_err_msg, wallet_err_code,
                                                             wallet_not_found_msg,
                                                             transport_err_msg, NULL);
}

// ============================================================================
// ENCRYPTION KEY SELECTION
// ============================================================================

result_t api_qmail_select_enc_key_with_rid(const char *wallet_path,
                                           uint32_t exclude_sn,
                                           http_response_t *response,
                                           raida_encryption_key_t *out,
                                           const char *err_msg,
                                           const char *rid) {
    encryption_key_init(out);
    result_t key_res = encryption_key_select(wallet_path, exclude_sn, out);
    if (key_res != RESULT_SUCCESS || !out->valid) {
        key_res = encryption_key_select_any_wallet(exclude_sn, out);
    }
    if (key_res != RESULT_SUCCESS || !out->valid) {
        const char *msg = err_msg ? err_msg : "No encryption key available";
        if (rid && rid[0]) {
            api_qmail_error_response_with_rid(response, msg, 500, rid);
        } else {
            json_error_response_from_string(response, msg, 500);
        }
        return RESULT_ERROR;
    }
    return RESULT_SUCCESS;
}

result_t api_qmail_select_enc_key(const char *wallet_path,
                                  uint32_t exclude_sn,
                                  http_response_t *response,
                                  raida_encryption_key_t *out,
                                  const char *err_msg) {
    return api_qmail_select_enc_key_with_rid(wallet_path, exclude_sn,
                                              response, out, err_msg, NULL);
}

// ============================================================================
// DB ERROR RESPONSE (three-way)
// ============================================================================

bool api_qmail_handle_db_error_with_rid(http_response_t *response, result_t r,
                                        const char *not_found_msg,
                                        const char *internal_err_msg,
                                        const char *rid) {
    if (r == RESULT_SUCCESS) return false;
    if (r == RESULT_NOT_FOUND) {
        const char *msg = not_found_msg ? not_found_msg : "Not found";
        if (rid && rid[0]) {
            api_qmail_error_response_with_rid(response, msg, 404, rid);
        } else {
            json_error_response_from_string(response, msg, 404);
        }
    } else {
        const char *msg = internal_err_msg ? internal_err_msg : "Database error";
        if (rid && rid[0]) {
            api_qmail_result_error_response_with_rid(response, msg, 500, r, rid);
        } else {
            api_qmail_result_error_response(response, msg, 500, r);
        }
    }
    return true;
}

bool api_qmail_handle_db_error(http_response_t *response, result_t r,
                               const char *not_found_msg,
                               const char *internal_err_msg) {
    return api_qmail_handle_db_error_with_rid(response, r, not_found_msg,
                                               internal_err_msg, NULL);
}

// ============================================================================
// COMMON RESPONSE HELPERS
// ============================================================================

void api_qmail_success_response(json_builder_t *jb, const char *message) {
    json_init(jb);
    json_object_begin(jb);
    json_add_bool(jb, "success", true);
    if (message && message[0]) {
        json_add_string(jb, "message", message);
    }
}

/* Shared core for api_qmail_result_error_response and its rid-carrying
 * sibling. rid may be NULL — when present it is added to the log line
 * AND emitted as `request_id` in the JSON body. */
static void api_qmail_result_error_response_core(http_response_t *response,
                                                 const char *message,
                                                 int code,
                                                 result_t detail_result,
                                                 const char *rid) {
    // Log every error response through one helper so every QMail handler
    // error path is greppable without per-handler instrumentation.
    // 4xx -> warn (user error); 5xx -> error (internal).
    const char *detail = (detail_result != RESULT_SUCCESS)
                         ? result_to_string(detail_result) : "(no detail)";
    bool have_rid = rid && rid[0];
    if (code >= 500) {
        if (have_rid) {
            log_error(LOG_CAT_COMMAND, "QMAIL error %d rid=%s: %s (%s)",
                      code, rid, message ? message : "(no message)", detail);
        } else {
            log_error(LOG_CAT_COMMAND, "QMAIL error %d: %s (%s)",
                      code, message ? message : "(no message)", detail);
        }
    } else {
        if (have_rid) {
            log_warn(LOG_CAT_COMMAND, "QMAIL error %d rid=%s: %s (%s)",
                     code, rid, message ? message : "(no message)", detail);
        } else {
            log_warn(LOG_CAT_COMMAND, "QMAIL error %d: %s (%s)",
                     code, message ? message : "(no message)", detail);
        }
    }

    json_builder_t jb;
    json_error_response(&jb, message, code);
    if (have_rid) {
        json_add_string(&jb, "request_id", rid);
    }
    if (detail_result != RESULT_SUCCESS) {
        json_add_string(&jb, "detail", result_to_string(detail_result));
    }
    json_object_end(&jb);
    http_response_set_json(response, &jb);
    response->status_code = code;
    if (code == 400) {
        strcpy(response->status_message, "Bad Request");
    } else if (code == 404) {
        strcpy(response->status_message, "Not Found");
    } else if (code == 409) {
        strcpy(response->status_message, "Conflict");
    } else {
        strcpy(response->status_message, "Internal Server Error");
    }
}

void api_qmail_result_error_response(http_response_t *response,
                                     const char *message,
                                     int code,
                                     result_t detail_result) {
    api_qmail_result_error_response_core(response, message, code,
                                          detail_result, NULL);
}

void api_qmail_result_error_response_with_rid(http_response_t *response,
                                              const char *message,
                                              int code,
                                              result_t detail_result,
                                              const char *rid) {
    api_qmail_result_error_response_core(response, message, code,
                                          detail_result, rid);
}

void api_qmail_make_body_preview(const char *body, size_t body_len,
                                 char *preview_out, size_t max_preview) {
    size_t plen;

    if (!preview_out || max_preview == 0) {
        return;
    }
    if (!body || body_len == 0) {
        preview_out[0] = '\0';
        return;
    }

    plen = body_len < (max_preview - 1) ? body_len : (max_preview - 1);
    memcpy(preview_out, body, plen);

    while (plen > 0 && ((uint8_t)preview_out[plen - 1] & 0xC0) == 0x80) {
        plen--;
    }
    if (plen > 0) {
        uint8_t last = (uint8_t)preview_out[plen - 1];
        if ((last & 0xE0) == 0xC0 && plen < 2) plen--;
        else if ((last & 0xF0) == 0xE0 && body_len > plen) plen--;
        else if ((last & 0xF8) == 0xF0 && body_len > plen) plen--;
    }

    preview_out[plen] = '\0';
}

void api_qmail_add_ping_notifications(json_builder_t *jb,
                                      const qmail_ping_response_t *ping_resp) {
    if (!jb || !ping_resp || ping_resp->notification_count <= 0) {
        return;
    }

    json_key(jb, "notifications");
    json_array_begin(jb);
    for (int i = 0; i < ping_resp->notification_count; i++) {
        char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
        api_qmail_guid_to_hex(ping_resp->notifications[i].file_guid, guid_hex);

        const qmail_tell_notification_t *n = &ping_resp->notifications[i];

        json_object_begin(jb);
        json_add_string(jb, "file_guid", guid_hex);
        json_add_int64(jb, "sender_sn", (int64_t)n->sender_sn);
        json_add_int64(jb, "timestamp", (int64_t)n->timestamp);
        json_add_int(jb, "tell_type", (int)n->tell_type);
        json_add_int64(jb, "total_file_size", (int64_t)n->total_file_size);
        json_add_int(jb, "manifest_version", (int)n->manifest_version);
        json_add_int(jb, "file_count", (int)n->file_count);
        json_add_int(jb, "manifest_flags", (int)n->manifest_flags);
        if (n->manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 &&
            n->file_count > 0 &&
            n->file_entry_size == QMAIL_TELL_MANIFEST_ENTRY_SIZE &&
            n->manifest_len == (uint16_t)(n->file_count * n->file_entry_size)) {
            json_key(jb, "files");
            json_array_begin(jb);
            for (int f = 0; f < n->file_count; f++) {
                const qmail_file_manifest_entry_t *mf = &n->files[f];
                json_object_begin(jb);
                json_add_int(jb, "file_type", (int)mf->file_type);
                json_add_int(jb, "flags", (int)mf->file_flags);
                json_add_int64(jb, "size_bytes",
                               (int64_t)utils_read_u64_be(mf->original_size));
                json_add_int64(jb, "crc32",
                               (int64_t)utils_read_u32_be(mf->crc32));
                json_object_end(jb);
            }
            json_array_end(jb);
        } else if (n->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2 &&
                   n->file_count > 0 &&
                   n->file_entry_size == QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE &&
                   n->manifest_len ==
                       (uint16_t)(n->file_count * n->file_entry_size)) {
            json_key(jb, "files");
            json_array_begin(jb);
            for (int f = 0; f < n->file_count; f++) {
                qmail_ot_manifest_v2_entry_t mf;
                if (qmail_ot_parse_manifest_v2_entry(
                        n->manifest_bytes +
                            (size_t)f * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE,
                        &mf) != RESULT_SUCCESS) {
                    continue;
                }
                char object_id[QMAIL_OT_ID_SIZE * 2 + 1];
                char object_hash[QMAIL_OT_HASH_SIZE * 2 + 1];
                utils_bytes_to_hex(mf.object_id, QMAIL_OT_ID_SIZE, object_id);
                utils_bytes_to_hex(mf.object_hash, QMAIL_OT_HASH_SIZE,
                                   object_hash);
                json_object_begin(jb);
                json_add_int(jb, "file_type", (int)mf.file_type);
                json_add_int(jb, "flags", (int)mf.file_flags);
                json_add_int(jb, "storage_protocol",
                             (int)mf.storage_protocol);
                json_add_int(jb, "hash_algorithm",
                             (int)mf.hash_algorithm);
                json_add_string(jb, "object_id", object_id);
                json_add_int64(jb, "generation", (int64_t)mf.generation);
                json_add_int64(jb, "size_bytes",
                               (int64_t)mf.original_size);
                json_add_string(jb, "object_hash", object_hash);
                json_object_end(jb);
            }
            json_array_end(jb);
        }
        json_object_end(jb);
    }
    json_array_end(jb);
}

// ============================================================================
// REQUEST CORRELATION ID (rid)
// ============================================================================

void api_qmail_generate_rid(char *out) {
    if (!out) return;
    uint8_t bytes[8];
    crypto_random_bytes(bytes, sizeof(bytes));
    sprintf(out, "%02x%02x%02x%02x%02x%02x%02x%02x",
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7]);
    out[API_QMAIL_RID_LEN - 1] = '\0';
}

void api_qmail_add_request_id(json_builder_t *jb, const char *rid) {
    if (!jb || !rid) return;
    json_add_string(jb, "request_id", rid);
}

void api_qmail_error_response_with_rid(http_response_t *response,
                                       const char *message,
                                       int code,
                                       const char *rid) {
    json_builder_t jb;
    json_error_response(&jb, message, code);
    if (rid && rid[0]) {
        json_add_string(&jb, "request_id", rid);
    }
    json_object_end(&jb);
    http_response_set_json(response, &jb);
    response->status_code = code;
    if (code == 400)      strcpy(response->status_message, "Bad Request");
    else if (code == 404) strcpy(response->status_message, "Not Found");
    else if (code == 409) strcpy(response->status_message, "Conflict");
    else                  strcpy(response->status_message, "Internal Server Error");
}

// ============================================================================
// RECIPIENT PARAMETER COLLECTION
// ============================================================================

result_t api_qmail_collect_recipient_param(http_request_t *request,
                                           const char *name,
                                           char *buffer, size_t buffer_size) {
    if (!request || !name || !buffer || buffer_size == 0) {
        return RESULT_INVALID_PARAM;
    }

    buffer[0] = '\0';

    /* Multi-value read: each ?to=X&to=Y pair becomes one slot. */
    const char *values[QMAIL_MAX_RECIPIENTS];
    int value_count = http_request_get_param_multi(request, name,
                                                   values, QMAIL_MAX_RECIPIENTS);
    if (value_count == 0) {
        return RESULT_NOT_FOUND;
    }

    /* Join non-empty values with ';' so qmail_parse_recipients can split.
     * A single empty value (?to=) is skipped, not treated as a recipient. */
    size_t used = 0;
    for (int i = 0; i < value_count; i++) {
        const char *value = values[i];
        if (!value || !value[0]) continue;

        size_t value_len = strlen(value);
        if (used > 0) {
            if (used + 1 >= buffer_size) return RESULT_ERROR;
            buffer[used++] = ';';
        }
        if (used + value_len >= buffer_size) return RESULT_ERROR;
        memcpy(buffer + used, value, value_len);
        used += value_len;
    }

    if (used == 0) {
        return RESULT_NOT_FOUND;
    }

    buffer[used] = '\0';
    return RESULT_SUCCESS;
}
