# Forge Kernel Audit — Model Healing / Sewing + Tolerant Modelling

> AREA: Model healing / sewing + tolerant modelling.
> TARGET: full industrial 1:1 parity with **ACIS tolerant modelling** + **Parasolid healing**
> (gap closure, manifold repair, validity). No lite versions, no small-function stand-ins.
> GROUNDED in the live tree at `forge-kernel/` (read 2026-06-24), cross-checked against
> `OCCT_ZERO_ROADMAP.md`. Discipline = Bible §0: real impl only, OCCT stays the oracle +
> live default until each native op is A/B-proven, CI-green per increment, dynamic not static.

---

## 1. What Forge has TODAY (cited from source actually read)

### 1.1 The B-rep healing surface — 100% OCCT wrappers (NOT native)

Every B-rep-level healing/sewing/validity entry point is a thin pass-through to OCCT. These
are the user-facing `heal.*`, `sewing.*`, `shapefix.*`, `shapecheck.*`, `booleantol.*` ops:

| File | What it actually is | OCCT class it wraps |
|------|--------------------|---------------------|
| `src/Healing.cpp` (313 LOC) | `sewShape`, `simplifyShape`, `autoFillMissingFaces`, `autoRepairSelfIntersection`, `harmonizeNormals`, `checkValidity` — the **main** `heal.*` namespace (bound at `binding.cpp:5560-5567`) | `BRepBuilderAPI_Sewing`, `ShapeUpgrade_UnifySameDomain`, `ShapeAnalysis_FreeBounds`, `BRepOffsetAPI_MakeFilling`, `ShapeFix_Shape`, `ShapeFix_Solid`, `ShapeAnalysis_Shell`, `BRepCheck_Analyzer` |
| `src/ShapeFix.cpp` (110 LOC) | `shapefix.repair` + DONE1..8/FAIL1..8 status log | `ShapeFix_Shape::Perform()` |
| `src/Sewing.cpp` (63 LOC) | `sewing.sew(shapes[], tol)` + free/multiple/contiguous/degenerate counters | `BRepBuilderAPI_Sewing` |
| `src/ShapeCheck.cpp` (163 LOC) | `shapecheck.analyse` — walks SOLID→VERTEX, maps ~36 `BRepCheck_Status` enums to strings | `BRepCheck_Analyzer`, `BRepCheck_Result` |
| `src/BooleanTol.cpp` (62 LOC) | `booleantol.{fuse,cut,common}(a,b,fuzz)` — tolerant/fuzzy boolean | `BRepAlgoAPI_*::SetFuzzyValue()` |

**Verdict:** the entire B-rep healing/sewing/tolerant-boolean/validity stack is OCCT. Matches
`OCCT_ZERO_ROADMAP.md` which lists `ShapeFix` + `Sewing` as `missing` (native) and
`ShapeCheck`/`BooleanTol` as `partial`. There is **zero native B-rep healing today.**

### 1.2 The native MESH-soup repair — genuinely native, but mesh-only

Two real, OCCT-free, pure-C++20 modules operate on **indexed triangle soup**, not B-rep:

- **`src/native/mesh/Repair.cpp` (`repairMesh`, 643 LOC)** — the strongest native asset in this
  area. A full soup→watertight-2-manifold pipeline: (1) spatial-hash **vertex weld**
  (`weldVertices`, cell=eps, 27-neighbour search); (2) **drop degenerate** (repeated index /
  area ≤ areaEps); (3) **dedupe exact-duplicate faces** (canonical sorted-triple key);
  (4) **non-manifold edge detection** (edge incident to >2 faces → honest `ok=false`);
  (5) **consistent winding** per connected component via BFS edge-orientation propagation +
  global outward flip by signed volume; (6) **ear-clip hole fill** in best-fit Newell plane
  using **exact `orient2d`** (`earClip2D`, never a float tolerance), bounded by `maxHoleEdges`.
  Rebuilds a `HalfEdgeMesh` and re-audits `validate().isValid()`. **0-fakes discipline is real**:
  it fails honestly on non-manifold soup or untriangulable holes.

