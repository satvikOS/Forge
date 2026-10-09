#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_fea_tet_surface_conformance_gate.sh — build + run
# test/fea_tet_surface_conformance_gate.cpp against the node-free kernel library.
#
# Native only: configures the kernel with FORGE_BUILD_NODE_ADDON=OFF and
# FORGE_BUILD_DESKTOP_FOUNDATION=ON, builds forge_kernel_core, compiles the gate with
# -Wall -Wextra -Werror and runs it. No Node, no addon, no JS.
#
# env:
#   KERNEL_BUILD  an existing kernel build dir to reuse (must hold libforge_kernel_core);
#                 default $TMPDIR/forge_fea_tet_gate_build, configured + built here.
#   JOBS          parallel build jobs (default 6)
#   PART          surface | le10 | le1 | all   (default all)
#   OCCT_ROOT     OCCT prefix (default: brew --prefix opencascade)
# exit: the gate's own exit code (0 = every asserted check held), 2 = setup error.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/.." && pwd)"
BUILD_DIR="${KERNEL_BUILD:-${TMPDIR:-/tmp}/forge_fea_tet_gate_build}"
JOBS="${JOBS:-6}"
PART="${PART:-all}"
CXX="${CXX:-clang++}"

OCCT_ROOT="${OCCT_ROOT:-$( (command -v brew >/dev/null && brew --prefix opencascade) 2>/dev/null || echo /opt/homebrew/opt/opencascade)}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  for c in /opt/homebrew/opt/opencascade /usr/local/opt/opencascade /usr /usr/local ; do
    [ -e "$c/include/opencascade/Standard_Version.hxx" ] && { OCCT_ROOT="$c"; break; }
  done
fi
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] \
  || { echo "FATAL: OCCT headers not found (set OCCT_ROOT)"; exit 2; }

echo "[1/3] kernel library ($BUILD_DIR)"
if [ ! -f "$BUILD_DIR/CMakeCache.txt" ]; then
  mkdir -p "$BUILD_DIR"
  cmake -S "$KERNEL" -B "$BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF \
        -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >"$BUILD_DIR/fea_tet_gate.configure.log" 2>&1 \
    || { echo "FATAL: configure failed"; tail -20 "$BUILD_DIR/fea_tet_gate.configure.log"; exit 2; }
fi
cmake --build "$BUILD_DIR" --target forge_kernel_core -j "$JOBS" >"$BUILD_DIR/fea_tet_gate.build.log" 2>&1 \
  || { echo "FATAL: forge_kernel_core build failed"; tail -30 "$BUILD_DIR/fea_tet_gate.build.log"; exit 2; }
LIB="$(ls "$BUILD_DIR"/libforge_kernel_core.* 2>/dev/null | head -1)"
[ -n "$LIB" ] || { echo "FATAL: libforge_kernel_core not built in $BUILD_DIR"; exit 2; }

echo "[2/3] compile + link the gate (-Wall -Wextra -Werror)"
"$CXX" -std=c++20 -O2 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
    -I "$KERNEL/include" -I "$OCCT_ROOT/include/opencascade" \
    "$HERE/fea_tet_surface_conformance_gate.cpp" \
    -o "$BUILD_DIR/fea_tet_surface_conformance_gate" \
    -L "$BUILD_DIR" -lforge_kernel_core \
    -Wl,-rpath,"$BUILD_DIR" -Wl,-rpath,"$OCCT_ROOT/lib" \
  || { echo "FATAL: gate did not compile/link"; exit 2; }

echo "[3/3] run the gate (part=$PART)"
echo
"$BUILD_DIR/fea_tet_surface_conformance_gate" "$PART"
exit $?
