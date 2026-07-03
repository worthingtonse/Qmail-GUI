import { describe, expect, it } from "vitest";

import {
  buildWindowTitle,
  formatTitleQmailAddress,
  TITLE_ADDRESS_SEPARATOR,
  TITLE_ADDRESS_SEPARATOR_COUNT,
} from "./windowTitle";

const TITLE_PREFIX =
  "QMail Alpha      Limited Functionality. Attachment Max Size and Count: 250KB and 2     ";

describe("buildWindowTitle", () => {
  it("uses the stable version/address format with 10 spaced periods", () => {
    const title = buildWindowTitle({
      qmailAddress: "15:33@mega",
      buildDate: "2026-06-26",
    });

    expect(title).toBe(
      `${TITLE_PREFIX}June 26, 2026 ${".  ".repeat(9)}. Your Qmail Address: 15:33@mega`,
    );
    expect(TITLE_ADDRESS_SEPARATOR_COUNT).toBe(10);
    expect(TITLE_ADDRESS_SEPARATOR).toBe(`${".  ".repeat(9)}.`);
  });

  it("omits the gap while the address is unavailable", () => {
    expect(buildWindowTitle({ buildDate: "2026-06-26" })).toBe(
      `${TITLE_PREFIX}June 26, 2026`,
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
  it("normalizes the denomination while preserving the local address", () => {
    expect(formatTitleQmailAddress("127.103@kILO")).toBe("127.103@kilo");
    expect(formatTitleQmailAddress("15:33@MEGA")).toBe("15:33@mega");
  });
});
