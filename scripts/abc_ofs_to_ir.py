#!/usr/bin/env python3
"""abc_ofs_to_ir.py — turn ONE real ABC/Onshape FeatureScript tree (an `ofs` YAML)
into Forge IR text, or REFUSE it with a named, counted reason.

    in : 00000042/00000042_<docid>_featurescript_000.yml   (BTMFeature list)
    out: "%1 = SKETCH(XY)\\n%2 = SPT(%1, ...)\\n... RESULT(%n)\\n"

================================ WHAT IS READ ================================

Onshape's serialised feature tree carries TWO kinds of number and they are NOT
alike, which is the single most important thing this file knows:

  * SKETCH GEOMETRY IS EVALUATED. Every curve ships its solved placement —
    BTCurveGeometryLine {pntX, pntY, dirX, dirY} + startParam/endParam, and
    BTCurveGeometryCircle {xCenter, yCenter, radius, xDir, yDir, clockwise}
    (+ startParam/endParam for an arc). All in METRES. So the constraints can be
    dropped on the floor: we read the answer, not the question, and no
    constraint solver is needed to place a point.

  * FEATURE PARAMETERS ARE NOT EVALUATED. MEASURED over 6,524 extrude depths in
    a stride sample of 1,400 models: `value` is 0.0 in 6,524 of 6,524 cases —
    100%. The number lives ONLY in `expression`, as FeatureScript source text
    WITH UNITS ('.25 in', '40.0*mm', '(3/16) in', '#size'). 6,308 of 6,524
    (96.7%) are a bare `<number> <unit>`; the rest are arithmetic. So a
    translator that reads `value` builds every solid 0 mm thick and never
    notices. This file evaluates the EXPRESSION, through a whitelisted AST —
    never eval() — and REFUSES a variable reference rather than guess.

============================== WHAT IS REFUSED ==============================

Refusal is a first-class output. Every refusal is one of the named reasons in
REFUSALS below, and the harness counts them; nothing is silently approximated
and nothing is silently dropped. In particular:

  * SPLINE / ELLIPSE / CONIC have no representation in the IR. There is no
    POLY fallback here on purpose: tessellating a spline into chords produces a
    tree that compiles, measures plausibly, and is wrong by an amount nobody
    ever computes. They are REFUSED and COUNTED.

  * AN UNRESOLVABLE QUERY IS REFUSED, NOT GUESSED. A sketch plane, a filleted
    edge, a revolve axis and a boolean scope are all Onshape *deterministic id*
    queries ('JHK', 'JTC'). Resolving one requires evaluating the document,
    which is exactly what we do not have. Three ids are document-independent
    constants and therefore resolvable: MEASURED over 787 models, 90.0% of the
    sketches created BEFORE any solid exists sit on {JDC, JCC, JEC} and nothing
    else is remotely as common — those are the three default planes. Every
    other id names a face or plane that only an evaluator can find, so a sketch
    on one is refused.

  * A MODEL THAT MIXES DEFAULT PLANES IS REFUSED. Forge's SKETCH(PLANE) keyword
    is parsed but NOT APPLIED — the compiler says so on the verify channel and
    solves every sketch on Z=0 (FeatureTreeCompiler.cpp, skNew). A single-plane
    model is therefore built in its own sketch frame, which is a rigid rotation
    of the Onshape one: volume, area, topology and sorted bbox extents are
    unchanged. A model that mixes planes would need the id -> world-axis
    mapping, and that mapping is NOT established by anything measured here.
    Refusing is the difference between an unproven orientation and a wrong one.

======================= ONE KERNEL DEFECT, DESIGNED AROUND =======================

MEASURED at this SHA with the built forge_verify (positive control, two
concentric circles r=20 and r=5 in one sketch, extruded 10):

    expected  pi*(400-25)*10 = 11780.97   genus 1
    measured  pi*400*10      = 12566.37   genus 0, no error, valid:true

EXTRUDE reaches forge::part::extrudeProfile -> firstWire(sketch): the FIRST
wire only. Every other closed loop in the sketch is discarded silently, so a
plate with a bolt hole builds as a plate, and a square drawn beside a circle
builds as the circle. `ringsToProfile` (the native path) does handle holes, but
its runtime gate (forgeNativeFeaturesEnabled) is off in the shipped binary.

So this translator NEVER emits a multi-loop sketch. It splits the sketch into
one closed ring per SKETCH/SOLVE/EXTRUDE, computes the even-odd nesting itself
in 2D, and states the holes as CUT. That is not a workaround for a bug in this
file; it is the emission that is correct against the kernel as it actually is.

Usage:
    python3 scripts/abc_ofs_to_ir.py <model.yml>            # IR on stdout, or a refusal
    python3 scripts/abc_ofs_to_ir.py --json <model.yml>     # {ir, refusal, stats}
"""
from __future__ import annotations

