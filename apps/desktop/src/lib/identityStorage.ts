import { getElectronAPI } from "./desktop";

export type StoredIdentityBlob = {
  publicKey: string;
  privateKey: string;
};

const STORAGE_PREFIX = "speakapp_e2e_identity_";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readLocalStorage(userId: string): StoredIdentityBlob | null {
  const stored = localStorage.getItem(storageKey(userId));
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as StoredIdentityBlob;
    if (
      typeof parsed.publicKey !== "string" ||
      typeof parsed.privateKey !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalStorage(userId: string, blob: StoredIdentityBlob): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(blob));
}

/** Load identity from durable Electron store, migrating legacy localStorage if needed. */
export async function loadStoredIdentity(
  userId: string,
): Promise<StoredIdentityBlob | null> {
  const electron = getElectronAPI();
  if (electron?.loadE2eIdentity) {
    try {
      const fromDisk = await electron.loadE2eIdentity(userId);
      if (fromDisk?.publicKey && fromDisk?.privateKey) {
        writeLocalStorage(userId, fromDisk);
        return fromDisk;
      }
    } catch {
      /* fall through */
    }
  }

  const legacy = readLocalStorage(userId);
  if (legacy && electron?.saveE2eIdentity) {
    try {
      await electron.saveE2eIdentity(userId, legacy);
    } catch {
      /* keep localStorage copy */
    }
  }
  return legacy;
}

/** Persist identity to Electron userData (encrypted) and localStorage backup. */
export async function saveStoredIdentity(
  userId: string,
  blob: StoredIdentityBlob,
): Promise<void> {
  writeLocalStorage(userId, blob);
  const electron = getElectronAPI();
  if (electron?.saveE2eIdentity) {
    await electron.saveE2eIdentity(userId, blob);
  }
}

export async function deleteStoredIdentity(userId: string): Promise<void> {
  localStorage.removeItem(storageKey(userId));
  const electron = getElectronAPI();
  if (electron?.deleteE2eIdentity) {
    await electron.deleteE2eIdentity(userId);
  }
}
