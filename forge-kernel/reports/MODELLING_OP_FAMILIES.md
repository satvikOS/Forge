# The three classical modelling families — census, gaps, and what it costs to close them

**Scope.** Wireframe/curve, B-rep, and solid op families: what the kernel can actually do,
what the feature-IR can name, what a user of the app can invoke, and the distance between
those three numbers.

**Pinned at** `32ee748514af06447040e117760a8f2f7f01fb16` (satvikOS/Forge, branch
`design/modelling-op-families`). Every "exists" claim below is a `file:line` in that tree.
Measured numbers were produced by `forge-kernel/build-unified/forge_verify`
(80336 bytes, mtime 2026-08-06 23:55 — the pinned verifier; it is **older than HEAD**, and
each measurement below says so where the distinction could matter).

---

## 0. The one-paragraph answer

The kernel is not short of modelling capability. It is short of **names**. Three independent
reachability layers exist and they are wildly different sizes:

| layer | what it is | size |
|---|---:|---:|
| C++ kernel API | `forge::part` / `forge::direct` / `forge::heal` / `forge::surfacing` / `forge::classa` / `forge::native::brep` | hundreds of entry points |
| N-API binding (`src/binding.cpp`) | what JS can call | 3278 `Set("…")` sites |
| **feature-IR** (`forge::ft::OpCode`) | **what Archie can emit** | **40 ops** (counted, `FeatureTree.hpp`) |
| `forge::ui` command registry | what a user can click | 20 IR-emitting commands → **18 ops** |

The IR compiler (`src/ft/FeatureTreeCompiler.cpp`, 2403 lines) calls roughly **fifty** kernel
entry points, and the set is closed — what it does not call, nothing downstream of Archie can
reach. `draftFaces`, `rib`, `thickenSurface`, `offsetSolid`, `extrudeProfileOnPlane`,
`holeWizard`, `sweepWithGuides`, `loftWithGuides`, `shellMultiThickness`, `onCurvePattern`,
`moveFace`, `rotateFace`, `deleteFaceAndHeal`, `replaceFace`, `sewShape`,
`autoFillMissingFaces`, `autoRepairSelfIntersection`, `harmonizeNormals`, `shapefix::repair`,
`sewing::sew`, every `forge::surfacing::*`, every `forge::classa::*`, `helicalSweep`,
`sectionSolid`, `nurbsfit::fitSurface` and `mold::splitCavityCore` are **built, compiled,
and unnameable**.

The single cheapest capability in the project is writing op names for code that already runs.

---

## 1. Corrections to the received census

Three claims in the brief were re-derived. Two hold exactly; one is an artefact.

| claim | verdict |
|---|---|
| 40 kernel ops, 18 user-invocable, 22 forbidden | **CONFIRMED** — `OpCode` enum has 40 non-sentinel entries; `ArchieOpVocabulary.hpp` declares `kKernelOpsCount=40`, `kUserInvocableOpsCount=18`, `kForbiddenOpsCount=22` |
| exactly three value kinds (PROFILE, SOLID, WIRE); no SURFACE | **CONFIRMED** — `FeatureTree.hpp` value model; `Val::kind` in the compiler |
| file counts NURBS 58 · Sweep 68 · G2 32 · Loft 27 · curvature 21 · SubD 18 · Blend 17 · Bezier 16 · BSpline 24 | **CONFIRMED to the file** — `grep -ril` over `forge-kernel/src` reproduces all nine exactly |
| `"Class A"` ZERO | **ARTEFACT OF THE HYPHEN.** `grep -ril "class a"` = 0; `grep -ril "class-a"` = **4** (`ClassASurfacing.cpp`, `Nurbs.cpp`, `binding.cpp`, `native/brep/SurfaceFill.cpp`). `include/forge/ClassASurfacing.hpp` is a 169-line header: zebra stripes, curvature combs, G0–G3 continuity, Gauss/mean curvature field, G2 sewing, guide-curve sweep. `src/ClassASurfacing.cpp` is in `FORGE_KERNEL_SOURCES` (`CMakeLists.txt:1569`) and is bound to JS as `forge.classa.*` (`binding.cpp:16246`). **Class-A surfacing is built.** It has no IR name and no UI command. |

The reason there is no SURFACE *value kind* is correct and load-bearing — but the reason
there is no surfacing *capability* is not the kernel. `forge::surfacing::buildNurbsPatch`
returns a `ShapeHandle` like everything else; the kernel's type system already carries a
surface. Only the IR's three-way `Val` tag refuses to.

---

## 2. Family 1 — WIREFRAME / CURVE

The IR has a `WIRE` value kind, a `WIRE` op and a `RING` op. **Every one of them is a
polyline.** `RING` and `WIRE` both terminate in `forge::part::profileWire`
(`FeatureTreeCompiler.cpp:884,905`), and `profileWire` is
`BRepBuilderAPI_MakePolygon` (`src/Features.cpp:822-838`). `POLY` is a sketch of
`addLine` segments between consecutive points (`FeatureTreeCompiler.cpp:855-863`).
There is no curved edge anywhere in the IR's wire vocabulary.

### 2.1 The table

