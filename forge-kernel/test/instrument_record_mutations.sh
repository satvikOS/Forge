#!/usr/bin/env bash
# instrument_record_mutations.sh -- THE NEGATIVE CONTROL FOR THE INSTRUMENT GATE.
#
# A GATE WHOSE FAILURE PATH CANNOT PRODUCE A NON-ZERO EXIT IS NOT A GATE. That is
# not a hypothetical here: the defect instrument_record_gate.cpp exists for ran
# unnoticed through a COMPLETE 600-row run precisely because nothing ever
# exercised the path forge_verify died on, and every downstream count was quietly
# wrong for it. A gate added in response to that must not be allowed to acquire
# the same property.
#
# So this script breaks the SHIPPED header -- src/tools/InstrumentRecord.hpp, the
# one forge_verify.cpp #includes, never a replica -- eight ways, one at a time,
# and requires the gate to go RED for each, at the specific check that guarantee
# belongs to. A mutation that leaves the gate GREEN is a hole in the gate and
# fails this script. So is a mutation that goes red for the WRONG reason: "it
# turned red" is not evidence that the check you care about is doing anything.
#
# Each mutation is a defect someone could plausibly write:
#
#   1  remove-terminate-handler     the 2026-09-01 world, restored exactly: the
#                                   process dies having said nothing.
#   2  lose-exception-type          the record survives, the TYPE does not --
#                                   which is what the .ips ("abort() called")
#                                   already fails to keep.
#   3  discard-what                 the message is dropped while the type stays:
#                                   a crash that half-destroys its own diagnosis.
#   4  never-flag-after-answer      a death after a row was measured is recorded
#                                   as if the row was never measured -- a caller
#                                   obeying it would DISCARD a good measurement.
#   5  forget-the-row-id            a record no one can attribute to a row. It
#                                   still reconciles by COUNT and is still
#                                   useless, which is the point.
#   6  record-to-the-wrong-stream   the record is written -- to stderr, where the
#                                   caller reading records never sees it. The
#                                   subtlest of the eight: everything "works".
#   7  no-signal-handlers           a segfault takes its row down silently again.
#   8  fire-on-every-row            the opposite failure: a gate that fires on
#                                   everything measures nothing, so a healthy row
#                                   gets slandered as an instrument failure.
#
# THE COUNT IS AN EQUALITY, NEVER A FLOOR. A mutation deleted or one that stops
# applying (a rename upstream makes its sed match nothing) must fail this script
# rather than quietly shrink it.
#
# The working tree is never mutated: every edit is made to a COPY under a temp
# directory, and the baseline is rebuilt from that same copy at the end to prove
# the harness restores what it broke. Reverting a mutation with git is how a
# whole day's edit was once lost.
#
# Exit codes
#   0  GREEN -- baseline green, all N mutations red at the right check
#   1  RED   -- a mutation left the gate green, or reddened the wrong check
#   3  RED   -- could not run (no compiler, sources missing, baseline not green).
#              A check that could not run is not a check that passed.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/.." && pwd)"
HDR_SRC="$KERNEL/src/tools/InstrumentRecord.hpp"
GATE_SRC="$KERNEL/test/instrument_record_gate.cpp"
EXPECTED_MUTATIONS=8

