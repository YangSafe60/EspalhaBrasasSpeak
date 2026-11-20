# Espalha Brasas

Lightweight Discord/TeamSpeak-style voice + text client (**Electron**) with a self-hosted Rust API, optimized for ARM VPS (Oracle Cloud).

## Stack

| Piece | Tech |
|-------|------|
| Desktop | Electron + React + Vite + Zustand + LiveKit JS |
| API | Rust / Axum + SQLite + WebSocket gateway |
| Voice / screen | LiveKit SFU · native capture via Electron `desktopCapturer` (custom picker, system audio) |
| Deploy | Docker Compose (api + livekit + caddy), multi-arch |

## Quick start (dev)

### Windows (PowerShell)

`cargo` must be available to run the API. In **two** (or three) terminals from the repo root:

```powershell
# Terminal 1 — API
.\scripts\run-server.ps1

# Terminal 2 — LiveKit (voice / screen share)
.\scripts\run-livekit.ps1

# Terminal 3 — desktop (Electron)
.\scripts\run-desktop.ps1
```

Or manually:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
mkdir data\media -Force | Out-Null
$env:DATABASE_URL = "sqlite://data/speakapp.db?mode=rwc"
cargo run -p speakapp-server
```

```powershell
cd apps\desktop
npm install
npm run desktop
```

### Server (macOS / Linux)

```bash
# From repo root — requires Rust
cp .env.example .env
mkdir -p data/media
cargo run -p speakapp-server
```

API listens on `http://localhost:8080`.

### LiveKit (optional for voice)

**Windows (no Docker):** `.\scripts\run-livekit.ps1`

**Docker:**

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 50000-50100:50000-50100/udp \
  -v ${PWD}/deploy/livekit.yaml:/etc/livekit.yaml \
  livekit/livekit-server --config /etc/livekit.yaml
```

### Desktop notes

- Use the **Espalha Brasas** Electron window — do **not** open `http://127.0.0.1:1420` in Chrome (that URL is only Vite feeding Electron).
- Default API base: `http://localhost:8080` (`VITE_API_BASE` to override).
- Two accounts on one PC (separate profile):

```powershell
$env:ELECTRON_USER_DATA = "$env:TEMP\espalha-brasas-alt"
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:1420"
cd apps\desktop
npx electron .
```

(Keep the first `npm run desktop` Vite server running.)

## Desktop installer (Windows)

```powershell
cd apps\desktop
npm install
# Optional — bake production API URL into the build:
#   $env:VITE_API_BASE = "https://your.domain"
npm run dist
```

Or from the repo root: `npm run desktop:dist`

| Output | Path |
|--------|------|
| NSIS installer | `apps/desktop/release/Espalha Brasas-0.1.0-Setup.exe` |
| Unpacked app (no install) | `apps/desktop/release/win-unpacked/Espalha Brasas.exe` |

Open the Setup `.exe` to install. Installed apps update themselves from GitHub Releases (checked on startup, installed when you quit); running a newer Setup by hand also upgrades in place.

See [docs/desktop.md](docs/desktop.md) for packaging details.

## Docker (ARM64 / Oracle)

```bash
cd deploy
# Optional — omit these and Compose/API use localhost-friendly defaults
export JWT_SECRET=please-change-me
export PUBLIC_URL=https://your.domain
docker compose build --platform linux/arm64
docker compose up -d
```

### Auto-deploy from GitHub

Push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): SSH → VPS → `git reset` to that commit → `deploy/remote-deploy.sh`.

1. Clone the repo once on the VPS (`~/espalha-brasas` by default).
2. Add secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (and optionally `PUBLIC_URL`, `JWT_SECRET`, LiveKit keys…).
3. Empty/missing app secrets keep local defaults — same as running without a production `.env`.

See [docs/self-host.md](docs/self-host.md) for Oracle sizing, TLS, backups, GitHub secret table, and building the Electron client against your domain.

## Features (v1)

