/**
 * api_handlers.h - Internal header for REST API endpoint handlers
 *
 * Declares all handler functions and shared helpers so they can be
 * referenced across the split handler source files.
 * Not part of the public API - only included by api_handlers_*.c files.
 */

#ifndef API_HANDLERS_H
#define API_HANDLERS_H

#include "api/api_rest.h"
#include "api/raida_task.h"
#include "api/core_adapter.h"
#include "api/transport_adapter.h"
#include "crypto.h"
#include "coin_file.h"
#include "coin_utils.h"
#include "wallet.h"
#include "cmd_locker.h"
#include "cmd_version.h"
#include "cmd_count.h"
#include "cmd_deposit.h"
#include "cmd_detect.h"
#include "cmd_pown.h"
#include "cmd_wallet.h"
#include "cmd_make_change.h"
#include "cmd_heal.h"
#include "encryption_key.h"
#include "raida_status.h"
#include "raida_consensus_fetch.h"
#include "transaction_log.h"
#include <ctype.h>
#include <inttypes.h>
#include <math.h>
#ifndef _WIN32
#include <dirent.h>
#endif

// ============================================================================
// FORWARD DECLARATIONS (types used across handler files)
// ============================================================================

// JOIN COINS types
typedef struct
{
    bool success;
    int success_count;
    coin_t new_coin;
    char error_message[256];
} core_join_coins_result_t;

extern result_t core_join_coins(
    coin_t *source_coins,
    int source_coin_count,
    int8_t target_denomination,
    encryption_key_t *enc_key,
    core_transport_t *transport_iface,
    transport_type_t transport,
    core_join_coins_result_t *results);

// EXPORT COMMAND types — defined in cmd_export.h
#include "cmd_export.h"

// DETECT COMMAND status codes - defined in cmd_detect.h via raida_status.h

// Threading support for async deposit
#ifdef _WIN32
#include <process.h>
#else
#include <pthread.h>
#endif

// ============================================================================
// TRANSACTION LOGGING DEFINES
// ============================================================================

#ifndef TX_MEMO_MAX_LEN
#define TX_MEMO_MAX_LEN 256
#endif

// ============================================================================
// SHARED HELPER DECLARATIONS (from api_handlers_utils.c)
// ============================================================================

void pown_to_string(const uint8_t pown[RAIDA_COUNT], char out[RAIDA_COUNT + 1]);

// pown_status_to_char, raida_to_spaced_string, and RAIDA_SPACED_STRING_LEN
// now live in include/cmd_pown.h (implementation in src/coin_pown.c). They
// are declared here transitively because api_handlers.h already pulls in
// cmd_pown.h via "cmd_deposit.h" / friends — see below.
char ticket_status_to_char(uint8_t status);
char fix_status_to_char(uint8_t status);

void normalize_path_separators(char *path);
void append_unique_line(const char *filename, const char *line);

/* Path-canonicalization + Client_Data prefix check live in
 * include/filesystem.h as fs_canonicalize_path /
 * fs_path_is_inside_client_data so both the CLI (cmd_wallet_backup)
 * and the REST endpoint share the implementation. Include
 * "filesystem.h" wherever you need them. */
#define RESOLVE_WALLET_PATH_REQUIRE_EXISTS 0x01u
result_t resolve_wallet_path_ex(http_request_t *request, char *wallet_path,
                                size_t len, unsigned flags);
result_t resolve_wallet_path(http_request_t *request, char *wallet_path, size_t len);

const char *get_param_or(http_request_t *request, const char *key, const char *fallback);
void json_add_task_poll_fields(json_builder_t *jb, const char *task_id);

void json_not_implemented(http_response_t *response, const char *command);

void json_error_response_from_string(http_response_t *response, const char *message, int code);
void json_error_response_with_detail(http_response_t *response, const char *message,
                                     int code, const char *detail);
void json_result_error_response(http_response_t *response, const char *message,
                                int code, result_t detail_result);

