const { contextBridge, ipcRenderer } = require("electron");

const apiBase = String(
  process.env.SPEAKAPP_API_BASE || process.env.VITE_API_BASE || "",
).replace(/\/$/, "");

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
    return () => ipcRenderer.removeListener("relay:frame", listener);
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
  setScreenPreviewActive: (active) => ipcRenderer.send("voice:set-preview", active),
  onScreenPreview: (handler) => {
    const listener = (_event, active) => handler(Boolean(active));
    ipcRenderer.on("voice:preview", listener);
    return () => ipcRenderer.removeListener("voice:preview", listener);
  },
  ensureVoiceHost: () => ipcRenderer.invoke("voice:ensure-host"),
  destroyVoiceHost: () => ipcRenderer.invoke("voice:destroy-host"),
  sendVoiceCommand: (cmd) => ipcRenderer.send("voice:cmd", cmd),
  publishVoiceEvent: (evt) => ipcRenderer.send("voice:evt", evt),
  publishLobbyFrame: (frame) => ipcRenderer.send("voice:lobby-frame", frame),
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
    return () => ipcRenderer.removeListener("voice:lobby-frame", listener);
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
