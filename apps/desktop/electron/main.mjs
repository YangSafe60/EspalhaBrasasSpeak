import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:1420";

/** Optional separate profile for multi-account testing. */
if (process.env.ELECTRON_USER_DATA) {
  app.setPath("userData", process.env.ELECTRON_USER_DATA);
}

/** Performance-oriented Chromium flags (voice + screen share). */
// Prefer normal Chromium memory reclaim; voice join toggles throttling via IPC.
// Keep GPU / HW decode for video (do not call disableHardwareAcceleration).

let mainWindow = null;
const popouts = new Map();

function preloadPath() {
  return path.join(__dirname, "preload.cjs");
}

function createMainWindow() {
  const iconPath = path.join(__dirname, "icon.png");
  mainWindow = new BrowserWindow({
    title: "Espalha Brasas",
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#0c0d11",
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true,
      v8CacheOptions: "code",
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function installSessionHandlers() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = [
      "media",
      "audioCapture",
      "videoCapture",
      "display-capture",
      "mediaKeySystem",
    ].includes(permission);
    callback(allow);
  });

  ses.setPermissionCheckHandler((_wc, permission) =>
    [
      "media",
      "audioCapture",
      "videoCapture",
      "display-capture",
      "mediaKeySystem",
    ].includes(permission),
  );
}

function registerIpc() {
  ipcMain.handle("desktop:info", () => ({
    isElectron: true,
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  ipcMain.handle("window:focus-main", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  });

  ipcMain.handle("share:list-sources", async (_evt, opts = {}) => {
    const types = opts.types || ["screen", "window"];
    const sources = await desktopCapturer.getSources({
      types,
      thumbnailSize: { width: 160, height: 90 },
      fetchWindowIcons: false,
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle("popout:open", async (_evt, { title, trackSid, url }) => {
    const key = `screen-${trackSid}`;
    const existing = popouts.get(key);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return { ok: true, reused: true };
    }

    const win = new BrowserWindow({
      title: title || "Screen",
      width: 960,
      height: 540,
      minWidth: 480,
      minHeight: 270,
      show: true,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      icon: path.join(__dirname, "icon.png"),
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: true,
        v8CacheOptions: "code",
      },
    });

    popouts.set(key, win);
    win.on("closed", () => popouts.delete(key));

    if (isDev) {
      void win.loadURL(url);
    } else {
      const u = new URL(`file://${path.join(__dirname, "..", "dist", "index.html")}`);
      const incoming = new URL(url);
      u.search = incoming.search;
      void win.loadURL(u.href);
    }
    return { ok: true, reused: false };
  });

  ipcMain.handle("popout:close-all", () => {
    for (const win of popouts.values()) {
      if (!win.isDestroyed()) win.close();
    }
    popouts.clear();
    return true;
  });

  ipcMain.handle("window:set-background-throttling", (_evt, enabled) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setBackgroundThrottling(Boolean(enabled));
    }
    return true;
  });

  ipcMain.handle("relay:signal", (_evt, payload) => {
    // Host (main window) owns MediaStreamTracks — only it needs request/stop.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("relay:signal", payload);
    }
    return true;
  });

  ipcMain.handle("relay:frame", (_evt, payload) => {
    // Don't fan JPEG frames into every window — only the matching popout.
    const sid = payload?.trackSid;
    if (!sid) return true;
    const win = popouts.get(`screen-${sid}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send("relay:frame", payload);
    }
    return true;
  });
}

app.whenReady().then(() => {
  installSessionHandlers();
  registerIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
