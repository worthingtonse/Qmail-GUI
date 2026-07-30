/**
 * Pure helpers for Help → Send Logs To Support.
 * Kept free of React/fetch so unit tests can cover orchestration rules.
 */

/**
 * True if path looks like an absolute filesystem path ending in .zip
 * (Windows drive or UNC, or POSIX absolute).
 */
export function isAbsoluteZipPath(filePath) {
  if (typeof filePath !== "string") return false;
  const p = filePath.trim();
  if (!p) return false;
  const lower = p.toLowerCase();
  if (!lower.endsWith(".zip")) return false;
  // Windows: C:\... or \\server\share\...
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\")) return true;
  // POSIX absolute
  if (p.startsWith("/")) return true;
  return false;
}

/**
 * Normalize /api/tools/support-zip JSON into a success/error result.
 * Requires explicit success (status === "success" or success === true).
 */
export function normalizeSupportZipResponse(data) {
  if (!data || typeof data !== "object") {
    return { success: false, error: "Invalid support-zip response." };
  }

  if (data.status === "error" || data.success === false) {
    return {
      success: false,
      error:
        (typeof data.message === "string" && data.message.trim()) ||
        "Failed to create support ZIP",
    };
  }

  const explicitlySuccessful =
    data.status === "success" || data.success === true;
  if (!explicitlySuccessful) {
    return {
      success: false,
      error:
        (typeof data.message === "string" && data.message.trim()) ||
        "Support-zip response did not report success.",
    };
  }

  const fullPath =
    (typeof data.full_path === "string" && data.full_path.trim()) ||
    (typeof data.zip_path === "string" && data.zip_path.trim()) ||
    "";
  const filename =
    (typeof data.filename === "string" && data.filename.trim()) ||
    fullPath.replace(/^.*[/\\]/, "") ||
    "";
  const filesAdded = Number(data.files_added);
  const filesSkipped = Number(data.files_skipped);
  const walletsOffline = Number(data.wallets_offline);

  if (!isAbsoluteZipPath(fullPath)) {
    return {
      success: false,
      error: "Support ZIP path missing, not absolute, or not a .zip file.",
    };
  }

  if (!Number.isFinite(filesAdded) || filesAdded <= 0) {
    return {
      success: false,
      error: "Support ZIP contained no files.",
    };
  }

  return {
    success: true,
    data: {
      fullPath,
      filename: filename.toLowerCase().endsWith(".zip")
        ? filename
        : `${filename}.zip`,
      location: typeof data.location === "string" ? data.location : "",
      filesAdded,
      filesSkipped: Number.isFinite(filesSkipped) ? filesSkipped : 0,
      walletsOffline: Number.isFinite(walletsOffline) ? walletsOffline : 0,
      message:
        (typeof data.message === "string" && data.message) ||
        "Support ZIP created successfully",
    },
  };
}

/**
 * Parse a non-negative integer delivery field. Returns null if missing/invalid.
 */
