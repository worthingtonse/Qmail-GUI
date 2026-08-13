#!/usr/bin/env bash
set -euo pipefail

# Publishes the client version to the RAIDA service directory, in two files:
#
#   qmail_client_version.php   (legacy) — echoes one bare ISO date, nothing
#     else. Fielded clients anchor a ^\d{4}-\d{2}-\d{2}$ regex against the
#     WHOLE response body, so a single extra character breaks their update
#     check permanently. This file's format is frozen; never add to it.
#
#   qmail_client_versions.php  (manifest) — one release date per platform,
#     so a Windows release stops nagging Mac and Linux users. Keeps a bare
#     date on line 1 for anything that reads only the first line, with the
#     JSON object after it.
#
# Only the platform(s) built by this pipeline are bumped; every other key
# keeps the date already published, which is the whole point of the split.
#
# USAGE
#   bump_qmail_client_version.sh <version.json|YYYY-MM-DD> <platform-key>
#
# The date may be given either as a version.json to read "buildDate" out of
# (how the GUI pipeline calls it) or as a literal ISO date (for callers that
# have no version.json — notably the core repo, whose CMake/CI publishes the
# "core" key independently of any GUI release).
#
# CALLING THIS FROM THE CORE REPO
#   bump_qmail_client_version.sh 2026-09-15 core
#
# It needs only: bash, awk, sed, curl, ssh/rsync access to r11. No Node, no
# GUI checkout. The "core" key never touches the legacy single-date file —
# see LEGACY_KEY below.

VERSION_INPUT=${1:?usage: bump_qmail_client_version.sh <version.json|YYYY-MM-DD> <platform-key>}
PLATFORM_KEY=${2:?usage: bump_qmail_client_version.sh <version.json|YYYY-MM-DD> <platform-key>}
SSH_OPTS="-o BatchMode=yes"
REMOTE_PATH=/opt/raida/service/qmail_client_version.php
REMOTE_MANIFEST_PATH=/opt/raida/service/qmail_client_versions.php

# Must match PLATFORM_KEYS in src/platform.js.
VALID_KEYS="windows linux-app linux-deb linux-tar-gz mac android iphone core"
if [[ " $VALID_KEYS " != *" $PLATFORM_KEY "* ]]; then
  echo "unknown platform key: $PLATFORM_KEY (expected one of: $VALID_KEYS)" >&2
  exit 1
fi

# Which key owns the frozen legacy file. That file predates the manifest and
# means "the latest QMail desktop client", so only a desktop release may
# rewrite it. A core bump publishes to the manifest alone — otherwise a core
# release would tell every fielded GUI that a new GUI exists.
LEGACY_KEY=windows

