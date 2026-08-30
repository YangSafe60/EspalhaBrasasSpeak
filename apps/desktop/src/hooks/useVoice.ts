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
import { getElectronAPI } from "../lib/desktop";
import {
  loadMediaSettings,
  outputGainFromSettings,
  subscribeMediaSettings,
} from "../lib/mediaSettings";
import {
  clearAllScreenBridge,
  registerScreenTrack,
  unregisterScreenTrack,
  pruneScreenTracks,
  focusMainWindow,
} from "../lib/screenBridge";
import {
  applyScreenShareQualityHints,
  captureElectronSource,
  isShareCancelError,
  isDesktopApp,
  tunePublishedScreenShare,
} from "../lib/screenShare";
import {
  loadScreenShareQuality,
  resolveCaptureDimensions,
  screenShareEncoding,
  type ScreenShareFps,
  type ScreenShareResolution,
} from "../lib/screenShareQuality";
import { closeAllScreenPopouts } from "../lib/popout";
import {
  playScreenShareStartSound,
  playScreenShareStopSound,
  playVoiceJoinSound,
  playVoiceLeaveSound,
  closeVoiceSoundContext,
} from "../lib/voiceSounds";
import { getUserVoicePref, type UserVoicePref } from "../lib/userVoicePrefs";
import { useAppStore } from "../store/appStore";
import type { VoiceTokenResponse } from "../types";
import {
  applyDevicesToRoom,
  collectScreenTracks,
  ensureMicPermission,
  normalizeLivekitUrl,
  readSignalRtt,
  stopLocalMediaExceptScreenShare,
} from "./voice/livekitHelpers";
import type {
  LocalScreen,
  RemoteScreen,
  ScreenShareAudioState,
} from "./voice/types";

export type { LocalScreen, RemoteScreen, ScreenShareAudioState } from "./voice/types";

/**
 * LiveKit voice hook: join/leave channel, mic/camera, screen share publish/watch,
 * remote audio routing, and lobby presence sync with the API.
 */