| capability | in kernel? | reachable from IR? | user-invocable? | what it would take |
|---|---|---|---|---|
| line segment | **YES** — `forge::addLine` (`Sketcher.hpp:115`); `native::brep::Curve::makeLine` (`native/brep/Curve.hpp:104`) | only *inside* `RECT`/`POLY`/`REGPOLY`/`WIRE`/`RING`; no standalone op | no | — |
| arc (centre + 2 ends) | **YES** — `forge::addArc` (`Sketcher.hpp:124`) | only *inside* `RRECT` and `SLOT` builders (`FeatureTreeCompiler.cpp:819-822, 850-852`) | no | an `ARC` term in the profile grammar; the sketch entity is already there |
| circle | **YES** — `forge::addCircle`; `Curve::makeCircle` | **YES** — `CIRCLE` | **YES** — `part.sketch_circle` | — |
| ellipse | `native::brep::Curve::makeEllipse` (`Curve.hpp:108`) **only**. Not a `Sketcher` entity, not in `binding.cpp` | no | no | lift `makeEllipse` into the sketcher; `ELLIPSE` op |
| spline through points (interpolation) | **NO.** `Sketcher` entity set is point/line/circle/arc — nothing else (`binding.cpp:6420-6430`). `NurbsCurve` (`native/brep/Nurbs.hpp:72`) evaluates but does not *interpolate* | **NO** — `POLY` is a polyline | no | Cox–de-Boor global interpolation. The exact forms are already written down in `reports/nurbs_forms_reference.md` |
| spline by control points | `NurbsCurve::evaluate` + `Curve::makeBSpline(NurbsCurve)` (`Curve.hpp:111`) exist as edge geometry | **NO** | no | a `SPLINE` op + a `Curve`→wire binding |
| helix | **YES** — `native::brep::helicalSweep` (`native/brep/HelicalSweep.hpp`), RMF-transported, volume-exact to Pappus. But it emits a **SOLID**, not a curve | **NO** | no | `HELIX(r, R, pitch, turns)` → SOLID is a one-case compiler add; a helix *WIRE* needs the curve kind first |
| offset curve (2D) | **YES** — `native::geom::PolygonOffset2D` (`native/geom/PolygonOffset2D.hpp:131`), bound as `geom.polygonOffset2D` (`binding_geom.cpp`) | **NO** | no | `OFFSET(%profile, d)` → PROFILE |
| project curve to face | **point only** — `surfacing::projectPointToSurface`, `native::geom::projectPointOnSurface` (`NativeProjection.hpp:65`). No curve-level projection | **NO** | no | genuinely not built |
| intersection curve | **YES, three ways** — `surfacing::intersectSurfaces` (`Nurbs.hpp`, `BRepAlgoAPI_Section`); `native::brep::intersectSurfaces` (`SurfaceIntersect.hpp:121`, returns typed `IntersectionCurve`); `native::brep::sectionSolid` (`Section.hpp:142`, returns `SectionWire`s) | **NO** | no | `SECTION(%solid, plane)` → WIRE. `sectionSolid` already returns exactly that shape of answer |
| composite / joined wire | **YES** — `native::shape::Wire::fromEdges` / `addEdge` / `isContiguous` / `isClosed` (`native/shape/Wire.hpp:61-82`) | **NO** — `WIRE` takes a point list; nothing joins two WIREs | no | `JOIN(%w0, %w1, …)` → WIRE |
| trim / extend / split a wire | **NO** | **NO** | no | build it — the only genuinely absent row in this family |

### 2.2 Measured: what the polyline WIRE costs

Run on the pinned verifier. A right cylinder r=20 h=30 by four routes:

| IR | volume | Δ vs analytic | faces | edges |
|---|---:|---:|---:|---:|
| `CYL(20,30)` | 37699.111843 | — (π·400·30 exactly) | **3** | 3 |
| `CIRCLE(20)` → `EXTRUDE(…,30)` | 37699.111843 | 0 | **3** | 3 |
| `RING(20,20,0)` + `RING(20,20,30)` → `LOFT` (default `seg=48`) | 37591.543359 | **−0.2853 %** | **50** | 144 |
| `RING(…,seg=256)` ×2 → `LOFT` | 37695.327011 | **−0.0100 %** | **258** | 768 |

The volume figures match the inscribed-regular-polygon prism closed form
`(n/2)r²sin(2π/n)·h` to all printed digits, so this is the discretisation and nothing else.

**The face count is the finding, not the volume.** The owner's ground-truth fixture
`task_101.log` is **329 faces / 753 edges for the entire part**. One lofted circular section
at the IR's own default costs 50 of those 329; pushing volume error under 0.01 % costs 258 —
*more than the whole part's budget for a single feature.* A face census like the ground
truth's is arithmetically unreachable through a polyline `WIRE`. This is the structural
reason `archie_edit_214.log`'s input carries **67 BSPLINE faces out of 430 (15.6 %)** that
the IR cannot name: not that free-form is hard, but that the IR's only curve is a chord.

### 2.3 Why `POLY` is the model reaching for this

`POLY` is the *only* IR op that accepts an arbitrary silhouette. The ground truth's
op 1 in `task_101.log` is `waist_extrude(L=232,W=146,H=45)` — a waisted (curved) plate
outline. There is no IR term for it, so the only available spelling is a dense `POLY`.
That is a model correctly identifying the gap and paying for it in faces.

(The brief's figure of 892 `POLY` uses in a 600-row emission set could **not** be
reproduced from this tree — no such emission corpus is committed here. It is carried as
brief-supplied, not re-verified. The structural argument above does not depend on it.)

