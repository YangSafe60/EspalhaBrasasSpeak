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
const relays = new Map<
  string,
  { stop: () => void; viewers: number }
>();

let hostReady: Promise<void> | null = null;

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

function startRelay(trackSid: string, track: MediaStreamTrack) {
  const existing = relays.get(trackSid);
  if (existing) {
    existing.viewers += 1;
    return;
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  const cloned = (() => {
    try {
      return track.clone();
    } catch {
      return track;
    }
  })();
  video.srcObject = new MediaStream([cloned]);
  void video.play().catch(() => undefined);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let timer: number | null = null;
  let stopped = false;

  const tick = () => {
    if (stopped || !ctx) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w > 0 && h > 0) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      try {
        const frame = canvas.toDataURL("image/jpeg", 0.72);
        void publishFrame({ trackSid, frame });
      } catch {
        /* canvas tainted / empty */
      }
    }
    timer = window.setTimeout(tick, 66);
  };

  timer = window.setTimeout(tick, 50);

  relays.set(trackSid, {
    viewers: 1,
    stop: () => {
      stopped = true;
      if (timer != null) window.clearTimeout(timer);
      try {
        cloned.stop();
      } catch {
        /* ignore */
      }
      video.srcObject = null;
      video.remove();
      relays.delete(trackSid);
    },
  });
}

function releaseRelay(trackSid: string) {
  const entry = relays.get(trackSid);
  if (!entry) return;
  entry.viewers -= 1;
  if (entry.viewers <= 0) entry.stop();
}

async function ensureHost() {
  if (hostReady) return hostReady;
  hostReady = (async () => {
    await subscribeSignals((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "request") {
        const media = tracks.get(msg.trackSid);
        if (!media || media.readyState === "ended") return;
        startRelay(msg.trackSid, media);
        return;
      }
      if (msg.type === "stop") {
        releaseRelay(msg.trackSid);
      }
    });
  })();
  return hostReady;
}

export function registerScreenTrack(trackSid: string, track: MediaStreamTrack) {
  tracks.set(trackSid, track);
  void ensureHost();
}

export function unregisterScreenTrack(trackSid: string) {
  tracks.delete(trackSid);
  const entry = relays.get(trackSid);
  if (entry) entry.stop();
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
  }, 1000);

  return () => {
    window.clearInterval(retry);
    unsub();
    void publishSignal({ type: "stop", trackSid });
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
