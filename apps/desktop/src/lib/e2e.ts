/**
 * Pragmatic E2E for 1:1 DMs: X25519 identity keys + AES-GCM.
 * Private keys stay on this device; the server only sees public keys and ciphertext.
 */

const STORAGE_PREFIX = "speakapp_e2e_identity_";

export type IdentityKeyPair = {
  publicKeyB64: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

const dmKeyCache = new Map<string, CryptoKey>();

function b64Encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64Decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function exportPublicRaw(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return b64Encode(raw);
}

async function importPublicRaw(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    b64Decode(b64),
    { name: "X25519" },
    true,
    [],
  );
}

async function exportPrivatePkcs8(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("pkcs8", key);
  return b64Encode(raw);
}

async function importPrivatePkcs8(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    b64Decode(b64),
    { name: "X25519" },
    true,
    ["deriveBits"],
  );
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export async function loadOrCreateIdentity(userId: string): Promise<IdentityKeyPair> {
  const stored = localStorage.getItem(storageKey(userId));
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { publicKey: string; privateKey: string };
      const privateKey = await importPrivatePkcs8(parsed.privateKey);
      const publicKey = await importPublicRaw(parsed.publicKey);
      return {
        publicKeyB64: parsed.publicKey,
        privateKey,
        publicKey,
      };
    } catch {
      localStorage.removeItem(storageKey(userId));
    }
  }

  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;

  const publicKeyB64 = await exportPublicRaw(pair.publicKey);
  const privateKeyB64 = await exportPrivatePkcs8(pair.privateKey);
  localStorage.setItem(
    storageKey(userId),
    JSON.stringify({ publicKey: publicKeyB64, privateKey: privateKeyB64 }),
  );

  return {
    publicKeyB64,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  };
}

export function clearIdentityCache(): void {
  dmKeyCache.clear();
}

export function clearDmKeyCache(dmChannelId?: string): void {
  if (dmChannelId) dmKeyCache.delete(dmChannelId);
  else dmKeyCache.clear();
}

async function deriveDmKey(
  myPrivate: CryptoKey,
  peerPublicB64: string,
  dmChannelId: string,
): Promise<CryptoKey> {
  const cached = dmKeyCache.get(dmChannelId);
  if (cached) return cached;

  const peerPublic = await importPublicRaw(peerPublicB64);
  const bits = await crypto.subtle.deriveBits(
    { name: "X25519", public: peerPublic },
    myPrivate,
    256,
  );

  const baseKey = await crypto.subtle.importKey("raw", bits, "HKDF", false, [
    "deriveKey",
  ]);
  const info = new TextEncoder().encode(`espalha-brasas-dm:${dmChannelId}`);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  dmKeyCache.set(dmChannelId, aesKey);
  return aesKey;
}

export async function encryptDm(
  plaintext: string,
  myPrivate: CryptoKey,
  peerPublicB64: string,
  dmChannelId: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const key = await deriveDmKey(myPrivate, peerPublicB64, dmChannelId);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: b64Encode(ct), nonce: b64Encode(nonce) };
}

export async function decryptDm(
  ciphertextB64: string,
  nonceB64: string,
  myPrivate: CryptoKey,
  peerPublicB64: string,
  dmChannelId: string,
): Promise<string> {
  const key = await deriveDmKey(myPrivate, peerPublicB64, dmChannelId);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64Decode(nonceB64) },
    key,
    b64Decode(ciphertextB64),
  );
  return new TextDecoder().decode(plain);
}

/** Short fingerprint for manual verification (sorted public keys). */
export async function fingerprint(
  myPublicB64: string,
  peerPublicB64: string,
): Promise<string> {
  const [a, b] = [myPublicB64, peerPublicB64].sort();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${a}|${b}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16).match(/.{1,4}/g)?.join(" ") ?? hex.slice(0, 16);
}
