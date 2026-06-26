/**
 * qmail_receive_object_transfer.h - Revised-manifest object receiver
 */

#ifndef QMAIL_RECEIVE_OBJECT_TRANSFER_H
#define QMAIL_RECEIVE_OBJECT_TRANSFER_H

#include "qmail/qmail_object_transfer.h"
#include "qmail/qmail_types.h"
#include "results.h"
#include <stddef.h>
#include <stdint.h>

typedef struct {
    int stripes_downloaded;
    int stripes_recovered;
} qmail_receive_object_result_t;

/**
 * Download a revised-manifest object from its advertised QMail servers,
 * reconstruct its bit-interleaved data stripes, verify its logical SHA-256,
 * and atomically replace destination_path.
 */
result_t qmail_receive_object_download(
    const qmail_tell_notification_t *notification,
    const qmail_ot_manifest_v2_entry_t *entry,
    const char *wallet_path,
    const char *destination_path,
    qmail_receive_object_result_t *result,
    char *error_out,
    size_t error_out_size);

/**
 * Reconstruct already-downloaded stripe files. Paths are indexed by stripe
 * index; one data path may be NULL when a parity path is present.
 *
 * This is public so the streaming reconstruction contract can be tested
 * without network access.
 */
result_t qmail_receive_object_reconstruct(
    const char *const stripe_paths[QMAIL_MAX_SERVERS],
    int data_stripe_count,
    int parity_stripe_index,
    uint64_t original_size,
    const uint8_t expected_hash[QMAIL_OT_HASH_SIZE],
    const char *destination_path,
    int *stripes_recovered_out,
    char *error_out,
    size_t error_out_size);

#endif /* QMAIL_RECEIVE_OBJECT_TRANSFER_H */
