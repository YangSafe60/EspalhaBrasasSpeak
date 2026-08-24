import type { Member, Role, Server } from "../types";
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
    if (role.is_everyone || member.role_ids.includes(role.id)) {
      bits |= role.permissions;
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
  return a.toLowerCase() === b.toLowerCase();
}

export { Perm };
