import { api } from "../../api/client";
import {
  clearDmKeyCache,
  createIdentity,
  decryptDm,
  importIdentityBackup,
  loadIdentity,
  type IdentityKeyPair,
} from "../../lib/e2e";
import type {
  DmMessage,
  DmMessageWire,
  Friendship,
  UserIdentityKey,
  UserIdentityKeyHistory,
} from "../../types";

let identityPair: IdentityKeyPair | null = null;
let identityPromise: Promise<IdentityKeyPair> | null = null;
const peerKeyHistoryCache = new Map<string, string[]>();

export class E2EIdentityMissingError extends Error {
  readonly code = "E2E_IDENTITY_MISSING";

  constructor() {
    super(
      "Encryption keys for this account are missing on this device. Restore a backup or use the device where you originally set up encrypted messaging.",
    );
    this.name = "E2EIdentityMissingError";
  }
}

async function uploadIdentity(publicKeyB64: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await api<UserIdentityKey>("/api/crypto/identity", {
        method: "PUT",
        body: { public_key: publicKeyB64 },
      });
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        await new Promise((r) => window.setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Could not register encryption keys on the server.");
}

async function fetchServerIdentity(userId: string): Promise<UserIdentityKey | null> {
  try {
    return await api<UserIdentityKey>(`/api/crypto/identity/${userId}`);
  } catch {
    return null;
  }
}

/**
 * Load or create the device E2E identity without silently rotating keys.
 * - Local keys win and are re-uploaded if the server drifted.
 * - If the server has keys but this device does not, fail loudly.
 */
export async function ensureIdentity(userId: string): Promise<IdentityKeyPair> {
  if (identityPair) return identityPair;
  if (identityPromise) return identityPromise;

  identityPromise = (async () => {
    const local = await loadIdentity(userId);
    const server = await fetchServerIdentity(userId);

    if (local) {
      if (!server || server.public_key !== local.publicKeyB64) {
        await uploadIdentity(local.publicKeyB64);
      }
      identityPair = local;
      return local;
    }

    if (server) {
      throw new E2EIdentityMissingError();
    }

    const created = await createIdentity(userId);
    await uploadIdentity(created.publicKeyB64);
    identityPair = created;
    return created;
  })();

  try {
    return await identityPromise;
  } finally {
    identityPromise = null;
  }
}

/** Restore identity from a JSON backup and sync the public key to the server. */
export async function restoreIdentityBackup(
  userId: string,
  backup: { publicKey: string; privateKey: string },
): Promise<IdentityKeyPair> {
  const pair = await importIdentityBackup(userId, backup);
  await uploadIdentity(pair.publicKeyB64);
  identityPair = pair;
  return pair;
}

/** Fetch a peer's current public encryption key from the server. */
export async function fetchPeerPublicKey(peerId: string): Promise<string> {
  const key = await api<UserIdentityKey>(`/api/crypto/identity/${peerId}`);
  return key.public_key;
}

/** Current + retired public keys for a peer (cached per session). */
export async function fetchPeerPublicKeyHistory(peerId: string): Promise<string[]> {
  const cached = peerKeyHistoryCache.get(peerId);
  if (cached) return cached;

  const res = await api<UserIdentityKeyHistory>(
    `/api/crypto/identity/${peerId}/history`,
  );
  const keys: string[] = [];
  if (res.current?.public_key) keys.push(res.current.public_key);
  for (const entry of res.history) {
    keys.push(entry.public_key);
  }
  const unique = [...new Set(keys)];
  peerKeyHistoryCache.set(peerId, unique);
  return unique;
}

/** Ensure the peer's public key is cached and any stale DM AES cache is cleared. */
export async function prefetchPeerPublicKey(
  peerId: string,
  dmChannelId: string,
  setCachedPeerKey: (id: string, key: string) => void,
): Promise<string> {
  clearDmKeyCache(dmChannelId);
  const pub = await fetchPeerPublicKey(peerId);
  setCachedPeerKey(peerId, pub);
  peerKeyHistoryCache.delete(peerId);
  return pub;
}

function publicKeysForMessage(
  wire: DmMessageWire,
  userId: string,
  cachedPeerKey: string | undefined,
  historyKeys: string[],
): string[] {
  const keys: string[] = [];
  const isOwn = wire.author_id === userId;

  if (isOwn) {
    if (wire.recipient_public_key) keys.push(wire.recipient_public_key);
  } else if (wire.sender_public_key) {
    keys.push(wire.sender_public_key);
  }

  if (cachedPeerKey) keys.push(cachedPeerKey);
  keys.push(...historyKeys);
  return [...new Set(keys.filter(Boolean))];
}

/** Decrypt a wire-format DM using the cached local identity key. */
export async function decryptWire(
  wire: DmMessageWire,
  peerPublic: string,
): Promise<DmMessage> {
  if (!identityPair) {
    return {
      ...wire,
      content: "",
      decrypt_failed: true,
    };
  }
  try {
    const content = await decryptDm(
      wire.ciphertext,
      wire.nonce,
      identityPair.privateKey,
      peerPublic,
      wire.dm_channel_id,
    );
    return { ...wire, content, decrypt_failed: false };
  } catch {
    return { ...wire, content: "", decrypt_failed: true };
  }
}

/** Try message-bound keys, cached peer key, then retired keys from the server. */
export async function decryptWireResilient(
  wire: DmMessageWire,
  peerId: string,
  userId: string,
  getCachedPeerKey: (id: string) => string | undefined,
  setCachedPeerKey: (id: string, key: string) => void,
  preloadedHistory?: string[],
): Promise<DmMessage> {
  if (!identityPair) {
    return { ...wire, content: "", decrypt_failed: true };
  }

  let history = preloadedHistory;
  if (!history) {
    try {
      history = await fetchPeerPublicKeyHistory(peerId);
    } catch {
      history = [];
    }
  }

  const cached = getCachedPeerKey(peerId);
  const candidates = publicKeysForMessage(wire, userId, cached, history);

  for (const pub of candidates) {
    clearDmKeyCache(wire.dm_channel_id);
    const message = await decryptWire(wire, pub);
    if (!message.decrypt_failed) {
      if (pub !== cached) setCachedPeerKey(peerId, pub);
      return message;
    }
  }

  return { ...wire, content: "", decrypt_failed: true };
}

/** Replace or append one friendship row in a list. */
export function upsertFriendship(list: Friendship[], f: Friendship): Friendship[] {
  const next = list.filter((x) => x.id !== f.id);
  next.push(f);
  return next;
}

export function resetIdentityCache() {
  identityPair = null;
  identityPromise = null;
  peerKeyHistoryCache.clear();
}

/** Cached device identity after first load (null until login/bootstrap). */
export function getCachedIdentity(): IdentityKeyPair | null {
  return identityPair;
}

export function isIdentityMissingError(error: unknown): boolean {
  return error instanceof E2EIdentityMissingError;
}
