import { useAppStore } from "../store/appStore";
import { ServerInviteCard } from "./ServerInviteCard";

export function ServerInviteReceivedModal() {
  const invite = useAppStore((s) => s.pendingServerInvite);
  const clear = useAppStore((s) => s.clearPendingServerInvite);
  const selectServer = useAppStore((s) => s.selectServer);

  if (!invite) return null;

  const by =
    invite.invited_by.display_name || invite.invited_by.username || "a friend";

  async function onGo() {
    const serverId = invite!.server.id;
    clear();
    await selectServer(serverId);
  }

  return (
    <div className="modal-backdrop" onClick={clear}>
      <div
        className="modal join-invite-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>You&apos;ve been invited</h3>
          <button type="button" className="icon-btn" onClick={clear}>
            ✕
          </button>
        </header>
        <ServerInviteCard
          name={invite.server.name}
          iconUrl={invite.server.icon_url}
          bannerUrl={
            invite.server.banner_url || invite.server.invite_splash_url
          }
          accentColor={invite.server.accent_color}
          memberCount={invite.member_count}
          onlineCount={invite.online_count}
          createdAt={invite.server.created_at}
          ctaLabel="Go to Server"
          onCta={() => void onGo()}
          footer={`Invited by ${by}`}
        />
      </div>
    </div>
  );
}
