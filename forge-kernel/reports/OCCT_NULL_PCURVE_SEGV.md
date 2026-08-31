# OCCT segfaults on BOTH model output AND the GOLD REFERENCE parts — one defect class, two paths

**Date:** 2026-08-31 · **Status:** MEASURED, not yet fixed · **Severity:** highest available —
it is the only failure mode that produces no diagnostic at all.

## What happens

Two different Forge binaries die with `SIGSEGV / KERN_INVALID_ADDRESS at 0x0`. ★**The two paths
crash on two different KINDS of input, and that is the most important fact in this report:**
path A is Archie's emitted geometry, but **path B is the GOLD REFERENCE parts** —
`runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps/*.step`, the ground truth we score
against. OCCT's own offset operation segfaults on the reference corpus. This is therefore not a
"the model emits bad geometry" defect. **At least eleven crash reports on this machine today, and the count was
still rising at 16:57 while this was being written** — `corpus_ab_coverage` is crashing
repeatedly under a running A/B job. All but one are the same bug, reached by two different
paths. The table below is a sample, not a census; treat the rate as *sustained*, not as eleven.

| time (local) | binary | faulting frame | path |
|---|---|---|---|
| 00:40:56 | `forge_verify` | `libTKG2d :: Geom2d_Curve::Value(double) const` | A |
| 04:05:38 | `forge_verify` | `libTKG2d :: Geom2d_Curve::Value(double) const` | A |
| 10:08:50 | `forge_verify` | `libTKGeomBase :: BndLib_Box2dCurve::Compute(handle<Geom2d_Conic>&, ...)` | A |
| 16:51:53 | `forge_verify` | `libTKGeomBase :: BndLib_Box2dCurve::Compute(handle<Geom2d_Conic>&, ...)` | A |
| 16:55:51 | `corpus_ab_coverage` | `libTKBRep :: BRep_Tool::CurveOnSurface(TopoDS_Edge const&, ...)` | **B** |
| 16:55:56 | `corpus_ab_coverage` | `libTKBRep :: BRep_Tool::CurveOnSurface(TopoDS_Edge const&, ...)` | **B** |
| 16:55:59 | `corpus_ab_coverage` | `libTKBRep :: BRep_Tool::CurveOnSurface(TopoDS_Edge const&, ...)` | **B** |
| (one more) | `corpus_ab_coverage` | `BRep_Tool::CurveOnSurface` | **B** |

All eight are a **null 2D-curve handle dereferenced without a check**. The ninth is unrelated and
is recorded at the bottom.

## Path A — solid classification

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

## Path B — offset construction (this is the SHELL operation)

```
BRepOffset_MakeOffset::BuildOffsetByInter(Message_ProgressRange)
BRepOffset_MakeOffset::IntersectEdges(NCollection_List<TopoDS_Shape> const&, ...)
BRepOffset_Inter2d::ConnexIntByInt(TopoDS_Face const&, BRepOffset_Offset&, ...)
BRepAdaptor_Curve::BRepAdaptor_Curve(TopoDS_Edge const&, TopoDS_Face const&)
BRepAdaptor_Curve::Initialize(TopoDS_Edge const&, TopoDS_Face const&)
BRep_Tool::CurveOnSurface(TopoDS_Edge const&, TopoDS_Face const&, ...)
BRep_Tool::CurveOnSurface(TopoDS_Edge const&, handle<Geom2d_Curve>&, ...)   <-- SIGSEGV
```

Same missing p-curve, reached while OCCT intersects the edges of an offset — the operation
behind `SHELL`. **This path is in `libTKOffset`**, the toolkit at the top of the drop ladder.

Two things make it worse than path A. It is a **modelling operation a user can invoke**, not a
read-only measurement path. And the inputs are the **gold reference STEP files**, observed live:

```
corpus_ab_coverage .../gold_ref_steps/ho1084.step --name=ho1084 --arm-timeout=20 --part-timeout=300
```

13 crashes inside four minutes during one 600-part A/B sweep. The sweep itself is sound — each
part is a separate subprocess, so a segfault costs one part rather than the run — which is why
this went unnoticed: **the harness was correctly designed to survive a failure mode nobody had
looked at.**

### ★ This CORRECTS the guard proposed below

An earlier revision of this report proposed guarding by *"calling `BRep_Tool::CurveOnSurface`
and checking the handle is non-null"*. **Path B rules that out: `CurveOnSurface` is itself the
faulting frame.** A guard that calls it would crash inside the guard. Whatever check we add must
establish the p-curve exists *without* going through the accessor that faults — inspecting the
edge's representation list directly, or validating at the point the shape is constructed rather
than at the point it is consumed. The mechanism below is inferred from the stacks, not read out
of OCCT's source, and the fix must be designed against the real code.

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

## ★ PRIOR ART — this bug class was already solved once, and it refutes the remedy below

`forge-kernel/src/DirectEdit.cpp:94-198` carries a **measured** guard for the same defect class,
dated 2026-08-29, with a reproducer (`test/ft_unify_concentric_hole_segv.ir`) and a 20-case sweep
(`unify_coaxial_guard_test.sh`). Read it before designing anything here. Three of its findings
bear directly on this report:

1. **`ShapeUpgrade_UnifySameDomain::IntUnifyFaces` dereferences a NULL `Geom2d_Curve` and
   SIGSEGVs** — the identical mechanism, a third path.
2. ★**"A pre-check for null pcurves on the INPUT cannot work: the input is clean
   (nullPcurves=0, measured on the crashing shape)."** The null is *produced inside OCCT's own
   merge*, not carried in. **This falsifies "repair the p-curve at construction" as a general
   remedy** — there may be nothing to repair. Whether that also holds for paths A and B here is
   NOT yet measured and must not be assumed either way.
