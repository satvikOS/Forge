#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_offsetshape.sh — LIVE-OCCT A/B for TKOffset family H.
#
# Compiles test/ab_native_offsetshape_occt.cpp together with the two native
# translation units it needs — src/native/brep/NativeThickSolid.cpp (the engine)
# and src/native/brep/NativeShapeHeal.cpp (occtheal::solidFromShell, the
# TKShHealing-free ShapeFix_Solid subset it orients through) — against OCCT, and
# runs it. Exit 0 iff every volume / position / topology assertion holds AND the
# negative control is rejected.
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
    echo "[ab-offsetshape] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_offsetshape.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# TKOffset is linked HERE and only here: the A/B's OCCT half calls
# BRepOffsetAPI_MakeOffsetShape on purpose. The engine under test references no
# TKOffset symbol at all — that is the point of the exercise.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)

echo "[ab-offsetshape] OCCT $OCCT_ROOT"
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" \
      forge-kernel/test/ab_native_offsetshape_occt.cpp \
      forge-kernel/src/native/brep/NativeThickSolid.cpp \
      forge-kernel/src/native/brep/NativeShapeHeal.cpp \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/ab_offsetshape" 2>"$OUT/build.err"; then
  echo "[ab-offsetshape] BUILD/LINK FAIL"; sed -n '1,60p' "$OUT/build.err"; exit 1
fi
if [ -s "$OUT/build.err" ]; then
  echo "[ab-offsetshape] compiler diagnostics:"; sed -n '1,40p' "$OUT/build.err"
fi

# PROOF OF THE POINT: the engine's own object file must import ZERO TKOffset
# symbol. Compiled separately so the check is on the engine alone, not the A/B.
"$CXX" -std=c++20 -O1 -DFORGE_NATIVE_BREP=1 -I "$INC" -I "$OCCT_INC" \
   -c forge-kernel/src/native/brep/NativeThickSolid.cpp -o "$OUT/engine.o" \
   2>/dev/null || { echo "[ab-offsetshape] engine-only compile FAILED"; exit 1; }
nm -gU "$OCCT_LIB/libTKOffset.7.9.dylib" 2>/dev/null | awk 'NF>=3{print $3} NF==2{print $2}' \
  | sort -u > "$OUT/tkoffset.exports"
nm -u "$OUT/engine.o" | sed 's/^ *//' | sort -u > "$OUT/engine.undef"
NTK=$(comm -12 "$OUT/engine.undef" "$OUT/tkoffset.exports" | tee "$OUT/engine.tkoffset" | grep -c . )
echo "[ab-offsetshape] NativeThickSolid.o TKOffset imports: $NTK"
if [ "$NTK" -ne 0 ]; then
  echo "[ab-offsetshape] FAIL — the engine imports TKOffset symbols:"
  c++filt < "$OUT/engine.tkoffset"
  exit 1
fi

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/ab_offsetshape"
rc=$?
[ "$rc" -eq 0 ] && echo "[ab-offsetshape] PASS" || echo "[ab-offsetshape] FAIL (exit $rc)"
exit "$rc"
