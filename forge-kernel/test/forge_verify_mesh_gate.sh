#!/usr/bin/env bash
# forge_verify_mesh_gate.sh -- THE SCORER MEASURES THE MESH THE KERNEL MADE, NOT A COPY.
#
# Archie's CAD score (shape = surface-F1 + volume IoU, topology = Betti, interface =
# point-in-solid at authored keep-in/keep-out points) is computed on the kernel's
# TESSELLATION. Until T-234 the only producer of that mesh for the scorer was the Node
# addon, reached through forge-kernel/test/cadscore_harness.mjs, whose worker imports
# frontend/src/ai/ForgeToolBridge.js -- the Electron tree that is being retired. forge_verify
# could build the solid but could not hand the mesh out, so a native scorer had nothing to
# score. Two opt-in request fields close that:
#
#   "mesh":"<lin>,<ang>"  -> "mesh":{"lin","ang","positions":[..],"indices":[..]}
#                            = forge::tessellate(handle, lin, ang), the SAME call the addon's
#                            tessellate() makes. positions are float32 in the kernel and are
#                            printed with 9 significant digits, so every one parses back to
#                            the IDENTICAL float32 the addon put in its Float32Array.
#   "validity":"raw"      -> "validity":{"isClosed","isManifold","isOriented",
#                            "hasSelfIntersect","badFaces","badEdges"}
#                            = forge::heal::checkValidity, the six flags and not a verdict,
#                            because the JS gate (closed && manifold && oriented &&
#                            !selfIntersect && badFaces==0) is NOT forge_verify's own `valid`
#                            rule (which also needs badEdges==0, and relaxes orientation for a
#                            bare INPUT()). A caller that wants the JS gate needs the flags.
#
# MEASURED before the change (forge_verify at origin/archdisc b609b41d): 0 of 4 mesh
# requests answered with a mesh, 0 of 2 validity requests with flags -> this gate RED.
#
# What is asserted (each is a property a wrong implementation breaks):
#   P1  a row that asks for neither field is answered with NEITHER key (opt-in, additive)
#   P2  a BOX's mesh: indices in range, positions a multiple of 3, mesh bbox == the
#       reported bbox exactly, closed 2-manifold (every edge used exactly twice once
#       vertices are welded on the harness's 1e-4 mm quantum),
#       divergence-theorem volume == the reported volume (6000) to 1e-9 relative
#   P3  every printed coordinate is float32-exact (float32(parse(s)) printed %.9g == s)
#   P4  a plate with a through-hole: mesh Euler characteristic gives genus 1, the SAME
#       genus forge_verify reports for that row from its own internal tessellation
#   P5  a cylinder's mesh volume converges on pi r^2 h from below as lin shrinks
#       (0.5 -> 0.05): the requested tolerance is actually honoured
#   P6  raw validity of a BOX: closed, manifold, oriented, no self-intersection, 0 bad
#       faces, 0 bad edges -- and `valid` equals the strict rule over those flags
#   P7  a malformed mesh spec ("abc", "0,0.5", "-1,0.5") answers meshError, emits no
#       mesh, and does not cost any other row in the batch
#   P8  a row that does not build emits neither mesh nor validity and the batch survives
#
# Exit codes: 0 GREEN; 1 RED (a property failed); 3 RED (binary/fixture/python missing --
# a check that could not run is not a check that passed).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

BIN="${FORGE_VERIFY_BIN:-}"
if [ -z "$BIN" ]; then
  for cand in "$ROOT/forge-kernel/build/forge_verify" \
              "$ROOT/forge-kernel/build-app/forge_verify" \
              "$ROOT/forge-kernel/build/Release/forge_verify"; do
    [ -x "$cand" ] && { BIN="$cand"; break; }
  done
fi
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  echo "[fv-mesh] forge_verify binary not found (set FORGE_VERIFY_BIN). Refusing to guess. RED."
  exit 3
fi
command -v python3 >/dev/null 2>&1 || { echo "[fv-mesh] python3 not found. RED."; exit 3; }
echo "[fv-mesh] binary: $BIN"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/fv_mesh.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
IN="$TMP/batch.jsonl"
OUT="$TMP/out.jsonl"

