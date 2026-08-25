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
      <header className="friends-home-header">
        <div className="friends-home-title">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path
              fill="currentColor"
              d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
            />
          </svg>
          <h2>Friends</h2>
        </div>
        <nav className="friends-home-tabs" aria-label="Friends filters">
          {(
            [
              ["online", "Online"],
              ["all", "All"],
              ["pending", "Pending"],
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
          <button
            type="button"
            className={`friends-add-friend-btn${tab === "add" ? " on" : ""}`}
            onClick={() => onTabChange("add")}
          >
            Add Friend
          </button>
        </nav>
      </header>

      {tab === "add" ? (
        <div className="friends-add-panel">
          <h3>Add Friend</h3>
          <p className="muted">
            You can add friends with their SpeakApp username.
          </p>
          <form className="friends-add-form" onSubmit={(e) => void onAdd(e)}>
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
                setMsg(null);
              }}
              placeholder="Enter a username"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !username.trim()}
            >
              {busy ? "Sending…" : "Send Friend Request"}
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
                <section className="friends-home-section">
                  <h3>Incoming — {pendingInbound.length}</h3>
                  <ul className="friends-home-list">
                    {pendingInbound.map((f) => (
                      <li key={f.id} className="friends-home-row">
                        <div className="friends-home-peer">
                          <FriendAvatar user={f.peer} />
                          <div>
                            <strong>{f.peer.display_name}</strong>
                            <span className="muted">@{f.peer.username}</span>
                          </div>
                        </div>
                        <div className="friends-home-actions">
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
                            Ignore
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {pendingOutbound.length > 0 && (
                <section className="friends-home-section">
                  <h3>Outgoing — {pendingOutbound.length}</h3>
                  <ul className="friends-home-list">
                    {pendingOutbound.map((f) => (
                      <li key={f.id} className="friends-home-row">
                        <div className="friends-home-peer">
                          <FriendAvatar user={f.peer} />
                          <div>
                            <strong>{f.peer.display_name}</strong>
                            <span className="muted">
                              Outgoing Friend Request
                            </span>
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
          <label className="friends-home-search">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
              <path
                fill="currentColor"
                d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
              />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search friends"
            />
          </label>

          <section className="friends-home-section">
            <h3>
              {tab === "online" ? "Online" : "All friends"} —{" "}
              {listFriends.length}
            </h3>
            {listFriends.length === 0 ? (
              <p className="friends-home-empty muted">
                {tab === "online"
                  ? "No friends are online right now."
                  : "No friends yet. Add someone with Add Friend."}
              </p>
            ) : (
              <ul className="friends-home-list">
                {listFriends.map((f) => {
                  const status = presenceFor(f.peer.id);
                  return (
                    <li key={f.id} className="friends-home-row">
                      <button
                        type="button"
                        className="friends-home-peer clickable"
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
                      <div className="friends-home-actions">
                        <button
                          type="button"
                          className="friends-icon-action"
                          title="Message"
                          onClick={() => void openDmWithPeer(f.peer.id)}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="18"
                            height="18"
                            aria-hidden
                          >
                            <path
                              fill="currentColor"
                              d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="friends-icon-action"
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
                          <svg
                            viewBox="0 0 24 24"
                            width="18"
                            height="18"
                            aria-hidden
                          >
                            <path
                              fill="currentColor"
                              d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
                            />
                          </svg>
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
