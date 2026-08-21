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
    connectedHere &&
    (voice.localScreens.length > 0 || voice.remoteScreens.length > 0);

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
            {voice.localScreens.map((s, i) => (
              <LobbyScreenTile
                key={s.trackSid}
                track={s.track}
                name={
                  voice.localScreens.length > 1
                    ? `Screen share ${i + 1}`
                    : "Your screen"
                }
                badge="You"
                busy={popoutBusy === s.trackSid}
                onPopout={() =>
                  void openPopout(
                    s.trackSid,
                    voice.localScreens.length > 1
                      ? `Screen share ${i + 1}`
                      : "Your screen",
                  )
                }
                hoverActionLabel="Stop sharing"
                onHoverAction={() => {
                  void voice.stopLocalShare({
                    sourceId: s.sourceId,
                    trackSid: s.trackSid,
                  });
                }}
              />
            ))}
            {voice.remoteScreens.map((s) =>
              s.subscribed && s.track ? (
                <LobbyScreenTile
                  key={s.trackSid}
                  track={s.track}
                  name={s.participantName}
                  busy={popoutBusy === s.trackSid}
                  onPopout={() =>
                    void openPopout(
                      s.trackSid,
                      `${s.participantName}'s screen`,
                    )
                  }
                  hoverActionLabel="Leave stream"
                  onHoverAction={() => voice.leaveRemoteScreen(s.trackSid)}
                  audioControls={
                    s.hasAudio
                      ? {
                          volume:
                            voice.shareAudioByTrack[s.trackSid]?.volume ?? 1,
                          muted:
                            voice.shareAudioByTrack[s.trackSid]?.muted ?? false,
                          onVolume: (v) =>
                            voice.setScreenShareVolume(s.trackSid, v),
                          onMute: (m) =>
                            voice.setScreenShareMuted(s.trackSid, m),
                        }
                      : undefined
                  }
                />
              ) : (
                <LobbyScreenInvite
                  key={s.trackSid}
                  name={s.participantName}
                  onJoin={() => voice.joinRemoteScreen(s.trackSid)}
                />
              ),
            )}
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
                    style={
                      u.avatar
                        ? { backgroundImage: `url(${u.avatar})` }
                        : undefined
                    }
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

function LobbyScreenInvite({
  name,
  onJoin,
}: {
  name: string;
  onJoin: () => void;
}) {
  return (
    <div className="lobby-screen-tile lobby-screen-invite">
      <div className="lobby-screen-invite-body">
        <p className="lobby-screen-invite-label">{name} is sharing</p>
        <p className="muted tiny">Join the stream to watch</p>
        <button type="button" className="btn primary sm" onClick={onJoin}>
          Join stream
        </button>
      </div>
    </div>
  );
}

function LobbyScreenTile({
  track,
  name,
  badge,
  busy,
  onPopout,
  hoverActionLabel,
  onHoverAction,
  audioControls,
}: {
  track: {
    attach: (el: HTMLMediaElement) => void;
    detach: (el?: HTMLMediaElement) => void;
  };
  name: string;
  badge?: string;
  busy: boolean;
  onPopout: () => void;
  hoverActionLabel: string;
  onHoverAction: () => void;
  audioControls?: {
    volume: number;
    muted: boolean;
    onVolume: (v: number) => void;
    onMute: (muted: boolean) => void;
  };
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(document.fullscreenElement === tileRef.current);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  async function toggleFullscreen() {
    const el = tileRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* fullscreen may be blocked */
    }
  }

  return (
    <div className="lobby-screen-tile" ref={tileRef}>
      <video ref={ref} autoPlay playsInline muted />
      <div className="lobby-screen-hover">
        <button
          type="button"
          className="btn danger sm lobby-screen-hover-btn"
          onClick={onHoverAction}
        >
          {hoverActionLabel}
        </button>
      </div>
      <div className="lobby-screen-meta">
        <span>
          {badge && <em className="you-badge">{badge}</em>}
          {name}
        </span>
        <div className="lobby-screen-meta-actions">
          {audioControls && (
            <div
              className="lobby-screen-audio"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`btn ghost sm lobby-screen-icon-btn${audioControls.muted ? " is-muted" : ""}`}
                title={audioControls.muted ? "Unmute stream audio" : "Mute stream audio"}
                aria-label={
                  audioControls.muted ? "Unmute stream audio" : "Mute stream audio"
                }
                onClick={() => audioControls.onMute(!audioControls.muted)}
              >
                {audioControls.muted ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"
                    />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                    />
                  </svg>
                )}
              </button>
              <input
                type="range"
                className="lobby-screen-volume"
                min={0}
                max={100}
                value={Math.round(audioControls.volume * 100)}
                aria-label="Stream audio volume"
                title="Stream volume"
                onChange={(e) =>
                  audioControls.onVolume(Number(e.target.value) / 100)
                }
              />
            </div>
          )}
          <button
            type="button"
            className="btn ghost sm lobby-screen-icon-btn"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="currentColor"
                  d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={onPopout}
          >
            {busy ? "…" : "Pop out"}
          </button>
        </div>
      </div>
    </div>
  );
}