result_t rest_transaction_log_add_ex(const char *wallet_path, const char *type,
                                     double amount, const char *description,
                                     char *task_id_out, size_t task_id_size);

double calculate_wallet_balance(const char *wallet_path);

// folder_balance_t type and helpers
typedef struct
{
    int note_count;
    int64_t total_value_microunits;
} folder_balance_t;

result_t scan_folder_balance(const char *folder_path, folder_balance_t *result);

bool json_extract_value(const char *json, const char *key, char *value, size_t size);

void format_value_plain(double value, char *buf, size_t size);

// ---- HTTP parameter parsing (from api_handlers_utils.c) --------------------
// Note: http_param_parse_bool lives in api/api_rest.h so http_server.c can
// use it without pulling in this internal header.

// Strict uint32 parse with overflow detection. Returns false on NULL, empty
// string, non-numeric chars, or values above UINT32_MAX.
bool http_param_parse_uint32(const char *str, uint32_t *out);

// Read an int param from the request, default if missing, clamp to [lo, hi].
int http_param_int_clamped(http_request_t *request, const char *key,
                           int def, int lo, int hi);

// ============================================================================
// HANDLER DECLARATIONS (one per handler function)
// ============================================================================

// RAIDA handlers (api_handlers_raida.c)
void api_handle_echo(http_request_t *, http_response_t *, void *);
void api_handle_raida_version(http_request_t *, http_response_t *, void *);
void api_handle_raida_count(http_request_t *, http_response_t *, void *);

// Health handlers (api_handlers_health.c)
void api_handle_fix_encryption(http_request_t *, http_response_t *, void *);
void api_handle_fix_fracked(http_request_t *, http_response_t *, void *);
void api_handle_test_fix_command(http_request_t *, http_response_t *, void *);
void api_handle_find(http_request_t *, http_response_t *, void *);
void api_handle_health_check(http_request_t *, http_response_t *, void *);

// Coin handlers (api_handlers_coins.c)
void api_handle_make_change(http_request_t *, http_response_t *, void *);
void api_handle_join_coins(http_request_t *, http_response_t *, void *);
void api_handle_consolidate_coins(http_request_t *, http_response_t *, void *);
void api_handle_coins_import(http_request_t *, http_response_t *, void *);
void api_handle_coins_authenticate(http_request_t *, http_response_t *, void *);
void api_handle_prepare_change(http_request_t *, http_response_t *, void *);

// Locker handlers (api_handlers_locker.c)
void api_handle_locker_download(http_request_t *, http_response_t *, void *);
void api_handle_locker_peek(http_request_t *, http_response_t *, void *);
void api_handle_locker_upload(http_request_t *, http_response_t *, void *);
void api_handle_locker_put(http_request_t *, http_response_t *, void *);
void api_handle_locker_put_one_coin(http_request_t *, http_response_t *, void *);
void api_handle_locker_put_no_sum(http_request_t *, http_response_t *, void *);

// Wallet handlers (api_handlers_wallet.c)
void api_handle_wallet_balance(http_request_t *, http_response_t *, void *);
void api_handle_wallets_list(http_request_t *, http_response_t *, void *);
void api_handle_wallet_show_coins(http_request_t *, http_response_t *, void *);
void api_handle_wallet_create(http_request_t *, http_response_t *, void *);
void api_handle_wallet_transactions(http_request_t *, http_response_t *, void *);
void api_handle_wallet_receipts(http_request_t *, http_response_t *, void *);
void api_handle_wallet_rename(http_request_t *, http_response_t *, void *);
void api_handle_wallet_delete(http_request_t *, http_response_t *, void *);
void api_handle_wallet_coin_details(http_request_t *, http_response_t *, void *);
void api_handle_wallet_register(http_request_t *, http_response_t *, void *);
void api_handle_wallet_backup(http_request_t *, http_response_t *, void *);

// Export handlers (api_handlers_export.c)
void api_handle_coins_export(http_request_t *, http_response_t *, void *);
void api_handle_export_locations(http_request_t *, http_response_t *, void *);

