/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { X, RotateCcw, Save } from "lucide-react";
import { STANDARD_THEMES } from "./themeContext";
import { useTheme } from "./useTheme";
import "./ThemeEditorModal.css";

/* Theme editor modal — exposes the editable subset of tokens (plan §2.5)
 * so non-technical users can customise the look without touching CSS.
 *
 * On open: reads the current computed values for each editable token off
 * <html>, so the controls start from the user's currently-visible state
 * (whether that's dark/light/high-contrast or a previously saved custom
 * theme).
 *
 * On Save: builds the JSON theme object per §2.4, calls saveCustom() from
 * the ThemeProvider, and closes if the save succeeds. Validation runs
 * client-side in themeService before any network call.
 *
 * On Reset: clears the custom override file and falls back to the
 * persisted base theme. The picker reflects the new active theme.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// The eight editable tokens per plan §2.5. Order is the modal's tab
// order. Color tokens come first because they're the most-tweaked.
const EDITABLE = [
  { key: "--accent-primary", label: "Accent color", type: "color", fallback: "#a78bfa" },
  { key: "--accent-secondary", label: "Secondary accent", type: "color", fallback: "#7dd3fc" },
  { key: "--secondary-bg", label: "Surface color", type: "color", fallback: "#151921" },
  { key: "--text-primary", label: "Text color", type: "color", fallback: "#f8fafc" },
  { key: "--radius-md", label: "Corner radius", type: "px", min: 0, max: 24, step: 1, fallback: "12px" },
  { key: "--font-scale", label: "Font size", type: "scale", min: 0.8, max: 1.5, step: 0.05, fallback: "1" },
  { key: "--glass-blur-amount", label: "Glass blur", type: "px", min: 0, max: 32, step: 1, fallback: "16px" },
  { key: "--motion-scale", label: "Animation speed", type: "scale", min: 0, max: 1, step: 0.1, fallback: "1" },
];

function readCurrentValue(key, fallback) {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(key)
    .trim();
  return raw || fallback;
}

// Normalise the read value into the input's expected format. Colour
// inputs only accept #rrggbb; sliders accept numeric strings.
function normaliseForInput(token, raw) {
  if (token.type === "color") {
    if (HEX_RE.test(raw)) return raw.toLowerCase();
    // The dark theme has gradients/rgba for some bg tokens — fall back
    // to a sensible solid the user can change from.
    return token.fallback;
  }
  if (token.type === "px") {
    const m = raw.match(/(-?\d+(\.\d+)?)/);
    return m ? Number(m[1]) : Number(token.fallback.replace(/px$/, ""));
  }
  // scale
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number(token.fallback);
}

function readDraftFromDocument() {
  const draft = {};
  for (const token of EDITABLE) {
    draft[token.key] = normaliseForInput(
      token,
      readCurrentValue(token.key, token.fallback)
    );
  }
  return draft;
}

function draftToTokens(draft) {
  const tokens = {};
  for (const token of EDITABLE) {
    const raw = draft[token.key];
    if (token.type === "color") {
      tokens[token.key] = String(raw).toLowerCase();
    } else if (token.type === "px") {
      tokens[token.key] = `${raw}px`;
    } else {
      // scale: store as a string (CSS treats unitless numbers fine in
      // calc() and as font-scale; storing "1" not "1.0" keeps the file
      // small).
      tokens[token.key] = String(raw);
    }
  }
  return tokens;
}

function buildThemePayload({ draft, base, a11y, name }) {
  return {
    schema: "qmail-theme/1",
    name: name || "My Theme",
    base,
    a11y: {
      reduced_motion: Boolean(a11y.reduced_motion),
      large_print: Boolean(a11y.large_print),
    },
    tokens: draftToTokens(draft),
  };
}

export function ThemeEditorModal({ open, onClose }) {
  const { themeId, customTheme, customBase, saveCustom, clearCustom, customStatus } =
    useTheme();

  const initialBase = useMemo(() => {
    if (customTheme?.base && STANDARD_THEMES.includes(customTheme.base)) {
      return customTheme.base;
    }
    if (STANDARD_THEMES.includes(customBase)) return customBase;
    if (STANDARD_THEMES.includes(themeId)) return themeId;
    return "dark";
  }, [customTheme, customBase, themeId]);

  const [draft, setDraft] = useState(() => readDraftFromDocument());
  const [base, setBase] = useState(initialBase);
  const [name, setName] = useState(customTheme?.name || "My Theme");
  const [a11y, setA11y] = useState({
    reduced_motion: Boolean(customTheme?.a11y?.reduced_motion),
    large_print: Boolean(customTheme?.a11y?.large_print),
  });
  const [error, setError] = useState(null);

  // When the modal re-opens, re-read the current document state so the
  // editor matches what the user is looking at. (Closing + reopening is
  // an explicit "I want to start from the live look" gesture.)
  useEffect(() => {
    if (!open) return;
    setDraft(readDraftFromDocument());
    setBase(initialBase);
    setName(customTheme?.name || "My Theme");
    setA11y({
      reduced_motion: Boolean(customTheme?.a11y?.reduced_motion),
      large_print: Boolean(customTheme?.a11y?.large_print),
    });
    setError(null);
  }, [open, initialBase, customTheme]);

  // Esc closes (matches existing modal patterns in the codebase).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isSaving = customStatus === "saving";
  const isClearing = customStatus === "clearing";

  const handleDraftChange = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setError(null);
    const payload = buildThemePayload({ draft, base, a11y, name });
    const result = await saveCustom(payload);
    if (!result.success) {
      setError(result.error || "Save failed");
      return;
    }
    onClose();
  };

  const handleReset = async () => {
    setError(null);
    const ok = window.confirm(
      "Delete your custom theme and return to the standard themes? This cannot be undone."
    );
    if (!ok) return;
    const result = await clearCustom();
    if (!result.success) {
      setError(result.error || "Reset failed");
      return;
    }
    onClose();
  };

  return (
    <div
      className="theme-editor__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="theme-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-editor-title"
      >
        <header className="theme-editor__header">
          <h2 id="theme-editor-title" className="theme-editor__title">
            Custom theme
          </h2>
          <button
            type="button"
            className="theme-editor__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="theme-editor__body">
          <section className="theme-editor__field-group">
            <label className="theme-editor__label" htmlFor="theme-editor-name">
              Name
            </label>
            <input
              id="theme-editor-name"
              type="text"
              className="theme-editor__input"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
            />
          </section>

          <section className="theme-editor__field-group">
            <label className="theme-editor__label" htmlFor="theme-editor-base">
              Start from
            </label>
            <select
              id="theme-editor-base"
              className="theme-editor__input"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            >
              {STANDARD_THEMES.map((id) => (
                <option key={id} value={id}>
                  {id === "high-contrast"
                    ? "High contrast"
                    : id.charAt(0).toUpperCase() + id.slice(1)}
                </option>
              ))}
            </select>
            <p className="theme-editor__hint">
              The base supplies any token you do not override.
            </p>
          </section>

          <section className="theme-editor__tokens">
            {EDITABLE.map((token) => (
              <div key={token.key} className="theme-editor__token">
                <label
                  className="theme-editor__label"
                  htmlFor={`theme-editor-${token.key}`}
                >
                  {token.label}
                </label>
                {token.type === "color" ? (
                  <div className="theme-editor__color-row">
                    <input
                      id={`theme-editor-${token.key}`}
                      type="color"
                      className="theme-editor__color"
                      value={draft[token.key]}
                      onChange={(e) =>
                        handleDraftChange(token.key, e.target.value)
                      }
                    />
                    <span className="theme-editor__value">
                      {draft[token.key]}
                    </span>
                  </div>
                ) : (
                  <div className="theme-editor__slider-row">
                    <input
                      id={`theme-editor-${token.key}`}
                      type="range"
                      className="theme-editor__slider"
                      min={token.min}
                      max={token.max}
                      step={token.step}
                      value={draft[token.key]}
                      onChange={(e) =>
                        handleDraftChange(token.key, Number(e.target.value))
                      }
                    />
                    <span className="theme-editor__value">
                      {token.type === "px"
                        ? `${draft[token.key]}px`
                        : draft[token.key]}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </section>

          <section className="theme-editor__field-group">
            <p className="theme-editor__group-title">Accessibility</p>
            <label className="theme-editor__checkbox-row">
              <input
                type="checkbox"
                checked={a11y.reduced_motion}
                onChange={(e) =>
                  setA11y((prev) => ({
                    ...prev,
                    reduced_motion: e.target.checked,
                  }))
                }
              />
              <span>Reduced motion</span>
            </label>
            <label className="theme-editor__checkbox-row">
              <input
                type="checkbox"
                checked={a11y.large_print}
                onChange={(e) =>
                  setA11y((prev) => ({
                    ...prev,
                    large_print: e.target.checked,
                  }))
                }
              />
              <span>Large print</span>
            </label>
          </section>

          {error ? (
            <p className="theme-editor__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="theme-editor__footer">
          <button
            type="button"
            className="theme-editor__button theme-editor__button--ghost"
            onClick={handleReset}
            disabled={isSaving || isClearing}
            title="Delete the saved custom theme"
          >
            <RotateCcw size={16} aria-hidden />
            Reset
          </button>
          <div className="theme-editor__footer-right">
            <button
              type="button"
              className="theme-editor__button theme-editor__button--ghost"
              onClick={onClose}
              disabled={isSaving || isClearing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="theme-editor__button theme-editor__button--primary"
              onClick={handleSave}
              disabled={isSaving || isClearing}
            >
              <Save size={16} aria-hidden />
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
