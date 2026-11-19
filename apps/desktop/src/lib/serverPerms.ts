import type { Member, PermissionOverwrite, Role, Server } from "../types";
import { Perm } from "../types";

/** Discord-style: OR role permissions; owner gets everything. */
export function effectiveServerPerms(
  server: Server | undefined,
  roles: Role[],
  member: Member | undefined,
  userId: string | undefined,
): number {
  if (!server || !userId) return 0;
  if (sameId(server.owner_id, userId)) return ~0 >>> 0;
  if (!member) return 0;
  let bits = 0;
  for (const role of roles) {
    if (isEveryoneRole(role) || member.role_ids.some((id) => sameId(id, role.id))) {
      if (permissionsIncludeAdministrator(role.permissions)) {
        return ~0 >>> 0;
      }
      bits |= permBits(role.permissions);
    }
  }
  return bits;
}

/** Effective permissions for a specific channel/category (includes overwrites). */
export function effectiveChannelPerms(
  server: Server | undefined,
  roles: Role[],
  member: Member | undefined,
  userId: string | undefined,
  overwrites: PermissionOverwrite[] | undefined,
): number {
  let perms = effectiveServerPerms(server, roles, member, userId);
  if (!member || !userId || !overwrites?.length) return perms;
  if (server && sameId(server.owner_id, userId)) return ~0 >>> 0;

  const everyone = roles.find(isEveryoneRole);
  const everyoneId = everyone?.id;

  const everyoneOw = everyoneId
    ? overwrites.find(
        (o) =>
          String(o.target_type).toLowerCase() === "role" &&
          sameId(o.target_id, everyoneId),
      )
    : undefined;
  if (everyoneOw) {
    const allow = permBits(everyoneOw.allow);
    const deny = permBits(everyoneOw.deny);
    perms = ((perms & ~deny) | allow) >>> 0;
  }

  let roleAllow = 0;
  let roleDeny = 0;
  for (const o of overwrites) {
    if (String(o.target_type).toLowerCase() !== "role") continue;
    if (everyoneId && sameId(o.target_id, everyoneId)) continue;
    if (!member.role_ids.some((id) => sameId(id, o.target_id))) continue;
    roleAllow |= permBits(o.allow);
    roleDeny |= permBits(o.deny);
  }
  perms = ((perms & ~roleDeny) | roleAllow) >>> 0;

  const memberOw = overwrites.find(
    (o) =>
      String(o.target_type).toLowerCase() === "member" &&
      sameId(o.target_id, userId),
  );
  if (memberOw) {
    const allow = permBits(memberOw.allow);
    const deny = permBits(memberOw.deny);
    perms = ((perms & ~deny) | allow) >>> 0;
  }

  return perms;
}

function permissionsIncludeAdministrator(value: unknown): boolean {
  try {
    const big =
      typeof value === "bigint"
        ? value
        : typeof value === "string" && value.trim()
          ? BigInt(value)
          : typeof value === "number" && Number.isFinite(value)
            ? BigInt(Math.trunc(value))
            : 0n;
    return (big & (1n << 63n)) !== 0n;
  } catch {
    return false;
  }
}

export function hasPerm(bits: number, flag: number): boolean {
  // ADMINISTRATOR (1 << 63) not in JS number safely — treat owner via ~0
  if (bits === (~0 >>> 0)) return true;
  return (bits & flag) === flag;
}

/** Names match the Rust `Permissions` bitflags (JSON serializes them as `"A | B"`). */
const PERM_NAME_TO_BIT: Record<string, number> = {
  VIEW_CHANNEL: Perm.VIEW_CHANNEL,
  SEND_MESSAGES: Perm.SEND_MESSAGES,
  MANAGE_MESSAGES: Perm.MANAGE_MESSAGES,
  CONNECT: Perm.CONNECT,
  SPEAK: Perm.SPEAK,
  STREAM: Perm.STREAM,
  MUTE_MEMBERS: Perm.MUTE_MEMBERS,
  MOVE_MEMBERS: Perm.MOVE_MEMBERS,
  MANAGE_CHANNELS: Perm.MANAGE_CHANNELS,
  MANAGE_ROLES: Perm.MANAGE_ROLES,
  MANAGE_SERVER: Perm.MANAGE_SERVER,
  KICK_MEMBERS: Perm.KICK_MEMBERS,
  BAN_MEMBERS: Perm.BAN_MEMBERS,
  CREATE_INVITE: Perm.CREATE_INVITE,
  ATTACH_FILES: Perm.ATTACH_FILES,
  ADD_REACTIONS: Perm.ADD_REACTIONS,
  MENTION_EVERYONE: Perm.MENTION_EVERYONE,
  MANAGE_EXPRESSIONS: Perm.MANAGE_EXPRESSIONS,
};

function bitsFromBigInt(value: bigint): number {
  if ((value & (1n << 63n)) !== 0n) return ~0 >>> 0;
  return Number(value & 0xffffffffn) >>> 0;
}

