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
run(){ bash "$S" "$1" "${@:2}" >/tmp/occt_gate_out.$$ 2>/tmp/occt_gate_err.$$; echo $?; }

# ── THE SHIPPED DYLIB'S OCCT SYMBOL CEILING (T-291) ──────────────────────────
# Until this line the only --assert-symbols in CI ran on forge-kernel.node, in the
# Node 'kernel' job; the dylib Forge.app ships had closure/direct/phantom ceilings
# here and NO symbol count, so any number of new OCCT calls could land in it green
# as long as they came from toolkits already linked. OCCT_SYMBOLS is the
# fine-grained ledger (closure is a 14-step ladder; symbols move per call site).
#
# MEASURED 2026-10-10 on a Release FORGE_BUILD_NODE_ADDON=OFF
# FORGE_BUILD_DESKTOP_FOUNDATION=ON build of forge_kernel_core (kernel sources ==
# origin/archdisc b609b41d), Homebrew opencascade 7.9.3, with
#   bash forge-kernel/scripts/occt_closure_count.sh <build>/libforge_kernel_core.dylib --symbols
#   -> OCCT_SYMBOLS=503 DIRECT=10 CLOSURE=14 PHANTOM=0
# The ceiling is that measurement, not a target. It is checked in BOTH directions
# below: 503 must pass and 502 must reject, so this goes red if the dylib GAINS a
# symbol and also if it LOSES one without the ceiling being lowered in the same
# change -- a ceiling above the measurement is slack, and slack in a ratchet is a
# regression of that size landing green (T-144, T-167).
# ★ This governs the DYLIB only. The .node's 507 in the Node job is a different
#   artifact (they diverged at T-146: addon 532 vs dylib 539) and stays T-167's.
SYMBOLS_CEILING=503

echo "== the shipped artifact is gated at its measured ceilings =="
if [ -f "$DYLIB" ]; then
  # DIRECT 11 -> 10 when TKPrim left the link line (it named a library nothing calls:
  # BRepPrimAPI stopped being called on 2026-08-07). The ceiling is RETIGHTENED to the
  # new measured value rather than left at 11 -- a ratchet that keeps the old ceiling
  # after the number improves silently permits giving the gain back. CLOSURE stays 14:
  # TKPrim still loads transitively via TKBO/TKBool/TKFillet/TKOffset, exactly as the
  # removed note predicted, and PHANTOM stays 0 -- the load-bearing check that dropping
  # the record did not unmask a real call.
  chk "dylib passes closure 14 / direct 10 / no-phantom / symbols $SYMBOLS_CEILING" 0 \
      "$(run "$DYLIB" --assert-closure 14 --assert-direct 10 --assert-no-phantom \
                      --assert-symbols "$SYMBOLS_CEILING")"
  # The measured number, printed on every run, so a red here names the count it saw.
  grep -E 'OCCT_SYMBOLS' /tmp/occt_gate_out.$$ | sed 's/^ */  measured: /' || true
  cat /tmp/occt_gate_err.$$ 2>/dev/null | sed 's/^/  /'
  echo "== NEGATIVE CONTROLS: each assertion must actually reject =="
  chk "closure ceiling 13 rejects closure=14" 1 "$(run "$DYLIB" --assert-closure 13)"
  chk "direct ceiling 9 rejects direct=10"    1 "$(run "$DYLIB" --assert-direct 9)"
  # Fails if the dylib carries FEWER than SYMBOLS_CEILING symbols: the ceiling must
  # then be lowered to the new measurement in the same change.
  chk "symbol ceiling $((SYMBOLS_CEILING-1)) rejects the dylib (no slack under $SYMBOLS_CEILING)" 1 \
      "$(run "$DYLIB" --assert-symbols "$((SYMBOLS_CEILING-1))")"
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

rm -f /tmp/occt_gate_err.$$ /tmp/occt_gate_out.$$
echo
echo "RESULT: $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
