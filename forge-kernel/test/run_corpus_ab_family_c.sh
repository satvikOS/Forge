#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_corpus_ab_family_c.sh — LIVE-OCCT corpus A/B *and the regression lock* for
# TKOffset family C (BRepOffsetAPI_MakeFilling, src/Healing.cpp).
#
# Two things are checked, and the second is the one that keeps the drop dropped:
#
#   (1) GEOMETRY. test/corpus_ab_family_c.cpp runs the production native cap
#       (forge::occtfill::fillC0BoundaryDiag) against the OCCT sequence that was
#       deleted from the call site, over a generated corpus spanning six decades
#       of scale, convex/non-convex polygons, arc-built circles, planar splines
#       and non-planar saddles, comparing the FULL observable vector and a closed
#       form where one exists. OCCT is the ORACLE here, never the source.
#
#   (2) THE LOCK. src/Healing.cpp is compiled with the SHIPPED flag set and its
#       object file must import ZERO TKOffset symbols. This is what a flag could
#       never give: a guarded branch still emits every symbol it names, which is
#       why family C shipped 5 symbols for months while its option sat at OFF.
#       If anyone re-adds <BRepOffsetAPI_MakeFilling.hxx> or the call, this fails.
#
# OCCT root is the brew default; override with OCCT_ROOT= (matches CMakeLists).
# exit 0 iff the A/B runs clean AND Healing.cpp.o imports no TKOffset symbol.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[ab-famC] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_famC.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null \
  | awk 'NF>=3{print $3} NF==2{print $2}' | sort -u > "$OUT/tkoffset.exports"
if [ ! -s "$OUT/tkoffset.exports" ]; then
  echo "[ab-famC] FATAL: no libTKOffset found under $OCCT_LIB"; exit 2
fi

echo "[ab-famC] OCCT $OCCT_ROOT"

# ── (2) THE LOCK — run FIRST, because it is the claim of record ──────────────
# The shipped flag set, copied from CMakeFiles/forge_kernel_core.dir/flags.make.
# NOTE deliberately absent: -DFORGE_FILLING_DROP_NATIVE. Family C must be native
# with NO opt-in define present, which is precisely what distinguishes a deletion
# from a flag.
BASE_DEFS=(-DFORGE_NATIVE_BREP=1 -DFORGE_NATIVE_LAW=1 -DFORGE_NATIVE_NURBS_CONVERT=1
           -DFORGE_NATIVE_PROJECTION=1 -DFORGE_OFFSET_DROP_MAKEOFFSET=1
           -DFORGE_SHHEAL_DROP_NATIVE=1 -DNDEBUG)
LOCK_INCS=(-I"$OCCT_INC" -I"$ROOT/forge-kernel/3rdParty/planegcs_eigen_shim"
           -I/opt/homebrew/opt/boost/include
           -I"$ROOT/forge-kernel/3rdParty/planegcs" -I"$INC")

if ! "$CXX" -std=gnu++20 -O1 -fPIC "${BASE_DEFS[@]}" "${LOCK_INCS[@]}" \
      -c forge-kernel/src/Healing.cpp -o "$OUT/Healing.o" 2>"$OUT/healing.err"; then
  echo "[ab-famC] BUILD FAIL — src/Healing.cpp did not compile"
  sed -n '1,60p' "$OUT/healing.err"; exit 1
fi
nm -u "$OUT/Healing.o" | sed 's/^ *//' | sort -u > "$OUT/healing.undef"
comm -12 "$OUT/healing.undef" "$OUT/tkoffset.exports" > "$OUT/healing.tkoffset"
NTK=$(grep -c . "$OUT/healing.tkoffset" || true)
echo "[ab-famC] Healing.cpp.o TKOffset imports: $NTK  (must be 0)"
if [ "$NTK" -ne 0 ]; then
  echo "[ab-famC] FAIL — the OCCT family-C path is back in src/Healing.cpp:"
  c++filt < "$OUT/healing.tkoffset"
  exit 1
fi

# ── (1) GEOMETRY — the A/B itself ───────────────────────────────────────────
# -Wno-deprecated-declarations: OCCT 7.9's own GeomPlate/NCollection headers call
# sprintf(3), and the OCCT arm of this A/B must include them. That is OCCT's
# code, not ours; the ENGINE is held to -Werror below with no such waiver.
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP=1 -I "$INC" -I "$OCCT_INC" \
      forge-kernel/test/corpus_ab_family_c.cpp \
      forge-kernel/src/native/brep/NativeFilling.cpp \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$OUT/corpus_ab" 2>"$OUT/build.err"; then
  echo "[ab-famC] BUILD/LINK FAIL"; sed -n '1,80p' "$OUT/build.err"; exit 1
fi

# The engine alone, at the SR-3 warning bar, importing zero TKOffset symbols.
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" \
      -c forge-kernel/src/native/brep/NativeFilling.cpp -o "$OUT/engine.o" \
      2>"$OUT/engine.err"; then
  echo "[ab-famC] engine-only -Werror compile FAILED"; sed -n '1,60p' "$OUT/engine.err"; exit 1
fi
nm -u "$OUT/engine.o" | sed 's/^ *//' | sort -u > "$OUT/engine.undef"
comm -12 "$OUT/engine.undef" "$OUT/tkoffset.exports" > "$OUT/engine.tkoffset"
NENG=$(grep -c . "$OUT/engine.tkoffset" || true)
echo "[ab-famC] NativeFilling.o TKOffset imports: $NENG  (must be 0)"
if [ "$NENG" -ne 0 ]; then
  echo "[ab-famC] FAIL — the engine imports TKOffset symbols:"
  c++filt < "$OUT/engine.tkoffset"; exit 1
fi

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/corpus_ab" | tee "$OUT/ab.log"
rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ]; then
  echo "[ab-famC] FAIL — A/B exited $rc (a defer with an empty reason exits 2)"
  exit "$rc"
fi

# The A/B is a MEASUREMENT, so it reports rather than asserts thresholds — with
# one exception that is a correctness invariant, not a tuning knob: a declined
# boundary must always carry a named reason. corpus_ab_family_c.cpp exits 2 if it
# ever sees an empty one, which is what the rc check above catches.
echo "[ab-famC] PASS"
exit 0
