import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type LocalTrackPublication,
  type RemoteTrack,
  type RemoteTrackPublication,
  type LocalVideoTrack,
} from "livekit-client";
import { api } from "../api/client";
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
  isShareCancelError,
  isTauriApp,
  startTauriScreenTrack,
} from "../lib/screenShare";
import { useAppStore } from "../store/appStore";
import type { VoiceTokenResponse } from "../types";
import type { ShareSource } from "../components/ScreenSharePicker";

export type RemoteScreen = {
  trackSid: string;
  participantIdentity: string;
  participantName: string;
  track: RemoteTrack;
};

export type LocalScreen = {
  trackSid: string;
  track: LocalVideoTrack;
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
      (pub.source === Track.Source.ScreenShare ||
        pub.source === Track.Source.ScreenShareAudio) &&
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

  const [connected, setConnected] = useState(false);
  const [remoteScreens, setRemoteScreens] = useState<RemoteScreen[]>([]);
  const [localScreen, setLocalScreen] = useState<LocalScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  const tauriShareStopRef = useRef<(() => Promise<void>) | null>(null);

  voiceChannelIdRef.current = voiceChannelId;
  mutedRef.current = muted;
  deafenedRef.current = deafened;

  const syncLocalScreen = useCallback(
    (room: Room) => {
      let found: LocalScreen | null = null;
      room.localParticipant.trackPublications.forEach((pub) => {
        if (
          pub.source === Track.Source.ScreenShare &&
          pub.track &&
          pub.track.kind === Track.Kind.Video &&
          pub.trackSid
        ) {
          const media = pub.track.mediaStreamTrack;
          if (media) registerScreenTrack(pub.trackSid, media);
          found = {
            trackSid: pub.trackSid,
            track: pub.track as LocalVideoTrack,
          };
        }
      });
      setLocalScreen(found);
      setVoiceLocal({ streaming: !!found });
    },
    [setVoiceLocal],
  );

  const refreshScreens = useCallback(
    (room: Room) => {
      const screens: RemoteScreen[] = [];
      const seen = new Set<string>();
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          if (
            pub.source === Track.Source.ScreenShare &&
            pub.track &&
            pub.trackSid
          ) {
            seen.add(pub.trackSid);
            const media = pub.track.mediaStreamTrack;
            if (media) registerScreenTrack(pub.trackSid, media);
            screens.push({
              trackSid: pub.trackSid,
              participantIdentity: p.identity,
              participantName: p.name || p.identity,
              track: pub.track,
            });
          }
        });
      });
      setRemoteScreens((prev) => {
        for (const old of prev) {
          if (!seen.has(old.trackSid)) unregisterScreenTrack(old.trackSid);
        }
        return screens;
      });
      syncLocalScreen(room);
    },
    [syncLocalScreen],
  );

  /** Stop screen share and optionally halt the underlying capture tracks. */
  const endScreenShare = useCallback(
    async (room: Room | null, stopTracks: boolean) => {
      if (tauriShareStopRef.current) {
        const stop = tauriShareStopRef.current;
        tauriShareStopRef.current = null;
        await stop().catch(() => undefined);
      }
      if (!room) {
        setLocalScreen(null);
        setVoiceLocal({ streaming: false });
        return;
      }
      const pubs = [
        ...room.localParticipant.trackPublications.values(),
      ] as LocalTrackPublication[];
      for (const pub of pubs) {
        if (
          pub.source !== Track.Source.ScreenShare &&
          pub.source !== Track.Source.ScreenShareAudio
        ) {
          continue;
        }
        if (pub.trackSid) unregisterScreenTrack(pub.trackSid);
        if (pub.track) {
          await room.localParticipant.unpublishTrack(pub.track, stopTracks);
          if (stopTracks) pub.track.stop();
        }
      }
      setLocalScreen(null);
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
            track.kind === Track.Kind.Audio
              ? Track.Source.ScreenShareAudio
              : Track.Source.ScreenShare,
          simulcast: false,
          videoEncoding:
            track.kind === Track.Kind.Video
              ? { maxBitrate: 3_000_000, maxFramerate: 30 }
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
    roomRef.current = null;
    // Leaving the lobby entirely always ends the stream.
    await endScreenShare(room, true);
    setConnected(false);
    setRemoteScreens([]);
    setSpeakingIds([]);
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
  }, [endScreenShare, setVoiceLocal]);

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
            await oldRoom.disconnect(false);
          } else {
            // Replacing a stuck session — drop share.
            await endScreenShare(oldRoom, true);
            roomRef.current = null;
            setRemoteScreens([]);
            setLocalScreen(null);
            await oldRoom.disconnect(true);
          }
        }

        const creds = await api<VoiceTokenResponse>(
          `/api/channels/${channelId}/voice/token`,
          { method: "POST" },
        );
        const settings = loadMediaSettings();
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
        room.on(RoomEvent.TrackSubscribed, onTrack);
        room.on(RoomEvent.TrackUnsubscribed, onTrack);
        room.on(RoomEvent.TrackPublished, onTrack);
        room.on(RoomEvent.TrackUnpublished, onTrack);
        room.on(RoomEvent.LocalTrackPublished, onTrack);
        room.on(RoomEvent.LocalTrackUnpublished, onTrack);
        room.on(RoomEvent.ParticipantConnected, onTrack);
        room.on(RoomEvent.ParticipantDisconnected, onTrack);
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          setSpeakingIds(speakers.map((p) => p.identity));
        });
        room.on(RoomEvent.Disconnected, () => {
          setConnected(false);
          setRemoteScreens([]);
          setSpeakingIds([]);
          if (!switchingRef.current) {
            setLocalScreen(null);
          }
        });

        await room.connect(creds.url, creds.token);
        await room.localParticipant.setMicrophoneEnabled(
          !mutedRef.current && !deafenedRef.current,
          {
            deviceId: settings.inputDeviceId || undefined,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
          },
        );
        await applyDevicesToRoom(room, settings);
        room.remoteParticipants.forEach((p) => {
          p.trackPublications.forEach((pub) => {
            if (pub.kind === Track.Kind.Audio) {
              pub.setSubscribed(true);
            }
          });
        });

        if (preservedScreen.length) {
          await republishScreenTracks(room, preservedScreen);
        } else {
          setLocalScreen(null);
          setVoiceLocal({ streaming: false });
        }

        setConnected(true);
        setVoiceLocal({
          voiceChannelId: channelId,
          streaming: preservedScreen.length > 0,
        });
        refreshScreens(room);
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
    [endScreenShare, leave, refreshScreens, republishScreenTracks, setVoiceLocal],
  );

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !connected) return;
    void room.localParticipant.setMicrophoneEnabled(!muted && !deafened);
    room.remoteParticipants.forEach((p) => {
      p.audioTrackPublications.forEach((pub: RemoteTrackPublication) => {
        if (pub.track) {
          pub.track.setMuted(deafened);
        }
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

  const shareScreen = useCallback(() => {
    if (!roomRef.current) return;
    setPickerOpen(true);
  }, []);

  const closeScreenPicker = useCallback(() => {
    if (pickerBusy) return;
    setPickerOpen(false);
  }, [pickerBusy]);

  const publishBrowserShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    setPickerBusy(true);
    try {
      const tracks = await room.localParticipant.createScreenTracks({
        audio: true,
        resolution: { width: 1920, height: 1080, frameRate: 30 },
      });
      for (const track of tracks) {
        await room.localParticipant.publishTrack(track, {
          source:
            track.kind === Track.Kind.Audio
              ? Track.Source.ScreenShareAudio
              : Track.Source.ScreenShare,
          simulcast: false,
          videoEncoding:
            track.kind === Track.Kind.Video
              ? { maxBitrate: 3_000_000, maxFramerate: 30 }
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
  }, [refreshScreens, syncLocalScreen]);

  const publishTauriShare = useCallback(
    async (source: ShareSource) => {
      const room = roomRef.current;
      if (!room) return;
      setPickerBusy(true);
      try {
        if (tauriShareStopRef.current) {
          await tauriShareStopRef.current().catch(() => undefined);
          tauriShareStopRef.current = null;
        }
        const { track, stop } = await startTauriScreenTrack(source.id);
        tauriShareStopRef.current = stop;
        await room.localParticipant.publishTrack(track, {
          source: Track.Source.ScreenShare,
          simulcast: false,
          videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 15 },
        });
        syncLocalScreen(room);
        refreshScreens(room);
        await api("/api/voice/state", {
          method: "PUT",
          body: { streaming: true },
        });
        setPickerOpen(false);
        await focusMainWindow();
      } catch (e) {
        if (tauriShareStopRef.current) {
          await tauriShareStopRef.current().catch(() => undefined);
          tauriShareStopRef.current = null;
        }
        if (!isShareCancelError(e)) {
          setError(e instanceof Error ? e.message : "Screen share failed");
        }
      } finally {
        setPickerBusy(false);
      }
    },
    [refreshScreens, syncLocalScreen],
  );

  const stopScreenShare = useCallback(async () => {
    await endScreenShare(roomRef.current, true);
  }, [endScreenShare]);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (tauriShareStopRef.current) {
        void tauriShareStopRef.current();
        tauriShareStopRef.current = null;
      }
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
    localScreen,
    speakingIds,
    pickerOpen,
    pickerBusy,
    isTauri: isTauriApp(),
    join,
    leave,
    toggleMute,
    toggleDeafen,
    shareScreen,
    closeScreenPicker,
    publishBrowserShare,
    publishTauriShare,
    stopScreenShare,
  };
}
