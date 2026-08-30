import { api } from "../../api/client";
import {
  decryptDm,
  loadOrCreateIdentity,
  type IdentityKeyPair,
} from "../../lib/e2e";
import type { DmMessage, DmMessageWire, Friendship, UserIdentityKey } from "../../types";

let identityPair: IdentityKeyPair | null = null;

/** Load or upload the device E2E identity for the signed-in user. */
export async function ensureIdentity(userId: string): Promise<IdentityKeyPair> {
  if (identityPair) return identityPair;
  identityPair = await loadOrCreateIdentity(userId);
  await api<UserIdentityKey>("/api/crypto/identity", {
    method: "PUT",
    body: { public_key: identityPair.publicKeyB64 },
  });
  return identityPair;
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

/** Replace or append one friendship row in a list. */
export function upsertFriendship(list: Friendship[], f: Friendship): Friendship[] {
  const next = list.filter((x) => x.id !== f.id);
  next.push(f);
  return next;
}

export function resetIdentityCache() {
  identityPair = null;
}

/** Cached device identity after first load (null until login/bootstrap). */
export function getCachedIdentity(): IdentityKeyPair | null {
  return identityPair;
}
