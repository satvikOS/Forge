#!/usr/bin/env python3
"""abc_ofs_verify.py — the DIFFERENTIAL GATE for abc_ofs_to_ir.py.

A translator that emits 200 trees proves nothing until something rebuilds them
and MEASURES the solid. This harness does that, over a stride sample, and
reports a pass rate with the failure taxonomy that produced it.

============================ THE TWO ARMS ============================

  ARM A — the claim:      ofs YAML -> abc_ofs_to_ir.emit -> IR text
                          -> forge_verify (the C++ kernel) -> solid + STEP
  ARM B — the reference:  the SAME emission plan -> a straight OCCT build in
                          python (OCP) -> solid + STEP

The two arms share the READER (which curve is where, which ring is a hole,
what the depth expression evaluates to) and differ in the BUILDER. That is
deliberate and it is the honest boundary of what this gate proves:

  IT PROVES   the emitted IR denotes the solid the reader read — arc direction
              and sweep, ring nesting and hole polarity, extrude sign, boolean
              order, unit conversion inside the emission, and that the kernel
              rebuilds it. Arm A states holes as CUT of overshooting prisms;
              arm B states them as INNER WIRES OF ONE FACE, so a nesting or
              polarity error cannot cancel between the arms.

  IT DOES NOT PROVE agreement with Onshape's own evaluation of the tree. The
              ofs corpus ships NO evaluated B-rep — CENSUSED over all 9,852
              YAMLs: zero contain a face, body, mesh or bounding-box record —
              and no ABC STEP/OBJ chunk is on this machine. Any claim of
              "matches the ground-truth solid" would therefore be unfalsifiable
              here, so none is made.

======================== THE OBSERVABLE VECTOR ========================

VOLUME ALONE CANNOT VALIDATE GEOMETRY. Every comparison below is a VECTOR, and
a model passes only if EVERY component passes:

    valid          kernel BRepCheck on arm A
    volume         |dV| / V_ref
    surface area   |dA| / A_ref            (a mis-nested hole moves area, not always volume)
    centre of mass |dC| / bbox diagonal    (a mirrored feature moves COM, not volume)
    bbox min/max   per-axis, / diagonal
    face count     exact
    edge count     exact
    vertex count   exact
    genus          exact                   (a lost hole is a genus change)
    shell count    exact
    IoU            >= 0.99, EXACT: vol(A and B)/vol(A or B) by two OCCT booleans
                   (the only observable that is not a summary)

Arm A's volume/area/COM/bbox are measured from the STEP THE KERNEL WROTE, with
the same OCP instrument that measures arm B, so a units or convention
difference between two measurement stacks cannot masquerade as agreement.

Usage:
  python3 scripts/abc_ofs_verify.py --root <extracted ofs dir> --n 250 \
      --verify <path to forge_verify> --out <results dir>
"""
from __future__ import annotations

import argparse
import collections
import glob
import json
import math
import os
import subprocess
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import abc_ofs_to_ir as T                                     # noqa: E402

from OCP.gp import gp_Pnt, gp_Circ, gp_Ax2, gp_Dir, gp_Vec, gp_Trsf  # noqa: E402
from OCP.BRepBuilderAPI import (BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire,   # noqa: E402
                                BRepBuilderAPI_MakeFace, BRepBuilderAPI_Transform)
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism                     # noqa: E402
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse, BRepAlgoAPI_Common  # noqa: E402
from OCP.GProp import GProp_GProps                                    # noqa: E402
from OCP.BRepGProp import BRepGProp                                   # noqa: E402
from OCP.Bnd import Bnd_Box                                           # noqa: E402
from OCP.BRepBndLib import BRepBndLib                                 # noqa: E402
from OCP.TopExp import TopExp                                         # noqa: E402
from OCP.TopTools import TopTools_IndexedMapOfShape                   # noqa: E402
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX, TopAbs_SHELL  # noqa: E402
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs, STEPControl_Reader  # noqa: E402
from OCP.IFSelect import IFSelect_RetDone                             # noqa: E402
from OCP.BRepCheck import BRepCheck_Analyzer                          # noqa: E402
from OCP.GC import GC_MakeArcOfCircle                                 # noqa: E402
from OCP.TopoDS import TopoDS                                         # noqa: E402
from OCP.BRepGProp import BRepGProp_Face                              # noqa: E402


# ------------------------------------------------------------------ arm B builder
def _edge_line(a, b):
    return BRepBuilderAPI_MakeEdge(gp_Pnt(a[0], a[1], 0.0), gp_Pnt(b[0], b[1], 0.0)).Edge()


