/**
 * Cross-window screen pop-out bridge.
 * Electron: IPC relay between BrowserWindows.
 * Fallback: BroadcastChannel (same process / browser).
 */

import { getElectronAPI } from "../desktop";
import {
  purgeOrphanRelayElements,
  releaseRelay,
  startRelay,
  syncRelayBackgroundThrottling,
} from "./relay";
import { bridgeRuntime, captureSources, relays, tracks } from "./state";
import { publishSignal, subscribeFrames, subscribeSignals } from "./transport";

async function ensureHost() {
  if (bridgeRuntime.hostReady) return bridgeRuntime.hostReady;
  bridgeRuntime.hostReady = (async () => {
    if (bridgeRuntime.signalUnlisten) return;
    bridgeRuntime.signalUnlisten = await subscribeSignals((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "request") {
        const media = tracks.get(msg.trackSid);
        const hasCapture = captureSources.has(msg.trackSid);
        if (!hasCapture && (!media || media.readyState === "ended")) {
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
  return bridgeRuntime.hostReady;
}

/** Stop IPC/BroadcastChannel listeners when voice is fully idle. */
export function releaseScreenBridgeHost() {
  bridgeRuntime.signalUnlisten?.();
  bridgeRuntime.signalUnlisten = null;
  bridgeRuntime.hostReady = null;
}

/** Main window must call this before opening a pop-out so relay IPC is listening. */
export async function ensureScreenBridgeHost(): Promise<void> {
  await ensureHost();
}

/** Register a MediaStreamTrack for fallback relay capture. */
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
  if (!tracks.has(trackSid)) {
    releaseRelay(trackSid);
  }
}

export function unregisterScreenTrack(trackSid: string) {
  tracks.delete(trackSid);
  releaseRelay(trackSid);
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
  bridgeRuntime.activeRelayViewers = 0;
  syncRelayBackgroundThrottling();
  purgeOrphanRelayElements();
}

/** Full voice leave: relays, registered tracks, and the persistent host listener. */
export function teardownScreenBridgeForVoiceLeave() {
  clearAllScreenBridge();
  releaseScreenBridgeHost();
}

/** Attach a live screen share into a pop-out `<img>`. Returns a cleanup fn. */
export async function consumeScreenInPopout(
  trackSid: string,
  target: HTMLImageElement,
): Promise<() => void> {
  const unsub = await subscribeFrames((msg) => {
    if (msg.trackSid !== trackSid || !msg.frame) return;
    target.src = msg.frame;
  });

  void publishSignal({ type: "request", trackSid });
  let retries = 0;
  const retry = window.setInterval(() => {
    retries += 1;
    if (retries > 8) {
      window.clearInterval(retry);
      return;
    }
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
