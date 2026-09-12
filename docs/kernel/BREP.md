# The native B-Rep data model and its operations

`forge/native/brep/Topology.hpp` is the Forge-owned boundary-representation graph.
This file documents what that graph holds, which headers build on it, what each of
those operations does and does not do, and the diagnostic taxonomy `Check.hpp`
reports against it.

Companion files: `MIGRATION.md` (the judgement call on removal order) and
`OCCT_REMOVAL_TRACKER.md` (generated from the tree, gated in CI). Where those two
carry a number, this file does not restate it — it cites it.

## Where this is measured from

Everything below was measured on 2026-09-12 in the worktree `wt/topohonesty` at
`ddef657b`. Every count in this file has a command behind it; none was carried
over from a previous doc. Two claims that an earlier read of this subject got
wrong are corrected in the last section, with the measurement that corrects them.

Every claim was then re-run adversarially against the same tree. Five did not
reproduce and are corrected in place: the `Native*`/`Step*Occt` characterisation of
the OCCT-bearing files (`FaceNormal.hpp` is neither), `SolidFactory`'s builder count
(12, not 10 — the under-claim that would have scheduled work already finished),
"each of the four gaps is probed" (three are), "`--selftest` proves each probe can
flip" (it mutates 3 of 5), and the five Euler killers "appear nowhere" (they appear
in the sentence that denies them). Everything else reproduced exactly, including all
61 brep gates and all 14 quoted per-gate check counts.

## The reach of the header

| | |
|---|---:|
| headers with a real `#include` of `Topology.hpp` | **31** |
| of those, naming a topology type in a FUNCTION SIGNATURE | **26** |
| of those, holding one only in a result struct | **5** |
| production (non-test) translation units including it | **53** |
| `forge-kernel/test` translation units including it | 50 |
| files inside `src|include/native/brep` including it directly | 29 |

Read the 26/5 split carefully and do not treat the 5 as weaker. `Gear.hpp`,
`HelicalSweep.hpp`, `LoftSweep.hpp`, `StepRead.hpp` and `OcctImport.hpp` return a
`Solid*` plus the `TopologyBuilder` that owns it inside a result struct rather
than taking one as a parameter — they are producers, not consumers. All 31 take
these types in their API; none merely includes the header for a constant.

The 53 is not confined to the kernel's B-Rep corner. 16 of them are
`forge-kernel/src` top-level engines — `DirectEdit.cpp`, `DirectModeling.cpp`,
`Drawings.cpp`, `Fea.cpp`, `FeaTet.cpp`, `Sewing.cpp`, `ShapeFix.cpp`,
`ShapeCheck.cpp`, `Healing.cpp`, `VarFillet.cpp`, `LoftGuide.cpp`,
`Airfoil.cpp`, `CamAdvanced.cpp`, `ClassASurfacing.cpp`,
`InterferenceDetection.cpp`, `NativeOcctBridge.cpp` — and one is application code,
`forge-desktop/src/FileExchangeHost.cpp`. The native model is already load-bearing
above the kernel, not a parallel prototype.

Measured by:

```
grep -rlE '^[[:space:]]*#[[:space:]]*include[[:space:]]*"forge/native/brep/Topology\.hpp"' \
  --include='*.hpp' --include='*.h' .          # 31
```

The loose form of that grep returns 32 because `Topology.hpp`'s own first comment
line is its path. Use the anchored `#include` form; the difference is exactly the
self-match.

**Do not confuse it with `forge/Topology.hpp`.** That is a different, unrelated
47-line header — a topology SIGNATURE (genus, shell count, Euler characteristic)
computed on the *tessellation*, not the B-Rep, because topology is 0.2 of the
CADGenBench metric and has to be assertable inside the IR. It names zero B-Rep
types and zero OCCT types, and 7 files include it. A grep for `Topology.hpp`
without the `native/brep/` prefix hits both and conflates them.

