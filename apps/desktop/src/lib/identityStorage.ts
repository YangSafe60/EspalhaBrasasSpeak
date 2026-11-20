import { getElectronAPI } from "./desktop";

export type StoredIdentityBlob = {
  publicKey: string;
  privateKey: string;
};

/**
 * Old builds kept the private key in localStorage in plain text. It is only
 * read here to migrate it into the encrypted desktop store, then removed.
 */
const LEGACY_PREFIX = "speakapp_e2e_identity_";

function legacyKey(userId: string): string {
  return `${LEGACY_PREFIX}${userId}`;
}

function isBlob(value: unknown): value is StoredIdentityBlob {
  const v = value as StoredIdentityBlob | null;
  return (
    !!v && typeof v.publicKey === "string" && typeof v.privateKey === "string"
  );
}

function readLegacy(userId: string): StoredIdentityBlob | null {
  try {
    const raw = localStorage.getItem(legacyKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isBlob(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function removeLegacy(userId: string): void {
  try {
    localStorage.removeItem(legacyKey(userId));
  } catch {
    /* storage unavailable */
  }
}

function hasDesktopStore(): boolean {
  const electron = getElectronAPI();
  return !!(electron?.loadE2eIdentity && electron.saveE2eIdentity);
}

/**
 * Load the identity from the encrypted desktop store (Electron safeStorage).
 * A legacy plaintext localStorage copy is moved into that store and deleted;
 * it is only deleted after the encrypted copy was written successfully.
 */
export async function loadStoredIdentity(
  userId: string,
): Promise<StoredIdentityBlob | null> {
  const electron = getElectronAPI();
  if (!electron || !hasDesktopStore()) {
    // Browser preview only (the app requires Electron): nothing safer exists.
    return readLegacy(userId);
  }

  let diskError: unknown = null;
  const fromDisk = await electron.loadE2eIdentity!(userId).catch((err) => {
    diskError = err;
    return null;
  });
  if (isBlob(fromDisk)) {
    removeLegacy(userId);
    return fromDisk;
  }

  const legacy = readLegacy(userId);
  if (!legacy) {
    // A key file exists but the OS keystore can't open it: fail loudly so the
    // caller doesn't create (and save over it) a brand-new identity.
    if (diskError) throw diskError;
    return null;
  }
  try {
    await electron.saveE2eIdentity!(userId, legacy);
    removeLegacy(userId);
  } catch {
    // Keep the legacy copy rather than lose the only key we have.
  }
  return legacy;
}

/** Persist the identity in the encrypted desktop store only. */
export async function saveStoredIdentity(
  userId: string,
  blob: StoredIdentityBlob,
): Promise<void> {
  const electron = getElectronAPI();
  if (!electron || !hasDesktopStore()) {
    localStorage.setItem(legacyKey(userId), JSON.stringify(blob));
    return;
  }
  await electron.saveE2eIdentity!(userId, blob);
  removeLegacy(userId);
}

export async function deleteStoredIdentity(userId: string): Promise<void> {
  removeLegacy(userId);
  const electron = getElectronAPI();
  if (electron?.deleteE2eIdentity) {
    await electron.deleteE2eIdentity(userId);
  }
}
