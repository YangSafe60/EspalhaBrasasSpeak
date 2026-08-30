import { useMemo, useState } from "react";
import type { useVoice } from "../hooks/useVoice";
import { openScreenPopout } from "../lib/popout";
import { mediaCssUrl } from "../lib/mediaUrl";
import { sameId } from "../lib/serverPerms";
import { useAppStore } from "../store/appStore";
import { LobbyScreenInvite } from "./voice/LobbyScreenInvite";
import { LobbyScreenTile } from "./voice/LobbyScreenTile";

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

/** Private DM voice call lobby — same layout as server voice channels. */
export function DmCallLobbyView({ voice }: Props) {
  const dmCallId = useAppStore((s) => s.dmCallId);
  const dmCallByChannel = useAppStore((s) => s.dmCallByChannel);
  const dmChannels = useAppStore((s) => s.dmChannels);
  const authors = useAppStore((s) => s.authors);
  const user = useAppStore((s) => s.user);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const [popoutBusy, setPopoutBusy] = useState<string | null>(null);
  const [popoutError, setPopoutError] = useState<string | null>(null);

  const dm = useMemo(
    () => dmChannels.find((d) => dmCallId && sameId(d.id, dmCallId)),
    [dmCallId, dmChannels],
  );

  const lobbyUsers: LobbyUser[] = useMemo(() => {
    if (!dmCallId || !dm || !user) return [];

    const byId = new Map<string, LobbyUser>();
    const participants = dmCallByChannel[dmCallId] || [];

    for (const p of participants) {
      const isSelf = sameId(p.user_id, user.id);
      const author = isSelf
        ? user
        : sameId(p.user_id, dm.peer.id)
          ? dm.peer
          : authors[p.user_id];
      byId.set(p.user_id, {
        user_id: p.user_id,
        name:
          author?.display_name ||
          (isSelf ? user.display_name : dm.peer.display_name),
        avatar: author?.avatar_url ?? null,
        muted: isSelf ? voice.muted : p.muted,
        deafened: isSelf ? voice.deafened : p.deafened,
        streaming: isSelf
          ? voice.localScreens.length > 0
          : p.streaming,
        isSelf,
      });
    }

    const inCall =
      voice.dmCallId &&
      sameId(voice.dmCallId, dmCallId) &&
      (voice.connected || voice.joining);

    if (inCall && !byId.has(user.id)) {
      byId.set(user.id, {
        user_id: user.id,
        name: user.display_name,
        avatar: user.avatar_url,
        muted: voice.muted,
        deafened: voice.deafened,
        streaming: voice.localScreens.length > 0,
        isSelf: true,
      });
    }

    if (
      inCall &&
      voice.connected &&
      !byId.has(dm.peer.id) &&
      !participants.some((p) => sameId(p.user_id, dm.peer.id))
    ) {
      byId.set(dm.peer.id, {
        user_id: dm.peer.id,
        name: dm.peer.display_name,
        avatar: dm.peer.avatar_url,
        muted: false,
        deafened: false,
        streaming: false,
        isSelf: false,
      });
    }

    return Array.from(byId.values());
  }, [
    authors,
    dm,
    dmCallByChannel,
    dmCallId,
    user,
    voice.connected,
    voice.deafened,
    voice.dmCallId,
    voice.joining,
    voice.localScreens.length,
    voice.muted,
  ]);

  if (!dm || !dmCallId) return null;

  const connectedHere =
    voice.dmCallId &&
    sameId(voice.dmCallId, dmCallId) &&
    (voice.connected || voice.joining);
  const hasStage =
    connectedHere &&
    (voice.localScreens.length > 0 || voice.remoteScreens.length > 0);
  const participants = dmCallByChannel[dmCallId] || [];
  const peerJoined = participants.some(
    (p) => !sameId(p.user_id, user?.id),
  );

  async function openPopout(trackSid: string, title: string) {
    setPopoutBusy(trackSid);
    setPopoutError(null);
    try {
      await openScreenPopout({ trackSid, title });
    } catch (e) {
      setPopoutError(
        e instanceof Error ? e.message : "Could not open pop-out window",
      );
    } finally {
      setPopoutBusy(null);
    }
  }

  return (
    <main className="voice-lobby dm-call-lobby">
      <header className="voice-lobby-header">
        <div>
          <p className="voice-lobby-eyebrow">Private call</p>
          <h2>
            <span className="dm-call-lobby-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.85 21 3 13.15 3 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.24 1.01l-2.2 2.2z" />
              </svg>
            </span>{" "}
            {dm.peer.display_name}
          </h2>
          <p className="muted tiny">
            {voice.joining && !voice.connected
              ? "Connecting…"
              : connectedHere
                ? peerJoined
                  ? `${lobbyUsers.length} in call`
                  : `Waiting for ${dm.peer.display_name} to join…`
                : "Start the call from the chat header"}
          </p>
        </div>
      </header>

      <div className="voice-lobby-body">
        {popoutError && (
          <p className="form-error voice-lobby-popout-error">{popoutError}</p>
        )}
        {hasStage && (
          <section className="voice-lobby-stage">
            {voice.localScreens.map((s, i) => (
              <LobbyScreenTile
                key={s.trackSid}
                trackSid={s.trackSid}
                track={"track" in s ? s.track : null}
                relayFrame={
                  "lobbyFrames" in voice
                    ? voice.lobbyFrames[s.trackSid]
                    : undefined
                }
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
              s.subscribed ? (
                <LobbyScreenTile
                  key={s.trackSid}
                  trackSid={s.trackSid}
                  track={s.track}
                  relayFrame={
                    "lobbyFrames" in voice
                      ? voice.lobbyFrames[s.trackSid]
                      : undefined
                  }
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
          <h3>In call</h3>
          {lobbyUsers.length === 0 ? (
            <p className="muted">Connecting to the call…</p>
          ) : (
            <div className="voice-lobby-grid">
              {lobbyUsers.map((u) => (
                <div
                  key={u.user_id}
                  className={`voice-lobby-tile${u.streaming ? " live" : ""}${u.isSelf ? " self" : ""}${voice.speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                  onClick={(e) =>
                    openMiniProfile({
                      userId: u.user_id,
                      serverId: null,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                >
                  <div
                    className={`voice-lobby-tile-avatar${voice.speakingIds.includes(u.user_id) ? " speaking" : ""}`}
                    style={
                      u.avatar
                        ? { backgroundImage: mediaCssUrl(u.avatar) }
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
                      {!u.isSelf &&
                      connectedHere &&
                      voice.connected &&
                      !participants.some((p) => sameId(p.user_id, u.user_id)) ? (
                        <span className="waiting">Ringing…</span>
                      ) : null}
                      {!u.muted &&
                        !u.deafened &&
                        !u.streaming &&
                        (u.isSelf ||
                          participants.some((p) => sameId(p.user_id, u.user_id))) && (
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
