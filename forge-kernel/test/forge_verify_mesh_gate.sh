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
# A third opt-in, "importStep":"<path>", measures a STEP FILE AS IMPORTED --
# forge::io::importStep and nothing else -- because that is the handle every JS scorer
# measured. `%1 = INPUT()` is not it: INPUT() runs unifyFaces and, on an unoriented
# import, harmonizeNormals, so it repairs exactly what the validity gate exists to see.
#
# MEASURED before the change (checks that depend on an answer run only when it came):
#   forge_verify at origin/archdisc b609b41d: RED, 25 of the 33 checks that ran failed
#     (no mesh, no flags, no importStep); the 8 that passed are the ones a tool without
#     the opt-ins also satisfies (clean exit, every row answered, P1, P8 no-build, the
#     P10 export and INPUT() fixture rows, "no `valid`" on a refused row, P13 no-ir).
#   forge_verify at aed8eaaf (mesh + validity, no importStep yet): RED, 14 of 44 failed,
#     all of them P10-P13.
#   With importStep: GREEN, 46 of 46.
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
#   P9  badEdges is its OWN count: two boxes sharing one edge (FUSE -> non-manifold edge)
#       report badEdges >= 1 with badFaces == 0, and `valid` is false
#   P10 importStep is the RAW import: two boxes FUSEd face to face and written to STEP keep
#       their split faces (10) through importStep, while INPUT() of the same file unifies
#       them (6); volume, faceCount, bbox and the 0.3,0.6 mesh agree with the exporting
#       row; there is no `valid` (a verdict needs a rule)
#   P11 importStep neither unifies nor harmonizes: data/cadgenbench_edit_out/225/output.step
#       (a real CADGenBench edit output) imports unoriented with a bad face and INPUT() of
#       the same file reports it clean; 243/output.step also imports unoriented, and
#       MEASURED, harmonizeNormals ALONE cleans 243 (it does not clean 225, which needs
#       unifyFaces first), so 243 is what catches an importStep that only harmonizes. If a
#       kernel change makes either file import clean, that fixture no longer
#       discriminates: replace it, do not drop the check. (INPUT() of 243 is not asked:
#       it takes ~94 s against ~3 s for importStep -- see T-301.)
#   P12 importStep honours the mesh spec: data/cadgenbench_edit_out/218/output.step meshed
#       at lin 0.05 has more triangles than at 0.3 (the shared 0.3,0.6 tessellation is
#       reused only for that exact spec). Not a Forge-written cylinder: MEASURED, a
#       CYL(10,20) written by outStep and read back by importStep (the native StepAnalytic
#       route) tessellates to the same 378 triangles at every lin, with signed volume 0
#       -- a kernel mesher defect on that route (T-300), not a property of this tool
#   P13 importStep is exclusive and fails per row: with ir or inputStep it is refused, an
#       empty or missing path answers ok:false, and a row with neither ir nor importStep
#       still answers exactly {"id","ok":false,"error":"no ir"}
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
EDGE2='%1 = BOX(10,10,10)\n%2 = BOX(10,10,10)\n%3 = TRANSLATE(%2,10,10,0)\n%4 = FUSE(%1,%3)'
FUSE2='%1 = BOX(10,10,10)\n%2 = BOX(10,10,10)\n%3 = TRANSLATE(%2,10,0,0)\n%4 = FUSE(%1,%3)'
REAL225="$ROOT/data/cadgenbench_edit_out/225/output.step"
REAL218="$ROOT/data/cadgenbench_edit_out/218/output.step"
REAL243="$ROOT/data/cadgenbench_edit_out/243/output.step"
for fx in "$REAL225" "$REAL218" "$REAL243"; do
  if [ ! -s "$fx" ]; then
    echo "[fv-mesh] fixture $fx missing. RED."
    exit 3
  fi
