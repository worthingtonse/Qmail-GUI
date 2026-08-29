#!/usr/bin/env bash
# =============================================================================
# promote_canonical.sh — refresh ONE canonical download name on r11 from the
# artifact this pipeline just published.
#
#   windows -> QMail.exe        linux -> QMail.AppImage        mac -> QMail.dmg
#
# WHY THIS EXISTS: publish_gui_bin.sh / publish_mac_bin.sh write only the dated
# and *-latest names. The canonical QMail.* names are what the public download
# pages link to (cloudcoinconsortium.com/use.php, distributedmailsystem.com).
# Until now those were refreshed by hand via the server-side promote-all.sh,
# which is why QMail.exe could sit days behind qmail-windows-latest.exe.
#
# DELIBERATELY per-platform: a Windows-only publish must not refresh the mac or
# linux downloads, which were not rebuilt by this pipeline run. (The server-side
# promote-all.sh does all three at once; that remains available for manual use.)
#
# Uses `install` (NOT cp -p) so the promoted file gets a fresh mtime and the
# nginx autoindex shows the true release date.
#
# Idempotent: if the canonical file already matches, it is left alone and
# SHA256SUMS is not rewritten.
# =============================================================================
set -euo pipefail

PLATFORM=${1:?usage: promote_canonical.sh <windows|linux|mac> <version.json> [format]}
VERSION_JSON=${2:?usage: promote_canonical.sh <windows|linux|mac> <version.json> [format]}
# Linux only: which of the three formats to promote. Defaults to AppImage so
# existing callers keep their behaviour.
FORMAT=${3:-AppImage}

BIN_DIR=/var/www/cloudcoinconsortium.com/bin
SSH_OPTS="-o BatchMode=yes"

[[ -s "$VERSION_JSON" ]] || { echo "missing version metadata: $VERSION_JSON" >&2; exit 1; }

BUILD_DATE=$(sed -nE 's/^.*"buildDate"[[:space:]]*:[[:space:]]*"([0-9]{4}-[0-9]{2}-[0-9]{2})".*$/\1/p' "$VERSION_JSON" | head -n1)
[[ "$BUILD_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || {
  echo "could not parse YYYY-MM-DD buildDate from $VERSION_JSON" >&2
  exit 1
}

case "$PLATFORM" in
  windows) DATED="qmail-windows-${BUILD_DATE}.exe";            CANON="QMail.exe";       MODE=0755 ;;
  linux)
    case "$FORMAT" in
      # The AppImage and the tarball are run directly, so they stay 0755. The
      # .deb is fed to dpkg/apt and is never executed in place: 0644.
      AppImage) EXT="AppImage"; MODE=0755 ;;
      deb)      EXT="deb";      MODE=0644 ;;
      tar.gz)   EXT="tar.gz";   MODE=0644 ;;
      *) echo "unsupported linux format: $FORMAT (use AppImage|deb|tar.gz)" >&2; exit 2 ;;
    esac
    DATED="qmail-linux-desktop-${BUILD_DATE}.${EXT}"; CANON="QMail.${EXT}"
    ;;
  mac)     DATED="qmail-mac-${BUILD_DATE}.dmg";                CANON="QMail.dmg";       MODE=0644 ;;
  *)       echo "unsupported platform: $PLATFORM" >&2; exit 2 ;;
esac

echo "Promoting $DATED -> $CANON on r11:$BIN_DIR"

ssh $SSH_OPTS r11 "bash -s" <<EOF
set -euo pipefail
BIN_DIR='$BIN_DIR'; DATED='$DATED'; CANON='$CANON'; MODE='$MODE'
cd "\$BIN_DIR"

if [[ ! -f "\$DATED" ]]; then
  echo "source artifact not on server: \$DATED" >&2
  exit 1
fi

if [[ -f "\$CANON" ]] && cmp -s "\$DATED" "\$CANON"; then
  echo "\$CANON already current (= \$DATED); SHA256SUMS untouched"
  exit 0
fi

# keep one rollback copy of what the public was being served
if [[ -f "\$CANON" ]]; then
  sudo cp -p "\$CANON" "\$CANON.old"
fi

sudo install -m "\$MODE" "\$DATED" "\$CANON"
# Exclude *.sh — bin/ is public; a helper script left there should not be
# served or listed as a release artifact. See publish_mac_bin.sh.
ls -1 | grep -v '^archive\$' | grep -v '^SHA256SUMS\$' | grep -v '\.sh\$' | xargs sha256sum | sudo tee SHA256SUMS >/dev/null
echo "promoted: \$CANON <- \$DATED (previous kept as \$CANON.old); SHA256SUMS regenerated"
EOF
