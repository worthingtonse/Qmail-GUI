/* eslint-disable react/prop-types */
import { avatarColorFromString } from "./avatarColor";
import QmailCartoucheAvatar from "./QmailCartoucheAvatar";

const SenderAvatar = ({ sender, email, status, senderSn, senderDenominationCode }) => {
  // BUG-06 FIX: Guard against undefined/null sender
  const getInitials = (name) => {
    if (!name) return "?";
    // Show "?" for unknown/unresolved senders
    if (name === "Unknown Sender" || name === "Unknown" || name.startsWith("Unknown")) return "?";
    // Addresses are dotted decimal ("51.254@bit") — show the first
    // letter/digit (a contact name gives a letter, an address a digit).
    const match = name.match(/[A-Za-z0-9]/);
    return match ? match[0].toUpperCase() : "?";
  };

  const colorKey = email || sender || "";
  const { bg } = avatarColorFromString(colorKey);
  const cartoucheAvatar = (
    <QmailCartoucheAvatar
      serialNumber={senderSn}
      denominationCode={senderDenominationCode}
    />
  );

  return (
    <div className="email-list-pane__avatar">
      {cartoucheAvatar || (
        <div
          className="email-list-pane__avatar-circle"
          style={{ "--email-list-pane-avatar-bg": bg }}
        >
          <span>{getInitials(sender)}</span>
        </div>
      )}
      {status && status !== "none" && (
        <div className={`email-list-pane__coin-badge email-list-pane__coin-badge--${status}`}>
          {status === "gold" ? "◈" : status === "silver" ? "◇" : "●"}
        </div>
      )}
    </div>
  );
};

export default SenderAvatar;
