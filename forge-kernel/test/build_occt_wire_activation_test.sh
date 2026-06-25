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
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
OBJDIR="$(mktemp -d /tmp/forge_occt_wire.XXXXXX)"
trap 'rm -rf "$OBJDIR"' EXIT
FAIL="$OBJDIR/fail"; : > "$FAIL"

CAP=()
cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null||true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null||true; done; CAP=(); }

OBJS=()

# 1. compile every native source (OCCT-free) to a .o
compile_native() { if ! $CXX $FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1"; tail -12 "$2.err"; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile_native "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[wire-activation] native source compile failed"; exit 1; }

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
)
compile_occt() { if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c "$1" -o "$2" 2>"$2.err"; then echo "OCCT SRC FAIL: $1"; tail -20 "$2.err"; echo x>>"$FAIL"; fi; }
for src in "${OCCT_SRCS[@]}"; do
  [ -e "$src" ] || { echo "MISSING: $src"; echo x>>"$FAIL"; continue; }
  obj="$OBJDIR/occt_$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile_occt "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[wire-activation] OCCT source compile failed"; exit 1; }

# 3. link + run the A/B test (OCCT libs). OCCT 7.9 merges GProp into TKTopAlgo.
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKMesh -lTKXSBase -lTKDESTEP -lTKDE"
BIN="$OBJDIR/native_occt_wire_activation_test"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" test/native_occt_wire_activation_test.cpp "${OBJS[@]}" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$BIN" 2>"$BIN.err"; then
  echo "[wire-activation] TEST LINK FAILED:"; tail -60 "$BIN.err"; exit 1
fi
"$BIN"; RC=$?
exit $RC
