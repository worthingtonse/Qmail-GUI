/**
 * protectedAddresses.js — QMail service addresses with special GUI handling.
 *
 * These addresses must never be black-listed (senders the user could
 * otherwise silence and then miss critical notices from), and are re-added
 * to the DRD white list on every startup so their mail is always
 * fee-waived. Serials are dotted base-256: "20.123@giga" = 20*256 + 123.
 */

export const PROTECTED_ADDRESSES = [
  {
    address: "20.123@giga",
    denomination: 4,
    serialNumber: 5243,
    firstName: "Software",
    lastName: "Support",
    description:
      "Official software support address used by the QMail development team to deliver important service, security, and update notices.",
    blacklistRefusal:
      "This address cannot be black-listed. It belongs to the software developers, who may need to send you important service and security notices.",
  },
  {
    address: "20.100@giga",
    denomination: 4,
    serialNumber: 5220,
    firstName: "Subscription",
    lastName: "Support",
    description:
      "Official subscription service address used to deliver account and subscription status notifications.",
    blacklistRefusal:
      "This address cannot be black-listed. It belongs to the subscription service, which may need to send you subscription status updates.",
  },
];

/** The protected entry matching (denomination, serialNumber), or null. */
export const findProtectedAddress = (denomination, serialNumber) =>
  PROTECTED_ADDRESSES.find(
    (entry) =>
      Number(denomination) === entry.denomination &&
      Number(serialNumber) === entry.serialNumber,
  ) || null;
