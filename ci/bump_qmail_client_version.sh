#!/usr/bin/env bash
set -euo pipefail

VERSION_JSON=${1:?usage: bump_qmail_client_version.sh <version.json>}
SSH_OPTS="-o BatchMode=yes"
REMOTE_PATH=/opt/raida/service/qmail_client_version.php

if [[ ! -s "$VERSION_JSON" ]]; then
  echo "missing version metadata: $VERSION_JSON" >&2
  exit 1
fi

BUILD_DATE=$(node -e "const v=require('./$VERSION_JSON'); if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(v.buildDate)){process.exit(2)} process.stdout.write(v.buildDate)")
tmp_local=$(mktemp)
trap 'rm -f "$tmp_local" "$tmp_local.live"' EXIT

ssh $SSH_OPTS r11 "cat '$REMOTE_PATH'" > "$tmp_local.live"
if ! grep -Eq '^echo "[0-9]{4}-[0-9]{2}-[0-9]{2}";$' "$tmp_local.live"; then
  echo "live qmail_client_version.php format is not the expected hardcoded echo; refusing to rewrite" >&2
  cat "$tmp_local.live" >&2
  exit 1
fi

cat > "$tmp_local" <<EOF
<?php
// This returns the latest version of qmail client program. It also is the latest version of the rest_core (core that the qmail GUI uses)
echo "$BUILD_DATE";

?>
EOF

remote_tmp="/tmp/qmail_client_version.php.${CI_PIPELINE_ID:-manual}.$$"
rsync -e "ssh $SSH_OPTS" -z --partial "$tmp_local" "r11:$remote_tmp"

ssh $SSH_OPTS r11 "bash -s" <<EOF
set -e
REMOTE_PATH='$REMOTE_PATH'
REMOTE_TMP='$remote_tmp'
sudo cp -p "\$REMOTE_PATH" "\$REMOTE_PATH.previous"
sudo install -m 0644 "\$REMOTE_TMP" "\$REMOTE_PATH.tmp"
sudo mv "\$REMOTE_PATH.tmp" "\$REMOTE_PATH"
rm -f "\$REMOTE_TMP"
EOF

probe=$(curl -fsSL https://raida11.cloudcoin.global/service/qmail_client_version)
if [[ "$probe" != "$BUILD_DATE" ]]; then
  echo "probe mismatch after bump: expected $BUILD_DATE, got $probe" >&2
  exit 1
fi

echo "qmail_client_version bumped to $BUILD_DATE"
