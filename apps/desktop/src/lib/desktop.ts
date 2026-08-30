export type DesktopShareSource = {
  id: string;
  name: string;
  kind: "screen" | "window" | string;
  thumbnail: string;
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
  openPopout: (opts: {
    title: string;
    trackSid: string;
    url: string;
  }) => Promise<{ ok: boolean; reused?: boolean }>;
  closeAllPopouts: () => Promise<boolean>;
  relaySignal: (payload: unknown) => Promise<boolean>;
  relayFrame: (payload: unknown) => Promise<boolean>;
  onSignal: (handler: (payload: unknown) => void) => () => void;
  onFrame: (handler: (payload: unknown) => void) => () => void;
  onAppUpdate: (handler: (payload: AppUpdateEvent) => void) => () => void;
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
  /** Upload an image to ImgBB from the desktop process (no VPS storage). */
  uploadImage: (payload: {
    filename: string;
    contentType: string;
    data: ArrayBuffer;
    apiKey: string;
  }) => Promise<{
    url: string;
    size: number;
    filename: string;
    contentType: string;
  }>;
  ensureVoiceHost?: () => Promise<boolean>;
  destroyVoiceHost?: () => Promise<boolean>;
  sendVoiceCommand?: (cmd: import("../voice/voiceIpc").VoiceHostCommand) => void;
  publishVoiceEvent?: (evt: import("../voice/voiceIpc").VoiceHostEvent) => void;
  publishLobbyFrame?: (frame: import("../voice/voiceIpc").VoiceLobbyFrame) => void;
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
