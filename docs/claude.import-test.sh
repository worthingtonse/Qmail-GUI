#!/usr/bin/env bash
# Test harness for the first-run import / convert-recovery changes.
# Companion to claude.first-run-import-testplan.md
#
# SAFETY: no command here deposits anything unless you pass an explicit path.
# Deposit is a MOVE — coins leave the folder you name. Pass a scratch copy.
#
# Runs core from an ISOLATED data dir so gui/backend/Client_Data is untouched.

set -uo pipefail

CORE_EXE="${CORE_EXE:-/d/Code/p2/core/build-msvc/Release/core.exe}"
TEST_ROOT="${TEST_ROOT:-/c/Users/User/AppData/Local/Temp/claude/D--Code-p2-gui/271bc455-c1c2-4c34-8819-87f9c0eb77ea/scratchpad/import-test}"
PORT="${PORT:-8099}"
BASE="http://127.0.0.1:${PORT}"

LOG="${TEST_ROOT}/Client_Data/main.log"
PIDFILE="${TEST_ROOT}/core.pid"

api() { curl -s --max-time 120 "$@"; }

wallets_dir() { echo "${TEST_ROOT}/Client_Data/Wallets"; }

cmd_start() {
  if [ ! -x "$CORE_EXE" ]; then
    echo "ERROR: core.exe not found at $CORE_EXE" >&2
    echo "Build it: cmake --build build-msvc --config Release --target core" >&2
    return 1
  fi
  mkdir -p "$TEST_ROOT"
  echo "core.exe : $CORE_EXE"
  ls -la "$CORE_EXE" | awk '{print "  built  : " $6 " " $7 " " $8 "  (" $5 " bytes)"}'
  echo "data dir : $TEST_ROOT"
  echo "port     : $PORT"
  echo

  # core.exe locates Client_Data relative to its own location, so run a copy
  # from inside the isolated dir. That keeps the real backend untouched.
  #
  # core runs in the foreground and never returns, so it must be fully
  # detached (nohup + setsid where available) — otherwise this script blocks
  # forever waiting on a process that is working correctly.
  cp -f "$CORE_EXE" "${TEST_ROOT}/core.exe"
  (
    cd "$TEST_ROOT" || exit 1
    if command -v setsid >/dev/null 2>&1; then
      setsid nohup ./core.exe --port "$PORT" >"${TEST_ROOT}/stdout.log" 2>&1 &
    else
      nohup ./core.exe --port "$PORT" >"${TEST_ROOT}/stdout.log" 2>&1 &
    fi
    echo $! >"$PIDFILE"
  )

  for i in $(seq 1 40); do
    if api "${BASE}/api/wallets/list" >/dev/null 2>&1; then
      echo "core is up (pid $(cat "$PIDFILE"))"
      return 0
    fi
    sleep 0.5
  done
  echo "ERROR: core did not come up. stdout.log:" >&2
  tail -30 "${TEST_ROOT}/stdout.log" >&2
  return 1
}

# The bash pidfile tracks the shell's child, which under MSYS is not always
# the Windows PID that holds the port and the sqlite locks. Find the real
# core.exe by its executable path so stop/kill actually work.
real_core_pids() {
  local win_root
  win_root="$(cd "$TEST_ROOT" && pwd -W 2>/dev/null | sed 's:/:\\\\:g')"
  wmic process where "name='core.exe'" get ExecutablePath,ProcessId 2>/dev/null \
    | tr -d '\r' \
    | awk -v root="$win_root" 'index($0, "import-test") > 0 { print $NF }' \
    | grep -E '^[0-9]+$'
}

cmd_stop() {
  local pids; pids="$(real_core_pids)"
  if [ -z "$pids" ]; then echo "no test core.exe running"; rm -f "$PIDFILE"; return 0; fi
  for p in $pids; do taskkill //PID "$p" 2>/dev/null | head -1; done
  sleep 2
  # sqlite WAL + .instance.lock are released only once the process is gone;
  # verify rather than assume, or a later reset fails with "resource busy".
  if [ -n "$(real_core_pids)" ]; then
    echo "graceful stop did not release; forcing"
    for p in $(real_core_pids); do taskkill //PID "$p" //F 2>/dev/null | head -1; done
    sleep 2
  fi
  rm -f "$PIDFILE"
  echo "stopped."
}

# Hard kill — used by the fault-injection tests (6a/6b). No graceful shutdown,
# so on-disk state is exactly what it was mid-operation.
cmd_kill() {
  local pids; pids="$(real_core_pids)"
  if [ -z "$pids" ]; then echo "no test core.exe running"; return 1; fi
  for p in $pids; do taskkill //PID "$p" //F 2>/dev/null | head -1; done
  rm -f "$PIDFILE"
}

cmd_new_wallet() {
  local name="${1:?usage: new-wallet <name>}"
  # /api/wallets/create takes a full wallet_path and derives the name from the
  # last path component — not a bare name. Core needs a native Windows path.
  local win_root
  win_root="$(cd "$TEST_ROOT" && pwd -W 2>/dev/null | sed 's:/:\\:g')"
  if [ -z "$win_root" ]; then
    echo "ERROR: could not resolve a Windows path for $TEST_ROOT" >&2
    return 1
  fi
  local wpath="${win_root}\\Client_Data\\Wallets\\${name}"
  echo "creating wallet: $name"
  echo "  path: $wpath"
  api -X POST --data-urlencode "wallet_path=${wpath}" -G "${BASE}/api/wallets/create"; echo
  api "${BASE}/api/wallets/list"; echo
}

