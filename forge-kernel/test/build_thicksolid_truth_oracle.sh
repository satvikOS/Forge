#!/usr/bin/env bash
# build_thicksolid_truth_oracle.sh — build test/thicksolid_truth_oracle.cpp.
#
# The oracle links NO offset engine (no BRepOffsetAPI, no forge native source):
# it evaluates the DEFINITION of a hollow -- the morphological erosion of the
# solid by the wall radius over the boundary minus the removed face -- by Monte
# Carlo and by voxels. Its controls run as part of the build and the build
# REFUSES to emit a binary if they are red. Two of the four are the both-
# directions proof for the merge detector the corpus conclusion rests on: two
# holes 2 mm apart eroded by 2 mm MUST lose a handle, and the same two holes
# 18 mm apart MUST NOT.
#
# Output: BIN=<path> on stdout. Exit 0 iff built and controls green.
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2
CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else echo "FATAL: OCCT not found" >&2; exit 2; fi
fi
OBJDIR="${OBJDIR:-$KERNEL/.build-corpus-ab}"
OUT="${OUT:-$OBJDIR/thicksolid_truth_oracle}"
mkdir -p "$OBJDIR" || exit 2
if ! $CXX -std=c++20 -O2 -I "$OCCT/include/opencascade" \
     test/thicksolid_truth_oracle.cpp \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKMesh -lTKBO -lTKBool -lTKShHealing \
     -lTKDESTEP -lTKXSBase \
     -o "$OUT" 2> "$OBJDIR/truth_oracle_build.err"; then
  echo "[truth-oracle] BUILD FAILED:" >&2; tail -60 "$OBJDIR/truth_oracle_build.err" >&2; exit 1
fi
if ! "$OUT" --selftest > "$OBJDIR/truth_oracle_selftest.log" 2>&1; then
  echo "[truth-oracle] CONTROL SELF-TEST FAILED:" >&2; cat "$OBJDIR/truth_oracle_selftest.log" >&2; exit 1
fi
cat "$OBJDIR/truth_oracle_selftest.log" >&2
echo "BIN=$OUT"
exit 0
