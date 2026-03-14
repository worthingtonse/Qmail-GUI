/**
 * Formats a Unix timestamp (seconds) into a human-readable string.
 * - Today: "2:30 PM"
 * - This week: "Thu 2:30 PM"
 * - This year: "Mar 12 2:30 PM"
 * - Older: "Mar 12, 2024"
 */
export function formatTimestamp(ts) {
  if (!ts) return "";

  // If it's a string that's already formatted (not a number), return as-is
  if (typeof ts === "string" && isNaN(Number(ts))) return ts;

  const num = Number(ts);
  if (isNaN(num) || num <= 0) return String(ts);

  // Unix timestamps in seconds are < 10 billion; in ms they're > 1 trillion
  const ms = num < 1e12 ? num * 1000 : num;
  const date = new Date(ms);
  if (isNaN(date.getTime())) return String(ts);

  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / 86400000);

  const timeStr = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Today
  if (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  ) {
    return timeStr;
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  // This week (within 7 days)
  if (diffDays < 7 && diffDays >= 0) {
    return `${dayNames[date.getDay()]} ${timeStr}`;
  }

  // This year
  if (date.getFullYear() === now.getFullYear()) {
    return `${monthNames[date.getMonth()]} ${date.getDate()} ${timeStr}`;
  }

  // Older
  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
