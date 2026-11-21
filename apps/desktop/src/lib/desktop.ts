export type DesktopShareSource = {
  id: string;
  name: string;
  kind: "screen" | "window" | string;
  thumbnail: string;
};

/** How much the JPEG preview relays should work (see main.mjs screenPreviewLevel). */
export type ScreenPreviewLevel = 0 | 1 | 2;

export type MemorySnapshot = {
  total_mb: number;
  processes: { kind: string; label: string; mb: number }[];
  app_version?: string;
};

export type ElectronAPI = {
  isElectron: true;
  /** Runtime override (SPEAKAPP_API_BASE / VITE_API_BASE). Empty = use Vite default. */
  apiBase?: string;
  getInfo: () => Promise<{
    isElectron: boolean;
    appVersion?: string;
    platform: string;
    versions: { electron: string; chrome: string; node: string };
  }>;
  getAppUpdate: () => Promise<AppUpdateEvent | null>;
  /** Store the refresh token in the main process (encrypted, never read back). */
  saveSession?: (apiBase: string, refresh: string) => Promise<boolean>;
  hasSession?: () => Promise<boolean>;
  /** Main process exchanges the stored refresh token; returns the access token. */
  refreshSession?: () => Promise<
    { ok: true; access_token: string } | { ok: false; status: number }
  >;
  clearSession?: () => Promise<boolean>;
  /** Colours of the OS window buttons drawn over the in-app title strip. */
  setTitleBarColors?: (colors: { color: string; symbolColor: string }) => Promise<boolean>;
  /** RAM per Electron process, for memory diagnostics. */
  getMemorySnapshot?: () => Promise<MemorySnapshot>;
  /** True when the app was started with SPEAKAPP_MEM_LOG=1. */
  memoryLogFromEnv?: () => Promise<boolean>;
  focusMain: () => Promise<boolean>;
  showNotification?: (opts: {
    tag?: string;
    appName?: string;
    authorName?: string;
    authorAvatar?: string | null;
    context?: string;
    preview?: string;
  }) => Promise<boolean>;
  loadE2eIdentity?: (
    userId: string,
  ) => Promise<{ publicKey: string; privateKey: string } | null>;
  saveE2eIdentity?: (
    userId: string,
    data: { publicKey: string; privateKey: string },
  ) => Promise<boolean>;
  deleteE2eIdentity?: (userId: string) => Promise<boolean>;
  onNotificationClick?: (handler: (payload: { tag?: string }) => void) => () => void;
  /** Main window + process title (e.g. voice channel label in Task Manager). */
  setWindowTitle: (title: string) => Promise<boolean>;
  setBackgroundThrottling: (enabled: boolean) => Promise<boolean>;
  /** Hint Chromium to drop caches after voice teardown (best-effort). */
  trimMemory: () => Promise<boolean>;
  listShareSources: (opts?: {
    types?: Array<"screen" | "window">;
  }) => Promise<DesktopShareSource[]>;
  prepareDisplayCapture: (opts: {
    sourceId: string;
    systemAudio?: boolean;
  }) => Promise<boolean>;
  cancelDisplayCapture: () => Promise<boolean>;
  openPopout: (opts: {
    title: string;
    trackSid: string;
    url: string;
  }) => Promise<{ ok: boolean; reused?: boolean }>;
  closeAllPopouts: () => Promise<boolean>;
  relaySignal: (payload: unknown) => Promise<boolean>;
  relayFrame: (payload: unknown) => void;
  onSignal: (handler: (payload: unknown) => void) => () => void;
  onFrame: (handler: (payload: unknown) => void) => () => void;
  onAppUpdate: (handler: (payload: AppUpdateEvent) => void) => () => void;
  /** Upload a small MP3 notification sound to Catbox (random public URL, not on the VPS). */
  uploadNotifySound: (payload: {
    filename: string;
    data: ArrayBuffer;
  }) => Promise<{ url: string; size: number; filename: string }>;
  /** Upload a non-image file to Litterbox from the desktop process (no VPS storage). */
  uploadTempMedia: (payload: {
    filename: string;
    contentType: string;
    data: ArrayBuffer;
    expire?: "1h" | "12h" | "24h" | "72h";
  }) => Promise<{
    url: string;
    size: number;
    filename: string;
    contentType: string;
  }>;
  /** Upload an image to a direct public file URL from the desktop process. */
  uploadImage: (payload: {
    filename: string;
    contentType: string;
    data: ArrayBuffer;
  }) => Promise<{
    url: string;
    size: number;
    filename: string;
    contentType: string;
  }>;
  setScreenPreviewActive?: (active: boolean) => void;
  /** An expanded (in-app fullscreen) tile wants full frame rate / size. */
  setScreenPreviewFocused?: (focused: boolean) => void;
  /** 0 = nobody looking, 1 = lobby grid, 2 = pop-out or expanded tile. */
  onScreenPreview?: (handler: (level: ScreenPreviewLevel) => void) => () => void;
  ensureVoiceHost?: () => Promise<boolean>;
  destroyVoiceHost?: () => Promise<boolean>;
  sendVoiceCommand?: (cmd: import("../voice/voiceIpc").VoiceHostCommand) => void;
  publishVoiceEvent?: (evt: import("../voice/voiceIpc").VoiceHostEvent) => void;
  publishLobbyFrame?: (frame: import("../voice/voiceIpc").VoiceLobbyFrame) => void;
  /** Hand the live-preview MessagePorts to the page (see lib/framePorts.ts). */
  claimFramePorts?: () => number;
  /** Viewer side: ask the publishers of `trackSid` for a keyframe. */
  requestPreviewKeyFrame?: (trackSid: string) => void;
  /** Publisher side: a viewer asked for a keyframe of `trackSid`. */
  onPreviewKeyFrameRequest?: (handler: (trackSid: string) => void) => () => void;
  notifyVoiceHostReady?: () => void;
  onVoiceCommand?: (
    handler: (cmd: import("../voice/voiceIpc").VoiceHostCommand) => void,
  ) => () => void;
  onVoiceEvent?: (
    handler: (evt: import("../voice/voiceIpc").VoiceHostEvent) => void,
  ) => () => void;
  onLobbyFrame?: (
    handler: (frame: import("../voice/voiceIpc").VoiceLobbyFrame) => void,
  ) => () => void;
  openScreenPublisher?: (payload: {
    sourceId: string;
    mode: "channel" | "dm";
    targetId: string;
    systemAudio?: boolean;
    maxWidth: number;
    maxHeight: number;
    maxFps: number;
    resolution: string;
  }) => Promise<{ trackSid: string; hasAudio: boolean }>;
  closeScreenPublisher?: (sourceId: string) => Promise<boolean>;
  reportScreenPublisher?: (payload: {
    ok: boolean;
    sourceId: string;
    trackSid?: string;
    hasAudio?: boolean;
    error?: string;
  }) => void;
  onScreenPublisherClosed?: (handler: (sourceId: string) => void) => () => void;
};

export type AppUpdateEvent = {
  phase: "idle" | "downloading" | "ready";
  percent: number;
  version?: string;
  error?: string;
};

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/** Hidden renderer that owns LiveKit + screen capture (voice-host.html). */
export function isVoiceHostWindow(): boolean {
  if (typeof window === "undefined") return false;
  const href = `${window.location.pathname}${window.location.href}`;
  return /voice-host\.html/i.test(href);
}

export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.electronAPI?.isElectron) return true;
  // Legacy Tauri detection (transitional).
  const g = globalThis as typeof globalThis & {
    isTauri?: boolean;
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(g.isTauri || g.__TAURI_INTERNALS__ || g.__TAURI__);
}

export function getElectronAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}
