import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  session,
  shell,
} from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import {
  deleteE2eIdentity,
  loadE2eIdentity,
  saveE2eIdentity,
} from "./e2eIdentityStore.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:1420";
const DEFAULT_APP_TITLE = "Espalha Brasas";

/** Optional separate profile for multi-account testing. */
if (process.env.ELECTRON_USER_DATA) {
  app.setPath("userData", process.env.ELECTRON_USER_DATA);
}

/** Performance-oriented Chromium flags (voice + screen share). */
app.commandLine.appendSwitch("js-flags", "--expose-gc");

let mainWindow = null;
let voiceHostWindow = null;
let voiceHostReady = false;
/** Block respawn while tearing down or shortly after destroy. */
let voiceHostTeardownUntil = 0;
/** True while a voice/DM session should keep (or spin up) the hidden host. */
let voiceHostSessionActive = false;
/** Commands queued until the hidden voice renderer finishes booting. */
const pendingVoiceCommands = [];
/** Main-process safety net if the voice renderer never emits host-idle. */
let voiceHostDestroyTimer = null;
const popouts = new Map();
/** Last update payload so the renderer can catch up if it mounted late. */
let lastUpdatePayload = null;

/** Custom Discord-style toast windows (bottom-right stack). */
const notifyPopups = new Map();
const NOTIFY_WIDTH = 400;
const NOTIFY_HEIGHT = 108;
const NOTIFY_MARGIN = 16;
const NOTIFY_GAP = 10;
const NOTIFY_TTL_MS = 7000;

function isMp3Buffer(buf) {
  if (buf.length < 3) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  if (buf[0] !== 0xff || buf.length < 2) return false;
  const next = buf[1];
  const synced = (next & 0xe0) === 0xe0;
  const versionOk = (next & 0x18) !== 0x08;
  const layerOk = (next & 0x06) !== 0x00;
  return synced && versionOk && layerOk;
}

function imageFileExt(filename, contentType) {
  const fromName = String(filename || "").match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName === "jpg") return "jpeg";
  if (fromName && ["png", "jpeg", "gif", "webp"].includes(fromName)) return fromName;
  const type = String(contentType || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpeg";
  if (type.includes("gif")) return "gif";
  if (type.includes("webp")) return "webp";
  return "png";
}

async function uploadImageToCatbox(buf, filename, contentType) {
  const ext = imageFileExt(filename, contentType);
  const safe = `image.${ext === "jpeg" ? "jpg" : ext}`;
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append(
    "fileToUpload",
    new Blob([new Uint8Array(buf)], { type: contentType || "image/png" }),
    safe,
  );
  const res = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    headers: { "User-Agent": "EspalhaBrasas/0.1" },
    body: form,
  });
  const text = (await res.text()).trim();
  const ok = new RegExp(
    `^https://files\\.catbox\\.moe/[a-z0-9]+\\.${ext === "jpeg" ? "jpe?g" : ext}$`,
    "i",
  ).test(text);
  if (!res.ok || !ok) {
    throw new Error(
      text && text.length < 200 ? `Upload failed: ${text}` : `Upload failed (${res.status})`,
    );
  }
  return text;
}

function notifyAppIconUrl() {
  const candidates = [
    path.join(__dirname, "..", "dist", "icon-192.png"),
    path.join(__dirname, "..", "public", "icon-192.png"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return "";
}

function notificationPopupPath() {
  return path.join(__dirname, "notificationPopup.html");
}

function repositionNotifyPopups() {
  const wins = [...notifyPopups.values()].filter((w) => w && !w.isDestroyed());
  const area = screen.getPrimaryDisplay().workArea;
  wins.forEach((win, index) => {
    const y =
      area.y +
      area.height -
      NOTIFY_MARGIN -
      NOTIFY_HEIGHT -
      index * (NOTIFY_HEIGHT + NOTIFY_GAP);
    const x = area.x + area.width - NOTIFY_MARGIN - NOTIFY_WIDTH;
    win.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: NOTIFY_WIDTH,
      height: NOTIFY_HEIGHT,
    });
  });
}

