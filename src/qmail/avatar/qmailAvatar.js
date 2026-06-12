/**
 * qmailAvatar.js — cartouche avatar model for dotted-decimal QMail addresses.
 *
 * A QMail address is a 3-byte serial number + denomination code (see
 * src/qmail/address/qmailAddress.js). The cartouche mirrors the address's
 * zero-dropping: one symbol per significant serial byte (1-3 symbols),
 * drawn from the 256 numbered SVGs in public/qmail-avatars/NewAvatars/
 * (each baked with its own color — scripts/bake-newavatar-colors.mjs).
 * The frame color encodes the denomination (bit/byte/kilo/mega/giga).
 */

const QMAIL_AVATAR_TIERS = ["bit", "byte", "kilo", "mega", "giga"];

const normalizeSerialNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  // Serial 0 is reserved; anything above 3 bytes is not a QMail serial.
  if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > 0xffffff) {
    return null;
  }
  return numberValue;
};

const joinBasePath = (pathSuffix) => {
  const baseUrl = import.meta.env?.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${pathSuffix}`;
};

/**
 * Symbol indices for a serial number — one per significant byte, high to
 * low, mirroring the address's dropped leading zeros:
 *   0x0033FE (51.254@...) -> [51, 254]      (2 symbols)
 *   0x0100FE (1.0.254@..) -> [1, 0, 254]    (3 symbols; inner zeros stay)
 *   0x0000FE (254@...)    -> [254]          (1 symbol)
 * Returns null for serial numbers that are not valid QMail serials.
 */
export const getQmailAvatarSymbolIndices = (serialNumber) => {
  const sn = normalizeSerialNumber(serialNumber);
  if (sn === null) return null;

  const b1 = (sn >> 16) & 0xff;
  const b2 = (sn >> 8) & 0xff;
  const b3 = sn & 0xff;

  if (b1 !== 0) return [b1, b2, b3];
  if (b2 !== 0) return [b2, b3];
  return [b3];
};

export const getQmailAvatarTierName = (denominationCode) => {
  if (denominationCode === null || denominationCode === undefined || denominationCode === "") {
    return null;
  }

  const normalizedCode = Number(denominationCode);
  if (!Number.isInteger(normalizedCode) || normalizedCode < 0 || normalizedCode >= QMAIL_AVATAR_TIERS.length) {
    return null;
  }

  return QMAIL_AVATAR_TIERS[normalizedCode];
};

/**
 * Asset href for a cartouche layer.
 *   getQmailAvatarAssetHref("frame", "kilo") -> .../qmail-avatars/frames/kilo.svg
 *   getQmailAvatarAssetHref("symbol", 51)    -> .../qmail-avatars/NewAvatars/051.svg
 */
export const getQmailAvatarAssetHref = (kind, identifier) => {
  if (kind === "frame") {
    return joinBasePath(`qmail-avatars/frames/${identifier}.svg`);
  }
  if (kind === "symbol") {
    return joinBasePath(
      `qmail-avatars/NewAvatars/${String(identifier).padStart(3, "0")}.svg`,
    );
  }
  return null;
};

export const getQmailAvatarModel = ({ serialNumber, denominationCode }) => {
  const tierName = getQmailAvatarTierName(denominationCode);
  const symbolIndices = getQmailAvatarSymbolIndices(serialNumber);
  if (!tierName || !symbolIndices) return null;

  return { tierName, symbolIndices };
};
