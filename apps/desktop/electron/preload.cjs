const { contextBridge, ipcRenderer } = require("electron");

const apiBase = String(
  process.env.SPEAKAPP_API_BASE || process.env.VITE_API_BASE || "",
).replace(/\/$/, "");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  apiBase,
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  focusMain: () => ipcRenderer.invoke("window:focus-main"),
  setBackgroundThrottling: (enabled) =>
    ipcRenderer.invoke("window:set-background-throttling", enabled),
  listShareSources: (opts) => ipcRenderer.invoke("share:list-sources", opts),
  openPopout: (opts) => ipcRenderer.invoke("popout:open", opts),
  closeAllPopouts: () => ipcRenderer.invoke("popout:close-all"),
  relaySignal: (payload) => ipcRenderer.invoke("relay:signal", payload),
  relayFrame: (payload) => ipcRenderer.invoke("relay:frame", payload),
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
});
