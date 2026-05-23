// Tests for src/api/themeService.js — Track D acceptance criteria.
//
// Covers the response-shape compatibility (spec {success} vs current C
// {status}), JSON schema validation rules from plan §2.4, oversize
// handling, corrupted-JSON fallback, and the one-time legacy warning.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __test,
  clearUserTheme,
  fetchUserTheme,
  saveUserTheme,
  validateThemePayload,
} from "./themeService.js";

const okResponse = (body) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  });

const errResponse = (status, statusText, body) =>
  Promise.resolve({
    ok: false,
    status,
    statusText,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  });

const validTheme = () => ({
  schema: "qmail-theme/1",
  name: "My Theme",
  author: "sean",
  base: "dark",
  a11y: { reduced_motion: false, large_print: false },
  tokens: {
    "--accent-primary": "#22c55e",
    "--secondary-bg": "#0a0a0a",
    "--font-scale": "1.1",
    "--radius-md": "6px",
  },
});

beforeEach(() => {
  __test.resetLegacyShapeWarn();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateThemePayload", () => {
  it("accepts a well-formed payload", () => {
    expect(validateThemePayload(validTheme())).toEqual({ valid: true });
  });

  it("accepts a payload with no schema field (forward compat)", () => {
    const t = validTheme();
    delete t.schema;
    expect(validateThemePayload(t)).toEqual({ valid: true });
  });

  it("rejects unknown schema marker", () => {
    const t = validTheme();
    t.schema = "qmail-theme/2";
    expect(validateThemePayload(t).valid).toBe(false);
  });

  it("rejects a base that is not a standard theme id", () => {
    const t = validTheme();
    t.base = "midnight";
    const result = validateThemePayload(t);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/base/i);
  });

  it("rejects non-object tokens", () => {
    const t = validTheme();
    t.tokens = ["--accent-primary", "#22c55e"];
    expect(validateThemePayload(t).valid).toBe(false);
  });

  it("rejects token keys that do not match the CSS custom-property regex", () => {
    const cases = [
      "accent-primary", // missing leading --
      "--Accent-Primary", // uppercase
      "--accent primary", // space
      "--accent_primary", // underscore
      "---bad", // triple dash
      "--9foo", // starts with digit
      "--", // empty after the dashes
    ];
    for (const key of cases) {
      const t = validTheme();
      t.tokens = { [key]: "#fff" };
      expect(validateThemePayload(t).valid, key).toBe(false);
    }
  });

  it("rejects token values containing a semicolon (CSS injection)", () => {
    const t = validTheme();
    t.tokens = { "--accent-primary": "#22c55e; background: url(x)" };
    expect(validateThemePayload(t).valid).toBe(false);
  });

  it("rejects token values containing a closing brace (CSS injection)", () => {
    const t = validTheme();
    t.tokens = { "--accent-primary": "#22c55e } body { background: red" };
    expect(validateThemePayload(t).valid).toBe(false);
  });

  it("rejects token values containing a /* comment opener (CSS injection)", () => {
    const t = validTheme();
    t.tokens = { "--accent-primary": "#22c55e /* sneaky */" };
    expect(validateThemePayload(t).valid).toBe(false);
  });

  it("rejects non-string token values", () => {
    const t = validTheme();
    t.tokens = { "--font-scale": 1.1 };
    expect(validateThemePayload(t).valid).toBe(false);
  });

  it("rejects null and arrays at top level", () => {
    expect(validateThemePayload(null).valid).toBe(false);
    expect(validateThemePayload([]).valid).toBe(false);
  });
});

