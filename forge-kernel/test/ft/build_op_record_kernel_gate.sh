#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build_op_record_kernel_gate.sh — T-132: op records against the REAL kernel.
#
# Compiles op_record_kernel_gate.cpp against the node-free kernel core in
# $KERNEL_BUILD (default <repo>/build-k; build it with
#   cmake -S forge-kernel -B <dir> -DCMAKE_BUILD_TYPE=Release \
#         -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
#   cmake --build <dir> --target forge_kernel_core)
# with the same defines forge_verify is compiled with, -Wall -Wextra -Werror, and
# runs it. Exit 0 iff every check passes; a missing kernel library is exit 3,
# never a skip.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
KERNEL="$(cd "$HERE/../.." && pwd)" || exit 2
KB="${KERNEL_BUILD:-$KERNEL/../build-k}"
case "$KB" in /*) ;; *) KB="$(pwd)/$KB" ;; esac
LIB="$KB/libforge_kernel_core.dylib"
[ -e "$LIB" ] || LIB="$KB/libforge_kernel_core.so"
if [ ! -e "$LIB" ]; then
  echo "[op-record-kernel] no libforge_kernel_core in $KB -- build forge_kernel_core first. RED."
  exit 3
fi
OCCT="${OCCT_ROOT:-$(brew --prefix opencascade 2>/dev/null || echo /opt/homebrew/opt/opencascade)}"
OUT="${OUT:-$KB}"
CXX="${CXX:-clang++}"
# forge_verify's compile definitions (build-k/CMakeFiles/forge_verify.dir/flags.make):
# the kernel headers change shape under FORGE_NATIVE_BREP, so a consumer compiled
# without the library's defines would be reading a different ABI.
DEFS=(-DFORGE_NATIVE_BREP=1 -DFORGE_NATIVE_LAW=1 -DFORGE_NATIVE_NURBS_CONVERT=1
      -DFORGE_NATIVE_PROJECTION=1 -DFORGE_SHHEAL_DROP_NATIVE=1 -DFORGE_THICKEN_DROP_NATIVE=1
      -DFORGE_THICKSOLID_DROP_NATIVE=1)
echo "[1/2] compile + link op_record_kernel_gate against $LIB (-Werror)"
"$CXX" -std=c++20 -O1 -Wall -Wextra -Werror "${DEFS[@]}" \
    -I"$KERNEL/include" -I"$OCCT/include/opencascade" \
    "$HERE/op_record_kernel_gate.cpp" -o "$OUT/op_record_kernel_gate" \
    "$LIB" -Wl,-rpath,"$KB" -Wl,-rpath,"$OCCT/lib" || exit 2
echo "[2/2] run"
echo
"$OUT/op_record_kernel_gate"
rc=$?
echo
echo "exit=$rc"
exit $rc