/** Parse `bitflags` human-readable form (`"VIEW_CHANNEL | SEND_MESSAGES"`). */
function permBitsFromFlagString(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (/^-?\d+$/.test(trimmed)) {
    try {
      return bitsFromBigInt(BigInt(trimmed));
    } catch {
      return 0;
    }
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    try {
      return bitsFromBigInt(BigInt(trimmed));
    } catch {
      return 0;
    }
  }

  let bits = 0;
  let administrator = false;
  for (const part of trimmed.split("|")) {
    const name = part.trim();
    if (!name) continue;
    if (name === "ADMINISTRATOR") {
      administrator = true;
      continue;
    }
    if (/^0x[0-9a-f]+$/i.test(name)) {
      try {
        bits |= bitsFromBigInt(BigInt(name));
      } catch {
        /* ignore unknown residue */
      }
      continue;
    }
    const bit = PERM_NAME_TO_BIT[name];
    if (bit) bits |= bit;
  }
  if (administrator) return ~0 >>> 0;
  return bits >>> 0;
}

/** Coerce API permission values (number, numeric string, flag names, or `{ bits }`) to a bitfield. */
export function permBits(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >>> 0;
  }
  if (typeof value === "bigint") {
    return bitsFromBigInt(value);
  }
  if (typeof value === "string") {
    return permBitsFromFlagString(value);
  }
  if (value && typeof value === "object") {
    const obj = value as { bits?: unknown };
    if ("bits" in obj) return permBits(obj.bits);
    const vals = Object.values(obj);
    if (vals.length === 1) return permBits(vals[0]);
  }
  return 0;
}

export function sameId(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();
}

export function isEveryoneRole(role: Role | undefined | null): boolean {
  if (!role) return false;
  return Boolean(role.is_everyone) || role.name === "@everyone";
}

/** Highest role position held by a member (@everyone counts). */
export function highestRolePosition(
  member: Member | undefined,
  roles: Role[],
): number {
  if (!member) return -1;
  let max = -1;
  for (const role of roles) {
    const held =
      isEveryoneRole(role) ||
      member.role_ids.some((id) => sameId(id, role.id));
    if (held) max = Math.max(max, role.position);
  }
  return max;
}

export function canManageTargetMemberRoles(
  actorMember: Member | undefined,
  targetMember: Member | undefined,
  roles: Role[],
  server: Server | undefined,
  actorUserId: string | undefined,
  myPerms: number,
): boolean {
  if (!server || !actorUserId || !targetMember) return false;
  if (sameId(server.owner_id, actorUserId)) return true;
  if (!hasPerm(myPerms, Perm.MANAGE_ROLES)) return false;
  // Owners/managers may assign roles to themselves (still capped below their highest role).
  if (sameId(targetMember.user.id, actorUserId)) return true;
  return (
    highestRolePosition(actorMember, roles) >
    highestRolePosition(targetMember, roles)
  );
}

export function canRemoveRoleFromMember(
  role: Role,
  actorMember: Member | undefined,
  targetMember: Member | undefined,
  roles: Role[],
  server: Server | undefined,
  actorUserId: string | undefined,
  myPerms: number,
): boolean {
  if (isEveryoneRole(role)) return false;
  if (
    !canManageTargetMemberRoles(
      actorMember,
      targetMember,
      roles,
      server,
      actorUserId,
      myPerms,
    )
  ) {
    return false;
  }
  if (sameId(server?.owner_id, actorUserId)) return true;
  return role.position < highestRolePosition(actorMember, roles);
}

/** Roles the actor may add to the target member. */
export function assignableRoles(
  actorMember: Member | undefined,
  targetMember: Member | undefined,
  roles: Role[],
  server: Server | undefined,
  actorUserId: string | undefined,
  myPerms: number,
): Role[] {
  if (
    !targetMember ||
    !canManageTargetMemberRoles(
      actorMember,
      targetMember,
      roles,
      server,
      actorUserId,
      myPerms,
    )
  ) {
    return [];
  }
  const isOwner = sameId(server?.owner_id, actorUserId);
  const actorHighest = highestRolePosition(actorMember, roles);
  const assigned = new Set(
    targetMember.role_ids.map((id) => id.replace(/-/g, "").toLowerCase()),
  );
  return roles
    .filter((r) => !isEveryoneRole(r))
    .filter((r) => !assigned.has(r.id.replace(/-/g, "").toLowerCase()))
    .filter((r) => isOwner || r.position < actorHighest)
    .sort((a, b) => b.position - a.position);
}

/** Bits used to lock a channel (voice also blocks Connect). */
export function channelAccessBits(channelType: string | undefined): number {
  if (channelType === "voice") {
    return (Perm.VIEW_CHANNEL | Perm.CONNECT) >>> 0;
  }
  return Perm.VIEW_CHANNEL >>> 0;
}

export function hasAnyAccessBit(bits: number, accessBits: number): boolean {
  return (permBits(bits) & accessBits) !== 0;
}

/** True when @everyone is denied View (and Connect for voice). */
export function isChannelLocked(
  ows: PermissionOverwrite[] | undefined,
  roles: Role[],
  channelType: string | undefined,
): boolean {
  if (!ows?.length) return false;
  const accessBits = channelAccessBits(channelType);
  const roleOws = ows.filter(
    (o) => String(o.target_type).toLowerCase() === "role",
  );
  const everyone = roles.find((r) => isEveryoneRole(r));
  let everyoneOw = everyone
    ? roleOws.find((o) => sameId(o.target_id, everyone.id))
    : undefined;
  if (!everyoneOw) {
    everyoneOw = roleOws.find((o) => {
      const deny = permBits(o.deny);
      const allow = permBits(o.allow);
      return (
        hasAnyAccessBit(deny, accessBits) && !hasAnyAccessBit(allow, accessBits)
      );
    });
  }
  return Boolean(
    everyoneOw && hasAnyAccessBit(permBits(everyoneOw.deny), accessBits),
  );
}

export { Perm };