function closeNotifyPopup(tag) {
  if (!tag) return;
  const win = notifyPopups.get(tag);
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  notifyPopups.delete(tag);
  repositionNotifyPopups();
}

function showCustomNotifyPopup(opts) {
  const tag =
    typeof opts?.tag === "string" && opts.tag.trim()
      ? opts.tag.trim()
      : `notify-${Date.now()}`;

  closeNotifyPopup(tag);

  const win = new BrowserWindow({
    width: NOTIFY_WIDTH,
    height: NOTIFY_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "notificationPreload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  notifyPopups.set(tag, win);
  repositionNotifyPopups();

  const payload = {
    tag,
    appName:
      typeof opts?.appName === "string" && opts.appName.trim()
        ? opts.appName.trim().slice(0, 60)
        : DEFAULT_APP_TITLE,
    appIcon: notifyAppIconUrl(),
    authorName:
      typeof opts?.authorName === "string"
        ? opts.authorName.trim().slice(0, 80)
        : "Someone",
    authorAvatar:
      typeof opts?.authorAvatar === "string" ? opts.authorAvatar : null,
    context:
      typeof opts?.context === "string" ? opts.context.trim().slice(0, 80) : "",
    preview:
      typeof opts?.preview === "string"
        ? opts.preview.trim().slice(0, 240)
        : "New message",
  };

  win.on("closed", () => {
    notifyPopups.delete(tag);
    repositionNotifyPopups();
  });

  const timer = setTimeout(() => closeNotifyPopup(tag), NOTIFY_TTL_MS);
  win.on("closed", () => clearTimeout(timer));

  win.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) return;
    win.webContents.send("notify:data", payload);
    win.showInactive();
  });

  void win.loadFile(notificationPopupPath());
  return true;
}

function preloadPath() {
  return path.join(__dirname, "preload.cjs");
}

function voiceHostPageUrl() {
  if (isDev) return `${DEV_URL}/voice-host.html`;
  return path.join(__dirname, "..", "dist", "voice-host.html");
}

const screenHosts = new Map();
const screenOpenWaiters = new Map();

