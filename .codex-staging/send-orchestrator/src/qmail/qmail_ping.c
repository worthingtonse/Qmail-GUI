/**
 * qmail_ping.c - CMD 72/73: Ping (Long-Poll) and Peek (Quick Check)
 *
 * Command data passed to protocol_build_packet() is 36 bytes:
 *   qmail_identity(32) + since_timestamp(4)
 *
 * raidax sees challenge(16) + qmail_identity(32) as qmail_preamble_t
 * (48 bytes) at the start of the decrypted body.
 *
 * Sent to: User's beacon RAIDA server.
 * Ping: Long-poll with 600s timeout.
 * Peek: Quick check with 10s timeout.
 *
 * Response format:
 *   tell_count(1) + padding(7) +
 *   FileHeader(64) + ServerEntries(32*M) + Manifest(manifest_len)
 *   per notification
 */

#include "qmail/qmail_commands.h"
#include "qmail/qmail_preamble.h"
#include "qmail/qmail_crypto.h"
#include "encryption_key.h"
#include "protocol.h"
#include "raida_status.h"
#include "logging.h"
#include "utils.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ============================================================================
// SHARED BODY BUILDER (used by both PING2 and PEEK2)
// ============================================================================

static void set_legacy_body_manifest(qmail_tell_notification_t *n) {
    if (!n) return;
    n->file_count = 1;
    n->file_entry_size = QMAIL_TELL_MANIFEST_ENTRY_SIZE;
    n->manifest_len = 0;
    n->manifest_flags = 0;
    memset(&n->files[0], 0, sizeof(n->files[0]));
    n->files[0].file_type = QMAIL_FILE_BODY;
    n->files[0].file_flags = QMAIL_FILE_MANIFEST_FLAG_BODY;
    utils_write_u64_be(n->files[0].original_size, n->total_file_size);
}

static result_t ping_peek_build_body(uint8_t raida_id,
                                      uint8_t **body, size_t *body_size,
                                      void *user_data) {
    const qmail_ping_context_t *ctx = (const qmail_ping_context_t *)user_data;
    (void)raida_id;

    /* Always include the 4-byte timestamp — PEEK requires it (server checks
     * body_size >= 54) and PING tolerates the extra bytes (checks >= 50). */

    /* 32 bytes of preamble (after challenge) + 4-byte timestamp */
    size_t total = 36;

    *body = (uint8_t *)calloc(total, 1);
    if (!*body) return RESULT_MEMORY_ERROR;
    *body_size = total;

    uint8_t *p = *body;
    size_t off = 0;

    /* ===== PREAMBLE after challenge (32 bytes) ===== */
    off += qmail_write_preamble(p + off, ctx->denomination, ctx->serial_number,
                                 ctx->device_id, ctx->an);

    /* Since Timestamp (after preamble, 4 bytes) */
    utils_write_u32_be(p + off, ctx->since_timestamp);
    off += 4;

    /* No terminator — protocol layer adds 0x3E 0x3E */

    log_info(LOG_CAT_COMMAND, "Peek/Ping body: sn=%u denom=%d since=%u total=%zu",
             ctx->serial_number, ctx->denomination, ctx->since_timestamp, total);
    log_debug(LOG_CAT_COMMAND,
              "Peek/Ping outgoing body built (preamble AN redacted, total=%zu)", total);

    return RESULT_SUCCESS;
}

// ============================================================================
// RESPONSE PARSER
// ============================================================================

