#!/bin/bash
# forge-kernel/test/run_fillet_radius_honesty_gate.sh
#
# T-182: FILLET / CHAMFER / BLEND build THE SIZE ASKED FOR, OR FAIL LOUDLY.
#
# FeatureTreeCompiler retried a declined fillet at 0.75r, 0.5r, 0.35r and 0.2r inside a
# bare catch(...) and returned the first that built, reporting ok=true with nothing in
# the result saying the part was different -- against FeatureTree.hpp's own contract
# ("does not silently degrade"). MEASURED before the fix, through this same forge_verify
# binary: the default bracket plus FILLET(%5, 3) came back ok with V=76947.900701, which
# is exactly the r=2.25 (=0.75*3) solid; CHAMFER(%1, 11) on a 20 mm cube came back ok
# with V=2827.25. forge-desktop's document gate had passed on that shrunk fillet.
#
# The oracle is independent of the compiler: a cube of side a with every edge filleted
# at r (rolling-ball edges, spherical corners) has the closed form
#     V = a^3 - 12(1 - pi/4) r^2 (a - 2r) - 8(1 - pi/6) r^3
# so a compiled volume that matches it to 1e-6 is a fillet of THAT radius, and a shrunk
# one cannot pass.
#
# Uses the forge_verify binary in $FORGE_KERNEL_BUILD_DIR (default forge-kernel/build-verify),
# the same artifact every benchmark number comes from. Its absence is exit 3, never a skip.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KB="${FORGE_KERNEL_BUILD_DIR:-$ROOT/forge-kernel/build-verify}"
case "$KB" in /*) ;; *) KB="$ROOT/$KB" ;; esac
BIN="${FORGE_VERIFY_BIN:-$KB/forge_verify}"
if [ ! -x "$BIN" ]; then
  echo "[fillet-honesty] no forge_verify at $BIN -- build it (cmake --build $KB --target forge_verify). RED."
  exit 3
fi
OCCT_LIB="$(brew --prefix opencascade 2>/dev/null)/lib"
ROWS="$(mktemp "${TMPDIR:-/tmp}/fillet_honesty.XXXXXX")"
OUT="$ROWS.out"
trap 'rm -f "$ROWS" "$OUT"' EXIT
BRACKET='%1 = RECT(80, 50)\n%2 = EXTRUDE(%1, 20)\n%3 = CYL(6, 40, 0, 0, -10)\n%4 = CUT(%2, %3)\n%5 = FILLET(%4, 3, VERTICAL)'
cat > "$ROWS" <<J
{"id":"cube_fillet_3","ir":"%1 = BOX(20, 20, 20)\n%2 = FILLET(%1, 3)"}
{"id":"cube_fillet_5","ir":"%1 = BOX(20, 20, 20)\n%2 = FILLET(%1, 5)"}
{"id":"cube_fillet_9","ir":"%1 = BOX(20, 20, 20)\n%2 = FILLET(%1, 9)"}
{"id":"bracket_second_fillet_2.5","ir":"$BRACKET\n%6 = FILLET(%5, 2.5)"}
{"id":"bracket_second_fillet_3","ir":"$BRACKET\n%6 = FILLET(%5, 3)"}
{"id":"cube_chamfer_11","ir":"%1 = BOX(20, 20, 20)\n%2 = CHAMFER(%1, 11)"}
{"id":"cube_fillet_11","ir":"%1 = BOX(20, 20, 20)\n%2 = FILLET(%1, 11)"}
{"id":"cube_blend_11","ir":"%1 = BOX(20, 20, 20)\n%2 = BLEND(%1, 11, 11)"}
J
DYLD_LIBRARY_PATH="$KB:$OCCT_LIB${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" "$BIN" < "$ROWS" > "$OUT" 2>/dev/null
rc=$?
if [ $rc -ne 0 ] && [ ! -s "$OUT" ]; then
  echo "[fillet-honesty] forge_verify exited $rc with no output. RED."; exit 3
fi
python3 -I - "$OUT" <<'PY'
import json, math, sys
rows = {}
for line in open(sys.argv[1]):
    try:
        r = json.loads(line)
    except ValueError:
        continue
    rows[r.get("id")] = r
P = F = 0
def ck(desc, cond, detail=""):
    global P, F
    if cond: P += 1; print(f"  ok   {desc}")
    else:    F += 1; print(f"  FAIL {desc}{('  [' + detail + ']') if detail else ''}")
def analytic(a, r):
    return a**3 - 12*(1 - math.pi/4)*r*r*(a - 2*r) - 8*(1 - math.pi/6)*r**3
for r in (3, 5, 9):
    row = rows.get(f"cube_fillet_{r}", {})
    v = row.get("volume")
    want = analytic(20, r)
    ck(f"FILLET r={r} on a 20 mm cube builds AT r={r}: V matches the closed form to 1e-6",
       bool(row.get("ok")) and isinstance(v, (int, float)) and abs(v - want) / want < 1e-6,
       f"ok={row.get('ok')} V={v} closed-form={want:.6f}")
row = rows.get("bracket_second_fillet_2.5", {})
ck("control: a second fillet the kernel CAN build (r=2.5) still builds", bool(row.get("ok")),
   str(row.get("error", ""))[:160])
row = rows.get("bracket_second_fillet_3", {})
err = str(row.get("error", ""))
ck("a fillet the kernel declines at r=3 is REFUSED, not built smaller (was ok at V=76947.90 = r 2.25)",
   not row.get("ok") and "declined radius 3" in err, f"ok={row.get('ok')} V={row.get('volume')} {err[:160]}")
row = rows.get("cube_chamfer_11", {})
err = str(row.get("error", ""))
ck("a chamfer the kernel declines at d=11 is REFUSED, not built smaller (was ok at V=2827.25)",
   not row.get("ok") and "declined distance 11" in err, f"ok={row.get('ok')} V={row.get('volume')} {err[:160]}")
for rid in ("cube_fillet_11", "cube_blend_11"):
    row = rows.get(rid, {})
    ck(f"{rid}: an impossible size is refused", not row.get("ok"), f"ok={row.get('ok')} V={row.get('volume')}")
print(f"[fillet-honesty] {P} passed, {F} failed")
sys.exit(0 if F == 0 else 1)
PY
