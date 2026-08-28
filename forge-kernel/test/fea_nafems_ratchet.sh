#!/usr/bin/env bash
# fea_nafems_ratchet.sh — run the NAFEMS known-answer gate and apply the accuracy ratchet.
#
# The gate itself is never modified to go green and its bands are never widened; this only
# INTERPRETS its result. Modelled on test/ft/s0_ratchet.sh (same contract, same refusal to
# guess), with one addition: because there are only three NAFEMS cases, an equal miss COUNT
# with a different miss SET is a regression in disguise, so the set is compared too.
#
# Exit codes
#   0  GREEN — miss count and miss set both equal the baseline; the gaps are printed.
#   1  RED   — a ratchet violation (regression, or an improvement whose baseline was not
#              lowered in the same commit), or a differing miss set at equal count.
#   2  RED   — the gate tripped a KERNEL-CORRECTNESS guard (hardFail=true). Never ratcheted.
#   3  RED   — the gate's machine-readable summary could not be parsed, or the gate died.
#              Refusing to guess: an unparseable result is not a pass.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Overridable ONLY so the ratchet's own red paths can be exercised without mutating the
# committed gate or baseline (see test/fea_nafems_ratchet_selftest.sh). CI sets neither.
BASELINE_FILE="${NAFEMS_BASELINE_FILE:-$HERE/fea_nafems_baseline.txt}"
GATE="${NAFEMS_GATE:-$HERE/fea_nafems_gate.mjs}"

if [ ! -f "$BASELINE_FILE" ]; then
  echo "[nafems-ratchet] baseline file $BASELINE_FILE is missing — refusing to guess. RED."
  exit 3
fi
# shellcheck source=/dev/null
. "$BASELINE_FILE"
: "${NAFEMS_EXPECTED_MISSES:?baseline file did not define NAFEMS_EXPECTED_MISSES}"
: "${NAFEMS_EXPECTED_MISS_SET:?baseline file did not define NAFEMS_EXPECTED_MISS_SET}"
# A baseline count that is not an integer would make every `[ -gt ]` below emit a shell
# error and fall through to whichever branch happens to be last. Refuse instead.
case "$NAFEMS_EXPECTED_MISSES" in
  ''|*[!0-9]*)
    echo "[nafems-ratchet] NAFEMS_EXPECTED_MISSES='$NAFEMS_EXPECTED_MISSES' is not a non-negative"
    echo "                 integer — refusing to guess. RED."
    exit 3 ;;
esac

LOG="$(mktemp "${TMPDIR:-/tmp}/fea_nafems_ratchet.XXXXXX")"
node "$GATE" > "$LOG" 2>&1
gate_rc=$?
cat "$LOG"

# The gate throws (rc != 0/1) when the kernel is missing the fea/fea.tet entry points or a
# mesh/solve blows up. That is not a band miss and must not be ratcheted into green.
if [ "$gate_rc" -gt 1 ]; then
  echo
  echo "[nafems-ratchet] the gate exited $gate_rc (not 0/1) — it did not complete. RED."
  rm -f "$LOG"; exit 3
fi

summary="$(grep -E '^\[nafems-summary\] ' "$LOG" | tail -1)"
if [ -z "$summary" ]; then
  echo
  echo "[nafems-ratchet] no [nafems-summary] line in the gate output — refusing to guess. RED."
  rm -f "$LOG"; exit 3
fi

