# Forge Kernel Audit — AREA: B-rep + NURBS solid/surface core

> Grounded audit, 2026-06-24. Read live from `forge-kernel/src/native/brep/*`,
> `forge-kernel/include/forge/native/brep/*`, `OCCT_ZERO_ROADMAP.md`, and
> `src/*.cpp` (the OCCT-backed live route). Target: **full industrial 1:1 parity
> with Siemens Parasolid + Spatial ACIS** (full feature set, data structures,
> operational paradigms — no lite). Bible §0 discipline assumed: OCCT stays the
> live default + A/B oracle until each native op is A/B-proven; delete OCCT only
> against a frozen golden corpus.

---

## 0. TL;DR

Forge has a **real but early in-house B-rep/NURBS substrate** (~11k LOC across 19
brep .cpp files) that is genuine, validated, and dependency-free — but it is at
roughly **a first-increment analytic-quadric kernel**, not a Parasolid/ACIS-class
modeller. Against the production target it is **~10-15% of the way** in capability
terms (the roadmap's own "~35% migrated" counts the OCCT-backed live route as the
product; the *native* B-rep core alone is far less).

The three structural facts that frame the whole gap:

1. **Two disjoint representations.** The analytic B-rep (`Topology.hpp` +
   `Surface.hpp` + `Boolean.cpp`) carries exact quadric faces but its **edges have
   no curve geometry** (an `Edge` is just `start`/`end` vertex pointers —
   `Topology.hpp:89-97`). Meanwhile **every feature op — Loft, Sweep, Fillet,
   Chamfer, Draft — operates on `mesh::HalfEdgeMesh` (triangle soup), NOT on
   `brep::Solid`** (`Loft.hpp:71` `mesh::HalfEdgeMesh mesh;`, same for Sweep/
   Chamfer/Draft/Fillet). So features cannot consume or produce the analytic
   B-rep. This is the deepest architectural gap vs Parasolid (one unified
   topological model on which *every* op acts).
2. **Faces are single-loop only.** `Face` has one `outerLoop` and *no inner
   loops* (`Topology.hpp:136-163` "no inner hole loops yet"). A planar face with
   a hole — the single most common real B-rep face — cannot be represented in the
   native topology.
3. **Production still runs on OCCT for everything non-trivial.** `NativeRoute.cpp`
   flips only CORE native by default (primitives/transform/booleans on native
   operands/massprops/tessellate, A/B-verified `native_vs_occt 33/33`);
   `featuresNative()` and `stepNative()` stay **OFF in production**
   (`NativeRoute.cpp:54-74`). 36 `src/*.cpp` files still call OCCT
   (`TopoDS_`/`BRep*`/`STEPControl`/`Geom_`/`gp_Pnt`).

---

## 1. What Forge has now (cited)

### 1.1 Topology data structure — `Topology.hpp` / `Topology.cpp`
- Winged/radial-edge-lite half-edge graph: `Vertex, Edge, Coedge, Loop, Face,
  Shell, Solid` (`Topology.hpp:80-180`), owned by `TopologyBuilder` via
  `unique_ptr` vectors; raw-pointer adjacency.
- Basic Euler operators: `makeVertex/Edge/Coedge/Loop/Face/Shell/Solid`, `mev`
  (Make-Edge-Vertex), `addOuterLoopToFace` (shared-edge mating),
  `addFaceToShell`, `addShellToSolid`, `buildBox` (`Topology.hpp:216-263`).
- Validators: `counts()` → `EulerCounts` (V-E+F characteristic) and
  `isClosedTwoManifold()` (every edge mated, loops close) (`Topology.hpp:266-274`).
- **Face geometry:** a `Face` optionally points at an analytic `Surface*` with a
  parameter-rectangle trim window `(u0,u1)x(v0,v1)` plus a `paramTri` flag for
  imprinted curved sub-faces (`Topology.hpp:138-163`).

### 1.2 Analytic surface geometry — `Surface.hpp` / `Surface.cpp`
- Tagged union `SurfaceKind {Plane, Cylinder, Cone, Sphere, Torus, Nurbs}`
  (`Surface.hpp:59-66`) with exact `evaluate`, `evaluateDeriv` (dS/du, dS/dv),
  `normalAt` for each (`Surface.hpp:111-118`). Exact circular-disk cap annotation
  for analytic-exact mass props (`Surface.hpp:96-106`).

