const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
const BYTE_BASE = 1024n;

export const normalizeByteCount = (value) => {
  if (typeof value === "bigint") return value >= 0n ? value : 0n;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0n;
    return BigInt(Math.trunc(value));
  }

  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? BigInt(text) : 0n;
};

export const calculateBytePercentage = (completedBytes, totalBytes) => {
  const completed = normalizeByteCount(completedBytes);
  const total = normalizeByteCount(totalBytes);
  if (total === 0n) return 0;
  if (completed >= total) return 100;

  return Number((completed * 1000n) / total) / 10;
};

export const formatByteCount = (value) => {
  const bytes = normalizeByteCount(value);
  let unitIndex = 0;
  let divisor = 1n;

  while (
    unitIndex < BYTE_UNITS.length - 1 &&
    bytes >= divisor * BYTE_BASE
  ) {
    divisor *= BYTE_BASE;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${bytes.toLocaleString()} B`;
  }

  const tenths = (bytes * 10n) / divisor;
  const whole = tenths / 10n;
  const fraction = tenths % 10n;
  const numberText =
    fraction === 0n ? whole.toString() : `${whole}.${fraction}`;
  return `${numberText} ${BYTE_UNITS[unitIndex]}`;
};

export const formatProgressPercentage = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  const clamped = Math.min(100, Math.max(0, numeric));
  return Number.isInteger(clamped) ? String(clamped) : clamped.toFixed(1);
};

export const formatByteProgress = ({
  completedBytes,
  totalBytes,
  percentage,
}) => {
  const resolvedPercentage = Number.isFinite(Number(percentage))
    ? Number(percentage)
    : calculateBytePercentage(completedBytes, totalBytes);

  return `${formatByteCount(completedBytes)} / ${formatByteCount(totalBytes)} (${formatProgressPercentage(resolvedPercentage)}%)`;
};

const readTransferByteField = (source, snakeName, camelName) =>
  source?.[snakeName] ?? source?.[camelName] ?? null;

const OPERATION_ID_PATTERN = /^[0-9a-f]{32}$/i;

export const extractTransferOperationIds = (source) => {
  const found = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 4) return;
    if (typeof value === "string") {
      const candidate = value.trim();
      if (OPERATION_ID_PATTERN.test(candidate)) {
        found.add(candidate.toLowerCase());
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof value !== "object") return;

    visit(value.operation_id, depth + 1);
    visit(value.operationId, depth + 1);
    visit(value.operation_ids, depth + 1);
    visit(value.operationIds, depth + 1);
    visit(value.transfers, depth + 1);
    visit(value.operations, depth + 1);
    visit(value.result, depth + 1);
    visit(value.data, depth + 1);
  };

  visit(source);
  return [...found];
};

export const extractTransferState = (source) => {
  const candidates = [
    source?.transferState,
    source?.transfer_state,
    source?.result?.state,
    source?.result?.transfer_state,
    source?.data?.state,
  ];
  const state = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  return state ? state.trim().toLowerCase() : "";
};

export const deriveUploadByteProgress = (
  taskStatus,
  knownTotalBytes,
) => {
  const result = taskStatus?.result;
  const exactCompleted = readTransferByteField(
    result,
    "completed_bytes",
    "completedBytes",
  );
  const exactTotal = readTransferByteField(
    result,
    "total_bytes",
    "totalBytes",
  );

  if (exactCompleted !== null && normalizeByteCount(exactTotal) > 0n) {
    const completed = normalizeByteCount(exactCompleted);
    const total = normalizeByteCount(exactTotal);
    return {
      completedBytes: (completed > total ? total : completed).toString(),
      totalBytes: total.toString(),
      percentage: calculateBytePercentage(completed, total),
      estimated: false,
    };
  }

  const total = normalizeByteCount(knownTotalBytes);
  if (total === 0n) return null;

  const taskPercentage = Math.min(
    100,
    Math.max(0, Number(taskStatus?.progress) || 0),
  );
  const successful =
    taskStatus?.isSuccessful === true ||
    taskStatus?.state === "completed" ||
    taskStatus?.state === "success";
  const uploadPercentage = successful || taskPercentage >= 90
    ? 100
    : Math.min(100, Math.max(0, ((taskPercentage - 5) / 85) * 100));
  const tenths = BigInt(Math.round(uploadPercentage * 10));
  const completed = (total * tenths) / 1000n;

  return {
    completedBytes: completed.toString(),
    totalBytes: total.toString(),
    percentage: Math.round(uploadPercentage * 10) / 10,
    estimated: true,
  };
};
