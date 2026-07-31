/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  X,
} from "lucide-react";
import {
  decryptExistingCoinFiles,
  encryptExistingCoinFiles,
  getCoinEncryptionStatus,
  setCoinEncryptionPassword,
  shutdownCore,
  waitForTaskCompletion,
} from "../../api/qmailApiServices";
import "./CoinEncryptionModal.css";

const getEncryptionCounts = (taskResult) => {
  const counts =
    taskResult?.data?.result?.counts ||
    taskResult?.data?.result?.data?.counts ||
    taskResult?.data?.counts ||
    null;

  if (!counts || typeof counts !== "object") return null;
  return {
    processed: Number(counts.processed) || 0,
    encrypted: Number(counts.encrypted) || 0,
    decrypted: Number(counts.decrypted) || 0,
    skipped: Number(counts.skipped) || 0,
    errors: Number(counts.errors) || 0,
  };
};

const CoinEncryptionModal = ({
  action,
  onClose,
  onComplete,
  required = false,
}) => {
  const isEncrypting = action === "encrypt";
  const isDecrypting = action === "decrypt";
  const isUnlocking = action === "unlock";
  const isOpen = isEncrypting || isDecrypting || isUnlocking;
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [encryptionStatus, setEncryptionStatus] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!isOpen) return undefined;

    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setRiskAccepted(false);
    setEncryptionStatus(null);
    setStatusError("");
    setError("");
    setSuccessMessage("");
    setProgressMessage("");
    setIsWorking(false);

    let cancelled = false;
    setIsCheckingStatus(true);
    getCoinEncryptionStatus()
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setEncryptionStatus(result.data);
        } else {
          setStatusError(
            result.error ||
              "The core did not provide coin encryption status.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingStatus(false);
      });

    return () => {
      cancelled = true;
    };
  }, [action, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !isWorking && !required) {
        event.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isWorking, onClose, required]);

  if (!isOpen) return null;

  const keyAlreadySet = encryptionStatus?.keySet === true;
  const needsPassword = !keyAlreadySet;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccessMessage("");
    setProgressMessage("");

    if (needsPassword && !password) {
      setError("Enter your coin encryption password.");
      return;
    }
    if (isEncrypting && needsPassword && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (isEncrypting && !riskAccepted) {
      setError("Confirm that you understand the backup and password warning.");
      return;
    }
    setIsWorking(true);
    setProgressMessage(
      isEncrypting
        ? "Loading the encryption key..."
        : "Unlocking encrypted coin files...",
    );

    try {
      if (needsPassword) {
        const loginResult = await setCoinEncryptionPassword(password);
        if (!loginResult.success) {
          setError(loginResult.error || "The password was not accepted.");
          return;
        }

        setPassword("");
        setConfirmPassword("");
        setEncryptionStatus((current) => ({
          ...(current || {}),
          keySet: true,
          loginRequired: false,
        }));
      }

      if (isUnlocking) {
        setSuccessMessage(
          "Password loaded. Encrypted coin files are unlocked for this QMail session.",
        );
        onComplete?.({ state: "encrypted" });
        return;
      }

      setProgressMessage(
        isEncrypting
          ? "Starting coin-file encryption..."
          : "Starting coin-file decryption...",
      );
      const startResult = isEncrypting
        ? await encryptExistingCoinFiles()
        : await decryptExistingCoinFiles();
      if (!startResult.success) {
        setError(
          startResult.error ||
            `Coin ${isEncrypting ? "encryption" : "decryption"} did not start.`,
        );
        return;
      }

      const taskResult = await waitForTaskCompletion(startResult.data.taskId, {
        timeoutMs: 300000,
        intervalMs: 1000,
        onUpdate: (task) => {
          const progress = Number(task?.progress);
          setProgressMessage(
            Number.isFinite(progress)
              ? `${isEncrypting ? "Encrypting" : "Decrypting"} coin files... ${Math.min(100, Math.max(0, Math.round(progress)))}%`
              : task?.message ||
                `${isEncrypting ? "Encrypting" : "Decrypting"} coin files...`,
          );
        },
      });
      if (!taskResult.success) {
        setError(
          taskResult.error ||
            `Coin-file ${isEncrypting ? "encryption" : "decryption"} failed.`,
        );
        return;
      }

      const counts = getEncryptionCounts(taskResult);
      if (isDecrypting) {
        setProgressMessage("Decryption complete. Closing QMail securely...");
        await shutdownCore();
        if (window.electronAPI?.quitApp) {
          await window.electronAPI.quitApp();
          return;
        }
      }

      if (counts) {
        const changedCount = isEncrypting
          ? counts.encrypted
          : counts.decrypted;
        const summary =
          `${changedCount.toLocaleString()} ${isEncrypting ? "encrypted" : "decrypted"}, ` +
          `${counts.skipped.toLocaleString()} skipped, ` +
          `${counts.errors.toLocaleString()} errors.`;
        if (counts.errors > 0) {
          setError(
            `${isEncrypting ? "Encryption" : "Decryption"} completed with file errors: ${summary}`,
          );
          return;
        }
        setSuccessMessage(
          `Coin-file ${isEncrypting ? "encryption" : "decryption"} completed: ${summary}`,
        );
      } else {
        setSuccessMessage(
          `Coin-file ${isEncrypting ? "encryption" : "decryption"} completed.`,
        );
      }
      setEncryptionStatus((current) => ({
        ...(current || {}),
        keySet: isEncrypting,
        encryptedFilesExist: isEncrypting,
        loginRequired: false,
      }));
      const fileState =
        await window.electronAPI?.getCoinFileState?.();
      onComplete?.(
        fileState || { state: isEncrypting ? "encrypted" : "decrypted" },
      );
    } catch (operationError) {
      setError(
        operationError?.message ||
          `Coin-file ${
            isEncrypting
              ? "encryption"
              : isDecrypting
                ? "decryption"
                : "unlock"
          } failed.`,
      );
    } finally {
      setProgressMessage("");
      setIsWorking(false);
    }
  };

  const statusCopy = (() => {
    if (isCheckingStatus) return "Checking encryption status...";
    if (statusError) {
      return `Encryption status is unavailable: ${statusError}`;
    }
    if (encryptionStatus?.keySet) {
      return isEncrypting
        ? "An encryption key is already loaded. Confirm the warning to encrypt existing plaintext files."
        : isDecrypting
          ? "The password is already loaded. The encrypted files are ready to be permanently decrypted."
          : "Encrypted coin files are already unlocked for this core session.";
    }
    if (encryptionStatus?.encryptedFilesExist) {
      return "Encrypted coin files exist and currently require a password.";
    }
    return "No encrypted coin files were reported by the core.";
  })();

  const submitDisabled =
    isWorking ||
    Boolean(successMessage) ||
    isCheckingStatus ||
    (needsPassword && !password) ||
    (isEncrypting &&
      ((needsPassword && !confirmPassword) || !riskAccepted));

  return (
    <div
      className="coin-encryption-modal__overlay"
      role="presentation"
      onClick={() => {
        if (!isWorking && !required) onClose?.();
      }}
    >
      <section
        className="coin-encryption-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coin-encryption-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="coin-encryption-modal__header">
          <div className="coin-encryption-modal__heading">
            <LockKeyhole size={21} aria-hidden="true" />
            <h2 id="coin-encryption-modal-title">
              {isEncrypting
                ? "Encrypt Coins"
                : isDecrypting
                  ? "Decrypt Coins"
                  : "Unlock Encrypted Coins"}
            </h2>
          </div>
          <button
            type="button"
            className="coin-encryption-modal__close"
            onClick={onClose}
            disabled={isWorking || required}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="coin-encryption-modal__body">
            <p className="coin-encryption-modal__intro">
              {isEncrypting
                ? "Set the password used to encrypt existing coin files in all registered wallets and all future coin-file writes during this core session."
                : isDecrypting
                  ? "Enter the same password used for encryption. QMail will rewrite every encrypted coin file as plaintext, then remove the password from memory so future files stay decrypted."
                  : "Encrypted coin files were found. Enter the same password used for encryption before opening the dashboard."}
            </p>

            <div
              className={`coin-encryption-modal__status ${
                statusError ? "coin-encryption-modal__status--warning" : ""
              }`}
              role="status"
            >
              {isCheckingStatus && <Loader2 size={16} className="spinning" />}
              <span>{statusCopy}</span>
            </div>

            {isEncrypting && (
              <div className="coin-encryption-modal__warning" role="note">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>
                  Back up every wallet first using File → Backup Wallet. A
                  lost password cannot be recovered and will make encrypted
                  coins inaccessible.
                </span>
              </div>
            )}

            {needsPassword && (
              <>
                <label className="coin-encryption-modal__field">
                  <span>Password</span>
                  <div className="coin-encryption-modal__password-row">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={isWorking || Boolean(successMessage)}
                      autoComplete={isEncrypting ? "new-password" : "current-password"}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="coin-encryption-modal__reveal"
                      onClick={() => setShowPassword((shown) => !shown)}
                      disabled={isWorking}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </label>
                {isEncrypting && (
                  <label className="coin-encryption-modal__field">
                    <span>Confirm Password</span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={isWorking || Boolean(successMessage)}
                      autoComplete="new-password"
                    />
                  </label>
                )}
              </>
            )}

            {isEncrypting && (
              <>
                <label className="coin-encryption-modal__acknowledgement">
                  <input
                    type="checkbox"
                    checked={riskAccepted}
                    onChange={(event) => setRiskAccepted(event.target.checked)}
                    disabled={isWorking || Boolean(successMessage)}
                  />
                  <span>
                    I understand that losing this password can make my coins
                    permanently inaccessible.
                  </span>
                </label>
              </>
            )}

            {progressMessage && (
              <div className="coin-encryption-modal__progress" role="status">
                <Loader2 size={17} className="spinning" />
                <span>{progressMessage}</span>
              </div>
            )}
            {successMessage && (
              <div className="coin-encryption-modal__success" role="status">
                <CheckCircle size={17} />
                <span>{successMessage}</span>
              </div>
            )}
            {error && (
              <div className="coin-encryption-modal__error" role="alert">
                <AlertTriangle size={17} />
                <span>{error}</span>
              </div>
            )}
          </div>

          <footer className="coin-encryption-modal__footer">
            {!required && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onClose}
                disabled={isWorking}
              >
                {successMessage ? "Close" : "Cancel"}
              </button>
            )}
            {!successMessage && (
              <button
                type="submit"
                className="btn btn--primary"
                disabled={submitDisabled}
              >
                {isWorking && <Loader2 size={16} className="spinning" />}
                <span>
                  {isWorking
                    ? "Working..."
                    : isEncrypting
                      ? "Encrypt Coins"
                      : isDecrypting
                        ? "Decrypt Coins"
                        : "Unlock Coins"}
                </span>
              </button>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
};

export default CoinEncryptionModal;
