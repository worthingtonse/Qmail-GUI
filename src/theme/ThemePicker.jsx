import { useState } from "react";
import { Moon, Sun, Contrast, Sparkles, Edit3 } from "lucide-react";
import { useTheme } from "./useTheme";
import { ThemeEditorModal } from "./ThemeEditorModal";
import "./ThemePicker.css";

const OPTIONS = [
  {
    id: "dark",
    label: "Dark",
    description: "The default QMail look.",
    Icon: Moon,
  },
  {
    id: "light",
    label: "Light",
    description: "Bright background for daylight use.",
    Icon: Sun,
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    description: "Yellow on black, larger text, no motion.",
    Icon: Contrast,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Build your own — accent colors, sizing, motion.",
    Icon: Sparkles,
  },
];

/* Theme picker for AccountPane's Application Settings section.
 * Replaces the "Dark Mode" ComingSoonToggle placeholder. Phase 3 adds
 * the Custom option with an inline Edit button that opens the
 * ThemeEditorModal.
 */
export function ThemePicker() {
  const { themeId, setTheme, customStatus, customTheme } = useTheme();
  const [editorOpen, setEditorOpen] = useState(false);

  const handleSelect = (id) => {
    if (id === "custom" && !customTheme) {
      // No saved custom theme yet — open the editor instead of switching
      // to an empty custom slot the user can't visually distinguish.
      setEditorOpen(true);
      return;
    }
    setTheme(id);
  };

  return (
    <fieldset className="theme-picker">
      <legend className="theme-picker__legend">Appearance</legend>
      <p className="theme-picker__description">
        Choose the look of the QMail interface.
      </p>
      <ul className="theme-picker__list">
        {OPTIONS.map(({ id, label, description, Icon }) => {
          const checked = themeId === id;
          const isCustom = id === "custom";
          return (
            <li key={id} className="theme-picker__item">
              <label
                className={
                  "theme-picker__option" +
                  (checked ? " theme-picker__option--checked" : "")
                }
              >
                <input
                  type="radio"
                  name="qmail-theme"
                  value={id}
                  checked={checked}
                  onChange={() => handleSelect(id)}
                  className="theme-picker__input"
                />
                <Icon size={20} className="theme-picker__icon" aria-hidden />
                <span className="theme-picker__text">
                  <span className="theme-picker__label">{label}</span>
                  <span className="theme-picker__hint">
                    {isCustom && customStatus === "loading"
                      ? "Loading your saved theme…"
                      : isCustom && !customTheme
                        ? "Not saved yet — opens the editor."
                        : description}
                  </span>
                </span>
                {isCustom ? (
                  <button
                    type="button"
                    className="theme-picker__edit"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditorOpen(true);
                    }}
                    aria-label="Edit custom theme"
                  >
                    <Edit3 size={14} aria-hidden />
                    Edit
                  </button>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>

      <ThemeEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
      />
    </fieldset>
  );
}
