/**
 * Password-protected backup of the E2E identity keys.
 *
 * The backup used to be the key pair as plain JSON, so anyone who saw the
 * pasted text (a chat, a notes app, a screenshot) could read every DM. It is
 * now encrypted with a key derived from a password the user chooses:
 * PBKDF2-SHA256 (600k iterations) -> AES-256-GCM, all via WebCrypto.
 *
 * Format: {"v":2,"kdf":"PBKDF2-SHA256","iter":600000,"salt","iv","ct"}
 * (base64). Plain v1 backups ({"publicKey","privateKey"}) are still accepted
 * when restoring.
 */

export type IdentityBackupKeys = { publicKey: string; privateKey: string };

type EncryptedBackupV2 = {
  v: 2;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
};

const ITERATIONS = 600_000;
const AAD = new TextEncoder().encode("espalha-brasas-e2e-backup-v2");
export const MIN_BACKUP_PASSWORD = 8;

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptKeyBackup(
  keys: IdentityBackupKeys,
  password: string,
): Promise<string> {
  if (password.length < MIN_BACKUP_PASSWORD) {
    throw new Error(`Backup password must be at least ${MIN_BACKUP_PASSWORD} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plain = new TextEncoder().encode(
    JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }),
  );
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, plain);
  const out: EncryptedBackupV2 = {
    v: 2,
    kdf: "PBKDF2-SHA256",
    iter: ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    ct: b64(ct),
  };
  return JSON.stringify(out);
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The backup isn't valid JSON.");
  }
}

export function isEncryptedKeyBackup(text: string): boolean {
  try {
    return (JSON.parse(text) as { v?: number })?.v === 2;
  } catch {
    return false;
  }
}

/** Accepts an encrypted (v2) backup with its password, or a legacy plain one. */
export async function readKeyBackup(text: string, password: string): Promise<IdentityBackupKeys> {
  const data = parse(text.trim()) as Partial<EncryptedBackupV2> & Partial<IdentityBackupKeys>;
  if (data?.v === 2) {
    if (
      data.kdf !== "PBKDF2-SHA256" ||
      typeof data.salt !== "string" ||
      typeof data.iv !== "string" ||
      typeof data.ct !== "string" ||
      typeof data.iter !== "number" ||
      data.iter < 100_000 ||
      data.iter > 10_000_000
    ) {
      throw new Error("Unsupported or damaged backup.");
    }
    if (!password) throw new Error("Enter the backup password.");
    let plain: ArrayBuffer;
    try {
      const key = await deriveKey(password, unb64(data.salt), data.iter);
      plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(data.iv), additionalData: AAD },
        key,
        unb64(data.ct),
      );
    } catch {
      throw new Error("Wrong password, or the backup is damaged.");
    }
    const keys = JSON.parse(new TextDecoder().decode(plain)) as Partial<IdentityBackupKeys>;
    if (!keys.publicKey || !keys.privateKey) throw new Error("Unsupported or damaged backup.");
    return { publicKey: keys.publicKey, privateKey: keys.privateKey };
  }
  // Legacy plain backup.
  if (typeof data?.publicKey === "string" && typeof data?.privateKey === "string") {
    return { publicKey: data.publicKey, privateKey: data.privateKey };
  }
  throw new Error("Backup must include publicKey and privateKey.");
}
