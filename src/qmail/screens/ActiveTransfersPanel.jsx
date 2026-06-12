/* eslint-disable react/prop-types */
import {
  AlertCircle,
  CheckCircle,
  Download,
  FolderOpen,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";

import {
  formatByteProgress,
  formatProgressPercentage,
} from "../transferProgress";
import "./ActiveTransfersPanel.css";

const RUNNING_STATES = new Set([
  "beginning",
  "committing",
  "cancelling",
  "downloading",
  "hashing",
  "queued",
  "running",
  "uploading",
  "verifying",
]);

const getStateLabel = (state) => {
  const normalized = String(state || "checking").toLowerCase();
  if (normalized === "completed") return "Completed";
  if (normalized === "cancelled") return "Cancelled";
  if (normalized === "failed") return "Failed";
  if (normalized === "paused") return "Paused";
  if (normalized === "cancelling") return "Cancelling";
  if (normalized === "checking") return "Checking";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const ActiveTransfersPanel = ({
  transfers,
  pendingOperationId,
  onCancel,
  onResume,
  onDismiss,
  onOpenPath,
}) => {
  if (!Array.isArray(transfers) || transfers.length === 0) return null;

  return (
    <aside className="active-transfers" aria-label="Restored transfers">
      <header className="active-transfers__header">
        <h2>Transfers</h2>
        <span>{transfers.length}</span>
      </header>

      <div className="active-transfers__list">
        {transfers.map((entry) => {
          const status = entry.status || entry;
          const state = status.state || entry.state || "checking";
          const running = RUNNING_STATES.has(state);
          const paused = state === "paused";
          const terminal = ["cancelled", "completed", "failed"].includes(
            state,
          );
          const pending = pendingOperationId === entry.operationId;
          const transferError = status.transferError || entry.transferError;
          const destinationPath =
            status.destinationPath ||
            status.destination_path ||
            entry.destinationPath;
          const progress = {
            completedBytes:
              status.completedBytes ||
              status.completed_bytes ||
              entry.completedBytes ||
              "0",
            totalBytes:
              status.totalBytes ||
              status.total_bytes ||
              entry.totalBytes ||
              "0",
            percentage:
              status.progress ??
              status.percentage ??
              entry.percentage ??
              0,
          };

          return (
            <article
              className={`active-transfers__item active-transfers__item--${state}`}
              key={entry.operationId}
            >
              <div className="active-transfers__summary">
                <span className="active-transfers__direction" aria-hidden="true">
                  {entry.direction === "download" ? (
                    <Download size={16} />
                  ) : (
                    <Upload size={16} />
                  )}
                </span>
                <div className="active-transfers__identity">
                  <strong>{entry.label}</strong>
                  <span>{getStateLabel(state)}</span>
                </div>
                <span className="active-transfers__state-icon" aria-hidden="true">
                  {state === "completed" ? (
                    <CheckCircle size={17} />
                  ) : state === "failed" || state === "cancelled" ? (
                    <AlertCircle size={17} />
                  ) : (
                    <Loader2
                      size={17}
                      className={running && !pending ? "spinning" : ""}
                    />
                  )}
                </span>
              </div>

              <div
                className="active-transfers__progress"
                role="progressbar"
                aria-label={`${entry.label} progress`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(Number(progress.percentage) || 0)}
              >
                <span
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, Number(progress.percentage) || 0),
                    )}%`,
                  }}
                />
              </div>

              <div className="active-transfers__bytes">
                <span>{formatByteProgress(progress)}</span>
                <strong>
                  {formatProgressPercentage(progress.percentage)}%
                </strong>
              </div>

              {(transferError || status.error || entry.lookupError) && (
                <div className="active-transfers__error">
                  <strong>
                    {transferError?.title || "Transfer status unavailable"}
                  </strong>
                  <span>
                    {transferError?.message ||
                      status.error ||
                      entry.lookupError}
                  </span>
                  {transferError?.detail && <small>{transferError.detail}</small>}
                </div>
              )}

              {destinationPath && (
                <code className="active-transfers__path">
                  {destinationPath}
                </code>
              )}

              <div className="active-transfers__actions">
                {paused && status.transferError?.canResume !== false && (
                  <button
                    type="button"
                    onClick={() => onResume(entry.operationId)}
                    disabled={pending}
                    title="Resume transfer"
                  >
                    <RotateCcw
                      size={14}
                      className={pending ? "spinning" : ""}
                    />
                    Resume
                  </button>
                )}
                {running && state !== "cancelling" && (
                  <button
                    type="button"
                    className="active-transfers__cancel"
                    onClick={() => onCancel(entry.operationId)}
                    disabled={pending}
                    title="Cancel transfer"
                  >
                    <X size={14} />
                    Cancel
                  </button>
                )}
                {state === "completed" && destinationPath && onOpenPath && (
                  <button
                    type="button"
                    onClick={() => onOpenPath(destinationPath)}
                    title="Open downloaded file"
                  >
                    <FolderOpen size={14} />
                    Open
                  </button>
                )}
                {terminal && (
                  <button
                    type="button"
                    onClick={() => onDismiss(entry.operationId)}
                    title="Dismiss transfer"
                  >
                    <X size={14} />
                    Dismiss
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </aside>
  );
};

export default ActiveTransfersPanel;
