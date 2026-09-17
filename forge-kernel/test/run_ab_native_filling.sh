#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_filling.sh — LIVE-OCCT A/B for TKOffset family C.
#
# Compiles test/ab_native_filling_occt.cpp together with the engine it exercises
# — src/native/brep/NativeFilling.cpp — against OCCT, and runs it. Exit 0 iff
# every area / position / topology / surface-type assertion holds, the whole-solid
# end-to-end closes, every DEFER control declines, and the negative control is
# rejected.
#
# Only two TUs are compiled on purpose: the engine is deliberately self-contained,
# so the A/B does not need the kernel linked and does not compete with a full build
# for machine time.
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
    echo "[ab-filling] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_filling.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

# TKOffset is linked HERE and only here: the A/B's OCCT half calls
# BRepOffsetAPI_MakeFilling on purpose. The engine under test references no
# TKOffset symbol at all — that is the point.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)

echo "[ab-filling] OCCT $OCCT_ROOT"
# -Wno-deprecated-declarations: OCCT 7.9's own GeomPlate/NCollection headers call
# sprintf(3). That is OCCT's code, not ours; the ENGINE is compiled -Werror below
# with no such waiver.
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" \
      forge-kernel/test/ab_native_filling_occt.cpp \
      forge-kernel/src/native/brep/NativeFilling.cpp \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/ab_filling" 2>"$OUT/build.err"; then
  echo "[ab-filling] BUILD/LINK FAIL"; sed -n '1,80p' "$OUT/build.err"; exit 1
fi

# PROOF OF THE POINT: the engine's own object file must import ZERO TKOffset
# symbol. Compiled separately, and with -Werror, so the check is on the engine
# alone and holds it to the SR-3 warning bar.
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
   -I "$INC" -I "$OCCT_INC" \
   -c forge-kernel/src/native/brep/NativeFilling.cpp -o "$OUT/engine.o" \
   2>"$OUT/engine.err" || {
     echo "[ab-filling] engine-only -Werror compile FAILED"; sed -n '1,60p' "$OUT/engine.err"; exit 1; }
nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null | awk 'NF>=3{print $3} NF==2{print $2}' \
  | sort -u > "$OUT/tkoffset.exports"
nm -u "$OUT/engine.o" | sed 's/^ *//' | sort -u > "$OUT/engine.undef"
NTK=$(comm -12 "$OUT/engine.undef" "$OUT/tkoffset.exports" | tee "$OUT/engine.tkoffset" | grep -c . )
echo "[ab-filling] NativeFilling.o TKOffset imports: $NTK"
if [ "$NTK" -ne 0 ]; then
  echo "[ab-filling] FAIL — the engine imports TKOffset symbols:"
  c++filt < "$OUT/engine.tkoffset"
  exit 1
fi

# ── THE DROP LOCK (added 2026-09-14 with the family-C deletion) ─────────────
# The A/B above proves the ENGINE is TKOffset-free. It says nothing about the
# CALL SITE, and the call site is where the symbols actually came from: for
# months src/Healing.cpp carried the OCCT BRepOffsetAPI_MakeFilling path behind
# #ifndef FORGE_FILLING_DROP_NATIVE, the option sat at OFF, and all 5 family-C
# symbols shipped. A guarded branch still emits every symbol it names.
#
# So compile src/Healing.cpp with the SHIPPED flag set — note that
# -DFORGE_FILLING_DROP_NATIVE is deliberately ABSENT, because family C must now be
# native with no opt-in present — and require ZERO TKOffset imports. Re-adding the
# header or the call turns this red.
HEAL_DEFS=(-DFORGE_NATIVE_BREP=1 -DFORGE_NATIVE_LAW=1 -DFORGE_NATIVE_NURBS_CONVERT=1
           -DFORGE_NATIVE_PROJECTION=1 -DFORGE_OFFSET_DROP_MAKEOFFSET=1
           -DFORGE_SHHEAL_DROP_NATIVE=1 -DNDEBUG)
HEAL_INCS=(-I"$OCCT_INC" -I"$ROOT/forge-kernel/3rdParty/planegcs_eigen_shim"
           -I/opt/homebrew/opt/boost/include
           -I"$ROOT/forge-kernel/3rdParty/planegcs" -I"$INC")
if ! "$CXX" -std=gnu++20 -O1 -fPIC "${HEAL_DEFS[@]}" "${HEAL_INCS[@]}" \
      -c forge-kernel/src/Healing.cpp -o "$OUT/Healing.o" 2>"$OUT/healing.err"; then
  echo "[ab-filling] BUILD/LINK FAIL — src/Healing.cpp did not compile"
  sed -n '1,60p' "$OUT/healing.err"; exit 1
fi
nm -u "$OUT/Healing.o" | sed 's/^ *//' | sort -u > "$OUT/healing.undef"
NHEAL=$(comm -12 "$OUT/healing.undef" "$OUT/tkoffset.exports" \
        | tee "$OUT/healing.tkoffset" | grep -c . )
echo "[ab-filling] CALL SITE src/Healing.cpp.o TKOffset imports: $NHEAL  (must be 0)"
if [ "$NHEAL" -ne 0 ]; then
  echo "[ab-filling] FAIL — the OCCT family-C path is back in src/Healing.cpp:"
  c++filt < "$OUT/healing.tkoffset"
  exit 1
fi

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/ab_filling"
rc=$?
[ "$rc" -eq 0 ] && echo "[ab-filling] PASS" || echo "[ab-filling] FAIL (exit $rc)"
exit "$rc"
