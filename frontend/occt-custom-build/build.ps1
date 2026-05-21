# =============================================================================
# ArchDisc — custom OCCT WASM build launcher (Docker Desktop / Windows)
# =============================================================================
# Builds a complete-API OCCT WebAssembly module from archdisc-occt.yml.
#
#   * This is a LONG build (~3-6 hours). Run it overnight / in the background.
#   * Requires Docker Desktop running with the WSL 2 backend (Linux containers).
#   * The image `donalffons/opencascade.js:2.0.0-beta.b5ff984` must be pulled
#     first (see README.md "Step 4 / pre-pull").
#
# Usage (from anywhere):
#   pwsh -File frontend/occt-custom-build/build.ps1
#
# Output: archdisc-occt.js / .wasm / .d.ts written into THIS directory.
# =============================================================================

$ErrorActionPreference = "Stop"

# Resolve this script's own directory — it is both the build config location
# and the volume mounted into the container as /src.
$BuildDir = $PSScriptRoot
$Image    = "donalffons/opencascade.js:2.0.0-beta.b5ff984"
$Config   = "archdisc-occt.yml"

Write-Host "ArchDisc custom OCCT WASM build" -ForegroundColor Cyan
Write-Host "  build dir : $BuildDir"
Write-Host "  image     : $Image"
Write-Host "  config    : $Config"
Write-Host ""

# --- Pre-flight checks -------------------------------------------------------
if (-not (Test-Path (Join-Path $BuildDir $Config))) {
  throw "Build config $Config not found in $BuildDir"
}

try { docker info *> $null } catch {
  throw "Docker is not running. Start Docker Desktop and retry."
}

# --- Memory pre-flight -------------------------------------------------------
# The full-OCCT link OOM-killed wasm-ld on the first attempt (~8 GB VM ceiling).
# .wslconfig raises it to 13 GB; verify the running VM actually picked it up.
$memBytes = [int64](docker info --format '{{.MemTotal}}')
$memGB    = [math]::Round($memBytes / 1GB, 1)
Write-Host "  docker VM memory : $memGB GB"
if ($memBytes -lt 11GB) {
  throw ("Docker VM has only $memGB GB — the full-OCCT link needs >=12 GB or " +
         "wasm-ld is OOM-killed (SIGKILL -9). Edit ~/.wslconfig (memory=13GB), " +
         "then run 'wsl --shutdown' and restart Docker Desktop. See README.md.")
}

$haveImage = (docker images -q $Image)
if (-not $haveImage) {
  Write-Host "Image not cached locally. Pulling (large, ~1.7 GB compressed)..." -ForegroundColor Yellow
  docker pull $Image
  if ($LASTEXITCODE -ne 0) { throw "docker pull failed." }
}

# --- Run the build -----------------------------------------------------------
# The container ENTRYPOINT is buildFromYaml.py; its single argument is the
# config filename, resolved relative to the working dir /src.
# Docker Desktop on Windows accepts native Windows paths for -v; the path is
# translated into the WSL 2 VM automatically.
Write-Host "Launching build — expect 3-6 hours. Do not close Docker Desktop." -ForegroundColor Yellow
$startedAt = Get-Date

docker run --rm `
  -v "${BuildDir}:/src" `
  $Image `
  $Config

if ($LASTEXITCODE -ne 0) { throw "OCCT build failed (exit $LASTEXITCODE)." }

$elapsed = (Get-Date) - $startedAt
Write-Host ""
Write-Host ("Build finished in {0:hh\:mm\:ss}." -f $elapsed) -ForegroundColor Green
Write-Host "Outputs:" -ForegroundColor Green
Get-ChildItem -Path $BuildDir -Filter "archdisc-occt.*" |
  Where-Object { $_.Extension -in ".js", ".wasm", ".d.ts" -or $_.Name -like "*.d.ts" } |
  ForEach-Object { Write-Host ("  {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
Write-Host ""
Write-Host "Next: see README.md 'Consuming the build' to wire it into kernelLoader.js." -ForegroundColor Cyan
