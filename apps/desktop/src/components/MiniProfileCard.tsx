import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { mediaCssUrl, mediaUrl } from "../lib/mediaUrl";
import {
  assignableRoles,
  canManageTargetMemberRoles,
  canRemoveRoleFromMember,
  effectiveServerPerms,
  isEveryoneRole,
} from "../lib/serverPerms";
import { useAppStore } from "../store/appStore";
import type { PresenceStatus, Role, UserPublic } from "../types";

function resolveUser(
  userId: string,
  me: UserPublic | null,
  authors: Record<string, UserPublic>,
  members: { user: UserPublic }[],
  friends: { peer: UserPublic }[],
  dmChannels: { peer: UserPublic }[],
): UserPublic | null {
  if (me?.id === userId) return me;
  const fromMembers = members.find((m) => m.user.id === userId)?.user;
  if (fromMembers) return fromMembers;
  if (authors[userId]) return authors[userId];
  const friend = friends.find((f) => f.peer.id === userId)?.peer;
  if (friend) return friend;
  return dmChannels.find((d) => d.peer.id === userId)?.peer || null;
}

function memberRoles(roleIds: string[], roles: Role[]): Role[] {
  return roles
    .filter((r) => !r.is_everyone && roleIds.includes(r.id))
    .sort((a, b) => b.position - a.position);
}

function editableRoleIds(roleIds: string[], roles: Role[]): string[] {
  return roleIds.filter((id) => {
    const role = roles.find((r) => r.id === id);
    return role && !isEveryoneRole(role);
  });
}

