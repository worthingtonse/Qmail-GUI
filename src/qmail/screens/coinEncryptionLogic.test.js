import { describe, expect, it } from "vitest";

import {
  addCounts,
  buildCompletionSummary,
  canProceedAfterLogin,
  dedupeWallets,
  emptyAggregateCounts,
  getEncryptionCounts,
  needsPasswordForAction,
} from "./coinEncryptionLogic";

const KEY_STATES = [
  "none",
  "establishing_ready",
  "establishing",
  "candidate",
  "confirmed",
];

const ACTIONS = ["encrypt", "decrypt", "unlock"];

describe("getEncryptionCounts", () => {
  it("reads counts from data.result.counts", () => {
    expect(
      getEncryptionCounts({
        data: {
          result: {
            counts: {
              processed: 10,
              encrypted: 4,
              decrypted: 0,
              skipped: 2,
              errors: 1,
              already_target: 3,
              skipped_multi: 1,
              conflict: 0,
            },
          },
        },
      }),
    ).toEqual({
      processed: 10,
      encrypted: 4,
      decrypted: 0,
      skipped: 2,
      errors: 1,
      alreadyTarget: 3,
      skippedMulti: 1,
      conflict: 0,
    });
  });

  it("reads counts from data.result.data.counts", () => {
    expect(
      getEncryptionCounts({
        data: {
          result: {
            data: {
              counts: {
                processed: 5,
                encrypted: 5,
                decrypted: 0,
                skipped: 0,
                errors: 0,
                already_target: 0,
                skipped_multi: 0,
                conflict: 1,
              },
            },
          },
        },
      }),
    ).toEqual({
      processed: 5,
      encrypted: 5,
      decrypted: 0,
      skipped: 0,
      errors: 0,
      alreadyTarget: 0,
      skippedMulti: 0,
      conflict: 1,
    });
  });

  it("reads counts from data.counts", () => {
    expect(
      getEncryptionCounts({
        data: {
          counts: {
            processed: 2,
            encrypted: 0,
            decrypted: 2,
            skipped: 1,
            errors: 0,
            already_target: 0,
            skipped_multi: 0,
            conflict: 0,
          },
        },
      }),
    ).toEqual({
      processed: 2,
      encrypted: 0,
      decrypted: 2,
      skipped: 1,
      errors: 0,
      alreadyTarget: 0,
      skippedMulti: 0,
      conflict: 0,
    });
  });

  it("returns null for missing or non-object counts", () => {
    expect(getEncryptionCounts(null)).toBeNull();
    expect(getEncryptionCounts(undefined)).toBeNull();
    expect(getEncryptionCounts({})).toBeNull();
    expect(getEncryptionCounts({ data: {} })).toBeNull();
    expect(getEncryptionCounts({ data: { counts: "nope" } })).toBeNull();
    expect(getEncryptionCounts({ data: { counts: null } })).toBeNull();
  });

  it("coerces non-numeric fields to 0 and maps snake_case extras", () => {
    expect(
      getEncryptionCounts({
        data: {
          counts: {
            processed: "3",
            encrypted: null,
            decrypted: undefined,
            skipped: "x",
            errors: {},
            already_target: "7",
            skipped_multi: false,
            conflict: "2",
          },
        },
      }),
    ).toEqual({
      processed: 3,
      encrypted: 0,
      decrypted: 0,
      skipped: 0,
      errors: 0,
      alreadyTarget: 7,
      skippedMulti: 0,
      conflict: 2,
    });
  });
});

describe("emptyAggregateCounts + addCounts", () => {
  it("starts at zeros", () => {
    expect(emptyAggregateCounts()).toEqual({
      processed: 0,
      encrypted: 0,
      decrypted: 0,
      skipped: 0,
      errors: 0,
      alreadyTarget: 0,
      skippedMulti: 0,
      conflict: 0,
    });
  });

  it("sums counts across two wallets", () => {
    const walletA = {
      processed: 10,
      encrypted: 8,
      decrypted: 0,
      skipped: 1,
      errors: 1,
      alreadyTarget: 2,
      skippedMulti: 0,
      conflict: 0,
    };
    const walletB = {
      processed: 5,
      encrypted: 3,
      decrypted: 0,
      skipped: 2,
      errors: 0,
      alreadyTarget: 1,
      skippedMulti: 1,
      conflict: 1,
    };

    const total = addCounts(addCounts(emptyAggregateCounts(), walletA), walletB);

    expect(total).toEqual({
      processed: 15,
      encrypted: 11,
      decrypted: 0,
      skipped: 3,
      errors: 1,
      alreadyTarget: 3,
      skippedMulti: 1,
      conflict: 1,
    });
  });

  it("returns the aggregate unchanged when counts is null", () => {
    const aggregate = {
      processed: 4,
      encrypted: 4,
      decrypted: 0,
      skipped: 0,
      errors: 0,
      alreadyTarget: 0,
      skippedMulti: 0,
      conflict: 0,
    };
    expect(addCounts(aggregate, null)).toBe(aggregate);
    expect(addCounts(aggregate, undefined)).toBe(aggregate);
  });
});

