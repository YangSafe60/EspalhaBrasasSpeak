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

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          label: "Close DM",
          onClick: () => void closeDm(menu.dm.id),
        },
      ]
    : [];

  return (
    <aside className="channel-sidebar friends-sidebar">
      <div className="friends-sidebar-search-wrap">
        <input
          id="friends-sidebar-search"
          className="friends-sidebar-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find or start a conversation"
          aria-label="Find or start a conversation"
        />
      </div>

      <div className="channel-scroll friends-sidebar-scroll">
        <nav className="friends-sidebar-nav">
          <button
            type="button"
            className={`friends-nav-item${friendsViewActive ? " active" : ""}`}
            onClick={() => onOpenFriends("online")}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path
                fill="currentColor"
                d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
              />
            </svg>
            <span>Friends</span>
            {pendingCount > 0 ? (
              <span className="friends-tab-badge">{pendingCount}</span>
            ) : null}
          </button>
        </nav>

        {search.trim() && filteredFriends.length > 0 && (
          <section className="friends-dm-section">
            <header className="friends-dm-header">
              <h3>Friends</h3>
            </header>
            <ul className="friends-dm-list">
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
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="friends-dm-section">
          <header className="friends-dm-header">
            <h3>Direct Messages</h3>
            <button
              type="button"
              className="friends-dm-add"
              title="Add Friend"
              onClick={() => onOpenFriends("add")}
            >
              +
            </button>
          </header>
          {filteredDms.length === 0 ? (
            <p className="muted friends-empty">
              {search.trim()
                ? "No conversations match."
                : "No direct messages yet."}
            </p>
          ) : (
            <ul className="friends-dm-list">
              {filteredDms.map((dm) => (
                <li key={dm.id}>
                  <button
                    type="button"
                    className={`friends-dm-btn ${activeDmId === dm.id ? "active" : ""}`}
                    onClick={() => void selectDm(dm.id)}
                    onContextMenu={(e: MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenu({ x: e.clientX, y: e.clientY, dm });
                    }}
                  >
                    <FriendAvatar
                      user={dm.peer}
                      status={presenceByUser[dm.peer.id] || "offline"}
                    />
                    <span className="friends-dm-name">
                      {dm.peer.display_name}
                      {!dm.friendship_id && (
                        <span className="muted friends-dm-tag"> closed</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="friends-sidebar-footer">
        <button
          type="button"
          className="icon-btn"
          title="User settings"
          onClick={() => setModal("user-settings")}
        >
          ⚙
        </button>
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
