# OCCT segfaults on Archie-generated geometry — one defect class, four instances

**Date:** 2026-08-31 · **Status:** MEASURED, not yet fixed · **Severity:** highest available —
it is the only failure mode that produces no diagnostic at all.

## What happens

`forge_verify` dies with `SIGSEGV / KERN_INVALID_ADDRESS at 0x0` while classifying a solid built
from a model-emitted feature tree. Four crash reports on this machine today, and they are **one
bug, not four**:

| time (local) | signal | faulting frame |
|---|---|---|
| 00:40:56 | SIGSEGV | `libTKG2d :: Geom2d_Curve::Value(double) const` |
| 04:05:38 | SIGSEGV | `libTKG2d :: Geom2d_Curve::Value(double) const` |
| 10:08:50 | SIGSEGV | `libTKGeomBase :: BndLib_Box2dCurve::Compute(handle<Geom2d_Conic> const&, ...)` |
| 16:51:53 | SIGSEGV | `libTKGeomBase :: BndLib_Box2dCurve::Compute(handle<Geom2d_Conic> const&, ...)` |

All four are a **null `Geom2d_Curve` handle dereferenced without a check**. The two frames are
two entry points into the same 2D-curve layer.

## The path in

Symbolicated stack of the 16:51:53 report, innermost last:

```
BRepClass3d_SolidClassifier::BRepClass3d_SolidClassifier(TopoDS_Shape const&)
BRepClass3d_SolidExplorer::BRepClass3d_SolidExplorer(TopoDS_Shape const&)
BRepClass3d_SolidExplorer::InitShape(TopoDS_Shape const&)
IntCurvesFace_Intersector::IntCurvesFace_Intersector(TopoDS_Face const&, ...)
BRepAdaptor_Surface::Initialize(TopoDS_Face const&, bool)
BRepTools::UVBounds(TopoDS_Face const&, double&, double&, double&, double&)
BRepTools::AddUVBounds(TopoDS_Face const&, Bnd_Box2d&)
BRepTools::AddUVBounds(TopoDS_Face const&, TopoDS_Edge const&, Bnd_Box2d&)
BndLib_Add2dCurve::Add(handle<Geom2d_Curve> const&, double, ...)
BndLib_Box2dCurve::PerformLineConic()
BndLib_Box2dCurve::Compute(handle<Geom2d_Conic> const&, ...)   <-- SIGSEGV
```

`AddUVBounds` walks a face's edges and asks each for its **p-curve** — the edge's 2D
representation *on that surface*. When an edge carries no p-curve for the face it bounds, the
handle comes back null and OCCT dereferences it. There is no guard anywhere on this path.

## Why it matters more than its rate suggests

The rate is low — of 600 held-out emissions run through `tools/pinned/forge_verify`, 6 (1.0%)
ended in the harness bucket, and in that particular run **all six were 300 s timeouts rather
than crashes**, so the segfault rate is lower still. That undersells it for three reasons:

1. **A segfault yields nothing.** No verdict, no error string, no partial measurement. Every
   other failure in the taxonomy — a failed VERIFY, a not-closed solid, a parse error — tells
   the repair loop what to fix. This one tells it nothing, and is recorded as
   *"instrument failure, not a score"*, which is indistinguishable from a broken harness.
2. **It is an unbounded liability in the product direction we are building.** The whole point
   of the programme is that Archie emits a feature tree and the kernel compiles it. A kernel
   that segfaults on adversarial-but-legal input cannot be driven by a generative model, and
   cannot be embedded in a desktop app where the crash takes the user's session with it.
3. **The input is not malformed.** These trees parse, and the shapes build far enough to reach
   solid classification. The geometry is merely *degenerate in a way OCCT does not check*.

## The fix belongs on our side of the boundary

The faulting toolkits are `TKG2d`, `TKGeomBase`, `TKBRep`, `TKTopAlgo` — third-party code we do
not control, and OCCT has no null check to enable. Two responses, in order:

1. **Guard before the call (do this first, it is cheap).** Before handing a shape to any
   `BRepClass3d_*` classifier, walk its faces and assert every bounding edge has a p-curve on
   that face (`BRep_Tool::CurveOnSurface` returning a non-null handle). A face that fails is a
   *diagnosable* error — "face N edge M has no p-curve on its surface" — instead of a segfault.
   This converts the worst failure mode in the taxonomy into an ordinary one.
2. **Native replacement removes the class.** The native classifier path, when it exists, is code
   we own and can make total. This is a concrete argument for the drop ladder that is
   independent of the closure count: `TKGeomBase` and `TKG2d` are not merely dependencies to be
   retired for tidiness, they are actively crashing on our own generated input.

## Reproducing

The crashing inputs were not captured — the crash reports name the process, not the stdin. To
get a reproducer, run the corpus with each emission written to a file before it is fed in, so
the last file written when the process dies is the trigger:

```
implementation/sacrosanct/tools/verify_op_gate_truth.py \
  --emissions runs/composite_anchor/axis_named_v7_e600/emissions.jsonl \
  --verify tools/pinned/forge_verify --jobs 1
```

`--jobs 1` matters: with concurrent workers you cannot attribute the crash to an input.

**Known-slow rows for the separate timeout defect** (all 6 that exceeded 300 s in the n=600 run):
`ho385`, `ho535`, `ho1309`, `ho348`, `ho1241`, `ho211`. `ho385` is 71 statements / 13,696
characters and its op census is `HOLE 40, EXTRUDE 7, VERIFY 7, FUSE 6, POLY 5, RECT 3,
TRANSLATE 3` — 40 boolean cuts against a fused body. That is a performance defect in the
boolean path, not a correctness one, and it is tracked separately from this segfault.