### The two vocabularies barely touch

Within `src|include/native/brep` (128 production files), 31 carry at least one
OCCT `#include` and 29 carry a direct `#include` of `Topology.hpp`. The overlap is
**one file**: `forge-kernel/src/native/brep/NativeShapeHealBridge.cpp`. 30 of those
31 OCCT-bearing files are a `Native*` bridge or `Step*Occt` — the adapter layer
`OCCT_REMOVAL_TRACKER.md` lists separately. The 31st is `FaceNormal.hpp`, which is
neither: it is an OCCT-side helper that reimplements `BRepGProp_Face::Normal` /
`::Bounds` without instantiating `BRepGProp_Face` (that class holds a
`Geom2dAdaptor_Curve` member, so merely constructing it drags in the TKG2d
dependency K6 removes). It lives in this directory and carries the `brep`
namespace, but it takes `TopoDS_Face` and returns `gp_Vec` — it names zero native
topology types. So the "none of them speaks the native graph" half holds for all
31; the "every one is a bridge" half does not.

So the native B-Rep model is not "OCCT code with different names". It is a
disjoint file set with one deliberate seam. The tracker's `Topology / B-Rep` row
(578 OCCT include lines over 31 files) is counting that adapter layer, not this
graph.

```
# both lists, then comm -12  ->  NativeShapeHealBridge.cpp, and nothing else
```

## The data model

Seven element types, one builder, in `namespace forge::native::brep`.

| type | identity | adjacency | geometry |
|---|---|---|---|
| `Vertex` | `id` | — | `Point3 point`, `double tolerance` |
| `Edge` | `id` | `start`, `end`, `coedgeA`, `coedgeB` | `Curve* curve` over its own `[t0,t1]`, `double tolerance` |
| `Coedge` | `id` | `edge`, `loop`, `next`, `prev`, `mate`, `bool forward` | `PCurve* pcurve` in the face's (u,v), `double tolerance` |
| `Loop` | `id` | `face`, `first`, `coedgeCount`, `bool isOuter` | — |
| `Face` | `id` | `shell`, `outerLoop`, `vector<Loop*> innerLoops` | `Surface* surface`, `(u0,u1)x(v0,v1)`, `vertexUV` |
| `Shell` | `id` | `solid`, `vector<Face*> faces` | — |
| `Solid` | `id` | `vector<Shell*> shells` (outer first) | — |

The model is radial-edge-lite / winged half-edge: a `Coedge` is one oriented use
of an `Edge` by a `Loop`; a closed 2-manifold edge carries exactly two, in
opposite sense. The graph owns its elements as `std::vector<std::unique_ptr<…>>`
on `TopologyBuilder`; every cross-link above is a non-owning raw pointer.

### Geometry is bound, not planned

`Edge::curve` and `Face::surface` are present, non-null in practice, and the
reason `Topology.hpp` includes `Surface.hpp` and `Curve.hpp` in full rather than
forward-declaring: the builder owns `unique_ptr` vectors of both, so every TU that
instantiates a builder needs the complete type for the vector destructor.

The bound geometry is a tagged analytic union, not a mesh:

- `SurfaceKind` — `Plane`, `Cylinder`, `Cone`, `Sphere`, `Torus`, `Nurbs`,
  `EllipseExtrusion` (7).
- `GeomCurveKind` — `Line`, `Circle`, `Ellipse`, `BSpline` (4).
- `GeomPCurveKind` — `Line2`, `Circle2`, `BSpline2` (3).

Every geometry pointer defaults to null, so a bare-topology solid (the original
box gate) still validates. This is the claim that went stale once and is now
probed: `tools/kernel/topology_honesty_gate.py::probe_geometry_bound` fails the
build if the header's denial list ever re-acquires "No geometry is attached".

### Faceted topology over exact geometry

