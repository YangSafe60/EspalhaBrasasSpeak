import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
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
/** Last update payload so the renderer can catch up if it mounted late. */
let lastUpdatePayload = null;

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
    appVersion: app.getVersion(),
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  ipcMain.handle("app:update:get", () => lastUpdatePayload);

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

  /** Upload non-image files from the user's machine (bypasses VPS + CORS). */
  ipcMain.handle("media:upload-temp", async (_evt, payload = {}) => {
    const filename = String(payload.filename || "file.bin").replace(/[/\\]/g, "_");
    const contentType = String(payload.contentType || "application/octet-stream");
    const expire = ["1h", "12h", "24h", "72h"].includes(payload.expire)
      ? payload.expire
      : "72h";
    const raw = payload.data;
    if (!raw) {
      throw new Error("file data required");
    }
    const buf = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(raw instanceof ArrayBuffer ? raw : new Uint8Array(raw));
    if (buf.length === 0) {
      throw new Error("empty file");
    }
    // Match server default MAX_UPLOAD_BYTES (25 MiB).
    const maxBytes = 25 * 1024 * 1024;
    if (buf.length > maxBytes) {
      throw new Error("file too large (max 25 MB)");
    }

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("time", expire);
    form.append(
      "fileToUpload",
      new Blob([new Uint8Array(buf)], { type: contentType }),
      filename,
    );

    const res = await fetch(
      "https://litterbox.catbox.moe/resources/internals/api.php",
      { method: "POST", body: form },
    );
    const text = (await res.text()).trim();
    if (!res.ok || !/^https:\/\/litter\.catbox\.moe\//i.test(text)) {
      throw new Error(
        text && text.length < 200
          ? `Litterbox upload failed: ${text}`
          : `Litterbox upload failed (${res.status})`,
      );
    }
    return { url: text, size: buf.length, filename, contentType };
  });
}

function sendAppUpdate(payload) {
  lastUpdatePayload = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update", payload);
  }
}

function setupAutoUpdate() {
  if (isDev) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.warn("electron-updater not available", e);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Prefer in-app fire overlay over OS toast notifications.

  const restartWithUpdate = (info) => {
    sendAppUpdate({
      phase: "ready",
      percent: 100,
      version: info?.version || lastUpdatePayload?.version || "",
    });
    for (const win of popouts.values()) {
      if (!win.isDestroyed()) win.close();
    }
    popouts.clear();
    // Give the fire overlay a moment to show "restarting", then silent install + relaunch.
    setTimeout(() => {
      try {
        // isSilent=true → no NSIS wizard / Finish button
        // isForceRunAfter=true → open the app again when done
        autoUpdater.quitAndInstall(true, true);
      } catch (err) {
        console.warn("quitAndInstall", err);
        app.relaunch();
        app.exit(0);
      }
    }, 1800);
  };

  autoUpdater.on("checking-for-update", () => {
    // Keep idle until we know there is something to download.
  });

  autoUpdater.on("update-available", (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setBackgroundThrottling(false);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    sendAppUpdate({
      phase: "downloading",
      percent: 0,
      version: info?.version || "",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendAppUpdate({
      phase: "downloading",
      percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
      version: lastUpdatePayload?.version || "",
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    restartWithUpdate(info);
  });

  autoUpdater.on("error", (err) => {
    console.warn("auto-update", err);
    sendAppUpdate({
      phase: "idle",
      percent: 0,
      version: "",
      error: String(err?.message || err || "update failed"),
    });
  });

  const startCheck = () => {
    void autoUpdater.checkForUpdates().catch((err) => {
      console.warn("checkForUpdates", err);
    });
  };

  // Wait until the UI can receive the fire-overlay events.
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", () => {
        setTimeout(startCheck, 600);
      });
    } else {
      setTimeout(startCheck, 600);
    }
  } else {
    setTimeout(startCheck, 1200);
  }
}

app.whenReady().then(() => {
  installSessionHandlers();
  registerIpc();
  createMainWindow();
  setupAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
