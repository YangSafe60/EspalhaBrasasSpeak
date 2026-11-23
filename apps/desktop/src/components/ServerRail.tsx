import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import { useAppStore } from "../store/appStore";
import { mediaCssUrl } from "../lib/mediaUrl";
import logoMark from "../assets/logo-flame.png";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { MUTE_DURATIONS } from "../lib/channelMutePrefs";
import { serverIsMuted } from "../lib/serverMutePrefs";
import { serverNotifyOf } from "../lib/serverNotifyPrefs";
import {
  effectiveServerPerms,
  hasPerm,
  Perm,
  sameId,
} from "../lib/serverPerms";
import type { Server } from "../types";
import {
  FOLDER_COLORS,
  loadLayout,
  moveServer,
  reconcile,
  saveLayout,
  ungroup,
  updateFolder,
  type DropTarget,
  type RailEntry,
  type RailFolder,
} from "../lib/serverFolders";

type Zone = "before" | "merge" | "after";

/** Top quarter = before, bottom quarter = after, middle = into a folder. */
function zoneOf(e: DragEvent<HTMLElement>): Zone {
  const r = e.currentTarget.getBoundingClientRect();
  const rel = (e.clientY - r.top) / r.height;
  return rel < 0.25 ? "before" : rel > 0.75 ? "after" : "merge";
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h3.6c.6 0 1.2.24 1.65.66L12.3 6.1H18.5A2.5 2.5 0 0 1 21 8.6v8.9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z" />
    </svg>
  );
}

