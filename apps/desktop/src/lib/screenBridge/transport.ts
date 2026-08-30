import { getElectronAPI } from "../desktop";
import type {
  ScreenBridgeFrame,
  ScreenBridgeSignal,
  Unlisten,
} from "./state";

const CHANNEL = "speakapp-screen-bridge";

/** Send a relay control message to the main window (Electron IPC or BroadcastChannel). */
export async function publishSignal(msg: ScreenBridgeSignal) {
  const electron = getElectronAPI();
  if (electron) {
    await electron.relaySignal(msg);
    return;
  }
  if (typeof BroadcastChannel !== "undefined") {
    new BroadcastChannel(CHANNEL).postMessage(msg);
  }
}

/** Send one JPEG frame to pop-out subscribers. */
export async function publishFrame(payload: ScreenBridgeFrame) {
  const electron = getElectronAPI();
  if (electron) {
    await electron.relayFrame(payload);
    return;
  }
  if (typeof BroadcastChannel !== "undefined") {
    new BroadcastChannel(CHANNEL).postMessage({
      type: "frame",
      ...payload,
    });
  }
}

/** Listen for relay start/stop requests on the main window. */
export async function subscribeSignals(
  handler: (msg: ScreenBridgeSignal) => void,
): Promise<Unlisten> {
  const cleanups: Unlisten[] = [];

  const electron = getElectronAPI();
  if (electron) {
    cleanups.push(
      electron.onSignal((payload) => {
        const msg = payload as ScreenBridgeSignal;
        if (msg?.type === "request" || msg?.type === "stop") handler(msg);
      }),
    );
  }

  if (typeof BroadcastChannel !== "undefined") {
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data?.type === "request" || data?.type === "stop") handler(data);
    };
    cleanups.push(() => bc.close());
  }

  return () => cleanups.forEach((c) => c());
}

/** Listen for JPEG frames on a pop-out window. */
export async function subscribeFrames(
  handler: (msg: ScreenBridgeFrame) => void,
): Promise<Unlisten> {
  const cleanups: Unlisten[] = [];

  const electron = getElectronAPI();
  if (electron) {
    cleanups.push(
      electron.onFrame((payload) => {
        const msg = payload as ScreenBridgeFrame;
        if (msg?.trackSid && msg.frame) handler(msg);
      }),
    );
  }

  if (typeof BroadcastChannel !== "undefined") {
    const bc = new BroadcastChannel(CHANNEL);
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
