import { useMemo, useState, type MouseEvent } from "react";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { DmChannel, PresenceStatus, UserPublic } from "../types";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { GroupDmPicker } from "./GroupDmPicker";
import { dmMemberCount, dmTitle } from "../lib/dmDisplay";
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

  const me = useAppStore((s) => s.user);
  const removeGroupDmMember = useAppStore((s) => s.removeGroupDmMember);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<MenuState>(null);

  const pendingCount = pendingInbound.length + pendingOutbound.length;

  const filteredDms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return dmChannels;
    return dmChannels.filter((d) =>
      d.is_group
        ? dmTitle(d, me?.id).toLowerCase().includes(q) ||
          (d.members || []).some((m) => m.username.toLowerCase().includes(q))
        : d.peer.display_name.toLowerCase().includes(q) ||
          d.peer.username.toLowerCase().includes(q),
    );
  }, [dmChannels, search, me?.id]);

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
    if (dm.is_group) {
      return [
        { label: "Close DM", onClick: () => void closeDm(dm.id) },
        {
          label: "Leave group",
          danger: true,
          onClick: () => {
            if (me) void removeGroupDmMember(dm.id, me.id);
          },
        },
      ];
    }
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
  }, [menu, friends, pendingOutbound, requestFriend, startDmCallWithPeer, closeDm, me, removeGroupDmMember]);

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
          <h3 className="friends-section-head">
            Direct messages
            <button
              type="button"
              className="icon-btn friends-new-group"
              title="Create group DM"
              aria-label="Create group DM"
              onClick={() => setCreatingGroup(true)}
            >
              +
            </button>
          </h3>
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
                    {dm.is_group ? (
                      <span className="friends-avatar-wrap sm">
                        <span className="friends-avatar placeholder group-dm-icon"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="currentColor"><path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05A4.22 4.22 0 0 1 17 16.5V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" /></svg></span>
                      </span>
                    ) : (
                      <FriendAvatar
                        user={dm.peer}
                        status={presenceByUser[dm.peer.id] || "offline"}
                      />
                    )}
                    <span className="friends-dm-name">
                      {dmTitle(dm, me?.id)}
                      <span className="muted">
                        {dm.is_group ? `${dmMemberCount(dm)} members` : `@${dm.peer.username}`}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="friends-dm-close icon-btn"
                    title="Close DM"
                    aria-label={`Close DM with ${dmTitle(dm, me?.id)}`}
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

      {creatingGroup && <GroupDmPicker onClose={() => setCreatingGroup(false)} />}

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
