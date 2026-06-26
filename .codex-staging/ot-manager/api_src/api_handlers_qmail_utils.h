/**
 * api_handlers_qmail_utils.h - Shared helpers for QMail REST handlers
 *
 * Internal header — only included by api_handlers_qmail_*.c. Lives beside
 * api_handlers.h in api_src/, not under include/api/.
 *
 * Collects the boilerplate that every qmail handler repeats: wallet path +
 * transport lookup, encryption key selection with fallback, GUID hex
 * conversion, and the three-way DB error response.
 *
 * See docs/api_file_reduction_plan.txt §3 for rationale.
 */

#ifndef API_HANDLERS_QMAIL_UTILS_H
#define API_HANDLERS_QMAIL_UTILS_H

#include "api_handlers.h"
#include "qmail/qmail_db.h"
#include "encryption_key.h"
#include "api/transport_adapter.h"

// ============================================================================
// GUID / HEX CONVERSION
// ============================================================================

/**
 * Format a 16-byte GUID as a lowercase hex string.
 * hex_out must be at least QMAIL_GUID_SIZE*2 + 1 bytes.
 */
void api_qmail_guid_to_hex(const uint8_t guid[QMAIL_GUID_SIZE], char *hex_out);

/**
 * Parse a lowercase hex string into a 16-byte GUID. Returns false if the
 * input is NULL, not exactly QMAIL_GUID_SIZE*2 chars, or contains non-hex.
 */
bool api_qmail_hex_to_guid(const char *hex, uint8_t guid_out[QMAIL_GUID_SIZE]);

/**
 * Parse a GUID string that may come from any source (request param, JSON body).
 * On failure, writes a 400 error response using the supplied messages and
 * returns false.
 */
bool api_qmail_parse_guid_or_error(http_response_t *response,
                                   const char *hex,
                                   const char *missing_msg,
                                   const char *invalid_msg,
                                   uint8_t guid_out[QMAIL_GUID_SIZE]);

/**
 * rid-carrying variant of api_qmail_parse_guid_or_error(). The 400 body
 * includes `request_id` when rid is non-NULL.
 */
bool api_qmail_parse_guid_or_error_with_rid(http_response_t *response,
                                            const char *hex,
                                            const char *missing_msg,
                                            const char *invalid_msg,
                                            uint8_t guid_out[QMAIL_GUID_SIZE],
                                            const char *rid);

/**
 * Fetch and parse a GUID from a request parameter.
 * On failure, writes a 400 error response and returns false.
 */
bool api_qmail_require_guid_param(http_request_t *request,
                                  http_response_t *response,
                                  const char *param_name,
                                  const char *missing_msg,
                                  const char *invalid_msg,
                                  uint8_t guid_out[QMAIL_GUID_SIZE]);

/**
 * rid-carrying variant of api_qmail_require_guid_param(). The 400 body
 * includes `request_id` when rid is non-NULL.
 */
bool api_qmail_require_guid_param_with_rid(http_request_t *request,
                                           http_response_t *response,
                                           const char *param_name,
                                           const char *missing_msg,
                                           const char *invalid_msg,
                                           uint8_t guid_out[QMAIL_GUID_SIZE],
                                           const char *rid);

// ============================================================================
// REQUEST PROLOGUE (wallet path + transport)
// ============================================================================

/**
 * Resolve the wallet_path param and fetch the transport singleton.
 *
 * On failure, writes the error response itself and returns a non-SUCCESS
 * result; the caller should simply `return`.
 *
 * Error behavior is configurable so call sites can preserve their existing
 * error strings / status codes exactly. Pass NULL for wallet_err_msg /
 * transport_err_msg to use the defaults ("Invalid wallet_path" 400 and
 * "Transport not initialized" 500).
 */
result_t api_qmail_begin_request(http_request_t *request,
                                 http_response_t *response,
                                 char *wallet_path, size_t wallet_path_len,
                                 core_transport_t **out_transport,
                                 const char *wallet_err_msg, int wallet_err_code,
                                 const char *transport_err_msg);

