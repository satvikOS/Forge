#!/usr/bin/env bash
# run_ir_pipeline.sh -- build and run the UI -> IR -> kernel -> SOLID gate.
#
# Compiles directly with the compiler rather than through forge-desktop/CMakeLists.txt on
# purpose: that file links forge_desktop_core, which drags in SDL2, Vulkan and ImGui. This
# gate needs none of them -- only forge::ui and the node-free forge_kernel_core -- and the
# CI kernel job installs OCCT but not the windowing stack. A gate that cannot run in CI is
# a gate that rots.
#
# Requires a prebuilt libforge_kernel_core. Point at it with FORGE_KERNEL_BUILD_DIR, or
# build one with:
#   cmake -S forge-kernel -B forge-kernel/build-verify -DCMAKE_BUILD_TYPE=Release \
#         -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
#   cmake --build forge-kernel/build-verify -j3 --target forge_kernel_core
#
# Exit codes
#   0  GREEN
#   1  RED  -- the gate's own assertions failed
#   3  RED  -- could not build, or the kernel core is missing. A check that could not run
#              is not a check that passed.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

KDIR="${FORGE_KERNEL_BUILD_DIR:-$ROOT/forge-kernel/build-verify}"
LIB=""
for cand in "$KDIR/libforge_kernel_core.dylib" "$KDIR/libforge_kernel_core.so" \
            "$KDIR/libforge_kernel_core.a"; do
  [ -f "$cand" ] && { LIB="$cand"; break; }
done
if [ -z "$LIB" ]; then
  echo "[ir-pipeline] libforge_kernel_core not found under $KDIR."
  echo "              Set FORGE_KERNEL_BUILD_DIR or build it (see the header). RED."
  exit 3
fi
echo "[ir-pipeline] kernel core: $LIB"

CXX="${CXX:-clang++}"
OCCT_PREFIX="${OCCT_PREFIX:-$( (brew --prefix opencascade 2>/dev/null) || echo /usr/local )}"
EIGEN_PREFIX="${EIGEN_PREFIX:-$( (brew --prefix eigen 2>/dev/null) || echo /usr/local )}"
BIN="$(mktemp -d "${TMPDIR:-/tmp}/ir_pipeline.XXXXXX")/ir_pipeline_gate"

# -Wall -Wextra -Werror to match every other gate in this tree: a warning nobody is forced
# to read is a suggestion, not a standard.
# shellcheck disable=SC2086
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror \
  -I ui/include -I forge-kernel/include \
  -I "$OCCT_PREFIX/include/opencascade" -I "$EIGEN_PREFIX/include/eigen3" \
  ui/src/*.cpp forge-desktop/test/ir_pipeline_gate.cpp \
  "$LIB" -L "$OCCT_PREFIX/lib" \
  -Wl,-rpath,"$KDIR" -Wl,-rpath,"$OCCT_PREFIX/lib" \
  -o "$BIN"
rc=$?
if [ $rc -ne 0 ]; then
  echo "[ir-pipeline] the gate did not BUILD (rc=$rc). RED."
  exit 3
fi

"$BIN"
rc=$?
rm -rf "$(dirname "$BIN")"

# A signal death is NOT "the assertions failed" -- reporting it as such sends the reader
# looking for a geometry bug that is not there. MEASURED while writing this gate: compiling
# against a working tree whose forge-kernel/include is mid-edit, while linking a
# libforge_kernel_core built from a DIFFERENT commit, segfaults at rc=139. The headers and
# the library disagreed; neither was broken on its own.
if [ $rc -ge 128 ]; then
  echo
  echo "[ir-pipeline] the gate CRASHED on signal $((rc - 128)) -- it did not complete, so this"
  echo "              is NOT an assertion failure. RED."
  echo "              First thing to check: do forge-kernel/include and the linked"
  echo "              libforge_kernel_core come from the SAME commit? Building against a"
  echo "              mid-edit header while linking a core built elsewhere reproduces this."
  exit 1
fi
exit $rc
