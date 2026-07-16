// Pure helpers for deriving the display identity (sender for incoming mail,
// primary recipient for Sent/Drafts) shown by EmailListItem, ReadingPane, and
// SenderAvatar. Extracted from QMailDashboard so the logic — especially the
// name-vs-address display selection — can be unit-tested in isolation.
//
// Display contract (see EmailListItem / ReadingPane):
//   - senderDisplayName    : resolved contact name, or "" when the party is
//                            not a saved contact. The UI shows this as the
//                            primary label and falls back to the address when
//                            it is empty.
//   - senderDisplayAddress : the QMail address, surfaced on hover and by the
//                            copy button (never the contact name/metadata).

export const QMAIL_DENOMINATION_CODE_TO_VALUE = {
  0: 1,
  1: 10,
  2: 100,
  3: 1000,
  4: 10000,
  5: 100000, // epic
};

// Folders whose messages the user SENT — for these we display the recipient
// ("To"), not the sender (which would be the user themselves).
export const OUTGOING_FOLDERS = new Set(["sent", "drafts"]);

export const readNumericSenderField = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
};

export const isSerialNumberText = (value) =>
  typeof value === "string" && /^\d+$/.test(value.trim());

export const getEmailSenderSn = (email = {}) => {
  const sn = readNumericSenderField(email.sender_sn, email.senderSn);
  return sn && sn > 0 ? sn : null;
};

export const getEmailSenderDenominationCode = (email = {}) => {
  const code = readNumericSenderField(
    email.sender_denomination_code,
    email.senderDenominationCode,
  );
  if (code !== null && code >= 0 && code <= 5) return code;

  const denomination = readNumericSenderField(
    email.sender_denomination,
    email.senderDenomination,
  );
  const codeFromValue = Object.entries(QMAIL_DENOMINATION_CODE_TO_VALUE).find(
    ([, value]) => value === denomination,
  );
  return codeFromValue ? Number(codeFromValue[0]) : null;
};

export const getEmailSenderDenomination = (email = {}) => {
  const denomination = readNumericSenderField(
    email.sender_denomination,
    email.senderDenomination,
  );
  if (denomination && denomination > 0) return denomination;

  const code = getEmailSenderDenominationCode(email);
  return code !== null ? QMAIL_DENOMINATION_CODE_TO_VALUE[code] : null;
};

export const getEmailSenderAddress = (email = {}, fallback = "Unknown Sender") => {
  const address = [
    email.sender_address,
    email.senderAddress,
    email.senderEmail,
    email.from,
    email.sender,
  ].find(
    (value) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      !isSerialNumberText(value) &&
      !/^SN#/i.test(value.trim()) &&
      !/^Unknown( Sender)?$/i.test(value.trim()),
  );
  if (address) return address.trim();

  const senderSn = getEmailSenderSn(email);
  if (senderSn) return String(senderSn);

  const serialText = [email.senderEmail, email.from, email.sender].find(
    (value) => typeof value === "string" && isSerialNumberText(value),
  );
  return serialText ? serialText.trim() : fallback;
};

export const getEmailSenderFields = (email = {}, fallback = "Unknown Sender") => {
  const senderSn = getEmailSenderSn(email);
  const senderDenomination = getEmailSenderDenomination(email);
  const senderDenominationCode = getEmailSenderDenominationCode(email);
  const sender = getEmailSenderAddress(email, senderSn ? String(senderSn) : fallback);
  const senderEmail = sender && (sender !== fallback || senderSn) ? sender : "";
  // Resolved contact name from the backend (empty when not a saved contact).
  const senderName =
    typeof email.senderName === "string" && email.senderName.trim()
      ? email.senderName.trim()
      : typeof email.sender_name === "string"
      ? email.sender_name.trim()
      : "";

  return {
    sender,
    senderEmail,
    from: senderEmail,
    sender_address: senderEmail,
    // Name to show as the primary label; address to reveal on hover / copy.
    // senderDisplayName is empty for non-contacts so the UI falls back to the
    // address.
    senderDisplayName: senderName,
    senderDisplayAddress: senderEmail || (senderSn ? String(senderSn) : ""),
    senderSn,
    sender_sn: senderSn,
    senderDenomination,
    sender_denomination: senderDenomination,
    senderDenominationCode,
    sender_denomination_code: senderDenominationCode,
  };
};

// Build the "sender_*" display fields that EmailListItem / ReadingPane /
// SenderAvatar all read. For incoming mail these are the real sender; for
// outgoing mail (Sent/Drafts) we map the primary RECIPIENT into the same
// sender-shaped fields so the existing display components show the
// recipient without any per-component folder branching.
export const getEmailDisplayIdentityFields = (email = {}, folder) => {
  if (!OUTGOING_FOLDERS.has(folder)) {
    return getEmailSenderFields(email);
  }

  const recipientSn =
    readNumericSenderField(email.recipientSn, email.recipient_sn) || null;
  const recipientCode = (() => {
    const code = readNumericSenderField(
      email.recipientDenominationCode,
      email.recipient_denomination_code,
    );
    return code !== null && code >= 0 && code <= 5 ? code : null;
  })();
  const recipientAddress =
    typeof email.recipientAddress === "string" && email.recipientAddress.trim()
      ? email.recipientAddress.trim()
      : typeof email.recipient_address === "string" && email.recipient_address.trim()
      ? email.recipient_address.trim()
      : recipientSn
      ? String(recipientSn)
      : "";
  const extraCount =
    (readNumericSenderField(email.recipientCount, email.recipient_count) || 0) - 1;
  // Resolved recipient contact name from the backend (empty when the primary
  // recipient is not a saved contact).
  const recipientName =
    typeof email.recipientName === "string" && email.recipientName.trim()
      ? email.recipientName.trim()
      : typeof email.recipient_name === "string"
      ? email.recipient_name.trim()
      : "";
  // The primary label prefers the contact name, falling back to the address.
  const primaryLabel = recipientName || recipientAddress || "Unknown Recipient";
  // When a message has multiple recipients, hint at it after the first.
  const displayName =
    extraCount > 0 ? `${primaryLabel} +${extraCount}` : primaryLabel;
  // The visible name label carries the multi-recipient "+N" hint. The address
  // used for hover / copy is the bare primary recipient only — copied
  // addresses must stay clean (no "+N" suffix). When the recipient is not a
  // saved contact, a multi-recipient row still needs the hint on its visible
  // label, so fall back to the address-based label; consumers render
  // senderDisplayName || senderDisplayAddress and would otherwise drop "+N".
  const displayNameLabel = recipientName
    ? extraCount > 0
      ? `${recipientName} +${extraCount}`
      : recipientName
    : extraCount > 0
      ? `${primaryLabel} +${extraCount}`
      : "";
  const displayAddress =
    recipientAddress || (recipientSn ? String(recipientSn) : "");

  return {
    sender: displayName,
    senderEmail: recipientAddress,
    from: recipientAddress,
    sender_address: recipientAddress,
    senderDisplayName: displayNameLabel,
    senderDisplayAddress: displayAddress,
    senderSn: recipientSn,
    sender_sn: recipientSn,
    senderDenomination: null,
    sender_denomination: null,
    senderDenominationCode: recipientCode,
    sender_denomination_code: recipientCode,
  };
};
