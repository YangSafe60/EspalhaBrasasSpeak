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

export function isLivekitLoaded(): boolean {
  return cached !== null;
}

/**
 * Drop our reference to the lazy-loaded module after voice teardown.
 * Best-effort — the runtime may keep parsed code, but WebRTC state should be gone.
 */
export function releaseLivekitModule(): void {
  cached = null;
  loading = null;
}

/** Remove hidden playback nodes LiveKit or our voice hook may leave in the DOM. */
export function purgeLivekitDomArtifacts(): void {
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
  document.getElementById("livekit-dummy-audio-el")?.remove();
}