`Primitives.hpp` subdivides a quadric of revolution into angular sector faces —
`PrimitiveOptions::nSeg = 128`, `nBand = 64` — but **each sector carries a trim
window over the same exact analytic surface**. The geometry per face is the
quadric; only the parameter domain is split. Mass integrals over the union of trim
windows therefore recover the exact whole-surface integral, and `UnifyFaces.hpp`
can merge the sectors back into the single periodic face OCCT emits.

This is the distinction `MIGRATION.md` calls the single most important lesson of
the migration — 128 faces where OCCT emits 1 is a face-identity difference even
when volume agrees to 1e-12. Here it is deliberate and reversible, which is not
the same as harmless: anything selecting "the bore" on an un-unified primitive
sees 128 faces.

### Euler bookkeeping

`EulerCounts` carries `vertices/edges/faces/loops/shells/innerLoops` and two
accessors:

- `characteristic()` — the classic `V - E + F`.
- `eulerPoincareValid(shellCount, genus)` — the general
  `V - E + F - R - 2(S - G) == 0`, where `R = innerLoops`.

`eulerPoincareValid` is arithmetic only. Structural 2-manifoldness is a separate,
stronger check: `TopologyBuilder::isClosedTwoManifold()` verifies that every edge
has exactly two mated opposite-sense coedges, every coedge's `next`/`prev` are
consistent with its loop, and every loop ring closes with the recorded count.

### TopologyBuilder

Factories: `makeVertex`, `makeEdge`, `makeCoedge`, `makeLoop`, `makeFace`,
`makeShell`, `makeSolid`, `makeSurface`, `makeCurve`, `makePcurve`.

Assembly: `addOuterLoopToFace`, `addInnerLoopToFace` (both share edges — an edge
already joining two vertices is reused and the second coedge becomes its mate),
`addFaceToShell`, `addShellToSolid`, `buildBox`.

Edge lookup is an `unordered_map` keyed on the unordered 64-bit vertex-id pair.
The header records why: a 200k-triangle STEP makes roughly 600k `findEdge` calls,
and the prior linear scan over a growing vector was minutes of import cost.

## What is NOT built

Four gaps. THREE of them are probed by `topology_honesty_gate.py` so they cannot
rot the way the geometry claim did; the genus>0 row is not (the probe column below
says so). The gate is registered at `.github/workflows/gate-registration.yml:225`
and its `--selftest` (line 226) is green, but it mutates 3 of the gate's 5 probes —
`probe_geometry_bound`, `probe_euler_complete` and `probe_nonmanifold_representation`
have a falsifying mutation; `probe_ops_on_topology` and `probe_lineage_ids` do not.
Both commands are green as of this measurement.

| gap | what exists instead | probe |
|---|---|---|
| General Euler operators | `KEV`, `KEF`, `MEKR`, `KEMR`, `MZEV` appear nowhere in the kernel except the honesty sentence that denies them, `Topology.hpp:39-40` | `probe_euler_complete` |
| Non-manifold representation | `Edge` has two named slots (`coedgeA`/`coedgeB`), so a 3+-coedge edge cannot be built. `Check.hpp` T9 DETECTS the condition and `Heal.hpp` repairs it — detecting and repairing is not supporting | `probe_nonmanifold_representation` |
| genus>0 handle operators | `genus` is a parameter to validation and is computed by `Sew.hpp`/`CadScoreGates`, but nothing mints a handle | — |
| Persistent-ID minting via `LineageRegistry` | element `id`s are per-builder `uint32_t` counters | `probe_lineage_ids` |

One correction to the header's own wording. It says "Only MEV and MEF exist".
**MEV exists; MEF does not.** `TopologyBuilder::mev` is declared at
`Topology.hpp:385` and defined at `Topology.cpp:139`; there is no `mef` entry
point anywhere in the kernel, and the header's own surrounding comment concedes
that the box builder "assembles faces directly via makeFace + addLoopToFace, which
is the validated path". So the Euler-operator inventory is **one operator**, and
face creation is done by direct assembly.

