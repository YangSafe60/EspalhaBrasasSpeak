import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLivekit,
  loadLivekit,
  type LocalTrack,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
} from "../lib/livekit";
import { api, getAccessToken, getApiBase } from "../api/client";
import {
  inputGainFromSettings,
  loadMediaSettings,
  outputGainFromSettings,
  subscribeMediaSettings,
  type MediaSettings,
} from "../lib/mediaSettings";
import {
  registerScreenTrack,
  unregisterScreenTrack,
  focusMainWindow,
} from "../lib/screenBridge";
import {
  captureElectronSource,
  isShareCancelError,
  isDesktopApp,
} from "../lib/screenShare";
import {
  playScreenShareStartSound,
  playScreenShareStopSound,
  playVoiceJoinSound,
  playVoiceLeaveSound,
} from "../lib/voiceSounds";
import { useAppStore } from "../store/appStore";
import type { VoiceTokenResponse } from "../types";

/** WebView2 often breaks ICE when the URL host is `localhost` (IPv6 ::1). */
function normalizeLivekitUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/\/localhost(?=[:/]|$)/i, "//127.0.0.1");
  }
}

/** WebView2 can block PeerConnection until getUserMedia has been granted. */
async function ensureMicPermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // User denied or no device — still attempt join (listen-only may work).
  }
}

export type RemoteScreen = {
  trackSid: string;
  participantIdentity: string;
  participantName: string;
  /** Present only after the viewer opts in (Join stream). */
  track: RemoteTrack | null;
  subscribed: boolean;
  /** Screen-share system/tab audio from the same participant, if any. */
  hasAudio: boolean;
  audioTrackSid: string | null;
};

export type ScreenShareAudioState = {
  volume: number;
  muted: boolean;
};

export type LocalScreen = {
  trackSid: string;
  track: LocalVideoTrack;
  /** Native share source id when known (`monitor:0`, `window:123`, …). */
  sourceId?: string;
  label: string;
};

async function applyDevicesToRoom(room: Room, settings: MediaSettings) {
  try {
    if (settings.inputDeviceId) {
      await room.switchActiveDevice("audioinput", settings.inputDeviceId);
    }
  } catch {
    /* device may be unavailable */
  }
  try {
    if (settings.outputDeviceId) {
      await room.switchActiveDevice("audiooutput", settings.outputDeviceId);
    }
  } catch {
    /* not all platforms support sinkId */
  }
  try {
    if (settings.cameraDeviceId) {
      await room.switchActiveDevice("videoinput", settings.cameraDeviceId);
    }
  } catch {
    /* optional */
  }

  const gain = inputGainFromSettings(settings);
  room.localParticipant.audioTrackPublications.forEach((pub) => {
    const track = pub.track;
    if (track && "setVolume" in track && typeof track.setVolume === "function") {
      track.setVolume(gain);
    }
  });

  const out = outputGainFromSettings(settings);
  room.remoteParticipants.forEach((p) => {
    p.audioTrackPublications.forEach((pub) => {
      if (pub.source === getLivekit().Track.Source.ScreenShareAudio) return;
      const track = pub.track;
      if (track && "setVolume" in track && typeof track.setVolume === "function") {
        track.setVolume(out);
      }
    });
  });
}

function collectScreenTracks(room: Room): LocalTrack[] {
  const tracks: LocalTrack[] = [];
  room.localParticipant.trackPublications.forEach((pub) => {
    if (
      (pub.source === getLivekit().Track.Source.ScreenShare ||
        pub.source === getLivekit().Track.Source.ScreenShareAudio) &&
      pub.track
    ) {
      tracks.push(pub.track);
    }
  });
  return tracks;
}