### 1.3 NURBS curve + surface — `Nurbs.hpp/.cpp`, `NurbsSurface.hpp/.cpp`, `NurbsCalculus.hpp/.cpp`
- Cox-de Boor `findSpan` + `basisFunctions` (`Nurbs.hpp:58-65`); rational
  `NurbsCurve::evaluate`, `NurbsSurface::evaluate`; independent de Casteljau /
  Bernstein Bezier evaluators as cross-check (`Nurbs.hpp:113-128`).
- `NurbsSurface.cpp`: `validateSurface` (clamped/consistent knots, degree<count,
  weights>0), `evaluateWithDerivatives` (rational quotient-rule partials + analytic
  normal, FD-cross-checked <1e-5), uniform `tessellate` to a `HalfEdgeMesh`
  (open patch) (`NurbsSurface.hpp:72-107`).
- `NurbsCalculus.cpp`: `basisFunctionDerivatives` (DersBasisFuns A2.3),
  `curveDerivatives`/`surfaceDerivatives` (1st+2nd, rational A4.2/A4.4),
  tangent/normal/curvature, and **Boehm single-knot insertion** (A5.1,
  multiplicity +1) (`NurbsCalculus.hpp:76-126`).

### 1.4 Surface-surface intersection — `SurfaceIntersect.hpp/.cpp` (823 LOC)
- Closed-form: plane∩plane, plane∩sphere, plane∩cylinder (lines/circle/ellipse),
  sphere∩sphere, **plane∩cone full Dandelin conic set** (circle/ellipse/parabola/
  hyperbola/line-pair/point), cyl∩cyl Steinmetz (equal-r), cyl∩sphere coaxial
  (`SurfaceIntersect.hpp:20-43`).
- Newton-marched polyline for skew/unequal cyl∩cyl and offset cyl∩sphere
  (`closedForm=true` only when residual <1e-9 on both surfaces).
- **Deferred (ok=false → mesh fallback):** cone∩(cyl/cone/sphere), **every torus
  pair**, **anything involving a NURBS face** (`SurfaceIntersect.hpp:44-48`).

### 1.5 Boolean — `Boolean.hpp/.cpp` (1218 LOC)
- `booleanSolid(A,B,op)` Fuse/Cut/Common on analytic `brep::Solid`s: pairwise
  AABB-overlap → analytic SSI → imprint curve via `constrainedDelaunay2D` in each
  face's own (u,v) box → sub-faces **keep the parent Surface** (exact, not chordal)
  → in/out classify by ray-cast → stitch → validate closed 2-manifold.
- **Honest mesh fallback** flagged `usedMeshFallback` for any pair the analytic SSI
  defers (`Boolean.hpp:44-53`). Result mass is analytic-exact for the quadric family.

### 1.6 Feature ops (all **mesh**-based, on `HalfEdgeMesh`)
- `Loft.cpp` (281): parallel same-count section polygons → watertight 2-manifold
  triangle solid; refuses non-monotone/mismatched/degenerate (`Loft.hpp:68-91`).
- `Sweep.cpp` (684): linear/polyline extrude with rotation-minimising transport,
  outer+hole profile loops, miter planes (`Sweep.hpp`).
- `Fillet.cpp` (1242): **mesh** rolling-ball fillet of sharp **convex** edges of a
  closed triangle solid; per-edge selection; spherical-cap corners. **Concave edges
  SKIPPED** (`Fillet.hpp:25-94, 159`).
- `Chamfer.cpp` (629), `Draft.cpp` (344): mesh-based, emit `HalfEdgeMesh`.

### 1.7 Mass properties — `MassProps.cpp` (327)
- Divergence-theorem volume/area/COM/inertia directly on the analytic faces — this
  *is* the A/B oracle metric (`OCCT_ZERO_ROADMAP.md` W1.6).

### 1.8 STEP I/O — `StepAnalytic.cpp` (1311), `StepFaceted.cpp` (879), `MeshExchange.cpp` (744)
- `StepAnalytic`: AP242 ISO-10303-21 writer + reader. Surface map PLANE/
  CYLINDRICAL/CONICAL/SPHERICAL/TOROIDAL_SURFACE 1:1; `B_SPLINE_SURFACE_WITH_KNOTS`
  **written** when populated but **NOT read back** — `read()` fails honestly
  `"unsupported analytic surface entity"` (`StepAnalytic.cpp:747-749`); writer also
  fails on a NURBS face it cannot serialise (`StepAnalytic.cpp:495`).
