import { api } from "../../api/client";
import {
  clearDmKeyCache,
  decryptDm,
  loadOrCreateIdentity,
  type IdentityKeyPair,
} from "../../lib/e2e";
import type { DmMessage, DmMessageWire, Friendship, UserIdentityKey } from "../../types";

let identityPair: IdentityKeyPair | null = null;
let identityPromise: Promise<IdentityKeyPair> | null = null;

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

/** Load or upload the device E2E identity for the signed-in user. */
export async function ensureIdentity(userId: string): Promise<IdentityKeyPair> {
  if (identityPair) return identityPair;
  if (identityPromise) return identityPromise;

  identityPromise = (async () => {
    const pair = await loadOrCreateIdentity(userId);
    await uploadIdentity(pair.publicKeyB64);
    identityPair = pair;
    return pair;
  })();

  try {
    return await identityPromise;
  } finally {
    identityPromise = null;
  }
}

/** Fetch a peer's public encryption key (always from server when force=true). */
export async function fetchPeerPublicKey(
  peerId: string,
  _force = false,
): Promise<string> {
  const key = await api<UserIdentityKey>(`/api/crypto/identity/${peerId}`);
  return key.public_key;
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

/**
 * Decrypt with a fresh peer key from the server if the cached key fails
 * (e.g. peer re-registered keys on another device).
 */
export async function decryptWireResilient(
  wire: DmMessageWire,
  peerId: string,
  getCachedPeerKey: (id: string) => string | undefined,
  setCachedPeerKey: (id: string, key: string) => void,
): Promise<DmMessage> {
  if (!identityPair) {
    return { ...wire, content: "", decrypt_failed: true };
  }

  const attempt = async (force: boolean) => {
    let pub = force ? undefined : getCachedPeerKey(peerId);
    if (!pub) {
      pub = await fetchPeerPublicKey(peerId, force);
      setCachedPeerKey(peerId, pub);
    }
    return decryptWire(wire, pub);
  };

  let message = await attempt(false);
  if (!message.decrypt_failed) return message;

  clearDmKeyCache(wire.dm_channel_id);
  message = await attempt(true);
  return message;
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
}

/** Cached device identity after first load (null until login/bootstrap). */
export function getCachedIdentity(): IdentityKeyPair | null {
  return identityPair;
}
