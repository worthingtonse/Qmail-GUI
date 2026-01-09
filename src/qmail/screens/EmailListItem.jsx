import React from "react";
import { ShieldAlert, Star } from "lucide-react";
import SenderAvatar from "./SenderAvatar";

const EmailListItem = ({ email, onSelect, isSelected, onMarkAsRead }) => (
  <div
    className={`email-list-item ${isSelected ? "selected" : ""} ${
      !email.isRead ? "unread" : ""
    }`}
    onClick={() => onSelect(email)}
  >
    {/* Read/Unread Indicator - Clickable */}
    <div 
      className="read-indicator"
      onClick={(e) => {
        e.stopPropagation();
        onMarkAsRead && onMarkAsRead(email.id, !email.isRead);
      }}
      title={email.isRead ? "Mark as unread" : "Mark as read"}
    >
      <div className={`read-dot ${email.isRead ? 'read' : 'unread'}`}></div>
    </div>

    <SenderAvatar sender={email.sender} status={email.senderStatus} />
    
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
              // Handle star toggle
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