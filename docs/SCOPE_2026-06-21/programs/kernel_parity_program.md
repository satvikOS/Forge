# PROGRAM — Kernel 1:1 Parasolid/ACIS Parity

**Owner:** SCOPE_2026-06-21 / programs · **Date:** 2026-06-21
**North-star:** Archie-driving-Forge ≥ **0.85 on CADGenBench across *every* dimension** (validity gate · shape similarity · interface match · topology match) — not a 0.85 mean.
**Mandate:** rebuild the unified `forge::native` geometry kernel to **1:1 functional parity** with **Siemens Parasolid (PK interface)** AND **Spatial 3D ACIS (husk/api architecture)** — re-implementing in pure C++20, no new deps, no WASM, OCCT retained as foundation + parity oracle until each capability is retired per-capability. **No lite, no stub, no fallback** (Bible §0/§9).

This program synthesizes four research docs:
- `research/parasolid_acis.md` — the 1:1 parity matrix (operations a1–a35, data-structures b1–b16, paradigms c1–c17; biggest-gap synthesis; PK class taxonomy + 35 ACIS husks).
- `research/manufacturing.md` — DFM/CAPP/MBD/PLM engines that *consume* kernel truth (access cones, draft/thickness/undercut, midsurface, feature recognition, semantic PMI).
- `research/sim_grounded.md` — grounded sim engines that *consume* kernel meshing/topology (tet10+prism mesher, swept volumes, midsurface→shell FE, clash).
- `research/cadgenbench.md` — the exact grader (OCCT `BRepCheck_Analyzer.IsValid()`, manifold3d booleans, watertight tessellation, Betti b₀/b₁/b₂, KOR/KIR jig sub-volumes) that scores every emitted STEP.

**Ground-truth baseline (verified, `KERNEL_INHOUSE_ROADMAP.md`):** the kernel works *today* on OCCT 7.9.3 (20 toolkits) + vendored planegcs; in-house `native/` subtrees exist (`brep csg gdt geom implicit mesh voxel Predicates`). Stages 1–5 (predicates→mesh→implicit→voxel) are tractable weeks-to-months each; Stage 6 (in-house B-rep/NURBS) is the multi-year pole. In-house mesh boolean is **Manifold-class robust-in-practice** (double-precision, ~98–100% general-position, 0 fakes) — *not* CGAL proven-exact. Predicates are being re-derived from first principles (user directive 2026-06-20), gated against Shewchuk reference sign values.

---

## 0. Strategy & sequencing principles

1. **OCCT-anchored, retire-per-capability.** Every batch ships **on OCCT first** (binding gap closed → CADGenBench-scorable now), then the in-house `native::` reimplementation lands behind a **parity gate** (validated vs OCCT or analytic truth) before the OCCT/WASM path is retired. Never big-bang; never a stub in place of a working binding.
2. **CADGenBench-first leverage order.** Validity is the hard gate (a single leaky solid = score 0), so the **validity substrate** (BRepCheck-equivalent + healing + watertight manifold tessellation) is Batch 0 and is continuously hardened. Then the axes in leverage order: validity → shape (exact booleans/blends/dimensions) → interface (holes/bosses/slots/patterns/GD&T sub-volumes) → topology (correct b₀/b₁/b₂ counts).
3. **The four `[GAP-HARD]` moats decide ≥0.85** (from `parasolid_acis.md §biggest-gap`): (1) tolerant modeling + tolerant booleans + full heal; (2) surface-surface intersector → exact intcurves w/ pcurves → B-rep boolean robustness; (3) face-face + variable-radius + setback blending; (4) native history/rollback/marks/partitions + persistent-ID rebuild. These are scheduled as dedicated multi-batch poles, not folded into "misc."
4. **Euler-operator substrate first.** A formal Euler-operator API (MEV/MEF/MVFS/KEMR…) on the in-house half-edge is the *safe primitive layer* every higher op stands on — it precedes booleans/blends in the in-house track. OCCT has no formal Euler set; this is foundational.
5. **One heavy step at a time** (`feedback-hardware-calm`): M4 Max / 36 GB — kernel rebuilds wait for the GPU to be free of training; batches are sized so a single quarter buys a coherent, gate-passing slice.
6. **Every native op emits lineage from the op itself** (`Modified()/Generated()/Deleted()`), not tessellation-derived — this is the persistent-ID foundation the parametric rebuild and the topological-naming robustness depend on.

