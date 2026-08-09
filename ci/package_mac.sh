#!/usr/bin/env bash
# =============================================================================
# ci-gui/package_mac.sh — package the QMail Electron GUI as a universal macOS
# .dmg on the Apple-Silicon runner. Mirrors ci/package_windows.ps1.
#
# Intended to live at ccv3/gui: ci/package_mac.sh, invoked by the `package-mac`
# GitLab job (tag macos-build).
#
# Flow (matches package_windows.ps1):
#   1. download core-mac-latest from bin/, verify against SHA256SUMS
#   2. stamp CI version (ci/stamp_ci_version.cjs)
#   3. vite build
#   4. electron-builder --mac --universal  (produces mac-universal/QMail.app)
#   5. sign: Developer ID if a signing identity is present, else ad-hoc
#   6. build the .dmg with hdiutil (electron-builder's bundled dmg tool errors
#      E_INVALIDARG on recent macOS; hdiutil is reliable)
#   7. emit ci-build/version-mac.json + sha256 sidecars
#
# Signing env (optional; absent => ad-hoc, Gatekeeper-blocked off-machine):
#   MAC_SIGN_IDENTITY   e.g. "Developer ID Application: Sean Worthington (9M3DA6YP8B)"
#   (notarization gets its own env — notarytool + ASC key / app pw — when wired)
# =============================================================================
set -euo pipefail

BASE_URL="${QMAIL_BIN_BASE_URL:-https://cloudcoinconsortium.com/bin}"
CORE_NAME="core-mac-latest"
APP_NAME="QMail.app"
ENTITLEMENTS="build/entitlements.mac.plist"

rm -rf backend release ci-build
mkdir -p backend ci-build

# --- 1) fetch + verify the published universal core -------------------------
echo "[package_mac] downloading $CORE_NAME"
curl -fsSL "$BASE_URL/SHA256SUMS"    -o ci-build/SHA256SUMS
curl -fsSL "$BASE_URL/$CORE_NAME"    -o backend/core
expected="$(awk -v n="$CORE_NAME" '$2==n{print $1; f=1} END{exit f?0:1}' ci-build/SHA256SUMS)" \
  || { echo "SHA256SUMS has no $CORE_NAME" >&2; exit 1; }
actual="$(shasum -a 256 backend/core | awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo "checksum mismatch for $CORE_NAME (exp $expected got $actual)" >&2; exit 1; }
chmod 0755 backend/core
printf '%s  backend/core\n' "$actual" > ci-build/mac-core.sha256
echo "[package_mac] verified $CORE_NAME ($actual); arches: $(lipo -archs backend/core)"

# --- 2) version stamp + 3) vite build ---------------------------------------
node ci/stamp_ci_version.cjs
npx vite build

# --- 4) electron-builder (universal .app; we build the dmg ourselves) -------
CSC_IDENTITY_AUTO_DISCOVERY=false \
  npx electron-builder --config electron-builder.config.cjs --mac --universal --dir --publish=never
APP="release/mac-universal/$APP_NAME"
[[ -d "$APP" ]] || { echo "$APP not produced" >&2; exit 1; }
echo "[package_mac] app arches: $(lipo -archs "$APP/Contents/MacOS/QMail")"

# --- 5) sign ----------------------------------------------------------------
if [[ -n "${MAC_SIGN_IDENTITY:-}" ]]; then
  echo "[package_mac] signing with Developer ID: $MAC_SIGN_IDENTITY"
  codesign --force --deep --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$MAC_SIGN_IDENTITY" \
    "$APP/Contents/Resources/backend/core"
  codesign --force --deep --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$MAC_SIGN_IDENTITY" "$APP"
else
  echo "[package_mac] no MAC_SIGN_IDENTITY -> ad-hoc signing"
  codesign --force --sign - "$APP/Contents/Resources/backend/core"
  codesign --force --deep --sign - --options runtime \
    --entitlements "$ENTITLEMENTS" "$APP"
fi
codesign --verify --deep --strict "$APP"

# --- 6) dmg via hdiutil -----------------------------------------------------
STAGE_ROOT="$(mktemp -d)"
trap 'rm -rf "$STAGE_ROOT"' EXIT
STAGE="$STAGE_ROOT/QMail"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "QMail" -srcfolder "$STAGE" -ov -format ULFO release/QMail.dmg

# --- 7) sidecars ------------------------------------------------------------
dmg_sha="$(shasum -a 256 release/QMail.dmg | awk '{print $1}')"
printf '%s  release/QMail.dmg\n' "$dmg_sha" > ci-build/qmail-mac.sha256
cp version.json ci-build/version-mac.json
echo "[package_mac] OK -> release/QMail.dmg ($(du -h release/QMail.dmg | cut -f1), sha $dmg_sha)"
