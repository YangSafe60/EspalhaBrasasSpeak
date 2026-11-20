import type { ServerNotifyLevel, ServerNotifyPref } from "./serverNotifyPrefs";

/**
 * Per text channel notification level, like Discord's channel "Notification
 * Settings". Channels without an entry use the server's setting.
 */

const STORAGE_KEY = "eb_channel_notify";

export type ChannelNotifyMap = Record<string, ServerNotifyLevel>;

function isLevel(value: unknown): value is ServerNotifyLevel {
  return value === "all" || value === "mentions" || value === "nothing";
}

export function loadChannelNotify(): ChannelNotifyMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: ChannelNotifyMap = {};
    for (const [id, level] of Object.entries(parsed)) {
      if (isLevel(level)) next[id] = level;
    }
    return next;
  } catch {
    return {};
  }
}

export function saveChannelNotify(map: ChannelNotifyMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* not persisted this session */
  }
}

/** The channel's own level, or `null` when it follows the server. */
export function channelNotifyOf(map: ChannelNotifyMap, channelId: string): ServerNotifyLevel | null {
  return map[channelId] ?? null;
}

/**
 * What applies to a message in this channel: the server's preferences, with
 * the channel's level on top when it has one. The server's suppress options
 * (@everyone, roles, highlights) still apply to "Only @mentions".
 */
export function effectiveNotify(
  serverPref: ServerNotifyPref,
  channelLevel: ServerNotifyLevel | null,
): ServerNotifyPref {
  return channelLevel ? { ...serverPref, level: channelLevel } : serverPref;
}

export const NOTIFY_LEVEL_LABELS: Record<ServerNotifyLevel, string> = {
  all: "All Messages",
  mentions: "Only @mentions",
  nothing: "Nothing",
};
