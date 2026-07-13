/**
 * Shared helpers for DRD profile editor screens.
 */

/** Defaults for an unregistered DRD directory user (post payload shape). */
export const EMPTY_PROFILE = {
  fee: "0",
  firstSymbol: null,
  secondSymbol: null,
  classRejection: 0,
  firstName: "",
  lastName: "",
  description: "",
};

/**
 * Map a getDrdUserProfile `user` record into the postDrdUserProfile payload
 * shape. Missing fields fall back to EMPTY_PROFILE defaults.
 */
export function profileUserToForm(user) {
  if (!user || typeof user !== "object") {
    return { ...EMPTY_PROFILE };
  }

  const feeRaw = user.inboxFee ?? user.fee ?? EMPTY_PROFILE.fee;
  return {
    fee: feeRaw === null || feeRaw === undefined ? EMPTY_PROFILE.fee : String(feeRaw),
    firstSymbol: normalizeSymbol(user.firstSymbol),
    secondSymbol: normalizeSymbol(user.secondSymbol),
    classRejection:
      user.classRejection === null || user.classRejection === undefined
        ? EMPTY_PROFILE.classRejection
        : Number(user.classRejection) || 0,
    firstName: typeof user.firstName === "string" ? user.firstName : "",
    lastName: typeof user.lastName === "string" ? user.lastName : "",
    description: typeof user.description === "string" ? user.description : "",
  };
}

function normalizeSymbol(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  return n;
}

/** UTF-8 byte length of a string (for name field caps). */
export function utf8ByteLength(value) {
  if (typeof value !== "string" || value.length === 0) return 0;
  return new TextEncoder().encode(value).length;
}

/**
 * Pull a "Saved to N of 25 RAIDA servers" style message from a post response.
 * postDrdUserProfile returns fan-out counts as `passCount` (camelCase, see
 * mapDrdFanout in qmailApiServices). `quorum` is a BOOLEAN there — never a
 * count — so it must not be coerced into N. Falls back to a plain "Saved."
 */
export function formatProfileSaveMessage(result, raidaCount = 25) {
  const data = result?.data;
  if (!data || typeof data !== "object") {
    return "Saved.";
  }

  const candidates = [data.passCount, data.pass_count];

  for (const candidate of candidates) {
    if (typeof candidate === "boolean") continue;
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 0) {
      return `Saved to ${Math.round(n)} of ${raidaCount} RAIDA servers`;
    }
  }

  if (typeof data.message === "string" && data.message.trim()) {
    return data.message.trim();
  }

  return "Saved.";
}

/** Stable den:sn key used for localStorage disabled-list entries. */
export function denSnKey(denomination, serialNumber) {
  return `${Number(denomination)}:${Number(serialNumber)}`;
}

export function readJsonArray(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeJsonArray(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Quota / private mode — ignore; in-session state still works.
  }
}

export function randomSymbolIndex() {
  return Math.floor(Math.random() * 256);
}