export function useVoice() {
  const voiceChannelId = useAppStore((s) => s.voiceChannelId);
  const muted = useAppStore((s) => s.muted);
  const deafened = useAppStore((s) => s.deafened);
  const setVoiceLocal = useAppStore((s) => s.setVoiceLocal);

  const roomRef = useRef<Room | null>(null);
  /** Bumps when leaving or starting a new join — invalidates delayed join work. */
  const joinGenerationRef = useRef(0);
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
  const remoteAudioTracksRef = useRef(new Map<string, RemoteTrack>());
  /** Per video trackSid: viewer volume/mute for that stream's share audio. */
  const shareAudioStateRef = useRef(
    new Map<string, ScreenShareAudioState>(),
  );
  const [shareAudioByTrack, setShareAudioByTrack] = useState<
    Record<string, ScreenShareAudioState>
  >({});

  const [connected, setConnected] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
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
  /** Last chosen screen-share quality (for lobby hops / republish). */
  const shareFpsRef = useRef<ScreenShareFps>(loadScreenShareQuality().fps);
  const shareResolutionRef = useRef<ScreenShareResolution>(
    loadScreenShareQuality().resolution,
  );
  const joinPullTimersRef = useRef<number[]>([]);
  const leavingRef = useRef(false);

  const clearJoinPullTimers = useCallback(() => {
    for (const id of joinPullTimersRef.current) {
      window.clearTimeout(id);
    }
    joinPullTimersRef.current = [];
  }, []);

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
      pruneScreenTracks(new Set(found.map((s) => s.trackSid)));
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
          if (getUserVoicePref(p.identity).hideVideo) {
            watchingScreensRef.current.delete(pub.trackSid);
            if (pub.isSubscribed) pub.setSubscribed(false);
            unregisterScreenTrack(pub.trackSid);
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
    const track = remoteAudioTracksRef.current.get(trackSid);
    if (track && el) {
      try {
        track.detach(el);
      } catch {
        /* already detached */
      }
    }
    remoteAudioTracksRef.current.delete(trackSid);
    if (!el) return;
    try {
      const media = el as HTMLMediaElement & { srcObject?: MediaStream | null };
      media.srcObject = null;
      media.removeAttribute("src");
      media.load?.();
    } catch {
      /* ignore */
    }
    el.remove();
    remoteAudioElsRef.current.delete(trackSid);
  }, []);

  const purgeRemoteAudio = useCallback(() => {
    for (const sid of [...remoteAudioElsRef.current.keys()]) {
      detachRemoteAudio(sid);
    }
    remoteAudioElsRef.current.clear();
    remoteAudioTracksRef.current.clear();
    document.querySelectorAll("[data-lk-remote-audio]").forEach((el) => {
      try {
        const media = el as HTMLMediaElement & { srcObject?: MediaStream | null };
        media.srcObject = null;
        media.removeAttribute("src");
        media.load?.();
        el.remove();
      } catch {
        /* ignore */
      }
    });
  }, [detachRemoteAudio]);

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
      remoteAudioTracksRef.current.set(pub.trackSid, track);
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
    (trackSid: string) => {
      const room = roomRef.current;
      if (room) {
        for (const p of room.remoteParticipants.values()) {
          const match = [...p.trackPublications.values()].find(
            (x) => x.trackSid === trackSid,
          );
          if (match && getUserVoicePref(p.identity).hideVideo) return;
        }
      }
      setRemoteScreenSubscribed(trackSid, true);
    },
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
      void closeAllScreenPopouts();
      clearAllScreenBridge();

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
    async (
      room: Room,
      tracks: { track: LocalTrack; name?: string }[],
    ) => {
      const fps = shareFpsRef.current;
      const resolution = shareResolutionRef.current;
      const encoding = screenShareEncoding(resolution, fps);
      for (const { track, name } of tracks) {
        if (track.kind === getLivekit().Track.Kind.Video) {
          const media = track.mediaStreamTrack;
          if (media) {
            applyScreenShareQualityHints(media);
          }
        }
        await room.localParticipant.publishTrack(track, {
          name,
          source:
            track.kind === getLivekit().Track.Kind.Audio
              ? getLivekit().Track.Source.ScreenShareAudio
              : getLivekit().Track.Source.ScreenShare,
          simulcast: false,
          videoEncoding:
            track.kind === getLivekit().Track.Kind.Video ? encoding : undefined,
        });
        if (track.kind === getLivekit().Track.Kind.Video) {
          await tunePublishedScreenShare(track as LocalVideoTrack);
        }
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

  const teardownRoom = useCallback(
    async (room: Room, stopTracks: boolean) => {
      try {
        room.removeAllListeners();
      } catch {
        /* EventEmitter API */
      }

      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          const track = pub.track;
          if (track) {
            try {
              track.detach();
            } catch {
              /* already detached */
            }
          }
          try {
            pub.setSubscribed(false);
          } catch {
            /* ignore */
          }
        });
      });

      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* already down */
      }
      try {
        await room.localParticipant.setCameraEnabled(false);
      } catch {
        /* optional */
      }

      for (const pub of [
        ...room.localParticipant.trackPublications.values(),
      ] as LocalTrackPublication[]) {
        const track = pub.track;
        if (!track) continue;
        try {
          await room.localParticipant.unpublishTrack(track, stopTracks);
        } catch {
          if (stopTracks) {
            try {
              track.stop();
            } catch {
              /* ignore */
            }
          }
        }
      }

      if (stopTracks) {
        stopLocalMediaExceptScreenShare(room);
        room.localParticipant.trackPublications.forEach((pub) => {
          const track = pub.track;
          if (!track) return;
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        });
      }

      try {
        await (
          room as Room & { stopAudio?: () => Promise<void> }
        ).stopAudio?.();
      } catch {
        /* optional */
      }

      try {
        await room.disconnect(stopTracks);
      } catch {
        /* already disconnected */
      }
    },
    [],
  );

  const leave = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      joinGenerationRef.current += 1;
      clearJoinPullTimers();
      setJoining(false);
      setPickerOpen(false);
      setPickerBusy(false);

      const room = roomRef.current;
      const wasInVoice = !!room;
      roomRef.current = null;

      void closeAllScreenPopouts();

      // Leaving the lobby entirely always ends the stream + capture.
      await endScreenShare(room, true);
      clearAllScreenBridge();

      setConnected(false);
      setRemoteScreens([]);
      setLocalScreens([]);
      setSpeakingIds([]);
      watchingScreensRef.current.clear();

      purgeRemoteAudio();
      shareAudioStateRef.current.clear();
      setShareAudioByTrack({});

      if (room) {
        await teardownRoom(room, true);
      }

      void getElectronAPI()?.setBackgroundThrottling?.(true);
      closeVoiceSoundContext();
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
    } finally {
      leavingRef.current = false;
    }
  }, [
    clearJoinPullTimers,
    endScreenShare,
    purgeRemoteAudio,
    setVoiceLocal,
    teardownRoom,
  ]);

  const join = useCallback(
    async (channelId: string) => {
      if (voiceChannelIdRef.current === channelId && roomRef.current) {
        return;
      }

      const joinGen = joinGenerationRef.current;
      setJoining(true);
      setError(null);

      const previousChannel = voiceChannelIdRef.current;
      const switching =
        !!roomRef.current && !!previousChannel && previousChannel !== channelId;

      let preservedScreen: { track: LocalTrack; name?: string }[] = [];

      try {
        if (roomRef.current) {
          const oldRoom = roomRef.current;
          if (switching) {
            // Moving between lobbies: keep the capture, just hop rooms.
            switchingRef.current = true;
            preservedScreen = collectScreenTracks(oldRoom);
            for (const { track } of preservedScreen) {
              await oldRoom.localParticipant.unpublishTrack(track, false);
            }
            roomRef.current = null;
            setRemoteScreens([]);
            watchingScreensRef.current.clear();
            purgeRemoteAudio();
            shareAudioStateRef.current.clear();
            setShareAudioByTrack({});
            setSpeakingIds([]);
            void closeAllScreenPopouts();
            clearAllScreenBridge();
            try {
              await oldRoom.localParticipant.setMicrophoneEnabled(false);
              await oldRoom.localParticipant.setCameraEnabled(false);
            } catch {
              /* ignore */
            }
            stopLocalMediaExceptScreenShare(oldRoom);
            await teardownRoom(oldRoom, false);
          } else {
            // Replacing a stuck session — drop share.
            await endScreenShare(oldRoom, true);
            roomRef.current = null;
            setRemoteScreens([]);
            setLocalScreens([]);
            watchingScreensRef.current.clear();
            clearAllScreenBridge();
            void closeAllScreenPopouts();
            purgeRemoteAudio();
            await teardownRoom(oldRoom, true);
          }
        }

        if (joinGenerationRef.current !== joinGen) {
          return;
        }

        const creds = await api<VoiceTokenResponse>(
          `/api/channels/${channelId}/voice/token`,
          { method: "POST" },
        );
        if (joinGenerationRef.current !== joinGen) {
          return;
        }
        const livekitUrl = normalizeLivekitUrl(creds.url);
        await ensureMicPermission();
        if (joinGenerationRef.current !== joinGen) {
          return;
        }
        const settings = loadMediaSettings();
        const { Room } = await loadLivekit();
        if (joinGenerationRef.current !== joinGen) {
          return;
        }
        const room = new Room({
          adaptiveStream: false,
          dynacast: false,
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
          participant?: {
            identity: string;
            trackPublications: Map<string, RemoteTrackPublication>;
          },
        ) => {
          if (
            participant &&
            getUserVoicePref(participant.identity).hideVideo
          ) {
            pub.setSubscribed(false);
            return true;
          }
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
          const pref = getUserVoicePref(participant.identity);
          attachRemoteAudio(
            track,
            pub,
            out * pref.volume,
            pref.muted || deafenedRef.current,
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
          if (roomRef.current === room) {
            roomRef.current = null;
          }
          setConnected(false);
          setRemoteScreens([]);
          setSpeakingIds([]);
          watchingScreensRef.current.clear();
          purgeRemoteAudio();
          shareAudioStateRef.current.clear();
          setShareAudioByTrack({});
          if (!switchingRef.current) {
            setLocalScreens([]);
            clearAllScreenBridge();
            void closeAllScreenPopouts();
            void getElectronAPI()?.setBackgroundThrottling?.(true);
            closeVoiceSoundContext();
          }
        });

        // autoSubscribe lives on connect options (not Room ctor) — keep screen off by default.
        await room.connect(livekitUrl, creds.token, {
          autoSubscribe: false,
          rtcConfig: {
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
          },
        });
        if (joinGenerationRef.current !== joinGen || roomRef.current !== room) {
          await teardownRoom(room, true);
          return;
        }
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
        const pullIfCurrent = () => {
          if (joinGenerationRef.current !== joinGen || roomRef.current !== room) {
            return;
          }
          pullRemoteAudio(room);
        };
        pullIfCurrent();
        queueMicrotask(pullIfCurrent);
        clearJoinPullTimers();
        joinPullTimersRef.current.push(
          window.setTimeout(pullIfCurrent, 250),
          window.setTimeout(pullIfCurrent, 1000),
        );

        if (preservedScreen.length) {
          await republishScreenTracks(room, preservedScreen);
        } else {
          setLocalScreens([]);
          setVoiceLocal({ streaming: false });
        }
        if (joinGenerationRef.current !== joinGen || roomRef.current !== room) {
          await teardownRoom(room, true);
          return;
        }

        setConnected(true);
        void getElectronAPI()?.setBackgroundThrottling?.(false);
        setVoiceLocal({
          voiceChannelId: channelId,
          streaming: preservedScreen.length > 0,
        });
        refreshScreens(room);
        if (!deafenedRef.current) {
          playVoiceJoinSound();
        }
      } catch (e) {
        for (const { track } of preservedScreen) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
        setError(e instanceof Error ? e.message : "Failed to join voice");
        if (joinGenerationRef.current === joinGen) {
          await leave();
        }
      } finally {
        switchingRef.current = false;
        setJoining(false);
      }
    },
    [
      attachRemoteAudio,
      clearJoinPullTimers,
      detachRemoteAudio,
      endScreenShare,
      leave,
      pullRemoteAudio,
      purgeRemoteAudio,
      refreshScreens,
      republishScreenTracks,
      setVoiceLocal,
      subscribeRemoteAudio,
      teardownRoom,
    ],
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
        const pref = getUserVoicePref(p.identity);
        const out = outputGainFromSettings(loadMediaSettings());
        const mute = deafened || pref.muted;
        pub.track.setMuted(mute);
        if (
          "setVolume" in pub.track &&
          typeof pub.track.setVolume === "function"
        ) {
          pub.track.setVolume(mute ? 0 : out * pref.volume);
        }
      });
    });
    void api("/api/voice/state", {
      method: "PUT",
      body: { muted, deafened },
    }).catch(() => undefined);
  }, [muted, deafened, connected]);

  const applyUserMic = useCallback((userId: string, pref: UserVoicePref) => {
    const room = roomRef.current;
    if (!room) return;
    const p = room.remoteParticipants.get(userId);
    if (!p) return;
    const out = outputGainFromSettings(loadMediaSettings());
    p.audioTrackPublications.forEach((pub) => {
      if (!pub.track) return;
      if (pub.source === getLivekit().Track.Source.ScreenShareAudio) return;
      const mute = deafenedRef.current || pref.muted;
      pub.track.setMuted(mute);
      if (
        "setVolume" in pub.track &&
        typeof pub.track.setVolume === "function"
      ) {
        pub.track.setVolume(mute ? 0 : out * pref.volume);
      }
    });
  }, []);

  const applyUserVideoHide = useCallback(
    (userId: string, hide: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      const p = room.remoteParticipants.get(userId);
      if (!p) return;
      p.trackPublications.forEach((pub) => {
        const isVideo =
          pub.source === getLivekit().Track.Source.Camera ||
          pub.source === getLivekit().Track.Source.ScreenShare;
        const isShareAudio =
          pub.source === getLivekit().Track.Source.ScreenShareAudio;
        if (!isVideo && !isShareAudio) return;
        if (hide) {
          if (pub.trackSid) watchingScreensRef.current.delete(pub.trackSid);
          pub.setSubscribed(false);
        }
      });
      refreshScreens(room);
    },
    [refreshScreens],
  );

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

  // Server/WS can clear voice membership without going through the disconnect button.
  useEffect(() => {
    if (voiceChannelId != null || joining) return;
    if (!roomRef.current) return;
    void leave();
  }, [voiceChannelId, joining, leave]);

  const toggleMute = useCallback(async () => {
    const state = useAppStore.getState();
    const me = state.voiceStates.find((v) => v.user_id === state.user?.id);
    if (me?.server_muted && muted) return;
    const next = !muted;
    setVoiceLocal({ muted: next });
  }, [muted, setVoiceLocal]);

  const toggleDeafen = useCallback(async () => {
    const state = useAppStore.getState();
    const me = state.voiceStates.find((v) => v.user_id === state.user?.id);
    if (me?.server_deafened && deafened) return;
    const next = !deafened;
    // Deafen forces mute; undeafen clears both (Discord behavior).
    setVoiceLocal({
      deafened: next,
      muted: next,
    });
  }, [deafened, setVoiceLocal]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !connected) return;
    const settings = loadMediaSettings();
    const next = !room.localParticipant.isCameraEnabled;
    try {
      await room.localParticipant.setCameraEnabled(next, {
        deviceId: settings.cameraDeviceId || undefined,
      });
      setCameraOn(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not toggle camera");
    }
  }, [connected]);

  useEffect(() => {
    if (!connected) {
      setPingMs(null);
      setCameraOn(false);
      return;
    }
    const tick = () => {
      const room = roomRef.current;
      if (!room) return;
      setPingMs(readSignalRtt(room));
      setCameraOn(room.localParticipant.isCameraEnabled);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [connected]);

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
      fps?: ScreenShareFps;
      resolution?: ScreenShareResolution;
      replaceAll?: boolean;
    }) => {
      const room = roomRef.current;
      if (!room) return;
      await loadLivekit();
      setPickerBusy(true);
      setError(null);
      const fps = opts.fps === 60 ? 60 : 30;
      const resolution = opts.resolution ?? shareResolutionRef.current;
      shareFpsRef.current = fps;
      shareResolutionRef.current = resolution;
      const capture = resolveCaptureDimensions(resolution);
      const encoding = screenShareEncoding(resolution, fps);
      try {
        if (opts.replaceAll) {
          await endScreenShare(room, true);
        }

        const captured = await captureElectronSource(opts.sourceId, {
          systemAudio: opts.systemAudio !== false,
          maxWidth: capture.maxWidth,
          maxHeight: capture.maxHeight,
          maxFps: fps,
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

        applyScreenShareQualityHints(captured.videoTrack.mediaStreamTrack);

        await room.localParticipant.publishTrack(captured.videoTrack, {
          name: `screen:${opts.sourceId}`,
          source: getLivekit().Track.Source.ScreenShare,
          simulcast: false,
          videoEncoding: encoding,
        });
        await tunePublishedScreenShare(captured.videoTrack);

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
      const fps = shareFpsRef.current;
      const resolution = shareResolutionRef.current;
      const capture = resolveCaptureDimensions(resolution);
      const encoding = screenShareEncoding(resolution, fps);
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
          contentHint: "detail",
          resolution: {
            width: capture.maxWidth,
            height: capture.maxHeight,
            frameRate: fps,
          },
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
              applyScreenShareQualityHints(media);
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
              track.kind === getLivekit().Track.Kind.Video ? encoding : undefined,
            audioPreset:
              track.kind === getLivekit().Track.Kind.Audio
                ? { maxBitrate: 128_000 }
                : undefined,
          });
          if (track.kind === getLivekit().Track.Kind.Video) {
            await tunePublishedScreenShare(track as LocalVideoTrack);
          }
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
            await room.localParticipant.unpublishTrack(existing, true);
          } catch {
            /* already unpublished */
          }
          try {
            existing.stop();
          } catch {
            /* ignore */
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
        const target = pubs.find((pub) => pub.trackSid === opts.trackSid);
        const name = target?.trackName || "";
        const inferredSource = name.startsWith("screen:")
          ? name.slice("screen:".length)
          : name.startsWith("screen-audio:")
            ? name.slice("screen-audio:".length)
            : undefined;

        if (inferredSource && shareStopsRef.current.has(inferredSource)) {
          await stopOneShare(room, inferredSource);
        } else {
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
      }

      const hasScreenVideo = [
        ...room.localParticipant.trackPublications.values(),
      ].some(
        (pub) =>
          pub.source === getLivekit().Track.Source.ScreenShare &&
          pub.kind !== getLivekit().Track.Kind.Audio,
      );

      if (!hasScreenVideo) {
        // Leftover capture stops / screen-audio after a channel switch.
        const leftoverStops = [...shareStopsRef.current.entries()];
        shareStopsRef.current.clear();
        setActiveShareIds([]);
        for (const [, stop] of leftoverStops) {
          await stop().catch(() => undefined);
        }
        void closeAllScreenPopouts();
        clearAllScreenBridge();
        const leftoverPubs = [
          ...room.localParticipant.trackPublications.values(),
        ] as LocalTrackPublication[];
        for (const pub of leftoverPubs) {
          if (
            pub.source !== getLivekit().Track.Source.ScreenShare &&
            pub.source !== getLivekit().Track.Source.ScreenShareAudio
          ) {
            continue;
          }
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
        await api("/api/voice/state", {
          method: "PUT",
          body: { streaming: false },
        }).catch(() => undefined);
        setVoiceLocal({ streaming: false });
      }

      syncLocalScreen(room);
      refreshScreens(room);
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
      joinGenerationRef.current += 1;
      clearJoinPullTimers();
      const room = roomRef.current;
      roomRef.current = null;
      const stops = [...shareStopsRef.current.values()];
      shareStopsRef.current.clear();
      for (const stop of stops) void stop();
      clearAllScreenBridge();
      void closeAllScreenPopouts();
      purgeRemoteAudio();
      if (room) {
        void teardownRoom(room, true).finally(() => {
          void getElectronAPI()?.setBackgroundThrottling?.(true);
          closeVoiceSoundContext();
        });
      } else {
        void getElectronAPI()?.setBackgroundThrottling?.(true);
        closeVoiceSoundContext();
      }
    };
  }, [clearJoinPullTimers, purgeRemoteAudio, teardownRoom]);

  return {
    roomRef,
    voiceChannelId,
    connected,
    joining,
    error,
    pingMs,
    cameraOn,
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
    toggleCamera,
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
    applyUserMic,
    applyUserVideoHide,
  };
}