- **`src/MeshRepair.cpp` (`forge::meshrepair`, 447 LOC)** — `analyse` (boundary-edge /
  non-manifold-edge counts), `dedupeVertices` (spatial hash), `removeDegenerate`, `fillHoles`
  (centroid-fan, weaker than Repair.cpp's ear-clip), `laplacianSmooth` (boundary-pinned),
  `decimateEdgeCollapse` (greedy shortest-edge with a non-manifold guard). Bound at
  `binding.cpp:6935-7023` as `meshrepair.*`.

- **`src/native/mesh/HalfEdgeMesh.cpp` (264 LOC)** — the validity backbone: `buildFromSoup`
  (rejects repeated directed edge = bad winding), `validate()` (twin consistency, watertight,
  per-edge 2-manifold, **vertex-fan single-cycle** check, Euler characteristic), `signedVolume`,
  `surfaceArea`. This `ValidityReport` is the native oracle the soup repair gates against.

- Supporting native mesh validity tooling: `SelfIntersect.cpp` (exact tri-tri via spatial grid,
  reproduces O(n²) verdict exactly), `HoleFill.cpp`, `WallThickness.cpp`, `TopologyStats.cpp`,
  `FeatureEdges.cpp`. All OCCT-free.

### 1.3 The native B-rep substrate (what healing would build ON)

- **`src/native/brep/Topology.cpp` + `include/.../Topology.hpp`** — a real **radial-edge-lite /
  winged-half-edge** B-rep: `Vertex/Edge/Coedge/Loop/Face/Shell/Solid` with `coedgeA/coedgeB`
  mate links, `makeVertex/makeEdge/makeCoedge/makeLoop/makeFace/makeShell/makeSolid`, an
  Euler-style `mev`, `addOuterLoopToFace` (shared-edge reuse), `buildBox`, `counts()`
  (Euler-Poincaré), and **`isClosedTwoManifold()`** (every edge has 2 opposite-sense mated
  coedges, every loop closes, every coedge dest = next origin). This is an **ACIS-flavoured
  topology graph** — the right foundation.
- **`src/native/brep/Surface.{cpp,hpp}`** — tagged-union analytic surface (Plane/Cylinder/Cone/
  Sphere/Torus + Nurbs fallback) with exact `S(u,v)`, partials, area element, outward normal.
- **`src/native/brep/Boolean.cpp` (57 KB)** — native analytic boolean with **imprint + CDT**
  (`imprintFace`), surface-surface intersection, and a manifold check at stitch time
  (`"analytic stitch: duplicated directed edge (non-manifold)"`, `Boolean.cpp:979-982`). But it
  is **analytic-quadric-only** and bails to the mesh fallback for imprinted sphere/torus.
- `SurfaceIntersect.cpp`, `Fillet.cpp`, `Chamfer.cpp`, `Draft.cpp`, `StepAnalytic.cpp` (read+write
  for the 5 quadrics only — fails honestly at `StepAnalytic.cpp:749` on `B_SPLINE_SURFACE` and
  any non-canonical surface).

### 1.4 Tolerance (the dimensional kind, NOT geometric tolerant modelling)

- **`src/Tolerance.cpp` + `src/native/tolstack/Tolstack.cpp`** — tolerance **stack-up** analysis
  (worst-case / RSS / Monte-Carlo Cp/Cpk/yield). This is **statistical dimensional tolerancing**,
  a completely different thing from ACIS **geometric tolerant modelling** (per-entity geometric
  tolerance attached to topology). **There is NO geometric tolerant-modelling data structure
  anywhere in the native kernel.**

---

## 2. THE GAP vs the target (ACIS tolerant modelling + Parasolid healing)

The honest headline: **for the B-rep, healing/sewing/tolerant-modelling is 0% native** — it is
100% OCCT. The native side is a strong *mesh-soup* repair engine that does not touch B-rep
topology or carry any tolerance attribute. Concrete missing items:

### 2.1 Tolerant modelling (ACIS) — the data-structure gap is total

1. **No per-entity tolerance attribute.** ACIS stores a tolerance on every `VERTEX`/`EDGE`/
   `COEDGE` (tolerant entities: `TVERTEX`, `TEDGE`, `TCOEDGE`). Forge's native `Edge`/`Vertex`/
   `Coedge` (`Topology.hpp`) carry **no `tolerance` field at all**. Without it there is no native
   tolerant modelling — period. This is the single biggest data-structure hole.
2. **No tolerant geometry pairing.** ACIS tolerant edges carry a 3D curve PLUS the two pcurves
   whose mismatch the tolerance bounds; a tolerant vertex bounds the gap between incident edge
   ends. Forge has no concept of "edge whose two pcurve images disagree by ≤ tol."
3. **No fuzzy-boolean native path.** `BooleanTol.cpp` fuzzy boolean is OCCT-only (`SetFuzzyValue`).
   The native `Boolean.cpp` has a single de-dup tolerance constant, **no caller-set fuzz, no
   tolerance propagation onto result entities, no SetFuzzyValue equivalent.**
4. **No tolerant snapping / tolerance assignment / tolerance reduction** (ACIS
   `api_set_entity_tolerance`, tolerant-modelling cleanup that *grows* a vertex tolerance to
   absorb a gap instead of moving geometry). Forge can only *move* geometry (weld), never *widen
   a tolerance to legitimise a gap* — the defining ACIS behaviour.
5. **No tolerance interrogation** (`api_get_entity_tolerance`, per-edge/-vertex tolerance query)
   and no max-tolerance roll-up to the body.

### 2.2 Sewing — native sewing does not exist for B-rep

6. **No native B-rep sewing.** `Sewing.cpp` + `Healing.cpp::sewShape` are OCCT
   `BRepBuilderAPI_Sewing`. There is no native operator that takes a pile of independent native
   `Face`s and stitches shared edges into `coedgeA/coedgeB` mates within a tolerance. The native
   `Topology` *graph* can represent a sewn shell, but nothing *builds* one from loose faces.
7. **No tolerant edge-matching for sewing.** Parasolid/ACIS sewing matches edges whose 3D curves
   are within tol even when endpoints/parameterisations differ; the result may be a *tolerant*
   edge. Forge's native edge-merge (in `mesh/Repair.cpp`) is **mesh vertex-weld only** — it has
   no curve-proximity edge match, no pcurve reconciliation, and produces no B-rep edge.
8. **No non-manifold sewing.** Parasolid sews to non-manifold bodies (3+ faces on an edge) when
   asked; Forge's native `Coedge` model **hard-asserts** on the third use of an edge
   (`Topology.cpp:64` `assert(false && "edge already has two coedges (non-manifold use)")`), and
   `mesh/Repair.cpp:369` returns `ok=false` on any >2-incidence edge. **Non-manifold is
   structurally impossible in the native model today.**
9. **No shell→solid lid logic native** beyond OCCT (`Healing.cpp` uses `BRepBuilderAPI_MakeSolid`).

### 2.3 Healing / gap closure — native covers mesh soup, not B-rep

10. **No native gap closure on B-rep edges.** Parasolid healing closes gaps between faces by
    geometry adjustment OR tolerance growth on real B-rep edges. Forge native only welds mesh
    *vertices*; it cannot close a gap between two analytic faces while keeping them analytic.
11. **No native small-edge / sliver-face removal on B-rep** (ACIS `api_remove_sliver_faces`,
    `api_remove_short_edges`; Parasolid "delete redundant topology"). `mesh/Repair.cpp` drops
    sliver *triangles*; nothing operates on B-rep faces/edges.
12. **No native missing-pcurve / missing-3D-curve regeneration** (`ShapeFix_Edge`,
    `ShapeFix_Wire::FixAddPCurve` / `FixAddCurve3d`). This is a core import-healing step; OCCT-only.
13. **No native face-orientation / shell-orientation healing** on B-rep
    (`harmonizeNormals` is OCCT `ShapeAnalysis_Shell` + `ShapeFix_Solid`). The native mesh
    pipeline orients *triangle* winding, not B-rep `Coedge` sense / shell outwardness.
14. **No native seam/degenerate-edge fixing, no closed-surface seam repair**
    (`ShapeFix_Face`/`FixMissingSeam`). OCCT-only.
15. **No native self-intersection healing on B-rep** (`autoRepairSelfIntersection` is OCCT
    `ShapeFix_Shape`). The native `SelfIntersect.cpp` only *detects* on mesh; it does not heal,
    and does not run on B-rep.
16. **No native `UnifySameDomain` / merge-coplanar-faces / merge-tangent-edges** on B-rep
    (`simplifyShape` is OCCT `ShapeUpgrade_UnifySameDomain`).
17. **No native auto-fill on B-rep.** `autoFillMissingFaces` uses OCCT
    `ShapeAnalysis_FreeBounds` + `BRepOffsetAPI_MakeFilling` (an N-sided NURBS filler Forge does
    not have natively).

### 2.4 Validity checking — native is mesh-only; B-rep checker is OCCT

18. **No native B-rep validator.** `ShapeCheck.cpp` + `Healing.cpp::checkValidity` are OCCT
    `BRepCheck_Analyzer`. The native side validates a `HalfEdgeMesh` (`validate()`) and the
    native `Topology` (`isClosedTwoManifold()`), but there is **no native equivalent of the ~36
    `BRepCheck_Status` predicates** on a geometry-bearing B-rep (InvalidPointOnCurve,
    NoCurveOnSurface, InvalidCurveOnSurface, SelfIntersectingWire, IntersectingWires,
    InvalidImbricationOfWires/Shells, BadOrientation, NotClosed, NotConnected,
    InvalidToleranceValue, EnclosedRegion, …). These need curve/surface/pcurve geometry the native
    `Face` only partially carries.
19. **No native curve/surface consistency checks** (point-on-curve, point-on-surface, curve-on-
    surface deviation) — these require sampling the native curve against its pcurve against the
    surface, which presupposes the tolerance pairing from §2.1.
20. **No native wire self-intersection / wire ordering / wire closure checks** on B-rep loops.
21. **No native interference / clash check** between bodies as a *validity* gate (distinct from
    the boolean). Parasolid `PK_TOPOL_check_clash`; Forge has none native at B-rep level.

### 2.5 Format / round-trip (drives WHICH inputs even reach the healer)

22. **No trimmed-NURBS STEP read native** (`StepAnalytic.cpp:749` honest fail). Per
    `OCCT_ZERO_ROADMAP.md` §5 this is *the* keystone blocker: any real imported part — the exact
    population that *needs* healing — routes to OCCT's `STEPControl_Reader`, which means the
    healing also stays OCCT. **You cannot heal what you cannot read natively.**
23. **No Parasolid-XT / SAT (ACIS) read or write** at all (OCCT itself lacks XT/SAT; so does
    Forge). For 1:1 parity an XT/SAT bridge would be required, but that is out of scope for an
    *in-house* kernel and should be explicitly de-scoped (interop via STEP).

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Guiding rule (Bible §0): **OCCT stays the live default + the A/B oracle for each op until that
op's native replacement passes A/B, then flip a per-op gate; delete OCCT only at the very end
against a frozen golden corpus.** Every increment ships complete (no MVP/stub) and CI-green.
A/B oracles named per step. "Dynamic not static" → every gate runs on generated dirty inputs,
not a fixed snapshot.

> **Ordering note.** Healing/sewing/tolerant-modelling is gated by §2.5#22 (native trimmed-NURBS
> read) for *real-world* inputs, but the native B-rep healing engine itself can be built and
> A/B-proven NOW against OCCT on **synthetic dirty B-reps generated from the existing native
> primitives + booleans** (translate/perturb a face, drop a face, widen a gap). So this plan does
> NOT block on the NURBS keystone; it builds the engine in parallel and lights up on real imports
> the moment §2.5#22 lands.

