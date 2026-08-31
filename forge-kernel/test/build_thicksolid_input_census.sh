#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_thicksolid_input_census.sh — build test/thicksolid_input_census.cpp.
#
# This probe links NO forge source. It is OCCT only, deliberately: it measures
# the corpus INPUT (source validity, face-type census, and how many planar faces
# meet NativeThickSolid's one-full-circle admissibility rule), and a probe that
# shared code with the engine under test could report the engine's own bug back
# as a property of the corpus.
#
# The control self-test runs as part of the build and the build REFUSES to emit
# a binary if it is red — a census that classified everything as "other" would
# look exactly like a real result on a NURBS corpus.
#
# Output: BIN=<path> on stdout. Exit 0 iff the binary built and its controls pass.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2
    exit 2
  fi
fi

OBJDIR="${OBJDIR:-$KERNEL/.build-corpus-ab}"
OUT="${OUT:-$OBJDIR/thicksolid_input_census}"
mkdir -p "$OBJDIR" || exit 2

if ! $CXX -std=c++20 -O2 -I "$OCCT/include/opencascade" \
     test/thicksolid_input_census.cpp \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing \
     -lTKDESTEP -lTKXSBase \
     -o "$OUT" 2> "$OBJDIR/input_census_build.err"; then
  echo "[input-census] BUILD FAILED:" >&2
  tail -40 "$OBJDIR/input_census_build.err" >&2
  exit 1
fi

if ! "$OUT" --selftest > "$OBJDIR/input_census_selftest.log" 2>&1; then
  echo "[input-census] CONTROL SELF-TEST FAILED:" >&2
  cat "$OBJDIR/input_census_selftest.log" >&2
  exit 1
fi
cat "$OBJDIR/input_census_selftest.log" >&2

echo "BIN=$OUT"
exit 0
