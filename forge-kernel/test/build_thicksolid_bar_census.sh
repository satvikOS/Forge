#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_thicksolid_bar_census.sh — build test/thicksolid_bar_census.cpp.
#
# This probe links NO forge source. It measures the OCCT arm of the THICKSOLID
# coverage gate only, deliberately: sharing code with the native engine would let
# the engine's own defects be reported back as properties of the baseline.
#
# The controls run as part of the build and the build REFUSES to emit a binary if
# they are red. Four of the five controls are about the INSTRUMENT rather than
# the corpus: a hollow that is valid must read valid with the closed-form volume;
# an impossible wall must NOT read as a clean hollow; a child that SIGSEGVs must
# read CRASH with its pre-crash records intact; a child that hangs must read
# TIMEOUT. A census that reported every part as "invalid" would look exactly like
# a real result on this corpus, so the valid direction is pinned first.
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
OUT="${OUT:-$OBJDIR/thicksolid_bar_census}"
mkdir -p "$OBJDIR" || exit 2

if ! $CXX -std=c++20 -O2 -I "$OCCT/include/opencascade" \
     test/thicksolid_bar_census.cpp \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
     -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKOffset -lTKShHealing \
     -lTKDESTEP -lTKXSBase \
     -o "$OUT" 2> "$OBJDIR/bar_census_build.err"; then
  echo "[bar-census] BUILD FAILED:" >&2
  tail -60 "$OBJDIR/bar_census_build.err" >&2
  exit 1
fi

if ! "$OUT" --selftest > "$OBJDIR/bar_census_selftest.log" 2>&1; then
  echo "[bar-census] CONTROL SELF-TEST FAILED:" >&2
  cat "$OBJDIR/bar_census_selftest.log" >&2
  exit 1
fi
cat "$OBJDIR/bar_census_selftest.log" >&2

echo "BIN=$OUT"
exit 0
