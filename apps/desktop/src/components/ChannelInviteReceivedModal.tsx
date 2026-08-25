import { useAppStore } from "../store/appStore";
import { ServerInviteCard } from "./ServerInviteCard";

export function ChannelInviteReceivedModal() {
  const invite = useAppStore((s) => s.pendingChannelInvite);
  const clear = useAppStore((s) => s.clearPendingChannelInvite);
  const selectServer = useAppStore((s) => s.selectServer);
  const selectChannel = useAppStore((s) => s.selectChannel);

  if (!invite) return null;

  const by =
    invite.invited_by.display_name || invite.invited_by.username || "a friend";
  const channelLabel =
    invite.channel.channel_type === "voice"
      ? invite.channel.name
      : `#${invite.channel.name}`;

  async function onJoin() {
    const { server, channel } = invite!;
    clear();
    await selectServer(server.id);
    if (channel.channel_type === "text") {
      await selectChannel(channel.id);
    }
  }

  return (
    <div className="modal-backdrop" onClick={clear}>
      <div
        className="modal join-invite-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>Channel invite</h3>
          <button type="button" className="icon-btn" onClick={clear}>
            ✕
          </button>
        </header>
        <ServerInviteCard
          name={channelLabel}
          iconUrl={invite.server.icon_url}
          bannerUrl={
            invite.server.banner_url || invite.server.invite_splash_url
          }
          accentColor={invite.server.accent_color}
          memberCount={invite.member_count}
          onlineCount={invite.online_count}
          createdAt={invite.server.created_at}
          ctaLabel="Join Channel"
          onCta={() => void onJoin()}
          footer={`Invited by ${by} · ${invite.server.name}`}
        />
      </div>
    </div>
  );
}
