#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_draft.sh — LIVE-OCCT A/B for TKOffset FAMILY J.
#
# Compiles test/ab_native_draft_occt.cpp together with the engine it exercises —
# src/native/brep/NativeDraft.cpp (+ NativeShapeHeal.cpp, whose
# occtheal::solidFromShell it uses) — against OCCT, and runs it. Exit 0 iff every
# volume / centre-of-mass / bounding-box / topology / validity assertion holds,
# the equal-volume NEGATIVE CONTROL is rejected, and every DEFER control declines.
#
# It also asserts the POINT of the exercise on the OBJECT FILE: NativeDraft.o must
# import ZERO TKOffset symbol. TKOffset is linked HERE and only here, because the
# A/B's OCCT half calls BRepOffsetAPI_DraftAngle on purpose.
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
    echo "[ab-draft] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_draft.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

ENGINE=forge-kernel/src/native/brep/NativeDraft.cpp
DEPS=forge-kernel/src/native/brep/NativeShapeHeal.cpp

OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)

echo "[ab-draft] OCCT $OCCT_ROOT"
# -Wno-deprecated-declarations: OCCT 7.9's own NCollection headers call sprintf(3).
# That is OCCT's code, not ours; the ENGINE is compiled -Werror below with no waiver.
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" \
      forge-kernel/test/ab_native_draft_occt.cpp "$ENGINE" "$DEPS" \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/ab_draft" 2>"$OUT/build.err"; then
  echo "[ab-draft] BUILD/LINK FAIL"; sed -n '1,100p' "$OUT/build.err"; exit 1
fi

# PROOF OF THE POINT: the engine's own object file must import ZERO TKOffset
# symbol. Compiled separately, and with -Werror, so the check is on the engine
# alone and holds it to the SR-3 warning bar.
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -Wno-deprecated-declarations \
   -DFORGE_NATIVE_BREP=1 -I "$INC" -I "$OCCT_INC" \
   -c "$ENGINE" -o "$OUT/engine.o" 2>"$OUT/engine.err" || {
     echo "[ab-draft] engine-only -Werror compile FAILED"; sed -n '1,60p' "$OUT/engine.err"; exit 1; }
nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null | awk 'NF>=3{print $3} NF==2{print $2}' \
  | sort -u > "$OUT/tkoffset.exports"
if [ ! -s "$OUT/tkoffset.exports" ]; then
  echo "[ab-draft] FAIL — could not read libTKOffset exports from $OCCT_LIB;"
  echo "           the zero-import check would pass VACUOUSLY. Refusing."
  exit 1
fi
nm -u "$OUT/engine.o" | sed 's/^ *//' | sort -u > "$OUT/engine.undef"
NTK=$(comm -12 "$OUT/engine.undef" "$OUT/tkoffset.exports" | tee "$OUT/engine.tkoffset" | grep -c . )
echo "[ab-draft] NativeDraft.o TKOffset imports: $NTK"
if [ "$NTK" -ne 0 ]; then
  echo "[ab-draft] FAIL — the engine imports TKOffset symbols:"
  c++filt < "$OUT/engine.tkoffset"
  exit 1
fi

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/ab_draft"
rc=$?
[ "$rc" -eq 0 ] && echo "[ab-draft] PASS" || echo "[ab-draft] FAIL (exit $rc)"
exit "$rc"
