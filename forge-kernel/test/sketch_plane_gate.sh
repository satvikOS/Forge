#!/usr/bin/env bash
# sketch_plane_gate.sh — SKETCH(XY|YZ|XZ) must place the solid on the named plane.
#
# WHAT THIS CATCHES, and why volume cannot.
#
# The compiler used to record nothing for a plane keyword. It pushed a note onto
# res->verify saying the plane was "NOT APPLIED", on the argument that a reported
# approximation beats a refusal. The argument had a hole: that note goes to a
# channel `ok` does not read. MEASURED before the fix -- SKETCH(YZ) and SKETCH(XZ)
# each returned ok=true, error empty, and a bounding box IDENTICAL to XY's. Every
# consumer that checks ok, which is all of them, read a wrong solid as correct.
#
# A ROTATION PRESERVES VOLUME. All three planes yield exactly 10000 mm^3 for the
# fixture below, so a volume assertion -- the one this programme reaches for by
# habit -- can never distinguish right from wrong here. The BOUNDING BOX EXTENT is
# the discriminator, and this gate asserts on it.
set -uo pipefail
KROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
V="${FORGE_VERIFY_BIN:-$KROOT/build/forge_verify}"
PASS=0; FAIL=0
chk(){ if [ "$2" = "$3" ]; then echo "  PASS  $1 -> $3"; PASS=$((PASS+1));
       else echo "  FAIL  $1 -> got $3, want $2"; FAIL=$((FAIL+1)); fi; }

[ -x "$V" ] || { echo "  FAIL  forge_verify not executable at $V"; exit 1; }

# 40 x 25 rectangle, extruded 10. The extrusion must run along the plane's NORMAL.
probe() {  # probe <plane> -> "ok|volume|ex,ey,ez"
  printf '%s\n' "{\"ir\":\"%1 = SKETCH($1)\\n%2 = SPT(%1,0,0)\\n%3 = SPT(%1,40,0)\\n%4 = SPT(%1,40,25)\\n%5 = SPT(%1,0,25)\\n%6 = SLINE(%2,%3)\\n%7 = SLINE(%3,%4)\\n%8 = SLINE(%4,%5)\\n%9 = SLINE(%5,%2)\\n%10 = SOLVE(%1)\\n%11 = EXTRUDE(%10,10)\\nRESULT(%11)\"}" \
    | "$V" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin); b=d.get('bbox') or {}
mn,mx=b.get('min'),b.get('max')
ext='none' if not (mn and mx) else ','.join('%g'%round(mx[i]-mn[i],4) for i in range(3))
print('%s|%s|%s'%(d.get('ok'),d.get('volume'),ext))"
}

echo "== the solid lands on the named plane =="
for spec in "XY|40,25,10" "YZ|10,40,25" "XZ|40,10,25"; do
  plane="${spec%%|*}"; want="${spec##*|}"
  out="$(probe "$plane")"
  chk "SKETCH($plane) builds"      "True" "$(echo "$out" | cut -d'|' -f1)"
  chk "SKETCH($plane) bbox extent" "$want" "$(echo "$out" | cut -d'|' -f3)"
done

echo "== volume is the SAME for all three, so it proves nothing on its own =="
VXY=$(probe XY | cut -d'|' -f2); VYZ=$(probe YZ | cut -d'|' -f2); VXZ=$(probe XZ | cut -d'|' -f2)
chk "XY volume == YZ volume (a rotation preserves it)" "$VXY" "$VYZ"
chk "XY volume == XZ volume (a rotation preserves it)" "$VXY" "$VXZ"

echo "== the three planes are genuinely DIFFERENT solids =="
EXY=$(probe XY | cut -d'|' -f3); EYZ=$(probe YZ | cut -d'|' -f3); EXZ=$(probe XZ | cut -d'|' -f3)
chk "XY extent differs from YZ" "different" "$([ "$EXY" != "$EYZ" ] && echo different || echo IDENTICAL)"
chk "XY extent differs from XZ" "different" "$([ "$EXY" != "$EXZ" ] && echo different || echo IDENTICAL)"
chk "YZ extent differs from XZ" "different" "$([ "$EYZ" != "$EXZ" ] && echo different || echo IDENTICAL)"

echo "== an unknown plane is REFUSED, not quietly solved on XY =="
BAD=$(printf '%s\n' '{"ir":"%1 = SKETCH(ZZ)\n%2 = SPT(%1,0,0)\nRESULT(%1)"}' | "$V" 2>/dev/null \
      | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('ok'))")
chk "SKETCH(ZZ) is rejected" "False" "$BAD"

echo "== and no stale 'NOT APPLIED' note is emitted any more =="
NOTE=$(printf '%s\n' '{"ir":"%1 = SKETCH(YZ)\n%2 = SPT(%1,0,0)\n%3 = SPT(%1,10,0)\n%4 = SPT(%1,10,10)\n%5 = SPT(%1,0,10)\n%6 = SLINE(%2,%3)\n%7 = SLINE(%3,%4)\n%8 = SLINE(%4,%5)\n%9 = SLINE(%5,%2)\n%10 = SOLVE(%1)\n%11 = EXTRUDE(%10,5)\nRESULT(%11)"}' \
       | "$V" 2>/dev/null | python3 -c "
import json,sys;d=json.load(sys.stdin)
print(any('NOT APPLIED' in x for x in (d.get('verify') or [])))")
chk "no NOT-APPLIED note" "False" "$NOTE"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
