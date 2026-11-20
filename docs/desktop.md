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

The picture you see of a live inside the app (lobby tiles, pop-out) is a JPEG
relay, separate from the WebRTC track other people receive. Its cost follows
how prominently it is shown (`previewProfile()` in `src/lib/jpegRelay.ts`):

| Level | When | fps | Max width | JPEG quality |
|-------|------|-----|-----------|--------------|
| 0 | nobody is looking | 4 | 640 | 0.6 |
| 1 | lobby grid tile | 24 | 1280 | 0.72 |
| 2 | pop-out or expanded tile | 30 | 1920 | 0.8 |

Relays never queue frames: if an encode is still running, only the newest
frame is kept. Any level is capped at 30 fps.

### Measuring memory

Start the app with `SPEAKAPP_MEM_LOG=1` to log the RAM of every process every
10 s, labelled `main-window`, `voice-host`, `screen-host:<id>` or `popout`:

```powershell
$env:SPEAKAPP_MEM_LOG = "1"
cd apps\desktop
npm run desktop
```

```
[mem] total=612MB Browser=98MB Tab[main-window]=210MB Tab[voice-host]=180MB ...
```

Use it to compare voice-only against a live, or one build against another.

## E2E keys

DM identity keys are stored per account under `<userData>/e2e-identities/`,
encrypted with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS,
libsecret/kwallet on Linux). Only when the OS has no keystore are they written
as plain JSON. Back them up from **User Settings** before wiping app data.

## Notes

- Capture uses Chromium `desktopCapturer` (custom in-app picker + optional system audio).
- Mic/camera permissions are auto-allowed in the main process.
- LiveKit is code-split and loaded when joining voice.