# Parse strictly: every field must match its expected shape or we bail rather than default.
cases="$(printf '%s' "$summary"  | sed -nE 's/.*[[:space:]]cases=([0-9]+).*/\1/p')"
misses="$(printf '%s' "$summary" | sed -nE 's/.*[[:space:]]misses=([0-9]+).*/\1/p')"
blocked="$(printf '%s' "$summary" | sed -nE 's/.*[[:space:]]blocked=([0-9]+).*/\1/p')"
blockedSet="$(printf '%s' "$summary" | sed -nE 's/.*[[:space:]]blockedSet=([^ ]+).*/\1/p')"
# blocked= is NOT defaulted. Defaulting an absent field to 0 would mean an older gate that
# does not emit it reads as "nothing blocked" — which is precisely the silent capability loss
# this axis was added to catch. Absent => unparseable => exit 3 below. The BASELINE keys do
# default, and they default to the STRICTEST value (ceiling 0 = any blocked case is red), so a
# baseline written before this axis existed cannot be weakened by its own silence.
: "${blockedSet:=-}"
: "${NAFEMS_EXPECTED_BLOCKED_MAX:=0}"; : "${NAFEMS_EXPECTED_BLOCKED_SET:=-}"
missSet="$(printf '%s' "$summary" | sed -nE 's/.*[[:space:]]missSet=([^[:space:]]+).*/\1/p')"
hardFail="$(printf '%s' "$summary" | sed -nE 's/.*[[:space:]]hardFail=(true|false).*/\1/p')"
if [ -z "$cases" ] || [ -z "$misses" ] || [ -z "$missSet" ] || [ -z "$hardFail" ] || [ -z "$blocked" ]; then
  echo
  echo "[nafems-ratchet] could not parse the summary line — refusing to guess. RED."
  echo "                 line was: $summary"
  rm -f "$LOG"; exit 3
fi

# Every case must have emitted a machine-readable per-case line, or the summary is not
# describing the run we think it is.
caseLines="$(grep -cE '^\[nafems-case\] ' "$LOG" || true)"
: "${caseLines:=0}"
# cases= counts the cases that RAN; a blocked case still prints a [nafems-case] line carrying
# verdict=BLOCKED, so the expected line count is ran + blocked. MEASURED, not assumed: forcing
# LE11's fuse to refuse makes the real gate print cases=2 misses=2 blocked=1 with THREE case
# lines. Checking against cases alone made that exit 3 ("inconsistent") in CI and nowhere else.
expectedLines=$((cases + blocked))
if [ "$caseLines" -ne "$expectedLines" ]; then
  echo
  echo "[nafems-ratchet] summary says cases=$cases + blocked=$blocked but $caseLines [nafems-case] lines were printed."
  echo "                 The gate output is inconsistent — refusing to guess. RED."
  rm -f "$LOG"; exit 3
fi

echo
echo "----------------------------------------------------------------------"
echo "[nafems-ratchet] cases=$cases misses=$misses missSet=$missSet blocked=$blocked ($blockedSet) hardFail=$hardFail"
echo "[nafems-ratchet] baseline misses=$NAFEMS_EXPECTED_MISSES set=$NAFEMS_EXPECTED_MISS_SET"

if [ "$hardFail" = "true" ]; then
  echo "[nafems-ratchet] RED — the gate tripped a KERNEL-CORRECTNESS guard (degenerate shell"
  echo "                 mesh / NaN / wrong-sign stress / CG non-convergence / thermoelastic"
  echo "                 analytic check). This is never ratcheted. Fix the kernel."
  rm -f "$LOG"; exit 2
fi

# Normalise both sets (sorted, comma-separated) before comparing. The gate already sorts;
# sorting again here means a reordered baseline string cannot cause a false RED.
norm() { printf '%s' "$1" | tr ',' '\n' | sed '/^$/d' | LC_ALL=C sort | paste -sd, -; }
gotSet="$(norm "$missSet")"
wantSet="$(norm "$NAFEMS_EXPECTED_MISS_SET")"

# A case that DID NOT RUN is judged on its own axis, before accuracy is judged at all.
if [ "$blocked" -gt "$NAFEMS_EXPECTED_BLOCKED_MAX" ]; then
  echo "[nafems-ratchet] RED — a case stopped RUNNING: blocked=$blocked ($blockedSet) against a"
  echo "                 ceiling of $NAFEMS_EXPECTED_BLOCKED_MAX ($NAFEMS_EXPECTED_BLOCKED_SET)."
  echo "                 That is a CAPABILITY loss, not an accuracy change. Do not raise the ceiling."
  exit 1
