import { miniStore } from "./miniStore";

export type ActivityId = "watch" | "listen";

/**
 * The activity I have open, and in which voice channel. Shared so it can be
 * started from the voice dock (any view) and shown in the voice lobby.
 */
export const openActivity = miniStore<{ channelId: string; id: ActivityId } | null>(null);

export function setOpenActivity(channelId: string, id: ActivityId | null) {
  openActivity.set(id ? { channelId, id } : null);
}
