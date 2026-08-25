/** Client-side accessibility prefs (localStorage + CSS / DOM). */

export const A11Y_STORAGE_KEY = "eb_a11y";
export const LEGACY_COMPACT_KEY = "eb_compact_messages";

export type UiDensity = "compact" | "default" | "spacious";
export type ChatDisplay = "default" | "compact";

export type AccessibilityPrefs = {
  chatFontSize: number;
  underlineLinks: boolean;
  chatDisplay: ChatDisplay;
  messageGroupGap: number;
  uiDensity: UiDensity;
  zoom: number;
  saturation: number;
  highContrast: boolean;
  reducedMotion: boolean;
  syncReducedMotion: boolean;
  playAnimatedEmoji: boolean;
  ttsRate: number;
  showImageDescriptions: boolean;
};

export const CHAT_FONT_SIZES = [12, 14, 15, 16, 18, 20, 24] as const;
export const MESSAGE_GROUP_GAPS = [0, 4, 8, 16, 24] as const;
export const ZOOM_LEVELS = [
  50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200,
] as const;

export const DEFAULT_A11Y: AccessibilityPrefs = {
  chatFontSize: 16,
  underlineLinks: false,
  chatDisplay: "default",
  messageGroupGap: 16,
  uiDensity: "default",
  zoom: 100,
  saturation: 100,
  highContrast: false,
  reducedMotion: false,
  syncReducedMotion: true,
  playAnimatedEmoji: true,
  ttsRate: 1,
  showImageDescriptions: false,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function nearest(values: readonly number[], n: number) {
  return values.reduce((best, v) =>
    Math.abs(v - n) < Math.abs(best - n) ? v : best,
  );
}

function osPrefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function effectiveReducedMotion(prefs: AccessibilityPrefs): boolean {
  if (prefs.syncReducedMotion) return osPrefersReducedMotion();
  return prefs.reducedMotion;
}

export function loadAccessibility(): AccessibilityPrefs {
  try {
    const raw = localStorage.getItem(A11Y_STORAGE_KEY);
    let parsed: Partial<AccessibilityPrefs> = {};
    if (raw) parsed = JSON.parse(raw) as Partial<AccessibilityPrefs>;

    // Migrate legacy compact toggle.
    if (
      parsed.chatDisplay == null &&
      localStorage.getItem(LEGACY_COMPACT_KEY) === "1"
    ) {
      parsed.chatDisplay = "compact";
    }

    return {
      chatFontSize: nearest(
        CHAT_FONT_SIZES,
        Number(parsed.chatFontSize ?? DEFAULT_A11Y.chatFontSize),
      ),
      underlineLinks: Boolean(
        parsed.underlineLinks ?? DEFAULT_A11Y.underlineLinks,
      ),
      chatDisplay:
        parsed.chatDisplay === "compact" ? "compact" : "default",
      messageGroupGap: nearest(
        MESSAGE_GROUP_GAPS,
        Number(parsed.messageGroupGap ?? DEFAULT_A11Y.messageGroupGap),
      ),
      uiDensity:
        parsed.uiDensity === "compact" || parsed.uiDensity === "spacious"
          ? parsed.uiDensity
          : "default",
      zoom: nearest(ZOOM_LEVELS, Number(parsed.zoom ?? DEFAULT_A11Y.zoom)),
      saturation: clamp(
        Math.round(Number(parsed.saturation ?? DEFAULT_A11Y.saturation)),
        0,
        100,
      ),
      highContrast: Boolean(parsed.highContrast ?? DEFAULT_A11Y.highContrast),
      reducedMotion: Boolean(
        parsed.reducedMotion ?? DEFAULT_A11Y.reducedMotion,
      ),
      syncReducedMotion:
        parsed.syncReducedMotion ?? DEFAULT_A11Y.syncReducedMotion,
      playAnimatedEmoji:
        parsed.playAnimatedEmoji ?? DEFAULT_A11Y.playAnimatedEmoji,
      ttsRate: clamp(Number(parsed.ttsRate ?? DEFAULT_A11Y.ttsRate), 0.5, 2),
      showImageDescriptions: Boolean(
        parsed.showImageDescriptions ?? DEFAULT_A11Y.showImageDescriptions,
      ),
    };
  } catch {
    return { ...DEFAULT_A11Y };
  }
}

export function saveAccessibility(prefs: AccessibilityPrefs) {
  localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(prefs));
  // Keep legacy key in sync for any old readers.
  localStorage.setItem(
    LEGACY_COMPACT_KEY,
    prefs.chatDisplay === "compact" ? "1" : "0",
  );
}

export function applyAccessibility(prefs: AccessibilityPrefs) {
  const root = document.documentElement;
  root.style.setProperty("--chat-font-size", `${prefs.chatFontSize}px`);
  root.style.setProperty("--message-group-gap", `${prefs.messageGroupGap}px`);
  root.dataset.underlineLinks = prefs.underlineLinks ? "1" : "0";
  root.dataset.compact = prefs.chatDisplay === "compact" ? "1" : "0";
  root.dataset.uiDensity = prefs.uiDensity;
  root.dataset.highContrast = prefs.highContrast ? "1" : "0";
  root.dataset.reducedMotion = effectiveReducedMotion(prefs) ? "1" : "0";
  root.dataset.animatedEmoji = prefs.playAnimatedEmoji ? "1" : "0";
  root.dataset.imageDescriptions = prefs.showImageDescriptions ? "1" : "0";

  const zoomFactor = prefs.zoom / 100;
  const app = document.getElementById("root");
  if (app) {
    (app.style as CSSStyleDeclaration & { zoom?: string }).zoom =
      String(zoomFactor);
  }

  const sat = Math.max(0.01, prefs.saturation / 100);
  root.style.setProperty("--ui-sat", String(sat));
  root.dataset.desaturate = prefs.saturation < 100 ? "1" : "0";
}

export function setAndApplyAccessibility(
  prefs: AccessibilityPrefs,
): AccessibilityPrefs {
  saveAccessibility(prefs);
  applyAccessibility(prefs);
  return prefs;
}

export function previewTts(rate: number, text?: string) {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(
    text ||
      "This is a preview of text to speech. You can change the reading speed in Accessibility settings.",
  );
  u.rate = clamp(rate, 0.5, 2);
  speechSynthesis.speak(u);
}

let motionListener: ((e: MediaQueryListEvent) => void) | null = null;

export function watchReducedMotion(onChange: () => void) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (motionListener) motion.removeEventListener("change", motionListener);
  motionListener = () => onChange();
  motion.addEventListener("change", motionListener);
  return () => {
    if (motionListener) motion.removeEventListener("change", motionListener);
    motionListener = null;
  };
}
