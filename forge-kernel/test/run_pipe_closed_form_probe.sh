#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_pipe_closed_form_probe.sh — drive test/pipe_closed_form_probe over the
# same 600-part corpus the coverage A/B scores, and answer one question:
#
#   For TKOffset families E (PIPE) and F (PIPESHELL), is the OCCT arm that the
#   flip gate compares against actually COMPUTING THE SWEPT SOLID?
#
# The gate in CMakeLists.txt reads `native % >= occt %` where both percentages
# count "the arm returned a shape". Nothing in that comparison looks at whether
# the shape is right. This script measures OCCT's shape against two closed
# forms — the mitre A*(L1+L2) and the transformed-transition A*(L1+L2*cos30) —
# so the denominator of that gate can be read for what it is.
#
# SAMPLING is the SAME stride device as run_corpus_ab_coverage.sh, for the same
# reason: a prefix of a corpus whose ordering is undocumented is a biased
# sample, and this programme has already measured a prefix reading 0.2423 where
# the full set read 0.3617. Default is the WHOLE corpus.
#
# NO WATCHDOG IS NEEDED. The probe does one STEP import and one MakePipe per
# part and exits; there is no fork, no alarm and nothing to contain. A part that
# crashes the probe is reported as a crash rather than silently skipped.
#
# usage:  test/run_pipe_closed_form_probe.sh [N] [OUTDIR]
#           N  parts to sample (default 0 = all)
#         env: CORPUS=<dir> SKIP_BUILD=1
# Writes OUTDIR/{results.jsonl, manifest.json, summary.md} and prints summary.md.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

N="${1:-0}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${2:-$KERNEL/.build-corpus-ab/pipe-probe-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"

[ -d "$CORPUS" ] || { echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; }

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  BIN="$KERNEL/.build-corpus-ab/pipe_closed_form_probe"
else
  BINLINE="$(bash "$KERNEL/test/build_pipe_closed_form_probe.sh" 2>&1 | tee /dev/stderr | grep '^BIN=' | tail -1)"
  BIN="${BINLINE#BIN=}"
fi
[ -n "$BIN" ] && [ -x "$BIN" ] || {
  echo "FATAL: no probe binary — a gate that cannot build cannot fail" >&2; exit 1; }

# The binary must have been built from the tree we are about to attribute the
# numbers to. This repo has discarded a full corpus run for exactly this.
STAMP="$KERNEL/.build-corpus-ab/pipe_probe_stamp.json"
HEAD_SHA="$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"
BUILT_SHA="$(sed -n 's/.*"git_head": "\([0-9a-f]*\)".*/\1/p' "$STAMP" 2>/dev/null)"
if [ "$BUILT_SHA" != "$HEAD_SHA" ]; then
  echo "FATAL: probe was built at $BUILT_SHA but HEAD is $HEAD_SHA." >&2
  echo "       Rebuild, or the numbers belong to a tree that is not this one." >&2
  exit 3
fi

mkdir -p "$OUTDIR" || exit 2
RESULTS="$OUTDIR/results.jsonl"; : > "$RESULTS"

ALL="$OUTDIR/corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$ALL"
TOTAL="$(wc -l < "$ALL" | tr -d ' ')"
[ "$TOTAL" -gt 0 ] || { echo "FATAL: no .step files in $CORPUS" >&2; exit 2; }
case "$N" in all|0) N="$TOTAL" ;; esac
[ "$N" -gt "$TOTAL" ] && N="$TOTAL"
STRIDE=$(( TOTAL / N )); [ "$STRIDE" -lt 1 ] && STRIDE=1
SAMPLE="$OUTDIR/sample.list"
awk -v s="$STRIDE" -v want="$N" 'NR > 0 && (NR - 1) % s == 0 && kept < want { print; kept++ }' \
    "$ALL" > "$SAMPLE"
NSAMPLE="$(wc -l < "$SAMPLE" | tr -d ' ')"

crashes=0
while IFS= read -r f; do
  name="$(basename "$f" .step)"
  out="$("$BIN" "$f" --name="$name" 2>/dev/null)"
  rc=$?
  if [ -n "$out" ]; then
    printf '%s\n' "$out" >> "$RESULTS"
  else
    printf '{"part":"%s","error":"probe_crash_or_silent","rc":%d}\n' "$name" "$rc" >> "$RESULTS"
    crashes=$(( crashes + 1 ))
  fi
done < "$SAMPLE"

cat > "$OUTDIR/manifest.json" <<JSON
{
  "generated_utc": "$TS",
  "corpus_dir": "$CORPUS",
  "corpus_total": $TOTAL,
  "sampling": "stride over the LC_ALL=C sorted file list (NOT a prefix)",
  "stride": $STRIDE,
  "requested_n": $N,
  "realised_n": $NSAMPLE,
  "rows": $(wc -l < "$RESULTS" | tr -d ' '),
  "silent_or_crashed_parts": $crashes,
  "git_head": "$HEAD_SHA",
  "build_stamp": $(cat "$STAMP"),
  "binary": "$BIN"
}
JSON

python3 "$KERNEL/test/pipe_closed_form_aggregate.py" "$RESULTS" > "$OUTDIR/summary.md" 2>&1
cat "$OUTDIR/summary.md"
echo
echo "results: $RESULTS"
[ "$crashes" -eq 0 ]
