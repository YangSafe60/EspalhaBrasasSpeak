import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import {
  channelIsMuted,
  formatMuteRemaining,
  MUTE_DURATIONS,
} from "../../lib/channelMutePrefs";
import {
  effectiveServerPerms,
  hasPerm,
  Perm,
  sameId,
} from "../../lib/serverPerms";
import { useAppStore } from "../../store/appStore";
import type { Channel } from "../../types";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { useMemberContextMenu } from "../MemberUserMenu";
import {
  canManageChannelRow,
  channelRowLocked,
  ChannelRow,
} from "./ChannelRow";
import { CategoryHeader } from "./CategoryHeader";
import { CreateChannelModal } from "./CreateChannelModal";
import { useChannelDnD } from "./useChannelDnD";
import type {
  ChannelMenuState,
  ChannelSidebarProps,
  CreateDraft,
  EmptySpaceMenuState,
} from "./types";

/** Server channel list: categories, DnD reorder, voice user tree, context menus. */
export function ChannelSidebar({
  onJoinVoice,
  speakingIds = [],
  voiceHandlers,
}: ChannelSidebarProps) {
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
  const duplicateChannel = useAppStore((s) => s.duplicateChannel);
  const deleteChannel = useAppStore((s) => s.deleteChannel);
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
  const [emptyMenu, setEmptyMenu] = useState<EmptySpaceMenuState>(null);
  const creatingRef = useRef(false);

  const server = servers.find((s) => sameId(s.id, activeServerId));
  const membersKey = Object.keys(membersByServer).find((id) =>
    sameId(id, activeServerId),
  );
  const members = membersKey ? membersByServer[membersKey] || [] : [];
  const rolesKey = Object.keys(rolesByServer).find((id) =>
    sameId(id, activeServerId),
  );
  const roles = rolesKey ? rolesByServer[rolesKey] || [] : [];
  const me = members.find((m) => sameId(m.user.id, user?.id));
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

  const channels = useMemo(() => {
    const key = Object.keys(channelsByServer).find((id) =>
      sameId(id, activeServerId),
    );
    const raw = key ? channelsByServer[key] || [] : [];
    const seen = new Set<string>();
    const unique = raw.filter((c) => {
      const k = c.id.replace(/-/g, "").toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return unique.slice().sort((a, b) => a.position - b.position);
  }, [activeServerId, channelsByServer]);

  const categories = channels.filter((c) => c.channel_type === "category");
  const uncategorized = channels.filter((c) => {
    if (c.channel_type === "category") return false;
    if (!c.category_id) return true;
    return !categories.some((cat) => sameId(cat.id, c.category_id));
  });

  const dnd = useChannelDnD({
    canManageChannels,
    activeServerId,
    channels,
    applyChannelOrder,
    setCollapsed,
  });

  useEffect(() => {
    setCollapsed({});
    setDraft(null);
    dnd.resetDnD();
    setChannelMenu(null);
    setEmptyMenu(null);
  }, [activeServerId, dnd.resetDnD]);

  useEffect(() => {
    pruneChannelMutes();
    const t = window.setInterval(() => pruneChannelMutes(), 30_000);
    return () => window.clearInterval(t);
  }, [pruneChannelMutes]);

  function overwritesFor(channelId: string) {
    const key = Object.keys(overwritesByChannel).find((id) =>
      sameId(id, channelId),
    );
    return key ? overwritesByChannel[key] || [] : [];
  }

  function channelsIn(cat: Channel) {
    return channels.filter(
      (c) => c.channel_type !== "category" && sameId(c.category_id, cat.id),
    );
  }

  function voiceUsers(channelId: string) {
    return voiceStates
      .filter((v) => v.channel_id === channelId)
      .map((v) => {
        const member = (activeServerId
          ? membersByServer[activeServerId] || []
          : []
        ).find((m) => sameId(m.user.id, v.user_id));
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

  function avatarForUser(userId: string) {
    return (
      (activeServerId
        ? membersByServer[activeServerId] || []
        : []
      ).find((m) => m.user.id === userId)?.user.avatar_url ||
      authors[userId]?.avatar_url ||
      null
    );
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

    const mode = draft.mode;
    const categoryId = draft.categoryId;
    const trimmed = name.trim();
    creatingRef.current = true;
    setBusy(true);
    setError(null);
    setDraft(null);
    setName("");

    try {
      if (mode === "category") {
        await createChannel(activeServerId, {
          name: trimmed,
          channel_type: "category",
        });
      } else {
        const ch = await createChannel(activeServerId, {
          name: trimmed,
          channel_type: channelType,
          category_id: categoryId,
        });
        if (ch.channel_type === "text") await selectChannel(ch.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
      setDraft({ mode, categoryId });
      setName(trimmed);
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  }

  function openSettings(e: MouseEvent, channelId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!canManageChannels && !canManageChannelRow(server, roles, me, user?.id, overwritesFor(channelId))) {
      return;
    }
    setModal("channel-settings", channelId);
  }

  async function promoteUncategorized(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!canManageChannels || !activeServerId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const existing = categories.find(
        (c) => c.name.trim().toLowerCase() === "channels",
      );
      const cat =
        existing ||
        (await createChannel(activeServerId, {
          name: "Channels",
          channel_type: "category",
        }));
      const latest =
        useAppStore.getState().channelsByServer[activeServerId] || [];
      const cats = latest.filter((c) => c.channel_type === "category");
      const moving = latest.filter((c) => {
        if (c.channel_type === "category") return false;
        if (sameId(c.category_id, cat.id)) return false;
        if (!c.category_id) return true;
        return !cats.some((x) => sameId(x.id, c.category_id));
      });
      if (moving.length > 0) {
        const moveIds = new Set(
          moving.map((m) => m.id.replace(/-/g, "").toLowerCase()),
        );
        let pos = 0;
        const ordered = latest.map((c) => {
          const key = c.id.replace(/-/g, "").toLowerCase();
          if (!moveIds.has(key)) return c;
          return { ...c, category_id: cat.id, position: pos++ };
        });
        await applyChannelOrder(activeServerId, ordered);
      }
      setModal("channel-settings", cat.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to edit category");
    } finally {
      setBusy(false);
    }
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
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
      ch.channel_type === "text" && !muted ? unreadByChannel[ch.id] || 0 : 0;
    const muteLabel =
      muted && ch.id in channelMutes
        ? formatMuteRemaining(channelMutes[ch.id])
        : null;
    const limitLabel =
      ch.channel_type === "voice" && ch.user_limit > 0
        ? ` · ${voiceUsers(ch.id).length}/${ch.user_limit}`
        : "";
    const isDragOver =
      dnd.dropHint?.zone === "channel-before" && dnd.dropHint.channelId === ch.id;
    const isDraggingSelf =
      dnd.dragging?.kind === "channel" && dnd.dragging.id === ch.id;
    const locked = channelRowLocked(
      overwritesFor(ch.id),
      roles,
      ch,
    );
    const manage = canManageChannelRow(
      server,
      roles,
      me,
      user?.id,
      overwritesFor(ch.id),
    );

    return (
      <ChannelRow
        key={ch.id}
        channel={ch}
        active={active}
        inVoice={inVoice}
        muted={muted}
        unread={unread}
        muteLabel={muteLabel}
        limitLabel={limitLabel}
        locked={locked}
        canManageChannels={canManageChannels}
        canManageThisChannel={manage}
        canInvitePeople={canInvitePeople}
        isDragOver={isDragOver}
        isDraggingSelf={isDraggingSelf}
        voiceUsers={voiceUsers(ch.id)}
        speakingIds={speakingIds}
        activeServerId={activeServerId}
        avatarForUser={avatarForUser}
        onJoinVoice={onJoinVoice}
        onSelectText={(id) => void selectChannel(id)}
        onInvite={openInvitePeople}
        onOpenSettings={openSettings}
        onContextMenu={(e, channel) => {
          const canManage = canManageChannelRow(
            server,
            roles,
            me,
            user?.id,
            overwritesFor(channel.id),
          );
          if (channel.channel_type !== "text" && !canManage) return;
          e.preventDefault();
          e.stopPropagation();
          setEmptyMenu(null);
          setChannelMenu({ x: e.clientX, y: e.clientY, channel });
        }}
        onOpenMiniProfile={openMiniProfile}
        onUserContextMenu={openForUserId}
        draggable={canManageChannels}
        onDragStart={dnd.onDragStart}
        onDragEnd={dnd.onDragEnd}
        onDragOver={dnd.allowDrop}
        onDrop={(e, hint) => void dnd.commitDrop(e, hint)}
        guardClick={dnd.guardClick}
      />
    );
  }

  const categoryName =
    draft?.mode === "channel" && draft.categoryId
      ? categories.find((c) => c.id === draft.categoryId)?.name
      : null;

  const showUncategorized =
    uncategorized.length > 0 ||
    categories.length === 0 ||
    dnd.dragging?.kind === "channel" ||
    dnd.dragging?.kind === "category";

  const headerProps = {
    canManageChannels,
    busy,
    dropHint: dnd.dropHint,
    dragging: dnd.dragging,
    onToggleCollapse: toggleCollapse,
    onCreateCategory: openCreateCategory,
    onCreateChannel: openCreateChannel,
    onOpenSettings: openSettings,
    onPromoteUncategorized: promoteUncategorized,
    onDragStart: dnd.onDragStart,
    onDragEnd: dnd.onDragEnd,
    currentPayload: dnd.currentPayload,
    allowDrop: dnd.allowDrop,
    commitDrop: dnd.commitDrop,
    guardClick: dnd.guardClick,
  };

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
        className={`channel-scroll${dnd.dragging ? " is-reordering" : ""}`}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            dnd.clearDropHint();
          }
        }}
        onContextMenu={(e) => {
          if (!canManageChannels) return;
          const target = e.target as Element;
          if (
            target.closest(
              ".channel-row, .channel-block, .category-header, .voice-users, button, a, input",
            )
          ) {
            return;
          }
          e.preventDefault();
          setChannelMenu(null);
          setEmptyMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {categories.map((cat) => {
          const key = cat.id;
          const kids = channelsIn(cat);
          const isCollapsed = !!collapsed[key];
          const intoBody =
            dnd.dropHint?.zone === "category-into" &&
            dnd.dropHint.categoryId === cat.id &&
            kids.length === 0;
          return (
            <div
              key={cat.id}
              className={`category${intoBody ? " drop-into" : ""}`}
              onDragOver={(e) => {
                if (dnd.currentPayload(e)?.kind === "channel") {
                  dnd.allowDrop(e, { zone: "category-into", categoryId: cat.id });
                }
              }}
              onDrop={(e) => {
                if (dnd.currentPayload(e)?.kind === "channel") {
                  void dnd.commitDrop(e, {
                    zone: "category-into",
                    categoryId: cat.id,
                  });
                }
              }}
            >
              <CategoryHeader
                {...headerProps}
                collapseKey={key}
                label={cat.name}
                categoryId={cat.id}
                isCollapsed={isCollapsed}
              />
              {!isCollapsed && kids.map(renderChannel)}
            </div>
          );
        })}

        {showUncategorized && (
          <div
            className={`category${dnd.dropHint?.zone === "uncategorized-into" && uncategorized.length === 0 ? " drop-into" : ""}`}
            onDragOver={(e) => {
              if (dnd.currentPayload(e)?.kind === "channel") {
                dnd.allowDrop(e, { zone: "uncategorized-into" });
              }
            }}
            onDrop={(e) => {
              if (dnd.currentPayload(e)?.kind === "channel") {
                void dnd.commitDrop(e, { zone: "uncategorized-into" });
              }
            }}
          >
            <CategoryHeader
              {...headerProps}
              collapseKey="uncategorized"
              label="Channels"
              categoryId={null}
              isCollapsed={!!collapsed.uncategorized}
              showCreateCategory={categories.length === 0}
            />
            {!collapsed.uncategorized && uncategorized.map(renderChannel)}
          </div>
        )}
        {canManageChannels && (
          <div
            className="channel-scroll-empty"
            aria-hidden
            title="Right-click to create a channel"
          />
        )}
      </div>

      {draft && (
        <CreateChannelModal
          draft={draft}
          categoryName={categoryName ?? null}
          channelType={channelType}
          name={name}
          busy={busy}
          error={error}
          onClose={() => setDraft(null)}
          onChannelType={setChannelType}
          onName={setName}
          onSubmit={(e) => void submitCreate(e)}
        />
      )}
      {menuPortal}
      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          onClose={() => setChannelMenu(null)}
          items={(() => {
            const ch = channelMenu.channel;
            const muted =
              ch.channel_type === "text" &&
              channelIsMuted(channelMutes, ch.id);
            const items: ContextMenuItem[] = [];
            if (ch.channel_type === "text") {
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
            }
            if (canManageChannelRow(server, roles, me, user?.id, overwritesFor(ch.id))) {
              items.push({
                label: "Duplicate Channel",
                onClick: () => {
                  void duplicateChannel(ch.id);
                },
              });
              items.push({
                label: "Edit Channel",
                onClick: () => setModal("channel-settings", ch.id),
              });
              items.push({
                label: "Delete Channel",
                danger: true,
                onClick: () => {
                  void deleteChannel(ch.id);
                },
              });
            }
            return items;
          })()}
        />
      )}
      {emptyMenu && canManageChannels && (
        <ContextMenu
          x={emptyMenu.x}
          y={emptyMenu.y}
          onClose={() => setEmptyMenu(null)}
          items={[
            {
              label: "Create Channel",
              onClick: () => openCreateChannel(null),
            },
            {
              label: "Create Category",
              onClick: () => openCreateCategory(),
            },
          ]}
        />
      )}
    </aside>
  );
}
