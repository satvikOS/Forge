#!/usr/bin/env bash
#
# BUILD_AND_VERIFY_RIGOR.sh — single-threaded incremental kernel rebuild +
# physics-validation harness, gating the two physics-rigor upgrades:
#
#   UPGRADE A  consistent hex mass matrix  → cantilever modal f1 error < 8%
#   UPGRADE B  CFD inlet/outlet channel    → finite maxVel + peak/mean ≈ 1.5
#
# Run this ONLY after the GPU LoRA train has released memory — the build is
# forced SINGLE-THREADED here (--parallel 1) specifically to keep peak RAM low
# and avoid the Mac OOM that a --parallel 10 cmake build risks alongside MLX.
#
# Usage:   bash forge-kernel/BUILD_AND_VERIFY_RIGOR.sh
# Exit:    0 if BOTH rigor gates pass, 1 otherwise.
set -uo pipefail

# --- locate repo root (this script lives in <root>/forge-kernel/) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL_DIR="$SCRIPT_DIR"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CMAKE_JS="$ROOT_DIR/node_modules/.bin/cmake-js"
HARNESS="$KERNEL_DIR/test/physics_validation_harness.mjs"

echo "======================================================================"
echo " Forge physics-rigor build + verify"
echo "   root:    $ROOT_DIR"
echo "   kernel:  $KERNEL_DIR"
echo "   threads: 1 (single-threaded to stay under the OOM ceiling)"
echo "======================================================================"

if [ ! -x "$CMAKE_JS" ]; then
  echo "FATAL: cmake-js not found at $CMAKE_JS" >&2
  echo "       run 'npm install' in $ROOT_DIR first." >&2
  exit 2
fi

# --- 1. incremental SINGLE-THREADED build ----------------------------------
# Incremental: do NOT reconfigure / clean — only the edited Cfd.cpp + Fea.cpp
# (and the touched header) recompile, which is far cheaper than a full build.
echo
echo "[1/2] Building kernel (incremental, --parallel 1) ..."
( cd "$KERNEL_DIR" && "$CMAKE_JS" build --parallel 1 )
BUILD_RC=$?
if [ $BUILD_RC -ne 0 ]; then
  echo
  echo "FATAL: kernel build failed (rc=$BUILD_RC). Not running the harness." >&2
  exit $BUILD_RC
fi
echo "      build OK."

# --- 2. run the validation harness (it self-gates + exits non-zero on fail)-
echo
echo "[2/2] Running physics validation harness ..."
node "$HARNESS"
HARNESS_RC=$?

echo
echo "======================================================================"
if [ $HARNESS_RC -eq 0 ]; then
  echo " RESULT: PASS — both rigor gates met"
  echo "   [PASS] UPGRADE A  modal f1 error < 8%   (consistent hex mass)"
  echo "   [PASS] UPGRADE B  channel finite maxVel + peak/mean in 1.125-1.875"
else
  echo " RESULT: FAIL — one or more rigor gates did not pass (rc=$HARNESS_RC)"
  echo "   See the [PASS]/[FAIL] lines and 'rigor-upgrade gate summary' above."
fi
echo "======================================================================"
exit $HARNESS_RC
