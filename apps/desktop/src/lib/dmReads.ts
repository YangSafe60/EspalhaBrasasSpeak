import { api } from "../api/client";
import { miniStore } from "./miniStore";

/** "Seen" in DMs: where each person has read up to, per DM. */
export type DmRead = { message_id: string; read_at: string };
export const dmReads = miniStore<Record<string, Record<string, DmRead>>>({});

const KEY = "sendReadReceipts";

/** Off = I don't tell others what I read, and I don't see theirs either. */
export function readReceiptsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setReadReceiptsOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("read-receipts-changed"));
}

export function applyDmRead(dmId: string, userId: string, read: DmRead) {
  dmReads.set((all) => ({ ...all, [dmId]: { ...(all[dmId] || {}), [userId]: read } }));
}

const loaded = new Set<string>();

export async function loadDmReads(dmId: string) {
  if (loaded.has(dmId)) return;
  loaded.add(dmId);
  try {
    const rows = await api<{ user_id: string; message_id: string; read_at: string }[]>(`/api/dms/${dmId}/reads`);
    for (const r of rows) applyDmRead(dmId, r.user_id, { message_id: r.message_id, read_at: r.read_at });
  } catch {
    loaded.delete(dmId);
  }
}

const lastSent: Record<string, string> = {};

/** Tell the others I've read up to this message (once per message). */
export function markDmRead(dmId: string, messageId: string) {
  if (!readReceiptsOn() || lastSent[dmId] === messageId) return;
  lastSent[dmId] = messageId;
  void api(`/api/dms/${dmId}/read`, { method: "PUT", body: { message_id: messageId } }).catch(() => {
    delete lastSent[dmId];
  });
}
