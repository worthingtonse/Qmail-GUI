/* eslint-disable react/prop-types */
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
} from "lucide-react";
import SenderAvatar from "./SenderAvatar";
import QmailCartoucheAvatar from "./QmailCartoucheAvatar";
import { getQmailAvatarModel } from "../avatar/qmailAvatar";
import {
  formatByteProgress,
  formatProgressPercentage,
} from "../transferProgress";
import "./ReadingPane.css";

const DECRYPT_STRIPES = [
  ["01001101", "10110010", "00110111", "11001001", "01100100", "10011011"],
  ["11100010", "00011101", "10101010", "01010101", "00111100", "11000011"],
  ["10010100", "01101011", "11110000", "00001111", "10110100", "01001011"],
  ["00101110", "11010001", "01011010", "10100101", "01111000", "10000111"],
  ["11100111", "00011000", "10000011", "01111100", "10101100", "01010011"],
  ["01010110", "10101001", "00110010", "11001101", "01101110", "10010001"],
  ["11011000", "00100111", "11101010", "00010101", "10011100", "01100011"],
];

const DECRYPT_STEPS = [
  "Receiving stripes",
  "Reassembling blocks",
  "AES decrypt",
  "Rendering message",
];

const SevenStripeDecryptAnimation = ({ active }) => (
  <section
    className={`reading-pane__decrypt-box ${
      active ? "reading-pane__decrypt-box--active" : ""
    }`}
    aria-label="Message decryption progress"
  >
    <div className="reading-pane__decrypt-stage" aria-hidden="true">
      <div className="reading-pane__decrypt-stripes">
        {DECRYPT_STRIPES.map((stripe, stripeIndex) => (
          <div
            key={`stripe-${stripeIndex}`}
            className={`reading-pane__decrypt-stripe ${
              stripeIndex % 2 === 0
                ? "reading-pane__decrypt-stripe--top"
                : "reading-pane__decrypt-stripe--bottom"
            }`}
            style={{ "--stripe-delay": `${stripeIndex * 90}ms` }}
          >
            <div className="reading-pane__decrypt-stream">
              {stripe.map((chunk, chunkIndex) => (
                <span key={`${stripeIndex}-${chunkIndex}`}>{chunk}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="reading-pane__decrypt-scan" />
    </div>

    <div className="reading-pane__decrypt-steps" aria-hidden="true">
      {DECRYPT_STEPS.map((step, index) => (
        <span
          key={step}
          className="reading-pane__decrypt-step"
          style={{ "--step-delay": `${index * 420}ms` }}
        >
          {step}
        </span>
      ))}
    </div>
  </section>
);

const ReadingPane = ({
  email,
  isDecrypting = false,
  onReply,
  onReplyAll,
  onForward,
  onMoveEmail,
  onRejectPayment,
  isRejectingPayment = false,
  attachments = [],
  attachmentDownloadProgress = null,
  downloadLocation = null,
  onOpenDownloadLocation,
  onDownloadAttachment,
  onCancelAttachmentDownload,
  onResumeAttachmentDownload,
}) => {
  const emailId = email?.id || email?.guid;
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
  const hasReplyAllRecipientData =
    hasRecipientValue(getEmailField("to")) ||
    hasRecipientValue(getEmailField("To")) ||
    hasRecipientValue(getEmailField("to_addresses")) ||
    hasRecipientValue(getEmailField("cc")) ||
    hasRecipientValue(getEmailField("CC")) ||
    hasRecipientValue(getEmailField("cc_addresses"));

  const currentFolder = email.folder || "inbox";
  const isUndownloaded =
    currentFolder === "inbox" &&
    !email.isRead &&
    (email.isPending ||
      email.isDownloaded === false ||
      email.isDownloaded === "false" ||
      email.isDownloaded === 0);

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
  const showArchiveButton =
    onMoveEmail &&
    currentFolder !== "archive" &&
    currentFolder !== "trash" &&
    !email.isTrashed;

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
            <SevenStripeDecryptAnimation active={isDecrypting} />
          </section>
        </div>
      </section>
    );
  }
  const headerSenderSn = email.senderSn ?? email.sender_sn;
  const headerSenderDenominationCode =
    email.senderDenominationCode ?? email.sender_denomination_code;
  // A real cartouche only renders for a valid serial + denomination; drafts
  // and unresolved senders fall back to the small SenderAvatar.
  const hasHeaderCartouche =
    !email.isDraft &&
    Boolean(
      getQmailAvatarModel({
        serialNumber: headerSenderSn,
        denominationCode: headerSenderDenominationCode,
      }),
    );

  return (
    <section className="reading-pane">
      <header className="reading-pane__header">
        {hasHeaderCartouche && (
          <QmailCartoucheAvatar
            serialNumber={headerSenderSn}
            denominationCode={headerSenderDenominationCode}
            className="reading-pane__header-cartouche"
          />
        )}
        <div className="reading-pane__header-text">
        {email.isDraft ? (
          <div className="reading-pane__top-row">
            <div className="reading-pane__sender">
              <SenderAvatar
                sender={email.sender}
                email={email.senderEmail || email.from}
                status={email.senderStatus}
                senderSn={email.senderSn ?? email.sender_sn}
                senderDenominationCode={email.senderDenominationCode ?? email.sender_denomination_code}
              />
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
              {!hasHeaderCartouche && (
                <SenderAvatar
                  sender={email.sender}
                  email={email.senderEmail || email.from}
                  status={email.senderStatus}
                  senderSn={email.senderSn ?? email.sender_sn}
                  senderDenominationCode={email.senderDenominationCode ?? email.sender_denomination_code}
                />
              )}
              <div className="reading-pane__sender-details">
                <span className="reading-pane__sender-name">
                  {email.from || email.senderEmail || email.sender}
                </span>
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
                    className="reading-pane__action-button reading-pane__action-button--secondary reading-pane__action-button--icon"
                    onClick={() => onReplyAll(email)}
                    disabled={!hasReplyAllRecipientData}
                    type="button"
                  >
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

              {showArchiveButton && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--secondary"
                  onClick={() => onMoveEmail(email.id, "archive")}
                  title="Archive qmail"
                  type="button"
                >
                  <Archive size={16} /> Archive
                </button>
              )}
            </div>
          </div>
        )}

        <h2 className="reading-pane__subject">{email.subject}</h2>
        </div>
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
            {activeAttachmentDownload && (
              <div className="reading-pane__attachment-decrypt-panel">
                <SevenStripeDecryptAnimation active={attachmentTransferRunning} />
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
                    }${isDownloading ? " reading-pane__attachment--downloading" : ""}`}
                    onClick={() =>
                      handleDownloadAttachment(attachmentId, attachment)
                    }
                    onKeyDown={(event) =>
                      handleAttachmentKeyDown(event, attachmentId, attachment)
                    }
                    aria-busy={isDownloading}
                    role="button"
                    tabIndex={0}
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
                        ) : (
                          isPending && (
                            <span className="reading-pane__attachment-status reading-pane__attachment-status--pending">
                              Click to download
                            </span>
                          )
                        )}
                      </div>
                    </div>
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
