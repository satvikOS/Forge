#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_loftpipe.sh — LIVE-OCCT A/B for TKOffset families D and F.
#
# Compiles test/ab_native_loftpipe_occt.cpp together with the two native
# translation units it needs — src/native/brep/NativeLoftPipe.cpp (the engine)
# and src/native/brep/NativeShapeHeal.cpp (occtheal::solidFromShell, the
# TKShHealing-free ShapeFix_Solid subset it orients through) — against OCCT, and
# runs it. Exit 0 iff every volume / position / topology assertion holds, every
# DEFER control declines, and the negative control is rejected.
#
# Only three TUs are compiled on purpose: the engine is deliberately self-
# contained, so the A/B does not need the kernel linked and does not compete with
# a full build for machine time.
#
# OCCT root is the brew default; override with OCCT_ROOT= (matches CMakeLists).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[ab-loftpipe] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_loftpipe.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# TKOffset is linked HERE and only here: the A/B's OCCT half calls
# BRepOffsetAPI_ThruSections and BRepOffsetAPI_MakePipeShell on purpose. The
# engine under test references no TKOffset symbol at all — that is the point.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)

# OcctPrimBuilder.cpp is linked because NativeLoftPipe.cpp calls forge::occtCylinderSolid
# NativeNurbsConvert.cpp is linked because NativeLoftPipe.cpp calls
# forge::occtconv::curveToBSpline. That dependency arrived when THRUSECTIONS
# swapped GeomConvert::CurveToBSplineCurve (header-only OCCT) for our own helper
# -- a correct change, because GeomConvert lives in TKGeomBase, a toolkit still
# on the drop list, so using it would have MOVED the debt rather than paid it.
# The cost was that this harness's hand-maintained link list stopped matching
# its own sources, and run_ab_all.sh reported
#   RED loftpipe: DID NOT BUILD/LINK -- its assertions did not run at all
# i.e. the assertions silently did not run at all. A hand-maintained link list
# is a standing trap: when an engine gains a first-party dependency, EVERY
# harness that compiles that engine standalone has to gain it too.
# and forge::occtPrism since the TKPrim-free swap (PR #64). Without it this harness dies
# with "symbol(s) not found for architecture arm64" and its assertions never run at all.
# This is the SECOND harness PR #64 broke; run_ab_native_thicken.sh was the first, and CI
# runs neither, so both failed silently from the moment that PR merged.
echo "[ab-loftpipe] OCCT $OCCT_ROOT"
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" \
      forge-kernel/test/ab_native_loftpipe_occt.cpp \
      forge-kernel/src/native/brep/NativeLoftPipe.cpp \
      forge-kernel/src/native/brep/NativeShapeHeal.cpp \
      forge-kernel/src/OcctPrimBuilder.cpp \
      forge-kernel/src/native/geom/NativeNurbsConvert.cpp \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/ab_loftpipe" 2>"$OUT/build.err"; then
  echo "[ab-loftpipe] BUILD/LINK FAIL"; sed -n '1,80p' "$OUT/build.err"; exit 1
fi
if [ -s "$OUT/build.err" ]; then
  echo "[ab-loftpipe] compiler diagnostics:"; sed -n '1,40p' "$OUT/build.err"
fi

# PROOF OF THE POINT: the engine's own object file must import ZERO TKOffset
# symbol. Compiled separately so the check is on the engine alone, not the A/B.
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
   -I "$INC" -I "$OCCT_INC" \
   -c forge-kernel/src/native/brep/NativeLoftPipe.cpp -o "$OUT/engine.o" \
   2>"$OUT/engine.err" || {
     echo "[ab-loftpipe] engine-only -Werror compile FAILED"; sed -n '1,60p' "$OUT/engine.err"; exit 1; }
nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null | awk 'NF>=3{print $3} NF==2{print $2}' \
  | sort -u > "$OUT/tkoffset.exports"
nm -u "$OUT/engine.o" | sed 's/^ *//' | sort -u > "$OUT/engine.undef"
NTK=$(comm -12 "$OUT/engine.undef" "$OUT/tkoffset.exports" | tee "$OUT/engine.tkoffset" | grep -c . )
echo "[ab-loftpipe] NativeLoftPipe.o TKOffset imports: $NTK"
if [ "$NTK" -ne 0 ]; then
  echo "[ab-loftpipe] FAIL — the engine imports TKOffset symbols:"
  c++filt < "$OUT/engine.tkoffset"
  exit 1
fi

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/ab_loftpipe"
rc=$?
[ "$rc" -eq 0 ] && echo "[ab-loftpipe] PASS" || echo "[ab-loftpipe] FAIL (exit $rc)"
exit "$rc"
