# Forge Kernel Audit — Exact Predicates + Robust Computational Geometry + Mesh Repair

> AREA: exact-predicate kernels, planar/spatial arrangements, mesh processing/repair.
> TARGET: full industrial 1:1 parity with **CGAL** (exact-predicate & exact-construction
> kernels, `Arrangement_2`, Delaunay/CDT/mesh-2/mesh-3, Polygon_mesh_processing repair).
> GROUND TRUTH: live source at `forge-kernel/src/native/{Predicates.cpp, geom/, mesh/}`
> read 2026-06-24, cross-checked against `OCCT_ZERO_ROADMAP.md`. Bible §0 discipline:
> real impl only, dep stays as oracle until each native op is A/B-proven, CI-green per
> increment, dynamic not static.

---

## 0. TL;DR

Forge's **exact-predicate layer is genuinely real and CGAL-grade in kind** — a
from-scratch Shewchuk adaptive-precision implementation (TwoSum/TwoProduct via FMA,
non-overlapping expansions, static error-bound filter → exact expansion fallback) for
`orient2d / orient3d / incircle / insphere`. It is **actually used** by downstream
robust code (UV flip-audit, hole-fill ear clipping, mesh repair, and the SoS-based mesh
boolean), not a dead library.

The gap to CGAL is therefore **not** the predicate filter — it is everything CGAL builds
*on top* of exact predicates:

1. **No exact-CONSTRUCTION kernel (EPECK).** Every *coordinate* produced by an
   intersection (segment×segment, tri×tri, edge×face) is plain IEEE-754 `double`. The
   code states this honestly ("the honest Manifold/Clipper ceiling, not EPECK",
   `MeshCrossSection.cpp:28`; `Geom.hpp:26`). This is the single biggest structural gap:
   CGAL's reliability comes from exact *constructions*, not just exact *signs*.
2. **No general arrangement engine.** There is no `Arrangement_2` (sweep-line /
   Bentley-Ottmann over line *segments and curves*, DCEL face/edge/vertex incidence,
   point location, overlay, zone). The 2D boolean (`PolygonBoolean2D`) is a
   winding-extraction over polygon loops only — not a general arrangement of arbitrary
   segment/curve sets.
3. **Mesh repair is solid but partial vs PMP.** `repairMesh` does weld + degenerate/dup
   drop + manifold-edge guard + consistent winding + small planar hole fill + outward
   orientation, all gated by a half-edge `validate()`. It is honest (fails rather than
   fakes). But it has **no autonomous self-intersection *resolution*** (only detection),
   **no non-manifold-vertex splitting**, **no curved/large hole filling**, and **no
   isotropic remeshing-grade repair**.
4. **Rich native geometry exists but is mostly NOT bridged to JS.** `delaunay2D`,
   `constrainedDelaunay2D`, `alphaShape3D`, `voronoi3D`, `polygonBoolean2D`,
   `polygonOffset2D`, `convexDecomposition`, `minkowskiSum3D`, `selfIntersect`,
   `insphere` all exist and compile natively — only `repair, orient2d/3d, incircle,
   convexHull2D/3D, meshBoolean` are wired into `binding.cpp`. Large latent capability
   is one bridging layer away from being usable.

**Verdict:** predicate substrate ≈ 90% of CGAL-in-kind; construction/arrangement/PMP
substrate ≈ 25–35%. The predicates are a genuine moat; the path to CGAL parity is
(a) an exact-construction number type, (b) a real `Arrangement_2`, (c) PMP-grade repair,
(d) Delaunay refinement / mesh-2 / mesh-3.

---

## 1. What Forge has TODAY (grounded — files/functions read)

### 1.1 Exact predicates — `src/native/Predicates.cpp` (587 LOC), `include/.../Predicates.hpp`
- **EFT primitives:** `twoSum` (Knuth, branch-free), `twoDiff`, `twoProduct` (FMA-based,
  exact on arm64 hardware FMA — `Predicates.cpp:67`), `growExpansion`,
  `fastExpansionSum` (Shewchuk merge), `scaleExpansion`, `twoProductDifference`,
  `signOfExpansion` (sign = last nonzero component since non-overlapping & sorted).
