#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_draft_defer_probe.sh — run test/draft_defer_probe over the SAME 600-part
# corpus the family-J A/B row was measured on, and classify the defers.
#
# The corpus default and the stride sampling are copied from
# run_corpus_ab_coverage.sh so the denominator is the same one summary.md's
# DRAFT row (N=565 applicable, 35 not applicable) reports over.
#
# A part that crashes or exits non-zero without printing a row gets an explicit
# {"error": ...} row, so the row count and the sample size cannot silently
# disagree — a missing row would read exactly like a clean defer.
#
# usage: test/run_draft_defer_probe.sh [N] [OUTDIR]     env: CORPUS=<dir>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

N="${1:-0}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${2:-$KERNEL/.build-draft-probe/run-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"

[ -d "$CORPUS" ] || { echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; }

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  BIN="${BIN:-$KERNEL/.build-draft-probe/draft_defer_probe}"
else
  BINLINE="$(bash "$KERNEL/test/build_draft_defer_probe.sh" 2>/dev/null | grep '^BIN=' | tail -1)"
  BIN="${BINLINE#BIN=}"
fi
[ -n "$BIN" ] && [ -x "$BIN" ] || { echo "FATAL: no draft_defer_probe binary" >&2; exit 1; }

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
  "binary": "$BIN",
  "kernel_head_at_run": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)",
  "build_stamp": $(cat "$(dirname "$BIN")/build_stamp.json" 2>/dev/null || echo null)
}
JSON

i=0
while IFS= read -r step; do
  i=$((i + 1))
  name="$(basename "$step" .step)"
  if ! "$BIN" "$step" --name="$name" >> "$RESULTS" 2>/dev/null; then
    rc=$?
    if ! grep -q "\"part\":\"$name\"" "$RESULTS"; then
      printf '{"part":"%s","error":"process_rc_%d"}\n' "$name" "$rc" >> "$RESULTS"
    fi
  fi
done < "$SAMPLE"

echo "[draft-probe] $i parts, $(wc -l < "$RESULTS" | tr -d ' ') rows -> $RESULTS"
