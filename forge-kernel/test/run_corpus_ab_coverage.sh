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

# --selftest-guard: prove BOTH tree checks above can actually fail. A guard that
# has never been seen to fire is indistinguishable from one that cannot.
if [ "${1:-}" = "--selftest-guard" ]; then
  KBIN="$KERNEL/.build-corpus-ab/corpus_ab_coverage"
  STAMPF="$KERNEL/.build-corpus-ab/build_stamp.json"
  if [ ! -x "$KBIN" ] || [ ! -f "$STAMPF" ]; then
    echo "FATAL: build first (test/build_corpus_ab_coverage.sh)" >&2; exit 2
  fi
  bad=0
  cp "$STAMPF" "$STAMPF.bak"
  sed -i '' 's/"git_head": "[0-9a-f]*"/"git_head": "0000000000000000000000000000000000000000"/' "$STAMPF"
  SKIP_BUILD=1 bash "$0" 1 "${TMPDIR:-/tmp}/corpus_ab_guard1.$$" >/dev/null 2>&1
  rc=$?
  mv "$STAMPF.bak" "$STAMPF"
  rm -rf "${TMPDIR:-/tmp}/corpus_ab_guard1.$$"
  if [ "$rc" = "3" ]; then echo "  build-SHA-vs-HEAD guard    exit 3  ok"
  else echo "  build-SHA-vs-HEAD guard    exit $rc  EXPECTED 3 — THE GUARD DID NOT FIRE"; bad=1; fi

  G2="${TMPDIR:-/tmp}/corpus_ab_guard2.$$"
  FORGE_AB_FAKE_END_HEAD=1111111111111111111111111111111111111111 \
    SKIP_BUILD=1 bash "$0" 1 "$G2" >/dev/null 2>&1
  rc=$?
  if [ "$rc" = "4" ] && [ -f "$G2/INVALID.json" ]; then
    echo "  head-moved-during-run gate exit 4  ok (INVALID.json written)"
  else
    echo "  head-moved-during-run gate exit $rc  EXPECTED 4 with INVALID.json — DID NOT FIRE"; bad=1
  fi
  rm -rf "$G2"
  [ "$bad" = "0" ] && echo "PASS: both tree guards fire" || echo "FAIL: a tree guard is inert"
  exit "$bad"
fi

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
# SKIP_BUILD=1 reuses an already-built binary. It exists for two reasons: to
# re-run a corpus without a rebuild, and because it is the ONLY path on which the
# stamp check below can fire — the build script re-stamps with the current HEAD,
# so a check placed after an unconditional build can never disagree with it. A
# guard that cannot fire is not a guard, and test/run_corpus_ab_coverage.sh
# --selftest-guard exercises this path to prove it does.
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  BIN="${BIN:-$KERNEL/.build-corpus-ab/corpus_ab_coverage}"
else
  BINLINE="$(bash "$KERNEL/test/build_corpus_ab_coverage.sh" 2>&1 | tee /dev/stderr | grep '^BIN=' | tail -1)"
  BIN="${BINLINE#BIN=}"
fi
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "FATAL: no corpus_ab_coverage binary — a gate that cannot build cannot fail" >&2
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
  "kernel_head_at_run": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)",
  "build_stamp": $(cat "$(dirname "$BIN")/build_stamp.json" 2>/dev/null || echo null)
}
JSON

# ── TWO TREE CHECKS, and each one can actually fire ─────────────────────────
# `kernel_head_at_run` is what HEAD says NOW; `build_stamp.git_head` is what it
# said when the binary was COMPILED, and the second is the one the numbers belong
# to. The first full-corpus run of this harness was compiled from one commit and
# measured after the worktree had moved to another — three of the ten engines
# under test differ between them — and it was thrown away.
#
# CHECK 1 (before the run): the binary's tree vs HEAD. Reachable only under
# SKIP_BUILD=1, because an unconditional build re-stamps first; that is stated
# rather than left as a guard that quietly never runs.
BUILD_HEAD="$(sed -n 's/.*"git_head": "\([0-9a-f]*\)".*/\1/p' "$(dirname "$BIN")/build_stamp.json" 2>/dev/null)"
RUN_HEAD="$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"
if [ -n "$BUILD_HEAD" ] && [ "$BUILD_HEAD" != "$RUN_HEAD" ]; then
  echo "FATAL: the binary was built from $BUILD_HEAD but HEAD is now $RUN_HEAD." >&2
  echo "       Rebuild with FORCE=1 — a coverage number measured against the wrong" >&2
  echo "       tree is worse than no number." >&2
  exit 3
fi

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

# CHECK 2 (after the run): did the tree move WHILE the corpus was being measured?
# This is the check that catches what actually went wrong the first time — the run
# was launched, the worktree was then switched to another commit under it, and the
# already-loaded binary carried on producing numbers for a tree no longer on disk.
# No check placed before the loop can see that. FORGE_AB_FAKE_END_HEAD exists so
# this branch is exercisable (--selftest-guard); it changes nothing else.
END_HEAD="${FORGE_AB_FAKE_END_HEAD:-$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)}"
if [ "$END_HEAD" != "$RUN_HEAD" ]; then
  echo "FATAL: HEAD moved DURING the run ($RUN_HEAD -> $END_HEAD)." >&2
  echo "       These results span two trees and are not usable. Re-run on a settled tree." >&2
  echo '{"invalid":true,"reason":"head_moved_during_run","head_at_start":"'"$RUN_HEAD"'","head_at_end":"'"$END_HEAD"'"}' \
    > "$OUTDIR/INVALID.json"
  exit 4
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "[corpus-ab] node not found — results are in $RESULTS; aggregate with test/corpus_ab_aggregate.mjs" >&2
  exit 0
fi
"$NODE" "$KERNEL/test/corpus_ab_aggregate.mjs" "$RESULTS" \
  --json "$OUTDIR/summary.json" --md "$OUTDIR/summary.md"
exit 0
