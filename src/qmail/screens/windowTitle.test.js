import { describe, expect, it } from "vitest";

import {
  buildWindowTitle,
  formatTitleQmailAddress,
  TITLE_SEPARATOR,
} from "./windowTitle";

describe("buildWindowTitle", () => {
  it("joins app, date, folder and address with tildes", () => {
    const title = buildWindowTitle({
      qmailAddress: "23.25@giga",
      buildDate: "2026-08-09",
      appDir: "C:/Users/User/",
    });

    expect(title).toBe("QMail ~ August 9, 2026 ~ C:/Users/User/ ~ 23.25@giga");
    expect(TITLE_SEPARATOR).toBe(" ~ ");
  });

  it("omits the build number", () => {
    const title = buildWindowTitle({
      qmailAddress: "15:33@mega",
      buildDate: "2026-06-26",
      appDir: "D:\\Apps\\QMail",
    });

    expect(title).not.toContain("build");
    expect(title).not.toMatch(/\(\s*build/i);
  });

  it("drops the address segment while the identity is still loading", () => {
    expect(
      buildWindowTitle({ buildDate: "2026-06-26", appDir: "D:\\Apps\\QMail" }),
    ).toBe("QMail ~ June 26, 2026 ~ D:\\Apps\\QMail");
  });

  it("drops the folder segment when the path is unavailable", () => {
    expect(
      buildWindowTitle({ qmailAddress: "15:33@mega", buildDate: "2026-06-26", appDir: "   " }),
    ).toBe("QMail ~ June 26, 2026 ~ 15:33@mega");
  });

  it("leaves no dangling separator when only the date is known", () => {
    const title = buildWindowTitle({ buildDate: "2026-06-26" });

    expect(title).toBe("QMail ~ June 26, 2026");
    expect(title.endsWith(TITLE_SEPARATOR.trimEnd())).toBe(false);
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