def _edge_arc(seg, rev):
    """An exact OCCT arc through start / mid / end — three points ON the true circle."""
    a, b = (seg.b, seg.a) if rev else (seg.a, seg.b)
    ccw = seg.ccw if not rev else (not seg.ccw)
    t0 = math.atan2(a[1] - seg.c[1], a[0] - seg.c[0])
    t1 = math.atan2(b[1] - seg.c[1], b[0] - seg.c[0])
    d = t1 - t0
    if ccw:
        while d <= 1e-12:
            d += 2 * math.pi
    else:
        while d >= -1e-12:
            d -= 2 * math.pi
    tm = t0 + d / 2.0
    mid = (seg.c[0] + seg.r * math.cos(tm), seg.c[1] + seg.r * math.sin(tm))
    arc = GC_MakeArcOfCircle(gp_Pnt(a[0], a[1], 0.0), gp_Pnt(mid[0], mid[1], 0.0),
                             gp_Pnt(b[0], b[1], 0.0))
    if not arc.IsDone():
        raise RuntimeError("reference arm: GC_MakeArcOfCircle failed")
    return BRepBuilderAPI_MakeEdge(arc.Value()).Edge()


def _wire(region, segs, ccw=True):
    """Build the region's wire, oriented CCW (`ccw=True`) or CW.

    THE ORIENTATION IS LOAD-BEARING AND IT WAS MEASURED, not assumed.
    BRepBuilderAPI_MakeFace::Add takes an inner wire on the convention that it
    runs OPPOSITE to the outer one. Adding a hole wire with the SAME handedness
    does not fail and does not warn — it produces a face whose area is the SUM
    of the two loops. On model 00005825 (a 20 mm box with a 19.2 mm through
    pocket) that made the reference arm report 15,372.8 mm3 where the truth is
    627.2: the reference was 24x too large and looked entirely healthy. The
    differential gate caught it because arm A states the same hole as a CUT,
    which cannot express "add the hole's area".
    """
    kind, payload = region
    mk = BRepBuilderAPI_MakeWire()
    if kind == "circle":
        circ = gp_Circ(gp_Ax2(gp_Pnt(payload.c[0], payload.c[1], 0.0), gp_Dir(0, 0, 1)), payload.r)
        mk.Add(BRepBuilderAPI_MakeEdge(circ).Edge())
        signed = math.pi * payload.r * payload.r          # gp_Circ on +Z is CCW
    else:
        for si, rev in payload:
            s = segs[si]
            mk.Add(_edge_line(s.b, s.a) if (s.kind == "line" and rev) else
                   (_edge_line(s.a, s.b) if s.kind == "line" else _edge_arc(s, rev)))
        signed = T._area(T._ring_polyline(payload, segs))
    if not mk.IsDone():
        raise RuntimeError("reference arm: wire did not close")
    w = mk.Wire()
    if (signed > 0) != bool(ccw):
        w = TopoDS.Wire_s(w.Reversed())
    return w


def build_reference(pl: dict):
    """Build the plan straight in OCCT: ONE face with inner wires, then a prism.

    Deliberately not the shape of arm A's emission (many prisms combined by
    booleans), so hole polarity and nesting are tested rather than shared.
    """
    body = None
    for st in pl["steps"]:
        segs, regions, depths = st["segs"], st["regions"], st["depths"]
        dmm, z0, updir = st["depth_mm"], st["z0"], st["updir"]
        outer_i = st["outer"]
        face = BRepBuilderAPI_MakeFace(_wire(regions[outer_i], segs, ccw=True), True)
        islands = []
        for i, d in enumerate(depths):
            if i == outer_i:
                continue
            if d % 2 == 1:
                face.Add(_wire(regions[i], segs, ccw=False))   # an inner wire runs the OTHER way
            else:
                islands.append(i)
        if not face.IsDone():
            raise RuntimeError("reference arm: face with holes failed")
        tool = BRepPrimAPI_MakePrism(face.Face(), gp_Vec(0, 0, dmm * (1 if updir > 0 else -1))).Shape()
        for i in islands:
            isl_face = BRepBuilderAPI_MakeFace(_wire(regions[i], segs, ccw=True), True).Face()
            isl = BRepPrimAPI_MakePrism(isl_face, gp_Vec(0, 0, dmm * (1 if updir > 0 else -1))).Shape()
            tool = BRepAlgoAPI_Fuse(tool, isl).Shape()
        if abs(z0) > 1e-12:
            tr = gp_Trsf()
            tr.SetTranslation(gp_Vec(0, 0, z0))
            tool = BRepBuilderAPI_Transform(tool, tr, True).Shape()
        if body is None:
            body = tool
        elif st["op"] in ("NEW", "ADD"):
            body = BRepAlgoAPI_Fuse(body, tool).Shape()
        elif st["op"] == "REMOVE":
            body = BRepAlgoAPI_Cut(body, tool).Shape()
        elif st["op"] == "INTERSECT":
            body = BRepAlgoAPI_Common(body, tool).Shape()
    return body


