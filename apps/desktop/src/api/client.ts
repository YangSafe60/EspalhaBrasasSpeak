import type { AuthResponse } from "../types";

const STORAGE_ACCESS = "speakapp_access";
const STORAGE_REFRESH = "speakapp_refresh";
/** Legacy key — cleared so old user overrides no longer apply. */
const LEGACY_STORAGE_API = "speakapp_api_base";

/** App-configured API origin (build-time / env), not user-editable. */
export function getApiBase(): string {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LEGACY_STORAGE_API);
  }
  return (
    import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ||
    "http://localhost:8080"
  );
}

export function getAccessToken(): string | null {
  return localStorage.getItem(STORAGE_ACCESS);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(STORAGE_REFRESH);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(STORAGE_ACCESS, access);
  localStorage.setItem(STORAGE_REFRESH, refresh);
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_ACCESS);
  localStorage.removeItem(STORAGE_REFRESH);
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

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refresh = getRefreshToken();
    if (!refresh) return false;
    try {
      const res = await fetch(`${getApiBase()}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        clearTokens();
        return false;
      }
      const data = (await res.json()) as AuthResponse;
      setTokens(data.access_token, data.refresh_token);
      return true;
    } catch {
      clearTokens();
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
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

  let res = await doFetch();
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
    throw new ApiError(res.status, msg, errBody);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function wsUrl(token: string): string {
  const base = getApiBase().replace(/^http/, "ws");
  return `${base}/api/ws?token=${encodeURIComponent(token)}`;
}
