#!/usr/bin/env bash
# Proves the OCCT ledger's ASSERTIONS FIRE. A ratchet that has never failed is an
# unverified ratchet -- test the hatch, not only the check.
#
# The ledger was ratcheted on forge-kernel.node and on nothing else, while the
# artifact package_macos.sh stages into Forge.app is libforge_kernel_core.dylib.
# MEASURED 2026-09-09: closure agreed at 14 on both, so the roadmap's headline
# number was right by COINCIDENCE, not by enforcement.
#
# Usage: occt_ledger_gate_fires.sh [KERNEL_BUILD_DIR]
set -uo pipefail
KROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${1:-$KROOT/build/Release}"
S="$KROOT/scripts/occt_closure_count.sh"
DYLIB="$BUILD/libforge_kernel_core.dylib"
NODE="$BUILD/forge-kernel.node"
PASS=0; FAIL=0; SKIP=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS  $1 (rc=$3)"; PASS=$((PASS+1));
       else echo "  FAIL  $1 (rc=$3, want $2)"; FAIL=$((FAIL+1)); fi; }
run(){ bash "$S" "$1" "${@:2}" >/dev/null 2>/tmp/occt_gate_err.$$; echo $?; }

echo "== the shipped artifact is gated at its measured ceilings =="
if [ -f "$DYLIB" ]; then
  chk "dylib passes closure 14 / direct 11 / no-phantom" 0 \
      "$(run "$DYLIB" --assert-closure 14 --assert-direct 11 --assert-no-phantom)"
  echo "== NEGATIVE CONTROLS: each assertion must actually reject =="
  chk "closure ceiling 13 rejects closure=14" 1 "$(run "$DYLIB" --assert-closure 13)"
  chk "direct ceiling 10 rejects direct=11"   1 "$(run "$DYLIB" --assert-direct 10)"
  chk "dylib (PHANTOM=0) accepted by --assert-no-phantom" 0 "$(run "$DYLIB" --assert-no-phantom)"
else
  # FAIL CLOSED. The dylib is the artifact Forge.app ships; if it is missing the
  # gate has measured nothing, and a skip that exits 0 reads exactly like a pass.
  # An absent instrument is not evidence.
  echo "  FAIL  $DYLIB absent -- the SHIPPED artifact must exist for this gate to mean anything"
  FAIL=$((FAIL+1))
fi

echo "== --assert-no-phantom is not a no-op =="
if [ -f "$NODE" ]; then
  # The .node links -undefined dynamic_lookup, so it CALLS TKBO and TKG2d with no
  # link record at all: PHANTOM=2. That makes it the positive control proving the
  # flag can reject something.
  chk ".node (PHANTOM=2) rejected by --assert-no-phantom" 1 "$(run "$NODE" --assert-no-phantom)"
  chk ".node still passes its own pre-existing ceilings" 0 \
      "$(run "$NODE" --assert-closure 14 --assert-direct 9)"
else
  echo "  SKIP  $NODE absent (node addon is OFF in this configure)"; SKIP=$((SKIP+1))
fi

rm -f /tmp/occt_gate_err.$$
echo
echo "RESULT: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