import argparse
import ast
import glob
import json
import math
import os
import re
import sys

import yaml

try:
    from yaml import CSafeLoader as _Loader
except Exception:                                     # pragma: no cover
    from yaml import SafeLoader as _Loader


# --------------------------------------------------------------------- constants
M_TO_MM = 1000.0

# The three document-independent default-plane deterministic ids. MEASURED, not
# recalled: over 787 stride-sampled models these three are 90.0% of the sketch
# planes used before any solid exists (JDC 49.2%, JCC 30.1%, JEC 10.7%), and the
# next id is 2.7%. They are constants across documents; every other id is a face
# or a constructed plane and cannot be resolved without evaluating the document.
DEFAULT_PLANE_IDS = frozenset(("JDC", "JCC", "JEC"))

# Curve types with an exact IR representation. Everything else is refused.
REPRESENTABLE_CURVES = frozenset(("BTCurveGeometryLine", "BTCurveGeometryCircle"))

# Point-merge tolerance in MILLIMETRES. Onshape ships solver-converged
# coordinates, so shared endpoints agree far below this; the kernel's own
# stitcher uses 1e-5. Sitting below that means a ring this file calls closed is
# one the kernel will also close.
JOIN_TOL_MM = 1.0e-6

# Arcs are split so no sub-arc exceeds this sweep. forge::extractProfileRings
# normalises a sweep into (-pi, pi] and returns the MINOR arc, so an arc wider
# than 180 degrees would silently become its own complement. 120 keeps every
# sub-arc unambiguous with margin, on the SAME circle (exact, not tessellated).
MAX_ARC_SWEEP_DEG = 120.0

# FeatureScript length units -> metres.
UNITS_M = {
    "meter": 1.0, "meters": 1.0, "metre": 1.0, "metres": 1.0, "m": 1.0,
    "centimeter": 1e-2, "centimeters": 1e-2, "centimetre": 1e-2, "centimetres": 1e-2, "cm": 1e-2,
    "millimeter": 1e-3, "millimeters": 1e-3, "millimetre": 1e-3, "millimetres": 1e-3, "mm": 1e-3,
    "micrometer": 1e-6, "micrometre": 1e-6, "micron": 1e-6,
    "inch": 0.0254, "inches": 0.0254, "in": 0.0254,
    "foot": 0.3048, "feet": 0.3048, "ft": 0.3048,
    "yard": 0.9144, "yards": 0.9144, "yd": 0.9144,
}

SUPPORTED_FEATURES = frozenset(("newSketch", "extrude"))

REFUSALS = (
    "unsupported_feature",               # an op outside {newSketch, extrude}
    "unrepresentable_curve",             # spline / ellipse / conic / text / image
    "sketch_plane_not_a_default_plane",  # the plane is an unresolvable query
    "model_mixes_sketch_planes",         # would need an unverified axis mapping
    "extrude_bound_needs_evaluation",    # THROUGH_ALL / UP_TO_* have no numeric depth
    "extrude_second_direction",
    "extrude_draft",
    "extrude_not_solid",
    "extrude_scope_not_default",         # a boolean scope query we cannot resolve
    "extrude_without_own_sketch",
    "depth_expression_unevaluable",
    "depth_variable_reference",
    "depth_not_positive",
    "sketch_has_no_closed_region",
    "sketch_ring_did_not_close",
    "sketch_junction_is_ambiguous",      # a vertex with degree != 2
    "sketch_has_multiple_regions",       # cannot tell which region the extrude took
    "boolean_without_existing_body",
    "model_creates_multiple_bodies",
    "model_produced_no_solid",
)


class Refused(Exception):
    """A named, countable refusal. `reason` must be one of REFUSALS."""

    def __init__(self, reason: str, detail: str = ""):
        assert reason in REFUSALS, f"unnamed refusal reason: {reason}"
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


# ------------------------------------------------------------ expression evaluator
class _UnitValue:
    """A number carrying a length exponent, so '2*mm' is a length and '3/4' is not."""

    __slots__ = ("v", "dim")

    def __init__(self, v: float, dim: int = 0):
        self.v = float(v)
        self.dim = int(dim)


