#!/usr/bin/env bash
# selector_kind_gate.sh — an unrecognised selector KIND must fail loudly.
#
# TAG's selector grammar is <kind>:<qualifier>. The last branch of the resolver
# handled bore/hole/boss/shaft/fillet/blend, and ANYTHING ELSE fell through it with
# every want* flag false -- which selects EVERY cylindrical face and then ranks by
# radius.
#
# MEASURED before the fix, on a box with one hole:
#
#   TAG(%2, "@t", "planar:max")  ->  ok=true,  "TAG @t -> cylinder face 6"
#
# The caller asked for the largest PLANAR face and was handed a bore, reported as a
# success. `planar` is a near-miss of `plane:largest`, which IS valid, so this is
# exactly the typo a model or a person makes -- and the entire value of a closed
# vocabulary is that a word outside it fails instead of meaning something else.
# Same class as SKETCH silently solving YZ on XY.
set -uo pipefail
KROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V="${FORGE_VERIFY_BIN:-$KROOT/build/forge_verify}"
PASS=0; FAIL=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS  $1 -> $3"; PASS=$((PASS+1));
       else echo "  FAIL  $1 -> got $3, want $2"; FAIL=$((FAIL+1)); fi; }
[ -x "$V" ] || { echo "  FAIL  forge_verify not executable at $V"; exit 1; }

ask() {  # ask <selector> -> "ok|firstTagOrError"
  printf '%s\n' "{\"ir\":\"%1 = BOX(60,40,20)\\n%2 = HOLE(%1, 8, 10, -15, 0)\\n%3 = TAG(%2, \\\"@t\\\", \\\"$1\\\")\\nRESULT(%3)\"}" \
    | "$V" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=[x for x in (d.get('verify') or []) if 'TAG' in x]
print('%s|%s' % (d.get('ok'), v[0] if v else (d.get('error') or '')))"
}

echo "== an unrecognised kind is REFUSED, not silently read as 'any cylinder' =="
for s in "planar:max" "flat:max" "surface:largest" "gibberish:max"; do
  out="$(ask "$s")"
  chk "$s is refused" "False" "$(echo "$out" | cut -d'|' -f1)"
  case "$(echo "$out" | cut -d'|' -f2)" in
    *"unknown selector kind"*) echo "        names the problem and lists the valid kinds" ;;
    *) echo "  FAIL  $s was refused for the WRONG reason: $(echo "$out" | cut -d'|' -f2 | head -c 90)"
       FAIL=$((FAIL+1)) ;;
  esac
done

echo "== and every VALID kind still resolves -- no capability was traded away =="
out="$(ask 'bore:max')"
chk "bore:max builds"            "True" "$(echo "$out" | cut -d'|' -f1)"
case "$(echo "$out" | cut -d'|' -f2)" in
  *cylinder*) echo "        and it selects a CYLINDER, as a bore must"; PASS=$((PASS+1)) ;;
  *) echo "  FAIL  bore:max did not select a cylinder"; FAIL=$((FAIL+1)) ;;
esac

out="$(ask 'plane:largest')"
chk "plane:largest builds"       "True" "$(echo "$out" | cut -d'|' -f1)"
case "$(echo "$out" | cut -d'|' -f2)" in
  *plane*) echo "        and it selects a PLANE -- which is the whole point"; PASS=$((PASS+1)) ;;
  *) echo "  FAIL  plane:largest did not select a plane: $(echo "$out" | cut -d'|' -f2 | head -c 80)"
     FAIL=$((FAIL+1)) ;;
esac

out="$(ask 'face:1')"
chk "face:<n> builds"            "True" "$(echo "$out" | cut -d'|' -f1)"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
