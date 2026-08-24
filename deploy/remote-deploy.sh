#!/usr/bin/env bash
# Runs on the VPS after git checkout (from GitHub Actions or manually).
# Empty / unset secrets fall back to the same localhost-friendly defaults as local dev.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/deploy"

# Localhost / compose defaults when GitHub secrets (or shell env) are empty.
JWT_SECRET="${JWT_SECRET:-dev-secret-change-me-in-production}"
PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:8080}"
# Public URL embedded in voice tokens (desktop clients). Do not use ws://livekit:7880
# on a VPS — that hostname only exists inside Docker.
LIVEKIT_URL="${LIVEKIT_URL:-ws://127.0.0.1:7880}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkey}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-espalha_brasas_dev_livekit_secret_32b}"
MAX_UPLOAD_BYTES="${MAX_UPLOAD_BYTES:-26214400}"

# Hostnames for Caddy (strip scheme + path).
api_host() {
  printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##' | cut -d/ -f1 | cut -d@ -f2
}

API_HOST="$(api_host "$PUBLIC_URL")"
LK_HOST="$(api_host "$LIVEKIT_URL")"

umask 077
cat > .env <<EOF
JWT_SECRET=${JWT_SECRET}
PUBLIC_URL=${PUBLIC_URL}
LIVEKIT_URL=${LIVEKIT_URL}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
MAX_UPLOAD_BYTES=${MAX_UPLOAD_BYTES}
EOF

# Caddy: real domains get automatic HTTPS; IP/localhost stays plain HTTP.
if [[ "$API_HOST" == 127.0.0.1:* ]] || [[ "$API_HOST" == localhost* ]] || [[ "$API_HOST" == 127.0.0.1 ]] \
  || [[ "$API_HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(:[0-9]+)?$ ]]; then
  cat > Caddyfile <<EOF
# Generated for IP / local access (no TLS). Prefer a domain for production.
:80 {
	reverse_proxy api:8080
}
EOF
  echo "==> Caddy: HTTP on :80 → api (no domain yet)"
else
  if [[ "$LK_HOST" == "$API_HOST" ]] || [[ -z "$LK_HOST" ]]; then
    cat > Caddyfile <<EOF
# Generated from PUBLIC_URL=${PUBLIC_URL}
${API_HOST} {
	reverse_proxy api:8080
}
EOF
    echo "==> Caddy: https://${API_HOST} → api (LiveKit host missing/same — set LIVEKIT_URL to a subdomain)"
  else
    cat > Caddyfile <<EOF
# Generated from PUBLIC_URL + LIVEKIT_URL
${API_HOST} {
	reverse_proxy api:8080
}

${LK_HOST} {
	reverse_proxy livekit:7880
}
EOF
    echo "==> Caddy: https://${API_HOST} → api, https://${LK_HOST} → livekit"
  fi
fi

echo "==> Building and starting stack in $ROOT/deploy"

compose() {
  if docker info >/dev/null 2>&1; then
    docker compose "$@"
  elif sudo -n docker info >/dev/null 2>&1; then
    sudo -n docker compose "$@"
  else
    echo "Docker is not usable as this user (permission denied on docker.sock)."
    echo "On the VPS run once:"
    echo "  sudo usermod -aG docker \$USER"
    echo "  # then start a new SSH session (required for GitHub Actions too)"
    echo "Or: sudo visudo  →  ubuntu ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose, /usr/libexec/docker/cli-plugins/docker-compose"
    exit 1
  fi
}

compose up -d --build --remove-orphans

echo "==> Status"
compose ps
