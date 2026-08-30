import { useEffect, useMemo, useState } from "react";
import { copyText } from "../lib/clipboard";
import { mediaUrl } from "../lib/mediaUrl";
import { useAppStore } from "../store/appStore";
import type { UserPublic } from "../types";
import { ServerInviteCard } from "./ServerInviteCard";

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
        src={mediaUrl(fresh.avatar_url)}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }
  return <span className="friends-avatar placeholder">{initial}</span>;
}

function InviteTargetRow({
  target,
  inviting,
  showMemberBadge,
  onInvite,
}: {
  target: InviteTarget;
  inviting: boolean;
  showMemberBadge: boolean;
  onInvite: () => void;
}) {
  const presence = useAppStore((s) => s.presenceByUser[target.id]);
  const displayName = target.user.display_name || target.user.username;

  return (
    <div className="invite-target-row">
      <div className="invite-target-user">
        <div className="friends-avatar-wrap sm">
          <FriendAvatar user={target.user} />
          {presence ? (
            <span
              className={`friends-status-dot status-${presence}`}
              aria-hidden
            />
          ) : null}
        </div>
        <div className="invite-target-meta">
          <strong>{displayName}</strong>
          <span className="invite-target-sub">@{target.user.username}</span>
        </div>
        {showMemberBadge && target.kind === "member" ? (
          <span className="invite-target-badge">Member</span>
        ) : null}
      </div>
      <button
        type="button"
        className="invite-target-btn"
        disabled={inviting}
        onClick={onInvite}
      >
        {inviting ? "Sending…" : "Invite"}
      </button>
    </div>
  );
}

type InviteTarget = {
  id: string;
  user: UserPublic;
  kind: "friend" | "member";
};

