import type {
  LocalScreen,
  RemoteScreen,
  ScreenShareAudioState,
} from "../hooks/voice/types";
import type { UserVoicePref } from "../lib/userVoicePrefs";
import type { ScreenShareFps, ScreenShareResolution } from "../lib/screenShareQuality";

export type VoiceHostCommand =
  | { op: "join"; channelId: string }
  | { op: "leave" }
  | { op: "toggle-mute" }
  | { op: "toggle-deafen" }
  | { op: "toggle-camera" }
  | { op: "share-screen" }
  | { op: "open-screen-picker" }
  | { op: "close-screen-picker" }
  | {
      op: "publish-electron-share";
      sourceId: string;
      systemAudio: boolean;
      fps: ScreenShareFps;
      resolution: ScreenShareResolution;
      replaceAll?: boolean;
    }
  | { op: "publish-browser-share"; replaceAll?: boolean }
  | { op: "stop-screen-share" }
  | { op: "stop-local-share"; sourceId?: string; trackSid?: string }
  | { op: "join-remote-screen"; trackSid: string }
  | { op: "leave-remote-screen"; trackSid: string }
  | {
      op: "set-screen-share-volume";
      videoTrackSid: string;
      volume: number;
    }
  | {
      op: "set-screen-share-muted";
      videoTrackSid: string;
      muted: boolean;
    }
  | { op: "apply-user-mic"; userId: string; pref: UserVoicePref }
  | { op: "apply-user-video-hide"; userId: string; hide: boolean }
  | {
      op: "sync-local";
      voiceChannelId?: string | null;
      muted?: boolean;
      deafened?: boolean;
      voiceStates?: Array<{
        user_id: string;
        channel_id: string | null;
        muted: boolean;
        deafened: boolean;
        streaming: boolean;
        server_muted?: boolean;
        server_deafened?: boolean;
      }>;
      userId?: string | null;
    };

export type VoiceHostScreenMeta = Omit<LocalScreen, "track"> | Omit<RemoteScreen, "track">;

export type VoiceHostEvent =
  | {
      op: "state";
      connected: boolean;
      joining: boolean;
      error: string | null;
      pingMs: number | null;
      cameraOn: boolean;
      voiceChannelId: string | null;
      muted: boolean;
      deafened: boolean;
      streaming: boolean;
      speakingIds: string[];
      localScreens: Omit<LocalScreen, "track">[];
      remoteScreens: Omit<RemoteScreen, "track">[];
      shareAudioByTrack: Record<string, ScreenShareAudioState>;
      pickerOpen: boolean;
      pickerBusy: boolean;
      activeShareIds: string[];
    }
  | { op: "host-ready" }
  | { op: "host-idle" };

export type VoiceLobbyFrame = {
  trackSid: string;
  frame: string;
};
