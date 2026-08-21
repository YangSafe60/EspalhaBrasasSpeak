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

Open the Setup `.exe` to install. Running a **newer** Setup again upgrades over the existing install (same `appId`) — close the app first. There is no auto-update in the background yet.

See [docs/desktop.md](docs/desktop.md) for packaging details.

## Docker (ARM64 / Oracle)

```bash
cd deploy
export JWT_SECRET=please-change-me
export PUBLIC_URL=https://your.domain
docker compose build --platform linux/arm64
docker compose up -d
```

See [docs/self-host.md](docs/self-host.md) for Oracle sizing, TLS, backups, and building the Electron client against your domain.

## Features (v1)

- Servers, invites, bans, members
- Friends + 1:1 private DMs with pragmatic end-to-end encryption (X25519 + AES-GCM; server stores ciphertext only)
- Text + voice channels, categories (create / edit / delete)
- Messages, attachments, reactions, typing, presence events
- Discord-style role bitflags + channel overwrites
- Per-channel backgrounds (blur / dim / text color) + atmosphere presets
- LiveKit voice (mute / deafen)
- Multi screen share: in-app picker, opt-in watch, system audio, volume, pop-out / fullscreen

### Private DM privacy (honest limits)

- The API never sees DM plaintext — only ciphertext + metadata (who, when, size).
- Identity private keys live on this device (`localStorage`). Clearing app data without a backup means you cannot decrypt old DMs.
- Not Signal Protocol: no Double Ratchet / multi-device sync in v1. Compare fingerprints in the DM header to verify the peer.

## Repo layout

```
apps/desktop/     Electron + React client (Espalha Brasas)
  electron/       Main process + preload
  release/        Installers after `npm run dist` (gitignored)
crates/server/    Axum API
crates/shared/    Shared types + permissions
deploy/           Compose + Dockerfile + Caddy + LiveKit
docs/             Hosting, desktop client, permission notes
scripts/          Dev helpers (Windows)
```