/**
 * rid-carrying variant of api_qmail_begin_request(). Internal error
 * responses include `request_id` in the JSON body when rid is non-NULL.
 * Pass NULL to fall back to the no-rid behavior.
 */
result_t api_qmail_begin_request_with_rid(http_request_t *request,
                                          http_response_t *response,
                                          char *wallet_path, size_t wallet_path_len,
                                          core_transport_t **out_transport,
                                          const char *wallet_err_msg, int wallet_err_code,
                                          const char *transport_err_msg,
                                          const char *rid);

/**
 * Variant of api_qmail_begin_request() that also requires the resolved wallet
 * directory to exist.
 */
result_t api_qmail_begin_existing_wallet_request(http_request_t *request,
                                                 http_response_t *response,
                                                 char *wallet_path, size_t wallet_path_len,
                                                 core_transport_t **out_transport,
                                                 const char *wallet_err_msg, int wallet_err_code,
                                                 const char *wallet_not_found_msg,
                                                 const char *transport_err_msg);

/**
 * rid-carrying variant of api_qmail_begin_existing_wallet_request().
 * Internal error responses include `request_id` in the JSON body when
 * rid is non-NULL.
 */
result_t api_qmail_begin_existing_wallet_request_with_rid(http_request_t *request,
                                                          http_response_t *response,
                                                          char *wallet_path, size_t wallet_path_len,
                                                          core_transport_t **out_transport,
                                                          const char *wallet_err_msg, int wallet_err_code,
                                                          const char *wallet_not_found_msg,
                                                          const char *transport_err_msg,
                                                          const char *rid);

// ============================================================================
// ENCRYPTION KEY SELECTION (wallet-specific then any-wallet fallback)
// ============================================================================

/**
 * Select an encryption key for the given wallet, falling back to any wallet
 * if the wallet-specific lookup fails. Follows the CLAUDE.md rule for key
 * selection.
 *
 * On failure, writes a 500 error response with the given message (or a
 * default if NULL) and returns a non-SUCCESS result.
 */
result_t api_qmail_select_enc_key(const char *wallet_path,
                                  uint32_t exclude_sn,
                                  http_response_t *response,
                                  raida_encryption_key_t *out,
                                  const char *err_msg);

/**
 * rid-carrying variant of api_qmail_select_enc_key(). The 500 error
 * body includes `request_id` when rid is non-NULL.
 */
result_t api_qmail_select_enc_key_with_rid(const char *wallet_path,
                                           uint32_t exclude_sn,
                                           http_response_t *response,
                                           raida_encryption_key_t *out,
                                           const char *err_msg,
                                           const char *rid);

// ============================================================================
// DB ERROR RESPONSE (three-way)
// ============================================================================

/**
 * Handle a DB result that may be NOT_FOUND or an internal error.
 * Returns true if an error response was written (caller should return).
 * Returns false only if r == RESULT_SUCCESS.
 *
 * Only use at call sites that follow the clean early-return pattern —
 * handlers that interleave success/error branches inside a single
 * json_builder_t should continue to do so manually.
 */
bool api_qmail_handle_db_error(http_response_t *response, result_t r,
                               const char *not_found_msg,
                               const char *internal_err_msg);

/**
 * rid-carrying variant of api_qmail_handle_db_error(). Both the 404
 * not_found body and the 500 internal-error body include `request_id`
 * when rid is non-NULL.
 */
bool api_qmail_handle_db_error_with_rid(http_response_t *response, result_t r,
                                        const char *not_found_msg,
                                        const char *internal_err_msg,
                                        const char *rid);

// ============================================================================
// COMMON RESPONSE HELPERS
// ============================================================================

/**
 * Start a standard QMail success response. Adds `"success": true` and, when
 * provided, a `"message"` field. Caller continues adding endpoint-specific
 * fields and must still close the object / set the response.
 */
void api_qmail_success_response(json_builder_t *jb, const char *message);

/**
 * Write a standardized QMail error response using the repo-wide
 * `{ error, message, code }` envelope and, when available, a machine-readable
 * `detail` derived from a result_t.
 */