function destroyScreenHostWindow(sourceId) {
  const win = screenHosts.get(sourceId);
  screenHosts.delete(sourceId);
  if (win && !win.isDestroyed()) {
    try {
      win.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function closeScreenHost(sourceId) {
  const win = screenHosts.get(sourceId);
  if (!win || win.isDestroyed()) {
    screenHosts.delete(sourceId);
    return;
  }
  try {
    await Promise.race([
      win.webContents.executeJavaScript("window.__stopScreenHost?.()", true),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
  } catch {
    /* page already gone */
  }
  destroyScreenHostWindow(sourceId);
}

function closeAllScreenHosts() {
  for (const sourceId of [...screenHosts.keys()]) {
    void closeScreenHost(sourceId);
  }
}

function sendToMainRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendToVoiceHostRenderer(channel, payload) {
  if (voiceHostWindow && !voiceHostWindow.isDestroyed()) {
    voiceHostWindow.webContents.send(channel, payload);
  }
}

function flushPendingVoiceCommands() {
  while (pendingVoiceCommands.length) {
    const cmd = pendingVoiceCommands.shift();
    sendToVoiceHostRenderer("voice:cmd", cmd);
  }
}

let screenPreviewWanted = false;
let screenPreviewFocused = false;

/**
 * Preview level for the JPEG relays that feed lobby tiles and pop-outs:
 * 0 = nobody is looking (relays stop), 1 = lobby grid visible,
 * 2 = a pop-out or an expanded tile is open (full frame rate / size).
 */
function screenPreviewLevel() {
  if (popouts.size > 0 || (screenPreviewWanted && screenPreviewFocused)) return 2;
  return screenPreviewWanted ? 1 : 0;
}

function pushScreenPreview() {
  const level = screenPreviewLevel();
  sendToVoiceHostRenderer("voice:preview", level);
  // Each live's own process makes the streamer's preview; it must follow the
  // same level so it stops encoding when the lobby is not on screen.
  for (const win of screenHosts.values()) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("voice:preview", level);
    }
  }
}

function markVoiceHostReady() {
  voiceHostReady = true;
  flushPendingVoiceCommands();
  pushScreenPreview();
}

function closeAllScreenPopouts() {
  for (const win of popouts.values()) {
    if (!win.isDestroyed()) {
      try {
        win.close();
      } catch {
        /* ignore */
      }
    }
  }
  popouts.clear();
  pushScreenPreview();
}

function clearVoiceHostDestroyFallback() {
  if (voiceHostDestroyTimer != null) {
    clearTimeout(voiceHostDestroyTimer);
    voiceHostDestroyTimer = null;
  }
}

function scheduleVoiceHostDestroyFallback(delayMs = 5000) {
  clearVoiceHostDestroyFallback();
  voiceHostDestroyTimer = setTimeout(() => {
    voiceHostDestroyTimer = null;
    if (voiceHostWindow && !voiceHostWindow.isDestroyed()) {
      destroyVoiceHost();
    }
  }, delayMs);
}

function destroyVoiceHost() {
  clearVoiceHostDestroyFallback();
  closeAllScreenHosts();
  voiceHostReady = false;
  voiceHostSessionActive = false;
  voiceHostTeardownUntil = Date.now() + 5000;
  pendingVoiceCommands.length = 0;
  closeAllScreenPopouts();
  const win = voiceHostWindow;
  voiceHostWindow = null;
  if (!win || win.isDestroyed()) {
    return;
  }
  const wc = win.webContents;
  const finish = () => {
    if (win.isDestroyed()) return;
    if (wc && !wc.isDestroyed()) {
      try {
        wc.setBackgroundThrottling(true);
      } catch {
        /* ignore */
      }
      try {
        wc.close();
      } catch {
        /* ignore */
      }
    }
    try {
      win.destroy();
    } catch {
      /* ignore */
    }
  };
  if (!wc || wc.isDestroyed()) {
    finish();
    return;
  }
  // Release desktop-capture consumers before the renderer dies. Killing the
  // window while a hidden <video> still holds the share track leaks that process.
  // Stop every attached track and wait until it fires "ended" before the
  // renderer is killed. Destroying the window in the same turn drops the
  // capturer-stop message, and Windows then keeps that utility process.
  const release = wc
    .executeJavaScript(
      `(async () => {
        const tracks = [];
        const seen = new Set();
        const take = (track) => {
          if (track && !seen.has(track)) {
            seen.add(track);
            tracks.push(track);
          }
        };
        document.querySelectorAll("video,audio").forEach((el) => {
          try { el.pause(); } catch (e) {}
          const stream = el.srcObject;
          if (stream && stream.getTracks) stream.getTracks().forEach(take);
          try { el.srcObject = null; el.removeAttribute("src"); el.load(); } catch (e) {}
        });
        const ended = tracks.map((track) => new Promise((resolve) => {
          if (track.readyState === "ended") { resolve(); return; }
          const timer = setTimeout(resolve, 800);
          track.addEventListener("ended", () => { clearTimeout(timer); resolve(); }, { once: true });
        }));
        for (const track of tracks) {
          try { track.stop(); } catch (e) {}
        }
        await Promise.race([
          Promise.all(ended),
          new Promise((resolve) => setTimeout(resolve, 900)),
        ]);
      })()`,
      true,
    )
    .catch(() => undefined);
  const timer = setTimeout(finish, 1500);
  void release.finally(() => {
    clearTimeout(timer);
    setTimeout(finish, 300);
  });
}

/** Commands that must never recreate the hidden LiveKit window. */
function voiceHostNoSpawnOps(op) {
  return op === "sync-local" || op === "leave";
}

function markVoiceHostSessionActive(active) {
  voiceHostSessionActive = Boolean(active);
}

function voiceHostSessionOps(op) {
  return [
    "join",
    "join-dm",
    "leave",
    "toggle-mute",
    "toggle-deafen",
    "toggle-camera",
    "share-screen",
    "open-screen-picker",
    "close-screen-picker",
    "publish-electron-share",
    "publish-browser-share",
    "stop-screen-share",
    "stop-local-share",
    "join-remote-screen",
    "leave-remote-screen",
    "set-screen-share-volume",
    "set-screen-share-muted",
    "apply-user-mic",
    "apply-user-video-hide",
  ].includes(op);
}

function ensureVoiceHostWindow() {
  if (Date.now() < voiceHostTeardownUntil) {
    return new Promise((resolve) => {
      const wait = () => {
        if (!voiceHostSessionActive) {
          resolve(false);
          return;
        }
        if (Date.now() >= voiceHostTeardownUntil) {
          void ensureVoiceHostWindow().then(resolve);
          return;
        }
        setTimeout(wait, 100);
      };
      wait();
    });
  }
  if (!voiceHostSessionActive) {
    return Promise.resolve(false);
  }
  if (voiceHostWindow && !voiceHostWindow.isDestroyed() && voiceHostReady) {
    return Promise.resolve(true);
  }
  if (voiceHostWindow && !voiceHostWindow.isDestroyed()) {
    return new Promise((resolve) => {
      const waitReady = () => {
        if (voiceHostReady) {
          resolve(true);
          return;
        }
        setTimeout(waitReady, 50);
      };
      waitReady();
    });
  }

  voiceHostReady = false;
  voiceHostWindow = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      v8CacheOptions: "code",
    },
  });

  voiceHostWindow.setTitle(`${DEFAULT_APP_TITLE} Voice Host`);

  voiceHostWindow.on("closed", () => {
    voiceHostWindow = null;
    voiceHostReady = false;
  });

  if (isDev) {
    void voiceHostWindow.loadURL(voiceHostPageUrl());
  } else {
    void voiceHostWindow.loadFile(voiceHostPageUrl());
  }

  return new Promise((resolve) => {
    const waitReady = () => {
      if (voiceHostReady) {
        resolve(true);
        return;
      }
      if (!voiceHostWindow || voiceHostWindow.isDestroyed()) {
        resolve(false);
        return;
      }
      setTimeout(waitReady, 50);
    };
    waitReady();
  });
}

