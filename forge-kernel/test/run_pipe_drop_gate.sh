#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_pipe_drop_gate.sh — the END-TO-END flip gate for TKOffset family E
# (FORGE_PIPE_DROP_NATIVE / BRepOffsetAPI_MakePipe), in one command.
#
# WHY THIS EXISTS. The pieces of this gate already existed and were never run
# together, so the one thing nobody had shown was the thing that matters: that a
# kernel built with the option ON LINKS, LOSES THE THREE OCCT SYMBOLS, and still
# returns the right solid from the shipped entry points. Each step below is a
# measurement, and each prints its number.
#
#   1. build the kernel twice from ONE tree — option OFF, then option ON.
#      ★ The variant script reconfigures forge-kernel/build IN PLACE, so the two
#        binaries MUST be copied aside under labels. Comparing "baseline" at
#        build/Release/forge-kernel.node against a variant built afterwards is
#        comparing a binary to ITSELF — that mistake was made here on 2026-09-02
#        and caught only because both arms reported the identical error string.
#   2. nm the two: exactly BRepOffsetAPI_MakePipe's ctor, Build and vtable must
#      leave, nothing may arrive, and the TKOffset total must fall by 3.
#   3. scripts/occt_closure_count.sh on the ON build. It will say 14 and that is
#      the CORRECT and EXPECTED answer: CMakeLists removes TKOffset from
#      OCCT_LIBS only when ALL NINE families are compiled out, and family E is
#      one. A drop that moves symbols and not the closure is worth ZERO on the
#      ledger, and this gate says so rather than hiding it.
#   4. the positive control against the ON build — the OCCT class is not in that
#      binary, so any solid it returns came from the native engine.
#   5. the capability census against BOTH builds. The diff of the two columns is
#      what the drop actually changes, measured rather than argued.
#
# usage: bash forge-kernel/test/run_pipe_drop_gate.sh
#   env: FORGE_BUILD_PAR (default 2 — this box runs several agents)
#        OUTDIR (default forge-kernel/.build-pipe-drop-gate)
# exit: 0 iff the symbol delta is exactly the three and the positive control passes.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTDIR="${OUTDIR:-$ROOT/forge-kernel/.build-pipe-drop-gate}"
export TKDROP_OUTDIR="$OUTDIR"
export FORGE_BUILD_PAR="${FORGE_BUILD_PAR:-2}"
OCCT_LIB="${OCCT_LIB_DIR:-/opt/homebrew/opt/opencascade/lib}"
mkdir -p "$OUTDIR" || exit 2
RC=0

echo "== 1. build both variants from one tree =="
bash "$ROOT/forge-kernel/scripts/tkdrop_build_baseline.sh" >"$OUTDIR/configure.log" 2>&1 || {
  echo "FATAL: initial configure/build failed"; tail -20 "$OUTDIR/configure.log"; exit 2; }
for v in "OFF" "ON"; do
  bash "$ROOT/forge-kernel/scripts/tkdrop_build_variant.sh" "pipe$v" \
       "-DFORGE_PIPE_DROP_NATIVE=$v" || { echo "FATAL: build $v failed"; exit 2; }
done
BOFF="$OUTDIR/forge-kernel.pipeOFF.node"
BON="$OUTDIR/forge-kernel.pipeON.node"

echo
echo "== 2. TKOffset symbol delta =="
nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null \
  | awk 'NF>=3{print $3} NF==2{print $2}' | sort -u > "$OUTDIR/tko.exports"
for b in "$BOFF" "$BON"; do
  nm -u "$b" 2>/dev/null | sed 's/^ *//' | sort -u > "$b.undef"
  comm -12 "$b.undef" "$OUTDIR/tko.exports" > "$b.tko"
done
NOFF=$(grep -c . "$BOFF.tko"); NON=$(grep -c . "$BON.tko")
echo "  TKOffset symbols  OFF=$NOFF  ON=$NON  (delta $((NOFF - NON)))"
echo "  REMOVED:"; comm -23 "$BOFF.tko" "$BON.tko" | c++filt | sed 's/^/    /'
ADDED=$(comm -13 "$BOFF.tko" "$BON.tko")
if [ -n "$ADDED" ]; then echo "  FAIL — symbols ADDED by the drop:"; printf '%s\n' "$ADDED" | c++filt | sed 's/^/    /'; RC=1; fi
[ "$((NOFF - NON))" -eq 3 ] || { echo "  FAIL — expected exactly 3 symbols to leave, got $((NOFF - NON))"; RC=1; }
if c++filt < "$BON.tko" | grep -q 'BRepOffsetAPI_MakePipe::'; then
  echo "  FAIL — BRepOffsetAPI_MakePipe is STILL referenced by the ON build"; RC=1
else
  echo "  BRepOffsetAPI_MakePipe: fully absent from the ON build"
fi

echo
echo "== 3. THE LEDGER (expected: unchanged at 14 — family E is 1 of 9) =="
bash "$ROOT/forge-kernel/scripts/occt_closure_count.sh" "$BON" | sed -n '1,7p'
bash "$ROOT/forge-kernel/scripts/tkoffset_ledger_gate.sh" "$BON" --max-tkoffset "$NOFF" | tail -6 || RC=1

echo
echo "== 4. positive control against the ON build =="
node "$ROOT/forge-kernel/test/pipe_drop_positive_control.js" "$BON" || RC=1

echo
echo "== 5. capability census, both arms =="
node "$ROOT/forge-kernel/test/pipe_drop_capability_census.js" "$BOFF" "OCCT-OFF"
node "$ROOT/forge-kernel/test/pipe_drop_capability_census.js" "$BON"  "DROP-ON"

echo
[ "$RC" -eq 0 ] && echo "run_pipe_drop_gate: PASS" || echo "run_pipe_drop_gate: FAIL"
exit "$RC"
