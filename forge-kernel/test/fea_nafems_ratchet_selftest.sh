#!/usr/bin/env bash
# fea_nafems_ratchet_selftest.sh — PROVE the NAFEMS ratchet can fail.
#
# SR-3: "a gate whose failure path cannot produce a non-zero exit is not a gate." The bug
# this whole track exists to fix was exactly that — fea_nafems_gate.mjs printed FAIL for a
# missed NAFEMS target while exiting 0, because only note() set hardFail and the
# reference-correlation sub-cases never called it. So the ratchet that replaces it does not
# get to be trusted on its say-so either: every red path below is DRIVEN to red here and
# its exit code asserted against the documented value.
#
# Each case drives the ratchet with a stub gate and/or a stub baseline (the two
# NAFEMS_GATE / NAFEMS_BASELINE_FILE seams). No committed file is mutated. The stub gates
# emit the same machine-readable contract the real gate emits, so a change to that contract
# that the ratchet's parser cannot handle shows up here.
#
# Run: bash test/fea_nafems_ratchet_selftest.sh      (exit 0 = every path proven)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RATCHET="$HERE/fea_nafems_ratchet.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/nafems_selftest.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
# expect <name> <wanted-exit> <gate> <baseline>
expect() {
  local name="$1" want="$2" gate="$3" base="$4"
  local out rc
  out="$(NAFEMS_GATE="$gate" NAFEMS_BASELINE_FILE="$base" bash "$RATCHET" 2>&1)"
  rc=$?
  if [ "$rc" -eq "$want" ]; then
    printf '  PASS  %-46s exit=%d (wanted %d)\n' "$name" "$rc" "$want"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-46s exit=%d (wanted %d)\n' "$name" "$rc" "$want"
    printf '%s\n' "$out" | sed 's/^/        | /'
    fail=$((fail + 1))
  fi
}

mkgate() {  # mkgate <file> <cases> <misses> <missSet> <hardFail>
  local f="$1" cases="$2" misses="$3" set="$4" hf="$5"
  : > "$f"
  local i=0
  IFS=',' read -r -a names <<< "$set"
  while [ "$i" -lt "$cases" ]; do
    local nm="OK$i" verdict="PASS"
    if [ "$i" -lt "$misses" ]; then nm="${names[$i]}"; verdict="MISS"; fi
    echo "console.log('[nafems-case] name=$nm measured=1.0 target=2.0 errPct=-50.00 band=5 order=nan verdict=$verdict');" >> "$f"
    i=$((i + 1))
  done
  echo "console.log('[nafems-summary] cases=$cases misses=$misses missSet=$set hardFail=$hf');" >> "$f"
}
mkbase() { printf 'NAFEMS_EXPECTED_MISSES=%s\nNAFEMS_EXPECTED_MISS_SET="%s"\n' "$2" "$3" > "$1"; }

echo "[nafems-ratchet-selftest] driving every documented exit path"

# --- 0. the control: an at-baseline run must be GREEN, or nothing below means anything.
mkgate "$TMP/g_ok.mjs" 3 3 "LE1,LE10,LE11" false
mkbase "$TMP/b_ok.txt" 3 "LE1,LE10,LE11"
expect "at baseline -> GREEN" 0 "$TMP/g_ok.mjs" "$TMP/b_ok.txt"

# --- 1. regression: more misses than the baseline.
mkgate "$TMP/g_worse.mjs" 3 3 "LE1,LE10,LE11" false
mkbase "$TMP/b_two.txt" 2 "LE1,LE10"
expect "misses > baseline -> RED (regression)" 1 "$TMP/g_worse.mjs" "$TMP/b_two.txt"

# --- 2. improvement without lowering the baseline in the same commit.
mkgate "$TMP/g_better.mjs" 3 2 "LE1,LE10" false
mkbase "$TMP/b_three.txt" 3 "LE1,LE10,LE11"
expect "misses < baseline -> RED (lower baseline)" 1 "$TMP/g_better.mjs" "$TMP/b_three.txt"

# --- 3. THE DISGUISED REGRESSION: same count, different set. A count-only ratchet
#        (s0_ratchet.sh) would call this GREEN. With three cases it must not.
mkgate "$TMP/g_swap.mjs" 3 3 "LE1,LE10,LE99" false
expect "same count, different set -> RED (swap)" 1 "$TMP/g_swap.mjs" "$TMP/b_ok.txt"

# --- 4. kernel-correctness guard tripped: never ratcheted, always red.
mkgate "$TMP/g_hard.mjs" 3 3 "LE1,LE10,LE11" true
expect "hardFail=true -> RED (kernel guard)" 2 "$TMP/g_hard.mjs" "$TMP/b_ok.txt"

# --- 5. no summary line at all: refuse to guess, do NOT default to green.
echo "console.log('nothing machine readable here');" > "$TMP/g_silent.mjs"
expect "no summary line -> RED (refuse to guess)" 3 "$TMP/g_silent.mjs" "$TMP/b_ok.txt"

# --- 6. summary present but malformed: refuse to guess.
echo "console.log('[nafems-summary] cases=three misses=? missSet= hardFail=maybe');" > "$TMP/g_junk.mjs"
expect "unparseable summary -> RED (refuse to guess)" 3 "$TMP/g_junk.mjs" "$TMP/b_ok.txt"

# --- 7. summary disagrees with the per-case lines actually printed.
{ echo "console.log('[nafems-case] name=LE1 measured=1 target=2 errPct=-50 band=5 order=nan verdict=MISS');"
  echo "console.log('[nafems-summary] cases=3 misses=3 missSet=LE1,LE10,LE11 hardFail=false');"; } > "$TMP/g_incons.mjs"
expect "cases= disagrees with case lines -> RED" 3 "$TMP/g_incons.mjs" "$TMP/b_ok.txt"

# --- 8. the gate itself dies (throw / missing kernel entry point).
echo "throw new Error('kernel entry point missing');" > "$TMP/g_throw.mjs"
expect "gate throws -> RED (did not complete)" 3 "$TMP/g_throw.mjs" "$TMP/b_ok.txt"

# --- 9. a baseline whose count is not an integer must be refused, not shell-errored past.
printf 'NAFEMS_EXPECTED_MISSES=three\nNAFEMS_EXPECTED_MISS_SET="LE1"\n' > "$TMP/b_bad.txt"
expect "non-integer baseline -> RED (refuse to guess)" 3 "$TMP/g_ok.mjs" "$TMP/b_bad.txt"

# --- 10. the baseline file is gone: a missing baseline is not a pass.
expect "baseline file missing -> RED" 3 "$TMP/g_ok.mjs" "$TMP/does_not_exist.txt"

echo
echo "[nafems-ratchet-selftest] TOTAL pass=$pass fail=$fail"
if [ "$fail" -ne 0 ]; then
  echo "[nafems-ratchet-selftest] RED — a documented ratchet failure path did NOT produce its exit code."
  exit 1
fi
echo "[nafems-ratchet-selftest] GREEN — every documented red path proven to exit non-zero."
exit 0
