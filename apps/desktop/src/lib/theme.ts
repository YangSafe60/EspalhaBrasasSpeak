/** Client-side Discord-style themes (localStorage + CSS variables). */

export const THEME_STORAGE_KEY = "eb_theme";
export const THEME_DEVICE_STORAGE_KEY = "eb_theme_device";

export type ThemeBase = "brand" | "dark" | "midnight" | "light" | "system";

export type ServerThemeMode = "mine" | "server";

export type CustomTheme = {
  mode: "dark" | "light";
  colors: string[];
  intensity: number;
};

export type AppTheme = {
  base: ThemeBase;
  /** Preset id, "custom", or null (base only / brand accents). */
  colorTheme: string | null;
  custom: CustomTheme;
  /** When on, theme is stored in the shared account key (for future multi-device sync). */
  syncAcrossDevices: boolean;
  /** Prefer personal theme or the active server's accent while in a server. */
  serverThemeMode: ServerThemeMode;
};

export type CssVars = Record<string, string>;

export type ColorPreset = {
  id: string;
  label: string;
  /** Swatch gradient stops */
  gradient: string[];
  colors: string[];
  intensity: number;
  preferredMode?: "dark" | "light";
};

const BRAND_VARS: CssVars = {
  "--bg-0": "#050505",
  "--bg-1": "#0c0c0c",
  "--bg-2": "#141414",
  "--bg-3": "#1c1c1c",
  "--panel": "rgba(12, 12, 12, 0.88)",
  "--panel-solid": "#0c0c0c",
  "--border": "rgba(255, 255, 255, 0.1)",
  "--text": "#f4f4f4",
  "--text-dim": "#9a9a9a",
  "--accent": "#e31b23",
  "--accent-2": "#ff3b42",
  "--accent-soft": "rgba(227, 27, 35, 0.16)",
  "--bg-end": "#000000",
  "--accent-glow": "rgba(227, 27, 35, 0.22)",
  "--accent-glow-2": "rgba(227, 27, 35, 0.08)",
};

export const DEFAULT_CUSTOM: CustomTheme = {
  mode: "dark",
  colors: ["#5865f2"],
  intensity: 70,
};

