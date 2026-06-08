/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchUserTheme,
  saveUserTheme,
  clearUserTheme,
} from "../api/themeService";
import {
  ThemeContext,
  STANDARD_THEMES,
  THEME_BASE_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from "./themeContext";

/* ThemeProvider — applies the active theme to <html data-theme="..."> and
 * persists the user's choice to localStorage.
 *
 * The FOUC-prevention script in index.html has already set the attribute
 * before this component mounts. This provider keeps the attribute in
 * sync as the user switches themes from the UI.
 *
 * Custom theme behaviour (Phase 3 / plan §2.3):
 *   * When themeId === "custom", fetch the saved override file via
 *     GET /api/system/theme on mount.
 *   * Apply the parsed theme's `base` to <html data-theme> (so the
 *     standard cascade still drives every non-overridden token) and
 *     inject the override tokens into a <style id="qmail-user-theme">
 *     tag in <head>.
 *   * If no custom file is saved yet (exists:false, theme:null), fall
 *     back to the persisted base (or dark) visually but keep the picker
 *     showing "custom" so the user can still open the editor.
 */

const STYLE_TAG_ID = "qmail-user-theme";

function readStoredBase() {
  try {
    const stored = localStorage.getItem(THEME_BASE_STORAGE_KEY);
    if (stored && STANDARD_THEMES.includes(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "dark";
}

function readInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && (STANDARD_THEMES.includes(stored) || stored === "custom")) {
      return stored;
    }
  } catch {
    /* localStorage unavailable — fall through to detection */
  }

  /* Honour OS preference on first launch (plan §10.3 / index.html script). */
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

function buildOverrideCss(theme) {
  if (!theme || !theme.tokens) return "";
  const lines = [":root[data-theme=\"custom\"] {"];
  const a11y = theme.a11y || {};
  for (const [key, value] of Object.entries(theme.tokens)) {
    lines.push(`  ${key}: ${value};`);
  }
  if (a11y.reduced_motion) lines.push("  --motion-scale: 0;");
  if (a11y.large_print) lines.push("  --font-scale: 1.25;");
  lines.push("}");
  return lines.join("\n");
}

function applyOverrideStyle(css) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_TAG_ID);
  if (!css) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_TAG_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(readInitialTheme);
  const [customTheme, setCustomTheme] = useState(null);
  const [customStatus, setCustomStatus] = useState("idle");
  // Tracks the base used to drive data-theme while themeId === "custom".
  // Reads from localStorage on first mount so the saved choice survives
  // reloads (the FOUC script already used the same key).
  const [customBase, setCustomBase] = useState(readStoredBase);
  // Avoid the StrictMode double-effect causing two fetches.
  const fetchedOnceRef = useRef(false);

  // Resolve the effective data-theme attribute. For custom themes, the
  // base provides the un-overridden token values; overrides come from
  // the <style id="qmail-user-theme"> tag.
  const effectiveDataTheme = themeId === "custom" ? customBase : themeId;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveDataTheme);
    if (STANDARD_THEMES.includes(effectiveDataTheme)) {
      window.electronAPI?.notifyThemeChanged?.(effectiveDataTheme);
    }
  }, [effectiveDataTheme]);

  // On mount (and any switch INTO "custom"), fetch the saved override file
  // and inject the <style> tag. On switching AWAY from "custom", remove
  // the style tag so the standard cascade fully applies.
  useEffect(() => {
    if (themeId !== "custom") {
      applyOverrideStyle("");
      return;
    }

    // Guard against StrictMode double-invoke: only fetch on the first
    // real entry into "custom" per session. Subsequent switches use the
    // already-loaded customTheme; explicit saveCustom() also refreshes.
    if (fetchedOnceRef.current) {
      applyOverrideStyle(buildOverrideCss(customTheme));
      return;
    }
    fetchedOnceRef.current = true;

    setCustomStatus("loading");
    fetchUserTheme().then((result) => {
      if (!result.success) {
        setCustomStatus("error");
        return;
      }
      const loaded = result.data.theme;
      if (loaded) {
        setCustomTheme(loaded);
        setCustomBase(loaded.base);
        try {
          localStorage.setItem(THEME_BASE_STORAGE_KEY, loaded.base);
        } catch {
          /* ignore */
        }
        applyOverrideStyle(buildOverrideCss(loaded));
        setCustomStatus("ready");
      } else {
        // exists:false || parse failure — no saved overrides yet.
        // Keep the active theme as "custom" but fall back visually to
        // the persisted base. The editor will surface this state.
        setCustomTheme(null);
        applyOverrideStyle("");
        setCustomStatus("empty");
      }
    });
  }, [themeId, customTheme]);

  const setTheme = useCallback((next) => {
    if (!STANDARD_THEMES.includes(next) && next !== "custom") {
      return;
    }
    setThemeId(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Theme switching still works in-session even if persistence
       * fails — there's nothing to surface here. */
    }
    // Switching away from "custom" should let the next entry refetch
    // (so a saveCustom from elsewhere is visible). Reset the guard.
    if (next !== "custom") {
      fetchedOnceRef.current = false;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onThemeSelect?.((next) => {
      if (STANDARD_THEMES.includes(next)) {
        setTheme(next);
      }
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [setTheme]);

  const saveCustom = useCallback(async (themeObj) => {
    setCustomStatus("saving");
    const result = await saveUserTheme(themeObj);
    if (!result.success) {
      setCustomStatus("error");
      return result;
    }
    setCustomTheme(themeObj);
    setCustomBase(themeObj.base);
    try {
      localStorage.setItem(THEME_BASE_STORAGE_KEY, themeObj.base);
      localStorage.setItem(THEME_STORAGE_KEY, "custom");
    } catch {
      /* ignore */
    }
    applyOverrideStyle(buildOverrideCss(themeObj));
    setThemeId("custom");
    setCustomStatus("ready");
    return result;
  }, []);

  const clearCustom = useCallback(async () => {
    setCustomStatus("clearing");
    const result = await clearUserTheme();
    if (!result.success) {
      setCustomStatus("error");
      return result;
    }
    setCustomTheme(null);
    applyOverrideStyle("");
    // Move the user back to the persisted base (or dark) — picker shows
    // the base as selected, not "custom".
    const base = customBase || "dark";
    setThemeId(base);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, base);
    } catch {
      /* ignore */
    }
    fetchedOnceRef.current = false;
    setCustomStatus("idle");
    return result;
  }, [customBase]);

  const value = useMemo(
    () => ({
      themeId,
      setTheme,
      customTheme,
      customBase,
      customStatus,
      saveCustom,
      clearCustom,
    }),
    [themeId, setTheme, customTheme, customBase, customStatus, saveCustom, clearCustom]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
