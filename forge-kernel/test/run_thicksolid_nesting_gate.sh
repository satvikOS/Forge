#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thicksolid_nesting_gate.sh — build + run test/native_thicksolid_nesting_gate.cpp,
# the two-sided gate on the offset-circle NESTING guard in
# src/native/brep/NativeThickSolid.cpp (circlesNest).
#
# Three TUs only — the engine, the ShapeFix_Solid subset it orients through, and
# the gate — so this does not need the kernel linked and does not compete with a
# full build for machine time. Same assembly as run_ab_native_offsetshape.sh.
#
# Exit 0 iff every assertion holds. See the gate's own banner for what it asserts
# and for the measured case (ho1041) that motivated the guard.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[thicksolid-nesting] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

OUT="${OUT:-$KERNEL/.build-thicksolid-nesting}"
mkdir -p "$OUT" || exit 2
BIN="$OUT/native_thicksolid_nesting_gate"

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"

# TKBO/TKBool are for the fixture's BRepAlgoAPI_Cut only — the ENGINE under test
# references neither, which run_ab_native_offsetshape.sh proves by symbol census.
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I include -I "$OCCT_INC" \
     test/native_thicksolid_nesting_gate.cpp \
     src/native/brep/NativeThickSolid.cpp \
     src/native/brep/NativeShapeHeal.cpp \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing \
     -o "$BIN" 2> "$OUT/build.err"; then
  echo "[thicksolid-nesting] BUILD FAILED:"
  tail -40 "$OUT/build.err"
  exit 1
fi

"$BIN"
rc=$?
exit "$rc"
