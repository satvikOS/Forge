#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_surface_compile_probe.sh — the SURFACE value kind ACTUALLY BUILT.
#
# Unlike its two siblings this one LINKS THE WHOLE KERNEL and runs
# forge::ft::compileText, so the surface ops produce real geometry and the
# tolerance contract is OBSERVED rather than asserted about. That is what it is
# for: the first version of forge::surf::facesOf read an empty index list as
# "every face", so `FACES(%body, "bore:r=99999")` on a 6-face box returned all
# SIX faces and THICKEN built a 5587 mm^3 body out of them. Every headless gate
# was green. Only running it found that.
#
# It needs a built node-free kernel core. Point KERNEL_BUILD at one, or let this
# script configure and build one (which takes a while the first time):
#
#   cmake -S forge-kernel -B <dir> -DCMAKE_BUILD_TYPE=Release \
#         -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
#   cmake --build <dir> -j3 --target forge_kernel_core
#
#   KERNEL_BUILD=<dir> bash forge-kernel/test/ft/build_surface_compile_probe.sh
#
# Exit 0 iff every invariant the value kind depends on held on real geometry.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
KERNEL="$(cd "$HERE/../.." && pwd)" || exit 2
KERNEL_BUILD="${KERNEL_BUILD:-$KERNEL/build-app}"

if [ ! -f "$KERNEL_BUILD/libforge_kernel_core.dylib" ] && \
   [ ! -f "$KERNEL_BUILD/libforge_kernel_core.so" ]; then
  echo "[surface-probe] no forge_kernel_core in $KERNEL_BUILD"
  echo "[surface-probe] configuring + building it (this is the slow first run)"
  cmake -S "$KERNEL" -B "$KERNEL_BUILD" -DCMAKE_BUILD_TYPE=Release \
        -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON || exit 2
  # -j3 on purpose: this machine is shared, and a build that starves its
  # neighbours is not faster overall.
  cmake --build "$KERNEL_BUILD" -j "${JOBS:-3}" --target forge_kernel_core || exit 2
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
BIN="$KERNEL_BUILD/surface_compile_probe"

echo "[surface-probe] compiling + linking against $KERNEL_BUILD"
"$CXX" -std=c++20 -O0 -g -Wall -Wextra \
    -I"$KERNEL/include" -I"$OCCT_INC" \
    "$HERE/surface_compile_probe.cpp" -o "$BIN" \
    -L"$KERNEL_BUILD" -lforge_kernel_core \
    -Wl,-rpath,"$KERNEL_BUILD" -Wl,-rpath,"$OCCT_LIB" || exit 2

echo
"$BIN"
rc=$?
echo
echo "exit=$rc"
exit $rc
