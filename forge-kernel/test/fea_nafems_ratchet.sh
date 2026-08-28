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
missSet="$(printf '%s' "$summary" | sed -nE 's/.*[[:space:]]missSet=([^[:space:]]+).*/\1/p')"
hardFail="$(printf '%s' "$summary" | sed -nE 's/.*[[:space:]]hardFail=(true|false).*/\1/p')"
if [ -z "$cases" ] || [ -z "$misses" ] || [ -z "$missSet" ] || [ -z "$hardFail" ]; then
  echo
  echo "[nafems-ratchet] could not parse the summary line — refusing to guess. RED."
  echo "                 line was: $summary"
  rm -f "$LOG"; exit 3
fi

# Every case must have emitted a machine-readable per-case line, or the summary is not
# describing the run we think it is.
caseLines="$(grep -cE '^\[nafems-case\] ' "$LOG" || true)"
: "${caseLines:=0}"
if [ "$caseLines" -ne "$cases" ]; then
  echo
  echo "[nafems-ratchet] summary says cases=$cases but $caseLines [nafems-case] lines were printed."
  echo "                 The gate output is inconsistent — refusing to guess. RED."
  rm -f "$LOG"; exit 3
fi

echo
echo "----------------------------------------------------------------------"
echo "[nafems-ratchet] cases=$cases misses=$misses missSet=$missSet hardFail=$hardFail"
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

if [ "$misses" -gt "$NAFEMS_EXPECTED_MISSES" ]; then
  echo "[nafems-ratchet] RED — NAFEMS accuracy REGRESSED: $misses band misses against a"
  echo "                 baseline of $NAFEMS_EXPECTED_MISSES. Newly missing: $gotSet (was $wantSet)."
  echo "                 A published target that used to be met no longer is. Do not raise the"
  echo "                 baseline to go green."
  rm -f "$LOG"; exit 1
fi
if [ "$misses" -lt "$NAFEMS_EXPECTED_MISSES" ]; then
  echo "[nafems-ratchet] RED — NAFEMS accuracy IMPROVED: $misses band misses against a baseline"
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
