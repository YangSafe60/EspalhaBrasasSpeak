import { useEffect, useRef } from "react";
import { useVoiceEngine } from "../hooks/useVoiceEngine";
import { useAppStore } from "../store/appStore";
import type { VoiceHostCommand, VoiceHostEvent } from "./voiceIpc";
import { startVoiceHostLobbyRelay, stopVoiceHostLobbyRelay } from "./voiceHostLobbyRelay";

function stripScreens(engine: ReturnType<typeof useVoiceEngine>): VoiceHostEvent {
  return {
    op: "state",
    connected: engine.connected,
    joining: engine.joining,
    error: engine.error,
    pingMs: engine.pingMs,
    cameraOn: engine.cameraOn,
    voiceChannelId: engine.voiceChannelId,
    muted: engine.muted,
    deafened: engine.deafened,
    streaming: engine.localScreens.length > 0,
    speakingIds: engine.speakingIds,
    localScreens: engine.localScreens.map(({ track: _t, ...rest }) => rest),
    remoteScreens: engine.remoteScreens.map(({ track: _t, ...rest }) => rest),
    shareAudioByTrack: engine.shareAudioByTrack,
    pickerOpen: engine.pickerOpen,
    pickerBusy: engine.pickerBusy,
    activeShareIds: engine.activeShareIds,
  };
}

/** Hidden renderer process: owns LiveKit + screen capture; syncs UI via IPC. */
export function VoiceHostApp() {
  const engine = useVoiceEngine();
  const engineRef = useRef(engine);
  engineRef.current = engine;

  useEffect(() => {
    window.electronAPI?.notifyVoiceHostReady?.();
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onVoiceCommand) return;
    return api.onVoiceCommand((cmd: VoiceHostCommand) => {
      const e = engineRef.current;
      switch (cmd.op) {
        case "join":
          void e.join(cmd.channelId);
          break;
        case "leave":
          void e.leave();
          break;
        case "toggle-mute":
          void e.toggleMute();
          break;
        case "toggle-deafen":
          void e.toggleDeafen();
          break;
        case "toggle-camera":
          void e.toggleCamera();
          break;
        case "share-screen":
          void e.shareScreen();
          break;
        case "open-screen-picker":
          e.openScreenPicker();
          break;
        case "close-screen-picker":
          e.closeScreenPicker();
          break;
        case "publish-electron-share":
          void e.publishElectronShare({
            sourceId: cmd.sourceId,
            systemAudio: cmd.systemAudio,
            fps: cmd.fps,
            resolution: cmd.resolution,
            replaceAll: cmd.replaceAll,
          });
          break;
        case "publish-browser-share":
          void e.publishBrowserShare({ replaceAll: cmd.replaceAll });
          break;
        case "stop-screen-share":
          void e.stopScreenShare();
          break;
        case "stop-local-share":
          void e.stopLocalShare({
            sourceId: cmd.sourceId,
            trackSid: cmd.trackSid,
          });
          break;
        case "join-remote-screen":
          e.joinRemoteScreen(cmd.trackSid);
          break;
        case "leave-remote-screen":
          e.leaveRemoteScreen(cmd.trackSid);
          break;
        case "set-screen-share-volume":
          e.setScreenShareVolume(cmd.videoTrackSid, cmd.volume);
          break;
        case "set-screen-share-muted":
          e.setScreenShareMuted(cmd.videoTrackSid, cmd.muted);
          break;
        case "apply-user-mic":
          e.applyUserMic(cmd.userId, cmd.pref);
          break;
        case "apply-user-video-hide":
          e.applyUserVideoHide(cmd.userId, cmd.hide);
          break;
        case "sync-local":
          useAppStore.setState({
            ...(cmd.voiceChannelId !== undefined
              ? { voiceChannelId: cmd.voiceChannelId }
              : {}),
            ...(cmd.muted !== undefined ? { muted: cmd.muted } : {}),
            ...(cmd.deafened !== undefined ? { deafened: cmd.deafened } : {}),
            ...(cmd.voiceStates ? { voiceStates: cmd.voiceStates } : {}),
          });
          break;
        default:
          break;
      }
    });
  }, []);

  useEffect(() => {
    const payload = stripScreens(engine);
    void window.electronAPI?.publishVoiceEvent?.(payload);
    if (!engine.voiceChannelId && !engine.joining && !engine.connected) {
      stopVoiceHostLobbyRelay();
      void window.electronAPI?.publishVoiceEvent?.({ op: "host-idle" });
    }
  }, [
    engine.connected,
    engine.joining,
    engine.error,
    engine.pingMs,
    engine.cameraOn,
    engine.voiceChannelId,
    engine.muted,
    engine.deafened,
    engine.speakingIds,
    engine.localScreens,
    engine.remoteScreens,
    engine.shareAudioByTrack,
    engine.pickerOpen,
    engine.pickerBusy,
    engine.activeShareIds,
  ]);

  useEffect(() => {
    if (!engine.connected && !engine.joining) {
      stopVoiceHostLobbyRelay();
      return;
    }
    startVoiceHostLobbyRelay(engine.localScreens, engine.remoteScreens);
    return () => stopVoiceHostLobbyRelay();
  }, [engine.connected, engine.joining, engine.localScreens, engine.remoteScreens]);

  return null;
}