describe("needsPasswordForAction", () => {
  it("covers the full action x keyState matrix", () => {
    const expected = {
      encrypt: {
        none: true,
        establishing_ready: false,
        establishing: true,
        candidate: true,
        confirmed: false,
      },
      decrypt: {
        none: true,
        establishing_ready: true,
        establishing: true,
        candidate: true,
        confirmed: false,
      },
      unlock: {
        none: true,
        establishing_ready: true,
        establishing: true,
        candidate: true,
        confirmed: false,
      },
    };

    for (const action of ACTIONS) {
      for (const keyState of KEY_STATES) {
        expect(needsPasswordForAction(action, keyState)).toBe(
          expected[action][keyState],
        );
      }
    }
  });

  it("requires password for decrypt/unlock when establishing_ready", () => {
    // Round-1 Major regression: decrypt must not skip password on
    // establishing_ready (only encrypt may proceed without one).
    expect(needsPasswordForAction("decrypt", "establishing_ready")).toBe(true);
    expect(needsPasswordForAction("unlock", "establishing_ready")).toBe(true);
    expect(needsPasswordForAction("encrypt", "establishing_ready")).toBe(false);
  });
});

describe("canProceedAfterLogin", () => {
  it("covers the full action x keyState matrix", () => {
    const expected = {
      encrypt: {
        none: false,
        establishing_ready: true,
        establishing: false,
        candidate: false,
        confirmed: true,
      },
      decrypt: {
        none: false,
        establishing_ready: false,
        establishing: false,
        candidate: false,
        confirmed: true,
      },
      unlock: {
        none: false,
        establishing_ready: false,
        establishing: false,
        candidate: false,
        confirmed: true,
      },
    };

    for (const action of ACTIONS) {
      for (const keyState of KEY_STATES) {
        expect(canProceedAfterLogin(action, keyState)).toBe(
          expected[action][keyState],
        );
      }
    }
  });

  it("never allows candidate to proceed", () => {
    for (const action of ACTIONS) {
      expect(canProceedAfterLogin(action, "candidate")).toBe(false);
    }
  });
});

describe("dedupeWallets", () => {
  it("keeps the first occurrence for case/trailing-space duplicates", () => {
    const first = { name: "Default", path: "E:\\Wallets\\Default" };
    const second = { name: "Default Dup", path: "e:\\wallets\\default  " };
    const third = { name: "Mail", path: "E:\\Wallets\\Mail" };

    expect(dedupeWallets([first, second, third])).toEqual([first, third]);
  });

  it("preserves order of unique paths", () => {
    const wallets = [
      { name: "A", path: "C:/a" },
      { name: "B", path: "C:/b" },
      { name: "C", path: "C:/c" },
    ];
    expect(dedupeWallets(wallets)).toEqual(wallets);
  });

  it("returns an empty list for an empty input", () => {
    expect(dedupeWallets([])).toEqual([]);
  });

  it("collapses entries with null/empty path to a single first entry", () => {
    const first = { name: "Fallback", path: null };
    const second = { name: "Also empty", path: "" };
    const third = { name: "Missing path" };
    const withPath = { name: "Real", path: "D:/w" };

    expect(dedupeWallets([first, second, third, withPath])).toEqual([
      first,
      withPath,
    ]);
  });
});

describe("buildCompletionSummary", () => {
  const baseCounts = {
    processed: 10,
    encrypted: 7,
    decrypted: 5,
    skipped: 2,
    errors: 1,
    alreadyTarget: 0,
    skippedMulti: 0,
    conflict: 0,
  };

  it("builds the base encrypt summary", () => {
    expect(buildCompletionSummary(true, baseCounts)).toBe(
      "7 encrypted, 2 skipped, 1 errors.",
    );
  });

  it("builds the base decrypt summary", () => {
    expect(buildCompletionSummary(false, baseCounts)).toBe(
      "5 decrypted, 2 skipped, 1 errors.",
    );
  });

  it("appends already done when alreadyTarget > 0", () => {
    expect(
      buildCompletionSummary(true, { ...baseCounts, alreadyTarget: 3 }),
    ).toBe("7 encrypted, 2 skipped, 1 errors, 3 already done.");
  });

  it("appends conflicts when conflict > 0", () => {
    expect(
      buildCompletionSummary(false, { ...baseCounts, conflict: 4 }),
    ).toBe("5 decrypted, 2 skipped, 1 errors, 4 conflicts.");
  });

  it("appends both already done and conflicts when both are nonzero", () => {
    expect(
      buildCompletionSummary(true, {
        ...baseCounts,
        alreadyTarget: 3,
        conflict: 4,
      }),
    ).toBe("7 encrypted, 2 skipped, 1 errors, 3 already done, 4 conflicts.");
  });
});
