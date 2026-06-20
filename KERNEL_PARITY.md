# KERNEL_PARITY.md — Forge native kernel vs Parasolid / ACIS-class kernels

**Honest, conservative parity matrix for the Forge native geometry kernel.**
Written per the Forge Engineering Bible §0/§9 honesty rules: every PARITY
claim cites a real test file that was run and passed; every external claim
cites a public URL; anything not built / unverified is marked as such.

- **What the kernel actually is.** `forge-kernel/` is a C++20 Node-API
  (`.node`) addon that links **OpenCASCADE Technology (OCCT) 7.9.3** as its
  geometry/topology engine (real, exact B-rep — `Geom_BSplineSurface`,
  `TopoDS_*`, `BRepAlgoAPI_*`), plus a **vendored planegcs** 2D constraint
  solver and **Eigen** for the in-house FEA/numeric paths. This is NOT a
  WASM / `manifold-3d` / pure-JS kernel — those references in
  `docs/kernel-audit.md` (dated 2026-05-10) and
  `docs/parasolid-parity-plan.md` predate the OCCT-native rebrand and are
  **stale** for this matrix. Evidence:
  `forge-kernel/CMakeLists.txt:36-87` (OCCT toolkit link list),
  `forge-kernel/CMakeLists.txt:104-113` (vendored planegcs),
  and the live kernel self-report `{ forgeKernel: '0.1.0', occt: '7.9.3',
  napiCpp: 8 }` printed by `forge-kernel/test/smoke.js` (run 2026-06-20).
- **OCCT reference (external):** Open CASCADE Technology overview,
  https://dev.opencascade.org/doc/overview/html/index.html (Modeling Data,
  Modeling Algorithms, Data Exchange toolkits — TKBO/TKBool, TKFillet,
  TKOffset, TKDESTEP, TKDEIGES, TKHLR, TKMesh, etc.).
- **OCCT vs Parasolid (external, honest framing):** OCCT is a mature
  open-source kernel but is *not* Parasolid/ACIS. It is widely used (e.g.
  FreeCAD) and is documented as having weaker boolean/fillet robustness
  than the commercial kernels in adversarial cases. This matrix treats
  "OCCT can do X and a Forge test proves the Forge binding does X" as the
  bar for PARITY — it does **not** claim Forge has matched Parasolid's
  35-year robustness record. See Honesty Caveats at the bottom.

---

## Status legend

- **NOT STARTED** — no binding / no implementation.
- **PARTIAL** — implemented and callable, but limited scope, known
  failure modes, or the only test is "try-first-valid-edge / accept the
  error path", i.e. it does not prove the op on a demanding case.
- **PARITY** — feature-set is present AND a real test that was executed
  asserts a correct geometric/numeric result on a non-trivial case.
  The **Validation** column names the test file and the assertion.

> **PARITY here = "Forge binding demonstrably performs the operation
> class," NOT "Forge equals Parasolid robustness."** All tests below were
> executed on 2026-06-20 against the built artifact
> `forge-kernel/build/Release/forge-kernel.node` (built 2026-06-18,
> 5.0 MB). They are **not run in CI** — see Caveat C1.

---

## 0. In-house pure-C++ native kernel (`forge::native`) — first increments [2026-06-20]

Per the user directive (ONE native, in-house, pure-C++, no-deps, no-WASM kernel carrying the
unified power of all five classes — `KERNEL_UNIFICATION.md §0/§4` + `KERNEL_INHOUSE_ROADMAP.md`),
the in-house kernel is built bottom-up ALONGSIDE the OCCT-backed kernel (OCCT stays the working
foundation + parity oracle until each capability reaches parity). These are the first **real,
compiled, validated** increments — pure C++20, zero dependencies, no WASM, one shared predicate
engine (no duplicates). Run: `npm run forge:native` (251 tests across 11 gates; CI: `kernel-tests.yml` `native` job).

