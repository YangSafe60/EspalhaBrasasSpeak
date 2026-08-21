import type {
  LocalAudioTrack,
  LocalTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
} from "livekit-client";

export type {
  LocalAudioTrack,
  LocalTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
};

type LivekitModule = typeof import("livekit-client");

let cached: LivekitModule | null = null;
let loading: Promise<LivekitModule> | null = null;

/** Lazy-load livekit-client (keeps the auth / text UI chunk small). */
export function loadLivekit(): Promise<LivekitModule> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = import("livekit-client").then((mod) => {
      cached = mod;
      return mod;
    });
  }
  return loading;
}

export function getLivekit(): LivekitModule {
  if (!cached) {
    throw new Error("LiveKit is not loaded yet");
  }
  return cached;
}
