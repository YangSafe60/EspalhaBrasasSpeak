/**
 * Cross-window screen pop-out bridge.
 * Electron: IPC relay between BrowserWindows.
 * Fallback: BroadcastChannel (same process / browser).
 */

import { getElectronAPI } from "./desktop";

type Signal =
  | { type: "request"; trackSid: string }
  | { type: "stop"; trackSid: string };

type FramePayload = { trackSid: string; frame: string };

const tracks = new Map<string, MediaStreamTrack>();
/** Prefer capturing the lobby <video> — remote WebRTC tracks often won't decode in a clone. */
const captureSources = new Map<string, () => HTMLVideoElement | null>();
const relays = new Map<
  string,
  { stop: () => void; viewers: number }
>();

/** Cap popout relay cost without looking too soft. */
const MAX_RELAY_WIDTH = 1920;
const JPEG_QUALITY = 0.82;
const FRAME_INTERVAL_MS = 66; // ~15 fps

let hostReady: Promise<void> | null = null;
let activeRelayViewers = 0;

function syncRelayBackgroundThrottling() {
  const electron = getElectronAPI();
  if (!electron?.setBackgroundThrottling) return;
  if (activeRelayViewers > 0) {
    void electron.setBackgroundThrottling(false);
  }
}

async function publishSignal(msg: Signal) {
  const electron = getElectronAPI();
  if (electron) {
    await electron.relaySignal(msg);
    return;
  }
  if (typeof BroadcastChannel !== "undefined") {
    new BroadcastChannel("speakapp-screen-bridge").postMessage(msg);
  }
}

async function publishFrame(payload: FramePayload) {
  const electron = getElectronAPI();
  if (electron) {
    await electron.relayFrame(payload);
    return;
  }
  if (typeof BroadcastChannel !== "undefined") {
    new BroadcastChannel("speakapp-screen-bridge").postMessage({
      type: "frame",
      ...payload,
    });
  }
}

type Unlisten = () => void;

async function subscribeSignals(handler: (msg: Signal) => void): Promise<Unlisten> {
  const cleanups: Unlisten[] = [];

  const electron = getElectronAPI();
  if (electron) {
    cleanups.push(
      electron.onSignal((payload) => {
        const msg = payload as Signal;
        if (msg?.type === "request" || msg?.type === "stop") handler(msg);
      }),
    );
  }

  if (typeof BroadcastChannel !== "undefined") {
    const bc = new BroadcastChannel("speakapp-screen-bridge");
    bc.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data?.type === "request" || data?.type === "stop") handler(data);
    };
    cleanups.push(() => bc.close());
  }

  return () => cleanups.forEach((c) => c());
}

async function subscribeFrames(
  handler: (msg: FramePayload) => void,
): Promise<Unlisten> {
  const cleanups: Unlisten[] = [];

  const electron = getElectronAPI();
  if (electron) {
    cleanups.push(
      electron.onFrame((payload) => {
        const msg = payload as FramePayload;
        if (msg?.trackSid && msg.frame) handler(msg);
      }),
    );
  }

  if (typeof BroadcastChannel !== "undefined") {
    const bc = new BroadcastChannel("speakapp-screen-bridge");
    bc.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data?.type === "frame" && data.trackSid && data.frame) {
        handler({ trackSid: data.trackSid, frame: data.frame });
      }
    };
    cleanups.push(() => bc.close());
  }

  return () => cleanups.forEach((c) => c());
}

function mountHiddenRelayVideo(video: HTMLVideoElement) {
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.top = "0";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";
  document.body.appendChild(video);
}

function resolveCaptureVideo(trackSid: string): HTMLVideoElement | null {
  return captureSources.get(trackSid)?.() ?? null;
}