```
grep -rn '\bmev\b|\bmef\b' --include='*.hpp' --include='*.cpp' forge-kernel
  ->  mev: Topology.hpp:385, Topology.cpp:139.   mef: 0 hits.
```

The honesty gate does not catch this: it probes the five named killers
(`KEV`/`KEF`/`MEKR`/`KEMR`/`MZEV`) and `mev`/`mef` are not among them. This is an
over-claim in the header, the opposite direction from the under-claim that gate
was built for, and it is unprobed.

## The operations

All twelve headers below are `0 OCCT include lines` in both the header and its
`.cpp`, measured directly — they are pure C++20 plus stdlib plus sibling forge
native headers.

| header | .hpp | .cpp | entry points |
|---|---:|---:|---|
| `Primitives.hpp` | 124 | 883 | `SolidFactory` with 12 builders |
| `Sew.hpp` | 205 | 482 | `sewFaces`, `diagnoseShell`, `weldNearVertices` |
| `Heal.hpp` | 287 | 980 | `healBRep`, `shellSignedVolume`, `shellSurfaceArea` |
| `FilletAnalytic.hpp` | 467 | 2910 | 9 named fillet entry points + `enumerateSolidStraightEdges` |
| `ChamferAnalytic.hpp` | 202 | 479 | 3 chamfer entry points + 2 box helpers |
| `DraftAnalytic.hpp` | 123 | 241 | `draftBoxAnalytic` |
| `OffsetShape.hpp` | 164 | 470 | `offsetSolidShape`, `offsetSurfaceOutward` |
| `Shell.hpp` | 165 | 549 | `shellSolid`, `offsetSurfaceInward` |
| `UnifyFaces.hpp` | 145 | 1224 | 3 eligibility predicates + 3 unifiers |
| `Section.hpp` | 150 | 467 | `sectionSolid` |
| `Query.hpp` | 142 | 796 | `minDistance`, `pointInSolid`, `analyticFaceInventory`, `analyticEdgeCount` |
| `Check.hpp` | 300 | 1435 | `checkBRep` ×3 overloads, `checkTrimmedFaceSelfIntersection` |

`Boolean.hpp` (229 / 1918, also 0 OCCT) declares `booleanSolid(const Solid&, const Solid&, BoolOp)`
against these same types, with `modifiedFromA`/`modifiedFromB`/`deletedA`/`deletedB`
face-tracking maps and an honestly flagged `usedMeshFallback` bit for the
high-degree face pairs analytic SSI cannot close.

### Primitives — 10 canonical solids and 2 analytic sweeps

Ten canonical primitives: `buildBox`, `buildCylinder`, `buildCone` (frustum;
`r2==0` gives an apex cone), `buildSphere`, `buildTorus`, `buildPrism`,
`buildWedge`, `buildTube`, `buildPyramid` (planar skin), `buildEllipsoid` (NURBS
skin). Placement matches OCCT `BRepPrimAPI` 1:1 — box min-corner at origin,
cylinder axis +Z with base on z=0, sphere centred at origin — so native and OCCT
numbers compare like for like. The `SolidFactory` owns the topology; the returned
`Solid*` is a view valid for the factory's lifetime.

`SolidFactory` declares **12** `build*` entry points, not 10. The two beyond the
canonical primitives are analytic SWEPT solids — the header's own words, "ADDITIVE
analytic replacements for OCCT `BRepPrimAPI_MakePrism` / `MakeRevol`":

- `buildPrismFromProfile(profile, vx, vy, vz)` (`Primitives.hpp:97`) — linear
  extrude of a planar sketch polygon. All-planar, so a non-convex L/T/U profile
  integrates exactly. Returns `nullptr` on `|vz| ~ 0`, a zero-area profile, or
  fewer than 3 points.
