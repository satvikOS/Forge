#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_draft_local_probe.sh — build and run test/draft_local_probe over the SAME
# 600-part corpus the family-J A/B row was measured on, and report what the
# GENERAL native draft engine actually covers.
#
# The corpus default and the stride sampling are copied from
# run_draft_defer_probe.sh (which copied them from run_corpus_ab_coverage.sh) so
# the denominator is the same one summary.md's DRAFT row reports over: N=565
# applicable, 35 not applicable.
#
# ★ COVERAGE IS "AGREES WITH OCCT", NOT "DID NOT DEFER". The probe drafts each
# part on BOTH engines and compares a VECTOR of observables. A part that built a
# solid which disagrees is scored as a DISAGREEMENT and never as coverage.
#
# A part that crashes or exits non-zero without printing a row gets an explicit
# {"error": ...} row, so the row count and the sample size cannot silently
# disagree — a missing row would read exactly like a clean defer.
#
# ONE PART AT A TIME, on purpose. Per-job concurrency does not bound per-job
# memory: one forge_verify once grew to 9.9 GB in 101 seconds under a --jobs 2
# limit. Each part also gets a wall-clock timeout so a single pathological
# OCCT draft cannot hold the run.
#
# usage: test/run_draft_local_probe.sh [N] [OUTDIR]
#   env: CORPUS=<dir>  SKIP_BUILD=1  BIN=<path>  PART_TIMEOUT=<seconds>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

N="${1:-0}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${2:-$KERNEL/.build-draft-local/run-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
PART_TIMEOUT="${PART_TIMEOUT:-120}"

[ -d "$CORPUS" ] || { echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; }

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  BIN="${BIN:-$KERNEL/.build-draft-local/draft_local_probe}"
else
  BINLINE="$(bash "$KERNEL/test/build_draft_local_probe.sh" | grep '^BIN=' | tail -1)"
  BIN="${BINLINE#BIN=}"
fi
[ -n "$BIN" ] && [ -x "$BIN" ] || { echo "FATAL: no draft_local_probe binary" >&2; exit 1; }

mkdir -p "$OUTDIR" || exit 2
RESULTS="$OUTDIR/results.jsonl"
: > "$RESULTS"

ALL="$OUTDIR/corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$ALL"
TOTAL="$(wc -l < "$ALL" | tr -d ' ')"
[ "$TOTAL" -gt 0 ] || { echo "FATAL: no .step files in $CORPUS" >&2; exit 2; }
case "$N" in all|0) N="$TOTAL" ;; esac
[ "$N" -gt "$TOTAL" ] && N="$TOTAL"
STRIDE=$(( TOTAL / N )); [ "$STRIDE" -lt 1 ] && STRIDE=1
SAMPLE="$OUTDIR/sample.list"
awk -v s="$STRIDE" -v want="$N" 'NR > 0 && (NR - 1) % s == 0 && kept < want { print; kept++ }' "$ALL" > "$SAMPLE"
NSAMPLE="$(wc -l < "$SAMPLE" | tr -d ' ')"

cat > "$OUTDIR/manifest.json" <<JSON
{
  "generated_utc": "$TS",
  "corpus_dir": "$CORPUS",
  "corpus_total": $TOTAL,
  "stride": $STRIDE,
  "realised_n": $NSAMPLE,
  "part_timeout_s": $PART_TIMEOUT,
  "binary": "$BIN",
  "kernel_head_at_run": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)",
  "build_stamp": $(cat "$(dirname "$BIN")/build_stamp.json" 2>/dev/null || echo null)
}
JSON

# `timeout` is GNU; macOS has it only via coreutils. Fall back to a background
# job plus a watchdog so the run never silently loses the bound.
run_one() {   # run_one <step> <name>
  if command -v timeout >/dev/null 2>&1; then
    timeout "$PART_TIMEOUT" "$BIN" "$1" --name="$2"
    return $?
  fi
  "$BIN" "$1" --name="$2" &
  local pid=$!
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$PART_TIMEOUT" ]; then
      # Kill only THIS process tree, by PID. Never pkill: peers share this box.
      for c in $(pgrep -P "$pid" 2>/dev/null); do kill -9 "$c" 2>/dev/null; done
      kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
  return $?
}

i=0
while IFS= read -r step; do
  i=$((i + 1))
  name="$(basename "$step" .step)"
  if ! run_one "$step" "$name" >> "$RESULTS" 2>/dev/null; then
    rc=$?
    if ! grep -q "\"part\":\"$name\"" "$RESULTS"; then
      printf '{"part":"%s","error":"process_rc_%d"}\n' "$name" "$rc" >> "$RESULTS"
    fi
  fi
  if [ $((i % 50)) -eq 0 ]; then echo "[draft-local-probe] $i/$NSAMPLE" >&2; fi
done < "$SAMPLE"

echo "[draft-local-probe] $i parts, $(wc -l < "$RESULTS" | tr -d ' ') rows -> $RESULTS"
