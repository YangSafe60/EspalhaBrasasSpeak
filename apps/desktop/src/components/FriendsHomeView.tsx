import { useMemo, useState, type FormEvent, type MouseEvent } from "react";
import { ApiError } from "../api/client";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { Friendship, PresenceStatus, UserPublic } from "../types";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

export type FriendsTab = "online" | "all" | "pending" | "add";

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
    <div className="friends-avatar-wrap">
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

function statusLabel(status: PresenceStatus): string {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  if (status === "dnd") return "Do Not Disturb";
  return "Offline";
}

type MenuState = {
  x: number;
  y: number;
  friendship: Friendship;
} | null;

type Props = {
  tab: FriendsTab;
  onTabChange: (tab: FriendsTab) => void;
};

export function FriendsHomeView({ tab, onTabChange }: Props) {
  const friends = useAppStore((s) => s.friends);
  const pendingInbound = useAppStore((s) => s.pendingInbound);
  const pendingOutbound = useAppStore((s) => s.pendingOutbound);
  const presenceByUser = useAppStore((s) => s.presenceByUser);
  const requestFriend = useAppStore((s) => s.requestFriend);
  const acceptFriend = useAppStore((s) => s.acceptFriend);
  const declineFriend = useAppStore((s) => s.declineFriend);
  const removeFriend = useAppStore((s) => s.removeFriend);
  const muteFriend = useAppStore((s) => s.muteFriend);
  const blockFriend = useAppStore((s) => s.blockFriend);
  const openDmWithPeer = useAppStore((s) => s.openDmWithPeer);

  const [query, setQuery] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);

  function presenceFor(userId: string): PresenceStatus {
    return presenceByUser[userId] || "offline";
  }

  const onlineFriends = useMemo(
    () =>
      friends.filter((f) => {
        const s = presenceFor(f.peer.id);
        return s === "online" || s === "idle" || s === "dnd";
      }),
    [friends, presenceByUser],
  );

  const listFriends = useMemo(() => {
    const base = tab === "online" ? onlineFriends : friends;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (f) =>
        f.peer.display_name.toLowerCase().includes(q) ||
        f.peer.username.toLowerCase().includes(q),
    );
  }, [tab, onlineFriends, friends, query]);

  const pendingCount = pendingInbound.length + pendingOutbound.length;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || busy) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await requestFriend(username.trim());
      setUsername("");
      setMsg("Friend request sent.");
    } catch (err) {
      let text =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not send request";
      if (
        err instanceof ApiError &&
        err.status === 404 &&
        /not found/i.test(text)
      ) {
        text =
          "Friends API not available — restart the server (./scripts/run-server.ps1)";
      }
      setError(text);
    } finally {
      setBusy(false);
    }
  }

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          label: "Message",
          onClick: () => void openDmWithPeer(menu.friendship.peer.id),
        },
        {
          label: menu.friendship.muted
            ? "Unmute notifications"
            : "Mute notifications",
          onClick: () => void muteFriend(menu.friendship.id),
        },
        {
          label: "Remove friend",
          onClick: () => void removeFriend(menu.friendship.id),
        },
        {
          label: "Block",
          danger: true,
          onClick: () => void blockFriend(menu.friendship.id),
        },
      ]
    : [];

  return (
    <main className="friends-home">
      <header className="message-header friends-home-header">
        <div>
          <h2>Friends</h2>
          <p className="topic">People and private chats</p>
        </div>
        <nav className="friends-home-tabs" aria-label="Friends filters">
          {(
            [
              ["online", "Online"],
              ["all", "All"],
              ["pending", "Pending"],
              ["add", "Add"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? "on" : ""}
              onClick={() => onTabChange(id)}
            >
              {label}
              {id === "pending" && pendingCount > 0 ? (
                <span className="friends-tab-badge">{pendingCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      {tab === "add" ? (
        <div className="friends-add-panel">
          <h3>Add friend</h3>
          <p className="muted">
            Send a request with their username.
          </p>
          <form className="friends-add-form" onSubmit={(e) => void onAdd(e)}>
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
                setMsg(null);
              }}
              placeholder="@username"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !username.trim()}
            >
              {busy ? "Sending…" : "Send request"}
            </button>
          </form>
          {error && <p className="form-error">{error}</p>}
          {msg && <p className="muted">{msg}</p>}
        </div>
      ) : tab === "pending" ? (
        <div className="friends-home-body">
          {pendingInbound.length === 0 && pendingOutbound.length === 0 ? (
            <p className="friends-home-empty muted">
              No pending friend requests.
            </p>
          ) : (
            <>
              {pendingInbound.length > 0 && (
                <section className="friends-section">
                  <h3>Incoming — {pendingInbound.length}</h3>
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
                  <h3>Outgoing — {pendingOutbound.length}</h3>
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
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => void declineFriend(f.id)}
                        >
                          Cancel
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="friends-home-body">
          <label className="friends-home-search" htmlFor="friends-home-search">
            <input
              id="friends-home-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search friends"
              aria-label="Search friends"
            />
          </label>

          <section className="friends-section">
            <h3>
              {tab === "online" ? "Online" : "All friends"} —{" "}
              {listFriends.length}
            </h3>
            {listFriends.length === 0 ? (
              <p className="friends-home-empty muted">
                {tab === "online"
                  ? "No friends are online right now."
                  : "No friends yet. Use Add to send a request."}
              </p>
            ) : (
              <ul className="friends-list">
                {listFriends.map((f) => {
                  const status = presenceFor(f.peer.id);
                  return (
                    <li key={f.id} className="friends-row">
                      <button
                        type="button"
                        className="friends-peer clickable"
                        onClick={() => void openDmWithPeer(f.peer.id)}
                        onContextMenu={(e: MouseEvent) => {
                          e.preventDefault();
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            friendship: f,
                          });
                        }}
                      >
                        <FriendAvatar user={f.peer} status={status} />
                        <div>
                          <strong>
                            {f.peer.display_name}
                            {f.muted ? (
                              <span className="muted friends-mute-tag">
                                {" "}
                                muted
                              </span>
                            ) : null}
                          </strong>
                          <span className="muted">{statusLabel(status)}</span>
                        </div>
                      </button>
                      <div className="friends-actions">
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => void openDmWithPeer(f.peer.id)}
                        >
                          Message
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="More"
                          onClick={(e) => {
                            const rect = (
                              e.currentTarget as HTMLButtonElement
                            ).getBoundingClientRect();
                            setMenu({
                              x: rect.left,
                              y: rect.bottom + 4,
                              friendship: f,
                            });
                          }}
                        >
                          ···
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </main>
  );
}
