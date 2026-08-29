#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_fillet_concave.sh — LIVE-OCCT A/B for the TKFillet-free CONCAVE
# (reflex) edge fillet and chamfer.
#
# Compiles test/ab_native_fillet_concave_occt.cpp together with the single native
# translation unit under test — src/native/brep/NativeFilletChamfer.cpp — against
# OCCT, and runs it. Exit 0 iff every observable matches OCCT on every in-scope
# case, every case also matches the INDEPENDENT closed form, every defer control
# declines with the stated reason, and the negative control is rejected.
#
# Only two TUs are compiled on purpose: the engine is self-contained, so the A/B
# does not need the kernel linked and does not compete with a full build for
# machine time. (Same idiom as run_ab_native_loftpipe.sh.)
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
    echo "[ab-fillet-concave] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_fillet_concave.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# TKFillet is linked HERE and only here: the A/B's OCCT half calls
# BRepFilletAPI_MakeFillet / BRepFilletAPI_MakeChamfer on purpose. The engine
# under test references no TKFillet symbol at all — that is the point, and the
# nm check below proves it rather than asserting it.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO
           -lTKBool -lTKFillet)

echo "[ab-fillet-concave] OCCT $OCCT_ROOT"
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" \
      forge-kernel/test/ab_native_fillet_concave_occt.cpp \
      forge-kernel/src/native/brep/NativeFilletChamfer.cpp \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/ab_fillet_concave" 2>"$OUT/build.err"; then
  echo "[ab-fillet-concave] BUILD/LINK FAIL"; sed -n '1,80p' "$OUT/build.err"; exit 1
fi
if [ -s "$OUT/build.err" ]; then
  echo "[ab-fillet-concave] compiler diagnostics:"; sed -n '1,40p' "$OUT/build.err"
fi

# PROOF OF THE POINT: the engine's own object file must import ZERO TKFillet
# symbol. Compiled separately so the check is on the engine alone, not the A/B.
#
# -Wno-unused-function is NOT a licence for new dead code: two file-static helpers
# (orderedOuterVertices, planarFaceFromRing) are unused on the CURRENT tree and were
# already unused at HEAD — measured 2026-08-29, identical two diagnostics at the same
# two line numbers on `git show HEAD:` of this file. Every OTHER warning class is
# still -Werror here.
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -Wno-unused-function -DFORGE_NATIVE_BREP=1 \
   -I "$INC" -I "$OCCT_INC" \
   -c forge-kernel/src/native/brep/NativeFilletChamfer.cpp -o "$OUT/engine.o" \
   2>"$OUT/engine.err" || {
     echo "[ab-fillet-concave] engine-only -Werror compile FAILED"; sed -n '1,60p' "$OUT/engine.err"; exit 1; }
nm -gU "$OCCT_LIB"/libTKFillet.*.dylib 2>/dev/null | awk 'NF>=3{print $3} NF==2{print $2}' \
  | sort -u > "$OUT/tkfillet.exports"
nm -u "$OUT/engine.o" | sed 's/^ *//' | sort -u > "$OUT/engine.undef"
NTK=$(comm -12 "$OUT/engine.undef" "$OUT/tkfillet.exports" | tee "$OUT/engine.tkfillet" | grep -c . )
echo "[ab-fillet-concave] NativeFilletChamfer.o TKFillet imports: $NTK"
if [ "$NTK" -ne 0 ]; then
  echo "[ab-fillet-concave] FAIL — the engine imports TKFillet symbols:"
  c++filt < "$OUT/engine.tkfillet"
  exit 1
fi

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/ab_fillet_concave"
rc=$?
[ "$rc" -eq 0 ] && echo "[ab-fillet-concave] PASS" || echo "[ab-fillet-concave] FAIL (exit $rc)"
exit "$rc"
