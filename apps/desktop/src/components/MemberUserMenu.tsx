import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/appStore";
import {
  effectiveServerPerms,
  hasPerm,
  Perm,
} from "../lib/serverPerms";
import {
  getUserVoicePref,
  setUserVoicePref,
  type UserVoicePref,
} from "../lib/userVoicePrefs";
import type { Member } from "../types";

export type MemberVoiceHandlers = {
  applyUserMic?: (userId: string, pref: UserVoicePref) => void;
  applyUserVideoHide?: (userId: string, hide: boolean) => void;
};

type MenuState = {
  x: number;
  y: number;
  userId: string;
  label: string;
  username: string;
  pref: UserVoicePref;
} | null;

function displayName(m: Member): string {
  return m.nickname || m.user.display_name || m.user.username;
}

export function useMemberContextMenu(voice?: MemberVoiceHandlers) {
  const activeServerId = useAppStore((s) => s.activeServerId);
  const servers = useAppStore((s) => s.servers);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const voiceStates = useAppStore((s) => s.voiceStates);
  const user = useAppStore((s) => s.user);
  const kickMember = useAppStore((s) => s.kickMember);
  const banMember = useAppStore((s) => s.banMember);
  const moderateMemberVoice = useAppStore((s) => s.moderateMemberVoice);
  const blockUser = useAppStore((s) => s.blockUser);

  const [menu, setMenu] = useState<MenuState>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const members = activeServerId
    ? membersByServer[activeServerId] || []
    : [];
  const roles = activeServerId ? rolesByServer[activeServerId] || [] : [];
  const server = servers.find((s) => s.id === activeServerId);
  const me = members.find((m) => m.user.id === user?.id);
  const myPerms = useMemo(
    () => effectiveServerPerms(server, roles, me, user?.id),
    [server, roles, me, user?.id],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onDown = (e: globalThis.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [menu, closeMenu]);

  // Keep the panel inside the window (member list is on the right edge).
  useLayoutEffect(() => {
    if (!menu) return;
    const el = panelRef.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
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
  }, [menu]);

  const openForMember = useCallback(
    (e: MouseEvent, member: Member) => {
      e.preventDefault();
      e.stopPropagation();
      if (member.user.id === user?.id) return;
      setMenu({
        x: e.clientX,
        y: e.clientY,
        userId: member.user.id,
        label: displayName(member),
        username: member.user.username,
        pref: getUserVoicePref(member.user.id),
      });
    },
    [user?.id],
  );

  const openForUserId = useCallback(
    (e: MouseEvent, userId: string, label: string, username?: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (userId === user?.id) return;
      const member = members.find((m) => m.user.id === userId);
      setMenu({
        x: e.clientX,
        y: e.clientY,
        userId,
        label: member ? displayName(member) : label,
        username: member?.user.username || username || "",
        pref: getUserVoicePref(userId),
      });
    },
    [user?.id, members],
  );

  function patchPref(patch: Partial<UserVoicePref>) {
    if (!menu) return;
    const next = setUserVoicePref(menu.userId, patch);
    setMenu({ ...menu, pref: next });
    voice?.applyUserMic?.(menu.userId, next);
    if (patch.hideVideo !== undefined) {
      voice?.applyUserVideoHide?.(menu.userId, next.hideVideo);
    }
  }

  const targetVoice = menu
    ? voiceStates.find((v) => v.user_id === menu.userId)
    : undefined;

  const menuPortal: ReactNode =
    menu &&
    activeServerId &&
    createPortal(
      <div
        ref={panelRef}
        className="member-ctx-panel"
        style={{ left: menu.x, top: menu.y }}
        role="menu"
      >
        <div className="member-ctx-head">
          <strong>{menu.label}</strong>
          {menu.username ? (
            <span className="muted">@{menu.username}</span>
          ) : null}
        </div>
        <label className="member-ctx-volume">
          <span>User volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(menu.pref.volume * 100)}
            onChange={(e) =>
              patchPref({ volume: Number(e.target.value) / 100 })
            }
          />
        </label>
        <button
          type="button"
          className="ctx-menu-item"
          onClick={() => patchPref({ muted: !menu.pref.muted })}
        >
          {menu.pref.muted ? "Unmute for me" : "Mute for me"}
        </button>
        <button
          type="button"
          className="ctx-menu-item"
          onClick={() => patchPref({ hideVideo: !menu.pref.hideVideo })}
        >
          {menu.pref.hideVideo
            ? "Show their video / screen"
            : "Hide their video / screen"}
        </button>
        <button
          type="button"
          className="ctx-menu-item danger"
          onClick={() => {
            void blockUser(menu.userId);
            closeMenu();
          }}
        >
          Block
        </button>
        {hasPerm(myPerms, Perm.MUTE_MEMBERS) && (
          <>
            <div className="member-ctx-sep" />
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                void moderateMemberVoice(activeServerId, menu.userId, {
                  server_muted: !targetVoice?.server_muted,
                });
                closeMenu();
              }}
            >
              {targetVoice?.server_muted ? "Server unmute" : "Server mute"}
            </button>
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => {
                void moderateMemberVoice(activeServerId, menu.userId, {
                  server_deafened: !targetVoice?.server_deafened,
                });
                closeMenu();
              }}
            >
              {targetVoice?.server_deafened
                ? "Server undeafen"
                : "Server deafen"}
            </button>
          </>
        )}
        {(hasPerm(myPerms, Perm.KICK_MEMBERS) ||
          hasPerm(myPerms, Perm.BAN_MEMBERS)) && (
          <div className="member-ctx-sep" />
        )}
        {hasPerm(myPerms, Perm.KICK_MEMBERS) && (
          <button
            type="button"
            className="ctx-menu-item danger"
            onClick={() => {
              void kickMember(activeServerId, menu.userId);
              closeMenu();
            }}
          >
            Kick
          </button>
        )}
        {hasPerm(myPerms, Perm.BAN_MEMBERS) && (
          <button
            type="button"
            className="ctx-menu-item danger"
            onClick={() => {
              void banMember(activeServerId, menu.userId);
              closeMenu();
            }}
          >
            Ban
          </button>
        )}
      </div>,
      document.body,
    );

  return { openForMember, openForUserId, menuPortal };
}
