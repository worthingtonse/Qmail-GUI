import React from "react";
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
    <div className="avatar-with-coins">
      <div className="sender-avatar-circle" style={{ background: bg }}>
        <span>{getInitials(sender)}</span>
      </div>
      {status && status !== "none" && (
        <div className={`coin-badge ${status}`}>
          {status === "gold" ? "◈" : status === "silver" ? "◇" : "●"}
        </div>
      )}
    </div>
  );
};

export default SenderAvatar;