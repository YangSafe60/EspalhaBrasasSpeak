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

umask 077
cat > .env <<EOF
JWT_SECRET=${JWT_SECRET}
PUBLIC_URL=${PUBLIC_URL}
LIVEKIT_URL=${LIVEKIT_URL}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
MAX_UPLOAD_BYTES=${MAX_UPLOAD_BYTES}
EOF

echo "==> Building and starting stack in $ROOT/deploy"
docker compose up -d --build --remove-orphans

echo "==> Status"
docker compose ps