static result_t parse_ping_response(const char *cmd_name,
                                    const raida_result_t *exec_result,
                                    qmail_ping_response_t *response) {
    memset(response, 0, sizeof(qmail_ping_response_t));

    if (!exec_result->has_response) {
        /* Legacy long-poll behavior: the server closed the connection
         * without sending a response. Newer servers return an explicit
         * RAIDA_STATUS_TIMEOUT (245) instead, handled below. Either way
         * means no mail arrived — treat as empty success so the beacon
         * re-polls without backoff. timed_out stays false here so callers
         * can tell this case apart from an explicit 245. */
        response->raida_status = 0;
        response->timed_out    = false;
        log_debug(LOG_CAT_COMMAND, "%s: no response (legacy long-poll close)", cmd_name);
        return RESULT_SUCCESS;
    }
    response->raida_status = exec_result->response.status;
    if (response->raida_status == RAIDA_STATUS_TIMEOUT) {
        /* Long-poll completed cleanly with no data. Server held the socket
         * for the full timeout, then sent this status and closed. */
        response->timed_out = true;
        log_debug(LOG_CAT_COMMAND, "%s: timeout (245) — no new mail", cmd_name);
        return RESULT_SUCCESS;
    }
    if (!raida_status_is_success(response->raida_status)) {
        log_warn(LOG_CAT_COMMAND, "%s: RAIDA status 0x%02X (%s)",
                 cmd_name, response->raida_status,
                 raida_status_to_string(response->raida_status));
        return RESULT_PERMISSION_DENIED;
    }

    const uint8_t *body = exec_result->response.body;
    size_t body_len = exec_result->response.body_len;

    log_info(LOG_CAT_COMMAND, "%s: response body_len=%zu, status=0x%02X",
             cmd_name, body_len, exec_result->response.status);
    if (body && body_len > 0) {
        size_t dump_len = body_len < 64 ? body_len : 64;
        char label[64];
        snprintf(label, sizeof(label), "%s response body", cmd_name);
        log_debug_hex_dump(body, dump_len, label);
    }

    if (!body || body_len < 8) return RESULT_SUCCESS;

    response->tell_count = body[0];
    log_info(LOG_CAT_COMMAND, "%s: tell_count=%d (byte[0]=0x%02X)",
             cmd_name, response->tell_count, body[0]);
    if (response->tell_count == 0) return RESULT_SUCCESS;

    response->notifications = (qmail_tell_notification_t *)calloc(
        response->tell_count, sizeof(qmail_tell_notification_t));
    if (!response->notifications) return RESULT_MEMORY_ERROR;

    size_t offset = 8;
    for (int i = 0; i < response->tell_count; i++) {
        if (offset + 64 > body_len) break;

        qmail_file_header_t *header = (qmail_file_header_t *)(body + offset);
        qmail_tell_notification_t *n = &response->notifications[i];

        memcpy(n->file_guid, header->email_id, 16);
        memcpy(n->locker_code, header->locker_code, 16);
        n->sender_sn = (header->sender_serial_number[0] << 24) | (header->sender_serial_number[1] << 16) |
                       (header->sender_serial_number[2] << 8) | header->sender_serial_number[3];
        n->sender_denomination = header->sender_denomination;
        n->timestamp = (header->timestamp[0] << 24) | (header->timestamp[1] << 16) |
                       (header->timestamp[2] << 8) | header->timestamp[3];
        n->total_file_size = (header->total_file_size[0] << 24) | (header->total_file_size[1] << 16) |
                             (header->total_file_size[2] << 8) | header->total_file_size[3];
        n->tell_type = header->tell_type;
        n->server_count = header->stripe_count;
        n->manifest_version = header->reserved[0];
        n->file_count = header->reserved[1];
        n->file_entry_size = header->reserved[2];
        n->manifest_len = utils_read_u16_be(header->reserved + 3);
        n->manifest_flags = header->reserved[5];

        offset += 64;
        for (int s = 0; s < n->server_count; s++) {
            if (offset + 32 > body_len) break;
            if (s < QMAIL_MAX_SERVERS) {
                n->servers[s].stripe_index = body[offset];
                n->servers[s].stripe_type = body[offset + 1];
                n->servers[s].server_id = body[offset + 2];
                memcpy(n->servers[s].raw_entry, body + offset, 32);
            }
            offset += 32;
        }

        if (n->server_count > QMAIL_MAX_SERVERS) {
            log_warn(LOG_CAT_COMMAND,
                     "%s: notification %d reports %d servers; stored first %d",
                     cmd_name, i + 1, n->server_count, QMAIL_MAX_SERVERS);
            n->server_count = QMAIL_MAX_SERVERS;
        }

        if (n->manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 ||
            n->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
            uint8_t expected_entry_size =
                n->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2
                ? QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE
                : QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE;
            bool manifest_ok =
                n->file_count > 0 &&
                n->file_count <= QMAIL_TELL_MANIFEST_MAX_FILES &&
                n->file_entry_size == expected_entry_size &&
                n->manifest_len == (uint16_t)(n->file_count * n->file_entry_size) &&
                n->manifest_len <= QMAIL_TELL_MANIFEST_MAX_LEN;
            if (!manifest_ok || offset + n->manifest_len > body_len) {
                log_warn(LOG_CAT_COMMAND,
                         "%s: notification %d has invalid manifest "
                         "(version=%u files=%u entry=%u len=%u)",
                         cmd_name, i + 1, n->manifest_version, n->file_count,
                         n->file_entry_size, n->manifest_len);
                break;
            }
            if (n->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
                memcpy(n->manifest_bytes, body + offset, n->manifest_len);
            } else {
                memcpy(n->files, body + offset, n->manifest_len);
            }
            offset += n->manifest_len;
        } else if (n->manifest_version == QMAIL_TELL_MANIFEST_VERSION_LEGACY) {
            set_legacy_body_manifest(n);
            /* Legacy pre-manifest records may carry the old 18-byte footer.
             * Only legacy records are allowed to consume it. */
            if (offset + 18 <= body_len && body[offset] == 0x50 && body[offset + 1] == 0x10) {
                offset += 18;
            }
        } else {
            log_warn(LOG_CAT_COMMAND,
                     "%s: notification %d uses unsupported manifest version %u",
                     cmd_name, i + 1, n->manifest_version);
            break;
        }

        response->notification_count++;
        log_debug(LOG_CAT_COMMAND,
                  "%s: notification %d/%d from DN%d.%u size=%u servers=%d files=%u manifest=%u",
                  cmd_name, i + 1, response->tell_count,
                  n->sender_denomination, n->sender_sn,
                  n->total_file_size, n->server_count,
                  n->file_count, n->manifest_version);
    }

    return RESULT_SUCCESS;
}