CXX="${CXX:-c++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "[instr-mut] no C++ compiler ($CXX). RED."; exit 3; }
[ -f "$HDR_SRC" ]  || { echo "[instr-mut] missing $HDR_SRC. RED."; exit 3; }
[ -f "$GATE_SRC" ] || { echo "[instr-mut] missing $GATE_SRC. RED."; exit 3; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/instr_mut.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src/tools" "$TMP/test"
cp "$HDR_SRC"  "$TMP/src/tools/InstrumentRecord.hpp"
cp "$HDR_SRC"  "$TMP/pristine.hpp"          # the ONLY restore source. Never git.
cp "$GATE_SRC" "$TMP/test/instrument_record_gate.cpp"

fail=0
red_count=0

# Build the gate against whatever is currently in $TMP and run it.
# Echoes: "<compile-rc>:<run-rc>"; the gate's own output lands in $TMP/run.log.
build_and_run() {
    if ! "$CXX" -std=c++17 -O1 -o "$TMP/gate" \
            "$TMP/test/instrument_record_gate.cpp" > "$TMP/compile.log" 2>&1; then
        echo "compile:-"
        return
    fi
    "$TMP/gate" > "$TMP/run.log" 2>&1
    echo "ok:$?"
}

echo "[instr-mut] header: $HDR_SRC"
echo "[instr-mut] compiler: $CXX"

# ---- BASELINE. If this is not green the mutations prove nothing. -------------
base="$(build_and_run)"
case "$base" in
  compile:*) echo "[instr-mut] the UNMUTATED gate does not compile. RED (cannot run)."
             sed -n '1,25p' "$TMP/compile.log"; exit 3 ;;
  ok:0)      echo "[instr-mut] baseline: GREEN" ;;
  *)         echo "[instr-mut] the UNMUTATED gate is not green (${base#ok:}). RED (cannot run)."
             tail -20 "$TMP/run.log"; exit 3 ;;
esac

# mutate <name> <sed-expr> <check-substring-that-must-go-red>
# Sets LAST_VERDICT to one of RED / HOLE / WRONG / BROKEN, which is what
# --selftest reads to prove this harness's own red paths are reachable.
LAST_VERDICT=""
mutate() {
    local name="$1" expr="$2" want="$3"
    cp "$TMP/pristine.hpp" "$TMP/src/tools/InstrumentRecord.hpp"
    sed -i.bak "$expr" "$TMP/src/tools/InstrumentRecord.hpp"
    rm -f "$TMP/src/tools/InstrumentRecord.hpp.bak"

    # A MUTATION THAT DID NOT APPLY IS A BROKEN MUTATION, NOT A PASSING GATE.
    # Renaming something upstream must break this script loudly instead of
    # silently reducing it to a smaller suite that still says GREEN.
    if cmp -s "$TMP/pristine.hpp" "$TMP/src/tools/InstrumentRecord.hpp"; then
        echo "  BROKEN  $name -- the edit matched nothing; the header moved under it"
        LAST_VERDICT=BROKEN; fail=$((fail + 1)); return
    fi

    local r; r="$(build_and_run)"
    if [ "$r" = "compile:-" ]; then
        echo "  BROKEN  $name -- the mutant does not compile, so it tests nothing"
        sed -n '1,6p' "$TMP/compile.log"
        LAST_VERDICT=BROKEN; fail=$((fail + 1)); return
    fi
    local rc="${r#ok:}"
    if [ "$rc" = "0" ]; then
        echo "  HOLE    $name -- the gate stayed GREEN. This defect would ship."
        LAST_VERDICT=HOLE; fail=$((fail + 1)); return
    fi
    if ! grep -q "FAIL.*$want" "$TMP/run.log"; then
        echo "  WRONG   $name -- red (rc=$rc) but NOT at '$want'; that check is asleep"
        grep '^  FAIL' "$TMP/run.log" | sed 's/^/          /'
        LAST_VERDICT=WRONG; fail=$((fail + 1)); return
    fi
    echo "  RED     $name (rc=$rc) -- caught at: $(grep -m1 "FAIL.*$want" "$TMP/run.log" | sed 's/^ *FAIL *//')"
    LAST_VERDICT=RED; red_count=$((red_count + 1))
}

echo "[instr-mut] breaking the shipped header $EXPECTED_MUTATIONS ways"

# 1. The handler is never installed -- exactly the state forge_verify shipped in
#    on 2026-09-01, when seven deaths produced seven silences.
mutate "remove-terminate-handler" \
       's/std::set_terminate(onTerminate)/std::get_terminate()/' \
       "the dying process emits an instrument record"

# 2. The record survives; the exception's type does not.
mutate "lose-exception-type" \
       's/abi::__cxa_current_exception_type()/nullptr/' \
       "the exception's TYPE survives"

# 3. what() is thrown away while the type is kept -- half a diagnosis.
mutate "discard-what" \
       's/if (std::current_exception()) {/if (false) {/' \
       "what() survives"

