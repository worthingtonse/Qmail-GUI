import { describe, expect, it } from "vitest";

import {
  buildWindowTitle,
  formatTitleQmailAddress,
  TITLE_ADDRESS_GAP,
} from "./windowTitle";

describe("buildWindowTitle", () => {
  it("uses the stable version/address format with exactly 20 spaces", () => {
    const title = buildWindowTitle({
      qmailAddress: "127.103@kilo",
      buildDate: "2026-06-26",
    });

    expect(title).toBe(
      `QMail Version June 26, 2026${" ".repeat(20)}127.103@Kilo`,
    );
    expect(TITLE_ADDRESS_GAP).toBe(20);
  });

  it("omits the gap while the address is unavailable", () => {
    expect(buildWindowTitle({ buildDate: "2026-06-26" })).toBe(
      "QMail Version June 26, 2026",
    );
  });

  it("does not vary with obsolete folder or unread-count inputs", () => {
    const title = buildWindowTitle({
      qmailAddress: "127.103@Kilo",
      buildDate: "2026-06-26",
      folder: "trash",
      unread: 42,
    });

    expect(title).not.toContain("Trash");
    expect(title).not.toContain("42");
  });
});

describe("formatTitleQmailAddress", () => {
  it("normalizes the denomination without adding a label", () => {
    expect(formatTitleQmailAddress("127.103@kILO")).toBe("127.103@Kilo");
  });
});