- `buildRevolveProfile(profileRZ, angleRad)` (`Primitives.hpp:112`) — rotational
  sweep of an `(r,z)` polygon about +Z. Each profile edge sweeps an exact
  Cylinder / planar annulus / Cone face; a partial angle adds the two planar end
  walls. Returns `nullptr` on a degenerate profile or a non-positive/over-full
  angle.

Both are defined (`Primitives.cpp:636` and `:721`) and gated:
`forge-kernel/test/native/brep/native_sweep_analytic_test.cpp`, 58/58 this run.
Do not plan prism/revolve as missing work — it is built, and it is the
`BRepPrimAPI` sweep pair, not a primitive.

### Sew — three operations

1. **Sew.** Boundary edges are bucketed in a spatial hash keyed on both endpoint
   positions quantised to the tolerance grid, probed in both orderings. A pair is
   confirmed only when the endpoints coincide within `tol` *and* sampled
   mid-curve points do — so the two diagonals of a quad are not falsely merged.
2. **Diagnose.** Each surviving edge is classified by coedge count: 1 = free,
   2 = manifold, 3+ = non-manifold. Closed iff zero free and zero non-manifold.
   Reports `V`, `E`, `F`, `shellCount`, `eulerCharacteristic`, `genus`, and the
   ids of every free and non-manifold edge.
3. **Heal (light).** Standalone near-vertex weld. Remaining free edges are
   FLAGGED with their ids — **not filled**.

### Heal — seven repair passes and a report

The header numbers eight items, but item (5) is REPORT, not a repair. The seven
repairs, each individually switchable in `HealOptions`, are: (1) gap-fill — snap
free-edge endpoints already within `tol` to a common vertex, then re-sew;
(2) small-edge collapse; (3) sliver-face removal by area or aspect ratio;
(4) duplicate/coincident-vertex weld; (6) face-orientation repair from the
face-adjacency graph; (7) self-intersection repair; (8) non-manifold resolution
for edges with 3+ coedges. They are applied in the order 4, 2, 3, 1 in the core
pass.

The discipline is the point: no geometry is invented. A gap wider than `tol`, a
non-collapsible short edge, or a hole that sliver-removal opens and cannot re-close
is reported UNFIXED with its entity ids (`unfixedFreeEdgeIds`,
`uncollapsibleShortEdgeIds`, `keptSliverFaceIds`, `unfixedNonManifoldEdgeIds`,
`unfixedSelfIntersectionFacePairs`, `nonManifoldVertexIds`). `HealReport` carries
the `SewDiagnosis` before and after plus volume and area before and after, so a
heal that changed the shape is visible rather than inferred.

`Heal.cpp` is one of only three `.cpp` files under `native/brep` with a direct
`#include` of `Topology.hpp` — it mutates the graph in place rather than rebuilding.

### FilletAnalytic — nine entry points, each a named case

This is the largest implementation in the directory (2910 lines) and the one whose
scope is most easily misread. There is no general `fillet(Solid, edges, R)`. The
entry points are:

| entry point | case |
|---|---|
| `filletBoxEdgeAnalytic` | one box edge |
| `filletSolidStraightEdgeAnalytic` | one straight edge of a general solid |
| `filletSolidStraightConvexEdgeAnalytic` | as above, convex only |
| `filletLBlockEdgeAnalytic` | the L-block concave case |
| `filletBoxEdgeChainAnalytic` | a chain of box edges |
| `filletSolidStraightEdgesAnalytic` | a chain by edge id |
| `filletCylinderTopEdgeAnalytic` | the cylinder top rim — a true torus blend |
| `filletBoxEdgeVariable` ×2 | variable radius R0→R1 along one box edge |

The chain result is explicit about what it could not do:
`AnalyticChainFilletResult::unblendedCorners` lists every shared box corner where
two or more filleted edges meet and the corner was left sharp. That is a reported
limitation, not a silent one.