---

## 3. Family 2 — B-REP

This family is the closest to done, and it is the one most completely hidden. `HEAL`,
`DEFEATURE`, `PUSHFACE` and `RESIZEBORE` are not stubs — they are thin wrappers over a
substantial, tested toolkit.

| capability | in kernel? | reachable from IR? | user-invocable? | what it would take |
|---|---|---|---|---|
| sew (single shape) | **YES** — `heal::sewShape` (`Healing.hpp`), before/after open-edge report | **NO** | no | `SEW(%b [, tol])` |
| sew (many shapes → one shell) | **YES** — `sewing::sew` (`Sewing.hpp`), free/multiple/contiguous-edge report; `native::brep::sewFaces` (`native/brep/Sew.hpp:177`) with `SewDiagnosis` + misoriented-pair list | **NO** | no | needs a multi-body value; today the IR has no compound |
| unsew | **NO** | **NO** | no | build it (low value) |
| face extraction / explode | **YES** — `native::shape::Explorer` / `ShapeMap` / `Ancestry` (`native/shape/Explore.hpp`); `forge::faceInventory` (`DirectEdit.hpp`), `direct::topoCounts` / `edgeSegments` | **selector only** — `faceInventory` is consulted by `resolveSelector`; **no op returns a face as a value** | no | a `FACE` value kind, or keep faces as selectors (see §7) |
| face replacement | **YES** — `direct::replaceFace(shape, faceId, SurfaceSpec{Plane\|Cylinder\|Sphere})` (`DirectModeling.hpp`) | **NO** | no | `REPLACEFACE(%b, "sel", PLANE\|CYL\|SPHERE, …)` |
| move / rotate a face | **YES** — `direct::moveFace`, `direct::rotateFace` | **NO** | no | `MOVEFACE` / `ROTATEFACE` — `PUSHFACE` is the 1-DOF special case already wired |
| edge/face deletion + heal | **YES** — `forge::defeature` (`BRepAlgoAPI_Defeaturing`), `direct::deleteFaceAndHeal` (filling + re-sew) | **YES** — `DEFEATURE` | **no** (forbidden) | one UI command |
| healing (general) | **YES, four routines** — `simplifyShape`, `autoFillMissingFaces`, `autoRepairSelfIntersection`, `harmonizeNormals` | **PARTIAL — `HEAL` maps to `simplifyShape` alone** (`FeatureTreeCompiler.cpp:1322-1326`), with default options, and **swallows failure** (`return r.handle != kInvalidHandle ? r.handle : body`) | no | give `HEAL` a mode keyword: `HEAL(%b, SIMPLIFY\|FILL\|REPAIR\|ORIENT)` — four one-line cases over code already compiled |
| tolerance repair | **YES** — `shapefix::repair` (`ShapeFix.hpp`), returns the full `ShapeFix_Shape` DONE1..8 / FAIL1..8 **log** | **NO** | no | `HEAL(%b, TOLERANCE [, prec, minTol, maxTol])`; the log is exactly the named-failure a repair loop needs |
| shape upgrade / downgrade | **YES** — `simplifyShape` carries `unifyFaces` / `unifyEdges` / **`concatBSplines`** / `angularTol`; `surfacing::refineNurbs` raises degree | **PARTIAL** — `HEAL` passes `{}`, so `concatBSplines` is **always false** and the tolerance is never settable | no | expose the four options as `HEAL` args |
| unify same-domain faces | **YES** — `forge::unifyFaces`; native `unifySameDomain{Planar,Curved,Bored}` (`native/brep/UnifyFaces.hpp`) | **implicit only** — the compiler calls it internally (3 sites) but no op names it | no | `UNIFY(%b)` |
| validity / topology check | **YES** — `heal::checkValidity` (per-face/per-edge bad lists), `forge::topologySignature` (genus, χ, shells) | **YES** — `VERIFY` | **no** (forbidden) | one UI command |
| push/pull planar face | **YES** — `forge::pushPullFace`, `direct::pushPullFace` | **YES** — `PUSHFACE` | **no** (forbidden) | one UI command |
| resize a bore exactly | **YES** — `forge::resizeBore` | **YES** — `RESIZEBORE` | **no** (forbidden) | one UI command |
| persistent feature naming | **YES** — `TAG` + `resolveSelector`'s `@name` path with a **position tolerance and an ambiguity check** (`FeatureTreeCompiler.cpp:1409-1452`) — a genuinely good piece of work | **YES** — `TAG` | **no** (forbidden) | ★ see §7 |

`FOLD` is a macro, not a B-rep op: `BOX` + `ROTATE` about the hinge + `FUSE`
(`FeatureTreeCompiler.cpp:1299-1321`), composed from verified primitives. It is correct
for what it is and is not sheet-metal (no bend allowance, no K-factor, no flat pattern —
although `src/SheetMetalFlatPattern.cpp` exists separately).

---

## 4. Family 3 — SOLID, against an NX/CATIA baseline

