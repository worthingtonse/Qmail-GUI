// --- src/api/themeService.js ---
// Theme service: GET / POST / DELETE against /api/system/theme.
//
// Pure module. No React imports. Consumed by Phase 3 ThemeProvider
// integration. The three exported async functions return shapes that
// mirror src/api/apiService.js: { success, data?, error? }.
//
// Defensive behaviour: the C core today returns { status, ... } where
// the PHP spec at D:/Code/src/PHP/cloudcoin.org-main/commands/
// system-theme.php documents { success, command, ... }. See
// docs/opu.theme.plan.txt §8 D3 for the five discrepancies. Until the
// C team aligns, this module accepts BOTH shapes and emits a one-time
// console warning the first time it sees the legacy {status} shape so
// we know when the server upgrade lands.

import { STANDARD_THEMES } from "../theme/themeContext.js";

const API_PORT = import.meta.env.VITE_API_PORT || "8080";
const API_BASE_URL = `http://localhost:${API_PORT}/api`;
const THEME_ENDPOINT = `${API_BASE_URL}/system/theme`;

const THEME_SCHEMA = "qmail-theme/1";
const MAX_THEME_BYTES = 8192;

// Plan §2.4 specifies /^--[a-z0-9-]+$/. Tightened to require the first
// character after the leading -- to be a letter, so things like
// "---bad", "--9foo", "--" are rejected. Every real token name in
// src/styles/tokens.css already matches this stricter form.
const TOKEN_KEY_RE = /^--[a-z][a-z0-9-]*$/;
const FORBIDDEN_VALUE_CHARS = [";", "}", "/*"];

let legacyShapeWarned = false;
const warnLegacyShapeOnce = () => {
  if (legacyShapeWarned) return;
  legacyShapeWarned = true;
  console.warn(
    "themeService: server returned legacy {status} response shape. " +
      "Update the C core per docs/theme.c-core-ticket.md (D3) to use {success}."
  );
};

const extractMessage = (data, fallback) => {
  if (!data || typeof data !== "object") return fallback;
  for (const key of ["message", "detail", "details", "error"]) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return fallback;
};

// Accept BOTH the spec's {success: true} and the legacy {status: "success"}.
// Anything else (including a thrown JSON error) is treated as not-success.
const isSuccessShape = (data) => {
  if (!data || typeof data !== "object") return false;
  if (data.success === true) return true;
  if (data.status === "success") {
    warnLegacyShapeOnce();
    return true;
  }
  return false;
};

// Validation rules per docs/opu.theme.plan.txt §2.4.
// Returns { valid: true } or { valid: false, error: string }.
export const validateThemePayload = (obj) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { valid: false, error: "Theme payload must be a JSON object" };
  }

  if (obj.schema !== undefined && obj.schema !== THEME_SCHEMA) {
    return {
      valid: false,
      error: `Unknown schema "${obj.schema}" (expected "${THEME_SCHEMA}")`,
    };
  }

  if (typeof obj.base !== "string" || !STANDARD_THEMES.includes(obj.base)) {
    return {
      valid: false,
      error: `"base" must be one of: ${STANDARD_THEMES.join(", ")}`,
    };
  }

  const tokens = obj.tokens;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return { valid: false, error: '"tokens" must be a JSON object' };
  }

  for (const [key, value] of Object.entries(tokens)) {
    if (!TOKEN_KEY_RE.test(key)) {
      return {
        valid: false,
        error: `Invalid token key "${key}" (must match ${TOKEN_KEY_RE})`,
      };
    }
    if (typeof value !== "string") {
      return {
        valid: false,
        error: `Token "${key}" must have a string value`,
      };
    }
    for (const bad of FORBIDDEN_VALUE_CHARS) {
      if (value.includes(bad)) {
        return {
          valid: false,
          error: `Token "${key}" value contains forbidden sequence "${bad}"`,
        };
      }
    }
  }

  return { valid: true };
};

const parseThemeFile = (content) => {
  if (typeof content !== "string" || content.trim() === "") {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.warn("themeService: custom theme file is not valid JSON", err);
    return null;
  }
  const check = validateThemePayload(parsed);
  if (!check.valid) {
    console.warn("themeService: custom theme file failed validation:", check.error);
    return null;
  }
  return parsed;
};

/**
 * GET /api/system/theme.
 *
 * Returns { success: true, data: { exists, content, theme, size } } where
 * `theme` is the parsed-and-validated theme object (or null on any parse
 * or validation failure — a corrupted theme file must never break the
 * GUI). `exists:false` may mean "newly created stub" (per spec) or
 * "permanent absence" (per current C). The caller decides.
 *
 * On network/server failure: { success: false, error }.
 */
