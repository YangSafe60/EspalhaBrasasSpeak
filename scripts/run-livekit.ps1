# Start LiveKit SFU for local voice/screen share (Windows, no Docker)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$lkDir = Join-Path $root "tools\livekit"
$exe = Join-Path $lkDir "livekit-server.exe"
$config = Join-Path $root "deploy\livekit.local.yaml"

New-Item -ItemType Directory -Force -Path $lkDir | Out-Null

# Free ports if a previous instance is still running
Get-Process livekit-server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400
foreach ($port in 7880, 7881) {
  $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" }
  foreach ($c in $conns) {
    try { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }
}

if (-not (Test-Path $exe)) {
  Write-Host "Downloading LiveKit server..."
  $zip = Join-Path $lkDir "livekit.zip"
  $url = "https://github.com/livekit/livekit/releases/download/v1.13.5/livekit_1.13.5_windows_amd64.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $lkDir -Force
  Remove-Item $zip -Force
  if (-not (Test-Path $exe)) {
    $found = Get-ChildItem $lkDir -Recurse -Filter "livekit-server.exe" | Select-Object -First 1
    if ($found) { Copy-Item $found.FullName $exe -Force }
  }
}

if (-not (Test-Path $exe)) {
  Write-Error "livekit-server.exe not found after download"
}

Write-Host "Starting LiveKit on ws://127.0.0.1:7880"
& $exe --config $config
