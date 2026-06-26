/**
 * main_rest.c - REST Core Entry Point
 *
 * CloudCoin REST Core API server program.
 * This program provides a REST API for GUI applications to communicate
 * with RAIDA servers. It uses the core library for all RAIDA operations.
 *
 * Usage:
 *   rest_core.exe [options]
 *
 * Options:
 *   -port <number>    Set HTTP server port (default: 8080)
 *   -debug            Enable debug mode (shows advanced logging)
 *   -upgrade-coins    Upgrade CCv1/CCv2 coins in exe directory and exit
 *   --version, -v     Show version and exit
 *   --help, -h        Show help and exit
 *
 * Client_Data directory is always created next to the executable.
 *
 * Part of rest_core - consolidated core + REST program.
 */

#include "api/api_rest.h"
#include "sse_server.h"
#include "cmd_deposit.h"
#include "cmd_upgrade.h"
#include "cmd_convert.h"
#include "qmail/qmail_db.h"
#include "qmail/qmail_beacon.h"
#include "qmail/qmail_tell_retry.h"
#include "qmail/qmail_servers.h"
#include "qmail/qmail_users.h"
#include "qmail/qmail_wordlist.h"
#include "qmail/qmail_health.h"
#include "qmail/qmail_locker_pool.h"
#include "qmail/qmail_transfer_manager.h"
#include "qmail/qmail_receive.h"
#include "boot_encryption_check.h"
#include "encryption_key.h"
#include "filesystem.h"
#include "http_client.h"
#include "platform.h"
#include "health_manager.h"
#include "receipt_writer.h"

/* Declared in api_src/receipt_writer_json.c — installs the JSON
 * receipt builder so core callers (deposit_execute, upgrade_execute)
 * can produce JSON receipts without the core library linking against
 * simple_json.c. */
void receipt_writer_json_install(void);
#include "raida_telemetry.h"
#include "wallet.h"
#include <sys/stat.h>
#include <signal.h>
#ifdef _WIN32
#include <windows.h>
#include <dbghelp.h>
#include <process.h>
#pragma comment(lib, "dbghelp.lib")
#else
#include <dirent.h>
#include <pthread.h>
#endif

// ============================================================================
// CRASH HANDLER
// ============================================================================

#ifdef _WIN32
static LONG WINAPI crash_handler(EXCEPTION_POINTERS *ep) {
    FILE *crash_log = fopen("crash.log", "a");
    if (crash_log) {
        SYSTEMTIME st;
        GetLocalTime(&st);
        fprintf(crash_log, "\n=== CRASH at %04d-%02d-%02d %02d:%02d:%02d ===\n",
                st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
        fprintf(crash_log, "Exception code: 0x%08lX\n",
                ep->ExceptionRecord->ExceptionCode);
        fprintf(crash_log, "Exception address: 0x%p\n",
                ep->ExceptionRecord->ExceptionAddress);
        fprintf(crash_log, "RIP: 0x%016llX\n", (unsigned long long)ep->ContextRecord->Rip);
        fprintf(crash_log, "RSP: 0x%016llX\n", (unsigned long long)ep->ContextRecord->Rsp);

        // Walk the stack
        fprintf(crash_log, "\nStack trace:\n");
        HANDLE process = GetCurrentProcess();
        HANDLE thread = GetCurrentThread();
        SymInitialize(process, NULL, TRUE);

        STACKFRAME64 frame;
        memset(&frame, 0, sizeof(frame));
        frame.AddrPC.Offset = ep->ContextRecord->Rip;
        frame.AddrPC.Mode = AddrModeFlat;
        frame.AddrFrame.Offset = ep->ContextRecord->Rbp;
        frame.AddrFrame.Mode = AddrModeFlat;
        frame.AddrStack.Offset = ep->ContextRecord->Rsp;
        frame.AddrStack.Mode = AddrModeFlat;

        for (int i = 0; i < 32; i++) {
            if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, process, thread, &frame,
                            ep->ContextRecord, NULL,
                            SymFunctionTableAccess64, SymGetModuleBase64, NULL))
                break;

            char symbol_buf[sizeof(SYMBOL_INFO) + 256];
            SYMBOL_INFO *symbol = (SYMBOL_INFO *)symbol_buf;
            symbol->SizeOfStruct = sizeof(SYMBOL_INFO);
            symbol->MaxNameLen = 255;

            DWORD64 displacement = 0;
            if (SymFromAddr(process, frame.AddrPC.Offset, &displacement, symbol)) {
                fprintf(crash_log, "  [%d] %s + 0x%llX (0x%016llX)\n",
                        i, symbol->Name, (unsigned long long)displacement,
                        (unsigned long long)frame.AddrPC.Offset);
            } else {
                fprintf(crash_log, "  [%d] 0x%016llX\n",
                        i, (unsigned long long)frame.AddrPC.Offset);
            }
        }

        SymCleanup(process);
        fclose(crash_log);
    }

    // Also print to stderr
    fprintf(stderr, "\n*** CRASH: Exception 0x%08lX at 0x%p ***\n",
            ep->ExceptionRecord->ExceptionCode,
            ep->ExceptionRecord->ExceptionAddress);
    fprintf(stderr, "See crash.log for details.\n");
    fflush(stderr);

    return EXCEPTION_EXECUTE_HANDLER;
}
#endif

static void install_crash_handler(void) {
#ifdef _WIN32
    SetUnhandledExceptionFilter(crash_handler);
#endif
    // POSIX signal handlers could be added here for Linux
}

// Global QMail beacon state (referenced by api_handlers_qmail.c)
qmail_beacon_state_t g_qmail_beacon_state;

// Beacon callback: downloads mail using fresh key selection at call time
static void beacon_on_new_mail(const qmail_tell_notification_t *notif,
                                void *user_data) {
    (void)user_data;
    core_transport_t *transport =
        (core_transport_t *)g_qmail_beacon_state.transport_iface;

    if (!transport) {
        log_error(LOG_CAT_GENERAL,
            "Beacon: cannot download mail — transport not available");
        return;
    }

    char guid_hex[QMAIL_GUID_SIZE * 2 + 1];
    for (int i = 0; i < QMAIL_GUID_SIZE; i++)
        sprintf(guid_hex + i * 2, "%02x", notif->file_guid[i]);
    guid_hex[QMAIL_GUID_SIZE * 2] = '\0';

    log_info(LOG_CAT_GENERAL,
        "Beacon: downloading email guid=%s from SN=%u (%u bytes, %d servers)",
        guid_hex, notif->sender_sn, notif->total_file_size, notif->server_count);

    qmail_receive_result_t recv_result;
    memset(&recv_result, 0, sizeof(recv_result));

    /* Key selection happens inside qmail_receive_email() */
    const char *wp = g_qmail_beacon_state.wallet_path[0] ?
        g_qmail_beacon_state.wallet_path : NULL;
    result_t ret = qmail_receive_email(notif, transport, wp, &recv_result);

    if (ret == RESULT_SUCCESS && recv_result.success) {
        log_info(LOG_CAT_GENERAL,
            "Beacon: email downloaded and stored guid=%s subject='%.64s'",
            guid_hex, recv_result.subject);

        /* Push a real-time notification to any connected GUI. At this point
         * the tell has been consumed and the message is already in the local
         * inbox DB, so the renderer refreshes the inbox/counts directly. */
        char sse_data[160];
        snprintf(sse_data, sizeof(sse_data),
                 "{\"guid\":\"%s\",\"sender_sn\":%u}",
                 guid_hex, (unsigned)notif->sender_sn);
        sse_server_broadcast("new-mail", sse_data);
    } else if (ret == RESULT_SUCCESS) {
        log_warn(LOG_CAT_GENERAL,
            "Beacon: email downloaded but DB store failed guid=%s: %s",
            guid_hex, recv_result.error_message);
    } else {
        log_warn(LOG_CAT_GENERAL,
            "Beacon: email download failed guid=%s: %s",
            guid_hex, result_to_string(ret));
    }

    qmail_receive_result_free(&recv_result);
}

// Upgrade-coins CLI mode flags
static bool g_upgrade_mode = false;
static upgrade_mode_t g_upgrade_cli_mode = UPGRADE_MODE_AUTO;

