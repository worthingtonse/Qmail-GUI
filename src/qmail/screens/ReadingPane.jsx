import React from "react";
import { Mail, Trash2, Reply, RefreshCw, Paperclip, FileText, File, Sheet, Image, Archive, FileEdit } from "lucide-react";
import SenderAvatar from "./SenderAvatar";
import "./ReadingPane.css";

const ReadingPane = ({ email, onReply, onMarkAsDownloaded, onMarkAsRead, onDeleteEmail, onMoveEmail, attachments = [] }) => {
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

  const handleDownload = () => {
    console.log("Downloading email:", email.id);
    onMarkAsDownloaded(email.id);
  };

  const handleAttachmentDownload = (attachment) => {
    console.log("Downloading attachment:", attachment.attachmentId || attachment.name);
    // Here you would implement actual attachment download
    // You could use the attachment ID to fetch the actual file content
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  const getFileTypeIcon = (extension) => {
    const ext = extension?.toLowerCase();
    const iconProps = { size: 20, className: "file-type-icon" };
    
    switch (ext) {
      case 'pdf': 
        return <FileText {...iconProps} />;
      case 'doc':
      case 'docx': 
        return <FileText {...iconProps} />;
      case 'xls':
      case 'xlsx': 
        return <Sheet {...iconProps} />;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif': 
        return <Image {...iconProps} />;
      case 'zip':
      case 'rar': 
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
              <span className="sender-name">{email.sender}</span>
              <span className="sender-email">{email.senderEmail}</span>
              <span className="email-time">{email.timestamp}</span>
            </div>
          </div>
        </div>
        
        {/* Action buttons - different for drafts vs regular emails */}
        <div className="email-actions">
          {email.isDraft ? (
            // Draft ke liye hint message
            <div style={{
              padding: 'var(--space-md)',
              backgroundColor: 'var(--tertiary-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-sm)'
            }}>
              <FileEdit size={16} />
              <span>Click on the draft message to edit</span>
            </div>
          ) : (
            // Regular emails ke liye saare buttons
            <>
              {/* Mark as Read/Unread Button */}
              <button 
                className="action-button secondary" 
                onClick={() => onMarkAsRead && onMarkAsRead(email.id, !email.isRead)}
                title={email.isRead ? "Mark as unread" : "Mark as read"}
              >
                {email.isRead ? (
                  <>
                    <Mail size={16} />
                    Mark Unread
                  </>
                ) : (
                  <>
                    <Mail size={16} />
                    Mark Read
                  </>
                )}
              </button>

              {/* Delete Button */}
              <button 
                className="action-button danger" 
                onClick={() => onDeleteEmail && onDeleteEmail(email.id)}
                title="Move to trash"
              >
                <Trash2 size={16} />
                Delete
              </button>

              {/* Move to Folder Dropdown */}
              <select
                className="action-button secondary folder-dropdown"
                onChange={(e) => {
                  if (e.target.value && onMoveEmail) {
                    onMoveEmail(email.id, e.target.value);
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Move to...</option>
                <option value="inbox">Inbox</option>
                <option value="sent">Sent</option>
                <option value="drafts">Drafts</option>
                <option value="trash">Trash</option>
              </select>

              {/* Reply Button */}
              {onReply && (
                <button 
                  className="action-button secondary" 
                  onClick={() => onReply(email)}
                  title="Reply to email"
                >
                  <Reply size={16} />
                  Reply
                </button>
              )}

              {/* Download Button */}
              {!email.isDownloaded && onMarkAsDownloaded && (
                <button 
                  className="action-button primary" 
                  onClick={handleDownload}
                  title="Download email"
                >
                  <Mail size={16} />
                  Download
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="reading-pane-body">
        {email.isDownloaded || email.isDraft ? (
          <>
            <div className="email-content">
              <p>{email.body || email.preview || "This email content is not available."}</p>
            </div>
            
            {/* FULL ATTACHMENTS IMPLEMENTATION */}
            {attachments && attachments.length > 0 && (
              <div className="attachments-section">
                <h4 className="attachments-title">
                  <Paperclip size={16} />
                  Attachments ({attachments.length})
                </h4>
                <div className="attachments-list">
                  {attachments.map((attachment, index) => (
                    <div 
                      key={attachment.attachmentId || index} 
                      className="attachment-item"
                      onClick={() => handleAttachmentDownload(attachment)}
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
                            handleAttachmentDownload(attachment);
                          }}
                          title="Download attachment"
                        >
                          <Paperclip size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Attachment Summary */}
                <div className="attachments-summary">
                  <span className="text-sm text-tertiary">
                    Total size: {formatFileSize(
                      attachments.reduce((total, att) => total + (att.size || 0), 0)
                    )}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="email-not-downloaded">
            <div className="download-status">
              <Mail size={48} />
              <h3>Email Not Downloaded</h3>
              <p>Click the download button above to retrieve this email's content.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default ReadingPane;
