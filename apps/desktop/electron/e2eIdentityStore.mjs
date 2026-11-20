import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E identity keys on disk, encrypted with the OS keystore (DPAPI on Windows,
 * Keychain on macOS, libsecret/kwallet on Linux) via Electron safeStorage.
 *
 * File format:
 *   "EBK1" + safeStorage ciphertext   (encrypted, normal case)
 *   plain JSON                         (only when the OS has no keystore)
 */
const MAGIC = Buffer.from("EBK1");

function identityDir() {
  const dir = path.join(app.getPath("userData"), "e2e-identities");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function identityPath(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(identityDir(), `${safe}.bin`);
}

function isBlob(value) {
  return (
    typeof value?.publicKey === "string" && typeof value?.privateKey === "string"
  );
}

function tryParse(text) {
  try {
    const parsed = JSON.parse(text);
    return isBlob(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Returns { blob, encrypted } or null. Never throws for a damaged file, so a
 * failing keystore does not look like "no key" and trigger a new identity.
 */
function readPayload(filePath) {
  const raw = fs.readFileSync(filePath);
  const hasMagic = raw.length > MAGIC.length && raw.subarray(0, 4).equals(MAGIC);

  if (safeStorage.isEncryptionAvailable()) {
    const body = hasMagic ? raw.subarray(MAGIC.length) : raw;
    try {
      const blob = tryParse(safeStorage.decryptString(body));
      if (blob) return { blob, encrypted: true };
    } catch {
      /* not encrypted (old file written without a keystore) */
    }
  }
  if (!hasMagic) {
    const blob = tryParse(raw.toString("utf8"));
    if (blob) return { blob, encrypted: false };
  }
  return null;
}

/** Write via a temp file + rename so a crash never leaves half a key file. */
function writePayload(filePath, json) {
  let buf;
  if (safeStorage.isEncryptionAvailable()) {
    buf = Buffer.concat([MAGIC, safeStorage.encryptString(json)]);
  } else {
    console.warn(
      "[e2e] OS keystore unavailable — identity key stored unencrypted (file mode 600)",
    );
    buf = Buffer.from(json, "utf8");
  }
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

/** @returns {{ publicKey: string, privateKey: string } | null} */
export function loadE2eIdentity(userId) {
  if (!userId) return null;
  const file = identityPath(userId);
  if (!fs.existsSync(file)) return null;
  let result = null;
  try {
    result = readPayload(file);
  } catch {
    return null;
  }
  if (!result) {
    // Keystore can't open it right now (e.g. Linux keyring locked). Surface it
    // instead of returning null, which would look like a missing identity.
    throw new Error(
      "Encryption keys on this device could not be unlocked by the system keystore",
    );
  }
  // Upgrade files written before the keystore was available.
  if (!result.encrypted && safeStorage.isEncryptionAvailable()) {
    try {
      writePayload(file, JSON.stringify(result.blob));
    } catch {
      /* keep the readable copy */
    }
  }
  return result.blob;
}

/** @param {{ publicKey: string, privateKey: string }} data */
export function saveE2eIdentity(userId, data) {
  if (!userId || !isBlob(data)) {
    throw new Error("invalid identity payload");
  }
  writePayload(
    identityPath(userId),
    JSON.stringify({ publicKey: data.publicKey, privateKey: data.privateKey }),
  );
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
