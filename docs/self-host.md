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

## Deploy

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

Build the desktop client with `VITE_API_BASE=https://your.domain`, and set `LIVEKIT_URL` to `wss://livekit.your.domain`.

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
