# Self-hosting Espalha Brasas on ARM (Oracle Cloud)

## Recommended VM

- Shape: Ampere A1 (ARM64), **1–2 OCPU**, **6–12 GB RAM** preferred; **1 GB** works for &lt;10 users if LiveKit shares the host.
- OS: Ubuntu 22.04/24.04 aarch64
- Open ports: `80/443` (Caddy), `7881/tcp`, `50000-50100/udp` (LiveKit WebRTC)

## Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

## Deploy (API + LiveKit + Caddy)

```bash
git clone <your-repo> espalha-brasas && cd espalha-brasas/deploy
cp ../.env.example .env
# edit JWT_SECRET, PUBLIC_URL, LIVEKIT_* to match livekit.yaml keys
docker compose up -d --build
```

Point DNS A/AAAA to the VPS. Update `Caddyfile` with your real domain and use Caddy automatic HTTPS:

```
your.domain {
  reverse_proxy api:8080
}

livekit.your.domain {
  reverse_proxy livekit:7880
}
```

Set server env so tokens and URLs match the public host:

- `PUBLIC_URL=https://your.domain`
- `LIVEKIT_URL=wss://livekit.your.domain` (what the API embeds in voice tokens)

## Desktop client (Electron)

The desktop app is **not** served by Docker. Build it on a developer machine and distribute the installer, with the API base baked in at build time:

```bash
cd apps/desktop
npm ci
export VITE_API_BASE=https://your.domain
npm run dist
```

Windows: NSIS installer under `apps/desktop/release/`.  
macOS / Linux: corresponding targets from `electron-builder` (see `apps/desktop/electron-builder.yml`).

For local testing against a remote API without packaging:

```bash
VITE_API_BASE=https://your.domain npm run desktop
```

## Backups

SQLite + media live in the `speakapp-data` volume:

```bash
docker compose exec api sqlite3 /data/speakapp.db ".backup '/data/speakapp-backup.db'"
docker run --rm -v speakapp_speakapp-data:/data -v $PWD:/out alpine \
  tar czf /out/speakapp-backup.tgz -C /data .
```

## RAM tips

- Keep SQLite (default); only switch to Postgres for larger communities.
- Cap LiveKit bitrate in room settings if the VPS is small.
- Run API + LiveKit on one host until you outgrow ~20 concurrent voice users, then split LiveKit.
