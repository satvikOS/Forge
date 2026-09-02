#!/usr/bin/env bash
# forge_verify_instrument_gate.sh -- A VERIFIER THAT DIES IS ITS OWN OUTCOME.
#
# THE DEFECT, MEASURED 2026-09-01 on a completed 600-row self-consistency run.
# Seven of the 600 emissions carried a zero-axis ROTATE -- `ROTATE(%2, 0, 0, 0,
# 0, 0, 30)` and kin. gp_Dir(0,0,0) RAISES Standard_ConstructionError, which does
# not derive from std::exception, so main's `catch (const std::exception&)` never
# matched: __cxa_throw -> failed_throw -> std::terminate -> abort. forge_verify
# died seven times, said nothing on the way out, and the harness wrote down, for
# all seven rows, "the tree does not compile: verifier produced no output".
#
# That sentence is a claim about the MODEL'S OUTPUT, and for those seven rows
# nothing had established it. Worse, it is SILENT contamination: eight of the
# nine rows lost to the instrument that day emitted a VERIFY op, so they sat in
# the self-inconsistency DENOMINATOR while unable to reach its numerator, and the
# published rate was too LOW by 1.6 points (89.7% over 455 rows -> 91.3% over the
# 447 actually measured).
#
# WHAT THIS GATE CHECKS, against the real binary:
#   1. A zero-axis ROTATE is now an ordinary per-op ERROR that names the op. It
#      is a verdict on the TREE, correctly attributed, and the batch survives it.
#   2. When the tool DOES die, it emits an `instrument` record naming the row --
#      at the point where the process exits, not wherever a harness notices the
#      silence. That record is what makes the count reconcile against the OS
#      crash reports; without it a crash leaves a hole no one can size.
#   3. An `instrument` record is never produced for a healthy row (the negative
#      control: a gate that fires on everything measures nothing).
#
# Exit codes
#   0  GREEN
#   1  RED  -- a death produced no record, a survivable fault killed the batch,
#              or a healthy row was slandered
#   3  RED  -- the binary could not be established. A check that could not run is
#              not a check that passed.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

BIN="${FORGE_VERIFY_BIN:-}"
if [ -z "$BIN" ]; then
  for cand in "$ROOT/forge-kernel/build/forge_verify" \
              "$ROOT/forge-kernel/build-verify/forge_verify" \
              "$ROOT/forge-kernel/build-app/forge_verify" \
              "$ROOT/forge-kernel/build/Release/forge_verify"; do
    [ -x "$cand" ] && { BIN="$cand"; break; }
  done
fi
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "[fv-instrument] forge_verify not found (set FORGE_VERIFY_BIN). Refusing to guess. RED."
  exit 3
fi
echo "[fv-instrument] binary: $BIN"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/fv_instr.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
IN="$TMP/in.jsonl"

# r1 and r3 are ordinary, buildable rows; r2 is the zero-axis ROTATE that used to
# abort. Its NEIGHBOURS are the point: a crash on r2 used to cost r3 as well.
{
  printf '%s\n' '{"id":"r1","ir":"%1 = BOX(10,10,10)\nRESULT(%1)"}'
  printf '%s\n' '{"id":"r2","ir":"%1 = BOX(10,10,10)\n%2 = ROTATE(%1, 0, 0, 0, 0, 0, 30)\nRESULT(%2)"}'
  printf '%s\n' '{"id":"r3","ir":"%1 = BOX(20,20,20)\nRESULT(%1)"}'
} > "$IN"

fail=0
pass() { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }
check(){ if [ "$1" = "true" ]; then pass "$2"; else bad "$2"; fi; }
rec()  { grep -F "\"id\":\"$2\"" "$1" | head -1; }
present() { [ -n "$(rec "$1" "$2")" ] && echo true || echo false; }
holds() { case "$(rec "$1" "$2")" in *"$3"*) echo true;; *) echo false;; esac; }

