const QMAIL_AVATAR_TIERS = ["bit", "byte", "kilo", "mega", "giga"];

const normalizePositiveInteger = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) return null;
  return numberValue;
};

const joinBasePath = (pathSuffix) => {
  const baseUrl = import.meta.env?.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${pathSuffix}`;
};

export const getQmailAvatarWordIndices = (serialNumber) => {
  const normalizedSerialNumber = normalizePositiveInteger(serialNumber);
  if (normalizedSerialNumber === null) return null;

  // The serial number is a 3-byte value. The low byte selects the noun and
  // the middle byte selects the adjective (each has a 256-entry word list).
  // The high (third) byte has no word list; it is rendered as a decimal
  // number prefixed in front of the adjective in the address, e.g.
  // serial 0x01DFFF -> "@1.silk.square.kilo". numberPrefix is 0 when the
  // serial fits in two bytes (no prefix shown).
  return {
    numberPrefix: (normalizedSerialNumber >> 16) & 0xff,
    adjectiveIndex: (normalizedSerialNumber >> 8) & 0xff,
    nounIndex: normalizedSerialNumber & 0xff,
  };
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

export const getQmailAvatarAssetHref = (kind, identifier) => {
  if (kind === "frame") {
    return joinBasePath(`qmail-avatars/frames/${identifier}.svg`);
  }

  return joinBasePath(`qmail-avatars/${kind}/${String(identifier).padStart(3, "0")}.svg`);
};

export const getQmailAvatarModel = ({ serialNumber, denominationCode }) => {
  const tierName = getQmailAvatarTierName(denominationCode);
  const wordIndices = getQmailAvatarWordIndices(serialNumber);
  if (!tierName || !wordIndices) return null;

  return {
    tierName,
    ...wordIndices,
  };
};
