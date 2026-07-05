import { describe, expect, it } from "vitest";

import {
  classifyPaymentRequiredError,
  getPaymentRequiredCoinThreshold,
} from "./paymentRequiredError";

describe("getPaymentRequiredCoinThreshold", () => {
  it("uses a nonzero requirement reported by the backend", () => {
    expect(
      getPaymentRequiredCoinThreshold({
        walletRequired: 12,
        requiredUploadLockers: 9,
        requiredInboxFee: 1,
      }),
    ).toBe(12);
  });

  it("falls back to the legacy 9 upload plus 1 inbox CC requirement", () => {
    expect(
      getPaymentRequiredCoinThreshold({
        walletRequired: 0,
        requiredUploadLockers: 9,
        requiredInboxFee: 0,
      }),
    ).toBe(10);
  });
});

describe("classifyPaymentRequiredError", () => {
  it("asks for coins based only on the Default Wallet balance", () => {
    expect(
      classifyPaymentRequiredError({ walletBalance: 4, requiredCoins: 10 }),
    ).toMatchObject({
      code: "payment_funds_required",
      title: "Add coins to your Default Wallet",
    });
  });

  it("asks for an upgrade when the Default Wallet has enough coins", () => {
    expect(
      classifyPaymentRequiredError({ walletBalance: 10, requiredCoins: 10 }),
    ).toMatchObject({
      code: "qmail_upgrade_required",
      title: "QMail update required",
    });
  });
});
