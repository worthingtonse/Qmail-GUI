# ============================================================================
# Founders Core Library - CMakeLists.txt
# ============================================================================
# Shared command library for RAIDA protocol operations.
# Used by both console and REST applications.
# ============================================================================

cmake_minimum_required(VERSION 3.16)
project(founders_core C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# ============================================================================
# BUILD OPTIONS
# ============================================================================

# REST_MODE: When ON, disables CLI display code (printf, histograms)
option(CORE_REST_MODE "Build for REST API (no CLI output)" OFF)

if(CORE_REST_MODE)
    add_definitions(-DREST_MODE)
    message(STATUS "Core library: REST_MODE enabled (no CLI output)")
else()
    message(STATUS "Core library: CLI mode (display enabled)")
endif()

# ============================================================================
# SOURCE FILES
# ============================================================================

set(CORE_SOURCES
    # Platform abstraction
    src/platform.c

    # Cryptographic operations
    src/crypto.c

    # Protocol layer
    src/protocol.c

    # Executor framework
    src/executor.c
    src/raida_telemetry.c

    # Logging utilities
    src/logging.c

    # Network utilities
    src/http_client.c

    # RAIDA server configuration
    src/raida_servers.c

    # Utility functions
    src/utils_new.c

    # RAIDA status codes
    src/raida_status.c

    # Coin file handling (Phase 1)
    src/coin_pown.c
    src/coin_denom.c
    src/folder_types.c
    src/filesystem.c

    # Coin file handling (Phase 2)
    src/coin_file.c
    src/coin_filename.c

    # Coin file encryption (Phase 3)
    src/coin_crypto.c
    src/password_verifier.c
    src/boot_encryption_check.c

    # Wallet management (Phase 4)
    src/wallet.c
    src/wallet_lock.c

    # Commands
    src/commands/cmd_echo.c
    src/commands/cmd_version.c
    src/commands/cmd_count.c

    # Import/Deposit (Phase 5)
    src/raida_parallel.c
    src/commands/cmd_pown.c
    src/commands/cmd_unpack.c
    src/commands/cmd_grade.c
    src/commands/cmd_convert.c
    src/commands/cmd_deposit.c
    src/commands/cmd_upgrade.c
    src/commands/cmd_wallet.c

    # Make Change (Phase 6)
    src/encryption_key.c
    src/commands/cmd_make_change.c
    src/commands/cmd_get_sns.c
    src/commands/cmd_join.c

    # Locker (Phase 7)
    src/commands/cmd_locker.c

    # Transactions (Phase 8)
    src/commands/transaction_log.c

    # Platform Utils (Phase 9)
    src/commands/cmd_platform_utils.c
    src/commands/cmd_config_utils.c

    # Healing Commands (Phase 10)
    src/commands/cmd_detect.c
    src/commands/cmd_get_ticket.c
    src/commands/cmd_heal.c
    src/commands/cmd_fix_encryption.c
    src/commands/cmd_fix_protocol.c
    src/commands/cmd_fix.c

    # Disclaimer (Phase 11)
    src/commands/cmd_disclaimer.c

    # Wallet Wrappers (Phase 12)
    src/commands/cmd_wallet_wrappers.c

    # Export (Phase 13)
    src/commands/cmd_export.c

    # Health Automation (Phase 14)
    src/health_manager.c
    src/commands/cmd_find.c

    # Shared RAIDA consensus fetch utility
    src/raida_consensus_fetch.c

    # SHA-256 hash utility
    src/sha256_util.c

    # Task Manager (shared by CLI and REST)
    src/task_manager.c

    # Receipt writer (core-side stub; JSON impl lives in api_src)
    src/receipt_writer_stub.c

    # QMail Email Client (Phase 15)
    src/qmail/qmail_servers.c
    src/qmail/qmail_cbdf.c
    src/qmail/qmail_striping.c
    src/qmail/qmail_crypto.c
    src/qmail/qmail_upload.c
    src/qmail/qmail_tell.c
    src/qmail/qmail_ping.c
    src/qmail/qmail_peek.c
    src/qmail/qmail_download.c
    src/qmail/qmail_object_transfer.c
    src/qmail/qmail_transfer_store.c
    src/qmail/qmail_transfer_manager.c
    src/qmail/qmail_send.c
    src/qmail/qmail_upload_orchestrator.c
    src/qmail/qmail_receipt.c
    src/qmail/qmail_receive.c
    src/qmail/qmail_beacon.c
    src/qmail/qmail_tell_retry.c
    src/qmail/qmail_db.c
    src/qmail/qmail_contacts.c
    src/qmail/qmail_wordlist.c
    src/qmail/qmail_users.c
    src/qmail/qmail_health.c
)

# NOTE: transport.c is NOT included - applications provide their own
# transport implementation via the core_transport.h callback interface.

set(CORE_HEADERS
    include/protocol.h
    include/results.h
# ... (rest of CORE_HEADERS) ...
    # Platform Util headers (Phase 9)
    include/cmd_platform_utils.h
    include/cmd_config_utils.h

    # Disclaimer headers (Phase 11)
    include/cmd_disclaimer.h

    # Wallet Wrapper headers (Phase 12)
    include/cmd_wallet_wrappers.h

    # Task Manager header
    include/task_manager.h

    # Shared RAIDA consensus fetch utility
    include/raida_consensus_fetch.h

    # SHA-256 hash utility
    include/sha256_util.h
    include/qmail/qmail_transfer_store.h
    include/qmail/qmail_transfer_manager.h
)

# ============================================================================
# LIBRARY TARGET
# ============================================================================

add_library(founders_core STATIC ${CORE_SOURCES} ${CORE_HEADERS})

target_include_directories(founders_core
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party
)

# ============================================================================
# PLATFORM-SPECIFIC CONFIGURATION
# ============================================================================

if(WIN32)
    # Windows-specific settings
    target_compile_definitions(founders_core PRIVATE _CRT_SECURE_NO_WARNINGS)
    target_link_libraries(founders_core PUBLIC ws2_32 bcrypt winhttp shlwapi dbghelp)

    if(MSVC)
        target_compile_options(founders_core PRIVATE /W3)
    endif()
else()
    # Unix/Linux settings
    find_package(Threads REQUIRED)
    find_package(OpenSSL REQUIRED)
    find_package(CURL REQUIRED)

    target_link_libraries(founders_core PUBLIC
        Threads::Threads
        OpenSSL::SSL
        OpenSSL::Crypto
        CURL::libcurl
    )

    target_compile_options(founders_core PRIVATE -Wall -Wextra)
endif()

# ============================================================================
# INSTALL (optional)
# ============================================================================

install(TARGETS founders_core
    ARCHIVE DESTINATION lib
    LIBRARY DESTINATION lib
)

install(FILES ${CORE_HEADERS}
    DESTINATION include/founders_core
)

# ============================================================================
# TEST EXECUTABLES (only built if tests/ directory exists)
# ============================================================================

# Tests removed — not needed

# ============================================================================
# REST CORE EXECUTABLE
# ============================================================================

# REST API layer source files
set(REST_API_SOURCES
    # --- Core REST Implementation ---
    api_src/main_rest.c          # Entry point, initialization
    api_src/http_server.c        # HTTP server implementation
    api_src/sse_server.c         # Server-Sent Events listener (second port)
    api_src/api_handlers.c       # REST endpoint registration
    api_src/api_handlers_utils.c # Shared helper functions
    api_src/api_handlers_raida.c # RAIDA echo/version/count
    api_src/api_handlers_health.c # Fix encryption/fracked, find
    api_src/api_handlers_coins.c # Coin management
    api_src/api_handlers_locker.c # Locker operations
    api_src/api_handlers_wallet.c # Wallet operations
    api_src/api_handlers_export.c # Export operations
    api_src/api_handlers_system_diag.c # Loopback test, task status, recovery status
    api_src/api_handlers_system_encrypt.c # File encryption login/logout/status/encrypt-existing
    api_src/api_handlers_system_glue.c # Theme, dropdown, support zip
    api_src/api_handlers_system_program.c # Program echo, disclaimer, version-check, USB/mobile
    api_src/api_handlers_system_transfer.c # Wallet-to-wallet transfer
    api_src/api_handlers_system_update.c # Software update download/apply
    api_src/api_handlers_system_utils.c # Shared system handler helpers
    api_src/api_handlers_deposit.c # Deposit endpoint (async)
    api_src/api_handlers_upgrade.c # Upgrade CCv1/CCv2 endpoints (async)
    api_src/receipt_writer_json.c  # JSON impl for the receipt engine
    api_src/config.c             # Configuration management
    api_src/network.c            # Network utilities
    api_src/simple_json.c        # JSON builder
    api_src/raida_task.c         # Async task tracking

    # --- Adapter Layer (REST -> Core Bridge) ---
    # These files bridge REST's API to core library implementations.
    # They translate function signatures and types, NOT duplicate logic.
    #
    # core_adapter.c: Wraps REST's transport to match core's callback interface
    #                 (core_transport_t). Allows core commands to use REST's
    #                 network implementation.
    api_src/core_adapter.c
    #
    # transport_adapter.c: Maps REST transport types (REST_TRANSPORT_TCP/UDP)
    #                      to core transport types (TRANSPORT_TCP/UDP).
    api_src/transport_adapter.c
    #
    # command_adapter.c: Provides stubs for REST command functions not yet
    #                    wired to core equivalents. Functions return
    #                    RESULT_NOT_IMPLEMENTED until implemented.
    #                    Also provides g_client_data_path global for core.
    api_src/command_adapter.c

    # Transport implementation (used by transport_adapter.c)
    src/transport.c

    # Third-party: miniz (ZIP support)
    third_party/miniz.c
    third_party/miniz_tdef.c
    third_party/miniz_tinfl.c
    third_party/miniz_zip.c

    # Third-party: SQLite (for QMail)
    third_party/sqlite3.c

    # QMail REST API handlers
    api_src/api_handlers_qmail_messages.c
    api_src/api_handlers_qmail_messages_send.c
    api_src/api_handlers_qmail_beacon_control.c
    api_src/api_handlers_qmail_object_transfer.c
    api_src/api_handlers_qmail_inbox.c
    api_src/api_handlers_qmail_folders.c
    api_src/api_handlers_qmail_contacts.c
    api_src/api_handlers_qmail_drafts.c
    api_src/api_handlers_qmail_attachments.c
    api_src/api_handlers_qmail_tells.c
    api_src/api_handlers_qmail_payments.c
    api_src/api_handlers_qmail_identity.c
    api_src/api_handlers_qmail_misc.c
    api_src/api_handlers_qmail_receipts.c
    api_src/api_handlers_qmail_reports.c
    api_src/api_handlers_qmail_utils.c
    api_src/qmail_locker_pool.c
    api_src/qmail_locker_pool_partial.c
)

# Build REST Core executable with REST_MODE enabled
add_executable(core ${REST_API_SOURCES})

target_compile_definitions(core PRIVATE REST_MODE SQLITE_ENABLE_FTS5)

target_include_directories(core PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
    ${CMAKE_CURRENT_SOURCE_DIR}/include/api
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party
    ${CMAKE_CURRENT_SOURCE_DIR}/include/qmail
)

target_link_libraries(core founders_core)

if(NOT WIN32)
    target_link_libraries(core m)
endif()

# Frozen QMail Object Transfer v1 vector harness. This is intentionally
# opt-in so normal portable/REST builds do not produce an extra executable.
option(BUILD_QMAIL_OBJECT_TRANSFER_TESTS
       "Build QMail Object Transfer v1 byte-vector tests" OFF)

if(BUILD_QMAIL_OBJECT_TRANSFER_TESTS)
    enable_testing()
    find_package(Python3 COMPONENTS Interpreter REQUIRED)
    add_executable(qmail_object_transfer_vector_driver
        qmail_object_transfer_tests/qmail_object_transfer_vector_driver.c
    )
    target_include_directories(qmail_object_transfer_vector_driver PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/include/qmail
    )
    target_link_libraries(qmail_object_transfer_vector_driver founders_core)
    if(NOT WIN32)
        target_link_libraries(qmail_object_transfer_vector_driver m)
    endif()
    add_test(
        NAME qmail_object_transfer_vectors
        COMMAND ${Python3_EXECUTABLE}
            ${CMAKE_CURRENT_SOURCE_DIR}/qmail_object_transfer_tests/test_qmail_object_transfer_vectors.py
            --driver $<TARGET_FILE:qmail_object_transfer_vector_driver>
            --vectors
            ${CMAKE_CURRENT_SOURCE_DIR}/qmail_object_transfer_tests/qmail-object-transfer-v1-vectors.json
    )

    add_executable(qmail_transfer_store_test
        qmail_object_transfer_tests/qmail_transfer_store_test.c
        third_party/sqlite3.c
    )
    target_compile_definitions(qmail_transfer_store_test PRIVATE
        REST_MODE SQLITE_ENABLE_FTS5)
    target_include_directories(qmail_transfer_store_test PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/include/qmail
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party
    )
    target_link_libraries(qmail_transfer_store_test founders_core)
    if(NOT WIN32)
        target_link_libraries(qmail_transfer_store_test m)
    endif()
    add_test(
        NAME qmail_transfer_store
        COMMAND qmail_transfer_store_test
    )
endif()

# ============================================================================
# Pre-build: kill any core.exe / core processes occupying the test ports
# (8080 = base API, 8081 = Client1, 8082 = Client2). Otherwise the link
# step or the post-build mirror would fail with a file-lock error and the
# AdvancedTests harness would silently keep using a stale binary.
# Cross-platform via a generated CMake script that picks per-OS commands.
# ============================================================================
set(_kill_ports_script "${CMAKE_CURRENT_BINARY_DIR}/kill_test_ports.cmake")
file(WRITE "${_kill_ports_script}"
"# Auto-generated by CMakeLists.txt — do not edit by hand.
# Usage: cmake -P kill_test_ports.cmake
set(_ports 8080 8081 8082)
if(WIN32 OR CMAKE_HOST_WIN32)
    # BUG-51: kill any running QMail.exe / core.exe by name so the post-build
    # mirror copy doesn't hit a file lock. Per Sean: machine-wide is fine.
    execute_process(
        COMMAND powershell -NoProfile -Command
            \"foreach (\$n in @('QMail','core')) { Get-Process -Name \$n -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id \$_.Id -Force -ErrorAction Stop; Write-Host \\\"killed \$n PID \$(\$_.Id)\\\" } catch { } } }\"
        OUTPUT_VARIABLE _name_out
        ERROR_QUIET
    )
    if(_name_out)
        message(STATUS \"\${_name_out}\")
    endif()
    foreach(_port \${_ports})
        # Use PowerShell. Get-NetTCPConnection returns PIDs of owning processes
        # for any LISTEN/ESTABLISHED socket on that local port. Stop-Process
        # -Force terminates them. Both calls are wrapped in -ErrorAction
        # SilentlyContinue so an empty result (no listener) is not an error.
        execute_process(
            COMMAND powershell -NoProfile -Command
                \"$pids = (Get-NetTCPConnection -LocalPort \${_port} -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique; if ($pids) { foreach ($p in $pids) { try { Stop-Process -Id $p -Force -ErrorAction Stop; Write-Host \\\"killed PID $p on port \${_port}\\\" } catch { } } }\"
            RESULT_VARIABLE _rc
            OUTPUT_VARIABLE _out
            ERROR_QUIET
        )
        if(_out)
            message(STATUS \"port \${_port}: \${_out}\")
        endif()
    endforeach()
else()
    # Linux/macOS: prefer lsof (most portable), fall back to fuser.
    find_program(_lsof_exe lsof)
    find_program(_fuser_exe fuser)
    foreach(_port \${_ports})
        if(_lsof_exe)
            execute_process(
                COMMAND \${_lsof_exe} -ti tcp:\${_port}
                OUTPUT_VARIABLE _pids
                OUTPUT_STRIP_TRAILING_WHITESPACE
                ERROR_QUIET
            )
            if(_pids)
                string(REPLACE \"\\n\" \";\" _pid_list \"\${_pids}\")
                foreach(_pid \${_pid_list})
                    if(_pid)
                        execute_process(
                            COMMAND kill -9 \${_pid}
                            ERROR_QUIET
                        )
                        message(STATUS \"port \${_port}: killed PID \${_pid}\")
                    endif()
                endforeach()
            endif()
        elseif(_fuser_exe)
            execute_process(
                COMMAND \${_fuser_exe} -k -n tcp \${_port}
                OUTPUT_QUIET
                ERROR_QUIET
            )
        else()
            message(WARNING \"Neither lsof nor fuser found; cannot free port \${_port} automatically.\")
        endif()
    endforeach()
endif()
")

# Output directory
if(WIN32)
    set_target_properties(core PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "E:/"
        RUNTIME_OUTPUT_DIRECTORY_DEBUG "E:/"
        RUNTIME_OUTPUT_DIRECTORY_RELEASE "E:/"
    )

    # PRE_LINK fires after compile but before link/copy on every generator
    # (unlike PRE_BUILD which is VS-only when attached to a target). The
    # kill happens once per `core` build, just before the new binary lands.
    add_custom_command(TARGET core PRE_LINK
        COMMAND ${CMAKE_COMMAND} -P "${_kill_ports_script}"
        COMMENT "Freeing test ports 8080/8081/8082 before relink"
    )

    # Mirror the freshly-built core.exe into the two test-client folders so
    # the AdvancedTests harness (which launches E:\Client1\core.exe and
    # E:\Client2\core.exe on ports 8081/8082) always runs against the
    # current build instead of stale binaries left over from earlier work.
    # The copy is best-effort: if Client1/Client2 are currently running,
    # Windows holds a file lock on their core.exe and the copy will fail.
    # A small CMake script (`mirror_core.cmake`) wraps the copy in a
    # try/warn so a locked file just emits a visible warning and the
    # build still succeeds, leaving the older binary in place.
    set(_mirror_script "${CMAKE_CURRENT_BINARY_DIR}/mirror_core.cmake")
    file(WRITE "${_mirror_script}"
"# Auto-generated by CMakeLists.txt — do not edit by hand.
# Usage:  cmake -DSRC=<source-exe> -DDST=<dest-exe> -P mirror_core.cmake
get_filename_component(_dst_dir \"\${DST}\" DIRECTORY)
file(MAKE_DIRECTORY \"\${_dst_dir}\")
execute_process(
    COMMAND \"\${CMAKE_COMMAND}\" -E copy_if_different \"\${SRC}\" \"\${DST}\"
    RESULT_VARIABLE _copy_rc
    OUTPUT_QUIET
    ERROR_QUIET
)
if(NOT _copy_rc EQUAL 0)
    message(STATUS \"WARNING: could not update \${DST} (client running? file locked?)\")
endif()
")
    add_custom_command(TARGET core POST_BUILD
        COMMAND ${CMAKE_COMMAND}
                -DSRC=$<TARGET_FILE:core>
                -DDST=E:/Client1/core.exe
                -P "${_mirror_script}"
        COMMAND ${CMAKE_COMMAND}
                -DSRC=$<TARGET_FILE:core>
                -DDST=E:/Client2/core.exe
                -P "${_mirror_script}"
        COMMAND ${CMAKE_COMMAND}
                -DSRC=$<TARGET_FILE:core>
                -DDST=E:/gem/core.exe
                -P "${_mirror_script}"
        COMMAND ${CMAKE_COMMAND}
                -DSRC=$<TARGET_FILE:core>
                -DDST=E:/gpt/core.exe
                -P "${_mirror_script}"
        COMMAND ${CMAKE_COMMAND}
                -DSRC=$<TARGET_FILE:core>
                -DDST=E:/opu/core.exe
                -P "${_mirror_script}"
        # BUG-51: mirror into the QMail-GUI repo's backend/ so
        # electron-builder bundles the fresh core.exe inside QMail.exe.
        COMMAND ${CMAKE_COMMAND}
                -DSRC=$<TARGET_FILE:core>
                -DDST=D:/code/src/JavaScript/Qmail-GUI/backend/core.exe
                -P "${_mirror_script}"
        COMMENT "Mirroring core.exe to E:/Client1, E:/Client2, E:/gem, E:/gpt, E:/opu, Qmail-GUI/backend"
    )
else()
    set_target_properties(core PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "/opt/raidax"
        RUNTIME_OUTPUT_DIRECTORY_DEBUG "/opt/raidax"
        RUNTIME_OUTPUT_DIRECTORY_RELEASE "/opt/raidax"
    )

    # Same pre-link kill on Linux so a running core blocking the install
    # path doesn't break the relink. The script switches branches on
    # CMAKE_HOST_WIN32 so a single file works everywhere.
    add_custom_command(TARGET core PRE_LINK
        COMMAND ${CMAKE_COMMAND} -P "${_kill_ports_script}"
        COMMENT "Freeing test ports 8080/8081/8082 before relink"
    )
endif()

# ============================================================================
# VERSION (auto-generated build date in YYYY-MM-DD format)
# ============================================================================

# Force CMake to reconfigure on every build so the date stays current.
# Without this, the timestamp only updates when CMakeLists.txt changes.
set(VERSION_STAMP_FILE "${CMAKE_CURRENT_BINARY_DIR}/version_stamp.txt")
file(WRITE "${VERSION_STAMP_FILE}" "")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${VERSION_STAMP_FILE}")

string(TIMESTAMP REST_BUILD_DATE "%Y-%m-%d" UTC)

target_compile_definitions(core PRIVATE
    REST_VERSION_STRING="${REST_BUILD_DATE}"
)

message(STATUS "Core: Version ${REST_BUILD_DATE}")
message(STATUS "Core: Building executable")
