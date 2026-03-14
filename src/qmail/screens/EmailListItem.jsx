import React from "react";
import { ShieldAlert, Star, Mail, MailOpen, Trash2 } from "lucide-react";
import SenderAvatar from "./SenderAvatar";

const EmailListItem = ({ email, onSelect, isSelected, onMarkAsRead, onToggleStar, onDeleteEmail, isChecked, onCheck }) => (
  <div
    className={`email-list-item ${isSelected ? "selected" : ""} ${
      !email.isRead ? "unread" : ""
    }`}
    onClick={() => onSelect(email)}
  >
    {/* Left column: draft checkbox OR envelope + trash icons stacked */}
    {email.isDraft ? (
      <div
        className="draft-checkbox-container"
        onClick={(e) => {
          e.stopPropagation();
          onCheck && onCheck(email.id);
        }}
        title="Select for deletion"
      >
        <input
          type="checkbox"
          className="draft-checkbox"
          checked={!!isChecked}
          readOnly
        />
      </div>
    ) : (
    <div className="email-action-column">
      <div
        className="read-indicator"
        onClick={(e) => {
          e.stopPropagation();
          onMarkAsRead && onMarkAsRead(email.id, !email.isRead);
        }}
        title={email.isRead ? "Mark as unread" : "Mark as read"}
      >
        {email.isRead ? (
          <MailOpen size={16} className="envelope-icon read" />
        ) : (
          <Mail size={16} className="envelope-icon unread" />
        )}
      </div>
      <div
        className="list-trash-indicator"
        onClick={(e) => {
          e.stopPropagation();
          onDeleteEmail && onDeleteEmail(email.id, false);
        }}
        title="Move to trash"
      >
        <Trash2 size={14} className="list-trash-icon" />
      </div>
    </div>
    )}

    <SenderAvatar sender={email.sender} email={email.senderEmail || email.from} status={email.senderStatus} />

    <div className="email-details">
      <div className="email-sender-row">
        <div className="email-sender-left">
          <span className="email-sender">{email.sender}</span>
          {email.annoyanceReported && (
            <ShieldAlert
              size={14}
              className="annoyance-icon"
              title="Reported as annoying"
            />
          )}
        </div>
        <div className="email-sender-right">
          <span className="email-timestamp">{email.timestamp}</span>
          <Star
            size={16}
            className={`star-icon ${email.starred ? "starred" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar && onToggleStar(email.id);
            }}
          />
        </div>
      </div>
      <div className="email-subject">{email.subject}</div>
      <div className="email-preview">{email.preview}</div>
      {email.tags && email.tags.length > 0 && (
        <div className="email-tags">
          {email.tags.map((tag) => (
            <span key={tag} className={`tag tag-${tag}`}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default EmailListItem;
