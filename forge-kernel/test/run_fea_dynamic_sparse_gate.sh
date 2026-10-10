#!/usr/bin/env bash
# run_fea_dynamic_sparse_gate.sh — T-286: build + run test/fea_dynamic_sparse_gate.cpp
#
# solveDynamic must assemble its Rayleigh damping C and Newmark operator A as
# SPARSE linear combinations (no n x n densify) with an unchanged answer.
#
#   KERNEL_BUILD=<dir with libforge_kernel_core.*>   (required; configure with
#        -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -DFORGE_BUILD_NODE_ADDON=OFF,
#        build target forge_kernel_core)
#   OUT=<dir for binaries and dumps>                  (default: $KERNEL_BUILD)
#   BASELINE_KERNEL_BUILD=<dir>  optional: a PRE-CHANGE libforge_kernel_core.
#        The same gate source is linked against it; the A/B fixtures are run on
#        BOTH libraries and compared (D1..D3), and the BEFORE peak memory/time
#        is printed for FDS_BEFORE_RSS (default b2k,b6k,b11k — the dense path
#        needs 3 x 8n^2 bytes, so keep this list to sizes that fit).
#   FDS_RSS=<fixtures>   AFTER memory fixtures, asserted
#        (default b2k,b6k,b11k,b21k,bracketM,bracketM:c; ":c" = consistent mass)
#
# Checks: A3 (static) no toDense() inside solveDynamic in src/Fea.cpp;
#         closedform CF1..CF4; rss M1..M3; with a baseline, compare D1..D3.
# Exit 0 iff every check passes.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KROOT="$(cd "$HERE/.." && pwd)"
: "${KERNEL_BUILD:?set KERNEL_BUILD to the forge-kernel build dir containing libforge_kernel_core}"
KERNEL_BUILD="$(cd "$KERNEL_BUILD" && pwd)"
OUT="${OUT:-$KERNEL_BUILD}"
mkdir -p "$OUT"
CXX="${CXX:-clang++}"

if ! ls "$KERNEL_BUILD"/libforge_kernel_core.* >/dev/null 2>&1; then
  echo "[fea_dynamic_sparse_gate] no libforge_kernel_core in $KERNEL_BUILD"; exit 2
fi
OCCT_PREFIX="${OCCT_PREFIX:-$( (brew --prefix opencascade 2>/dev/null) || echo /usr/local)}"
OCCT_INC="$OCCT_PREFIX/include/opencascade"
OCCT_LIB="$OCCT_PREFIX/lib"

build_one() {   # $1 = lib dir, $2 = output binary
  "$CXX" -std=c++20 -O2 -Wall -Wextra -Werror \
    -DFORGE_NATIVE_BREP=1 \
    -I "$KROOT/include" -I "$OCCT_INC" \
    "$HERE/fea_dynamic_sparse_gate.cpp" \
    -L "$1" -lforge_kernel_core \
    -Wl,-rpath,"$1" -Wl,-rpath,"$OCCT_LIB" -L "$OCCT_LIB" \
    -o "$2"
}
run_one() {     # $1 = lib dir, $2 = binary, $3.. = args
  local lib="$1" bin="$2"; shift 2
  DYLD_LIBRARY_PATH="$lib:$OCCT_LIB${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" \
  LD_LIBRARY_PATH="$lib:$OCCT_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$bin" "$@"
}

rc=0
# ---- A3: the Newmark operator assembly path holds no densify ----------------
# Body of the options overload of solveDynamic (the one every entry forwards to).
BODY="$(awk '/^DynamicResult solveDynamic\(/{n++} n==2{print} n==2 && /^}/{exit}' "$KROOT/src/Fea.cpp")"
NDENSE="$(printf '%s\n' "$BODY" | grep -c 'toDense' || true)"
if [ -n "$BODY" ] && [ "$NDENSE" = "0" ]; then
  echo "  [PASS] A3 solveDynamic body ($(printf '%s\n' "$BODY" | wc -l | tr -d ' ') lines) has 0 toDense() calls"
else
  echo "  [FAIL] A3 solveDynamic body has $NDENSE toDense() calls (body found: $([ -n "$BODY" ] && echo yes || echo no))"
  rc=1
fi

BIN="$OUT/fea_dynamic_sparse_gate"
build_one "$KERNEL_BUILD" "$BIN"
echo "[fea_dynamic_sparse_gate] built $BIN"

if [ -n "${BASELINE_KERNEL_BUILD:-}" ]; then
  BASELINE_KERNEL_BUILD="$(cd "$BASELINE_KERNEL_BUILD" && pwd)"
  BBIN="$OUT/fea_dynamic_sparse_gate_before"
  build_one "$BASELINE_KERNEL_BUILD" "$BBIN"
  echo "=============== A/B BEFORE ($BASELINE_KERNEL_BUILD) ==============="
  run_one "$BASELINE_KERNEL_BUILD" "$BBIN" ab "$OUT/fds_ab_before.bin" || rc=1
  echo "=============== A/B AFTER  ($KERNEL_BUILD) ==============="
  run_one "$KERNEL_BUILD" "$BIN" ab "$OUT/fds_ab_after.bin" || rc=1
  echo "=============== COMPARE before vs after ==============="
  run_one "$KERNEL_BUILD" "$BIN" compare "$OUT/fds_ab_before.bin" "$OUT/fds_ab_after.bin" || rc=1
  echo "=============== MEMORY BEFORE (report only) ==============="
  run_one "$BASELINE_KERNEL_BUILD" "$BBIN" rss-report "${FDS_BEFORE_RSS:-b2k,b6k,b11k}" || true
fi

echo "=============== CLOSED FORM ($KERNEL_BUILD) ==============="
run_one "$KERNEL_BUILD" "$BIN" closedform || rc=1
echo "=============== MEMORY AFTER (asserted) ==============="
run_one "$KERNEL_BUILD" "$BIN" rss "${FDS_RSS:-b2k,b6k,b11k,b21k,bracketM,bracketM:c}" || rc=1

echo "[fea_dynamic_sparse_gate] $([ $rc = 0 ] && echo PASS || echo FAIL)"
exit $rc
