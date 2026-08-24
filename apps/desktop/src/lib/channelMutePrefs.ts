const STORAGE_KEY = "eb_channel_mutes";

/** `null` = muted until manually unmuted; number = unix ms when mute ends. */
export type ChannelMuteUntil = number | null;

export type ChannelMuteMap = Record<string, ChannelMuteUntil>;

export const MUTE_DURATIONS = [
  { label: "For 15 Minutes", ms: 15 * 60 * 1000 },
  { label: "For 1 Hour", ms: 60 * 60 * 1000 },
  { label: "For 3 Hours", ms: 3 * 60 * 60 * 1000 },
  { label: "For 8 Hours", ms: 8 * 60 * 60 * 1000 },
  { label: "For 24 Hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Until I turn it back on", ms: null as number | null },
] as const;

export function loadChannelMutes(): ChannelMuteMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChannelMuteMap;
    return pruneExpiredMutes(parsed);
  } catch {
    return {};
  }
}

export function saveChannelMutes(map: ChannelMuteMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function pruneExpiredMutes(map: ChannelMuteMap): ChannelMuteMap {
  const now = Date.now();
  const next: ChannelMuteMap = {};
  for (const [id, until] of Object.entries(map)) {
    if (until === null || until > now) next[id] = until;
  }
  return next;
}

export function channelIsMuted(
  map: ChannelMuteMap,
  channelId: string,
): boolean {
  if (!(channelId in map)) return false;
  const until = map[channelId];
  if (until === null) return true;
  return until > Date.now();
}

export function formatMuteRemaining(until: ChannelMuteUntil): string {
  if (until === null) return "Muted";
  const ms = until - Date.now();
  if (ms <= 0) return "Muted";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `Muted · ${mins}m`;
  const hours = Math.ceil(mins / 60);
  if (hours < 48) return `Muted · ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `Muted · ${days}d`;
}
