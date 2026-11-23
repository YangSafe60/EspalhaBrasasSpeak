import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { DmInvite } from "../lib/inviteMessage";
import { useAppStore } from "../store/appStore";
import type { Channel, Member, PresenceStatus } from "../types";
import { ServerInviteCard } from "./ServerInviteCard";

type Info = { members: number; online: number; channel: Channel | null };

/** One fetch per server for every card showing it (cached for a minute). */
const cache = new Map<string, { at: number; p: Promise<Info> }>();

function loadInfo(serverId: string, channelId: string | null): Promise<Info> {
  const key = `${serverId}:${channelId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.p;
  const p = Promise.all([
    api<Member[]>(`/api/servers/${serverId}/members`),
    api<{ user_id: string; status: PresenceStatus }[]>(`/api/servers/${serverId}/presence`).catch(() => []),
    channelId ? api<Channel[]>(`/api/servers/${serverId}/channels`).catch(() => [] as Channel[]) : Promise.resolve([] as Channel[]),
  ]).then(([members, presence, channels]) => {
    const ids = new Set(members.map((m) => m.user.id));
    return {
      members: members.length,
      online: presence.filter((p) => ids.has(p.user_id) && p.status !== "offline").length,
      channel: channels.find((c) => c.id === channelId) ?? null,
    };
  });
  p.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), p });
  return p;
}

/**
 * An invite sent in a DM (see lib/inviteMessage). The invite already made
 * the person a member, so the button just takes them there.
 */
export function DmInviteCard({ invite, authorName, mine }: { invite: DmInvite; authorName: string; mine: boolean }) {
  const server = useAppStore((s) => s.servers.find((x) => x.id === invite.serverId));
  const cachedChannel = useAppStore((s) =>
    invite.kind === "channel" ? (s.channelsByServer[invite.serverId] || []).find((c) => c.id === invite.channelId) : undefined,
  );
  const selectServer = useAppStore((s) => s.selectServer);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const requestVoiceJoin = useAppStore((s) => s.requestVoiceJoin);
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!server) return;
    let alive = true;
    loadInfo(invite.serverId, invite.kind === "channel" ? invite.channelId : null)
      .then((i) => alive && setInfo(i))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [server, invite]);

  if (!server) {
    return (
      <div className="dm-invite-gone">
        <strong>Invite unavailable</strong>
        <span className="muted tiny">You're not in this server anymore, or it was deleted.</span>
      </div>
    );
  }

  const channel = cachedChannel ?? info?.channel ?? null;
  const name =
    invite.kind === "server"
      ? server.name
      : channel
        ? channel.channel_type === "voice"
          ? channel.name
          : `#${channel.name}`
        : "Channel";

  async function go() {
    setBusy(true);
    try {
      await selectServer(invite.serverId);
      if (invite.kind === "channel") {
        // After selectServer the channel list is loaded, so the type is known.
        const ch =
          (useAppStore.getState().channelsByServer[invite.serverId] || []).find((c) => c.id === invite.channelId) ??
          channel;
        if (ch?.channel_type === "voice") {
          // Same path as clicking the channel in the sidebar (asks for the
          // mic the first time, then joins).
          requestVoiceJoin(invite.channelId);
        } else {
          await selectChannel(invite.channelId);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const isVoice = invite.kind === "channel" && channel?.channel_type === "voice";

  return (
    <div className="dm-invite">
      <span className="dm-invite-label">
        {mine
          ? invite.kind === "server"
            ? "You sent an invite to join a server"
            : "You sent an invite to join a channel"
          : invite.kind === "server"
            ? "You've been invited to join a server"
            : "You've been invited to join a channel"}
      </span>
      <ServerInviteCard
        name={name}
        iconUrl={server.icon_url}
        bannerUrl={server.banner_url || server.invite_splash_url}
        accentColor={server.accent_color}
        memberCount={info?.members ?? 0}
        onlineCount={info?.online ?? 0}
        createdAt={server.created_at}
        ctaLabel={invite.kind === "server" ? "Go to Server" : isVoice ? "Join Voice" : "Go to Channel"}
        onCta={() => void go()}
        ctaBusy={busy}
        footer={invite.kind === "channel" ? `${server.name} · invited by ${mine ? "you" : authorName}` : `Invited by ${mine ? "you" : authorName}`}
      />
    </div>
  );
}