export function InvitePeopleModal() {
  const modal = useAppStore((s) => s.modal);
  const setModal = useAppStore((s) => s.setModal);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const inviteChannelId = useAppStore((s) => s.inviteChannelId);
  const servers = useAppStore((s) => s.servers);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const friends = useAppStore((s) => s.friends);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const presenceByUser = useAppStore((s) => s.presenceByUser);
  const user = useAppStore((s) => s.user);
  const loadFriends = useAppStore((s) => s.loadFriends);
  const createInvite = useAppStore((s) => s.createInvite);
  const inviteFriend = useAppStore((s) => s.inviteFriend);
  const inviteToChannel = useAppStore((s) => s.inviteToChannel);

  const [query, setQuery] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const server = servers.find((s) => s.id === activeServerId);
  const channel = inviteChannelId
    ? (activeServerId ? channelsByServer[activeServerId] || [] : []).find(
        (c) => c.id === inviteChannelId,
      )
    : undefined;
  const members = activeServerId ? membersByServer[activeServerId] || [] : [];
  const memberIds = useMemo(
    () => new Set(members.map((m) => m.user.id)),
    [members],
  );
  const onlineCount = useMemo(
    () =>
      members.filter((m) => {
        const st = presenceByUser[m.user.id];
        return st && st !== "offline";
      }).length,
    [members, presenceByUser],
  );

  const inviteable = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (u: UserPublic) => {
      if (!q) return true;
      const name = (u.display_name || "").toLowerCase();
      const uname = u.username.toLowerCase();
      return name.includes(q) || uname.includes(q);
    };

    const targets: InviteTarget[] = [];

    if (channel) {
      for (const f of friends) {
        if (invitedIds.has(f.peer.id) || memberIds.has(f.peer.id)) continue;
        if (!matches(f.peer)) continue;
        targets.push({ id: f.peer.id, user: f.peer, kind: "friend" });
      }
      for (const m of members) {
        if (m.user.id === user?.id || invitedIds.has(m.user.id)) continue;
        if (!matches(m.user)) continue;
        targets.push({ id: m.user.id, user: m.user, kind: "member" });
      }
    } else {
      for (const f of friends) {
        if (memberIds.has(f.peer.id) || invitedIds.has(f.peer.id)) continue;
        if (!matches(f.peer)) continue;
        targets.push({ id: f.peer.id, user: f.peer, kind: "friend" });
      }
    }

    return targets.sort((a, b) =>
      (a.user.display_name || a.user.username).localeCompare(
        b.user.display_name || b.user.username,
      ),
    );
  }, [friends, members, memberIds, invitedIds, query, channel, user?.id]);

  useEffect(() => {
    if (modal !== "invite-people") return;
    setQuery("");
    setInviteCode(null);
    setCopied(false);
    setError(null);
    setInvitingId(null);
    setInvitedIds(new Set());
    void loadFriends();
  }, [modal, inviteChannelId, loadFriends]);

  if (modal !== "invite-people" || !activeServerId || !server) return null;
  if (inviteChannelId && !channel) return null;

  const cardName = channel
    ? channel.channel_type === "voice"
      ? channel.name
      : `#${channel.name}`
    : server.name;

  async function ensureInviteCode(): Promise<string> {
    if (inviteCode) return inviteCode;
    setLinkBusy(true);
    try {
      const inv = await createInvite(activeServerId!, {
        max_age: 60 * 60 * 24,
        max_uses: null,
      });
      setInviteCode(inv.code);
      return inv.code;
    } finally {
      setLinkBusy(false);
    }
  }

  async function onCopyLink() {
    setError(null);
    try {
      const code = await ensureInviteCode();
      await copyText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create invite");
    }
  }

  async function onInvite(userId: string) {
    setError(null);
    setInvitingId(userId);
    try {
      if (channel) {
        await inviteToChannel(channel.id, userId);
      } else {
        await inviteFriend(activeServerId!, userId);
      }
      setInvitedIds((prev) => new Set(prev).add(userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInvitingId(null);
    }
  }

  const emptyMsg = channel
    ? query.trim()
      ? "No one matches that search."
      : "No one left to invite — try friends who aren't in the server yet."
    : friends.length === 0
      ? "Add friends first, then invite them here."
      : query.trim()
        ? "No friends match that search."
        : "All your friends are already in this server.";

  return (
    <div className="modal-backdrop" onClick={() => setModal(null)}>
      <div
        className="modal invite-people-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>
            {channel
              ? `Invite people to ${channel.channel_type === "voice" ? "" : "#"}${channel.name}`
              : `Invite people to ${server.name}`}
          </h3>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setModal(null)}
          >
            ✕
          </button>
        </header>

        <div className="stack invite-people-body">
          <ServerInviteCard
            name={cardName}
            iconUrl={server.icon_url}
            bannerUrl={server.banner_url || server.invite_splash_url}
            accentColor={server.accent_color}
            memberCount={members.length}
            onlineCount={onlineCount}
            createdAt={server.created_at}
            ctaLabel={
              channel
                ? "Join Channel"
                : copied
                  ? "Copied!"
                  : "Copy Invite"
            }
            onCta={channel ? undefined : () => void onCopyLink()}
            ctaBusy={linkBusy}
            ctaDisabled={Boolean(channel)}
            footer={channel ? server.name : null}
          />

          <label className="invite-people-search">
            <span className="invite-people-search-label">
              {channel ? "Search friends & members" : "Search friends"}
            </span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={channel ? "Find someone" : "Find a friend"}
            />
          </label>

          <div className="invite-people-list">
            {inviteable.length === 0 ? (
              <p className="invite-people-empty">{emptyMsg}</p>
            ) : (
              inviteable.map((t) => (
                <InviteTargetRow
                  key={t.id}
                  target={t}
                  inviting={invitingId === t.id}
                  showMemberBadge={Boolean(channel)}
                  onInvite={() => void onInvite(t.id)}
                />
              ))
            )}
          </div>

          {!channel && inviteCode ? (
            <p className="muted invite-people-code-hint">
              Invite code: <code>{inviteCode}</code>
            </p>
          ) : null}

          {error && <p className="form-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