fi
if [ "$blocked" -lt "$NAFEMS_EXPECTED_BLOCKED_MAX" ]; then
  # A CEILING, deliberately not an equality — unlike the miss count. The blocked set is
  # PLATFORM-DEPENDENT by its nature: LE11's ball+cone+cylinder fuse succeeds on macOS locally and
  # is refused on the CI runner, where the native-only operand class has no OCCT fallback. Making
  # "fewer blocked" red would leave this gate permanently red on whichever platform is doing better,
  # which teaches people to ignore it — the exact failure the ratchet exists to prevent.
  echo "[nafems-ratchet] NOTE — fewer cases blocked than the ceiling ($blocked < $NAFEMS_EXPECTED_BLOCKED_MAX)."
  echo "                 A case that was blocked elsewhere RUNS here. Not an error; the ceiling"
  echo "                 tracks the worst platform. Lower it once no platform blocks that case."
fi
# Accuracy is compared ONLY among the cases that actually ran. The baseline names every case
# expected to miss; a BLOCKED case cannot miss, because it never produced a number. Subtracting
# the blocked set from the expected set — from the COUNT and from the SET, both are compared
# below — is what makes one committed baseline correct on a platform where LE11 runs (expect
# LE1,LE10,LE11) and on one where its boolean is refused (expect LE1,LE10). Without it the
# ratchet reads a capability loss as an accuracy improvement and demands the baseline be
# LOWERED, which would lock the regression in.
wantSet="$(
  for _e in $(printf '%s' "$wantSet" | tr ',' ' '); do
    _isblocked=0
    for _b in $(printf '%s' "$blockedSet" | tr ',' ' '); do
      [ "$_b" = "$_e" ] && _isblocked=1
    done
    [ "$_isblocked" -eq 0 ] && printf '%s\n' "$_e"
  done | LC_ALL=C sort | paste -sd, -
)"
expected_among_ran="$(printf '%s' "$wantSet" | tr ',' '\n' | sed '/^$/d' | grep -c . || true)"
: "${expected_among_ran:=0}"
if [ "$expected_among_ran" -ne "$NAFEMS_EXPECTED_MISSES" ]; then
  echo "[nafems-ratchet] $blocked case(s) did not run here ($blockedSet), so the baseline's"
  echo "                 $NAFEMS_EXPECTED_MISSES expected misses reduce to $expected_among_ran among the cases that RAN: $wantSet"
fi
if [ "$misses" -gt "$expected_among_ran" ]; then
  echo "[nafems-ratchet] RED — NAFEMS accuracy REGRESSED: $misses band misses against"
  echo "                 $expected_among_ran expected among the cases that ran. Got: $gotSet (baseline $wantSet)."
  echo "                 A published target that used to be met no longer is. Do not raise the"
  echo "                 baseline to go green."
  rm -f "$LOG"; exit 1
fi
if [ "$misses" -lt "$expected_among_ran" ]; then
  echo "[nafems-ratchet] RED — NAFEMS accuracy IMPROVED: $misses band misses against $expected_among_ran expected"
  echo "                 of $NAFEMS_EXPECTED_MISSES. Set NAFEMS_EXPECTED_MISSES=$misses and"
  echo "                 NAFEMS_EXPECTED_MISS_SET=\"$gotSet\" in $BASELINE_FILE, in this same commit."
  echo "                 This direction is red on purpose: a stale baseline silently re-admits"
  echo "                 regressions."
  rm -f "$LOG"; exit 1
fi
if [ "$gotSet" != "$wantSet" ]; then
  echo "[nafems-ratchet] RED — same miss COUNT ($misses) but a DIFFERENT miss SET."
  echo "                 got:      $gotSet"
  echo "                 baseline: $wantSet"
  echo "                 One target was closed and another broken. That nets to the same number"
  echo "                 and is still a regression. Fix the newly-missing case, or record both"
  echo "                 changes in $BASELINE_FILE in this same commit."
  rm -f "$LOG"; exit 1
fi

echo "[nafems-ratchet] GREEN — $misses known NAFEMS gaps, unchanged. They remain OWED:"
grep -E '^\[nafems-case\] ' "$LOG" | grep 'verdict=MISS' | sed 's/^/                 /'
echo "                 Root cause and costed plan: reports/FEA_NAFEMS_GAP.md"
rm -f "$LOG"
exit 0
