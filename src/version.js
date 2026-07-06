// ===========================================================================
//  QMAIL CLIENT BUILD DATE  —  EDIT THIS ONE LINE ON EVERY RELEASE
// ===========================================================================
//
//  This is the build date of THIS client. It is compared against the remote
//  version files (https://raida<N>.cloudcoin.global/service/qmail_client_version,
//  majority vote across the mirrors in qmailApiServices.REMOTE_VERSION_URLS)
//  to decide whether an update is available.
//
//  FORMAT: "YYYY-MM-DD"  (zero-padded; e.g. "2026-06-23")
//  Both this value and the remote file use this exact format, which compares
//  correctly with plain string ordering — no date parsing needed.
//
//  >>> BUMP THIS DATE, SAVE, THEN REBUILD. Nothing else to change. <<<
//
// ===========================================================================

export const BUILD_DATE = "2026-07-04";

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