**Parity scoring (per row):** `[HAVE]` OCCT/in-house gate covers it · `[PARTIAL]` present, limited robustness · `[GAP]` no binding/must build · `[GAP-HARD]` industry multi-year pole. Parity = covering **operation classes + per-class robustness**, not literal symbol count (PK ≈ 900+ fns / 677 unique `PK_*`; ACIS ≈ 35 husks × hundreds of `api_*`).

---

## 1. Phased batches (acceptance-gated)

Each batch lists: **scope (PK/ACIS/OCCT-reimpl mapping)**, **new `forge::native` modules/ops/data-structures**, **acceptance gate**, **CADGenBench axis linkage**, **dependencies**.

### BATCH 0 — Validity substrate & honesty gate (CONTINUOUS, blocks all releases)
*The CADGenBench hard gate. Nothing ships until a part passes this.*
- **Scope:** B-rep-level full validity (self-intersection, loop orientation, fin consistency, geometry-on-topology) + *local* check on op output (b15); watertight closed-shell audit; manifold tessellation (every edge in exactly 2 triangles, orientation-consistent); full heal pipeline (c6 — gap-close→sew→tolerant-edge-synth→sliver-removal→re-param). Reimplements OCCT `BRepCheck_Analyzer`, `BOPAlgo_CheckerSI`, `ShapeHealing` (`TKShHealing`).
- **Modules/ops:** `native::brep::check{Body,Face,Edge,FacePair,Local}`, `native::heal::{closeGaps,sew,synthTolerantEdge,removeSlivers,reparam}`, `native::mesh::auditManifoldWatertight` (extend existing in-house audit from float→exact-predicate).
- **Gate:** every Batch-N export runs validity + heal; ForgeCADScore validity axis = OCCT `BRepCheck_Analyzer.IsValid()` exactly; **validity_rate ≥ 0.95** on a 81-fixture mirror corpus; advisory warnings surfaced (face area <0.001 mm², aspect >1000, BREP tol >0.1 mm) but non-gating.
- **CADGenBench:** **Axis 1 (Validity)** — highest leverage; a 0 here zeroes the sample.
- **Deps:** Predicates (Stage-1 in-house) exhaustively hardened first.

### BATCH 1 — Half-edge topology core + Euler operators (in-house foundation)
- **Scope:** full B-rep topology graph (b1) `BODY→REGION→SHELL→FACE→LOOP→FIN(oriented edge-use, partner ptr)→EDGE→VERTEX` + wire bodies; regions/lumps/void shells (b2, exterior infinite region + interior voids); formal Euler-operator API (c15). Reimplements OCCT `BRep_Builder`/`TopoDS`; ACIS `EULR` + KERN topology; PK `PK_*_euler_*` family.
- **Modules/ops:** `native::brep::HalfEdge` (fin/coedge layer w/ partner pointers); `native::brep::euler::{MEV,MEF,MVFS,MEKR,KEMR,KFMRH, expand,flatten,separate,combine}`; `native::brep::{Region,Lump,VoidShell}` graph with exterior-region tracking; `disjoin`, `findFacesets` (a30).
- **Gate:** Euler invariant V−E+F=2(S−H) holds on a perturbation/degenerate fixture set; box/torus/multi-void solids round-trip; lump-separate ↔ combine idempotent; matches OCCT `TopExp` walk.
- **CADGenBench:** **Axis 4 (Topology)** — correct b₀ (lumps), b₂ (void shells) counts come from this graph.
- **Deps:** Batch 0.