done
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
  printf '%s\n' "{\"id\":\"nonmanifold\",\"ir\":\"$EDGE2\",\"validity\":\"raw\"}"
  # rows run in order, so each STEP is written before the rows that import it
  printf '%s\n' "{\"id\":\"mk_fuse\",\"ir\":\"$FUSE2\",\"outStep\":\"$TMP/fuse2.step\",\"mesh\":\"0.3,0.6\"}"
  printf '%s\n' "{\"id\":\"imp_fuse\",\"importStep\":\"$TMP/fuse2.step\",\"mesh\":\"0.3,0.6\",\"validity\":\"raw\"}"
  printf '%s\n' "{\"id\":\"inp_fuse\",\"ir\":\"%1 = INPUT()\",\"inputStep\":\"$TMP/fuse2.step\"}"
  printf '%s\n' "{\"id\":\"imp_225\",\"importStep\":\"$REAL225\",\"validity\":\"raw\"}"
  printf '%s\n' "{\"id\":\"inp_225\",\"ir\":\"%1 = INPUT()\",\"inputStep\":\"$REAL225\",\"validity\":\"raw\"}"
  printf '%s\n' "{\"id\":\"imp_243\",\"importStep\":\"$REAL243\",\"validity\":\"raw\"}"
  printf '%s\n' "{\"id\":\"imp_218_coarse\",\"importStep\":\"$REAL218\",\"mesh\":\"0.3,0.6\"}"
  printf '%s\n' "{\"id\":\"imp_218_fine\",\"importStep\":\"$REAL218\",\"mesh\":\"0.05,0.6\"}"
  printf '%s\n' "{\"id\":\"imp_and_ir\",\"ir\":\"%1 = BOX(1,1,1)\",\"importStep\":\"$TMP/fuse2.step\"}"
  printf '%s\n' "{\"id\":\"imp_and_input\",\"importStep\":\"$TMP/fuse2.step\",\"inputStep\":\"$TMP/fuse2.step\"}"
  printf '%s\n' '{"id":"imp_empty","importStep":""}'
  printf '%s\n' "{\"id\":\"imp_missing\",\"importStep\":\"$TMP/no_such_file.step\"}"
  printf '%s\n' '{"id":"noir"}'
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
check("every one of the 24 rows answered", len(rows) == 24, f"got {len(rows)}")

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

# P9 badEdges is its own count
nm = rows.get("nonmanifold", {})
nv = nm.get("validity")
check("P9 non-manifold FUSE answered with raw validity flags", isinstance(nv, dict), str(nm.get("error")))
if isinstance(nv, dict):
    check("P9 badEdges >= 1 while badFaces == 0 (the two counts are reported independently)",
          isinstance(nv.get("badEdges"), int) and nv.get("badEdges") >= 1 and nv.get("badFaces") == 0
          and nv.get("isManifold") is False, str(nv))
    check("P9 `valid` is false on it", nm.get("valid") is False)

# P10 importStep is the raw import
mk, im, inp = rows.get("mk_fuse", {}), rows.get("imp_fuse", {}), rows.get("inp_fuse", {})
check("P10 the face-to-face FUSE built and was exported", mk.get("ok") is True and mk.get("exported") is True,
      str({k: mk.get(k) for k in ("ok", "error", "exported")}))
check("P10 importStep row answered ok with source=importStep",
      im.get("ok") is True and im.get("source") == "importStep", str({k: im.get(k) for k in ("ok", "error", "source")}))
check("P10 INPUT() of the same file unifies the split faces (the fixture discriminates)",
      isinstance(inp.get("faceCount"), int) and isinstance(mk.get("faceCount"), int)
      and inp.get("faceCount") < mk.get("faceCount"),
      f"INPUT() faces={inp.get('faceCount')} exported faces={mk.get('faceCount')}")
check("P10 importStep keeps every face the exporter wrote (no unifyFaces)",
      im.get("faceCount") == mk.get("faceCount") and im.get("edgeCount") == mk.get("edgeCount"),
      f"importStep faces/edges={im.get('faceCount')}/{im.get('edgeCount')} "
      f"exported={mk.get('faceCount')}/{mk.get('edgeCount')}")
check("P10 importStep volume == the exporting row's volume (2000)",
      isinstance(im.get("volume"), (int, float)) and abs(im.get("volume") - 2000) < 1e-6
      and abs(mk.get("volume", 0) - 2000) < 1e-6, f"{im.get('volume')} vs {mk.get('volume')}")
check("P10 importStep emits no `valid` verdict", "valid" not in im)
iv = im.get("validity")
check("P10 importStep raw flags of a clean part are all clean",
      isinstance(iv, dict) and iv.get("isClosed") is True and iv.get("isManifold") is True
      and iv.get("isOriented") is True and iv.get("hasSelfIntersect") is False
      and iv.get("badFaces") == 0 and iv.get("badEdges") == 0, str(iv))
