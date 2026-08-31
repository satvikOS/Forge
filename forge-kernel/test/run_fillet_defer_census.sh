#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_fillet_defer_census.sh — run test/fillet_defer_census over the SAME
# 600-part corpus the FILLET A/B row was measured on, and name the guard that
# fired on each part, on BOTH arms.
#
# The corpus default and the stride sampling are copied from
# run_corpus_ab_coverage.sh so the denominator is the same one
# reports/CORPUS_AB_COVERAGE.md's FILLET row reports over.
#
# A part that crashes or exits non-zero without printing a row gets an explicit
# {"error": ...} row, so the row count and the sample size cannot silently
# disagree — a missing row would read exactly like a clean defer.
#
# usage: test/run_fillet_defer_census.sh [N] [OUTDIR]     env: CORPUS=<dir>
#        JOBS=<n> runs n parts in parallel (each part is its own process, so a
#        crash costs one row and is recorded).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

N="${1:-0}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${2:-$KERNEL/.build-fillet-census/run-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
PJOBS="${JOBS:-4}"

[ -d "$CORPUS" ] || { echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; }

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  BIN="${BIN:-$KERNEL/.build-fillet-census/fillet_defer_census}"
else
  BINLINE="$(JOBS="$PJOBS" bash "$KERNEL/test/build_fillet_defer_census.sh" 2>/dev/null | grep '^BIN=' | tail -1)"
  BIN="${BINLINE#BIN=}"
fi
[ -n "$BIN" ] && [ -x "$BIN" ] || { echo "FATAL: no fillet_defer_census binary" >&2; exit 1; }

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

HEAD_START="$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"

# One process per part, into its own file, so a parallel run cannot interleave
# two partial lines into one corrupt row.
PARTDIR="$OUTDIR/parts"
mkdir -p "$PARTDIR"
export BIN PARTDIR
runone() {
  n="$(basename "$1" .step)"
  if ! "$BIN" "$1" --name="$n" > "$PARTDIR/$n.json" 2> "$PARTDIR/$n.err"; then
    rc=$?
    if ! grep -q "\"part\"" "$PARTDIR/$n.json" 2>/dev/null; then
      printf '{"part":"%s","error":"process_rc_%d"}\n' "$n" "$rc" > "$PARTDIR/$n.json"
    fi
  fi
}
export -f runone
xargs -P "$PJOBS" -I{} bash -c 'runone "$@"' _ {} < "$SAMPLE"

while IFS= read -r step; do
  n="$(basename "$step" .step)"
  if [ -s "$PARTDIR/$n.json" ]; then
    cat "$PARTDIR/$n.json" >> "$RESULTS"
  else
    printf '{"part":"%s","error":"no_row_emitted"}\n' "$n" >> "$RESULTS"
  fi
done < "$SAMPLE"

HEAD_END="$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"

cat > "$OUTDIR/manifest.json" <<JSON
{
  "generated_utc": "$TS",
  "corpus_dir": "$CORPUS",
  "corpus_total": $TOTAL,
  "stride": $STRIDE,
  "realised_n": $NSAMPLE,
  "rows": $(wc -l < "$RESULTS" | tr -d ' '),
  "binary": "$BIN",
  "kernel_head_at_run_start": "$HEAD_START",
  "kernel_head_at_run_end": "$HEAD_END",
  "build_stamp": $(cat "$(dirname "$BIN")/build_stamp.json" 2>/dev/null || echo null)
}
JSON

if [ "$HEAD_START" != "$HEAD_END" ]; then
  echo '{"invalid":"HEAD moved during the run"}' > "$OUTDIR/INVALID.json"
  echo "[fillet-census] HEAD MOVED DURING RUN ($HEAD_START -> $HEAD_END): result INVALID" >&2
  exit 4
fi

echo "[fillet-census] $NSAMPLE parts, $(wc -l < "$RESULTS" | tr -d ' ') rows -> $RESULTS"
