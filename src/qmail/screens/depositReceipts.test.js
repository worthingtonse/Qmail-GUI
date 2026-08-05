import { describe, expect, it } from "vitest";

import {
  countFromTotals,
  depositAddedNothing,
  getDepositWarnings,
  getTaskProgressLabel,
  getTotalsFromResult,
} from "./depositReceipts";

describe("getTotalsFromResult", () => {
  it("reads totals from data.totals", () => {
    expect(getTotalsFromResult({ data: { totals: { bank_count: 3 } } })).toEqual({
      bank_count: 3,
    });
  });

  it("reads totals from the finished task payload (data.result.totals)", () => {
    expect(
      getTotalsFromResult({ data: { result: { totals: { fracked_count: 2 } } } }),
    ).toEqual({ fracked_count: 2 });
  });

  it("reads totals from a nested receipt object", () => {
    expect(
      getTotalsFromResult({ data: { receipt: { totals: { limbo_count: 1 } } } }),
    ).toEqual({ limbo_count: 1 });
  });

  it("returns an empty object when nothing is present", () => {
    expect(getTotalsFromResult(null)).toEqual({});
    expect(getTotalsFromResult({ data: {} })).toEqual({});
  });
});

describe("countFromTotals", () => {
  it("sums the requested keys and ignores missing or non-numeric values", () => {
    const totals = { bank_count: 5, fracked_count: "2", counterfeit_count: "n/a" };
    expect(countFromTotals(totals, ["bank_count", "fracked_count"])).toBe(7);
    expect(countFromTotals(totals, ["counterfeit_count", "limbo_count"])).toBe(0);
    expect(countFromTotals(null, ["bank_count"])).toBe(0);
  });
});

describe("depositAddedNothing", () => {
  it("trusts total_deposited when present", () => {
    expect(depositAddedNothing({ total_deposited: 0, bank_count: 4 })).toBe(true);
    expect(depositAddedNothing({ total_deposited: 2, bank_count: 0 })).toBe(false);
  });

  it("falls back to authentic counts when total_deposited is absent", () => {
    expect(depositAddedNothing({ bank_count: 0, fracked_count: 0 })).toBe(true);
    expect(depositAddedNothing({ bank_count: 0, fracked_count: 1 })).toBe(false);
    expect(depositAddedNothing({})).toBe(true);
  });
});

describe("getDepositWarnings", () => {
  it("returns no warnings for a clean deposit", () => {
    expect(getDepositWarnings({ bank_count: 10 })).toEqual([]);
  });

  it("stacks independent warnings", () => {
    const warnings = getDepositWarnings({
      counterfeit_count: 2,
      limbo_count: 1,
      duplicate_count: 3,
      error_count: 1,
    });
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain("counterfeit");
  });

  it("counts legacy counterfeits together with regular ones", () => {
    const warnings = getDepositWarnings({
      counterfeit_count: 1,
      legacy_counterfeit_count: 2,
    });
    expect(warnings).toEqual(["3 notes were counterfeit"]);
  });
});

describe("getTaskProgressLabel", () => {
  it("formats numeric progress with the given verb", () => {
    expect(getTaskProgressLabel({ progress: 42.4 }, "Importing")).toBe(
      "Importing... 42%",
    );
    expect(getTaskProgressLabel({ percent: 120 })).toBe("Depositing... 100%");
  });

  it("falls back to the task message, status, then the verb", () => {
    expect(getTaskProgressLabel({ message: "Scanning folder" })).toBe(
      "Scanning folder",
    );
    expect(getTaskProgressLabel({ status: "running" })).toBe("running");
    expect(getTaskProgressLabel({}, "Importing")).toBe("Importing...");
  });
});
