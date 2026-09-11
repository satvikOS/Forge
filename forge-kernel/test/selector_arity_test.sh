#!/bin/bash
# selector_arity_test.sh — a malformed selector is not evidence about the part.
#
# MEASURED on the 2026-09-10 edit benchmark (reports/sweep_20260910T220154): of 12
# BAD_SELECTOR rows, SIX gave three coordinates where `at=` takes two, and THREE of
# those six were reported as "matched no candidate face". That reads as "your part has
# no such feature" when the fault is in the REQUEST, and it is what made selector
# failure look like a grounding problem when half of it is a format problem.
#
# The emptiness test used to run before the `at=` syntax check, so which diagnosis you
# got depended on whether the part happened to have candidate faces.
set -uo pipefail
K="$(cd "$(dirname "$0")/.." && pwd)"
V="${FORGE_VERIFY:-$K/build/forge_verify}"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
[[ -x "$V" ]] || { echo "  SKIP-BLOCKED: no forge_verify at $V"; exit 2; }

run_ir() {  # run_ir <ir> -> the error string
  python3 -c 'import json,sys; print(json.dumps({"id":"s","ir":sys.argv[1]}))' "$1" \
    | "$V" 2>/dev/null | head -1 \
    | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("error",""))
except Exception: print("")'
}

# A part with NO holes at all: the candidate list is empty, which is exactly the
# condition that used to mask the format error.
NOHOLES='%0 = BOX(50,50,10)
%1 = PUSHFACE(%0, "hole:at=1.0,2.0,3.0", 5)
RESULT(%1)'
# The same malformed selector on a part that DOES have a hole.
WITHHOLE='%0 = BOX(50,50,10)
%1 = HOLE(%0, 25, 25, 4, 10)
%2 = PUSHFACE(%1, "hole:at=1.0,2.0,3.0", 5)
RESULT(%2)'
# Well-formed, just wrong place — must still read as a grounding miss.
WELLFORMED='%0 = BOX(50,50,10)
%1 = HOLE(%0, 25, 25, 4, 10)
%2 = PUSHFACE(%1, "hole:at=99.0,99.0", 5)
RESULT(%2)'

echo "== a 3-coordinate at= is a FORMAT error, whatever the part contains =="
E="$(run_ir "$NOHOLES")"
[[ "$E" == *"want at=x,y"* ]] \
  && ok "part with NO holes: says 'want at=x,y'" \
  || bad "part with NO holes: still blames the part -> $E"
[[ "$E" == *"matched no candidate face"* ]] \
  && bad "  and still reports a grounding miss: $E" \
  || ok "  and does NOT report a grounding miss"

E="$(run_ir "$WITHHOLE")"
[[ "$E" == *"want at=x,y"* ]] \
  && ok "part WITH a hole: same diagnosis" \
  || bad "part WITH a hole: $E"

echo ""
echo "== REGRESSION: a well-formed selector that misses still reads as a miss =="
# Without this the fix could be "call everything a format error", which is useless.
E="$(run_ir "$WELLFORMED")"
[[ "$E" == *"want at=x,y"* ]] \
  && bad "a VALID at=x,y was called malformed: $E" \
  || ok "a valid at=x,y is not called malformed"
[[ -n "$E" ]] && ok "  and the tree is still refused ($(echo "$E" | head -c 58)...)" \
  || bad "  but the tree was ACCEPTED — the selector should not have matched"

echo ""
echo "[selector-arity] $((PASS+FAIL)) checks, $FAIL failures"
[[ "$FAIL" -eq 0 ]] || exit 1
