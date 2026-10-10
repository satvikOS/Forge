#!/usr/bin/env bash
# run_linalg_accelerate_gate.sh — T-157: build + run test/linalg_accelerate_gate.cpp
#
# The sparse SPD solver (la::SparseLDLT) factors supernodally through a native
# dense-kernel seam (POTRF/TRSM/SYRK: native loops, Apple Accelerate above the
# measured crossover). This script measures it against the up-looking oracle on
# the production FEA matrices (A1, A3, A4), end to end against a pre-change
# library on the same fixtures and command (A2, A3), and checks the link
# surface (A5).
#
#   KERNEL_BUILD=<dir with libforge_kernel_core.*>   (required; the build under
#        test: -DFORGE_BUILD_DESKTOP_FOUNDATION=ON -DFORGE_BUILD_NODE_ADDON=OFF)
#   OUT=<dir for binaries/dumps>                      (default: $KERNEL_BUILD)
#   BASELINE_KERNEL_BUILD=<dir>  optional: a PRE-CHANGE libforge_kernel_core.
#        The e2e mode (public FEA API only, compiled -DLAG_E2E_ONLY) runs against
#        BOTH libraries: wall-clocks BEFORE/AFTER, output A/B (compare, D1/D2),
#        S1 speed: solveStatic on bracketM and tube AFTER <= LAG_E2E_RATIO x
#        BEFORE (LAG_E2E_RATIO, default 0.6 when the library under test links
#        Accelerate, else LAG_E2E_RATIO_NATIVE, default 0.8), and A5 (link
#        surface + OCCT symbols unchanged).
#   NATIVE_KERNEL_BUILD=<dir>    optional: a -DFORGE_LINALG_ACCELERATE=OFF build;
#        the gate also runs against it (portable path, native speed bound).
#   LAG_SKIP_GATE=1              run only the e2e / A5 part (no gate mode).
#   LAG_FIXTURES / LAG_REPS / LAG_JSON are passed through.
# Exit 0 iff every check passes.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KROOT="$(cd "$HERE/.." && pwd)"
: "${KERNEL_BUILD:?set KERNEL_BUILD to the forge-kernel build dir containing libforge_kernel_core}"
KERNEL_BUILD="$(cd "$KERNEL_BUILD" && pwd)"
OUT="${OUT:-$KERNEL_BUILD}"
mkdir -p "$OUT"
CXX="${CXX:-clang++}"
OCCT_PREFIX="${OCCT_PREFIX:-$( (brew --prefix opencascade 2>/dev/null) || echo /usr/local)}"
OCCT_INC="$OCCT_PREFIX/include/opencascade"
OCCT_LIB="$OCCT_PREFIX/lib"
lib_of() { ls "$1"/libforge_kernel_core.* 2>/dev/null | head -1; }
[ -n "$(lib_of "$KERNEL_BUILD")" ] || { echo "[linalg_accelerate_gate] no libforge_kernel_core in $KERNEL_BUILD"; exit 2; }

build_one() {   # $1 = lib dir, $2 = output binary, $3.. extra flags
  local lib="$1" bin="$2"; shift 2
  "$CXX" -std=c++20 -O2 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
    -I "$KROOT/include" -I "$OCCT_INC" "$HERE/linalg_accelerate_gate.cpp" \
    -L "$lib" -lforge_kernel_core -Wl,-rpath,"$lib" -Wl,-rpath,"$OCCT_LIB" -L "$OCCT_LIB" \
    "$@" -o "$bin"
}
run_one() {     # $1 = lib dir, $2 = binary, $3.. = args
  local lib="$1" bin="$2"; shift 2
  DYLD_LIBRARY_PATH="$lib:$OCCT_LIB${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" \
  LD_LIBRARY_PATH="$lib:$OCCT_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$bin" "$@"
}

rc=0
BIN="$OUT/linalg_accelerate_gate"

