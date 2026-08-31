#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thicksolid_input_census.sh — drive test/thicksolid_input_census over the
# whole 600-part corpus and write one JSONL row per part.
#
# Same corpus and the same LC_ALL=C sorted order as run_corpus_ab_coverage.sh,
# so a row here joins a row there on `part`. NO SAMPLING: the whole corpus is
# run, because the point is to say what the 593 native deferrals are made of and
# a sample cannot attribute a named bucket.
#
# usage: test/run_thicksolid_input_census.sh [OUTFILE]
# env:   CORPUS=<dir>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OUT="${1:-$KERNEL/.build-corpus-ab/thicksolid_input_census.jsonl}"
BIN="$KERNEL/.build-corpus-ab/thicksolid_input_census"

if [ ! -x "$BIN" ]; then
  bash "$KERNEL/test/build_thicksolid_input_census.sh" >/dev/null || exit 2
fi
[ -d "$CORPUS" ] || { echo "FATAL: corpus not found: $CORPUS" >&2; exit 2; }

: > "$OUT"
n=0
while IFS= read -r f; do
  "$BIN" "$f" >> "$OUT" 2>/dev/null
  n=$((n + 1))
done < <(LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort)

echo "[input-census] $n part(s) -> $OUT" >&2
exit 0