### Phase H0 — Tolerance data structure (foundation; unblocks everything) — P0

- **H0.1 — Add tolerance to native topology.** Add `double tolerance` to `Vertex`, `Edge`,
  `Coedge` in `Topology.hpp`; default = resolution (e.g. `1e-7`). Add `bodyTolerance()` roll-up.
  Subsystem: `native/brep`. **Verify:** unit test that a fresh box has all-resolution tolerances;
  `isClosedTwoManifold()` unaffected (additive). ~120 LOC.
- **H0.2 — Tolerant entity semantics.** Define "tolerant edge" = edge whose two coedge pcurve
  images (or 3D curve vs pcurve) deviate by ≤ `tolerance`; add `isTolerant()` predicates +
  `setEntityTolerance` / `getEntityTolerance` (ACIS `api_set/get_entity_tolerance`). Subsystem:
  `native/brep`. **Verify:** construct an edge with a controlled pcurve mismatch δ; assert
  `isTolerant()` flips exactly at `tolerance == δ`. No OCCT oracle (this is new capability) →
  known-answer regression. ~250 LOC.

### Phase H1 — Native B-rep validator (the oracle for all healing) — P0

- **H1.1 — Native `BRepCheck` equivalent.** Port the ~36 predicate set onto the geometry-bearing
  native B-rep: structural (NotClosed, NotConnected, FreeEdge, BadOrientation, multi-connexity)
  reuse `Topology::isClosedTwoManifold` machinery; geometric (InvalidPointOnCurve / OnSurface,
  NoCurveOnSurface, InvalidCurveOnSurface, InvalidSameParameter, SelfIntersectingWire,
  IntersectingWires, InvalidTolerance) sample native curves/pcurves/surfaces vs `tolerance`.
  Subsystem: new `native/brep/Check.cpp`. **Verify:** A/B vs OCCT `BRepCheck_Analyzer` /
  `shapecheck.analyse` on a **generated** corpus of N known-bad shapes (each defect injected
  deliberately) — native must flag the same status enum on each. Regression suite, not mass-props.
  ~700 LOC. *Biggest single risk item; do early so every later heal step has a native pass/fail.*

