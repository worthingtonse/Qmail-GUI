/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Clipboard,
  Download,
  File,
  FolderOpen,
  KeyRound,
  Loader2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  depositCloudCoinFiles,
  depositCloudCoinFolder,
  downloadLockerToDefaultWallet,
  getDefaultWalletReceipt,
  normalizeLockerCode,
  validateLockerCode,
  waitForTaskCompletion,
  withdrawToLockerCode,
} from "../../api/qmailApiServices";
import "./ComposeModal.css";
import "./WalletActionModal.css";

const ADD_METHODS = [
  { id: "locker", label: "Locker", icon: KeyRound },
  { id: "folder", label: "Folder", icon: FolderOpen },
  { id: "files", label: "Files", icon: File },
];

const SUPPORTED_DEPOSIT_FILE_LABEL = ".bin, .stack, .zip, .png";

const formatBalance = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 CC";
  return `${Math.ceil(number).toLocaleString()} CC`;
};

const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let normalized = size;
  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }
  const digits = normalized >= 10 || unitIndex === 0 ? 0 : 1;
  return `${normalized.toFixed(digits)} ${units[unitIndex]}`;
};

const getTaskProgressLabel = (task) => {
  const progress = Number(task?.progress ?? task?.percent ?? task?.percentage);
  if (Number.isFinite(progress) && progress >= 0) {
    return `Depositing... ${Math.min(100, Math.round(progress))}%`;
  }
  return task?.message || task?.status || "Depositing...";
};

const normalizeReceiptFilename = (value) => {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "recovered") return "";

  const basename = raw.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  if (!basename || basename === "." || basename === ".." || basename.includes("..")) {
    return "";
  }

  return /\.(json|txt)$/i.test(basename) ? basename : `${basename}.json`;
};

const getReceiptFilenameFromResult = (result, fallbackTaskId = null) => {
  const data = result?.data || {};
  const nested = data.result || {};
  const receipt = data.receipt || nested.receipt || {};
  const candidates = [
    data.receipt_filename,
    data.receipt_file,
    data.receipt_path,
    data.receipt_id,
    data.receiptId,
    data.filename,
    nested.receipt_filename,
    nested.receipt_file,
    nested.receipt_path,
    nested.receipt_id,
    nested.receiptId,
    nested.filename,
    receipt.receipt_filename,
    receipt.receipt_id,
    receipt.task_id,
    data.task_id,
    data.taskId,
    nested.task_id,
    nested.taskId,
    fallbackTaskId,
  ];

  for (const candidate of candidates) {
    const filename = normalizeReceiptFilename(candidate);
    if (filename) return filename;
  }

  return "";
};

const getReceiptWalletPathFromResult = (result) => {
  const data = result?.data || {};
  const nested = data.result || {};
  const receipt = data.receipt || nested.receipt || {};
  return data.wallet_path || data.walletPath || nested.wallet_path || nested.walletPath || receipt.wallet_path || "";
};

