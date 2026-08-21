# Espalha Brasas desktop (Windows PowerShell)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "apps\desktop"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm not found. Install Node.js 20+ from https://nodejs.org and reopen the terminal."
}

Write-Host "Starting Espalha Brasas (Electron)."
Write-Host "Ignore any localhost:1420 URL — that is only Vite feeding the desktop app."

Set-Location $desktop
if (-not (Test-Path "node_modules")) { npm install }
npm run desktop
