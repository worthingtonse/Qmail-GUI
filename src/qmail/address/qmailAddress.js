/**
 * qmailAddress.js - QMail dotted-decimal address parsing & formatting.
 *
 * This is the GUI mirror of rest_core's src/qmail/qmail_contacts.c
 * (qmail_address_parse_core / qmail_address_build). Keep the two in sync:
 * same accepted forms, same rules, same error messages.
 *
 * An address encodes 4 bytes: a 3-byte serial number plus a 1-byte
 * denomination code (0=bit, 1=byte, 2=kilo, 3=mega, 4=giga). Accepted
 * input forms (leading zero serial bytes may be dropped; groups are
 * counted from the right):
 *
 *   0.51.254.0     full numeric: 3 serial bytes + denomination code
 *   51.254.0       leading zero serial bytes dropped
 *   51.254@bit     serial bytes + '@' + denomination word
 *
 * Canonical display form is the '@word' form, e.g. "51.254@bit".
 * Serial number 0 is reserved and never a valid address. Addresses
 * carry no name part; names live in user-created contacts.
 */

export const QMAIL_DENOMINATION_NAMES = ["bit", "byte", "kilo", "mega", "giga"];

/** Example shown to users in every format error message (mirrors C). */
export const QMAIL_ADDRESS_FORMS_HINT =
  "a valid address looks like 51.254@bit, 51.254.0 or 0.51.254.0";

/* Mirrors QMAIL_MAX_ADDRESS_LEN in rest_core. */
const MAX_ADDRESS_LENGTH = 255;

/**
 * Denomination code (0..4) -> word ("bit".."giga"), or null when out of
 * range (including the Phase-1-rejected fractional codes like 0xFF).
 */
export function denominationCodeToName(code) {
  if (!Number.isInteger(code) || code < 0 || code >= QMAIL_DENOMINATION_NAMES.length) {
    return null;
  }
  return QMAIL_DENOMINATION_NAMES[code];
}

/**
 * Denomination word -> code (case-insensitive), or null when unknown.
 */
export function denominationNameToCode(name) {
  if (typeof name !== "string") return null;
  const index = QMAIL_DENOMINATION_NAMES.indexOf(name.toLowerCase());
  return index === -1 ? null : index;
}

function failure(error) {
  return { ok: false, error };
}

/**
 * Parse a QMail address in any accepted form.
 *
 * Surrounding whitespace is trimmed first (divergence from the C core,
 * which requires the caller to trim).
 *
 * @param {string} input
 * @returns {{ok: true, serialNumber: number, serialBytes: [number, number, number],
 *            denominationCode: number, denominationName: string, canonical: string}
 *          | {ok: false, error: string}}
 *          On failure, `error` is a user-facing reason identical to the
 *          message rest_core returns for the same input.
 */