const formatReceiptContent = (content) => {
  if (content == null) return "";
  if (typeof content === "string") {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return JSON.stringify(content, null, 2);
};

const WalletActionModal = ({
  isOpen,
  initialMode = "add",
  walletBalance,
  onClose,
  onWalletUpdated,
}) => {
  const [mode, setMode] = useState(initialMode === "withdraw" ? "withdraw" : "add");
  const [addMethod, setAddMethod] = useState("locker");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [lockerCode, setLockerCode] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [withdrawLockerCode, setWithdrawLockerCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [receiptFilename, setReceiptFilename] = useState("");
  const [receiptWalletPath, setReceiptWalletPath] = useState("");
  const [receiptContent, setReceiptContent] = useState(null);
  const [isReceiptVisible, setIsReceiptVisible] = useState(false);
  const [isReceiptLoading, setIsReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const walletPickerSupported =
    typeof window !== "undefined" &&
    !!window.electronAPI &&
    typeof window.electronAPI.pickWalletCoinFiles === "function" &&
    typeof window.electronAPI.pickWalletCoinFolder === "function";

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode === "withdraw" ? "withdraw" : "add");
    setAddMethod("locker");
    setSelectedFiles([]);
    setSelectedFolder(null);
    setLockerCode("");
    setWithdrawAmount("");
    setIsWorking(false);
    setStatusMessage("");
    setError("");
    setSuccessMessage("");
    setWithdrawLockerCode("");
    setCopied(false);
    setReceiptFilename("");
    setReceiptWalletPath("");
    setReceiptContent(null);
    setIsReceiptVisible(false);
    setIsReceiptLoading(false);
    setReceiptError("");
  }, [initialMode, isOpen]);

  const modalTitle = mode === "withdraw" ? "Withdraw" : "Add Funds";
  const walletTotal = walletBalance?.totalValue ?? walletBalance?.totalCoins ?? 0;

  const fileSummary = useMemo(() => {
    if (selectedFiles.length === 0) return "No files selected";
    const totalSize = selectedFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    return `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected (${formatFileSize(totalSize)})`;
  }, [selectedFiles]);

  if (!isOpen) return null;

  const resetReceiptState = () => {
    setReceiptFilename("");
    setReceiptWalletPath("");
    setReceiptContent(null);
    setIsReceiptVisible(false);
    setIsReceiptLoading(false);
    setReceiptError("");
  };

  const resetOperationState = () => {
    setError("");
    setSuccessMessage("");
    setStatusMessage("");
    setWithdrawLockerCode("");
    setCopied(false);
    resetReceiptState();
  };

  const handleClose = () => {
    if (isWorking) return;
    onClose();
  };


  const handleAddMethodChange = (nextMethod) => {
    if (isWorking || addMethod === nextMethod) return;
    resetOperationState();
    setAddMethod(nextMethod);
  };

  const handlePickFiles = async () => {
    resetOperationState();
    if (!walletPickerSupported) {
      setError("File picker is only available in the QMail desktop app.");
      return;
    }

    const files = await window.electronAPI.pickWalletCoinFiles();
    if (Array.isArray(files) && files.length > 0) {
      setSelectedFiles(files);
    }
  };

  const handlePickFolder = async () => {
    resetOperationState();
    if (!walletPickerSupported) {
      setError("Folder picker is only available in the QMail desktop app.");
      return;
    }

    const folder = await window.electronAPI.pickWalletCoinFolder();
    if (folder?.path) {
      setSelectedFolder(folder);
    }
  };

  const refreshWallet = async () => {
    if (typeof onWalletUpdated === "function") {
      await onWalletUpdated();
    }
  };

  const finishDepositTask = async (result) => {
    const taskId = result?.data?.task_id || result?.data?.taskId;
    if (!taskId) return result;

    setStatusMessage("Depositing...");
    return waitForTaskCompletion(taskId, {
      onUpdate: (task) => setStatusMessage(getTaskProgressLabel(task)),
    });
  };

  const handleAddFunds = async () => {
    resetOperationState();
    setIsWorking(true);

    try {
      let result;
      let receiptTaskId = null;
      if (addMethod === "files") {
        if (selectedFiles.length === 0) {
          setError(`Choose at least one CloudCoin file (${SUPPORTED_DEPOSIT_FILE_LABEL}).`);
          return;
        }
        setStatusMessage("Starting deposit...");
        result = await depositCloudCoinFiles(selectedFiles.map((file) => file.path));
        receiptTaskId = result?.data?.task_id || result?.data?.taskId;
        result = await finishDepositTask(result);
      } else if (addMethod === "folder") {
        if (!selectedFolder?.path) {
          setError("Choose a folder containing CloudCoin files.");
          return;
        }
        setStatusMessage("Starting deposit...");
        result = await depositCloudCoinFolder(selectedFolder.path);
        receiptTaskId = result?.data?.task_id || result?.data?.taskId;
        result = await finishDepositTask(result);
      } else {
        if (!validateLockerCode(lockerCode)) {
          setError("Enter a locker code in the format XXX-XXXX.");
          return;
        }
        setStatusMessage("Downloading locker...");
        result = await downloadLockerToDefaultWallet(lockerCode);
        receiptTaskId = result?.data?.task_id || result?.data?.taskId;
      }

      if (!result?.success) {
        setError(result?.error || "Add funds failed.");
        return;
      }

      const nextReceiptFilename = getReceiptFilenameFromResult(result, receiptTaskId);
      await refreshWallet();
      setStatusMessage("");
      setReceiptFilename(nextReceiptFilename);
      setReceiptWalletPath(getReceiptWalletPathFromResult(result));
      setSuccessMessage("Funds added to the Default wallet.");
      setSelectedFiles([]);
      setSelectedFolder(null);
      setLockerCode("");
    } catch (err) {
      setError(err?.message || "Add funds failed.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleWithdraw = async () => {
    resetOperationState();
    setIsWorking(true);

    try {
      setStatusMessage("Creating locker...");
      const result = await withdrawToLockerCode(withdrawAmount);
      if (!result?.success) {
        setError(result?.error || "Withdraw failed.");
        return;
      }

      await refreshWallet();
      const newLockerCode = result.data?.locker_key || result.data?.lockerKey || "";
      setWithdrawLockerCode(newLockerCode);
      setStatusMessage("");
      setSuccessMessage("Coins put in locker.");
    } catch (err) {
      setError(err?.message || "Withdraw failed.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isWorking) return;
    if (mode === "withdraw") {
      handleWithdraw();
      return;
    }
    handleAddFunds();
  };

  const handleCopyLockerCode = async () => {
    if (!withdrawLockerCode) return;
    try {
      await navigator.clipboard.writeText(withdrawLockerCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const handleSeeReceipt = async () => {
    if (!receiptFilename || isReceiptLoading) return;
    setReceiptError("");
    setIsReceiptVisible(true);
    setIsReceiptLoading(true);

    try {
      const result = await getDefaultWalletReceipt(receiptFilename, receiptWalletPath || null);
      if (!result?.success) {
        setReceiptError(result?.error || "Could not load receipt.");
        return;
      }
      setReceiptContent(result.data.content);
    } catch (err) {
      setReceiptError(err?.message || "Could not load receipt.");
    } finally {
      setIsReceiptLoading(false);
    }
  };

  const addSubmitDisabled =
    isWorking ||
    (addMethod === "files" && selectedFiles.length === 0) ||
    (addMethod === "folder" && !selectedFolder?.path) ||
    (addMethod === "locker" && !validateLockerCode(lockerCode));

  const withdrawSubmitDisabled =
    isWorking || !Number.isInteger(Number(withdrawAmount)) || Number(withdrawAmount) <= 0;

  return (
    <div className="compose-modal__overlay wallet-action-modal__overlay">
      <section
        className="compose-modal wallet-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-action-modal-title"
      >
        <header className="compose-modal__header wallet-action-modal__header">
          <div className="wallet-action-modal__heading">
            <Wallet size={20} />
            <h2 id="wallet-action-modal-title" className="compose-modal__title">
              {modalTitle}
            </h2>
          </div>
          <button
            className="compose-modal__close-button"
            onClick={handleClose}
            disabled={isWorking}
            type="button"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>

        <form className="compose-modal__body wallet-action-modal__body" onSubmit={handleSubmit}>
          <div className="wallet-action-modal__balance">
            <span>Default Wallet</span>
            <strong>{formatBalance(walletTotal)}</strong>
          </div>

          {mode === "add" ? (
            <section className="wallet-action-modal__section" aria-label="Add funds">
              <div className="wallet-action-modal__method-tabs" role="tablist" aria-label="Add funds source">
                {ADD_METHODS.map((method) => {
                  const Icon = method.icon;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      className={`wallet-action-modal__method-tab ${addMethod === method.id ? "wallet-action-modal__method-tab--active" : ""}`}
                      onClick={() => handleAddMethodChange(method.id)}
                      disabled={isWorking}
                    >
                      <Icon size={15} />
                      <span>{method.label}</span>
                    </button>
                  );
                })}
              </div>

              {addMethod === "files" && (
                <div className="wallet-action-modal__picker">
                  <button
                    className="wallet-action-modal__picker-button"
                    type="button"
                    onClick={handlePickFiles}
                    disabled={isWorking}
                  >
                    <File size={16} />
                    <span>Choose Files</span>
                  </button>
                  <span className="wallet-action-modal__selection">{fileSummary}</span>
                </div>
              )}

              {addMethod === "folder" && (
                <div className="wallet-action-modal__picker">
                  <button
                    className="wallet-action-modal__picker-button"
                    type="button"
                    onClick={handlePickFolder}
                    disabled={isWorking}
                  >
                    <FolderOpen size={16} />
                    <span>Choose Folder</span>
                  </button>
                  <span className="wallet-action-modal__selection">
                    {selectedFolder?.name || "No folder selected"}
                  </span>
                </div>
              )}

              {addMethod === "locker" && (
                <div className="compose-modal__field wallet-action-modal__field">
                  <label htmlFor="wallet-locker-code">Locker Code</label>
                  <input
                    id="wallet-locker-code"
                    type="text"
                    value={lockerCode}
                    onChange={(event) => {
                      setLockerCode(normalizeLockerCode(event.target.value));
                      resetOperationState();
                    }}
                    placeholder="XXX-XXXX"
                    maxLength={8}
                    disabled={isWorking}
                    autoComplete="off"
                  />
                </div>
              )}
            </section>
          ) : (
            <section className="wallet-action-modal__section" aria-label="Withdraw funds">
              <div className="compose-modal__field wallet-action-modal__field">
                <label htmlFor="wallet-withdraw-amount">Amount</label>
                <input
                  id="wallet-withdraw-amount"
                  type="number"
                  min="1"
                  step="1"
                  value={withdrawAmount}
                  onChange={(event) => {
                    setWithdrawAmount(event.target.value);
                    resetOperationState();
                  }}
                  disabled={isWorking}
                  inputMode="numeric"
                />
              </div>

              {withdrawLockerCode && (
                <div className="wallet-action-modal__locker-result">
                  <span>Locker Code</span>
                  <strong>{withdrawLockerCode}</strong>
                  <button type="button" onClick={handleCopyLockerCode}>
                    {copied ? <CheckCircle size={16} /> : <Clipboard size={16} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              )}
            </section>
          )}

          {statusMessage && (
            <div className="compose-modal__send-progress wallet-action-modal__status" role="status">
              <Loader2 size={16} className="spinning compose-modal__status-icon" />
              <span>{statusMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="compose-modal__send-progress wallet-action-modal__success" role="status">
              <CheckCircle size={16} className="compose-modal__status-icon compose-modal__status-icon--success" />
              <span className="wallet-action-modal__success-text">{successMessage}</span>
              {mode === "add" && receiptFilename && (
                <button
                  type="button"
                  className="wallet-action-modal__receipt-link"
                  onClick={handleSeeReceipt}
                  disabled={isReceiptLoading}
                >
                  {isReceiptLoading ? "Loading receipt..." : "See Receipt"}
                </button>
              )}
            </div>
          )}

          {isReceiptVisible && (
            <section className="wallet-action-modal__receipt-panel" aria-label="Deposit receipt">
              <header className="wallet-action-modal__receipt-header">
                <div>
                  <strong>Receipt</strong>
                  <span>{receiptFilename}</span>
                </div>
                <button
                  type="button"
                  className="wallet-action-modal__receipt-close"
                  onClick={() => setIsReceiptVisible(false)}
                  aria-label="Close receipt"
                >
                  <X size={14} />
                </button>
              </header>
              {isReceiptLoading ? (
                <div className="wallet-action-modal__receipt-loading" role="status">
                  <Loader2 size={16} className="spinning" />
                  <span>Loading receipt...</span>
                </div>
              ) : (
                <pre className="wallet-action-modal__receipt-content">{formatReceiptContent(receiptContent)}</pre>
              )}
            </section>
          )}

          {receiptError && (
            <div className="compose-modal__error wallet-action-modal__receipt-error" role="alert">
              <AlertCircle size={16} />
              <span>{receiptError}</span>
            </div>
          )}

          {error && (
            <div className="compose-modal__error wallet-action-modal__error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <footer className="compose-modal__footer wallet-action-modal__footer">
            <button
              className="compose-modal__draft-button"
              type="button"
              onClick={handleClose}
              disabled={isWorking}
            >
              {successMessage ? "OK" : "Cancel"}
            </button>
            <button
              className="compose-modal__send-button"
              type="submit"
              disabled={mode === "withdraw" ? withdrawSubmitDisabled : addSubmitDisabled}
            >
              {isWorking ? (
                <>
                  <Loader2 size={16} className="spinning" />
                  <span>Working...</span>
                </>
              ) : mode === "withdraw" ? (
                <>
                  <Upload size={16} />
                  <span>Withdraw</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>Add Funds</span>
                </>
              )}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};

export default WalletActionModal;
