import type { PreviewFrame } from "./previewFrames";

/**
 * Live-preview frame ports, owned by the page itself.
 *
 * The main process wires a MessagePort between every publisher window (voice
 * host, screen hosts) and every consumer window (main, pop-outs). The preload
 * hands those ports to the page (window.postMessage with a transfer), so frames
 * go page -> port -> page: no contextBridge copy on either side, and the chunk
 * bytes are transferred instead of copied when only one viewer wants them.
 * Without ports (before they arrive, or outside Electron) the old IPC relay in
 * the preload is used.
 */

type PortMsg =
  | { __ebFramePort: true; role: "publisher" | "consumer"; id: string; trackSid: string | null }
  | { __ebFramePortClose: true; id: string };

const outPorts = new Map<string, { port: MessagePort; trackSid: string | null }>();
const inPorts = new Map<string, MessagePort>();
const frameHandlers = new Set<(frame: PreviewFrame) => void>();
const keyFrameHandlers = new Set<(trackSid: string) => void>();
let started = false;
/** Ports the preload had queued when this window claimed them. */
let claimedCount = 0;

function onKeyFrame(trackSid: unknown) {
  if (typeof trackSid !== "string" || !trackSid) return;
  for (const h of keyFrameHandlers) h(trackSid);
}

function start() {
  if (started) return;
  started = true;
  const api = window.electronAPI;
  if (!api?.claimFramePorts) return;
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window) return;
    const msg = e.data as PortMsg | null;
    if (!msg || typeof msg !== "object") return;
    if ("__ebFramePortClose" in msg) {
      outPorts.get(msg.id)?.port.close();
      outPorts.delete(msg.id);
      inPorts.get(msg.id)?.close();
      inPorts.delete(msg.id);
      return;
    }
    if (!("__ebFramePort" in msg)) return;
    const port = e.ports[0];
    if (!port || !msg.id) return;
    if (msg.role === "publisher") {
      outPorts.get(msg.id)?.port.close();
      // Viewers talk back on the same port to ask for a keyframe.
      port.onmessage = (ev) => {
        if (ev.data?.op === "keyframe") onKeyFrame(ev.data.trackSid);
      };
      outPorts.set(msg.id, { port, trackSid: msg.trackSid });
    } else {
      inPorts.get(msg.id)?.close();
      const from = msg.id;
      port.onmessage = (ev) => {
        const data = ev.data as PreviewFrame | null;
        if (!data || typeof data !== "object") return;
        data.from = from;
        for (const h of frameHandlers) h(data);
      };
      inPorts.set(msg.id, port);
    }
  });
  // Ports that arrived before this listener existed are sent now.
  claimedCount = Number(api.claimFramePorts()) || 0;
}

/** Publisher side: send one encoded frame to every window watching it. */
export function publishFrame(frame: PreviewFrame): void {
  start();
  if (!outPorts.has("main")) {
    // Until the main window's port arrives, use the IPC relay.
    window.electronAPI?.publishLobbyFrame?.(frame);
    return;
  }
  const targets = [...outPorts.values()].filter((o) => !o.trackSid || o.trackSid === frame.trackSid);
  targets.forEach(({ port }, i) => {
    const last = i === targets.length - 1;
    const buf = frame.chunk?.data ?? frame.jpeg;
    // The last viewer takes the buffer itself; earlier ones get a copy.
    if (last && buf) port.postMessage(frame, [buf]);
    else port.postMessage(frame);
  });
}

/** Publisher side: a viewer needs a keyframe for `trackSid`. */
export function onKeyFrameRequest(handler: (trackSid: string) => void): () => void {
  start();
  keyFrameHandlers.add(handler);
  const offIpc = window.electronAPI?.onPreviewKeyFrameRequest?.(handler);
  return () => {
    keyFrameHandlers.delete(handler);
    offIpc?.();
  };
}

/** Consumer side: ask publishers for a keyframe. */
export function requestKeyFrame(trackSid: string): void {
  start();
  if (!trackSid) return;
  if (inPorts.size === 0) {
    window.electronAPI?.requestPreviewKeyFrame?.(trackSid);
    return;
  }
  for (const port of inPorts.values()) port.postMessage({ op: "keyframe", trackSid });
}

/** Consumer side: frames from any publisher (ports, plus the IPC fallback). */
export function onFrame(handler: (frame: PreviewFrame) => void): () => void {
  start();
  frameHandlers.add(handler);
  return () => {
    frameHandlers.delete(handler);
  };
}

/** Call early in each window so ports are claimed before frames flow. */
export function initFramePorts(): void {
  start();
}

/** For diagnostics: how many ports this window holds. */
export function framePortStats(): { out: string[]; in: string[]; claimed: boolean; handed: number } {
  return { out: [...outPorts.keys()], in: [...inPorts.keys()], claimed: started, handed: claimedCount };
}
