#!/usr/bin/env bash
set -euo pipefail

IMAGE=${ELECTRON_BUILDER_IMAGE:-electronuserland/builder:18-wine-mono-05.26}

mkdir -p .npm .cache/electron .cache/electron-builder

uid=$(id -u)
gid=$(id -g)
cleanup() {
  docker run --rm \
    -v "$PWD:/project" \
    -w /project \
    "$IMAGE" \
    bash -lc "chown -R $uid:$gid .npm .cache node_modules backend release ci-build dist package.json version.json 2>/dev/null || true" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm \
  -e CI=true \
  -e CI_PIPELINE_IID="${CI_PIPELINE_IID:?}" \
  -e QMAIL_BIN_BASE_URL="${QMAIL_BIN_BASE_URL:-}" \
  -e npm_config_cache=/project/.npm \
  -e ELECTRON_CACHE=/project/.cache/electron \
  -e ELECTRON_BUILDER_CACHE=/project/.cache/electron-builder \
  -e APPIMAGE_EXTRACT_AND_RUN=1 \
  -v "$PWD:/project" \
  -w /project \
  "$IMAGE" \
  bash -lc 'npm ci && bash ci/package_linux.sh'