/* QMail background-refresh thread tracking. Allows rest_cleanup to
 * signal the thread, wait briefly for it to notice, and join the
 * handle so we don't terminate mid-write to qmail_users.csv or the
 * wordlist cache files. The flag is checked at phase boundaries
 * inside qmail_refresh_thread; in-flight network I/O is not
 * cancellable but completes within a few seconds in practice. */
static volatile bool g_qmail_refresh_shutdown_requested = false;
#ifdef _WIN32
static HANDLE g_qmail_refresh_thread_handle = NULL;
#else
static pthread_t g_qmail_refresh_tid;
static bool      g_qmail_refresh_tid_valid = false;
#endif

/* Best-effort: ask the background refresh thread to stop, then wait up
 * to ~2 seconds for it. Called from main() right before rest_cleanup so
 * cache-file writes have a chance to complete. Safe to call when the
 * thread was never started or already finished. */
static void qmail_refresh_request_shutdown(void) {
    g_qmail_refresh_shutdown_requested = true;
#ifdef _WIN32
    if (g_qmail_refresh_thread_handle) {
        WaitForSingleObject(g_qmail_refresh_thread_handle, 2000);
        CloseHandle(g_qmail_refresh_thread_handle);
        g_qmail_refresh_thread_handle = NULL;
    }
#else
    if (g_qmail_refresh_tid_valid) {
        /* No portable timed join exists; pthread_join blocks until the
         * thread exits. The cancellation flag check at the next phase
         * boundary inside the thread keeps this bounded in practice. */
        pthread_join(g_qmail_refresh_tid, NULL);
        g_qmail_refresh_tid_valid = false;
    }
#endif
}

/* Periodic RAIDA-health refresh thread. Runs cmd_echo every
 * QMAIL_HEALTH_REFRESH_INTERVAL_SEC and feeds the results into the
 * qmail_health tracker. Without this, a RAIDA that goes down after
 * boot stays marked reachable=true forever and we burn the full
 * upload timeout against it on every QMail send. The boot echo
 * seeds the tracker on startup; this thread keeps it current. */
#define QMAIL_HEALTH_REFRESH_INTERVAL_SEC 300  /* 5 minutes */
#define QMAIL_HEALTH_REFRESH_ECHO_TIMEOUT_MS 3000

static volatile bool g_qmail_health_refresh_shutdown_requested = false;
#ifdef _WIN32
static HANDLE g_qmail_health_refresh_thread_handle = NULL;
#else
static pthread_t g_qmail_health_refresh_tid;
static bool      g_qmail_health_refresh_tid_valid = false;
#endif

static void qmail_health_refresh_request_shutdown(void) {
    g_qmail_health_refresh_shutdown_requested = true;
#ifdef _WIN32
    if (g_qmail_health_refresh_thread_handle) {
        WaitForSingleObject(g_qmail_health_refresh_thread_handle, 2000);
        CloseHandle(g_qmail_health_refresh_thread_handle);
        g_qmail_health_refresh_thread_handle = NULL;
    }
#else
    if (g_qmail_health_refresh_tid_valid) {
        pthread_join(g_qmail_health_refresh_tid, NULL);
        g_qmail_health_refresh_tid_valid = false;
    }
#endif
}

/* ----------------------------------------------------------------------------
 * QMail DOWNLOAD-RETRY worker
 *
 * The beacon persists every tell locally (qmail_received_tells, downloaded=0)
 * BEFORE attempting the download, and only marks it downloaded on full success.
 * If a download fails (transient server/paging/network error), the row stays
 * downloaded=0 but nothing re-drives it — the live beacon won't see it again
 * (the server deletes the tell on read and the poll cursor advances). This
 * worker periodically re-attempts every undownloaded tell so a transient
 * failure is non-destructive, and it RECOVERS tells already orphaned by the
 * old delete-on-read behavior (the content is still on the server even though
 * the inbox notification is gone). It reuses beacon_on_new_mail(), which does
 * receive + SSE + marks-downloaded-on-success, so already-downloaded rows are
 * naturally skipped (get_pending only returns downloaded=0).
 * -------------------------------------------------------------------------- */
#define QMAIL_DL_RETRY_INTERVAL_SEC 120  /* 2 minutes between sweeps */

static volatile bool g_qmail_dl_retry_shutdown_requested = false;
#ifdef _WIN32
static HANDLE g_qmail_dl_retry_thread_handle = NULL;
#else
static pthread_t g_qmail_dl_retry_tid;
static bool      g_qmail_dl_retry_tid_valid = false;
#endif

static void qmail_dl_retry_request_shutdown(void) {
    g_qmail_dl_retry_shutdown_requested = true;
#ifdef _WIN32
    if (g_qmail_dl_retry_thread_handle) {
        WaitForSingleObject(g_qmail_dl_retry_thread_handle, 2000);
        CloseHandle(g_qmail_dl_retry_thread_handle);
        g_qmail_dl_retry_thread_handle = NULL;
    }
#else
    if (g_qmail_dl_retry_tid_valid) {
        pthread_join(g_qmail_dl_retry_tid, NULL);
        g_qmail_dl_retry_tid_valid = false;
    }
#endif
}

