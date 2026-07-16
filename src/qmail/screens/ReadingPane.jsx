/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import {
  Mail,
  Reply,
  Paperclip,
  FileText,
  File,
  Sheet,
  Image,
  Archive,
  FileEdit,
  ShieldAlert,
  Download,
  Forward,
  Users,
  RotateCcw,
  Loader2,
  X,
  ChevronUp,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react";
import SenderAvatar from "./SenderAvatar";
import QmailCartoucheAvatar from "./QmailCartoucheAvatar";
import { addressDerivedSymbols, useDrdSymbols } from "../avatar/drdSymbols";
import {
  formatByteProgress,
  formatProgressPercentage,
} from "../transferProgress";
import "./ReadingPane.css";

// raida-hero.svg lives in public/ and animates itself (SMIL), so the
// component only needs to place and dim it. BASE_URL join matches
// qmailAvatar.js so the packaged Electron build resolves it too.
const RAIDA_HERO_SRC = (() => {
  const baseUrl = import.meta.env?.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}raida-hero.svg`;
})();

const RaidaHeroAnimation = ({ active }) => (
  <section
    className={`reading-pane__decrypt-box ${
      active ? "reading-pane__decrypt-box--active" : ""
    }`}
    aria-label="Message decryption progress"
  >
    <img
      className="reading-pane__decrypt-hero"
      src={RAIDA_HERO_SRC}
      alt=""
      draggable={false}
    />
  </section>
);

const ReadingPane = ({
  email,
  isDecrypting = false,
  onReply,
  onReplyAll,
  onForward,
  onRejectPayment,
  isRejectingPayment = false,
  attachments = [],
  attachmentDownloadProgress = null,
  downloadLocation = null,
  onOpenDownloadLocation,
  onDownloadAttachment,
  onCancelAttachmentDownload,
  onResumeAttachmentDownload,
  onRevealSentAttachment,
  onPreviousEmail,
  onNextEmail,
  hasPreviousEmail = false,
  hasNextEmail = false,
}) => {
  const [recipientsCopied, setRecipientsCopied] = useState(false);
  const copyRecipientsResetRef = useRef(null);
  // The clipboard write resolves asynchronously and can land after this
  // pane unmounts; the guard keeps the late resolve from touching state.
  const isMountedRef = useRef(true);

  // Hooks must run before any early return. Drafts / no-email skip the lookup.
  // Setup re-asserts true because StrictMode replays setup/cleanup/setup in
  // dev — cleanup alone would leave the ref false on a mounted component.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (copyRecipientsResetRef.current) {
        clearTimeout(copyRecipientsResetRef.current);
      }
    };
  }, []);

  const emailId = email?.id || email?.guid;
  // Tracks the currently displayed message so a clipboard write that
  // resolves after the user switched messages can't mark the new one copied.
  const currentEmailIdRef = useRef(emailId);
  currentEmailIdRef.current = emailId;

  // Reset the copied indicator when the displayed message changes so the
  // Check icon from the previous message can't carry over to another one.
  useEffect(() => {
    if (copyRecipientsResetRef.current) {
      clearTimeout(copyRecipientsResetRef.current);
      copyRecipientsResetRef.current = null;
    }
    setRecipientsCopied(false);
  }, [emailId]);
  const headerSenderSn = email?.senderSn ?? email?.sender_sn ?? null;
  const headerSenderDenominationCode =
    email?.senderDenominationCode ?? email?.sender_denomination_code ?? null;
  const headerDrdSymbols = useDrdSymbols(
    email && !email.isDraft ? headerSenderDenominationCode : null,
    email && !email.isDraft ? headerSenderSn : null,
  );
  // Chosen DRD symbols win; otherwise the address-derived defaults (serial
  // high byte top, low byte bottom) so every sender with a valid address
  // gets a cartouche.
  const headerSymbols =
    email && !email.isDraft
      ? headerDrdSymbols ?? addressDerivedSymbols(headerSenderSn)
      : null;
  const activeAttachmentDownload =
    attachmentDownloadProgress != null &&
    String(attachmentDownloadProgress.emailId) === String(emailId);
  const attachmentTransferRunning =
    activeAttachmentDownload &&
    ["running", "cancelling"].includes(attachmentDownloadProgress.status);
  const attachmentTransferResumable =
    activeAttachmentDownload &&
    ["cancelled", "failed", "paused"].includes(
      attachmentDownloadProgress.status,
    ) &&
    attachmentDownloadProgress.transferError?.canRetry !== false;

  const handleDownloadAttachment = async (attachmentId, attachment) => {
    // Sent-box receipt metadata has no downloadable content (see
    // docs/attachment.views.txt) — the card is informational only.
    if (attachment?.metadataOnly) return;
    if (
      attachmentTransferResumable &&
      String(attachmentDownloadProgress.attachmentId) === String(attachmentId)
    ) {
      await onResumeAttachmentDownload?.();
      return;
    }
    if (!onDownloadAttachment || attachmentDownloadProgress != null) return;
    try {
      await onDownloadAttachment(email.id || email.guid, attachmentId, attachment);
    } catch (err) {
      // The dashboard handler reports its own errors.
      console.error("Attachment download failed:", err);
    }
  };

  if (!email) {
    return (
      <section className="reading-pane">
        <section className="reading-pane__empty" aria-label="No qmail selected">
          <Mail size={48} />
          <h3 className="reading-pane__empty-title">Select a qmail to read</h3>
          <p className="reading-pane__empty-text">
            Choose a message from the list to view its contents here.
          </p>
        </section>
      </section>
    );
  }

  const hasRecipientValue = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  };

  const getEmailField = (field) => email[field];

  const currentFolder = email.folder || "inbox";
  const isUndownloaded =
    currentFolder === "inbox" &&
    !email.isRead &&
    (email.isPending ||
      email.isDownloaded === false ||
      email.isDownloaded === "false" ||
      email.isDownloaded === 0);

  // Normalize to/cc/bcc (array or comma/semicolon string) and build a single
  // de-duplicated copy string for "copy all recipients".
  const normalizeRecipientField = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === "string" ? item.trim() : String(item ?? "").trim(),
        )
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(/[,;]/)
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [];
  };

  // First non-empty field among aliases (API may use to / To / to_addresses).
  const firstRecipientList = (...values) => {
    for (const value of values) {
      const list = normalizeRecipientField(value);
      if (list.length > 0) return list;
    }
    return [];
  };

  const toAddresses = firstRecipientList(
    email.to,
    email.To,
    email.to_addresses,
  );
  const ccAddresses = firstRecipientList(
    email.cc,
    email.CC,
    email.cc_addresses,
  );
  const bccAddresses = firstRecipientList(
    email.bcc,
    email.BCC,
    email.bcc_addresses,
  );

  const hasReplyAllRecipientData =
    hasRecipientValue(getEmailField("to")) ||
    hasRecipientValue(getEmailField("To")) ||
    hasRecipientValue(getEmailField("to_addresses")) ||
    hasRecipientValue(getEmailField("cc")) ||
    hasRecipientValue(getEmailField("CC")) ||
    hasRecipientValue(getEmailField("cc_addresses")) ||
    toAddresses.length > 0 ||
    ccAddresses.length > 0;

  const buildAllRecipientsList = () => {
    const combined = [...toAddresses, ...ccAddresses, ...bccAddresses];
    const seen = new Set();
    const unique = [];
    for (const address of combined) {
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(address);
    }
    return unique.join(", ");
  };

  const allRecipientsList = buildAllRecipientsList();
  const multiRecipient =
    toAddresses.length + ccAddresses.length + bccAddresses.length > 1;
  // Sent always offers copy when we have addresses; elsewhere when multi-recipient.
  const showCopyRecipients =
    allRecipientsList.length > 0 &&
    (currentFolder === "sent" || multiRecipient);

  const handleCopyRecipients = (event) => {
    event.stopPropagation();
    if (!allRecipientsList) return;

    const copiedForId = currentEmailIdRef.current;
    const markCopied = () => {
      if (!isMountedRef.current || currentEmailIdRef.current !== copiedForId) {
        return;
      }
      setRecipientsCopied(true);
      if (copyRecipientsResetRef.current) {
        clearTimeout(copyRecipientsResetRef.current);
      }
      copyRecipientsResetRef.current = setTimeout(() => {
        if (isMountedRef.current) setRecipientsCopied(false);
      }, 1500);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(allRecipientsList).then(markCopied, () => {});
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  const getFileTypeIcon = (extension) => {
    const ext = extension?.toLowerCase();
    const iconProps = { size: 20, className: "reading-pane__file-type-icon" };

    switch (ext) {
      case "pdf":
        return <FileText {...iconProps} />;
      case "doc":
      case "docx":
        return <FileText {...iconProps} />;
      case "xls":
      case "xlsx":
        return <Sheet {...iconProps} />;
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
        return <Image {...iconProps} />;
      case "zip":
      case "rar":
        return <Archive {...iconProps} />;
      default:
        return <File {...iconProps} />;
    }
  };

  const inboxFeeValue = Number(email.inboxFee ?? email.inbox_fee ?? 0) || 0;
  const rawPaymentStatus = email.paymentStatus ?? email.payment_status;
  const paymentStatusValue =
    rawPaymentStatus === null || rawPaymentStatus === undefined || rawPaymentStatus === ""
      ? null
      : Number(rawPaymentStatus);
  const hasNumericPaymentStatus = Number.isFinite(paymentStatusValue);
  const paymentStatusText = String(
    email.paymentStatusText || email.payment_status_text || "",
  ).toLowerCase();
  const paymentAlreadyFinal =
    paymentStatusValue === 1 ||
    paymentStatusValue === 3 ||
    paymentStatusText === "claimed" ||
    paymentStatusText === "refunded";
  const hasRefundablePaymentSignal = hasNumericPaymentStatus
    ? !paymentAlreadyFinal
    : inboxFeeValue > 0;
  const canRejectPayment =
    Boolean(onRejectPayment) &&
    !email.isDraft &&
    !email.isTrashed &&
    currentFolder !== "sent" &&
    currentFolder !== "drafts" &&
    currentFolder !== "trash" &&
    hasRefundablePaymentSignal &&
    !paymentAlreadyFinal;
  const showMessageNav =
    Boolean(onPreviousEmail || onNextEmail) && !email.isDraft;

  const handleAttachmentKeyDown = (event, attachmentId, attachment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleDownloadAttachment(attachmentId, attachment);
    }
  };

  if (isUndownloaded) {
    return (
      <section className="reading-pane reading-pane--pending">
        <header className="reading-pane__header reading-pane__header--pending">
          <div className="reading-pane__top-row">
            <div className="reading-pane__sender">
              <div className="reading-pane__sender-details">
                <h2 className="reading-pane__subject">
                  Message from:{" "}
                  {email.from ||
                    email.senderEmail ||
                    email.sender ||
                    "Unknown Sender"}
                </h2>
              </div>
            </div>
            {onForward && (
              <div className="reading-pane__actions">
                <span title="Decrypt the message first to forward.">
                  <button
                    className="reading-pane__action-button reading-pane__action-button--secondary reading-pane__action-button--icon"
                    disabled
                    type="button"
                  >
                    <Forward size={16} />
                    <span className="reading-pane__sr-only">Forward</span>
                  </button>
                </span>
              </div>
            )}
          </div>
        </header>

        <div className="reading-pane__body">
          <section className="reading-pane__secure-box reading-pane__secure-box--decrypt">
            <h3 className="reading-pane__secure-title">
              {isDecrypting ? "Decrypting message" : "Preparing message"}
            </h3>
            <p className="reading-pane__secure-text">
              {isDecrypting
                ? "Receiving stripes, reassembling the payload, and unlocking the message."
                : "The message is queued for background decryption."}
            </p>
            {downloadLocation && (
              <div className="reading-pane__download-location">
                <div className="reading-pane__download-location-row">
                  <span className="reading-pane__download-location-label">
                    Download location
                  </span>
                  {onOpenDownloadLocation && (
                    <button
                      type="button"
                      className="reading-pane__download-location-button"
                      onClick={onOpenDownloadLocation}
                    >
                      Open folder
                    </button>
                  )}
                </div>
                <code className="reading-pane__download-location-path">
                  {downloadLocation}
                </code>
              </div>
            )}
            <RaidaHeroAnimation active={isDecrypting} />
          </section>
        </div>
      </section>
    );
  }
  // Cartouche when the sender's chosen DRD symbols are known; otherwise the
  // SenderAvatar letter-circle fallback fills the same full-height header box.
  const hasHeaderCartouche = Boolean(headerSymbols);

  return (
    <section className="reading-pane">
      <header className="reading-pane__header">
        <div className="reading-pane__header-avatar">
          {hasHeaderCartouche ? (
            <QmailCartoucheAvatar
              firstSymbol={headerSymbols.firstSymbol}
              secondSymbol={headerSymbols.secondSymbol}
              denominationCode={headerSenderDenominationCode}
              serialNumber={headerSenderSn}
              className="reading-pane__header-cartouche"
            />
          ) : (
            <SenderAvatar
              sender={email.sender}
              email={email.senderEmail || email.from}
              status={email.senderStatus}
              senderSn={email.senderSn ?? email.sender_sn}
              senderDenominationCode={
                email.senderDenominationCode ?? email.sender_denomination_code
              }
            />
          )}
        </div>
        <div className="reading-pane__header-text">
        {email.isDraft ? (
          <div className="reading-pane__top-row">
            <div className="reading-pane__sender">
              <div className="reading-pane__sender-details">
                <span className="reading-pane__sender-name">Draft</span>
              </div>
            </div>
            <div className="reading-pane__actions">
              <div className="reading-pane__draft-note">
                <FileEdit size={16} />
                <span>Click on the draft to edit</span>
              </div>

            </div>
          </div>
        ) : (
          <div className="reading-pane__top-row">
            <div className="reading-pane__sender">
              <div className="reading-pane__sender-details">
                {(() => {
                  // For Sent, header identity is the primary recipient; full
                  // To/Cc/Bcc lists are shown below so multi-recipient mail is
                  // not reduced to "first@addr +N".
                  const address =
                    email.senderDisplayAddress ||
                    email.from ||
                    email.senderEmail ||
                    email.sender ||
                    "";
                  const name = email.senderDisplayName || "";
                  // Prefer full recipient list on the subtitle when present.
                  const subtitleAddresses =
                    currentFolder === "sent" && allRecipientsList
                      ? allRecipientsList
                      : address;
                  return (
                    <>
                      <div className="reading-pane__sender-name-row">
                        <span className="reading-pane__sender-name">
                          {name || address}
                        </span>
                        {showCopyRecipients && (
                          <button
                            type="button"
                            className="reading-pane__copy-recipients"
                            onClick={handleCopyRecipients}
                            title="Copy all recipient addresses"
                            aria-label="Copy all recipient addresses"
                          >
                            {recipientsCopied ? (
                              <Check size={14} />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        )}
                      </div>
                      {subtitleAddresses &&
                        subtitleAddresses !== name && (
                        <span
                          className="reading-pane__sender-address"
                          title={subtitleAddresses}
                        >
                          {subtitleAddresses}
                        </span>
                      )}
                      {(toAddresses.length > 0 ||
                        ccAddresses.length > 0 ||
                        bccAddresses.length > 0) && (
                        <div className="reading-pane__recipient-lists">
                          {toAddresses.length > 0 && (
                            <div className="reading-pane__recipient-line">
                              <span className="reading-pane__recipient-label">
                                To
                              </span>
                              <span className="reading-pane__recipient-values">
                                {toAddresses.join(", ")}
                              </span>
                            </div>
                          )}
                          {ccAddresses.length > 0 && (
                            <div className="reading-pane__recipient-line">
                              <span className="reading-pane__recipient-label">
                                Cc
                              </span>
                              <span className="reading-pane__recipient-values">
                                {ccAddresses.join(", ")}
                              </span>
                            </div>
                          )}
                          {bccAddresses.length > 0 &&
                            currentFolder === "sent" && (
                            <div className="reading-pane__recipient-line">
                              <span className="reading-pane__recipient-label">
                                Bcc
                              </span>
                              <span className="reading-pane__recipient-values">
                                {bccAddresses.join(", ")}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            <div className="reading-pane__actions">
              {onReply && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--secondary reading-pane__action-button--icon"
                  onClick={() => onReply(email)}
                  title="Reply to qmail"
                  type="button"
                >
                  <Reply size={16} />
                  <span className="reading-pane__sr-only">Reply</span>
                </button>
              )}

              {onReplyAll && (
                <span
                  title={
                    hasReplyAllRecipientData
                      ? "Reply to all"
                      : "Recipient list not stored with this message."
                  }
                >
                  <button
                    className="reading-pane__action-button reading-pane__action-button--secondary reading-pane__action-button--icon reading-pane__action-button--icon-pair"
                    onClick={() => onReplyAll(email)}
                    disabled={!hasReplyAllRecipientData}
                    type="button"
                    aria-label="Reply All"
                  >
                    <Reply size={16} />
                    <Users size={16} />
                    <span className="reading-pane__sr-only">Reply All</span>
                  </button>
                </span>
              )}

              {onForward && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--secondary reading-pane__action-button--icon"
                  onClick={() => onForward(email)}
                  title="Forward qmail"
                  type="button"
                >
                  <Forward size={16} />
                  <span className="reading-pane__sr-only">Forward</span>
                </button>
              )}

              {canRejectPayment && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--warning"
                  onClick={() => onRejectPayment(email)}
                  disabled={isRejectingPayment}
                  title="Reject payment and return the locker key"
                  type="button"
                >
                  {isRejectingPayment ? (
                    <Loader2 size={16} className="spinning" />
                  ) : (
                    <RotateCcw size={16} />
                  )}
                  Reject
                </button>
              )}
            </div>
          </div>
        )}

        <h2 className="reading-pane__subject">{email.subject}</h2>
        </div>
        {showMessageNav && (
          <div className="reading-pane__nav">
            <button
              type="button"
              className="reading-pane__action-button reading-pane__action-button--secondary reading-pane__nav-button"
              onClick={onPreviousEmail}
              disabled={!hasPreviousEmail}
              title="Previous message"
            >
              <ChevronUp size={14} aria-hidden="true" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              className="reading-pane__action-button reading-pane__action-button--secondary reading-pane__nav-button"
              onClick={onNextEmail}
              disabled={!hasNextEmail}
              title="Next message"
            >
              <span>Next</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      <div className="reading-pane__body">
        <article className="reading-pane__content">
          <p className="reading-pane__content-text">
            {email.body || email.preview || "No content available."}
          </p>
        </article>

        {attachments && Array.isArray(attachments) && attachments.length > 0 && (
          <section className="reading-pane__attachments">
            <h3 className="reading-pane__attachments-title">
              <Paperclip size={16} />
              Attachments ({attachments.length})
            </h3>
            {attachments.every((attachment) => attachment.metadataOnly) && (
              <p className="reading-pane__attachments-note">
                Attachment files are not stored in your Sent box — they were
                included when this qmail was sent. The original file locations
                are shown for reference.
              </p>
            )}
            {activeAttachmentDownload && (
              <div className="reading-pane__attachment-decrypt-panel">
                <RaidaHeroAnimation active={attachmentTransferRunning} />
                <p className="reading-pane__attachment-decrypt-notice">
                  {attachmentTransferRunning
                    ? attachmentDownloadProgress.status === "cancelling"
                      ? "Cancelling attachment download"
                      : "Downloading and decrypting attachment"
                    : attachmentDownloadProgress.transferError?.title
                      ? attachmentDownloadProgress.transferError.title
                    : attachmentDownloadProgress.status === "failed"
                      ? "Attachment download interrupted"
                      : attachmentDownloadProgress.status === "paused"
                        ? "Attachment download paused"
                        : "Attachment download cancelled"}
                </p>
                <div
                  className="reading-pane__transfer-progress-track"
                  role="progressbar"
                  aria-label="Attachment download progress"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={Math.round(
                    attachmentDownloadProgress.percentage,
                  )}
                >
                  <span
                    className="reading-pane__transfer-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(0, attachmentDownloadProgress.percentage))}%`,
                    }}
                  />
                </div>
                <p className="reading-pane__transfer-progress-bytes">
                  {formatByteProgress(attachmentDownloadProgress)}
                </p>
                {attachmentDownloadProgress.error && (
                  <p className="reading-pane__transfer-progress-error">
                    {attachmentDownloadProgress.transferError?.message ||
                      attachmentDownloadProgress.error}
                  </p>
                )}
                {attachmentDownloadProgress.transferError?.detail && (
                  <p className="reading-pane__transfer-progress-detail">
                    {attachmentDownloadProgress.transferError.detail}
                  </p>
                )}
                <div className="reading-pane__transfer-controls">
                  {attachmentTransferRunning ? (
                    <button
                      type="button"
                      className="reading-pane__transfer-control reading-pane__transfer-control--danger"
                      onClick={onCancelAttachmentDownload}
                      disabled={
                        attachmentDownloadProgress.status === "cancelling"
                      }
                      title="Cancel attachment download"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  ) : (
                    attachmentTransferResumable && (
                      <button
                        type="button"
                        className="reading-pane__transfer-control"
                        onClick={onResumeAttachmentDownload}
                        title="Resume attachment download"
                      >
                        <RotateCcw size={14} />
                        {attachmentDownloadProgress.status === "failed"
                          ? "Retry"
                          : "Resume"}
                      </button>
                    )
                  )}
                </div>
              </div>
            )}
            <div className="reading-pane__attachments-list">
              {attachments.map((attachment, index) => {
                const attachmentId = attachment.attachmentId || attachment.id;
                const attachmentName = attachment.name || `Attachment ${index + 1}`;
                const isDangerous = attachment.dangerous === true;
                const warningTitle =
                  attachment.warning || "Potentially dangerous attachment";
                // PENDING (storage_mode 2): bytes haven't been downloaded yet;
                // they're fetched on demand the first time the user clicks.
                const isPending = attachment.isDownloaded === false;
                // Receipt-derived Sent metadata can reveal the original local
                // source through a receipt-validated main-process IPC call.
                const isMetadataOnly = attachment.metadataOnly === true;
                const canRevealSentAttachment =
                  isMetadataOnly &&
                  Boolean(attachment.sourcePath) &&
                  Boolean(onRevealSentAttachment);
                const isDownloading =
                  attachmentTransferRunning &&
                  String(attachmentDownloadProgress.attachmentId) ===
                    String(attachmentId);
                const isResumable =
                  attachmentTransferResumable &&
                  String(attachmentDownloadProgress.attachmentId) ===
                    String(attachmentId);

                return (
                  <article
                    key={attachmentId || index}
                    className={`reading-pane__attachment${
                      isPending ? " reading-pane__attachment--pending" : ""
                    }${isDownloading ? " reading-pane__attachment--downloading" : ""}${
                      isMetadataOnly ? " reading-pane__attachment--metadata" : ""
                    }${
                      canRevealSentAttachment
                        ? " reading-pane__attachment--revealable"
                        : ""
                    }`}
                    {...(canRevealSentAttachment
                      ? {
                          onClick: () =>
                            onRevealSentAttachment(emailId, attachmentId),
                          onKeyDown: (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRevealSentAttachment(emailId, attachmentId);
                            }
                          },
                          role: "button",
                          tabIndex: 0,
                        }
                      : isMetadataOnly
                      ? {}
                      : {
                          onClick: () =>
                            handleDownloadAttachment(attachmentId, attachment),
                          onKeyDown: (event) =>
                            handleAttachmentKeyDown(event, attachmentId, attachment),
                          "aria-busy": isDownloading,
                          role: "button",
                          tabIndex: 0,
                        })}
                  >
                    <div className="reading-pane__attachment-icon">
                      {isDownloading ? (
                        <Loader2
                          size={20}
                          className="reading-pane__attachment-spinner"
                        />
                      ) : (
                        getFileTypeIcon(attachment.fileExtension)
                      )}
                    </div>
                    <div className="reading-pane__attachment-info">
                      <div className="reading-pane__attachment-name">
                        <span className="reading-pane__attachment-name-text">
                          {attachmentName}
                        </span>
                        {isDangerous && (
                          <span
                            className="reading-pane__attachment-danger-chip"
                            title={warningTitle}
                          >
                            <ShieldAlert size={12} />
                            Dangerous
                          </span>
                        )}
                      </div>
                      <div className="reading-pane__attachment-details">
                        <span className="reading-pane__attachment-size">
                          {formatFileSize(attachment.size)}
                        </span>
                        {attachment.fileExtension && (
                          <span className="reading-pane__attachment-type">
                            {attachment.fileExtension.toUpperCase()}
                          </span>
                        )}
                        {isDownloading ? (
                          <span className="reading-pane__attachment-status reading-pane__attachment-status--decrypting">
                            Downloading{" "}
                            {formatProgressPercentage(
                              attachmentDownloadProgress.percentage,
                            )}
                            %
                          </span>
                        ) : isMetadataOnly ? (
                          <span className="reading-pane__attachment-status reading-pane__attachment-status--metadata">
                            {canRevealSentAttachment
                              ? "Click to show in folder"
                              : "Not stored in Sent box"}
                          </span>
                        ) : (
                          isPending && (
                            <span className="reading-pane__attachment-status reading-pane__attachment-status--pending">
                              Click to download
                            </span>
                          )
                        )}
                      </div>
                      {isMetadataOnly && attachment.sourcePath && (
                        <div
                          className="reading-pane__attachment-source"
                          title={attachment.sourcePath}
                        >
                          Sent from: {attachment.sourcePath}
                        </div>
                      )}
                    </div>
                    {!isMetadataOnly && (
                    <div className="reading-pane__attachment-download">
                      <button
                        className="reading-pane__attachment-download-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownloadAttachment(attachmentId, attachment);
                        }}
                        disabled={
                          isDownloading &&
                          attachmentDownloadProgress.status === "cancelling"
                        }
                        title={
                          isResumable
                            ? "Resume attachment download"
                            : isPending
                            ? "Download attachment"
                            : "Save attachment"
                        }
                        type="button"
                      >
                        {isDownloading ? (
                          <Loader2
                            size={14}
                            className="reading-pane__attachment-spinner"
                          />
                        ) : isResumable ? (
                          <RotateCcw size={14} />
                        ) : (
                          <Download size={14} />
                        )}
                      </button>
                    </div>
                    )}
                  </article>
                );
              })}
            </div>

            <footer className="reading-pane__attachments-summary">
              <span className="reading-pane__attachments-summary-text">
                Total size:{" "}
                {formatFileSize(
                  attachments.reduce(
                    (total, attachment) => total + (attachment.size || 0),
                    0,
                  ),
                )}
              </span>
            </footer>
          </section>
        )}
      </div>
    </section>
  );
};

export default ReadingPane;
