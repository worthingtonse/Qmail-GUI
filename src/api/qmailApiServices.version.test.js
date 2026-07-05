import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkVersion, REMOTE_VERSION_URLS } from "./qmailApiServices.js";
import { BUILD_DATE } from "../version.js";

const mockFetchByUrl = (responder) => {
  globalThis.fetch = vi.fn(async (url) => {
    const body = responder(url);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, text: async () => body };
  });
};

beforeEach(() => {
  globalThis.window = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.window;
  delete globalThis.fetch;
});

describe("checkVersion", () => {
  it("polls several mirrors, not just one", () => {
    expect(REMOTE_VERSION_URLS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(REMOTE_VERSION_URLS).size).toBe(REMOTE_VERSION_URLS.length);
  });

  it("takes the majority answer over a stale minority", async () => {
    // Two stale mirrors (the raida0/1/11 scenario), the rest current.
    mockFetchByUrl((url) =>
      REMOTE_VERSION_URLS.indexOf(url) < 2 ? "2026-03-24" : "2099-07-24",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.latest_version).toBe("2099-07-24");
    expect(result.data.update_available).toBe(true);
    expect(result.data.current_version).toBe(BUILD_DATE);
  });

  it("breaks a tie toward the newest date", async () => {
    // 6 valid answers (one mirror down): 3 old vs 3 new.
    mockFetchByUrl((url) => {
      const index = REMOTE_VERSION_URLS.indexOf(url);
      if (index === 0) return new Error("down");
      return index <= 3 ? "2026-01-01" : "2099-01-01";
    });

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.latest_version).toBe("2099-01-01");
  });

  it("ignores malformed responses when tallying", async () => {
    mockFetchByUrl((url) =>
      REMOTE_VERSION_URLS.indexOf(url) === 0 ? "<html>oops</html>" : "2001-01-01",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.latest_version).toBe("2001-01-01");
    expect(result.data.update_available).toBe(false);
  });

  it("fails without prompting when no mirror gives a valid date", async () => {
    mockFetchByUrl(() => new Error("Failed to fetch"));

    const result = await checkVersion();

    expect(result.success).toBe(false);
  });
});
