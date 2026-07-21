# OCCT-ZERO ORDERED DROP PLAN (measured 2026-07-21, otool 13)

Verified: stable binary links 13 real OCCT toolkits (the 14th token `TKHLR13` is the binary's own filename suffix, not a linked toolkit — post TKG2d+TKHLR drops, otool=13 confirmed). TKDESTEP exclusive=6 confirmed by the gate. The dossier counts are measured-accurate. Here is the ordered plan.

---

# OCCT-ZERO ORDERED DROP-EXECUTION PLAN (otool 13 → 0)

**Measured baseline:** 13 linked OCCT toolkits on `forge-kernel.node.TKHLR13_CURRENT`; 696 undefined symbols the .node still imports from OCCT. Governing truth up front: **zero toolkits drop cleanly THIS session.** Every one still has at least one live OCCT symbol reference. What *is* session-bounded is a handful of "route native / wire the already-built code" prep steps that shrink the reference set. The two true gates on every drop are **Models-OS STEP-import 13/13** and **Linux strict-link CI** (the TKG2d 15→14 attempt passed all macOS gates yet regressed Models-OS 13→9 and was reverted — locally-green is necessary, not sufficient).

The dependency spine dictates the tail: **TKernel drops dead-last** (pure transitive runtime substrate), **TKMath second-to-last** (every modeling toolkit pulls `gp_`/`Bnd_`/`TopLoc_`), and the two type-substrates **TKBRep (TopoDS) + TKG3d (Geom_Surface)** drop just before TKMath because every algorithm toolkit consumes their types. The independent front-runner is the STEP pair (TKDESTEP+TKXSBase) — it is the *only* cluster gated on its own parity rather than on the K6 curved-B-rep substrate.

---

## PHASE A — Independent STEP path (own parity gate, NOT K6-blocked)

**1. TKDESTEP — exclusive 6 — difficulty: medium**
- **Eliminate:** route the 3 OCCT-STEP call sites native — (a) rewrite `NativeOcctBridge.cpp occtFromNativeSolid` to build the OCCT `TopoDS_Shape` directly via `BRepBuilderAPI` instead of the `StepAnalytic→temp.step→STEPControl_Reader` round-trip (cheapest single win, no foreign-parity needed); (b) close `readForeignStep` volume-parity to 81/81 and wire it into `importStep` (IoExchange.cpp:79); (c) native `exportStep` for OCCT-handle branch (IoExchange.cpp:136).
- **Live test:** 81 CADGenBench `output.step` — `foreignStepInfo(path).{volume,faces}` vs OCCT `importStep` oracle: assert `|Δvol|/vol ≤ 1e-2 AND faces==` for all 81 (measured NOW: **58/81 @1%, 65/81 @5%, 78/81 exact faces** — not yet there); plus `exportStep→re-import` round-trip vol within 1e-6 (golden_corpus `--verify`).
- **Go/no-go NOW:** **NO-GO for the drop** (23/81 foreign-reader volume misses from unsupported SURFACE_OF_REVOLUTION + EDGE_CURVE(uninvertible)). **Session-bounded prep = the `BRepBuilderAPI` bridge rewrite (b/a)**, which removes `STEPControl_Reader` from one of two call sites without needing full parity. Atomic with TKXSBase.

**2. TKXSBase — exclusive 6 — difficulty: medium (FREE transitive with #1)**
- **Eliminate:** delete the 3 `Interface_Static::SetCVal` config lines in IoExchange.cpp (intent already baked into StepAnalytic = mm/AP242); the other 5 symbols are pure `XSControl_Reader` base-class plumbing that vanish the instant no `STEPControl_*` object is instantiated.
- **Live test:** same 81-model STEP parity + round-trip as #1 (XSControl is only exercised through that path).
- **Go/no-go NOW:** **NO-GO alone** — cannot drop independently (STEPControl IS-A XSControl_Reader). Drops **for free in the same commit as TKDESTEP** once its 3 sites are native.

---

## PHASE B — Algorithm toolkits: native engines built + A/B-green, but imported-handle path is K6-gated

Each has a bounded wiring win available now, but the full drop waits on the K6 curved-preserving native B-rep (so imported-STEP / OCCT-boolean handles can be operated on natively).

**3. TKPrim — exclusive 25 — difficulty: large**
- **Eliminate:** analytic subset (~17 symbols: box/cyl/cone/sphere/torus/wedge) is BUILT+PARITY and default-on — convert the compiled runtime OCCT else-branches to compile-time exclusion in Primitives/Features/Weldments/SheetMetal/DirectModeling/OcctImport; give DirectEdit.cpp + Mold.cpp their first native routes; then the real blocker — `MakePrism` (20+ callsites) / `MakeRevol` emit a NativeMesh incompatible with downstream OCCT booleans/features/STEP-export, so either migrate those chains native or make prism/revol emit an analytic curved Solid (K6a).
- **Live test:** per-primitive FORGE_NATIVE_BREP=1 vs =0 mass/faces parity to 1e-9 (box→6000/6f, cyl(5,10)→785.398/3f, torus(10,3)→1776.529); decisive end-to-end = extrude-profile-then-boolean-cut fully native == OCCT final vol/topology (proves mesh↔solid interop).
- **Go/no-go NOW:** **NO-GO for full drop.** Session-bounded prep = analytic compile-time exclusion (removes ~17 symbols' *unconditional* linkage). General sweep + interop is multi-cycle.

**4. TKFillet — exclusive 11 — difficulty: blocked**
- **Eliminate:** native fillet is EXACT-analytic for straight convex edges on NativeSolid; three OCCT paths remain — (a) imported/boolean handles have no native fillet (K6-gated); (b) `variableFilletEdge` is pure OCCT (needs a native variable-radius law); (c) wire the already-built `ChamferAnalytic.cpp` into `chamferEdges` (the one bounded sub-task).
- **Live test:** 20mm fillet on a 100³ box, setNativeBrep false vs true → vol==OCCT 1e-9, faces 6→7, Euler χ match; the *drop-proving* missing test = fillet a 20mm edge of an **imported-STEP** solid natively (no path today → red-lights the true blocker).
- **Go/no-go NOW:** **NO-GO.** Session-bounded prep = wire ChamferAnalytic. Rest is K6.

**5. TKOffset — exclusive 40 — difficulty: blocked**
- **Eliminate:** widest algorithm toolkit — 7 families, 9 files. Bounded win = WIRE the already-built+tested `OffsetShape.offsetSolidShape` into `thickenSurface` (Features.cpp:886, pure OCCT today). Rest K6-gated: extend `shellSolid` to curved/multiThickness/imported; complete PolygonOffset2D curved edges; native guided sweep (`MakePipe`/`MakePipeShell` — none exists); wire SurfaceFill/GregoryFill into Healing `MakeFilling`; route guided/mismatched lofts native.
- **Live test:** shell 50³ box to 2mm wall → wall-vol==OCCT 1e-6, faces 6→11 (native_vs_occt_shell.cpp); missing drop-proof test = `thickenSurface` native==OCCT (no gate today).
- **Go/no-go NOW:** **NO-GO.** Session-bounded prep = wire OffsetShape into thicken (1 small win). Rest multi-cycle.

**6. TKGeomAlgo — exclusive 19 — difficulty: blocked**
- **Eliminate:** `GeomAPI_ProjectPointOnSurf`→native `projectPointToSurface` is parity-proven (biggest win, unblocks the native mesher); genuine GAPS to build = least-squares B-spline fitter (`GeomAPI_PointsToBSpline`, "no fitting" today) and smooth N-section skinning (`GeomFill_NSections`, only ruled/Coons now); trivial `Law_Linear`/`Law_S` couple to TKFillet/K3.
- **Live test:** off-surface projection {nearest,dist,(u,v)} vs OCCT over 50 pts (1e-9/1e-6); airfoil fit deviation <1e-4 (FAILS today = proves the gap).
- **Go/no-go NOW:** **NO-GO.** Pinned on TKG3d surface handles + 2 net-new algorithms.

**7. TKGeomBase — exclusive 11 — difficulty: blocked**
- **Eliminate:** small classical natives to author — 3-point arc, 2D segment, arc-length/deflection curve sampler (replace 3× `GCPnts`), analytic→NURBS converter (`GeomConvert`); route `Extrema_GenExtPS`→`projectPointToSurface`.
- **Live test:** sampler point-count±1 + chordal dev + polyline length vs `GCPnts_TangentialDeflection` to 1e-6; 3-point arc center/radius/20-pts to 1e-9.
- **Go/no-go NOW:** **NO-GO.** Individually small but every input is an OCCT `Adaptor3d_Curve`/`Handle(Geom_)` → transitively pinned behind TKG3d. (Note: OCCT_ZERO map wrongly lists this as 0-consumer/transitive; the gate shows **11 genuinely exclusive symbols, 6 real consumers** — NOT free.)

**8. TKShHealing — exclusive 17 — difficulty: blocked**
- **Eliminate:** native `healBRep`/`sewFaces` cover the analytic ShapeFix_Shape sites; two NET-NEW algorithms don't exist anywhere — (1) a same-domain face/edge unifier (peer to `ShapeUpgrade_UnifySameDomain`), (2) a free-wire cap-synthesis pipeline wiring SurfaceFill/GregoryFill behind a FreeBounds-equivalent; ungated curved-solid heal sites (DirectModeling/DirectEdit) need the K6/K7 exact-surface substrate so heal doesn't facet curved geometry.
- **Live test:** Part A — gapped box shell → both native+OCCT yield closed valid solid, vol 1e-4, census 6/12/8. Part B (discriminating) — co-planar split-face → `UnifySameDomain` merges to 1 face; native unifier **expected to FAIL today** = proof the block is real capability, not linkage.
- **Go/no-go NOW:** **NO-GO.** Needs 2 net-new algos + K6/K7 + importOcctSolid NURBS/Torus coverage.

---

## PHASE C — Type-substrate co-keystones (K6/K6a): drop just before TKMath

**9. TKTopAlgo — exclusive 84 — difficulty: blocked (co-keystone with TKBRep)**
- **Eliminate:** best per-op native coverage of the whole group, ALL A/B-green on native solids (`BRepGProp`→massProperties, `SolidClassifier`→pointInSolid, `BRepCheck`→CheckReport, `BRepBndLib`→Aabb, `BRepBuilderAPI_Make*`→TopologyBuilder, `Sewing`→Sew). But every one of the 84 symbols takes a `TopoDS_Shape` arg → transitively pinned to TKBRep's TopoDS substrate. Drop WITH or immediately AFTER TKBRep, never before.
- **Live test:** box-with-hole+chamfer built native vs OCCT — VolumeProperties/COM/inertia (1e-6), 10³ point-classification grid == OCCT State() exactly, IsValid verdict, AABB; then repeat on an **imported .step** solid to expose the TopoDS dependency.
- **Go/no-go NOW:** **NO-GO.** Engines ready; toolkit removal blocked on TopoDS migration.

**10. TKG3d — exclusive 62 — difficulty: blocked (deepest geometry substrate)**
- **Eliminate:** the MATH is built+parity (NurbsSurface/Curve eval, NurbsCalculus derivatives, NurbsAlgebra curvature exact vs sphere/cyl/plane, GeomLProp analogs, native massProperties); the TYPE substrate is not — add a native NURBS/analytic surface-handle kind to ShapeRegistry, implement the OCCT-face→native producer at the declared seam `Nurbs.cpp::nativeSurfaceOf()` (returns nullopt by design today), then migrate `BRep_Tool::Surface`/`Geom_Surface::Value`/`GeomLProp_SLProps` consumers native.
- **Live test:** bicubic + rational-sphere-octant B-spline patch, native vs OCCT over 10×10 (u,v): point 1e-9, normal 1e-9, Gaussian/mean curvature 1e-8 (sphere→1/R²,1/R); plus GProp vol/COM/inertia on box-minus-cyl.
- **Go/no-go NOW:** **NO-GO.** No native-surface-handle kind exists; `nativeSurfaceOf()`=nullopt for every input.

**11. TKBRep — exclusive 59 — difficulty: blocked (K6, near-last)**
- **Eliminate:** native `brep::Solid` graph (Topology.hpp, Euler-Poincaré valid) proven to OCCT parity for NATIVE-created solids (core 34/34, face-inventory 44/44), but there is **no OCCT-TopoDS→native-Solid importer** (bridge is one-way native→OCCT), so imported-STEP shapes stay TopoDS and all 23 consumers still call `BRep_Tool`/`TopExp_Explorer`/`BRepAdaptor`. Build the importer (or land K1 native reader so shapes arrive as brep::Solid), then route `BRep_Tool`→Face/Edge/Vertex, `TopExp_Explorer`→native adjacency iteration, adaptors/LProps→native eval, `BRep_Builder`→Euler ops; then TopoDS_T* vtables drop.
- **Live test:** box-minus-cylinder both substrates → TopExp V/E/F counts match, per-face analytic type+axis match, `BRep_Tool::Pnt` 1e-9, adaptor curvature/normal 1e-6; ALSO on an imported .step solid (the actual uncovered blocker).
- **Go/no-go NOW:** **NO-GO.** Multi-cycle keystone K6; 812 family-ref lines across 23 files including OcctImport.cpp which mints the TopoDS everything reads.

---

## PHASE D — Substrate: drop last, purely transitively

**12. TKMath — exclusive 20 — difficulty: blocked (SECOND-TO-LAST)**
- **Eliminate:** consolidate a native `forge::math` (unify NVec3/Point3; author a rigid 3×4 Trsf with SetRotation/SetMirror/Invert/SetTransformation; gp_Ax2/Ax3/Pln frame builders matching OCCT's YDir=Z×X convention; Bnd_Box-parity AABB; TopLoc_Location-parity local-frame), then migrate ~30 files. **Cannot begin until every toolkit above stops pulling `gp_`** — each re-introduces the identical 20 exclusive symbols.
- **Live test:** unit box, Trsf = rotate 30° about Z then mirror across XOY → vol invariant 1e-9, 8 corners == `gp_Pnt::Transform` 1e-9, native AABB == `Bnd_Box::Get`, `Invert()·Trsf`==identity.
- **Go/no-go NOW:** **NO-GO.** Dependency-respecting second-to-last; blocked until otool reaches ~2.

**13. TKernel — exclusive 25 — difficulty: blocked (DEAD-LAST, zero direct work)**
- **Eliminate:** DO NOTHING directly. The 25 symbols (`Standard::Allocate/Free`, `Standard_Failure`, `Standard_Type::Register`, `NCollection_Base*`) are OCCT's runtime substrate, referenced only because OCCT objects remain in the binary. Native code already uses the C++ std runtime. When the last OCCT object leaves, TKernel falls out of `otool -L` automatically → **otool 0**.
- **Live test:** full native-vs-OCCT suite (core 34/34) passing with TKernel NOT linked; deliberate-failure op raises/catches via std::exception; 10k-shape build/destroy leak check.
- **Go/no-go NOW:** **NO-GO.** Cannot drop until otool 1→0.

---

## SESSION VERDICT (honest)

- **Toolkits droppable THIS session: 0.** No native subsystem is complete enough to remove a toolkit's last OCCT reference and clear the Models-OS-13/13 + Linux-CI gate.
- **The one path NOT blocked on the deep K6 substrate is the STEP pair (#1 TKDESTEP + #2 TKXSBase)** — gated only on its own foreign-reader parity (58/81→81/81) and a `BRepBuilderAPI` bridge rewrite. This is the highest-leverage *next* target and the correct place to spend build cycles.
- **Bounded prep wins available now (shrink references, don't yet drop):** the NativeOcctBridge `BRepBuilderAPI` rewrite (TKDESTEP), wiring the already-built+tested `ChamferAnalytic` (TKFillet) and `OffsetShape.offsetSolidShape` into `thickenSurface` (TKOffset), and TKPrim analytic compile-time OCCT-branch exclusion. Each is a real code change behind the single-track build lock (another agent holds it) — none complete a drop alone.
- **Everything in Phases C–D is one interlocked substrate program:** the native curved-preserving B-rep (K6a) + native surface-handle kind + OCCT-TopoDS→native importer. Until that lands, TKBRep/TKG3d/TKTopAlgo/TKGeomBase/TKGeomAlgo/TKShHealing/TKFillet/TKOffset/TKPrim all stay pinned, and TKMath/TKernel cannot even start. This is the true long pole to otool 0, not a sequence of bounded drops.

## Per-toolkit dossiers (measured)