export const fetchUserTheme = async () => {
  try {
    const response = await fetch(THEME_ENDPOINT);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        success: false,
        error: extractMessage(
          data,
          `Server responded with ${response.status} ${response.statusText}`
        ),
      };
    }

    if (!isSuccessShape(data)) {
      // Spec says GET always returns success; if neither shape matches
      // treat as a degraded server, but still surface any content we
      // can pick out so the GUI can fall back to defaults.
      const content = typeof data?.content === "string" ? data.content : "";
      return {
        success: true,
        data: {
          exists: data?.exists === true,
          size: typeof data?.size === "number" ? data.size : content.length,
          content,
          theme: parseThemeFile(content),
        },
      };
    }

    const content = typeof data.content === "string" ? data.content : "";
    return {
      success: true,
      data: {
        exists: data.exists === true,
        size: typeof data.size === "number" ? data.size : content.length,
        content,
        theme: parseThemeFile(content),
      },
    };
  } catch (error) {
    console.error("fetchUserTheme failed:", error);
    return { success: false, error: `Error fetching theme: ${error.message}` };
  }
};

/**
 * POST /api/system/theme with JSON.stringify(obj) as the body.
 *
 * Validates the payload against §2.4 rules BEFORE making the request,
 * so the CSS-injection blacklist runs client-side too. If validation
 * fails: { success: false, error } — no network call is made.
 *
 * On 413 (or legacy 400 with "Theme too large"): {success:false,
 * error, oversize:true} so the caller can show a tailored toast.
 */
export const saveUserTheme = async (obj) => {
  const check = validateThemePayload(obj);
  if (!check.valid) {
    return { success: false, error: `Theme validation failed: ${check.error}` };
  }

  let body;
  try {
    body = JSON.stringify(obj);
  } catch (err) {
    return { success: false, error: `Theme serialisation failed: ${err.message}` };
  }

  if (body.length > MAX_THEME_BYTES) {
    return {
      success: false,
      oversize: true,
      error: `Theme is ${body.length} bytes (max ${MAX_THEME_BYTES})`,
    };
  }

  try {
    const response = await fetch(THEME_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.status === 413) {
      return {
        success: false,
        oversize: true,
        error: extractMessage(data, "Theme too large"),
      };
    }

    // §8 D4: the legacy C handler returns 400 instead of 413 for oversize.
    // Detect it by message so the GUI can use the same oversize branch.
    if (response.status === 400 && data) {
      const msg = extractMessage(data, "");
      if (msg && /too large/i.test(msg)) {
        return { success: false, oversize: true, error: msg };
      }
    }

    if (!response.ok) {
      return {
        success: false,
        error: extractMessage(
          data,
          `Server responded with ${response.status} ${response.statusText}`
        ),
      };
    }

    if (!isSuccessShape(data)) {
      return {
        success: false,
        error: extractMessage(data, "Server did not confirm theme save"),
      };
    }

    return {
      success: true,
      data: {
        bytes_written:
          typeof data.bytes_written === "number"
            ? data.bytes_written
            : typeof data.size === "number"
              ? data.size
              : body.length,
        message: extractMessage(data, "Theme saved"),
      },
    };
  } catch (error) {
    console.error("saveUserTheme failed:", error);
    return { success: false, error: `Error saving theme: ${error.message}` };
  }
};

/**
 * DELETE /api/system/theme.
 *
 * 404 ("file did not exist") is treated as a soft-success — the GUI
 * wanted the file gone, and it is, so the user-facing outcome is the
 * same. We expose `alreadyAbsent:true` for callers that want to nudge
 * the messaging.
 */
export const clearUserTheme = async () => {
  try {
    const response = await fetch(THEME_ENDPOINT, { method: "DELETE" });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.status === 404) {
      return {
        success: true,
        alreadyAbsent: true,
        data: { message: extractMessage(data, "Theme file did not exist") },
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: extractMessage(
          data,
          `Server responded with ${response.status} ${response.statusText}`
        ),
      };
    }

    if (!isSuccessShape(data)) {
      return {
        success: false,
        error: extractMessage(data, "Server did not confirm theme deletion"),
      };
    }

    return {
      success: true,
      data: { message: extractMessage(data, "Theme cleared") },
    };
  } catch (error) {
    console.error("clearUserTheme failed:", error);
    return { success: false, error: `Error clearing theme: ${error.message}` };
  }
};

// Exposed for tests; not part of the public API.
export const __test = {
  THEME_SCHEMA,
  MAX_THEME_BYTES,
  TOKEN_KEY_RE,
  FORBIDDEN_VALUE_CHARS,
  resetLegacyShapeWarn() {
    legacyShapeWarned = false;
  },
};
