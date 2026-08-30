import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../store/appStore";
import {
  effectiveServerPerms,
  hasPerm,
  Perm,
  sameId,
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

type TimeoutDraft = {
  userId: string;
  label: string;
};

const TIMEOUT_PRESETS: { label: string; seconds: number }[] = [
  { label: "60 secs", seconds: 60 },
  { label: "5 mins", seconds: 5 * 60 },
  { label: "10 mins", seconds: 10 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "1 week", seconds: 7 * 24 * 60 * 60 },
];

function displayName(m: Member): string {
  return m.nickname || m.user.display_name || m.user.username;
}

function isTimedOut(member: Member | undefined): boolean {
  if (!member?.timeout_until) return false;
  const t = Date.parse(member.timeout_until);
  return Number.isFinite(t) && t > Date.now();
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
  const timeoutMember = useAppStore((s) => s.timeoutMember);
  const moderateMemberVoice = useAppStore((s) => s.moderateMemberVoice);
  const transferOwnership = useAppStore((s) => s.transferOwnership);
  const blockUser = useAppStore((s) => s.blockUser);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const openDmWithPeer = useAppStore((s) => s.openDmWithPeer);
  const startDmCallWithPeer = useAppStore((s) => s.startDmCallWithPeer);
  const mentionMemberInChat = useAppStore((s) => s.mentionMemberInChat);

  const [menu, setMenu] = useState<MenuState>(null);
  const [timeoutDraft, setTimeoutDraft] = useState<TimeoutDraft | null>(null);
  const [transferDraft, setTransferDraft] = useState<TimeoutDraft | null>(
    null,
  );
  const [durationKey, setDurationKey] = useState<string>("60");
  const [customDays, setCustomDays] = useState("1");
  const [reason, setReason] = useState("");
  const [timeoutBusy, setTimeoutBusy] = useState(false);
  const [timeoutErr, setTimeoutErr] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferErr, setTransferErr] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const members = activeServerId
    ? membersByServer[activeServerId] || []
    : [];
  const roles = activeServerId ? rolesByServer[activeServerId] || [] : [];
  const server = servers.find((s) => sameId(s.id, activeServerId));
  const me = members.find((m) => sameId(m.user.id, user?.id));
  const myPerms = useMemo(
    () => effectiveServerPerms(server, roles, me, user?.id),
    [server, roles, me, user?.id],
  );
  const iAmOwner = Boolean(server && sameId(server.owner_id, user?.id));

  const canTimeout =
    hasPerm(myPerms, Perm.MUTE_MEMBERS) || hasPerm(myPerms, Perm.KICK_MEMBERS);

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
      if (sameId(member.user.id, user?.id)) return;
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
      if (sameId(userId, user?.id)) return;
      const member = members.find((m) => sameId(m.user.id, userId));
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

  function openTimeoutModal(userId: string, label: string) {
    setTimeoutDraft({ userId, label });
    setDurationKey("60");
    setCustomDays("1");
    setReason("");
    setTimeoutErr(null);
    setTimeoutBusy(false);
    closeMenu();
  }

  function resolveDurationSeconds(): number | null {
    if (durationKey === "custom") {
      const days = Math.floor(Number(customDays));
      if (!Number.isFinite(days) || days < 1 || days > 365) return null;
      return days * 24 * 60 * 60;
    }
    const n = Number(durationKey);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function submitTimeout(e: FormEvent) {
    e.preventDefault();
    if (!timeoutDraft || !activeServerId) return;
    const secs = resolveDurationSeconds();
    if (secs == null) {
      setTimeoutErr("Enter a valid custom duration (1–365 days).");
      return;
    }
    setTimeoutBusy(true);
    setTimeoutErr(null);
    try {
      await timeoutMember(activeServerId, timeoutDraft.userId, {
        duration_seconds: secs,
        reason: reason.trim() || undefined,
      });
      setTimeoutDraft(null);
    } catch (err) {
      setTimeoutErr(err instanceof Error ? err.message : "Timeout failed");
    } finally {
      setTimeoutBusy(false);
    }
  }

  async function clearTimeoutFor(userId: string) {
    if (!activeServerId) return;
    try {
      await timeoutMember(activeServerId, userId, { clear: true });
    } catch {
      /* ignore */
    }
    closeMenu();
  }

  function openTransferModal(userId: string, label: string) {
    setTransferDraft({ userId, label });
    setTransferErr(null);
    setTransferBusy(false);
    closeMenu();
  }

  async function confirmTransfer() {
    if (!transferDraft || !activeServerId) return;
    setTransferBusy(true);
    setTransferErr(null);
    try {
      await transferOwnership(activeServerId, transferDraft.userId);
      setTransferDraft(null);
    } catch (err) {
      setTransferErr(
        err instanceof Error ? err.message : "Transfer failed",
      );
    } finally {
      setTransferBusy(false);
    }
  }

  const targetVoice = menu
    ? voiceStates.find((v) => sameId(v.user_id, menu.userId))
    : undefined;
  const targetMember = menu
    ? members.find((m) => sameId(m.user.id, menu.userId))
    : undefined;
  const targetTimedOut = isTimedOut(targetMember);

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
        <button
          type="button"
          className="ctx-menu-item"
          onClick={() => {
            openMiniProfile({
              userId: menu.userId,
              serverId: activeServerId,
              x: menu.x,
              y: menu.y,
            });
            closeMenu();
          }}
        >
          Profile
        </button>
        <button
          type="button"
          className="ctx-menu-item"
          disabled={!menu.username}
          onClick={() => {
            if (!menu.username) return;
            mentionMemberInChat(menu.username);
            closeMenu();
          }}
        >
          Mention
        </button>
        <button
          type="button"
          className="ctx-menu-item"
          onClick={() => {
            void openDmWithPeer(menu.userId);
            closeMenu();
          }}
        >
          Message
        </button>
        <button
          type="button"
          className="ctx-menu-item"
          onClick={() => {
            void startDmCallWithPeer(menu.userId);
            closeMenu();
          }}
        >
          Start call
        </button>
        <div className="member-ctx-sep" />
        <label className="member-ctx-volume">
          <span>User volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(menu.pref.volume * 100)}
            style={
              {
                "--range-fill": `${Math.round(menu.pref.volume * 100)}%`,
              } as CSSProperties
            }
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
              className="ctx-menu-item danger"
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
              className="ctx-menu-item danger"
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
        {canTimeout && (
          <>
            <div className="member-ctx-sep" />
            {targetTimedOut ? (
              <button
                type="button"
                className="ctx-menu-item"
                onClick={() => void clearTimeoutFor(menu.userId)}
              >
                Remove timeout
              </button>
            ) : (
              <button
                type="button"
                className="ctx-menu-item danger"
                onClick={() => openTimeoutModal(menu.userId, menu.label)}
              >
                Timeout
              </button>
            )}
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
        {iAmOwner && (
          <>
            <div className="member-ctx-sep" />
            <button
              type="button"
              className="ctx-menu-item"
              onClick={() => openTransferModal(menu.userId, menu.label)}
            >
              Transfer ownership
            </button>
          </>
        )}
      </div>,
      document.body,
    );

  const timeoutPortal: ReactNode =
    timeoutDraft &&
    createPortal(
      <div
        className="modal-backdrop"
        onClick={() => !timeoutBusy && setTimeoutDraft(null)}
      >
        <div
          className="modal timeout-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`Timeout ${timeoutDraft.label}`}
        >
          <header className="modal-header">
            <h3>Timeout {timeoutDraft.label}</h3>
            <button
              type="button"
              className="icon-btn"
              disabled={timeoutBusy}
              onClick={() => setTimeoutDraft(null)}
            >
              ✕
            </button>
          </header>
          <p className="muted tiny timeout-modal-desc">
            Members who are in timeout are temporarily not allowed to chat or
            react in text channels. They are also not allowed to connect to
            voice channels.
          </p>
          <form className="stack" onSubmit={(e) => void submitTimeout(e)}>
            <div className="timeout-duration">
              <span className="settings-nav-label">Duration</span>
              <div className="timeout-pills">
                {TIMEOUT_PRESETS.map((p) => (
                  <button
                    key={p.seconds}
                    type="button"
                    className={`timeout-pill${durationKey === String(p.seconds) ? " on" : ""}`}
                    onClick={() => setDurationKey(String(p.seconds))}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`timeout-pill${durationKey === "custom" ? " on" : ""}`}
                  onClick={() => setDurationKey("custom")}
                >
                  Custom days
                </button>
              </div>
              {durationKey === "custom" && (
                <label className="timeout-custom-days">
                  Days
                  <input
                    type="number"
                    min={1}
                    max={365}
                    step={1}
                    value={customDays}
                    onChange={(e) => setCustomDays(e.target.value)}
                    required
                  />
                </label>
              )}
            </div>
            <label>
              Reason
              <textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter a reason (optional — not shown to the member)."
                maxLength={500}
              />
            </label>
            {timeoutErr && <p className="form-error">{timeoutErr}</p>}
            <div className="row">
              <button
                type="button"
                className="btn ghost"
                disabled={timeoutBusy}
                onClick={() => setTimeoutDraft(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={timeoutBusy}
              >
                {timeoutBusy ? "Timing out…" : "Timeout"}
              </button>
            </div>
          </form>
        </div>
      </div>,
      document.body,
    );

  const transferPortal: ReactNode =
    transferDraft &&
    createPortal(
      <div
        className="modal-backdrop"
        onClick={() => !transferBusy && setTransferDraft(null)}
      >
        <div
          className="modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Transfer server ownership"
        >
          <header className="modal-header">
            <h2>Transfer ownership</h2>
            <button
              type="button"
              className="icon-btn"
              disabled={transferBusy}
              onClick={() => setTransferDraft(null)}
              aria-label="Close"
            >
              ×
            </button>
          </header>
          <div className="modal-body">
            <p>
              Make <strong>{transferDraft.label}</strong> the owner of this
              server? You will lose owner privileges immediately.
            </p>
            {transferErr && <p className="form-error">{transferErr}</p>}
            <div className="row">
              <button
                type="button"
                className="btn ghost"
                disabled={transferBusy}
                onClick={() => setTransferDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={transferBusy}
                onClick={() => void confirmTransfer()}
              >
                {transferBusy ? "Transferring…" : "Transfer ownership"}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );

  return {
    openForMember,
    openForUserId,
    menuPortal: (
      <>
        {menuPortal}
        {timeoutPortal}
        {transferPortal}
      </>
    ),
  };
}
