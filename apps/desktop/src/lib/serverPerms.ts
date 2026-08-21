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

export { Perm };
