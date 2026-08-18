import { BUILD_DATE, formatBuildDateForDisplay } from "../../version.js";

// Segments are joined by a tilde rather than labelled ("Version:",
// "Folder:"), so the caption stays readable when Windows truncates it —
// the values themselves say what they are.
export const TITLE_SEPARATOR = " ~ ";

// TLD names (bit, byte, kilo, mega, giga) always display lowercase.
const lowercaseWord = (value) => String(value || "").trim().toLowerCase();

export const formatTitleQmailAddress = (address) => {
  const text = String(address || "").trim();
  if (!text) return "";

  const atIndex = text.lastIndexOf("@");
  if (atIndex === -1) return text;

  const localPart = text.slice(0, atIndex);
  const denomination = text.slice(atIndex + 1);
  return `${localPart}@${lowercaseWord(denomination)}`;
};

// "port:3784" — a bare number is not self-describing the way a date or
// path is, so this segment keeps the label the user asked to see.
export const formatTitlePort = (port) => {
  const text = String(port ?? "").trim();
  if (!/^\d+$/.test(text)) return "";
  const n = Number(text);
  if (n < 1 || n > 65535) return "";
  return `port:${n}`;
};

// "QMail ~ August 9, 2026 ~ port:3784 ~ C:/Users/User/ ~ 23.25@giga"
//
// The build number is deliberately absent: the date is what the update
// check compares against, so it is the only version a user can act on.
// formatVersionForDisplay still carries the number for --version and the
// About dialog.
//
// The listen port sits before the folder path so a long path does not
// push it off the right edge of a truncated Windows caption.
//
// Segments that have no value yet — the address is unavailable until the
// identity loads — are dropped rather than shown empty, so the title never
// renders a dangling separator.
export const buildWindowTitle = ({
  qmailAddress,
  buildDate = BUILD_DATE,
  appDir = "",
  port = "",
} = {}) =>
  [
    "QMail",
    formatBuildDateForDisplay(buildDate),
    formatTitlePort(port),
    String(appDir || "").trim(),
    formatTitleQmailAddress(qmailAddress),
  ]
    .filter(Boolean)
    .join(TITLE_SEPARATOR);