| capability | in kernel? | reachable from IR? | user-invocable? | what it would take |
|---|---|---|---|---|
| **draft** | **YES, three paths** — `part::draftFaces` (`Features.cpp:2077`): analytic exact (canonical cube only), native mesh-bridge taper, OCCT `BRepOffsetAPI_DraftAngle` | **NO** | **no** | ★★ **see §5** |
| rib | **YES** — `part::rib` (`Features.cpp:2383`), native closed-profile prism + native open-profile ribbon + OCCT fallback | **NO** | no | `RIB(%profile, depth, thk)` — a real implementation with no name |
| boss / pocket on a face | **YES** — `part::extrudeProfileOnPlane` (`Features.cpp:483`): sketch on an arbitrary world plane, `sign` selects boss or cut-into-face | **NO** — `EXTRUDE` is Z=0-plane only | no | `EXTRUDEON(%profile, dist, origin, normal, uDir, sign)`. This is the single largest expressive win in the family: it makes *every* feature placeable on *any* face |
| groove | no dedicated op — `CUT` with a revolved/swept tool | via `CUT` | via `part.boolean_subtract` | acceptable as a composition |
| thread | **geometry:** `native::brep::helicalSweep` — **circular profile only**, no trapezoidal/ACME (its header names that as a follow-up). **metadata:** `HoleSpec.tappedPitch` is recorded and **changes no geometry** (`Features.hpp:180`) | **NO** | no | honest answer: a real thread needs a non-circular helical profile. Cosmetic threads are cheap; cut threads are not |
| keyway | **NO** — no occurrence in `include/` or `src/` | **NO** | no | composition of `SLOT` + `CUT` once `SLOT` is fixed (§6.1) |
| variable-radius fillet | **YES** — `varfillet::fillet`, `part::variableFilletEdge(shape, edgeId, anchors[])` | **YES** — `BLEND` (linear or `SMOOTH` S-law) | **YES** — `part.variable_fillet` | the per-edge **anchor list** form is unreachable: `BLEND` sends one (start,end) pair to every selected edge |
| face blend (blend between two faces) | **NO** — every fillet path is edge-driven | **NO** | no | genuinely absent |
| thicken (open shell → solid) | **YES** — `part::thickenSurface(shape, t, side)` (`Features.cpp:1199`) | **NO** | no | `THICKEN(%b, t, side)`. Blocked behind the missing SURFACE/open-shell value more than behind the op |
| offset solid (grow/shrink) | **YES** — `part::offsetSolid`, distinct from shell and from thicken | **NO** | no | `OFFSETSOLID(%b, d)` — one compiler case |
| shell, multi-thickness | **YES** — `part::shellMultiThickness(base, perFaceOverrides[])` | **NO** — `SHELL` is uniform and picks **one** opening face by largest-area-facing-axis (`FeatureTreeCompiler.cpp:1256-1290`) | uniform only | let `SHELL` take a face selector list and per-face thicknesses |
| split body | **YES** — `mold::splitCavityCore` (`Mold.hpp:100`, `BRepAlgoAPI_Splitter`) | **NO** | no | `SPLIT(%b, %tool)` → needs a multi-body value |
| imprint | machinery exists **inside** the native boolean (SSI cut curves, `native/brep/Boolean.hpp:125`) — no standalone entry point | **NO** | no | export the SSI result as a public op |
| guided sweep | **YES** — `part::sweepWithGuides`, `classa::sweepWithGuides` (`MakePipeShell`, binormal-from-guide) | **NO** — `SWEEP` routes to `pipeFromPolyline`/`sweepPolyline` (`FeatureTreeCompiler.cpp:1006-1029`) | no | `SWEEP(…, GUIDE %w)` |
| guided loft | **YES** — `part::loftWithGuides`; and `loftguide::loft(wires, **guides**, solid, ruled)` | **NO — by one argument.** The compiler calls `loftguide::loft(wires, **{}**, solid, ruled)` (`FeatureTreeCompiler.cpp:1002`) | no | ★ **pass the guides.** The parameter is already in the signature |
| countersink / tapped hole | **YES** — `part::holeWizard(kind = 0 simple / 1 cbore / 2 **countersink** / 3 **tapped**)` | **NO** — `HOLE` and `CBORE` are hand-built cylinder cuts and never call `holeWizard` | `part.hole`/`part.counterbore` only | `HOLE(…, CSK, angle)`; countersink geometry is already written |
| pattern along a curve | **YES** — `part::onCurvePattern(shape, pathSketch, count)` | **NO** — `PATTERN` is `LINEAR`\|`POLAR`\|`GRID` | linear/polar/grid | `PATTERN(%b, CURVE, n, %wire)` |
| NURBS patch authoring | **YES** — `surfacing::buildPatch/trim/sew/refine/eval/intersect/projectPoint/classAAnalyse` (`Nurbs.hpp`, JS `forge.surfacing.*`) | **NO** | no | needs the SURFACE value kind |
| Class-A diagnostics | **YES** — `classa::zebraStripes / curvatureComb / continuityCheck (G0-G3) / gaussianAndMeanCurvature / stitchG2` | **NO** | no | these are *measurements*; they belong in `VERIFY`, not as builders |
| surface fit to point cloud | **YES** — `nurbsfit::fitSurface` (`NurbsFit.hpp`), cubic tensor-product LSQ with per-point residuals | **NO** | no | reverse-engineering path; low priority for the fixtures |

---

## 5. ★ THE DRAFT FINDING

Draft is not a line item. It is the single node the whole OCCT-drop ladder hangs from,
and it is simultaneously **absent from the IR entirely**.

