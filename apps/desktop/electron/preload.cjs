const { contextBridge, ipcRenderer } = require("electron");

const apiBase = String(
  process.env.SPEAKAPP_API_BASE || process.env.VITE_API_BASE || "",
).replace(/\/$/, "");

/*
 * Preview frames over direct MessagePorts (wired by the main process, see
 * trackFrameWindow in main.mjs), so JPEGs don't pass through the main process.
 * A publisher (voice host, screen host) holds one port per consumer window; a
 * consumer (main window, pop-out) holds one port per publisher.
 */
const framePortsOut = new Map(); // consumer id -> { port, trackSid }
const framePortsIn = new Map(); // publisher id -> port
const frameListeners = new Set();
const keyFrameHandlers = new Set();

function onKeyFrameRequest(trackSid) {
  if (typeof trackSid !== "string" || !trackSid) return;
  for (const handler of keyFrameHandlers) handler(trackSid);
}

ipcRenderer.on("frames:port", (event, info) => {
  const port = event.ports && event.ports[0];
  if (!port || !info || !info.id) return;
  if (info.role === "publisher") {
    const old = framePortsOut.get(info.id);
    if (old) old.port.close();
    // Viewers talk back on the same port to ask for a keyframe.
    port.onmessage = (e) => {
      if (e.data && e.data.op === "keyframe") onKeyFrameRequest(e.data.trackSid);
    };
    framePortsOut.set(info.id, { port, trackSid: info.trackSid || null });
  } else {
    const old = framePortsIn.get(info.id);
    if (old) old.close();
    const from = info.id;
    port.onmessage = (e) => {
      const frame = e.data && typeof e.data === "object" ? { ...e.data, from } : e.data;
      for (const handler of frameListeners) handler(frame);
    };
    framePortsIn.set(info.id, port);
  }
});

ipcRenderer.on("frames:port-close", (_event, info) => {
  const id = info && info.id;
  if (!id) return;
  const out = framePortsOut.get(id);
  if (out) {
    out.port.close();
    framePortsOut.delete(id);
  }
  const inPort = framePortsIn.get(id);
  if (inPort) {
    inPort.close();
    framePortsIn.delete(id);
  }
});

// Without ports (fallback), keyframe requests go through the main process.
ipcRenderer.on("frames:keyframe", (_event, trackSid) => onKeyFrameRequest(trackSid));

function requestKeyFrame(trackSid) {
  if (!trackSid) return;
  if (framePortsIn.size === 0) {
    ipcRenderer.send("voice:preview-keyframe", trackSid);
    return;
  }
  for (const port of framePortsIn.values()) port.postMessage({ op: "keyframe", trackSid });
}

