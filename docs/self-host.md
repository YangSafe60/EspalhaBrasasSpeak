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
| `LIVEKIT_URL` | no* | `wss://livekit.your.domain` **or** `ws://YOUR_VPS_IP:7880` (written into voice tokens) |
| `LIVEKIT_API_KEY` | no* | same key on API **and** LiveKit container |
| `LIVEKIT_API_SECRET` | no* | ≥32 chars; same secret on API **and** LiveKit container |
| `MAX_UPLOAD_BYTES` | no | `26214400` |
| `IMGBB_API_KEY` | recommended | ImgBB key, used **only by the server** as the fallback when the desktop app cannot upload an image to Catbox |
| `KLIPY_API_KEY` | yes for GIFs | Klipy API key ([partner.klipy.com](https://partner.klipy.com)) |

\*If these are missing or empty, the deploy script and Compose keep **localhost / local-dev defaults** (same as `.env.example`). Set them for a real public VPS.

If `LIVEKIT_URL` is empty (or still `ws://127.0.0.1:7880`) while `PUBLIC_URL` is your VPS IP/domain, deploy now derives `ws://<PUBLIC_HOST>:7880` automatically. Without that, desktop clients try to open LiveKit on their own PC and fail with **could not establish signal connection: Failed to fetch**.

Also open **TCP 7880/7881** and **UDP 50000–50100** on the Oracle security list (`deploy/open-oracle-ports.sh`).

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are written to `deploy/.env` on the Oracle box. Compose injects them into **both** the API and the LiveKit server so tokens and the SFU stay in sync.

If `VPS_HOST` is unset, the deploy job is **skipped** (safe for forks without secrets).

The GitHub Actions SSH user must run Docker without a password prompt:

```bash
sudo usermod -aG docker ubuntu   # or opc
# log out of ALL sessions, then SSH back in once
groups   # should list docker
```

If `groups` still has no `docker`, Actions will fail with `permission denied` on `docker.sock`.

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

Point DNS A/AAAA to the VPS. On deploy, `remote-deploy.sh` **writes** `Caddyfile` from
`PUBLIC_URL` + `LIVEKIT_URL` (GitHub secrets), so Caddy gets automatic HTTPS for:

```
your.domain            → api:8080
livekit.your.domain    → livekit:7880
```

You do **not** need to edit `Caddyfile` by hand if those secrets are set.

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

Media is not on the VPS: images go to Catbox from the desktop app (ImgBB through the server as fallback), other files to Litterbox, GIFs stay on Klipy. The database only stores the URLs.

E2E DM keys are **not** on the server either — they live on each user's PC, encrypted with the OS keystore (Electron `safeStorage`). Users back them up from the app; the server has only public keys and ciphertext.

SQLite lives in the `speakapp-data` volume:

```bash
docker compose exec api sqlite3 /data/speakapp.db ".backup '/data/speakapp-backup.db'"
docker run --rm -v speakapp_speakapp-data:/data -v $PWD:/out alpine \
  tar czf /out/speakapp-backup.tgz -C /data .
```

## API limits

| What | Limit |
|------|-------|
| Login | 5 per minute per IP |
| Register | 3 per hour per IP |
| Token refresh | 30 per minute per IP |
| Messages | 10 per 10 s per sender, per user, shared by channels and DMs (webhooks: per webhook) |
| Message / edit / webhook text | 4000 characters; webhook name 80 |
| JSON request body | 1 MB (image upload: `MAX_UPLOAD_BYTES`, 25 MB by default) |
| Username | 2–32 of `A-Z a-z 0-9 _ . -` |
| Display name | 1–32 characters, no control characters |
| Email | valid format, at most 254 characters |

Over a rate limit the API answers `429 Too Many Requests` with `Retry-After`
(seconds); the desktop app shows how long to wait.

Limits are kept in memory, per API process, and reset on restart.

### Real client IP behind Caddy

Per-IP limits need the real client address. The API reads `X-Forwarded-For`
**only when the connection comes from a trusted proxy**, and then takes the
right-most entry (the one Caddy itself added), so a client cannot fake its IP.

- `TRUSTED_PROXIES` — comma-separated IPs/CIDRs. Default: loopback and private
  networks (`127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
  fc00::/7`), which covers Caddy on the same Docker network.
- As long as port 8080 is published to the internet, Docker may hand the API
  outside connections from its bridge gateway (a private IP), which would
  then be trusted. Closing 8080 (below) removes that path: only Caddy can
  reach the API.

### Closing port 8080

Once clients use HTTPS through Caddy:

1. Check that `https://your.domain/health` answers `ok` and `PUBLIC_URL` is that URL.
2. Ship an installer built with `VITE_API_BASE=https://your.domain` and wait
   for users to auto-update.
3. In `deploy/docker-compose.yml` change the API port to
   `"127.0.0.1:8080:8080"` (later remove the `ports:` entry altogether).
4. Remove 8080 from the Oracle security list and the VPS firewall.

## Desktop memory log

`SPEAKAPP_MEM_LOG=1` (desktop app, not the server) logs the RAM of each
Electron process every 10 s. See [desktop.md](desktop.md#measuring-memory).

## RAM tips

- Keep SQLite (default); only switch to Postgres for larger communities.
- Cap LiveKit bitrate in room settings if the VPS is small.
- Run API + LiveKit on one host until you outgrow ~20 concurrent voice users, then split LiveKit.