read_build_date() {
  local file=${1:?}
  local date
  date=$(sed -nE 's/^.*"buildDate"[[:space:]]*:[[:space:]]*"([0-9]{4}-[0-9]{2}-[0-9]{2})".*$/\1/p' "$file" | head -n 1)
  if [[ ! "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "could not parse YYYY-MM-DD buildDate from $file" >&2
    exit 1
  fi
  printf '%s\n' "$date"
}

if [[ "$VERSION_INPUT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  BUILD_DATE=$VERSION_INPUT
elif [[ -s "$VERSION_INPUT" ]]; then
  BUILD_DATE=$(read_build_date "$VERSION_INPUT")
else
  echo "not an ISO date and not a readable version.json: $VERSION_INPUT" >&2
  exit 1
fi
tmp_local=$(mktemp)
tmp_manifest=$(mktemp)
trap 'rm -f "$tmp_local" "$tmp_manifest" "$tmp_local.live" "$tmp_local.live.norm" "$tmp_manifest.live"' EXIT

# ---------------------------------------------------------------------------
# Legacy file — unchanged format, rewritten wholesale. Only the desktop key
# that owns it may do so; every other key publishes to the manifest only.
# ---------------------------------------------------------------------------
if [[ "$PLATFORM_KEY" == "$LEGACY_KEY" ]]; then
  ssh $SSH_OPTS r11 "cat '$REMOTE_PATH'" > "$tmp_local.live"
  tr -d '\r' < "$tmp_local.live" > "$tmp_local.live.norm"
  if ! grep -Eq '^echo "[0-9]{4}-[0-9]{2}-[0-9]{2}";$' "$tmp_local.live.norm"; then
    echo "live qmail_client_version.php format is not the expected hardcoded echo; refusing to rewrite" >&2
    cat "$tmp_local.live" >&2
    exit 1
  fi

  cat > "$tmp_local" <<EOF
<?php
// This returns the latest version of qmail client program. It also is the latest version of the rest_core (core that the qmail GUI uses)
// FROZEN FORMAT: clients regex-match this entire response against
// ^\d{4}-\d{2}-\d{2}$. Do not add output here — see qmail_client_versions.php
// for the per-platform manifest.
echo "$BUILD_DATE";

?>
EOF
else
  echo "$PLATFORM_KEY: manifest only, leaving $REMOTE_PATH untouched"
fi

# ---------------------------------------------------------------------------
# Manifest — merge this platform's new date over what is already published,
# so platforms not built by this pipeline keep their existing dates.
# ---------------------------------------------------------------------------
if ssh $SSH_OPTS r11 "cat '$REMOTE_MANIFEST_PATH' 2>/dev/null" > "$tmp_manifest.live" \
   && [[ -s "$tmp_manifest.live" ]]; then
  # A manifest already exists. Keys missing from it have never shipped, so
  # they must stay missing rather than inherit this run's date.
  SEEDING=0
else
  # No manifest yet — seed the full key set so the first published file is
  # complete instead of holding a single platform.
  SEEDING=1
  printf '' > "$tmp_manifest.live"
fi

# Merge in awk rather than python3/jq: every other script in ci/ sticks to
# POSIX tools, and the fleet-deploy runner is not guaranteed to have either.
#
# The manifest is a flat string->string object written by this script, so a
# line-oriented "key": "value" scan is sufficient and total — we never have
# to parse arbitrary JSON, and anything that doesn't match the expected
# shape is ignored rather than trusted.
MANIFEST_JSON=$(
  awk -v new_key="$PLATFORM_KEY" -v new_date="$BUILD_DATE" -v keys="$VALID_KEYS" \
      -v seeding="$SEEDING" '
    # Scan every "key": "value" pair on the line. Pairs may share a line
    # (the served file is pretty-printed, but a hand-edit may not be), so
    # this walks the line pair by pair rather than testing it as a whole.
    #
    # A value that is not an ISO date is refused rather than skipped:
    # skipping is safe in the sense that garbage can never be published,
    # but the key would then be re-seeded to todays build date, silently
    # losing that platforms real release date. A manifest we cannot read in
    # full is a manifest we must not rewrite.
    {
      rest = $0
      while (match(rest, /"[A-Za-z0-9._-]+"[[:space:]]*:[[:space:]]*"[^"]*"/)) {
        pair = substr(rest, RSTART, RLENGTH)
        rest = substr(rest, RSTART + RLENGTH)

        split(pair, halves, /"[[:space:]]*:[[:space:]]*"/)
        key = halves[1]; sub(/^"/, "", key)
        value = halves[2]; sub(/"$/, "", value)

        if (value !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) {
          printf "unreadable entry in live manifest: \"%s\": \"%s\"\n", key, value > "/dev/stderr"
          malformed = 1
          continue
        }
        seen[key] = value
      }
    }
    END {
      if (malformed) exit 1
      n = split(keys, ordered, " ")

      # Seed the full key set ONLY when there is no manifest yet. On a
      # populated manifest, a key that is absent has genuinely never been
      # released, and stamping it with this build date would announce a
      # release that does not exist — the exact bug this file prevents for
      # the platforms it does know about.
      if (seeding)
        for (i = 1; i <= n; i++)
          if (!(ordered[i] in seen)) seen[ordered[i]] = new_date

      # This run only moves its own platform.
      seen[new_key] = new_date

      # Build the whole object before printing any of it: a partial write
      # to stdout would be indistinguishable from success, since $(...)
      # hides the non-zero status from set -e.
      # (No apostrophes in this awk program — it is single-quoted below.)
      out = "{\n"
      count = 0
      for (i = 1; i <= n; i++) {
        key = ordered[i]
        if (!(key in seen)) continue
        if (count++) out = out ",\n"
        out = out sprintf("  \"%s\": \"%s\"", key, seen[key])
      }
      printf "%s\n}\n", out
    }
  ' "$tmp_manifest.live"
)

# Guard the shape rather than mere non-emptiness: a truncated or malformed
# merge must fail the pipeline, not get published.
if [[ "$MANIFEST_JSON" != "{"*"}" ]] || ! grep -q "\"$PLATFORM_KEY\": \"$BUILD_DATE\"" <<< "$MANIFEST_JSON"; then
  echo "failed to build manifest JSON for $PLATFORM_KEY:" >&2
  echo "$MANIFEST_JSON" >&2
  exit 1
fi

# Line 1 of the manifest mirrors the legacy file: "the latest desktop
# client". A core release must not move it, or a first-line-only reader
# would see a core date and think a new GUI shipped. Reuse whatever the
# legacy file already serves unless this run is the one rewriting it.
if [[ "$PLATFORM_KEY" == "$LEGACY_KEY" ]]; then
  HEADER_DATE=$BUILD_DATE
else
  HEADER_DATE=$(
    ssh $SSH_OPTS r11 "cat '$REMOTE_PATH'" 2>/dev/null |
      tr -d '\r' |
      sed -nE 's/^echo "([0-9]{4}-[0-9]{2}-[0-9]{2})";$/\1/p' |
      head -n 1
  ) || true
  if [[ ! "$HEADER_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "could not read the current legacy date for the manifest header" >&2
    exit 1
  fi
fi

cat > "$tmp_manifest" <<EOF
<?php
// Per-platform latest release dates for the QMail client.
//
// Line 1 of the output is a bare ISO date — the latest DESKTOP CLIENT
// release, mirroring qmail_client_version.php — purely for readers that
// only take the first line. The JSON object after it is the real payload:
// one "YYYY-MM-DD" per platform key, and it is what clients actually read.
//
// Bumped by ci/bump_qmail_client_version.sh, one platform per run. The
// "core" key is published independently by the core repo and deliberately
// does not move line 1.
echo "$HEADER_DATE\n";
echo <<<'JSON'
$MANIFEST_JSON
JSON;
echo "\n";

?>
EOF

remote_tmp="/tmp/qmail_client_version.php.${CI_PIPELINE_ID:-manual}.$$"
remote_manifest_tmp="/tmp/qmail_client_versions.php.${CI_PIPELINE_ID:-manual}.$$"
if [[ "$PLATFORM_KEY" == "$LEGACY_KEY" ]]; then
  rsync -e "ssh $SSH_OPTS" -z --partial "$tmp_local" "r11:$remote_tmp"
fi
rsync -e "ssh $SSH_OPTS" -z --partial "$tmp_manifest" "r11:$remote_manifest_tmp"

ssh $SSH_OPTS r11 "bash -s" <<EOF
set -e
REMOTE_PATH='$REMOTE_PATH'
REMOTE_TMP='$remote_tmp'
REMOTE_MANIFEST_PATH='$REMOTE_MANIFEST_PATH'
REMOTE_MANIFEST_TMP='$remote_manifest_tmp'
WRITE_LEGACY='$([[ "$PLATFORM_KEY" == "$LEGACY_KEY" ]] && echo yes || echo no)'
if [ "\$WRITE_LEGACY" = yes ]; then
  sudo cp -p "\$REMOTE_PATH" "\$REMOTE_PATH.previous"
  sudo install -m 0644 "\$REMOTE_TMP" "\$REMOTE_PATH.tmp"
  sudo mv "\$REMOTE_PATH.tmp" "\$REMOTE_PATH"
  rm -f "\$REMOTE_TMP"
fi
if [ -f "\$REMOTE_MANIFEST_PATH" ]; then
  sudo cp -p "\$REMOTE_MANIFEST_PATH" "\$REMOTE_MANIFEST_PATH.previous"
fi
sudo install -m 0644 "\$REMOTE_MANIFEST_TMP" "\$REMOTE_MANIFEST_PATH.tmp"
sudo mv "\$REMOTE_MANIFEST_PATH.tmp" "\$REMOTE_MANIFEST_PATH"
rm -f "\$REMOTE_MANIFEST_TMP"
EOF

# Legacy probe: exact match, and only when this run actually rewrote it. A
# core bump still verifies the file is UNCHANGED, since the manifest header
# was derived from it.
probe=$(curl -fsSL https://raida11.cloudcoin.global/service/qmail_client_version)
if [[ "$PLATFORM_KEY" == "$LEGACY_KEY" ]]; then
  expected_legacy=$BUILD_DATE
else
  expected_legacy=$HEADER_DATE
fi
if [[ "$probe" != "$expected_legacy" ]]; then
  echo "probe mismatch after bump: expected $expected_legacy, got $probe" >&2
  exit 1
fi

# The legacy probe above is an exact-match check; the manifest needs its own
# because a served-but-malformed manifest would silently push every client
# onto the fallback path without failing the pipeline.
manifest_probe=$(curl -fsSL https://raida11.cloudcoin.global/service/qmail_client_versions)
probed_date=$(
  printf '%s\n' "$manifest_probe" |
    sed -nE "s/.*\"${PLATFORM_KEY}\"[[:space:]]*:[[:space:]]*\"([0-9]{4}-[0-9]{2}-[0-9]{2})\".*/\1/p" |
    head -n 1
)
if [[ "$probed_date" != "$BUILD_DATE" ]]; then
  echo "manifest probe mismatch after bump: expected $BUILD_DATE for $PLATFORM_KEY, got $probed_date" >&2
  echo "$manifest_probe" >&2
  exit 1
fi

echo "qmail_client_version bumped to $BUILD_DATE ($PLATFORM_KEY)"
