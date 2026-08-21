import { useEffect, useMemo, useRef, useState } from "react";
import type { useVoice } from "../hooks/useVoice";
import { openScreenPopout } from "../lib/popout";
import { useAppStore } from "../store/appStore";

type VoiceApi = ReturnType<typeof useVoice>;

type Props = {
  voice: VoiceApi;
};

type LobbyUser = {
  user_id: string;
  name: string;
  avatar: string | null;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  isSelf: boolean;
};

export function VoiceLobbyView({ voice }: Props) {
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const voiceStates = useAppStore((s) => s.voiceStates);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const authors = useAppStore((s) => s.authors);
  const user = useAppStore((s) => s.user);
  const [popoutBusy, setPopoutBusy] = useState<string | null>(null);

  const channel = useMemo(
    () =>
      Object.values(channelsByServer)
        .flat()
        .find((c) => c.id === activeChannelId),
    [activeChannelId, channelsByServer],
  );

  const lobbyUsers: LobbyUser[] = useMemo(() => {
    if (!activeChannelId) return [];
    return voiceStates
      .filter((v) => v.channel_id === activeChannelId)
      .map((v) => {
        const member = Object.values(membersByServer)
          .flat()
          .find((m) => m.user.id === v.user_id);
        const author = authors[v.user_id];
        const isSelf = v.user_id === user?.id;
        return {
          user_id: v.user_id,
          name:
            member?.nickname ||
            member?.user.display_name ||
            author?.display_name ||
            (isSelf ? user?.display_name : null) ||
            v.user_id.slice(0, 8),
          avatar:
            member?.user.avatar_url ||
            author?.avatar_url ||
            (isSelf ? user?.avatar_url : null) ||
            null,
          muted: v.muted,
          deafened: v.deafened,
          streaming: v.streaming,
          isSelf,
        };
      });
  }, [activeChannelId, authors, membersByServer, user, voiceStates]);

  if (!channel || channel.channel_type !== "voice") return null;

  const connectedHere = voice.voiceChannelId === channel.id;
  const hasStage =
    connectedHere && (!!voice.localScreen || voice.remoteScreens.length > 0);

  async function openPopout(trackSid: string, title: string) {
    setPopoutBusy(trackSid);
    try {
      await openScreenPopout({ trackSid, title });
    } finally {
      setPopoutBusy(null);
    }
  }

  return (
    <main className="voice-lobby">
      <header className="voice-lobby-header">
        <div>
          <p className="voice-lobby-eyebrow">Voice channel</p>
          <h2>
            <span className="ch-icon">◎</span> {channel.name}
          </h2>
          <p className="muted tiny">
            {connectedHere
              ? `${lobbyUsers.length} connected`
              : "Join this lobby from the channel list to talk"}
          </p>
        </div>
        {channel.user_limit > 0 && (
          <span className="voice-lobby-limit">
            {lobbyUsers.length}/{channel.user_limit}
          </span>
        )}
      </header>

      <div className="voice-lobby-body">
        {hasStage && (
          <section className="voice-lobby-stage">
            {voice.localScreen && (
              <LobbyScreenTile
                track={voice.localScreen.track}
                name="Your screen"
                badge="You"
                busy={popoutBusy === voice.localScreen.trackSid}
                onPopout={() =>
                  void openPopout(voice.localScreen!.trackSid, "Your screen")
                }
              />
            )}
            {voice.remoteScreens.map((s) => (
              <LobbyScreenTile
                key={s.trackSid}
                track={s.track}
                name={s.participantName}
                busy={popoutBusy === s.trackSid}
                onPopout={() =>
                  void openPopout(s.trackSid, `${s.participantName}'s screen`)
                }
              />
            ))}
          </section>
        )}

        <section className="voice-lobby-people">
          <h3>In lobby</h3>
          {lobbyUsers.length === 0 ? (
            <p className="muted">No one here yet. Be the first to join.</p>
          ) : (
            <div className="voice-lobby-grid">
              {lobbyUsers.map((u) => (
                <div
                  key={u.user_id}
                  className={`voice-lobby-tile${u.streaming ? " live" : ""}${u.isSelf ? " self" : ""}${voice.speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                >
                  <div
                    className={`voice-lobby-tile-avatar${voice.speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                    style={u.avatar ? { backgroundImage: `url(${u.avatar})` } : undefined}
                  >
                    {!u.avatar && (u.name.charAt(0) || "?").toUpperCase()}
                    {u.streaming && <span className="live-pill">LIVE</span>}
                  </div>
                  <div className="voice-lobby-tile-meta">
                    <strong>
                      {u.name}
                      {u.isSelf ? " (you)" : ""}
                    </strong>
                    <span className="voice-lobby-tile-flags">
                      {u.muted && <span title="Muted">Mic off</span>}
                      {u.deafened && <span title="Deafened">Deafened</span>}
                      {u.streaming && <span title="Sharing">Sharing</span>}
                      {!u.muted && !u.deafened && !u.streaming && (
                        <span className="ok">Connected</span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function LobbyScreenTile({
  track,
  name,
  badge,
  busy,
  onPopout,
}: {
  track: { attach: (el: HTMLMediaElement) => void; detach: (el?: HTMLMediaElement) => void };
  name: string;
  badge?: string;
  busy: boolean;
  onPopout: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return (
    <div className="lobby-screen-tile">
      <video ref={ref} autoPlay playsInline muted />
      <div className="lobby-screen-meta">
        <span>
          {badge && <em className="you-badge">{badge}</em>}
          {name}
        </span>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={onPopout}>
          {busy ? "…" : "Pop out"}
        </button>
      </div>
    </div>
  );
}
