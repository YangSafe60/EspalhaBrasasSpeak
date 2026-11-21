import { sameId } from "./serverPerms";
import type { DmChannel, UserPublic } from "../types";

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

/** Who in a DM call isn't me (first one = who "is calling"). */
export function otherCallers(
  dm: DmChannel,
  participants: { user_id: string }[],
  myId: string | undefined,
): UserPublic[] {
  const people = dm.is_group ? dm.members || [] : [dm.peer];
  return participants
    .filter((p) => !myId || !sameId(p.user_id, myId))
    .map((p) => people.find((u) => sameId(u.id, p.user_id)))
    .filter((u): u is UserPublic => Boolean(u));
}

export function dmMemberCount(dm: DmChannel): number {
  return dm.is_group ? (dm.members || []).length : 2;
}
