#!/usr/bin/env bash
# s0_ratchet.sh — run the Appendix B acceptance suite and apply the conformance ratchet.
# The suite itself is never modified and never weakened; this only interprets its result.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE_FILE="$HERE/s0_conformance_baseline.txt"
# shellcheck source=/dev/null
. "$BASELINE_FILE"
: "${S0_EXPECTED_FAILURES:?baseline file did not define S0_EXPECTED_FAILURES}"

LOG="$(mktemp "${TMPDIR:-/tmp}/s0_ratchet.XXXXXX")"
bash "$HERE/build_s0_acceptance.sh" > "$LOG" 2>&1
raw=$?
cat "$LOG"

if [ "$raw" -eq 2 ]; then
  echo "[s0-ratchet] BUILD FAILED (exit 2) — the suite could not be compiled. RED."
  rm -f "$LOG"; exit 2
fi

line="$(grep -E '^TOTAL[[:space:]]+pass=' "$LOG" | tail -1)"
if [ -z "$line" ]; then
  echo "[s0-ratchet] could not find the TOTAL line — refusing to guess. RED."
  rm -f "$LOG"; exit 3
fi
pass="$(printf '%s' "$line" | sed -E 's/.*pass=([0-9]+).*/\1/')"
fail="$(printf '%s' "$line" | sed -E 's/.*fail=([0-9]+).*/\1/')"
rm -f "$LOG"

echo
echo "[s0-ratchet] pass=$pass fail=$fail  baseline=$S0_EXPECTED_FAILURES"
if [ "$fail" -gt "$S0_EXPECTED_FAILURES" ]; then
  echo "[s0-ratchet] RED — conformance REGRESSED: $fail failures against a baseline of $S0_EXPECTED_FAILURES."
  echo "             A law that used to hold no longer does. Do not raise the baseline to go green."
  exit 1
fi
if [ "$fail" -lt "$S0_EXPECTED_FAILURES" ]; then
  echo "[s0-ratchet] RED — conformance IMPROVED: $fail failures against a baseline of $S0_EXPECTED_FAILURES."
  echo "             Lower S0_EXPECTED_FAILURES to $fail in $BASELINE_FILE, in this same commit."
  echo "             This direction is red on purpose: a stale baseline silently re-admits regressions."
  exit 1
fi
echo "[s0-ratchet] GREEN — $fail known gaps, unchanged. They are listed above and remain owed."
exit 0
