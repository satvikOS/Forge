#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thicksolid_bar_census.sh — drive test/thicksolid_bar_census over the whole
# 600-part corpus and write one JSONL row per part.
#
# THIS NEEDS THE CORPUS AND IS THEREFORE NOT A CI GATE. The corpus-free half of
# the same finding is test/run_ab_native_thicksolid_bar_fixture.sh, which run_ab_all.sh
# ratchets. Committed results are in reports/corpus_ab/thicksolid_bar/.
#
# Same corpus and the same LC_ALL=C sorted order as run_corpus_ab_coverage.sh, so
# a row here joins a row there on `part`. NO SAMPLING: the whole corpus is run.
#
# usage: test/run_thicksolid_bar_census.sh [OUTFILE] [MODE]
#   MODE  census (default) | sweep   — sweep re-runs the same derived operation
#                                      at wall/{1,2,4,...,128}
# env:   CORPUS=<dir>  TIMEOUT=<sec>  EXTRA="--no-bop --no-fix"
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
MODE="${2:-census}"
OUT="${1:-$KERNEL/.build-corpus-ab/thicksolid_bar_$MODE.jsonl}"
TIMEOUT="${TIMEOUT:-180}"
EXTRA="${EXTRA:-}"
BIN="$KERNEL/.build-corpus-ab/thicksolid_bar_census"

if [ ! -x "$BIN" ]; then
  bash "$KERNEL/test/build_thicksolid_bar_census.sh" >/dev/null || exit 2
fi
[ -d "$CORPUS" ] || { echo "FATAL: corpus not found: $CORPUS" >&2; exit 2; }

: > "$OUT"
n=0
# NOT `for f in $(...)`: zsh does not word-split, and a glob that matches nothing
# aborts the whole command. find + read is the form that works in both shells.
while IFS= read -r f; do
  name="$(basename "$f" .step)"
  # shellcheck disable=SC2086
  "$BIN" "$f" --name="$name" --mode="$MODE" --timeout="$TIMEOUT" $EXTRA >> "$OUT" 2>/dev/null
  rc=$?
  # A part-level failure is DATA. The probe contains OCCT in a forked child and
  # reports CRASH/TIMEOUT itself, so a non-zero rc here means the PROBE died and
  # must not be silently absent from the row count.
  [ "$rc" != "0" ] && printf '{"part":"%s","error":"process_rc_%d"}\n' "$name" "$rc" >> "$OUT"
  n=$((n + 1))
  [ $((n % 100)) -eq 0 ] && echo "[bar-census] $n" >&2
done < <(LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort)

echo "[bar-census] $n part(s) -> $OUT" >&2
exit 0
