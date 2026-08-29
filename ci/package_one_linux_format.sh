#!/usr/bin/env bash
# =============================================================================
# Build ONE linux format and publish it, without a round trip through GitLab.
#
#   package_one_linux_format.sh <deb|tar.gz>
#
# WHY THIS EXISTS: package-linux builds all three linux formats in one
# electron-builder run, but only the AppImage can be uploaded as an artifact --
# all three together exceed the instance limit ("413 Request Entity Too Large").
# The AppImage therefore keeps the normal package -> publish split across two
# runners, and deb/tar.gz are built and published in a single job on the
# linux-build runner instead. Same reasoning as publish-mac, which publishes the
# 180MB dmg straight from the mac rather than shipping it through GitLab.
#
# Each format is independent: this script builds exactly one target, so a deb
# failure cannot stop a tar.gz release or vice versa.
# =============================================================================
set -euo pipefail

FORMAT=${1:?usage: package_one_linux_format.sh <deb|tar.gz>}
case "$FORMAT" in
  deb)    ARTIFACT=release/QMail.deb;    KEY=linux-deb;    HASH=ci-build/qmail-linux-deb.sha256 ;;
  tar.gz) ARTIFACT=release/QMail.tar.gz; KEY=linux-tar-gz; HASH=ci-build/qmail-linux-tar-gz.sha256 ;;
  *) echo "unsupported format: $FORMAT (use deb|tar.gz)" >&2; exit 2 ;;
esac

# BUILD inside the same container package-linux uses -- the linux-build runner
# has no node/electron toolchain of its own. PUBLISH afterwards on the HOST:
# the container has no ssh keys for r11, so it could not publish even if asked.
IMAGE=${ELECTRON_BUILDER_IMAGE:-electronuserland/builder:18-wine-mono-05.26}
mkdir -p .npm .cache/electron .cache/electron-builder

uid=$(id -u)
gid=$(id -g)
cleanup() {
  docker run --rm -v "$PWD:/project" -w /project "$IMAGE"     bash -lc "chown -R $uid:$gid .npm .cache node_modules backend release ci-build dist package.json version.json 2>/dev/null || true" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm   -e CI=true   -e CI_PIPELINE_IID="${CI_PIPELINE_IID:?}"   -e QMAIL_BIN_BASE_URL="${QMAIL_BIN_BASE_URL:-}"   -e npm_config_cache=/project/.npm   -e ELECTRON_CACHE=/project/.cache/electron   -e ELECTRON_BUILDER_CACHE=/project/.cache/electron-builder   -e APPIMAGE_EXTRACT_AND_RUN=1   -e FORMAT="$FORMAT"   -v "$PWD:/project"   -w /project   "$IMAGE"   bash -lc 'npm ci && bash ci/download_published_core.sh linux && node ci/stamp_ci_version.cjs && npx vite build && npx electron-builder --config electron-builder.config.cjs --linux "$FORMAT" --x64 --publish=never'

test -s "$ARTIFACT"
mkdir -p ci-build
sha256sum "$ARTIFACT" > "$HASH"
cp version.json ci-build/version-linux.json
echo "packaged $ARTIFACT"

if [[ "${PUBLISH:-no}" != "yes" ]]; then
  echo "PUBLISH=$PUBLISH — built only, nothing published"
  exit 0
fi

bash ci/publish_gui_bin.sh linux "$ARTIFACT" ci-build/version-linux.json "$FORMAT"
bash ci/promote_canonical.sh linux ci-build/version-linux.json "$FORMAT"
bash ci/bump_qmail_client_version.sh ci-build/version-linux.json "$KEY"
echo "published $ARTIFACT as $KEY"
