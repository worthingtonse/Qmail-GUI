/* eslint-disable react/prop-types */
import { avatarColorFromString } from "./avatarColor";

const SenderAvatar = ({ sender, email, status }) => {
  // BUG-06 FIX: Guard against undefined/null sender
  const getInitials = (name) => {
    if (!name) return "?";
    // Show "?" for unknown/unresolved senders
    if (name === "Unknown Sender" || name === "Unknown" || name.startsWith("Unknown")) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  const colorKey = email || sender || "";
  const { bg } = avatarColorFromString(colorKey);

  return (
    <div className="email-list-pane__avatar">
      <div
        className="email-list-pane__avatar-circle"
        style={{ "--email-list-pane-avatar-bg": bg }}
      >
        <span>{getInitials(sender)}</span>
      </div>
      {status && status !== "none" && (
        <div className={`email-list-pane__coin-badge email-list-pane__coin-badge--${status}`}>
          {status === "gold" ? "◈" : status === "silver" ? "◇" : "●"}
        </div>
      )}
    </div>
  );
};

export default SenderAvatar;