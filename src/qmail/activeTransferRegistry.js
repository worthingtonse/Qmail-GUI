export const ACTIVE_TRANSFER_STORAGE_KEY =
  "qmail.activeObjectTransfers.v1";

const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/i;
const MAX_ACTIVE_TRANSFERS = 100;

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

const cleanUnsignedDecimal = (value) => {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : null;
};

const cleanTimestamp = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : fallback;
};

const sanitizeEntry = (entry, previous = null) => {
  const operationId = cleanText(
    entry?.operationId ?? entry?.operation_id,
    32,
  )?.toLowerCase();
  if (!operationId || !OPERATION_ID_PATTERN.test(operationId)) return null;

  const now = Date.now();
  const directionText = cleanText(entry?.direction, 16)?.toLowerCase();
  const direction =
    directionText === "download" || directionText === "delete"
      ? directionText
      : previous?.direction || "upload";

  return {
    operationId,
    direction,
    taskId:
      cleanText(entry?.taskId ?? entry?.task_id, 128) ||
      previous?.taskId ||
      null,
    label:
      cleanText(entry?.label, 256) ||
      previous?.label ||
      (direction === "download" ? "Attachment download" : "Email upload"),
    emailId:
      cleanText(entry?.emailId ?? entry?.email_id, 128) ||
      previous?.emailId ||
      null,
    attachmentId:
      cleanText(
        entry?.attachmentId ?? entry?.attachment_id,
        128,
      ) ||
      previous?.attachmentId ||
      null,
    attachmentName:
      cleanText(
        entry?.attachmentName ?? entry?.attachment_name,
        256,
      ) ||
      previous?.attachmentName ||
      null,
    totalBytes:
      cleanUnsignedDecimal(entry?.totalBytes ?? entry?.total_bytes) ||
      previous?.totalBytes ||
      "0",
    completedBytes:
      cleanUnsignedDecimal(
        entry?.completedBytes ?? entry?.completed_bytes,
      ) ||
      previous?.completedBytes ||
      "0",
    state:
      cleanText(entry?.state, 32)?.toLowerCase() ||
      previous?.state ||
      "queued",
    error:
      entry?.error !== undefined
        ? cleanText(entry.error, 512)
        : previous?.error || null,
    destinationPath:
      cleanText(
        entry?.destinationPath ?? entry?.destination_path,
        1024,
      ) ||
      previous?.destinationPath ||
      null,
    createdAt: cleanTimestamp(
      entry?.createdAt ?? entry?.created_at,
      previous?.createdAt || now,
    ),
    updatedAt: now,
  };
};

export const readActiveTransferRegistry = (
  storage = getDefaultStorage(),
) => {
  if (!storage) return [];

  try {
    const parsed = JSON.parse(
      storage.getItem(ACTIVE_TRANSFER_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(parsed)) return [];

    const deduplicated = new Map();
    parsed.forEach((entry) => {
      const sanitized = sanitizeEntry(entry);
      if (sanitized) deduplicated.set(sanitized.operationId, sanitized);
    });
    return [...deduplicated.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(-MAX_ACTIVE_TRANSFERS);
  } catch {
    return [];
  }
};

const writeRegistry = (entries, storage) => {
  if (!storage) return false;
  try {
    storage.setItem(
      ACTIVE_TRANSFER_STORAGE_KEY,
      JSON.stringify(entries.slice(-MAX_ACTIVE_TRANSFERS)),
    );
    return true;
  } catch {
    return false;
  }
};

export const rememberActiveTransfer = (
  entry,
  storage = getDefaultStorage(),
) => {
  if (!storage) return null;

  const entries = readActiveTransferRegistry(storage);
  const previous = entries.find(
    (candidate) =>
      candidate.operationId ===
      String(
        entry?.operationId ?? entry?.operation_id ?? "",
      ).toLowerCase(),
  );
  const sanitized = sanitizeEntry(entry, previous);
  if (!sanitized) return null;

  const nextEntries = entries.filter(
    (candidate) => candidate.operationId !== sanitized.operationId,
  );
  nextEntries.push(sanitized);
  writeRegistry(nextEntries, storage);
  return sanitized;
};

export const forgetActiveTransfer = (
  operationId,
  storage = getDefaultStorage(),
) => {
  if (!storage) return false;
  const normalized = String(operationId || "").trim().toLowerCase();
  if (!OPERATION_ID_PATTERN.test(normalized)) return false;

  const entries = readActiveTransferRegistry(storage);
  const nextEntries = entries.filter(
    (entry) => entry.operationId !== normalized,
  );
  return nextEntries.length !== entries.length &&
    writeRegistry(nextEntries, storage);
};

export const clearActiveTransferRegistry = (
  storage = getDefaultStorage(),
) => {
  if (!storage) return false;
  try {
    storage.removeItem(ACTIVE_TRANSFER_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