# ---- case 1: the real defect. A zero axis is the TREE's problem, and is now
# reported as one -- with the batch intact. -----------------------------------
echo "[case 1] zero-axis ROTATE: a per-op verdict, not a corpse"
OUT="$TMP/out1.jsonl"; ERR="$TMP/err1.log"
"$BIN" < "$IN" > "$OUT" 2>"$ERR"; rc=$?
n=$(grep -c '^{' "$OUT" 2>/dev/null); [ -z "$n" ] && n=0
check "$([ "$rc" -eq 0 ] && echo true || echo false)" "the process exits cleanly (rc=$rc)"
check "$([ "$n" -eq 3 ] && echo true || echo false)"  "all three rows answered ($n/3)"
check "$(holds "$OUT" r2 '"ok":false')" "the zero-axis row FAILS"
check "$(holds "$OUT" r2 'ROTATE')"     "...and the error names the op that did it"
check "$(holds "$OUT" r2 'axis')"       "...and says the axis is the problem"
case "$(rec "$OUT" r2)" in
  *'"instrument"'*) bad "the zero-axis row is a TREE verdict, not an instrument failure";;
  *)                pass "the zero-axis row is a TREE verdict, not an instrument failure";;
esac
check "$(holds "$OUT" r3 '"ok":true')"  "the row AFTER it still builds (no collateral loss)"

# ---- case 2: a survivable fault inside the row body -------------------------
echo "[case 2] a throw inside the row body is the TOOL's failure, and is survivable"
OUT="$TMP/out2.jsonl"
FORGE_VERIFY_FAULT=nonstd FORGE_VERIFY_FAULT_ID=r2 "$BIN" < "$IN" > "$OUT" 2>/dev/null; rc=$?
n=$(grep -c '^{' "$OUT" 2>/dev/null); [ -z "$n" ] && n=0
check "$([ "$rc" -eq 0 ] && echo true || echo false)" "the process survives (rc=$rc)"
check "$([ "$n" -eq 3 ] && echo true || echo false)"  "every row still gets a record ($n/3)"
check "$(holds "$OUT" r2 '"instrument":"verifier_exception"')" \
      "the faulted row is an INSTRUMENT record, not a compile failure"
check "$(holds "$OUT" r3 '"ok":true')" "and its neighbour is unharmed"

# ---- case 3: THE ONE THAT MATTERS. The process dies, and still answers. ------
echo "[case 3] the process ABORTS -- and says so, from inside the crash"
OUT="$TMP/out3.jsonl"; ERR="$TMP/err3.log"
FORGE_VERIFY_FAULT=terminate FORGE_VERIFY_FAULT_ID=r2 "$BIN" < "$IN" > "$OUT" 2>"$ERR"; rc=$?
check "$([ "$rc" -ge 128 ] && echo true || echo false)" \
      "it really did die (rc=$rc), so the OS crash report still exists to reconcile against"
check "$(present "$OUT" r1)" "the row before the crash keeps its measurement"
check "$(holds "$OUT" r2 '"instrument":"verifier_aborted"')" \
      "THE DYING PROCESS EMITS A RECORD FOR THE ROW IN FLIGHT"
check "$(holds "$OUT" r2 'InjectedFault')" \
      "...naming the exception type, which the .ips ('abort() called') destroys"
check "$(grep -q 'forge_verify: INSTRUMENT' "$ERR" && echo true || echo false)" \
      "...and repeats it on stderr, where a parent reads a child's last words"

# ---- case 4: a signal has no exception to read, but still has a row ----------
echo "[case 4] a fatal signal names its row too"
OUT="$TMP/out4.jsonl"
FORGE_VERIFY_FAULT=segv FORGE_VERIFY_FAULT_ID=r2 "$BIN" < "$IN" > "$OUT" 2>/dev/null; rc=$?
check "$(holds "$OUT" r2 '"instrument":"verifier_signal"')" "an instrument record for the signal"
check "$(holds "$OUT" r2 'SIGSEGV')" "...naming the signal"

# ---- case 5: NEGATIVE CONTROL ------------------------------------------------
echo "[case 5] negative control: healthy rows are never called instrument failures"
OUT="$TMP/out5.jsonl"
printf '%s\n' '{"id":"g1","ir":"%1 = BOX(5,5,5)\nRESULT(%1)"}' > "$TMP/good.jsonl"
"$BIN" < "$TMP/good.jsonl" > "$OUT" 2>/dev/null; rc=$?
case "$(cat "$OUT")" in
  *'"instrument"'*) bad "a healthy row was recorded as an instrument failure";;
  *)                pass "no instrument record for a healthy row";;
esac
check "$(holds "$OUT" g1 '"ok":true')" "and it is measured as it always was"

echo
if [ "$fail" -eq 0 ]; then
  echo "[fv-instrument] GREEN"
  exit 0
fi
echo "[fv-instrument] RED -- $fail check(s) failed"
exit 1
