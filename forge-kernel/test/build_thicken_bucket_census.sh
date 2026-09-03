#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_thicken_bucket_census.sh — build test/thicken_bucket_census.cpp.
#
# The probe is PURE OCCT and links NO forge object, so an engine change cannot
# move its answer — which is what lets it stand as an oracle for one. It
# reproduces the corpus A/B's own face pick (betterFace, copied verbatim from
# test/corpus_ab_coverage.cpp:442) and reports the TRIM STRUCTURE of that face:
# surface type, UV box, area against R*du*dv, wire count, and how many boundary
# edges are u-isoparametric / v-isoparametric / neither.
#
# WHY IT EXISTS. THICKEN's deletion bucket was 23 of 600 parts on a single defer
# reason, "the face is not the full parametric rectangle (a trimmed or holed
# patch)". That sentence names a PREDICATE, not a shape, and an engine cannot be
# designed against a predicate. This probe answered what the 23 actually are:
# 23/23 Geom_CylindricalSurface, 23/23 a full 2*pi turn, area ratio 0.842..0.960,
# 19 of 23 carrying exactly one hole, and 21 of 23 with at least one boundary
# edge that is NOT isoparametric — which is what said a general radial ruled wall
# was required and an isoparametric-only special case would buy only 2 of 23.
#
# usage: bash forge-kernel/test/build_thicken_bucket_census.sh
#        then: <bin> <part.step>   (one JSON object per part on stdout)
# Output: the binary path on stdout as  BIN=<path>.
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
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2; exit 2
  fi
fi
OUTDIR="${OUTDIR:-$KERNEL/.build-corpus-ab}"
OUT="${OUT:-$OUTDIR/thicken_bucket_census}"
mkdir -p "$OUTDIR" || exit 2
"$CXX" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
  -I "$OCCT/include/opencascade" test/thicken_bucket_census.cpp \
  -L "$OCCT/lib" -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep \
  -lTKTopAlgo -lTKShHealing -lTKDESTEP -lTKXSBase -o "$OUT" || {
    echo "FATAL: build failed" >&2; exit 1; }
echo "BIN=$OUT"
