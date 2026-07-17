#!/usr/bin/env bash
set -euo pipefail

PLATFORM=${1:?usage: download_published_core.sh <windows|linux>}
BASE_URL=${QMAIL_BIN_BASE_URL:-https://cloudcoinconsortium.com/bin}

mkdir -p backend ci-build

download() {
  local url=$1
  local out=$2
  curl -fsSL "$url" -o "$out"
}

sha_from_sums() {
  local filename=$1
  awk -v name="$filename" '$2 == name { print $1; found = 1 } END { exit found ? 0 : 1 }' ci-build/SHA256SUMS
}

download "$BASE_URL/SHA256SUMS" ci-build/SHA256SUMS

case "$PLATFORM" in
  windows)
    source_name=core-windows-latest.exe
    target_path=backend/core.exe
    ;;
  linux)
    source_name=core-linux-latest
    target_path=backend/core
    ;;
  *)
    echo "unsupported platform: $PLATFORM" >&2
    exit 2
    ;;
esac

download "$BASE_URL/$source_name" "$target_path"

expected=$(sha_from_sums "$source_name") || {
  echo "SHA256SUMS does not contain $source_name" >&2
  exit 1
}
actual=$(sha256sum "$target_path" | awk '{ print $1 }')

if [[ "$actual" != "$expected" ]]; then
  echo "checksum mismatch for $source_name" >&2
  echo "expected: $expected" >&2
  echo "actual:   $actual" >&2
  exit 1
fi

chmod 0755 "$target_path"
printf '%s  %s\n' "$actual" "$target_path" > "ci-build/${PLATFORM}-core.sha256"
echo "verified $source_name ($actual)"
