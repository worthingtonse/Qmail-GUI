const TERMINAL_TRANSFER_STATES = new Set([
  "cancelled",
  "completed",
  "failed",
  "error",
  "timeout",
  "aborted",
]);

const RETRYABLE_PROTOCOL_STATUSES = new Set([225, 252, 253]);

const PROTOCOL_ERROR_PROFILES = {
  169: {
    code: "payment_required",
    title: "Payment required",
    message:
      "The server requires a funded payment for this object transfer.",
    canRetry: false,
  },
  218: {
    code: "tcp_required",
    title: "TCP connection required",
    message:
      "This server requires TCP for object transfers. Check the QMail network configuration and retry.",
  },
  219: {
    code: "unsupported_protocol",
    title: "Transfer protocol not supported",
    message:
      "The client and server do not support the same object-transfer version. Update QMail or use another server.",
  },
  220: {
    code: "capacity",
    title: "Attachment exceeds server limit",
    message:
      "This attachment is larger than the server allows. Remove it, split it, or use a server with a higher limit.",
    canRetry: false,
  },
  221: {
    code: "range_too_large",
    title: "Transfer range rejected",
    message:
      "The server rejected the requested transfer range. Start the transfer again with the server's advertised limits.",
  },
  222: {
    code: "transfer_not_found",
    title: "Transfer no longer exists",
    message:
      "The server cannot find this transfer. Start a new transfer.",
  },
  223: {
    code: "transfer_expired",
    title: "Transfer expired",
    message:
      "The server expired this transfer before it completed. Start a new transfer.",
  },
  224: {
    code: "range_conflict",
    title: "Transfer data conflict",
    message:
      "The server received conflicting data for the same byte range. Start the transfer again.",
  },
  225: {
    code: "transfer_incomplete",
    title: "Transfer incomplete",
    message:
      "Some transfer ranges are still missing. Resume the transfer to send or receive the remaining bytes.",
    canRetry: true,
  },
  226: {
    code: "hash_mismatch",
    title: "Transfer integrity check failed",
    message:
      "The transferred data did not match its expected hash. Start the transfer again.",
  },
  227: {
    code: "capacity",
    title: "Server capacity limit reached",
    message:
      "The server cannot reserve enough capacity for this transfer. Reduce the attachment size or use another server.",
  },
  228: {
    code: "object_not_committed",
    title: "Object is not available",
    message:
      "The object was not committed by the server. Ask the sender to upload it again.",
  },
  229: {
    code: "invalid_range",
    title: "Invalid transfer range",
    message:
      "The server rejected an invalid byte range. Start the transfer again.",
  },
  230: {
    code: "storage_full",
    title: "Server storage is full",
    message:
      "The server does not have enough free storage for this transfer. Retry later or use another server.",
  },
  231: {
    code: "object_state",
    title: "Object state changed",
    message:
      "The object is no longer in the state required for this operation. Refresh and start the transfer again.",
  },
  232: {
    code: "not_object_owner",
    title: "Object ownership rejected",
    message:
      "The server rejected this operation because the current identity does not own the object.",
    canRetry: false,
  },
  233: {
    code: "generation_conflict",
    title: "Message version changed",
    message:
      "The object changed on the server while this transfer was running. Refresh the message and start the transfer again.",
  },
  234: {
    code: "transfer_conflict",
    title: "Transfer request conflict",
    message:
      "This transfer ID is already associated with different transfer details. Start a new transfer.",
  },
  235: {
    code: "retention_unavailable",
    title: "Requested retention is unavailable",
    message:
      "The server cannot provide the requested storage duration. Choose another duration or server.",
  },
  252: {
    code: "server_error",
    title: "Server transfer error",
    message:
      "The server encountered a temporary transfer error. Resume the transfer.",
    canRetry: true,
  },
  253: {
    code: "network_error",
    title: "Transfer connection interrupted",
    message:
      "The network connection was interrupted. Resume the transfer when connectivity is restored.",
    canRetry: true,
  },
  254: {
    code: "server_memory",
    title: "Server resources unavailable",
    message:
      "The server could not allocate resources for this transfer. Retry later or use another server.",
  },
};

const asObject = (value) =>
  value && typeof value === "object" ? value : null;

const collectSources = (source) => {
  const sources = [];
  const queue = [source];
  const visited = new Set();

  while (queue.length > 0 && sources.length < 16) {
    const value = queue.shift();
    const object = asObject(value);
    if (!object || visited.has(object)) continue;
    visited.add(object);
    sources.push(object);
    queue.push(
      object.apiData,
      object.data,
      object.payload,
      object.result,
      object.transferError,
    );
  }

  return sources;
};

