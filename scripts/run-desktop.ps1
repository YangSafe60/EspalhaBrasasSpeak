# Espalha Brasas desktop (Windows PowerShell)
# Uses the MSVC toolchain — MinGW/GNU hits "export ordinal too large" with Tauri.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "apps\desktop"

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

# Prefer cargo, and strip MSYS MinGW from PATH so the GNU linker is not picked up.
$pathParts = @($cargoBin) + @(
  ($env:Path -split ';' | Where-Object {
    $_ -and
    ($_ -notmatch '(?i)msys64\\mingw') -and
    ($_ -notmatch '(?i)mingw64\\bin')
  })
)
$env:Path = ($pathParts -join ';')

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Error "cargo not found. Install Rust from https://rustup.rs and reopen the terminal."
}

# Ensure the MSVC toolchain is available (required for Tauri on Windows).
rustup toolchain install stable-x86_64-pc-windows-msvc 2>$null | Out-Null
rustup default stable-x86_64-pc-windows-msvc 2>$null | Out-Null

# Load VS Build Tools env if present (link.exe / cl.exe).
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if (-not $vsPath) {
    $vsPath = & $vswhere -latest -products * -property installationPath 2>$null
  }
  if ($vsPath) {
    $vsDevCmd = Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"
    if (Test-Path $vsDevCmd) {
      $env:VSCMD_SKIP_SENDTELEMETRY = "1"
      cmd /c "`"$vsDevCmd`" -arch=amd64 -host_arch=amd64 >nul && set" | ForEach-Object {
        if ($_ -match '^(.*?)=(.*)$') {
          [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
        }
      }
    }
  }
}

Write-Host "Rust host: $((rustc -vV | Select-String 'host:').ToString().Trim())"
Write-Host "Starting Espalha Brasas desktop window (ignore any localhost URL — that is only Vite)."

Set-Location $desktop
if (-not (Test-Path "node_modules")) { npm install }
npm run desktop