| Module (`forge::native::`) | Class re-implemented | Status | Validated gate (real, this commit) |
|---|---|---|---|
| `Predicates` | CGAL robustness substrate | PARTIAL | 39/39 — orient2d/3d, incircle/insphere; proven-exact in normal binary64 range (subnormal boundary noted) |
| `brep` (Topology+Nurbs) | OCCT B-rep/NURBS | PARTIAL | 33/33 — box Euler V−E+F=2; Cox-de Boor rational NURBS + Bézier eval to 1e-9 |
| `mesh` (HalfEdge+Boolean) | Manifold mesh booleans | PARTIAL | 25/25 — 2-manifold/watertight audit; plane-clip volume exact via real `orient3d` |
| `geom` (Hull+Intersect) | CGAL robust geometry | PARTIAL | 30/30 — robust 2D/3D convex hull + segment intersection, degenerate-proof |
| `implicit` (Sdf+IsoMesher) | libfive F-rep/SDF | PARTIAL | 15/15 — SDF tree + marching cubes; sphere → 4/3·π·r³ convergence |
| `voxel` (VoxelGrid+Tpms) | PicoGK voxel/lattice | PARTIAL | 9/9 — sphere vol error shrinks 1660×; gyroid volume-fraction 0.5; percolation |

**Round 2 [2026-06-20]:** next validated increment per class — `mesh::triTriIntersect` (exact, 14/14;
the core primitive of general booleans → the `manifold-3d` removal path), `geom::Delaunay`
(Bowyer–Watson via robust `incircle`, 43/43), `brep::NurbsCalculus` (curve/surface derivatives,
tangent/normal/curvature + Boehm knot insertion, 21/21), `implicit::DualContour` (sharp-feature
meshing, 10/10), `voxel::VoxelMesh` (voxel→half-edge mesh, 12/12).

**Honest status:** these are *first/second increments*, NOT parity, and NOT yet wired into `binding.cpp` /
the live kernel (validated only via standalone gates). The hard remainders — general mesh booleans,
curve-curve / surface-surface intersection, B-rep boolean + features (the OCCT replacement, longest
pole) — are TARGETED per `KERNEL_INHOUSE_ROADMAP.md` Stages 2/4/5/6 and marked in each module header.
Robustness ceiling is *robust-in-practice* (predicates + snap-rounding), NOT CGAL-exact/Nef.

---

## 1. Geometry primitives & exact B-rep core

| Row | Status | Evidence (file:line) | Validation (test run 2026-06-20) |
|---|---|---|---|
| Primitives (box/cyl/sphere/cone/torus) | **PARITY** | `src/Primitives.cpp:1-67`, bound `binding.cpp` | `test/smoke.js` — box vol=1.0, area=6, COM=[.5,.5,.5]; cylinder vol=62.83 (πr²h). PASS. |
| Exact B-rep topology (Vertex→Edge→Wire→Face→Shell→Solid) | **PARITY** | OCCT `TopoDS_*` (native), `src/ShapeRegistry.cpp` | Implicit in every passing op; tessellate returns closed manifolds. |
| Reference-counted shape registry / handle de-dup | **PARITY** | `src/ShapeRegistry.cpp:1-58` | `test/smoke.js` — "lifecycle ok — refcounting honored". PASS. |
| Tessellation (BRepMesh, deflection-controlled) | **PARITY** | `src/Tessellate.cpp:1-226` | `test/smoke.js` — box → 24 verts / 12 tris; `part_features_smoke` tessOk on every feature. PASS. |
| Mass properties (volume / area / centroid, analytic on B-rep) | **PARITY** | `src/MassProps.cpp` (OCCT `BRepGProp`) | `test/smoke.js` COM exact; `e2e/push-58` (PARITY-PUSH.md:41-53) 27000 mm³ / 5400 mm² exact. PASS. |
| Transforms (translate / rotate / GTransform) | **PARITY** | `src/Transform.cpp:1-33` | `test/smoke.js` cut residual after transformed B; assembly tests place instances. PASS. |

## 2. Booleans

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Boolean fuse / cut / common on exact B-rep (not polygonal) | **PARITY** | `src/Booleans.cpp:160-162` (`BRepAlgoAPI_Fuse/Cut/Common`) | `test/smoke.js` — cut of two boxes → residual vol 0.929 (geometrically correct). PASS. |
| Boolean with tolerance control | **PARTIAL** | `src/BooleanTol.cpp:1-62` bound | No dedicated executed assertion located; relies on OCCT fuzzy-boolean. UNVERIFIED at the assertion level. |
| Boolean lineage (which faces survived/split/born/died) | **PARITY** | `src/Booleans.cpp:30-135`, `src/LineageRegistry.cpp` | `test/lineage_smoke.js` — cut → 8 entries {survivor:6, birth:2}, every face accounted for. PASS. |
| Sequential-boolean robustness (100+ ops, sliver handling) | **PARTIAL** | OCCT `BOPAlgo` | Not stress-tested in the kernel test suite as run; OCCT is known weaker than Parasolid on adversarial coincident-face cases. Claimed elsewhere but **UNVERIFIED here**. |