export function parseQmailAddress(input) {
  const address = typeof input === "string" ? input.trim() : "";

  if (address === "") {
    return failure("Address is empty");
  }
  if (address.startsWith("@")) {
    return failure(`Address must not start with '@'; ${QMAIL_ADDRESS_FORMS_HINT}`);
  }
  if (address.length > MAX_ADDRESS_LENGTH) {
    return failure(`Address is too long; ${QMAIL_ADDRESS_FORMS_HINT}`);
  }

  /* Split off the '@word' denomination part if present. */
  let numericPart = address;
  let denomWord = null;
  const atIndex = address.indexOf("@");
  if (atIndex !== -1) {
    if (address.indexOf("@", atIndex + 1) !== -1) {
      return failure(`Address has more than one '@'; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    numericPart = address.slice(0, atIndex);
    denomWord = address.slice(atIndex + 1);
    if (denomWord === "") {
      return failure(`Missing denomination after '@'; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
  }

  /* Split the numeric part into decimal groups (0..255 each). Mirror the
   * C scanner's check order exactly: empty group, then group width, then
   * digits-only, then value range, then group count. A trailing '.'
   * surfaces as an empty LAST segment after at least one good group,
   * which gets the same dedicated message as in C. */
  const MAX_GROUPS = 4;
  const segments = numericPart.split(".");
  const groups = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "") {
      if (i === segments.length - 1 && groups.length > 0) {
        return failure(`Address must not end with '.'; ${QMAIL_ADDRESS_FORMS_HINT}`);
      }
      return failure(`Address has an empty number group; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    if (segment.length > 3) {
      return failure(`Each number in the address must be 0-255; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    if (!/^[0-9]+$/.test(segment)) {
      return failure(`Address numbers may only contain digits; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    const value = Number(segment);
    if (value > 0xff) {
      return failure(`Each number in the address must be 0-255; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    if (groups.length >= MAX_GROUPS) {
      return failure(`Address has too many number groups; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    groups.push(value);
  }

  /* Determine serial bytes and denomination from the groups. */
  let serialGroups;
  let denominationCode;

  if (denomWord !== null) {
    /* '@word' form: every group is a serial byte. */
    if (groups.length > 3) {
      return failure(`Address has too many number groups before '@'; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    const code = denominationNameToCode(denomWord);
    if (code === null) {
      return failure("Denomination after '@' must be bit, byte, kilo, mega or giga");
    }
    serialGroups = groups;
    denominationCode = code;
  } else {
    /* All-numeric form: the LAST group is the denomination code. */
    if (groups.length < 2) {
      return failure(`Address needs a serial number and a denomination; ${QMAIL_ADDRESS_FORMS_HINT}`);
    }
    serialGroups = groups.slice(0, -1);
    const denomValue = groups[groups.length - 1];

    /* Phase 1: whole-cc notes only (codes 0..4). Fractional codes
     * (0xFF=.1cc, 0xFE=.01cc, ...) are rejected here on purpose. */
    if (denomValue > 4) {
      return failure("Denomination code must be 0-4 (bit, byte, kilo, mega, giga)");
    }
    denominationCode = denomValue;
  }

  /* Serial bytes are right-aligned: the last serial group is always the
   * low byte, so "51.254" and "0.51.254" mean the same serial number. */
  let serialNumber = 0;
  for (const group of serialGroups) {
    serialNumber = serialNumber * 256 + group;
  }

  if (serialNumber === 0) {
    return failure("Serial number 0 is reserved and not a valid address");
  }

  const serialBytes = [
    Math.floor(serialNumber / 65536) % 256,
    Math.floor(serialNumber / 256) % 256,
    serialNumber % 256,
  ];

  return {
    ok: true,
    serialNumber,
    serialBytes,
    denominationCode,
    denominationName: QMAIL_DENOMINATION_NAMES[denominationCode],
    canonical: formatQmailAddress(serialNumber, denominationCode),
  };
}

/**
 * Build the canonical QMail address string: dotted-decimal serial bytes
 * with leading zero bytes dropped, then '@' and the denomination word.
 *
 *   formatQmailAddress(0x0033fe, 0) -> "51.254@bit"
 *   formatQmailAddress(0x0100fe, 4) -> "1.0.254@giga"
 *   formatQmailAddress(0x0000fe, 1) -> "254@byte"
 *
 * Returns null for unusable input (serial 0 or > 0xFFFFFF, denomination
 * outside 0..4) so render paths can fall back gracefully instead of
 * throwing on malformed network data.
 *
 * @param {number|string} serialNumber  3-byte serial number (1..0xFFFFFF)
 * @param {number|string} denominationCode  Denomination code (0..4)
 * @returns {string|null}
 */
export function formatQmailAddress(serialNumber, denominationCode) {
  const sn = typeof serialNumber === "string" ? Number(serialNumber) : serialNumber;
  const code = typeof denominationCode === "string" ? Number(denominationCode) : denominationCode;

  if (!Number.isInteger(sn) || sn <= 0 || sn > 0xffffff) return null;

  const word = denominationCodeToName(code);
  if (word === null) return null;

  const b1 = Math.floor(sn / 65536) % 256;
  const b2 = Math.floor(sn / 256) % 256;
  const b3 = sn % 256;

  if (b1 !== 0) return `${b1}.${b2}.${b3}@${word}`;
  if (b2 !== 0) return `${b2}.${b3}@${word}`;
  return `${b3}@${word}`;
}

/**
 * Convenience boolean check (compose-field validation etc.).
 */
export function isValidQmailAddress(input) {
  return parseQmailAddress(input).ok;
}
