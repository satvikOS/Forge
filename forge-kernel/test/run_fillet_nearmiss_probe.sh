#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_fillet_nearmiss_probe.sh — drive test/fillet_nearmiss_probe over the same
# 600-part corpus test/run_corpus_ab_coverage.sh uses, one PROCESS PER PART.
#
# ONE PROCESS PER PART IS THE CONTAINMENT. OCCT dies on this corpus: measured
# here, `ShapeCustom::SweptToElementary` SIGSEGVs on the very first part tried
# (ho1219) while working on a synthetic box, and the A/B's own baseline already
# records OCCT crashing in THICKSOLID and OFFSETSHAPE. A crash therefore costs
# that part's row and nothing else, and the row is written as an explicit
# {"error":"process_rc_N"} so the part count and the sample size cannot silently
# disagree.
#
# THE TREE GUARD is the A/B's, for the A/B's reason: a number measured against a
# binary built from a different commit is worse than no number.
#
# usage: test/run_fillet_nearmiss_probe.sh [N|all] [OUTDIR]
#   env: CORPUS=<dir> SKIP_BUILD=1 GRID=12
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

N="${1:-60}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${2:-$KERNEL/.build-corpus-ab/probe-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
GRID="${GRID:-12}"
[ -d "$CORPUS" ] || { echo "FATAL: corpus dir not found: $CORPUS" >&2; exit 2; }

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  BIN="${BIN:-$KERNEL/.build-corpus-ab/fillet_nearmiss_probe}"
else
  BINLINE="$(bash "$KERNEL/test/build_fillet_nearmiss_probe.sh" 2>/dev/null | grep '^BIN=' | tail -1)"
  BIN="${BINLINE#BIN=}"
fi
[ -n "$BIN" ] && [ -x "$BIN" ] || { echo "FATAL: no probe binary" >&2; exit 1; }

STAMPF="$(dirname "$BIN")/probe_build_stamp.json"
BUILD_HEAD="$(sed -n 's/.*"git_head": "\([0-9a-f]*\)".*/\1/p' "$STAMPF" 2>/dev/null)"
RUN_HEAD="$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"
if [ -n "$BUILD_HEAD" ] && [ "$BUILD_HEAD" != "$RUN_HEAD" ]; then
  echo "FATAL: probe built from $BUILD_HEAD but HEAD is $RUN_HEAD — rebuild." >&2
  exit 3
fi

mkdir -p "$OUTDIR" || exit 2
ALL="$OUTDIR/corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$ALL"
TOTAL="$(wc -l < "$ALL" | tr -d ' ')"
[ "$TOTAL" -gt 0 ] || { echo "FATAL: no .step files in $CORPUS" >&2; exit 2; }
case "$N" in all|0) N="$TOTAL" ;; esac
[ "$N" -gt "$TOTAL" ] && N="$TOTAL"
STRIDE=$(( TOTAL / N )); [ "$STRIDE" -lt 1 ] && STRIDE=1
SAMPLE="$OUTDIR/sample.list"
awk -v s="$STRIDE" -v want="$N" 'NR>0 && (NR-1)%s==0 && kept<want {print; kept++}' "$ALL" > "$SAMPLE"
NS="$(wc -l < "$SAMPLE" | tr -d ' ')"

cat > "$OUTDIR/manifest.json" <<JSON
{
  "generated_utc": "$TS",
  "corpus_dir": "$CORPUS",
  "corpus_total": $TOTAL,
  "sampling": "stride over the LC_ALL=C sorted list (NOT a prefix)",
  "stride": $STRIDE,
  "requested_n": $N,
  "realised_n": $NS,
  "grid": $GRID,
  "binary": "$BIN",
  "kernel_head_at_run": "$RUN_HEAD",
  "build_stamp": $(cat "$STAMPF" 2>/dev/null || echo null)
}
JSON

RESULTS="$OUTDIR/results.jsonl"; : > "$RESULTS"
LOG="$OUTDIR/run.log"; : > "$LOG"
i=0; failed=0; START="$(date +%s)"
while IFS= read -r step; do
  i=$((i+1))
  name="$(basename "$step" .step)"
  if ! "$BIN" "$step" --name="$name" --grid="$GRID" >> "$RESULTS" 2>> "$LOG"; then
    rc=$?
    if ! grep -q "\"part\":\"$name\"" "$RESULTS"; then
      printf '{"part":"%s","error":"process_rc_%d"}\n' "$name" "$rc" >> "$RESULTS"
    fi
    failed=$((failed+1))
    echo "[probe] part $name exited $rc" >> "$LOG"
  fi
  if [ $((i % 25)) -eq 0 ]; then
    echo "[probe] $i/$NS ($(( $(date +%s) - START ))s, $failed part-level failures)" | tee -a "$LOG"
  fi
done < "$SAMPLE"
echo "[probe] done: $i parts in $(( $(date +%s) - START ))s, $failed part-level failures" | tee -a "$LOG"

# THE ARTEFACT'S OWN GATE. A JSONL a strict reader refuses is not a result. The
# first run of this probe wrote 67 of 600 rows with a UTF-8 sequence cut in half;
# node parsed them (it substitutes) and python did not, so the defect survived a
# whole aggregation pass unnoticed. Checked here, on the file, every run.
if ! python3 -c "
import json,sys
raw=open(sys.argv[1],'rb').read().decode('utf-8')   # strict: raises on a split sequence
n=0
for l in raw.splitlines():
    if l.strip(): json.loads(l); n+=1
print(n)
" "$RESULTS" > "$OUTDIR/rows_parsed.txt" 2>"$OUTDIR/parse.err"; then
  echo "FATAL: results.jsonl is not strictly decodable JSONL:" >&2
  cat "$OUTDIR/parse.err" >&2
  exit 5
fi
PARSED="$(cat "$OUTDIR/rows_parsed.txt")"
if [ "$PARSED" != "$i" ]; then
  echo "FATAL: wrote $i rows but only $PARSED parse — the artefact and the run disagree" >&2
  exit 5
fi
echo "[probe] artefact gate: $PARSED/$i rows parse strictly" | tee -a "$LOG"

END_HEAD="$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"
if [ "$END_HEAD" != "$RUN_HEAD" ]; then
  echo "FATAL: HEAD moved DURING the run ($RUN_HEAD -> $END_HEAD)." >&2
  echo '{"invalid":true,"reason":"head_moved_during_run"}' > "$OUTDIR/INVALID.json"
  exit 4
fi
echo "OUT=$OUTDIR"
exit 0