export function useVoice() {
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const muted = useAppStore((s) => s.muted);
  const deafened = useAppStore((s) => s.deafened);
  const setVoiceLocal = useAppStore((s) => s.setVoiceLocal);

  const roomRef = useRef<Room | null>(null);
  const voiceChannelIdRef = useRef<string | null>(voiceChannelId);
  const mutedRef = useRef(muted);
  const deafenedRef = useRef(deafened);
  const switchingRef = useRef(false);
  /** Suppress share start/stop chirps while replacing a share slot. */
  const replacingShareRef = useRef(false);
  /** Remote screen trackSids the local user opted into watching. */
  const watchingScreensRef = useRef(new Set<string>());
  /** Hidden <audio> elements for remote playback (mic + screen share). */
  const remoteAudioElsRef = useRef(new Map<string, HTMLMediaElement>());
  /** Per video trackSid: viewer volume/mute for that stream's share audio. */
  const shareAudioStateRef = useRef(
    new Map<string, ScreenShareAudioState>(),
  );
  const [shareAudioByTrack, setShareAudioByTrack] = useState<
    Record<string, ScreenShareAudioState>
  >({});

  const [connected, setConnected] = useState(false);
  const [remoteScreens, setRemoteScreens] = useState<RemoteScreen[]>([]);
  const [localScreens, setLocalScreens] = useState<LocalScreen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  /** sourceId -> stop() for each active Tauri capture */
  const shareStopsRef = useRef<Map<string, () => Promise<void>>>(new Map());
  const activeShareIdsRef = useRef<string[]>([]);
  const [activeShareIds, setActiveShareIds] = useState<string[]>([]);

  voiceChannelIdRef.current = voiceChannelId;
  mutedRef.current = muted;
  deafenedRef.current = deafened;
  activeShareIdsRef.current = activeShareIds;

  const syncLocalScreen = useCallback(
    (room: Room) => {
      const found: LocalScreen[] = [];
      room.localParticipant.trackPublications.forEach((pub) => {
        if (
          pub.source === getLivekit().Track.Source.ScreenShare &&
          pub.track &&
          pub.track.kind === getLivekit().Track.Kind.Video &&
          pub.trackSid
        ) {
          const media = pub.track.mediaStreamTrack;
          if (media) registerScreenTrack(pub.trackSid, media);
          const name = pub.trackName || "";
          const sourceId = name.startsWith("screen:")
            ? name.slice("screen:".length)
            : undefined;
          found.push({
            trackSid: pub.trackSid,
            track: pub.track as LocalVideoTrack,
            sourceId,
            label: "Screen share",
          });
        }
      });
      found.forEach((s, i) => {
        s.label =
          found.length > 1 ? `Screen share ${i + 1}` : "Screen share 1";
      });
      setLocalScreens(found);
      setVoiceLocal({ streaming: found.length > 0 });
    },
    [setVoiceLocal],
  );

  const refreshScreens = useCallback(
    (room: Room) => {
      const screens: RemoteScreen[] = [];
      const seen = new Set<string>();
      room.remoteParticipants.forEach((p) => {
        const audioPub = [...p.trackPublications.values()].find(
          (pub) => pub.source === getLivekit().Track.Source.ScreenShareAudio,
        );
        p.trackPublications.forEach((pub) => {
          if (
            pub.source !== getLivekit().Track.Source.ScreenShare ||
            pub.kind === getLivekit().Track.Kind.Audio ||
            !pub.trackSid
          ) {
            return;
          }
          seen.add(pub.trackSid);
          const optedIn = watchingScreensRef.current.has(pub.trackSid);
          if (!optedIn && pub.isSubscribed) {
            pub.setSubscribed(false);
          }
          const subscribed = optedIn && pub.isSubscribed && !!pub.track;
          if (subscribed) {
            const media = pub.track!.mediaStreamTrack;
            if (media) registerScreenTrack(pub.trackSid, media);
          } else {
            unregisterScreenTrack(pub.trackSid);
          }
          screens.push({
            trackSid: pub.trackSid,
            participantIdentity: p.identity,
            participantName: p.name || p.identity,
            track: subscribed ? (pub.track ?? null) : null,
            subscribed,
            hasAudio: Boolean(audioPub),
            audioTrackSid: audioPub?.trackSid ?? null,
          });
        });
      });
      setRemoteScreens((prev) => {
        for (const old of prev) {
          if (!seen.has(old.trackSid)) {
            unregisterScreenTrack(old.trackSid);
            shareAudioStateRef.current.delete(old.trackSid);
          }
        }
        return screens;
      });
      setShareAudioByTrack((prev) => {
        const next: Record<string, ScreenShareAudioState> = {};
        for (const s of screens) {
          next[s.trackSid] =
            shareAudioStateRef.current.get(s.trackSid) ??
            prev[s.trackSid] ?? { volume: 1, muted: false };
          shareAudioStateRef.current.set(s.trackSid, next[s.trackSid]);
        }
        return next;
      });
      syncLocalScreen(room);
    },
    [syncLocalScreen],
  );

  const detachRemoteAudio = useCallback((trackSid: string) => {
    const el = remoteAudioElsRef.current.get(trackSid);
    if (el) {
      el.remove();
      remoteAudioElsRef.current.delete(trackSid);
    }
  }, []);

  const attachRemoteAudio = useCallback(
    (
      track: RemoteTrack,
      pub: RemoteTrackPublication,
      volume = 1,
      muted = false,
    ) => {
      if (track.kind !== getLivekit().Track.Kind.Audio || !pub.trackSid) return;
      detachRemoteAudio(pub.trackSid);
      const el = track.attach();
      el.autoplay = true;
      el.setAttribute("data-lk-remote-audio", pub.trackSid);
      el.style.display = "none";
      document.body.appendChild(el);
      remoteAudioElsRef.current.set(pub.trackSid, el);
      if ("setVolume" in track && typeof track.setVolume === "function") {
        track.setVolume(muted ? 0 : volume);
      }
      if ("setMuted" in track && typeof track.setMuted === "function") {
        track.setMuted(muted || deafenedRef.current);
      }
      void el.play().catch(() => undefined);
    },
    [detachRemoteAudio],
  );

  const applyShareAudioToParticipant = useCallback(
    (participantIdentity: string, videoTrackSid: string) => {
      const room = roomRef.current;
      if (!room) return;
      const state = shareAudioStateRef.current.get(videoTrackSid) ?? {
        volume: 1,
        muted: false,
      };
      const p = room.getParticipantByIdentity(participantIdentity);
      if (!p) return;
      p.trackPublications.forEach((pub) => {
        if (pub.source !== getLivekit().Track.Source.ScreenShareAudio || !pub.track) return;
        const track = pub.track;
        if ("setVolume" in track && typeof track.setVolume === "function") {
          track.setVolume(state.muted ? 0 : state.volume);
        }
        if ("setMuted" in track && typeof track.setMuted === "function") {
          track.setMuted(state.muted || deafenedRef.current);
        }
      });
    },
    [],
  );

  /** Mic audio only — never auto-pull screen shares (viewer must Join). */
  const subscribeRemoteAudio = useCallback((pub: RemoteTrackPublication) => {
    if (
      pub.source === getLivekit().Track.Source.ScreenShare ||
      pub.source === getLivekit().Track.Source.ScreenShareAudio
    ) {
      return;
    }
    if (
      pub.source === getLivekit().Track.Source.Microphone ||
      pub.kind === getLivekit().Track.Kind.Audio
    ) {
      pub.setSubscribed(true);
    }
  }, []);

  const pullRemoteAudio = useCallback(
    (room: Room) => {
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => subscribeRemoteAudio(pub));
      });
    },
    [subscribeRemoteAudio],
  );

  const setRemoteScreenSubscribed = useCallback(
    (trackSid: string, subscribed: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      if (subscribed) {
        watchingScreensRef.current.add(trackSid);
      } else {
        watchingScreensRef.current.delete(trackSid);
      }
      room.remoteParticipants.forEach((p) => {
        const target = [...p.trackPublications.values()].find(
          (pub) => pub.trackSid === trackSid,
        );
        if (!target) return;
        if (
          target.source !== getLivekit().Track.Source.ScreenShare &&
          target.source !== getLivekit().Track.Source.ScreenShareAudio
        ) {
          return;
        }
        target.setSubscribed(subscribed);

        p.trackPublications.forEach((pub) => {
          if (pub.source !== getLivekit().Track.Source.ScreenShareAudio) return;
          if (subscribed) {
            pub.setSubscribed(true);
          } else {
            const stillWatching = [...p.trackPublications.values()].some(
              (v) =>
                v.source === getLivekit().Track.Source.ScreenShare &&
                v.kind !== getLivekit().Track.Kind.Audio &&
                v.trackSid !== trackSid &&
                watchingScreensRef.current.has(v.trackSid ?? ""),
            );
            if (!stillWatching) {
              pub.setSubscribed(false);
              if (pub.trackSid) detachRemoteAudio(pub.trackSid);
            }
          }
        });

        if (subscribed) {
          if (!shareAudioStateRef.current.has(trackSid)) {
            shareAudioStateRef.current.set(trackSid, {
              volume: 1,
              muted: false,
            });
          }
          // Attach any already-subscribed share audio.
          p.trackPublications.forEach((pub) => {
            if (
              pub.source === getLivekit().Track.Source.ScreenShareAudio &&
              pub.track &&
              pub.trackSid
            ) {
              const st = shareAudioStateRef.current.get(trackSid)!;
              attachRemoteAudio(pub.track, pub, st.volume, st.muted);
            }
          });
        }
      });
      refreshScreens(room);
    },
    [attachRemoteAudio, detachRemoteAudio, refreshScreens],
  );

  const joinRemoteScreen = useCallback(
    (trackSid: string) => setRemoteScreenSubscribed(trackSid, true),
    [setRemoteScreenSubscribed],
  );

  const leaveRemoteScreen = useCallback(
    (trackSid: string) => setRemoteScreenSubscribed(trackSid, false),
    [setRemoteScreenSubscribed],
  );

  const setScreenShareVolume = useCallback(
    (videoTrackSid: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const prev = shareAudioStateRef.current.get(videoTrackSid) ?? {
        volume: 1,
        muted: false,
      };
      const next = { ...prev, volume: clamped };
      shareAudioStateRef.current.set(videoTrackSid, next);
      setShareAudioByTrack((s) => ({ ...s, [videoTrackSid]: next }));
      const screen = remoteScreens.find((r) => r.trackSid === videoTrackSid);
      if (screen) {
        applyShareAudioToParticipant(screen.participantIdentity, videoTrackSid);
      }
    },
    [applyShareAudioToParticipant, remoteScreens],
  );

  const setScreenShareMuted = useCallback(
    (videoTrackSid: string, muted: boolean) => {
      const prev = shareAudioStateRef.current.get(videoTrackSid) ?? {
        volume: 1,
        muted: false,
      };
      const next = { ...prev, muted };
      shareAudioStateRef.current.set(videoTrackSid, next);
      setShareAudioByTrack((s) => ({ ...s, [videoTrackSid]: next }));
      const screen = remoteScreens.find((r) => r.trackSid === videoTrackSid);
      if (screen) {
        applyShareAudioToParticipant(screen.participantIdentity, videoTrackSid);
      }
    },
    [applyShareAudioToParticipant, remoteScreens],
  );

  /** Stop all screen shares and optionally halt the underlying capture tracks. */
  const endScreenShare = useCallback(
    async (room: Room | null, stopTracks: boolean) => {
      const stops = [...shareStopsRef.current.values()];
      shareStopsRef.current.clear();
      setActiveShareIds([]);
      await Promise.all(stops.map((stop) => stop().catch(() => undefined)));

      if (!room) {
        setLocalScreens([]);
        setVoiceLocal({ streaming: false });
        return;
      }
      const pubs = [
        ...room.localParticipant.trackPublications.values(),
      ] as LocalTrackPublication[];
      for (const pub of pubs) {
        if (
          pub.source !== getLivekit().Track.Source.ScreenShare &&
          pub.source !== getLivekit().Track.Source.ScreenShareAudio
        ) {
          continue;
        }
        if (pub.trackSid) unregisterScreenTrack(pub.trackSid);
        const track = pub.track;
        if (!track) continue;
        try {
          // stopOnUnpublish=false — capture/media already stopped above (or caller owns stop).
          await room.localParticipant.unpublishTrack(track, false);
        } catch {
          /* already gone */
        }
        if (stopTracks) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
      }
      setLocalScreens([]);
      setVoiceLocal({ streaming: false });
      try {
        await api("/api/voice/state", {
          method: "PUT",
          body: { streaming: false },
        });
      } catch {
        /* best effort */
      }
    },
    [setVoiceLocal],
  );

  const republishScreenTracks = useCallback(
    async (room: Room, tracks: LocalTrack[]) => {
      for (const track of tracks) {
        await room.localParticipant.publishTrack(track, {
          source:
            track.kind === getLivekit().Track.Kind.Audio
              ? getLivekit().Track.Source.ScreenShareAudio
              : getLivekit().Track.Source.ScreenShare,
          simulcast: false,
          videoEncoding:
            track.kind === getLivekit().Track.Kind.Video
              ? { maxBitrate: 8_000_000, maxFramerate: 30 }
              : undefined,
        });
      }
      syncLocalScreen(room);
      refreshScreens(room);
      if (tracks.length) {
        try {
          await api("/api/voice/state", {
            method: "PUT",
            body: { streaming: true },
          });
        } catch {
          /* best effort */
        }
      }
    },
    [refreshScreens, syncLocalScreen],
  );

  const leave = useCallback(async () => {
    const room = roomRef.current;
    const wasInVoice = !!room;
    roomRef.current = null;
    // Leaving the lobby entirely always ends the stream.
    await endScreenShare(room, true);
    setConnected(false);
    setRemoteScreens([]);
    setSpeakingIds([]);
    watchingScreensRef.current.clear();
    for (const sid of [...remoteAudioElsRef.current.keys()]) {
      detachRemoteAudio(sid);
    }
    shareAudioStateRef.current.clear();
    setShareAudioByTrack({});
    if (room) {
      await room.disconnect(true);
    }
    setVoiceLocal({ voiceChannelId: null, streaming: false });
    try {
      await api("/api/voice/state", {
        method: "PUT",
        body: { channel_id: null, streaming: false },
      });
    } catch {
      /* best effort */
    }
    if (wasInVoice && !deafenedRef.current && !switchingRef.current) {
      playVoiceLeaveSound();
    }
  }, [detachRemoteAudio, endScreenShare, setVoiceLocal]);

  const join = useCallback(
    async (channelId: string) => {
      if (voiceChannelIdRef.current === channelId && roomRef.current) {
        return;
      }

      setJoining(true);
      setError(null);

      const previousChannel = voiceChannelIdRef.current;
      const switching =
        !!roomRef.current && !!previousChannel && previousChannel !== channelId;

      let preservedScreen: LocalTrack[] = [];

      try {
        if (roomRef.current) {
          const oldRoom = roomRef.current;
          if (switching) {
            // Moving between lobbies: keep the capture, just hop rooms.
            switchingRef.current = true;
            preservedScreen = collectScreenTracks(oldRoom);
            for (const track of preservedScreen) {
              await oldRoom.localParticipant.unpublishTrack(track, false);
            }
            roomRef.current = null;
            setRemoteScreens([]);
            watchingScreensRef.current.clear();
            await oldRoom.disconnect(false);
          } else {
            // Replacing a stuck session — drop share.
            await endScreenShare(oldRoom, true);
            roomRef.current = null;
            setRemoteScreens([]);
            setLocalScreens([]);
            watchingScreensRef.current.clear();
            await oldRoom.disconnect(true);
          }
        }

        const creds = await api<VoiceTokenResponse>(
          `/api/channels/${channelId}/voice/token`,
          { method: "POST" },
        );
        const livekitUrl = normalizeLivekitUrl(creds.url);
        await ensureMicPermission();
        const settings = loadMediaSettings();
        const { Room } = await loadLivekit();
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            deviceId: settings.inputDeviceId || undefined,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
          },
          videoCaptureDefaults: {
            deviceId: settings.cameraDeviceId || undefined,
          },
          audioOutput: {
            deviceId: settings.outputDeviceId || undefined,
          },
        });
        roomRef.current = room;

        const onTrack = () => refreshScreens(room);
        const isScreenSharePub = (pub: {
          source: RemoteTrackPublication["source"];
          kind?: RemoteTrackPublication["kind"];
        }) =>
          pub.source === getLivekit().Track.Source.ScreenShare &&
          (pub.kind === undefined || pub.kind === getLivekit().Track.Kind.Video);

        const ensureScreenShareOptIn = (
          pub: RemoteTrackPublication,
          participant?: { trackPublications: Map<string, RemoteTrackPublication> },
        ) => {
          if (pub.source === getLivekit().Track.Source.ScreenShareAudio) {
            const watchingVideo = participant
              ? [...participant.trackPublications.values()].some(
                  (v) =>
                    v.source === getLivekit().Track.Source.ScreenShare &&
                    v.kind !== getLivekit().Track.Kind.Audio &&
                    watchingScreensRef.current.has(v.trackSid ?? ""),
                )
              : false;
            pub.setSubscribed(watchingVideo);
            return true;
          }
          if (pub.source === getLivekit().Track.Source.ScreenShare) {
            if (!watchingScreensRef.current.has(pub.trackSid ?? "")) {
              pub.setSubscribed(false);
            }
            return true;
          }
          return false;
        };

        room.on(getLivekit().RoomEvent.TrackSubscribed, (track, pub, participant) => {
          onTrack();
          if (track.kind !== getLivekit().Track.Kind.Audio) return;

          if (pub.source === getLivekit().Track.Source.ScreenShareAudio) {
            const videoSid = [...participant.trackPublications.values()].find(
              (v) =>
                v.source === getLivekit().Track.Source.ScreenShare &&
                v.kind !== getLivekit().Track.Kind.Audio &&
                watchingScreensRef.current.has(v.trackSid ?? ""),
            )?.trackSid;
            const st = videoSid
              ? (shareAudioStateRef.current.get(videoSid) ?? {
                  volume: 1,
                  muted: false,
                })
              : { volume: 1, muted: false };
            attachRemoteAudio(track, pub, st.volume, st.muted);
            return;
          }

          const out = outputGainFromSettings(loadMediaSettings());
          attachRemoteAudio(
            track,
            pub,
            out,
            deafenedRef.current,
          );
        });
        room.on(getLivekit().RoomEvent.TrackUnsubscribed, (track, pub) => {
          onTrack();
          if (pub.trackSid) detachRemoteAudio(pub.trackSid);
          try {
            track.detach();
          } catch {
            /* ignore */
          }
        });
        room.on(getLivekit().RoomEvent.TrackPublished, (pub, participant) => {
          if (!ensureScreenShareOptIn(pub, participant)) {
            subscribeRemoteAudio(pub);
          }
          onTrack();
          if (
            !deafenedRef.current &&
            !replacingShareRef.current &&
            isScreenSharePub(pub)
          ) {
            playScreenShareStartSound();
          }
        });
        room.on(getLivekit().RoomEvent.TrackUnpublished, (pub) => {
          if (pub.trackSid) {
            watchingScreensRef.current.delete(pub.trackSid);
            detachRemoteAudio(pub.trackSid);
          }
          onTrack();
          if (
            !deafenedRef.current &&
            !switchingRef.current &&
            !replacingShareRef.current &&
            isScreenSharePub(pub)
          ) {
            playScreenShareStopSound();
          }
        });
        room.on(getLivekit().RoomEvent.LocalTrackPublished, (pub) => {
          onTrack();
          if (
            !deafenedRef.current &&
            !replacingShareRef.current &&
            isScreenSharePub(pub)
          ) {
            playScreenShareStartSound();
          }
        });
        room.on(getLivekit().RoomEvent.LocalTrackUnpublished, (pub) => {
          onTrack();
          if (
            !deafenedRef.current &&
            !switchingRef.current &&
            !replacingShareRef.current &&
            isScreenSharePub(pub)
          ) {
            playScreenShareStopSound();
          }
        });
        room.on(getLivekit().RoomEvent.ParticipantConnected, (participant) => {
          participant.trackPublications.forEach((pub) => {
            if (!ensureScreenShareOptIn(pub, participant)) {
              subscribeRemoteAudio(pub);
            }
          });
          onTrack();
          if (!deafenedRef.current) playVoiceJoinSound();
        });
        room.on(getLivekit().RoomEvent.ParticipantDisconnected, () => {
          onTrack();
          if (!deafenedRef.current && !switchingRef.current) {
            playVoiceLeaveSound();
          }
        });
        room.on(getLivekit().RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setSpeakingIds(speakers.map((p) => p.identity));
        });
        room.on(getLivekit().RoomEvent.Disconnected, () => {
          setConnected(false);
          setRemoteScreens([]);
          setSpeakingIds([]);
          watchingScreensRef.current.clear();
          for (const sid of [...remoteAudioElsRef.current.keys()]) {
            detachRemoteAudio(sid);
          }
          shareAudioStateRef.current.clear();
          setShareAudioByTrack({});
          if (!switchingRef.current) {
            setLocalScreens([]);
          }
        });

        // autoSubscribe lives on connect options (not Room ctor) — keep screen off by default.
        await room.connect(livekitUrl, creds.token, {
          autoSubscribe: false,
          rtcConfig: {
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
          },
        });
        await room.localParticipant.setMicrophoneEnabled(
          !mutedRef.current && !deafenedRef.current,
          {
            deviceId: settings.inputDeviceId || undefined,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
          },
        );
        // Unlock WebView audio playback (same user gesture as Join).
        try {
          await room.startAudio();
        } catch {
          /* may still work once a remote track arrives */
        }
        await applyDevicesToRoom(room, settings);
        pullRemoteAudio(room);
        // Publications can arrive a tick after connect.
        queueMicrotask(() => pullRemoteAudio(room));
        setTimeout(() => pullRemoteAudio(room), 250);
        setTimeout(() => pullRemoteAudio(room), 1000);

        if (preservedScreen.length) {
          await republishScreenTracks(room, preservedScreen);
        } else {
          setLocalScreens([]);
          setVoiceLocal({ streaming: false });
        }

        setConnected(true);
        setVoiceLocal({
          voiceChannelId: channelId,
          streaming: preservedScreen.length > 0,
        });
        refreshScreens(room);
        if (!deafenedRef.current) {
          playVoiceJoinSound();
        }
      } catch (e) {
        for (const track of preservedScreen) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
        setError(e instanceof Error ? e.message : "Failed to join voice");
        await leave();
      } finally {
        switchingRef.current = false;
        setJoining(false);
      }
    },
    [attachRemoteAudio, detachRemoteAudio, endScreenShare, leave, pullRemoteAudio, refreshScreens, republishScreenTracks, setVoiceLocal, subscribeRemoteAudio],
  );

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !connected) return;
    void room.localParticipant.setMicrophoneEnabled(!muted && !deafened);
    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub: RemoteTrackPublication) => {
        if (!pub.track) return;
        if (pub.source === getLivekit().Track.Source.ScreenShareAudio) {
          const videoSid = [...p.trackPublications.values()].find(
            (v) =>
              v.source === getLivekit().Track.Source.ScreenShare &&
              v.kind !== getLivekit().Track.Kind.Audio &&
              watchingScreensRef.current.has(v.trackSid ?? ""),
          )?.trackSid;
          const st = videoSid
            ? shareAudioStateRef.current.get(videoSid)
            : undefined;
          pub.track.setMuted(deafened || Boolean(st?.muted));
          if (
            !deafened &&
            st &&
            "setVolume" in pub.track &&
            typeof pub.track.setVolume === "function"
          ) {
            pub.track.setVolume(st.muted ? 0 : st.volume);
          }
          return;
        }
        pub.track.setMuted(deafened);
      });
    });
    void api("/api/voice/state", {
      method: "PUT",
      body: { muted, deafened },
    }).catch(() => undefined);
  }, [muted, deafened, connected]);

  useEffect(() => {
    return subscribeMediaSettings((settings) => {
      const room = roomRef.current;
      if (!room) return;
      void applyDevicesToRoom(room, settings);
      void room.localParticipant.setMicrophoneEnabled(!muted && !deafened, {
        deviceId: settings.inputDeviceId || undefined,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      });
    });
  }, [muted, deafened]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    setVoiceLocal({ muted: next });
  }, [muted, setVoiceLocal]);

  const toggleDeafen = useCallback(async () => {
    const next = !deafened;
    // Deafen forces mute; undeafen clears both (Discord behavior).
    setVoiceLocal({
      deafened: next,
      muted: next,
    });
  }, [deafened, setVoiceLocal]);

  const closeScreenPicker = useCallback(() => {
    if (pickerBusy) return;
    setPickerOpen(false);
  }, [pickerBusy]);

  const openScreenPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const publishElectronShare = useCallback(
    async (opts: {
      sourceId: string;
      systemAudio?: boolean;
      replaceAll?: boolean;
    }) => {
      const room = roomRef.current;
      if (!room) return;
      await loadLivekit();
      setPickerBusy(true);
      setError(null);
      try {
        if (opts.replaceAll) {
          await endScreenShare(room, true);
        }

        const captured = await captureElectronSource(opts.sourceId, {
          systemAudio: opts.systemAudio !== false,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFps: 60,
        });

        shareStopsRef.current.set(opts.sourceId, captured.stop);
        setActiveShareIds((ids) =>
          ids.includes(opts.sourceId) ? ids : [...ids, opts.sourceId],
        );

        if (!captured.audioTrack) {
          setError(
            "System audio wasn’t captured for this source. Try sharing a full screen with “Share system audio” enabled.",
          );
        }

        await room.localParticipant.publishTrack(captured.videoTrack, {
          name: `screen:${opts.sourceId}`,
          source: getLivekit().Track.Source.ScreenShare,
          simulcast: false,
          videoEncoding: { maxBitrate: 12_000_000, maxFramerate: 60 },
        });

        if (captured.audioTrack) {
          await room.localParticipant.publishTrack(captured.audioTrack, {
            name: `screen-audio:${opts.sourceId}`,
            source: getLivekit().Track.Source.ScreenShareAudio,
            audioPreset: { maxBitrate: 128_000 },
          });
        }

        syncLocalScreen(room);
        refreshScreens(room);
        await api("/api/voice/state", {
          method: "PUT",
          body: { streaming: true },
        });
        setPickerOpen(false);
        await focusMainWindow();
      } catch (e) {
        if (!isShareCancelError(e)) {
          setError(e instanceof Error ? e.message : "Screen share failed");
        }
      } finally {
        setPickerBusy(false);
      }
    },
    [endScreenShare, refreshScreens, syncLocalScreen],
  );

  /** Fallback: OS getDisplayMedia (rarely needed in Electron). */
  const publishBrowserShare = useCallback(
    async (opts?: { replaceAll?: boolean }) => {
      const room = roomRef.current;
      if (!room) return;
      await loadLivekit();
      setPickerBusy(true);
      setError(null);
      try {
        if (opts?.replaceAll) {
          await endScreenShare(room, true);
        }

        const tracks = await room.localParticipant.createScreenTracks({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            // @ts-expect-error experimental display-media field
            suppressLocalAudioPlayback: false,
          },
          contentHint: "motion",
          resolution: { width: 1920, height: 1080, frameRate: 60 },
          systemAudio: "include",
          selfBrowserSurface: "exclude",
        });

        const hasShareAudio = tracks.some(
          (t) => t.kind === getLivekit().Track.Kind.Audio,
        );
        if (!hasShareAudio) {
          setError(
            "Screen audio wasn’t captured. Enable “Share system audio” if available.",
          );
        }

        const stamp = Date.now();
        for (const track of tracks) {
          if (track.kind === getLivekit().Track.Kind.Video) {
            const media = track.mediaStreamTrack;
            if (media) {
              try {
                media.contentHint = "motion";
              } catch {
                /* optional */
              }
            }
          }
          await room.localParticipant.publishTrack(track, {
            name:
              track.kind === getLivekit().Track.Kind.Video
                ? `screen:native-${stamp}`
                : `screen-audio:native-${stamp}`,
            source:
              track.kind === getLivekit().Track.Kind.Audio
                ? getLivekit().Track.Source.ScreenShareAudio
                : getLivekit().Track.Source.ScreenShare,
            simulcast: false,
            videoEncoding:
              track.kind === getLivekit().Track.Kind.Video
                ? { maxBitrate: 12_000_000, maxFramerate: 60 }
                : undefined,
            audioPreset:
              track.kind === getLivekit().Track.Kind.Audio
                ? { maxBitrate: 128_000 }
                : undefined,
          });
        }
        syncLocalScreen(room);
        refreshScreens(room);
        await api("/api/voice/state", {
          method: "PUT",
          body: { streaming: true },
        });
        setPickerOpen(false);
        await focusMainWindow();
      } catch (e) {
        if (!isShareCancelError(e)) {
          setError(e instanceof Error ? e.message : "Screen share failed");
        }
      } finally {
        setPickerBusy(false);
      }
    },
    [endScreenShare, refreshScreens, syncLocalScreen],
  );

  const shareScreen = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const stopOneShare = useCallback(
    async (room: Room, sourceId: string) => {
      const prevStop = shareStopsRef.current.get(sourceId);
      shareStopsRef.current.delete(sourceId);
      setActiveShareIds((ids) => ids.filter((id) => id !== sourceId));

      const pubs = [
        ...room.localParticipant.trackPublications.values(),
      ] as LocalTrackPublication[];
      for (const pub of pubs) {
        const name = pub.trackName || "";
        if (
          name !== `screen:${sourceId}` &&
          name !== `screen-audio:${sourceId}`
        ) {
          continue;
        }
        if (pub.trackSid) unregisterScreenTrack(pub.trackSid);
        const existing = pub.track;
        if (existing) {
          try {
            await room.localParticipant.unpublishTrack(existing, false);
          } catch {
            /* already unpublished */
          }
        }
      }

      if (prevStop) {
        await prevStop().catch(() => undefined);
      }
    },
    [],
  );

  const stopScreenShare = useCallback(async () => {
    await endScreenShare(roomRef.current, true);
  }, [endScreenShare]);

  const stopLocalShare = useCallback(
    async (opts: { sourceId?: string; trackSid?: string }) => {
      const room = roomRef.current;
      if (!room) return;

      if (opts.sourceId) {
        await stopOneShare(room, opts.sourceId);
      } else if (opts.trackSid) {
        const pubs = [
          ...room.localParticipant.trackPublications.values(),
        ] as LocalTrackPublication[];
        for (const pub of pubs) {
          if (pub.trackSid !== opts.trackSid) continue;
          if (pub.trackSid) unregisterScreenTrack(pub.trackSid);
          const existing = pub.track;
          if (existing) {
            try {
              await room.localParticipant.unpublishTrack(existing, true);
            } catch {
              /* already unpublished */
            }
          }
        }
      }

      syncLocalScreen(room);
      refreshScreens(room);
      if (
        shareStopsRef.current.size === 0 &&
        ![...room.localParticipant.trackPublications.values()].some(
          (pub) => pub.source === getLivekit().Track.Source.ScreenShare,
        )
      ) {
        await api("/api/voice/state", {
          method: "PUT",
          body: { streaming: false },
        }).catch(() => undefined);
        setVoiceLocal({ streaming: false });
      }
    },
    [refreshScreens, setVoiceLocal, stopOneShare, syncLocalScreen],
  );

  useEffect(() => {
    const clearPresenceKeepalive = () => {
      if (!voiceChannelIdRef.current) return;
      const token = getAccessToken();
      if (!token) return;
      try {
        void fetch(`${getApiBase()}/api/voice/state`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ channel_id: null, streaming: false }),
          keepalive: true,
        });
      } catch {
        /* best effort on quit */
      }
    };

    window.addEventListener("beforeunload", clearPresenceKeepalive);
    window.addEventListener("pagehide", clearPresenceKeepalive);

    return () => {
      window.removeEventListener("beforeunload", clearPresenceKeepalive);
      window.removeEventListener("pagehide", clearPresenceKeepalive);
      const room = roomRef.current;
      roomRef.current = null;
      const stops = [...shareStopsRef.current.values()];
      shareStopsRef.current.clear();
      for (const stop of stops) void stop();
      if (room) {
        void room.disconnect(true);
      }
    };
  }, []);

  return {
    roomRef,
    voiceChannelId,
    connected,
    joining,
    error,
    muted,
    deafened,
    remoteScreens,
    localScreens,
    speakingIds,
    shareAudioByTrack,
    pickerOpen,
    pickerBusy,
    activeShareIds,
    isDesktop: isDesktopApp(),
    join,
    leave,
    toggleMute,
    toggleDeafen,
    shareScreen,
    openScreenPicker,
    closeScreenPicker,
    publishElectronShare,
    publishBrowserShare,
    stopScreenShare,
    stopLocalShare,
    joinRemoteScreen,
    leaveRemoteScreen,
    setScreenShareVolume,
    setScreenShareMuted,
  };
}