### Phase H2 — Native sewing — P0 (the Parasolid keystone for this area)

- **H2.1 — Native tolerant face sewing.** Given loose native `Face`s, match boundary edges whose
  3D curves are within tol (curve-proximity, not just shared `Vertex*`), merge into one `Edge`
  with two opposite-sense `Coedge`s, growing the merged edge/vertex `tolerance` to absorb the gap
  (the ACIS move). Drive into a `Shell`; lid to `Solid` when closed. Subsystem: new
  `native/brep/Sew.cpp` (reuse `SurfaceIntersect` for curve proximity, `Topology` builder for
  merge). **Verify:** A/B vs OCCT `sewing.sew` / `Healing::sewShape` on generated face-piles
  (explode a native box/cylinder into faces, perturb edges by δ<tol): compare free/multiple/
  contiguous-edge counts **and** topology signature (V/E/F + adjacency hash, per §6 risk) **and**
  closed-volume parity. ~600 LOC.
- **H2.2 — Non-manifold sewing.** Replace the `Topology.cpp:64` hard `assert` with a real
  non-manifold edge representation (an `Edge` owning an ordered fan of `Coedge`s, radial-edge
  proper) **behind a `nonManifold` flag** so manifold paths are byte-identical. Subsystem:
  `native/brep`. **Verify:** sew 3 faces sharing one edge; assert the edge reports 3 coedges and
  the validator marks it non-manifold (matching OCCT's `InvalidMultiConnexity` only when manifold
  was requested). ~400 LOC. *This is the deepest topology change — it touches the core invariant.*

