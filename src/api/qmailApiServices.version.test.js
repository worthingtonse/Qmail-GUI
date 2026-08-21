import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkVersion,
  REMOTE_VERSION_MANIFEST_URLS,
  REMOTE_VERSION_URLS,
  VERSIONS_HTML_URL,
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

// Every URL polled in the preferred (manifest-format) tier.
const MANIFEST_TIER_URLS = [VERSIONS_HTML_URL, ...REMOTE_VERSION_MANIFEST_URLS];

// Legacy-only responder: the manifest tier 404s everywhere (RAIDA mirrors
// that haven't been updated, HTML page not deployed), forcing the
// fallback path.
const legacyOnly = (responder) =>
  mockFetchByUrl((url) =>
    MANIFEST_TIER_URLS.includes(url) ? undefined : responder(url),
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

  it("polls raida11, where CI publishes first", () => {
    // r11 is the origin of every version bump; excluding it (as the list
    // did before 2026-08) meant the freshest data was never consulted.
    expect(REMOTE_VERSION_URLS).toContain(
      "https://raida11.cloudcoin.global/service/qmail_client_version",
    );
  });

  it("takes the newest answer over stale mirrors", async () => {
    legacyOnly((url) =>
      REMOTE_VERSION_URLS.indexOf(url) < 2 ? "2026-03-24" : "2099-07-24",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.latest_version).toBe("2099-07-24");
    expect(result.data.update_available).toBe(true);
    expect(result.data.current_version).toBe(BUILD_DATE);
  });

  it("a single fresher mirror is enough (the release-day r11 scenario)", async () => {
    // Right after a publish, only r11 carries the new date; every other
    // mirror is stale until replication runs. The stale majority must not
    // suppress the release.
    legacyOnly((url) =>
      REMOTE_VERSION_URLS.indexOf(url) === 3 ? "2099-08-20" : "2026-08-08",
    );

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.latest_version).toBe("2099-08-20");
    expect(result.data.update_available).toBe(true);
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

  it("reads the same-host HTML page as a manifest source", async () => {
    // qmail-versions.html lives next to the binaries on
    // cloudcoinconsortium.com and wraps the same date+JSON block in HTML.
    // It alone must be able to carry the check when every RAIDA mirror
    // 404s the manifest.
    mockFetchByUrl((url) => {
      if (url === VERSIONS_HTML_URL) {
        return `<html><body><pre id="qmail-versions">\n2099-06-06\n${JSON.stringify(
          { windows: "2099-06-06" },
        )}\n</pre></body></html>`;
      }
      if (REMOTE_VERSION_MANIFEST_URLS.includes(url)) return undefined;
      return "2001-01-01";
    });

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.source).toBe("manifest");
    expect(result.data.latest_version).toBe("2099-06-06");
    expect(result.data.update_available).toBe(true);
  });

  it("reads the HTML page even when styling adds other braces", async () => {
    // A realistically styled page: CSS braces before the version block and
    // a script after it. The parser must find the manifest object among
    // them instead of swallowing first-{-to-last-} as one span — otherwise
    // the one same-host source dies the moment CI styles the page, and
    // clients fall back to the frozen legacy date.
    mockFetchByUrl((url) => {
      if (url === VERSIONS_HTML_URL) {
        return (
          "<html><head><style>body { margin: 0; } pre { color: #eee; }</style></head>" +
          '<body><h1>QMail Releases</h1><pre id="qmail-versions">\n2099-06-07\n' +
          `${JSON.stringify({ windows: "2099-06-07" })}\n</pre>` +
          "<script>window.x = { legacy: false };</script></body></html>"
        );
      }
      if (REMOTE_VERSION_MANIFEST_URLS.includes(url)) return undefined;
      return "2001-01-01";
    });

    const result = await checkVersion();

    expect(result.success).toBe(true);
    expect(result.data.source).toBe("manifest");
    expect(result.data.latest_version).toBe("2099-06-07");
  });

  it("takes the newest date when manifest mirrors disagree", async () => {
    // Release-day skew: one mirror already replicated, the rest are a day
    // behind. The newer date must win without any quorum.
    mockFetchByUrl((url) => {
      if (!REMOTE_VERSION_MANIFEST_URLS.includes(url)) return "2001-01-01";
      return REMOTE_VERSION_MANIFEST_URLS.indexOf(url) === 0
        ? manifestBody({ windows: "2099-09-09" })
        : manifestBody({ windows: "2099-09-08" });
    });

    const result = await checkVersion();

    expect(result.data.source).toBe("manifest");
    expect(result.data.latest_version).toBe("2099-09-09");
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
