/**
 * newRecipients.js — find typed recipients that aren't known contacts.
 *
 * After a successful send, ComposeModal offers to save any hand-typed To:
 * addresses that don't already match a contact. This is the pure logic for
 * that, kept out of the component so it can be unit-tested.
 */
import { parseQmailAddress } from "./qmailAddress";

/**
 * Build the set of serial numbers already covered by known contacts.
 * A contact is matched by parsing its address; if that fails we fall back
 * to its numeric userId (which the contacts API sets to the serial number).
 *
 * @param {Array<object>} contacts
 * @param {(contact: object) => string} getContactAddress
 * @returns {Set<number>}
 */
export function knownContactSerials(contacts, getContactAddress) {
  const serials = new Set();
  for (const contact of contacts || []) {
    const parsed = parseQmailAddress(getContactAddress(contact));
    const serial = parsed.ok ? parsed.serialNumber : Number(contact?.userId);
    if (Number.isFinite(serial)) serials.add(serial);
  }
  return serials;
}

/**
 * Return the de-duplicated list of recipients in `toList` that parse as
 * valid QMail addresses but are not already known contacts.
 *
 * @param {Array<string>} toList         raw typed To: tokens
 * @param {Array<object>} contacts       known contacts
 * @param {(contact: object) => string} getContactAddress
 * @returns {Array<{canonical: string, serialNumber: number,
 *                  denominationCode: number, denominationName: string}>}
 */
export function findUnknownRecipients(toList, contacts, getContactAddress) {
  const knownSerials = knownContactSerials(contacts, getContactAddress);
  const seen = new Set();
  const unknown = [];

  for (const raw of toList || []) {
    const parsed = parseQmailAddress(raw);
    if (!parsed.ok) continue; // already validated upstream, but be defensive
    if (knownSerials.has(parsed.serialNumber)) continue;
    if (seen.has(parsed.serialNumber)) continue;
    seen.add(parsed.serialNumber);
    unknown.push({
      canonical: parsed.canonical,
      serialNumber: parsed.serialNumber,
      denominationCode: parsed.denominationCode,
      denominationName: parsed.denominationName,
    });
  }
  return unknown;
}
