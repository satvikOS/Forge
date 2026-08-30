#!/bin/sh
# Build + run the thicken orientation gate.
#
# This gate needs the PRODUCTION path (forge::part::thickenSurface), not a replica of it,
# because the defect it exists to catch lives in what Features.cpp REGISTERS rather than in
# what BRepOffset returns. So it links libforge_kernel_core rather than compiling the
# engine standalone, and it builds that library first if it is absent -- a gate that cannot
# build cannot fail, and in this repo that has looked exactly like silence four times.
set -eu

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
KERNEL="$ROOT/forge-kernel"
BUILD="$KERNEL/build-app"
LIB="$BUILD/libforge_kernel_core.dylib"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ] || OCCT_ROOT="/usr/local/opt/opencascade"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
    echo "[thicken-orientation] OCCT not found — set OCCT_ROOT="; exit 2
fi

if [ ! -f "$LIB" ]; then
    echo "[thicken-orientation] building libforge_kernel_core first"
    cmake -S "$KERNEL" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
          -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON >/dev/null
    cmake --build "$BUILD" --target forge_kernel_core -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" >/dev/null
fi

OUT="${OUT:-$KERNEL/.build-thicken-orientation}"
mkdir -p "$OUT"

"${CXX:-clang++}" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
    "$KERNEL/test/thicken_orientation_gate.cpp" \
    -I "$KERNEL/include" -I "$OCCT_ROOT/include/opencascade" \
    "$LIB" -Wl,-rpath,"$BUILD" \
    -L "$OCCT_ROOT/lib" -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo \
    -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool \
    -o "$OUT/thicken_orientation_gate"

exec "$OUT/thicken_orientation_gate"
