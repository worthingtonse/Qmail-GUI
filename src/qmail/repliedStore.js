/**
 * repliedStore.js — local record of which messages the user has replied to.
 *
 * The backend does not track reply relationships, so the dashboard records
 * one locally whenever a reply/reply-all compose is actually sent. The map
 * lives in localStorage (cleared on sign-out along with the rest of the
 * QMail keys) and is capped so it cannot grow without bound.
 *
 * Keys are message ids lowercased; values are ISO timestamps of the reply.
 */

const STORAGE_KEY = "qmail.repliedMap";
const MAX_ENTRIES = 500;

// Write-through in-memory cache: the dashboard reads this on every render,
// so avoid hitting localStorage + JSON.parse each time.
let cache = null;

function readMap() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist(map) {
  cache = map;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* Storage full/unavailable — the in-memory record still works
     * for this session. */
  }
}

const normalizeId = (messageId) => String(messageId ?? "").trim().toLowerCase();

export function getRepliedAt(messageId) {
  const key = normalizeId(messageId);
  if (!key) return null;
  return readMap()[key] || null;
}

export function markReplied(messageId, when = new Date().toISOString()) {
  const key = normalizeId(messageId);
  if (!key) return;
  const map = { ...readMap(), [key]: when };

  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) {
    // Drop the oldest entries (ISO strings sort chronologically).
    keys
      .sort((a, b) => String(map[a]).localeCompare(String(map[b])))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((old) => delete map[old]);
  }
  persist(map);
}
