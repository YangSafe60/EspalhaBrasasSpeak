# Self-hosting Espalha Brasas on ARM (Oracle Cloud)

## Recommended VM

- Shape: Ampere A1 (ARM64), **1–2 OCPU**, **6–12 GB RAM** preferred; **1 GB** works for &lt;10 users if LiveKit shares the host.
- OS: Ubuntu 22.04/24.04 aarch64
- Open ports: `80/443` (Caddy), `7881/tcp`, `50000-50100/udp` (LiveKit WebRTC)

## Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out/in so docker group applies, or:
newgrp docker
```

## One-time VPS bootstrap

```bash
git clone <your-repo-url> ~/espalha-brasas
cd ~/espalha-brasas/deploy
cp .env.example .env
# edit JWT_SECRET, PUBLIC_URL, LIVEKIT_* for production (or leave defaults for LAN testing)
docker compose up -d --build
```

## GitHub Actions auto-deploy

On every push to `main` / `master`, [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) SSHs into the VPS, checks out that commit, and runs `deploy/remote-deploy.sh`.

### 1. SSH key on the VPS

```bash
# On your PC — create a deploy key (no passphrase for Actions)
ssh-keygen -t ed25519 -C "github-deploy" -f ./espalha-deploy -N ""

# On the VPS — authorize it
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<contents of espalha-deploy.pub>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 2. GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Required | Example |
|--------|----------|---------|
| `VPS_HOST` | yes | `130.61.x.x` or `vps.your.domain` |
| `VPS_USER` | yes | `ubuntu` or `opc` |
| `VPS_SSH_KEY` | yes | full private key PEM (`espalha-deploy`) |
| `VPS_PORT` | no | `22` |
| `VPS_DEPLOY_PATH` | no | `/home/ubuntu/espalha-brasas` |
| `JWT_SECRET` | no* | long random string |
| `PUBLIC_URL` | no* | `https://your.domain` |
| `LIVEKIT_URL` | no* | `wss://livekit.your.domain` (written to VPS `.env`; used in voice tokens) |
| `LIVEKIT_API_KEY` | no* | same key on API **and** LiveKit container |
| `LIVEKIT_API_SECRET` | no* | ≥32 chars; same secret on API **and** LiveKit container |
| `MAX_UPLOAD_BYTES` | no | `26214400` |

\*If these are missing or empty, the deploy script and Compose keep **localhost / local-dev defaults** (same as `.env.example`). Set them for a real public VPS.

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are written to `deploy/.env` on the Oracle box. Compose injects them into **both** the API and the LiveKit server so tokens and the SFU stay in sync.

If `VPS_HOST` is unset, the deploy job is **skipped** (safe for forks without secrets).

The VPS clone must be able to `git fetch` GitHub:

- **Public repo:** `git clone https://github.com/<you>/<repo>.git ~/espalha-brasas`
- **Private repo:** add a read-only [GitHub deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys) on the VPS (`ssh-keygen` + repo Settings → Deploy keys), then clone via SSH.

### 3. Manual deploy on the VPS

```bash
cd ~/espalha-brasas
git pull
./deploy/remote-deploy.sh
```

Or trigger **Actions → deploy → Run workflow** in GitHub.

## Deploy (API + LiveKit + Caddy) — manual

```bash
git clone <your-repo> espalha-brasas && cd espalha-brasas/deploy
cp .env.example .env
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
