# Run Espalha Brasas API (Windows PowerShell)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "Cargo.toml"))) { $root = $PSScriptRoot }

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$mingwBin = "C:\msys64\mingw64\bin"
$env:Path = "$mingwBin;$cargoBin;" + $env:Path

Set-Location $root
New-Item -ItemType Directory -Force -Path "data\media" | Out-Null

if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "sqlite://data/speakapp.db?mode=rwc" }
if (-not $env:JWT_SECRET) { $env:JWT_SECRET = "dev-secret-change-me" }
if (-not $env:MEDIA_DIR) { $env:MEDIA_DIR = "data/media" }
if (-not $env:PUBLIC_URL) { $env:PUBLIC_URL = "http://localhost:8080" }
if (-not $env:SPEAKAPP_BIND) { $env:SPEAKAPP_BIND = "0.0.0.0:8080" }
if (-not $env:LIVEKIT_URL) { $env:LIVEKIT_URL = "ws://localhost:7880" }
if (-not $env:LIVEKIT_API_KEY) { $env:LIVEKIT_API_KEY = "devkey" }
if (-not $env:LIVEKIT_API_SECRET) { $env:LIVEKIT_API_SECRET = "espalha_brasas_dev_livekit_secret_32b" }

# Avoid duplicate listeners (Windows can bind more than one process to the same port)
Get-Process speakapp-server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400

$release = Join-Path $root "target\release\speakapp-server.exe"
if (Test-Path $release) {
  Write-Host "Starting Espalha Brasas API from release binary on http://localhost:8080"
  & $release
} else {
  Write-Host "Building and starting speakapp-server..."
  cargo run -p speakapp-server
}
