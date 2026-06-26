/**
 * api_handlers.c - REST API endpoint registration
 *
 * All handler implementations are in separate files:
 *   api_handlers_utils.c   - Shared helper functions
 *   api_handlers_raida.c   - RAIDA echo/version/count
 *   api_handlers_health.c  - Fix encryption/fracked, find
 *   api_handlers_coins.c   - Coin management (import/auth/detect/grade/break/join/consolidate)
 *   api_handlers_locker.c  - Locker operations (upload/peek/download)
 *   api_handlers_wallet.c  - Wallet operations (balance/list/show-coins/add-location)
 *   api_handlers_export.c  - Export operations (coins export, export locations)
 *   api_handlers_system_diag.c     - Loopback test, task status, recovery status
 *   api_handlers_system_encrypt.c  - File encryption login/logout/status/encrypt-existing
 *   api_handlers_system_glue.c     - Theme, dropdown, support zip
 *   api_handlers_system_program.c  - Program echo, disclaimer, version-check, USB/mobile
 *   api_handlers_system_transfer.c - Wallet-to-wallet transfer
 *   api_handlers_system_update.c   - Software update download/apply
 *   api_handlers_system_utils.c    - Shared system handler helpers
 */

#include "api_handlers.h"

void api_register_endpoints(http_server_t *server)
{
    // RAIDA echo
    http_server_register_endpoint(server, "/api/raida/echo", api_handle_echo, NULL);
    http_server_register_endpoint(server, "/api/raida/version", api_handle_raida_version, NULL);
    http_server_register_endpoint(server, "/api/raida/count", api_handle_raida_count, NULL);

    // Health endpoints (official paths)
    http_server_register_endpoint(server, "/api/health/encryption-repair", api_handle_fix_encryption, NULL);
    http_server_register_endpoint(server, "/api/health/fix", api_handle_fix_fracked, NULL);
    http_server_register_endpoint(server, "/api/health/authenticate", api_handle_coins_authenticate, NULL);
    http_server_register_endpoint(server, "/api/health/find", api_handle_find, NULL);
    http_server_register_endpoint(server, "/api/health/check", api_handle_health_check, NULL);

    // Wallet endpoints
    http_server_register_endpoint(server, "/api/wallets/balance", api_handle_wallet_balance, NULL);
    http_server_register_endpoint(server, "/api/wallets/list", api_handle_wallets_list, NULL);
    http_server_register_endpoint(server, "/api/wallets/show-coins", api_handle_wallet_show_coins, NULL);
    http_server_register_endpoint(server, "/api/wallets/create", api_handle_wallet_create, NULL);
    http_server_register_endpoint(server, "/api/wallets/transactions", api_handle_wallet_transactions, NULL);
    http_server_register_endpoint(server, "/api/wallets/receipts", api_handle_wallet_receipts, NULL);
    http_server_register_endpoint(server, "/api/wallets/rename", api_handle_wallet_rename, NULL);
    http_server_register_endpoint(server, "/api/wallets/delete", api_handle_wallet_delete, NULL);
    http_server_register_endpoint(server, "/api/wallets/coin-details", api_handle_wallet_coin_details, NULL);
    http_server_register_endpoint(server, "/api/wallets/register", api_handle_wallet_register, NULL);
    http_server_register_endpoint(server, "/api/wallets/consolidate", api_handle_consolidate_coins, NULL);
    http_server_register_endpoint(server, "/api/wallets/backup", api_handle_wallet_backup, NULL);

    // Coin management endpoints (official paths)
    http_server_register_endpoint(server, "/api/coins/import", api_handle_coins_import, NULL); // This just moves coins from outside ot the import folder.
    http_server_register_endpoint(server, "/api/coins/break", api_handle_make_change, NULL);
    http_server_register_endpoint(server, "/api/coins/join", api_handle_join_coins, NULL);
    http_server_register_endpoint(server, "/api/coins/prepare-change", api_handle_prepare_change, NULL);

    // Program endpoints
    http_server_register_endpoint(server, "/api/program/echo", api_handle_program_echo, NULL);
    http_server_register_endpoint(server, "/api/system/disclaimer", api_handle_program_disclaimer, NULL);

    // System config endpoints
    http_server_register_endpoint(server, "/api/system/config/usb", api_handle_system_usb, NULL);
    http_server_register_endpoint(server, "/api/system/config/mobile", api_handle_system_mobile, NULL);
    http_server_register_endpoint(server, "/api/system/theme", api_handle_system_theme, NULL);
    http_server_register_endpoint(server, "/api/system/dropdown", api_handle_system_dropdown, NULL);

    // System endpoints (official paths)
    http_server_register_endpoint(server, "/api/system/tasks", api_handle_task_status, NULL);
    http_server_register_endpoint(server, "/api/system/version-check", api_handle_version_check, NULL);
    http_server_register_endpoint(server, "/api/system/update/download", api_handle_system_update_download, NULL);
    http_server_register_endpoint(server, "/api/system/update/apply", api_handle_system_update_apply, NULL);
    http_server_register_endpoint(server, "/api/system/login", api_handle_system_login, NULL);
    http_server_register_endpoint(server, "/api/system/logout", api_handle_system_logout, NULL);
    http_server_register_endpoint(server, "/api/system/encryption-status", api_handle_system_encryption_status, NULL);
    http_server_register_endpoint(server, "/api/system/encrypt_existing_files", api_handle_system_encrypt_existing_files, NULL);
    http_server_register_endpoint(server, "/api/recovery/status", api_handle_recovery_status, NULL);

    // Transaction endpoints
    http_server_register_endpoint(server, "/api/transactions/deposit", api_handle_transactions_deposit, NULL);
    http_server_register_endpoint(server, "/api/transactions/upgrade-ccv1", api_handle_transactions_upgrade_ccv1, NULL);
    http_server_register_endpoint(server, "/api/transactions/upgrade-ccv2", api_handle_transactions_upgrade_ccv2, NULL);
    http_server_register_endpoint(server, "/api/transactions/transfer", api_handle_transactions_transfer, NULL);
    http_server_register_endpoint(server, "/api/transactions/export", api_handle_coins_export, NULL);
    http_server_register_endpoint(server, "/api/transactions/export-locations", api_handle_export_locations, NULL);

    // Locker endpoints (official paths - combined upload endpoint)
    http_server_register_endpoint(server, "/api/locker/upload", api_handle_locker_upload, NULL);
    http_server_register_endpoint(server, "/api/locker/peek", api_handle_locker_peek, NULL);
    http_server_register_endpoint(server, "/api/locker/download", api_handle_locker_download, NULL);

    // Backward compatibility aliases (legacy put/put-one-coin map to upload)
    http_server_register_endpoint(server, "/api/locker/put", api_handle_locker_put, NULL);
    http_server_register_endpoint(server, "/api/locker/put-one-coin", api_handle_locker_put_one_coin, NULL);
    http_server_register_endpoint(server, "/api/transactions/locker/upload", api_handle_locker_upload, NULL);
    http_server_register_endpoint(server, "/api/transactions/locker/put", api_handle_locker_put, NULL);
    http_server_register_endpoint(server, "/api/transactions/locker/put-one-coin", api_handle_locker_put_one_coin, NULL);
    http_server_register_endpoint(server, "/api/transactions/locker/peek", api_handle_locker_peek, NULL);
    http_server_register_endpoint(server, "/api/transactions/locker/download", api_handle_locker_download, NULL);
    http_server_register_endpoint(server, "/api/locker/put-no-sum", api_handle_locker_put_no_sum, NULL);
    http_server_register_endpoint(server, "/api/transactions/locker/put-no-sum", api_handle_locker_put_no_sum, NULL);

    // Tools endpoints
    http_server_register_endpoint(server, "/api/tools/support-zip", api_handle_tools_support_zip, NULL);

    // -------------------------------------------------------------------------
    // QMail bucketed routes (gem.qmail.naming.txt). Four buckets:
    //   /api/qmail/db/     - Local SQLite persistence (fast, zero network)
    //   /api/qmail/local/  - Local runtime / stateless compute
    //   /api/qmail/net/    - QMail-7 transport (Beacon + message transfer)
    //   /api/qmail/raida/  - RAIDA-25 consensus operations
    // -------------------------------------------------------------------------

    // -- DB: messages --
    http_server_register_endpoint(server, "/api/qmail/db/messages/list",     api_handle_qmail_inbox,            NULL);
    http_server_register_endpoint(server, "/api/qmail/db/messages/get",      api_handle_qmail_read,             NULL);
    http_server_register_endpoint(server, "/api/qmail/db/messages/search",   api_handle_qmail_search,           NULL);
    // soft-delete: canonical alias uses api_handle_qmail_trash (move-to-trash)
    http_server_register_endpoint(server, "/api/qmail/db/messages/trash",    api_handle_qmail_trash,            NULL);
    // hard-delete: permanently removes from DB
    http_server_register_endpoint(server, "/api/qmail/db/messages/delete",   api_handle_qmail_delete_permanent, NULL);
    http_server_register_endpoint(server, "/api/qmail/db/messages/move",     api_handle_qmail_move,             NULL);
    http_server_register_endpoint(server, "/api/qmail/db/messages/set-star", api_handle_qmail_star,             NULL);
    http_server_register_endpoint(server, "/api/qmail/db/messages/set-read", api_handle_qmail_mark_read,        NULL);

    // -- DB: folders --
    http_server_register_endpoint(server, "/api/qmail/db/folders/list",      api_handle_qmail_folders,          NULL);
    http_server_register_endpoint(server, "/api/qmail/db/folders/counts",    api_handle_qmail_counts,           NULL);

    // -- DB: contacts --
    http_server_register_endpoint(server, "/api/qmail/db/contacts/list",         api_handle_qmail_contacts_list,    NULL);
    http_server_register_endpoint(server, "/api/qmail/db/contacts/create",       api_handle_qmail_contacts_add,     NULL);
    http_server_register_endpoint(server, "/api/qmail/db/contacts/delete",       api_handle_qmail_contacts_delete,  NULL);
    http_server_register_endpoint(server, "/api/qmail/db/contacts/list-popular", api_handle_qmail_contacts_popular, NULL);
    http_server_register_endpoint(server, "/api/qmail/db/contacts/favorite",     api_handle_qmail_contacts_favorite, NULL);

    // -- DB: drafts --
    http_server_register_endpoint(server, "/api/qmail/db/drafts/list",   api_handle_qmail_drafts,       NULL);
    http_server_register_endpoint(server, "/api/qmail/db/drafts/create", api_handle_qmail_draft_save,   NULL);
    http_server_register_endpoint(server, "/api/qmail/db/drafts/update", api_handle_qmail_draft_update, NULL);

    // -- DB: attachments (rows in SQLite, not filesystem) --
    http_server_register_endpoint(server, "/api/qmail/db/attachments/list", api_handle_qmail_attachments,         NULL);
    http_server_register_endpoint(server, "/api/qmail/db/attachments/get",  api_handle_qmail_attachment_download,  NULL);

    // -- DB: tells & notifications (local queue/inbox; wire TELL2 lives under net/messages) --
    http_server_register_endpoint(server, "/api/qmail/db/tells/list-pending",    api_handle_qmail_pending_tells,        NULL);
    http_server_register_endpoint(server, "/api/qmail/db/tells/retry",           api_handle_qmail_pending_tells_retry,  NULL);
    http_server_register_endpoint(server, "/api/qmail/db/tells/clear-sent",      api_handle_qmail_pending_tells_clear,  NULL);
    http_server_register_endpoint(server, "/api/qmail/db/notifications/list",    api_handle_qmail_notifications,        NULL);
    http_server_register_endpoint(server, "/api/qmail/db/notifications/dismiss", api_handle_qmail_notification_dismiss, NULL);

    // -- DB: payments (DB-read path; see also raida/payments/claim for the RAIDA write path) --
    http_server_register_endpoint(server, "/api/qmail/db/payments/get",     api_handle_qmail_payment,            NULL);
    http_server_register_endpoint(server, "/api/qmail/db/payments/mark-refunded",
                                  api_handle_qmail_payment_mark_refunded, NULL);

    // -- DB: reports (read-only views joining sent emails to locker_pool) --
    http_server_register_endpoint(server, "/api/qmail/db/reports/sent-payments",
                                  api_handle_qmail_sent_payments, NULL);

    // -- LOCAL: identity --
    http_server_register_endpoint(server, "/api/qmail/local/identity/whoami", api_handle_qmail_whoami,   NULL);
    http_server_register_endpoint(server, "/api/qmail/local/identity/get",    api_handle_qmail_identity, NULL);
    // exists: checks local Mail wallet files (NOT a DB query)
    http_server_register_endpoint(server, "/api/qmail/local/identity/exists", api_handle_qmail_has_id,   NULL);

    // -- LOCAL: misc --
    http_server_register_endpoint(server, "/api/qmail/local/status",              api_handle_qmail_status,               NULL);
    http_server_register_endpoint(server, "/api/qmail/local/inbox-fee",           api_handle_qmail_inbox_fee,            NULL);
    http_server_register_endpoint(server, "/api/qmail/local/address/from-sn",     api_handle_qmail_convert_coin_to_email, NULL);
    // locker-pool status read (local cache view; replenish is under /raida/ below)
    http_server_register_endpoint(server, "/api/qmail/local/locker-pool/status",  api_handle_qmail_locker_pool,          NULL);

    // -- LOCAL: util --
    // Both paths reach the same handler; the handler reads the path suffix to
    // distinguish encode vs. decode.
    http_server_register_endpoint(server, "/api/qmail/local/util/base32-encode",  api_handle_qmail_base32,               NULL);
    http_server_register_endpoint(server, "/api/qmail/local/util/base32-decode",  api_handle_qmail_base32,               NULL);

    // -- NET: beacon (PEEK / PING against the beacon RAIDA) --
    http_server_register_endpoint(server, "/api/qmail/net/beacon/peek", api_handle_qmail_check, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/beacon/ping", api_handle_qmail_poll,  NULL);

    // -- NET: messages (QMail-7 storage transport) --
    /* Phase 3.7: legacy /send and the legacy combined-mode upload handler were
     * deleted (no backwards-compat shim). /upload is now the new
     * upload-only handler. */
    http_server_register_endpoint(server, "/api/qmail/net/messages/upload",          api_handle_qmail_upload,          NULL);
    http_server_register_endpoint(server, "/api/qmail/net/messages/tell",            api_handle_qmail_tell,            NULL);
    http_server_register_endpoint(server, "/api/qmail/net/messages/upload_and_tell", api_handle_qmail_upload_and_tell, NULL);
    /* Phase 3.6: runtime beacon control. */
    http_server_register_endpoint(server, "/api/qmail/local/beacon/control",
                                   api_handle_qmail_beacon_control, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/messages/download", api_handle_qmail_download, NULL);

    // -- NET: durable Object Transfer v1 --
    http_server_register_endpoint(server, "/api/qmail/net/objects/capabilities",
                                  api_handle_qmail_object_capabilities, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/objects/upload",
                                  api_handle_qmail_object_upload_begin, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/objects/download",
                                  api_handle_qmail_object_download_begin, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/objects/delete",
                                  api_handle_qmail_object_delete, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/object-transfers/status",
                                  api_handle_qmail_object_transfer_status, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/object-transfers/resume",
                                  api_handle_qmail_object_transfer_resume, NULL);
    http_server_register_endpoint(server, "/api/qmail/net/object-transfers/cancel",
                                  api_handle_qmail_object_transfer_cancel, NULL);

    // Legacy alias: raidax cmd_qmail.c calls /api/qmail/inbox-fee directly over
    // a localhost socket. Keep this alias until raidax is updated to the new
    // bucketed path (/api/qmail/local/inbox-fee). Remove when raidax is migrated.
    http_server_register_endpoint(server, "/api/qmail/inbox-fee", api_handle_qmail_inbox_fee, NULL);

    // -- LOCAL: receipts (Phase 3.2 — read-only) --
    http_server_register_endpoint(server, "/api/qmail/receipts", api_handle_qmail_receipts, NULL);

    // -- RAIDA: identity, payments, locker --
    http_server_register_endpoint(server, "/api/qmail/raida/identity/heal",         api_handle_qmail_heal_identity,      NULL);
    http_server_register_endpoint(server, "/api/qmail/raida/payments/claim",        api_handle_qmail_payment_claim,      NULL);
    http_server_register_endpoint(server, "/api/qmail/raida/locker/import-credentials", api_handle_qmail_import_credentials, NULL);
    // locker-pool replenish (RAIDA fan-out; status read is under /local/ above)
    http_server_register_endpoint(server, "/api/qmail/raida/locker-pool/replenish", api_handle_qmail_locker_pool,        NULL);

    // Debug/test endpoints
    http_server_register_endpoint(server, "/api/debug/loopback-test", api_handle_loopback_test, NULL);
    http_server_register_endpoint(server, "/api/debug/test-fix-command", api_handle_test_fix_command, NULL);

    log_info(LOG_CAT_HTTP, "Registered %d API endpoints",
            server->endpoint_count);
}
