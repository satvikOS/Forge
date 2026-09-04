#!/usr/bin/env bash
# build_thicksolid_bar_fixture_gate.sh — build test/thicksolid_bar_fixture_gate.cpp.
#
# OCCT ONLY, no forge source: the gate's subject is OCCT's answer and the coverage
# harness's success predicate. A fixture that shared code with the native engine
# could report the engine's own defect as a property of the baseline.
#
# Output: BIN=<path> on stdout. Exit 0 iff the binary built.
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2
CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2; exit 2; fi
fi
OBJDIR="${OBJDIR:-$KERNEL/.build-thicksolid-bar}"
OUT="${OUT:-$OBJDIR/thicksolid_bar_fixture_gate}"
mkdir -p "$OBJDIR" || exit 2
if ! $CXX -std=c++20 -O2 -I "$OCCT/include/opencascade" \
     test/thicksolid_bar_fixture_gate.cpp \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKOffset -lTKShHealing \
     -o "$OUT" 2> "$OBJDIR/fixture_gate_build.err"; then
  echo "[thicksolid-bar-fixture] BUILD FAILED:" >&2
  tail -60 "$OBJDIR/fixture_gate_build.err" >&2
  exit 1
fi
echo "BIN=$OUT"
exit 0