// ============================================================================
// PUBLIC API: PING (long-poll)
// ============================================================================

result_t qmail_cmd_ping(const qmail_ping_context_t *ctx,
                        uint8_t target_raida_id,
                        core_transport_t *transport_iface,
                        uint32_t timeout_ms,
                        qmail_ping_response_t *response) {
    if (!ctx || !transport_iface || !response) return RESULT_INVALID_PARAM;

    log_debug(LOG_CAT_COMMAND, "Ping: target RAIDA %2d, SN %u",
              target_raida_id, ctx->serial_number);

    exec_config_t config;
    exec_config_init(&config);
    config.transport = TRANSPORT_TCP;
    config.mode = EXEC_MODE_SERIAL;
    config.timeout_ms = timeout_ms > 0 ? timeout_ms : (QMAIL_PING_TIMEOUT_SEC * 1000);
    config.transport_iface = transport_iface;

    /* Encryption is mandatory for the current QMail protocol. The caller MUST
     * supply a key.
     * The legacy "no encryption" fallback was leftover dev scaffolding. */
    if (!ctx->enc_key) {
        log_error(LOG_CAT_COMMAND, "Ping: ctx->enc_key is NULL — encryption is required");
        return RESULT_INVALID_PARAM;
    }
    qmail_encryption_state_t enc_state;
    qmail_apply_encryption_key((const raida_encryption_key_t *)ctx->enc_key,
                               &config, &enc_state);

    uint8_t include[] = { target_raida_id };
    config.include_only = include;
    config.include_count = 1;

    exec_results_t exec_results;
    exec_results_init(&exec_results);

    result_t res = executor_run(CMD_GROUP_QMAIL, CMD_QMAIL_PING,
                                ping_peek_build_body, (void *)ctx,
                                &config, &exec_results);

    if (res == RESULT_SUCCESS) {
        res = parse_ping_response("Ping", &exec_results.results[target_raida_id], response);
        if (res == RESULT_SUCCESS) {
            log_debug(LOG_CAT_COMMAND, "Ping RAIDA %2d: %d notifications",
                      target_raida_id, response->notification_count);
        } else {
            log_warn(LOG_CAT_COMMAND, "Ping RAIDA %2d: parse failed (%d)",
                     target_raida_id, res);
        }
    } else {
        log_warn(LOG_CAT_COMMAND, "Ping RAIDA %2d: executor failed (%d)",
                 target_raida_id, res);
    }

    exec_results_free(&exec_results);
    return res;
}

// ============================================================================
// PUBLIC API: PEEK (quick check)
// ============================================================================

result_t qmail_cmd_peek(const qmail_ping_context_t *ctx,
                        uint8_t target_raida_id,
                        core_transport_t *transport_iface,
                        qmail_ping_response_t *response) {
    if (!ctx || !transport_iface || !response) return RESULT_INVALID_PARAM;

    log_debug(LOG_CAT_COMMAND, "Peek: target RAIDA %2d, SN %u",
              target_raida_id, ctx->serial_number);

    exec_config_t config;
    exec_config_init(&config);
    config.transport = TRANSPORT_TCP;
    config.mode = EXEC_MODE_SERIAL;
    config.timeout_ms = 10000;
    config.transport_iface = transport_iface;

    /* Encryption is mandatory for the current QMail protocol. The caller MUST
     * supply a key.
     * The legacy "no encryption" fallback was leftover dev scaffolding. */
    if (!ctx->enc_key) {
        log_error(LOG_CAT_COMMAND, "Peek: ctx->enc_key is NULL — encryption is required");
        return RESULT_INVALID_PARAM;
    }
    qmail_encryption_state_t enc_state;
    qmail_apply_encryption_key((const raida_encryption_key_t *)ctx->enc_key,
                               &config, &enc_state);

    uint8_t include[] = { target_raida_id };
    config.include_only = include;
    config.include_count = 1;

    exec_results_t exec_results;
    exec_results_init(&exec_results);

    result_t res = executor_run(CMD_GROUP_QMAIL, CMD_QMAIL_PEEK,
                                ping_peek_build_body, (void *)ctx,
                                &config, &exec_results);

    if (res == RESULT_SUCCESS) {
        res = parse_ping_response("Peek", &exec_results.results[target_raida_id], response);
        if (res == RESULT_SUCCESS) {
            log_debug(LOG_CAT_COMMAND, "Peek RAIDA %2d: %d notifications",
                      target_raida_id, response->notification_count);
        } else {
            log_warn(LOG_CAT_COMMAND, "Peek RAIDA %2d: parse failed (%d)",
                     target_raida_id, res);
        }
    } else {
        log_warn(LOG_CAT_COMMAND, "Peek RAIDA %2d: executor failed (%d)",
                 target_raida_id, res);
    }

    exec_results_free(&exec_results);
    return res;
}