- `StepFaceted` / `MeshExchange`: faceted STEP + mesh exchange.

### 1.9 Routing / gating — `NativeRoute.cpp` (405)
- Three independent gates: CORE (default ON, A/B `native_vs_occt 33/33`),
  FEATURES (`FORGE_NATIVE_FEATURES`, **OFF**), STEP (`FORGE_NATIVE_STEP`, **OFF**)
  (`NativeRoute.cpp:26-79`). `tessellateSolidForViewport` bridges native Solid →
  viewport buffers.
- A/B harness: `test/native_vs_occt_core.mjs`; native brep unit tests in
  `test/native/brep/` (boolean, ssi, primitives, nurbs, loft, sweep, fillet,
  chamfer, draft, step_analytic, stepfaceted).

---

## 2. The gap vs Parasolid + ACIS (concrete, enumerated)

### 2.1 Topology / data-structure gaps
- **No inner (hole) loops on faces** — `Face` is single-`outerLoop` only
  (`Topology.hpp:136`). Parasolid/ACIS faces carry an outer loop + N inner loops.
  Blocks: any face with a hole, real trimmed surfaces, boolean results on plates.
- **No curve geometry on edges.** `Edge` is two vertex pointers; there is no
  `Curve` (line/circle/ellipse/B-spline) bound to an edge, and **no pcurve** (the
  surface-domain 2D curve a coedge needs). Parasolid edges carry a 3D curve;
  coedges carry SP-curves. Without pcurves, trimmed surfaces, robust face splitting
  and HLR are not representable analytically.
- **No non-manifold topology.** `Edge` has exactly two coedge slots
  (`Topology.hpp:95-96`); roadmap §1 confirms "no non-manifold support". ACIS is
  fundamentally non-manifold (general-body, mixed wire/sheet/solid, laminae).
- **No general bodies:** no wire body, no sheet/open-shell body, no mixed-dimension
  body, no void shells / inner shells (`Solid` = "outer shell first", voids
  TARGETED, `Topology.hpp:175-180`). No bounding-box / spatial face-edge index on
  the topology.
- **No persistent IDs / attributes / lineage on native topology.** No
  attribute-on-entity system, no tag/rollback. Parasolid+ACIS attach attributes to
  every entity and track Modified/Generated/Deleted lineage — the roadmap notes
  native Booleans have "no Modified/Generated/IsDeleted yet" (`W1.3`), so booleans
  cannot feed a feature history.
- **No two-representation unification.** Analytic B-rep (Topology/Surface/Boolean)
  and the mesh feature stack (Loft/Sweep/Fillet/Chamfer/Draft on `HalfEdgeMesh`)
  are **disjoint**. A real kernel has ONE body model that every op reads and writes.

### 2.2 Surface / curve (geometry) gaps
- **No trimmed-NURBS surface as a face geometry.** `Surface` supports 5 quadrics +
  a raw `NurbsSurface`, but a face trim is a *parameter rectangle*
  (`Surface.hpp:20-25`) — no arbitrary trim loops in (u,v). This is **the keystone
  blocker** (also per roadmap §5).
- **No procedural/derived surfaces:** no offset surface, no surface of
  revolution-as-NURBS, no ruled/Coons/Gordon/skinned NURBS surface, no
  blend/fillet surface type, no extruded/swept surface object.
- **NURBS curve ops missing:** no knot *removal*, no **degree elevation**, no
  refinement, no curve/surface **fitting/interpolation/approximation** (point→
  B-spline), no curve-curve / curve-surface intersection, no curve **trimming/
  splitting**, no reparameterisation, no closest-point/projection on
  curve or surface.
- **NURBS surface ops missing:** surface knot insertion (only curve has Boehm),
  surface splitting, surface-surface intersection for NURBS faces, surface
  offsetting, surface filling (Coons/Gordon), continuity (G0-G3) analysis.
- **No general 3D curve type bound to topology** (line/circle/ellipse/parabola/
  hyperbola/B-spline as edge geometry) — SSI returns analytic curves but nothing
  stores them on edges.

