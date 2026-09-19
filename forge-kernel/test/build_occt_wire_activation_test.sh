#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_occt_wire_activation_test.sh — build + run the PHASE-D wire-activation
# A/B gate (test/native_occt_wire_activation_test.cpp). It drives the REAL op
# files (ShapeCheck.cpp / InterferenceDetection.cpp / Fea.cpp) on OCCT inputs
# with the FEAT gate forced ON, proving each wire now imports the OCCT solid via
# forge::importOcctSolid and runs the native op, matching the OCCT result.
#
# This LINKS OCCT (the op files + the importer's bridge oracle), so it is NOT
# part of test/native/run_native.sh (which is pure-native, OCCT-free). It mirrors
# build_occt_import_test.sh: compile every src/native/**.cpp OCCT-free, plus the
# OCCT-side TUs the ops need WITH OCCT headers, then link the test + OCCT.
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
# The native sweep is compiled OCCT-free, "like run_native.sh", and run_native.sh
# uses exactly `-std=c++20 -O2`. With -DFORGE_NATIVE_BREP the OCCT-bridge half of
# src/native (18 of 156 sources) switches on and the pass cannot compile at all —
# and with the guard ON it cannot LINK either, because that code calls the bridge
# layer this script does not compile. Full derivation in build_occt_import_test.sh.
# The OCCT passes below keep the define (src/OcctImport.cpp is inside it).
# Step 1b is the positive control that keeps this pass from being green over an
# EMPTY translation unit.
NATIVE_FLAGS="-std=c++20 -O2"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
OBJDIR="$(mktemp -d /tmp/forge_occt_wire.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAIL="$OBJDIR/fail"; : > "$FAIL"

CAP=()
cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null||true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null||true; done; CAP=(); }

OBJS=()

# 1. compile every native source (OCCT-free) to a .o
compile_native() { if ! $CXX $NATIVE_FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1"; tail -12 "$2.err"; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile_native "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[wire-activation] native source compile failed"; exit 1; }

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
echo "[wire-activation] native OCCT-free pass: ${NOBJ:-0}/${NSRC:-0} objects, ${NSYM:-0} forge:: symbols, cylinderPCurve=${NPCF:-0}"
if [ "${NOBJ:-0}" -ne "${NSRC:-0}" ] || [ "${NSYM:-0}" -lt 1000 ] || [ "${NPCF:-0}" -lt 1 ]; then
  echo "[wire-activation] POSITIVE CONTROL FAILED — the OCCT-free pass did not compile real code"
  exit 1
fi

# 2. compile the OCCT-side TUs (op files + their registry/assembly deps + the
#    importer) WITH OCCT headers. These are the call-sites the wires live in.
OCCT_SRCS=(
  src/OcctImport.cpp
  src/NativeOcctBridge.cpp
  src/ShapeRegistry.cpp
  src/ComponentRegistry.cpp
  src/AssemblyHierarchy.cpp
  src/BVH.cpp
  src/InterferenceDetection.cpp
  src/Fea.cpp
  src/FeaTet.cpp
  src/ShapeCheck.cpp
  src/ShapeFix.cpp
  src/MassProps.cpp
  src/Drawings.cpp
  src/Healing.cpp
  # ── ADDED BY T-154, and only discoverable once the script could LINK ────────
  # This list was incomplete from the day it was written, and nothing could say
  # so: the native pass above died at its first step (see the NATIVE_FLAGS note),
  # so the link was never reached and these five never had a chance to be missed.
  # Each is named by an undefined symbol the linker printed, not guessed:
  src/ShapeHandle.cpp                # forge::shapeKind          <- MassProps.cpp
  src/NativeShapeAccess.cpp          # forge::nativeMeshOf/nativeSolidOf
  src/OcctPrimBuilder.cpp            # forge::occtCone/Torus/SphereSolid
  src/OcctNativeMesh.cpp             # forge::occtmesh::triangulateShapeInPlace
  # ★ NativeFilling.cpp lives under src/native and is therefore ALSO swept
  #   OCCT-free above, where it is inside #ifdef FORGE_NATIVE_BREP and compiles
  #   to an EMPTY object. Healing.cpp needs the real thing, so it is compiled a
  #   second time WITH OCCT here. That is not an exclusion from the OCCT-free
  #   sweep — the sweep still compiles it and still proves it needs no OCCT
  #   header to do so; this adds a compile rather than removing one, and the
  #   empty object contributes no symbol for this one to collide with.
  src/native/brep/NativeFilling.cpp  # forge::occtfill::fillC0BoundaryDiag <- Healing.cpp
)
compile_occt() { if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c "$1" -o "$2" 2>"$2.err"; then echo "OCCT SRC FAIL: $1"; tail -20 "$2.err"; echo x>>"$FAIL"; fi; }
for src in "${OCCT_SRCS[@]}"; do
  [ -e "$src" ] || { echo "MISSING: $src"; echo x>>"$FAIL"; continue; }
  obj="$OBJDIR/occt_$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile_occt "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[wire-activation] OCCT source compile failed"; exit 1; }

# 3. link + run the A/B test (OCCT libs). OCCT 7.9 merges GProp into TKTopAlgo.
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKMesh -lTKXSBase -lTKDESTEP -lTKDE -lTKHLR -lTKOffset -lTKFillet"
BIN="$OBJDIR/native_occt_wire_activation_test"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" test/native_occt_wire_activation_test.cpp "${OBJS[@]}" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$BIN" 2>"$BIN.err"; then
  echo "[wire-activation] TEST LINK FAILED:"; tail -60 "$BIN.err"; exit 1
fi
"$BIN"; RC=$?
exit $RC