#ifdef _WIN32
static unsigned __stdcall qmail_dl_retry_thread(void *arg) {
#else
static void *qmail_dl_retry_thread(void *arg) {
#endif
    (void)arg;
    log_info(LOG_CAT_GENERAL,
             "QMail download-retry: started (interval=%ds)",
             QMAIL_DL_RETRY_INTERVAL_SEC);

    while (!g_qmail_dl_retry_shutdown_requested) {
        /* Sleep first (1s ticks for prompt shutdown). */
        for (int i = 0; i < QMAIL_DL_RETRY_INTERVAL_SEC; i++) {
            if (g_qmail_dl_retry_shutdown_requested) break;
            platform_sleep_ms(1000);
        }
        if (g_qmail_dl_retry_shutdown_requested) break;

        if (!qmail_db_is_open()) continue;

        qmail_tell_notification_t *pending = NULL;
        int count = 0;
        if (qmail_db_tell_get_pending(&pending, &count) != RESULT_SUCCESS) {
            continue;
        }
        if (count <= 0) {
            free(pending);
            continue;
        }

        log_info(LOG_CAT_GENERAL,
                 "QMail download-retry: re-attempting %d undownloaded tell(s)",
                 count);

        for (int i = 0; i < count; i++) {
            if (g_qmail_dl_retry_shutdown_requested) break;
            /* Re-check downloaded state in case the live beacon completed it
             * between the list query and now. */
            bool already = false;
            if (qmail_db_tell_is_downloaded(pending[i].file_guid, &already)
                    == RESULT_SUCCESS && already) {
                continue;
            }
            /* Re-drive through the beacon's process_notification: this shares
             * the IN-FLIGHT GUID guard (so we never download the same GUID
             * concurrently with the live beacon or a prior sweep) and the
             * RECEIVE SERIALIZATION LOCK (so a long paged download is not run
             * twice in parallel, which would starve the API/transport). It
             * downloads, stores, marks downloaded on success, and broadcasts
             * SSE. On failure the row stays downloaded=0 and a later sweep
             * retries. If the GUID is already in-flight, this returns at once. */
            qmail_beacon_redrive_tell(&g_qmail_beacon_state, &pending[i]);
        }

        free(pending);
    }

    log_info(LOG_CAT_GENERAL, "QMail download-retry: stopped");
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

#ifdef _WIN32
static unsigned __stdcall qmail_health_refresh_thread(void *arg) {
#else
static void *qmail_health_refresh_thread(void *arg) {
#endif
    (void)arg;
    log_info(LOG_CAT_GENERAL,
             "QMail health refresh: started (interval=%ds)",
             QMAIL_HEALTH_REFRESH_INTERVAL_SEC);

    while (!g_qmail_health_refresh_shutdown_requested) {
        /* Sleep first so the boot echo gets the first slot without
         * competing with this refresher. Break the sleep into 1s ticks
         * so shutdown is observed quickly. */
        for (int i = 0; i < QMAIL_HEALTH_REFRESH_INTERVAL_SEC; i++) {
            if (g_qmail_health_refresh_shutdown_requested) break;
            platform_sleep_ms(1000);
        }
        if (g_qmail_health_refresh_shutdown_requested) break;

        echo_task_t task;
        result_t r = cmd_echo(TRANSPORT_TCP, ENCRYPTION_NONE,
                              EXEC_MODE_PARALLEL,
                              QMAIL_HEALTH_REFRESH_ECHO_TIMEOUT_MS, &task);
        if (r != RESULT_SUCCESS) {
            log_warn(LOG_CAT_GENERAL,
                     "QMail health refresh: cmd_echo failed (%s); retry next interval",
                     result_to_string(r));
            continue;
        }

        bool success[RAIDA_COUNT];
        bool timed_out_arr[RAIDA_COUNT];
        uint32_t times[RAIDA_COUNT];
        for (int i = 0; i < RAIDA_COUNT; i++) {
            success[i] = task.results[i].success;
            timed_out_arr[i] = task.results[i].timed_out;
            times[i] = task.results[i].response_time_ms;
        }
        qmail_health_update(RAIDA_COUNT, success, timed_out_arr, times);
    }

    log_info(LOG_CAT_GENERAL, "QMail health refresh: stopped");
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}


// (removed: -data flag for custom data directory — Client_Data is always next to exe)

// External declaration from core_adapter.c
extern void* transport_get_default(void);

// ============================================================================
// LOG ROTATION CONSTANTS
// ============================================================================

/** Maximum log file size before rotation (1 MB) */
#define LOG_MAX_SIZE_BYTES    (1 * 1024 * 1024)

/** Old logs folder name */
#define OLD_LOGS_FOLDER       "OldLogs"

// ============================================================================
// LOG ROTATION FUNCTION
// ============================================================================

/**
 * Check if main.log exceeds 1MB and rotate if needed.
 * Moves old log to OldLogs folder with timestamp, optionally zips it.
 */
static void rotate_log_if_needed(const char *client_data_path) {
    char log_path[MAX_PATH_LEN];
    char old_logs_dir[MAX_PATH_LEN];
    char archive_path[MAX_PATH_LEN];
    struct stat st;

    // Build paths
    snprintf(log_path, sizeof(log_path), "%s%s%s",
             client_data_path, PATH_SEPARATOR_STR, MAIN_LOG_FILE);
    snprintf(old_logs_dir, sizeof(old_logs_dir), "%s%s%s",
             client_data_path, PATH_SEPARATOR_STR, OLD_LOGS_FOLDER);

    // Check if log file exists and get its size
    if (stat(log_path, &st) != 0) {
        return;  // File doesn't exist yet
    }

    // Check if file exceeds max size
    if (st.st_size < LOG_MAX_SIZE_BYTES) {
        return;  // File is under limit
    }

    // Create OldLogs directory if it doesn't exist
    create_directory(old_logs_dir);

    // Generate timestamped archive name
    time_t now = time(NULL);
    struct tm tm_buf;
    platform_localtime(&now, &tm_buf);
    char timestamp[32];
    strftime(timestamp, sizeof(timestamp), "%Y%m%d_%H%M%S", &tm_buf);

    // Try to compress using PowerShell (Windows) or gzip (Unix)
#ifdef _WIN32
    char zip_path[MAX_PATH_LEN];
    snprintf(zip_path, sizeof(zip_path), "%s%smain_%s.zip",
             old_logs_dir, PATH_SEPARATOR_STR, timestamp);

    // Use PowerShell to compress
    char cmd[MAX_PATH_LEN * 3];
    snprintf(cmd, sizeof(cmd),
             "powershell -Command \"Compress-Archive -Path '%s' -DestinationPath '%s' -Force\" 2>nul",
             log_path, zip_path);

    int ret = system(cmd);
    if (ret == 0) {
        // Compression succeeded, delete original
        remove(log_path);
        return;
    }
#else
    // Unix: try gzip
    char gz_path[MAX_PATH_LEN];
    snprintf(gz_path, sizeof(gz_path), "%s%smain_%s.log.gz",
             old_logs_dir, PATH_SEPARATOR_STR, timestamp);

    char cmd[MAX_PATH_LEN * 3];
    snprintf(cmd, sizeof(cmd), "gzip -c '%s' > '%s' 2>/dev/null", log_path, gz_path);

    int ret = system(cmd);
    if (ret == 0) {
        remove(log_path);
        return;
    }
#endif

    // Fallback: just move the file without compression (fs_move_file handles cross-volume)
    snprintf(archive_path, sizeof(archive_path), "%s%smain_%s.log",
             old_logs_dir, PATH_SEPARATOR_STR, timestamp);
    fs_move_file(log_path, archive_path);
}


/**
 * Print usage help to stderr
 */
static void print_usage(void) {
    fprintf(stderr, "Usage: rest_core [options]\n\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  -port <number>    Set HTTP server port (default: %d)\n", DEFAULT_HTTP_PORT);
    fprintf(stderr, "  -debug, -d        Enable debug mode (shows advanced logging)\n");
    fprintf(stderr, "  -data-dir <path>  Parent directory under which Client_Data is created.\n");
    fprintf(stderr, "                    Default: directory containing the executable.\n");
    fprintf(stderr, "  -upgrade-coins    Upgrade CCv1/CCv2 coins in exe directory and exit\n");
    fprintf(stderr, "  --version, -v     Show version and exit\n");
    fprintf(stderr, "  --help, -h        Show this help message\n");
}

/**
 * Parse command-line arguments
 * Returns true if parsing succeeded, false if invalid arguments found
 */
static bool parse_arguments(int argc, char *argv[]) {
    bool has_errors = false;

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "-port") == 0 || strcmp(argv[i], "--port") == 0)) {
            if (i + 1 < argc) {
                g_config.http_port = (uint16_t)atoi(argv[++i]);
            } else {
                fprintf(stderr, "ERROR: -port requires a port number\n\n");
                has_errors = true;
            }
        } else if (strcmp(argv[i], "-debug") == 0 || strcmp(argv[i], "--debug") == 0 || strcmp(argv[i], "-d") == 0) {
            g_config.debug_mode = true;
        } else if (strcmp(argv[i], "-data-dir") == 0 || strcmp(argv[i], "--data-dir") == 0) {
            if (i + 1 < argc) {
                // Override default <exe>/Client_Data placement. The wrapper
                // (e.g. QMail.exe / electron.cjs) sets this to the visible
                // portable folder so user data persists outside Electron's
                // temp extraction. Joined with "Client_Data" downstream in
                // rest_init() — pass the PARENT directory here.
                snprintf(g_config.client_data_path, sizeof(g_config.client_data_path),
                         "%s%sClient_Data", argv[++i], PATH_SEPARATOR_STR);
            } else {
                fprintf(stderr, "ERROR: -data-dir requires a path\n\n");
                has_errors = true;
            }
        } else if (strcmp(argv[i], "-upgrade-coins") == 0 || strcmp(argv[i], "--upgrade-coins") == 0) {
            g_upgrade_mode = true;
            g_upgrade_cli_mode = UPGRADE_MODE_AUTO;
        } else if (strcmp(argv[i], "--upgrade-ccv1") == 0) {
            g_upgrade_mode = true;
            g_upgrade_cli_mode = UPGRADE_MODE_CCV1;
        } else if (strcmp(argv[i], "--upgrade-ccv2") == 0) {
            g_upgrade_mode = true;
            g_upgrade_cli_mode = UPGRADE_MODE_CCV2;
        } else if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-v") == 0) {
            printf("%s v%s\n", REST_PROGRAM_NAME, REST_VERSION);
            exit(0);
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            printf("Usage: rest_core [options]\n\n");
            printf("Options:\n");
            printf("  -port <number>    Set HTTP server port (default: %d)\n", DEFAULT_HTTP_PORT);
            printf("  -debug, -d        Enable debug mode (shows advanced logging)\n");
            printf("  -data-dir <path>  Parent dir under which Client_Data is created\n");
            printf("                    (default: directory containing the executable)\n");
            printf("  -upgrade-coins    Upgrade CCv1/CCv2 coins in exe directory and exit\n");
            printf("  --upgrade-ccv1    Upgrade only CCv1 (.stack) coins and exit\n");
            printf("  --upgrade-ccv2    Upgrade only CCv2 (.bin) coins and exit\n");
            printf("  --version, -v     Show version and exit\n");
            printf("  --help, -h        Show this help message\n");
            exit(0);
        } else {
            fprintf(stderr, "ERROR: Unknown argument: %s\n", argv[i]);
            has_errors = true;
        }
    }

    if (has_errors) {
        fprintf(stderr, "\n");
        print_usage();
        return false;
    }

    // Echo debug mode status if enabled
    if (g_config.debug_mode) {
        printf("Debug mode: ENABLED\n");
    }

    return true;
}

