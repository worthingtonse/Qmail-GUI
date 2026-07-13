/* eslint-disable react/prop-types */
import { avatarColorFromString } from "./avatarColor";
import { addressDerivedSymbols, useDrdSymbols } from "../avatar/drdSymbols";
import { getQmailAvatarTierName } from "../avatar/qmailAvatar";
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
  const symbols = useDrdSymbols(senderDenominationCode, senderSn);
  // Users without chosen DRD symbols still get a cartouche: the symbols
  // derive from the address's serial bytes (high byte top, low byte
  // bottom). The letter-circle only remains for rows with no usable
  // address (no serial / unknown denomination).
  const shownSymbols =
    getQmailAvatarTierName(senderDenominationCode) !== null
      ? symbols ?? addressDerivedSymbols(senderSn)
      : null;

  return (
    <div className="email-list-pane__avatar">
      {shownSymbols ? (
        <QmailCartoucheAvatar
          firstSymbol={shownSymbols.firstSymbol}
          secondSymbol={shownSymbols.secondSymbol}
          denominationCode={senderDenominationCode}
          serialNumber={senderSn}
        />
      ) : (
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