### Phase H3 — Native B-rep healing operators — P1

Each maps 1:1 to an OCCT fixer it A/B-replaces; gate per-op.

- **H3.1 — Orientation healing** (`harmonizeNormals`): native shell coedge-sense + outward-normal
  fix via signed volume on the analytic shell. Oracle: OCCT `ShapeFix_Solid`/`ShapeAnalysis_Shell`.
  ~250 LOC.
- **H3.2 — Gap closure / tolerant snap** (Parasolid heal core): for free edges within tol, either
  snap geometry or grow `tolerance` (H0). Oracle: `ShapeFix_Shape` free-edge reduction +
  `checkValidity` open-edge count. ~400 LOC.
- **H3.3 — Sliver-face + short-edge removal** (`api_remove_sliver_faces`/`short_edges`): native
  Euler `KEF`/`KEV` collapse on B-rep. Oracle: OCCT `ShapeFix_Shape` DONE3 + face/edge counts +
  mass-props invariance. ~350 LOC.
- **H3.4 — Missing pcurve / 3D-curve regeneration** (`ShapeFix_Edge`): project edge curve onto the
  adjacent native surface to build the pcurve (needs §2.5#22 NURBS for non-analytic faces; works
  now on analytic). Oracle: OCCT `ShapeFix_Wire::FixAddPCurve`. ~400 LOC.
