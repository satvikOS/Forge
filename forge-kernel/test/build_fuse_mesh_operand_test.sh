#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_fuse_mesh_operand_test.sh — build + run the PHASE-D FUSE MESH-OPERAND
# BRIDGE gate (test/native_fuse_mesh_operand_test.cpp). It drives the REAL op
# files (Primitives.cpp / Features.cpp / Booleans.cpp / Transform.cpp) with the
# FEAT gate forced ON, proving a cut/fuse whose operand is a NativeMesh (a
# fillet/chamfer mesh-bridge result) now routes through the native mesh boolean
# (brep::booleanMeshOperand via tryNativeBoolean) WITHOUT hitting the OCCT bridge
# (the inverted importOcctSolidCallCount probe must NOT move).
#
# This LINKS OCCT only to supply the importer-probe oracle (OcctImport.cpp) +
# the OCCT-side op TUs the call-sites live in — the boolean itself is OCCT-free.
# It mirrors build_occt_wire_activation_test.sh: compile every src/native/**.cpp
# OCCT-free, plus the curated OCCT-side TUs WITH OCCT headers, then link + OCCT.
#
# Exit 0 iff the gate prints "0 failed".
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
# PLANEGCS (vendored) + its in-house Eigen shim + boost — needed to compile/link
# src/Sketcher.cpp (Features.cpp references forge::extractProfileRings, which lives
# there). Same include set CMakeLists.txt uses for the planegcs target.
PLANEGCS_DIR="$KERNEL/3rdParty/planegcs"
EIGEN_SHIM="$KERNEL/3rdParty/planegcs_eigen_shim"
BOOST_INC="${BOOST_INC:-/opt/homebrew/opt/boost/include}"
if [ ! -e "$BOOST_INC/boost/graph/adjacency_list.hpp" ]; then
  echo "FATAL: Boost not found at $BOOST_INC (brew install boost or set BOOST_INC)"; exit 2
fi
GCS_FLAGS="-I $EIGEN_SHIM -I $BOOST_INC -I $PLANEGCS_DIR"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
OBJDIR="$(mktemp -d /tmp/forge_fuse_mesh.XXXXXX)"
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
[ -s "$FAIL" ] && { echo "[fuse-mesh-operand] native source compile failed"; exit 1; }

# 2. compile the OCCT-side TUs (the op files this test drives + their registry/
#    importer/bridge deps) WITH OCCT headers. These are the call-sites the
#    mesh-operand boolean lives behind.
OCCT_SRCS=(
  src/OcctImport.cpp        # importOcctSolidCallCount (the inverted probe oracle)
  src/NativeOcctBridge.cpp  # the lazy native->OCCT bridge in ShapeRegistry::get
  src/ShapeRegistry.cpp     # ShapeRegistry / kindOf / getNativeMesh / addNativeSolid
  src/Primitives.cpp        # makeBox / makeCylinder
  src/Features.cpp          # filletEdges (the NativeMesh-producing mesh-bridge verb)
  src/Booleans.cpp          # cut / fuse / tryNativeBoolean (the fix under test)
  src/LineageRegistry.cpp   # LineageRegistry::put (OCCT-fallback path in runBoolean)
  src/Transform.cpp         # translate (place the cutter / boss)
  src/Sketcher.cpp          # extractProfileRings (Features.cpp dep)
)
# Sketcher.cpp needs OCCT + the PLANEGCS/eigen-shim/boost include set (it includes GCS.h).
compile_occt() {
  local extra=""
  case "$1" in src/Sketcher.cpp) extra="$GCS_FLAGS";; esac
  # shellcheck disable=SC2086
  if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" $extra -c "$1" -o "$2" 2>"$2.err"; then echo "OCCT SRC FAIL: $1"; tail -20 "$2.err"; echo x>>"$FAIL"; fi;
}
for src in "${OCCT_SRCS[@]}"; do
  [ -e "$src" ] || { echo "MISSING: $src"; echo x>>"$FAIL"; continue; }
  obj="$OBJDIR/occt_$(echo "$src" | tr '/.' '__').o"; OBJS+=("$obj"); cap compile_occt "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[fuse-mesh-operand] OCCT source compile failed"; exit 1; }

# 2b. compile the vendored PLANEGCS solver TUs (extractProfileRings -> the Sketcher
#     class -> GCS symbols). OCCT-free; needs the eigen-shim/boost/planegcs includes.
PLANEGCS_SRCS=(
  "$PLANEGCS_DIR/Constraints.cpp"
  "$PLANEGCS_DIR/GCS.cpp"
  "$PLANEGCS_DIR/Geo.cpp"
  "$PLANEGCS_DIR/SubSystem.cpp"
  "$PLANEGCS_DIR/qp_eq.cpp"
)
compile_gcs() { if ! $CXX $FLAGS -I "$INC" $GCS_FLAGS -c "$1" -o "$2" 2>"$2.err"; then echo "GCS SRC FAIL: $1"; tail -20 "$2.err"; echo x>>"$FAIL"; fi; }
for src in "${PLANEGCS_SRCS[@]}"; do
  [ -e "$src" ] || { echo "MISSING: $src"; echo x>>"$FAIL"; continue; }
  obj="$OBJDIR/gcs_$(basename "$src" .cpp).o"; OBJS+=("$obj"); cap compile_gcs "$src" "$obj"
done
drain
[ -s "$FAIL" ] && { echo "[fuse-mesh-operand] PLANEGCS source compile failed"; exit 1; }

# 3. link + run the gate (OCCT libs). OCCT 7.9 merges GProp into TKTopAlgo.
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKMesh -lTKXSBase -lTKDESTEP -lTKDE -lTKHLR -lTKOffset -lTKFillet"
BIN="$OBJDIR/native_fuse_mesh_operand_test"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" test/native_fuse_mesh_operand_test.cpp "${OBJS[@]}" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$BIN" 2>"$BIN.err"; then
  echo "[fuse-mesh-operand] TEST LINK FAILED:"; tail -60 "$BIN.err"; exit 1
fi
"$BIN"; RC=$?
exit $RC