function startRelay(trackSid: string) {
  const existing = relays.get(trackSid);
  if (existing) {
    existing.viewers += 1;
    activeRelayViewers += 1;
    syncRelayBackgroundThrottling();
    return;
  }

  const track = tracks.get(trackSid);
  let fallbackVideo: HTMLVideoElement | null = null;
  let cloned: MediaStreamTrack | null = null;
  const kickPlay = () => {
    void fallbackVideo?.play().catch(() => undefined);
  };

  if (track && track.readyState !== "ended") {
    fallbackVideo = document.createElement("video");
    mountHiddenRelayVideo(fallbackVideo);
    cloned = (() => {
      try {
        return track.clone();
      } catch {
        return track;
      }
    })();
    fallbackVideo.srcObject = new MediaStream([cloned]);
    kickPlay();
    fallbackVideo.addEventListener("loadeddata", kickPlay);
    fallbackVideo.addEventListener("loadedmetadata", kickPlay);
    fallbackVideo.addEventListener("resize", kickPlay);
    fallbackVideo.addEventListener("canplay", kickPlay);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  let timer: number | null = null;
  let stopped = false;

  const publishSnapshot = () => {
    if (stopped || !ctx) return false;
    const source = resolveCaptureVideo(trackSid) ?? fallbackVideo;
    if (!source) return false;
    const w = source.videoWidth;
    const h = source.videoHeight;
    if (w <= 0 || h <= 0) return false;
    const scale = w > MAX_RELAY_WIDTH ? MAX_RELAY_WIDTH / w : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    ctx.drawImage(source, 0, 0, tw, th);
    try {
      const frame = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      void publishFrame({ trackSid, frame });
      return true;
    } catch {
      return false;
    }
  };

  const tick = () => {
    if (stopped) return;
    publishSnapshot();
    timer = window.setTimeout(tick, FRAME_INTERVAL_MS);
  };

  const onEnded = () => {
    relays.get(trackSid)?.stop();
  };
  cloned?.addEventListener("ended", onEnded);

  timer = window.setTimeout(tick, 50);
  activeRelayViewers += 1;
  syncRelayBackgroundThrottling();

  relays.set(trackSid, {
    viewers: 1,
    stop: () => {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      cloned?.removeEventListener("ended", onEnded);
      if (fallbackVideo) {
        fallbackVideo.removeEventListener("loadeddata", kickPlay);
        fallbackVideo.removeEventListener("loadedmetadata", kickPlay);
        fallbackVideo.removeEventListener("resize", kickPlay);
        fallbackVideo.removeEventListener("canplay", kickPlay);
        try {
          if (cloned && cloned !== track) cloned.stop();
        } catch {
          /* ignore */
        }
        fallbackVideo.srcObject = null;
        fallbackVideo.remove();
      }
      canvas.width = 0;
      canvas.height = 0;
      relays.delete(trackSid);
      activeRelayViewers = Math.max(0, activeRelayViewers - 1);
      syncRelayBackgroundThrottling();
    },
  });
}

function releaseRelay(trackSid: string) {
  const entry = relays.get(trackSid);
  if (!entry) return;
  entry.viewers -= 1;
  if (entry.viewers <= 0) {
    entry.stop();
    return;
  }
  activeRelayViewers = Math.max(0, activeRelayViewers - 1);
  syncRelayBackgroundThrottling();
}

async function ensureHost() {
  if (hostReady) return hostReady;
  hostReady = (async () => {
    await subscribeSignals((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "request") {
        const media = tracks.get(msg.trackSid);
        const hasCapture = captureSources.has(msg.trackSid);
        if (
          !hasCapture &&
          (!media || media.readyState === "ended")
        ) {
          return;
        }
        startRelay(msg.trackSid);
        return;
      }
      if (msg.type === "stop") {
        releaseRelay(msg.trackSid);
      }
    });
  })();
  return hostReady;
}

/** Main window must call this before opening a pop-out so relay IPC is listening. */
export async function ensureScreenBridgeHost(): Promise<void> {
  await ensureHost();
}

export function registerScreenTrack(trackSid: string, track: MediaStreamTrack) {
  tracks.set(trackSid, track);
  void ensureHost();
}

/** Register the on-screen lobby video used for pop-out relay capture. */
export function registerScreenCapture(
  trackSid: string,
  getVideo: () => HTMLVideoElement | null,
) {
  captureSources.set(trackSid, getVideo);
  void ensureHost();
}

export function unregisterScreenCapture(trackSid: string) {
  captureSources.delete(trackSid);
}

export function unregisterScreenTrack(trackSid: string) {
  tracks.delete(trackSid);
  const entry = relays.get(trackSid);
  if (entry) entry.stop();
}

/** Drop any registered tracks whose sids are not in `keep`. */
export function pruneScreenTracks(keep: Set<string>) {
  for (const sid of [...tracks.keys()]) {
    if (!keep.has(sid)) unregisterScreenTrack(sid);
  }
}

/** Tear down every relay + registered track (call when leaving voice). */
export function clearAllScreenBridge() {
  for (const sid of [...relays.keys()]) {
    relays.get(sid)?.stop();
  }
  relays.clear();
  tracks.clear();
  captureSources.clear();
  activeRelayViewers = 0;
  syncRelayBackgroundThrottling();
}

/** Attach a live screen share into a pop-out <img>. */
export async function consumeScreenInPopout(
  trackSid: string,
  target: HTMLImageElement,
): Promise<() => void> {
  const unsub = await subscribeFrames((msg) => {
    if (msg.trackSid !== trackSid || !msg.frame) return;
    target.src = msg.frame;
  });

  void publishSignal({ type: "request", trackSid });
  const retry = window.setInterval(() => {
    void publishSignal({ type: "request", trackSid });
  }, 2000);

  return () => {
    window.clearInterval(retry);
    unsub();
    void publishSignal({ type: "stop", trackSid });
    target.removeAttribute("src");
  };
}

/** Keep Espalha Brasas focused after picking a share target. */
export async function focusMainWindow() {
  const electron = getElectronAPI();
  if (electron) {
    await electron.focusMain();
    return;
  }
  window.focus();
}