# ------------------------------------------------------------------- measurement
def _count(shape, kind):
    """Count DISTINCT sub-shapes.

    Not TopExp_Explorer + a set: OCCT 7.9 dropped TopoDS_Shape::HashCode, and an
    explorer visits a shared edge once per adjoining face, so the naive walk
    would report ~2x the edges and ~3x the vertices — a wrong count that still
    looks like a count. TopExp.MapShapes_s is the de-duplicating map.
    """
    m = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, kind, m)
    return m.Extent()


def measure(shape) -> dict:
    """The OCP-side observables. The SAME function measures both arms' STEP."""
    vp = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, vp)
    sp = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, sp)
    com = vp.CentreOfMass()
    bb = Bnd_Box()
    BRepBndLib.Add_s(shape, bb)
    xm, ym, zm, xM, yM, zM = bb.Get()
    nf, ne, nv = _count(shape, TopAbs_FACE), _count(shape, TopAbs_EDGE), _count(shape, TopAbs_VERTEX)
    ns = _count(shape, TopAbs_SHELL)
    return {
        "volume": vp.Mass(), "area": sp.Mass(),
        "com": [com.X(), com.Y(), com.Z()],
        "bbox": [[xm, ym, zm], [xM, yM, zM]],
        "faces": nf, "edges": ne, "vertices": nv, "shells": ns,
        "euler": nv - ne + nf,
        "valid": bool(BRepCheck_Analyzer(shape).IsValid()),
    }


def write_step(shape, path):
    w = STEPControl_Writer()
    w.Transfer(shape, STEPControl_AsIs)
    if w.Write(path) != IFSelect_RetDone:
        raise RuntimeError("reference arm: STEP write failed")


def read_step(path):
    r = STEPControl_Reader()
    if r.ReadFile(path) != IFSelect_RetDone:
        raise RuntimeError(f"could not read STEP {path}")
    r.TransferRoots()
    return r.OneShape()


def boolean_iou(sa, sb):
    """EXACT intersection-over-union: vol(A and B) / vol(A or B). No voxels.

    THIS REPLACES forge_verify's voxel IoU, and the reason is a FAILED POSITIVE
    CONTROL, not a preference. Handed the SAME STEP file as both candidate and
    reference, `voxelIoU` returned 0.097778 on model 00005825 and 0.883900 on
    00009425 — a solid compared with itself must score 1.0. Its own cell counts
    disagree for that one solid (candidate 3480 vs reference 26160 on a 32 grid),
    so the two shapes are not being sampled on the same lattice. It also cost
    74 s for two models at grid 32, which is grid^3 point-in-solid
    classifications, twice.

    Two booleans are exact and cheap. Identity is the control: this function
    returns exactly 1.0 for a shape against itself.
    """
    vi, vu = GProp_GProps(), GProp_GProps()
    common = BRepAlgoAPI_Common(sa, sb)
    if not common.IsDone():
        raise RuntimeError("IoU: intersection failed")
    fuse = BRepAlgoAPI_Fuse(sa, sb)
    if not fuse.IsDone():
        raise RuntimeError("IoU: union failed")
    BRepGProp.VolumeProperties_s(common.Shape(), vi)
    BRepGProp.VolumeProperties_s(fuse.Shape(), vu)
    if not (vu.Mass() > 0):
        raise RuntimeError("IoU: union has no volume")
    return vi.Mass() / vu.Mass()


# ------------------------------------------------------------------ the comparison
TOL_REL = 1.0e-3          # volume / area, relative
TOL_POS = 1.0e-3          # COM and bbox, relative to the bbox diagonal
TOL_IOU = 0.99