- **Predicates:** `orient2d` (`:236`), `orient3d` (`:273`), `incircle` (`:321`),
  `insphere` (`:385`) — each: static filter with derived Shewchuk error bounds
  (`o2dErrBoundA`…`isErrBoundA`, `:225`–`:228`) → exact expansion path when the filter is
  inconclusive. `insphere` builds the full 5×5 determinant as expansions up to 4096
  components (`:513`).
- **Honest limits stated in header:** proven-exact only when coordinates are exact
  binary64 and no overflow/denormal-underflow; subnormal-input collapse is a documented
  TODO (`Predicates.hpp:43`–`:50`). This is a *real* limitation vs CGAL's EPECK (which
  scales/normalizes).
- **Validation:** `test/native/predicates_test.cpp` — analytic signs, naive-vs-robust
  near-degenerate contrast, Shewchuk published-sign black-box oracle, antisymmetry.
- **Used by (verified call-sites):** `mesh/Parameterize.cpp:384` (UV orient2d flip
  audit), `mesh/Repair.cpp:192` (point-in-tri + ear clip), `mesh/HoleFill.cpp:73`,
  `mesh/MeshBooleanNative.cpp` (SoS-wrapped orient2d/orient3d), `geom/Geom.cpp` (hulls),
  `geom/Delaunay*.cpp`, `geom/ConstrainedDelaunay2D.cpp`, `Features.cpp:32`.

### 1.2 Native 2D/3D geometry — `src/native/geom/` (19 files, ~8.9k LOC)
- `Delaunay.cpp` (321) — randomized incremental (Lawson) 2D Delaunay, exact `incircle`,
  exact-cocircular handling. Header explicitly lists CDT/refinement/Voronoi/3D/regular as
  *future slices* (`Delaunay.hpp:66`).
- `ConstrainedDelaunay2D.cpp` (1063) — CDT with Anglada strip constraint insertion,
  pseudo-polygon retriangulation, Lawson restore, parity flood for in/out. Real PSLG-ish.
- `Delaunay3D.cpp` (500) — 3D Delaunay (Bowyer-Watson, exact insphere).
- `Voronoi3D.cpp` (529) — 3D Voronoi cells via half-space clipping off the Delaunay dual.
- `AlphaShape3D.cpp` (289) — fixed-α 3D alpha complex / solid alpha shape.
- `PolygonBoolean2D.cpp` (534) — 2D union/intersect/difference/xor by planar
  winding-extraction (Clipper-class, exact predicates, **double coords**).
- `PolygonOffset2D.cpp` (604) — 2D polygon offset.
- `ConvexDecomposition.cpp` (994) — approximate convex decomposition (ACD).
- `MinkowskiSum3D.cpp`, `MinEnclosingSphere.cpp` (Welzl), `OBB.cpp`, `KdTree3D.cpp`,
  `AABBTree.cpp` (626), `PrimitiveFit.cpp`, `PointCloudNormals.cpp`, `Bezier.cpp`,
  `SurfaceIntersect.cpp`, `LineGeometry.cpp`, `Geom.cpp` (convexHull2D Andrew monotone +
  small-set incremental convexHull3D, segmentIntersect).

### 1.3 Mesh processing / repair — `src/native/mesh/` (~47 files)
- `Repair.cpp` (643) — `repairMesh`: clean fast-path (return verbatim if already a valid
  oriented 2-manifold), spatial-hash vertex weld, degenerate/zero-area drop, exact-dup
  face dedup, **>2-faces-per-edge non-manifold guard (honest fail)**, BFS consistent
  winding per component, planar hole fill (Newell plane → ear clip ≤ `maxHoleEdges`),
  global outward orientation, half-edge `validate()` gate. **0-fakes**: returns
  `ok=false` with a reason on anything it can't legitimately fix.
- `MeshBooleanNative.cpp` (1528) — general boundary-crossing mesh boolean, strategy =
  combined-arrangement interior-face removal, with a full **Simulation-of-Simplicity**
  (Edelsbrunner–Mücke ε^(2^i) symbolic perturbation) layer over the exact predicates;
  measured ~99.88% on random general-position cube pairs, honest `ok=false` on
  near-triple-point coordinate slivers (the double-coordinate ceiling).
