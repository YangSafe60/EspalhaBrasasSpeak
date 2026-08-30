import type { LocalVideoTrack, RemoteTrack } from "../../lib/livekit";

/** Remote participant screen share visible in the voice lobby. */
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

/** Per-stream viewer controls for screen-share audio. */
export type ScreenShareAudioState = {
  volume: number;
  muted: boolean;
};

/** Local screen share tile shown to the publisher. */
export type LocalScreen = {
  trackSid: string;
  track: LocalVideoTrack;
  /** Native share source id when known (`monitor:0`, `window:123`, …). */
  sourceId?: string;
  label: string;
};
