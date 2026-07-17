#!/usr/bin/env bash
# Publish QMail desktop artifacts to /bin/ on r11 after both platform
# package jobs have succeeded. This mirrors core's publish_bin.sh layout but
# handles the Windows and Linux GUI pair atomically in one job.
set -euo pipefail

WIN=${1:?usage: publish_gui_bin.sh <QMail.exe> <QMail.AppImage> <version.json>}
LINUX=${2:?usage: publish_gui_bin.sh <QMail.exe> <QMail.AppImage> <version.json>}
VERSION_JSON=${3:?usage: publish_gui_bin.sh <QMail.exe> <QMail.AppImage> <version.json>}

BIN_DIR=/var/www/cloudcoinconsortium.com/bin
SSH_OPTS="-o BatchMode=yes"

if [[ ! -s "$WIN" || ! -s "$LINUX" || ! -s "$VERSION_JSON" ]]; then
  echo "missing publish input artifact" >&2
  exit 1
fi

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

BUILD_DATE=$(read_build_date "$VERSION_JSON")

WIN_DATED="qmail-windows-${BUILD_DATE}.exe"
WIN_LATEST="qmail-windows-latest.exe"
LINUX_DATED="qmail-linux-desktop-${BUILD_DATE}.AppImage"
LINUX_LATEST="qmail-linux-desktop-latest.AppImage"
REMOTE_DIR="/tmp/qmail-gui-${CI_PIPELINE_ID:-manual}-$$"

echo "Publishing QMail desktop artifacts for buildDate=$BUILD_DATE"
ssh $SSH_OPTS r11 "mkdir -p '$REMOTE_DIR'"
rsync -e "ssh $SSH_OPTS" -z --partial --timeout=60 "$WIN" "r11:$REMOTE_DIR/$WIN_DATED"
rsync -e "ssh $SSH_OPTS" -z --partial --timeout=60 "$LINUX" "r11:$REMOTE_DIR/$LINUX_DATED"

ssh $SSH_OPTS r11 "bash -s" <<EOF
set -e
BIN_DIR='$BIN_DIR'
DATE='$BUILD_DATE'
REMOTE_DIR='$REMOTE_DIR'
WIN_DATED='$WIN_DATED'
WIN_LATEST='$WIN_LATEST'
LINUX_DATED='$LINUX_DATED'
LINUX_LATEST='$LINUX_LATEST'

sudo install -m 0755 "\$REMOTE_DIR/\$WIN_DATED" "\$BIN_DIR/\$WIN_DATED"
sudo install -m 0755 "\$REMOTE_DIR/\$LINUX_DATED" "\$BIN_DIR/\$LINUX_DATED"
sudo cp "\$REMOTE_DIR/\$WIN_DATED" "\$BIN_DIR/.\$WIN_LATEST.tmp"
sudo cp "\$REMOTE_DIR/\$LINUX_DATED" "\$BIN_DIR/.\$LINUX_LATEST.tmp"
sudo chmod 0755 "\$BIN_DIR/.\$WIN_LATEST.tmp" "\$BIN_DIR/.\$LINUX_LATEST.tmp"
sudo mv "\$BIN_DIR/.\$WIN_LATEST.tmp" "\$BIN_DIR/\$WIN_LATEST"
sudo mv "\$BIN_DIR/.\$LINUX_LATEST.tmp" "\$BIN_DIR/\$LINUX_LATEST"
sudo mkdir -p "\$BIN_DIR/archive/\$DATE"
sudo cp -p "\$BIN_DIR/\$WIN_DATED" "\$BIN_DIR/archive/\$DATE/"
sudo cp -p "\$BIN_DIR/\$LINUX_DATED" "\$BIN_DIR/archive/\$DATE/"
cd "\$BIN_DIR"
ls -1 | grep -v '^archive\$' | grep -v '^SHA256SUMS\$' | xargs sha256sum | sudo tee SHA256SUMS >/dev/null
rm -rf "\$REMOTE_DIR"
echo "published: \$WIN_DATED + \$WIN_LATEST + \$LINUX_DATED + \$LINUX_LATEST + archive/\$DATE/ + SHA256SUMS"
EOF