### BATCH 2 — NURBS + analytic geometry engine (the geometry pole)
- **Scope:** B-surfaces (b3, `PK_BSURF_*`) rational/non-rational + degree-elevation/removal/trimming + G0/G1/G2 continuity; B-curves (b4, `PK_BCURVE_*`) + **pcurves** (param-space curves stored on faces) + **intcurves** (exact intersection curves); analytic surfaces (b5, plane/cyl/cone/sphere/torus) + exact analytic↔analytic intersection; analytic curves (b6); procedural lazy-eval surfaces (b7 — blend/offset/swept/spun evaluated lazily, not baked). Reimplements OCCT `Geom_BSpline*/Geom2d_*/Geom_{Plane,Cyl,Cone,Sphere,Torus}`; PK B-geometry chapters; ACIS spline interface.
- **Modules/ops:** extend `native::brep::Nurbs` (have: Cox-de-Boor rational eval/derivatives/Boehm knot-insert/curvature) with `elevateDegree`, `removeKnot`, `trim`, `continuityGtoG`; `native::geom::{Pcurve,Intcurve,AnalyticSurf,AnalyticCurve}`; `native::geom::ProceduralSurf{Blend,Offset,Swept,Spun}` (lazy).
- **Gate:** Bézier/B-spline eval to 1e-9 vs OCCT; knot-insert/degree-elevate preserve curve; analytic intersections (cyl∩cyl, sphere∩plane) exact vs closed form; pcurve↔3D consistency on trimmed faces.
- **CADGenBench:** **Axis 2 (Shape)** — exact surfaces → exact dimensions (0.5% bbox-diag tolerance, no rigid-rescale).
- **Deps:** Batch 1.

### BATCH 3 — Surface-surface intersector → exact booleans `[GAP-HARD pole #2]`
- **Scope:** full SS/CS/CC intersector (b8) producing exact intcurves with pcurves on **both** faces — *the literal core of the kernel*; B-rep-level boolean (a2, `PK_BODY_boolean_2`/`PK_FACE_boolean_2`) robust on degenerate/tangent commercial-grade cases; selective/graph-theory region booleans (ACIS `SBOOL`); local face-subset boolean; imprinting (a5, curve-set/projected-isocline onto face-sets with tag persistence). Reimplements OCCT `IntTools`/`BRepAlgoAPI_{Fuse,Cut,Common,Section,Splitter}`/`BOPAlgo`; CGAL corefinement; ACIS `INTR`+`BOOL`+`SBOOL`.
- **Modules/ops:** `native::geom::intersect::{ss,cs,cc,raytest,silhouette,pointClassify}`; `native::csg::{booleanBody,booleanFaceSubset,booleanSelective}`; `native::brep::{imprintCurves,imprintIsocline,imprintPoint}`. Keep existing `mesh::meshBooleanNative` (Manifold-class) as the convergent/facet path.
- **Gate:** boolean robustness ≥ Manifold-class on B-rep (random general-position + curated degenerate/tangent suite, 0 fakes); section/split tag persistence; selective-boolean region selection correct; **volume IoU via manifold3d-equivalent** matches GT.
- **CADGenBench:** **Axis 2 (Shape, volume IoU)** + **Axis 4 (Topology, b₁ holes from cuts)**.
- **Deps:** Batch 2 (intcurves/pcurves). **This is the gating dependency for most of a-rows.**