function createMainWindow() {
  const iconPath = path.join(__dirname, "icon.png");
  mainWindow = new BrowserWindow({
    title: DEFAULT_APP_TITLE,
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
    destroyVoiceHost();
    mainWindow = null;
  });
}

let pendingDisplayCapture = null;

function installSessionHandlers() {
  const ses = session.defaultSession;

  // Chosen source from our picker. getDisplayMedia (not the legacy
  // chromeMediaSource getUserMedia path) is what actually exits the Windows
  // capture process when the track stops.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    const pending = pendingDisplayCapture;
    pendingDisplayCapture = null;
    if (!pending?.sourceId) {
      callback({});
      return;
    }
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });
      const source = sources.find((s) => s.id === pending.sourceId);
      if (!source) {
        callback({});
        return;
      }
      callback({
        video: source,
        audio: pending.systemAudio ? "loopback" : undefined,
      });
    } catch {
      callback({});
    }
  });

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allow = [
      "media",
      "audioCapture",
      "videoCapture",
      "display-capture",
      "mediaKeySystem",
      "notifications",
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
      "notifications",
    ].includes(permission),
  );
}

function registerIpc() {
  ipcMain.on("notify:action", (_evt, payload) => {
    const tag = typeof payload?.tag === "string" ? payload.tag : "";
    if (payload?.action === "close") {
      closeNotifyPopup(tag);
      return;
    }
    if (payload?.action === "open") {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      if (tag) {
        sendToMainRenderer("desktop:notify-click", { tag });
      }
      closeNotifyPopup(tag);
    }
  });

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
  ipcMain.handle("diag:memory", () => memorySnapshot());
  ipcMain.handle("diag:memory-env", () => process.env.SPEAKAPP_MEM_LOG === "1");

  ipcMain.handle("window:focus-main", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  });

  ipcMain.handle("desktop:notify", (_evt, opts) => showCustomNotifyPopup(opts));

  ipcMain.handle("crypto:identity:load", (_evt, userId) =>
    loadE2eIdentity(userId),
  );
  ipcMain.handle("crypto:identity:save", (_evt, userId, data) => {
    saveE2eIdentity(userId, data);
    return true;
  });
  ipcMain.handle("crypto:identity:delete", (_evt, userId) =>
    deleteE2eIdentity(userId),
  );

  /** Updates taskbar + Windows Task Manager process label while in voice. */
  ipcMain.handle("window:set-title", (_evt, title) => {
    const next =
      typeof title === "string" && title.trim()
        ? title.trim().slice(0, 120)
        : DEFAULT_APP_TITLE;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(next);
    }
    process.title = next;
    return true;
  });

  ipcMain.handle("share:prepare-capture", (_evt, payload = {}) => {
    const sourceId = String(payload.sourceId || "");
    if (!sourceId) {
      throw new Error("screen source required");
    }
    pendingDisplayCapture = {
      sourceId,
      systemAudio: payload.systemAudio !== false,
    };
    return true;
  });

  ipcMain.handle("share:cancel-capture", () => {
    pendingDisplayCapture = null;
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
        backgroundThrottling: false,
        v8CacheOptions: "code",
      },
    });

    popouts.set(key, win);
    pushScreenPreview();
    win.on("closed", () => {
      popouts.delete(key);
      pushScreenPreview();
    });

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
    closeAllScreenPopouts();
    return true;
  });

  ipcMain.handle("window:set-background-throttling", (_evt, enabled) => {
    const on = Boolean(enabled);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setBackgroundThrottling(on);
    }
    if (voiceHostWindow && !voiceHostWindow.isDestroyed()) {
      voiceHostWindow.webContents.setBackgroundThrottling(on);
    }
    return true;
  });

  ipcMain.handle("memory:trim", async () => {
    const ses = session.defaultSession;
    try {
      await ses.clearCache();
      ses.clearHostResolverCache();
      ses.clearAuthCache();
    } catch (err) {
      console.warn("memory:trim", err);
    }
    return true;
  });

  ipcMain.handle("voice:ensure-host", () => {
    markVoiceHostSessionActive(true);
    clearVoiceHostDestroyFallback();
    return ensureVoiceHostWindow();
  });

  ipcMain.handle("voice:destroy-host", () => {
    destroyVoiceHost();
    return true;
  });

  ipcMain.handle("screen:open", async (_evt, payload = {}) => {
    const sourceId = String(payload.sourceId || "");
    if (!sourceId) throw new Error("screen source required");
    if (screenHosts.has(sourceId)) {
      throw new Error("That screen is already being shared");
    }
    const query = new URLSearchParams({
      sourceId,
      mode: payload.mode === "dm" ? "dm" : "channel",
      targetId: String(payload.targetId || ""),
      systemAudio: payload.systemAudio === false ? "0" : "1",
      maxWidth: String(payload.maxWidth || 1920),
      maxHeight: String(payload.maxHeight || 1080),
      maxFps: String(payload.maxFps === 60 ? 60 : 30),
      resolution: String(payload.resolution || "1080p"),
    });
    const win = new BrowserWindow({
      show: false,
      width: 640,
      height: 480,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
        v8CacheOptions: "code",
      },
    });
    screenHosts.set(sourceId, win);
    win.on("closed", () => {
      screenHosts.delete(sourceId);
      const waiter = screenOpenWaiters.get(sourceId);
      if (waiter) {
        screenOpenWaiters.delete(sourceId);
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Screen publisher closed"));
      }
      sendToVoiceHostRenderer("screen:closed", { sourceId });
    });
    // Tell the new live process whether anyone is looking at the preview.
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed()) {
        win.webContents.send("voice:preview", screenPreviewLevel());
      }
    });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        screenOpenWaiters.delete(sourceId);
        reject(new Error("Screen publisher timed out"));
        void closeScreenHost(sourceId);
      }, 20000);
      screenOpenWaiters.set(sourceId, { resolve, reject, timer });
    });
    if (isDev) {
      void win.loadURL(`${DEV_URL}/screen-host.html?${query.toString()}`);
    } else {
      void win.loadFile(path.join(__dirname, "..", "dist", "screen-host.html"), {
        search: query.toString(),
      });
    }
    return ready;
  });

  ipcMain.on("screen:result", (_evt, payload = {}) => {
    const sourceId = String(payload.sourceId || "");
    const waiter = screenOpenWaiters.get(sourceId);
    if (!waiter) return;
    screenOpenWaiters.delete(sourceId);
    clearTimeout(waiter.timer);
    if (payload.ok && payload.trackSid) {
      waiter.resolve({
        trackSid: String(payload.trackSid),
        hasAudio: Boolean(payload.hasAudio),
      });
      return;
    }
    void closeScreenHost(sourceId);
    waiter.reject(new Error(String(payload.error || "Screen share failed")));
  });

  ipcMain.handle("screen:close", async (_evt, sourceId) => {
    await closeScreenHost(String(sourceId || ""));
    return true;
  });

  ipcMain.handle("screen:close-all", async () => {
    await Promise.all([...screenHosts.keys()].map((id) => closeScreenHost(id)));
    return true;
  });

  ipcMain.on("voice:cmd", (_evt, cmd) => {
    const op = cmd?.op;
    if (op === "join" || op === "join-dm") {
      markVoiceHostSessionActive(true);
      clearVoiceHostDestroyFallback();
    }
    if (op === "leave") {
      markVoiceHostSessionActive(false);
      pendingVoiceCommands.length = 0;
      if (voiceHostReady) {
        sendToVoiceHostRenderer("voice:cmd", cmd);
        scheduleVoiceHostDestroyFallback(5000);
      } else if (voiceHostWindow && !voiceHostWindow.isDestroyed()) {
        destroyVoiceHost();
      }
      return;
    }
    if (voiceHostReady) {
      sendToVoiceHostRenderer("voice:cmd", cmd);
      return;
    }
    if (voiceHostNoSpawnOps(op)) {
      return;
    }
    if (!voiceHostSessionOps(op)) {
      return;
    }
    if (!voiceHostSessionActive) {
      return;
    }
    pendingVoiceCommands.push(cmd);
    void ensureVoiceHostWindow().then((ok) => {
      if (!ok) {
        pendingVoiceCommands.length = 0;
      }
    });
  });

  ipcMain.on("voice:evt", (_evt, payload) => {
    if (payload?.op === "host-idle") {
      destroyVoiceHost();
    } else if (
      payload?.op === "state" &&
      !payload.connected &&
      !payload.joining &&
      !payload.voiceChannelId &&
      !payload.dmCallId
    ) {
      markVoiceHostSessionActive(false);
    }
    sendToMainRenderer("voice:evt", payload);
  });

  ipcMain.on("voice:lobby-frame", (_evt, payload) => {
    sendToMainRenderer("voice:lobby-frame", payload);
    const sid = payload?.trackSid;
    if (!sid) return;
    const win = popouts.get(`screen-${sid}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send("relay:frame", payload);
    }
  });

  ipcMain.on("voice:host-ready", () => {
    markVoiceHostReady();
  });

  ipcMain.on("voice:set-preview", (_evt, active) => {
    screenPreviewWanted = Boolean(active);
    if (!screenPreviewWanted) screenPreviewFocused = false;
    pushScreenPreview();
  });

  ipcMain.on("voice:set-preview-focus", (_evt, focused) => {
    screenPreviewFocused = Boolean(focused);
    pushScreenPreview();
  });

  ipcMain.handle("relay:signal", (_evt, payload) => {
    // Host (main window) owns MediaStreamTracks — only it needs request/stop.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("relay:signal", payload);
    }
    return true;
  });

  ipcMain.on("relay:frame", (_evt, payload) => {
    // Browser fallback only. Desktop pop-outs are fed from voice:lobby-frame.
    const sid = payload?.trackSid;
    if (!sid) return;
    const win = popouts.get(`screen-${sid}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send("relay:frame", payload);
    }
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

  /**
   * Notification sounds: same off-server upload as other files, but permanent
   * Catbox (random files.catbox.moe link) instead of a 72h Litterbox file.
   * Only small MP3s — this is not a general upload endpoint.
   */
  ipcMain.handle("media:upload-notify-sound", async (_evt, payload = {}) => {
    const filename = String(payload.filename || "notify.mp3").replace(/[/\\]/g, "_");
    if (!filename.toLowerCase().endsWith(".mp3")) {
      throw new Error("Only .mp3 files can be used as a notification sound");
    }
    const raw = payload.data;
    if (!raw) {
      throw new Error("file data required");
    }
    const buf = Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(raw instanceof ArrayBuffer ? raw : new Uint8Array(raw));
    const maxBytes = 1024 * 1024;
    if (buf.length === 0) {
      throw new Error("empty file");
    }
    if (buf.length > maxBytes) {
      throw new Error("MP3 must be 1 MB or smaller");
    }
    if (!isMp3Buffer(buf)) {
      throw new Error("That file is not a valid MP3");
    }

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append(
      "fileToUpload",
      new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }),
      filename,
    );

    const res = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      headers: { "User-Agent": "EspalhaBrasas/0.1" },
      body: form,
    });
    const text = (await res.text()).trim();
    if (!res.ok || !/^https:\/\/files\.catbox\.moe\/[a-z0-9]+\.mp3$/i.test(text)) {
      throw new Error(
        text && text.length < 200
          ? `Upload failed: ${text}`
          : `Upload failed (${res.status})`,
      );
    }
    return { url: text, size: buf.length, filename };
  });

  /** Images go to Catbox as a direct file URL. If it fails, the renderer falls back to /api/media/upload (the server holds the ImgBB key). */
  ipcMain.handle("media:upload-image", async (_evt, payload = {}) => {
    const filename = String(payload.filename || "image.png").replace(/[/\\]/g, "_");
    const contentType = String(payload.contentType || "image/png");
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
    const maxBytes = 25 * 1024 * 1024;
    if (buf.length > maxBytes) {
      throw new Error("file too large (max 25 MB)");
    }

    const url = await uploadImageToCatbox(buf, filename, contentType);
    return { url, size: buf.length, filename, contentType };
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

/** Which window an OS process belongs to, for the memory snapshot. */
function memoryLabelForPid(pid) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.webContents.getOSProcessId() !== pid) continue;
    if (win === mainWindow) return "main-window";
    if (win === voiceHostWindow) return "voice-host";
    for (const [sourceId, host] of screenHosts) {
      if (host === win) return `screen-host:${sourceId.slice(0, 12)}`;
    }
    return "popout";
  }
  return "";
}

