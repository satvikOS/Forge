#!/usr/bin/env bash
# build_cam_inwardoffset_ring_probe.sh — build the attribution probe for the
# FORGE_OFFSET_DROP_MAKEOFFSET deletion bucket. See
# test/cam_inwardoffset_ring_probe.cpp for what it measures.
#
#   usage: test/build_cam_inwardoffset_ring_probe.sh   -> prints BIN=<path>
#   env:   OCCT_ROOT=<prefix>  CXX=<compiler>
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

OUT="${OUT:-$KERNEL/.build-cam-offset-ab}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT=/usr/local/opt/opencascade
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || { echo "FATAL: OCCT not found" >&2; exit 2; }
mkdir -p "$OUT" || exit 2

LIBNAT="$KERNEL/.build-corpus-ab/libforge_native_ab.a"
[ -f "$LIBNAT" ] || bash "$KERNEL/test/build_corpus_ab_coverage.sh" >/dev/null 2>&1
[ -f "$LIBNAT" ] || { echo "FATAL: no $LIBNAT" >&2; exit 1; }

CXX="${CXX:-clang++}"
INC="-I $KERNEL/include -I $OCCT/include/opencascade"
LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      -lTKDESTEP -lTKXSBase"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"

# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$KERNEL/src/ShapeRegistry.cpp"   -o "$OUT/rp_shapereg.o"  || exit 1
# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$KERNEL/src/NativeOcctBridge.cpp" -o "$OUT/rp_bridge.o"   || exit 1
# shellcheck disable=SC2086
$CXX $FLAGS $INC -c "$KERNEL/test/cam_inwardoffset_ring_probe.cpp" -o "$OUT/rp_main.o" || exit 1
# shellcheck disable=SC2086
$CXX $FLAGS $INC "$OUT/rp_main.o" "$OUT/rp_shapereg.o" "$OUT/rp_bridge.o" "$LIBNAT" \
     -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" $LIBS -o "$OUT/cam_ring_probe" || exit 1
echo "BIN=$OUT/cam_ring_probe"
