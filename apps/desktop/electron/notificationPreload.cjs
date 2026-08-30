const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("notifyAPI", {
  onData: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("notify:data", listener);
    return () => ipcRenderer.removeListener("notify:data", listener);
  },
  action: (payload) => ipcRenderer.send("notify:action", payload),
});
