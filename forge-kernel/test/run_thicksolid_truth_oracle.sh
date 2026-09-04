#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thicksolid_truth_oracle.sh — drive test/thicksolid_truth_oracle over the
# whole 600-part corpus.
#
# The oracle links NO offset engine. It evaluates the DEFINITION of a hollow —
# the erosion { p in int(S) : d(p, dS\F) > t } — by Monte Carlo for volume and by
# voxels for topology, so it can say what the correct answer IS on a family where
# reports/corpus_ab/THICKSOLID_HONEST_BAR.md measures neither engine producing one.
#
# Every row carries its own control: the same Monte-Carlo sample estimates vol(S),
# which BRepGProp knows exactly. Check that column before quoting a row —
# |mc_src_vol - exact_src_vol| / mc_se should be O(1), and it is over 596 of the
# 600 committed rows.
#
# usage: test/run_thicksolid_truth_oracle.sh [OUTFILE]
# env:   CORPUS=<dir>  SAMPLES=<n>  VOXPERWALL=<n>  VOXCAP=<n>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OUT="${1:-$KERNEL/.build-corpus-ab/thicksolid_truth_oracle.jsonl}"
BIN="$KERNEL/.build-corpus-ab/thicksolid_truth_oracle"
SAMPLES="${SAMPLES:-300000}"
VOXPERWALL="${VOXPERWALL:-3}"
VOXCAP="${VOXCAP:-40000000}"

if [ ! -x "$BIN" ]; then
  bash "$KERNEL/test/build_thicksolid_truth_oracle.sh" >/dev/null || exit 2
fi
[ -d "$CORPUS" ] || { echo "FATAL: corpus not found: $CORPUS" >&2; exit 2; }

: > "$OUT"
n=0
while IFS= read -r f; do
  name="$(basename "$f" .step)"
  "$BIN" "$f" --name="$name" --samples="$SAMPLES" \
        --vox-per-wall="$VOXPERWALL" --vox-cap="$VOXCAP" >> "$OUT" 2>/dev/null
  rc=$?
  [ "$rc" != "0" ] && printf '{"part":"%s","error":"process_rc_%d"}\n' "$name" "$rc" >> "$OUT"
  n=$((n + 1))
  [ $((n % 100)) -eq 0 ] && echo "[truth-oracle] $n" >&2
done < <(LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort)

echo "[truth-oracle] $n part(s) -> $OUT" >&2
exit 0
