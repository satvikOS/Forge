#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_curve_kind_ab_probe.sh — build test/curve_kind_ab_probe.cpp.
#
# The probe is PURE OCCT and links NO forge object: it carries both the OLD
# (Geom_* RTTI) and the NEW (BRepAdaptor_Curve::GetType) form of every curve
# classification NativeLoftPipe performs, and runs them in one process on one
# set of edges. It therefore measures the SUBSTITUTION, not the engine — the
# same separation test/thrusections_pair_probe.cpp is built for.
#
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
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2
    exit 2
  fi
fi

OBJDIR="${OBJDIR:-$KERNEL/.build-curve-kind-ab}"
OUT="${OUT:-$OBJDIR/curve_kind_ab_probe}"
mkdir -p "$OBJDIR" || exit 2

if ! $CXX -std=c++20 -O2 -I "include" -I "$OCCT/include/opencascade" \
     test/curve_kind_ab_probe.cpp -o "$OUT" \
     -L "$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKBRep -lTKTopAlgo -lTKGeomBase \
     2> "$OBJDIR/curve_kind_ab_probe.err"; then
  echo "BUILD FAILED:" >&2
  tail -40 "$OBJDIR/curve_kind_ab_probe.err" >&2
  exit 1
fi
echo "BIN=$OUT"
