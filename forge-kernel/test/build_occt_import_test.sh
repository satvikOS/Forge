#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_occt_import_test.sh — build + run the OCCT->native importer A/B gate
# (test/native_occt_import_test.cpp). This test LINKS OCCT (it is the bridge's
# correctness oracle), so it is NOT part of test/native/run_native.sh (which is
# pure-native, OCCT-free). It mirrors the manual build line documented in the
# native_vs_occt_*.cpp A/B tests, but assembles the native object set + OCCT link
# flags automatically.
#
# It compiles every src/native/**.cpp (OCCT-free, like run_native.sh) once, plus
# src/OcctImport.cpp WITH OCCT, then links the test against the whole set + OCCT.
#
# Exit 0 iff the A/B gate prints "0 failed".
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL"

CXX="${CXX:-clang++}"
INC="include"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)"; exit 2
  fi
fi
OCCT_INC="$OCCT/include/opencascade"
OCCT_LIB="$OCCT/lib"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
# ── THE NATIVE PASS MUST NOT DEFINE FORGE_NATIVE_BREP (T-154) ────────────────
# This script's own header says the native sweep is compiled "OCCT-free, like
# run_native.sh" — and run_native.sh compiles that exact same sweep with exactly
# `-std=c++20 -O2`. Carrying -DFORGE_NATIVE_BREP into the native pass was a
# copy of the OCCT passes' flags, and it made the pass UNSATISFIABLE. The guard
# turns on the OCCT-BRIDGE half of src/native — MEASURED 2026-09-18: 18 of the
# 156 swept sources (StepRead/WriteOcct, NativeShapeHealBridge, NativeDraft*,
# NativeLoftPipe, NativeThick*, NativeNurbsConvert, ...) — whose headers include
# OCCT, which this pass deliberately gives no path to. Result: 18 "SRC FAIL"
# lines and `native source compile failed`, exit 1, BEFORE a single gate ran.

# It has been that way since 2026-07-21 (3aa7aed3), the day the first OCCT-typed
# source landed under src/native — three weeks after this script was written.
#
# ★ The guard is not merely unneeded here, it is INCOMPATIBLE with this script's
#   object set. Compiled with it ON (and an OCCT include path) the same objects
#   FAIL TO LINK: the guarded native code calls the bridge layer this script does
#   not compile — forge::occtBoxSolid, forge::occtCylinderSolid,
#   forge::occtFromNativeSolid, forge::occtmesh::tessellateShapeToSoup. Measured,
#   not assumed. The OCCT passes below KEEP the define, because src/OcctImport.cpp
#   is itself entirely inside `#ifdef FORGE_NATIVE_BREP`.
#
# ★★ A pass that compiles guarded code with the guard OFF can be green over an
#    EMPTY translation unit — a compiler returns 0 on an empty file. Step 1b is
#    therefore a POSITIVE CONTROL, and it is not optional.
NATIVE_FLAGS="-std=c++20 -O2"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
OBJDIR="$(mktemp -d /tmp/forge_occt_import.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAIL="$OBJDIR/fail"; : > "$FAIL"

CAP=()
cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null||true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null||true; done; CAP=(); }

# 1. compile every native source (OCCT-free) to a .o
OBJS=()
compile() { if ! $CXX $NATIVE_FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1"; tail -12 "$2.err"; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[occt-import] native source compile failed"; exit 1; }

# ── 1b. POSITIVE CONTROL: the pass above compiled REAL CODE ──────────────────
# Step 1 compiles the native tree with FORGE_NATIVE_BREP OFF, so everything
# inside that guard preprocesses to NOTHING — and a compiler returns 0 on an
# empty file. Without this check, step 1 could be GREEN WHILE COMPILING NOTHING.
# That is not hypothetical: it is the exact trap that produced two invalid
# "it compiles" measurements on the native pcurve fit, both written up in
# src/native/geom/README.NativePCurveFit.rescue.md. So count what the pass
# actually produced, and name a symbol that has to be in it.
#
# ★ forge::pcurvefit::cylinderPCurve is the anchor BECAUSE IT USED TO BE ABSENT.
#   Before T-154 the native pcurve fit was OCCT-typed and guarded, so an
#   OCCT-free compile of it emitted ZERO symbols. It is now OCCT-free and
#   unguarded, so this pass emits it. A future 0 means either the sweep stopped
#   compiling real code or the pcurve fit went back behind the guard.
#
# MEASURED on this tree, 2026-09-18, by this script at its own -O2: 156 sources
# -> 156 objects, 3004 forge:: symbols, cylinderPCurve = 1. (The same sweep at -O1
# reports 3060 — the symbol count is optimisation-dependent, which is exactly why
# the floor is 1000 and not the measurement.) The floors sit far below both, so
# ordinary churn cannot trip them; only a pass that compiled nothing can.
NSRC=${#OBJS[@]}
NOBJ=$(ls "$OBJDIR"/*.o 2>/dev/null | wc -l | tr -d ' ')
nm -g "$OBJDIR"/*.o 2>/dev/null | c++filt > "$OBJDIR/syms.txt" 2>/dev/null || true
NSYM=$(grep -c 'forge::' "$OBJDIR/syms.txt" 2>/dev/null || true)
NPCF=$(grep -c 'forge::pcurvefit::cylinderPCurve' "$OBJDIR/syms.txt" 2>/dev/null || true)
echo "[occt-import] native OCCT-free pass: ${NOBJ:-0}/${NSRC:-0} objects, ${NSYM:-0} forge:: symbols, cylinderPCurve=${NPCF:-0}"
if [ "${NOBJ:-0}" -ne "${NSRC:-0}" ] || [ "${NSYM:-0}" -lt 1000 ] || [ "${NPCF:-0}" -lt 1 ]; then
  echo "[occt-import] POSITIVE CONTROL FAILED — the OCCT-free pass did not compile real code"
  exit 1
fi

# 2. compile the importer WITH OCCT headers
IMP="$OBJDIR/OcctImport.o"
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c src/OcctImport.cpp -o "$IMP" 2>"$IMP.err"; then
  echo "[occt-import] OcctImport.cpp compile failed:"; tail -30 "$IMP.err"; exit 1
fi
OBJS+=("$IMP")

# 3. link + run the A/B test (OCCT libs)
# OCCT 7.9 merges GProp into TKTopAlgo (no TKGProp toolkit).
# TKFillet -> BRepFilletAPI_MakeFillet (the variable-radius BSpline blend fixture);
# TKOffset -> BRepOffsetAPI_ThruSections (the BSpline loft fixture).
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset"
BIN="$OBJDIR/native_occt_import_test"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" test/native_occt_import_test.cpp "${OBJS[@]}" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$BIN" 2>"$BIN.err"; then
  echo "[occt-import] TEST LINK FAILED:"; tail -40 "$BIN.err"; exit 1
fi
"$BIN"; RC=$?
exit $RC