export const DEFAULT_THEME: AppTheme = {
  base: "brand",
  colorTheme: null,
  custom: { ...DEFAULT_CUSTOM, colors: [...DEFAULT_CUSTOM.colors] },
  syncAcrossDevices: true,
  serverThemeMode: "mine",
};

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: "blurple",
    label: "Blurple",
    gradient: ["#5865f2", "#3c45a5"],
    colors: ["#5865f2"],
    intensity: 72,
  },
  {
    id: "violet",
    label: "Violet",
    gradient: ["#9b59b6", "#6c3483"],
    colors: ["#9b59b6", "#5dade2"],
    intensity: 70,
  },
  {
    id: "mint",
    label: "Mint",
    gradient: ["#1abc9c", "#16a085"],
    colors: ["#1abc9c"],
    intensity: 65,
  },
  {
    id: "sunset",
    label: "Sunset",
    gradient: ["#e67e22", "#c0392b"],
    colors: ["#e67e22", "#e74c3c"],
    intensity: 75,
  },
  {
    id: "rose",
    label: "Rose",
    gradient: ["#e84393", "#6c5ce7"],
    colors: ["#e84393", "#6c5ce7"],
    intensity: 70,
  },
  {
    id: "ocean",
    label: "Ocean",
    gradient: ["#0984e3", "#00cec9"],
    colors: ["#0984e3", "#00cec9"],
    intensity: 68,
  },
  {
    id: "forest",
    label: "Forest",
    gradient: ["#27ae60", "#1e8449"],
    colors: ["#27ae60"],
    intensity: 60,
  },
  {
    id: "ember",
    label: "Ember",
    gradient: ["#e31b23", "#c88920"],
    colors: ["#e31b23", "#ff3b42"],
    intensity: 80,
  },
  {
    id: "cotton",
    label: "Cotton Candy",
    gradient: ["#fd79a8", "#a29bfe"],
    colors: ["#fd79a8", "#a29bfe"],
    intensity: 55,
    preferredMode: "light",
  },
  {
    id: "aurora",
    label: "Aurora",
    gradient: ["#00b894", "#6c5ce7", "#fd79a8"],
    colors: ["#00b894", "#6c5ce7"],
    intensity: 70,
  },
  {
    id: "steel",
    label: "Steel",
    gradient: ["#636e72", "#2d3436"],
    colors: ["#74b9ff", "#636e72"],
    intensity: 50,
  },
  {
    id: "mango",
    label: "Mango",
    gradient: ["#fdcb6e", "#e17055"],
    colors: ["#fdcb6e", "#e17055"],
    intensity: 65,
  },
  {
    id: "lava",
    label: "Lava",
    gradient: ["#d63031", "#2d3436"],
    colors: ["#d63031"],
    intensity: 85,
  },
  {
    id: "ice",
    label: "Ice",
    gradient: ["#74b9ff", "#dfe6e9"],
    colors: ["#74b9ff", "#81ecec"],
    intensity: 45,
    preferredMode: "light",
  },
];

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function normalizeHex(raw: string): string | null {
  let s = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function mix(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number,
) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function rgba(rgb: { r: number; g: number; b: number }, a: number) {
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${a})`;
}

function resolveBaseMode(base: ThemeBase): "dark" | "light" {
  if (base === "light") return "light";
  if (base === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return "dark";
}

function baseShell(mode: "dark" | "light", variant: ThemeBase): CssVars {
  if (mode === "light") {
    return {
      "--bg-0": "#f2f3f5",
      "--bg-1": "#e3e5e8",
      "--bg-2": "#ffffff",
      "--bg-3": "#f2f3f5",
      "--panel": "rgba(255, 255, 255, 0.92)",
      "--panel-solid": "#ffffff",
      "--border": "rgba(0, 0, 0, 0.12)",
      "--text": "#060607",
      "--text-dim": "#4e5058",
      "--bg-end": "#e3e5e8",
      "--accent": "#e31b23",
      "--accent-2": "#ff3b42",
      "--accent-soft": "rgba(227, 27, 35, 0.14)",
      "--accent-glow": "rgba(227, 27, 35, 0.12)",
      "--accent-glow-2": "rgba(227, 27, 35, 0.06)",
    };
  }
  if (variant === "midnight") {
    return {
      "--bg-0": "#000000",
      "--bg-1": "#050505",
      "--bg-2": "#0a0a0a",
      "--bg-3": "#121212",
      "--panel": "rgba(8, 8, 8, 0.92)",
      "--panel-solid": "#080808",
      "--border": "rgba(255, 255, 255, 0.08)",
      "--text": "#f2f3f5",
      "--text-dim": "#8b8d94",
      "--bg-end": "#000000",
      "--accent": "#5865f2",
      "--accent-2": "#7983f5",
      "--accent-soft": "rgba(88, 101, 242, 0.16)",
      "--accent-glow": "rgba(88, 101, 242, 0.18)",
      "--accent-glow-2": "rgba(88, 101, 242, 0.06)",
    };
  }
  if (variant === "dark") {
    return {
      "--bg-0": "#1e1f22",
      "--bg-1": "#2b2d31",
      "--bg-2": "#313338",
      "--bg-3": "#383a40",
      "--panel": "rgba(30, 31, 34, 0.92)",
      "--panel-solid": "#1e1f22",
      "--border": "rgba(255, 255, 255, 0.1)",
      "--text": "#f2f3f5",
      "--text-dim": "#b5bac1",
      "--bg-end": "#1a1b1e",
      "--accent": "#5865f2",
      "--accent-2": "#7983f5",
      "--accent-soft": "rgba(88, 101, 242, 0.18)",
      "--accent-glow": "rgba(88, 101, 242, 0.2)",
      "--accent-glow-2": "rgba(88, 101, 242, 0.08)",
    };
  }
  // brand
  return { ...BRAND_VARS };
}

export function computeCustomVars(custom: CustomTheme): CssVars {
  const c0 = hexToRgb(custom.colors[0] || "#5865f2") || {
    r: 88,
    g: 101,
    b: 242,
  };
  const c1 = hexToRgb(custom.colors[1] || custom.colors[0] || "#5865f2") || c0;
  const intensity = clamp(custom.intensity, 0, 100) / 100;
  const mode = custom.mode;

  const darkBase = {
    bg0: { r: 5, g: 5, b: 5 },
    bg1: { r: 12, g: 12, b: 12 },
    bg2: { r: 20, g: 20, b: 20 },
    bg3: { r: 28, g: 28, b: 28 },
  };
  const lightBase = {
    bg0: { r: 242, g: 243, b: 245 },
    bg1: { r: 227, g: 229, b: 232 },
    bg2: { r: 255, g: 255, b: 255 },
    bg3: { r: 242, g: 243, b: 245 },
  };
  const base = mode === "light" ? lightBase : darkBase;
  const tintStrength = intensity * (mode === "light" ? 0.28 : 0.35);

  const bg0 = mix(base.bg0, c0, tintStrength * 0.55);
  const bg1 = mix(base.bg1, c0, tintStrength * 0.4);
  const bg2 = mix(base.bg2, c0, tintStrength * 0.22);
  const bg3 = mix(base.bg3, c1, tintStrength * 0.28);

  const accent2 = mix(c0, c1, 0.45);

  return {
    "--bg-0": rgbToHex(bg0.r, bg0.g, bg0.b),
    "--bg-1": rgbToHex(bg1.r, bg1.g, bg1.b),
    "--bg-2": rgbToHex(bg2.r, bg2.g, bg2.b),
    "--bg-3": rgbToHex(bg3.r, bg3.g, bg3.b),
    "--panel":
      mode === "light"
        ? rgba(mix(bg2, { r: 255, g: 255, b: 255 }, 0.5), 0.94)
        : rgba(bg1, 0.9),
    "--panel-solid": rgbToHex(bg1.r, bg1.g, bg1.b),
    "--border":
      mode === "light" ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.1)",
    "--text": mode === "light" ? "#060607" : "#f4f4f4",
    "--text-dim": mode === "light" ? "#4e5058" : "#9a9a9a",
    "--accent": rgbToHex(c0.r, c0.g, c0.b),
    "--accent-2": rgbToHex(accent2.r, accent2.g, accent2.b),
    "--accent-soft": rgba(c0, mode === "light" ? 0.14 : 0.18),
    "--bg-end":
      mode === "light"
        ? rgbToHex(bg1.r, bg1.g, bg1.b)
        : rgbToHex(
            mix(bg0, { r: 0, g: 0, b: 0 }, 0.4).r,
            mix(bg0, { r: 0, g: 0, b: 0 }, 0.4).g,
            mix(bg0, { r: 0, g: 0, b: 0 }, 0.4).b,
          ),
    "--accent-glow": rgba(c0, mode === "light" ? 0.12 : 0.22),
    "--accent-glow-2": rgba(c1, mode === "light" ? 0.06 : 0.1),
  };
}

export function resolveThemeVars(theme: AppTheme): {
  vars: CssVars;
  mode: "dark" | "light";
} {
  if (theme.colorTheme === "custom") {
    const vars = computeCustomVars(theme.custom);
    return { vars, mode: theme.custom.mode };
  }

  const preset = COLOR_PRESETS.find((p) => p.id === theme.colorTheme);
  if (preset) {
    const mode =
      preset.preferredMode ||
      (theme.base === "light" ||
      (theme.base === "system" && resolveBaseMode("system") === "light")
        ? "light"
        : "dark");
    // When a color preset is active, keep base for dark/light shell preference
    const shellMode =
      theme.base === "light"
        ? "light"
        : theme.base === "system"
          ? resolveBaseMode("system")
          : mode === "light"
            ? "light"
            : "dark";
    return {
      vars: computeCustomVars({
        mode: shellMode,
        colors: preset.colors,
        intensity: preset.intensity,
      }),
      mode: shellMode,
    };
  }

  const mode = resolveBaseMode(theme.base);
  const shellBase =
    theme.base === "system"
      ? mode === "light"
        ? "light"
        : "dark"
      : theme.base;
  return { vars: baseShell(mode, shellBase), mode };
}

const VAR_KEYS = Object.keys(BRAND_VARS);

export type ApplyThemeOptions = {
  /** Active server accent when serverThemeMode is "server". */
  serverAccent?: string | null;
  friendsHome?: boolean;
};

function withServerAccent(vars: CssVars, accent: string, mode: "dark" | "light"): CssVars {
  const c0 = hexToRgb(accent);
  if (!c0) return vars;
  const accent2 = mix(c0, { r: 255, g: 255, b: 255 }, mode === "light" ? 0.2 : 0.15);
  return {
    ...vars,
    "--accent": rgbToHex(c0.r, c0.g, c0.b),
    "--accent-2": rgbToHex(accent2.r, accent2.g, accent2.b),
    "--accent-soft": rgba(c0, mode === "light" ? 0.14 : 0.18),
    "--accent-glow": rgba(c0, mode === "light" ? 0.12 : 0.22),
    "--accent-glow-2": rgba(c0, mode === "light" ? 0.06 : 0.1),
  };
}

export function applyTheme(theme: AppTheme, options: ApplyThemeOptions = {}) {
  const root = document.documentElement;
  let { vars, mode } = resolveThemeVars(theme);
  const useServer =
    theme.serverThemeMode === "server" &&
    !options.friendsHome &&
    options.serverAccent;
  if (useServer && options.serverAccent) {
    vars = withServerAccent(vars, options.serverAccent, mode);
  }
  for (const key of VAR_KEYS) {
    const v = vars[key];
    if (v) root.style.setProperty(key, v);
  }
  root.dataset.theme = mode;
  root.dataset.themeBase = theme.base;
  root.dataset.serverTheme = theme.serverThemeMode;
  if (theme.colorTheme) root.dataset.colorTheme = theme.colorTheme;
  else delete root.dataset.colorTheme;
}

function parseTheme(raw: string | null): AppTheme | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppTheme>;
    const base = (
      ["brand", "dark", "midnight", "light", "system"] as ThemeBase[]
    ).includes(parsed.base as ThemeBase)
      ? (parsed.base as ThemeBase)
      : "brand";
    const colors = Array.isArray(parsed.custom?.colors)
      ? parsed.custom!.colors
          .map((c) => normalizeHex(String(c)))
          .filter((c): c is string => Boolean(c))
          .slice(0, 2)
      : [...DEFAULT_CUSTOM.colors];
    return {
      base,
      colorTheme:
        typeof parsed.colorTheme === "string" || parsed.colorTheme === null
          ? parsed.colorTheme
          : null,
      custom: {
        mode: parsed.custom?.mode === "light" ? "light" : "dark",
        colors: colors.length ? colors : [...DEFAULT_CUSTOM.colors],
        intensity: clamp(Number(parsed.custom?.intensity ?? 70), 0, 100),
      },
      syncAcrossDevices: parsed.syncAcrossDevices !== false,
      serverThemeMode:
        parsed.serverThemeMode === "server" ? "server" : "mine",
    };
  } catch {
    return null;
  }
}

export function loadTheme(): AppTheme {
  const shared = parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  const device = parseTheme(localStorage.getItem(THEME_DEVICE_STORAGE_KEY));
  // Prefer the last-written preference about sync from either store.
  const syncHint =
    device?.syncAcrossDevices ?? shared?.syncAcrossDevices ?? true;
  if (!syncHint && device) return device;
  return shared || device || structuredClone(DEFAULT_THEME);
}

export function saveTheme(theme: AppTheme) {
  const payload = JSON.stringify(theme);
  if (theme.syncAcrossDevices) {
    localStorage.setItem(THEME_STORAGE_KEY, payload);
  } else {
    localStorage.setItem(THEME_DEVICE_STORAGE_KEY, payload);
  }
}

export function setAndApplyTheme(
  theme: AppTheme,
  options?: ApplyThemeOptions,
): AppTheme {
  saveTheme(theme);
  applyTheme(theme, options);
  return theme;
}

export function randomCustomTheme(mode?: "dark" | "light"): CustomTheme {
  const h = Math.floor(Math.random() * 360);
  const h2 = (h + 40 + Math.floor(Math.random() * 80)) % 360;
  return {
    mode: mode || (Math.random() > 0.35 ? "dark" : "light"),
    colors: [hsvToHex(h, 0.65 + Math.random() * 0.3, 0.85), hsvToHex(h2, 0.55, 0.9)],
    intensity: 55 + Math.floor(Math.random() * 35),
  };
}

let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

export function watchSystemTheme(onChange: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  if (systemListener) mq.removeEventListener("change", systemListener);
  systemListener = () => onChange();
  mq.addEventListener("change", systemListener);
  return () => {
    if (systemListener) mq.removeEventListener("change", systemListener);
    systemListener = null;
  };
}