if [ -n "${BASELINE_KERNEL_BUILD:-}" ]; then
  BASELINE_KERNEL_BUILD="$(cd "$BASELINE_KERNEL_BUILD" && pwd)"
  build_one "$BASELINE_KERNEL_BUILD" "$OUT/lag_e2e_before" -DLAG_E2E_ONLY
  build_one "$KERNEL_BUILD"          "$OUT/lag_e2e_after"  -DLAG_E2E_ONLY
  echo "=============== E2E BEFORE ($BASELINE_KERNEL_BUILD) ==============="
  run_one "$BASELINE_KERNEL_BUILD" "$OUT/lag_e2e_before" e2e "$OUT/lag_e2e_before.bin" || rc=1
  echo "=============== E2E AFTER  ($KERNEL_BUILD) ==============="
  run_one "$KERNEL_BUILD" "$OUT/lag_e2e_after" e2e "$OUT/lag_e2e_after.bin" || rc=1
  echo "=============== E2E OUTPUT A/B + TIMES ==============="
  CMP="$(run_one "$KERNEL_BUILD" "$OUT/lag_e2e_after" compare "$OUT/lag_e2e_before.bin" "$OUT/lag_e2e_after.bin")" || rc=1
  printf '%s\n' "$CMP"
  if nm -u "$(lib_of "$KERNEL_BUILD")" | grep -q 'cblas_dsyrk'; then
    RATIO="${LAG_E2E_RATIO:-0.6}"
  else
    RATIO="${LAG_E2E_RATIO_NATIVE:-0.8}"
  fi
  for fx in bracketM tube; do
    line="$(printf '%s\n' "$CMP" | grep " $fx/time.static " || true)"
    if [ -z "$line" ]; then echo "  [FAIL] S1 no e2e time for $fx"; rc=1; continue; fi
    b="$(printf '%s\n' "$line" | awk '{print $3}')"; a="$(printf '%s\n' "$line" | awk '{print $6}')"
    if awk -v a="$a" -v b="$b" -v r="$RATIO" 'BEGIN{exit !(a <= r*b)}'; then
      echo "  [PASS] S1 solveStatic $fx end to end: $b s -> $a s (<= $RATIO x before)"
    else
      echo "  [FAIL] S1 solveStatic $fx end to end: $b s -> $a s (> $RATIO x before)"; rc=1
    fi
  done

  echo "=============== A5 LINK SURFACE (before vs after) ==============="
  LB="$(lib_of "$BASELINE_KERNEL_BUILD")"; LA="$(lib_of "$KERNEL_BUILD")"
  deps() { otool -L "$1" | sed 1,2d | awk '{print $1}' | sort; }
  NEW="$(comm -13 <(deps "$LB") <(deps "$LA"))"
  echo "  new load commands: ${NEW:-(none)}"
  if [ -z "$NEW" ] || [ "$NEW" = "/System/Library/Frameworks/Accelerate.framework/Versions/A/Accelerate" ]; then
    echo "  [PASS] A5 the only new link is the Accelerate SYSTEM framework (or none)"
  else
    echo "  [FAIL] A5 unexpected new link(s): $NEW"; rc=1
  fi
  # OCCT closure / direct links / undefined OCCT symbols by toolkit, before vs after
  CB="$(bash "$KROOT/scripts/occt_closure_count.sh" "$LB" --symbols --json --quiet 2>&1 | sed -E 's/"binary":"[^"]*",//' | tr -d '\n' || true)"
  CA="$(bash "$KROOT/scripts/occt_closure_count.sh" "$LA" --symbols --json --quiet 2>&1 | sed -E 's/"binary":"[^"]*",//' | tr -d '\n' || true)"
  echo "  occt_closure_count --symbols before: $CB"
  echo "  occt_closure_count --symbols after:  $CA"
  if [ -n "$CB" ] && [ "$CB" = "$CA" ]; then
    echo "  [PASS] A5 OCCT closure, direct links and undefined OCCT symbols unchanged"
  else
    echo "  [FAIL] A5 OCCT closure/symbols differ"; rc=1
  fi
  # The Node addon compiles LinAlg.cpp WITHOUT FORGE_LINALG_ACCELERATE (the CMake
  # define is on forge_kernel_core only): that object must reference no Accelerate
  # symbol and no OCCT symbol.
  OBJ="$OUT/LinAlg_addon_flags.o"
  "$CXX" -std=c++20 -O2 -I "$KROOT/include" -c "$KROOT/src/native/linalg/LinAlg.cpp" -o "$OBJ"
  NACC="$(nm -u "$OBJ" | grep -cE 'cblas_|dpotrf|LAPACK' || true)"
  NOCC="$(nm -u "$OBJ" | grep -cE '__ZN[0-9]+(BRep|Geom|TopoDS|gp_|Standard_)' || true)"
  if [ "$NACC" = "0" ] && [ "$NOCC" = "0" ]; then
    echo "  [PASS] A5 LinAlg.o as the addon compiles it: 0 Accelerate, 0 OCCT undefined symbols"
  else
    echo "  [FAIL] A5 LinAlg.o (addon flags): $NACC Accelerate, $NOCC OCCT undefined symbols"; rc=1
  fi
fi

if [ "${LAG_SKIP_GATE:-0}" != "1" ]; then
  build_one "$KERNEL_BUILD" "$BIN"
  echo "=============== GATE ($KERNEL_BUILD) ==============="
  run_one "$KERNEL_BUILD" "$BIN" gate || rc=1
fi

if [ -n "${NATIVE_KERNEL_BUILD:-}" ] && [ "${LAG_SKIP_GATE:-0}" != "1" ]; then
  NATIVE_KERNEL_BUILD="$(cd "$NATIVE_KERNEL_BUILD" && pwd)"
  build_one "$NATIVE_KERNEL_BUILD" "$OUT/linalg_accelerate_gate_native"
  echo "=============== GATE, NATIVE-ONLY BUILD ($NATIVE_KERNEL_BUILD) ==============="
  run_one "$NATIVE_KERNEL_BUILD" "$OUT/linalg_accelerate_gate_native" gate || rc=1
fi

echo "[linalg_accelerate_gate] $([ $rc = 0 ] && echo PASS || echo FAIL)"
exit $rc
