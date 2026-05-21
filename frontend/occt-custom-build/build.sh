#!/usr/bin/env bash
# =============================================================================
# ArchDisc — custom OCCT WASM build launcher (WSL 2 / Git Bash / Linux)
# =============================================================================
# Builds a complete-API OCCT WebAssembly module from archdisc-occt.yml.
#
#   * LONG build (~3-6 hours). Run overnight / in the background.
#   * Requires Docker running with Linux containers.
#   * Pull `donalffons/opencascade.js:2.0.0-beta.b5ff984` first (see README.md).
#
# Usage:  bash frontend/occt-custom-build/build.sh
# Output: archdisc-occt.js / .wasm / .d.ts written into this directory.
# =============================================================================
set -euo pipefail

BUILD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="donalffons/opencascade.js:2.0.0-beta.b5ff984"
CONFIG="archdisc-occt.yml"

echo "ArchDisc custom OCCT WASM build"
echo "  build dir : ${BUILD_DIR}"
echo "  image     : ${IMAGE}"
echo "  config    : ${CONFIG}"
echo

[ -f "${BUILD_DIR}/${CONFIG}" ] || { echo "ERROR: ${CONFIG} missing" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker is not running" >&2; exit 1; }

# Memory pre-flight: the full-OCCT link OOM-killed wasm-ld at the ~8 GB WSL 2
# default. .wslconfig raises it to 13 GB — verify the VM picked it up.
MEM_BYTES=$(docker info --format '{{.MemTotal}}')
MEM_GB=$(( MEM_BYTES / 1073741824 ))
echo "  docker VM memory : ${MEM_GB} GB"
if [ "${MEM_BYTES}" -lt 11811160064 ]; then   # 11 GB
  echo "ERROR: Docker VM has only ${MEM_GB} GB — the full-OCCT link needs >=12 GB" >&2
  echo "       or wasm-ld is OOM-killed (SIGKILL -9). Edit ~/.wslconfig" >&2
  echo "       (memory=13GB), run 'wsl --shutdown', restart Docker. See README.md." >&2
  exit 1
fi

if [ -z "$(docker images -q "${IMAGE}")" ]; then
  echo "Image not cached — pulling (~1.7 GB compressed)..."
  docker pull "${IMAGE}"
fi

echo "Launching build — expect 3-6 hours."
START=$(date +%s)

# ENTRYPOINT is buildFromYaml.py; argument is the config filename under /src.
# -u keeps output files owned by the host user (Linux/WSL only; harmless).
docker run --rm \
  -v "${BUILD_DIR}:/src" \
  -u "$(id -u):$(id -g)" \
  "${IMAGE}" \
  "${CONFIG}"

ELAPSED=$(( $(date +%s) - START ))
printf 'Build finished in %02d:%02d:%02d.\n' \
  $((ELAPSED/3600)) $(((ELAPSED%3600)/60)) $((ELAPSED%60))
echo "Outputs:"
ls -lh "${BUILD_DIR}"/archdisc-occt.{js,wasm,d.ts} 2>/dev/null || true
echo
echo "Next: see README.md 'Consuming the build' to wire it into kernelLoader.js."