function readNonNegativeIntField(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Interpret a finished upload_and_tell task payload.
 *
 * Full delivery requires ALL of:
 *   isFinished, isSuccessful, all_accepted === true,
 *   tell_failures === 0, tell_retries_queued === 0
 *
 * Missing delivery fields → indeterminate (do not claim success; keep archive).
 *
 * @param {object|null} taskData - shape from getTaskStatus().data
 * @returns {{ outcome: 'full'|'partial'|'failed'|'indeterminate', message: string, result: object }}
 */
export function interpretSupportSendTaskResult(taskData) {
  if (!taskData) {
    return {
      outcome: "failed",
      message: "Send to support failed.",
      result: {},
    };
  }

  if (taskData.isFinished !== true) {
    return {
      outcome: "indeterminate",
      message:
        "Support send status is not finished yet. Wait or retry status later; " +
        "do not start another send.",
      result: taskData.result || {},
    };
  }

  if (taskData.isSuccessful !== true) {
    return {
      outcome: "failed",
      message:
        taskData.error ||
        taskData.message ||
        "Send to support failed.",
      result: taskData.result || {},
    };
  }

  const result =
    taskData.result && typeof taskData.result === "object"
      ? taskData.result
      : null;

  if (!result) {
    return {
      outcome: "indeterminate",
      message:
        "Support send finished but delivery fields are missing. " +
        "The archive remains under Client_Data/Zipped Logs.",
      result: {},
    };
  }

  const allAccepted = result.all_accepted;
  const tellFailures = readNonNegativeIntField(result.tell_failures);
  const retriesQueued = readNonNegativeIntField(result.tell_retries_queued);

  // Fail closed: every delivery field must be present and well-typed.
  if (
    allAccepted === undefined ||
    allAccepted === null ||
    tellFailures === null ||
    retriesQueued === null
  ) {
    return {
      outcome: "indeterminate",
      message:
        "Support send finished but delivery confirmation is incomplete " +
        "(missing all_accepted / tell_failures / tell_retries_queued). " +
        "The archive remains under Client_Data/Zipped Logs.",
      result,
    };
  }

  const accepted =
    allAccepted === true ||
    allAccepted === 1 ||
    allAccepted === "true" ||
    allAccepted === "1";

  if (accepted && tellFailures === 0 && retriesQueued === 0) {
    return {
      outcome: "full",
      message: "Support package sent. Thank you.",
      result,
    };
  }

  // Explicit incomplete delivery
  const parts = [];
  if (tellFailures > 0) parts.push(`${tellFailures} tell failure(s)`);
  if (retriesQueued > 0) parts.push(`${retriesQueued} retry(ies) queued`);
  if (!accepted) parts.push("not all recipients accepted");

  return {
    outcome: "partial",
    message:
      `Support package uploaded, but delivery is incomplete` +
      (parts.length ? ` (${parts.join(", ")})` : "") +
      `. Retries may continue in the background. The archive remains under Client_Data/Zipped Logs.`,
    result,
  };
}

/**
 * Build body text for support mail — filename only, no local absolute paths.
 */
export function buildSupportMessageBody({
  filename,
  buildDate,
  buildNumber,
  sentAt = new Date().toISOString(),
} = {}) {
  const lines = ["Automatic QMail support package."];
  if (buildDate != null || buildNumber != null) {
    lines.push(`Client build: ${buildDate || "?"} #${buildNumber ?? "?"}`);
  }
  if (filename) lines.push(`Attachment: ${filename}`);
  lines.push(`Sent at: ${sentAt}`);
  return lines.join("\n");
}

/**
 * Decide whether a progress update should raise a new notification.
 * Only when phase text changes or progress advances by at least `step` percent.
 */
export function shouldNotifySupportProgress(
  previous,
  next,
  { step = 10 } = {},
) {
  if (!next) return false;
  const prevMsg = (previous?.message || "").trim();
  const nextMsg = (next.message || "").trim();
  const prevPct =
    typeof previous?.progress === "number"
      ? Math.floor(previous.progress / step)
      : null;
  const nextPct =
    typeof next.progress === "number"
      ? Math.floor(next.progress / step)
      : null;

  if (previous == null) return true;
  if (nextMsg && nextMsg !== prevMsg) return true;
  if (nextPct != null && nextPct !== prevPct) return true;
  if (next.softTimeout && !previous.softTimeout) return true;
  if (next.connectivityLost && !previous.connectivityLost) return true;
  return false;
}

/**
 * Format a progress toast line.
 */
export function formatSupportProgressNotification(task) {
  if (!task) return "Sending support package…";
  if (task.connectivityLost) {
    return (
      "Lost contact with the backend while sending. Still waiting for " +
      "task status — do not start another send."
    );
  }
  if (task.softTimeout) {
    return "Still sending support package in the background…";
  }
  const msg = (task.message || "Sending support package…").trim();
  const pct =
    typeof task.progress === "number" ? Math.round(task.progress) : null;
  if (pct != null && pct >= 0) return `${msg} (${pct}%)`;
  return msg;
}
