#!/usr/bin/env bash
# run_sparse_ordering_gate.sh — T-163: build + run test/sparse_ordering_gate.cpp
#
# Measures the SparseLDLT fill-reducing ordering (nnz(L), flops, compute time,
# residual, forward error, solution vs the shipped RCM arm) on the REAL
# stiffness/conductance matrices the production FEA solvers assemble (captured
# through the linalg observation seam), for Natural / RCM / AMD / nested
# dissection / the default (Auto), against — on Apple — Accelerate's own
# AMD/METIS as a TEST-ONLY reference. Assertions G1..G7: see the .cpp header.
#
# Needs a kernel build that produced libforge_kernel_core (configure with
# -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -DFORGE_BUILD_NODE_ADDON=OFF, build
# target forge_kernel_core).
#
#   KERNEL_BUILD=<dir with libforge_kernel_core.*>   (required)
#   OUT=<dir for the gate binaries>                   (default: $KERNEL_BUILD)
#   BASELINE_KERNEL_BUILD=<dir>  optional: a PRE-CHANGE libforge_kernel_core.
#        The same source is compiled with -DSOG_E2E_ONLY (public FEA API only)
#        and run against BOTH libraries first, printing the end-to-end
#        solveStatic/solveThermal wall-clock BEFORE and AFTER on the same
#        fixtures (SOG_E2E_REPS best-of, default 3).
#   SOG_FIXTURES / SOG_FLOP_BUDGET / SOG_REPS / SOG_JSON are passed through.
# Exit 0 iff the gate (and, if requested, both e2e runs) pass.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KROOT="$(cd "$HERE/.." && pwd)"
: "${KERNEL_BUILD:?set KERNEL_BUILD to the forge-kernel build dir containing libforge_kernel_core}"
KERNEL_BUILD="$(cd "$KERNEL_BUILD" && pwd)"
OUT="${OUT:-$KERNEL_BUILD}"
CXX="${CXX:-clang++}"

if ! ls "$KERNEL_BUILD"/libforge_kernel_core.* >/dev/null 2>&1; then
  echo "[sparse_ordering_gate] no libforge_kernel_core in $KERNEL_BUILD"; exit 2
fi

OCCT_PREFIX="${OCCT_PREFIX:-$( (brew --prefix opencascade 2>/dev/null) || echo /usr/local)}"
OCCT_INC="$OCCT_PREFIX/include/opencascade"
OCCT_LIB="$OCCT_PREFIX/lib"

build_one() {   # $1 = lib dir, $2 = output binary, $3.. = extra flags
  local lib="$1" bin="$2"; shift 2
  "$CXX" -std=c++20 -O2 -Wall -Wextra -Werror \
    -DFORGE_NATIVE_BREP=1 \
    -I "$KROOT/include" -I "$OCCT_INC" \
    "$HERE/sparse_ordering_gate.cpp" \
    -L "$lib" -lforge_kernel_core \
    -Wl,-rpath,"$lib" -Wl,-rpath,"$OCCT_LIB" -L "$OCCT_LIB" \
    "$@" -o "$bin"
}
run_one() {     # $1 = lib dir, $2 = binary
  DYLD_LIBRARY_PATH="$1:$OCCT_LIB${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" \
  LD_LIBRARY_PATH="$1:$OCCT_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$2"
}

rc=0
if [ -n "${BASELINE_KERNEL_BUILD:-}" ]; then
  BASELINE_KERNEL_BUILD="$(cd "$BASELINE_KERNEL_BUILD" && pwd)"
  export SOG_E2E_REPS="${SOG_E2E_REPS:-3}"
  build_one "$BASELINE_KERNEL_BUILD" "$OUT/sparse_ordering_e2e_before" -DSOG_E2E_ONLY
  build_one "$KERNEL_BUILD"          "$OUT/sparse_ordering_e2e_after"  -DSOG_E2E_ONLY
  echo "=============== E2E BEFORE ($BASELINE_KERNEL_BUILD) ==============="
  SOG_JSON= run_one "$BASELINE_KERNEL_BUILD" "$OUT/sparse_ordering_e2e_before" || rc=1
  echo "=============== E2E AFTER  ($KERNEL_BUILD) ==============="
  SOG_JSON= run_one "$KERNEL_BUILD" "$OUT/sparse_ordering_e2e_after" || rc=1
  unset SOG_E2E_REPS
fi

EXTRA=()
if [ "$(uname -s)" = "Darwin" ]; then
  # Accelerate is a SYSTEM framework, used here ONLY as a test-time reference
  # oracle (its own AMD/METIS fill + time); the library under test does not link it.
  EXTRA+=(-framework Accelerate)
fi
BIN="$OUT/sparse_ordering_gate"
build_one "$KERNEL_BUILD" "$BIN" "${EXTRA[@]}"
echo "[sparse_ordering_gate] built $BIN"
run_one "$KERNEL_BUILD" "$BIN" || rc=1
exit $rc
