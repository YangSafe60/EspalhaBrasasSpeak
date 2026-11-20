import type { AuthResponse } from "../types";

const STORAGE_ACCESS = "speakapp_access";
const STORAGE_REFRESH = "speakapp_refresh";
/** Legacy key — cleared so old user overrides no longer apply. */
const LEGACY_STORAGE_API = "speakapp_api_base";

/** App-configured API origin (runtime Electron env, then Vite, then localhost). */
export function getApiBase(): string {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LEGACY_STORAGE_API);
  }
  const runtime =
    typeof window !== "undefined" ? window.electronAPI?.apiBase : "";
  const baked = import.meta.env.VITE_API_BASE;
  return (runtime || baked || "http://localhost:8080").replace(/\/$/, "");
}

export function getAccessToken(): string | null {
  return localStorage.getItem(STORAGE_ACCESS);
}

/**
 * Desktop: the refresh token is handed to the main process, which keeps it
 * encrypted with the OS keystore and never gives it back to a page. Only the
 * short-lived access token stays in localStorage. The browser build (no
 * Electron) keeps both in localStorage as before.
 */
function sessionApi() {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  return api?.saveSession && api.refreshSession && api.hasSession && api.clearSession
    ? api
    : null;
}

export function setTokens(access: string, refresh: string): Promise<void> {
  localStorage.setItem(STORAGE_ACCESS, access);
  const desktop = sessionApi();
  if (!desktop) {
    localStorage.setItem(STORAGE_REFRESH, refresh);
    return Promise.resolve();
  }
  localStorage.removeItem(STORAGE_REFRESH);
  return desktop.saveSession!(getApiBase(), refresh).then(
    () => undefined,
    () => undefined,
  );
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_ACCESS);
  localStorage.removeItem(STORAGE_REFRESH);
  void sessionApi()?.clearSession?.();
}

/** Moves a refresh token left in localStorage by older versions into the main process. */
async function migrateLegacyRefresh(): Promise<void> {
  const desktop = sessionApi();
  const legacy = localStorage.getItem(STORAGE_REFRESH);
  if (!desktop || !legacy) return;
  try {
    await desktop.saveSession!(getApiBase(), legacy);
    localStorage.removeItem(STORAGE_REFRESH);
  } catch {
    /* keep it; try again next start */
  }
}

/** Whether there is a session to resume (access token, or a stored refresh token). */
export async function hasSavedSession(): Promise<boolean> {
  await migrateLegacyRefresh();
  if (getAccessToken()) return true;
  const desktop = sessionApi();
  if (desktop) return Boolean(await desktop.hasSession!().catch(() => false));
  return Boolean(localStorage.getItem(STORAGE_REFRESH));
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Readable text for a 429, from the `Retry-After` header (seconds). */
export function rateLimitMessage(retryAfter: string | null): string {
  const secs = Math.max(1, Math.ceil(Number(retryAfter) || 0));
  if (!retryAfter || !Number.isFinite(Number(retryAfter))) {
    return "You're doing that too often. Please wait a moment and try again.";
  }
  const wait =
    secs < 60
      ? `${secs} second${secs === 1 ? "" : "s"}`
      : `${Math.ceil(secs / 60)} minute${Math.ceil(secs / 60) === 1 ? "" : "s"}`;
  return `You're doing that too often. Try again in ${wait}.`;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  const desktop = sessionApi();
  if (desktop) {
    // The main process does the exchange; we only receive the access token.
    const res = await desktop.refreshSession!().catch(() => ({ ok: false as const, status: 0 }));
    if (res.ok) {
      localStorage.setItem(STORAGE_ACCESS, res.access_token);
      return true;
    }
    // Rejected by the server: the session is over. 429 / offline: keep it.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      localStorage.removeItem(STORAGE_ACCESS);
    }
    return false;
  }

  const refresh = localStorage.getItem(STORAGE_REFRESH);
  if (!refresh) return false;
  try {
    const res = await fetch(`${getApiBase()}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    // Rate-limited: keep the session and let the caller retry later.
    if (res.status === 429) return false;
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = (await res.json()) as AuthResponse;
    await setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    // Network error: keep the session.
    return false;
  }
}

/** Single flight per window (the desktop main process also single-flights). */
async function tryRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshOnce().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export type ApiOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  formData?: FormData;
  query?: Record<string, string | number | undefined | null>;
};

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, formData, query } = opts;
  let url = `${getApiBase()}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (!formData) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const doFetch = () =>
    fetch(url, {
      method,
      headers,
      body: formData ? formData : body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch (e) {
    const hint = getApiBase();
    throw new ApiError(
      0,
      `Failed to reach ${hint}${path}. If this is the VPS: open TCP 80/443/8080 in Oracle (security list + iptables), and start the app with SPEAKAPP_API_BASE=${hint.startsWith("http://localhost") ? "http://YOUR_VPS_IP:8080" : hint}.`,
      e,
    );
  }
  if (res.status === 401 && auth) {
    const ok = await tryRefresh();
    if (ok) {
      const token = getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let errBody: unknown = null;
    try {
      errBody = await res.json();
    } catch {
      /* ignore */
    }
    const msg =
      typeof errBody === "object" &&
      errBody &&
      "error" in errBody &&
      typeof (errBody as { error: unknown }).error === "string"
        ? (errBody as { error: string }).error
        : res.statusText || `HTTP ${res.status}`;
    if (res.status === 429) {
      throw new ApiError(429, rateLimitMessage(res.headers.get("Retry-After")), errBody);
    }
    throw new ApiError(res.status, msg, errBody);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function wsUrl(): string {
  const base = getApiBase().replace(/^http/, "ws");
  return `${base}/api/ws`;
}

/**
 * The access token travels as a WebSocket subprotocol (Sec-WebSocket-Protocol
 * header) instead of in the URL, which proxies and servers tend to log.
 */
export function wsProtocols(token: string): string[] {
  return ["speakapp.auth", token];
}

/** Get a fresh access token (e.g. after the WebSocket was refused). */
export function refreshAccessToken(): Promise<boolean> {
  return tryRefresh();
}
