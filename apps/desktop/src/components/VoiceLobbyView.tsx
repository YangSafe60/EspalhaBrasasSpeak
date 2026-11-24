import { WatchTogether } from "./WatchTogether";
import { ActivitiesButton, RunningActivityCard, type ActivityId } from "./VoiceActivities";
import { loadWatch } from "../lib/watchTogether";
import { useEffect, useMemo, useState } from "react";
import type { useVoice } from "../hooks/useVoice";
import { useLobbyPreview } from "../hooks/useLobbyPreview";
import { openScreenPopout } from "../lib/popout";
import { mediaCssUrl } from "../lib/mediaUrl";
import { livekitUserId } from "../lib/screenPublisher";
import { sameId } from "../lib/serverPerms";
import { useAppStore } from "../store/appStore";
import { useMemberContextMenu } from "./MemberUserMenu";
import { VoiceChannelIcon } from "./VoiceChannelIcon";
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

/** Voice channel lobby: stage (screen shares) + connected member grid. */
export function VoiceLobbyView({ voice }: Props) {
  useLobbyPreview();
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const channelsByServer = useAppStore((s) => s.channelsByServer);
  const voiceStates = useAppStore((s) => s.voiceStates);
  const membersByServer = useAppStore((s) => s.membersByServer);
  const authors = useAppStore((s) => s.authors);
  const user = useAppStore((s) => s.user);
  const activeServerId = useAppStore((s) => s.activeServerId);
  const openMiniProfile = useAppStore((s) => s.openMiniProfile);
  const [popoutBusy, setPopoutBusy] = useState<string | null>(null);
  const [popoutError, setPopoutError] = useState<string | null>(null);
  // The activity I have open in this channel (Discord-style "Activities").
  const [activity, setActivityState] = useState<ActivityId | null>(null);
  // With a live and an activity at once: which one is big (the other is small on the side).
  const [focus, setFocus] = useState<"stage" | "activity">("activity");
  const setActivity = (id: ActivityId | null) => {
    setActivityState(id);
    if (id) setFocus("activity");
  };
  const { openForUserId, menuPortal } = useMemberContextMenu({
    applyUserMic: voice.applyUserMic,
    applyUserVideoHide: voice.applyUserVideoHide,
  });

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

  const connectedChannelId =
    voice.connected && channel && voice.voiceChannelId === channel.id ? channel.id : null;
  // A different channel: close the activity; load what this one is watching.
  useEffect(() => {
    setActivityState(null);
    if (connectedChannelId) {
      void loadWatch(connectedChannelId, "watch");
      void loadWatch(connectedChannelId, "listen");
    }
  }, [connectedChannelId]);

  if (!channel || channel.channel_type !== "voice") return null;

  const connectedHere =
    voice.voiceChannelId === channel.id &&
    (voice.connected || voice.joining);
  const selfConnected = voice.connected && voice.voiceChannelId === channel.id;
  const otherScreens = voice.remoteScreens.filter(
    (s) => !sameId(livekitUserId(s.participantIdentity), user?.id),
  );
  const hasStage =
    connectedHere &&
    (voice.localScreens.length > 0 || otherScreens.length > 0);
  const streamCount = voice.localScreens.length + otherScreens.length;
  // A live and an activity at the same time: one big, the other small beside it.
  const split = hasStage && selfConnected && activity !== null;

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
    <main className="voice-lobby">
      <header className="voice-lobby-header">
        <div>
          <p className="voice-lobby-eyebrow">Voice channel</p>
          <h2>
            <span className="ch-icon">
              <VoiceChannelIcon size={18} />
            </span>{" "}
            {channel.name}
          </h2>
          <p className="muted tiny">
            {connectedHere
              ? `${lobbyUsers.length} connected`
              : "Join this lobby from the channel list to talk"}
          </p>
        </div>
        <div className="voice-lobby-header-actions">
          {selfConnected && <ActivitiesButton onPick={setActivity} />}
          {channel.user_limit > 0 && (
            <span className="voice-lobby-limit">
              {lobbyUsers.length}/{channel.user_limit}
            </span>
          )}
        </div>
      </header>

      <div className="voice-lobby-body">
        {popoutError && (
          <p className="form-error voice-lobby-popout-error">{popoutError}</p>
        )}
        <div className={`voice-stage-area${split ? ` is-split focus-${focus}` : ""}`}>
        {split && (
          <div className="stage-switch" role="tablist" aria-label="What to show big">
            <button
              type="button"
              role="tab"
              aria-selected={focus === "stage"}
              className={focus === "stage" ? "active" : ""}
              onClick={() => setFocus("stage")}
            >
              <span className="stage-switch-live">LIVE</span>
              {streamCount === 1 ? "Stream" : `Streams (${streamCount})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={focus === "activity"}
              className={focus === "activity" ? "active" : ""}
              onClick={() => setFocus("activity")}
            >
              {activity === "listen" ? "Listen Together" : "Watch Together"}
            </button>
          </div>
        )}
        {hasStage && (
          <section
            className={`voice-lobby-stage${split ? (focus === "stage" ? " is-main" : " is-side") : ""}`}
            onClickCapture={(e) => {
              // A click on the small side tiles brings the streams to the front.
              if (split && focus !== "stage") {
                e.stopPropagation();
                e.preventDefault();
                setFocus("stage");
              }
            }}
          >
            {voice.localScreens.map((s, i) => (
              <LobbyScreenTile
                voice={voice}
                key={s.trackSid}
                trackSid={s.trackSid}
                track={"track" in s ? s.track : null}
                useRelay={voice.isDesktop}
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
            {otherScreens.map((s) =>
              s.subscribed ? (
                <LobbyScreenTile
                voice={voice}
                  key={s.trackSid}
                  trackSid={s.trackSid}
                  track={s.track}
                  useRelay={voice.isDesktop}
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

        {selfConnected &&
          (activity ? (
            <div className={`voice-activity-slot${split ? (focus === "activity" ? " is-main" : " is-side") : ""}`}>
              <WatchTogether
                key={activity}
                kind={activity}
                channelId={channel.id}
                compact={split && focus !== "activity"}
                onExpand={() => setFocus("activity")}
                onClose={() => setActivity(null)}
              />
            </div>
          ) : (
            <RunningActivityCard channelId={channel.id} onJoin={setActivity} />
          ))}
        </div>

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
                  onClick={(e) =>
                    openMiniProfile({
                      userId: u.user_id,
                      serverId: activeServerId,
                      x: e.clientX,
                      y: e.clientY,
                    })
                  }
                  onContextMenu={
                    u.isSelf
                      ? undefined
                      : (e) => openForUserId(e, u.user_id, u.name)
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
                      {/* Your voice state reaches the server before the voice
                          connection is up: say so until it really is. */}
                      {u.isSelf && !selfConnected ? (
                        <span className="waiting">Connecting…</span>
                      ) : (
                        !u.muted &&
                        !u.deafened &&
                        !u.streaming && <span className="ok">Connected</span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {menuPortal}
    </main>
  );
}
