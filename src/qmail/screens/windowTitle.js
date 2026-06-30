import { BUILD_DATE, formatBuildDateForDisplay } from "../../version";

export const TITLE_ADDRESS_GAP = 20;

const capitalizeWord = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
};

export const formatTitleQmailAddress = (address) => {
  const text = String(address || "").trim();
  if (!text) return "";

  const atIndex = text.lastIndexOf("@");
  if (atIndex === -1) return text;

  const localPart = text.slice(0, atIndex);
  const denomination = text.slice(atIndex + 1);
  return `${localPart}@${capitalizeWord(denomination)}`;
};

export const buildWindowTitle = ({ qmailAddress, buildDate = BUILD_DATE } = {}) => {
  const prefix = `QMail Version ${formatBuildDateForDisplay(buildDate)}`;
  const formattedAddress = formatTitleQmailAddress(qmailAddress);

  return formattedAddress
    ? `${prefix}${" ".repeat(TITLE_ADDRESS_GAP)}${formattedAddress}`
    : prefix;
};
