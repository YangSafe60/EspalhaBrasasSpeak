import { useCallback, useState, type FormEvent, type MouseEvent } from "react";
import { ApiError } from "../api/client";
import { useAppStore } from "../store/appStore";
import type { DmChannel, Friendship, UserPublic } from "../types";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

function FriendAvatar({ user }: { user: UserPublic }) {
  const authors = useAppStore((s) => s.authors);
  const fresh = authors[user.id] || user;
  const initial = (fresh.display_name || fresh.username || "?")
    .charAt(0)
    .toUpperCase();

  if (fresh.avatar_url) {
    return (
      <img
        className="friends-avatar"
        src={fresh.avatar_url}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }
  return <span className="friends-avatar placeholder">{initial}</span>;
}

type MenuState =
  | { kind: "dm"; x: number; y: number; dm: DmChannel }
  | { kind: "friend"; x: number; y: number; friendship: Friendship }
  | null;

export function FriendsSidebar() {
  const friends = useAppStore((s) => s.friends);
  const pendingInbound = useAppStore((s) => s.pendingInbound);
  const pendingOutbound = useAppStore((s) => s.pendingOutbound);
  const dmChannels = useAppStore((s) => s.dmChannels);
  const activeDmId = useAppStore((s) => s.activeDmId);
  const requestFriend = useAppStore((s) => s.requestFriend);
  const acceptFriend = useAppStore((s) => s.acceptFriend);
  const declineFriend = useAppStore((s) => s.declineFriend);
  const removeFriend = useAppStore((s) => s.removeFriend);
  const muteFriend = useAppStore((s) => s.muteFriend);
  const blockFriend = useAppStore((s) => s.blockFriend);
  const closeDm = useAppStore((s) => s.closeDm);
  const selectDm = useAppStore((s) => s.selectDm);
  const openDmWithPeer = useAppStore((s) => s.openDmWithPeer);
  const setModal = useAppStore((s) => s.setModal);

  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestFriend(username.trim());
      setUsername("");
    } catch (err) {
      let msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not send request";
      if (
        err instanceof ApiError &&
        err.status === 404 &&
        /not found/i.test(msg)
      ) {
        msg =
          "Friends API not available — restart the server (./scripts/run-server.ps1)";
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function onDmContext(e: MouseEvent, dm: DmChannel) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind: "dm", x: e.clientX, y: e.clientY, dm });
  }

  function onFriendContext(e: MouseEvent, friendship: Friendship) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ kind: "friend", x: e.clientX, y: e.clientY, friendship });
  }

  const menuItems: ContextMenuItem[] = (() => {
    if (!menu) return [];
    if (menu.kind === "dm") {
      return [
        {
          label: "Close DM",
          onClick: () => void closeDm(menu.dm.id),
        },
      ];
    }
    const f = menu.friendship;
    return [
      {
        label: f.muted ? "Unmute notifications" : "Mute notifications",
        onClick: () => void muteFriend(f.id),
      },
      {
        label: "Remove friend",
        onClick: () => void removeFriend(f.id),
      },
      {
        label: "Block",
        danger: true,
        onClick: () => void blockFriend(f.id),
      },
    ];
  })();

  return (
    <aside className="channel-sidebar friends-sidebar">
      <div className="sidebar-header">
        <h2>Friends</h2>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-btn"
            title="User settings"
            onClick={() => setModal("user-settings")}
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="channel-scroll">
        <form className="friends-add" onSubmit={(e) => void onAdd(e)}>
          <label className="muted" htmlFor="friend-username">
            Add friend by username
          </label>
          <div className="friends-add-row">
            <input
              id="friend-username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              placeholder="@username"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn primary" disabled={busy}>
              Add
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </form>

        {pendingInbound.length > 0 && (
          <section className="friends-section">
            <h3>Incoming</h3>
            <ul className="friends-list">
              {pendingInbound.map((f) => (
                <li key={f.id} className="friends-row">
                  <div className="friends-peer">
                    <FriendAvatar user={f.peer} />
                    <div>
                      <strong>{f.peer.display_name}</strong>
                      <span className="muted">@{f.peer.username}</span>
                    </div>
                  </div>
                  <div className="friends-actions">
                    <button
                      type="button"
                      className="btn primary sm"
                      onClick={() => void acceptFriend(f.id)}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => void declineFriend(f.id)}
                    >
                      Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pendingOutbound.length > 0 && (
          <section className="friends-section">
            <h3>Outgoing</h3>
            <ul className="friends-list">
              {pendingOutbound.map((f) => (
                <li key={f.id} className="friends-row">
                  <div className="friends-peer">
                    <FriendAvatar user={f.peer} />
                    <div>
                      <strong>{f.peer.display_name}</strong>
                      <span className="muted">@{f.peer.username}</span>
                    </div>
                  </div>
                  <span className="muted">Pending</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="friends-section">
          <h3>Direct messages</h3>
          {dmChannels.length === 0 ? (
            <p className="muted friends-empty">
              Accept a friend request to start a private chat.
            </p>
          ) : (
            <ul className="friends-list">
              {dmChannels.map((dm) => (
                <li key={dm.id}>
                  <button
                    type="button"
                    className={`friends-dm-btn ${activeDmId === dm.id ? "active" : ""}`}
                    onClick={() => void selectDm(dm.id)}
                    onContextMenu={(e) => onDmContext(e, dm)}
                  >
                    <FriendAvatar user={dm.peer} />
                    <span className="friends-dm-name">
                      {dm.peer.display_name}
                      <span className="muted">@{dm.peer.username}</span>
                    </span>
                    {!dm.friendship_id && (
                      <span className="muted friends-dm-tag">closed</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="friends-section">
          <h3>All friends</h3>
          {friends.length === 0 ? (
            <p className="muted friends-empty">No friends yet.</p>
          ) : (
            <ul className="friends-list">
              {friends.map((f) => (
                <li key={f.id} className="friends-row">
                  <button
                    type="button"
                    className="friends-peer clickable"
                    onClick={() => void openDmWithPeer(f.peer.id)}
                    onContextMenu={(e) => onFriendContext(e, f)}
                  >
                    <FriendAvatar user={f.peer} />
                    <div>
                      <strong>
                        {f.peer.display_name}
                        {f.muted ? (
                          <span className="muted friends-mute-tag"> muted</span>
                        ) : null}
                      </strong>
                      <span className="muted">@{f.peer.username}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    title="Remove friend"
                    onClick={() => void removeFriend(f.id)}
                  >
                    Remove
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
          onClose={closeMenu}
        />
      )}
    </aside>
  );
}
