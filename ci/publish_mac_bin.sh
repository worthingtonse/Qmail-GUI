#!/usr/bin/env bash
# =============================================================================
# ci-gui/publish_mac_bin.sh — publish the QMail macOS .dmg to /bin/ on r11.
# Mirrors ci/publish_gui_bin.sh (win+linux) but for the single mac artifact.
#
#   qmail-mac-YYYY-MM-DD.dmg   (dated, from version.json buildDate)
#   qmail-mac-latest.dmg       (stable name)
#   archive/YYYY-MM-DD/        (dated snapshot)
#   SHA256SUMS                 (regenerated over top-level files)
#
# NOTE: leaves qmail_client_version untouched (GUI version probe stays owned by
# the win/linux publish path; mac is additive per plan S6).
# =============================================================================
set -euo pipefail

DMG=${1:?usage: publish_mac_bin.sh <QMail.dmg> <version.json>}
VERSION_JSON=${2:?usage: publish_mac_bin.sh <QMail.dmg> <version.json>}

BIN_DIR=/var/www/cloudcoinconsortium.com/bin
SSH_OPTS="-o BatchMode=yes"

[[ -s "$DMG" && -s "$VERSION_JSON" ]] || { echo "missing publish input" >&2; exit 1; }

BUILD_DATE=$(sed -nE 's/^.*"buildDate"[[:space:]]*:[[:space:]]*"([0-9]{4}-[0-9]{2}-[0-9]{2})".*$/\1/p' "$VERSION_JSON" | head -n1)
[[ "$BUILD_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "bad buildDate in $VERSION_JSON" >&2; exit 1; }

DATED="qmail-mac-${BUILD_DATE}.dmg"
LATEST="qmail-mac-latest.dmg"
REMOTE_DIR="/tmp/qmail-mac-${CI_PIPELINE_ID:-manual}-$$"

echo "Publishing $DMG as $DATED (buildDate=$BUILD_DATE) to r11:$BIN_DIR"
ssh $SSH_OPTS r11 "mkdir -p '$REMOTE_DIR'"
rsync -e "ssh $SSH_OPTS" -z --partial --timeout=120 "$DMG" "r11:$REMOTE_DIR/$DATED"

ssh $SSH_OPTS r11 "bash -s" <<EOF
set -e
BIN_DIR='$BIN_DIR'; DATE='$BUILD_DATE'; REMOTE_DIR='$REMOTE_DIR'
DATED='$DATED'; LATEST='$LATEST'
sudo install -m 0644 "\$REMOTE_DIR/\$DATED" "\$BIN_DIR/\$DATED"
sudo cp "\$REMOTE_DIR/\$DATED" "\$BIN_DIR/.\$LATEST.tmp"
sudo chmod 0644 "\$BIN_DIR/.\$LATEST.tmp"
sudo mv "\$BIN_DIR/.\$LATEST.tmp" "\$BIN_DIR/\$LATEST"
sudo mkdir -p "\$BIN_DIR/archive/\$DATE"
sudo cp -p "\$BIN_DIR/\$DATED" "\$BIN_DIR/archive/\$DATE/"
cd "\$BIN_DIR"
ls -1 | grep -v '^archive\$' | grep -v '^SHA256SUMS\$' | xargs sha256sum | sudo tee SHA256SUMS >/dev/null
rm -rf "\$REMOTE_DIR"
echo "published: \$DATED + \$LATEST + archive/\$DATE/ + SHA256SUMS"
EOF