### 2.3 Modelling-operator gaps (vs Parasolid/ACIS op set)
- **Booleans:** only analytic-quadric pairs are exact; **cone-cone, all torus,
  all NURBS pairs fall back to mesh**; **no non-manifold booleans**, no
  **imprint** as a standalone op, no **boolean Splitter** (slice body by tool
  sheet — Parasolid `IMPRINT`/`PK_BODY_section`), no fuzzy/tolerant boolean
  policy in native (BooleanTol is OCCT-only), **no boolean lineage**.
- **Fillet/Chamfer (the single hardest area):** native fillet is **mesh + convex
  edges only**. Missing the entire analytic blend family: **constant-radius rolling-
  ball fillet surface on the B-rep**, **variable-radius / law-controlled fillet**,
  **concave (reflex) edge fillet**, **setback / vertex-blend corners**, **face-face
  (non-edge) blends**, **chordal / asymmetric / chamfer-with-setback**, **blend
  overflow/recession handling**. (Roadmap W3.10 calls the analytic rolling-ball
  fillet "STEP-grade hard… migrated last".)
- **Shelling / hollow:** no native B-rep shell-with-thickness, no face removal +
  offset to a solid.
- **Offset:** no analytic B-rep face/solid **offset** (only mesh offset in
  `mesh/Offset`); no 2D planar wire offset for sheet-metal/CAM (roadmap W3.7).
- **Sweep/Loft (analytic):** native loft is *parallel-section mesh* only — no
  **guided/multi-section NURBS loft** (GeomFill_NSections), no ruled-between-
  arbitrary-profiles, no closed loft, no tangency/continuity constraints. Sweep is
  *fixed cross-section polyline* — no **sweep-along-3D-NURBS-spine**, no
  variable/scaling/morphing section, no pipe-with-guide-rail.
- **Direct/synchronous modelling:** none native — push/pull face, move-face,
  offset-face, delete-face-and-heal, replace-face (roadmap W3.3 "missing").
- **Sewing + healing (ShapeFix):** none native — no edge-merge sew of faces into a
  shell, no gap healing, no small-edge/sliver-face removal, no self-intersection
  repair, no geometry/topology fix (roadmap W3.4 "missing").
- **Topological checker:** native validator only checks closed-2-manifold; no
  ACIS/Parasolid-grade `check_entity` (≈30 BRepCheck predicates — self-intersecting
  loop, wrong orientation, edge-not-on-surface, etc.; roadmap W3.5).
- **Hidden-line removal (drawings):** none native (roadmap W3.6 "missing"; substrate
  is `mesh/ProjectSilhouette`).
- **Tessellation:** native tessellator exists but is **uniform-grid**; no
  curvature-adaptive / tolerance-driven faceting with crack-free stitching across
  shared edges — required for both viewport and export parity.
- **Tetra/surface meshing from B-rep** (FeaTet) missing native (roadmap W3.8).
- **Sheet metal / mold** native ops missing (roadmap W3.9: need native Splitter +
  face normals for draft, mold core/cavity).

### 2.4 Data-exchange gaps
- **No Parasolid XT/XB read or write**, **no ACIS SAT/SAB read or write** — i.e. no
  interop with the two target kernels' native formats at all (only doc-comment
  mentions; confirmed no impl under `src/native/`).
- **STEP read of foreign/NURBS parts:** native reader handles only the 5 quadric
  surfaces; **trimmed B-spline surfaces are not reconstructed**
  (`StepAnalytic.cpp:747-749`). Any real benchmark/customer STEP routes to OCCT.
- **No IGES read/write, no STL→B-rep, no BREP/OBJ→solid heal-on-import** native.
- No assembly/PMI/GD&T (FCF) carried through the native exchange path.

### 2.5 Robustness / numerics
- Coordinates are plain IEEE-754 doubles; predicates (orient2d/3d) are exact, but
  the kernel is "robust-in-practice, NOT an exact (rational/interval) kernel"
  (`Fillet.hpp:90-94`). Parasolid/ACIS ship tolerant-modelling with per-entity
  tolerances, interval arithmetic, and exact predicates throughout the boolean and
  intersection engines. No tolerant-edge / SP-tolerance model in native topology.

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Discipline (Bible §0): OCCT stays live default + oracle per op; each increment ships
real (no MVP/stub), CI-green, dynamic; A/B gate adds a **topology signature**
(V/E/F counts + adjacency hash), not just mass props (roadmap §6 — coincidental
mass-props parity is the dangerous silent failure). Delete OCCT only at the end vs a
frozen golden corpus.