- Servers, invites, bans, members
- Friends + 1:1 private DMs with pragmatic end-to-end encryption (X25519 + AES-GCM; server stores ciphertext only)
- Text + voice channels, categories (create / edit / delete)
- Messages, attachments, GIFs, reactions, typing, presence events
- Private DMs can send the same GIFs and files as channels (text stays encrypted; the file itself is hosted like other uploads)
- Discord-style role bitflags + channel overwrites
- Per-channel backgrounds (blur / dim / text color) + atmosphere presets
- LiveKit voice (mute / deafen)
- Multi screen share: in-app picker, opt-in watch, system audio, volume, pop-out / fullscreen
- Screen share quality: **720p**, **1080p**, or **Source** (native up to 4K) at **30/60 FPS**
- Rate limits and input limits on the API (see [docs/self-host.md](docs/self-host.md#api-limits))
- Notification sounds: per-type on/off (server messages, DMs, friend requests), plus an optional custom **.mp3** up to **1 MB**

### Custom notification sound

In **User Settings → Appearance → Notification sounds**:

- **Choose MP3** replaces the built-in tone for every alert on this device. **Preview** plays it; **Use default** restores the generated chime.
- Only real `.mp3` files are accepted (extension and file header), and nothing over 1 MB.
- The desktop app uploads the file the same way as other non-image files: from your PC to a public host, under a random link (`https://files.catbox.moe/…`), not onto the API disk and not into a browsable folder. This device stores only that link (`localStorage`). It is not synced to other devices.
- Chat files still use short-lived Litterbox hosting. The notification sound uses Catbox so the link does not expire after 72 hours.

### Where uploads go

- **Images** (chat, avatars, banners, server icons, emojis): the desktop app uploads them straight to **Catbox** from your PC and the API stores only the link. If that fails, the image goes to the API, which re-uploads it to **ImgBB** with its own `IMGBB_API_KEY` — the key never leaves the server.
- **Other files**: uploaded from your PC to **Litterbox** (temporary, 72 h); the API stores the link.
- **GIFs**: Klipy links (`KLIPY_API_KEY` on the server).

### Bots

Bots post with their creator's account but are capped to their own permission bits — **creator ∩ bot**. See [docs/permissions.md](docs/permissions.md#bots).

### Private DM privacy (honest limits)

- The API never sees DM plaintext — only ciphertext + metadata (who, when, size). GIFs and file attachments are not inside that ciphertext: the server stores the attachment URL, and the bytes live on the same public hosts used for channel uploads.
- Identity private keys live on this device, encrypted with the OS keystore through Electron `safeStorage` (DPAPI / Keychain / libsecret). Clearing app data without a backup means you cannot decrypt old DMs.
- Not Signal Protocol: no Double Ratchet / multi-device sync in v1. Compare fingerprints in the DM header to verify the peer.

## Repo layout

```
apps/desktop/     Electron + React client (Espalha Brasas)
  electron/       Main process + preload
  src/
    components/   UI (voice/ = lobby screen tiles, pickers, …)
    hooks/        React hooks (voice/ = LiveKit helpers + useVoice)
    lib/          Client utilities (screenBridge/, screenShare*, livekit, …)
    store/        Zustand app state + helpers/
  release/        Installers after `npm run dist` (gitignored)
crates/server/    Axum API
crates/shared/    Shared types + permissions
deploy/           Compose + Dockerfile + Caddy + LiveKit
docs/             Hosting, desktop client, permission notes
scripts/          Dev helpers (Windows)
```

### Desktop code organization

Large modules are split into focused folders so behaviour stays the same but files stay readable:

| Area | Location | Role |
|------|----------|------|
| Voice / LiveKit | `hooks/voice/` | Types, LiveKit helpers, `useVoice` hook |
| Voice lobby UI | `components/voice/` | Screen tiles, join cards |
| Screen pop-out | `lib/screenBridge/` | IPC relay, JPEG capture, registry |
| Screen capture | `lib/screenShare.ts`, `screenShareQuality.ts` | Electron capture + quality presets |
| App state | `store/appStore.ts` + `store/slices/` + `store/helpers/` | Zustand slices (auth, server, messaging, social, ws, …) |
| Channel list | `components/channelSidebar/` | DnD reorder, rows, categories, create modal |

Functions are documented with English JSDoc comments at module boundaries (helpers, public exports).
