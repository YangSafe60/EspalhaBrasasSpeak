# Desktop client (Electron)

Espalha Brasas ships as an Electron app under `apps/desktop`.

## Dev

```bash
cd apps/desktop
npm install
npm run desktop   # Vite :1420 + Electron window
```

From repo root (Windows): `.\scripts\run-desktop.ps1`

Do not open `http://127.0.0.1:1420` in a browser — screen share and pop-outs need Electron.

## Production package

```bash
cd apps/desktop
# Bake the public API URL into the client:
#   export VITE_API_BASE=https://your.domain   # bash
#   $env:VITE_API_BASE="https://your.domain"   # PowerShell
npm run dist
```

| Artifact | Location |
|----------|----------|
| Windows installer | `apps/desktop/release/Espalha Brasas-<version>-Setup.exe` |
| Unpacked (portable test) | `apps/desktop/release/win-unpacked/Espalha Brasas.exe` |

Root shortcut: `npm run desktop:dist`

Targets are defined in `electron-builder.yml` (Win NSIS, macOS DMG, Linux AppImage).

**Upgrade:** each push to `main` builds a Windows installer, bumps the patch version, and publishes a [GitHub Release](https://github.com/YangSafe60/EspalhaBrasasSpeak/releases). Installed apps check that feed on startup and download/install when you quit if a newer version exists.

Dev (`npm run desktop`) does not auto-update.

## Multi-account (same machine)

```powershell
$env:ELECTRON_USER_DATA = "$env:TEMP\espalha-brasas-alt"
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:1420"
cd apps\desktop
npx electron .
```

## Process architecture

Each piece runs in its own Chromium renderer process, so a crash or a memory
spike in one does not take down the others:

| Process | Created by | Lives while | Does |
|---------|-----------|-------------|------|
| **Main window** | app start | the app is open | UI: servers, chat, DMs, settings. Never holds a LiveKit connection. |
| **Voice host** (hidden window, `voice-host.html`) | joining voice (`voice:ensure-host`) | you are in a voice channel or DM call | LiveKit room: mic, camera, playback of other people's audio/video, and the preview frames of their lives. |
| **Screen host** (hidden window, `screen-host.html`), **one per live** | starting a screen share (`screen:open`) | that live | Captures one screen/window with `desktopCapturer`, publishes it to LiveKit with its own screen token, and produces the local preview. |

Stopping a live closes its screen-host window, which ends that process and
frees its memory. Leaving voice destroys the voice host.

### Preview levels

The picture you see of a live inside the app (lobby tiles, pop-out) is a
separate preview stream, not the WebRTC track other people receive. The voice
host and each screen host encode it with WebCodecs (H.264, hardware when
available, VP8 otherwise) and send the chunks over direct MessagePorts to the
main window and pop-outs, which decode them onto a `<canvas>`. No Blobs are
involved (Chromium keeps Blob bytes in the main process), and one encoder per
level is kept ready so switching level doesn't freeze the picture. Machines
without WebCodecs fall back to one JPEG per frame. Its cost follows
how prominently it is shown (`previewProfile()` in `src/lib/jpegRelay.ts`):

| Level | When | fps | Max width | JPEG quality |
|-------|------|-----|-----------|--------------|
| 0 | nobody is looking | 4 | 640 | 0.6 |
| 1 | lobby grid tile | 24 | 1280 | 0.72 |
| 2 | pop-out or expanded tile | 30 | 1920 | 0.8 |

The encoder skips a frame rather than queueing when it falls behind, and a
viewer that appears mid-stream asks for a keyframe over the same port. Any
level is capped at 30 fps.

### Measuring memory

Turn on **User Settings → Voice & Video → Memory diagnostics → Send memory
samples**. Every 10 s the app sends the RAM of each process to the API,
labelled `main-window`, `voice-host`, `screen-host:<id>` or `popout`
(unlabelled rows are Electron's own processes: `Browser` is the main process,
`GPU`, utilities…). Samples are kept 7 days and are visible only to you.

Getting them back:

- **In the app:** same section → **Download CSV** (one row per sample, one
  column per process). **Delete samples** clears yours.
- **On the server:** each sample is also a `memlog` line in the API log:

  ```bash
  cd ~/espalha-brasas/deploy
  docker compose logs api --since 1h | grep memlog
  ```

- **API:** `GET /api/diagnostics/memory?since=<RFC 3339>&limit=<n>` returns
  your samples as JSON; `DELETE` clears them.

Starting the app with `SPEAKAPP_MEM_LOG=1` turns sending on without the
setting and also prints each sample to the terminal (`[mem] total=… …`).

Use it to compare voice-only against a live, or one build against another.

## E2E keys

DM identity keys are stored per account under `<userData>/e2e-identities/`,
encrypted with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS,
libsecret/kwallet on Linux). Only when the OS has no keystore are they written
as plain JSON. Back them up from **User Settings** before wiping app data.

## Security lockdown

- **Content-Security-Policy** on every page (injected by `cspPlugin` in
  `vite.config.ts`; the notification popup has its own): only the app's own
  scripts run. Inline scripts, inline event handlers, `eval` and scripts from
  other hosts are blocked, so markup that slipped into a message could not
  reach the preload API (E2E keys, tokens, uploads). Dev also allows inline
  scripts for Vite's HMR. Network and media stay open because the API and
  LiveKit hosts are configured at runtime.
- **Navigation lock** (`web-contents-created` in `electron/main.mjs`): app
  windows only load the app's own pages. Other navigations and redirects are
  refused, `window.open` is denied, and web links open in the default browser.
- **Permissions** (mic, camera, screen, notifications) are granted only to the
  app's own pages, judged by the full URL.
- **Session**: the 30-day refresh token is kept only in the main process,
  encrypted with `safeStorage` (`electron/sessionStore.mjs`), tied to the API
  origin that issued it. Pages ask the main process to refresh and only get the
  12-hour access token back. Tokens left in `localStorage` by older versions
  are moved there on start.
- **WebSocket** auth goes in the `Sec-WebSocket-Protocol` header
  (`speakapp.auth, <token>`) instead of the URL, so it doesn't end up in logs.
- **E2E key backup** is encrypted with a password (PBKDF2-SHA256, 600k
  iterations, AES-256-GCM, `src/lib/keyBackup.ts`). Old plain backups can still
  be restored.

## Notes

- Capture uses Chromium `desktopCapturer` (custom in-app picker + optional system audio).
- Mic/camera permissions are auto-allowed in the main process.
- LiveKit is code-split and loaded when joining voice.
