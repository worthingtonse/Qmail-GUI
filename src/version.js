// ===========================================================================
//  QMAIL CLIENT VERSION  —  DO NOT EDIT VALUES HERE
// ===========================================================================
//
//  The version lives in /version.json (repo root) and is stamped
//  automatically by scripts/stamp-version.cjs on every build (the npm
//  "prebuild" hook): buildDate is set to the day of the build and
//  buildNumber is incremented. electron.cjs requires the same file, so
//  the renderer and main process can never drift.
//
//  BUILD_DATE is compared against the remote version files
//  (https://raida<N>.cloudcoin.global/service/qmail_client_versions,
//  majority vote across the mirrors in
//  qmailApiServices.REMOTE_VERSION_MANIFEST_URLS) to decide whether an
//  update is available. That manifest publishes one date per platform, so
//  the comparison uses only this build's own platform key — see
//  src/platform.js. Mirrors that don't serve the manifest yet fall back to
//  the legacy single-date qmail_client_version endpoint.
//
//  FORMAT: "YYYY-MM-DD" (zero-padded). Both this value and the remote file
//  use this exact format, which compares correctly with plain string
//  ordering — no date parsing needed. BUILD_NUMBER is display-only.
//
// ===========================================================================

import versionInfo from "../version.json";

export const BUILD_DATE = versionInfo.buildDate;
export const BUILD_NUMBER = versionInfo.buildNumber;

export const formatBuildDateForDisplay = (value = BUILD_DATE) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return String(value || "");

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

export const formatVersionForDisplay = (
  buildDate = BUILD_DATE,
  buildNumber = BUILD_NUMBER,
) => `${formatBuildDateForDisplay(buildDate)} (build ${buildNumber})`;