- `SelfIntersect.cpp` (360) — detect (grid-accelerated + brute-force) tri-tri
  self-intersections with exact relation classification. **Detection only.**
- `HalfEdgeMesh.cpp` (264) — manifold half-edge, `validate()`, `signedVolume()`.
- Plus `HoleFill, Remesh, Decimate, Smooth, Subdivide, Curvature, Offset, Inset, Shell,
  WallThickness, Hausdorff, Geodesic, FeatureEdges, Parameterize, Voxelize, Slice,
  QuadDominant, TopologyStats, Bridge, ProjectSilhouette, TriTriIntersect, MeshBoolean,
  BooleanBVH`.
- Tests: `test/native/mesh/*_test.cpp` (repair, selfintersect, boolean_native, holefill,
  remesh, decimate, parameterize, tritri, …) — a real per-engine gate suite.

### 1.4 JS exposure (`src/binding.cpp`)
Bridged: `repair` (`:15407`), `orient2d/orient3d/incircle` (`:16001`–`:16039`),
`convexHull2D/3D` (`:16050`/`:16077`), `meshBoolean` (`:16215`). **NOT bridged**:
`insphere`, `delaunay2D`, `constrainedDelaunay2D`, `delaunay3D`, `voronoi3D`,
`alphaShape3D`, `polygonBoolean2D`, `polygonOffset2D`, `convexDecomposition`,
`minkowskiSum3D`, `selfIntersect`. Large built-but-dark capability.

---

## 2. The GAP vs CGAL — concrete missing features / data-structures / paradigms

### 2.1 Number types & kernels (the structural keystone)
- **No exact-construction kernel (EPECK / `Exact_predicates_exact_constructions_kernel`).**
  No rational / lazy-exact / interval+bigint number type. Intersection *coordinates* are
  double. CGAL parity for booleans/arrangements/Nef fundamentally requires this — without
  it, cascaded constructions (intersect, then intersect the result) accumulate error and
  the SoS/winding tricks only patch *signs*, never the *coordinates*.
- No **Cartesian/Homogeneous kernel abstraction** (templated on number type); Forge is
  hard-wired to `double`.
