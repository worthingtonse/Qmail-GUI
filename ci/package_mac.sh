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
#   MAC_KEYCHAIN        file keychain holding that identity; pinned into the
#                       search list and into CSC_KEYCHAIN when set
#   MAC_KEYCHAIN_PW     unlock password for MAC_KEYCHAIN (masked CI variable)
#
# Notarization env (optional; absent => signed but NOT notarized, and
# publish_mac_bin.sh will then refuse to publish):
#   MAC_NOTARY_KEY_P8   App Store Connect .p8 — a FILE-type CI variable, so
#                       this is a PATH. Preferred: no keychain, so it works
#                       while the Mac is locked.
#   MAC_NOTARY_KEY_ID   the key id
#   MAC_NOTARY_ISSUER   the issuer uuid
#   MAC_NOTARY_PROFILE  fallback stored profile name (default qmail-notary);
#                       only works while the GUI session is unlocked
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
#
# WHO SIGNS THE APP: electron-builder, not us — but only when a Developer ID
# is available. An Electron .app contains nested helper apps and dylibs
# (libEGL, libGLESv2, libvk_swiftshader, the Helper (GPU|Renderer|Plugin)
# bundles) which must each be signed inside-out, in order. `codesign --deep`
# does NOT do that correctly: it produces an app that passes a local
# --verify but comes back from Apple as Invalid. electron-builder knows the
# right order, so when signing for real we let it drive and only sign the
# bundled core ourselves first (it is an extraResource, not part of the app
# bundle electron-builder walks).
if [[ -n "${MAC_SIGN_IDENTITY:-}" ]]; then
  echo "[package_mac] Developer ID signing: $MAC_SIGN_IDENTITY"

  # The Developer ID lives in a FILE keychain. codesign only finds it if
  # that keychain is in the user search list, and a malformed search list
  # makes find-identity come up empty with no useful error — reproduced on
  # the runner in MAC-18. Pin the list when we know which keychain to use.
  if [[ -n "${MAC_KEYCHAIN:-}" ]]; then
    echo "[package_mac] pinning keychain search list: $MAC_KEYCHAIN"
    security list-keychains -d user -s "$MAC_KEYCHAIN" \
      "$HOME/Library/Keychains/login.keychain-db"
    # Unlock only if a password was provided; the keychain may already be
    # unlocked, and an empty -p would fail the job for no reason.
    if [[ -n "${MAC_KEYCHAIN_PW:-}" ]]; then
      security unlock-keychain -p "$MAC_KEYCHAIN_PW" "$MAC_KEYCHAIN"
    fi
    # Pin it for electron-builder too, so it signs from the same keychain.
    export CSC_KEYCHAIN="$MAC_KEYCHAIN"
  fi

  # The core is a bare Mach-O we ship as a resource. Sign it BEFORE
  # electron-builder runs so it is already valid when the app is sealed.
  # codesign --sign wants the FULL identity string.
  codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$MAC_SIGN_IDENTITY" backend/core

  # electron-builder wants the name WITHOUT the "Developer ID Application:"
  # prefix and rejects it outright ("Please remove prefix ... — appropriate
  # certificate will be chosen automatically"), so the same identity has to
  # be spelled two ways in one script. Strip the prefix if present; a value
  # that was already bare passes through untouched.
  CSC_NAME_VALUE="${MAC_SIGN_IDENTITY#Developer ID Application: }"
  CSC_IDENTITY_AUTO_DISCOVERY=true CSC_NAME="$CSC_NAME_VALUE" \
    npx electron-builder --config electron-builder.config.cjs \
      --mac --universal --dir --publish=never
else
  echo "[package_mac] no MAC_SIGN_IDENTITY -> ad-hoc signing (NOT notarizable)"
  CSC_IDENTITY_AUTO_DISCOVERY=false \
    npx electron-builder --config electron-builder.config.cjs \
      --mac --universal --dir --publish=never
fi

APP="release/mac-universal/$APP_NAME"
[[ -d "$APP" ]] || { echo "$APP not produced" >&2; exit 1; }
echo "[package_mac] app arches: $(lipo -archs "$APP/Contents/MacOS/QMail")"

# --- 5) sign (ad-hoc fallback only) -----------------------------------------
# With a real identity electron-builder already signed everything above.
# Without one, ad-hoc sign so the app at least runs on the build machine.
if [[ -z "${MAC_SIGN_IDENTITY:-}" ]]; then
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

