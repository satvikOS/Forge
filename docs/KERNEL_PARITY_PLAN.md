# Kernel Parity Plan — forge-kernel vs Parasolid / ACIS (Pillar #3)

**Grounded in the real kernel** at `forge-kernel/build/Release/forge-kernel.node`
(v0.1.0, OCCT 7.9.3, N-API 8), enumerated 2026-07-16 @ trunk `4aa4f9d4`.

- **337 top-level exports** → **283 namespaces + 54 top-level fns → 654 callable ops**.
- Most namespaces are the ~200 engineering *calculators* (`beam.solve`, `cfd.*`,
  `fea.*`, `boltjoint.*`, …). This plan concerns the **B-rep / geometry** subset —
  the ~20 namespaces that constitute the modeling kernel and are what Parasolid/ACIS
  are.

## Engine architecture (the "5 kernels", ground truth)

Per `forge-kernel/OCCT_DEPENDENCY_TRUTH.md` (otool-verified) the built `.node`
still **links 19–24 OCCT `TK*` dylibs**. `nativeBrepEnabled()` is **`true` by default**,
so a native B-rep path is preferred and A/B-verified against OCCT, but OCCT is **not
removed** — it is the residual fallback + STEP/IGES/STL io + test oracle.

| "Kernel" | Real backing code | Dependency-free? | Surfaced exports |
|---|---|---|---|
| **OCCT** (NURBS B-rep backbone) | linked `TK*` + native reimpl in `src/native/brep/` (NurbsSurface, Boolean, Fillet, Chamfer, Loft, Sweep, Draft, Shell, Section, Hlr, Step/Iges Read/Write) | **No** — 19–24 TK dylibs still linked | `part.*`, `io.*`, `direct.*`, `heal.*`, `surfacing.*`, `classa.*`, `drawings.*`, `varfillet`, `loftguide`, `sheetMetal.*`, `nurbsfit`, primitives, `massProps` |
| **Manifold** (robust polygonal CSG) | `src/native/mesh/` + `src/native/csg/` (MeshBooleanNative, MeshBooleanExact, Extrude, Revolve) | **Yes** | `nativeBoolean`, `native.meshBoolean`, `booleantol.{common,cut,fuse}`, `geom.polygonBoolean2D` |
| **CGAL** (computational geometry) | `src/native/geom/` (Delaunay 2D/3D, Voronoi3D, ConvexHull, ConvexDecomposition, Minkowski, AlphaShape) + exact predicates (`ExactReal`, `Predicates`) | **Yes** | `geom.*`, `native.{convexHull2D,convexHull3D,orient2d,orient3d,incircle}` |
| **libfive** (implicit / F-Rep / SDF) | `src/native/implicit/` (SdfTree, FRepTree, DualContour, IsoMesher, AdaptiveIntervalMesh) | **Yes** | `implicit.*` (29 ops), `dualContour.contour`, `meshToSdf.field` |
| **PicoGK** (voxel / lattice) | `src/native/voxel/` (VoxelGrid, Morphology, VoxelBoolean, Lattice, Tpms) | **Yes** | `tpms.{gyroid,neovius,schwarzD,schwarzP}`, `pointcloud.voxelMesh`, voxel offset/shell via `implicit` |

**Takeaway:** 4 of 5 engines are already genuinely dependency-free native code. The
whole "Parasolid/ACIS 1:1" effort reduces to **finishing the OCCT-displacement work in
`src/native/brep/` well enough that the analytic B-rep survives its own operations** —
not to writing new engines from scratch.

---

## 1. Feature matrix — canonical Parasolid/ACIS families vs forge-kernel

Legend: **HAS** = shipped & A/B-verified · **PARTIAL** = present but a documented
limitation applies · **FALLBACK** = works only because OCCT is still linked · **GAP** = absent.