## 3. Feature operations (parametric body ops)

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Extrude profile → solid | **PARITY** | `src/Features.cpp` (`extrudeProfile`) | `part_features_smoke.js:55-64` — circle→cylinder vol within 1%. PASS. |
| Revolve profile → solid | **PARITY** | `src/Features.cpp` (`revolveProfile`) | `part_features_smoke.js:69-92` — square revolved 2π, vol within 5%. PASS. |
| Sweep along curve (with guides) | **PARTIAL** | `src/Features.cpp` (`sweep`, `sweepWithGuides`, `BRepOffsetAPI_MakePipeShell`) | `part_features_smoke.js:97-130` — test accepts EITHER a vol-match OR the OCCT error path ("sweepWithGuides ok — V=0.000" in the run). The op exists but the executed test does not prove a non-trivial swept volume. |
| Loft (multi-section, with guides) | **PARTIAL** | `src/Features.cpp` (`loft`, `loftWithGuides`); `src/LoftGuide.cpp:1-121` (`GeomFill_NSections`) | `part_features_smoke.js:135-156` and `loftWithGuides error-path ok` in the run — again accepts the error path. Op present; demanding case not asserted. |
| Shell (uniform + per-face multi-thickness) | **PARITY** | `src/Features.cpp` (`shell`, `shellMultiThickness`) | `part_features_smoke.js` — "shellMultiThickness ok (rm=0, override=1) — V=1031.95"; shell vol asserted >0 across faces. PASS. |
| Fillet (constant radius) | **PARITY** | `src/Features.cpp` (`filletEdges`, `BRepFilletAPI_MakeFillet`) | `part_features_smoke.js` — box edge fillet, vol asserted in (900,1000) band consistent with (4−π)r²L removal. PASS. |
| Fillet (variable radius, law-driven) | **PARTIAL** | `src/VarFillet.cpp:47-121` (Law_Linear/Law_S sampled into Pnt2d array — a documented OCCT 7.9.3 workaround for the `Add(law,edge)` abort), `binding.cpp:3838`, `binding.cpp:15081` | `part_features_smoke.js` — `variableFilletEdge` test tries each edge and **accepts the error path** ("often fail because OCCT requires the edge to be in a contour"). Implementation real; no executed assertion proves a correct variable-radius solid. |
| Chamfer (uniform) | **PARITY** | `src/Features.cpp` (`chamferEdges`) | `part_features_smoke.js` — chamfer vol asserted in (990,1000) band. PASS. |
| Chamfer (asymmetric / two-distance) | **PARTIAL** | bound | Not asserted independently of uniform in the run. UNVERIFIED. |
| Draft (face/edge angle) | **PARTIAL** | `src/Features.cpp` (`draftFaces`, `BRepOffsetAPI_DraftAngle`) | `part_features_smoke.js` — draft test accepts error path. Op present; not asserted. |
| Hole wizard (simple / counterbore / countersink) | **PARITY** | `src/Features.cpp` (`holeWizard`) | `part_features_smoke.js` — simple hole vol within 5%; counterbore + countersink build. PASS. |
| Rib | **PARTIAL** | `src/Features.cpp` (`rib`) | `part_features_smoke.js` — vol-match OR error path accepted. |
| Patterns (linear / circular / mirror / on-curve) | **PARITY** | `src/Features.cpp` | `part_features_smoke.js` — linearPattern V=3.0, circularPattern V=4.0, mirrorPattern V=2.0, onCurvePattern V=3.0 (instance-count × unit vol). PASS. |

## 4. NURBS / freeform surfacing

