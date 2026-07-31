import { describe, expect, it } from "vitest";
import {
  formatMailboxCoinPolicyMessage,
  getMailboxWalletPolicy,
} from "./walletStoragePolicy";

describe("mailbox wallet storage policy", () => {
  it("allows a .bit wallet below 90% of its 50,000 coin limit", () => {
    expect(
      getMailboxWalletPolicy("51.254@bit", { totalCoins: 44_999 }),
    ).toMatchObject({
      status: "allowed",
      mailboxClass: "bit",
      coinCount: 44_999,
      coinLimit: 50_000,
      canEncryptCoins: false,
    });
  });

  it("warns at 90% without blocking the current deposit", () => {
    expect(
      getMailboxWalletPolicy("51.254@bit", { totalCoins: 45_000 }),
    ).toMatchObject({
      status: "warning",
      coinCount: 45_000,
      coinLimit: 50_000,
    });
  });

  it("blocks another deposit when the wallet has reached its limit", () => {
    const policy = getMailboxWalletPolicy("51.254@byte", {
      totalCoins: 1_000_000,
    });

    expect(policy).toMatchObject({
      status: "blocked",
      mailboxClass: "byte",
      coinLimit: 1_000_000,
      canEncryptCoins: false,
    });
    expect(formatMailboxCoinPolicyMessage(policy)).toContain(
      "Upgrade to a .kilo address",
    );
  });

  it.each(["kilo", "mega", "giga", "epic"])(
    "gives .%s unlimited storage and coin encryption",
    (mailboxClass) => {
      expect(
        getMailboxWalletPolicy(`51.254@${mailboxClass}`, {
          totalCoins: 9_999_999,
        }),
      ).toMatchObject({
        status: "unlimited",
        mailboxClass,
        coinLimit: null,
        canEncryptCoins: true,
      });
    },
  );

  it("does not enforce a limit when identity or balance data is unavailable", () => {
    expect(getMailboxWalletPolicy("", { totalCoins: 50_000 }).status).toBe(
      "unknown",
    );
    expect(getMailboxWalletPolicy("51.254@bit", null).status).toBe("unknown");
  });
});