| Capability family (Parasolid/ACIS canonical) | forge-kernel exports (real) | Status | Notes / limitation (grounded) |
|---|---|---|---|
| **Primitives** | `makeBox/Sphere/Cylinder/Cone/Torus/Prism/Pyramid/Wedge/Tube/Ellipsoid`, `implicit.{box,sphere,cylinder,cone,torus,capsule,roundedBox,hexPrism}` | **HAS** | Dual B-rep + implicit primitive sets. Solid. |
| **Sketch + constraint solver** | `sketcher.*` (13: addLine/Arc/Circle/Point/Constraint, solve, statuses), `sketch.diagnose`, `SketchDof` | **HAS** | 2D DOF/constraint solver present. |
| **Extrude / revolve** | `part.{extrudeProfile,extrudeProfileOnPlane,revolveProfile}`, `csg/Extrude`, `csg/Revolve` | **HAS** (revolve **PARTIAL**) | 90° revolve of a rect tessellates to **genus-4 instead of a ball** on the K5 mesh path (`K5_TKMESH_BLOCKER.md` gate 31/37). B-rep volume exact; mesh not watertight. |
| **Sweep / loft (multi-section, guide rails)** | `part.{sweep,sweepPolyline,sweepWithGuides,loft,loftWithGuides,pipeFromPolyline}`, `loftguide.loft`, `airfoil.loftWing`, `native/brep/{LoftSweep,HelicalSweep,Sweep}` | **HAS** | Guide-rail loft + helical sweep present. Twist/scale rails: verify against `classa.sweepWithGuides`. |
| **Blending / filleting** | `part.{filletEdges,variableFilletEdge,chamferEdges}`, `varfillet.fillet`, `native/brep/{Fillet,FilletAnalytic,Chamfer,ChamferAnalytic}` | **PARTIAL** | Constant + **variable-radius** edge fillet + chamfer are native (K3 general-dihedral convex-edge fillet merged). **Missing:** hold-line fillets, face-face (setback) blends with G2/G3, full concave/mixed-convexity fillet networks. |
| **Shell / thicken / draft / rib** | `part.{shell,shellMultiThickness,thickenSurface,draftFaces,rib}`, `implicit.shell`, `native/brep/{Shell,Draft,DraftAnalytic}`, `mesh/Shell` | **HAS** | Native shell/rib/draft merged & 9/9 A/B-verified (`KERNEL_UNIFIED_STATUS.md` GAP1). |
| **Patterns** | `part.{linearPattern,circularPattern,mirrorPattern,onCurvePattern}`, `native/brep/Pattern` | **HAS** | Full pattern family, native-verified (GAP1). |
| **Hole wizard / threads** | `part.holeWizard`, `native/brep/HelicalSweep` (thread sweep), `stdparts.{makeBolt,makeNut,…}` | **PARTIAL** | Counter-bore/-sink hole wizard native. ISO thread as true helical cut: present via HelicalSweep but not surfaced as a `part.thread` verb. |
| **Boolean robustness** | `nativeBoolean`, `native.meshBoolean`, `booleantol.{common,cut,fuse}`, `mesh/{MeshBooleanNative,MeshBooleanExact,BooleanBVH}` | **PARTIAL / FALLBACK** | Planar & straight-solid booleans native + exact. **Curved∩planar exact boolean is O(\|A\|·\|B\|) and unbounded** — budget-guarded to an honest `ok=false` (`K2_EXACT_BOOLEAN_BUDGET.md`); NURBS-mixed booleans still **FALLBACK** to OCCT. |
| **Tolerant modeling** | `heal.*`, `shapefix.repair`, `sewing.sew`, `booleantol.*` | **PARTIAL / FALLBACK** | Sew/fill/repair exist; true **per-entity tolerance carried through operations** (ACIS/Parasolid tolerant B-rep) relies on OCCT `BRep` tolerances, not the native path. |
| **Healing** | `heal.{autoFillMissingFaces,autoRepairSelfIntersection,checkValidity,harmonizeNormals,sewShape,simplifyShape}`, `shapefix.repair`, `shapecheck.analyse`, `mesh/{Repair,HoleFill,SelfIntersect}` | **HAS** | Strong native healing surface; broadest of the modeling families. |
| **Direct / synchronous edit** | `direct.{moveFace,rotateFace,pushPullFace,replaceFace,deleteFaceAndHeal,inferFeature,edgeCount,faceCount,edgeSegments}`, `pushPullFace`, `resizeBore`, `unifyFaces` | **PARTIAL** (blocked; G1 bridge-coalesce attempted+reverted 2026-07-17) | Ops exist, **but native path shatters an analytic cylinder into 128 strip faces** — face-level ops have no well-defined target. **A bridge-level fix (coalesce co-domain faces in `occtFromNativeSolid` via `ShapeUpgrade_UnifySameDomain`) was tried + A/B-verified + REVERTED**: it correctly gives cyl 3F/cone 3F/torus 1F and passes core.mjs 34/34 + a face-census gate, BUT the coalesced *periodic* face tessellates NON-WATERTIGHT on some random bodies → the `coherence_logic` scorer regressed 8/8→~3/10 (BRep-valid + volume-preserved, so a BRepCheck/volume guard did NOT catch it — it is a tessellation-of-periodic-face defect, same root as the K5/TKMesh gap). Honest revert per program discipline. **CORRECT FIX = native single-analytic-face primitive builders with a watertight periodic tessellator (G1+G2 together)**, not a bridge band-aid. `unifyFaces()` remains the opt-in band-aid. |
| **Class-A surfacing** | `classa.{curvatureComb,zebraStripes,continuityCheck,gaussianAndMeanCurvature,stitchG2,sweepWithGuides}`, `surfacing.{buildPatch,classAAnalyse,trim,sew,refine}`, `nurbsfit.fitSurface`, `native/brep/GregoryFill` | **HAS** | Zebra/curvature-comb/G2-stitch/Gregory-patch fill present — rare vs Parasolid; a genuine strength. |
| **Feature recognition** | `direct.inferFeature` only | **GAP** | Infers *one* feature behind a face-op; **no standalone FR** that segments an imported solid into holes/pockets/fillets/ribs. |
| **Data structures / topology / naming** | `ShapeRegistry`, `LineageRegistry`, `lineageFor`, `kindOf`, `faceInventory`, `unifyFaces` | **PARTIAL** | Lineage + shape registry exist; **persistent face/edge/vertex IDs do not reliably survive the native bridge or booleans** (same shatter root cause). No parametric history/rollback graph. |
| **Mass / inertial properties** | `massProps`, `nativeMassProps`, `native/brep/MassProps` | **HAS** | Analytic-ish; volume/COM exact to 1e-12 on both paths. |
| **Tessellation / faceting** | `tessellate`, `tessellateAsync`, `tessellateLOD`, `nativeTessellate`, LOD/BVH suite, `mesh/*`, `OcctNativeMesh` | **PARTIAL** (blocked) | Fast LOD + BVH + async pool. **Native tessellator `occtmesh` is not watertight** for revolved/curved surfaces and drifts F/E on prisms — blocks `TKMesh` removal (`K5_TKMESH_BLOCKER.md`). |
| **Implicit / lattice / AM** | `implicit.*` (29), `tpms.*`, `dualContour`, `meshToSdf`, `native.{amWarp,compositesClt}`, `voxel/*` | **HAS** | F-Rep + TPMS + voxel morphology — **exceeds** Parasolid (Siemens sells this as a separate module). |
| **Import** | `io.{importStep,importIges,importStl,importBrep,importJt,importParasolid}` | **PARTIAL / FALLBACK** | STEP/IGES/STL/BREP via OCCT `TKDE*`; native `StepRead`/`IgesRead` exist but not default. **`importJt`/`importParasolid` are honest stubs that throw a STEP-conversion message** — proprietary Siemens formats, deliberately not cloned. |
| **Export** | `io.{exportStep,exportStepWithPmi,exportIges,exportStl,exportBrep}`, `gltf.*`, `dxf.write`, `drawings.emitDXF/emitSVG`, `native/brep/IgesWrite` | **PARTIAL** | Geometry export solid. **AP242 PMI is appended as `/* … */` comment block, not semantic PMI entities** (`IoExchange.cpp exportStepWithPmi`). |
| **Engineering drawings / HLR** | `drawings.{projectView,projectSection,projectDetail,projectBroken,sectionView,projectShapePerspective}`, `projectShape`, `native/brep/Hlr` | **HAS** (perspective **FALLBACK**) | Orthographic HLR native; perspective HLR still leans on OCCT. |
| **Sheet metal** | `sheetMetal.*` (13), `sheetextend.*`, `SheetMetalFlatPattern` | **HAS** | Base/edge/miter flange, hem, jog, bend, closed corner, flat pattern, unfold. Deep. |
| **Assembly / mates / interference** | `assembly.*` (14), `matelib.solve`, `interferenceDetection`, `detectInterference` | **HAS** | Mate solver + interference native. |