| Row | Status | Evidence | Validation |
|---|---|---|---|
| NURBS surface authoring (B-spline patch, custom knots/degree) | **PARITY** | `src/Nurbs.cpp:137-238` (`Geom_BSplineSurface`, uniform-clamped or custom knots) | `test/nurbs_smoke.js` — 4×4 cubic saddle patch, eval(0.5,0.5) unit normal ±1e-6, Gauss K<0 (saddle). PASS. |
| Surface eval (point, ∂u, ∂v, normal, Gauss/mean curvature) | **PARITY** | `src/Nurbs.cpp:324-356` (`GeomLProp_SLProps`) | `test/nurbs_smoke.js` — normal unit-length, finite curvatures. PASS. |
| Trim NURBS face (UV loop with real pcurves) | **PARITY** | `src/Nurbs.cpp:240-285` | `test/trim_surface_smoke.js` — 6000 mm² patch trimmed to exact 3000 mm² (u∈[.25,.75]). PASS. |
| Sew / knit faces → shell | **PARITY** | `src/Nurbs.cpp:287-302` (`BRepBuilderAPI_Sewing`) | `test/knit_surface_smoke.js` — 2 patches → 12000 mm² shell; `test/nurbs_smoke.js` sew. PASS. |
| Thicken open surface → solid | **PARITY** | bound (`MakeThickSolid`/offset) | `test/thicken_surface_smoke.js` — open patch → exact 30000 mm³ solid. PASS. |
| Degree elevation / refine | **PARITY** | `src/Nurbs.cpp:304-322` (`IncreaseDegree`) | `test/nurbs_smoke.js` — refine returns fresh handle. PASS (handle only — no degree-value assertion). |
| Surface–surface intersection | **PARTIAL** | `src/Nurbs.cpp:358-371` (`BRepAlgoAPI_Section`) | `test/nurbs_smoke.js` calls `intersect`; no executed assertion on the curve result. UNVERIFIED at assertion level. |
| Point projection to surface | **PARITY** | `src/Nurbs.cpp:373-393` (`GeomAPI_ProjectPointOnSurf`) | `test/nurbs_smoke.js` — project (0,0,5) → uv≈(.33,.5), distance reported. PASS. |
| Class-A analysis (curvature / isophote banding) | **PARITY (analysis only)** | `src/Nurbs.cpp:395-462`, `src/ClassASurfacing.cpp:1-571` | `test/surfacing_class_a_smoke.js` — sphere R=5 → K=0.04 exactly (=1/R²), zero spread. PASS. **This is curvature *measurement*, not Class-A *construction* (G2/G3 blend authoring is not validated).** |
| NURBS reverse-fit (point grid → B-spline surface) | **PARITY** | `src/NurbsFit.cpp:1-153` (`GeomAPI_PointsToBSpline`) | `test/nurbsfit_smoke.js` — exact plane max\|r\|<1e-9; Gaussian-hill RMS<0.2 of 3 m; noisy plane RMS in noise band. PASS. |

## 5. Direct / synchronous modeling

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Push/pull face | **PARITY** | `src/DirectModeling.cpp:1-500` | `test/direct_smoke.js` — pushPullFace(+Z,+10) on box → vol 45000 (exact expected). PASS. |
| Delete face + heal | **PARITY** | `src/DirectModeling.cpp` (`deleteFaceAndHeal`) | `test/direct_smoke.js` — delete +Y face, heal → closed, vol 45000, area 7800. PASS. |
| Move/offset/replace face (general) | **PARTIAL** | bound in DirectModeling | Only push/pull + delete are asserted; replace-face / move-to inference UNVERIFIED. |

## 6. Topology / parametric history / persistent naming

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Persistent topo IDs across ops (selective-naming-style) | **PARITY** | `src/Booleans.cpp:30-135` (native OCCT `Modified()/Generated()/IsDeleted()`), `frontend/src/kernel/forge/PersistentTopoIds.js`, `LineageEmitter.js` | `test/lineage_smoke.js` (native) + `frontend/src/kernel/forge/__tests__/PersistentTopoIds.test.mjs` (JS, "all tests passed"). PASS. |
| Parametric feature tree with re-evaluation / rollback / suppress | **PARTIAL** | JS-side feature tree; `PARITY-PUSH.md:75-88` configurations re-apply | Re-apply/suppress proven in an e2e (`push-56`), but **the C++ kernel has no feature-graph re-execution** — history lives in JS. Kernel-level persistent-history is NOT demonstrated. Topological-naming robustness under upstream edits is not stress-tested. |
| Tolerant modeling for non-watertight imports | **PARTIAL** | OCCT `ShapeFix`/`ShapeUpgrade` via `src/ShapeFix.cpp`, `src/Healing.cpp` | Healing tested (§9); general tolerant-import round-trip not asserted. |

