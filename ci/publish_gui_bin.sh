#!/usr/bin/env bash
# =============================================================================
# Publish ONE QMail desktop artifact to /bin/ on r11.
#
#   publish_gui_bin.sh <windows|linux> <artifact> <version.json>
#
# Writes the dated release name and the stable *-latest name, archives a dated
# snapshot, and regenerates SHA256SUMS. It deliberately does NOT touch the
# canonical QMail.* download names — that is promote_canonical.sh, run as a
# separate step so the two concerns stay separable.
#
# WAS: this took <exe> <appimage> <version.json> and published Windows and
# Linux together in one atomic call, because releases always shipped as a pair.
# Releases are now driven per-platform from the Run-pipeline screen, so the
# pairing moved up into .gitlab-ci.yml (assert-build-dates still guards
# BUILD_PLATFORM=all) and this script handles exactly one platform.
# =============================================================================
set -euo pipefail

PLATFORM=${1:?usage: publish_gui_bin.sh <windows|linux> <artifact> <version.json>}
ARTIFACT=${2:?usage: publish_gui_bin.sh <windows|linux> <artifact> <version.json>}
VERSION_JSON=${3:?usage: publish_gui_bin.sh <windows|linux> <artifact> <version.json>}

BIN_DIR=/var/www/cloudcoinconsortium.com/bin
SSH_OPTS="-o BatchMode=yes"

if [[ ! -s "$ARTIFACT" || ! -s "$VERSION_JSON" ]]; then
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

case "$PLATFORM" in
  windows)
    DATED="qmail-windows-${BUILD_DATE}.exe"
    LATEST="qmail-windows-latest.exe"
    ;;
  linux)
    DATED="qmail-linux-desktop-${BUILD_DATE}.AppImage"
    LATEST="qmail-linux-desktop-latest.AppImage"
    ;;
  *)
    echo "unsupported platform: $PLATFORM (use publish_mac_bin.sh for mac)" >&2
    exit 2
    ;;
esac

REMOTE_DIR="/tmp/qmail-gui-${CI_PIPELINE_ID:-manual}-$$"

echo "Publishing $PLATFORM artifact for buildDate=$BUILD_DATE"
ssh $SSH_OPTS r11 "mkdir -p '$REMOTE_DIR'"
rsync -e "ssh $SSH_OPTS" -z --partial --timeout=60 "$ARTIFACT" "r11:$REMOTE_DIR/$DATED"

ssh $SSH_OPTS r11 "bash -s" <<EOF
set -e
BIN_DIR='$BIN_DIR'
DATE='$BUILD_DATE'
REMOTE_DIR='$REMOTE_DIR'
DATED='$DATED'
LATEST='$LATEST'

sudo install -m 0755 "\$REMOTE_DIR/\$DATED" "\$BIN_DIR/\$DATED"
sudo cp "\$REMOTE_DIR/\$DATED" "\$BIN_DIR/.\$LATEST.tmp"
sudo chmod 0755 "\$BIN_DIR/.\$LATEST.tmp"
sudo mv "\$BIN_DIR/.\$LATEST.tmp" "\$BIN_DIR/\$LATEST"
sudo mkdir -p "\$BIN_DIR/archive/\$DATE"
sudo cp -p "\$BIN_DIR/\$DATED" "\$BIN_DIR/archive/\$DATE/"
cd "\$BIN_DIR"
ls -1 | grep -v '^archive\$' | grep -v '^SHA256SUMS\$' | xargs sha256sum | sudo tee SHA256SUMS >/dev/null
rm -rf "\$REMOTE_DIR"
echo "published: \$DATED + \$LATEST + archive/\$DATE/ + SHA256SUMS"
EOF