Results carry the derived quantities — cylinder axis, tangent points on both
faces, dihedral angle, and for the torus case an exact `removedVolume` of
`2π(Rc−R)(1−π/4)R² + (π/3)R³`.

### ChamferAnalytic, DraftAnalytic

Chamfer: symmetric (`chamferBoxEdgeAnalytic`), asymmetric with independent
setbacks dA/dB (`chamferBoxEdgeAsymmetric`), and the general straight convex edge
(`chamferSolidStraightConvexEdgeAnalytic`).

Draft is the narrowest of the twelve: **`draftBoxAnalytic` is the only entry
point.** Scope is planar side faces of a prismatic solid, one neutral plane, one
uniform angle, pull direction = neutral-plane normal. Explicitly not built, and
surfaced in `reason` rather than faked: curved side faces, per-face variable
angle, a non-planar parting line, and drafting only a subset of a box's walls.

### OffsetShape, Shell

The same closed-form machinery in two directions. Each retained face keeps its
exact analytic surface and only its plane constant or radius moves — so the
offset volume is exact, not a chord estimate:

- plane `O' = O ± t·n`, cylinder/sphere/cone `r' = r ± t`.

`offsetSolidShape` grows or shrinks a whole solid (`t` may be negative) and
re-trims corners by meeting the `k≥3` offset planes at each original vertex.
`shellSolid` hollows to a thin wall, optionally opening named faces as mouths and
bridging each rim with a planar side-wall band of thickness `t`, reporting
`outerFaces`/`innerFaces`/`wallFaces` separately. Shell offsets torus faces
natively (minor radius `r2 → r2 − t`); OffsetShape explicitly defers the torus
case.

Neither builds: arc/rounded joins, freeform trimmed-NURBS offset with
self-intersection trimming, variable per-face thickness, or self-intersection
rejection beyond the `|t| <` min-half-extent guard. Each is reported `ok=false`
with a `reason`.

### UnifyFaces

The inverse of the faceting above, A/B-verified against OCCT
`ShapeUpgrade_UnifySameDomain` in `forge-kernel/test/native_unify_smoke.mjs`:
coplanar planar merge, plus co-cylindrical / co-conical / co-spherical /
co-toroidal merge and the through-bored plate. A cylinder's 128 sectors become the
one periodic face OCCT emits (3F); a pointed cone 2F; a sphere 1F; a torus 1F with
the fundamental-polygon boundary word `b·a·b⁻¹·a⁻¹`; a bored plate 7F with the
holed caps surviving as inner loops.

The three `…Eligible` predicates are narrow on purpose. Unification fires only for
a clean single-primitive body or a single through-bore. Multi-cylinder tubes,
blind bores and hemispheres return false from every eligibility check, and
`unifyFaces` in `DirectEdit.cpp` falls back to OCCT unchanged.

### Section, Query

`sectionSolid` cuts with a flat plane and returns ordered closed wires with signed
area, net filled area, 3D area centroid, perimeter, and an in-plane `uDir`/`vDir`
frame. A wire emitted from an exact analytic circle is tagged `circular` with its
radius and centre rather than being returned as a polyline. Not supported and
returned honestly: general trimmed-NURBS section curves, non-planar cut surfaces,
and plane-grazes-face degenerate sections.

`Query` provides `minDistance` (analytic closed form for sphere-sphere,
sphere-box, box-box; everything else routes to tessellated-boundary distance whose
error is the faceting chord error), `pointInSolid` (even-odd ray cast with a
jittered-ray majority guard against grazing hits), `analyticFaceInventory` (merges
strip faces back into logical analytic faces, reporting `stripFaceCount`), and
`analyticEdgeCount`.

## Check.hpp — the diagnostic taxonomy

The in-house equivalent of OCCT `BRepCheck_Analyzer` / ACIS `check_entity`. It
reads the topology graph and attached geometry; it never mutates.

**21 predicates** across three families. The header documents 21 and `Check.cpp`
emits exactly 21 — the two lists are byte-identical when sorted, and
`validator_test.cpp` asserts all 21 by name.

