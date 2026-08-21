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
if (-not $env:PUBLIC_URL) { $env:PUBLIC_URL = "http://127.0.0.1:8080" }
if (-not $env:SPEAKAPP_BIND) { $env:SPEAKAPP_BIND = "0.0.0.0:8080" }
if (-not $env:LIVEKIT_URL) { $env:LIVEKIT_URL = "ws://127.0.0.1:7880" }
if (-not $env:LIVEKIT_API_KEY) { $env:LIVEKIT_API_KEY = "devkey" }
if (-not $env:LIVEKIT_API_SECRET) { $env:LIVEKIT_API_SECRET = "espalha_brasas_dev_livekit_secret_32b" }

function Test-ApiHealth {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

# If API is already up, keep it (re-running this script used to Force-kill it → exit 0xffffffff).
if (Test-ApiHealth) {
  Write-Host "Espalha Brasas API already running on http://localhost:8080 (health ok)."
  Write-Host "Stop it first if you need a restart: Get-Process speakapp-server | Stop-Process"
  exit 0
}

# Free a dead/hung listener only when health check failed.
Get-Process speakapp-server -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "Stopping leftover speakapp-server PID $($_.Id)..."
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 400

# Prefer a freshly built binary so new API routes (friends/DMs) are always present.
# Set SPEAKAPP_USE_RELEASE=1 to force target/release after an explicit cargo build --release.
$release = Join-Path $root "target\release\speakapp-server.exe"
$useRelease = $env:SPEAKAPP_USE_RELEASE -eq "1"
if ($useRelease -and (Test-Path $release)) {
  Write-Host "Starting Espalha Brasas API from release binary on http://localhost:8080"
  & $release
  $code = $LASTEXITCODE
} else {
  Write-Host "Building and starting speakapp-server (dev)..."
  Write-Host "(If you see 'Blocking waiting for file lock', close other cargo/rust-analyzer builds and wait.)"
  cargo run -p speakapp-server
  $code = $LASTEXITCODE
}

if ($code -eq -1 -or $code -eq 0xffffffff -or $code -eq 4294967295) {
  Write-Host ""
  Write-Host "Server process was terminated (exit $code)."
  Write-Host "Usually another script/terminal stopped speakapp-server, or the port was taken."
  Write-Host "Check: Get-Process speakapp-server ; netstat -ano | findstr :8080"
  exit $code
}

exit $code