- No **interval arithmetic** number type (CGAL's `Interval_nt` filter layer) — Forge's
  filter is per-predicate hand-rolled, not a reusable filtered-kernel.
- No **`Filtered_kernel` / `Lazy_kernel`** paradigm (predicates + constructions sharing a
  filter), nor a `Nef_polyhedron` (exact regularized boolean) for 3D.

### 2.2 2D arrangements (CGAL `Arrangement_2` family) — essentially absent
- **No general `Arrangement_2`**: no DCEL of an arbitrary set of x-monotone curves /
  segments; no **Bentley-Ottmann sweep-line** intersection engine; no half-edge/face/
  vertex incidence over a planar subdivision of curves.
- No **point location** (naive / walk / landmark / trapezoidal-RIC) on an arrangement.
- No **overlay** of two arrangements with a result-decorator.
- No **zone / batched insertion / incremental insertion** of curves.
- No curved traits: **no arrangements of circular arcs, conics, Bézier, rational
  functions, polylines** — CGAL ships all of these as traits classes.
- `PolygonBoolean2D` covers only the *polygon-set boolean* subset (Clipper-class) and
  only for non-self-intersecting loop inputs (refuses self-intersecting — `ok=false`).

### 2.3 Triangulations & meshing (CGAL `Triangulation_2/3`, `Mesh_2`, `Mesh_3`)
- **No Delaunay refinement / quality meshing** (Ruppert, Chew) — explicitly deferred
  (`Delaunay.hpp:68`). No angle/size criteria, no Steiner-point insertion to bound min
  angle, no conforming Delaunay.
- **No `Mesh_2`** (2D mesh generator with seeds/holes/criteria) and **no `Mesh_3`**
  (3D Delaunay refinement tetrahedral mesher with sizing fields, protecting balls,
  feature preservation, optimization: Lloyd/ODT/perturb/exude). FeaTet has Bowyer-Watson
  but no quality-driven refinement loop (per `OCCT_ZERO_ROADMAP.md` W3.8).
- **No regular (weighted / power) triangulation** and **no weighted/power Voronoi
  (Laguerre)** — only the unweighted Voronoi.
- **No `Triangulation_data_structure` with incremental flips + point removal + vertex
  move** as a reusable container (each Delaunay variant has its own local mesh struct).
- No **periodic** triangulations, no **hyperbolic**, no **constrained-triangulation
  hierarchy** (CGAL's `Triangulation_hierarchy_2` for O(log n) location).

### 2.4 Polygon mesh processing / repair (CGAL `Polygon_mesh_processing`)
- **Self-intersection: detect-only.** No autonomous *removal/resolution*
  (`PMP::experimental::remove_self_intersections`, or a robust co-refine-and-extract).
- **No non-manifold-vertex/edge repair by duplication/splitting**
  (`PMP::duplicate_non_manifold_vertices`) — Forge fails honestly on >2-face edges
  instead of splitting/repairing them.
- **Hole filling is planar ear-clip only.** No 3D **triangulate-refine-fair** hole
  filling (CGAL's `triangulate_refine_and_fair_hole` with Liepa refinement + bi-Laplacian
  fairing) for curved/large holes; large/non-planar holes are left open.
- No **`PMP::corefine`** (corefine two meshes producing the shared cut as an exact
  sub-structure) decoupled from the boolean — the boolean is monolithic.
- No **`PMP::clip`** by a plane/mesh as a first-class op; no **`PMP::stitch_borders`** as
  a topological border-stitch (weld is positional only).
- No **isotropic remeshing to target edge length with feature-edge preservation** as a
  *repair* tool (a `Remesh.cpp` exists but its parity/quality vs CGAL is unverified here).
- No **`PMP::repair_polygon_soup`** orientation/combinatorial-repair that handles
  *non-manifold soups* (Forge's repair bails on non-manifold).
- No **shape/quality measures suite** (`PMP::face_area/edge_length/angles` as a coherent
  API) nor **`does_bound_a_volume`** style validators beyond `validate()`+`signedVolume`.

### 2.5 Other CGAL pillars in this area (absent or partial)
- No **2D/3D `Alpha_wrap`** (the watertight surface-wrapping that CGAL ships for repair
  of bad input) — distinct from the fixed-α alpha *shape* present.
- No **2D Minkowski sums / offset of polygons with holes via convolution** (CGAL's exact
  convolution-based offset); `PolygonOffset2D` is a straight offset, robustness vs CGAL
  unverified.
- No **3D convex hull for large sets** — `convexHull3D` is documented "for small point
  sets" (`Geom.cpp:232`); no Quickhull/divide-and-conquer with conflict graph.
- No **`Surface_mesh` / `Polyhedron_3` halfedge data structure with properties** as a
  general container (Forge's `HalfEdgeMesh` is fixed-purpose, not a property-mapped HDS).
- No **straight skeleton** (CGAL `Straight_skeleton_2`), **2D segment Voronoi / medial
  axis**, **principal-component / bounding-volume suite parity**, **AABB tree as a
  templated generic** (one exists but not generic over primitive type/traits).

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Discipline: each step ships real impl (no MVP/stub), keeps the existing dep/oracle until
A/B-proven, lands CI-green, and validates *dynamically* (randomized fuzz + named oracle),
not static fixtures only. Oracle = CGAL where licensing permits *as an out-of-tree
reference harness only*; otherwise a frozen golden corpus + cross-check against the naive
path on non-degenerate inputs.

> Note: the predicate layer needs almost nothing — it is already CGAL-in-kind. The plan
> is dominated by *constructions, arrangements, meshing, and PMP repair*.

### Phase A — Harvest existing dark capability + close predicate gaps (days, P0)
- **A1. Bridge the built geom engines to JS** (`binding.cpp`): expose `insphere`,
  `delaunay2D`, `constrainedDelaunay2D`, `delaunay3D`, `voronoi3D`, `alphaShape3D`,
  `polygonBoolean2D`, `polygonOffset2D`, `convexDecomposition`, `minkowskiSum3D`,
  `selfIntersect`. *Verify:* round-trip each through its existing native gate via JS;
  A/B vs the native test result. ~400 LOC binding.
- **A2. Denormal-safe predicate pre-scale** (close the documented subnormal TODO,
  `Predicates.hpp:43`): sign-invariant common power-of-two scaling of inputs into the
  normal range. *Verify:* extend `predicates_test.cpp` with a subnormal battery; assert
  robust==exact-rational oracle. ~120 LOC.
- **A3. Predicate fuzz harness** (dynamic): random + adversarial near-degenerate point
  generator, cross-check `orient*/incircle/insphere` against a bignum/rational oracle
  computed offline. *Verify:* 0 sign disagreements over ≥10M cases. ~300 LOC test-only.

### Phase B — Exact-construction number type (the keystone, P0) (1–2 wks)
- **B1. `ExactReal` lazy-exact number** (interval + on-demand exact via bigint rationals;
  CGAL `Lazy_exact_nt` paradigm) — header-only, pure C++20, no GMP (in-house bigint).
  *Verify:* arithmetic identity fuzz vs `long double`/rational reference; sign agreement
  with `ExactReal::sign()` on ≥10M random expressions.
- **B2. `segmentIntersect` exact construction** returning an `ExactReal` point that
  re-intersects *exactly* (idempotent under re-query). Keep the double-returning path as
  the fast default behind a flag; A/B the two. *Verify:* cascade test — intersect, feed
  result back, assert the exact path is stable where double drifts. ~250 LOC.
- **B3. Tri-tri / edge-face exact construction** for the mesh boolean cut points. Wire it
  behind `FORGE_EXACT_CONSTRUCT`; rerun the `MeshBooleanNative` gate. *Verify:* the
  ~0.12% honest-fail sliver rate on random cube pairs should drop toward 0; assert closed
  2-manifold + exact volume on the previously-failing seeds. ~400 LOC.
  → **This is the increment that lifts the boolean off its double-coordinate ceiling.**

### Phase C — General 2D arrangement (`Arrangement_2`-class, P1) (2–3 wks)
- **C1. DCEL container** (vertex/half-edge/face with incidence + face nesting). ~600 LOC.
- **C2. Bentley-Ottmann sweep** over line segments using exact predicates + B1 exact
  intersection points → build the segment arrangement. *Verify:* Euler formula
  (V−E+F=1+C) on random segment sets; A/B face/edge/vertex counts vs an offline CGAL
  `Arrangement_2<Segment>` reference on a fixed corpus. ~900 LOC.
- **C3. Point location** (start with walk + trapezoidal-RIC). *Verify:* query points vs
  brute-force containment. ~500 LOC.
- **C4. Overlay** of two arrangements + result decorator → re-implement `PolygonBoolean2D`
  and `PolygonOffset2D` *on top of* the arrangement (now self-intersecting inputs become
  legal). *Verify:* A/B net-area & loop topology vs current `PolygonBoolean2D` on its gate
  corpus; superset on self-intersecting inputs. ~500 LOC.
- **C5. Circular-arc + polyline traits** (the two CAD-relevant curved traits). *Verify:*
  arc-arc / arc-segment intersection vs analytic oracle. ~700 LOC.

### Phase D — Triangulation & meshing parity (`Mesh_2`/`Mesh_3`, P1) (3–4 wks)
- **D1. Reusable `TriangulationDataStructure`** (incremental insert/remove/flip/move,
  vertex hierarchy for O(log n) location). Refactor the 3 existing Delaunay variants onto
  it. *Verify:* empty-circle/empty-sphere invariant fuzz; topology unchanged vs old code.
- **D2. Conforming + constrained Delaunay** consolidation (promote
  `ConstrainedDelaunay2D` onto D1, add conforming Steiner insertion). *Verify:* all
  constraints present as edges; Delaunay-of-the-rest.
- **D3. `Mesh_2` Ruppert/Chew refinement** (min-angle/size criteria, seed-driven hole
  handling). *Verify:* min-angle bound met; termination; A/B element-quality histogram vs
  CGAL `Mesh_2` reference corpus.
- **D4. Regular (weighted) triangulation + power Voronoi (Laguerre)**, reusing exact
  `insphere`-weighted predicate. *Verify:* power-empty-ball invariant.
- **D5. `Mesh_3` Delaunay-refinement tet mesher** (sizing field, protecting balls,
  Lloyd/ODT/exude optimization, feature preservation). Replaces FeaTet's un-refined
  Bowyer-Watson (`OCCT_ZERO_ROADMAP.md` W3.8). *Verify:* radius-edge bound, dihedral-angle
  histogram, A/B vs CGAL `Mesh_3` on a sphere/box/feature corpus. (Largest single block.)

### Phase E — PMP-grade repair (P1) (2–3 wks)
- **E1. Self-intersection *resolution*** on top of `SelfIntersect` detection: local
  co-refine + remove, using B1 exact constructions. *Verify:* `selfIntersect` count → 0
  on the repaired mesh; volume/topology sanity; A/B vs CGAL
  `remove_self_intersections` on a corpus of self-intersecting parts.
- **E2. Non-manifold-vertex/edge duplication-split** (`PMP::duplicate_non_manifold_*`):
  promote Repair's honest-fail >2-face-edge case into an actual repair. *Verify:*
  resulting mesh is manifold; component count preserved/explained.
- **E3. Triangulate-refine-fair 3D hole filling** (Liepa refinement + bi-Laplacian
  fairing) replacing planar ear-clip for curved/large holes. *Verify:* watertight after
  fill; fairness energy reduction; A/B vs CGAL `triangulate_refine_and_fair_hole`.
- **E4. `corefine` + `clip` + `stitch_borders`** as first-class ops (decouple from the
  monolithic boolean). *Verify:* corefine idempotence; clip-volume vs analytic;
  stitch yields fewer border edges with unchanged geometry.
- **E5. `repair_polygon_soup` for non-manifold soups** + `Alpha_wrap` watertight wrapper
  for hopeless input. *Verify:* wrap is closed/manifold and within Hausdorff ε of input.

### Phase F — Convex hull + remaining pillars (P2)
- **F1. Quickhull 3D** (large sets, conflict graph) replacing the small-set incremental
  hull. *Verify:* every input point inside/on hull (exact orient3d); A/B facet count vs
  reference.
- **F2. Straight skeleton 2D**, 2D segment-Voronoi / medial axis, exact convolution-based
  2D Minkowski offset. *Verify:* per-op analytic / reference oracle.

---

## 4. The single biggest blocker + critical path

**Biggest blocker: the absence of an exact-CONSTRUCTION number type (EPECK-class).**
Forge's robustness today is *exact signs over double coordinates*. CGAL's defining
property is *exact coordinates* — every constructed intersection point is exact, so
cascaded operations (arrangement overlay, repeated boolean, corefine, Nef) stay correct
indefinitely. Without it:
- the mesh boolean keeps its honest ~0.12% near-triple-point failure ceiling (a
  *coordinate* problem SoS cannot fix — stated at `MeshBooleanNative.cpp:30`);
- a true `Arrangement_2` cannot be built robustly (sweep-line needs exact intersection
  points to maintain the status structure across events);
- PMP corefine/self-intersection-removal cannot be made exact.

**Critical path:**
`B1 ExactReal (lazy-exact number)` → `B2/B3 exact intersection constructions` →
`C1/C2 DCEL + Bentley-Ottmann arrangement` → `C4 boolean/offset rebuilt on arrangement`
→ `E1/E4 PMP corefine + self-intersection resolution` → `D5 Mesh_3`.
Everything downstream (general arrangements, exact 2D booleans on arbitrary input, robust
corefine, watertight repair, quality tet meshing) is gated by **B1**.

**Sequencing note (Bible §0):** start Phase A immediately (pure harvest + the documented
subnormal fix — low risk, ships value now and exposes the dark engines). Phase B is the
real investment and must precede C/E. The existing double-coordinate paths stay as the
fast default and A/B oracle until each exact path is proven; the dep/golden-corpus is
frozen before any path is removed.

---

## Appendix — rough scale

- Existing native substrate already in tree (predicates + geom + key mesh repair/boolean):
  **~14.2k LOC** (`geom/*.cpp` + `Predicates.cpp` + `Repair/SelfIntersect/MeshBooleanNative/
  HoleFill/Remesh/Decimate.cpp`).
- New work to reach CGAL parity in this area: **~9–13k LOC** of new native code
  (B≈1.5k, C≈3.2k, D≈4k, E≈2.5k, F≈1.2k) + ~0.8k binding/test, concentrated in the
  exact-number type, the arrangement engine, and `Mesh_3`.
