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
  if (server.owner_id === userId) return ~0 >>> 0; // all bits as unsigned
  if (!member) return 0;
  let bits = 0;
  for (const role of roles) {
    if (isEveryoneRole(role) || member.role_ids.some((id) => sameId(id, role.id))) {
      bits |= permBits(role.permissions);
    }
  }
  return bits;
}

export function hasPerm(bits: number, flag: number): boolean {
  // ADMINISTRATOR (1 << 63) not in JS number safely — treat owner via ~0
  if (bits === (~0 >>> 0)) return true;
  return (bits & flag) === flag;
}

/** Coerce API permission values (number, numeric string, or `{ bits }`) to a bitfield. */
export function permBits(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >>> 0;
  }
  if (typeof value === "bigint") {
    return Number(value & BigInt(0xffffffff)) >>> 0;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n >>> 0 : 0;
  }
  if (value && typeof value === "object" && "bits" in value) {
    return permBits((value as { bits: unknown }).bits);
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
