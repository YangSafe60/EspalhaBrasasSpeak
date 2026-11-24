import { api } from "../api/client";
import type { WatchState } from "../types";
import { miniStore } from "./miniStore";

/** "watch" = YouTube with video; "listen" = audio only. Each has its own queue. */
export type PlayKind = "watch" | "listen";

/** State per voice channel and kind (from the server, live over WS). */
export const watchStates = miniStore<Record<string, WatchState>>({});

export function watchKey(channelId: string, kind: PlayKind): string {
  return kind === "watch" ? channelId : `${channelId}:listen`;
}

export function applyWatch(channelId: string, state: WatchState, kind: PlayKind = "watch") {
  watchStates.set((all) => ({ ...all, [watchKey(channelId, kind)]: state }));
}

export async function loadWatch(channelId: string, kind: PlayKind = "watch") {
  try {
    applyWatch(channelId, await api<WatchState>(`/api/channels/${channelId}/watch`, { query: { kind } }), kind);
  } catch {
    /* not allowed / offline */
  }
}

/** Fetch again every activity this app has state for (after a reconnect). */
export async function reloadWatchStates() {
  const keys = Object.keys(watchStates.get());
  await Promise.all(
    keys.map((key) => {
      const [channelId, kind] = key.split(":");
      return loadWatch(channelId, kind === "listen" ? "listen" : "watch");
    }),
  );
}

export type WatchAction =
  | { action: "add"; url: string }
  | { action: "remove" | "select"; item_id: string }
  | { action: "play" | "pause" | "seek"; position: number }
  | { action: "next"; item_id?: string }
  | { action: "clear" };

export async function watchAction(channelId: string, body: WatchAction, kind: PlayKind = "watch"): Promise<WatchState> {
  const state = await api<WatchState>(`/api/channels/${channelId}/watch`, { method: "POST", body, query: { kind } });
  applyWatch(channelId, state, kind);
  return state;
}

/** Where the current video should be right now (seconds). */
export function livePosition(w: WatchState): number {
  if (!w.playing) return w.position;
  return w.position + Math.max(0, (Date.now() - new Date(w.updated_at).getTime()) / 1000);
}