# --- 6b) sign, notarize and staple the dmg ----------------------------------
#
# Without this a downloaded dmg is Gatekeeper-blocked on every Mac but the
# one that built it, which is indistinguishable from "the app is broken" to
# a user. Notarization is what makes the public download openable.
#
# HOW THE CREDENTIALS ARE SUPPLIED — two ways, API key preferred.
#
# 1. App Store Connect API key (MAC_NOTARY_KEY_P8 / _KEY_ID / _ISSUER).
#    MAC_NOTARY_KEY_P8 is a GitLab FILE variable, so CI drops the .p8 on
#    disk and hands us the path. Nothing is read from any keychain, so this
#    keeps working while the Mac is locked or logged out.
#
# 2. A stored notarytool keychain profile (MAC_NOTARY_PROFILE, default
#    qmail-notary) — the fallback.
#
# WHY THE KEY IS PREFERRED: the profile created by a plain
# `notarytool store-credentials` lands in the DATA-PROTECTION keychain,
# which unlocks and locks with the GUI login session — not with
# `security unlock-keychain`, which only reaches file keychains. The runner
# is a LaunchAgent in the Aqua session, so notarization succeeded while
# someone was logged in and failed the moment the screen locked (#1531
# notarized, #1533 nine minutes later did not, same code, same machine).
# App signing was unaffected because the Developer ID lives in a FILE
# keychain — which is why a build could sign perfectly and still fail to
# notarize. Diagnosed on the machine in MAC-18.
#
# Skipped, loudly, when no credential is available — an unsigned build is
# still useful for smoke-testing a packaging change, and failing the job
# would make a config gap look like a code break. publish_mac_bin.sh is
# what refuses to publish a non-notarized dmg; see the check there.
NOTARY_PROFILE="${MAC_NOTARY_PROFILE:-qmail-notary}"

# Resolve which credential we have, newest-first. notary_args is passed
# unquoted below, so no value may contain whitespace — paths and ids here
# are CI-generated and do not.
notary_args=""
notary_kind=""
if [[ -n "${MAC_NOTARY_KEY_P8:-}" && -n "${MAC_NOTARY_KEY_ID:-}" && -n "${MAC_NOTARY_ISSUER:-}" ]]; then
  if [[ -s "$MAC_NOTARY_KEY_P8" ]]; then
    notary_args="--key $MAC_NOTARY_KEY_P8 --key-id $MAC_NOTARY_KEY_ID --issuer $MAC_NOTARY_ISSUER"
    notary_kind="App Store Connect API key ($MAC_NOTARY_KEY_ID)"
  else
    echo "[package_mac] WARNING: MAC_NOTARY_KEY_P8 is set but empty/missing: $MAC_NOTARY_KEY_P8" >&2
    echo "[package_mac] WARNING: it must be a FILE-type CI variable, not a plain one." >&2
  fi
fi
if [[ -z "$notary_args" ]] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  notary_args="--keychain-profile $NOTARY_PROFILE"
  notary_kind="keychain profile '$NOTARY_PROFILE' (locks with the GUI session)"
fi

if [[ -z "${MAC_SIGN_IDENTITY:-}" ]]; then
  echo "[package_mac] WARNING: ad-hoc signed, skipping notarization."
  echo "[package_mac] WARNING: this dmg is Gatekeeper-blocked off this machine."
elif [[ -z "$notary_args" ]]; then
  echo "[package_mac] WARNING: no usable notarization credential." >&2
  echo "[package_mac] WARNING: dmg is signed but NOT notarized." >&2
  echo "[package_mac] set MAC_NOTARY_KEY_P8 (file) + MAC_NOTARY_KEY_ID + MAC_NOTARY_ISSUER," >&2
  echo "[package_mac] or store a profile: xcrun notarytool store-credentials $NOTARY_PROFILE" >&2
else
  echo "[package_mac] notarizing via $notary_kind"
  # The dmg is a container and is signed separately from the app inside it.
  echo "[package_mac] signing dmg"
  codesign --force --timestamp --sign "$MAC_SIGN_IDENTITY" release/QMail.dmg

  echo "[package_mac] submitting to Apple for notarization (this can take minutes)"
  # --wait blocks until Apple returns a verdict; without it the staple below
  # races the submission and fails.
  # shellcheck disable=SC2086  # notary_args is deliberately word-split
  xcrun notarytool submit release/QMail.dmg $notary_args --wait

  # Staple the ticket into the dmg so Gatekeeper accepts it offline. This is
  # the step whose absence only shows up on a machine with no network.
  xcrun stapler staple release/QMail.dmg
  xcrun stapler validate release/QMail.dmg

  # Final proof, and the one line worth reading in the job log: this must say
  # "source=Notarized Developer ID".
  spctl -a -vv -t install release/QMail.dmg 2>&1 | sed 's/^/[package_mac] spctl: /'
  echo "[package_mac] notarized + stapled OK"
fi

# --- 7) sidecars ------------------------------------------------------------
dmg_sha="$(shasum -a 256 release/QMail.dmg | awk '{print $1}')"
printf '%s  release/QMail.dmg\n' "$dmg_sha" > ci-build/qmail-mac.sha256
cp version.json ci-build/version-mac.json
echo "[package_mac] OK -> release/QMail.dmg ($(du -h release/QMail.dmg | cut -f1), sha $dmg_sha)"
