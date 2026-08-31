#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_offsetshape_defer_census.sh — drive test/offsetshape_defer_census over the
# SAME 600-part corpus test/run_corpus_ab_coverage.sh measures, one JSON row per
# part, and print the attribution histogram.
#
# SAMPLING IS A STRIDE, NEVER A PREFIX — same reason as
# run_corpus_ab_coverage.sh: this corpus's ordering is undocumented and a prefix
# of a difficulty-ordered corpus is a biased sample.
#
# Each part runs in its own process, so a crash or a hang inside one part is
# scoped to that part and shows up as a row rather than as a lost run.
#
# usage: test/run_offsetshape_defer_census.sh [N] [OUTDIR]
#   env: CORPUS=<dir>
# Writes OUTDIR/{census.jsonl, manifest.json, histogram.txt}. Exit 0 iff every
# sampled part was attempted.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

N="${1:-600}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${2:-$KERNEL/.build-offsetshape-census/run-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
[ -d "$CORPUS" ] || { echo "FATAL: corpus dir $CORPUS not found" >&2; exit 2; }

BIN="$KERNEL/.build-offsetshape-census/offsetshape_defer_census"
if [ "${SKIP_BUILD:-0}" != "1" ] || [ ! -x "$BIN" ]; then
  out="$(bash "$KERNEL/test/build_offsetshape_defer_census.sh" 2>&1)" || {
    echo "$out" >&2; echo "FATAL: census did not build" >&2; exit 2; }
  BIN="$(printf '%s' "$out" | sed -n 's/^BIN=//p' | tail -1)"
fi
[ -x "$BIN" ] || { echo "FATAL: no census binary" >&2; exit 2; }

mkdir -p "$OUTDIR" || exit 2
LC_ALL=C ls "$CORPUS"/*.step 2>/dev/null | LC_ALL=C sort > "$OUTDIR/corpus.list"
TOTAL="$(wc -l < "$OUTDIR/corpus.list" | tr -d ' ')"
[ "$TOTAL" -gt 0 ] || { echo "FATAL: corpus empty" >&2; exit 2; }
if [ "$N" = "0" ] || [ "$N" = "all" ] || [ "$N" -ge "$TOTAL" ]; then
  cp "$OUTDIR/corpus.list" "$OUTDIR/sample.list"; STRIDE=1
else
  STRIDE=$(( TOTAL / N ))
  [ "$STRIDE" -lt 1 ] && STRIDE=1
  awk -v s="$STRIDE" -v n="$N" 'NR % s == 1 || s == 1 { if (c++ < n) print }' \
      "$OUTDIR/corpus.list" > "$OUTDIR/sample.list"
fi
NS="$(wc -l < "$OUTDIR/sample.list" | tr -d ' ')"

cat > "$OUTDIR/manifest.json" <<JSON
{
  "generated_utc": "$TS",
  "corpus_dir": "$CORPUS",
  "corpus_total": $TOTAL,
  "sampling": "stride over the LC_ALL=C sorted file list (NOT a prefix)",
  "stride": $STRIDE,
  "requested_n": $N,
  "realised_n": $NS,
  "binary": "$BIN",
  "kernel_head": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"
}
JSON

: > "$OUTDIR/census.jsonl"
i=0
while IFS= read -r f; do
  i=$((i + 1))
  "$BIN" "$f" >> "$OUTDIR/census.jsonl" 2>/dev/null \
    || echo "{\"part\":\"$(basename "$f" .step)\",\"error\":\"probe_died\"}" >> "$OUTDIR/census.jsonl"
  [ $((i % 100)) -eq 0 ] && echo "[census] $i/$NS" >&2
done < "$OUTDIR/sample.list"

ROWS="$(wc -l < "$OUTDIR/census.jsonl" | tr -d ' ')"
python3 - "$OUTDIR" <<'PY' | tee "$OUTDIR/histogram.txt"
import json, sys, collections, os
d = sys.argv[1]
rows = [json.loads(l) for l in open(os.path.join(d, "census.jsonl")) if l.strip()]
err = [r for r in rows if "error" in r]
ok  = [r for r in rows if "error" not in r]
print("parts: %d   probe errors: %d" % (len(rows), len(err)))
st = collections.Counter(r["status"] for r in ok)
print("status: " + "  ".join("%s:%d" % kv for kv in sorted(st.items())))
print()
print("== native defer attribution (the ENGINE's own label) ==")
c = collections.Counter(r["reason"] for r in ok if r["status"] == "DEFER")
tot = sum(c.values())
for k, v in c.most_common():
    print("%5d  %5.1f%%  %s" % (v, 100.0 * v / max(1, tot), k))
print()
print("== PREDICTION ONLY: would a mixed planar+quadric guard set admit it? ==")
e = collections.Counter("ELIGIBLE" if r["mixed_eligible_PREDICTION"] else
                        r["mixed_block_PREDICTION"] for r in ok)
for k, v in e.most_common():
    print("%5d  %5.1f%%  %s" % (v, 100.0 * v / max(1, len(ok)), k))
print()
print("== eligibility crossed with the engine's reason ==")
x = collections.Counter((r["reason"] or r["status"],
                         r["mixed_eligible_PREDICTION"]) for r in ok)
for (reason, elig), v in sorted(x.items(), key=lambda kv: -kv[1]):
    print("%5d  elig=%-5s  %s" % (v, elig, reason))
PY

echo "[census] $ROWS rows -> $OUTDIR" >&2
[ "$ROWS" -eq "$NS" ] || exit 1
exit 0