### Phase A — Unify the body model + close topology holes (foundation; ~3-5k LOC)
- **A1. Inner loops on Face + general Loop set.** Add `innerLoops` to `Face`,
  loop role (outer/inner), update Euler counts/validator for `V-E+F = 2-2G-(L-F)`.
  *Subsystem:* `brep/Topology`. *Verify:* build plate-with-hole, A/B vs OCCT
  face/loop counts + mass props. *~600 LOC.*
- **A2. Curve geometry on edges + pcurves on coedges.** New `Curve` tagged type
  (Line/Circle/Ellipse/B-spline) + 2D `PCurve` in surface domain; bind to
  `Edge`/`Coedge`. *Subsystem:* `brep/Topology`+`brep/Curve` (new). *Verify:*
  round-trip eval of edge curve vs vertex chord + SSI curve; A/B edge geometry vs
  OCCT `BRep_Tool::Curve`. *~1.2k LOC.*
- **A3. Make features write `brep::Solid`, not mesh.** Re-target Sweep/Loft to emit
  analytic faces on the unified topology (planar caps + ruled/quadric sides where
  exact, NURBS otherwise). *Subsystem:* `brep/Sweep`,`brep/Loft`. *Verify:* A/B
  mass props + topology signature vs OCCT prism/thrusections. *~1.5k LOC.*
- **A4. Native attribute + lineage system** (persistent tag per entity;
  Modified/Generated/Deleted maps out of boolean). *Subsystem:* new
  `brep/Lineage`. *Verify:* boolean lineage matches OCCT `BRepAlgoAPI::Modified`
  on canonical cases. *~700 LOC.* (Gates dropping OCCT booleans entirely.)

### Phase B — The keystone: trimmed-NURBS surface (read + eval + face) (~2.5-3k LOC)
- **B1. Trimmed-NURBS surface face.** Surface = B-spline surface + N trim loops in
  (u,v); point/deriv/normal eval honouring trim; in-trim classification.
  *Subsystem:* `brep/Surface`+`brep/NurbsSurface`+`brep/Topology`. *Verify:*
  evaluate-in/out vs OCCT `BRepTopAdaptor_FClass2d`; mass props of a trimmed patch
  vs OCCT. *~1.5k LOC.*
- **B2. STEP reader for B_SPLINE_SURFACE_WITH_KNOTS + ADVANCED_FACE trims.** Replace
  the honest-fail at `StepAnalytic.cpp:747-749`. *Subsystem:* `brep/StepAnalytic`.
  *Verify:* round-trip a NURBS part write→read; import an OCCT-exported NURBS STEP,
  A/B mass props + face count vs OCCT `STEPControl_Reader`. *~1k LOC.* **THIS
  unblocks reading the benchmark/customer corpus natively.**

### Phase C — Healing/sewing + checker (gates import + direct-edit; ~2-3k LOC)
- **C1. Native sewing** (promote `mesh/Repair` weld to B-rep edge-merge + manifold
  detection). *Verify:* sew N faces → closed shell; topology signature vs OCCT
  `BRepBuilderAPI_Sewing`. *~900 LOC.*
- **C2. Native ShapeFix** (gap heal, sliver/small-edge removal, orientation fix).
  *Verify:* known-bad regression corpus → valid solid (not pure A/B). *~1k LOC.*
- **C3. Native topological checker** (~30 predicates). *Verify:* known-bad
  regression suite. *~800 LOC.*

### Phase D — Analytic NURBS op suite + surface intersection (~4-5k LOC)
- **D1. Curve/surface fitting + interpolation, degree elevation, knot removal,
  surface knot insertion, splitting, projection/closest-point.** *Subsystem:*
  `brep/NurbsCalculus`,`brep/NurbsSurface`. *Verify:* reconstruct known curves;
  A/B point-sets vs OCCT `GeomAPI_*`. *~1.8k LOC.*
