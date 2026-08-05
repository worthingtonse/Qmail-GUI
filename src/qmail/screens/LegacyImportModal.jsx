/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  FolderOpen,
  Loader2,
  Wallet,
  X,
} from "lucide-react";
import {
  depositCloudCoinFolder,
  waitForTaskCompletion,
} from "../../api/qmailApiServices";
import {
  countFromTotals,
  getDepositWarnings,
  getTaskProgressLabel,
  getTotalsFromResult,
} from "./depositReceipts";
import "./ComposeModal.css";
import "./WalletActionModal.css";
import "./LegacyImportModal.css";

const formatCcAmount = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 CC";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 8 })} CC`;
};

// One deposit can take a while on a slow RAIDA day; a legacy Bank folder can
// hold thousands of coins, so give each folder task a generous ceiling.
const FOLDER_TASK_TIMEOUT_MS = 15 * 60 * 1000;

const folderDisplayName = (folder) => `${folder.wallet}\\${folder.kind}`;

const FOLDER_STATUS_LABELS = {
  pending: "Waiting",
  running: "Importing...",
  skipped: "Skipped",
};

const FolderStatusIcon = ({ status }) => {
  if (status === "running") {
    return <Loader2 size={16} className="legacy-import__spinner" />;
  }
  if (status === "done") {
    return <CheckCircle size={16} className="legacy-import__icon--done" />;
  }
  if (status === "error") {
    return <AlertCircle size={16} className="legacy-import__icon--error" />;
  }
  return <FolderOpen size={16} className="legacy-import__icon--pending" />;
};