---

## 2. Top 8 gaps — the specific op, which engine supplies it, and effort

Ordered by leverage. Efforts are engineering-weeks for a senior kernel dev, anchored to
the fact that scaffolds already exist (files named below) — these are *finish* jobs, not
greenfield.

| # | Gap (specific op) | Engine / file that must supply it | Effort | Why it matters |
|---|---|---|---|---|
| **G1** | **Analytic-face survival through the native→OCCT bridge** — bridge must emit **one `TopoDS_Face` per analytic surface** instead of 128 angular strips. | OCCT/native — `src/native/brep/` bridge + `SolidTessellate.cpp`; supersedes `unifyFaces` band-aid | **3–6 wk** | Unblocks *all* `direct.*` synchronous editing and is the prerequisite for persistent naming (G5). This is the #1 root-cause defect; everything face-level depends on it. |
| **G2** | **Watertight native tessellator** — `forge::occtmesh` must produce a 2-manifold (every edge shared by exactly 2 tris), weld vertices across patch seams, handle periodic u=0≡u=2π seams. Gate on χ, not volume. | OCCT/native mesh — `OcctNativeMesh.cpp`, `src/native/brep/SolidTessellate.cpp`, `Tessellate.cpp`, `FeaTet.cpp` | **2–4 wk** (spec fully written in `K5_TKMESH_BLOCKER.md`) | Fixes revolve genus-4 defect, unblocks removing `TKMesh` from `OCCT_LIBS`, and raises FEA/drawing fidelity (both consume this mesh). |
| **G3** | **Curved∩planar boolean broad-phase** — replace the O(\|A\|·\|B\|) exact arrangement with a **BVH broad-phase** so cost is O(k) in genuinely-intersecting face pairs; then raise the 5 s budget. | Manifold/native — `src/native/mesh/BooleanBVH.cpp` (scaffold exists) + `MeshBooleanExact.cpp` | **2–3 wk** | Turns today's honest `ok=false` on sphere-through-box into a real answer; removes the last common boolean FALLBACK to OCCT. |
| **G4** | **NURBS↔NURBS exact boolean / surface-surface intersection robustness** — trace exact intersection curves between trimmed NURBS patches (Newton + subdivision marching) so curved-mixed booleans don't fall back. | OCCT/native — `src/native/brep/{NurbsSurfaceIntersect,SurfaceIntersect,Boolean}.cpp` | **8–16 wk** (hardest) | The core of "1:1 Parasolid" — robust NURBS booleans are Parasolid's 35-year moat. Longest pole; do it last, incrementally. |
| **G5** | **Persistent topological naming + history graph** — stable face/edge/vertex IDs that survive booleans/features + a rollback/parametric-history DAG. | OCCT/native — extend `ShapeRegistry`/`LineageRegistry` on top of G1's stable faces | **4–8 wk** | Required for parametric edit-and-rebuild and for direct-edit "infer feature" to re-target reliably. Blocked on G1. |
| **G6** | **Tolerant B-rep for dirty imports** — carry per-edge/vertex tolerance through native ops (not just a one-shot `heal`/`sew`), so gappy STEP/IGES imports model without re-heal each op. | OCCT/native — `src/native/brep/{Sew,Heal,Check}.cpp` + tolerance field on native topology | **3–5 wk** | ACIS/Parasolid ingest real-world dirty CAD; today the native path assumes watertight input and leans on OCCT `ShapeFix` tolerances. |
| **G7** | **Feature recognition (FR)** — segment an imported solid into holes / pockets / fillets / ribs / bosses via a rule engine over the topology graph (concave-edge loops, cylindrical-face clustering). | CGAL+native — `src/native/geom/` clustering + `src/native/brep/Topology.cpp` | **4–6 wk** | Parasolid/ACIS ship FR as the basis of direct-edit + CAM feature detect; forge only has single-op `direct.inferFeature`. |
| **G8** | **Native STEP AP242 + IGES io with semantic PMI** — make `native/brep/StepRead` + `IgesWrite` the default (unlink `TKDESTEP`/`TKDEIGES`), and emit **real AP242 GD&T/PMI entities** instead of a comment block. | OCCT/native — `src/native/brep/{StepRead,StepAnalytic,IgesWrite}.cpp`, `IoExchange.cpp`, `gdt/FcfEvaluator.cpp` | **6–10 wk** | Last big OCCT-link dependency + the MBD story (Pillar: auto-MBD). PMI-as-comment is not round-trippable into NX/CATIA. |