- **D2. NURBS-involved SSI** (the deferred pairs: cone-cone, torus-any, NURBS-any)
  via robust subdivision + Newton marching with topology of branches/loops.
  *Subsystem:* `brep/SurfaceIntersect`. *Verify:* A/B intersection point-sets vs
  OCCT `GeomInt_IntSS`. *~2k LOC.* (Removes the boolean's mesh fallback.)
- **D3. Adaptive crack-free tessellator** (curvature/tolerance driven, shared-edge
  stitched). *Verify:* deviation vs surface < tol, watertight; A/B tri vs OCCT
  `BRepMesh`. *~900 LOC.*

### Phase E — High-value modelling ops (~5-7k LOC)
- **E1. Analytic B-rep shell/offset** (face offset + solid hollow). *Verify:* A/B
  vs OCCT `BRepOffset_MakeOffset`. *~1.5k LOC.*
- **E2. Analytic edge fillet/chamfer on the B-rep** (constant-radius rolling-ball
  blend *surface* + trim), then **variable-radius / law fillet**, **concave**,
  **setback vertex blends**, **face-face blends**. *Verify:* A/B mass props +
  blend-surface point sampling vs OCCT `BRepFilletAPI`. *~3k LOC, the deepest item
  — schedule near last.*
- **E3. Direct/synchronous modelling** (push/pull, move/offset/delete-face-and-heal)
  on top of C1-C2. *Verify:* regression round-trip + mass props. *~1.5k LOC.*
- **E4. Boolean Splitter / imprint as ops; non-manifold boolean.** *Verify:* A/B vs
  OCCT `BRepAlgoAPI_Splitter`. *~1.2k LOC.*

### Phase F — Exchange + drawings + parity sweep (~4-6k LOC)
- **F1. Parasolid XT and ACIS SAT read/write** (the literal target-format interop).
  *Verify:* round-trip + A/B mass props vs the parts as imported through OCCT.
  *~2.5k LOC.* (May be policy-gated; biggest single interop lift.)
- **F2. IGES read/write, STL→B-rep heal-on-import.** *~1k LOC.*
- **F3. Native HLR for drawings** (substrate `mesh/ProjectSilhouette`). *Verify:*
  regression-image compare. *~1.2k LOC.*
- **F4. PMI/GD&T + assembly carried through native exchange.** *~800 LOC.*

### Phase G — OCCT deletion
Only after **zero runtime OCCT calls** under the full regression + CADGenBench, vs a
**frozen OCCT-built golden corpus** (oracle-removal paradox, roadmap §6). Flip each
remaining `src/*.cpp` of the 36 OCCT files off, delete the dep, freeze.

---

## 4. The single biggest blocker + critical path

**Biggest blocker: there is no unified analytic body model that every operator
shares.** The native B-rep (Topology/Surface/Boolean) and the mesh feature stack
(Loft/Sweep/Fillet/Chamfer/Draft on `HalfEdgeMesh`) are two disjoint
representations, the topology cannot represent a face with a hole or a curve on an
edge, and there is no attribute/lineage system. Until those are unified and
completed (**Phase A**), every higher op is either OCCT-only or mesh-only and cannot
compose into a Parasolid/ACIS-style modelling history.

Layered immediately behind it is the **geometric keystone the roadmap already
names: native trimmed-NURBS surface read+eval (Phase B / roadmap W3.1)** — without
it the kernel cannot read any real-world / benchmark / customer part (the moment a
face is not one of the 5 quadrics, import routes to OCCT — `StepAnalytic.cpp:749`),
so **OCCT can never be deleted**.

**Critical path:**
`A1 inner loops + A2 edge curves/pcurves` (unblocks trimmed faces and real face
splitting) → `A3 features emit B-rep` (one representation) → `B1 trimmed-NURBS
face` + `B2 NURBS STEP read` (read the corpus natively — keystone) → `C1/C2
sewing+healing` (clean imports + gate direct-edit) → `D2 NURBS SSI` (removes the
boolean mesh fallback; lets booleans run on all faces) → `E1 offset/shell` → `E2
analytic + variable fillet` (deepest, last) → `F1 Parasolid XT / ACIS SAT interop`
→ `A4 boolean lineage` (prereq to dropping OCCT booleans) → **G delete OCCT** vs the
frozen golden corpus.

Rough total to credible Parasolid/ACIS-class parity in this AREA: **~25-35k LOC**
of new native code (excluding the existing ~11k), staged as above. The fillet/blend
family (E2) and the two target-format codecs (F1) are the two highest-risk,
highest-LOC single items.
