import { parseQmailAddress } from "./address/qmailAddress";

export const MAILBOX_COIN_LIMITS = Object.freeze({
  bit: 50_000,
  byte: 1_000_000,
});

export const MAILBOX_COIN_WARNING_RATIO = 0.9;

const readCoinCount = (walletBalance) => {
  const count = Number(walletBalance?.totalCoins);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
};

export const getMailboxWalletPolicy = (qmailAddress, walletBalance) => {
  const parsedAddress = parseQmailAddress(qmailAddress);
  const coinCount = readCoinCount(walletBalance);

  if (!parsedAddress.ok) {
    return {
      status: "unknown",
      mailboxClass: null,
      coinCount,
      coinLimit: null,
      canEncryptCoins: false,
    };
  }

  const mailboxClass = parsedAddress.denominationName;
  const coinLimit = MAILBOX_COIN_LIMITS[mailboxClass] ?? null;
  const canEncryptCoins = parsedAddress.denominationCode >= 2;

  if (coinLimit === null) {
    return {
      status: "unlimited",
      mailboxClass,
      coinCount,
      coinLimit,
      canEncryptCoins,
    };
  }

  if (coinCount === null) {
    return {
      status: "unknown",
      mailboxClass,
      coinCount,
      coinLimit,
      canEncryptCoins,
    };
  }

  if (coinCount >= coinLimit) {
    return {
      status: "blocked",
      mailboxClass,
      coinCount,
      coinLimit,
      canEncryptCoins,
    };
  }

  return {
    status:
      coinCount >= coinLimit * MAILBOX_COIN_WARNING_RATIO
        ? "warning"
        : "allowed",
    mailboxClass,
    coinCount,
    coinLimit,
    canEncryptCoins,
  };
};

export const formatMailboxCoinPolicyMessage = (policy) => {
  if (policy?.status !== "blocked" && policy?.status !== "warning") {
    return "";
  }

  const mailboxClass = `.${policy.mailboxClass}`;
  const coinCount = policy.coinCount.toLocaleString();
  const coinLimit = policy.coinLimit.toLocaleString();
  const upgrade =
    "Upgrade to a .kilo address for unlimited coin storage and coin encryption.";

  if (policy.status === "blocked") {
    return (
      `Your ${mailboxClass} mailbox can store up to ${coinLimit} coins. ` +
      `This wallet currently contains ${coinCount} coins, so you cannot add more funds. ` +
      upgrade
    );
  }

  return (
    `Your ${mailboxClass} mailbox is nearing its ${coinLimit}-coin storage limit ` +
    `with ${coinCount} coins. You can add funds now, but future deposits will be ` +
    `blocked after the wallet reaches the limit. ${upgrade}`
  );
};
