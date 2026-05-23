/* eslint-disable react/prop-types */
import { Moon, Sun, Contrast } from "lucide-react";
import { useTheme } from "./useTheme";
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
];

/* Theme picker for AccountPane's Application Settings section.
 * Replaces the "Dark Mode" ComingSoonToggle placeholder. Custom
 * theme support arrives in Phase 3. */
export function ThemePicker() {
  const { themeId, setTheme } = useTheme();

  return (
    <fieldset className="theme-picker">
      <legend className="theme-picker__legend">Appearance</legend>
      <p className="theme-picker__description">
        Choose the look of the QMail interface.
      </p>
      <ul className="theme-picker__list">
        {OPTIONS.map(({ id, label, description, Icon }) => {
          const checked = themeId === id;
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
                  onChange={() => setTheme(id)}
                  className="theme-picker__input"
                />
                <Icon size={20} className="theme-picker__icon" aria-hidden />
                <span className="theme-picker__text">
                  <span className="theme-picker__label">{label}</span>
                  <span className="theme-picker__hint">{description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
