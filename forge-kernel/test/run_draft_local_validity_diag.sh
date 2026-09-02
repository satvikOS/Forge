#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_draft_local_validity_diag.sh — is the BRepCheck gate COSTING coverage, or
# CATCHING defects?
#
# The general draft engine refuses to return a solid BRepCheck_Analyzer rejects.
# From outside that refusal, "the gate stopped a real defect" and "the gate threw
# away a good answer" are the SAME observation: a defer. This script separates
# them, on the parts that actually hit it.
#
# METHOD. Take the parts whose row in a completed run_draft_local_probe.sh run
# says reason == "the rebuilt solid is not BRepCheck-valid". Re-run ONLY those,
# with FORGE_DRAFT_LOCAL_SKIP_VALIDITY=1 so the gate is bypassed and the shape it
# rejected is scored against OCCT on the full observable vector. Then:
#
#   * a part that now AGREES WITH OCCT on every observable is coverage the gate
#     is throwing away, and the gate is over-strict;
#   * a part that now disagrees, or that OCCT also refuses to draft, is a defect
#     the gate caught, and the gate is doing its job.
#
# The two answers point at opposite next commits, which is why this is measured
# rather than argued.
#
# usage: test/run_draft_local_validity_diag.sh <run-dir-of-a-completed-probe>
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

OUT="$RUNDIR/validity_diag.jsonl"
: > "$OUT"

# The subset, taken from the run's OWN rows so the two cannot drift apart.
PARTS="$(python3 - "$RUNDIR/results.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: r = json.loads(line)
    except Exception: continue
    if r.get('status') == 'DEFER' and 'not BRepCheck-valid' in r.get('reason', ''):
        print(r['part'])
PY
)"
N="$(printf '%s\n' "$PARTS" | grep -c . )"
echo "[validity-diag] $N part(s) deferred on the BRepCheck gate"
[ "$N" -gt 0 ] || { echo "[validity-diag] nothing to diagnose"; exit 0; }

for p in $PARTS; do
  [ -n "$p" ] || continue
  FORGE_DRAFT_LOCAL_SKIP_VALIDITY=1 "$BIN" "$CORPUS/$p.step" --name="$p" >> "$OUT" 2>/dev/null \
    || printf '{"part":"%s","error":"diag_rc"}\n' "$p" >> "$OUT"
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
print(f"[validity-diag] {len(rows)} rows, {len(ap)} applicable")
built   = [r for r in ap if r.get('status') == 'OK']
agrees  = [r for r in built if r.get('agrees')]
occt_ok = [r for r in ap if r.get('occt_ok')]
in_bad  = [r for r in ap if r.get('in_valid') is False]
print(f"  with the gate bypassed, built      : {len(built)}")
print(f"  of those, AGREE with OCCT          : {len(agrees)}   <-- coverage the gate costs")
print(f"  OCCT itself drafted                : {len(occt_ok)}")
print(f"  parts whose INPUT was already invalid: {len(in_bad)}")
c = collections.Counter()
for r in built:
    if not r.get('agrees'): c.update([x for x in r.get('diff', '').split(',') if x])
if c:
    print("  disagreeing observables among the rest:")
    for k, v in c.most_common(): print(f"    {v:4d}  {k}")
rem = collections.Counter(r.get('reason', '') for r in ap if r.get('status') != 'OK')
if rem:
    print("  still deferring for another reason:")
    for k, v in rem.most_common(): print(f"    {v:4d}  {k}")
PY