3. **The targeted fix was tried and failed.** Withholding just the offending pair via
   `KeepShapes` was implemented and measured: all six crashing cases still SIGSEGV, because
   `IntUnifyFaces` still traverses a kept face and still asks it for the absent pcurve.
   `KeepShapes` stops a face being merged away; it does not keep the traversal off it.

**What shipped is the pattern to copy**: detect the *configuration* that triggers the crash
(mixed-representation coaxial equal-radius seam walls — an analytic `Geom_CylindricalSurface`
from `HOLE` against a `Geom_SurfaceOfLinearExtrusion` from `CIRCLE+EXTRUDE+CUT`), and where it
fires, return the body **unmerged**. The cost is a bore wall left split in two — a face count we
would rather not have, and *not a wrong solid*. That is exactly "tolerate, do not reject", and it
is already proven in this codebase.

Note also how narrow the trigger was: **exact radius coincidence and nothing else** (4.4950 ==
the cut radius SIGSEGVs; 4.4900 and 4.5000 are fine), and two coaxial equal-radius *analytic*
cylinders merge fine — so the mixed representation is load-bearing, not the coincidence. Expect
paths A and B to be similarly narrow, and do not generalise from a stack trace to a mechanism
without a sweep.

## The fix belongs on our side of the boundary

The faulting toolkits are `TKG2d`, `TKGeomBase`, `TKBRep`, `TKTopAlgo` — third-party code we do
not control, and OCCT has no null check to enable. Two responses, in order:

1. **REPAIR or TOLERATE at construction — never REJECT.** ★This is the second correction to
   this section, and it matters more than the first. An earlier revision said to *validate* the
   invariant at construction so a violating shape "never reaches OCCT". **That is a capability
   gate wearing a safety hat, and it would be worse than the crash.**

   The ground-truth parts this system exists to produce are exactly the shapes most likely to
   trip it. `archie_edit_214`'s input inventory is 430 faces — `cylinder` 167, `torus` 125,
   `bspline` 67, `sphere` 25, `cone` 4, `plane` 42 — and `task_101` is a 14-op tree yielding
   **329 faces / 753 edges**. A construction-time reject would refuse long, dense, curved trees
   at precisely the complexity the benchmark is made of, and the failure would look like "Archie
   cannot build complex parts" when the truth is "we refused to".

   ★**But NOT necessarily by repairing the input** — see the prior art above, where the crashing
   shape measured `nullPcurves=0` and the null was born inside OCCT's merge. The first job is
   therefore a MEASUREMENT, not a fix: for paths A and B, is the null pcurve *present on the
   input* or *generated inside the operation*? Run the sweep before writing the guard.

   - **If present on input:** build the missing p-curve (derivable from the 3D curve and the
     surface — what `BRepLib` is for), and failing that, omit that edge from the bounds
     accumulation and carry on. One edge's unknown UV contribution does not invalidate a solid.
   - **If generated inside:** input repair is worthless. Follow the shipped precedent — detect
     the triggering *configuration* and fall back to a degraded-but-correct path (as `unifyFaces`
     returns the body unmerged).

   Either way the check must not route through `BRep_Tool::CurveOnSurface`, which faults in path
   B. And either way, if it must fail, the error names the face and edge so the repair loop can
   act.
2. **Native replacement removes the class.** Native code is ours and can be made total. This is
   a concrete argument for the drop ladder that is **independent of the closure count**:
   `TKGeomBase`, `TKG2d`, `TKBRep` and `TKOffset` are not merely dependencies to be retired for
   tidiness, they are **crashing on the ground truth itself**. Path B lands in `TKOffset`
   specifically, which the ledger already identifies as the next contested toolkit — and it
   raises the stakes on that work from "closure accounting" to "OCCT's offset cannot survive our
   own reference corpus". The drop is no longer only a purity goal; it is a reliability fix.

## What the target actually looks like — why "just reject it" is not available

The emission length and detail this kernel has to survive are set by the ground-truth records,
not by the current corpus:

| fixture | shape |
|---|---|
| `task_101` | 14 authoring ops -> **329 faces, 753 edges**, volume 422 448 mm³, full per-face census |
| `archie_edit_214` | input **430 faces**: torus 125, **cylinder 167**, bspline 67, sphere 25, cone 4, plane 42 |

Two things follow. First, **the ground truth is built from primitives the 18-op UI vocabulary
forbids** — `task_101` op 2 is literally `cylinder(r=45,h=15,at=(40,0,30))`, and `CYL` is not
user-invocable. The gate cannot represent its own target. Second, **any safety mechanism that
refuses degenerate geometry will fire hardest on the most valuable parts**, because face count
and curved-surface density are what make a part both realistic and fragile. Tolerance is not a
nicety here; it is the requirement.

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


## The ninth crash is a different bug — in OUR code

`corpus_ab_coverage-2026-08-31-165507.ips` faults with no OCCT frame at all:

```
(anonymous namespace)::runArm<...>(...)
(anonymous namespace)::selftest((anonymous namespace)::Cfg const&)
main
```

A null dereference inside the A/B harness's own `runArm`, called from its **selftest** — i.e.
the harness crashes while checking itself, before measuring anything. That is tracked
separately from the OCCT defect above and must not be folded into its count: it is a Forge bug,
it is in a self-test, and *a harness that crashes in its own selftest cannot be trusted to
report an A/B result*. Whatever arm numbers that binary produced around 16:55 should be treated
as suspect until this is fixed.