**Measured, from `reports/TOOLKIT_ELIMINATION_MAP.md:250-276`** (600-part paired corpus):

| family | option | native % | OCCT % | gap |
|---|---|---:|---:|---|
| C | `FORGE_FILLING_DROP_NATIVE` | 67.8 | 67.8 | 0 parts deleted |
| I | `FORGE_THICKEN_DROP_NATIVE` | 96.2 | 100.0 | close |
| A | `FORGE_OFFSET_DROP_MAKEOFFSET` | 94.5 | 99.0 | 27 parts |
| F | `FORGE_PIPESHELL_DROP_NATIVE` | 51.5 | 100.0 | open |
| D | `FORGE_THRUSECTIONS_DROP_NATIVE` | 51.5 | 94.5 | open |
| E | `FORGE_PIPE_DROP_NATIVE` | 41.5 | 100.0 | open |
| G | `FORGE_THICKSOLID_DROP_NATIVE` | 1.2 | 22.2 | open |
| H | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 1.2 | 6.3 | open |
| **J** | **`FORGE_DRAFT_DROP_NATIVE`** | **0.0** | **88.0** | ★ **no bounded fix exists** |

TKOffset needs **all nine** families and is the only parent-free node in the drop graph, so
family J alone gates **all thirteen waves** and the closure number 14 → 12. That is the
existing ledger's own conclusion, quoted: *"the single highest-value piece of work in the
whole programme is a native draft angle."*

**What this census adds to that.** The native draft is not merely low-coverage — it is
structurally the wrong shape:

1. `part::draftFaces` has an **analytic exact** path that fires only for the canonical cube
   with the neutral plane at z=0/+Z, exactly four side walls selected, and tan α < ½
   (`Features.cpp:2117-2148`). Anything else falls through.
2. The fallback native path **tessellates and returns a `NativeMesh`**
   (`Features.cpp:2153-2185`) — the analytic B-rep is destroyed. A drafted face is no longer
   a plane you can select, dimension, or `TAG`. That is why coverage reads 0.0 %: the
   measurement is asking for a B-rep and getting a mesh.
3. **There is no `DRAFT` OpCode at all.** Draft is invisible to Archie. Every one of the 88 %
   of corpus parts OCCT can draft is a part the model cannot ask for.

**Consequence for this design track.** The draft work has been framed as an OCCT-drop
problem. It is *also* the largest missing verb in the solid family, and the two framings
want different first steps:

- *drop framing* → make the native path cover 88 % of parts, hard.
- *capability framing* → **add `DRAFT(%body, "faceSel", angle, neutralPlane)` to the IR now**,
  routed through `part::draftFaces` exactly as it stands, OCCT fallback and all. Cost: one
  compiler case plus one selector, ~40 lines. It closes zero percent of the OCCT gap and it
  makes a first-class NX/CATIA verb emittable today.

These are not in conflict and the second is ~two orders of magnitude cheaper. **Do the
second first.** A `DRAFT` op that names a face and an angle is also the harness the native
engine needs: without it, every native-draft coverage experiment has to be driven from a
bespoke C++ probe rather than from the corpus of IR the model already emits.

---

## 6. Two defects found while censusing (both measured)

These were not the object of the task; the census surfaced them and both are load-bearing.

### 6.1 ★ `SLOT` builds an obround with its end caps **inverted**

`profSlot` (`FeatureTreeCompiler.cpp:833-853`) sets `l = len - wid`, `r = wid/2`, places the
four corner points and then adds `addArc(cR, tr, br)` and `addArc(cL, bl, tl)` — both arcs
traverse the **inside** of the rectangle. The caps are subtracted, not added.

Measured on the pinned verifier, three sizes, `EXTRUDE(…, 10)`:

| IR | measured | obround closed form `((len−wid)·wid + πr²)·h` | inverted-cap form `((len−wid)·wid − πr²)·h` | error |
|---|---:|---:|---:|---:|
| `SLOT(40,12)` | **2229.026645** | 4490.973355 | **2229.026645** | **−50.4 %** |
| `SLOT(30,10)` | **1214.601837** | 2785.398163 | **1214.601837** | **−56.4 %** |
| `SLOT(50,20)` | **2858.407346** | 9141.592654 | **2858.407346** | **−68.7 %** |

The inverted form matches to every printed digit in all three cases.

The bounding box confirms it independently: `SLOT(40,12)` reports
`bbox.min=[-14,-6,0] max=[14,6,10]` — half-length **14 = (len−wid)/2**, not 20 = len/2. An
op called `SLOT(len, wid)` produces a part whose overall length is `len − wid`. Its bbox is
**byte-identical to `RECT(28,12)`** extruded, which measured 3360 (= 28·12·10) — i.e. the
slot is the rectangle with two bites taken out.

`RRECT` is the control and is **correct**: `RRECT(40,30,6)` → 11690.973355, and
`(40·30 − (4−π)·36)·10 = 11690.973355` exactly. So the arc convention is right elsewhere; only
`SLOT` inverts. Face count is **6 either way**, so a topology check cannot see this.

**Why this is urgent.** `SLOT` is one of the twelve ops the separate `app/kernel-primitives`
branch is exposing to users. If it lands as written, every slot drawn in the app is ~50 %
undersized and still passes as a valid watertight solid. The fix is to swap the endpoint
order on both arcs. **This finding is handed to that branch, not fixed here.**

