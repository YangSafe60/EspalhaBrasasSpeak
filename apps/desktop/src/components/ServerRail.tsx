import { useEffect, useState } from "react";
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
        {servers.map((server) => {
          const initial = server.name.trim().charAt(0).toUpperCase() || "?";
          const active = !friendsHome && server.id === activeServerId;
          const muted = serverIsMuted(serverMutes, server.id);
          const textChannels = (channelsByServer[server.id] || []).filter(
            (c) => c.channel_type === "text",
          );
          const unread = !muted && textChannels.some((c) => (unreadByChannel[c.id] || 0) > 0);
          const mentions = textChannels.reduce((n, c) => n + (mentionsByChannel[c.id] || 0), 0);
          return (
            <button
              key={server.id}
              type="button"
              className={`server-orb ${active ? "active" : ""}${muted ? " is-muted" : ""}${unread && !active ? " has-unread" : ""}`}
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
            >
              {!server.icon_url && <span>{initial}</span>}
              {mentions > 0 && (
                <span className="rail-badge mention" aria-label={`${mentions} mentions`}>
                  {mentions > 99 ? "99+" : mentions}
                </span>
              )}
            </button>
          );
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
