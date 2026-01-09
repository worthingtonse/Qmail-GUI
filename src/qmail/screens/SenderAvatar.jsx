import React from "react";

const SenderAvatar = ({ sender, status }) => {
  const getInitials = (name) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
  };

  return (
    <div className="avatar-with-coins">
      <div className="sender-avatar-circle">
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