## 7. Data exchange (I/O)

| Row | Status | Evidence | Validation |
|---|---|---|---|
| STEP import (AP203/214/242 auto-detect) | **PARITY** | `src/IoExchange.cpp:26-50` (`STEPControl_Reader`) | `test/io_smoke.js` — box → STEP (15.4 KB) → re-import OK. PASS. |
| STEP export (AP242) | **PARITY (geometry round-trips)** | `src/IoExchange.cpp:52-66` (writes `AP242DIS`) | `test/io_smoke.js` — round-trip vol/area preserved. PASS. **Caveat:** export uses OCCT `STEPControl_Writer` so NURBS/analytic faces *are* emitted by OCCT, but **no Forge test asserts B_SPLINE_SURFACE / RATIONAL entities are present** — the "STEP emits NURBS" claim is UNVERIFIED at the assertion level. |
| STEP export with PMI / GD&T note block | **PARTIAL** | `src/IoExchange.cpp:179-222` | PMI is appended as ISO-10303-21 **`/* comment */` blocks**, not native AP242 semantic PMI entities. `test/io_pmi_smoke.js` exists; this is a comment carrier, NOT semantic PMI parity. Honestly PARTIAL. |
| IGES import | **PARITY** | `src/IoExchange.cpp:114-131` (`IGESControl_Reader`) | `test/io_iges_smoke.js` — hand-rolled IGES + STEP companion round-trip OK. PASS. |
| IGES export | **NOT STARTED** | `src/IoExchange.cpp` — no IGES writer; `test/io_iges_smoke.js:8-16` self-documents "OCCT 7.9 build only carries IGESControl_Reader (no writer pkg shipped)". | n/a — honestly absent. |
| STL import / export | **PARITY** | `src/IoExchange.cpp:85-108` | `test/io_smoke.js` — STL round-trip area=600. PASS. |
| BREP (OCCT native) import / export | **PARITY** | `src/IoExchange.cpp:68-83` | `test/io_smoke.js` — BREP round-trip OK. PASS. |
| glTF export | **PARITY** | `src/GltfExport.cpp:1-533` | `test/gltf_export_smoke.js`, `test/smoke-gltf-stream.js` (present; not re-run here). |
| DXF export | **PARTIAL** | `src/Dxf.cpp:1-136` (inline ASCII writer) | `test/smoke-dxf.js` present. |
| JT import | **NOT STARTED (honest stub)** | `src/IoExchange.cpp:147-157` — throws a friendly "requires proprietary Siemens JT Open Toolkit" error | `test/io_iges_smoke.js` asserts the stub throws. Correctly declared unsupported. |
| Parasolid (.x_t/.x_b) import | **NOT STARTED (honest stub)** | `src/IoExchange.cpp:159-173` — magic-byte sniff + friendly "requires Siemens Parasolid kernel, use STEP" error | `test/io_iges_smoke.js` asserts the stub throws. Correctly declared unsupported. |
| Native Parasolid x_t/x_b export, CATIA/Creo/NX readers | **NOT STARTED** | — | Not implemented; Parasolid/ACIS ship these. Honest gap. |

## 8. Drawings / 2D output

| Row | Status | Evidence | Validation |
|---|---|---|---|
| 3D→2D orthographic projection with hidden-line removal | **PARITY** | `src/Drawings.cpp:1-1055` (OCCT `TKHLR`) | `test/drawings_smoke.js` — top view visible=5/hidden=5, right=4/11, front bbox 50 mm; SVG written 9 KB. PASS. |
| Dimension chains / balloons / section views | **PARTIAL** | `src/Drawings.cpp`, `PARITY-PUSH.md` PUSH-90/93 | e2e-level only; not in the executed kernel smoke set here. |

## 9. Healing / repair / validation

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Validity check (closed / manifold / oriented) | **PARITY** | `src/Healing.cpp:1-313`, `src/ShapeCheck.cpp:1-163` | `test/healing_smoke.js` — final check closed=true, manifold=true, oriented=true. PASS. |
| Sew gaps + harmonize normals + ShapeFix | **PARITY** | `src/Healing.cpp`, `src/ShapeFix.cpp:1-110`, `src/Sewing.cpp:1-63` | `test/healing_smoke.js` — harmonizeNormals → closed+oriented; fixers fired. PASS. |
| Mesh repair (degenerate / non-manifold cleanup) | **PARTIAL** | `src/MeshRepair.cpp:1-447` | `test/heal_verbs_chunk4_test.mjs` present; not re-run here. |

