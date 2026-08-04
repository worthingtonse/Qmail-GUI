import { describe, expect, it } from "vitest";
import transactionLog from "../../transaction-log.cjs";

const { parseCsvRow, parseTransactionCsv } = transactionLog;

describe("wallet transaction log parsing", () => {
  it("parses quoted descriptions containing commas", () => {
    expect(parseCsvRow('icon,"task-1","08/02/2026, 09:10 PM","Deposit",25,,"Gift, thanks","125"'))
      .toEqual([
        "icon",
        "task-1",
        "08/02/2026, 09:10 PM",
        "Deposit",
        "25",
        "",
        "Gift, thanks",
        "125",
      ]);
  });

  it("only attaches an existing receipt to a transaction", () => {
    const content = [
      "Symbol,Task ID,Date & Time,Remarks,Deposit,Withdraw,Description,Balance",
      'in,"with-receipt","08/02/2026, 09:10 PM","Deposit",25,,"Gift","125"',
      'out,"without-receipt","08/01/2026, 08:00 PM","Withdraw",,5,"Spend","100"',
    ].join("\n");

    const rows = parseTransactionCsv(
      content,
      { name: "Default", path: "D:\\Wallets\\Default" },
      ["with-receipt.json"],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].receiptFilename).toBe("with-receipt.json");
    expect(rows[1].receiptFilename).toBeNull();
    expect(rows[0].walletName).toBe("Default");
  });
});