// ============================================================================
// UPGRADE-COINS CLI MODE
// ============================================================================

/**
 * Progress callback for upgrade mode - prints a dot per progress update
 */
static void upgrade_progress_callback(const char *task_id, int percent,
                                       const char *phase, const char *message,
                                       void *ctx) {
    (void)task_id; (void)percent; (void)phase; (void)message; (void)ctx;
    printf(".");
    fflush(stdout);
}

/**
 * Scan exe directory for legacy coin files and run the deposit pipeline.
 * Returns 0 on success, 1 on error.
 */
static int run_upgrade_coins(void) {
    printf("\n=== CloudCoin Upgrade Tool v%s ===\n\n", REST_VERSION);

    // Scan exe directory for .stack and legacy .bin files
    const char *exe_dir = g_config.exe_path;
    printf("Looking for coins in: %s\n", exe_dir);

    // Build file list of legacy coin files
    char **file_list = NULL;
    int file_count = 0;
    int file_capacity = 0;

#ifdef _WIN32
    WIN32_FIND_DATAA fd;
    char search_pattern[MAX_PATH_LEN];
    snprintf(search_pattern, sizeof(search_pattern), "%s%s*.*",
             exe_dir, PATH_SEPARATOR_STR);

    HANDLE hFind = FindFirstFileA(search_pattern, &fd);
    if (hFind != INVALID_HANDLE_VALUE) {
        do {
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;

            const char *name = fd.cFileName;
            size_t name_len = strlen(name);

            // Check for .stack extension
            bool is_stack = (name_len > 6 &&
                _stricmp(name + name_len - 6, ".stack") == 0);

            // Check for .bin extension (needs legacy detection)
            bool is_legacy_bin = false;
            if (name_len > 4 && _stricmp(name + name_len - 4, ".bin") == 0) {
                char full_path[MAX_PATH_LEN];
                snprintf(full_path, sizeof(full_path), "%s%s%s",
                         exe_dir, PATH_SEPARATOR_STR, name);
                legacy_file_type_t ftype = legacy_detect_file_type(full_path);
                if (ftype == LEGACY_V1 || ftype == LEGACY_V2) {
                    is_legacy_bin = true;
                }
            }

            if (is_stack || is_legacy_bin) {
                // Grow array if needed
                if (file_count >= file_capacity) {
                    file_capacity = file_capacity == 0 ? 16 : file_capacity * 2;
                    char **tmp = (char **)realloc(file_list, file_capacity * sizeof(char *));
                    if (!tmp) {
                        fprintf(stderr, "ERROR: Out of memory\n");
                        for (int i = 0; i < file_count; i++) free(file_list[i]);
                        free(file_list);
                        return 1;
                    }
                    file_list = tmp;
                }

                char full_path[MAX_PATH_LEN];
                snprintf(full_path, sizeof(full_path), "%s%s%s",
                         exe_dir, PATH_SEPARATOR_STR, name);
                file_list[file_count] = _strdup(full_path);
                if (!file_list[file_count]) {
                    fprintf(stderr, "ERROR: Out of memory\n");
                    for (int i = 0; i < file_count; i++) free(file_list[i]);
                    free(file_list);
                    return 1;
                }
                file_count++;
            }
        } while (FindNextFileA(hFind, &fd));
        FindClose(hFind);
    }
#else
    DIR *dir = opendir(exe_dir);
    if (dir) {
        struct dirent *entry;
        while ((entry = readdir(dir)) != NULL) {
            if (entry->d_name[0] == '.') continue;

            const char *name = entry->d_name;
            size_t name_len = strlen(name);

            bool is_stack = (name_len > 6 &&
                strcasecmp(name + name_len - 6, ".stack") == 0);

            bool is_legacy_bin = false;
            if (name_len > 4 && strcasecmp(name + name_len - 4, ".bin") == 0) {
                char full_path[MAX_PATH_LEN];
                snprintf(full_path, sizeof(full_path), "%s%s%s",
                         exe_dir, PATH_SEPARATOR_STR, name);
                legacy_file_type_t ftype = legacy_detect_file_type(full_path);
                if (ftype == LEGACY_V1 || ftype == LEGACY_V2) {
                    is_legacy_bin = true;
                }
            }

            if (is_stack || is_legacy_bin) {
                if (file_count >= file_capacity) {
                    file_capacity = file_capacity == 0 ? 16 : file_capacity * 2;
                    char **tmp = (char **)realloc(file_list, file_capacity * sizeof(char *));
                    if (!tmp) {
                        fprintf(stderr, "ERROR: Out of memory\n");
                        for (int i = 0; i < file_count; i++) free(file_list[i]);
                        free(file_list);
                        closedir(dir);
                        return 1;
                    }
                    file_list = tmp;
                }

                char full_path[MAX_PATH_LEN];
                snprintf(full_path, sizeof(full_path), "%s%s%s",
                         exe_dir, PATH_SEPARATOR_STR, name);
                file_list[file_count] = strdup(full_path);
                if (!file_list[file_count]) {
                    fprintf(stderr, "ERROR: Out of memory\n");
                    for (int i = 0; i < file_count; i++) free(file_list[i]);
                    free(file_list);
                    closedir(dir);
                    return 1;
                }
                file_count++;
            }
        }
        closedir(dir);
    }
#endif

    if (file_count == 0) {
        printf("No coin files found.\n");
        free(file_list);
        return 0;
    }

    printf("Found %d coin file%s.\n", file_count, file_count == 1 ? "" : "s");

    // Set up wallet path
    char wallet_path[MAX_PATH_LEN];
    get_wallet_path(wallet_path, sizeof(wallet_path), "Default");

    // Set up upgrade options
    upgrade_options_t opts;
    upgrade_options_init(&opts);
    opts.file_list = (const char **)file_list;
    opts.file_count = file_count;
    opts.wallet_path = wallet_path;
    opts.transport = (core_transport_t *)transport_get_default();
    opts.memo = "CLI upgrade";
    opts.use_unencrypted = true;
    opts.mode = g_upgrade_cli_mode;

    if (!opts.transport) {
        fprintf(stderr, "ERROR: Transport not available\n");
        for (int i = 0; i < file_count; i++) free(file_list[i]);
        free(file_list);
        return 1;
    }

    // Execute upgrade pipeline (MOVE -> UNPACK -> CONVERT -> GRADE, no POWN)
    upgrade_result_t result;
    upgrade_result_init(&result);

    printf("Upgrade starting...\n");
    fflush(stdout);

    result_t res = upgrade_execute(&opts, upgrade_progress_callback, NULL, &result);

    printf("\n");  // Newline after progress dots

    // Free file list
    for (int i = 0; i < file_count; i++) free(file_list[i]);
    free(file_list);

    if (res != RESULT_SUCCESS) {
        fprintf(stderr, "ERROR: Upgrade failed: %s\n", result_to_string(res));
        return 1;
    }

    // Print receipt
    printf("Upgrade complete!\n\n");

    time_t now = time(NULL);
    struct tm tm_buf;
    platform_localtime(&now, &tm_buf);
    char timestamp[32];
    strftime(timestamp, sizeof(timestamp), "%Y%m%d_%H%M%S", &tm_buf);

    uint64_t total_coins = result.total_value / 100000000ULL;

    printf("=== UPGRADE RECEIPT ===\n");
    printf("Date: %s\n", timestamp);
    printf("Results:\n");
    printf("  Converted to CCv3: %d\n", result.converted_count);
    printf("  Bank (authentic): %d\n", result.bank_count);
    printf("  Fracked (needs fixing): %d\n", result.fracked_count);
    if (result.expired_count > 0) {
        printf("  Expired (not converted): %d\n", result.expired_count);
    }
    if (result.counterfeit_count > 0) {
        printf("  Legacy counterfeit/spent: %d\n", result.counterfeit_count);
    }
    if (result.grade_counterfeit_count > 0) {
        printf("  Counterfeit (grading): %d\n", result.grade_counterfeit_count);
    }
    if (result.limbo_count > 0) {
        printf("  Limbo (uncertain): %d\n", result.limbo_count);
    }
    printf("Total deposited: %llu CloudCoin%s\n",
           (unsigned long long)total_coins, total_coins == 1 ? "" : "s");
    printf("========================\n\n");

    char coins_path[MAX_PATH_LEN];
    get_wallet_path(coins_path, sizeof(coins_path), "Default");
    printf("Your coins are in: %s\n", coins_path);

    return 0;
}

