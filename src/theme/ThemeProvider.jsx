/* eslint-disable react/prop-types */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ThemeContext,
  STANDARD_THEMES,
  THEME_STORAGE_KEY,
} from "./themeContext";

/* ThemeProvider — applies the active theme to <html data-theme="..."> and
 * persists the user's choice to localStorage.
 *
 * The FOUC-prevention script in index.html has already set the attribute
 * before this component mounts. This provider keeps the attribute in
 * sync as the user switches themes from the UI.
 *
 * Custom themes are stubbed out in Phase 1 (selecting 'custom' is allowed
 * but only sets the attribute — no override file is fetched yet). Phase 3
 * adds the /api/system/theme integration.
 */

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

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(readInitialTheme);

  /* Apply the attribute to <html>. The FOUC script does this once at
   * load; this effect keeps it correct after any in-app switch. */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeId);
  }, [themeId]);

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
  }, []);

  const value = useMemo(() => ({ themeId, setTheme }), [themeId, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
