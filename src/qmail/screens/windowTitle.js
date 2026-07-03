import { BUILD_DATE, formatBuildDateForDisplay } from "../../version.js";

export const TITLE_ADDRESS_SEPARATOR_COUNT = 10;
export const TITLE_ADDRESS_SEPARATOR = Array(TITLE_ADDRESS_SEPARATOR_COUNT)
  .fill(".")
  .join("  ");

// TLD names (bit, byte, kilo, mega, giga) always display lowercase.
const lowercaseWord = (value) => String(value || "").trim().toLowerCase();

export const formatTitleQmailAddress = (address) => {
  const text = String(address || "").trim();
  if (!text) return "";

  const atIndex = text.lastIndexOf("@");
  if (atIndex === -1) return text;

  const localPart = text.slice(0, atIndex);
  const denomination = text.slice(atIndex + 1);
  return `${localPart}@${lowercaseWord(denomination)}`;
};

export const buildWindowTitle = ({ qmailAddress, buildDate = BUILD_DATE } = {}) => {
  const prefix = `QMail Alpha      Limited Functionality. Attachment Max Size and Count: 250KB and 2     ${formatBuildDateForDisplay(buildDate)}`;
  const formattedAddress = formatTitleQmailAddress(qmailAddress);

  return formattedAddress
    ? `${prefix} ${TITLE_ADDRESS_SEPARATOR} Your Qmail Address: ${formattedAddress}`
    : prefix;
};