For completeness, every other primitive on that branch's list was checked against its closed
form on the same run and **all are exact**:
`BOX(40,30,20)`=24000 · `CYL(20,30)`=37699.111843 (π·400·30) ·
`CONE(20,10,30)`=21991.148575 (πh/3·(r₁²+r₁r₂+r₂²)) · `SPHERE(15)`=14137.166941 (⁴⁄₃π·3375) ·
`TORUS(30,8)`=37899.280900 (2π²·30·64, genus 1) · `PRISM(6,20,25)`=25980.762114 ·
`TUBE(20,12,30)`=24127.431580 (π·256·30, genus 1) · `REGPOLY(20,6)`×10=10392.304845 ·
`RRECT(40,30,6)`×10=11690.973355 · `POLY` pentagon ×12 = 9600 (shoelace exactly) ·
`ROTATE` volume-preserving. **`SLOT` is the only defective one of the twelve.**

### 6.2 `FILLET`/`CHAMFER` advertise two selector spellings the compiler does not honour

`selectEdges` (`FeatureTreeCompiler.cpp:1177-1196`) implements exactly `ALL`, `VERTICAL`,
and `RIM`/`HORIZONTAL`. But `implementation/sacrosanct/archie_op_vocabulary.json` — **the
vocabulary Archie is trained against** — publishes the argument as
`ALL|CONVEX|RIM|VERTICAL|"<face selector>"` for both ops (lines 471, 936), and
`FeatureTree.hpp:117` repeats `sel: ALL|VERTICAL|RIM|CONVEX`.

Measured, `BOX(40,30,20)` then `FILLET(%1, 2, sel)`:

| `sel` | result | volume | faces |
|---|---|---:|---:|
| *(no fillet)* | ok | 24000 | 6 |
| `ALL` | ok | 23701.687230 | 26 |
| `VERTICAL` | ok | 23931.327412 | 10 |
| **`CONVEX`** | **`ok:false` — "unknown edge selector \`CONVEX\`"** | — | — |
| **`"rim:largest"`** (quoted) | **ok — but identical to `ALL`** | **23701.687230** | **26** |

Two different failure modes, and the second is the worse one:

