import React from "react";
import {
  Mail,
  Trash2,
  Reply,
  RefreshCw,
  Paperclip,
  FileText,
  File,
  Sheet,
  Image,
  Archive,
  FileEdit,
  ShieldCheck,
  Loader2,
  Download,
} from "lucide-react";
import SenderAvatar from "./SenderAvatar";
import "./ReadingPane.css";

const ReadingPane = ({
  email,
  onDownload,
  isDownloading,
  onReply,
  onMarkAsRead,
  onDeleteEmail,
  onMoveEmail,
  attachments = [],
  onDownloadAttachment,
}) => {
  if (!email) {
    return (
      <section className="reading-pane">
        <div className="reading-pane-empty">
          <Mail size={48} />
          <h3>Select an email to read</h3>
          <p>Choose a message from the list to view its contents here.</p>
        </div>
      </section>
    );
  }

  // AGAR EMAIL DOWNLOAD NAHI HUA HAI
  if (
    email.isPending ||
    email.isDownloaded === false ||
    email.isDownloaded === "false" ||
    email.isDownloaded === 0
  ) {
    return (
      <div className="reading-pane pending-download-view">
        <div className="reading-header">
          <h2>
            Message from:{" "}
            {email.from ||
              email.senderEmail ||
              email.sender ||
              "Unknown Sender"}
          </h2>
        </div>

        <div className="secure-download-box">
          <ShieldCheck size={48} className="shield-icon" />
          <h3>Secure Encrypted Payload</h3>
          <p>
            This message is waiting on the server. Download it to decrypt and
            view the contents.
          </p>

          <button
            className="download-payload-btn"
            onClick={() => onDownload(email.guid || email.id)}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <>
                <Loader2 className="spinner" size={18} /> Decrypting Message...
              </>
            ) : (
              <>
                <Download size={18} /> Download Message
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  const getFileTypeIcon = (extension) => {
    const ext = extension?.toLowerCase();
    const iconProps = { size: 20, className: "file-type-icon" };

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

  return (
    <section className="reading-pane">
      <div className="reading-pane-header">
        <div className="email-meta">
          <h2 className="email-subject-full">{email.subject}</h2>
          <div className="sender-info">
            <SenderAvatar sender={email.sender} status={email.senderStatus} />
            <div className="sender-details">
              <span className="sender-name">
                {email.from || email.senderEmail || email.sender}
              </span>
            </div>
          </div>
        </div>

      <div className="email-actions">
          {email.isDraft ? (
            <div
              style={{
                padding: "var(--space-md)",
                backgroundColor: "var(--tertiary-bg)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-medium)",
                color: "var(--text-secondary)",
                fontSize: "var(--font-size-sm)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
              }}
            >
              <FileEdit size={16} />
              <span>Click on the draft message to edit</span>
            </div>
          ) : (
            <>
              <button
                className="action-button secondary"
                onClick={() =>
                  onMarkAsRead && onMarkAsRead(email.id, !email.isRead)
                }
                title={email.isRead ? "Mark as unread" : "Mark as read"}
              >
                {email.isRead ? (
                  <>
                    <Mail size={16} /> Mark Unread
                  </>
                ) : (
                  <>
                    <Mail size={16} /> Mark Read
                  </>
                )}
              </button>

              {email.folder === "trash" || email.isTrashed ? (
                <button
                  className="action-button danger"
                  onClick={() => onDeleteEmail && onDeleteEmail(email.id, true)}
                  title="Delete permanently"
                >
                  <Trash2 size={16} /> Delete Permanently
                </button>
              ) : (
                <button
                  className="action-button danger"
                  onClick={() => onDeleteEmail && onDeleteEmail(email.id, false)}
                  title="Move to trash"
                >
                  <Trash2 size={16} /> Delete
                </button>
              )}

              <select
                className="action-button secondary folder-dropdown"
                onChange={(e) => {
                  if (e.target.value && onMoveEmail) {
                    onMoveEmail(email.id, e.target.value);
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>
                  Move to...
                </option>
                <option value="inbox">Inbox</option>
                <option value="sent">Sent</option>
                <option value="drafts">Drafts</option>
                <option value="trash">Trash</option>
              </select>

              {onReply && (
                <button
                  className="action-button secondary"
                  onClick={() => onReply(email)}
                  title="Reply to email"
                >
                  <Reply size={16} /> Reply
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="reading-pane-body">
        <div className="email-content">
          <p>{email.body || email.preview || "No content available."}</p>
        </div>

        {attachments &&
          Array.isArray(attachments) &&
          attachments.length > 0 && (
            <div className="attachments-section">
              <h4 className="attachments-title">
                <Paperclip size={16} />
                Attachments ({attachments.length})
              </h4>
              <div className="attachments-list">
                {attachments.map((attachment, index) => {
                  // FIX: Grab the actual database ID from the attachment object
                  const correctAttachmentId =
                    attachment.attachmentId || attachment.id;

                  return (
                    <div
                      key={correctAttachmentId || index}
                      className="attachment-item"
                      onClick={() =>
                        onDownloadAttachment &&
                        onDownloadAttachment(
                          email.id || email.guid,
                          correctAttachmentId,
                          attachment.name,
                        )
                      }
                    >
                      <div className="attachment-icon">
                        {getFileTypeIcon(attachment.fileExtension)}
                      </div>
                      <div className="attachment-info">
                        <div className="attachment-name">
                          {attachment.name || `Attachment ${index + 1}`}
                        </div>
                        <div className="attachment-details">
                          <span className="attachment-size">
                            {formatFileSize(attachment.size)}
                          </span>
                          {attachment.fileExtension && (
                            <span className="attachment-type">
                              {attachment.fileExtension.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="attachment-download">
                        <button
                          className="download-btn ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onDownloadAttachment) {
                              onDownloadAttachment(
                                email.id || email.guid,
                                correctAttachmentId,
                                attachment.name,
                              );
                            }
                          }}
                          title="Download attachment"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="attachments-summary">
                <span className="text-sm text-tertiary">
                  Total size:{" "}
                  {formatFileSize(
                    attachments.reduce(
                      (total, att) => total + (att.size || 0),
                      0,
                    ),
                  )}
                </span>
              </div>
            </div>
          )}
      </div>
    </section>
  );
};

export default ReadingPane;