*(Deliberately-out-of-scope non-gaps: `importParasolid`/`importJt` stay honest stubs —
proprietary Siemens formats; STEP AP242 is the exact-precision interchange and the correct
answer per the "free, own-IP, no cloning" product rule.)*

---

## 3. Prioritized sequence

**Tier 1 — unblock the foundation (do first; both are fully spec'd in existing K-docs).**
1. **G1** analytic-face-per-surface bridge → makes `direct.*` and naming *possible at all*.
2. **G2** watertight native tessellator → fixes revolve/curved genus defects, unblocks `TKMesh` unlink.

These two are the highest-leverage: they convert a pile of "A/B-verified on volume only"
ops into ops that are correct at *face identity*, which is what every downstream direct-edit,
naming, drawing, and FEA consumer actually needs.

**Tier 2 — close the robustness + interchange gaps (parallelizable after Tier 1).**
3. **G3** boolean broad-phase (independent; can start now, scaffold exists).
4. **G6** tolerant B-rep for imports.
5. **G8** native STEP/IGES + semantic AP242 PMI (also retires the largest OCCT link).

**Tier 3 — the long parity poles (depend on Tier 1/2).**
6. **G5** persistent naming + history graph (needs G1).
7. **G7** feature recognition (needs G1 + stable topology).
8. **G4** robust NURBS↔NURBS booleans — multi-month; slice incrementally (start with
   analytic∩analytic, then analytic∩NURBS, then NURBS∩NURBS), keeping OCCT as the
   verified fallback until each slice A/B-passes.

**OCCT-unlink endgame** (the "1:1 native" milestone): G2 retires `TKMesh`; G8 retires
`TKDESTEP`/`TKDEIGES`; G1+G3+G4 retire `TKBO`/`TKBool`/`TKFillet`/`TKTopAlgo`. Only then does
`otool -L` show zero `TK*` and the "unified native kernel" claim becomes literally true.
Track under the existing `occt-unlink-truth` workflow.
