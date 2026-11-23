import { api } from "../api/client";
import type { ServerEvent } from "../types";
import { miniStore } from "./miniStore";

/** Scheduled events per server, sorted by start time. */
export const serverEvents = miniStore<Record<string, ServerEvent[]>>({});

function sorted(list: ServerEvent[]) {
  return [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function upsertEvent(e: ServerEvent) {
  serverEvents.set((all) => ({
    ...all,
    [e.server_id]: sorted([...(all[e.server_id] || []).filter((x) => x.id !== e.id), e]),
  }));
  scheduleReminder(e);
}

export function removeEvent(serverId: string, eventId: string) {
  serverEvents.set((all) => ({ ...all, [serverId]: (all[serverId] || []).filter((x) => x.id !== eventId) }));
  cancelReminder(eventId);
}

export async function loadEvents(serverId: string) {
  try {
    const list = await api<ServerEvent[]>(`/api/servers/${serverId}/events`);
    serverEvents.set((all) => ({ ...all, [serverId]: sorted(list) }));
    list.forEach(scheduleReminder);
  } catch {
    /* not a member / offline */
  }
}

export async function createEvent(
  serverId: string,
  body: { title: string; description?: string; starts_at: string; channel_id?: string | null },
) {
  upsertEvent(await api<ServerEvent>(`/api/servers/${serverId}/events`, { method: "POST", body }));
}

export async function setGoing(e: ServerEvent, going: boolean) {
  upsertEvent(await api<ServerEvent>(`/api/events/${e.id}/rsvp`, { method: going ? "PUT" : "DELETE" }));
}

export async function deleteEvent(e: ServerEvent) {
  await api(`/api/events/${e.id}`, { method: "DELETE" });
  removeEvent(e.server_id, e.id);
}

/* ---------- "starts in 15 minutes" reminders (while the app is open) ---------- */

const REMIND_BEFORE_MS = 15 * 60 * 1000;
const timers = new Map<string, number>();
let myId: string | null = null;
let notify: ((e: ServerEvent) => void) | null = null;

/** Who I am and how to show a reminder (set once the app is signed in). */
export function configureReminders(userId: string | null, show: (e: ServerEvent) => void) {
  myId = userId;
  notify = show;
  for (const list of Object.values(serverEvents.get())) list.forEach(scheduleReminder);
}

function cancelReminder(id: string) {
  const t = timers.get(id);
  if (t != null) window.clearTimeout(t);
  timers.delete(id);
}

function scheduleReminder(e: ServerEvent) {
  cancelReminder(e.id);
  if (!myId || !e.going.includes(myId)) return;
  const wait = new Date(e.starts_at).getTime() - REMIND_BEFORE_MS - Date.now();
  // Already inside the 15 minutes (or past): no reminder. Timers longer than
  // ~24 days overflow, so far-off events are scheduled on a later load.
  if (wait <= 0 || wait > 2 ** 31 - 1) return;
  timers.set(
    e.id,
    window.setTimeout(() => {
      timers.delete(e.id);
      notify?.(e);
    }, wait),
  );
}

/** "in 2 h 5 min", "in 3 days", "now", "started 20 min ago". */
export function untilLabel(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const mins = Math.round(Math.abs(diff) / 60000);
  const span =
    mins < 1
      ? ""
      : mins < 60
        ? `${mins} min`
        : mins < 60 * 24
          ? `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`
          : `${Math.round(mins / 60 / 24)} day${Math.round(mins / 60 / 24) === 1 ? "" : "s"}`;
  if (!span) return "now";
  return diff > 0 ? `in ${span}` : `started ${span} ago`;
}
