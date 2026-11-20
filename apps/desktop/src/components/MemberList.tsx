import { memo, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useStableHandlers } from "../hooks/useStableHandlers";
import { useAppStore } from "../store/appStore";
import { mediaUrl } from "../lib/mediaUrl";
import { sameId } from "../lib/serverPerms";
import type { Member, PresenceStatus, Role } from "../types";
import {
  useMemberContextMenu,
  type MemberVoiceHandlers,
} from "./MemberUserMenu";
import { OwnerCrown } from "./OwnerCrown";

const MEMBERS_OPEN_KEY = "speakapp_members_panel_open";

function readMembersOpen(): boolean {
  try {
    return localStorage.getItem(MEMBERS_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

function displayName(m: Member): string {
  return m.nickname || m.user.display_name || m.user.username;
}

function highestRoleColor(m: Member, roles: Role[]): string | undefined {
  const owned = roles
    .filter(
      (r) =>
        !r.is_everyone && m.role_ids.some((id) => sameId(id, r.id)),
    )
    .sort((a, b) => b.position - a.position);
  return owned[0]?.color || undefined;
}

const EMPTY_MEMBERS: Member[] = [];
const EMPTY_ROLES: Role[] = [];

/** Find a per-server list by id (ids may differ in case), keeping its identity. */
function pickByServer<T>(map: Record<string, T[]>, serverId: string | null, empty: T[]): T[] {
  if (!serverId) return empty;
  if (map[serverId]) return map[serverId];
  const key = Object.keys(map).find((id) => sameId(id, serverId));
  return key ? map[key] || empty : empty;
}

const MemberRow = memo(function MemberRow({
  member,
  status,
  color,
  isOwner,
  onOpen,
  onContext,
}: {
  member: Member;
  status: PresenceStatus;
  color?: string;
  isOwner?: boolean;
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
        <span className="member-list-name-row">
          <span
            className="member-list-name"
            style={color ? { color } : undefined}
          >
            {displayName(member)}
          </span>
          {isOwner && (
            <span className="owner-crown-wrap" title="Server Owner">
              <OwnerCrown />
            </span>
          )}
        </span>
        <span className="member-list-user muted">@{member.user.username}</span>
      </div>
    </li>
  );
});

export function MemberList({ voice }: { voice?: MemberVoiceHandlers }) {
  const activeServerId = useAppStore((s) => s.activeServerId);
  const servers = useAppStore((s) => s.servers);
  // Only the active server's lists, so other servers' updates don't re-render.
  const members = useAppStore((s) =>
    pickByServer(s.membersByServer, s.activeServerId, EMPTY_MEMBERS),
  );
  const roles = useAppStore((s) => pickByServer(s.rolesByServer, s.activeServerId, EMPTY_ROLES));
  const presenceByUser = useAppStore((s) => s.presenceByUser);
  const myStatus = useAppStore((s) => s.myStatus);
  const user = useAppStore((s) => s.user);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const { openForMember, menuPortal } = useMemberContextMenu(voice);
  const [open, setOpen] = useState(readMembersOpen);

  useEffect(() => {
    try {
      localStorage.setItem(MEMBERS_OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  const server = servers.find((s) => sameId(s.id, activeServerId));
  function isServerOwner(member: Member): boolean {
    return Boolean(server && sameId(server.owner_id, member.user.id));
  }

  // Role colour per member, computed once per members/roles change instead of
  // filtering and sorting the roles for every row on every render.
  const colorByUser = useMemo(() => {
    const out = new Map<string, string | undefined>();
    for (const m of members) out.set(m.user.id, highestRoleColor(m, roles));
    return out;
  }, [members, roles]);

  // Fixed-identity handlers so memoized rows skip re-rendering.
  const rowHandlers = useStableHandlers({
    open: (e: MouseEvent, member: Member) =>
      openMiniProfile({
        userId: member.user.id,
        serverId: activeServerId,
        x: e.clientX,
        y: e.clientY,
      }),
    context: (e: MouseEvent, member: Member) => openForMember(e, member),
  });

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

  function statusFor(member: Member): PresenceStatus {
    if (member.user.id === user?.id) return myStatus;
    return presenceByUser[member.user.id] || "offline";
  }

  if (!open) {
    return (
      <aside
        className="member-list-panel is-collapsed"
        aria-label="Server members"
      >
        <button
          type="button"
          className="member-list-toggle"
          title="Show members"
          aria-label="Show members"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <span className="member-list-toggle-icon" aria-hidden>
            ‹
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="member-list-panel" aria-label="Server members">
      <header className="member-list-toolbar">
        <span className="member-list-toolbar-label">Members</span>
        <button
          type="button"
          className="member-list-toggle"
          title="Hide members"
          aria-label="Hide members"
          aria-expanded={true}
          onClick={() => setOpen(false)}
        >
          <span className="member-list-toggle-icon" aria-hidden>
            ›
          </span>
        </button>
      </header>
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
                  color={colorByUser.get(m.user.id)}
                  isOwner={isServerOwner(m)}
                  onOpen={rowHandlers.open}
                  onContext={rowHandlers.context}
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
                  color={colorByUser.get(m.user.id)}
                  isOwner={isServerOwner(m)}
                  onOpen={rowHandlers.open}
                  onContext={rowHandlers.context}
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
