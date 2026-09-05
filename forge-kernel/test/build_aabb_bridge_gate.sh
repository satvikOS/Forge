#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_aabb_bridge_gate.sh — build + run test/native_aabb_bridge_gate.cpp.
#
# Links the BUILT libforge_kernel_core.dylib rather than recompiling the sources,
# so the gate exercises the EXACT binary that ships, not a private rebuild of it.
# Point BUILD_DIR at whichever candidate tree you are proving.
#
#   BUILD_DIR=build-occtzero-candidate bash test/build_aabb_bridge_gate.sh
#
# Exit 0 iff the gate prints "0 failed".
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL"

BUILD_DIR="${BUILD_DIR:-build-occtzero-candidate}"
CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)"; exit 2
  fi
fi

DYLIB="$KERNEL/$BUILD_DIR/libforge_kernel_core.dylib"
if [ ! -e "$DYLIB" ]; then
  echo "FATAL: $DYLIB not found — build forge_kernel_core in $BUILD_DIR first"; exit 2
fi

OUT="$(mktemp -d /tmp/forge_aabb_gate.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT
BIN="$OUT/native_aabb_bridge_gate"

# OCCT 7.9 merges GProp into TKTopAlgo; TKBO/TKBool are needed for the boolean fixture.
if ! $CXX -std=c++20 -O2 -DFORGE_NATIVE_BREP=1 \
    -I "$KERNEL/include" -I "$OCCT/include/opencascade" \
    test/native_aabb_bridge_gate.cpp \
    -L "$KERNEL/$BUILD_DIR" -lforge_kernel_core \
    -L "$OCCT/lib" -lTKernel -lTKMath -lTKG3d -lTKBRep -lTKTopAlgo -lTKPrim -lTKBO -lTKBool \
    -Wl,-rpath,"$KERNEL/$BUILD_DIR" -Wl,-rpath,"$OCCT/lib" \
    -o "$BIN" 2>"$OUT/err"; then
  echo "[aabb-gate] BUILD FAILED:"; tail -40 "$OUT/err"; exit 1
fi

echo "[aabb-gate] kernel under test: $DYLIB"
echo "[aabb-gate] sha256: $(shasum -a 256 "$DYLIB" | cut -d' ' -f1)"
echo
"$BIN"
exit $?
