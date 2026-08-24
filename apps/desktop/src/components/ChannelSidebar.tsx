import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  channelIsMuted,
  formatMuteRemaining,
  MUTE_DURATIONS,
} from "../lib/channelMutePrefs";
import { mediaCssUrl } from "../lib/mediaUrl";
import {
  effectiveServerPerms,
  hasPerm,
  isChannelLocked,
  Perm,
} from "../lib/serverPerms";
import { useAppStore } from "../store/appStore";
import type { Channel } from "../types";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  useMemberContextMenu,
  type MemberVoiceHandlers,
} from "./MemberUserMenu";

type Props = {
  onJoinVoice: (channelId: string) => void;
  speakingIds?: string[];
  voiceHandlers?: MemberVoiceHandlers;
};

type ChannelMenuState = {
  x: number;
  y: number;
  channel: Channel;
} | null;

type CreateDraft = {
  mode: "channel" | "category";
  categoryId: string | null;
};

type DragPayload = {
  kind: "category" | "channel";
  id: string;
};

type DropHint =
  | { zone: "category-before"; categoryId: string }
  | { zone: "category-end" }
  | { zone: "category-into"; categoryId: string }
  | { zone: "channel-before"; channelId: string; categoryId: string | null }
  | { zone: "uncategorized-into" };

const DND_MIME = "application/x-speakapp-channel";

