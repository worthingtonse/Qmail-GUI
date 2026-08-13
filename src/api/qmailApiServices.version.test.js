import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkVersion,
  REMOTE_VERSION_MANIFEST_URLS,
  REMOTE_VERSION_URLS,
} from "./qmailApiServices.js";
import { BUILD_DATE } from "../version.js";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) QMail/1.0.55 Electron/25.9.8 Safari/537.36";

const mockFetchByUrl = (responder) => {
  globalThis.fetch = vi.fn(async (url) => {
    const body = responder(url);
    if (body instanceof Error) throw body;
    if (body === undefined) {
      // Stand-in for a mirror that hasn't deployed the manifest yet.
      return { ok: false, status: 404, text: async () => "Not Found" };
    }
    return { ok: true, status: 200, text: async () => body };
  });
};

// The served manifest keeps a bare date on line 1 with the JSON after it.
const manifestBody = (platformDates, headerDate = "2099-01-01") =>
  `${headerDate}\n${JSON.stringify(platformDates, null, 2)}\n`;

// navigator is a getter-only global here, so it can't be assigned directly.
const stubUserAgent = (userAgent) =>
  vi.stubGlobal("navigator", { userAgent });

beforeEach(() => {
  globalThis.window = {};
  stubUserAgent(WINDOWS_UA);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.window;
  delete globalThis.fetch;
});

// Legacy-only responder: the manifest 404s everywhere, as it does on a
// mirror that hasn't been updated, forcing the fallback path.
const legacyOnly = (responder) =>
  mockFetchByUrl((url) =>
    REMOTE_VERSION_MANIFEST_URLS.includes(url) ? undefined : responder(url),
  );

describe("checkVersion", () => {
  it("polls several mirrors, not just one", () => {
    expect(REMOTE_VERSION_URLS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(REMOTE_VERSION_URLS).size).toBe(REMOTE_VERSION_URLS.length);
    expect(REMOTE_VERSION_MANIFEST_URLS).toHaveLength(
      REMOTE_VERSION_URLS.length,
    );
  });

  it("derives manifest URLs that differ from the frozen legacy ones", () => {
    // The legacy endpoint's format is frozen; the manifest must be a
    // genuinely separate path or old clients break.
    REMOTE_VERSION_MANIFEST_URLS.forEach((url) => {
      expect(REMOTE_VERSION_URLS).not.toContain(url);
      expect(url).toContain("qmail_client_versions");
    });
  });

  it("takes the majority answer over a stale minority", async () => {
    // Two stale mirrors (the raida0/1/11 scenario), the rest current.
    legacyOnly((url) =>
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
    legacyOnly((url) => {
      const index = REMOTE_VERSION_URLS.indexOf(url);
      if (index === 0) return new Error("down");
      return index <= 3 ? "2026-01-01" : "2099-01-01";
    });

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.latest_version).toBe("2099-01-01");
  });

  it("ignores malformed responses when tallying", async () => {
    legacyOnly((url) =>
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

describe("checkVersion per-platform manifest", () => {
  it("uses this platform's date, not another platform's release", async () => {
    // The regression this whole feature exists to prevent: Linux ships
    // today, Windows shipped weeks ago, and a Windows client must stay
    // quiet instead of being told to update.
    mockFetchByUrl((url) =>
      REMOTE_VERSION_MANIFEST_URLS.includes(url)
        ? manifestBody({
            windows: "2001-01-01",
            "linux-app": "2099-12-31",
            mac: "2099-12-31",
          })
        : "2099-12-31",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.source).toBe("manifest");
    expect(result.data.platform).toBe("windows");
    expect(result.data.latest_version).toBe("2001-01-01");
    expect(result.data.update_available).toBe(false);
  });

  it("prompts when this platform does have a newer build", async () => {
    mockFetchByUrl((url) =>
      REMOTE_VERSION_MANIFEST_URLS.includes(url)
        ? manifestBody({ windows: "2099-12-31", "linux-app": "2001-01-01" })
        : "2001-01-01",
    );

    const result = await checkVersion();

    expect(result.data.update_available).toBe(true);
    expect(result.data.latest_version).toBe("2099-12-31");
    expect(result.data.current_version).toBe(BUILD_DATE);
  });

  it("parses the manifest despite the leading bare-date line", async () => {
    // Line 1 stays a bare date for first-line-only readers; the parser has
    // to skip it rather than choke on non-JSON leading content.
    mockFetchByUrl((url) =>
      REMOTE_VERSION_MANIFEST_URLS.includes(url)
        ? manifestBody({ windows: "2099-05-05" }, "2099-05-05")
        : new Error("legacy should not be needed"),
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.source).toBe("manifest");
    expect(result.data.latest_version).toBe("2099-05-05");
  });

  it("falls back to legacy when mirrors have no manifest yet", async () => {
    legacyOnly(() => "2099-07-24");

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.source).toBe("legacy");
    expect(result.data.latest_version).toBe("2099-07-24");
  });

  it("falls back to legacy when the manifest omits this platform", async () => {
    // A platform with no published build must not silently inherit another
    // platform's date from the manifest.
    mockFetchByUrl((url) =>
      REMOTE_VERSION_MANIFEST_URLS.includes(url)
        ? manifestBody({ "linux-app": "2099-12-31", mac: "2099-12-31" })
        : "2098-01-01",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.source).toBe("legacy");
    expect(result.data.latest_version).toBe("2098-01-01");
  });

  it("falls back to legacy when the manifest body is not valid JSON", async () => {
    mockFetchByUrl((url) =>
      REMOTE_VERSION_MANIFEST_URLS.includes(url)
        ? "2099-01-01\n{ this is not json"
        : "2098-01-01",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.source).toBe("legacy");
    expect(result.data.latest_version).toBe("2098-01-01");
  });

  it("discards manifest mirrors serving a non-ISO date", async () => {
    // One poisoned mirror must not win the vote.
    mockFetchByUrl((url) => {
      if (!REMOTE_VERSION_MANIFEST_URLS.includes(url)) return "2001-01-01";
      return REMOTE_VERSION_MANIFEST_URLS.indexOf(url) === 0
        ? manifestBody({ windows: "tomorrow" })
        : manifestBody({ windows: "2099-03-03" });
    });

    const result = await checkVersion();

    expect(result.data.source).toBe("manifest");
    expect(result.data.latest_version).toBe("2099-03-03");
  });

  it("falls back to legacy when the platform is unidentifiable", async () => {
    stubUserAgent("unknown-runtime/1.0");
    mockFetchByUrl((url) =>
      REMOTE_VERSION_MANIFEST_URLS.includes(url)
        ? manifestBody({ windows: "2099-12-31" })
        : "2097-01-01",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.platform).toBeNull();
    expect(result.data.source).toBe("legacy");
    expect(result.data.latest_version).toBe("2097-01-01");
  });
});