| id | name | status mapped |
|---|---|---|
| T1 | `EveryEdgeHasOneOrTwoCoedges` | `InvalidMultiConnexity` |
| T2 | `NoDanglingCoedge` | `SubshapeNotInShape` |
| T3 | `NoDuplicateEdge` | `RedundantEdge` |
| T4 | `WireClosure` | `NotClosedWire` |
| T5 | `FaceHasOuterLoop` | `EmptyWire` |
| T6 | `ShellClosureConsistent` | `NotClosed` |
| T7 | `ShellConnected` | `NotConnected` |
| T8 | `EulerPoincareConsistent` | `EulerInvalid` |
| T9 | `NoNonManifoldEdge` | `NonManifoldEdge` |
| G1 | `NoZeroLengthEdge` | `ZeroLengthEdge` |
| G2 | `NoDegenerateFace` | `DegeneratedFace` |
| G3 | `FaceNormalOutward` | `BadOrientationFace` |
| G4 | `NoSelfIntersectingFace` | `SelfIntersectingWire` |
| G5 | `PCurveMatches3DEdge` | `InvalidCurveOnSurface` |
| G6 | `VertexOnEdge` | `InvalidPointOnCurve` |
| G7 | `EdgeOnFace` | `NoCurveOnSurface` |
| G8 | `ToleranceValid` | `InvalidToleranceValue` |
| G9 | `EdgeSameParameter` | `InvalidSameParameter` |
| O1 | `CoedgePairsOpposite` | `BadOrientation` |
| O2 | `OuterLoopCCW` | `BadOrientationCCW` |
| O3 | `CoedgeMateConsistent` | `BadOrientationMate` |

`CheckStatus` has **22** enumerators — the 21 above plus `NoError = 0` — and
`checkStatusName` in `Check.cpp` has 22 `case` labels, so no status can print as
a number. The names deliberately mirror OCCT's `BRepCheck_Status` so an A/B
against `BRepCheck_Analyzer` is a direct enum-name lookup rather than a mapping
table someone has to maintain.

### What makes the report actionable

Each `CheckPredicate` carries `family`, `status`, a stable short `name`
(`"G3.FaceNormalOutward"`), `passed`, a `detail` string, and — the part that
matters for repair — `offenders`: a list of `{IdKind, id}` where `IdKind` is one
of `Edge`, `Face`, `Coedge`, `Loop`, `Vertex`, `Shell`. A heal op does not have to
re-derive which entity failed.

`CheckReport` adds `valid` (true iff every predicate passed), `total()`,
`passed()`, `failed()`, `find(name)`, `failedPredicate(name)`, and
`failedStatuses()` (the distinct failing statuses, for per-status A/B comparison).

`CheckOptions`: `tol = 1e-6` model-space (OR-ed with per-entity tolerances as
`max(global, entity)`), `curveSamples = 8`, `maxTolerance = 1.0` as the
runaway-tolerance ceiling, and `expectClosed = true` — set it false for an open
sheet body so T6 checks the open-consistency direction instead of demanding
closure.

Three overloads: `checkBRep(vector<Face*>)` is the canonical entry;
`checkBRep(const Shell*)` and `checkBRep(const Solid*)` are conveniences. The
Solid overload concatenates all shells into one face set deliberately — T7 then
reports the shell count honestly rather than validating each shell blind to the
others.

### The combinatorial verdicts are exact

The geometric sign decisions — vertex-on-edge collinearity, the signed-volume
tetra sum behind G3's outward sense — go through `ExactPredicates3D::exactOrient3D`,
not a float tie-break. Same for `checkTrimmedFaceSelfIntersection`, the exhaustive
G4 case for a real trimmed-NURBS face: it tests every flattened trim pcurve, not
just the outer loop, catching both intra-loop self-crossing and inter-loop
imbrication (a hole poking outside the outer boundary — the wholly-outside-hole
case a pure crossing test misses).