- **`CONVEX` fails loud.** A documented, published keyword is a hard refusal. This is the
  gate-shaped failure the design constraint warns about: it fires on a spelling the model
  was *taught*. (Note the message differs between the pinned binary and HEAD — HEAD's
  `selectEdges` throws *"no edges match selector"*, which is strictly worse, because it is
  indistinguishable from a legitimate empty selection. A repair loop cannot tell "I don't
  know that word" from "there is nothing there".)
- **A quoted face selector fails silent.** `kwOpt` (`FeatureTreeCompiler.cpp:710-713`)
  returns its default unless the token is a `Keyword`; a `Str` token falls through to
  `"ALL"`. So `FILLET(%b, 2, "rim:largest")` **fillets every edge in the body** and reports
  success. That is wrong geometry presented as right — the failure class the project's own
  "volume cannot validate geometry" lesson is about, except here even the volume is
  plausible.

The IR already contains a rich face-selector grammar — `@name`, `+Z`/`-X`, `plane:max-area`,
`face:N`, `bore:largest`, `bore:r=47.5`, `radial:k`/`radial:all`/`blade:*`/`lug:*`/`spoke:*`
(`resolveSelector`, `FeatureTreeCompiler.cpp:1393-1730`). Edges get three keywords. That
asymmetry is exactly what blocks the ground truth: `task_101.log` op 8 is
`fillet(body, R4, circedges@z30 r45/r22)` and op 9 is
`fillet(body, R2, perimeter arcs@z35 r>40)`. Neither is expressible.

---

## 7. What already exists and is merely unreachable — the cheapest capability in the project

Twenty-two kernel ops are forbidden for exactly one stated reason, repeated verbatim
twenty-two times in the generated table: *"no command in the forge::ui registry emits it,
so no user can produce it."* Not one of them is forbidden for a geometric reason.

**Measured:** fifteen of them were driven straight through `forge::ft` on the pinned
verifier. **15 / 15 built valid watertight solids**, and every closed form checks:

| op | IR probed | volume | valid |
|---|---|---:|---|
| `POLY` | pentagon → `EXTRUDE(…,12)` | 9600 (shoelace exact) | ✓ |
| `TUBE` | `TUBE(20,12,30)` | 24127.431580, genus 1 | ✓ |
| `SWEEP` (pipe) | `SWEEP(4, [0 0 0; 0 0 30; 20 0 50])` | 2513.274123 | ✓ |
| `SWEEP` (profile) | 10×10 square along 40 | 4000 exact | ✓ |
| `WIRE` + `LOFT` | 40×20 → 16×16 over h=40 | 20480 = prismatoid `h/6(A₁+4Aₘ+A₂)` exact | ✓ |
| `RRECT` | `RRECT(40,30,6)` ×10 | 11690.973355 exact | ✓ |
| `REGPOLY` | `REGPOLY(20,6)` ×10 | 10392.304845 exact | ✓ |
| `PRISM` | `PRISM(6,20,25)` | 25980.762114 exact | ✓ |
| `HEAL` | `HEAL(BOX)` | 24000 (pass-through) | ✓ |
| `ROTATE` | 30° about +Z | 24000 (preserved) | ✓ |
| `TAG` + `RESIZEBORE` + `VERIFY` | tag a bore, shrink it, assert genus | 33080.970642; verify: `TAG @centrebore -> cylinder face 4`, `PASS genus=1 (got 1)` | ✓ |
| `PUSHFACE` | `PUSHFACE(BOX(40,30,20), "+Z", 5)` | 30000 = 40·30·25 exact | ✓ |
| `DEFEATURE` | drill Ø8, then defeature the bore | 24000 — hole fully healed away | ✓ |
| `FOLD` | 60×40×3 plate, 90° flange | 9360 | ✓ |
| `SLOT` | — | **see §6.1 — the one defect** | ✓ (but wrong) |

So the whole forbidden set is live code with a working compiler path and no name in the app.

### 7.1 Three of the forbidden ops are not features — they are the *safety mechanism*

`TAG`, `VERIFY` and `INPUT` are forbidden by the same rule as `BOX`. That is a category
error with a direct cost:

- `TAG` binds a persistent name that **survives index-permuting edits**, with a position
  tolerance and an explicit ambiguity refusal. It is the only defence against a face index
  silently retargeting after a boolean — and the comment at
  `FeatureTreeCompiler.cpp:1437-1441` records that exact bug being caught.
- `VERIFY` is the do-no-harm assertion (`PASS genus=1 (got 1)` above). Forbidding it means
  the app cannot express an invariant.
- `INPUT()` binds the input STEP. **Forbidding `INPUT` makes the entire editing half of the
  benchmark unreachable from the app** — `archie_edit_214.log` is an edit task and its first
  statement can only be `INPUT()`.

A vocabulary that forbids its own naming, assertion and input-binding mechanisms is not a
narrower vocabulary; it is a vocabulary that cannot check itself. These three should be
unforbidden regardless of what happens to the primitives.

### 7.2 The gate that is built but not wired

`ui/include/forge/ui/OpConstraintBridge.hpp` is a 235-line refusal engine over the generated
vocabulary, with thirteen distinct refusal verdicts. **It has no production caller** — a
repo-wide search finds it referenced only by `ui/test/op_constraint_bridge_test.cpp` and by
its own generator. Its header names `PartDocument::appendFeature` and
`CommandRegistry::dispatch` as the intended enforcement points; neither calls it today.

Against the binding design constraint — *"don't gate anything; if you do that, how will
Archie generate ultra-long feature trees?"* — this matters more than any single op:

**The bridge must never be wired onto the Archie emission path.** Its allow-set is 18 ops.
Under it, the *only* PROFILE producers are `RECT` and `CIRCLE`, and the *only* WIRE producer
is `RING` (a superellipse). An ultra-long tree is long precisely because it is dense in
non-rectangular profiles and non-superelliptical sections, so the refusal rate rises with
exactly the property that makes a tree valuable. `task_101.log`'s waisted plate is
unemittable under it; so is every organic loft; so is every edit tree, for want of `INPUT`.

The bridge is a fine **UI** affordance ("this command is not on a toolbar yet"). As a
**planner** gate it is a capability ceiling wearing a safety hat. The correct response to
`ForbiddenOp` is not to refuse the plan — it is to **add the command**.

### 7.3 The concrete cheap list, in order

| # | change | cost | unlocks |
|---|---|---:|---|
| 1 | Un-forbid `TAG`, `VERIFY`, `INPUT` | 3 vocabulary rows + regen | edit tasks at all; self-checking trees |
| 2 | UI commands for the 12 primitives | *in flight on `app/kernel-primitives`* | 12 ops — **but fix `SLOT` first (§6.1)** |
| 3 | UI commands for `POLY`, `SWEEP`, `WIRE`, `HEAL`, `PUSHFACE`, `RESIZEBORE`, `DEFEATURE`, `FOLD` | 8 commands | the other 8 forbidden ops; all proven live in §7 |
| 4 | Pass `guides` in `opLoft` instead of `{}` | **one argument** | guided loft |
| 5 | `DRAFT` op over `part::draftFaces` | ~40 lines | ★ the largest missing NX/CATIA verb (§5) |
| 6 | `HEAL` mode keyword → the other 3 healing routines + `shapefix::repair` | 4 cases | tolerance repair with a named-fixer log |
| 7 | `EXTRUDEON` over `extrudeProfileOnPlane` | 1 case + a plane arg | every feature placeable on any face |
| 8 | `RIB`, `THICKEN`, `OFFSETSOLID`, `MOVEFACE`, `ROTATEFACE`, `REPLACEFACE`, `UNIFY` | 1 case each | 7 built-but-unnamed verbs |
| 9 | `HOLE(…, CSK)` / tapped via `holeWizard` | 1 case | countersink geometry already written |
| 10 | `PATTERN(%b, CURVE, n, %wire)` over `onCurvePattern` | 1 case | curve-driven replication |

Items 1–4 and 6–10 are all *names for compiled code*. None of them requires new geometry.

---

## 8. Ranked backlog — value to the ground-truth fixtures ÷ cost

Value is judged against `task_101.log` (14 ops → 329 faces / 753 edges / 422448.55 mm³, full
per-face census) and `archie_edit_214.log` (430-face input: 167 cylinder, 125 torus,
**67 bspline**, 42 plane, 25 sphere, 4 cone).

| rank | work | value | cost | why |
|---:|---|---|---|---|
| 1 | **Fix `SLOT`** (§6.1) | high | **hours** | prevents a 50 %-wrong primitive from shipping to users this week |
| 2 | **Un-forbid `TAG`/`VERIFY`/`INPUT`** | high | **hours** | `archie_edit_214`-class tasks are unreachable without `INPUT` |
| 3 | **Edge selectors: implement `CONVEX`; make a quoted selector resolve instead of silently meaning `ALL`** (§6.2) | **very high** | days | `task_101` ops 8–9 are edge-predicate fillets and are inexpressible; the current silent-`ALL` is wrong geometry reported as success |
| 4 | **`DRAFT` op** over the existing `draftFaces` (§5) | **very high** | days | largest missing NX/CATIA verb; also the harness the native-draft programme needs |
| 5 | **Pass loft guides** (`opLoft`, one argument) | high | **one line** | `task_101` op 4 `peanut_blend(hubA,hubB,n=11)` is a guided figure-8 skin |
| 6 | **Analytic curve edges: `ARC`, `SPLINE`, `ELLIPSE` in the profile/wire grammar** | **highest** | weeks | §2.2: the polyline `WIRE` costs 50 faces where the analytic form costs 3, and 258 to reach 0.01 % volume. The GT's whole part is 329 faces. `task_101` op 1 `waist_extrude` needs it. The sketcher already has arcs; `native::brep::Curve` already has line/circle/ellipse/bspline; `reports/nurbs_forms_reference.md` already carries the exact rational forms |
| 7 | **`EXTRUDEON`** over `extrudeProfileOnPlane` | high | days | every boss/pocket in the GT is on a face, not on Z=0 |
| 8 | **`HEAL` modes + `shapefix::repair`** | medium-high | days | the DONE1..8 log is a *named* failure a repair loop can act on |
| 9 | **UI commands for the 8 remaining forbidden ops** | medium | days | proven live in §7; pure reachability |
| 10 | **`SECTION` op** over `native::brep::sectionSolid` | medium | days | the only kernel-backed WIRE producer that is not a polyline |
| 11 | **A `SURFACE` value kind** → `surfacing::*` + `classa::*` + `thickenSurface` | high | weeks | 67/430 GT faces are BSPLINE. The kernel side is built; the IR type system is the blocker |
| 12 | **Wire trim/extend/split; face blend; keyway; cut threads** | low-medium | weeks | genuinely absent from the kernel — build only after 1–11 |

---

## 9. Design stance — how to add all of this without adding a gate

Against *"don't gate anything"*, every proposal above is **represent / repair / tolerate**,
never refuse:

- **Represent.** Add op names, not validators. Nine of the twelve backlog items are one
  `case` in the compiler's switch over code that already runs.
- **Repair.** Where a request is out of range, degrade and *say so in the result*, the way
  `opFillet` already retries at 0.75/0.5/0.35/0.2× radius. A `DRAFT` that cannot hold the
  angle should emit the largest angle it can and report the shortfall — not throw.
- **Tolerate.** `HEAL` currently swallows failure silently (`r.handle != kInvalidHandle ? … : body`).
  That is tolerance without a record. Keep the tolerance; add the record.
- **Never refuse a spelling the vocabulary teaches.** §6.2 is the live instance:
  `CONVEX` is published to the model and rejected by the compiler. Either implement it or
  remove it from the vocabulary — but a trained spelling that hard-fails is the exact
  failure mode the constraint names, and it fires hardest on the trees that use the most
  selectors, i.e. the longest ones.
- **Never refuse silently.** The quoted-selector path is worse than a gate: it produces
  confidently wrong geometry. Where a refusal is truly unavoidable, the error must name the
  face/edge/op — `resolveSelector`'s `@name` failures already do this well
  (*"@x no longer matches any face … nearest candidate is 60.3 mm away, tolerance 12.0"*) and
  are the model to copy.
- **Keep `OpConstraintBridge` off the planner.** §7.2. It is a UI affordance. Wiring it to
  Archie's emission path would cap the vocabulary at 18 ops, two profile shapes and one
  section shape — and would do so most aggressively on the longest, densest, most curved
  trees.

---

## Appendix — reproduction

```
# every measurement in §2.2, §6.1, §6.2, §7 came from:
forge-kernel/build-unified/forge_verify < probe.jsonl
# protocol: one JSON object per line
#   {"id":"...","ir":"%1 = BOX(40,30,20)\n%2 = FILLET(%1, 2, ALL)\n"}
# out: {"id","ok","error","failedOpId","valid","volume","faceCount","edgeCount",
#       "bbox",{"min","max"},"genus","shellCount","verify":[...],"bores":[...]}

# the file counts in §1:
cd forge-kernel/src && for t in nurbs sweep G2 loft curvature subd blend bezier bspline; do
  printf '%s %s\n' "$t" "$(grep -ril "$t" . | wc -l)"; done
grep -ril "class a"  .   # 0
grep -ril "class-a"  .   # 4
```

Verifier provenance: `forge-kernel/build-unified/forge_verify`, 80336 bytes, mtime
2026-08-06 23:55. It predates HEAD. Where its behaviour and HEAD's source disagree the
difference is called out inline (§6.2, the `CONVEX` error text). Every *geometric* result
above was cross-checked against a closed form, so a stale binary would have had to be wrong
in a way that happens to match the closed form to nine digits.
