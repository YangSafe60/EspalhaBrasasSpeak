import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenShareFps, ScreenShareResolution } from "../lib/screenShareQuality";
import { loadScreenShareQuality } from "../lib/screenShareQuality";
import { isDesktopApp } from "../lib/desktop";
import { ensureScreenBridgeHost, teardownScreenBridgeForVoiceLeave } from "../lib/screenBridge";
import { closeAllScreenPopouts } from "../lib/popout";
import { playVoiceJoinSound, playVoiceLeaveSound } from "../lib/voiceSounds";
import { useAppStore } from "../store/appStore";
import type { VoiceHostCommand, VoiceHostEvent } from "../voice/voiceIpc";
import type {
  LocalScreen,
  RemoteScreen,
  ScreenShareAudioState,
} from "./voice/types";

export type { LocalScreen, RemoteScreen, ScreenShareAudioState } from "./voice/types";

const DEFAULT_TITLE = "Espalha Brasas";

function send(cmd: VoiceHostCommand) {
  void window.electronAPI?.sendVoiceCommand?.(cmd);
}

/**
 * Main-window voice API: forwards commands to the isolated voice host process
 * and mirrors state/events from IPC (no LiveKit in this renderer).
 */
export function useVoiceClient() {
  const setVoiceLocal = useAppStore((s) => s.setVoiceLocal);
  const muted = useAppStore((s) => s.muted);
  const deafened = useAppStore((s) => s.deafened);

  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [remoteScreens, setRemoteScreens] = useState<RemoteScreen[]>([]);
  const [localScreens, setLocalScreens] = useState<LocalScreen[]>([]);
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  const [shareAudioByTrack, setShareAudioByTrack] = useState<
    Record<string, ScreenShareAudioState>
  >({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [activeShareIds, setActiveShareIds] = useState<string[]>([]);
  const [lobbyFrames, setLobbyFrames] = useState<Record<string, string>>({});

  const roomRef = useRef(null);
  const hostConnectedRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const joiningRef = useRef(false);
  joiningRef.current = joining;

  const syncLocalToHost = useCallback(() => {
    const s = useAppStore.getState();
    send({
      op: "sync-local",
      muted: s.muted,
      deafened: s.deafened,
      voiceStates: s.voiceStates,
    });
  }, []);

  const applyHostState = useCallback(
    (evt: Extract<VoiceHostEvent, { op: "state" }>) => {
      // Voice host sends an idle snapshot on boot — ignore until a real session ran.
      if (
        !evt.connected &&
        !evt.joining &&
        !evt.voiceChannelId &&
        !evt.error &&
        !hostConnectedRef.current &&
        !wasConnectedRef.current
      ) {
        return;
      }

      hostConnectedRef.current = evt.connected;
      setConnected(evt.connected);
      setJoining(evt.joining);
      setError(evt.error);
      setPingMs(evt.pingMs);
      setCameraOn(evt.cameraOn);
      setVoiceChannelId(evt.voiceChannelId);
      setSpeakingIds(evt.speakingIds);
      setShareAudioByTrack(evt.shareAudioByTrack);
      setPickerOpen(evt.pickerOpen);
      setPickerBusy(evt.pickerBusy);
      setActiveShareIds(evt.activeShareIds);
      setVoiceLocal({
        voiceChannelId: evt.voiceChannelId,
        streaming: evt.streaming,
        muted: evt.muted,
        deafened: evt.deafened,
      });
      setLocalScreens(evt.localScreens as LocalScreen[]);
      setRemoteScreens(evt.remoteScreens as RemoteScreen[]);
      if (evt.connected && !wasConnectedRef.current && !evt.deafened) {
        playVoiceJoinSound();
      } else if (!evt.connected && wasConnectedRef.current && !evt.deafened) {
        playVoiceLeaveSound();
      }
      wasConnectedRef.current = evt.connected;
      if (!evt.voiceChannelId && !evt.joining) {
        setLobbyFrames({});
        hostConnectedRef.current = false;
        teardownScreenBridgeForVoiceLeave();
        void closeAllScreenPopouts();
      } else if (evt.connected) {
        void ensureScreenBridgeHost();
      }
    },
    [setVoiceLocal],
  );

  useEffect(() => {
    if (!window.electronAPI?.sendVoiceCommand) return;
    syncLocalToHost();
    return useAppStore.subscribe((state, prev) => {
      if (
        prev.voiceChannelId &&
        !state.voiceChannelId &&
        hostConnectedRef.current &&
        !joiningRef.current
      ) {
        send({ op: "leave" });
      }
      if (
        state.muted !== prev.muted ||
        state.deafened !== prev.deafened ||
        state.voiceStates !== prev.voiceStates
      ) {
        syncLocalToHost();
      }
    });
  }, [syncLocalToHost]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onVoiceEvent) return;
    const offEvt = api.onVoiceEvent((evt: VoiceHostEvent) => {
      if (evt.op === "state") applyHostState(evt);
      if (evt.op === "host-idle") {
        void api.destroyVoiceHost?.();
      }
    });
    const offFrame = api.onLobbyFrame?.(({ trackSid, frame }) => {
      setLobbyFrames((prev) =>
        prev[trackSid] === frame ? prev : { ...prev, [trackSid]: frame },
      );
    });
    return () => {
      offEvt();
      offFrame?.();
    };
  }, [applyHostState]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onVoiceEvent) return;
    return api.onVoiceEvent((evt: VoiceHostEvent) => {
      if (evt.op !== "state" || !evt.voiceChannelId) return;
      const channels = Object.values(useAppStore.getState().channelsByServer).flat();
      const channel = channels.find((c) => c.id === evt.voiceChannelId);
      const server = channel
        ? useAppStore.getState().servers.find((s) => s.id === channel.server_id)
        : undefined;
      if (channel && server) {
        void api.setWindowTitle?.(`${channel.name} | ${server.name}`);
      }
    });
  }, []);

  const join = useCallback(async (channelId: string) => {
    setJoining(true);
    setError(null);
    setVoiceChannelId(channelId);
    setVoiceLocal({ voiceChannelId: channelId });
    await window.electronAPI?.ensureVoiceHost?.();
    syncLocalToHost();
    send({ op: "join", channelId });
  }, [setVoiceLocal, syncLocalToHost]);

  const leave = useCallback(async () => {
    void window.electronAPI?.setWindowTitle?.(DEFAULT_TITLE);
    send({ op: "leave" });
  }, []);

  const toggleMute = useCallback(async () => {
    send({ op: "toggle-mute" });
  }, []);

  const toggleDeafen = useCallback(async () => {
    send({ op: "toggle-deafen" });
  }, []);

  const toggleCamera = useCallback(async () => {
    send({ op: "toggle-camera" });
  }, []);

  const shareScreen = useCallback(async () => {
    send({ op: "share-screen" });
  }, []);

  const openScreenPicker = useCallback(() => {
    send({ op: "open-screen-picker" });
  }, []);

  const closeScreenPicker = useCallback(() => {
    send({ op: "close-screen-picker" });
  }, []);

  const publishElectronShare = useCallback(
    async (opts: {
      sourceId: string;
      systemAudio?: boolean;
      fps?: ScreenShareFps;
      resolution?: ScreenShareResolution;
      replaceAll?: boolean;
    }) => {
      send({
        op: "publish-electron-share",
        sourceId: opts.sourceId,
        systemAudio: opts.systemAudio !== false,
        fps: opts.fps === 60 ? 60 : 30,
        resolution: opts.resolution ?? loadScreenShareQuality().resolution,
        replaceAll: opts.replaceAll,
      });
    },
    [],
  );

  const publishBrowserShare = useCallback(async (opts?: { replaceAll?: boolean }) => {
    send({ op: "publish-browser-share", replaceAll: opts?.replaceAll });
  }, []);

  const stopScreenShare = useCallback(async () => {
    send({ op: "stop-screen-share" });
  }, []);

  const stopLocalShare = useCallback(
    async (opts: { sourceId?: string; trackSid?: string }) => {
      send({
        op: "stop-local-share",
        sourceId: opts.sourceId,
        trackSid: opts.trackSid,
      });
    },
    [],
  );

  const joinRemoteScreen = useCallback((trackSid: string) => {
    send({ op: "join-remote-screen", trackSid });
  }, []);

  const leaveRemoteScreen = useCallback((trackSid: string) => {
    send({ op: "leave-remote-screen", trackSid });
    setLobbyFrames((prev) => {
      if (!(trackSid in prev)) return prev;
      const next = { ...prev };
      delete next[trackSid];
      return next;
    });
  }, []);

  const setScreenShareVolume = useCallback(
    (videoTrackSid: string, volume: number) => {
      send({ op: "set-screen-share-volume", videoTrackSid, volume });
    },
    [],
  );

  const setScreenShareMuted = useCallback(
    (videoTrackSid: string, muted: boolean) => {
      send({ op: "set-screen-share-muted", videoTrackSid, muted });
    },
    [],
  );

  const applyUserMic = useCallback(
    (userId: string, pref: import("../lib/userVoicePrefs").UserVoicePref) => {
      send({ op: "apply-user-mic", userId, pref });
    },
    [],
  );

  const applyUserVideoHide = useCallback((userId: string, hide: boolean) => {
    send({ op: "apply-user-video-hide", userId, hide });
  }, []);

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
    lobbyFrames,
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