cmd_snapshot() {
  local name="${1:?usage: snapshot <wallet>}"
  local w; w="$(wallets_dir)/${name}"
  if [ ! -d "$w" ]; then echo "no such wallet dir: $w" >&2; return 1; fi
  echo "--- $name @ $(date '+%H:%M:%S') ---"
  # Count FILES only. Bank/Counterfeit/Import all contain CCv1//CCv2/
  # subdirectories, and counting those as coins reads as phantom notes.
  for d in Bank Fracked Counterfeit Limbo Grade Suspect Pending Imported Recovery Import Import/CCv1 Import/CCv2 Counterfeit/CCv1 Counterfeit/CCv2; do
    printf '  %-18s %s\n' "$d" "$(find "$w/$d" -maxdepth 1 -type f 2>/dev/null | wc -l)"
  done
  local bytes
  bytes=$(ls -la "$w/Recovery" 2>/dev/null | awk 'NR>3 {print $5}' | tr '\n' ' ')
  if [ -n "$bytes" ]; then echo "  Recovery sizes: $bytes"; fi
  return 0
}

cmd_deposit() {
  local name="${1:?usage: deposit <wallet> <source-folder>}"
  local src="${2:?usage: deposit <wallet> <source-folder>}"
  if [ ! -d "$src" ]; then echo "no such source folder: $src" >&2; return 1; fi

  # Core needs a native Windows path; let curl do the percent-encoding rather
  # than hand-rolling it (backslashes and spaces both need escaping).
  local win_src
  win_src="$(cd "$src" && pwd -W 2>/dev/null | sed 's:/:\\:g')"
  [ -z "$win_src" ] && win_src="$src"

  echo "!!! deposit MOVES files out of: $src"
  echo "    windows path : $win_src"
  echo "    files present: $(ls "$src" | wc -l)"
  if [ "${ASSUME_YES:-0}" != "1" ]; then
    read -r -p "    proceed? [y/N] " ok
    [ "$ok" = "y" ] || { echo "aborted"; return 1; }
  fi
  api -X POST -G "${BASE}/api/transactions/deposit" \
      --data-urlencode "wallet=${name}" \
      --data-urlencode "source_folder=${win_src}" \
      --data-urlencode "memo=harness"
  echo
}

cmd_watch_recovery() {
  local name="${1:?usage: watch-recovery <wallet>}"
  local w; w="$(wallets_dir)/${name}/Recovery"
  echo "watching $w (ctrl-c to stop)"
  while true; do
    local n; n=$(ls "$w" 2>/dev/null | wc -l)
    if [ "$n" -gt 0 ]; then
      echo "$(date '+%H:%M:%S.%3N')  journals=$n  $(ls -la "$w" | awk 'NR>3 {print $9 "(" $5 "B)"}' | tr '\n' ' ')"
    fi
    sleep 0.05
  done
}

cmd_logs() {
  [ -f "$LOG" ] || { echo "no log yet at $LOG"; return 0; }
  grep -iE 'POWN phase|POWN SUM|UPGRADE:|Legacy coins detected|SwitchShard|recovery journal|Convert recovery|convert recovery journals|Graded:|counterfeit|Limbo|encryption key' "$LOG" | tail -60
}

cmd_tasks() { api "${BASE}/api/system/tasks"; echo; }
cmd_recovery_status() { api "${BASE}/api/recovery/status"; echo; }
cmd_balance() { api "${BASE}/api/wallets/balance?wallet=${1:-Default}"; echo; }

cmd_reset() {
  echo "This deletes the ISOLATED test tree only: $TEST_ROOT"
  read -r -p "proceed? [y/N] " ok
  [ "$ok" = "y" ] || { echo "aborted"; return 1; }
  cmd_stop 2>/dev/null
  rm -rf "$TEST_ROOT"
  echo "removed."
}

case "${1:-help}" in
  start)           shift; cmd_start "$@" ;;
  stop)            shift; cmd_stop "$@" ;;
  kill)            shift; cmd_kill "$@" ;;
  new-wallet)      shift; cmd_new_wallet "$@" ;;
  snapshot)        shift; cmd_snapshot "$@" ;;
  deposit)         shift; cmd_deposit "$@" ;;
  watch-recovery)  shift; cmd_watch_recovery "$@" ;;
  logs)            shift; cmd_logs "$@" ;;
  tasks)           shift; cmd_tasks "$@" ;;
  recovery-status) shift; cmd_recovery_status "$@" ;;
  balance)         shift; cmd_balance "$@" ;;
  reset)           shift; cmd_reset "$@" ;;
  *)
    cat <<'EOF'
usage: claude.import-test.sh <command>

  start                      run the freshly-built core against an isolated data dir
  stop                       graceful stop
  kill                       SIGKILL (fault-injection tests 6a/6b)
  new-wallet <name>          create + register a clean test wallet
  snapshot <wallet>          coin counts for every folder
  deposit <wallet> <folder>  deposit from a folder (MOVES files; prompts first)
  watch-recovery <wallet>    tight-loop watch on Recovery/ (test 5)
  logs                       tail the interesting log lines
  tasks | recovery-status | balance [wallet]
  reset                      delete the isolated test tree

env: CORE_EXE, TEST_ROOT, PORT (default 8099)
EOF
    ;;
esac
