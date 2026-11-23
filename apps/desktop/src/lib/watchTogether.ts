import { api } from "../api/client";
import type { WatchState } from "../types";
import { miniStore } from "./miniStore";

/** Watch-together state per voice channel (from the server, live over WS). */
export const watchStates = miniStore<Record<string, WatchState>>({});

export function applyWatch(channelId: string, state: WatchState) {
  watchStates.set((all) => ({ ...all, [channelId]: state }));
}

export async function loadWatch(channelId: string) {
  try {
    applyWatch(channelId, await api<WatchState>(`/api/channels/${channelId}/watch`));
  } catch {
    /* not allowed / offline */
  }
}

export type WatchAction =
  | { action: "add"; url: string }
  | { action: "remove" | "select"; item_id: string }
  | { action: "play" | "pause" | "seek"; position: number }
  | { action: "next"; item_id?: string }
  | { action: "clear" };

export async function watchAction(channelId: string, body: WatchAction): Promise<WatchState> {
  const state = await api<WatchState>(`/api/channels/${channelId}/watch`, { method: "POST", body });
  applyWatch(channelId, state);
  return state;
}

/** Where the current video should be right now (seconds). */
export function livePosition(w: WatchState): number {
  if (!w.playing) return w.position;
  return w.position + Math.max(0, (Date.now() - new Date(w.updated_at).getTime()) / 1000);
}