/**
 * RAM per Electron process (working set, MB). The renderer sends this to the
 * API every 10 s when memory diagnostics are on (User Settings → Voice &
 * Video), so the samples end up on the server.
 */
function memorySnapshot() {
  const metrics = app.getAppMetrics();
  const processes = metrics.map((m) => ({
    kind: `${m.type}${m.name ? `(${m.name})` : ""}`,
    label: memoryLabelForPid(m.pid),
    mb: Math.round((m.memory?.workingSetSize ?? 0) / 1024),
  }));
  const total = processes.reduce((sum, p) => sum + p.mb, 0);
  return { total_mb: total, processes, app_version: app.getVersion() };
}

/** SPEAKAPP_MEM_LOG=1 also prints each snapshot to the terminal (dev runs). */
function startMemoryLog() {
  if (process.env.SPEAKAPP_MEM_LOG !== "1") return;
  setInterval(() => {
    const snap = memorySnapshot();
    const rows = snap.processes.map(
      (p) => `${p.kind}${p.label ? `[${p.label}]` : ""}=${p.mb}MB`,
    );
    console.log(`[mem] total=${snap.total_mb}MB ${rows.join(" ")}`);
  }, 10_000);
}

app.whenReady().then(() => {
  installSessionHandlers();
  registerIpc();
  createMainWindow();
  setupAutoUpdate();
  startMemoryLog();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