function publishFrame(frame) {
  // Until the main window's port arrives, use the old IPC relay.
  if (!framePortsOut.has("main")) {
    ipcRenderer.send("voice:lobby-frame", frame);
    return;
  }
  const sid = frame && frame.trackSid;
  for (const { port, trackSid } of framePortsOut.values()) {
    if (!trackSid || trackSid === sid) port.postMessage(frame);
  }
}

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  apiBase,
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  getAppUpdate: () => ipcRenderer.invoke("app:update:get"),
  focusMain: () => ipcRenderer.invoke("window:focus-main"),
  showNotification: (opts) => ipcRenderer.invoke("desktop:notify", opts),
  loadE2eIdentity: (userId) => ipcRenderer.invoke("crypto:identity:load", userId),
  saveE2eIdentity: (userId, data) =>
    ipcRenderer.invoke("crypto:identity:save", userId, data),
  deleteE2eIdentity: (userId) =>
    ipcRenderer.invoke("crypto:identity:delete", userId),
  onNotificationClick: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("desktop:notify-click", listener);
    return () => ipcRenderer.removeListener("desktop:notify-click", listener);
  },
  setWindowTitle: (title) => ipcRenderer.invoke("window:set-title", title),
  onWindowTitle: (handler) => {
    const listener = (_event, title) => handler(String(title || ""));
    ipcRenderer.on("window:title", listener);
    return () => ipcRenderer.removeListener("window:title", listener);
  },
  setTitleBarColors: (colors) => ipcRenderer.invoke("window:titlebar-colors", colors),
  setBackgroundThrottling: (enabled) =>
    ipcRenderer.invoke("window:set-background-throttling", enabled),
  trimMemory: () => ipcRenderer.invoke("memory:trim"),
  listShareSources: (opts) => ipcRenderer.invoke("share:list-sources", opts),
  prepareDisplayCapture: (opts) => ipcRenderer.invoke("share:prepare-capture", opts),
  cancelDisplayCapture: () => ipcRenderer.invoke("share:cancel-capture"),
  openPopout: (opts) => ipcRenderer.invoke("popout:open", opts),
  closeAllPopouts: () => ipcRenderer.invoke("popout:close-all"),
  relaySignal: (payload) => ipcRenderer.invoke("relay:signal", payload),
  relayFrame: (payload) => ipcRenderer.send("relay:frame", payload),
  onSignal: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("relay:signal", listener);
    return () => ipcRenderer.removeListener("relay:signal", listener);
  },
  onFrame: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("relay:frame", listener);
    frameListeners.add(handler);
    return () => {
      ipcRenderer.removeListener("relay:frame", listener);
      frameListeners.delete(handler);
    };
  },
  onAppUpdate: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("app:update", listener);
    return () => ipcRenderer.removeListener("app:update", listener);
  },
  uploadTempMedia: (payload) => ipcRenderer.invoke("media:upload-temp", payload),
  uploadNotifySound: (payload) =>
    ipcRenderer.invoke("media:upload-notify-sound", payload),
  uploadImage: (payload) => ipcRenderer.invoke("media:upload-image", payload),
  getMemorySnapshot: () => ipcRenderer.invoke("diag:memory"),
  memoryLogFromEnv: () => ipcRenderer.invoke("diag:memory-env"),
  setScreenPreviewActive: (active) => ipcRenderer.send("voice:set-preview", active),
  setScreenPreviewFocused: (focused) =>
    ipcRenderer.send("voice:set-preview-focus", Boolean(focused)),
  /** Level 0 = hidden, 1 = lobby grid, 2 = pop-out / expanded tile. */
  onScreenPreview: (handler) => {
    const listener = (_event, level) => {
      const n = typeof level === "number" ? level : level ? 1 : 0;
      handler(Math.max(0, Math.min(2, n)));
    };
    ipcRenderer.on("voice:preview", listener);
    return () => ipcRenderer.removeListener("voice:preview", listener);
  },
  ensureVoiceHost: () => ipcRenderer.invoke("voice:ensure-host"),
  destroyVoiceHost: () => ipcRenderer.invoke("voice:destroy-host"),
  sendVoiceCommand: (cmd) => ipcRenderer.send("voice:cmd", cmd),
  publishVoiceEvent: (evt) => ipcRenderer.send("voice:evt", evt),
  publishLobbyFrame: (frame) => publishFrame(frame),
  requestPreviewKeyFrame: (trackSid) => requestKeyFrame(String(trackSid || "")),
  onPreviewKeyFrameRequest: (handler) => {
    keyFrameHandlers.add(handler);
    return () => keyFrameHandlers.delete(handler);
  },
  notifyVoiceHostReady: () => ipcRenderer.send("voice:host-ready"),
  onVoiceCommand: (handler) => {
    const listener = (_event, cmd) => handler(cmd);
    ipcRenderer.on("voice:cmd", listener);
    return () => ipcRenderer.removeListener("voice:cmd", listener);
  },
  onVoiceEvent: (handler) => {
    const listener = (_event, evt) => handler(evt);
    ipcRenderer.on("voice:evt", listener);
    return () => ipcRenderer.removeListener("voice:evt", listener);
  },
  onLobbyFrame: (handler) => {
    const listener = (_event, frame) => handler(frame);
    ipcRenderer.on("voice:lobby-frame", listener);
    frameListeners.add(handler);
    return () => {
      ipcRenderer.removeListener("voice:lobby-frame", listener);
      frameListeners.delete(handler);
    };
  },
  openScreenPublisher: (payload) => ipcRenderer.invoke("screen:open", payload),
  closeScreenPublisher: (sourceId) => ipcRenderer.invoke("screen:close", sourceId),
  reportScreenPublisher: (payload) => ipcRenderer.send("screen:result", payload),
  onScreenPublisherClosed: (handler) => {
    const listener = (_event, payload) => handler(payload?.sourceId || "");
    ipcRenderer.on("screen:closed", listener);
    return () => ipcRenderer.removeListener("screen:closed", listener);
  },
});
