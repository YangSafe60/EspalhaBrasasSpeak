import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

function identityDir() {
  const dir = path.join(app.getPath("userData"), "e2e-identities");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function identityPath(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(identityDir(), `${safe}.bin`);
}

function readPayload(filePath) {
  const raw = fs.readFileSync(filePath);
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(raw);
  }
  return raw.toString("utf8");
}

function writePayload(filePath, json) {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, "utf8");
  fs.writeFileSync(filePath, buf);
}

/** @returns {{ publicKey: string, privateKey: string } | null} */
export function loadE2eIdentity(userId) {
  if (!userId) return null;
  const file = identityPath(userId);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readPayload(file));
    if (
      typeof parsed?.publicKey !== "string" ||
      typeof parsed?.privateKey !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** @param {{ publicKey: string, privateKey: string }} data */
export function saveE2eIdentity(userId, data) {
  if (!userId || !data?.publicKey || !data?.privateKey) {
    throw new Error("invalid identity payload");
  }
  writePayload(identityPath(userId), JSON.stringify(data));
  return true;
}

export function deleteE2eIdentity(userId) {
  if (!userId) return false;
  const file = identityPath(userId);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    return true;
  }
  return false;
}
