# Espalha Brasas

Lightweight Discord/TeamSpeak-style voice + text client (Tauri) with a self-hosted Rust API, optimized for ARM VPS (Oracle Cloud).

## Stack

| Piece | Tech |
|-------|------|
| Desktop | Tauri 2 + React + Vite + Zustand + LiveKit JS |
| API | Rust / Axum + SQLite + WebSocket gateway |
| Voice / screen | LiveKit SFU (multi screen share, source quality) |
| Deploy | Docker Compose (api + livekit + caddy), multi-arch |

## Quick start (dev)

### Windows (PowerShell)

`cargo` and `docker` must be available in **that** terminal. If `cargo` is missing, either reopen the terminal after installing Rust, or prepend PATH:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\msys64\mingw64\bin;" + $env:Path
```

Then in **two** terminals from the repo root:

```powershell
# Terminal 1 — API
.\scripts\run-server.ps1

# Terminal 2 — desktop
.\scripts\run-desktop.ps1
```

Or manually:

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\msys64\mingw64\bin;" + $env:Path
mkdir data\media -Force | Out-Null
$env:DATABASE_URL = "sqlite://data/speakapp.db?mode=rwc"
cargo run -p speakapp-server
```

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\msys64\mingw64\bin;" + $env:Path
cd apps\desktop
npm install
npm run tauri dev
```

**LiveKit / voice:** Docker is optional. On Windows, run LiveKit without Docker:

```powershell
.\scripts\run-livekit.ps1
```

Then keep the API + desktop running and rejoin the voice channel.

### Server (macOS / Linux)

```bash
# From repo root — requires Rust
cp .env.example .env
mkdir -p data/media
cargo run -p speakapp-server
```

API listens on `http://localhost:8080`.

### LiveKit (optional for voice)

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 50000-50100:50000-50100/udp \
  -v ${PWD}/deploy/livekit.yaml:/etc/livekit.yaml \
  livekit/livekit-server --config /etc/livekit.yaml
```

### Desktop

```bash
cd apps/desktop
npm install
npm run desktop      # native Tauri window (Espalha Brasas) — use this
# npm run tauri dev  # same as above
```

Do **not** use `localhost:1420` in Chrome. That URL is only an internal feed for the
desktop window. Screen share and pop-outs require the native shell.

Set `VITE_API_BASE=http://localhost:8080` if needed (default).

## Docker (ARM64 / Oracle)

```bash
cd deploy
export JWT_SECRET=please-change-me
export PUBLIC_URL=https://your.domain
docker compose build --platform linux/arm64
docker compose up -d
```

See [docs/self-host.md](docs/self-host.md) for Oracle sizing, TLS, and backups.

## Features (v1)

- Servers, invites, bans, members
- Text + voice channels, categories
- Messages, attachments, reactions, typing, presence events
- Discord-class role bitflags + channel overwrites + server rules
- Per-channel backgrounds (blur/dim/text color) + atmosphere presets
- LiveKit voice (mute/deafen) and multi screen share with pop-out windows

## Repo layout

```
apps/desktop/     Tauri + React client (Espalha Brasas)
crates/server/    Axum API
crates/shared/    Shared types + permissions
deploy/           Compose + Dockerfile + Caddy + LiveKit
docs/             Hosting + permission notes
```