export function MiniProfileCard() {
  const miniProfile = useAppStore((s) => s.miniProfile);
  const closeMiniProfile = useAppStore((s) => s.closeMiniProfile);
  const setModal = useAppStore((s) => s.setModal);
  const setMemberRoles = useAppStore((s) => s.setMemberRoles);
  const me = useAppStore((s) => s.user);
  const authors = useAppStore((s) => s.authors);
  const servers = useAppStore((s) => s.servers);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const friends = useAppStore((s) => s.friends);
  const dmChannels = useAppStore((s) => s.dmChannels);
  const presenceByUser = useAppStore((s) => s.presenceByUser);
  const myStatus = useAppStore((s) => s.myStatus);
  const openDmWithPeer = useAppStore((s) => s.openDmWithPeer);

  const panelRef = useRef<HTMLDivElement>(null);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  const members = miniProfile?.serverId
    ? membersByServer[miniProfile.serverId] || []
    : [];
  const roles = miniProfile?.serverId
    ? rolesByServer[miniProfile.serverId] || []
    : [];
  const server = miniProfile?.serverId
    ? servers.find((s) => s.id === miniProfile.serverId)
    : undefined;
  const member = miniProfile
    ? members.find((m) => m.user.id === miniProfile.userId)
    : undefined;
  const meMember = members.find((m) => m.user.id === me?.id);

  const profile = useMemo(() => {
    if (!miniProfile) return null;
    return resolveUser(
      miniProfile.userId,
      me,
      authors,
      members,
      friends,
      dmChannels,
    );
  }, [miniProfile, me, authors, members, friends, dmChannels]);

  const myPerms = useMemo(
    () => effectiveServerPerms(server, roles, meMember, me?.id),
    [server, roles, meMember, me?.id],
  );

  const canEditRoles = useMemo(
    () =>
      canManageTargetMemberRoles(
        meMember,
        member,
        roles,
        server,
        me?.id,
        myPerms,
      ),
    [meMember, member, roles, server, me?.id, myPerms],
  );

  const shownRoles = useMemo(() => {
    if (!miniProfile?.serverId || !member) return [];
    return memberRoles(member.role_ids, roles);
  }, [miniProfile?.serverId, member, roles]);

  const addableRoles = useMemo(
    () =>
      assignableRoles(meMember, member, roles, server, me?.id, myPerms),
    [meMember, member, roles, server, me?.id, myPerms],
  );

  useEffect(() => {
    setRoleMenuOpen(false);
    setRoleError(null);
  }, [miniProfile?.userId, miniProfile?.serverId]);

  useEffect(() => {
    if (!miniProfile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMiniProfile();
    };
    const onDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        closeMiniProfile();
        return;
      }
      if (
        roleMenuOpen &&
        roleMenuRef.current &&
        !roleMenuRef.current.contains(target)
      ) {
        setRoleMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [miniProfile, closeMiniProfile, roleMenuOpen]);

  useLayoutEffect(() => {
    if (!miniProfile) return;
    const el = panelRef.current;
    if (!el) return;
    const pad = 10;
    const rect = el.getBoundingClientRect();
    let left = miniProfile.x;
    let top = miniProfile.y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [miniProfile, profile, shownRoles.length, roleMenuOpen, roleError]);

  if (!miniProfile || !profile) return null;

  const isSelf = me?.id === profile.id;
  const status: PresenceStatus = isSelf
    ? myStatus
    : presenceByUser[profile.id] || "offline";
  const display =
    member?.nickname || profile.display_name || profile.username;
  const initial = display.charAt(0).toUpperCase() || "?";
  const banner = profile.banner_url || null;
  const avatar = profile.avatar_url || null;

  async function updateRoles(nextRoleIds: string[]) {
    if (!miniProfile?.serverId || !member || roleBusy) return;
    setRoleBusy(true);
    setRoleError(null);
    try {
      await setMemberRoles(
        miniProfile.serverId,
        member.user.id,
        editableRoleIds(nextRoleIds, roles),
      );
      setRoleMenuOpen(false);
    } catch (e) {
      setRoleError(
        e instanceof Error ? e.message : "Could not update roles",
      );
    } finally {
      setRoleBusy(false);
    }
  }

  async function addRole(roleId: string) {
    if (!member) return;
    await updateRoles([...member.role_ids, roleId]);
  }

  async function removeRole(roleId: string) {
    if (!member) return;
    await updateRoles(member.role_ids.filter((id) => id !== roleId));
  }

  async function messageUser() {
    closeMiniProfile();
    try {
      await openDmWithPeer(profile!.id);
    } catch {
      /* ignore — friendship may be required */
    }
  }

  function editProfile() {
    closeMiniProfile();
    setModal("user-settings");
  }

  const card = (
    <div
      ref={panelRef}
      className="mini-profile"
      style={{ left: miniProfile.x, top: miniProfile.y }}
      role="dialog"
      aria-label={`${display}'s profile`}
      onClick={(e: MouseEvent) => e.stopPropagation()}
    >
      <div
        className={`mini-profile-banner${banner ? "" : " is-empty"}`}
        style={banner ? { backgroundImage: mediaCssUrl(banner) } : undefined}
      />

      <div className="mini-profile-avatar-row">
        <div className="mini-profile-avatar-wrap">
          {avatar ? (
            <img
              className="mini-profile-avatar"
              src={mediaUrl(avatar)}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="mini-profile-avatar placeholder">{initial}</span>
          )}
          <span
            className={`mini-profile-status status-${status}`}
            title={status}
            aria-label={status}
          />
        </div>
      </div>

      <div className="mini-profile-body">
        <div className="mini-profile-identity">
          <strong className="mini-profile-display">{display}</strong>
          <span className="mini-profile-username">@{profile.username}</span>
        </div>

        {miniProfile.serverId && (
          <section className="mini-profile-section">
            <h4>Roles</h4>
            {shownRoles.length === 0 && !canEditRoles ? (
              <p className="muted tiny">No roles</p>
            ) : (
              <div className="mini-profile-roles">
                {shownRoles.map((r) => {
                  const removable = canRemoveRoleFromMember(
                    r,
                    meMember,
                    member,
                    roles,
                    server,
                    me?.id,
                    myPerms,
                  );
                  return (
                    <span key={r.id} className="mini-profile-role">
                      <span
                        className="mini-profile-role-dot"
                        style={{ background: r.color || "#99a2ab" }}
                      />
                      {r.name}
                      {removable && (
                        <button
                          type="button"
                          className="mini-profile-role-remove"
                          title={`Remove ${r.name}`}
                          aria-label={`Remove ${r.name}`}
                          disabled={roleBusy}
                          onClick={() => void removeRole(r.id)}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  );
                })}
                {canEditRoles && (
                  <div className="mini-profile-role-add" ref={roleMenuRef}>
                    <button
                      type="button"
                      className="mini-profile-role mini-profile-role-add-btn"
                      disabled={roleBusy || addableRoles.length === 0}
                      aria-expanded={roleMenuOpen}
                      aria-haspopup="listbox"
                      onClick={() => setRoleMenuOpen((open) => !open)}
                    >
                      + Add role
                    </button>
                    {roleMenuOpen && addableRoles.length > 0 && (
                      <div
                        className="mini-profile-role-menu"
                        role="listbox"
                        aria-label="Add role"
                      >
                        {addableRoles.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            role="option"
                            className="mini-profile-role-option"
                            disabled={roleBusy}
                            onClick={() => void addRole(r.id)}
                          >
                            <span
                              className="mini-profile-role-dot"
                              style={{ background: r.color || "#99a2ab" }}
                            />
                            {r.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {roleError && (
              <p className="form-error tiny mini-profile-role-error">{roleError}</p>
            )}
          </section>
        )}

        <div className="mini-profile-actions">
          {isSelf ? (
            <button
              type="button"
              className="btn primary mini-profile-edit"
              onClick={editProfile}
            >
              Edit Profile
            </button>
          ) : (
            <button
              type="button"
              className="btn primary mini-profile-edit"
              onClick={() => void messageUser()}
            >
              Message
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(card, document.body);
}