/**
 * Background thread entry: refresh qmail word list and user directory from
 * RAIDA. On non-first-install boots this runs while the main thread continues
 * startup. On first-install boots the main thread joins this thread before
 * proceeding past qmail init.
 */
typedef struct {
    char data_dir[MAX_PATH_LEN];
} qmail_refresh_args_t;

#ifdef _WIN32
static unsigned __stdcall qmail_refresh_thread(void *arg) {
#else
static void *qmail_refresh_thread(void *arg) {
#endif
    qmail_refresh_args_t *a = (qmail_refresh_args_t *)arg;
    result_t wl_res = qmail_wordlist_sync(a->data_dir);

    /* Cancellation point: if shutdown was requested while we were
     * fetching the wordlist, stop here rather than starting users_sync
     * (which writes qmail_users.csv and could be killed mid-write). */
    if (g_qmail_refresh_shutdown_requested) {
        log_info(LOG_CAT_GENERAL,
                 "Background sync: shutdown requested — stopping after wordlist sync");
        free(a);
#ifdef _WIN32
        return 0;
#else
        return NULL;
#endif
    }

    if (wl_res == RESULT_SUCCESS && qmail_wordlist_is_loaded()) {
        qmail_users_sync(a->data_dir);

        /* Cancellation point: skip identity refresh if we're shutting
         * down. config_persist_identity writes rest_core.conf and we
         * don't want a partial write at exit. */
        if (g_qmail_refresh_shutdown_requested) {
            log_info(LOG_CAT_GENERAL,
                     "Background sync: shutdown requested — skipping post-sync identity refresh");
            free(a);
#ifdef _WIN32
            return 0;
#else
            return NULL;
#endif
        }

        /* The directory sync may have inserted a contact for the local
         * ID coin — re-derive identity so background readers (beacon,
         * send, receive, upload) pick up the better name/beacon/
         * description without waiting for the next whoami HTTP call.
         * Persist to rest_core.conf so a future cold boot starts with
         * the enriched identity. */
        if (qmail_identity_refresh(g_config.wallets_path) == RESULT_SUCCESS) {
            qmail_identity_t snap;
            qmail_identity_snapshot(&snap);
            config_persist_identity(&snap);
            log_info(LOG_CAT_GENERAL,
                     "Background sync: identity refreshed after user directory sync");
        }
    } else {
        log_error(LOG_CAT_GENERAL,
                  "Background sync: word tables failed to load — skipping user directory sync");
    }
    free(a);
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

/**
 * Background thread entry: run deposit recovery followed by legacy coin
 * upgrade. The Suspect scan and Import scan happen synchronously on the
 * main thread (fast, local file I/O) so this thread starts with counts
 * already populated in the global recovery state. Running after
 * http_server_start so /api/recovery/status is observable while work is
 * in flight — the GUI polls it and blocks user-initiated RAIDA calls
 * until recovering transitions false.
 */
typedef struct {
    char wallets_dir[MAX_PATH_LEN];
    int recovery_task_count;
    int legacy_count;
} recovery_thread_args_t;

#ifdef _WIN32
static unsigned __stdcall recovery_thread(void *arg) {
#else
static void *recovery_thread(void *arg) {
#endif
    recovery_thread_args_t *a = (recovery_thread_args_t *)arg;

    if (a->recovery_task_count > 0) {
        core_transport_t *transport = (core_transport_t *)transport_get_default();
        if (transport) {
            deposit_process_recovery(transport);
        } else {
            log_warn(LOG_CAT_COMMAND,
                    "Cannot process recovery: transport not available");
        }
        log_info(LOG_CAT_COMMAND, "Deposit recovery complete");
    }

    if (a->legacy_count > 0) {
        core_transport_t *upgrade_transport = (core_transport_t *)transport_get_default();
        if (upgrade_transport) {
            upgrade_process_import_folders(a->wallets_dir, upgrade_transport);
        } else {
            log_warn(LOG_CAT_COMMAND,
                    "Cannot process legacy coins: transport not available");
        }
    }

    free(a);
#ifdef _WIN32
    return 0;
#else
    return NULL;
#endif
}

/**
 * Main entry point
 */
int main(int argc, char *argv[]) {
    install_crash_handler();

    // Parse command-line arguments (sets g_config fields before init)
    // Note: g_config is zeroed, so parse_arguments can safely set fields
    // that rest_init() will preserve
    memset(&g_config, 0, sizeof(g_config));
    g_config.http_port = DEFAULT_HTTP_PORT;
    if (!parse_arguments(argc, argv)) {
        return 1;  // Exit on invalid arguments
    }

    // Store parsed values that rest_init() would overwrite
    bool debug_mode = g_config.debug_mode;
    uint16_t http_port = g_config.http_port;

    // Initialize the REST client (folder structure, config files, networking, RAIDA)
    // Client_Data directory is always created next to the executable
    result_t result = rest_init();
    if (result != RESULT_SUCCESS) {
        fprintf(stderr, "ERROR: Failed to initialize: %s\n", result_to_string(result));
        return 1;
    }

    // Restore command-line overrides
    g_config.debug_mode = debug_mode;
    g_config.http_port = http_port;

    // Display final configuration (after CLI overrides applied)
    if (g_config.config_loaded) {
        printf("Configuration:   Loaded from rest_core.conf\n");
    } else {
        printf("Configuration:   Using defaults\n");
    }
    printf("  HTTP port:     %d\n", g_config.http_port);
    printf("  Debug mode:    %s\n", g_config.debug_mode ? "enabled" : "disabled");

    // Check and rotate log file if it exceeds 1MB
    rotate_log_if_needed(g_config.client_data_path);

    // Initialize logging system (mutex, default state)
    log_init();

    // One-time HTTP client global init. Must happen before any thread calls
    // http_get() (e.g., background wordlist/users sync, consensus fetches).
    http_client_global_init();

    // Set up main.log file for logging
    char log_filepath[MAX_PATH_LEN];
    snprintf(log_filepath, sizeof(log_filepath), "%s%s%s",
             g_config.client_data_path, PATH_SEPARATOR_STR, MAIN_LOG_FILE);
    log_set_file(log_filepath);
    log_set_timestamps(true);

    // Initialize RAIDA performance telemetry (CSV logging)
    raida_telemetry_init(g_config.client_data_path);

    // Set log level based on debug mode
    if (g_config.debug_mode) {
        log_set_level(LOG_DEBUG);
        log_info(LOG_CAT_GENERAL, "=== DEBUG MODE ACTIVE ===");
        log_info(LOG_CAT_GENERAL, "Histograms: ON | Hex dumps on error: ON");
    }

    // Mirror startup configuration to main.log
    log_info(LOG_CAT_GENERAL, "REST Core starting — port=%d, debug=%s, config=%s",
             g_config.http_port,
             g_config.debug_mode ? "on" : "off",
             g_config.config_loaded ? "rest_core.conf" : "defaults");

    // Clean up leftover files from previous self-update
    {
        char cleanup_path[MAX_PATH_LEN];
        snprintf(cleanup_path, sizeof(cleanup_path), "%s%s%s",
                 g_config.exe_path, PATH_SEPARATOR_STR, CORE_OLD_NAME);
        if (platform_file_exists(cleanup_path)) {
            remove(cleanup_path);
            log_info(LOG_CAT_GENERAL, "Update cleanup: removed %s", CORE_OLD_NAME);
        }
        snprintf(cleanup_path, sizeof(cleanup_path), "%s%s%s",
                 g_config.exe_path, PATH_SEPARATOR_STR, CORE_NEW_NAME);
        if (platform_file_exists(cleanup_path)) {
            remove(cleanup_path);
            log_info(LOG_CAT_GENERAL, "Update cleanup: removed incomplete %s", CORE_NEW_NAME);
        }
    }

    printf("Starting echo...\n");
    fflush(stdout);
    log_info(LOG_CAT_COMMAND, "Starting echo (TCP, no encryption, parallel, 3000ms)");

    /* Initialize the QMail health tracker BEFORE the boot echo so we can
     * feed the echo results straight into it. Without this, the upload
     * orchestrator's qmail_health_get_healthy_servers() falls into the
     * optimistic "no echo data yet, using all 8 servers" branch on every
     * send and we burn the full timeout against any dead RAIDA on every
     * upload. (qmail_health_init is just a mutex init; it was previously
     * called later at the QMail init block but has no real dependencies.) */
    qmail_health_init();

    // Run echo on all RAIDA servers (TCP, no encryption, parallel, 3-second timeout)
    echo_task_t echo_task;
    result = cmd_echo(TRANSPORT_TCP, ENCRYPTION_NONE, EXEC_MODE_PARALLEL, 3000,
                       &echo_task);
    if (result == RESULT_SUCCESS) {
        // Save response times to CSV
        save_response_times(&echo_task);

        /* Seed qmail_health from the boot echo so the very first QMail
         * upload skips dead RAIDAs instead of timing out 30s against
         * them. Mirrors the block in api_handlers_raida.c that runs
         * after every /api/raida/echo request. */
        {
            bool success[RAIDA_COUNT];
            bool timed_out_arr[RAIDA_COUNT];
            uint32_t times[RAIDA_COUNT];
            for (int i = 0; i < RAIDA_COUNT; i++) {
                success[i] = echo_task.results[i].success;
                timed_out_arr[i] = echo_task.results[i].timed_out;
                times[i] = echo_task.results[i].response_time_ms;
            }
            qmail_health_update(RAIDA_COUNT, success, timed_out_arr, times);
        }
    }

    printf("Task ID: %s\n", echo_task.task_id);
    log_info(LOG_CAT_COMMAND, "Echo task ID: %s", echo_task.task_id);

    printf("Echo complete.\n");
    fflush(stdout);
    log_info(LOG_CAT_COMMAND, "Echo complete: %d pass, %d fail, %d timeout (%ums)",
             echo_task.success_count, echo_task.error_count,
             echo_task.timeout_count, echo_task.total_time_ms);

    // Upgrade-coins mode: run deposit pipeline and exit (no HTTP server)
    if (g_upgrade_mode) {
        int rc = run_upgrade_coins();
        rest_cleanup();
        log_cleanup();
        return rc;
    }

    // Initialize health manager mutex BEFORE boot health checks
    result = health_manager_start();
    if (result != RESULT_SUCCESS) {
        log_warn(LOG_CAT_GENERAL,
                "Failed to start health manager: %s", result_to_string(result));
    }

    // Boot health: only check the Mail wallet for fast startup.
    // Full health on all wallets is available via /api/health/check.
    {
        core_transport_t *health_transport = (core_transport_t *)transport_get_default();
        int wallet_count = wallet_registry_count();
        bool found_mail = false;
        for (int w = 0; w < wallet_count; w++) {
            const wallet_entry_t *entry = wallet_registry_get(w);
            if (!entry) continue;
#ifdef _WIN32
            if (_stricmp(entry->name, MAIL_WALLET) == 0) {
#else
            if (strcasecmp(entry->name, MAIL_WALLET) == 0) {
#endif
                found_mail = true;
                printf("Boot health: checking %s wallet only (%s)\n", MAIL_WALLET, entry->path);
                fflush(stdout);
                log_info(LOG_CAT_COMMAND, "Boot health: checking wallet %s", entry->path);

                if (health_transport) {
                    health_result_t health_result;
                    health_result_init(&health_result);
                    health_check_wallet(entry->path, health_transport, false, &health_result);
                } else {
                    log_warn(LOG_CAT_COMMAND,
                            "Boot health: No transport available, skipping wallet: %s",
                            entry->path);
                }
                break;
            }
        }
        if (!found_mail) {
            printf("No Mail wallet found, skipping boot health check.\n");
            fflush(stdout);
            log_info(LOG_CAT_GENERAL, "No Mail wallet registered, skipping boot health check");
        }
        printf("Boot health check complete.\n");
        fflush(stdout);
    }

    // Scan for encrypted .bin files. If any are found, set the global
    // "login required" flag so future endpoints can gate on it.
    boot_encryption_check_run();

    // Scan for unprocessed coins in Suspect and Legacy folders (all wallets)
    printf("Checking for unprocessed coins...\n");
    fflush(stdout);
    log_info(LOG_CAT_GENERAL, "Scanning for unprocessed coins");
    char wallets_dir[MAX_PATH_LEN];
    snprintf(wallets_dir, sizeof(wallets_dir), "%s%s%s",
             g_config.client_data_path, PATH_SEPARATOR_STR, WALLETS_DIR);

    // Scan Suspect folders (interrupted deposits) and Import folders (legacy
    // coins). Scans are fast local file I/O and populate counts used below.
    // Actual recovery / upgrade processing runs on a background thread
    // spawned AFTER http_server_start, so /api/recovery/status is observable
    // while work is in flight.
    int recovery_tasks = deposit_scan_suspect_folders(wallets_dir);
    if (recovery_tasks > 0) {
        printf("Found %d interrupted deposit tasks (will process in background).\n",
               recovery_tasks);
        log_info(LOG_CAT_COMMAND, "Found %d interrupted deposit tasks", recovery_tasks);
    } else {
        printf("No unprocessed coins in Suspect.\n");
        log_info(LOG_CAT_GENERAL, "No unprocessed coins in Suspect");
    }

    int legacy_count = upgrade_scan_import_folders(wallets_dir);
    if (legacy_count > 0) {
        printf("Found %d legacy coins to upgrade (will process in background).\n", legacy_count);
        fflush(stdout);
        log_info(LOG_CAT_COMMAND, "Found %d legacy coins to upgrade", legacy_count);
    } else {
        printf("No legacy coins found.\n");
        log_info(LOG_CAT_GENERAL, "No legacy coins found");
    }

    // Initialize HTTP server
    printf("Initializing HTTP server on port %d...\n", g_config.http_port);
    fflush(stdout);
    log_info(LOG_CAT_HTTP, "Initializing HTTP server on port %d", g_config.http_port);
    http_server_t server;
    result_t srv_result = http_server_init(&server, g_config.http_port, DEFAULT_HTTP_HOST);
    if (srv_result != RESULT_SUCCESS) {
        fprintf(stderr, "ERROR: Failed to initialize HTTP server\n");
        log_error(LOG_CAT_HTTP, "Failed to initialize HTTP server on port %d", g_config.http_port);
        rest_cleanup();
        log_cleanup();
        return 1;
    }

    // Install the JSON receipt writer before any handlers that could
    // trigger async deposit/upgrade work register.
    receipt_writer_json_install();

    // Register API endpoints
    api_register_endpoints(&server);

    // Start listening
    srv_result = http_server_start(&server);
    if (srv_result != RESULT_SUCCESS) {
        fprintf(stderr, "ERROR: Failed to start HTTP server on port %d\n", g_config.http_port);
        log_error(LOG_CAT_HTTP, "Failed to start HTTP server on port %d", g_config.http_port);
        http_server_destroy(&server);
        rest_cleanup();
        log_cleanup();
        return 1;
    }

    printf("REST API server running on http://%s:%d\n", DEFAULT_HTTP_HOST, g_config.http_port);
    printf("Press Ctrl+C to stop.\n\n");
    log_info(LOG_CAT_HTTP, "REST API server running on http://%s:%d", DEFAULT_HTTP_HOST, g_config.http_port);

    /* Start the SSE event stream on http_port + 100. Non-fatal on failure:
     * the GUI's existing notifications poll still works without SSE, so we
     * log a warning and keep going. Multi-instance Client1/Client2 (8081/
     * 8082) get SSE on 8181/8182 with no collision. */
    if (g_config.http_port > 65435) {
        log_warn(LOG_CAT_HTTP,
                 "SSE event stream disabled: HTTP port %d is too high to add 100 safely",
                 g_config.http_port);
    } else {
        uint16_t sse_port = (uint16_t)(g_config.http_port + 100);
        result_t sse_res = sse_server_init(sse_port);
        if (sse_res != RESULT_SUCCESS) {
            log_warn(LOG_CAT_HTTP,
                     "SSE event stream failed to start on port %u — continuing without push notifications",
                     sse_port);
        } else {
            log_info(LOG_CAT_HTTP,
                     "SSE event stream running on http://%s:%u/events",
                     DEFAULT_HTTP_HOST, sse_port);
        }
    }

    /* Spawn the periodic qmail_health refresh thread. It runs cmd_echo
     * every QMAIL_HEALTH_REFRESH_INTERVAL_SEC and feeds the results into
     * the health tracker so the upload orchestrator stops trying dead
     * RAIDAs. Failure to spawn is non-fatal (the boot echo already
     * seeded the tracker; we just won't get updates for RAIDAs that go
     * up/down later). */
#ifdef _WIN32
    g_qmail_health_refresh_thread_handle =
        (HANDLE)_beginthreadex(NULL, 0, qmail_health_refresh_thread, NULL, 0, NULL);
    if (g_qmail_health_refresh_thread_handle == NULL) {
        log_warn(LOG_CAT_GENERAL,
                 "QMail health refresh: _beginthreadex failed — periodic refresh disabled");
    }
#else
    if (pthread_create(&g_qmail_health_refresh_tid, NULL,
                       qmail_health_refresh_thread, NULL) != 0) {
        log_warn(LOG_CAT_GENERAL,
                 "QMail health refresh: pthread_create failed — periodic refresh disabled");
    } else {
        g_qmail_health_refresh_tid_valid = true;
    }
#endif

    /* Spawn the QMail download-retry worker: re-drives undownloaded tells so a
     * transient download failure is non-destructive and already-orphaned tells
     * are recovered. */
#ifdef _WIN32
    g_qmail_dl_retry_thread_handle =
        (HANDLE)_beginthreadex(NULL, 0, qmail_dl_retry_thread, NULL, 0, NULL);
    if (g_qmail_dl_retry_thread_handle == NULL) {
        log_warn(LOG_CAT_GENERAL,
                 "QMail download-retry: _beginthreadex failed — retry disabled");
    }
#else
    if (pthread_create(&g_qmail_dl_retry_tid, NULL,
                       qmail_dl_retry_thread, NULL) != 0) {
        log_warn(LOG_CAT_GENERAL,
                 "QMail download-retry: pthread_create failed — retry disabled");
    } else {
        g_qmail_dl_retry_tid_valid = true;
    }
#endif

    // Spawn background worker for deposit recovery + legacy coin upgrade.
    // /api/recovery/status is now live, so the GUI can poll it and block
    // user RAIDA requests until recovering transitions false.
    if (recovery_tasks > 0 || legacy_count > 0) {
        recovery_thread_args_t *rargs =
            (recovery_thread_args_t *)malloc(sizeof(*rargs));
        if (rargs) {
            strncpy(rargs->wallets_dir, wallets_dir, sizeof(rargs->wallets_dir) - 1);
            rargs->wallets_dir[sizeof(rargs->wallets_dir) - 1] = '\0';
            rargs->recovery_task_count = recovery_tasks;
            rargs->legacy_count = legacy_count;

#ifdef _WIN32
            HANDLE rth = (HANDLE)_beginthreadex(NULL, 0, recovery_thread, rargs, 0, NULL);
            if (rth == NULL) {
                log_warn(LOG_CAT_COMMAND,
                         "Recovery thread: _beginthreadex failed — running inline");
                recovery_thread(rargs);
            } else {
                CloseHandle(rth);
            }
#else
            pthread_t rtid;
            if (pthread_create(&rtid, NULL, recovery_thread, rargs) != 0) {
                log_warn(LOG_CAT_COMMAND,
                         "Recovery thread: pthread_create failed — running inline");
                recovery_thread(rargs);
            } else {
                pthread_detach(rtid);
            }
#endif
        }
    }

    // Initialize QMail subsystem
    printf("Initializing QMail...\n");
    fflush(stdout);
    log_info(LOG_CAT_GENERAL, "Initializing QMail subsystem");

    // Open QMail database
    char qmail_db_path[MAX_PATH_LEN];
    snprintf(qmail_db_path, sizeof(qmail_db_path), "%s%sqmail.db",
             g_config.client_data_path, PATH_SEPARATOR_STR);
    result = qmail_db_open(qmail_db_path);
    bool qmail_db_ready = result == RESULT_SUCCESS;
    if (result == RESULT_SUCCESS) {
        log_info(LOG_CAT_GENERAL, "QMail database opened: %s", qmail_db_path);
    } else {
        log_warn(LOG_CAT_GENERAL,
                "QMail database failed to open: %s", result_to_string(result));
    }

    // Initialize QMail servers (loads from qmail_servers.json, refreshes via HTTPS consensus)
    qmail_servers_init(g_config.client_data_path);

    /* qmail_health_init() was moved earlier (before the boot echo) so the
     * echo results can be fed straight into the health tracker. The
     * function is idempotent; no second call needed here. */

    // Load word lists from local cache (disk backup + embedded defaults). Fast,
    // no network. A background thread below refreshes from RAIDA.
    qmail_wordlist_load_cached(g_config.client_data_path);

    // Decide whether this is a first-install boot: if any cache file is
    // missing, we must block on the background refresh before proceeding so
    // identity detection + beacon have real data. Otherwise let the refresh
    // run while the server starts accepting requests.
    char adj_cache[MAX_PATH_LEN], noun_cache[MAX_PATH_LEN], users_cache[MAX_PATH_LEN];
    snprintf(adj_cache, sizeof(adj_cache), "%s%sqmail_adjectives.txt",
             g_config.client_data_path, PATH_SEPARATOR_STR);
    snprintf(noun_cache, sizeof(noun_cache), "%s%sqmail_nouns.txt",
             g_config.client_data_path, PATH_SEPARATOR_STR);
    snprintf(users_cache, sizeof(users_cache), "%s%sqmail_users.csv",
             g_config.client_data_path, PATH_SEPARATOR_STR);
    bool first_install = !platform_file_exists(adj_cache)
                      || !platform_file_exists(noun_cache)
                      || !platform_file_exists(users_cache);

    qmail_refresh_args_t *refresh_args = (qmail_refresh_args_t *)malloc(sizeof(*refresh_args));
    if (refresh_args) {
        strncpy(refresh_args->data_dir, g_config.client_data_path,
                sizeof(refresh_args->data_dir) - 1);
        refresh_args->data_dir[sizeof(refresh_args->data_dir) - 1] = '\0';

#ifdef _WIN32
        HANDLE refresh_thread = (HANDLE)_beginthreadex(NULL, 0, qmail_refresh_thread,
                                                       refresh_args, 0, NULL);
        if (refresh_thread == NULL) {
            log_warn(LOG_CAT_GENERAL,
                     "QMail background refresh: _beginthreadex failed — running inline");
            qmail_refresh_thread(refresh_args);
        } else if (first_install) {
            log_info(LOG_CAT_GENERAL,
                     "QMail first-install boot: waiting for RAIDA sync to complete");
            WaitForSingleObject(refresh_thread, INFINITE);
            CloseHandle(refresh_thread);
        } else {
            /* Hold the handle so qmail_refresh_request_shutdown can
             * join during graceful exit. Previously CloseHandle here
             * meant we had no way to wait for the thread on shutdown
             * and could terminate it mid-write. */
            g_qmail_refresh_thread_handle = refresh_thread;
        }
#else
        pthread_t refresh_tid;
        if (pthread_create(&refresh_tid, NULL, qmail_refresh_thread, refresh_args) != 0) {
            log_warn(LOG_CAT_GENERAL,
                     "QMail background refresh: pthread_create failed — running inline");
            qmail_refresh_thread(refresh_args);
        } else if (first_install) {
            log_info(LOG_CAT_GENERAL,
                     "QMail first-install boot: waiting for RAIDA sync to complete");
            pthread_join(refresh_tid, NULL);
        } else {
            /* Keep the tid joinable so qmail_refresh_request_shutdown
             * can join during graceful exit. Previously pthread_detach
             * here meant a SIGTERM with cleanup could kill the thread
             * mid-write to qmail_users.csv. */
            g_qmail_refresh_tid = refresh_tid;
            g_qmail_refresh_tid_valid = true;
        }
#endif
    }

    // Detect local user identity from Mail wallet
    qmail_identity_detect(g_config.wallets_path);

    // Start QMail beacon thread
    memset(&g_qmail_beacon_state, 0, sizeof(g_qmail_beacon_state));

    // Load identity coin for beacon authentication (from Mail wallet)
    char mail_wallet_path[MAX_PATH_LEN] = {0};
    qmail_identity_get_mail_wallet_path(g_config.wallets_path,
                                        mail_wallet_path,
                                        sizeof(mail_wallet_path));

    /* Initialize pre-funded locker pool for qmail send.
     *
     * The payment wallet (configured via rest_core.conf payment_wallet,
     * defaults to "Default") funds the locker pool. The Mail wallet is
     * NEVER used as a payment source — it holds only the user's
     * identity coin. wallet_is_mail_wallet() inside qmail_pool_init
     * enforces this as a defense-in-depth check. */
    char payment_wallet_path[MAX_PATH_LEN];
    get_wallet_path(payment_wallet_path, sizeof(payment_wallet_path),
                    g_config.payment_wallet);
    log_info(LOG_CAT_GENERAL, "Locker pool funding wallet: %s",
             payment_wallet_path);

    result_t pool_init_res = qmail_pool_init(payment_wallet_path);
    if (pool_init_res != RESULT_SUCCESS) {
        log_warn(LOG_CAT_GENERAL,
                 "Locker pool init: %s (pool will fill on first send)",
                 result_to_string(pool_init_res));
    }

    core_transport_t *object_transfer_transport =
        (core_transport_t *)transport_get_default();
    if (qmail_db_ready && object_transfer_transport) {
        result_t transfer_init_result = qmail_transfer_manager_init(
            qmail_db_path, object_transfer_transport);
        if (transfer_init_result != RESULT_SUCCESS) {
            log_warn(LOG_CAT_GENERAL,
                     "QMail Object Transfer manager failed to initialize: %s",
                     result_to_string(transfer_init_result));
        }
    }

    raida_encryption_key_t qmail_key;
    qmail_identity_t identity;
    result_t qmail_key_result = qmail_identity_load_key(g_config.wallets_path,
                                                        &qmail_key,
                                                        &identity);
    if (qmail_key_result == RESULT_SUCCESS && qmail_key.valid) {
        /* Use identity's configured beacon pair, falling back to Phase 1 defaults. */
        uint8_t beacon_id = identity.valid ?
            identity.beacon_raida : QMAIL_BEACON_RAIDA_ID;
        if (beacon_id >= RAIDA_COUNT) {
            beacon_id = QMAIL_BEACON_RAIDA_ID;
        }
        uint8_t secondary_beacon_id = identity.valid ?
            identity.secondary_beacon_raida : QMAIL_SECONDARY_BEACON_RAIDA_ID;
        if (secondary_beacon_id >= RAIDA_COUNT || secondary_beacon_id == beacon_id) {
            secondary_beacon_id = (beacon_id == QMAIL_SECONDARY_BEACON_RAIDA_ID)
                ? QMAIL_BEACON_RAIDA_ID : QMAIL_SECONDARY_BEACON_RAIDA_ID;
        }

        g_qmail_beacon_state.denomination = qmail_key.denomination;
        g_qmail_beacon_state.serial_number = qmail_key.serial_number;
        memcpy(g_qmail_beacon_state.an, qmail_key.ans[beacon_id], AN_LENGTH);
        g_qmail_beacon_state.device_id = 1;
        g_qmail_beacon_state.beacon_raida = beacon_id;
        g_qmail_beacon_state.secondary_beacon_raida = secondary_beacon_id;
        g_qmail_beacon_state.beacons[0].beacon_raida = beacon_id;
        g_qmail_beacon_state.beacons[1].beacon_raida = secondary_beacon_id;
        g_qmail_beacon_state.transport_iface = transport_get_default();
        strncpy(g_qmail_beacon_state.wallet_path, mail_wallet_path,
                sizeof(g_qmail_beacon_state.wallet_path) - 1);
        g_qmail_beacon_state.enc_key_ptr = calloc(1, sizeof(raida_encryption_key_t));
        if (g_qmail_beacon_state.enc_key_ptr) {
            memcpy(g_qmail_beacon_state.enc_key_ptr, &qmail_key,
                   sizeof(raida_encryption_key_t));
        }

        // Load per-beacon catchup timestamps.
        char ts_path[MAX_PATH_LEN];
        snprintf(ts_path, sizeof(ts_path), "%s%sqmail_beacon_ts.dat",
                 g_config.client_data_path, PATH_SEPARATOR_STR);
        qmail_beacon_load_state(ts_path, &g_qmail_beacon_state);

        // Download key is selected fresh at call time inside qmail_receive_email()
        g_qmail_beacon_state.on_new_mail = beacon_on_new_mail;
        g_qmail_beacon_state.callback_data = NULL;

        result = qmail_beacon_start(&g_qmail_beacon_state);
        if (result == RESULT_SUCCESS) {
            log_info(LOG_CAT_GENERAL,
                    "QMail beacon started (SN=%u, primary=%2d, secondary=%2d, last_ts=%u)",
                    g_qmail_beacon_state.serial_number,
                    g_qmail_beacon_state.beacon_raida,
                    g_qmail_beacon_state.secondary_beacon_raida,
                    g_qmail_beacon_state.last_tell_timestamp);
        } else {
            log_warn(LOG_CAT_GENERAL,
                    "QMail beacon failed to start: %s", result_to_string(result));
        }
    } else {
        log_warn(LOG_CAT_GENERAL,
                "QMail beacon skipped: no coins in wallet for authentication");
    }

    // Start tell retry worker (retries failed outgoing tell notifications)
    {
        core_transport_t *retry_transport = (core_transport_t *)transport_get_default();
        if (retry_transport) {
            result = qmail_tell_retry_start(retry_transport);
            if (result == RESULT_SUCCESS) {
                log_info(LOG_CAT_GENERAL, "QMail tell retry worker started");
            } else {
                log_warn(LOG_CAT_GENERAL,
                        "QMail tell retry worker failed to start: %s",
                        result_to_string(result));
            }
        }
    }

    printf("QMail initialized.\n");
    fflush(stdout);
    log_info(LOG_CAT_GENERAL, "QMail subsystem initialized");

    // Run server loop (blocks until Ctrl+C)
    http_server_run(&server);

    // Cleanup
    qmail_transfer_manager_shutdown();

    // Stop QMail tell retry worker
    qmail_tell_retry_stop();
    qmail_tell_retry_join();

    // Stop QMail beacon
    qmail_beacon_stop(&g_qmail_beacon_state);
    qmail_beacon_join(&g_qmail_beacon_state);

    // Save beacon timestamp
    if (g_qmail_beacon_state.serial_number > 0) {
        char ts_path[MAX_PATH_LEN];
        snprintf(ts_path, sizeof(ts_path), "%s%sqmail_beacon_ts.dat",
                 g_config.client_data_path, PATH_SEPARATOR_STR);
        qmail_beacon_save_state(ts_path, &g_qmail_beacon_state);
    }
    if (g_qmail_beacon_state.enc_key_ptr) {
        free(g_qmail_beacon_state.enc_key_ptr);
        g_qmail_beacon_state.enc_key_ptr = NULL;
    }

    // Close QMail database
    qmail_db_close();

    // Cleanup QMail health tracker
    qmail_health_cleanup();

    // Stop background health manager first
    health_manager_stop();

    http_server_destroy(&server);
    /* Stop the SSE listener (closes all open EventSource sockets and joins
     * the accept + keepalive threads). Idempotent — safe if init failed. */
    sse_server_stop();
    /* Stop the background QMail refresh thread BEFORE rest_cleanup so
     * any in-flight write to qmail_users.csv / wordlist cache /
     * rest_core.conf has a chance to complete cleanly. Best-effort: a
     * timed wait on Windows, blocking join on POSIX. */
    qmail_refresh_request_shutdown();
    qmail_health_refresh_request_shutdown();
    qmail_dl_retry_request_shutdown();
    raida_telemetry_close();
    rest_cleanup();
    http_client_global_cleanup();
    log_cleanup();
    return 0;
}
