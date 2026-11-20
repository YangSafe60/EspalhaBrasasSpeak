import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * The long-lived refresh token lives only here, in the main process, encrypted
 * with the OS keystore (DPAPI / Keychain / libsecret) like the E2E keys. Pages
 * never read it back: they ask the main process to refresh, and get only the
 * short-lived access token. So a script running in a page cannot steal a
 * 30-day session.
 *
 * The token is stored together with the API origin it was issued by, and is
 * only ever sent back to that origin.
 *
 * File: "EBS1" + safeStorage ciphertext of {"origin","refresh"} (plain JSON
 * only when the OS has no keystore).
 */
const MAGIC = Buffer.from("EBS1");

function sessionPath() {
  return path.join(app.getPath("userData"), "session.bin");
}

function originOf(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function readSession() {
  const file = sessionPath();
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file);
    const hasMagic = raw.length > MAGIC.length && raw.subarray(0, 4).equals(MAGIC);
    let text;
    if (hasMagic && safeStorage.isEncryptionAvailable()) {
      text = safeStorage.decryptString(raw.subarray(MAGIC.length));
    } else if (!hasMagic) {
      text = raw.toString("utf8");
    } else {
      return null;
    }
    const data = JSON.parse(text);
    if (typeof data?.refresh === "string" && originOf(data?.origin)) return data;
  } catch {
    /* unreadable: treat as signed out */
  }
  return null;
}

function writeSession(data) {
  const json = JSON.stringify(data);
  const buf = safeStorage.isEncryptionAvailable()
    ? Buffer.concat([MAGIC, safeStorage.encryptString(json)])
    : Buffer.from(json, "utf8");
  const file = sessionPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function saveSession(apiBase, refresh) {
  const origin = originOf(apiBase);
  if (!origin || typeof refresh !== "string" || !refresh || refresh.length > 512) {
    throw new Error("invalid session");
  }
  writeSession({ origin, refresh });
  return true;
}

export function hasSession() {
  return readSession() !== null;
}

export function clearSession() {
  try {
    fs.rmSync(sessionPath(), { force: true });
  } catch {
    /* already gone */
  }
  return true;
}

let inFlight = null;

/**
 * Exchange the stored refresh token for a new pair (single flight across all
 * windows). Returns { ok: true, access_token, user } or { ok: false, status }.
 * Only a definitive rejection (401/403/400) forgets the session; network
 * errors and 429 keep it so a blip doesn't sign the user out.
 */
export function refreshSession() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const session = readSession();
    if (!session) return { ok: false, status: 401 };
    let res;
    try {
      res = await fetch(`${session.origin}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh }),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    if (res.status === 429) return { ok: false, status: 429 };
    if (!res.ok) {
      if (res.status === 400 || res.status === 401 || res.status === 403) clearSession();
      return { ok: false, status: res.status };
    }
    try {
      const data = await res.json();
      if (typeof data?.refresh_token !== "string" || typeof data?.access_token !== "string") {
        return { ok: false, status: 502 };
      }
      writeSession({ origin: session.origin, refresh: data.refresh_token });
      return { ok: true, access_token: data.access_token, user: data.user ?? null };
    } catch {
      return { ok: false, status: 502 };
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