PLATE='%1 = BOX(60,40,10)\n%2 = CYL(8,40)\n%3 = TRANSLATE(%2,0,0,-15)\n%4 = CUT(%1,%3)'
{
  printf '%s\n' '{"id":"plain","ir":"%1 = BOX(10,20,30)"}'
  printf '%s\n' '{"id":"box","ir":"%1 = BOX(10,20,30)","mesh":"0.1,0.5","validity":"raw"}'
  printf '%s\n' "{\"id\":\"plate\",\"ir\":\"$PLATE\",\"mesh\":\"0.1,0.5\"}"
  printf '%s\n' '{"id":"cyl_coarse","ir":"%1 = CYL(10,20)","mesh":"0.5,0.5"}'
  printf '%s\n' '{"id":"cyl_fine","ir":"%1 = CYL(10,20)","mesh":"0.05,0.5"}'
  printf '%s\n' '{"id":"bad_abc","ir":"%1 = BOX(1,1,1)","mesh":"abc"}'
  printf '%s\n' '{"id":"bad_zero","ir":"%1 = BOX(1,1,1)","mesh":"0,0.5"}'
  printf '%s\n' '{"id":"bad_neg","ir":"%1 = BOX(1,1,1)","mesh":"-1,0.5"}'
  printf '%s\n' '{"id":"nobuild","ir":"%1 = NOSUCHOP(1)","mesh":"0.1,0.5","validity":"raw"}'
  printf '%s\n' '{"id":"tail","ir":"%1 = BOX(2,2,2)","validity":"raw"}'
} > "$IN"

"$BIN" < "$IN" > "$OUT" 2>"$TMP/err.log"; rc=$?

python3 - "$OUT" "$rc" <<'PY'
import json, math, struct, sys
from collections import Counter

out_path, rc = sys.argv[1], int(sys.argv[2])
fails = []
def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + (("   " + detail) if detail else ""))
    if not cond:
        fails.append(name)

rows = {}
with open(out_path) as fh:
    for line in fh:
        line = line.strip()
        if line.startswith("{"):
            r = json.loads(line)
            rows[r.get("id")] = r

check("process exited cleanly", rc == 0, f"rc={rc}")
check("every one of the 10 rows answered", len(rows) == 10, f"got {len(rows)}")

def f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]