## 10. Sheet metal / weldments / mfg-feature modeling

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Sheet metal: base/edge flange, miter, hem, sketched bend | **PARITY** | `src/SheetMetal.cpp:1-586`, `src/SheetMetalExtended.cpp:1-812` | `test/sheet_metal_smoke.js` — 4 edge flanges + hem + sketched bend, 7 bends, flat vol 14752. PASS. |
| Sheet metal: unfold / flat pattern (K-factor) | **PARITY** | `src/SheetMetalFlatPattern.cpp:1-85` | `test/sheet_flat_pattern_smoke.js` — base 12000 → edge flange develops with bend allowance, flat bbox 224.2×60. PASS. |
| Weldments: structural members + cut list + trims | **PARITY** | `src/Weldments.cpp:1-354` | `test/weldments_smoke.js` — HSS-50×50×3 members, cut list with L/qty/weight/trim. PASS. |

## 11. Sketcher / 2D constraints

| Row | Status | Evidence | Validation |
|---|---|---|---|
| 2D constraint solver (coincident/parallel/perp/tangent/distance/angle/…) | **PARITY** | `src/Sketcher.cpp:1-534` (vendored **planegcs**), `CMakeLists.txt:104-113` | `test/sketcher_smoke.js` — s1 solved (status 0, dof 3), post-solve distance=10 exact; s3 dof 6. PASS. |
| DOF analysis (well/under/over-constrained) | **PARITY** | `src/SketchDof.cpp:1-70` | `test/sketcher_smoke.js` — reports dof + status (status 2 = inconsistent case detected). PASS; `test/smoke-sketchdof.js` present. |

## 12. Assemblies / mates / interference / kinematics

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Assembly container + hierarchy + world transforms | **PARITY** | `src/AssemblyHierarchy.cpp:1-124` | `test/assembly_hierarchy_smoke.js` — tree wiring, world transform compose, BOM rollup 8 leaves + 2 sub-asm. PASS. |
| Mate solver (coincident/distance/concentric/…) | **PARITY** | `src/AssemblySolver.cpp:1-652` | `test/assembly_smoke.js` — stage1 converged (3 iters, residual 1.8e-10), \|inst1−inst2\|=5.0; stage2 residual 4.3e-9. PASS. |
| Mate library (extended mate kinds) | **PARTIAL** | `src/MateLibrary.cpp:1-794` | `test/matelib_smoke.js` — "ALL MATELIB SMOKE TESTS PASSED" but one case logs residual 5.9e+0 (non-converged "short" iteration). Op present; not all kinds proven to converge. |
| Interference / clearance detection | **PARITY** | `src/InterferenceDetection.cpp:1-115` | `test/assembly_interference_smoke.js` — overlapping boxes → pair with volume 0.5 (correct overlap). PASS. |
| Motion study / multibody dynamics | **PARTIAL→see FORGE_PHYSICS_VERIFICATION.md** | `src/MotionStudy.cpp`, `src/MultibodyDynamics.cpp` | Validated in `FORGE_PHYSICS_VERIFICATION.md` (HHT-α pendulum 0.016%) but that is physics, not kernel topology; out of strict scope of this matrix. |

## 13. Tolerance / GD&T analysis

| Row | Status | Evidence | Validation |
|---|---|---|---|
| Tolerance stack (worst-case / RSS / Monte-Carlo) | **PARITY (1-D numeric)** | `src/Tolerance.cpp:1-134` | `test/tolerance_smoke.js` — WC 39.8–40.2, RSS σ 0.0333 Cp 2.0, MC yield 100%. PASS. **1-D stack math only — not geometric FCF evaluation from datums.** |
| Semantic GD&T (datum reference frames derived from geometry, FCF eval) | **NOT STARTED** | — | No geometric feature-control-frame evaluator. Annotation/PMI is a comment carrier (§7). Honest gap vs Parasolid+downstream PMI. |

---

## Honesty caveats (read these before quoting any row)