const firstText = (sources, names) => {
  for (const source of sources) {
    for (const name of names) {
      const value = source?.[name];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return "";
};

const firstNumber = (sources, names) => {
  for (const source of sources) {
    for (const name of names) {
      const value = Number(source?.[name]);
      if (Number.isInteger(value) && value >= 0) return value;
    }
  }
  return null;
};

const inferStatusFromText = (text) => {
  const explicitStatus = text.match(
    /\bstatus(?:\s+code)?\s*[:#]?\s*(\d{3})\b/i,
  );
  if (explicitStatus) return Number(explicitStatus[1]);

  if (/object.{0,24}(too large|size limit)|exceeds.{0,24}object limit/i.test(text)) {
    return 220;
  }
  if (/quota exceeded|capacity (?:limit|exceeded)|cannot reserve/i.test(text)) {
    return 227;
  }
  if (/storage (?:is )?full|disk (?:is )?full|no space left/i.test(text)) {
    return 230;
  }
  if (/generation conflict|version changed|source file changed/i.test(text)) {
    return 233;
  }
  if (/hash mismatch|integrity (?:check )?failed/i.test(text)) {
    return 226;
  }
  if (/transfer (?:was )?not found|transfer no longer exists/i.test(text)) {
    return 222;
  }
  if (/transfer expired/i.test(text)) return 223;

  return null;
};

const normalizeState = (sources) =>
  firstText(sources, ["state", "transfer_state", "transferState"])
    .toLowerCase();

const cleanDetail = (detail, profile) => {
  if (!detail) return null;
  if (
    detail.toLowerCase() === profile?.title?.toLowerCase() ||
    detail.toLowerCase() === profile?.message?.toLowerCase()
  ) {
    return null;
  }
  return detail;
};

export const normalizeTransferError = (
  source,
  {
    fallbackMessage = "The object transfer failed.",
    terminal = false,
    defaultCanRetry = true,
  } = {},
) => {
  if (source?.code && source?.title && source?.message) {
    return source;
  }

  const sources = collectSources(source);
  if (source instanceof Error && !sources.includes(source)) {
    sources.unshift(source);
  }

  const state = normalizeState(sources);
  const detail =
    firstText(sources, [
      "error",
      "error_message",
      "errorMessage",
      "message",
      "detail",
      "details",
    ]) || (source instanceof Error ? source.message : "");
  const statusCode =
    firstNumber(sources, [
      "last_status",
      "lastStatus",
      "status_code",
      "statusCode",
      "protocol_status",
      "protocolStatus",
    ]) ?? inferStatusFromText(detail);
  const resultCode = firstNumber(sources, [
    "last_result",
    "lastResult",
    "result_code",
    "resultCode",
  ]);
  const profile = statusCode ? PROTOCOL_ERROR_PROFILES[statusCode] : null;
  const isPaused = state === "paused";
  const isCancelled = state === "cancelled" || state === "cancelling";
  const isTerminal =
    terminal || TERMINAL_TRANSFER_STATES.has(state) || Boolean(profile);

  if (!profile && !isPaused && !isCancelled && !isTerminal) {
    return null;
  }

  if (profile) {
    const retryable = RETRYABLE_PROTOCOL_STATUSES.has(statusCode);
    return {
      code: profile.code,
      title: profile.title,
      message: profile.message,
      detail: cleanDetail(detail, profile),
      protocolStatus: statusCode,
      resultCode,
      state,
      terminal: !retryable,
      retryable,
      canResume: retryable,
      canRetry: profile.canRetry ?? true,
    };
  }

  if (isCancelled) {
    return {
      code: "cancelled",
      title: "Transfer cancelled",
      message: detail || "The object transfer was cancelled.",
      detail: null,
      protocolStatus: statusCode,
      resultCode,
      state,
      terminal: true,
      retryable: false,
      canResume: false,
      canRetry: true,
    };
  }

  if (isPaused) {
    return {
      code: "paused",
      title: "Transfer paused",
      message:
        detail ||
        "The object transfer is paused. Resume it when the connection is available.",
      detail: null,
      protocolStatus: statusCode,
      resultCode,
      state,
      terminal: false,
      retryable: true,
      canResume: true,
      canRetry: true,
    };
  }

  return {
    code: "terminal_transfer_error",
    title: "Transfer failed",
    message: detail || fallbackMessage,
    detail: null,
    protocolStatus: statusCode,
    resultCode,
    state,
    terminal: true,
    retryable: false,
    canResume: false,
    canRetry: defaultCanRetry,
  };
};

export const formatTransferErrorNotification = (transferError, fallback) => {
  if (!transferError) return fallback || "The object transfer failed.";
  return `${transferError.title}: ${transferError.message}`;
};