def compare(a: dict, b: dict, ka: dict, kb: dict, iou) -> dict:
    """-> {component: (pass, measured)}.  `a` = arm A, `b` = the reference arm.

    EVERY component is measured on BOTH arms BY THE SAME INSTRUMENT:
    volume / area / centre of mass / bbox come from OCP reading each arm's own
    STEP; validity / face / edge / vertex / shell / genus come from the kernel
    reading each arm's own STEP. Comparing an OCP number against a kernel number
    would let a convention difference between two measurement stacks pass for a
    geometric difference, or hide one.
    """
    diag = math.dist(b["bbox"][0], b["bbox"][1]) or 1.0
    out = {}

    def rel(x, y):
        return abs(x - y) / max(abs(y), 1e-12)

    out["valid"] = (bool(ka.get("valid")) and bool(kb.get("valid")),
                    f"A={ka.get('valid')} B={kb.get('valid')}")
    out["volume"] = (rel(a["volume"], b["volume"]) <= TOL_REL,
                     f"{a['volume']:.6f} vs {b['volume']:.6f} rel={rel(a['volume'], b['volume']):.2e}")
    out["area"] = (rel(a["area"], b["area"]) <= TOL_REL,
                   f"{a['area']:.6f} vs {b['area']:.6f} rel={rel(a['area'], b['area']):.2e}")
    dc = math.dist(a["com"], b["com"]) / diag
    out["com"] = (dc <= TOL_POS, f"d={dc:.2e} of diag {diag:.4f}")
    db = max(max(abs(a["bbox"][k][i] - b["bbox"][k][i]) for i in range(3)) for k in (0, 1)) / diag
    out["bbox"] = (db <= TOL_POS, f"d={db:.2e} of diag")
    for name, key in (("faces", "faceCount"), ("edges", "edgeCount"),
                      ("vertices", "vertexCount"), ("shells", "shellCount"),
                      ("genus", "genus")):
        va, vb = ka.get(key), kb.get(key)
        out[name] = (va is not None and va == vb, f"{va} vs {vb}")
    # An IoU ABOVE 1 is impossible — vol(A and B) cannot exceed vol(A or B) —
    # so a value over the bound is an untrustworthy boolean, not a good score,
    # and it must not pass silently. MEASURED: model 00003025 returns 1.002857.
    out["iou"] = (iou is not None and TOL_IOU <= iou <= 1.0 + (1.0 - TOL_IOU),
                  f"{iou:.6f}" if iou is not None else "unmeasurable")
    return out


def perturb(ir: str, factor: float) -> str:
    """THE NEGATIVE CONTROL: scale every EXTRUDE distance, and expect the gate to fail.

    A gate that has never rejected anything has not been shown to be able to.
    "0 differences" across three variants was once one binary compared with
    itself; the cure is a positive control that MUST fail. Scaling every extrude
    by 1% moves volume ~1% and the bbox by 1% of the Z extent — an order of
    magnitude past every tolerance here — so a run with --negative-control must
    report a pass rate of ZERO. If it does not, the harness is comparing
    something to itself and none of its green is evidence.
    """
    out = []
    for line in ir.splitlines():
        i = line.find("EXTRUDE(")
        if i < 0:
            out.append(line)
            continue
        head, rest = line[:i + len("EXTRUDE(")], line[i + len("EXTRUDE("):]
        parts = rest.rsplit(")", 1)[0].split(",")
        parts[1] = f" {float(parts[1]) * factor:.6f}"
        out.append(head + ",".join(parts) + ")")
    return "\n".join(out) + "\n"


def measure_pair(step_a: str, step_b: str) -> dict:
    """Read both arms' STEP, measure each, and compute the exact IoU.

    RUN IN A CHILD PROCESS, WITH A TIMEOUT, and that is not defensive
    boilerplate: MEASURED, one model's OCCT boolean held this stage at 99% CPU
    for over ten minutes with flat RSS, and because the loop was in-process
    there was no way to fail that model without failing the whole run. This is
    the same "one record must not cost the batch" shape already fixed for the
    kernel stage; the reference arm had the identical hole and it only showed at
    corpus scale.
    """
    sa, sb = read_step(step_a), read_step(step_b)
    out = {"a": measure(sa), "b": measure(sb)}
    try:
        out["iou"] = boolean_iou(sa, sb)
    except Exception as e:
        out["iou"] = None
        out["iou_error"] = f"{type(e).__name__}: {e}"
    return out