describe("fetchUserTheme — spec response shape", () => {
  it("parses a successful response with valid theme content", async () => {
    const themeObj = validTheme();
    const content = JSON.stringify(themeObj);
    globalThis.fetch.mockReturnValueOnce(
      okResponse({
        success: true,
        command: "system-theme",
        file: "custom_theme.txt",
        path: "Data/Themes/custom_theme.txt",
        content,
        size: content.length,
        exists: true,
      })
    );

    const result = await fetchUserTheme();
    expect(result.success).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.content).toBe(content);
    expect(result.data.theme).toEqual(themeObj);
  });

  it("returns theme:null when content is empty (newly-created stub)", async () => {
    globalThis.fetch.mockReturnValueOnce(
      okResponse({
        success: true,
        command: "system-theme",
        content: "",
        size: 0,
        exists: false,
      })
    );

    const result = await fetchUserTheme();
    expect(result.success).toBe(true);
    expect(result.data.exists).toBe(false);
    expect(result.data.theme).toBeNull();
  });

  it("does NOT warn about legacy shape on spec response", async () => {
    globalThis.fetch.mockReturnValueOnce(
      okResponse({ success: true, content: "", exists: false })
    );
    await fetchUserTheme();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("fetchUserTheme — current C response shape", () => {
  it("parses the legacy {status: 'success'} shape and warns once", async () => {
    const themeObj = validTheme();
    const content = JSON.stringify(themeObj);
    globalThis.fetch
      .mockReturnValueOnce(okResponse({ status: "success", content, size: content.length, exists: true }))
      .mockReturnValueOnce(okResponse({ status: "success", content: "", size: 0, exists: false }));

    const r1 = await fetchUserTheme();
    const r2 = await fetchUserTheme();

    expect(r1.success).toBe(true);
    expect(r1.data.theme).toEqual(themeObj);
    expect(r2.success).toBe(true);

    const legacyWarns = console.warn.mock.calls.filter((args) =>
      String(args[0] || "").includes("legacy {status}")
    );
    expect(legacyWarns).toHaveLength(1);
  });
});

describe("fetchUserTheme — error and corruption paths", () => {
  it("returns theme:null on corrupted JSON content (does NOT throw)", async () => {
    globalThis.fetch.mockReturnValueOnce(
      okResponse({
        success: true,
        content: "{not valid json",
        size: 15,
        exists: true,
      })
    );

    const result = await fetchUserTheme();
    expect(result.success).toBe(true);
    expect(result.data.exists).toBe(true);
    expect(result.data.theme).toBeNull();
  });

  it("returns theme:null on JSON that fails token validation", async () => {
    const evilTheme = {
      base: "dark",
      tokens: { "--accent-primary": "#22c55e; background: url(x)" },
    };
    globalThis.fetch.mockReturnValueOnce(
      okResponse({ success: true, content: JSON.stringify(evilTheme), exists: true })
    );

    const result = await fetchUserTheme();
    expect(result.success).toBe(true);
    expect(result.data.theme).toBeNull();
  });

  it("surfaces a server 500 as success:false with an error message", async () => {
    globalThis.fetch.mockReturnValueOnce(
      errResponse(500, "Internal Server Error", { message: "boom" })
    );
    const result = await fetchUserTheme();
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("surfaces a network failure (fetch throws) as success:false", async () => {
    globalThis.fetch.mockImplementationOnce(() => {
      throw new TypeError("Failed to fetch");
    });
    const result = await fetchUserTheme();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to fetch/);
  });
});

describe("saveUserTheme — validation runs before network", () => {
  it("rejects an invalid payload without calling fetch", async () => {
    const result = await saveUserTheme({ base: "dark", tokens: { bad_key: "x" } });
    expect(result.success).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload without calling fetch", async () => {
    const t = validTheme();
    const big = "#".padEnd(__test.MAX_THEME_BYTES, "f");
    // Use a valid-format hex-style value that does not trigger
    // injection rules but is large enough to blow the cap.
    t.tokens["--accent-primary"] = big;
    const result = await saveUserTheme(t);
    expect(result.success).toBe(false);
    expect(result.oversize).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("saveUserTheme — server interaction", () => {
  it("returns success on a spec response", async () => {
    globalThis.fetch.mockReturnValueOnce(
      okResponse({
        success: true,
        command: "system-theme",
        bytes_written: 256,
        message: "ok",
      })
    );
    const result = await saveUserTheme(validTheme());
    expect(result.success).toBe(true);
    expect(result.data.bytes_written).toBe(256);
  });

  it("returns success on the legacy {status:'success'} shape and warns once", async () => {
    globalThis.fetch.mockReturnValueOnce(
      okResponse({ status: "success", action: "saved", size: 256 })
    );
    const result = await saveUserTheme(validTheme());
    expect(result.success).toBe(true);
    expect(result.data.bytes_written).toBe(256);
    expect(console.warn).toHaveBeenCalled();
  });

  it("flags oversize when server returns 413 (spec)", async () => {
    globalThis.fetch.mockReturnValueOnce(errResponse(413, "Payload Too Large", { message: "Theme too large (max 8192 bytes)" }));
    // Send a payload that passes client-side validation but pretend the
    // server rejected it.
    const result = await saveUserTheme(validTheme());
    expect(result.success).toBe(false);
    expect(result.oversize).toBe(true);
    expect(result.error).toMatch(/too large/i);
  });

  it("flags oversize when current C returns 400 with 'too large' message", async () => {
    globalThis.fetch.mockReturnValueOnce(errResponse(400, "Bad Request", { message: "Theme too large (max 8192 bytes)" }));
    const result = await saveUserTheme(validTheme());
    expect(result.success).toBe(false);
    expect(result.oversize).toBe(true);
  });

  it("surfaces other 400 errors as a normal failure (not oversize)", async () => {
    globalThis.fetch.mockReturnValueOnce(errResponse(400, "Bad Request", { message: "Malformed JSON" }));
    const result = await saveUserTheme(validTheme());
    expect(result.success).toBe(false);
    expect(result.oversize).toBeUndefined();
    expect(result.error).toBe("Malformed JSON");
  });
});

describe("clearUserTheme", () => {
  it("returns success on a spec response", async () => {
    globalThis.fetch.mockReturnValueOnce(
      okResponse({ success: true, command: "system-theme", action: "cleared", message: "ok" })
    );
    const result = await clearUserTheme();
    expect(result.success).toBe(true);
    expect(result.alreadyAbsent).toBeUndefined();
  });

  it("returns success on the legacy {status:'success'} shape", async () => {
    globalThis.fetch.mockReturnValueOnce(
      okResponse({ status: "success", action: "cleared", message: "ok" })
    );
    const result = await clearUserTheme();
    expect(result.success).toBe(true);
  });

  it("treats 404 as soft-success and sets alreadyAbsent", async () => {
    globalThis.fetch.mockReturnValueOnce(
      errResponse(404, "Not Found", { message: "Theme file does not exist" })
    );
    const result = await clearUserTheme();
    expect(result.success).toBe(true);
    expect(result.alreadyAbsent).toBe(true);
  });

  it("surfaces a server 500 as failure", async () => {
    globalThis.fetch.mockReturnValueOnce(errResponse(500, "Internal Server Error", { message: "boom" }));
    const result = await clearUserTheme();
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });
});
