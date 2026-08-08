/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
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
  provisionQMailIdentityFromDefault,
  validateLockerCode,
  waitForTaskCompletion,
  withdrawToBinFile,
  withdrawToLockerCode,
} from "../../api/qmailApiServices";
import { RAIDA_COUNT } from "./serverStatusUi";
import {
  countFromTotals,
  depositAddedNothing,
  getDepositWarnings,
  getTaskProgressLabel,
  getTotalsFromResult,
} from "./depositReceipts";
import { parseQmailAddress } from "../address/qmailAddress";
import {
  formatMailboxCoinPolicyMessage,
  getMailboxWalletPolicy,
} from "../walletStoragePolicy";
import "./ComposeModal.css";
import "./WalletActionModal.css";

const ADD_METHODS = [
  { id: "locker", label: "Locker", icon: KeyRound },
  { id: "folder", label: "Folder", icon: FolderOpen },
  { id: "files", label: "Files", icon: File },
];

const WITHDRAW_METHODS = [
  { id: "locker", label: "Locker Key", icon: KeyRound },
  { id: "file", label: ".bin File", icon: File },
];

const SUPPORTED_DEPOSIT_FILE_LABEL = ".bin, .stack";

const formatBalance = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 CC";
  return `${Math.ceil(number).toLocaleString()} CC`;
};

