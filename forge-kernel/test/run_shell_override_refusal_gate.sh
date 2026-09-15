#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_shell_override_refusal_gate.sh — build + run test/shell_override_refusal_gate.cpp
# against an ALREADY-BUILT libforge_kernel_core.
#
#   FORGE_KERNEL_BUILD_DIR   build tree holding libforge_kernel_core.{dylib,so}
#                            (default: forge-kernel/build-verify, the tree the
#                            kernel CI job populates in "Build forge_kernel_core")
#
# It does NOT build the library itself: a gate that silently kicks off a full
# kernel build is a heavy command nobody scheduled. A missing library is exit 2
# (not a pass, not a fail — the gate did not run).
#
# The previous binary is deleted FIRST and the compiler's exit status is read
# directly: a failed build that leaves an old binary on disk "passes" by testing
# the code it was meant to replace.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KERNEL="$ROOT/forge-kernel"
BUILD="${FORGE_KERNEL_BUILD_DIR:-$KERNEL/build-verify}"
case "$BUILD" in /*) ;; *) BUILD="$ROOT/$BUILD" ;; esac

LIB="$BUILD/libforge_kernel_core.dylib"
[ -f "$LIB" ] || LIB="$BUILD/libforge_kernel_core.so"
[ -f "$LIB" ] || { echo "[shell-override-refusal] FATAL: no libforge_kernel_core in $BUILD (build the forge_kernel_core target first)" >&2; exit 2; }

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] || OCCT_ROOT="/usr/local/opt/opencascade"
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] || OCCT_ROOT="/usr"
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] \
  || { echo "[shell-override-refusal] FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2; }

OUT="${OUT:-${TMPDIR:-/tmp}/forge_shell_override_refusal_gate}"
mkdir -p "$OUT" || exit 2
BIN="$OUT/shell_override_refusal_gate"
rm -f "$BIN"

if ! "${CXX:-clang++}" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP \
      "$KERNEL/test/shell_override_refusal_gate.cpp" \
      -I "$KERNEL/include" -I "$OCCT_ROOT/include/opencascade" \
      "$LIB" -Wl,-rpath,"$BUILD" \
      -L "$OCCT_ROOT/lib" -Wl,-rpath,"$OCCT_ROOT/lib" \
      -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -o "$BIN" 2> "$OUT/build.err"; then
  echo "[shell-override-refusal] BUILD FAILED:" >&2
  tail -30 "$OUT/build.err" >&2
  exit 1
fi
[ -x "$BIN" ] || { echo "[shell-override-refusal] no binary after a successful compile" >&2; exit 1; }

"$BIN"
exit $?
