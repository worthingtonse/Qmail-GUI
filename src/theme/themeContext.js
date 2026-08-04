import { createContext } from "react";

/* Public surface for any component that needs the active theme.
 *
 * Phase 1 ships dark/light/high-contrast as standard themes; Phase 3
 * adds 'custom'. The FOUC script in index.html applies the persisted
 * theme synchronously before React mounts, so by the time this
 * context is read the DOM is already correctly themed.
 */

export const THEME_STORAGE_KEY = "qmail.theme";
export const THEME_BASE_STORAGE_KEY = "qmail.theme.base";

export const STANDARD_THEMES = [
  "dark",
  "light",
  "high-contrast",
  "solarized",
  "nord",
  "dracula",
  "sepia",
];

export const ThemeContext = createContext({
  themeId: "dark",
  setTheme: () => {},
  customTheme: null,
  customStatus: "idle",
  saveCustom: async () => ({ success: false }),
  clearCustom: async () => ({ success: false }),
});