Its own scope note is honest about the remaining gap: the boundary is tested on
the chordal-adaptive *flattening* of each pcurve, with crossing signs taken
exactly. A full curved-pcurve exact arrangement (arc×arc tangency, exact rational
self-tangency) is not built.

## What proves all this

| claim | proof |
|---|---|
| the scope note matches the code | `tools/kernel/topology_honesty_gate.py`, registered at `gate-registration.yml:225`, `--selftest` at :226 — all 3 mutations go RED (3 of the gate's 5 probes) |
| the 21-predicate battery runs and is exercised | `forge-kernel/test/native/brep/validator_test.cpp` asserts all 21 by name; 54/54 checks pass |
| the B-Rep layer builds and passes | `forge-kernel/test/native/brep/*.cpp` — **61 gates**, all pass |
| those gates actually run in CI | `.github/workflows/kernel-tests.yml:99` runs `run_native.sh`, which globs `test/native/<class>/*.cpp` (142 gates total) and exits 1 unless `ran == count` |
| the twelve ops are OCCT-free | 0 OCCT `#include` lines in each `.hpp` and each `.cpp` |
| OCCT and the native graph do not mix | 1 file of 128 in `native/brep` includes both |

Measured this session with `ONLY=brep JOBS=8 bash forge-kernel/test/native/run_native.sh`,
61 of 142 gates run and pass. Selected counts:

| gate | checks |
|---|---:|
| `native_primitives_test` | 159/159 |
| `native_boolean_test` | 141/141 |
| `heal_test` | 68/68 |
| `native_sweep_analytic_test` | 58/58 |
| `validator_test` | 54/54 |
| `fillet_analytic_test` | 43/43 |
| `sew_test` | 34/34 |
| `brep_test` | 33/33 |
| `chamfer_analytic_test` | 29/29 |
| `k0_topology_test` | 26/26 |
| `query_test` | 24/24 |
| `offset_shape_test` | 20/20 |
| `shell_solid_test` | 19/19 |
| `section_test` | 16/16 |
| `draft_analytic_test` | 13/13 |

`run_native.sh` refuses to report green on a filtered run: with `ONLY=` set it
prints "NOT a full gate" and, unfiltered, fails outright if `ran != count`. That
is the property this repository learned to demand — a gate that cannot run cannot
fail, and ten physics gates in this tree had never run once before `d82b1d5c`.

### `UnifyFaces` is the one with no C++ gate

There is no `unify*_test.cpp` under `test/native/brep/`. `UnifyFaces.cpp` IS
compiled and link-checked by `run_native.sh` — its source phase builds every
`forge-kernel/src/native/*/*.cpp` into the object set every test links against —
so it cannot rot into a file nothing compiles. But no gate in the 142 calls it.
Its only behavioural evidence is the A/B in
`forge-kernel/test/native_unify_smoke.mjs`, which runs under the
`forge:kernel:test` npm script, not under `run_native.sh`. Compiled is not
covered: of the twelve operations here, this is the one whose 1224 lines no
native gate exercises.

## Two things this measurement corrected

**1. The header over-claims MEF.** `Topology.hpp:39` says "Only MEV and MEF
exist". MEV exists; MEF has zero occurrences in the kernel. The honesty gate
probes `KEV|KEF|MEKR|KEMR|MZEV` and would not catch this. Stated above so nobody
plans against an operator that is not there.

**2. `Primitives.hpp:49` says "Default 64"; line 52 says `int nSeg = 128`.** The
prose sentence is about `nSeg` ("so nSeg only governs the tessellation chord error
and the face count. Default 64 is a good balance for the gate"), and the field it
describes is 128. `nBand` is the one that is 64. A reader sizing a face count from
the prose would be off by 2×.

Neither is edited here — this file documents, it does not patch. Both are one-line
fixes in their own headers.
