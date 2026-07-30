/**
 * Persist an in-flight support-log send across remounts so we do not start a
 * second upload while a core task may still be running (connectivity loss,
 * sign-out, dashboard remount).
 */

export const SUPPORT_SEND_STORAGE_KEY_PREFIX = "qmail.supportSend.pending.v1";

const getDefaultStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
};

const cleanText = (value, maxLength = 512) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
};

/**
 * @returns {{ taskId: string, zipPath?: string, filename?: string, startedAt: number } | null}
 */
export function readPendingSupportSend(
  storageKey,
  storage = getDefaultStorage(),
) {
  const key = cleanText(storageKey, 256);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const taskId = cleanText(parsed?.taskId ?? parsed?.task_id, 128);
    if (!taskId) return null;
    return {
      taskId,
      zipPath: cleanText(parsed?.zipPath ?? parsed?.zip_path, 1024) || null,
      filename: cleanText(parsed?.filename, 256) || null,
      startedAt:
        Number.isFinite(Number(parsed?.startedAt)) && Number(parsed.startedAt) > 0
          ? Math.trunc(Number(parsed.startedAt))
          : Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ taskId: string, zipPath?: string, filename?: string }} entry
 */
export function rememberPendingSupportSend(
  entry,
  storageKey,
  storage = getDefaultStorage(),
) {
  const key = cleanText(storageKey, 256);
  if (!key || !storage) return false;
  const taskId = cleanText(entry?.taskId, 128);
  if (!taskId) return false;
  try {
    storage.setItem(
      key,
      JSON.stringify({
        taskId,
        zipPath: cleanText(entry?.zipPath, 1024),
        filename: cleanText(entry?.filename, 256),
        startedAt: Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function forgetPendingSupportSend(
  storageKey,
  storage = getDefaultStorage(),
) {
  const key = cleanText(storageKey, 256);
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}