const LegacyImportModal = ({ request, onClose, onWalletUpdated }) => {
  const [folderStates, setFolderStates] = useState([]);
  const [phase, setPhase] = useState("running");
  const [statusLabel, setStatusLabel] = useState("");
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!request) return undefined;

    let unmounted = false;
    cancelRef.current = false;
    setCancelRequested(false);
    setPhase("running");
    setStatusLabel("");
    setFolderStates(
      request.folders.map((folder) => ({ ...folder, status: "pending" })),
    );

    const updateFolder = (index, patch) => {
      if (unmounted) return;
      setFolderStates((current) =>
        current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
      );
    };

    (async () => {
      for (let index = 0; index < request.folders.length; index += 1) {
        if (unmounted) return;
        if (cancelRef.current) {
          for (let rest = index; rest < request.folders.length; rest += 1) {
            updateFolder(rest, { status: "skipped" });
          }
          break;
        }

        const folder = request.folders[index];
        updateFolder(index, { status: "running" });
        setStatusLabel("Starting deposit...");

        try {
          const memo = `Imported from ${request.programLabel} (${folder.wallet}/${folder.kind})`;
          const start = await depositCloudCoinFolder(folder.path, memo);
          if (!start?.success) {
            throw new Error(start?.error || "The deposit did not start.");
          }

          const taskId = start.data?.task_id || start.data?.taskId;
          const result = taskId
            ? await waitForTaskCompletion(taskId, {
                timeoutMs: FOLDER_TASK_TIMEOUT_MS,
                intervalMs: 1000,
                onUpdate: (task) => {
                  if (!unmounted) {
                    setStatusLabel(getTaskProgressLabel(task, "Importing"));
                  }
                },
              })
            : start;
          if (!result?.success) {
            throw new Error(result?.error || "The deposit failed.");
          }

          const totals = getTotalsFromResult(result);
          updateFolder(index, {
            status: "done",
            totals,
            warnings: getDepositWarnings(totals),
          });
        } catch (error) {
          // One bad folder (locked files, backend hiccup) must not strand the
          // rest of the wallets — record the failure and keep going.
          updateFolder(index, {
            status: "error",
            error: error?.message || "The deposit failed.",
          });
        }
      }

      if (!unmounted) {
        setStatusLabel("");
        setPhase("done");
        if (typeof onWalletUpdated === "function") {
          await onWalletUpdated();
        }
      }
    })();

    return () => {
      unmounted = true;
    };
    // The import must run exactly once per request; callbacks are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const summary = useMemo(() => {
    const done = folderStates.filter((entry) => entry.status === "done");
    const failed = folderStates.filter((entry) => entry.status === "error");
    const skipped = folderStates.filter((entry) => entry.status === "skipped");
    const totalsOf = (keys) =>
      done.reduce((acc, entry) => acc + countFromTotals(entry.totals, keys), 0);
    return {
      failed,
      skipped,
      coinsAdded: totalsOf(["bank_count", "fracked_count"]),
      valueAdded: totalsOf(["value_bank", "value_fracked"]),
      counterfeit: totalsOf(["counterfeit_count", "legacy_counterfeit_count"]),
      duplicates: totalsOf(["duplicate_count"]),
      limbo: totalsOf(["limbo_count"]),
    };
  }, [folderStates]);

  if (!request) return null;

  const isRunning = phase === "running";
  const currentIndex = folderStates.findIndex((entry) => entry.status === "running");
  const progressLabel =
    currentIndex >= 0
      ? `Folder ${currentIndex + 1} of ${folderStates.length}: ${folderDisplayName(folderStates[currentIndex])}`
      : "";

  const handleCancel = () => {
    cancelRef.current = true;
    setCancelRequested(true);
  };

  const handleClose = () => {
    if (isRunning) return;
    onClose();
  };

  return (
    <div className="compose-modal__overlay wallet-action-modal__overlay">
      <section
        className="compose-modal wallet-action-modal legacy-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-import-modal-title"
      >
        <header className="compose-modal__header wallet-action-modal__header">
          <div className="wallet-action-modal__heading">
            <Wallet size={20} />
            <h2 id="legacy-import-modal-title" className="compose-modal__title">
              Import Coins from {request.programLabel}
            </h2>
          </div>
          <button
            className="compose-modal__close-button"
            onClick={handleClose}
            disabled={isRunning}
            type="button"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>

        <div className="compose-modal__body wallet-action-modal__body">
          <p className="legacy-import__intro">
            Coins found in {request.programLabel} are imported into the Default
            wallet one folder at a time.
          </p>

          <ul className="legacy-import__folder-list">
            {folderStates.map((entry) => (
              <li
                key={entry.path}
                className={`legacy-import__folder legacy-import__folder--${entry.status}`}
              >
                <FolderStatusIcon status={entry.status} />
                <span className="legacy-import__folder-name" title={entry.path}>
                  {folderDisplayName(entry)}
                </span>
                <span className="legacy-import__folder-result">
                  {entry.status === "done" &&
                    `${countFromTotals(entry.totals, ["bank_count", "fracked_count"]).toLocaleString()} coins added`}
                  {entry.status === "error" && (entry.error || "Failed")}
                  {entry.status !== "done" && entry.status !== "error" &&
                    (FOLDER_STATUS_LABELS[entry.status] || "")}
                </span>
              </li>
            ))}
          </ul>

          {isRunning && (
            <p className="wallet-action-modal__status" role="status">
              <Loader2 size={16} className="legacy-import__spinner" />
              {progressLabel}
              {statusLabel ? ` — ${statusLabel}` : ""}
              {cancelRequested ? " (stopping after this folder)" : ""}
            </p>
          )}

          {!isRunning && (
            <div
              className={
                summary.failed.length > 0
                  ? "wallet-action-modal__success wallet-action-modal__success--issues"
                  : "wallet-action-modal__success"
              }
            >
              <CheckCircle size={18} />
              <div className="wallet-action-modal__success-text">
                <span>
                  {summary.coinsAdded > 0
                    ? `Imported ${summary.coinsAdded.toLocaleString()} coins (${formatCcAmount(summary.valueAdded)}) into the Default wallet.`
                    : "No coins were added to the Default wallet."}
                </span>
                <ul className="wallet-action-modal__deposit-warning-list">
                  {summary.counterfeit > 0 && (
                    <li>{summary.counterfeit.toLocaleString()} notes were counterfeit</li>
                  )}
                  {summary.duplicates > 0 && (
                    <li>Some coins were already in the bank</li>
                  )}
                  {summary.limbo > 0 && (
                    <li>An import was interrupted. The program will try to recover later</li>
                  )}
                  {summary.failed.length > 0 && (
                    <li>
                      {summary.failed.length}{" "}
                      {summary.failed.length === 1 ? "folder" : "folders"} failed to
                      import
                    </li>
                  )}
                  {summary.skipped.length > 0 && (
                    <li>
                      {summary.skipped.length}{" "}
                      {summary.skipped.length === 1 ? "folder was" : "folders were"}{" "}
                      skipped
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <footer className="compose-modal__footer wallet-action-modal__footer">
            {isRunning ? (
              <button
                type="button"
                className="compose-modal__draft-button"
                onClick={handleCancel}
                disabled={cancelRequested}
              >
                {cancelRequested ? "Stopping..." : "Stop After This Folder"}
              </button>
            ) : (
              <button
                type="button"
                className="compose-modal__send-button"
                onClick={handleClose}
              >
                Close
              </button>
            )}
          </footer>
        </div>
      </section>
    </div>
  );
};

export default LegacyImportModal;
