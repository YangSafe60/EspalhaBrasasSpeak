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
  setBackgroundThrottling: (enabled: boolean) => Promise<boolean>;
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