- **H3.5 — Merge same-domain faces/edges** (`simplifyShape`): native coplanar/co-quadric face
  merge + tangent-edge merge. Oracle: OCCT `ShapeUpgrade_UnifySameDomain` (face/edge counts +
  mass-props invariance + topology signature). ~450 LOC.
- **H3.6 — Auto-fill missing faces** (`autoFillMissingFaces`): native N-sided fill — analytic plane
  fill now; NURBS Coons/Gordon fill after §2.5#22. Oracle: OCCT `BRepOffsetAPI_MakeFilling` closed-
  volume parity. ~500 LOC (NURBS filler is the heavy part).
- **H3.7 — Self-intersection healing on B-rep** (`autoRepairSelfIntersection`): reuse native
  `SurfaceIntersect` + `SelfIntersect` to locate, then re-imprint/trim. Oracle: OCCT
  `ShapeFix_Shape` DONE6 + validator. ~400 LOC.

### Phase H4 — Native tolerant boolean — P1

- **H4.1 — Fuzzy boolean native.** Thread a caller `fuzz` into `native/brep/Boolean.cpp`'s
  coincidence tolerance + **propagate** result-entity tolerances (tolerant edges where operands
  met within fuzz). Oracle: OCCT `booleantol.{fuse,cut,common}` — vol/COM/inertia/AABB **+
  topology signature** on generated near-coincident operand pairs. ~350 LOC.

### Phase H5 — Promotion / OCCT removal (this area) — P2

- Flip each `heal.*` / `sewing.*` / `shapefix.*` / `shapecheck.*` / `booleantol.*` op to native
  default once its A/B gate is green; **keep OCCT compiled as oracle + fallback.** Only after the
  whole area shows zero runtime OCCT calls under the full generated regression + CADGenBench, and
  a **frozen OCCT golden corpus** exists (§6), delete the OCCT path for this area. P2 / last.

**Rough total native LOC for this area:** ~5,500–6,500 (excluding the shared §2.5#22 trimmed-NURBS
reader, which is a separate keystone tracked in `OCCT_ZERO_ROADMAP.md` W3.1 and feeds H3.4/H3.6).

---

## 4. The single biggest blocker + critical path

**Single biggest blocker (this area): the absence of a per-entity tolerance attribute in the
native B-rep (`Topology.hpp` `Vertex/Edge/Coedge` have no `tolerance`).** Tolerant modelling *is*
that attribute plus the operators that read/grow it; sewing and gap-closure parity with
ACIS/Parasolid both depend on "grow a tolerant edge to absorb a gap" rather than only moving
geometry. Until H0 lands, every native heal op can only *move* points (the mesh-weld paradigm),
which is strictly weaker than ACIS/Parasolid and cannot reach 1:1 parity.

**Cross-area blocker for REAL inputs: native trimmed-NURBS STEP read** (`OCCT_ZERO_ROADMAP.md`
W3.1, `StepAnalytic.cpp:749`). It does not block *building/proving* the native healing engine
(do that on synthetic dirty B-reps from native primitives now), but it blocks the engine from
ever *running natively on real imported parts* — which are the parts that need healing. So it
gates the **value**, not the **construction**.

**Critical path:**
`H0 (tolerance attribute) → H1 (native B-rep validator = the oracle every heal op gates on) →
H2 (native tolerant sewing, incl. the non-manifold topology change H2.2) → H3 (heal operators,
each A/B vs its OCCT fixer) → H4 (fuzzy boolean) → H5 (flip + eventual OCCT delete vs frozen
golden corpus).`
In parallel and converging at H3.4/H3.6: the shared **trimmed-NURBS reader** (W3.1) to unlock
healing on real imports and NURBS auto-fill.

---

## 5. Honest one-line state

For *mesh soup*, Forge has a genuine, 0-fakes native repair engine (`native/mesh/Repair.cpp` +
`HalfEdgeMesh`). For *B-rep healing / sewing / tolerant modelling / validity* — the thing a
practising engineer actually relies on when importing a STEP and closing its gaps — Forge is
**100% OCCT today**, has **no tolerance attribute**, **cannot represent non-manifold**, and has
**no native sewing or gap-closure**; closing that to ACIS/Parasolid parity is the ~6k-LOC
H0→H5 program above, foundationed on the tolerance attribute and the native B-rep validator.
