#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_corpus_ab_coverage.sh — drive test/corpus_ab_coverage over a real corpus
# and produce the per-family coverage table.
#
# THE GATE THIS ANSWERS. Ten of the twelve FORGE_*_DROP_* options in
# forge-kernel/CMakeLists.txt default OFF, and every one of them names the same
# flip condition: "native success rate >= the measured OCCT baseline"
# (reports/TKOFFSET_DECOMPOSITION.md §5 step 6, quoted at CMakeLists.txt:432,
# :475, :555). That is a COVERAGE measurement over real parts, and until this
# script existed nothing in the tree made it.
#
# CORPUS. 600 reference solids from the expert3d v5cap e600 run:
#   /Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps
# Override with CORPUS=<dir>.
#
# ★ SAMPLING IS A STRIDE, NEVER A PREFIX. The file list is sorted with
#   LC_ALL=C so the order is reproducible, and the sample takes every
#   floor(total/N)-th entry starting at offset 0. A PREFIX of a corpus that is
#   ordered by difficulty is a biased sample — this programme has already
#   measured a prefix reading 0.2423 where the full set read 0.3617 — and this
#   corpus's ordering is not documented, so a stride is used rather than
#   assuming the order is benign. The stride, the offset and the realised
#   sample size are all written into the manifest next to the results.
#
# NO `timeout` ON macOS AND NO `sleep` HERE. The per-arm deadline lives inside
# the binary (a forked child per arm, killed by the parent), and the whole-part
# deadline is the binary's own alarm(). This script therefore never needs a
# watchdog of its own and never blocks on one.
#
# usage:
#   test/run_corpus_ab_coverage.sh [N] [OUTDIR]
#     N       parts to sample (default 60; 0 or "all" = the whole corpus)
#     OUTDIR  where results land (default forge-kernel/.build-corpus-ab/run-<ts>)
#   env: CORPUS=<dir> FAMILIES=A,B ARM_TIMEOUT=20 PART_TIMEOUT=300 OFFSET=0
#
# Writes OUTDIR/{results.jsonl, manifest.json, summary.md, summary.json, run.log}
# and prints summary.md. Exit 0 iff every sampled part was attempted.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

N="${1:-60}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${2:-$KERNEL/.build-corpus-ab/run-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
FAMILIES="${FAMILIES:-}"
ARM_TIMEOUT="${ARM_TIMEOUT:-20}"
PART_TIMEOUT="${PART_TIMEOUT:-300}"
OFFSET="${OFFSET:-0}"

if [ ! -d "$CORPUS" ]; then
  echo "FATAL: corpus dir not found: $CORPUS" >&2
  exit 2
fi

# ── build (and, inside the build, run the containment self-test) ────────────
BINLINE="$(bash "$KERNEL/test/build_corpus_ab_coverage.sh" 2>&1 | tee /dev/stderr | grep '^BIN=' | tail -1)"
BIN="${BINLINE#BIN=}"
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "FATAL: build_corpus_ab_coverage.sh produced no binary — a gate that cannot build cannot fail" >&2
  exit 1
fi

mkdir -p "$OUTDIR" || exit 2
RESULTS="$OUTDIR/results.jsonl"
LOG="$OUTDIR/run.log"
: > "$RESULTS"
: > "$LOG"

# ── the stride sample ───────────────────────────────────────────────────────
ALL="$OUTDIR/corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$ALL"
TOTAL="$(wc -l < "$ALL" | tr -d ' ')"
if [ "$TOTAL" -eq 0 ]; then echo "FATAL: no .step files in $CORPUS" >&2; exit 2; fi

case "$N" in
  all|0) N="$TOTAL" ;;
esac
[ "$N" -gt "$TOTAL" ] && N="$TOTAL"
STRIDE=$(( TOTAL / N ))
[ "$STRIDE" -lt 1 ] && STRIDE=1

SAMPLE="$OUTDIR/sample.list"
awk -v s="$STRIDE" -v off="$OFFSET" -v want="$N" \
    'NR > off && (NR - 1 - off) % s == 0 && kept < want { print; kept++ }' "$ALL" > "$SAMPLE"
NSAMPLE="$(wc -l < "$SAMPLE" | tr -d ' ')"

cat > "$OUTDIR/manifest.json" <<JSON
{
  "generated_utc": "$TS",
  "corpus_dir": "$CORPUS",
  "corpus_total": $TOTAL,
  "sampling": "stride over the LC_ALL=C sorted file list (NOT a prefix: this corpus's ordering is undocumented and a prefix of a difficulty-ordered corpus is a biased sample)",
  "stride": $STRIDE,
  "offset": $OFFSET,
  "requested_n": $N,
  "realised_n": $NSAMPLE,
  "families": "${FAMILIES:-all}",
  "arm_timeout_sec": $ARM_TIMEOUT,
  "part_timeout_sec": $PART_TIMEOUT,
  "binary": "$BIN",
  "kernel_head": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"
}
JSON

FAMARG=""
[ -n "$FAMILIES" ] && FAMARG="--families=$FAMILIES"

echo "[corpus-ab] corpus $TOTAL parts, sampling $NSAMPLE with stride $STRIDE offset $OFFSET" | tee -a "$LOG"
echo "[corpus-ab] out: $OUTDIR" | tee -a "$LOG"

i=0
failed=0
START="$(date +%s)"
while IFS= read -r step; do
  i=$((i + 1))
  name="$(basename "$step" .step)"
  # shellcheck disable=SC2086
  if ! "$BIN" "$step" --name="$name" --arm-timeout="$ARM_TIMEOUT" \
        --part-timeout="$PART_TIMEOUT" $FAMARG >> "$RESULTS" 2>> "$LOG"; then
    rc=$?
    # A part-level failure is DATA, not a reason to stop: the binary already
    # printed an {"error":...} row for a bad import, and a non-zero rc with no
    # row (its own alarm fired, or it died) is recorded here so the aggregator's
    # part count and the sample size cannot silently disagree.
    if ! grep -q "\"part\":\"$name\"" "$RESULTS"; then
      printf '{"part":"%s","error":"process_rc_%d"}\n' "$name" "$rc" >> "$RESULTS"
    fi
    failed=$((failed + 1))
    echo "[corpus-ab] part $name exited $rc" >> "$LOG"
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "[corpus-ab] $i/$NSAMPLE  ($(( $(date +%s) - START ))s, $failed part-level failures)" | tee -a "$LOG"
  fi
done < "$SAMPLE"

ELAPSED=$(( $(date +%s) - START ))
echo "[corpus-ab] done: $i parts in ${ELAPSED}s, $failed part-level failures" | tee -a "$LOG"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "[corpus-ab] node not found — results are in $RESULTS; aggregate with test/corpus_ab_aggregate.mjs" >&2
  exit 0
fi
"$NODE" "$KERNEL/test/corpus_ab_aggregate.mjs" "$RESULTS" \
  --json "$OUTDIR/summary.json" --md "$OUTDIR/summary.md"
exit 0
