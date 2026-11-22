/**
 * Attachments are encrypted here before they leave the PC, so Catbox /
 * Litterbox only ever store ciphertext (their links are short and guessable).
 * The key (random per file) is stored with the attachment on our server and
 * sent to people who can see the message; the VPS does no crypto work.
 *
 * File format: "EBA1" + 12-byte IV + AES-256-GCM(ciphertext + tag).
 */
import { getElectronAPI } from "./desktop";
import type { Attachment } from "../types";

const MAGIC = new TextEncoder().encode("EBA1");

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encryptAttachment(
  plain: ArrayBuffer,
): Promise<{ data: ArrayBuffer; key: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + iv.length);
  return { data: out.buffer, key: b64url(raw) };
}

export async function decryptAttachment(data: ArrayBuffer, keyText: string): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data);
  if (bytes.length < MAGIC.length + 12 + 16 || !MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error("not an encrypted attachment");
  }
  const key = await crypto.subtle.importKey("raw", unb64url(keyText), "AES-GCM", false, ["decrypt"]);
  const iv = bytes.slice(MAGIC.length, MAGIC.length + 12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(MAGIC.length + 12));
}

async function download(url: string): Promise<ArrayBuffer> {
  const desktop = getElectronAPI();
  if (desktop?.fetchEncrypted) return desktop.fetchEncrypted(url);
  const res = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  return res.arrayBuffer();
}

/** Decrypted files as blob: URLs, kept for the most recent attachments. */
const MAX_CACHED = 150;
const cache = new Map<string, Promise<string>>();

/** A blob: URL of the decrypted file (cached; shared by every view of it). */
export function decryptedUrl(att: Attachment): Promise<string> {
  const hit = cache.get(att.id);
  if (hit) {
    // Most recently used goes last.
    cache.delete(att.id);
    cache.set(att.id, hit);
    return hit;
  }
  const job = (async () => {
    const plain = await decryptAttachment(await download(att.url), att.enc_key!);
    return URL.createObjectURL(new Blob([plain], { type: att.content_type || "application/octet-stream" }));
  })();
  // A failed download can be retried later.
  job.catch(() => cache.delete(att.id));
  cache.set(att.id, job);
  while (cache.size > MAX_CACHED) {
    const [oldId, oldJob] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(oldId);
    void oldJob.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  }
  return job;
}
