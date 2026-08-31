#!/usr/bin/env bash
# run_ab_all.sh — run EVERY live-OCCT A/B harness and ratchet the result.
#
# WHY THIS EXISTS. On 2026-08-29 two harnesses — thicken and loftpipe — stopped
# LINKING the moment PR #64 merged, because it made their engines call
# forge::occtPrism / forge::occtCylinderSolid and both compile their engine
# STANDALONE without src/OcctPrimBuilder.cpp. 541 assertions stopped running and
# NOTHING SAID SO, because CI ran neither harness. A GATE THAT CANNOT BUILD IS A
# GATE THAT CANNOT FAIL, and it fails silently — so this gate distinguishes a
# BUILD/LINK failure from an assertion failure and treats the former as RED
# unconditionally, never as "0 failures".
#
# The harnesses themselves are never modified and never weakened. This only
# interprets them, against test/ab_native_baseline.txt, in the same idiom as
# fea_nafems_ratchet.sh and ft/s0_ratchet.sh.
#
# Exit codes
#   0  GREEN — every harness built, and each one's failure count EQUALS its baseline.
#   1  RED   — a regression (count rose), or an unrecorded improvement (count fell
#              without the baseline being lowered in the same commit).
#   2  RED   — a harness did not BUILD or LINK. Never ratcheted, never excused.
#   3  RED   — a harness produced no parseable result. Refusing to guess.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$(cd "$ROOT/.." && pwd)"
BASE="${AB_BASELINE_FILE:-$HERE/ab_native_baseline.txt}"
[ -f "$BASE" ] || { echo "[ab-all] baseline $BASE missing — refusing to guess. RED."; exit 3; }
# shellcheck source=/dev/null
. "$BASE"

# thicksolid_mixed is a CLOSED-FORM gate, not a native-vs-OCCT A/B: section 4 of
# reports/corpus_ab/THICKSOLID_ATTRIBUTION.md measures OCCT returning an INVALID
# solid on 133 of its 133 successes for this operation, so it is not a valid
# oracle here. It is ratcheted in this list because it is a live-OCCT gate with
# the same build-and-link failure mode the rest of this file exists to catch.
HARNESSES="draft filling loftpipe offsetshape sweep fillet_concave thicken thicksolid_mixed"
rc=0
for t in $HARNESSES; do
  f="forge-kernel/test/run_ab_native_$t.sh"
  if [ ! -f "$f" ]; then echo "[ab-all] RED $t: harness missing"; rc=3; continue; fi
  out="$(bash "$f" 2>&1)"
  # A BUILD/LINK failure is not an assertion result and must never be counted as one.
  if printf '%s' "$out" | grep -q "BUILD/LINK FAIL\|symbol(s) not found\|linker command failed"; then
    echo "[ab-all] RED $t: DID NOT BUILD/LINK — its assertions did not run at all"
    printf '%s\n' "$out" | grep -m3 -E "Undefined symbols|symbol\(s\) not found|error:" | sed 's/^/         /'
    [ "$rc" -lt 2 ] && rc=2
    continue
  fi
  # "N passed, M failed" or "N/N assertions passed"
  got=$(printf '%s' "$out" | grep -oE "[0-9]+ (passed|failed)" | awk '/failed/{print $1}' | tail -1)
  if [ -z "$got" ]; then
    if printf '%s' "$out" | grep -qE "assertions passed|checks passed"; then got=0; else
      echo "[ab-all] RED $t: no parseable result — refusing to guess"; rc=3; continue; fi
  fi
  eval "want=\${AB_BASELINE_$t:-}"
  if [ -z "$want" ]; then echo "[ab-all] RED $t: no baseline entry — refusing to guess"; rc=3; continue; fi
  if [ "$got" -gt "$want" ]; then
    echo "[ab-all] RED $t: failures $got > baseline $want — REGRESSION"; [ "$rc" -lt 1 ] && rc=1
  elif [ "$got" -lt "$want" ]; then
    echo "[ab-all] RED $t: failures $got < baseline $want — IMPROVED. Lower AB_BASELINE_$t to $got in this commit."
    [ "$rc" -lt 1 ] && rc=1
  else
    echo "[ab-all] ok  $t: $got failure(s), baseline $want"
  fi
done
[ "$rc" -eq 0 ] && echo "[ab-all] GREEN — all 8 harnesses BUILT, and each matched its baseline."
exit "$rc"