imm = im.get("mesh")
if isinstance(imm, dict) and "positions" in imm:
    mp = mesh_props(imm)
    check("P10 importStep 0.3,0.6 mesh bbox == its reported bbox, closed, volume 2000",
          mp["bbox"] is not None and mp["bbox"][0] == im.get("bbox", {}).get("min")
          and mp["bbox"][1] == im.get("bbox", {}).get("max") and mp["two_manifold"]
          and abs(mp["volume"] - 2000) <= 1e-9 * 2000,
          f"mesh bbox={mp['bbox']} reported={im.get('bbox')} vol={mp['volume']!r}")
    mkm = mk.get("mesh")
    check("P10 importStep mesh == the exporting row's mesh (same solid, same spec)",
          isinstance(mkm, dict) and mesh_props(mkm)["bbox"] == mp["bbox"]
          and abs(mesh_props(mkm)["volume"] - mp["volume"]) <= 1e-9 * 2000)
else:
    check("P10 importStep row answered with a mesh", False, str(im.get("meshError")))

# P11 importStep does not harmonize normals (real data)
r225, i225 = rows.get("imp_225", {}), rows.get("inp_225", {})
rv, iv2 = r225.get("validity"), i225.get("validity")
def defect(v):
    return isinstance(v, dict) and (v.get("isOriented") is False or (v.get("badFaces") or 0) > 0)
check("P11 importStep of 225/output.step answered with raw flags",
      r225.get("ok") is True and isinstance(rv, dict), str({k: r225.get(k) for k in ("ok", "error")}))
check("P11 INPUT() of it reports it repaired (oriented, 0 bad faces) -- the fixture discriminates",
      isinstance(iv2, dict) and not defect(iv2), str(iv2))
check("P11 importStep reports the defect INPUT() repaired (unoriented or bad faces)", defect(rv), str(rv))
r243 = rows.get("imp_243", {})
check("P11 importStep of 243/output.step reports its raw defect (harmonizeNormals alone would clean it)",
      r243.get("ok") is True and defect(r243.get("validity")), str(r243.get("validity") or r243.get("error")))
check("P11 importStep keeps the faces INPUT() merges",
      isinstance(r225.get("faceCount"), int) and isinstance(i225.get("faceCount"), int)
      and r225.get("faceCount") > i225.get("faceCount"),
      f"importStep {r225.get('faceCount')} vs INPUT() {i225.get('faceCount')}")

# P12 the mesh spec is honoured on an importStep row
cc2, cf2 = rows.get("imp_218_coarse", {}).get("mesh"), rows.get("imp_218_fine", {}).get("mesh")
if isinstance(cc2, dict) and isinstance(cf2, dict) and "indices" in cc2 and "indices" in cf2:
    a2, b2 = len(cc2["indices"]) // 3, len(cf2["indices"]) // 3
    check("P12 lin 0.05 -> more triangles than lin 0.3 on the same imported part",
          b2 > a2 > 0, f"tris {a2} -> {b2}")
    check("P12 lin/ang echoed on importStep meshes",
          (cc2.get("lin"), cc2.get("ang"), cf2.get("lin"), cf2.get("ang")) == (0.3, 0.6, 0.05, 0.6))
else:
    check("P12 both importStep meshes of 218 answered", False)

# P13 exclusivity and per-row failure
for rid, needle in (("imp_and_ir", "takes no ir"), ("imp_and_input", "takes no ir"),
                    ("imp_empty", "importStep is empty"), ("imp_missing", "importStep:")):
    r = rows.get(rid, {})
    check(f"P13 {rid}: refused (ok:false, no measurement)",
          r.get("ok") is False and needle in (r.get("error") or "") and "volume" not in r
          and "mesh" not in r, str({k: r.get(k) for k in ("ok", "error")}))
check("P13 a row with neither ir nor importStep answers exactly as before",
      rows.get("noir") == {"id": "noir", "ok": False, "error": "no ir"}, str(rows.get("noir")))

print()
if fails:
    print(f"[fv-mesh] RED -- {len(fails)} check(s) failed.")
    sys.exit(1)
print("[fv-mesh] GREEN -- mesh, raw validity and importStep are opt-in, exact, and consistent with the solid.")
PY
st=$?
if [ "$st" -ne 0 ] && [ -s "$TMP/err.log" ]; then sed 's/^/           stderr: /' "$TMP/err.log" | head -5; fi
exit "$st"
