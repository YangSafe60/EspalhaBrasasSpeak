import type { DmChannel } from "../types";

/** Max people in a group DM (the server enforces the same). */
export const MAX_GROUP_MEMBERS = 10;

/** What to call a DM: the peer, the group's name, or its members' names. */
export function dmTitle(dm: DmChannel, myId: string | undefined): string {
  if (!dm.is_group) return dm.peer.display_name || dm.peer.username;
  if (dm.name) return dm.name;
  const others = (dm.members || []).filter((m) => m.id !== myId);
  if (others.length === 0) return "Just you";
  return others.map((m) => m.display_name || m.username).join(", ");
}

export function dmMemberCount(dm: DmChannel): number {
  return dm.is_group ? (dm.members || []).length : 2;
}
