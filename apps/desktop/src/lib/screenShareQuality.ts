/**
 * Screen share quality presets persisted in localStorage.
 * Controls capture resolution, LiveKit encode bitrate, and pop-out relay detail.
 */
export type ScreenShareResolution = "720p" | "1080p" | "source";
export type ScreenShareFps = 30 | 60;

export type ScreenShareQuality = {
  resolution: ScreenShareResolution;
  fps: ScreenShareFps;
};

export const SCREEN_SHARE_QUALITY_KEY = "eb_screen_share_quality";
export const SCREEN_SHARE_QUALITY_EVENT = "eb-screen-share-quality";

export const DEFAULT_SCREEN_SHARE_QUALITY: ScreenShareQuality = {
  resolution: "1080p",
  fps: 30,
};

/** Load last-used resolution + FPS from localStorage. */
export function loadScreenShareQuality(): ScreenShareQuality {
  try {
    const raw = localStorage.getItem(SCREEN_SHARE_QUALITY_KEY);
    if (!raw) return { ...DEFAULT_SCREEN_SHARE_QUALITY };
    const parsed = JSON.parse(raw) as Partial<ScreenShareQuality>;
    const resolution =
      parsed.resolution === "720p" ||
      parsed.resolution === "1080p" ||
      parsed.resolution === "source"
        ? parsed.resolution
        : DEFAULT_SCREEN_SHARE_QUALITY.resolution;
    const fps = parsed.fps === 60 ? 60 : 30;
    return { resolution, fps };
  } catch {
    return { ...DEFAULT_SCREEN_SHARE_QUALITY };
  }
}

export function saveScreenShareQuality(
  partial: Partial<ScreenShareQuality>,
): ScreenShareQuality {
  const next = { ...loadScreenShareQuality(), ...partial };
  localStorage.setItem(SCREEN_SHARE_QUALITY_KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent(SCREEN_SHARE_QUALITY_EVENT, { detail: next }),
  );
  return next;
}

/** Desktop capture upper bounds (Electron chromeMediaSource constraints). */
export function resolveCaptureDimensions(resolution: ScreenShareResolution): {
  maxWidth: number;
  maxHeight: number;
} {
  switch (resolution) {
    case "720p":
      return { maxWidth: 1280, maxHeight: 720 };
    case "1080p":
      return { maxWidth: 1920, maxHeight: 1080 };
    case "source":
      // Native monitor/window resolution, capped at 4K for sanity.
      return { maxWidth: 3840, maxHeight: 2160 };
  }
}

/** LiveKit encode budget — high bitrates for sharp UI/text. */
export function screenShareEncoding(
  resolution: ScreenShareResolution,
  fps: ScreenShareFps,
): { maxBitrate: number; maxFramerate: number } {
  const bitrates: Record<ScreenShareResolution, Record<ScreenShareFps, number>> =
    {
      "720p": { 30: 6_000_000, 60: 10_000_000 },
      "1080p": { 30: 10_000_000, 60: 16_000_000 },
      source: { 30: 16_000_000, 60: 25_000_000 },
    };
  return {
    maxBitrate: bitrates[resolution][fps],
    maxFramerate: fps,
  };
}
