import type { Channel, PermissionOverwrite } from "../../types";
import { permBits, sameId } from "../../lib/serverPerms";

/** Normalize API permission overwrite payloads to canonical client shape. */
export function normalizeOverwrite(o: PermissionOverwrite): PermissionOverwrite {
  const raw = o as PermissionOverwrite & {
    allow_bits?: unknown;
    deny_bits?: unknown;
  };
  return {
    ...o,
    id: String(o.id),
    channel_id: String(o.channel_id),
    target_id: String(o.target_id),
    target_type:
      String(o.target_type).toLowerCase() === "member" ? "member" : "role",
    allow: permBits(raw.allow ?? raw.allow_bits),
    deny: permBits(raw.deny ?? raw.deny_bits),
  };
}

/** Resolve a channel id to the canonical id stored in `channelsByServer`. */
export function canonicalChannelId(
  channelId: string,
  channelsByServer: Record<string, Channel[]>,
): string {
  for (const list of Object.values(channelsByServer)) {
    const ch = list.find((c) => sameId(c.id, channelId));
    if (ch) return ch.id;
  }
  return channelId;
}

/** Replace overwrites for one channel, merging duplicate id keys. */
export function setChannelOverwrites(
  overwritesByChannel: Record<string, PermissionOverwrite[]>,
  channelId: string,
  overwrites: PermissionOverwrite[],
  channelsByServer: Record<string, Channel[]>,
): Record<string, PermissionOverwrite[]> {
  const canonical = canonicalChannelId(channelId, channelsByServer);
  const next = { ...overwritesByChannel };
  for (const key of Object.keys(next)) {
    if (sameId(key, channelId) && key !== canonical) delete next[key];
  }
  next[canonical] = overwrites;
  return next;
}

/** Build channelId → overwrites map from a flat server list. */
export function indexOverwritesByChannel(
  overwrites: PermissionOverwrite[],
  channels: Channel[],
): Record<string, PermissionOverwrite[]> {
  const owsByChannel: Record<string, PermissionOverwrite[]> = {};
  for (const c of channels) {
    owsByChannel[c.id] = [];
  }
  for (const o of overwrites) {
    const ch = channels.find((c) => sameId(c.id, o.channel_id));
    const key = ch?.id ?? String(o.channel_id);
    if (!owsByChannel[key]) owsByChannel[key] = [];
    owsByChannel[key].push(o);
  }
  return owsByChannel;
}

/** Insert or replace one channel in a server channel list. */
export function upsertChannelList(list: Channel[], channel: Channel): Channel[] {
  return [...list.filter((c) => !sameId(c.id, channel.id)), channel];
}

/** Remove duplicate channel rows that share the same id. */
export function dedupeChannelList(list: Channel[]): Channel[] {
  const out: Channel[] = [];
  for (const ch of list) {
    if (!out.some((c) => sameId(c.id, ch.id))) out.push(ch);
  }
  return out;
}

/** Coalesce duplicate in-flight creates (double submit / WS + HTTP races). */
export const pendingChannelCreates = new Map<string, Promise<Channel>>();

/** Dedup key for optimistic channel create requests. */
export function channelCreateKey(
  serverId: string,
  body: {
    name: string;
    channel_type: string;
    category_id?: string | null;
  },
): string {
  return [
    serverId,
    body.channel_type,
    body.name.trim().toLowerCase(),
    body.category_id ?? "",
  ].join("\0");
}
