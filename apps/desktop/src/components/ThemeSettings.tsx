import { useEffect, useState } from "react";
import {
  type AppTheme,
  type ThemeBase,
  COLOR_PRESETS,
  DEFAULT_CUSTOM,
  DEFAULT_THEME,
  loadTheme,
  setAndApplyTheme,
  watchSystemTheme,
} from "../lib/theme";
import { ThemeCustomPanel } from "./ThemeCustomPanel";

const BASE_OPTIONS: {
  id: ThemeBase;
  label: string;
  className: string;
}[] = [
  { id: "light", label: "Light", className: "swatch-light" },
  { id: "dark", label: "Dark", className: "swatch-dark" },
  { id: "midnight", label: "Midnight", className: "swatch-midnight" },
  { id: "brand", label: "Brand", className: "swatch-brand" },
  { id: "system", label: "Sync", className: "swatch-system" },
];

export function ThemeSettings() {
  const [theme, setTheme] = useState<AppTheme>(() => loadTheme());
  const [customOpen, setCustomOpen] = useState(
    () => loadTheme().colorTheme === "custom",
  );

  useEffect(() => {
    return watchSystemTheme(() => {
      const t = loadTheme();
      if (t.base === "system") setAndApplyTheme(t);
    });
  }, []);

  function commit(next: AppTheme) {
    setTheme(next);
    setAndApplyTheme(next);
  }

  function selectBase(base: ThemeBase) {
    commit({
      ...theme,
      base,
      colorTheme: null,
    });
  }

  function selectPreset(id: string) {
    setCustomOpen(false);
    commit({ ...theme, colorTheme: id });
  }

  function openCustom() {
    setCustomOpen(true);
    commit({
      ...theme,
      colorTheme: "custom",
      custom: theme.custom.colors.length
        ? theme.custom
        : { ...DEFAULT_CUSTOM, colors: [...DEFAULT_CUSTOM.colors] },
    });
  }

  if (customOpen) {
    return (
      <ThemeCustomPanel
        custom={theme.custom}
        onChange={(custom) =>
          commit({ ...theme, colorTheme: "custom", custom })
        }
        onBack={() => setCustomOpen(false)}
        onReset={() => {
          commit({
            ...DEFAULT_THEME,
            custom: {
              ...DEFAULT_CUSTOM,
              colors: [...DEFAULT_CUSTOM.colors],
            },
          });
          setCustomOpen(false);
        }}
      />
    );
  }

  return (
    <div className="theme-settings">
      <div className="theme-section">
        <h4>Theme</h4>
        <p className="theme-section-desc">
          Pick a base look. Color themes below tint accents and backgrounds.
        </p>
        <div className="theme-base-row">
          {BASE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`theme-base-swatch ${opt.className}${
                theme.base === opt.id ? " on" : ""
              }`}
              title={opt.label}
              aria-pressed={theme.base === opt.id}
              onClick={() => selectBase(opt.id)}
            >
              {opt.label}
              {theme.base === opt.id && !theme.colorTheme ? (
                <span className="theme-check" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-section">
        <h4>Color Themes</h4>
        <p className="theme-section-desc">
          All themes are free — including custom colors.
        </p>
        <div className="theme-color-grid">
          <button
            type="button"
            className={`theme-color-swatch custom-tile${
              theme.colorTheme === "custom" ? " on" : ""
            }`}
            onClick={openCustom}
            title="Custom theme"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path
                fill="currentColor"
                d="M12 3a9 9 0 0 0 0 18c.55 0 1-.45 1-1 0-.26-.1-.5-.27-.69a1.06 1.06 0 0 1-.23-.66c0-.55.45-1 1-1H16a5 5 0 0 0 0-10H12zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
              />
            </svg>
            Custom
            {theme.colorTheme === "custom" ? (
              <span className="theme-check" aria-hidden>
                ✓
              </span>
            ) : null}
          </button>
          {COLOR_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`theme-color-swatch${
                theme.colorTheme === p.id ? " on" : ""
              }`}
              title={p.label}
              aria-label={p.label}
              aria-pressed={theme.colorTheme === p.id}
              style={{
                background: `linear-gradient(135deg, ${p.gradient.join(", ")})`,
              }}
              onClick={() => selectPreset(p.id)}
            >
              {theme.colorTheme === p.id ? (
                <span className="theme-check" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
