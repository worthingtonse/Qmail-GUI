export const PAYMENT_REQUIRED_STATUS = 169;

const LEGACY_UPLOAD_FEE_CC = 1;
const LEGACY_INBOX_FEE_CC = 1;
const DEFAULT_UPLOAD_SERVER_COUNT = 9;

const positiveNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};

export const getPaymentRequiredCoinThreshold = ({
  walletRequired,
  requiredUploadLockers,
  requiredInboxFee,
} = {}) => {
  const reportedRequirement = positiveNumber(walletRequired);
  if (reportedRequirement > 0) return reportedRequirement;

  const uploadCount =
    positiveNumber(requiredUploadLockers) || DEFAULT_UPLOAD_SERVER_COUNT;
  const inboxFee =
    positiveNumber(requiredInboxFee) || LEGACY_INBOX_FEE_CC;
  return uploadCount * LEGACY_UPLOAD_FEE_CC + inboxFee;
};

const formatCoins = (value) => {
  const numeric = Math.max(0, Number(value) || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
};

export const classifyPaymentRequiredError = ({
  walletBalance,
  requiredCoins,
} = {}) => {
  const balance = Math.max(0, Number(walletBalance) || 0);
  const requirement = Math.max(1, Number(requiredCoins) || 1);

  if (balance < requirement) {
    const shortfall = requirement - balance;
    return {
      code: "payment_funds_required",
      title: "Add coins to your Default Wallet",
      message:
        `This send requires at least ${formatCoins(requirement)} CC in your ` +
        `Default Wallet. Add ${formatCoins(shortfall)} CC, then try again.`,
    };
  }

  return {
    code: "qmail_upgrade_required",
    title: "QMail update required",
    message:
      "Your Default Wallet has enough coins, but the server rejected the payment format. Upgrade QMail to the latest version, then try again.",
  };
};
