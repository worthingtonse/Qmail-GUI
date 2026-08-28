#!/usr/bin/env bash
set -euo pipefail

export APPIMAGE_EXTRACT_AND_RUN=1
export ELECTRON_CACHE=${ELECTRON_CACHE:-$PWD/.cache/electron}
export ELECTRON_BUILDER_CACHE=${ELECTRON_BUILDER_CACHE:-$PWD/.cache/electron-builder}

bash ci/download_published_core.sh linux
node ci/stamp_ci_version.cjs
npx vite build
npx electron-builder --config electron-builder.config.cjs --linux AppImage deb tar.gz --x64 --publish=never

test -s release/QMail.AppImage
mkdir -p ci-build
sha256sum release/QMail.AppImage > ci-build/qmail-linux-desktop.sha256
cp version.json ci-build/version-linux.json
echo "packaged release/QMail.AppImage"
