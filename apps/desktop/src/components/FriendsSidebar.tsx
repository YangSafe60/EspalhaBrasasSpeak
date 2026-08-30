import { useMemo, useState, type MouseEvent } from "react";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { DmChannel, PresenceStatus, UserPublic } from "../types";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import type { FriendsTab } from "./FriendsHomeView";

function FriendAvatar({
  user,
  status,
}: {
  user: UserPublic;
  status?: PresenceStatus;
}) {
  const authors = useAppStore((s) => s.authors);
  const fresh = authors[user.id] || user;
  const initial = (fresh.display_name || fresh.username || "?")
    .charAt(0)
    .toUpperCase();

  return (
    <div className="friends-avatar-wrap sm">
      {fresh.avatar_url ? (
        <img
          className="friends-avatar"
          src={mediaUrl(fresh.avatar_url)}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="friends-avatar placeholder">{initial}</span>
      )}
      {status && (
        <span
          className={`friends-status-dot status-${status}`}
          title={status}
          aria-label={status}
        />
      )}
    </div>
  );
}

type MenuState = { x: number; y: number; dm: DmChannel } | null;

type Props = {
  onOpenFriends: (tab?: FriendsTab) => void;
  friendsViewActive: boolean;
};

export function FriendsSidebar({ onOpenFriends, friendsViewActive }: Props) {
  const friends = useAppStore((s) => s.friends);
  const pendingInbound = useAppStore((s) => s.pendingInbound);
  const pendingOutbound = useAppStore((s) => s.pendingOutbound);
  const dmChannels = useAppStore((s) => s.dmChannels);
  const activeDmId = useAppStore((s) => s.activeDmId);
  const presenceByUser = useAppStore((s) => s.presenceByUser);
  const closeDm = useAppStore((s) => s.closeDm);
  const selectDm = useAppStore((s) => s.selectDm);
  const openDmWithPeer = useAppStore((s) => s.openDmWithPeer);
  const startDmCallWithPeer = useAppStore((s) => s.startDmCallWithPeer);
  const requestFriend = useAppStore((s) => s.requestFriend);
  const setModal = useAppStore((s) => s.setModal);

  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);

  const pendingCount = pendingInbound.length + pendingOutbound.length;

  const filteredDms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dmChannels;
    return dmChannels.filter(
      (d) =>
        d.peer.display_name.toLowerCase().includes(q) ||
        d.peer.username.toLowerCase().includes(q),
    );
  }, [dmChannels, search]);

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return friends.filter(
      (f) =>
        f.peer.display_name.toLowerCase().includes(q) ||
        f.peer.username.toLowerCase().includes(q),
    );
  }, [friends, search]);

  const menuItems: ContextMenuItem[] = useMemo(() => {
    if (!menu) return [];
    const { dm } = menu;
    const isFriend = friends.some((f) => f.peer.id === dm.peer.id);
    const requestPending = pendingOutbound.some(
      (f) => f.peer.id === dm.peer.id,
    );
    const items: ContextMenuItem[] = [];

    if (!isFriend && !requestPending) {
      items.push({
        label: "Add friend",
        onClick: () => void requestFriend(dm.peer.username),
      });
    }

    items.push({
      label: "Start call",
      onClick: () => void startDmCallWithPeer(dm.peer.id),
    });

    items.push({
      label: "Close DM",
      onClick: () => void closeDm(dm.id),
    });

    return items;
  }, [menu, friends, pendingOutbound, requestFriend, startDmCallWithPeer, closeDm]);

  return (
    <aside className="channel-sidebar friends-sidebar">
      <header className="sidebar-header">
        <h2>Friends</h2>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-btn"
            title="Add friend"
            onClick={() => onOpenFriends("add")}
          >
            +
          </button>
          <button
            type="button"
            className="icon-btn"
            title="User settings"
            onClick={() => setModal("user-settings")}
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="channel-scroll friends-sidebar-scroll">
        <label className="friends-sidebar-search-wrap" htmlFor="friends-sidebar-search">
          <input
            id="friends-sidebar-search"
            className="friends-sidebar-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
          />
        </label>

        <button
          type="button"
          className={`friends-nav-item${friendsViewActive ? " active" : ""}`}
          onClick={() => onOpenFriends("online")}
        >
          <span>Friends</span>
          {pendingCount > 0 ? (
            <span className="friends-tab-badge">{pendingCount}</span>
          ) : null}
        </button>

        {search.trim() && filteredFriends.length > 0 && (
          <section className="friends-section">
            <h3>Friends</h3>
            <ul className="friends-list">
              {filteredFriends.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="friends-dm-btn"
                    onClick={() => void openDmWithPeer(f.peer.id)}
                  >
                    <FriendAvatar
                      user={f.peer}
                      status={presenceByUser[f.peer.id] || "offline"}
                    />
                    <span className="friends-dm-name">
                      {f.peer.display_name}
                      <span className="muted">@{f.peer.username}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="friends-section">
          <h3>Direct messages</h3>
          {filteredDms.length === 0 ? (
            <p className="muted friends-empty">
              {search.trim()
                ? "No conversations match."
                : "No direct messages yet."}
            </p>
          ) : (
            <ul className="friends-list">
              {filteredDms.map((dm) => (
                <li
                  key={dm.id}
                  className={`friends-dm-row${activeDmId === dm.id ? " active" : ""}`}
                  onContextMenu={(e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({ x: e.clientX, y: e.clientY, dm });
                  }}
                >
                  <button
                    type="button"
                    className="friends-dm-main"
                    onClick={() => void selectDm(dm.id)}
                  >
                    <FriendAvatar
                      user={dm.peer}
                      status={presenceByUser[dm.peer.id] || "offline"}
                    />
                    <span className="friends-dm-name">
                      {dm.peer.display_name}
                      <span className="muted">@{dm.peer.username}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="friends-dm-close icon-btn"
                    title="Close DM"
                    aria-label={`Close DM with ${dm.peer.display_name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeDm(dm.id);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}
