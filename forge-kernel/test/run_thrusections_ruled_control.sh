#!/usr/bin/env bash
# run_thrusections_ruled_control.sh — THE POSITIVE CONTROL for family D's ruled path.
#
# "New code was added and coverage went up" is an inference. This measures it: the
# SAME binary is run twice over the SAME parts, once normally and once with
# FORGE_THRUSECTIONS_NO_RULED=1 (which makes thruSectionsRuledCurved defer at its
# first line). Every part that builds in arm A and defers in arm B was built BY
# THIS PATH and by nothing else.
#
# It also asserts the direction: the control may only ever REMOVE coverage. A part
# that builds with the path disabled and fails with it enabled would mean the path
# is interfering with the two engines ahead of it, which the "strictly additive"
# claim forbids.
#
# usage: test/run_thrusections_ruled_control.sh [N]   (N parts, default all)
# exit: 0 iff arm B is a strict subset of arm A and the difference is non-empty.
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2
BIN="${BIN:-$KERNEL/.build-corpus-ab/corpus_ab_coverage}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
OUT="${OUT:-$KERNEL/.build-corpus-ab/ruled_control}"
[ -x "$BIN" ] || { echo "FATAL: build first (test/build_corpus_ab_coverage.sh)" >&2; exit 2; }
mkdir -p "$OUT" || exit 2

N="${1:-0}"
parts=()
while IFS= read -r f; do parts+=("$(basename "$f" .step)"); done \
  < <(LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort)
[ "$N" -gt 0 ] 2>/dev/null && parts=("${parts[@]:0:$N}")

run() {  # $1 = out file, $2 = value of FORGE_THRUSECTIONS_NO_RULED ("" = unset)
  : > "$1"
  local p
  for p in "${parts[@]}"; do
    if [ -n "$2" ]; then
      FORGE_THRUSECTIONS_NO_RULED="$2" "$BIN" "$CORPUS/$p.step" --name="$p" \
        --arm-timeout=20 --part-timeout=120 --families=THRUSECTIONS >> "$1" 2>/dev/null
    else
      "$BIN" "$CORPUS/$p.step" --name="$p" --arm-timeout=20 --part-timeout=120 \
        --families=THRUSECTIONS >> "$1" 2>/dev/null
    fi
  done
}
echo "[ruled-control] arm A: ruled path ON  (${#parts[@]} parts)"; run "$OUT/on.jsonl"  ""
echo "[ruled-control] arm B: ruled path OFF (${#parts[@]} parts)"; run "$OUT/off.jsonl" "1"

python3 - "$OUT/on.jsonl" "$OUT/off.jsonl" <<'PY'
import json, sys
def ok(p):
    d = {}
    for l in open(p):
        r = json.loads(l)
        if r.get('family') == 'THRUSECTIONS':
            d[r['part']] = r
    return d
a, b = ok(sys.argv[1]), ok(sys.argv[2])
A = {p for p, r in a.items() if r['native']['status'] == 'OK'}
B = {p for p, r in b.items() if r['native']['status'] == 'OK'}
gained, lost = sorted(A - B), sorted(B - A)
print(f"parts measured      : {len(a)}")
print(f"native OK, path ON  : {len(A)}")
print(f"native OK, path OFF : {len(B)}")
print(f"attributable to the ruled path: {len(gained)}")
print(f"  {' '.join(gained[:20])}{' ...' if len(gained) > 20 else ''}")
print(f"built ONLY with the path disabled (must be 0): {len(lost)}")
val = sum(1 for p in gained if a[p]['native']['valid'] == 1)
print(f"of the attributable parts, BRepCheck_Analyzer valid: {val}/{len(gained)}")
labs = {}
for p in gained:
    labs[b[p]['native']['note']] = labs.get(b[p]['native']['note'], 0) + 1
print("their defer label with the path OFF:")
for k, v in sorted(labs.items(), key=lambda kv: -kv[1]):
    print(f"  {v:4d}  {k}")
sys.exit(0 if (gained and not lost) else 1)
PY