// System handlers (split across api_handlers_system_*.c — see
// docs/api_handlers_system.c.refactor.txt)

// Diagnostics + task polling (api_handlers_system_diag.c)
void api_handle_loopback_test(http_request_t *, http_response_t *, void *);
void api_handle_task_status(http_request_t *, http_response_t *, void *);
void api_handle_recovery_status(http_request_t *, http_response_t *, void *);

// Program/info handlers (api_handlers_system_program.c)
void api_handle_program_echo(http_request_t *, http_response_t *, void *);
void api_handle_program_disclaimer(http_request_t *, http_response_t *, void *);
void api_handle_version_check(http_request_t *, http_response_t *, void *);
void api_handle_system_usb(http_request_t *, http_response_t *, void *);
void api_handle_system_mobile(http_request_t *, http_response_t *, void *);

// Software update (api_handlers_system_update.c)
void api_handle_system_update_download(http_request_t *, http_response_t *, void *);
void api_handle_system_update_apply(http_request_t *, http_response_t *, void *);

// Wallet-to-wallet transfer (api_handlers_system_transfer.c)
void api_handle_transactions_transfer(http_request_t *, http_response_t *, void *);

// Other transaction handlers (deposit / upgrade — own files)
void api_handle_transactions_deposit(http_request_t *, http_response_t *, void *);
void api_handle_transactions_upgrade_ccv1(http_request_t *, http_response_t *, void *);
void api_handle_transactions_upgrade_ccv2(http_request_t *, http_response_t *, void *);

// GUI glue (api_handlers_system_glue.c)
void api_handle_system_theme(http_request_t *, http_response_t *, void *);
void api_handle_system_dropdown(http_request_t *, http_response_t *, void *);
void api_handle_tools_support_zip(http_request_t *, http_response_t *, void *);

// File encryption (api_handlers_system_encrypt.c)
void api_handle_system_login(http_request_t *, http_response_t *, void *);
void api_handle_system_logout(http_request_t *, http_response_t *, void *);
void api_handle_system_encryption_status(http_request_t *, http_response_t *, void *);
void api_handle_system_encrypt_existing_files(http_request_t *, http_response_t *, void *);

// QMail handlers (api_handlers_qmail.c)
/* Legacy api_handle_qmail_send and the old combined upload handler were
 * removed in Phase 3.7. Use api_handle_qmail_upload (registered as /upload) and
 * api_handle_qmail_upload_and_tell. */
void api_handle_qmail_check(http_request_t *, http_response_t *, void *);
void api_handle_qmail_poll(http_request_t *, http_response_t *, void *);
void api_handle_qmail_download(http_request_t *, http_response_t *, void *);
void api_handle_qmail_inbox(http_request_t *, http_response_t *, void *);
void api_handle_qmail_read(http_request_t *, http_response_t *, void *);
void api_handle_qmail_delete(http_request_t *, http_response_t *, void *);
void api_handle_qmail_star(http_request_t *, http_response_t *, void *);
void api_handle_qmail_mark_read(http_request_t *, http_response_t *, void *);
void api_handle_qmail_search(http_request_t *, http_response_t *, void *);
void api_handle_qmail_contacts_add(http_request_t *, http_response_t *, void *);
void api_handle_qmail_contacts_list(http_request_t *, http_response_t *, void *);
void api_handle_qmail_contacts_delete(http_request_t *, http_response_t *, void *);
void api_handle_qmail_contacts_favorite(http_request_t *, http_response_t *, void *);
void api_handle_qmail_status(http_request_t *, http_response_t *, void *);
void api_handle_qmail_convert_coin_to_email(http_request_t *, http_response_t *, void *);
void api_handle_qmail_base32(http_request_t *, http_response_t *, void *);
void api_handle_qmail_whoami(http_request_t *, http_response_t *, void *);
void api_handle_qmail_receipts(http_request_t *, http_response_t *, void *);
void api_handle_qmail_upload(http_request_t *, http_response_t *, void *);
void api_handle_qmail_tell(http_request_t *, http_response_t *, void *);
void api_handle_qmail_upload_and_tell(http_request_t *, http_response_t *, void *);
void api_handle_qmail_beacon_control(http_request_t *, http_response_t *, void *);
void api_handle_qmail_object_capabilities(http_request_t *, http_response_t *, void *);
void api_handle_qmail_object_upload_begin(http_request_t *, http_response_t *, void *);
void api_handle_qmail_object_download_begin(http_request_t *, http_response_t *, void *);
void api_handle_qmail_object_transfer_status(http_request_t *, http_response_t *, void *);
void api_handle_qmail_object_transfer_resume(http_request_t *, http_response_t *, void *);
void api_handle_qmail_object_transfer_cancel(http_request_t *, http_response_t *, void *);
void api_handle_qmail_object_delete(http_request_t *, http_response_t *, void *);