void api_qmail_result_error_response(http_response_t *response,
                                     const char *message,
                                     int code,
                                     result_t detail_result);

/**
 * Same as api_qmail_result_error_response but also emits `request_id`
 * in the JSON body and includes the rid in the warn/error log line.
 * Use from any handler that already has a rid in scope so 500 bodies
 * carry the same correlation id as 4xx bodies emitted by
 * api_qmail_error_response_with_rid().
 */
void api_qmail_result_error_response_with_rid(http_response_t *response,
                                              const char *message,
                                              int code,
                                              result_t detail_result,
                                              const char *rid);

/**
 * Build a UTF-8-safe preview of an email body, truncating at a character
 * boundary. max_preview includes the terminating null space in preview_out.
 */
void api_qmail_make_body_preview(const char *body, size_t body_len,
                                 char *preview_out, size_t max_preview);

/**
 * Serialize the notifications array from a qmail ping/peek response.
 */
void api_qmail_add_ping_notifications(json_builder_t *jb,
                                      const qmail_ping_response_t *ping_resp);

// ============================================================================
// REQUEST CORRELATION ID (rid)
// ============================================================================

#define API_QMAIL_RID_LEN 17  /* 16 hex chars + '\0' */

/**
 * Generate a 16-char lowercase-hex correlation id for one HTTP request.
 * Used as a `rid=...` token in log lines and surfaced as `request_id` in
 * the JSON response so a single transaction can be followed across log
 * lines via `grep "rid=<id>" main.log`.
 *
 * Sized for 64-bit entropy: 50% birthday-paradox collision threshold is
 * ~4 billion requests per process lifetime, comfortably above any
 * realistic per-daemon traffic. Originally 8 hex (32 bits, ~65K) — bumped
 * after Copilot review Finding 6.1 flagged the lower threshold as
 * brittle for future scale.
 *
 * out must be at least API_QMAIL_RID_LEN bytes.
 */
void api_qmail_generate_rid(char *out);

/**
 * Add `"request_id": "<rid>"` to an open JSON object. Use after
 * api_qmail_success_response (or any builder that has an open object)
 * so the caller can echo the rid back to the client.
 */
void api_qmail_add_request_id(json_builder_t *jb, const char *rid);

/**
 * Error-response variant that tacks on `"request_id": "<rid>"` so the
 * GUI can `grep "rid=<id>" main.log` after seeing a 4xx/5xx body.
 * Drop-in replacement for json_error_response_from_string at any call
 * site that already has a rid in scope.
 */
void api_qmail_error_response_with_rid(http_response_t *response,
                                       const char *message,
                                       int code,
                                       const char *rid);

// ============================================================================
// RECIPIENT PARAMETER COLLECTION
// ============================================================================

/**
 * Collect a repeated request parameter (e.g. ?to=a&to=b) into a single
 * semicolon-joined string suitable for qmail_parse_recipients().
 *
 * Repeated params are the canonical recipient encoding in the current
 * protocol — one
 * `to=`/`cc=`/`bcc=` parameter per address. Comma/semicolon-separated
 * legacy forms are no longer accepted as a SINGLE-parameter mode; if
 * the caller supplies them they will be parsed downstream by
 * qmail_parse_recipients exactly as-is.
 *
 * @param request      HTTP request to read from.
 * @param name         Parameter name ("to", "cc", "bcc").
 * @param buffer       Output buffer; receives the joined string or "".
 * @param buffer_size  Size of buffer; must be at least 1.
 * @return RESULT_SUCCESS    one or more values found and joined.
 * @return RESULT_NOT_FOUND  no values for that parameter (buffer empty).
 * @return RESULT_ERROR      buffer too small for the joined string.
 * @return RESULT_INVALID_PARAM  bad arguments.
 */
result_t api_qmail_collect_recipient_param(http_request_t *request,
                                           const char *name,
                                           char *buffer, size_t buffer_size);

#endif // API_HANDLERS_QMAIL_UTILS_H