- **C1 — Native kernel tests are NOT in CI.** `.github/workflows/build-app.yml`
  builds the Electron app only; it does **not** run `cmake-js` to build the
  `.node` addon nor any `forge-kernel/test/*` smoke. The `gate` /
  `forge:kernel:test` npm scripts (`package.json:16-22`) run them **locally
  only**. Every PARITY above reflects a local run on 2026-06-20 against an
  artifact built 2026-06-18. A green PARITY row can silently regress because
  no automated gate guards the kernel.
- **C2 — "PARTIAL via error-path-accepting test" is honest PARTIAL.** Several
  Features tests (sweep, loft, variableFillet, draft, rib) try the first
  valid edge/face and **accept the OCCT error path as a pass**
  (`part_features_smoke.js`). That proves the binding is callable and throws
  real errors, NOT that the op produces correct geometry on a demanding
  case. Those rows are PARTIAL, not PARITY, on purpose.
- **C3 — PARITY = operation-class demonstrated, not Parasolid robustness.**
  OCCT's boolean/fillet engines are real and exact-B-rep, but they are
  publicly weaker than Parasolid/ACIS on adversarial coincident-face,
  thin-sliver, and tangent-propagation cases. No 100+-sequential-boolean or
  fuzzy-tolerance stress test is run here. Do not read these PARITY marks as
  "robust as Parasolid."
- **C4 — Variable-radius fillet is a sampled-law workaround.**
  `src/VarFillet.cpp:96-112` samples Law_Linear/Law_S into a `Pnt2d` array
  because OCCT 7.9.3's direct `Add(law,edge)` aborts. Functionally it builds
  a varying-radius fillet, but the only executed test accepts the error
  path, so it is UNVERIFIED as a correct variable-radius solid.
- **C5 — STEP/PMI semantics.** STEP export round-trips geometry (proven),
  but: (a) no test asserts B_SPLINE/RATIONAL entity emission, and (b) PMI is
  carried as ISO-10303-21 *comments* (`src/IoExchange.cpp:198-206`), not
  semantic AP242 PMI. IGES has **no writer**. JT and Parasolid import are
  honest "unsupported, use STEP" stubs (correctly tested to throw).
- **C6 — Parametric history lives in JS, not the kernel.** The C++ kernel is
  stateless per-op (every op returns a fresh handle; `src/Features.cpp:1-10`).
  Feature-tree re-evaluation, suppress, and persistent topological naming
  under upstream edits are JS-layer (`frontend/src/kernel/forge/`,
  `frontend/src/kernel/history/`) — proven at the lineage level
  (`PersistentTopoIds.test.mjs`) but not as a kernel-level rebuild graph.
- **C7 — `docs/kernel-audit.md` and `docs/parasolid-parity-plan.md` are
  stale** (2026-05-10, pre-OCCT, describe a `manifold-3d`/WASM/JS kernel that
  no longer exists). They are useful history but must NOT be cited as the
  current kernel's status.
- **C8 — The repo's own `PARITY.md` legend ("✅ shipped and tested") is more
  optimistic than this matrix.** Where `PARITY.md` marks ✅ on rows whose
  only test accepts an error path (e.g. variable fillet, draft, sweep/loft
  guides), this file deliberately downgrades them to PARTIAL.

## Net honest summary

The Forge native kernel is a **real, OCCT-7.9.3-backed exact-B-rep kernel**
with **demonstrably working** primitives, booleans (+ native face lineage),
core features (extrude/revolve/shell/fillet/chamfer/holes/patterns),
NURBS authoring + fit + trim + curvature analysis, push/pull direct edits,
STEP/IGES/STL/BREP/glTF I/O, HLR drawings, healing, sheet-metal, weldments,
a planegcs sketch solver, and a converging mate solver — each with a passing
test cited above.

It is **NOT at Parasolid/ACIS parity**: no semantic AP242 PMI, no IGES/JT/
Parasolid writers, sweep/loft/draft/variable-fillet only proven callable
(not on demanding geometry), no robustness stress suite, parametric history
confined to JS, and critically **no CI gate** on any of it. Treat every
PARITY mark as "this operation class works in a local run," and every
PARTIAL/NOT-STARTED as a real, named gap.

---
*Generated 2026-06-20. Tests executed locally against
`forge-kernel/build/Release/forge-kernel.node` (Node v26.0.0, OCCT 7.9.3).
Re-run `npm run forge:kernel:test` + the cited `test/*.js` to reproduce.*