# 4. Every death claims the row was never answered. A caller that believes it
#    throws away a measurement it already had.
mutate "never-flag-after-answer" \
       's/emitInstrument("verifier_aborted", detail, g_rowAnswered != 0)/emitInstrument("verifier_aborted", detail, false)/' \
       "flagged afterAnswer"

# 5. The record cannot be attributed to a row.
mutate "forget-the-row-id" \
       's/const std::size_t k = id.size() < sizeof(g_rowId) - 1 ? id.size() : sizeof(g_rowId) - 1;/const std::size_t k = 0;/' \
       "the record names the row in flight"

# 6. THE SUBTLE ONE: the record is written, to a stream the caller does not read
#    records from. Nothing errors; the row is simply lost again.
mutate "record-to-the-wrong-stream" \
       's/::write(STDOUT_FILENO, b, n)/::write(STDERR_FILENO, b, n)/' \
       "the dying process emits an instrument record"

# 7. A signal death goes back to being silent.
mutate "no-signal-handlers" \
       's/std::signal(SIGSEGV, onFatalSignal);/std::signal(SIGSEGV, SIG_DFL);/' \
       "the signal is named"

# 8. The opposite failure: an instrument record for a row that was fine. A gate
#    that fires on everything measures nothing -- and this one would relabel
#    healthy rows as unmeasured, deleting them from a denominator they belong in.
mutate "fire-on-every-row" \
       's|inline void emitRow(const std::string& json) {|inline void emitRow(const std::string\& json) { emitInstrument("spurious", "no death happened", false);|' \
       "no instrument record for a row that answered"

# ---- --selftest: THIS harness's own red paths must be reachable -------------
# Recursion, deliberately: the argument of this whole file is that a gate whose
# failure path cannot fire is not a gate, and that applies to the gate-checker
# too. Two deliberately bad mutations are fed to `mutate` and must be REFUSED --
# one that matches nothing (so it silently shrinks the suite) and one that
# applies, compiles, and changes only a comment (so the gate stays green).
if [ "${1:-}" = "--selftest" ]; then
    echo "[instr-mut] --selftest: the harness's own refusals"
    before_fail=$fail
    mutate "SELFTEST/edit-that-matches-nothing" \
           's/THIS_TOKEN_IS_NOT_IN_THE_HEADER/x/' "anything"
    sv1="$LAST_VERDICT"
    mutate "SELFTEST/harmless-comment-only" \
           's|// --- allocation-free JSON assembly|// --- mutated comment|' \
           "the dying process emits an instrument record"
    sv2="$LAST_VERDICT"
    fail=$before_fail                      # the two failures were the point
    st=0
    [ "$sv1" = "BROKEN" ] || { echo "  FAIL    a no-op mutation was not refused (got $sv1)"; st=1; }
    [ "$sv2" = "HOLE" ]   || { echo "  FAIL    a green mutant was not reported as a hole (got $sv2)"; st=1; }
    if [ "$st" = "0" ]; then
        echo "  ok      both refusals fired -- this harness can return non-zero"
    else
        fail=$((fail + 1))
    fi
fi

# ---- the harness must put back what it broke --------------------------------
cp "$TMP/pristine.hpp" "$TMP/src/tools/InstrumentRecord.hpp"
after="$(build_and_run)"
if [ "$after" != "ok:0" ]; then
    echo "  FAIL    the restored baseline is not green ($after) -- the harness did not restore"
    fail=$((fail + 1))
else
    echo "  ok      restored baseline is GREEN again"
fi

# ---- the count is an equality --------------------------------------------
if [ "$red_count" -ne "$EXPECTED_MUTATIONS" ]; then
    echo "  FAIL    $red_count of $EXPECTED_MUTATIONS mutations proved red -- the suite changed size"
    fail=$((fail + 1))
fi

echo
if [ "$fail" -eq 0 ]; then
    echo "[instr-mut] GREEN -- baseline green, $red_count/$EXPECTED_MUTATIONS mutations red at the right check"
    exit 0
fi
echo "[instr-mut] RED -- $fail problem(s)"
exit 1
