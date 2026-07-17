#!/usr/bin/env bash
set -euo pipefail

LEFT=${1:?usage: assert_same_build_date.sh <left-version.json> <right-version.json>}
RIGHT=${2:?usage: assert_same_build_date.sh <left-version.json> <right-version.json>}

read_build_date() {
  local file=${1:?}
  local date
  if [[ ! -s "$file" ]]; then
    echo "missing version metadata: $file" >&2
    exit 1
  fi
  date=$(sed -nE 's/^.*"buildDate"[[:space:]]*:[[:space:]]*"([0-9]{4}-[0-9]{2}-[0-9]{2})".*$/\1/p' "$file" | head -n 1)
  if [[ ! "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "could not parse YYYY-MM-DD buildDate from $file" >&2
    exit 1
  fi
  printf '%s\n' "$date"
}

left_date=$(read_build_date "$LEFT")
right_date=$(read_build_date "$RIGHT")

if [[ "$left_date" != "$right_date" ]]; then
  echo "buildDate mismatch: $LEFT has $left_date, $RIGHT has $right_date" >&2
  exit 1
fi

echo "buildDate verified: $left_date"
