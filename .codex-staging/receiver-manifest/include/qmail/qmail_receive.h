/**
 * qmail_receive.h - Receive Email Orchestrator
 *
 * Orchestrates both readable manifest layouts:
 *   - revised manifest: persistent object ranges -> recover -> stream reassemble
 *   - manifest v1: legacy page download -> recover -> reassemble
 */

#ifndef QMAIL_RECEIVE_H
#define QMAIL_RECEIVE_H

#include "qmail/qmail_types.h"
#include "core_transport.h"

/**
 * Download and reassemble an email from QMail servers.
 *
 * Selects a fresh encryption key at call time using the standard
 * encryption_key_select() pattern. The mailbox identity coin is excluded
 * from key selection to protect privacy (its SN would be visible in
 * unencrypted request headers).
 *
 * Flow:
 *   1. Select encryption key (wallet_path first, then any wallet)
 *   2. Download stripes in parallel from servers listed in tell notification
 *   3. If 1 stripe is missing, recover from parity
 *   4. Reassemble bit-interleaved stripes into original data
 *   5. Store email in database
 *
 * @param notification     Tell notification containing server locations
 * @param transport_iface  Transport interface
 * @param wallet_path      Preferred wallet for key selection (NULL = any wallet)
 * @param result           Output: receive result
 * @return RESULT_SUCCESS if receive orchestration completed
 */
result_t qmail_receive_email(const qmail_tell_notification_t *notification,
                              core_transport_t *transport_iface,
                              const char *wallet_path,
                              qmail_receive_result_t *result);

/**
 * Download ONE attachment on demand (user clicked a PENDING attachment).
 *
 * Reconstructs the tell from the stored received-tell row (by GUID), downloads
 * the single requested file_type through either revised-manifest Object
 * Transfer or the readable manifest-v1 legacy path, writes it to the external
 * attachment file, and flips the attachment DB row from PENDING to EXTERNAL.
 *
 * @param file_guid       16-byte email GUID
 * @param file_type       attachment file_type (0x0A+)
 * @param transport_iface Transport interface
 * @param attachment_id   DB row id of the PENDING attachment to fill in
 * @param error_out       Optional buffer for a human-readable error
 * @param error_out_size  Size of error_out
 * @return RESULT_SUCCESS when the attachment is downloaded and stored
 */
result_t qmail_receive_attachment_on_demand(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                            uint8_t file_type,
                                            core_transport_t *transport_iface,
                                            int64_t attachment_id,
                                            char *error_out,
                                            size_t error_out_size);

#endif /* QMAIL_RECEIVE_H */