function readPayload(e: DragEvent): DragPayload | null {
  try {
    const raw =
      e.dataTransfer.getData(DND_MIME) ||
      e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed?.kind !== "category" && parsed?.kind !== "channel") return null;
    if (typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function moveCategory(
  all: Channel[],
  draggedId: string,
  beforeCategoryId: string | null,
): Channel[] {
  const cats = all
    .filter((c) => c.channel_type === "category")
    .slice()
    .sort((a, b) => a.position - b.position);
  const moving = cats.find((c) => c.id === draggedId);
  if (!moving) return all;
  const without = cats.filter((c) => c.id !== draggedId);
  let idx = beforeCategoryId
    ? without.findIndex((c) => c.id === beforeCategoryId)
    : without.length;
  if (idx < 0) idx = without.length;
  without.splice(idx, 0, moving);
  const byId = new Map(
    without.map((c, i) => [c.id, { ...c, position: i }] as const),
  );
  return all.map((c) => byId.get(c.id) || c);
}

function moveChannel(
  all: Channel[],
  draggedId: string,
  categoryId: string | null,
  beforeChannelId: string | null,
): Channel[] {
  const moving = all.find(
    (c) => c.id === draggedId && c.channel_type !== "category",
  );
  if (!moving) return all;
  const siblings = all
    .filter(
      (c) =>
        c.channel_type !== "category" &&
        c.category_id === categoryId &&
        c.id !== draggedId,
    )
    .slice()
    .sort((a, b) => a.position - b.position);
  let idx = beforeChannelId
    ? siblings.findIndex((c) => c.id === beforeChannelId)
    : siblings.length;
  if (idx < 0) idx = siblings.length;
  const nextSiblings = [...siblings];
  nextSiblings.splice(idx, 0, { ...moving, category_id: categoryId });
  const byId = new Map(
    nextSiblings.map(
      (c, i) =>
        [c.id, { ...c, category_id: categoryId, position: i }] as const,
    ),
  );
  return all.map((c) => byId.get(c.id) || c);
}

export function ChannelSidebar({
  onJoinVoice,
  speakingIds = [],
  voiceHandlers,
}: Props) {
  const activeServerId = useAppStore((s) => s.activeServerId);
  const servers = useAppStore((s) => s.servers);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const voiceStates = useAppStore((s) => s.voiceStates);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const authors = useAppStore((s) => s.authors);
  const user = useAppStore((s) => s.user);
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const setModal = useAppStore((s) => s.setModal);
  const openInvitePeople = useAppStore((s) => s.openInvitePeople);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const createChannel = useAppStore((s) => s.createChannel);
  const applyChannelOrder = useAppStore((s) => s.applyChannelOrder);
  const channelMutes = useAppStore((s) => s.channelMutes);
  const unreadByChannel = useAppStore((s) => s.unreadByChannel);
  const overwritesByChannel = useAppStore((s) => s.overwritesByChannel);
  const muteChannel = useAppStore((s) => s.muteChannel);
  const unmuteChannel = useAppStore((s) => s.unmuteChannel);
  const pruneChannelMutes = useAppStore((s) => s.pruneChannelMutes);
  const { openForUserId, menuPortal } = useMemberContextMenu(voiceHandlers);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [channelType, setChannelType] = useState<"text" | "voice">("text");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelMenu, setChannelMenu] = useState<ChannelMenuState>(null);
  const creatingRef = useRef(false);

  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const dragPayloadRef = useRef<DragPayload | null>(null);
  const suppressClickRef = useRef(false);
  const reorderBusyRef = useRef(false);

  const server = servers.find((s) => s.id === activeServerId);
  const members = activeServerId
    ? membersByServer[activeServerId] || []
    : [];
  const roles = activeServerId ? rolesByServer[activeServerId] || [] : [];
  const me = members.find((m) => m.user.id === user?.id);
  const myPerms = useMemo(
    () => effectiveServerPerms(server, roles, me, user?.id),
    [server, roles, me, user?.id],
  );
  const canManageChannels = hasPerm(myPerms, Perm.MANAGE_CHANNELS);
  const canInvitePeople = hasPerm(myPerms, Perm.CREATE_INVITE);
  const canOpenServerSettings =
    hasPerm(myPerms, Perm.MANAGE_SERVER) ||
    hasPerm(myPerms, Perm.MANAGE_ROLES) ||
    hasPerm(myPerms, Perm.MANAGE_EXPRESSIONS) ||
    canInvitePeople;
  const channels = useMemo(
    () =>
      (activeServerId ? channelsByServer[activeServerId] || [] : [])
        .slice()
        .sort((a, b) => a.position - b.position),
    [activeServerId, channelsByServer],
  );

  const categories = channels.filter((c) => c.channel_type === "category");
  const uncategorized = channels.filter(
    (c) => c.channel_type !== "category" && !c.category_id,
  );

  useEffect(() => {
    setCollapsed({});
    setDraft(null);
    setDragging(null);
    setDropHint(null);
    setChannelMenu(null);
  }, [activeServerId]);

  useEffect(() => {
    pruneChannelMutes();
    const t = window.setInterval(() => pruneChannelMutes(), 30_000);
    return () => window.clearInterval(t);
  }, [pruneChannelMutes]);

  function channelsIn(cat: Channel) {
    return channels.filter(
      (c) => c.channel_type !== "category" && c.category_id === cat.id,
    );
  }

  function voiceUsers(channelId: string) {
    return voiceStates
      .filter((v) => v.channel_id === channelId)
      .map((v) => {
        const member = (activeServerId
          ? membersByServer[activeServerId] || []
          : []
        ).find((m) => m.user.id === v.user_id);
        return {
          ...v,
          name:
            member?.nickname ||
            member?.user.display_name ||
            authors[v.user_id]?.display_name ||
            v.user_id.slice(0, 8),
        };
      });
  }

  function openCreateChannel(categoryId: string | null) {
    if (!canManageChannels) return;
    setDraft({ mode: "channel", categoryId });
    setChannelType("text");
    setName("");
    setError(null);
  }

  function openCreateCategory() {
    if (!canManageChannels) return;
    setDraft({ mode: "category", categoryId: null });
    setName("");
    setError(null);
  }

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!canManageChannels) return;
    if (!activeServerId || !draft || !name.trim() || creatingRef.current) return;
    creatingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (draft.mode === "category") {
        await createChannel(activeServerId, {
          name: name.trim(),
          channel_type: "category",
        });
      } else {
        const ch = await createChannel(activeServerId, {
          name: name.trim(),
          channel_type: channelType,
          category_id: draft.categoryId,
        });
        if (ch.channel_type === "text") await selectChannel(ch.id);
      }
      setDraft(null);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  }

  function openSettings(e: MouseEvent, channelId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!canManageChannels) return;
    setModal("channel-settings", channelId);
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function onDragStart(kind: DragPayload["kind"], id: string, e: DragEvent) {
    if (!canManageChannels) {
      e.preventDefault();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("button.category-add, button.channel-gear")) {
      e.preventDefault();
      return;
    }
    const payload: DragPayload = { kind, id };
    dragPayloadRef.current = payload;
    setDragging(payload);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
  }

  function onDragEnd() {
    if (dragging) suppressClickRef.current = true;
    dragPayloadRef.current = null;
    setDragging(null);
    setDropHint(null);
  }

  function currentPayload(e: DragEvent): DragPayload | null {
    return dragPayloadRef.current || readPayload(e);
  }

  function allowDrop(e: DragEvent, hint: DropHint) {
    const payload = currentPayload(e);
    if (!payload) return;
    if (payload.kind === "category") {
      if (hint.zone !== "category-before" && hint.zone !== "category-end") return;
      if (hint.zone === "category-before" && hint.categoryId === payload.id) return;
    } else {
      if (
        hint.zone === "category-before" ||
        hint.zone === "category-end"
      ) {
        return;
      }
      if (hint.zone === "channel-before" && hint.channelId === payload.id) return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropHint(hint);
  }

  async function commitDrop(e: DragEvent, hint: DropHint) {
    e.preventDefault();
    e.stopPropagation();
    const payload = currentPayload(e);
    setDropHint(null);
    setDragging(null);
    dragPayloadRef.current = null;
    if (!canManageChannels) return;
    if (!payload || !activeServerId || reorderBusyRef.current) return;

    let next = channels;
    if (payload.kind === "category") {
      if (hint.zone === "category-before") {
        next = moveCategory(channels, payload.id, hint.categoryId);
      } else if (hint.zone === "category-end") {
        next = moveCategory(channels, payload.id, null);
      } else {
        return;
      }
    } else if (payload.kind === "channel") {
      if (hint.zone === "category-into") {
        next = moveChannel(channels, payload.id, hint.categoryId, null);
        setCollapsed((prev) => ({ ...prev, [hint.categoryId]: false }));
      } else if (hint.zone === "channel-before") {
        next = moveChannel(
          channels,
          payload.id,
          hint.categoryId,
          hint.channelId,
        );
      } else if (hint.zone === "uncategorized-into") {
        next = moveChannel(channels, payload.id, null, null);
        setCollapsed((prev) => ({ ...prev, uncategorized: false }));
      } else {
        return;
      }
    } else {
      return;
    }

    const changed = next.some((c) => {
      const o = channels.find((x) => x.id === c.id);
      return (
        !o ||
        o.position !== c.position ||
        o.category_id !== c.category_id
      );
    });
    if (!changed) return;

    reorderBusyRef.current = true;
    try {
      await applyChannelOrder(activeServerId, next);
    } catch {
      // store rolls back
    } finally {
      reorderBusyRef.current = false;
    }
  }

  function guardClick(): boolean {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }

  if (!server) {
    return (
      <aside className="channel-sidebar empty">
        <p>Create or join a server to get started.</p>
      </aside>
    );
  }

  function renderChannel(ch: Channel) {
    const active = ch.id === activeChannelId;
    const inVoice = ch.id === voiceChannelId;
    const muted =
      ch.channel_type === "text" && channelIsMuted(channelMutes, ch.id);
    const unread =
      ch.channel_type === "text" && !muted
        ? unreadByChannel[ch.id] || 0
        : 0;
    const muteLabel =
      muted && ch.id in channelMutes
        ? formatMuteRemaining(channelMutes[ch.id])
        : null;
    const limitLabel =
      ch.channel_type === "voice" && ch.user_limit > 0
        ? ` · ${voiceUsers(ch.id).length}/${ch.user_limit}`
        : "";
    const isDragOver =
      dropHint?.zone === "channel-before" && dropHint.channelId === ch.id;
    const isDraggingSelf =
      dragging?.kind === "channel" && dragging.id === ch.id;
    const locked = isChannelLocked(
      overwritesByChannel[ch.id],
      roles,
      ch.channel_type,
    );

    const row = (
      <div
        className={`channel-row ${inVoice ? "connected" : ""} ${active ? "active" : ""} ${muted ? "muted-channel" : ""} ${unread ? "has-unread" : ""} ${isDragOver ? "drop-before" : ""} ${isDraggingSelf ? "is-dragging" : ""}`}
        draggable={canManageChannels}
        onDragStart={(e) => onDragStart("channel", ch.id, e)}
        onDragEnd={onDragEnd}
        onDragOver={(e) =>
          allowDrop(e, {
            zone: "channel-before",
            channelId: ch.id,
            categoryId: ch.category_id,
          })
        }
        onDrop={(e) =>
          void commitDrop(e, {
            zone: "channel-before",
            channelId: ch.id,
            categoryId: ch.category_id,
          })
        }
        onContextMenu={(e) => {
          if (ch.channel_type !== "text") return;
          e.preventDefault();
          e.stopPropagation();
          setChannelMenu({ x: e.clientX, y: e.clientY, channel: ch });
        }}
      >
        <button
          type="button"
          className={`channel-btn ${ch.channel_type === "voice" ? "voice" : ""} ${inVoice ? "connected" : ""} ${active ? "active" : ""}`}
          title={muteLabel || undefined}
          onClick={() => {
            if (guardClick()) return;
            if (ch.channel_type === "voice") onJoinVoice(ch.id);
            else void selectChannel(ch.id);
          }}
        >
          <span
            className={`ch-icon${locked ? " is-locked" : ""}`}
            aria-label={locked ? "Private channel" : undefined}
          >
            {ch.channel_type === "voice" ? "◎" : "#"}
            {locked ? (
              <svg
                className="ch-lock"
                viewBox="0 0 24 24"
                width="10"
                height="10"
                aria-hidden
              >
                <path
                  fill="currentColor"
                  d="M17 8h-1V6a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 1 1 4 0v2h-4V6zm7 13H7v-9h10v9z"
                />
              </svg>
            ) : null}
          </span>
          <span className="channel-name">
            {ch.name}
            {limitLabel}
          </span>
          {muted && (
            <span
              className="channel-mute-icon"
              title={muteLabel || "Muted"}
              aria-label="Muted"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                <path
                  fill="currentColor"
                  d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2.04 1.5H8.04L8 16.04V11c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v5.04l-.04.46zM4.27 3 3 4.27l6.01 6.01 1.41 1.41 8.49 8.49L20.18 19l-5.46-5.46L4.27 3z"
                />
              </svg>
            </span>
          )}
          {unread > 0 && (
            <span className="channel-unread" aria-label={`${unread} unread`}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        {canInvitePeople && (
          <button
            type="button"
            className="channel-invite"
            title="Invite people"
            onClick={(e) => {
              e.stopPropagation();
              openInvitePeople(ch.id);
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <path
                fill="currentColor"
                d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-3.33 0-8 1.67-8 5v1h16v-1c0-3.33-4.67-5-8-5z"
              />
              <path
                fill="currentColor"
                d="M19 8h-2v2h-2v2h2v2h2v-2h2v-2h-2z"
              />
            </svg>
          </button>
        )}
        {canManageChannels && (
          <button
            type="button"
            className="channel-gear"
            title="Edit channel"
            onClick={(e) => openSettings(e, ch.id)}
          >
            ⚙
          </button>
        )}
      </div>
    );

    if (ch.channel_type === "voice") {
      const users = voiceUsers(ch.id);
      return (
        <div key={ch.id} className="channel-block">
          {row}
          {users.length > 0 && (
            <ul className="voice-users">
              {users.map((u) => {
                const avatar =
                  (activeServerId
                    ? membersByServer[activeServerId] || []
                    : []
                  ).find((m) => m.user.id === u.user_id)?.user.avatar_url ||
                  authors[u.user_id]?.avatar_url ||
                  null;
                return (
                  <li
                    key={u.user_id}
                    className={`${u.streaming ? "live" : ""}${speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                    onClick={(e) =>
                      openMiniProfile({
                        userId: u.user_id,
                        serverId: activeServerId,
                        x: e.clientX,
                        y: e.clientY,
                      })
                    }
                    onContextMenu={(e) => openForUserId(e, u.user_id, u.name)}
                  >
                    <span
                      className={`voice-user-avatar${speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                      style={
                        avatar ? { backgroundImage: mediaCssUrl(avatar) } : undefined
                      }
                    >
                      {!avatar && (u.name.charAt(0) || "?").toUpperCase()}
                    </span>
                    <span className="voice-user-name">{u.name}</span>
                    <span className="voice-user-flags">
                      {u.streaming && (
                        <span className="vu-flag live" title="Screen sharing">
                          LIVE
                        </span>
                      )}
                      {u.muted && (
                        <span className="vu-flag mute" title="Muted">
                          <svg
                            viewBox="0 0 24 24"
                            width="12"
                            height="12"
                            aria-hidden
                            fill="currentColor"
                          >
                            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3 3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                          </svg>
                        </span>
                      )}
                      {u.deafened && (
                        <span className="vu-flag deaf" title="Deafened">
                          <svg
                            viewBox="0 0 24 24"
                            width="12"
                            height="12"
                            aria-hidden
                            fill="currentColor"
                          >
                            <path d="M12 3c-4.97 0-9 4.03-9 9v4c0 1.1.9 2 2 2h2v-8c0-2.76 2.24-5 5-5s5 2.24 5 5v8h2c1.1 0 2-.9 2-2v-4c0-4.97-4.03-9-9-9z" />
                          </svg>
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      );
    }

    return <div key={ch.id}>{row}</div>;
  }

  function renderCategoryHeader(
    key: string,
    label: string,
    categoryId: string | null,
    opts?: { showCreateCategory?: boolean },
  ) {
    const isCollapsed = !!collapsed[key];
    const isReal = !!categoryId;
    const beforeHint =
      isReal &&
      dropHint?.zone === "category-before" &&
      dropHint.categoryId === categoryId;
    const intoHint =
      (isReal &&
        dropHint?.zone === "category-into" &&
        dropHint.categoryId === categoryId) ||
      (!isReal && dropHint?.zone === "category-end");
    const uncatHint =
      !isReal && dropHint?.zone === "uncategorized-into";
    const isDraggingSelf =
      isReal && dragging?.kind === "category" && dragging.id === categoryId;

    return (
      <div
        className={`category-header ${beforeHint ? "drop-before" : ""} ${intoHint || uncatHint ? "drop-into" : ""} ${isDraggingSelf ? "is-dragging" : ""}`}
        draggable={isReal && canManageChannels}
        onDragStart={
          isReal && canManageChannels
            ? (e) => onDragStart("category", categoryId, e)
            : undefined
        }
        onDragEnd={isReal && canManageChannels ? onDragEnd : undefined}
        onDragOver={(e) => {
          if (isReal) {
            const payload = currentPayload(e);
            if (payload?.kind === "category") {
              allowDrop(e, { zone: "category-before", categoryId });
            } else if (payload?.kind === "channel") {
              allowDrop(e, { zone: "category-into", categoryId });
            }
          } else {
            const payload = currentPayload(e);
            if (payload?.kind === "channel") {
              allowDrop(e, { zone: "uncategorized-into" });
            } else if (payload?.kind === "category") {
              allowDrop(e, { zone: "category-end" });
            }
          }
        }}
        onDrop={(e) => {
          if (isReal) {
            const payload = currentPayload(e);
            if (payload?.kind === "category") {
              void commitDrop(e, { zone: "category-before", categoryId });
            } else if (payload?.kind === "channel") {
              void commitDrop(e, { zone: "category-into", categoryId });
            }
          } else {
            const payload = currentPayload(e);
            if (payload?.kind === "channel") {
              void commitDrop(e, { zone: "uncategorized-into" });
            } else if (payload?.kind === "category") {
              void commitDrop(e, { zone: "category-end" });
            }
          }
        }}
      >
        <button
          type="button"
          className="category-toggle"
          onClick={() => {
            if (guardClick()) return;
            toggleCollapse(key);
          }}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          <span className={`category-chevron${isCollapsed ? " closed" : ""}`}>
            ▾
          </span>
          <span className="category-label-text">{label}</span>
        </button>
        {canManageChannels && (
          <div className="category-actions">
            {opts?.showCreateCategory && (
              <button
                type="button"
                className="category-add"
                title="Create category"
                onClick={(e) => {
                  e.stopPropagation();
                  openCreateCategory();
                }}
              >
                ▤
              </button>
            )}
            <button
              type="button"
              className="category-add"
              title="Create channel"
              onClick={(e) => {
                e.stopPropagation();
                openCreateChannel(categoryId);
              }}
            >
              +
            </button>
            {categoryId && (
              <button
                type="button"
                className="category-add"
                title="Edit category"
                onClick={(e) => openSettings(e, categoryId)}
              >
                ⚙
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const categoryName =
    draft?.mode === "channel" && draft.categoryId
      ? categories.find((c) => c.id === draft.categoryId)?.name
      : null;

  const showUncategorized =
    uncategorized.length > 0 ||
    categories.length === 0 ||
    dragging?.kind === "channel" ||
    dragging?.kind === "category";

  return (
    <aside className="channel-sidebar">
      <header className="sidebar-header">
        <h2>{server.name}</h2>
        <div className="sidebar-header-actions">
          {canInvitePeople && (
            <button
              type="button"
              className="icon-btn"
              title="Invite people"
              onClick={() => openInvitePeople()}
            >
              ✉
            </button>
          )}
          {canManageChannels && (
            <>
              <button
                type="button"
                className="icon-btn"
                title="Create category"
                onClick={openCreateCategory}
              >
                ▤
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Create channel"
                onClick={() => openCreateChannel(null)}
              >
                +
              </button>
            </>
          )}
          {canOpenServerSettings && (
            <button
              type="button"
              className="icon-btn"
              title="Server settings"
              onClick={() => setModal("server-settings")}
            >
              ⚙
            </button>
          )}
        </div>
      </header>

      <div
        className={`channel-scroll${dragging ? " is-reordering" : ""}`}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropHint(null);
          }
        }}
      >
        {categories.map((cat) => {
          const key = cat.id;
          const kids = channelsIn(cat);
          const isCollapsed = !!collapsed[key];
          const intoBody =
            dropHint?.zone === "category-into" &&
            dropHint.categoryId === cat.id &&
            kids.length === 0;
          return (
            <div
              key={cat.id}
              className={`category${intoBody ? " drop-into" : ""}`}
              onDragOver={(e) => {
                if (currentPayload(e)?.kind === "channel") {
                  allowDrop(e, { zone: "category-into", categoryId: cat.id });
                }
              }}
              onDrop={(e) => {
                if (currentPayload(e)?.kind === "channel") {
                  void commitDrop(e, {
                    zone: "category-into",
                    categoryId: cat.id,
                  });
                }
              }}
            >
              {renderCategoryHeader(key, cat.name, cat.id)}
              {!isCollapsed && kids.map(renderChannel)}
            </div>
          );
        })}

        {showUncategorized && (
          <div
            className={`category${dropHint?.zone === "uncategorized-into" && uncategorized.length === 0 ? " drop-into" : ""}`}
            onDragOver={(e) => {
              if (currentPayload(e)?.kind === "channel") {
                allowDrop(e, { zone: "uncategorized-into" });
              }
            }}
            onDrop={(e) => {
              if (currentPayload(e)?.kind === "channel") {
                void commitDrop(e, { zone: "uncategorized-into" });
              }
            }}
          >
            {renderCategoryHeader("uncategorized", "Channels", null, {
              showCreateCategory: categories.length === 0,
            })}
            {!collapsed.uncategorized && uncategorized.map(renderChannel)}
          </div>
        )}
      </div>

      {draft && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <div
            className="modal create-channel-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h3>
                {draft.mode === "category" ? "Create Category" : "Create Channel"}
              </h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setDraft(null)}
              >
                ✕
              </button>
            </header>
            <form className="stack" onSubmit={(e) => void submitCreate(e)}>
              {draft.mode === "channel" && (
                <>
                  <p className="muted tiny">
                    {categoryName
                      ? `In category “${categoryName}”`
                      : "No category (top-level channel)"}
                  </p>
                  <div className="channel-type-picker">
                    <button
                      type="button"
                      className={channelType === "text" ? "active" : ""}
                      onClick={() => setChannelType("text")}
                    >
                      <span className="ch-icon">#</span>
                      <span>
                        <strong>Text</strong>
                        <em>Chat, links, images</em>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={channelType === "voice" ? "active" : ""}
                      onClick={() => setChannelType("voice")}
                    >
                      <span className="ch-icon">◎</span>
                      <span>
                        <strong>Voice</strong>
                        <em>Talk and screen share</em>
                      </span>
                    </button>
                  </div>
                </>
              )}
              <label>
                {draft.mode === "category" ? "Category name" : "Channel name"}
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    draft.mode === "category" ? "new-category" : "new-channel"
                  }
                  required
                  maxLength={64}
                />
              </label>
              {error && <p className="form-error">{error}</p>}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={busy || !name.trim()}
                >
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {menuPortal}
      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          onClose={() => setChannelMenu(null)}
          items={(() => {
            const ch = channelMenu.channel;
            const muted = channelIsMuted(channelMutes, ch.id);
            const items: ContextMenuItem[] = [];
            if (muted) {
              items.push({
                label: "Unmute Channel",
                onClick: () => unmuteChannel(ch.id),
              });
            }
            items.push({
              label: muted ? "Change Mute Duration" : "Mute Channel",
              children: MUTE_DURATIONS.map((d) => ({
                label: d.label,
                onClick: () => muteChannel(ch.id, d.ms),
              })),
            });
            if (canManageChannels) {
              items.push({
                label: "Edit Channel",
                onClick: () => setModal("channel-settings", ch.id),
              });
            }
            return items;
          })()}
        />
      )}
    </aside>
  );
}
