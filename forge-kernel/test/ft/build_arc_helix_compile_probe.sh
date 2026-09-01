#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_arc_helix_compile_probe.sh — ARC and HELIX ACTUALLY BUILT.
#
# s0_ratchet.sh proves the two ops PARSE, on one translation unit, with no
# kernel link. That is not the same claim. A profile that builds every arc as
# its CHORD parses perfectly and returns a wrong solid with no error, which is
# the exact failure ARC exists to remove — so it has to be measured on real
# geometry, against closed-form values, on a VECTOR of observables.
#
# Same shape as build_surface_compile_probe.sh, and for the same reason: this
# one LINKS THE WHOLE KERNEL and calls forge::ft::compileText.
#
# It needs a built node-free kernel core. Point KERNEL_BUILD at one, or let this
# script configure and build one (slow the first time):
#
#   cmake -S forge-kernel -B <dir> -DCMAKE_BUILD_TYPE=Release \
#         -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
#   cmake --build <dir> -j2 --target forge_kernel_core
#
#   KERNEL_BUILD=<dir> bash forge-kernel/test/ft/build_arc_helix_compile_probe.sh
#
# JOBS defaults to 2, not to nproc: this machine is shared with a long-running
# evaluation, and a build that starves its neighbours is not faster overall.
#
# THE OCCT TOOLKITS ON THE LINK LINE BELOW ARE THIS PROBE'S, NOT THE KERNEL'S.
# The probe measures the helix wire directly -- BRepGProp::LinearProperties for
# arc length, BRepBndLib for the box -- and those symbols are not re-exported by
# libforge_kernel_core, so it names them itself. `forge-kernel/test/` is not in
# FORGE_KERNEL_SOURCES and CMakeLists.txt is untouched, so nothing here moves
# OCCT_DIRECT or OCCT_CLOSURE. Do not read this line as a ledger change.
#
# Exit 0 iff every closed-form observable matched and HELIX's value kind was
# observed to be WIRE.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
KERNEL="$(cd "$HERE/../.." && pwd)" || exit 2
KERNEL_BUILD="${KERNEL_BUILD:-$KERNEL/build-app}"

if [ ! -f "$KERNEL_BUILD/libforge_kernel_core.dylib" ] && \
   [ ! -f "$KERNEL_BUILD/libforge_kernel_core.so" ]; then
  echo "[arc-helix-probe] no forge_kernel_core in $KERNEL_BUILD"
  echo "[arc-helix-probe] configuring + building it (this is the slow first run)"
  cmake -S "$KERNEL" -B "$KERNEL_BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON || exit 2
  cmake --build "$KERNEL_BUILD" -j "${JOBS:-2}" --target forge_kernel_core || exit 2
fi

if [ -z "${OCCT_INC:-}" ]; then
  for _c in /opt/homebrew/include/opencascade \
            /opt/homebrew/opt/opencascade/include/opencascade \
            /usr/local/opt/opencascade/include/opencascade \
            /usr/include/opencascade \
            /usr/local/include/opencascade ; do
    [ -d "$_c" ] && { OCCT_INC="$_c"; break; }
  done
fi
OCCT_INC="${OCCT_INC:-}"
if [ -z "$OCCT_INC" ] || [ ! -d "$OCCT_INC" ]; then
  echo "OCCT headers not found. Set OCCT_INC=/path/to/include/opencascade" >&2
  exit 2
fi
OCCT_LIB="${OCCT_LIB:-$(dirname "$(dirname "$OCCT_INC")")/lib}"

CXX="${CXX:-clang++}"
BIN="$KERNEL_BUILD/arc_helix_compile_probe"

echo "[arc-helix-probe] compiling + linking against $KERNEL_BUILD"
"$CXX" -std=c++20 -O0 -g -Wall -Wextra \
    -I"$KERNEL/include" -I"$OCCT_INC" \
    "$HERE/arc_helix_compile_probe.cpp" -o "$BIN" \
    -L"$KERNEL_BUILD" -lforge_kernel_core \
    -L"$OCCT_LIB" -lTKernel -lTKMath -lTKBRep -lTKG3d -lTKTopAlgo -lTKGeomBase \
    -Wl,-rpath,"$KERNEL_BUILD" -Wl,-rpath,"$OCCT_LIB" || exit 2

echo
"$BIN"
rc=$?
echo
echo "exit=$rc"
exit $rc