/* Force a wallet rescan + identity refresh + persist to rest_core.conf.
 * Use after a flow that adds/removes coins from the Mail wallet (e.g.
 * import-credentials) so whoami reflects the new state immediately. */
void api_qmail_whoami_persist(void);

// Phase 1 & 2: Attachments, Folders, Counts, Move, Trash
void api_handle_qmail_attachments(http_request_t *, http_response_t *, void *);
void api_handle_qmail_attachment_download(http_request_t *, http_response_t *, void *);
void api_handle_qmail_folders(http_request_t *, http_response_t *, void *);
void api_handle_qmail_counts(http_request_t *, http_response_t *, void *);
void api_handle_qmail_move(http_request_t *, http_response_t *, void *);
void api_handle_qmail_trash(http_request_t *, http_response_t *, void *);
void api_handle_qmail_delete_permanent(http_request_t *, http_response_t *, void *);

// QMail Phase 3: Tells & Notifications
void api_handle_qmail_pending_tells(http_request_t *, http_response_t *, void *);
void api_handle_qmail_pending_tells_retry(http_request_t *, http_response_t *, void *);
void api_handle_qmail_pending_tells_clear(http_request_t *, http_response_t *, void *);
void api_handle_qmail_notifications(http_request_t *, http_response_t *, void *);
void api_handle_qmail_notification_dismiss(http_request_t *, http_response_t *, void *);

// QMail Phase 4: Payments & Drafts
void api_handle_qmail_payment(http_request_t *, http_response_t *, void *);
void api_handle_qmail_payment_mark_refunded(http_request_t *, http_response_t *, void *);
void api_handle_qmail_payment_claim(http_request_t *, http_response_t *, void *);
void api_handle_qmail_drafts(http_request_t *, http_response_t *, void *);
void api_handle_qmail_draft_save(http_request_t *, http_response_t *, void *);
void api_handle_qmail_draft_update(http_request_t *, http_response_t *, void *);

// QMail Phase 5: Identity & Healing
void api_handle_qmail_identity(http_request_t *, http_response_t *, void *);
void api_handle_qmail_heal_identity(http_request_t *, http_response_t *, void *);

// QMail Phase 6: Popular contacts & Import credentials
void api_handle_qmail_contacts_popular(http_request_t *, http_response_t *, void *);
void api_handle_qmail_import_credentials(http_request_t *, http_response_t *, void *);

// QMail utility
void api_handle_qmail_has_id(http_request_t *, http_response_t *, void *);

// QMail Locker Pool
void api_handle_qmail_locker_pool(http_request_t *, http_response_t *, void *);

// QMail Inbox Fee Lookup (used by beacon server)
void api_handle_qmail_inbox_fee(http_request_t *, http_response_t *, void *);

// QMail Reports (api_handlers_qmail_reports.c)
void api_handle_qmail_sent_payments(http_request_t *, http_response_t *, void *);

// Locker helper (api_handlers_locker.c)
int8_t find_breakable_denom_for_gap(const char *bank_path, int64_t gap);

#endif // API_HANDLERS_H