const friendlyWithdrawError = (message) => {
  const text = String(message || "");
  if (/no coins in wallet/i.test(text) || /no coins in bank/i.test(text)) {
    return "Your wallet has no coins to withdraw.";
  }
  if (/insufficient funds/i.test(text)) {
    return "Not enough CloudCoins in this wallet for that amount.";
  }
  if (/cannot make exact change/i.test(text)) {
    return "The wallet cannot make exact change for this amount. Try a different amount.";
  }
  return text || "Withdraw failed.";
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

const parseReceiptJson = (content) => {
  if (content == null) return null;
  if (typeof content === "object") return content;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const RECEIPT_TYPE_LABELS = {
  deposit: "Deposit",
  upgrade: "Coin Upgrade",
  locker_download: "Locker Download",
  locker_upload: "Locker Upload",
};

// Sum one or more receipt total fields, treating missing/non-numeric as 0.
const sumTotals = countFromTotals;

// "Authentic" is every coin that passed authentication, i.e. Bank + Fracked.
// Fracked coins are authentic too — they are just stored in the Fracked folder
// because not all 25 RAIDA agreed — so they are a SUBSET of Authentic. We show
// Authentic as the computed total (Bank + Fracked) and keep a separate Fracked
// row as the subset breakdown. (Backend already counts both toward
// total_deposited, so this is a display-only correction.)
const RECEIPT_TOTAL_ROWS = [
  {
    key: "authentic",
    label: "Authentic",
    alwaysShow: true,
    count: (t) => sumTotals(t, ["bank_count", "fracked_count"]),
    value: (t) => sumTotals(t, ["value_bank", "value_fracked"]),
  },
  { key: "fracked", label: "Fracked", count: (t) => sumTotals(t, ["fracked_count"]), value: (t) => sumTotals(t, ["value_fracked"]) },
  { key: "limbo", label: "Limbo", count: (t) => sumTotals(t, ["limbo_count"]), value: (t) => sumTotals(t, ["value_limbo"]) },
  { key: "counterfeit", label: "Counterfeit", count: (t) => sumTotals(t, ["counterfeit_count"]), value: (t) => sumTotals(t, ["value_counterfeit"]) },
  { key: "duplicate", label: "Duplicates", count: (t) => sumTotals(t, ["duplicate_count"]) },
  { key: "error", label: "Errors", count: (t) => sumTotals(t, ["error_count"]) },
  { key: "converted", label: "Converted", count: (t) => sumTotals(t, ["converted_count"]) },
  { key: "expired", label: "Expired", count: (t) => sumTotals(t, ["expired_count"]) },
  { key: "legacy_counterfeit", label: "Legacy Counterfeit", count: (t) => sumTotals(t, ["legacy_counterfeit_count"]) },
  { key: "move_failures", label: "Move Failures", count: (t) => sumTotals(t, ["move_failures"]) },
];

const formatReceiptDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

const formatCcAmount = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0 CC";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 8 })} CC`;
};

// Coin denomination is a signed power of ten: value = 10^denom CC.
const formatCoinValue = (denom) => {
  const exponent = Number(denom);
  if (!Number.isInteger(exponent)) return "";
  return formatCcAmount(10 ** exponent);
};

const ReceiptDetails = ({ receipt }) => {
  const totals = receipt.totals || {};
  const locker = receipt.locker;
  const coins = Array.isArray(receipt.coins) ? receipt.coins : [];
  const typeLabel = RECEIPT_TYPE_LABELS[receipt.type] || "Wallet Operation";
  const dateLabel = formatReceiptDate(receipt.date);
  const totalRows = RECEIPT_TOTAL_ROWS.filter(
    (row) => row.alwaysShow || row.count(totals) > 0,
  );

  return (
    <div className="wallet-action-modal__receipt-details">
      <dl className="wallet-action-modal__receipt-summary">
        <div>
          <dt>Type</dt>
          <dd>{typeLabel}</dd>
        </div>
        {dateLabel && (
          <div>
            <dt>Date</dt>
            <dd>{dateLabel}</dd>
          </div>
        )}
        {locker?.locker_key && (
          <div>
            <dt>Locker Code</dt>
            <dd className="wallet-action-modal__receipt-mono">{locker.locker_key}</dd>
          </div>
        )}
        {locker && Number.isFinite(Number(locker.raida_consensus)) && (
          <div>
            <dt>RAIDA Consensus</dt>
            <dd>
              {Number(locker.raida_consensus)} of {RAIDA_COUNT} servers
            </dd>
          </div>
        )}
        {receipt.memo && (
          <div>
            <dt>Memo</dt>
            <dd>{receipt.memo}</dd>
          </div>
        )}
      </dl>

      <table className="wallet-action-modal__receipt-table">
        <thead>
          <tr>
            <th scope="col">Coins</th>
            <th scope="col">Count</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {totalRows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.count(totals).toLocaleString()}</td>
              <td>{row.value ? formatCcAmount(row.value(totals)) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total Added</th>
            <td />
            <td>{formatCcAmount(totals.total_deposited)}</td>
          </tr>
        </tfoot>
      </table>

      {coins.length > 0 && (
        <details className="wallet-action-modal__receipt-coins">
          <summary>
            {coins.length === 1 ? "1 coin" : `${coins.length.toLocaleString()} coins`}
          </summary>
          <table className="wallet-action-modal__receipt-table">
            <thead>
              <tr>
                <th scope="col">Serial Number</th>
                <th scope="col">Value</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {coins.map((coin, index) => (
                <tr key={`${coin.sn}-${index}`}>
                  <td className="wallet-action-modal__receipt-mono">{coin.sn}</td>
                  <td>{formatCoinValue(coin.denom)}</td>
                  <td title={coin.pown ? `RAIDA responses: ${coin.pown}` : undefined}>
                    {coin.bucket || "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {receipt.per_coin_detail_truncated && (
        <p className="wallet-action-modal__receipt-note">
          Per-coin details were omitted because this deposit contains too many coins.
        </p>
      )}
    </div>
  );
};

const WalletActionModal = ({
  isOpen,
  initialMode = "add",
  initialAddMethod = "locker",
  initialSelectedFiles = null,
  initialSelectedFolder = null,
  initialWithdrawMethod = "locker",
  initialWithdrawDestination = null,
  autoOpenPicker = false,
  onboardingMode = false,
  resumeProvisioning = false,
  walletBalance,
  qmailAddress = "",
  onClose,
  onWalletUpdated,
  onIdentityReady,
  onProvisionDeferred,
}) => {
  const [mode, setMode] = useState(initialMode === "withdraw" ? "withdraw" : "add");
  const [addMethod, setAddMethod] = useState("locker");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [lockerCode, setLockerCode] = useState("");
  const [memo, setMemo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState("locker");
  const [withdrawDestination, setWithdrawDestination] = useState(null);
  const [isWorking, setIsWorking] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [withdrawLockerCode, setWithdrawLockerCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [receiptFilename, setReceiptFilename] = useState("");
  const [receiptWalletPath, setReceiptWalletPath] = useState("");
  const [receiptContent, setReceiptContent] = useState(null);
  const [depositWarnings, setDepositWarnings] = useState([]);
  const [storageWarning, setStorageWarning] = useState("");
  const [isReceiptVisible, setIsReceiptVisible] = useState(false);
  const [isReceiptLoading, setIsReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [showRawReceipt, setShowRawReceipt] = useState(false);
  const [depositCompleted, setDepositCompleted] = useState(false);
  const [identityAssignment, setIdentityAssignment] = useState(null);

  const walletPickerSupported =
    typeof window !== "undefined" &&
    !!window.electronAPI &&
    typeof window.electronAPI.pickWalletCoinFiles === "function" &&
    typeof window.electronAPI.pickWalletCoinFolder === "function";

  useEffect(() => {
    if (!isOpen) return;
    setMode(initialMode === "withdraw" ? "withdraw" : "add");
    setAddMethod(ADD_METHODS.some(({ id }) => id === initialAddMethod) ? initialAddMethod : "locker");
    setSelectedFiles(Array.isArray(initialSelectedFiles) ? initialSelectedFiles : []);
    setSelectedFolder(initialSelectedFolder?.path ? initialSelectedFolder : null);
    setLockerCode("");
    setMemo(onboardingMode ? "First Startup" : "");
    setWithdrawAmount("");
    setWithdrawMethod(
      WITHDRAW_METHODS.some(({ id }) => id === initialWithdrawMethod)
        ? initialWithdrawMethod
        : "locker",
    );
    setWithdrawDestination(initialWithdrawDestination?.path ? initialWithdrawDestination : null);
    setIsWorking(false);
    setStatusMessage("");
    setError("");
    setSuccessMessage(
      onboardingMode && resumeProvisioning
        ? "CloudCoins are ready in the Default wallet."
        : "",
    );
    setWithdrawLockerCode("");
    setCopied(false);
    setReceiptFilename("");
    setReceiptWalletPath("");
    setReceiptContent(null);
    setDepositWarnings([]);
    setStorageWarning("");
    setIsReceiptVisible(false);
    setIsReceiptLoading(false);
    setReceiptError("");
    setShowRawReceipt(false);
    setDepositCompleted(onboardingMode && resumeProvisioning);
    setIdentityAssignment(null);
  }, [
    initialAddMethod,
    initialMode,
    initialSelectedFiles,
    initialSelectedFolder,
    initialWithdrawDestination,
    initialWithdrawMethod,
    isOpen,
    onboardingMode,
    resumeProvisioning,
  ]);

  // First-startup shortcut: when the launch screen says "Use CloudCoin
  // Files/Folder", pop the native picker right away instead of making the
  // user click Choose Files/Choose Folder a second time. The picker opens
  // in the last-used deposit location (the main process remembers it).
  // The ref makes this once-per-open even under StrictMode's double effect
  // invocation, which would otherwise stack two native dialogs in dev.
  const autoPickRanRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      autoPickRanRef.current = false;
      return undefined;
    }
    if (!autoOpenPicker || autoPickRanRef.current) return undefined;
    if (initialAddMethod !== "files" && initialAddMethod !== "folder") return undefined;
    if (
      typeof window === "undefined" ||
      !window.electronAPI ||
      typeof window.electronAPI.pickWalletCoinFiles !== "function" ||
      typeof window.electronAPI.pickWalletCoinFolder !== "function"
    ) {
      return undefined;
    }

    autoPickRanRef.current = true;
    let cancelled = false;
    (async () => {
      if (initialAddMethod === "files") {
        const files = await window.electronAPI.pickWalletCoinFiles();
        if (!cancelled && Array.isArray(files) && files.length > 0) {
          setSelectedFiles(files);
        }
      } else {
        const folder = await window.electronAPI.pickWalletCoinFolder();
        if (!cancelled && folder?.path) {
          setSelectedFolder(folder);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoOpenPicker, initialAddMethod, isOpen]);

  const modalTitle = onboardingMode
    ? "Set Up QMail"
    : mode === "withdraw" ? "Withdraw" : "Add Funds";
  const walletTotal = walletBalance?.totalValue ?? walletBalance?.totalCoins ?? 0;

  const fileSummary = useMemo(() => {
    if (selectedFiles.length === 0) return "No files selected";
    const totalSize = selectedFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    return `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected (${formatFileSize(totalSize)})`;
  }, [selectedFiles]);

  // CC value of the staked identity coin (.bit=1 ... .giga=10000). The
  // provision response carries the human value in `denomination`; fall back
  // to deriving it from the address TLD so no extra API call is needed.
  const stakedIdentityValue = useMemo(() => {
    if (!identityAssignment) return null;
    const direct = Number(identityAssignment.denomination);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = parseQmailAddress(identityAssignment.address || "");
    return parsed.ok ? 10 ** parsed.denominationCode : null;
  }, [identityAssignment]);

  if (!isOpen) return null;

  const resetReceiptState = () => {
    setReceiptFilename("");
    setReceiptWalletPath("");
    setReceiptContent(null);
    setDepositWarnings([]);
    setStorageWarning("");
    setIsReceiptVisible(false);
    setIsReceiptLoading(false);
    setReceiptError("");
    setShowRawReceipt(false);
  };

  const resetOperationState = () => {
    setError("");
    setSuccessMessage("");
    setStatusMessage("");
    setWithdrawLockerCode("");
    setCopied(false);
    resetReceiptState();
    setDepositCompleted(false);
    setIdentityAssignment(null);
  };

  const deliverIdentity = async () => {
    if (!identityAssignment) return;
    setIsWorking(true);
    setError("");
    setStatusMessage("Loading the new identity...");
    try {
      if (typeof onIdentityReady === "function") {
        await onIdentityReady(identityAssignment);
      }
    } catch (err) {
      setStatusMessage("");
      setError(err?.message || "The new QMail identity could not be loaded.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleClose = () => {
    if (isWorking) return;
    // Closing after a successful provision means Continue — but only on the
    // first try. If delivery already failed (error set), let the user out;
    // the launch screen re-probes provision/identity state on close.
    if (onboardingMode && identityAssignment && !error) {
      deliverIdentity();
      return;
    }
    onClose();
  };


  const handleAddMethodChange = (nextMethod) => {
    if (
      isWorking ||
      (onboardingMode && depositCompleted) ||
      addMethod === nextMethod
    ) return;
    resetOperationState();
    setAddMethod(nextMethod);
  };

  const handleWithdrawMethodChange = (nextMethod) => {
    if (isWorking || withdrawMethod === nextMethod) return;
    resetOperationState();
    setWithdrawMethod(nextMethod);
  };

  const handlePickWithdrawFolder = async () => {
    resetOperationState();
    if (
      typeof window === "undefined" ||
      typeof window.electronAPI?.pickWalletWithdrawFolder !== "function"
    ) {
      setError("Folder picker is only available in the QMail desktop app.");
      return;
    }

    const folder = await window.electronAPI.pickWalletWithdrawFolder();
    if (folder?.path) {
      setWithdrawDestination(folder);
    }
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

  const provisionIdentity = async () => {
    setStatusMessage("Selecting the QMail identity coin...");
    const provisionResult = await provisionQMailIdentityFromDefault();
    if (!provisionResult?.success) {
      setStatusMessage("");
      setSuccessMessage("");
      if (onboardingMode && typeof onProvisionDeferred === "function") {
        onProvisionDeferred();
      }
      setError(
        provisionResult?.error ||
          "Funds were added, but the QMail identity could not be assigned.",
      );
      return null;
    }

    const assignment = provisionResult.data;
    setIdentityAssignment(assignment);
    setStatusMessage("");
    setError("");
    setSuccessMessage(
      `QMail identity ${assignment.address || assignment.serial_number} is ready.`,
    );
    return assignment;
  };

  const handleAddFunds = async () => {
    resetOperationState();

    if (!onboardingMode) {
      const storagePolicy = getMailboxWalletPolicy(qmailAddress, walletBalance);
      const storagePolicyMessage =
        formatMailboxCoinPolicyMessage(storagePolicy);

      if (storagePolicy.status === "blocked") {
        setError(storagePolicyMessage);
        return;
      }

      if (storagePolicy.status === "warning") {
        setStorageWarning(storagePolicyMessage);
      }
    }

    setIsWorking(true);

    try {
      // An empty memo falls back to each API's default label.
      const memoValue = memo.trim() || undefined;
      let result;
      let receiptTaskId = null;
      if (addMethod === "files") {
        if (selectedFiles.length === 0) {
          setError(`Choose at least one CloudCoin file (${SUPPORTED_DEPOSIT_FILE_LABEL}).`);
          return;
        }
        setStatusMessage("Starting deposit...");
        result = await depositCloudCoinFiles(selectedFiles.map((file) => file.path), memoValue);
        receiptTaskId = result?.data?.task_id || result?.data?.taskId;
        result = await finishDepositTask(result);
      } else if (addMethod === "folder") {
        if (!selectedFolder?.path) {
          setError("Choose a folder containing CloudCoin files.");
          return;
        }
        setStatusMessage("Starting deposit...");
        result = await depositCloudCoinFolder(selectedFolder.path, memoValue);
        receiptTaskId = result?.data?.task_id || result?.data?.taskId;
        result = await finishDepositTask(result);
      } else {
        const validLocker = onboardingMode
          ? lockerCode.trim().length > 0
          : validateLockerCode(lockerCode);
        if (!validLocker) {
          setError(
            onboardingMode
              ? "Enter a locker key."
              : "Enter a locker code in the format XXX-XXXX.",
          );
          return;
        }
        setStatusMessage("Downloading locker...");
        result = await downloadLockerToDefaultWallet(lockerCode, null, memoValue || "");
        receiptTaskId = result?.data?.task_id || result?.data?.taskId;
      }

      if (!result?.success) {
        setError(result?.error || "Add funds failed.");
        return;
      }

      const nextReceiptFilename = getReceiptFilenameFromResult(result, receiptTaskId);
      const totals = getTotalsFromResult(result);
      const warnings = getDepositWarnings(totals);
      await refreshWallet();
      setStatusMessage("");
      setReceiptFilename(nextReceiptFilename);
      setReceiptWalletPath(getReceiptWalletPathFromResult(result));
      setDepositWarnings(warnings);
      setSuccessMessage(
        depositAddedNothing(totals)
          ? "No funds were added to the Default wallet."
          : "Funds added to the Default wallet.",
      );
      setDepositCompleted(true);
      setSelectedFiles([]);
      setSelectedFolder(null);
      setLockerCode("");
      if (onboardingMode) {
        await provisionIdentity();
      }
    } catch (err) {
      setError(err?.message || "Add funds failed.");
    } finally {
      // Same as handleWithdraw: never leave a stale progress spinner
      // ("Starting deposit...", "Downloading locker...") next to an error.
      setStatusMessage("");
      setIsWorking(false);
    }
  };

  const handleOnboardingContinue = async () => {
    setIsWorking(true);
    try {
      if (!identityAssignment) {
        setError("");
        setStatusMessage("");
        await provisionIdentity();
        return;
      }
      await deliverIdentity();
    } catch (err) {
      setStatusMessage("");
      setError(err?.message || "The new QMail identity could not be loaded.");
    } finally {
      setIsWorking(false);
    }
  };

  const handleWithdraw = async () => {
    resetOperationState();
    setIsWorking(true);

    try {
      const memoValue = memo.trim();

      if (withdrawMethod === "file") {
        if (!withdrawDestination?.path) {
          setError("Choose a destination folder for the .bin file.");
          return;
        }
        setStatusMessage("Exporting coins...");
        const result = await withdrawToBinFile(withdrawAmount, withdrawDestination.path, memoValue);
        if (!result?.success) {
          setError(result?.error || "The .bin withdrawal failed.");
          return;
        }

        await refreshWallet();
        const exportedFile = result.data.files[0] || "";
        const exportedValue = Number(result.data.value_exported);
        setStatusMessage("");
        setSuccessMessage(
          exportedFile
            ? `Exported ${Number.isFinite(exportedValue) ? exportedValue.toLocaleString() : withdrawAmount} CC to "${exportedFile}".`
            : "Coins exported.",
        );

        // Show the user where their coins landed: open Explorer/Finder on
        // the exported file. Best-effort — the export already succeeded.
        try {
          await window.electronAPI?.revealWithdrawnFile?.({
            destination: withdrawDestination.path,
            filename: exportedFile,
          });
        } catch {
          // Ignore: the reveal is a convenience, not part of the withdrawal.
        }
        return;
      }

      setStatusMessage("Creating locker...");
      const result = await withdrawToLockerCode(withdrawAmount, null, memoValue);
      if (!result?.success) {
        setError(friendlyWithdrawError(result?.error));
        return;
      }

      await refreshWallet();
      const newLockerCode = result.data?.locker_key || result.data?.lockerKey || "";
      setWithdrawLockerCode(newLockerCode);
      setStatusMessage("");
      setSuccessMessage("Coins put in locker.");
    } catch (err) {
      setError(friendlyWithdrawError(err?.message));
    } finally {
      // Clear on every exit path — a failed withdraw must not leave the
      // "Creating locker..." / "Exporting coins..." spinner next to an error.
      setStatusMessage("");
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
    if (onboardingMode && depositCompleted) {
      handleOnboardingContinue();
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

  // A completed deposit that surfaced warnings (counterfeit, limbo, duplicate,
  // or RAIDA errors) should read as a problem, not a plain success.
  const depositHadIssues = mode === "add" && depositWarnings.length > 0;

  const lockerInputValid = onboardingMode
    ? lockerCode.trim().length > 0
    : validateLockerCode(lockerCode);
  const addSubmitDisabled = onboardingMode && depositCompleted
    ? isWorking
    : isWorking ||
      (addMethod === "files" && selectedFiles.length === 0) ||
      (addMethod === "folder" && !selectedFolder?.path) ||
      (addMethod === "locker" && !lockerInputValid);

  const withdrawSubmitDisabled =
    isWorking ||
    !Number.isInteger(Number(withdrawAmount)) ||
    Number(withdrawAmount) <= 0 ||
    (withdrawMethod === "file" && !withdrawDestination?.path);

  return (
    <>
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
            <span>{onboardingMode ? "Import destination" : "Default Wallet"}</span>
            <strong>{onboardingMode ? "Default Wallet" : formatBalance(walletTotal)}</strong>
          </div>

          {onboardingMode && (
            <p className="wallet-action-modal__receipt-note">
              Import into Default first. The highest-value coin of at least 1 CC
              becomes the Mail identity; all remaining coins stay in Default.
            </p>
          )}

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
                      disabled={isWorking || (onboardingMode && depositCompleted)}
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
                    disabled={isWorking || (onboardingMode && depositCompleted)}
                  >
                    <File size={16} />
                    <span>Choose Files</span>
                  </button>
                  <span className="wallet-action-modal__selection">{fileSummary}</span>
                  <small>Accepted files: {SUPPORTED_DEPOSIT_FILE_LABEL}</small>
                </div>
              )}

              {addMethod === "folder" && (
                <div className="wallet-action-modal__picker">
                  <button
                    className="wallet-action-modal__picker-button"
                    type="button"
                    onClick={handlePickFolder}
                    disabled={isWorking || (onboardingMode && depositCompleted)}
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
                      setLockerCode(
                        onboardingMode
                          ? event.target.value
                          : normalizeLockerCode(event.target.value),
                      );
                      resetOperationState();
                    }}
                    placeholder={onboardingMode ? "Locker key" : "XXX-XXXX"}
                    maxLength={onboardingMode ? undefined : 8}
                    disabled={isWorking || (onboardingMode && depositCompleted)}
                    autoComplete="off"
                  />
                </div>
              )}

              <div className="compose-modal__field wallet-action-modal__field">
                <label htmlFor="wallet-add-funds-memo">Memo (optional)</label>
                <input
                  id="wallet-add-funds-memo"
                  type="text"
                  value={memo}
                  onChange={(event) => setMemo(event.target.value)}
                  placeholder="Describe this transaction"
                  maxLength={120}
                  disabled={isWorking || (onboardingMode && depositCompleted)}
                  autoComplete="off"
                />
              </div>
            </section>
          ) : (
            <section className="wallet-action-modal__section" aria-label="Withdraw funds">
              <div className="wallet-action-modal__method-tabs" role="tablist" aria-label="Withdraw destination">
                {WITHDRAW_METHODS.map((method) => {
                  const Icon = method.icon;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      className={`wallet-action-modal__method-tab ${withdrawMethod === method.id ? "wallet-action-modal__method-tab--active" : ""}`}
                      onClick={() => handleWithdrawMethodChange(method.id)}
                      disabled={isWorking}
                    >
                      <Icon size={15} />
                      <span>{method.label}</span>
                    </button>
                  );
                })}
              </div>

              {withdrawMethod === "file" && (
                <div className="wallet-action-modal__picker">
                  <button
                    className="wallet-action-modal__picker-button"
                    type="button"
                    onClick={handlePickWithdrawFolder}
                    disabled={isWorking}
                  >
                    <FolderOpen size={16} />
                    <span>Choose Destination</span>
                  </button>
                  <span className="wallet-action-modal__selection">
                    {withdrawDestination?.path || "No destination selected"}
                  </span>
                  <small>The coins are combined into a single .bin file at this folder.</small>
                </div>
              )}

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

              <div className="compose-modal__field wallet-action-modal__field">
                <label htmlFor="wallet-withdraw-memo">Memo (optional)</label>
                <input
                  id="wallet-withdraw-memo"
                  type="text"
                  value={memo}
                  onChange={(event) => setMemo(event.target.value)}
                  placeholder="Describe this transaction"
                  maxLength={120}
                  disabled={isWorking}
                  autoComplete="off"
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
            <div
              className={`compose-modal__send-progress wallet-action-modal__success ${
                depositHadIssues ? "wallet-action-modal__success--issues" : ""
              }`}
              role={depositHadIssues ? "alert" : "status"}
            >
              {depositHadIssues ? (
                <AlertCircle size={16} className="compose-modal__status-icon" />
              ) : (
                <CheckCircle size={16} className="compose-modal__status-icon compose-modal__status-icon--success" />
              )}
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

          {identityAssignment && stakedIdentityValue != null && (
            <div
              className="compose-modal__send-progress wallet-action-modal__staked-note"
              role="note"
            >
              <AlertCircle size={16} className="compose-modal__status-icon" />
              <span>
                Attention: You have staked{" "}
                {stakedIdentityValue.toLocaleString()}{" "}
                {stakedIdentityValue === 1 ? "coin" : "coins"} which will not
                show up in your wallet total. This coin is your mailbox key —
                it is in use, not lost.
              </span>
            </div>
          )}

          {mode === "add" && depositWarnings.length > 0 && (
            <div
              className="compose-modal__error wallet-action-modal__deposit-warnings"
              role="alert"
            >
              <AlertCircle size={16} />
              <ul className="wallet-action-modal__deposit-warning-list">
                {depositWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {mode === "add" && storageWarning && (
            <div
              className="compose-modal__send-progress wallet-action-modal__storage-warning"
              role="status"
            >
              <AlertCircle size={16} className="compose-modal__status-icon" />
              <span>{storageWarning}</span>
            </div>
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
              {identityAssignment || (!onboardingMode && successMessage) ? "Close" : "Cancel"}
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
              ) : onboardingMode && identityAssignment ? (
                <>
                  <ArrowRight size={16} />
                  <span>Continue</span>
                </>
              ) : onboardingMode && depositCompleted ? (
                <>
                  <Download size={16} />
                  <span>{error ? "Retry Identity Setup" : "Finish Identity Setup"}</span>
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

    {isReceiptVisible && (
      <div
        className="compose-modal__overlay wallet-action-modal__overlay wallet-action-modal__receipt-overlay"
        onClick={() => setIsReceiptVisible(false)}
      >
        <section
          className="compose-modal wallet-action-modal wallet-action-modal__receipt-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Deposit receipt"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="compose-modal__header wallet-action-modal__receipt-header">
            <div className="wallet-action-modal__receipt-title">
              <strong>Receipt</strong>
              <span>{receiptFilename}</span>
            </div>
            <div className="wallet-action-modal__receipt-header-actions">
              {!isReceiptLoading && parseReceiptJson(receiptContent) && (
                <button
                  type="button"
                  className="wallet-action-modal__receipt-raw-toggle"
                  onClick={() => setShowRawReceipt((show) => !show)}
                >
                  {showRawReceipt ? "Formatted" : "Raw JSON"}
                </button>
              )}
              <button
                type="button"
                className="compose-modal__close-button"
                onClick={() => setIsReceiptVisible(false)}
                aria-label="Close receipt"
              >
                <X size={20} />
              </button>
            </div>
          </header>
          {isReceiptLoading ? (
            <div className="wallet-action-modal__receipt-loading" role="status">
              <Loader2 size={16} className="spinning" />
              <span>Loading receipt...</span>
            </div>
          ) : (() => {
            const parsedReceipt = parseReceiptJson(receiptContent);
            return parsedReceipt && !showRawReceipt ? (
              <div className="wallet-action-modal__receipt-body">
                <ReceiptDetails receipt={parsedReceipt} />
              </div>
            ) : (
              <pre className="wallet-action-modal__receipt-content">{formatReceiptContent(receiptContent)}</pre>
            );
          })()}
        </section>
      </div>
    )}
    </>
  );
};

export default WalletActionModal;