### BATCH 4 — Blending engine `[GAP-HARD pole #3]`
- **Scope:** constant-radius rolling-ball fillet (a6) w/ **unfixed-blend-as-attribute** paradigm (sketch/check/modify before `fix_blends`); variable-radius w/ linear + **conic** cross-section (a7); chamfer (a8, equal/two-dist/dist-angle/asymmetric); **face-face blending engine** (a9 — rolling-ball/disc/isoparam spine; conic/chamfer/**G2 curvature-continuous** cross-sections; cliff-edge & holdline; propagation; **notches; ribs**; trim-to-plane; multi-solution); setback/n-edge **vertex corner blends** (a10); overflow handling. Reimplements OCCT `BRepFilletAPI_Make{Fillet,Chamfer}` (`TKFillet`: `ChFi3d`/`BRepBlend`); ACIS `BLND`+`ABL`; PK edge-blend ch29–32 + FF-blend ch33.
- **Modules/ops:** `native::brep::blend::{constEdge,varEdge(law,conic),chamfer,faceFace(G2,holdline,cliffedge),vertexSetback,notch,rib}`; `native::brep::blend::{Unfixed,fixBlends,identifyBlends}`.
- **Gate:** constant/variable/chamfer vs OCCT to 1e-6; FF-blend G2 continuity verified by curvature comb; holdline/cliff-edge cases pass; unfixed→fix round-trips; overflow on tight concave edges handled (no self-intersection — Batch 0 validity passes).
- **CADGenBench:** **Axis 2 (Shape — correct fillet/chamfer radii bleed F1+IoU)**.
- **Deps:** Batch 3 (offset-surface intersection for chamfer/blend cross-sections).

### BATCH 5 — Sweeping, lofting, surfacing (a16/a17/a18/a19/a27/a35)
- **Scope:** sweep along path w/ guides/twist/scale law + self-intersect repair (a16); loft/skin w/ per-profile **derivative/tangency conditions**, vertex matching, degenerate-apex profiles (a17); extrude/revolve (a18, HAVE); emboss/pad/**wrap** (project+conform onto face) (a19); cover/patch/N-sided G1 fill-hole w/ tangency (a27); true tapered/variable-pitch **helical surfaces** (a35 — threads/augers/springs). Reimplements OCCT `BRepOffsetAPI_{MakePipeShell,ThruSections}`/`GeomFill_NSections`/`BRepFeat`/`BRepFill_Filling`; ACIS `SWP`+`AS`+`COVR`; PK Advanced Surfacing ch28.
- **Modules/ops:** `native::brep::{sweep(guides,law,repair),loft(derivCond,match),wrap,coverFill(tangency),helix(taper,varPitch)}`.
- **Gate:** sweep/loft vs OCCT to 1e-6; tight-spine sweep self-intersection repaired; N-sided patch G1 to neighbors; helical thread is true B-rep (not cosmetic) per ISO 261/ASME B1.1.
- **CADGenBench:** **Axis 2 (Shape)** + **Axis 3 (Interface — threaded holes are mating features)**.
- **Deps:** Batch 2 (procedural surfaces), Batch 3 (boolean for emboss/pad).

### BATCH 6 — Local/direct ops, shelling, offset, draft (a11–a15/a23/a24/a25/a26/a31/a32)
- **Scope:** shelling/hollowing w/ **pierce + tangent-pierce faces** + blend auto-removal (a11); thicken w/ self-intersect repair (a12); offset surfaces/faces w/ offset-step + self-intersection removal (a13); offset curves/wires (a14, HAVE); draft/taper double-sided/step + **isocline-surface steepness analysis** + neutral-plane vs parting-line modes (a15); **tweak = replace-surface** w/ auto-extend/retrim of neighbors + generic face-change + merge-after-tweak (a23); delete-face **heal-wound** strategies (a24 — cap-surface synthesis, grow/shrink loops, rubber faces); **feature-recognition defeature** (a25 — auto-find holes/fillets/chamfers/bosses → suppress → heal); **midsurface extraction** (a26 — face-pair match + offset-to-mid + trim/extend network); **law-driven space-warp** (a31 — bend/twist/taper/stretch on B-rep+mesh); embed/wrap body in surface (a32). Reimplements OCCT `BRepOffsetAPI_{MakeThickSolid,MakeOffsetShape,DraftAngle}`/`BRepTools_Modifier`/`ShapeUpgrade`; ACIS `LOP`+`REM`+`SHL`+`OFST`+`WARP`.
- **Modules/ops:** `native::brep::{shell(pierce),thicken,offsetSurf(step,deselfx),draft(isocline,modes),tweakReplaceSurf,faceChange,deleteFaceHeal,defeature(FR),midsurface,spaceWarp(law),embedInSurf}`.
- **Gate:** shell/offset/draft vs OCCT; defeature FR finds ≥95% of holes/fillets/chamfers on a test corpus; midsurface produces a connected sheet network for thin-wall parts (feeds sim shell-FE); space-warp preserves validity.
- **CADGenBench:** **Axis 2 (Shape)** + feeds **manufacturing.md** DFM (draft/thickness/undercut), **sim_grounded.md** midsurface→shell.
- **Deps:** Batch 4 (blend removal in shell), Batch 8 (Laws engine for warps), c16.

### BATCH 7 — Patterns/instancing, features, sectioning, sew, mass-props, queries (a20–a22/a28/a29/a33-partial/b11/b14/b16/c14)
- **Scope:** rib/web/boss parametric recipe library (a20); hole-wizard w/ **standards-driven helical-thread B-rep** ISO 261/ASME B1.1 (a21); patterns linear/circular/mirror/curve/**fill/table/skip** + **fast instanced boolean** (a22 — `PK_FACE_instance_tools`: one-boolean-then-copy, big perf for many-hole parts); sew/stitch/knit w/ tolerant gap-driven per-edge tolerance (a28); sectioning w/ in-front/behind/both region selection + fence (a29); convergent/facet body interplay (a33 partial — mesh faces in boolean); bounding/range-along-vector/local-range (b11, extend in-house BVH); full inertia tensor + principal axes on in-house B-rep (b14); point-in-body classify, find-extreme, silhouette, uvbox (b16); native exact clash classification clear/touch/interfere/contained + interference volume (c14). Reimplements OCCT `BRepGProp`/`BRepExtrema_DistShapeShape`/`BRepAlgoAPI_Section`/`BRepBuilderAPI_Sewing`/`Bnd_Box`/`BVH_Tree`; ACIS `CSTR`+`STITCH`+`CLR`+`INTR`.
- **Modules/ops:** `native::brep::{ribWebBoss,holeWizard(thread),pattern(fill,table,skip),instanceBoolean,sew(tolerant),section(region,fence)}`; `native::query::{massInertia,pointClassify,findExtreme,silhouette,uvbox,clash}`.
- **Gate:** inertia tensor vs OCCT `BRepGProp` to 1e-6; instanced-boolean = single-boolean result but ≥10× faster on 100-hole part; clash classification correct on touch/interfere fixtures; thread geometry passes thread-gauge check.
- **CADGenBench:** **Axis 3 (Interface — holes/bolt-circles/bosses/slots hit KOR/KIR sub-volumes within 5%/1%)** — the axis general models collapse on. **Axis 4 (Topology — hole/instance counts → b₁).**
- **Deps:** Batch 3 (boolean), Batch 5 (helix), Batch 6 (features).

### BATCH 8 — Operational paradigms: history/rollback, persistent-ID, attributes, laws, deformable `[GAP-HARD pole #4 + c-rows]`
- **Scope:** **native delta/mark/rollback bulletin-board** w/ partitions (independent streams) (b12, `PK_MARK/PMARK/DELTA/PARTITION`; ACIS roll history `api_note_state`/`api_roll`); **persistent topology IDs** w/ native `Modified()/Generated()/Deleted()` lineage from the op (b13, ACIS `PID`) → robust persistent-ID rebuild surviving topology change (c1 — solves FreeCAD topological-naming) ; general **user-attribute system** bound to native entities, surviving ops (b10, `PK_ATTRIB`/ACIS `GA`); **general symbolic Laws engine** (c16, parse/differentiate/evaluate; ACIS `LAWS`) reused across blend/sweep/warp/pattern/lattice-grading; **deformable/freeform modeling** (c3 — load/constraint-driven control-point solve over NURBS, multi-surface C1; ACIS `ADM`/`SDM`, PK global shape); subdivision surfaces (c4 — Catmull-Clark/Loop limit-surface). Reimplements OCAF transaction/undo (rollback), `TDataStd` (attributes); has no OCCT analogue for ADM/Laws.
- **Modules/ops:** `native::history::{Mark,PMark,Delta,Partition,roll}`; `native::ident::{TopoId,lineageFromOp}`; `native::attrib::{define,attach,survive}`; `native::laws::{parse,diff,eval}`; `native::deform::{loadConstraintSolve,multiSurfC1}`; `native::subdiv::{catmullClark,loop,limitEval}`.
- **Gate:** roll forward/back is exact + independent per partition; persistent-ID survives a fillet-then-edit-the-base sequence without misnaming (the canonical topological-naming regression); attribute survives boolean+fillet; Laws engine differentiates radius/twist/scale laws correctly; deformable solve hits target points within tol.
- **CADGenBench:** **Axis 4 (editing task topology stability)** + the **Editing fixtures (32)** — surgical deltas need stable IDs so unrelated geometry survives (editing renormalizes against no-op).
- **Deps:** Batch 1 (Euler/half-edge for lineage), Batches 3–7 (ops emit lineage).

### BATCH 9 — Cellular/general/non-manifold bodies + tolerant modeling `[GAP-HARD pole #1]`
- **Scope:** **per-entity tolerant modeling** (b9, `PK_EDGE_ask_precision`; ACIS tolerant EDGE/VERTEX/COEDGE) — per-edge/vertex tolerance band + tolerant intersection/snap within band; **tolerant booleans** on dirty/imported data (a4, "tolerant-hot" booleans); **cellular topology** engine (a3 — region cells for FE meshing/mixed material; ACIS `CT`); **general/non-manifold/mixed-dimension bodies** (a3 — wire-as-hole, acorn vertices, internal partition faces; `PK_TOPOL_make_general_body`); **convergent/facet modeling** unified B-rep ∪ mesh (a33 full — analytic + facet faces boolean/blend/offset together; Parasolid Convergent Modeling). Reimplements: CGAL Nef_3 (non-manifold) conceptually; no OCCT analogue for per-entity tolerance or cellular topology; Manifold for the facet side.
- **Modules/ops:** `native::brep::{TolEdge,TolVertex,tolerantBoolean,tolerantIntersect}`; `native::brep::cellular::{makeGeneralBody,regionCells,acornVertex,partitionFace}`; `native::convergent::{unifiedBody,facetFaceInBoolean,facetBlend,facetOffset}`.
- **Gate:** imported-STEP-with-gaps boolean succeeds where exact boolean fails (tolerant-hot); cellular body subdivides into FE-meshable cells; convergent body boolean of analytic-cube ∪ scanned-mesh is watertight + valid; **passes CADGenBench imported-STEP editing fixtures** that the exact path fails.
- **CADGenBench:** **Axis 1 (Validity on dirty imports)** + **Axis 2/4 (editing fixtures)** — the #1 Parasolid/ACIS moat and the difference between passing/failing imported-STEP cases.
- **Deps:** Batches 0,1,3,8. **The hardest pole — multi-batch, milestone-gated, no quarter buys all of it.**

### BATCH 10 — Lattice/implicit/AM modeling (a34/a33) + faceter/HLR (c5)
- **Scope:** beam/strut graph lattices, conformal lattices, **lattice→B-rep skinning**, grading fields (a34, on existing `voxel::Tpms` gyroid/schwarz/diamond — have SDF marching-cubes/dual-contour); kernel-native **curvature-adaptive crack-free B-rep faceter** (c5, independent of OCCT) + native **hidden-line (HLR)** for drawings; subdivision-from-Batch-8 organic modeling. Reimplements PicoGK/libfive (implicit/TPMS — partly HAVE) + OCCT `BRepMesh_IncrementalMesh`/`HLRBRep`; ACIS `FCT`+`PHL/IHL`.
- **Modules/ops:** `native::lattice::{strutGraph,conformal,skinToBrep,gradeField}`; `native::facet::{adaptiveBrepFacet,crackFreeSharedEdge}`; `native::hlr::{precise,interactive}`.
- **Gate:** lattice→B-rep is watertight + valid; faceter is crack-free across shared edges + curvature-adaptive (deflection-driven) matching OCCT deflection; HLR matches OCCT `HLRBRep` view.
- **CADGenBench:** **Axis 1 (faceter feeds manifold tessellation gate)** + AM/lightweighting flagships.
- **Deps:** Batch 8 (Laws for grading), Batch 9 (convergent for lattice∪B-rep).

### BATCH 11 — Interop completeness (c7–c13)
- **Scope:** **AP242 PMI/GD&T semantic round-trip** (c7 — kernel has tolerance/PMI bound-not-wired; wire it + write semantic FCFs not annotation curves) + native (non-OCCT) STEP writer for no-deps end-state; IGES (c8, HAVE); **JT read/write** ISO 14306 (c9 — tessellated + B-rep + PMI + LOD; enterprise/PLM); **Parasolid XT/XB + ACIS SAT/SAB** read/write (c10 — the MCAD lingua franca; every SolidWorks/NX/Inventor file rides one; + history markers); STL/OBJ/**3MF**(AM beam-lattice ext)/AMF/glTF (c11); DXF/SVG/PDF (HAVE in-house) + **DWG** read/write (c12); native assembly graph w/ transforms/shared-master-B-rep/partition-scoped rollback (c13, `PK_ASSEMBLY/INSTANCE/PARTITION`). Reimplements OCCT `TKDESTEP`(AP242)/`TKDEIGES`/`TKDESTL`/`XCAF`; ACIS InterOp + translators.
- **Modules/ops:** `native::io::{stepWriteSemanticPmi,jtRW,xtRW,satRW,3mfRW,dwgRW}`; `native::assembly::{graph,sharedMaster,instance,partitionRollback}`.
- **Gate:** AP242 semantic PMI round-trips through `forge.io.exportStepWithPmi` (feeds **manufacturing.md §C MBD**); XT/SAT of a curated assembly round-trips to the same B-rep; JT LODs render; CADGenBench STEP I/O byte-clean.
- **CADGenBench:** **all axes via STEP I/O** (the deliverable is a STEP file) + AP242-PMI is the **interface/GD&T-scoring path**; ingests CADGenBench/Mecado assets.
- **Deps:** Batches 2,8,9.

---

## 2. Hardest-gap pole tracker (the rows that decide ≥0.85)

| Pole | Batches | Reimplements | Why it gates CADGenBench | Status target |
|---|---|---|---|---|
| **#1 Tolerant modeling + tolerant booleans + heal** | 0, 9 | CGAL-Nef concept, ACIS HEAL/RBI, PK precision | Imported-STEP validity + editing fixtures; the #1 Parasolid moat | multi-batch, milestone-gated |
| **#2 SS-intersector → exact intcurves/pcurves → boolean** | 2, 3 | OCCT IntTools/BOPAlgo, CGAL corefinement | Volume IoU (Shape) + cut-hole counts (Topology); literal kernel core | dedicated pole |
| **#3 Face-face + variable + setback blending** | 4 | OCCT TKFillet, ACIS ABL, PK FF-blend ch33 | Correct fillet/chamfer radii bleed Shape F1+IoU; Class-A | dedicated engine |
| **#4 History/rollback/marks/partitions + persistent-ID rebuild** | 8 | OCAF, ACIS PID/roll | Editing-task topology stability (no-op renormalization); FreeCAD topo-naming | dedicated pole |
| (5) Convergent/facet ∪ B-rep + lattice→B-rep | 9, 10 | Manifold, PicoGK/libfive | AM flagships; differentiator vs OCCT | per-batch |
| (6) Defeature/FR + midsurface + deformable | 6, 8 | ShapeUpgrade, ACIS ADM | Sim-prep (sim_grounded midsurface→shell); Class-A | per-batch |
| (7) Interop XT/XB+SAT/SAB+JT+AP242-PMI | 11 | OCCT TKDE*, ACIS InterOp | STEP deliverable + GD&T scoring + asset ingest | per-batch |
| (8) Cellular/general/non-manifold + Euler substrate | 1, 9 | CGAL Nef, ACIS EULR/CT | Safe topological foundation; b₀/b₂ counts | foundational |

---

## 3. Cross-program dependencies (what consumes kernel truth)

- **manufacturing.md** needs: access-cone face-normal queries + ray-cast tool-reach (b16/c14 → Batch 7); draft/isocline analysis (a15 → Batch 6); medial-axis thickness + **midsurface** (a26 → Batch 6); **feature recognition** (a25 → Batch 6) for CAPP; semantic PMI authoring needs **AP242 semantic round-trip** (c7 → Batch 11) + persistent-ID (Batch 8) for stable annotation attachment.
- **sim_grounded.md** needs: tet10+prism mesher fed by the **adaptive faceter + cellular topology** (Batch 1/10); **midsurface** for shell-FE (Batch 6); **swept-volume boolean + clash** for MBD interference (Batch 3/7/c14); convergent body for mesh-FE coupling (Batch 9).
- **cadgenbench.md** needs: **ForgeCADScore re-implements the 4 grader axes** on the native kernel — validity (Batch 0 = `BRepCheck_Analyzer.IsValid()`), volume IoU via manifold3d-equivalent (Batch 3), Betti b₀/b₁/b₂ (Batch 1 topology graph + ray-cast), KOR/KIR jig sub-volume IoU (Batch 7 features) — for offline self-eval that mirrors the private grader exactly.

---

## 4. Acceptance ledger (program-level Definition of Done)

A batch is DONE only when: (1) the OCCT-binding gap is closed and CADGenBench-scorable; (2) the in-house `native::` reimplementation lands behind a parity gate (vs OCCT or analytic truth, error characterized — `SIM_VALIDATION.md` honesty contract); (3) Batch-0 validity passes on every op output; (4) lineage (`Modified/Generated/Deleted`) emits from the op; (5) a headed Playwright e2e on the live kernel demonstrates it (`feedback-verify-playwright-rerun`); (6) the per-capability OCCT/WASM path is retired only after the gate passes (no big-bang, no stub). **Program-level DoD: ForgeCADScore ≥ 0.85 on every axis on the 81-fixture mirror corpus, validity_rate ≥ 0.95.**

---

## 5. Sources
Inherited from the four research docs (full URLs therein): Parasolid PK V13 index (677 `PK_*`) http://www.q-solid.com/Parasolid_Docs/pk_index_long.html ; Parasolid SDK https://plm.sw.siemens.com/en-US/plm-components/parasolid/3d-modeling-sdk/ ; 3D ACIS architecture (35 husks) http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisgsTechArticles/SPAacisgs_arcomp.htm ; ACIS ADM http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_modefmodacis.htm ; OCCT toolkits https://dev.opencascade.org/doc/overview/html/ ; CGAL Nef_3 https://doc.cgal.org/latest/Nef_3/index.html ; Manifold https://github.com/elalish/manifold/wiki/Manifold-Library ; CADGenBench https://github.com/huggingface/cadgenbench + https://www.mecado.com/benchmark . In-repo ground truth: `KERNEL_INHOUSE_ROADMAP.md`, `KERNEL_UNIFICATION.md`, `KERNEL_PARITY.md`, `forge-kernel/CMakeLists.txt`, `forge-kernel/include/forge/native/`.
