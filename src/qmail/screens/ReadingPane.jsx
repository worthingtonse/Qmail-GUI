/* eslint-disable react/prop-types */
import {
  Mail,
  Trash2,
  Reply,
  Paperclip,
  FileText,
  File,
  Sheet,
  Image,
  Archive,
  FileEdit,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Download,
  Forward,
  Users,
  ChevronDown,
} from "lucide-react";
import SenderAvatar from "./SenderAvatar";
import "./ReadingPane.css";

const ReadingPane = ({
  email,
  onDownload,
  isDownloading,
  onReply,
  onReplyAll,
  onForward,
  onMarkAsRead,
  onDeleteEmail,
  onMoveEmail,
  attachments = [],
  onDownloadAttachment,
}) => {
  if (!email) {
    return (
      <section className="reading-pane">
        <section className="reading-pane__empty" aria-label="No email selected">
          <Mail size={48} />
          <h3 className="reading-pane__empty-title">Select an email to read</h3>
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

  const isUndownloaded =
    email.isPending ||
    email.isDownloaded === false ||
    email.isDownloaded === "false" ||
    email.isDownloaded === 0;

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

  const currentFolder = email.folder || "inbox";
  const showArchiveButton =
    onMoveEmail &&
    currentFolder !== "archive" &&
    currentFolder !== "trash" &&
    !email.isTrashed;
  const moveOptions = [
    { value: "inbox", label: "Inbox" },
    { value: "archive", label: "Archive" },
    { value: "trash", label: "Trash" },
  ].filter(
    (option) =>
      option.value !== currentFolder &&
      !(showArchiveButton && option.value === "archive"),
  );

  const handleAttachmentKeyDown = (event, attachmentId, attachment) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (onDownloadAttachment) {
        onDownloadAttachment(email.id || email.guid, attachmentId, attachment);
      }
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
                <span title="Download the message first to forward.">
                  <button
                    className="reading-pane__action-button reading-pane__action-button--secondary"
                    disabled
                    type="button"
                  >
                    <Forward size={16} /> Forward
                  </button>
                </span>
              </div>
            )}
          </div>
        </header>

        <div className="reading-pane__body">
          <section className="reading-pane__secure-box">
            <ShieldCheck size={48} className="reading-pane__secure-icon" />
            <h3 className="reading-pane__secure-title">Secure Encrypted Payload</h3>
            <p className="reading-pane__secure-text">
              This message is waiting on the server. Download it to decrypt and
              view the contents.
            </p>

            <button
              className="reading-pane__download-button"
              onClick={() => onDownload(email.guid || email.id)}
              disabled={isDownloading}
              type="button"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="reading-pane__spinner spinning" size={18} />
                  Decrypting Message...
                </>
              ) : (
                <>
                  <Download size={18} /> Download Message
                </>
              )}
            </button>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="reading-pane">
      <header className="reading-pane__header">
        {email.isDraft ? (
          <div className="reading-pane__top-row">
            <div className="reading-pane__sender">
              <SenderAvatar
                sender={email.sender}
                email={email.senderEmail || email.from}
                status={email.senderStatus}
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
              <button
                className="reading-pane__action-button reading-pane__action-button--danger"
                onClick={() => onDeleteEmail && onDeleteEmail(email.id, false)}
                title="Move to trash"
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className="reading-pane__top-row">
            <div className="reading-pane__sender">
              <SenderAvatar
                sender={email.sender}
                email={email.senderEmail || email.from}
                status={email.senderStatus}
              />
              <div className="reading-pane__sender-details">
                <span className="reading-pane__sender-name">
                  {email.from || email.senderEmail || email.sender}
                </span>
              </div>
            </div>
            <div className="reading-pane__actions">
              {onReply && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--secondary"
                  onClick={() => onReply(email)}
                  title="Reply to email"
                  type="button"
                >
                  <Reply size={16} /> Reply
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
                    className="reading-pane__action-button reading-pane__action-button--secondary"
                    onClick={() => onReplyAll(email)}
                    disabled={!hasReplyAllRecipientData}
                    type="button"
                  >
                    <Users size={16} /> Reply All
                  </button>
                </span>
              )}

              {onForward && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--secondary"
                  onClick={() => onForward(email)}
                  title="Forward email"
                  type="button"
                >
                  <Forward size={16} /> Forward
                </button>
              )}

              {onMarkAsRead && email.isRead && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--secondary"
                  onClick={() => onMarkAsRead(email.id, false)}
                  title="Mark as unread"
                  type="button"
                >
                  <Mail size={16} /> Mark Unread
                </button>
              )}

              {showArchiveButton && (
                <button
                  className="reading-pane__action-button reading-pane__action-button--secondary"
                  onClick={() => onMoveEmail(email.id, "archive")}
                  title="Archive email"
                  type="button"
                >
                  <Archive size={16} /> Archive
                </button>
              )}

              <label className="reading-pane__folder-select-wrap">
                <span className="reading-pane__sr-only">Move email to folder</span>
                <select
                  className="reading-pane__folder-select"
                  onChange={(event) => {
                    if (event.target.value && onMoveEmail) {
                      onMoveEmail(email.id, event.target.value);
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Move to...
                  </option>
                  {moveOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="reading-pane__folder-select-icon"
                />
              </label>

              {email.folder === "trash" || email.isTrashed ? (
                <button
                  className="reading-pane__action-button reading-pane__action-button--danger"
                  onClick={() => onDeleteEmail && onDeleteEmail(email.id, true)}
                  title="Delete permanently"
                  type="button"
                >
                  <Trash2 size={16} /> Delete Forever
                </button>
              ) : (
                <button
                  className="reading-pane__action-button reading-pane__action-button--danger"
                  onClick={() => onDeleteEmail && onDeleteEmail(email.id, false)}
                  title="Move to trash"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        <h2 className="reading-pane__subject">{email.subject}</h2>
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
            <div className="reading-pane__attachments-list">
              {attachments.map((attachment, index) => {
                const attachmentId = attachment.attachmentId || attachment.id;
                const attachmentName = attachment.name || `Attachment ${index + 1}`;
                const isDangerous = attachment.dangerous === true;
                const warningTitle =
                  attachment.warning || "Potentially dangerous attachment";

                return (
                  <article
                    key={attachmentId || index}
                    className="reading-pane__attachment"
                    onClick={() =>
                      onDownloadAttachment &&
                      onDownloadAttachment(
                        email.id || email.guid,
                        attachmentId,
                        attachment,
                      )
                    }
                    onKeyDown={(event) =>
                      handleAttachmentKeyDown(event, attachmentId, attachment)
                    }
                    role="button"
                    tabIndex={0}
                  >
                    <div className="reading-pane__attachment-icon">
                      {getFileTypeIcon(attachment.fileExtension)}
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
                      </div>
                    </div>
                    <div className="reading-pane__attachment-download">
                      <button
                        className="reading-pane__attachment-download-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (onDownloadAttachment) {
                            onDownloadAttachment(
                              email.id || email.guid,
                              attachmentId,
                              attachment,
                            );
                          }
                        }}
                        title="Download attachment"
                        type="button"
                      >
                        <Download size={14} />
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
