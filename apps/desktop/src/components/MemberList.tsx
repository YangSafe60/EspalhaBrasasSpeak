import { useMemo, type MouseEvent } from "react";
import { useAppStore } from "../store/appStore";
import { mediaUrl } from "../lib/mediaUrl";
import type { Member, PresenceStatus, Role } from "../types";
import {
  useMemberContextMenu,
  type MemberVoiceHandlers,
} from "./MemberUserMenu";

function displayName(m: Member): string {
  return m.nickname || m.user.display_name || m.user.username;
}

function highestRoleColor(m: Member, roles: Role[]): string | undefined {
  const owned = roles
    .filter((r) => !r.is_everyone && m.role_ids.includes(r.id))
    .sort((a, b) => b.position - a.position);
  return owned[0]?.color || undefined;
}

function MemberRow({
  member,
  status,
  color,
  onOpen,
  onContext,
}: {
  member: Member;
  status: PresenceStatus;
  color?: string;
  onOpen: (e: MouseEvent, member: Member) => void;
  onContext: (e: MouseEvent, member: Member) => void;
}) {
  const online = status === "online" || status === "idle" || status === "dnd";
  const initial = displayName(member).charAt(0).toUpperCase() || "?";

  return (
    <li
      className={`member-list-row ${online ? "online" : "offline"}`}
      onClick={(e) => onOpen(e, member)}
      onContextMenu={(e) => onContext(e, member)}
    >
      <div className="member-list-avatar-wrap">
        {member.user.avatar_url ? (
          <img
            className="member-list-avatar"
            src={mediaUrl(member.user.avatar_url)}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="member-list-avatar placeholder">{initial}</span>
        )}
        <span
          className={`member-list-status status-${status}`}
          title={status}
          aria-label={status}
        />
      </div>
      <div className="member-list-meta">
        <span className="member-list-name" style={color ? { color } : undefined}>
          {displayName(member)}
        </span>
        <span className="member-list-user muted">@{member.user.username}</span>
      </div>
    </li>
  );
}

export function MemberList({ voice }: { voice?: MemberVoiceHandlers }) {
  const activeServerId = useAppStore((s) => s.activeServerId);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const presenceByUser = useAppStore((s) => s.presenceByUser);
  const myStatus = useAppStore((s) => s.myStatus);
  const user = useAppStore((s) => s.user);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const { openForMember, menuPortal } = useMemberContextMenu(voice);

  const members = activeServerId
    ? membersByServer[activeServerId] || []
    : [];
  const roles = activeServerId ? rolesByServer[activeServerId] || [] : [];

  const { online, offline } = useMemo(() => {
    const on: Member[] = [];
    const off: Member[] = [];
    for (const m of members) {
      const status =
        m.user.id === user?.id
          ? myStatus
          : presenceByUser[m.user.id] || "offline";
      if (status === "offline") off.push(m);
      else on.push(m);
    }
    const byName = (a: Member, b: Member) =>
      displayName(a).localeCompare(displayName(b), undefined, {
        sensitivity: "base",
      });
    on.sort(byName);
    off.sort(byName);
    return { online: on, offline: off };
  }, [members, presenceByUser, user?.id, myStatus]);

  if (!activeServerId) return null;

  function openProfile(e: MouseEvent, member: Member) {
    openMiniProfile({
      userId: member.user.id,
      serverId: activeServerId,
      x: e.clientX,
      y: e.clientY,
    });
  }

  function statusFor(member: Member): PresenceStatus {
    if (member.user.id === user?.id) return myStatus;
    return presenceByUser[member.user.id] || "offline";
  }

  return (
    <aside className="member-list-panel" aria-label="Server members">
      <div className="member-list-scroll">
        {online.length > 0 && (
          <section className="member-list-section">
            <h3>Online — {online.length}</h3>
            <ul className="member-list">
              {online.map((m) => (
                <MemberRow
                  key={m.user.id}
                  member={m}
                  status={statusFor(m)}
                  color={highestRoleColor(m, roles)}
                  onOpen={openProfile}
                  onContext={openForMember}
                />
              ))}
            </ul>
          </section>
        )}
        {offline.length > 0 && (
          <section className="member-list-section">
            <h3>Offline — {offline.length}</h3>
            <ul className="member-list">
              {offline.map((m) => (
                <MemberRow
                  key={m.user.id}
                  member={m}
                  status="offline"
                  color={highestRoleColor(m, roles)}
                  onOpen={openProfile}
                  onContext={openForMember}
                />
              ))}
            </ul>
          </section>
        )}
        {members.length === 0 && (
          <p className="muted member-list-empty">No members yet.</p>
        )}
      </div>
      {menuPortal}
    </aside>
  );
}