def _ev(node) -> _UnitValue:
    if isinstance(node, ast.Expression):
        return _ev(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise Refused("depth_expression_unevaluable", f"non-numeric constant {node.value!r}")
        return _UnitValue(float(node.value), 0)
    if isinstance(node, ast.Name):
        nm = node.id
        if nm.startswith(_UNIT_PREFIX):
            nm = nm[len(_UNIT_PREFIX):]
        u = UNITS_M.get(nm.lower())
        if u is None:
            raise Refused("depth_expression_unevaluable", f"unknown identifier {node.id!r}")
        return _UnitValue(u, 1)
    if isinstance(node, ast.UnaryOp):
        a = _ev(node.operand)
        if isinstance(node.op, ast.UAdd):
            return a
        if isinstance(node.op, ast.USub):
            return _UnitValue(-a.v, a.dim)
        raise Refused("depth_expression_unevaluable", "unary op")
    if isinstance(node, ast.BinOp):
        a, b = _ev(node.left), _ev(node.right)
        if isinstance(node.op, ast.Add):
            if a.dim != b.dim:
                raise Refused("depth_expression_unevaluable", "adding mixed dimensions")
            return _UnitValue(a.v + b.v, a.dim)
        if isinstance(node.op, ast.Sub):
            if a.dim != b.dim:
                raise Refused("depth_expression_unevaluable", "subtracting mixed dimensions")
            return _UnitValue(a.v - b.v, a.dim)
        if isinstance(node.op, ast.Mult):
            return _UnitValue(a.v * b.v, a.dim + b.dim)
        if isinstance(node.op, ast.Div):
            if b.v == 0.0:
                raise Refused("depth_expression_unevaluable", "division by zero")
            return _UnitValue(a.v / b.v, a.dim - b.dim)
        if isinstance(node.op, ast.Pow):
            if b.dim != 0 or not float(b.v).is_integer():
                raise Refused("depth_expression_unevaluable", "non-integer or dimensional power")
            return _UnitValue(a.v ** b.v, a.dim * int(b.v))
        raise Refused("depth_expression_unevaluable", "binary op")
    raise Refused("depth_expression_unevaluable", type(node).__name__)


_TOKEN = re.compile(r"""
    (?P<num>(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)
  | (?P<name>[A-Za-z_][A-Za-z_0-9]*)
  | (?P<op>\*\*|[-+*/()])
  | (?P<ws>\s+)
""", re.X)

_UNIT_PREFIX = "_forge_unit_"


def eval_length_m(expr: str) -> float:
    """Evaluate a FeatureScript LENGTH expression to metres, or refuse.

    Whitelisted AST only — never eval(). A '#variable' reference is refused
    rather than defaulted, because a defaulted dimension is a fabricated one.

    THE UNIT WORDS ARE RENAMED BEFORE PARSING, and that is not cosmetic: the
    single most common unit in this corpus is `in` (2,050 of 6,524 depths), and
    `in` is a PYTHON KEYWORD. Handing '.25 in' to ast.parse raises SyntaxError,
    so an evaluator that leans on Python's tokeniser rejects the most common
    dimension in the dataset while accepting '40.0*mm' — it looks like a data
    problem and is a parser problem. Implicit multiplication ('.25 in',
    '.25in') is made explicit here for the same reason.
    """
    e = (expr or "").strip()
    if not e:
        raise Refused("depth_expression_unevaluable", "empty expression")
    if "#" in e:
        raise Refused("depth_variable_reference", e[:60])
    e = e.replace("^", "**")

    toks, pos = [], 0
    while pos < len(e):
        m = _TOKEN.match(e, pos)
        if not m:
            raise Refused("depth_expression_unevaluable", f"unlexable at {e[pos:pos + 12]!r}")
        pos = m.end()
        if m.lastgroup == "ws":
            continue
        if m.lastgroup == "name":
            key = m.group().lower()
            if key not in UNITS_M:
                raise Refused("depth_expression_unevaluable", f"unknown identifier {m.group()!r}")
            toks.append(("unit", _UNIT_PREFIX + key))
        elif m.lastgroup == "num":
            toks.append(("num", m.group()))
        else:
            toks.append(("op", m.group()))

    # implicit multiplication: <number|)|unit> followed by <unit|(|number>
    out = []
    for i, (k, v) in enumerate(toks):
        if out:
            pk, pv = toks[i - 1]
            left = pk in ("num", "unit") or (pk == "op" and pv == ")")
            right = k in ("num", "unit") or (k == "op" and v == "(")
            if left and right:
                out.append("*")
        out.append(v)
    try:
        tree = ast.parse("".join(out), mode="eval")
    except SyntaxError:
        raise Refused("depth_expression_unevaluable", e[:60])
    val = _ev(tree)
    if val.dim != 1:
        raise Refused("depth_expression_unevaluable", f"{e[:40]!r} is not a length (dim={val.dim})")
    return val.v


# ------------------------------------------------------------------- YAML reading
def _params(msg: dict) -> dict:
    return {p["message"].get("parameterId"): p["message"] for p in (msg.get("parameters") or [])}


def _query_ids(pm: dict) -> list:
    out = []
    for q in (pm.get("queries") or []):
        out += (q["message"].get("geometryIds") or [])
    return out


def load_features(path: str) -> list:
    with open(path) as fh:
        doc = yaml.load(fh, Loader=_Loader)
    return [f["message"] for f in (doc.get("features") or [])]


# ------------------------------------------------------------------ sketch reading
class Seg:
    """One open sketch segment in MILLIMETRES: a line, or an arc on a known circle."""

    __slots__ = ("kind", "a", "b", "c", "r", "ccw")

    def __init__(self, kind, a, b, c=None, r=0.0, ccw=True):
        self.kind = kind      # 'line' | 'arc'
        self.a = a            # (x, y) start
        self.b = b            # (x, y) end
        self.c = c            # (x, y) centre   (arc only)
        self.r = r            # radius mm       (arc only)
        self.ccw = ccw        # sweep direction (arc only)


class Circ:
    __slots__ = ("c", "r")

    def __init__(self, c, r):
        self.c = c
        self.r = r


def read_sketch(msg: dict):
    """-> (plane_id, [Seg], [Circ]).  Refuses any curve with no IR representation."""
    pr = _params(msg)
    ids = _query_ids(pr.get("sketchPlane", {}))
    if len(ids) != 1 or ids[0] not in DEFAULT_PLANE_IDS:
        raise Refused("sketch_plane_not_a_default_plane", ",".join(ids) or "<none>")
    plane = ids[0]

    segs, circles = [], []
    for ent in (msg.get("entities") or []):
        em = ent["message"]
        g = em.get("geometry")
        tname = g["typeName"] if g else ent.get("typeName")
        if tname == "BTMSketchPoint":
            continue                                   # a bare point carries no boundary
        if tname not in REPRESENTABLE_CURVES:
            raise Refused("unrepresentable_curve", str(tname))
        if em.get("isConstruction"):
            continue                                   # construction geometry is not boundary
        gm = g["message"]
        if tname == "BTCurveGeometryLine":
            px, py = gm["pntX"] * M_TO_MM, gm["pntY"] * M_TO_MM
            dx, dy = gm["dirX"], gm["dirY"]
            s, e = em.get("startParam"), em.get("endParam")
            if s is None or e is None:
                raise Refused("unrepresentable_curve", "unbounded line (no start/end param)")
            s *= M_TO_MM
            e *= M_TO_MM
            a = (px + dx * s, py + dy * s)
            b = (px + dx * e, py + dy * e)
            if math.hypot(b[0] - a[0], b[1] - a[1]) <= JOIN_TOL_MM:
                continue                               # degenerate
            segs.append(Seg("line", a, b))
        else:
            cx, cy = gm["xCenter"] * M_TO_MM, gm["yCenter"] * M_TO_MM
            r = gm["radius"] * M_TO_MM
            if not (r > JOIN_TOL_MM):
                continue
            s, e = em.get("startParam"), em.get("endParam")
            if s is None or e is None:
                circles.append(Circ((cx, cy), r))      # a FULL circle: its own closed ring
                continue
            # An ARC. The local frame is (xDir, yDir); `clockwise` flips the
            # second basis vector, so start/endParam stay a plain sweep in that
            # frame and the world-space direction follows the flip.
            ux, uy = gm.get("xDir", 1.0), gm.get("yDir", 0.0)
            n = math.hypot(ux, uy) or 1.0
            ux, uy = ux / n, uy / n
            cw = bool(gm.get("clockwise", False))
            vx, vy = (uy, -ux) if cw else (-uy, ux)

            def at(t, ux=ux, uy=uy, vx=vx, vy=vy, cx=cx, cy=cy, r=r):
                return (cx + r * (math.cos(t) * ux + math.sin(t) * vx),
                        cy + r * (math.cos(t) * uy + math.sin(t) * vy))

            sweep = e - s
            if abs(sweep) < 1e-12:
                continue
            # Split so no sub-arc can be mistaken for its own complement by the
            # kernel's minor-arc normalisation. Every split point lies ON the
            # true circle, so this is exact — it is not a tessellation.
            nsub = max(1, int(math.ceil(abs(math.degrees(sweep)) / MAX_ARC_SWEEP_DEG)))
            ccw = (sweep > 0) if not cw else (sweep < 0)
            for i in range(nsub):
                t0 = s + sweep * (i / nsub)
                t1 = s + sweep * ((i + 1) / nsub)
                segs.append(Seg("arc", at(t0), at(t1), (cx, cy), r, ccw))
    return plane, segs, circles


# ------------------------------------------------------------------ ring assembly
class _Pool:
    """Endpoint pool: merges coincident endpoints so rings can chain."""

    def __init__(self, tol=JOIN_TOL_MM):
        self.pts = []
        self.tol = tol

    def add(self, p):
        for i, q in enumerate(self.pts):
            if abs(p[0] - q[0]) <= self.tol and abs(p[1] - q[1]) <= self.tol:
                return i
        self.pts.append(p)
        return len(self.pts) - 1


def build_rings(segs):
    """Chain open segments into closed rings. Refuses an open or ambiguous loop."""
    if not segs:
        return []
    pool = _Pool()
    ends = [(pool.add(s.a), pool.add(s.b)) for s in segs]
    inc = {}
    for si, (i, j) in enumerate(ends):
        inc.setdefault(i, []).append(si)
        inc.setdefault(j, []).append(si)
    for v, lst in inc.items():
        if len(lst) != 2:
            raise Refused("sketch_junction_is_ambiguous", f"vertex degree {len(lst)}")

    rings, used = [], set()
    for start in range(len(segs)):
        if start in used:
            continue
        chain = [(start, False)]
        used.add(start)
        head, tail = ends[start]
        while True:
            nxt = None
            for si in inc.get(tail, []):
                if si in used:
                    continue
                i, j = ends[si]
                nxt = (si, i != tail)     # reversed when the segment's END meets our tail
                tail = j if i == tail else i
                break
            if nxt is None:
                break
            used.add(nxt[0])
            chain.append(nxt)
        if tail != head:
            raise Refused("sketch_ring_did_not_close", f"{len(chain)} segments")
        rings.append(chain)
    return rings


def _ring_polyline(chain, segs, per_arc=64):
    """Sample a ring to a polygon — used ONLY for nesting/area, never for emission."""
    pts = []
    for si, rev in chain:
        s = segs[si]
        a, b = (s.b, s.a) if rev else (s.a, s.b)
        if s.kind == "line":
            pts.append(a)
        else:
            t0 = math.atan2(a[1] - s.c[1], a[0] - s.c[0])
            t1 = math.atan2(b[1] - s.c[1], b[0] - s.c[0])
            ccw = s.ccw if not rev else (not s.ccw)
            d = t1 - t0
            if ccw:
                while d <= 1e-12:
                    d += 2 * math.pi
            else:
                while d >= -1e-12:
                    d -= 2 * math.pi
            n = max(2, int(abs(d) / (2 * math.pi) * per_arc) + 1)
            for k in range(n):
                t = t0 + d * (k / n)
                pts.append((s.c[0] + s.r * math.cos(t), s.c[1] + s.r * math.sin(t)))
    return pts


def _circle_polyline(circ, n=64):
    return [(circ.c[0] + circ.r * math.cos(2 * math.pi * k / n),
             circ.c[1] + circ.r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def _area(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        a += x0 * y1 - x1 * y0
    return 0.5 * a


def _inside(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xi:
                inside = not inside
    return inside


# ------------------------------------------------------------------- IR emission
class Emitter:
    def __init__(self):
        self.lines = []
        self.n = 0

    def op(self, text: str) -> int:
        self.n += 1
        self.lines.append(f"%{self.n} = {text}")
        return self.n

    def text(self, result_id: int) -> str:
        return "\n".join(self.lines + [f"RESULT(%{result_id})"]) + "\n"


def _num(x: float) -> str:
    """Fixed 6 dp — the IR is millimetres, so this is nanometre resolution."""
    s = f"{x:.6f}"
    return "0.000000" if s == "-0.000000" else s


def _emit_profile_solid(em: Emitter, region, segs, depth_mm, z0_mm, updir):
    """One closed region -> SKETCH/SPT/(SLINE|SARC|SCIRC)/SOLVE/EXTRUDE (+TRANSLATE)."""
    kind, payload = region
    sk = em.op("SKETCH(XY)")
    ptid = {}

    def pt(p):
        key = (round(p[0], 9), round(p[1], 9))
        if key not in ptid:
            ptid[key] = em.op(f"SPT(%{sk}, {_num(p[0])}, {_num(p[1])})")
        return ptid[key]

    if kind == "circle":
        c = pt(payload.c)
        em.op(f"SCIRC(%{c}, {_num(payload.r)})")
    else:
        for si, rev in payload:
            s = segs[si]
            a, b = (s.b, s.a) if rev else (s.a, s.b)
            ia, ib = pt(a), pt(b)
            if s.kind == "line":
                em.op(f"SLINE(%{ia}, %{ib})")
            else:
                ic = pt(s.c)
                em.op(f"SARC(%{ic}, %{ia}, %{ib})")
    prof = em.op(f"SOLVE(%{sk})")
    body = em.op(f"EXTRUDE(%{prof}, {_num(abs(depth_mm))}, 0, 0, {1 if updir > 0 else -1})")
    if abs(z0_mm) > 1e-9:
        body = em.op(f"TRANSLATE(%{body}, 0, 0, {_num(z0_mm)})")
    return body


# ------------------------------------------------------------------- gate scanner
def gate_violations(feats) -> list:
    """EVERY declarative gate a model violates, as [(reason, detail), ...].

    ONE implementation, two callers. `plan` raises on the first entry; the
    recovery ablation reads the whole list. The lesson this exists for is
    specific and was paid for once already: adding draft/splitPart/helix was
    PREDICTED to recover ~2,000 blocked models and MEASURED 745, because the
    same models were also blocked by importForeign. "How many models does gate
    G alone block" is only answerable if every gate is evaluated on every
    model — a first-refusal histogram cannot answer it and will overstate
    every candidate fix.
    """
    out = []
    planes = set()
    for m in feats:
        t = m.get("featureType")
        if t not in SUPPORTED_FEATURES:
            out.append(("unsupported_feature", str(t)))

    n_new = 0
    n_sketch = 0
    for idx, m in enumerate(feats):
        t = m.get("featureType")
        if t == "newSketch":
            n_sketch += 1
            pr = _params(m)
            ids = _query_ids(pr.get("sketchPlane", {}))
            if len(ids) != 1 or ids[0] not in DEFAULT_PLANE_IDS:
                out.append(("sketch_plane_not_a_default_plane", ",".join(ids) or "<none>"))
            else:
                planes.add(ids[0])
            for ent in (m.get("entities") or []):
                em = ent["message"]
                g = em.get("geometry")
                tn = g["typeName"] if g else ent.get("typeName")
                if tn == "BTMSketchPoint":
                    continue
                if tn not in REPRESENTABLE_CURVES:
                    out.append(("unrepresentable_curve", str(tn)))
                elif not em.get("isConstruction") and tn == "BTCurveGeometryLine" \
                        and (em.get("startParam") is None or em.get("endParam") is None):
                    out.append(("unrepresentable_curve", "unbounded line"))
        elif t == "extrude":
            pr = _params(m)
            if pr.get("bodyType", {}).get("value") != "SOLID":
                out.append(("extrude_not_solid", str(pr.get("bodyType", {}).get("value"))))
            bound = pr.get("endBound", {}).get("value")
            if bound not in ("BLIND", "SYMMETRIC"):
                out.append(("extrude_bound_needs_evaluation", str(bound)))
            if pr.get("hasSecondDirection", {}).get("value"):
                out.append(("extrude_second_direction", ""))
            if pr.get("hasDraft", {}).get("value"):
                out.append(("extrude_draft", ""))
            # BOOLEAN SCOPE. MEASURED over 500 stride-sampled models (179
            # extrudes): defaultScope is FALSE in 161 of 179 (89.9%) — an
            # explicit scope is the NORM, not the exception, so refusing on
            # `defaultScope == false` would refuse almost every real tree (it
            # held this translator at 0.0% until the count was looked at). What
            # matters is whether the scope is AMBIGUOUS: a model with more than
            # one NEW body is refused anyway, so a scope naming at most one body
            # can only name the one body that exists.
            n_scope = len(_query_ids(pr.get("booleanScope", {})))
            if n_scope > 1:
                out.append(("extrude_scope_not_default", f"{n_scope} scoped bodies"))
            if "depth" in pr:
                try:
                    d = eval_length_m(pr["depth"].get("expression"))
                    if not (d > 0):
                        out.append(("depth_not_positive", str(d)))
                except Refused as r:
                    out.append((r.reason, r.detail))
            op = pr.get("operationType", {}).get("value")
            if op == "NEW":
                n_new += 1
            elif op not in ("ADD", "REMOVE", "INTERSECT"):
                out.append(("boolean_without_existing_body", f"unknown operationType {op}"))
            elif n_new == 0:
                out.append(("boolean_without_existing_body", str(op)))
    if len(planes) > 1:
        out.append(("model_mixes_sketch_planes", ",".join(sorted(planes))))
    if n_new > 1:
        out.append(("model_creates_multiple_bodies", f"{n_new} NEW operations"))
    return out


# ---------------------------------------------------------------------- translate
def plan(path: str) -> dict:
    """Read + validate one model into an emission plan, or raise Refused.

    Kept separate from emission so an independent builder (the differential
    reference arm) consumes the SAME plan and cannot silently diverge on which
    ring is a hole — the two arms must differ in HOW they build, not in WHAT.
    """
    feats = load_features(path)
    viol = gate_violations(feats)
    if viol:
        raise Refused(*viol[0])

    sketches, planes, order = {}, set(), []
    for idx, m in enumerate(feats):
        if m.get("featureType") != "newSketch":
            continue
        pl, segs, circles = read_sketch(m)
        planes.add(pl)
        sketches[idx] = (segs, circles)
        order.append(idx)
    if len(planes) > 1:
        raise Refused("model_mixes_sketch_planes", ",".join(sorted(planes)))

    steps = []
    unconsumed = list(order)
    n_new = 0
    # The stats carry the EXPOSURE of every assumption the differential gate
    # cannot test, because both arms consume this same plan and a shared reading
    # error cancels between them. Named here so a reader can bound what the
    # green number does not cover:
    #   symmetric   SYMMETRIC depth read as the TOTAL extent, centred
    #   opposite    oppositeDirection read as extruding along -Z
    #   unbound     sketches no extrude claimed (the binding heuristic's slack)
    #   plane       the whole model is built in THIS sketch plane's own frame
    stats = {"sketches": len(order), "extrudes": 0, "rings": 0, "holes": 0,
             "islands": 0, "arcs": 0, "circles": 0, "symmetric": 0, "opposite": 0,
             "booleans": 0, "unbound_sketches": 0,
             "plane": next(iter(planes)) if planes else None}

    for idx, m in enumerate(feats):
        if m.get("featureType") != "extrude":
            continue
        # Every declarative gate on this extrude was already evaluated by
        # gate_violations above; re-testing them here would be a second
        # implementation of the same rules, free to drift from the one the
        # ablation reads. What is left is binding and geometry.
        pr = _params(m)
        bound = pr["endBound"]["value"]
        owner = None
        for s in sorted([s for s in unconsumed if s < idx], reverse=True):
            owner = s
            break
        if owner is None:
            raise Refused("extrude_without_own_sketch", "")
        unconsumed.remove(owner)

        depth_m = eval_length_m(pr["depth"].get("expression"))
        if not (depth_m > 0):
            raise Refused("depth_not_positive", str(depth_m))
        depth_mm = depth_m * M_TO_MM
        updir = -1 if bool(pr.get("oppositeDirection", {}).get("value")) else 1
        # SYMMETRIC: `depth` is the TOTAL extent, centred on the sketch plane.
        z0 = 0.0
        if bound == "SYMMETRIC":
            z0 = -depth_mm / 2.0
            updir = 1

        segs, circles = sketches[owner]
        chains = build_rings(segs)
        regions = [("ring", c) for c in chains] + [("circle", c) for c in circles]
        polys = [_ring_polyline(p, segs) if k == "ring" else _circle_polyline(p)
                 for k, p in regions]
        keep = [i for i, p in enumerate(polys) if len(p) >= 3 and abs(_area(p)) > 1e-12]
        regions = [regions[i] for i in keep]
        polys = [polys[i] for i in keep]
        if not regions:
            raise Refused("sketch_has_no_closed_region", "")

        # Even-odd nesting, computed here because the kernel's EXTRUDE takes the
        # FIRST wire only (see the header). Depth 0 = material, 1 = hole, ...
        depths = [sum(1 for j, pj in enumerate(polys) if j != i and _inside(pi[0], pj))
                  for i, pi in enumerate(polys)]
        outers = [i for i, d in enumerate(depths) if d == 0]
        if len(outers) != 1:
            # Onshape's extrude names WHICH regions it took with an unresolvable
            # deterministic-id query; with more than one region we would guess.
            raise Refused("sketch_has_multiple_regions", f"{len(outers)} outer rings")

        op = pr.get("operationType", {}).get("value")
        if op == "NEW":
            n_new += 1
            if n_new > 1:
                raise Refused("model_creates_multiple_bodies", f"{n_new} NEW operations")
        elif op not in ("ADD", "REMOVE", "INTERSECT"):
            raise Refused("boolean_without_existing_body", f"unknown operationType {op}")
        elif not steps:
            raise Refused("boolean_without_existing_body", str(op))

        stats["extrudes"] += 1
        if bound == "SYMMETRIC":
            stats["symmetric"] += 1
        if updir < 0:
            stats["opposite"] += 1
        if op != "NEW":
            stats["booleans"] += 1
        stats["rings"] += len(regions)
        stats["holes"] += sum(1 for d in depths if d % 2 == 1)
        stats["islands"] += sum(1 for d in depths if d >= 2 and d % 2 == 0)
        stats["circles"] += sum(1 for k, _ in regions if k == "circle")
        stats["arcs"] += sum(1 for k, p in regions if k == "ring"
                             for si, _ in p if segs[si].kind == "arc")

        steps.append({"op": op, "segs": segs, "regions": regions, "depths": depths,
                      "outer": outers[0], "depth_mm": depth_mm, "z0": z0, "updir": updir,
                      "bound": bound})

    if not steps:
        raise Refused("model_produced_no_solid", "")
    stats["unbound_sketches"] = len(unconsumed)
    return {"steps": steps, "stats": stats}


def emit(pl: dict) -> str:
    em = Emitter()
    body = None
    for st in pl["steps"]:
        segs, regions, depths = st["segs"], st["regions"], st["depths"]
        dmm, z0, updir = st["depth_mm"], st["z0"], st["updir"]
        tool = _emit_profile_solid(em, regions[st["outer"]], segs, dmm, z0, updir)
        # Holes overshoot both ends so a CUT never meets a coincident face.
        over = max(dmm * 1e-3, 1e-3)
        for i, d in enumerate(depths):
            if i == st["outer"]:
                continue
            if d % 2 == 1:
                zz = z0 - over if updir > 0 else z0 + over
                h = _emit_profile_solid(em, regions[i], segs, dmm + 2 * over, zz, updir)
                tool = em.op(f"CUT(%{tool}, %{h})")
            else:
                isl = _emit_profile_solid(em, regions[i], segs, dmm, z0, updir)
                tool = em.op(f"FUSE(%{tool}, %{isl})")
        if body is None:
            body = tool
        elif st["op"] in ("NEW", "ADD"):
            body = em.op(f"FUSE(%{body}, %{tool})")
        elif st["op"] == "REMOVE":
            body = em.op(f"CUT(%{body}, %{tool})")
        elif st["op"] == "INTERSECT":
            body = em.op(f"COMMON(%{body}, %{tool})")
    return em.text(body)


def translate(path: str) -> dict:
    pl = plan(path)
    ir = emit(pl)
    return {"ir": ir, "stats": pl["stats"], "plan": pl}


# ---------------------------------------------------------------------------- cli
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("model", help="one ofs YAML (or a model directory containing one)")
    ap.add_argument("--json", action="store_true", help="emit a JSON record instead of IR text")
    a = ap.parse_args()

    path = a.model
    if os.path.isdir(path):
        hits = sorted(glob.glob(os.path.join(path, "*.yml")))
        if not hits:
            print(f"no .yml under {path}", file=sys.stderr)
            return 2
        path = hits[0]

    try:
        out = translate(path)
    except Refused as r:
        if a.json:
            print(json.dumps({"path": path, "ir": None,
                              "refusal": r.reason, "detail": r.detail}))
            return 0
        print(f"REFUSED {r.reason}: {r.detail}", file=sys.stderr)
        return 1
    if a.json:
        print(json.dumps({"path": path, "ir": out["ir"], "refusal": None,
                          "stats": out["stats"]}))
    else:
        sys.stdout.write(out["ir"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