export function ServerRail() {
  const servers = useAppStore((s) => s.servers);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const friendsHome = useAppStore((s) => s.friendsHome);
  const pendingInbound = useAppStore((s) => s.pendingInbound);
  const selectServer = useAppStore((s) => s.selectServer);
  const openFriendsHome = useAppStore((s) => s.openFriendsHome);
  const setModal = useAppStore((s) => s.setModal);
  const user = useAppStore((s) => s.user);
  const rolesByServer = useAppStore((s) => s.rolesByServer);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const serverMutes = useAppStore((s) => s.serverMutes);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const unreadByChannel = useAppStore((s) => s.unreadByChannel);
  const mentionsByChannel = useAppStore((s) => s.mentionsByChannel);
  const serverNotify = useAppStore((s) => s.serverNotify);
  const muteServer = useAppStore((s) => s.muteServer);
  const unmuteServer = useAppStore((s) => s.unmuteServer);
  const pruneServerMutes = useAppStore((s) => s.pruneServerMutes);
  const setServerNotifyLevel = useAppStore((s) => s.setServerNotifyLevel);
  const patchServerNotify = useAppStore((s) => s.patchServerNotify);
  const leaveServer = useAppStore((s) => s.leaveServer);

  const [menu, setMenu] = useState<{ x: number; y: number; server: Server } | null>(
    null,
  );
  const [leaveTarget, setLeaveTarget] = useState<Server | null>(null);
  // Folders and order (this device only).
  const [layout, setLayoutState] = useState<RailEntry[]>(loadLayout);
  const entries = useMemo(() => reconcile(layout, servers.map((s) => s.id)), [layout, servers]);
  const byId = useMemo(() => new Map(servers.map((s) => [s.id, s])), [servers]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; zone: Zone } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: RailFolder } | null>(null);
  const [renaming, setRenaming] = useState<{ folder: RailFolder; x: number; y: number; name: string } | null>(null);

  function setLayout(next: RailEntry[]) {
    setLayoutState(next);
    saveLayout(next);
  }

  function drop(target: DropTarget) {
    if (dragId) setLayout(moveServer(entries, dragId, target));
    setDragId(null);
    setHover(null);
  }

  function serverAlerts(server: Server) {
    const muted = serverIsMuted(serverMutes, server.id);
    const textChannels = (channelsByServer[server.id] || []).filter((c) => c.channel_type === "text");
    const unread = !muted && textChannels.some((c) => (unreadByChannel[c.id] || 0) > 0);
    const mentions = textChannels.reduce((n, c) => n + (mentionsByChannel[c.id] || 0), 0);
    return { muted, unread, mentions };
  }

  function renderServer(server: Server, inFolder: boolean) {
    const initial = server.name.trim().charAt(0).toUpperCase() || "?";
    const active = !friendsHome && server.id === activeServerId;
    const { muted, unread, mentions } = serverAlerts(server);
    const zone = hover?.key === server.id ? hover.zone : null;
    return (
      <button
        key={server.id}
        type="button"
        draggable
        className={`server-orb ${active ? "active" : ""}${muted ? " is-muted" : ""}${unread && !active ? " has-unread" : ""}${dragId === server.id ? " is-dragging" : ""}${zone ? ` drop-${zone}` : ""}${inFolder ? " in-folder" : ""}`}
        style={
          server.icon_url
            ? { backgroundImage: mediaCssUrl(server.icon_url) }
            : { backgroundColor: server.accent_color || "var(--accent)" }
        }
        title={muted ? `${server.name} (muted)` : server.name}
        onClick={() => void selectServer(server.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, server });
        }}
        onDragStart={(e) => {
          setDragId(server.id);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", server.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setHover(null);
        }}
        onDragOver={(e) => {
          if (!dragId || dragId === server.id) return;
          e.preventDefault();
          const z = zoneOf(e);
          if (hover?.key !== server.id || hover.zone !== z) setHover({ key: server.id, zone: z });
        }}
        onDragLeave={() => setHover((h) => (h?.key === server.id ? null : h))}
        onDrop={(e) => {
          e.preventDefault();
          const z = zoneOf(e);
          drop(z === "merge" ? { kind: "merge", serverId: server.id } : { kind: z, serverId: server.id });
        }}
      >
        {!server.icon_url && <span>{initial}</span>}
        {mentions > 0 && (
          <span className="rail-badge mention" aria-label={`${mentions} mentions`}>
            {mentions > 99 ? "99+" : mentions}
          </span>
        )}
      </button>
    );
  }

  function renderFolder(folder: RailFolder) {
    const list = folder.servers.map((id) => byId.get(id)).filter((s): s is Server => Boolean(s));
    const alerts = list.map(serverAlerts);
    const mentions = alerts.reduce((n, a) => n + a.mentions, 0);
    const unread = alerts.some((a) => a.unread);
    const hasActive = !friendsHome && list.some((s) => s.id === activeServerId);
    const zone = hover?.key === folder.id ? hover.zone : null;
    const label = folder.name || list.map((s) => s.name).join(", ");
    const dropHandlers = {
      onDragOver: (e: DragEvent<HTMLButtonElement>) => {
        if (!dragId) return;
        e.preventDefault();
        const z = zoneOf(e);
        if (hover?.key !== folder.id || hover.zone !== z) setHover({ key: folder.id, zone: z });
      },
      onDragLeave: () => setHover((h) => (h?.key === folder.id ? null : h)),
      onDrop: (e: DragEvent<HTMLButtonElement>) => {
        e.preventDefault();
        const z = zoneOf(e);
        drop(
          z === "merge"
            ? { kind: "folder", folderId: folder.id }
            : { kind: z === "before" ? "before-folder" : "after-folder", folderId: folder.id },
        );
      },
    };
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      setFolderMenu({ x: e.clientX, y: e.clientY, folder });
    };
    if (!folder.open) {
      return (
        <button
          key={folder.id}
          type="button"
          className={`server-folder${hasActive ? " has-active" : ""}${unread && !hasActive ? " has-unread" : ""}${zone ? ` drop-${zone}` : ""}`}
          style={{ ["--folder-color" as string]: folder.color }}
          title={label}
          aria-label={`Folder: ${label}`}
          onClick={() => setLayout(updateFolder(entries, folder.id, { open: true }))}
          onContextMenu={onMenu}
          {...dropHandlers}
        >
          <span className="server-folder-grid">
            {list.slice(0, 4).map((s) => (
              <span
                key={s.id}
                className="server-folder-mini"
                style={
                  s.icon_url
                    ? { backgroundImage: mediaCssUrl(s.icon_url) }
                    : { backgroundColor: s.accent_color || "var(--accent)" }
                }
              >
                {!s.icon_url && (s.name.trim().charAt(0).toUpperCase() || "?")}
              </span>
            ))}
          </span>
          {mentions > 0 && (
            <span className="rail-badge mention" aria-label={`${mentions} mentions`}>
              {mentions > 99 ? "99+" : mentions}
            </span>
          )}
        </button>
      );
    }
    return (
      <div key={folder.id} className="server-folder-open" style={{ ["--folder-color" as string]: folder.color }}>
        <button
          type="button"
          className={`server-folder-head${zone ? ` drop-${zone}` : ""}`}
          title={label}
          aria-label={`Close folder: ${label}`}
          onClick={() => setLayout(updateFolder(entries, folder.id, { open: false }))}
          onContextMenu={onMenu}
          {...dropHandlers}
        >
          <FolderIcon />
        </button>
        {list.map((s) => renderServer(s, true))}
      </div>
    );
  }
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    pruneServerMutes();
    const timer = window.setInterval(() => pruneServerMutes(), 30_000);
    return () => window.clearInterval(timer);
  }, [pruneServerMutes]);

  function canOpenSettings(server: Server) {
    if (user && sameId(server.owner_id, user.id)) return true;
    const roleKey = Object.keys(rolesByServer).find((id) => sameId(id, server.id));
    const memberKey = Object.keys(membersByServer).find((id) =>
      sameId(id, server.id),
    );
    const roles = roleKey ? rolesByServer[roleKey] || [] : [];
    const members = memberKey ? membersByServer[memberKey] || [] : [];
    const me = members.find((m) => sameId(m.user.id, user?.id));
    const perms = effectiveServerPerms(server, roles, me, user?.id);
    return (
      hasPerm(perms, Perm.MANAGE_SERVER) ||
      hasPerm(perms, Perm.MANAGE_ROLES) ||
      hasPerm(perms, Perm.MANAGE_EXPRESSIONS) ||
      hasPerm(perms, Perm.CREATE_INVITE) ||
      hasPerm(perms, Perm.MANAGE_CHANNELS)
    );
  }

  function menuItems(server: Server): ContextMenuItem[] {
    const muted = serverIsMuted(serverMutes, server.id);
    const notify = serverNotifyOf(serverNotify, server.id);
    const isOwner = Boolean(user && sameId(server.owner_id, user.id));
    const items: ContextMenuItem[] = [];
    if (muted) {
      items.push({
        label: "Unmute Server",
        onClick: () => unmuteServer(server.id),
      });
    }
    items.push({
      label: muted ? "Change Mute Duration" : "Mute Server",
      children: MUTE_DURATIONS.map((d) => ({
        label: d.label,
        onClick: () => muteServer(server.id, d.ms),
      })),
    });
    items.push({
      label: "Notification Settings",
      children: [
        {
          label: "All Messages",
          checked: notify.level === "all",
          onClick: () => setServerNotifyLevel(server.id, "all"),
        },
        {
          label: "Only @mentions",
          checked: notify.level === "mentions",
          onClick: () => setServerNotifyLevel(server.id, "mentions"),
        },
        {
          label: "Nothing",
          checked: notify.level === "nothing",
          onClick: () => setServerNotifyLevel(server.id, "nothing"),
        },
        { label: "", divider: true },
        {
          label: "Suppress @everyone and @here",
          checked: notify.suppressEveryone,
          onClick: () =>
            patchServerNotify(server.id, {
              suppressEveryone: !notify.suppressEveryone,
            }),
        },
        {
          label: "Suppress All Role @mentions",
          checked: notify.suppressRoles,
          onClick: () =>
            patchServerNotify(server.id, { suppressRoles: !notify.suppressRoles }),
        },
        {
          label: "Suppress Highlights",
          checked: notify.suppressHighlights,
          onClick: () =>
            patchServerNotify(server.id, {
              suppressHighlights: !notify.suppressHighlights,
            }),
        },
        {
          label: "Mute New Events",
          checked: notify.muteEvents,
          onClick: () =>
            patchServerNotify(server.id, { muteEvents: !notify.muteEvents }),
        },
      ],
    });
    items.push({ label: "", divider: true });
    if (canOpenSettings(server)) {
      items.push({
        label: "Server Settings",
        onClick: () => {
          void selectServer(server.id).then(() => setModal("server-settings"));
        },
      });
    }
    if (!isOwner) {
      items.push({
        label: "Leave Server",
        danger: true,
        onClick: () => setLeaveTarget(server),
      });
    }
    return items;
  }

  return (
    <aside className="server-rail">
      <div className="rail-top">
        <button
          type="button"
          className={`rail-brand rail-home ${friendsHome ? "active" : ""}`}
          title="Friends & DMs"
          onClick={() => void openFriendsHome()}
        >
          <img src={logoMark} alt="" />
          {pendingInbound.length > 0 && (
            <span className="rail-badge">{pendingInbound.length}</span>
          )}
        </button>
        <div className="rail-divider" />
        {entries.map((entry) => {
          if (entry.type === "folder") return renderFolder(entry);
          const server = byId.get(entry.id);
          return server ? renderServer(server, false) : null;
        })}
        <button
          type="button"
          className="server-orb action"
          title="Create server"
          onClick={() => setModal("create-server")}
        >
          +
        </button>
        <button
          type="button"
          className="server-orb action"
          title="Join with invite"
          onClick={() => setModal("join-invite")}
        >
          ↪
        </button>
      </div>
      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
          items={[
            {
              label: "Rename folder",
              onClick: () =>
                setRenaming({ folder: folderMenu.folder, x: folderMenu.x, y: folderMenu.y, name: folderMenu.folder.name }),
            },
            {
              label: "Folder colour",
              children: FOLDER_COLORS.map((c, i) => ({
                label: ["Red", "Amber", "Green", "Blue", "Purple", "Pink", "Grey"][i] ?? c,
                checked: c === folderMenu.folder.color,
                onClick: () => setLayout(updateFolder(entries, folderMenu.folder.id, { color: c })),
              })),
            },
            { label: "", divider: true },
            { label: "Ungroup servers", onClick: () => setLayout(ungroup(entries, folderMenu.folder.id)) },
          ]}
        />
      )}
      {renaming && (
        <form
          className="rail-rename"
          style={{ left: renaming.x, top: renaming.y }}
          onSubmit={(e) => {
            e.preventDefault();
            setLayout(updateFolder(entries, renaming.folder.id, { name: renaming.name.trim().slice(0, 40) }));
            setRenaming(null);
          }}
        >
          <input
            autoFocus
            maxLength={40}
            value={renaming.name}
            placeholder="Folder name"
            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(null);
            }}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          />
        </form>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.server)}
          onClose={() => setMenu(null)}
        />
      )}
      <ConfirmDialog
        open={leaveTarget != null}
        title="Leave server?"
        description={
          leaveTarget
            ? `You will lose access to ${leaveTarget.name} until someone invites you back.`
            : undefined
        }
        confirmLabel={leaving ? "Leaving…" : "Leave Server"}
        busy={leaving}
        onCancel={() => {
          if (!leaving) setLeaveTarget(null);
        }}
        onConfirm={() => {
          if (!leaveTarget) return;
          setLeaving(true);
          void leaveServer(leaveTarget.id)
            .then(() => setLeaveTarget(null))
            .finally(() => setLeaving(false));
        }}
      />
    </aside>
  );
}
