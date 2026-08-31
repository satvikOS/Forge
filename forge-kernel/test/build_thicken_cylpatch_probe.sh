#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_thicken_cylpatch_probe.sh — build test/thicken_cylpatch_probe.cpp.
#
# The probe is PURE OCCT: it reads a STEP part, reproduces the corpus A/B's own
# face pick and thickness, calls BRepOffset_MakeOffset, and compares the answer
# with two closed forms. It links no forge object, so it needs no native
# archive and cannot be affected by an engine change — which is exactly what
# makes it usable as an oracle for one.
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

OBJDIR="${OBJDIR:-$KERNEL/.build-corpus-ab}"
OUT="${OUT:-$OBJDIR/thicken_cylpatch_probe}"
mkdir -p "$OBJDIR" || exit 2

if ! $CXX -std=c++20 -O2 -I "include" -I "$OCCT/include/opencascade" \
     test/thicken_cylpatch_probe.cpp -o "$OUT" \
     -L "$OCCT/lib" \
     -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKBRep -lTKTopAlgo -lTKGeomBase \
     -lTKGeomAlgo -lTKPrim -lTKBO -lTKBool -lTKShHealing -lTKOffset -lTKFillet \
     -lTKDESTEP -lTKDE -lTKXSBase 2> "$OBJDIR/thicken_cylpatch_probe.err"; then
  echo "BUILD FAILED:" >&2
  tail -30 "$OBJDIR/thicken_cylpatch_probe.err" >&2
  exit 1
fi
echo "BIN=$OUT"
