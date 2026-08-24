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

## Notes

- Capture uses Chromium `desktopCapturer` (custom in-app picker + optional system audio).
- Mic/camera permissions are auto-allowed in the main process.
- LiveKit is code-split and loaded when joining voice.
- Legacy `apps/desktop/src-tauri` (old Tauri shell) is unused and safe to delete.
