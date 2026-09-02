#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_draft_local_neighbour_census.sh — WHICH surface does the drafted wall meet?
#
# The general draft engine's dominant defer is "a drafted wall meets a non-planar
# face". That single reason covers three completely different pieces of work: a
# plane section of a CYLINDER is an ellipse, of a CONE a general conic, of a
# SPLINE neither, and each needs a different construction on the neighbour. A
# count of "non-planar" cannot size any of them, so it cannot decide what to
# build next. This censuses the kinds, on exactly the parts that hit the defer,
# and reports what OCCT manages on the same parts — which is the real gap.
#
# usage: test/run_draft_local_neighbour_census.sh <run-dir-of-a-completed-probe>
#   env: CORPUS=<dir>  BIN=<probe binary>
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

RUNDIR="${1:-}"
[ -n "$RUNDIR" ] && [ -f "$RUNDIR/results.jsonl" ] || {
  echo "usage: $0 <run-dir containing results.jsonl>" >&2; exit 2; }
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
BIN="${BIN:-$KERNEL/.build-draft-local/draft_local_probe}"
[ -x "$BIN" ] || { echo "FATAL: no probe binary at $BIN" >&2; exit 2; }

OUT="$RUNDIR/neighbour_census.jsonl"
: > "$OUT"

PARTS="$(python3 - "$RUNDIR/results.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: r = json.loads(line)
    except Exception: continue
    if r.get('status') == 'DEFER' and 'non-planar' in r.get('reason', ''):
        print(r['part'])
PY
)"
N="$(printf '%s\n' "$PARTS" | grep -c . )"
echo "[nb-census] $N part(s) deferred on 'a drafted wall meets a non-planar face'"
[ "$N" -gt 0 ] || { echo "[nb-census] nothing to census"; exit 0; }

for p in $PARTS; do
  [ -n "$p" ] || continue
  "$BIN" "$CORPUS/$p.step" --name="$p" >> "$OUT" 2>/dev/null \
    || printf '{"part":"%s","error":"census_rc"}\n' "$p" >> "$OUT"
done

python3 - "$OUT" <<'PY'
import json, sys, collections
rows = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: rows.append(json.loads(line))
    except Exception: pass
ap = [r for r in rows if r.get('applicable')]
print(f"[nb-census] {len(ap)} parts")
kinds = collections.Counter()
for r in ap:
    for tok in (r.get('wall_neighbours') or '').split(','):
        if not tok: continue
        k, _, n = tok.partition(':')
        if k != 'plane': kinds[k] += int(n or 0)
print("  NON-PLANAR surfaces the drafted wall meets, by kind (faces, not parts):")
for k, v in kinds.most_common(): print(f"    {v:5d}  {k}")
partkind = collections.Counter()
for r in ap:
    ks = sorted({t.partition(':')[0] for t in (r.get('wall_neighbours') or '').split(',')
                 if t and t.partition(':')[0] != 'plane'})
    partkind['+'.join(ks) or '(none)'] += 1
print("  parts, by the SET of non-planar kinds their wall meets:")
for k, v in partkind.most_common(): print(f"    {v:5d}  {k}")
occt = sum(1 for r in ap if r.get('occt_ok'))
print(f"  OCCT drafts {occt} of these {len(ap)}; the other {len(ap)-occt} neither engine does.")
print(f"  ==> the TRUE remaining gap to OCCT is {occt} parts, all of them this defer.")
PY
