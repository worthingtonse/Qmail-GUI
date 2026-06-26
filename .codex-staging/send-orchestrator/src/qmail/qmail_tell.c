/**
 * qmail_tell.c - CMD 71: Notify Beacon of New Email
 *
 * Command data passed to protocol_build_packet():
 *   qmail_identity(32) + RoutingHeader(48) + Recipients(N*32) +
 *   NotificationBlock(64+M*32+manifest_len)
 *
 * raidax sees challenge(16) + qmail_identity(32) as qmail_preamble_t
 * (48 bytes) at the start of the decrypted body.
 *
 * Sent to: Recipient's beacon RAIDA server
 */

#include "qmail/qmail_commands.h"
#include "qmail/qmail_preamble.h"
#include "qmail/qmail_crypto.h"
#include "encryption_key.h"
#include "protocol.h"
#include "logging.h"
#include "utils.h"
#include <stdlib.h>
#include <string.h>

// ============================================================================
// TELL BODY BUILDER (CMD 71)
// ============================================================================

static result_t tell_build_body(uint8_t raida_id,
                                uint8_t **body, size_t *body_size,
                                void *user_data) {
    const qmail_tell_context_t *ctx = (const qmail_tell_context_t *)user_data;

    /* Body builder data excludes the protocol challenge and terminator. */
    size_t routing_hdr = 48;
    size_t recipients = (size_t)ctx->recipient_count * 32;
    size_t manifest_len = ctx->notification_block.manifest_len;
    if (manifest_len > QMAIL_TELL_MANIFEST_MAX_LEN) return RESULT_INVALID_PARAM;
    if (manifest_len > 0) {
        bool v1 = ctx->notification_block.manifest_version ==
                      QMAIL_TELL_MANIFEST_VERSION_1 &&
                  ctx->notification_block.file_entry_size ==
                      QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE;
        bool v2 = ctx->notification_block.manifest_version ==
                      QMAIL_TELL_MANIFEST_VERSION_2 &&
                  ctx->notification_block.file_entry_size ==
                      QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE;
        if (!v1 && !v2) return RESULT_INVALID_PARAM;
    }
    if (manifest_len > 0 &&
        manifest_len != (size_t)ctx->notification_block.file_count *
                        ctx->notification_block.file_entry_size) {
        return RESULT_INVALID_PARAM;
    }
    size_t notification_block_size = 64 + ((size_t)ctx->server_count * 32) + manifest_len;
    size_t total = QMAIL_PREAMBLE_SIZE + routing_hdr + recipients + notification_block_size;

    *body = (uint8_t *)calloc(total, 1);
    if (!*body) return RESULT_MEMORY_ERROR;
    *body_size = total;

    uint8_t *p = *body;
    size_t off = 0;

    /* Preamble */
    off += qmail_write_preamble(p + off, ctx->denomination, ctx->serial_number,
                                 ctx->device_id, ctx->an);

    /* Routing Header (48 bytes) */
    memcpy(p + off, ctx->file_guid, 16);
    off += 16;
    utils_write_u32_be(p + off, ctx->total_file_size);
    off += 4;
    off += 4; /* reserved */
    utils_write_u32_be(p + off, ctx->timestamp);
    off += 4;
    p[off++] = ctx->tell_type;
    p[off++] = (uint8_t)ctx->recipient_count;
    p[off++] = (uint8_t)ctx->server_count;
    memcpy(p + off, ctx->beacon_payment_locker, 16);
    off += 16;
    off += 1; /* reserved */

    /* Recipients (N * 32) */
    for (int i = 0; i < ctx->recipient_count; i++) {
        p[off++] = ctx->recipients[i].recipient_type;
        utils_write_u16_be(p + off, 0x0006); /* Network ID */
        off += 2;
        p[off++] = (uint8_t)ctx->recipients[i].denomination;
        off += protocol_write_sn(p + off, ctx->recipients[i].serial_number);
        /* Locker payment key (16 bytes) - using first recipient's locker for now */
        memcpy(p + off, ctx->locker_code, 16);
        off += 16;
        off += 8; /* reserved */
    }

    /* Notification block (the pass-through payload) */
    memcpy(p + off, &ctx->notification_block.header, 64);
    off += 64;
    for (int i = 0; i < ctx->server_count; i++) {
        memcpy(p + off, ctx->notification_block.servers[i].raw_entry, 32);
        off += 32;
    }
    if (manifest_len > 0) {
        const void *manifest =
            ctx->notification_block.manifest_version ==
                QMAIL_TELL_MANIFEST_VERSION_2
            ? (const void *)ctx->notification_block.manifest_bytes
            : (const void *)ctx->notification_block.files;
        memcpy(p + off, manifest, manifest_len);
        off += manifest_len;
    }

    return RESULT_SUCCESS;
}

// ============================================================================
// PUBLIC API
// ============================================================================

result_t qmail_cmd_tell(const qmail_tell_context_t *ctx,
                        uint8_t target_raida_id,
                        core_transport_t *transport_iface,
                        raida_result_t *result) {
    if (!ctx || !transport_iface || !result) return RESULT_INVALID_PARAM;

    log_debug(LOG_CAT_COMMAND, "Tell: target RAIDA %2d, %d recipients, file_size=%u",
              target_raida_id, ctx->recipient_count, ctx->total_file_size);

    raida_result_init(result);

    exec_config_t config;
    exec_config_init(&config);
    config.transport = TRANSPORT_TCP;
    config.mode = EXEC_MODE_SERIAL;
    config.timeout_ms = 15000;
    config.transport_iface = transport_iface;

    /* Encryption is mandatory for the current QMail protocol. The caller MUST
     * supply a key.
     * The legacy "no encryption" fallback was leftover dev scaffolding. */
    if (!ctx->enc_key) {
        log_error(LOG_CAT_COMMAND, "Tell: ctx->enc_key is NULL — encryption is required");
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

    result_t res = executor_run(CMD_GROUP_QMAIL, CMD_QMAIL_TELL,
                                tell_build_body, (void *)ctx,
                                &config, &exec_results);

    *result = exec_results.results[target_raida_id];
    exec_results.results[target_raida_id].has_response = false;
    exec_results.results[target_raida_id].response.body = NULL;

    if (res == RESULT_SUCCESS && result->success) {
        uint8_t st = result->status_code;
        if (raida_status_is_success(st)) {
            log_debug(LOG_CAT_COMMAND, "Tell RAIDA %2d: accepted (status=0x%02X)",
                      target_raida_id, st);
        } else {
            log_warn(LOG_CAT_COMMAND, "Tell RAIDA %2d: rejected (status=0x%02X)",
                     target_raida_id, st);
        }
    } else {
        log_warn(LOG_CAT_COMMAND, "Tell RAIDA %2d: failed (res=%d, success=%d)",
                 target_raida_id, res, result->success);
    }

    exec_results_free(&exec_results);
    return res;
}
