import {
  type ChannelMuteMap,
  type ChannelMuteUntil,
  pruneExpiredMutes,
} from "./channelMutePrefs";

const STORAGE_KEY = "eb_server_mutes";

export type ServerMuteMap = ChannelMuteMap;
export type ServerMuteUntil = ChannelMuteUntil;

export function loadServerMutes(): ServerMuteMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return pruneExpiredMutes(JSON.parse(raw) as ServerMuteMap);
  } catch {
    return {};
  }
}

export function saveServerMutes(map: ServerMuteMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function serverIsMuted(map: ServerMuteMap, serverId: string): boolean {
  if (!(serverId in map)) return false;
  const until = map[serverId];
  if (until === null) return true;
  return until > Date.now();
}