def mesh_props(m):
    P, I = m["positions"], m["indices"]
    nv = len(P) // 3
    ok_shape = len(P) % 3 == 0 and len(I) % 3 == 0 and len(I) > 0
    in_range = all(0 <= i < nv for i in I)
    if not (ok_shape and in_range):
        # nothing below is meaningful on a mesh whose indices leave the vertex array;
        # report it as a failed property instead of dying on an IndexError
        return dict(ok_shape=ok_shape, in_range=in_range, two_manifold=False,
                    volume=float("nan"), chi=None, bbox=None, F=len(I) // 3)
    # Weld on a 1e-4 mm quantum -- the quantum cadscore_harness.bettiNumbers welds on.
    # NOT exact positions: MEASURED on the plate below, the cylinder seam emits two
    # vertices whose float32 coordinates differ in the last bits from their twins, so an
    # exact weld reads 8 boundary edges and chi=-2 on a solid whose 1e-6 weld (and 1e-4,
    # and 1e-3) is a clean 2-manifold with chi=0.
    q = 1e-4
    key = {}
    rep = []
    for v in range(nv):
        k = tuple(math.floor(P[3*v+d] / q + 0.5) for d in range(3))
        rep.append(key.setdefault(k, len(key)))
    edges = Counter()
    vol6 = 0.0
    for t in range(len(I) // 3):
        a, b, c = I[3*t], I[3*t+1], I[3*t+2]
        A, B, C = P[3*a:3*a+3], P[3*b:3*b+3], P[3*c:3*c+3]
        vol6 += (A[0]*(B[1]*C[2]-B[2]*C[1]) - A[1]*(B[0]*C[2]-B[2]*C[0])
                 + A[2]*(B[0]*C[1]-B[1]*C[0]))
        ra, rb, rc_ = rep[a], rep[b], rep[c]
        for u, w in ((ra, rb), (rb, rc_), (rc_, ra)):
            edges[(min(u, w), max(u, w))] += 1
    two_manifold = all(n == 2 for n in edges.values())
    V, E, F = len(key), len(edges), len(I) // 3
    bb = ([min(P[k::3]) for k in range(3)], [max(P[k::3]) for k in range(3)])
    return dict(ok_shape=ok_shape, in_range=in_range, two_manifold=two_manifold,
                volume=abs(vol6) / 6.0, chi=V - E + F, bbox=bb, F=F)

# P1 opt-in
p = rows.get("plain", {})
check("P1 a row asking for nothing gets no mesh/validity key",
      p.get("ok") is True and "mesh" not in p and "validity" not in p and "meshError" not in p)

# P2/P3/P6 box
b = rows.get("box", {})
m = b.get("mesh")
check("P2 box answered with a mesh", isinstance(m, dict) and "positions" in m)
if isinstance(m, dict) and "positions" in m:
    mp = mesh_props(m)
    check("P2 lin/ang echoed", m.get("lin") == 0.1 and m.get("ang") == 0.5, f"{m.get('lin')},{m.get('ang')}")
    check("P2 positions/indices well-formed", mp["ok_shape"] and mp["in_range"])
if isinstance(m, dict) and "positions" in m and mp["bbox"] is not None:
    rb = b.get("bbox", {})
    check("P2 mesh bbox == reported bbox",
          mp["bbox"][0] == rb.get("min") and mp["bbox"][1] == rb.get("max"),
          f"mesh={mp['bbox']} reported={rb}")
    check("P2 closed 2-manifold (every welded edge used twice)", mp["two_manifold"])
    vrep = b.get("volume", 0)
    check("P2 mesh volume == reported volume (6000)",
          abs(mp["volume"] - vrep) <= 1e-9 * max(1.0, vrep) and abs(vrep - 6000) < 1e-9,
          f"mesh={mp['volume']!r} reported={vrep!r}")
# P3: float32 exactness over EVERY mesh row, re-read from the RAW text so json float
# coercion cannot help. The box alone cannot show it (its corners are integers, which any
# precision prints exactly); the plate and cylinders carry cos/sin coordinates.
toks = []
for raw in open(out_path):
    if '"positions":[' not in raw:
        continue
    seg = raw[raw.index('"positions":[') + 13:]
    toks += seg[:seg.index("]")].split(",")
bad = [t for t in toks if ("%.9g" % f32(float(t))) != t]
nonint = sum(1 for t in toks if float(t) != int(float(t)))
check("P3 every coordinate is printed float32-exact",
      len(toks) > 0 and nonint > 0 and not bad,
      f"{len(toks)} coords ({nonint} non-integer), {len(bad)} not float32-exact {bad[:3]}")
va = b.get("validity")
check("P6 box answered with raw validity flags", isinstance(va, dict))
if isinstance(va, dict):
    check("P6 box flags all clean",
          va.get("isClosed") is True and va.get("isManifold") is True and va.get("isOriented") is True
          and va.get("hasSelfIntersect") is False and va.get("badFaces") == 0 and va.get("badEdges") == 0, str(va))
    strict = (va.get("isClosed") and va.get("isManifold") and va.get("isOriented")
              and not va.get("hasSelfIntersect") and va.get("badFaces") == 0 and va.get("badEdges") == 0)
    check("P6 `valid` equals the strict rule over the flags", b.get("valid") == bool(strict))

# P4 plate genus
pl = rows.get("plate", {})
pm = pl.get("mesh")
check("P4 plate answered with a mesh", isinstance(pm, dict) and "positions" in pm)
if isinstance(pm, dict) and "positions" in pm:
    mp = mesh_props(pm)
    g = (2 - mp["chi"]) / 2.0 if mp["chi"] is not None else None
    check("P4 plate mesh is a closed 2-manifold", mp["two_manifold"])
    check("P4 mesh genus == 1 == forge_verify's own genus",
          g == 1 and pl.get("genus") == 1, f"mesh genus={g} reported={pl.get('genus')}")

# P5 tolerance honoured
cc, cf = rows.get("cyl_coarse", {}).get("mesh"), rows.get("cyl_fine", {}).get("mesh")
if isinstance(cc, dict) and isinstance(cf, dict) and "positions" in cc and "positions" in cf:
    exact = math.pi * 100.0 * 20.0
    vc, vf = mesh_props(cc)["volume"], mesh_props(cf)["volume"]
    ec, ef = (exact - vc) / exact, (exact - vf) / exact
    check("P5 finer lin -> more triangles and a smaller volume deficit",
          mesh_props(cf)["F"] > mesh_props(cc)["F"] and 0 <= ef < ec,
          f"deficit coarse={ec:.3e} fine={ef:.3e} tris {mesh_props(cc)['F']}->{mesh_props(cf)['F']}")
else:
    check("P5 both cylinder meshes answered", False)

# P7 malformed specs
for rid in ("bad_abc", "bad_zero", "bad_neg"):
    r = rows.get(rid, {})
    check(f"P7 {rid}: meshError, no mesh, row still measured",
          "meshError" in r and "mesh" not in r and r.get("ok") is True, str({k: r.get(k) for k in ("ok", "meshError")}))

# P8 a non-building row
nb = rows.get("nobuild", {})
check("P8 a row that does not build emits no mesh/validity",
      nb.get("ok") is False and "mesh" not in nb and "validity" not in nb)
t = rows.get("tail", {})
check("P8 the row after it is answered normally",
      t.get("ok") is True and isinstance(t.get("validity"), dict))

print()
if fails:
    print(f"[fv-mesh] RED -- {len(fails)} check(s) failed.")
    sys.exit(1)
print("[fv-mesh] GREEN -- mesh and raw validity are opt-in, exact, and consistent with the solid.")
PY
st=$?
if [ "$st" -ne 0 ] && [ -s "$TMP/err.log" ]; then sed 's/^/           stderr: /' "$TMP/err.log" | head -5; fi
exit "$st"