# ------------------------------------------------------------------------- driver
def main() -> int:
    # Worker mode first: it takes two paths and nothing else, so it must not
    # require the driver's arguments.
    if len(sys.argv) == 4 and sys.argv[1] == "--measure-pair":
        print(json.dumps(measure_pair(sys.argv[2], sys.argv[3])))
        return 0

    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="directory of extracted ofs model dirs")
    ap.add_argument("--n", type=int, default=250)
    ap.add_argument("--verify", required=True, help="path to the built forge_verify")
    ap.add_argument("--out", required=True)
    ap.add_argument("--negative-control", type=float, default=0.0, metavar="FACTOR",
                    help="scale every emitted EXTRUDE depth by FACTOR (e.g. 1.01); the gate "
                         "MUST then pass ZERO models, or it is not measuring anything")
    ap.add_argument("--timeout", type=float, default=120.0,
                    help="seconds per model for forge_verify before it is failed")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    stepdir = os.path.join(a.out, "step")
    os.makedirs(stepdir, exist_ok=True)

    dirs = sorted(d for d in os.listdir(a.root) if d.isdigit())
    stride = max(1, len(dirs) // a.n)
    sample = dirs[::stride][:a.n]

    refusals = collections.Counter()
    blocked_by = collections.Counter()        # models with this gate among their blockers
    only_blocked_by = collections.Counter()   # models this gate ALONE blocks -> the recovery
    cleared_all_gates = [0]
    rows, jobs = [], []
    n_seen = 0

    # ---- stage 1: translate, and build the reference arm
    for d in sample:
        hits = sorted(glob.glob(os.path.join(a.root, d, "*.yml")))
        if not hits:
            refusals["no_yml_in_model_dir"] += 1
            continue
        n_seen += 1
        # EVERY gate this model violates, not just the first — the only way to
        # answer "how many models would supporting X actually recover".
        try:
            viol = {v[0] for v in T.gate_violations(T.load_features(hits[0]))}
        except Exception:
            viol = None
        if viol is not None:
            for r_ in viol:
                blocked_by[r_] += 1
            if len(viol) == 1:
                only_blocked_by[next(iter(viol))] += 1
            elif not viol:
                cleared_all_gates[0] += 1
        try:
            pl = T.plan(hits[0])
        except T.Refused as r:
            refusals[r.reason] += 1
            continue
        except Exception as e:                       # a crash is NOT a refusal
            refusals["translator_crash:" + type(e).__name__] += 1
            rows.append({"id": d, "stage": "plan", "crash": traceback.format_exc()[-600:]})
            continue
        try:
            ir = T.emit(pl)
            if a.negative_control:
                ir = perturb(ir, a.negative_control)
        except Exception as e:
            refusals["emitter_crash:" + type(e).__name__] += 1
            continue
        try:
            ref = build_reference(pl)
            rstep = os.path.join(stepdir, f"{d}.ref.step")
            write_step(ref, rstep)
        except Exception as e:
            refusals["reference_arm_failed:" + type(e).__name__] += 1
            continue
        jobs.append({"id": d, "yml": hits[0], "ir": ir, "refstep": rstep,
                     "stats": pl["stats"],
                     "outstep": os.path.join(stepdir, f"{d}.forge.step")})

    # ---- stage 2: one forge_verify batch for every emitted tree
    # TWO records per model: the emitted tree, and the reference STEP bound
    # through INPUT(). The second is what makes topology comparable — genus,
    # face/edge/vertex/shell counts then come from ONE instrument on BOTH arms.
    # (Deriving the reference's genus from Euler instead was tried and is WRONG:
    # V-E+F = 2-2g needs every face to be a disk, and a prism top face with a
    # hole in it is an annulus, so a real genus-1 solid reported genus 0.)
    # ONE SUBPROCESS PER MODEL, WITH A TIMEOUT — not one batch.
    #
    # MEASURED: with all models in a single batch, one model's voxel IoU ran for
    # 10 minutes at 99% CPU and the other 19 never got a verdict. Voxel IoU is
    # `grid^3` point-in-solid classifications against BRepClass3d, twice, so a
    # busy solid on a 64-grid is ~500k classifications; batching makes that one
    # model's cost everyone's cost. Per-model isolation turns an unbounded hang
    # into ONE named, counted failure (`kernel_timeout`).
    kern = {}
    for n_k, j in enumerate(jobs, 1):
        if n_k % 25 == 0:
            print(f"[kernel] {n_k}/{len(jobs)}", file=sys.stderr, flush=True)
        recs = [
            {"id": j["id"] + "|A", "ir": j["ir"], "outStep": j["outstep"]},
            {"id": j["id"] + "|B", "ir": "%1 = INPUT()\nRESULT(%1)\n",
             "inputStep": j["refstep"]},
        ]
        lines = "".join(json.dumps(r) + "\n" for r in recs)
        try:
            pr = subprocess.run([a.verify], input=lines, capture_output=True,
                                text=True, timeout=a.timeout)
        except subprocess.TimeoutExpired:
            continue                       # -> kernel_no_response, counted below
        for ln in pr.stdout.splitlines():
            ln = ln.strip()
            if not ln.startswith("{"):
                continue
            try:
                r = json.loads(ln)
            except Exception:
                continue
            kern[r.get("id")] = r

    # ---- stage 3: measure arm A's own STEP with the SAME instrument, then compare
    results, fails = [], collections.Counter()
    passes = 0
    n_done = 0
    comp_pass = collections.Counter()
    for j in jobs:
        n_done += 1
        if n_done % 25 == 0:
            print(f"[compare] {n_done}/{len(jobs)}", file=sys.stderr, flush=True)
        ka, kb = kern.get(j["id"] + "|A"), kern.get(j["id"] + "|B")
        rec = {"id": j["id"], "stats": j["stats"], "ir_lines": j["ir"].count("\n")}
        if ka is None or kb is None:
            fails["kernel_no_response"] += 1
            rec["fail"] = "kernel_no_response"
            results.append(rec)
            continue
        if not ka.get("ok"):
            fails["kernel_compile_error"] += 1
            rec["fail"] = "kernel_compile_error"
            rec["error"] = ka.get("error", "")[:200]
            results.append(rec)
            continue
        if not kb.get("ok"):
            fails["reference_step_unreadable_by_kernel"] += 1
            rec["fail"] = "reference_step_unreadable_by_kernel"
            rec["error"] = kb.get("error", "")[:200]
            results.append(rec)
            continue
        if not os.path.exists(j["outstep"]):
            fails["kernel_wrote_no_step"] += 1
            rec["fail"] = "kernel_wrote_no_step"
            results.append(rec)
            continue
        try:
            wp = subprocess.run([sys.executable, os.path.abspath(__file__), "--measure-pair",
                                 j["outstep"], j["refstep"]],
                                capture_output=True, text=True, timeout=a.timeout)
            m = json.loads(wp.stdout.strip().splitlines()[-1])
            ma, mb, iou = m["a"], m["b"], m.get("iou")
        except subprocess.TimeoutExpired:
            fails["measure_timeout"] += 1
            rec["fail"] = "measure_timeout"
            results.append(rec)
            continue
        except Exception as e:
            fails["step_unmeasurable:" + type(e).__name__] += 1
            rec["fail"] = "step_unmeasurable"
            results.append(rec)
            continue
        if not (mb["volume"] > 0):
            fails["reference_arm_empty"] += 1
            rec["fail"] = "reference_arm_empty"
            results.append(rec)
            continue
        cmp = compare(ma, mb, ka, kb, iou)
        for name, (okc, _) in cmp.items():
            if okc:
                comp_pass[name] += 1
        bad = [n for n, (okc, _) in cmp.items() if not okc]
        rec["compare"] = {n: {"pass": okc, "measured": m} for n, (okc, m) in cmp.items()}
        if bad:
            fails["mismatch:" + "+".join(sorted(bad))] += 1
            rec["fail"] = "mismatch"
            rec["mismatched"] = bad
        else:
            passes += 1
            rec["fail"] = None
        results.append(rec)

    summary = {
        "sampled_model_dirs": len(sample),
        "models_read": n_seen,
        "translated": len(jobs),
        "passed_full_vector": passes,
        "refusals": dict(refusals.most_common()),
        "failures": dict(fails.most_common()),
        "component_pass_counts": dict(comp_pass.most_common()),
        "gate_blocks_models": dict(blocked_by.most_common()),
        "gate_is_the_ONLY_blocker": dict(only_blocked_by.most_common()),
        "models_clearing_every_declarative_gate": cleared_all_gates[0],
        "tolerances": {"rel": TOL_REL, "pos": TOL_POS, "iou": TOL_IOU},
        "negative_control_factor": a.negative_control or None,
    }
    with open(os.path.join(a.out, "summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2)
    with open(os.path.join(a.out, "results.jsonl"), "w") as fh:
        for r in results:
            fh.write(json.dumps(r) + "\n")
    with open(os.path.join(a.out, "emitted.jsonl"), "w") as fh:
        for j in jobs:
            fh.write(json.dumps({"id": j["id"], "yml": j["yml"], "ir": j["ir"],
                                 "outstep": j["outstep"]}) + "\n")

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
