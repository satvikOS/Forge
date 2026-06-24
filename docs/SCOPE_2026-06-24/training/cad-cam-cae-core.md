# Training Curriculum Spec — CLUSTER: Core CAD / CAM / CAE + Computational Geometry + Computer Graphics & Geometric Modelling

> SCOPE_2026-06-24 / training. Curriculum + data-generation plan for the **pure
> CAD/CAM/CAE 14B** (Qwen2.5-14B + DeepSeek-R1 reasoning, 4-bit qLoRA, 36 GB M4-Max
> ceiling). This is the **geometry foundation cluster** — it sits UNDER every other
> field cluster and gates CADGenBench's **validity / shape / topology** axes.
>
> **Grounded against:** the live Forge verb surface in this repo
> (`forge.part.*`, `forge.sketcher.*`, `forge.surfacing.*`, `forge.direct.*`,
> `forge.heal.*`, `forge.io.*` — see `FORGE_PLATFORM_INVENTORY.md` /
> `KERNEL_PARITY.md`), the kernel audit `../kernel/brep-nurbs.md`, the corpus program
> `../../SCOPE_2026-06-21/programs/archie_corpus_program.md`, and the parametric-CAD
> literature map `../../SCOPE_2026-06-21/research/parametric_cad_literature_2026.md`.
>
> **House discipline (memory rules):** bulk_synth programmatic generation (agents top
> out at 40–60 samples; bulk_synth = millions); strict download→process→delete +
> `iter_batches`; NO `--mask-prompt` on long corpora (all-masked → NaN → silent
> adapter corruption); every sample carries Archie's chat template; honesty (surface
> real kernel limits, never fabricate); **every geometric sample terminates in a
> schema-valid `forge.<wb>.<op>(args)` call the kernel can replay and score**.

---

## 0. WHY THIS CLUSTER IS REQUIREMENT-ZERO

The corpus program's curriculum order is explicit: **math → geometry (validity first)
→ physics → manufacturing → …**. Geometry is S0→S1, *before* every physics and
manufacturing cluster, because:

1. **Validity is a hard zero-gate.** CADGenBench scores 0 if the solid is not
   watertight + manifold + meshable. No amount of correct physics or DFM reasoning
   recovers a non-manifold body. Robust geometric predicates + watertight booleans are
   the substrate that makes *every* downstream axis non-zero.
2. **Shape + Topology axes are 0.4·shape + 0.2·topology of the score** and are *pure
   geometry*: exact dimensions, correct fillet/chamfer radii, exact hole/void/body
   counts (Betti b₀/b₁/b₂). A model that cannot reason about NURBS evaluation, B-rep
   topology, or boolean classification cannot hit these.
3. **The literature is unanimous** (`parametric_cad_literature_2026.md` §2): the model
   must emit *operations*, the **kernel** owns watertightness. So the model's job is to
   reason *correctly about geometry* and emit the *right replayable op* — which is
   exactly what this cluster teaches. AutoBrep (70.8% validity) proves models that emit
   geometry fail; Forge's replay design makes validity ~100% **by construction** *iff*
   the emitted op-sequence is geometrically sound.
4. **The audited kernel gaps are geometric** (`../kernel/brep-nurbs.md`): boolean
   fragility (empty geometry after ~30 subtractions), no inner-loop faces, no curve-on-
   edge, no trimmed-NURBS face read. Archie must reason *around* and *toward* these —
   know when an op is exact vs mesh-fallback, and emit the sequence that stays in the
   exact analytic family.

A senior CAD engineer's geometric judgment is the target: not "what extrude" but
"this fillet ordering will fail because the rolling-ball radius exceeds the local
concave-edge curvature; reorder so the boss is filleted before the pocket, snap the
radius to a stock cutter size, and keep the boolean operands in the analytic-quadric
family so the result stays watertight."

---

## 1. KNOWLEDGE BREAKDOWN (bachelors → masters → PhD → industry)

> Four tiers. Each lists the sub-topics, the **load-bearing theory/equations**, the
> **standards**, and the **hard engineering judgment** that separates a parser from a
> practising engineer. The equation set is the *answer key* for the synth generators
> in §3; the judgment items are the *reasoning targets*.

### 1.1 TIER B — Bachelors (the literacy floor; every sample assumes this)

**B1. Solid-modelling representations & their trade-offs.**
- B-rep (boundary representation): vertex–edge–face topology + geometry; the
  winged/half-edge/radial-edge data structures. CSG trees. Cell decomposition /
  voxels / octrees. Function representation (F-rep / implicit / SDF). **Euler–Poincaré
  formula** `V − E + F = 2(S − H) + R` (shells S, through-holes/genus H, ring/inner-
  loop faces R) — the topological invariant every Euler operator must preserve.
- *Judgment:* which representation for which task (B-rep for parametric CAD + exact
  dimensions; CSG for clean booleans; SDF/F-rep for lattices/TPMS/blends; mesh only as
  output/fallback). **Forge maps:** analytic B-rep (`forge.part.*`) vs implicit
  (`forge.implicit.*`) vs mesh-fallback — and *why* the kernel marks
  `usedMeshFallback` (`brep-nurbs.md §1.5`).

**B2. Parametric / feature-based / direct modelling.**
- Sketch → constraint → feature (extrude/revolve/sweep/loft) → boolean → dress
  (fillet/chamfer/draft/shell/rib) → pattern. The **feature tree / history** and its
  *rebuild* semantics. Design intent: parent–child references, "design for change."
- Direct (history-free) editing: push/pull face, move/offset/delete-face-and-heal.
- *Judgment:* parametric vs direct trade-off (history = editability + fragility;
  direct = robustness + lost intent). Feature ordering to avoid rebuild failure.
  **Forge maps:** `forge.part.extrudeProfile / revolveProfile / sweep / loft /
  filletEdges / chamferEdges / draftFaces / shell / rib / *Pattern` (history) vs
  `forge.direct.pushPullFace / moveFace / replaceFace / deleteFaceAndHeal` (direct).

**B3. Curve & surface fundamentals.**
- Parametric curves/surfaces; Bézier (Bernstein basis, de Casteljau); B-splines (knot
  vectors, basis functions); **NURBS** (rational, homogeneous coordinates, weights).
  Tangent, normal, **curvature** `κ = |r′×r″|/|r′|³`, torsion. Surface first/second
  fundamental forms; **Gaussian K** and **mean H** curvature; principal curvatures.
- *Judgment:* degree vs # control points vs continuity; when a conic needs a rational
  weight (exact circle/ellipse needs NURBS w≠1); chord-length vs centripetal
  parameterisation for fitting. **Forge maps:** `forge.surfacing.eval / buildPatch /
  buildNurbsPatch / refineNurbs`.

**B4. Coordinate systems, transforms, projection.**
- Homogeneous coordinates, 4×4 affine + rigid transforms, quaternions vs Euler vs
  rotation matrices, **gimbal lock**. Datum planes/axes/CSYS. Orthographic vs
  perspective projection; the graphics pipeline (model→view→projection→viewport);
  hidden-line/hidden-surface removal at literacy level.
- *Judgment:* world vs local frame for an assembly mate; right-hand rule; why a
  rotation must compose as a quaternion to avoid drift in a long edit history.

**B5. Engineering drawing & GD&T literacy (geometric side).**
- Orthographic/section/detail views, dimensioning, **ASME Y14.5** datum reference
  frames, 14 GD&T characteristics, MMC/LMC, feature control frames. Surface finish.
  (Deep GD&T lives in the mechatronics/inspection cluster; *here* it is the
  geometry→drawing→geometry round-trip.)
- *Judgment:* 3-2-1 datum scheme; when a dimension is driving vs driven; bolt-circle
  via polar pattern not 6 hand-placed holes. **Forge maps:** `forge.drawings.projectView
  / projectDetail`, `forge.io.exportStepWithPmi`.

---

### 1.2 TIER M — Masters (the working-engineer reasoning layer)

**M1. NURBS theory & algorithms (The NURBS Book, Piegl & Tiller — the canon).**
- Cox–de Boor recursion + **de Boor evaluation** (numerically stable, O(p²)); knot
  **insertion (Boehm A5.1)**, **refinement (Oslo)**, **removal**, **degree elevation**;
  derivative algorithms (DersBasisFuns A2.3, rational quotient-rule A4.2/A4.4).
- **Curve/surface fitting**: global interpolation, least-squares approximation,
  knot-placement (averaging), error-bounded approximation. **Reparameterisation,
  closest-point/projection** (Newton on `(C(u)−P)·C′(u)=0`).
- **Continuity:** parametric Cⁿ vs geometric Gⁿ; G0 (position) / G1 (tangent) / G2
  (curvature) / G3 (curvature-rate) — the Class-A vocabulary.
- *Judgment:* the audited kernel **has** Boehm curve insertion + eval + derivatives but
  **lacks** elevation/removal/refinement/fitting/projection (`brep-nurbs.md §2.2`).
  Archie must know which NURBS ops are exact-native, which route to OCCT, and how to
  pose a fit so the result stays G2 for a Class-A surface. **Forge maps:**
  `forge.surfacing.buildNurbsPatch / refineNurbs / trimNurbsFace / sewNurbsFaces /
  projectPointToSurface / intersectSurfaces / classAAnalyse`.

**M2. B-rep topology & the unified body model.**
- Manifold vs non-manifold; orientation; **coedges / pcurves** (the 2D curve in the
  surface's (u,v) domain a coedge needs); inner (hole) loops; shells, voids, lamina,
  wire/sheet/mixed-dimension bodies. **Euler operators** (MEV, MEF, KEMR, MVFS …) and
  why every modelling op is a sequence of them that preserves the Euler–Poincaré
  invariant. Persistent IDs / attributes / lineage (Modified/Generated/Deleted).
- *Judgment:* **the single biggest audited gap** — Forge's analytic B-rep has *no
  inner loops, no curve-on-edge, no pcurves, no lineage* (`brep-nurbs.md §2.1, §4`).
  Archie must reason about *what a valid B-rep needs* so it never emits a sequence that
  would require a face-with-hole the native path can't hold (route to OCCT, or
  decompose). **Forge maps:** `forge.heal.checkValidity / sewShape / simplifyShape`,
  `forge.direct.faceCount / edgeCount / inferFeature`.

**M3. Computational geometry (the robustness substrate).**
- **Exact predicates:** orient2d/orient3d, incircle/insphere; **Shewchuk adaptive
  floating-point filters**; why naive doubles fail (the boolean-fragility root cause).
- Convex hull (Graham/QuickHull/incremental), **Delaunay triangulation** + constrained
  Delaunay (the kernel uses `constrainedDelaunay2D` to imprint boolean curves),
  **Voronoi**, Bentley–Ottmann sweep (segment intersection), point-in-polygon (winding /
  ray-cast), **Minkowski sums / straight skeleton / polygon offset** (sheet-metal + CAM
  contours), GJK/EPA (collision/interference). Ray–solid classification.
- *Judgment:* the audited boolean uses ray-cast in/out classify + analytic SSI imprint
  (`brep-nurbs.md §1.5`); when coordinates are near-degenerate, exact predicates are the
  difference between watertight and empty-after-30-subtractions. Archie must order
  booleans to avoid sliver faces and snap coordinates to a grid (256-bin quantization,
  the literature's "single highest-leverage trick"). **Forge maps:** `forge.cg.*`,
  `forge.native.meshBoolean`, `forge.assembly.detectInterference / clear`.

**M4. Boolean / intersection / offset / blend operations (the op physics).**
- **Surface–surface intersection (SSI):** closed-form for quadric pairs (plane∩cone =
  full Dandelin conic set), Newton-marched polyline for skew/NURBS pairs; branch/loop
  topology of the intersection curve. Boolean = imprint SSI curves → split faces →
  classify in/out → stitch → validate.
- **Offset** (curve/surface/solid; self-intersection & shrink/grow degeneracy);
  **shell/hollow** (face-removal + offset). **Fillet/chamfer** as a *blend surface*:
  constant-radius **rolling-ball**, variable-radius/law, concave (reflex) edges,
  **setback vertex blends**, face–face blends, **overflow/recession** handling — the
  hardest area in any kernel.
- *Judgment:* the audited native fillet is **mesh + convex edges only**; concave edges
  are *skipped* (`brep-nurbs.md §2.3`). Archie must know: fillet convex-before-concave,
  radius ≤ local curvature radius, large fillets last, and that a NURBS-pair boolean
  falls back to mesh (lose analytic-exact mass). It should *prefer op orderings that
  keep results in the exact family*. **Forge maps:** `forge.part.filletEdges /
  variableFilletEdge / chamferEdges / shell / shellMultiThickness / thickenSurface`,
  `forge.surfacing.offsetFace / trim / intersect`.

**M5. Constraint solving (the sketcher / GCS).**
- 2D geometric constraint systems: coincidence, parallel, perpendicular, tangent,
  concentric, distance, angle, symmetry, equal. **Degrees-of-freedom analysis**
  (under/well/over/inconsistently-constrained); witness/Jacobian methods; graph-based
  decomposition (PLANEGCS). Sketch DOF = 2·points − constraints.
- *Judgment:* the literature target is **93% fully-constrained** by training auto-
  constrain with the *real solver's DOF status as reward* (Autodesk ICCV'25). Archie
  must produce *fully-constrained* sketches (no DOF drift on rebuild), recognise over-
  constraint, and prefer a polar/grid pattern over redundant constraints. **Forge maps:**
  `forge.sketcher.createSketch / addPoint / addLine / addCircle / addArc / addConstraint /
  solve / kinds`.

**M6. Tessellation, meshing & display geometry.**
- Curvature-/tolerance-adaptive faceting; **crack-free stitching** across shared edges;
  chord/normal-deviation tolerance. Mesh quality (aspect ratio, skew). FE meshing from
  B-rep (Delaunay/advancing-front tet; quad/hex; boundary layers) — the bridge to CAE.
  Decimation (**QEM**), remeshing, UV unwrap (**LSCM/ARAP**) for the graphics side.
- *Judgment:* the audited tessellator is **uniform-grid** (no adaptive, no crack-free
  stitch — `brep-nurbs.md §2.3`); Archie must request the right deviation tolerance for
  export vs FE vs viewport, and know a too-coarse mesh corrupts the volume-IoU shape
  score. **Forge maps:** `forge.fea.meshFromBrep / tet`, `forge.io.exportStl`.

---

### 1.3 TIER P — PhD / research frontier (the depth that produces senior judgment)

**P1. Tolerant / robust modelling.** Per-entity tolerances (Parasolid SP-tolerance,
ACIS tolerant edges); interval/rational arithmetic; the **exact-computation paradigm
(CGAL EGC)** vs floating filters; numerical conditioning of intersection/Newton
marching; degeneracy & symbolic perturbation (SoS). *The audited kernel is "robust-in-
practice, NOT exact"* (`brep-nurbs.md §2.5`) — Archie must reason about *when* a
sequence is near the tolerance cliff.

**P2. Topology-naming / persistent-identification problem.** Stable face/edge handles
across an edit history (the OCCT topological-naming fragility, literature open-question
#4). **Selectors by GeomType + position, not index** (build123d's robust scheme) —
the keystone for editable, replayable references. *Forge's context-verbs need ONE shared
ctx* (memory). This is *why* Archie must reference geometry by stable selector, never by
brittle index.

**P3. NURBS/B-rep generative & learned geometry.** B-rep generation validity bars
(AutoBrep 70.8%, HoLa ~82–84%, DTGBrepGen 88.3% — topology-first decoupling raises
validity); continuous B-rep encoders (**BRT** Bezier-triangle > UV-grid); message-
passing scorers (**BRepNet/UV-Net** as topology-truth verifiers). The lesson Archie
encodes: *emit operations, let the kernel build; commit topology before geometry;
reference by stable handle.*

**P4. Subdivision, implicit & multiresolution surfaces.** Catmull–Clark / Loop /
Doo–Sabin subdivision + limit-surface analysis; **SDF/F-rep** booleans, R-functions,
**TPMS (gyroid/Schwarz)** as implicit fields, marching cubes / dual contouring; lattice
& gradient-shell design. Bridges to the voxel/lattice + implicit kernel areas
(`../kernel/voxel-lattice.md`, `../kernel/implicit-frep.md`).

**P5. Differential geometry of design surfaces & Class-A.** Geodesics; **isophotes,
reflection lines, zebra, porcupine/curvature combs**; fairing/energy-minimising
surfaces (thin-plate/MVC); G2/G3 surface continuity verification; the aesthetic-vs-
manufacturable trade. *Forge:* `forge.surfacing.classAAnalyse`.

**P6. Geometric & topological reasoning for assemblies & large models.** Mating-
constraint algebra & assembly DOF; interference/clearance at scale; spatial indexing
(BVH, R-tree, octree) for ~20k-component flagships via **organized instancing** (memory:
no confetti); LOD. Bridges `../kernel/assembly-largemodel.md`.

---

### 1.4 TIER I — Industry practice (the "is it actually makeable" judgment)

**I1. Manufacturable geometry, encoded as constraints on the model** (the cross-cutting
DFM-geometry layer; deep process rules live in the manufacturing cluster):
- Machining: internal corner radius ≥ cutter radius (and the 130% rule); pocket depth-
  to-width ratios; no sharp internal corners; tool-access / undercut detection.
- Casting/molding: **uniform wall thickness**, draft (1–3°), fillet all sharp corners,
  no sudden section changes (Chvorinov / Niyama feed the *physics*; the *geometry* is
  draft + fillet + wall uniformity). **Parting-line / core–cavity** geometry
  (`forge.mold.computeParting / insertCoolingChannels`).
- Sheet metal: bend radius ≥ material thickness, **K-factor / bend-allowance** flat-
  pattern, min flange, relief cuts.
- Additive: 45° self-supporting overhang, min feature/wall, trapped-powder escape.
- *Judgment:* the geometry must encode makeability — Archie sizes a fillet to a real
  cutter, drafts a molded face, makes walls uniform, and **flags** geometry that is
  geometrically valid but unmakeable. **Forge:** `forge.manufacturing.dfm.*`,
  `forge.cam.*`, `forge.mold.*`.

**I2. Data exchange & interoperability (the round-trip reality).**
- **ISO 10303 STEP AP242** (analytic + B-spline surfaces, PMI/GD&T, assemblies); IGES;
  Parasolid XT, ACIS SAT; STL/OBJ/glTF (mesh). Import healing (sew, gap-fill, sliver/
  small-edge removal, self-intersection repair). **Tolerance reconciliation** across
  kernels.
- *Judgment:* the audited STEP reader handles **only the 5 quadrics**; trimmed B-spline
  surfaces are **not** reconstructed and fail honestly (`brep-nurbs.md §2.4`). Archie
  must heal on import, surface the real "unsupported analytic surface" limit rather than
  hallucinate geometry, and know which export carries PMI. **Forge:** `forge.io.importStep
  / importBrep / importStl / exportStep / exportStepWithPmi / exportBrep / exportStl`,
  `forge.heal.*`.

**I3. CAM/CAE geometry hand-off.**
- CAM: toolpath geometry (offset contours, scallop height `h = R−√(R²−(s/2)²)`, adaptive
  clearing, rest-machining, multi-axis indexing, gouge/collision). **Forge:**
  `forge.cam.gcode / adaptiveClear / drill / multiAxisIndexed`.
- CAE: defeaturing/idealisation (suppress small fillets/holes that wreck mesh quality
  but don't carry load), midsurface extraction for shells, clean watertight geometry as
  the meshing prerequisite. **Forge:** `forge.fea.meshFromBrep / tet`.
- *Judgment:* which features to defeature for FE (small fillets/holes ↔ stress
  concentration trade); scallop vs cycle-time; the geometry the toolpath needs.

**I4. The kernel-honest senior judgment (the thing that makes Archie trustworthy).**
For any task, reason about: (a) does the op stay in the **exact analytic family** or
fall to **mesh** (lose exact mass)? (b) will the boolean **stay watertight** or produce
slivers? (c) is the result a **valid B-rep** (`forge.heal.checkValidity`)? (d) is the
geometry **makeable**? (e) if the kernel **can't** do it, **say so and route/decompose**
— never fabricate. This is the §27 honesty rule made geometric.

---

## 2. DATA SOURCES (premium / authoritative only)

> Cite-and-distill the proprietary/standards text into answer-keys; ingest only
> license-clean datasets into shipped weights. **Licensing is load-bearing** (see
> `parametric_cad_literature_2026.md §3`): ABC/DeepCAD = MIT (shipped-weights OK);
> **Fusion 360 Gallery = CC BY-NC (research/scorer-training ONLY, never shipped
> weights)**.

### 2.1 Textbooks (the canon — distill to answer-keys, do not scrape verbatim)
- **Piegl & Tiller, *The NURBS Book*** (2nd ed.) — THE NURBS canon (algorithms A2.x–
  A9.x are literal answer-keys for the synth fitting/insertion/elevation generators).
- **Mortenson, *Geometric Modeling*** — curves/surfaces/solids breadth.
- **Hoffmann, *Geometric and Solid Modeling*** — B-rep/CSG/Euler-operator theory.
- **Mäntylä, *An Introduction to Solid Modeling*** — Euler operators + half-edge (the
  topology answer-key).
- **Farin, *Curves and Surfaces for CAGD*** — Bézier/B-spline/CAGD + Class-A intuition.
- **Patrikalakis & Maekawa, *Shape Interrogation for Computer Aided Design and
  Manufacturing*** — SSI, offsets, distance/projection, robustness (MIT, free PDF).
- **Shewchuk, "Adaptive Precision Floating-Point Arithmetic and Fast Robust Geometric
  Predicates"** — the exact-predicate answer-key (boolean-robustness root fix).
- **de Berg, van Kreveld, Overmars, Schwarzkopf, *Computational Geometry: Algorithms
  and Applications*** — hull/Delaunay/Voronoi/sweep/Minkowski.
- **Botsch, Kobbelt, Pauly, Lévy, Alla, *Polygon Mesh Processing*** — decimation/
  remesh/parameterisation (graphics side).
- **Hughes et al., *Computer Graphics: Principles and Practice*** — pipeline/transforms/
  projection/HLR.
- **Shah & Mäntylä, *Parametric and Feature-Based CAD/CAM*** — feature modelling +
  feature recognition.
- **Lee, *Principles of CAD/CAM/CAE Systems*** + **Zeid, *CAD/CAM Theory and Practice***
  — system-level integration breadth.
- **Stroud, *Boundary Representation Modelling Techniques*** — production B-rep depth.
- **Boothroyd, Dewhurst, Knight, *Product Design for Manufacture and Assembly*** — the
  DFM-geometry answer-key (Tier I).

### 2.2 Courses (premier, free, citable)
- **MIT OCW 2.158J / 16.940 *Computational Geometry*** (Patrikalakis) — SSI/offset/
  robustness lectures + notes; pairs with the Patrikalakis–Maekawa text.
- **MIT OCW 6.837 *Computer Graphics*** — pipeline, curves/surfaces, ray-casting.
- **MIT OCW 2.007 / 2.008** — design & manufacturing (DFM geometry).
- **Stanford CS164 / CS348a *Computer Graphics: Geometric Modeling*** — subdivision,
  NURBS, mesh processing.
- **Berkeley CS184/284A** — graphics + geometry processing.
- **TU-Wien / RWTH geometry-processing courses; Keenan Crane, *Discrete Differential
  Geometry* (CMU 15-458)** — DDG, curvature, the modern geometry-processing answer-key.
- **Siemens NX / SolidWorks vendor courses** already in-repo (`docs/siemens-nx-course/`,
  `docs/solidworks-course/`) — workflow/feature-tree intent (UX-grounding, not theory).

### 2.3 Standards bodies (cite as answer-keys; the geometry-relevant subset)
- **ISO 10303 (STEP), esp. AP203/AP214/AP242** — the geometry + PMI exchange schema
  (`forge.io.exportStep*`).
- **ISO 14649 (STEP-NC)** — machining feature semantics.
- **ASME Y14.5-2018 / ISO 1101 / ISO 8015** — GD&T, datums, geometric tolerancing.
- **ISO 16792 / ASME Y14.41** — model-based definition / digital PMI.
- **ISO 286 (limits & fits), ISO 2768 (general tolerances)** — fit/clearance geometry.
- **VDA 4955 / JT (ISO 14306)** — visualisation/exchange.
- **DIN 6784 / ISO 13715** — edge/fillet/chamfer specification.

### 2.4 Papers / research corpora (the SOTA layer — full list in
`parametric_cad_literature_2026.md §8.2`)
- **TOOLCAD** (the Forge twin: tool-calls + step-level kernel reward + GRPO);
  **cadrille** (online-RL>offline, 0% invalid); **CADSmith** (kernel-measurement-in-
  loop); **CADMorph / CAD-Editor** (plan-generate-verify edit loop); **DeepCAD /
  Fusion360 Gallery / SketchGraphs** (the sketch-extrude + constraint corpora);
  **BRepNet / UV-Net / BRT** (B-rep scorers/encoders); **build123d** (Apache-2.0
  verb-taxonomy oracle + equivalence checker).

### 2.5 Datasets (license-flagged; download→process→delete; bulk_synth dominates)
| Dataset | Size | License | Use here |
|---|---|---|---|
| **ABC / ABC-1M** | ~1M / ~1.3M B-rep | **MIT (ship-OK)** | Root corpus: replay STEP→kernel→back-derive op/feature labels. Ungated. |
| **DeepCAD** | ~178k sketch-extrude | **MIT** | Primary SFT bootstrap: 16-D cmd-JSON → Forge tool-calls. |
| **SketchGraphs / CPTSketchGraphs** | 15M / 80M 2D sketches | research | Constraint-graph supervision → `forge.sketcher.*` auto-constrain. |
| **Fusion360 Gallery** | 8,625 seqs / 35,858 seg / 8,251 asm | **CC BY-NC** | **scorer/eval ONLY** — face↔verb scorer; never shipped weights. |
| **CC3D** | 50k+ scans+CAD | research | OOD/sim-to-real eval (never overfit DeepCAD). |
| **TMCAD / MFCAD++** | 10k STEP feature-labeled | research | Feature-recognition evaluator. |

**Synthetic dominates** (CAD-Recode's 1M procedural + cadrille pattern): bulk_synth is
70–80% of SFT fuel — license-clean, infinite, storage-bounded — validated against the
small real sets.

---

## 3. SYNTHETIC-DATA GENERATION PLAN (bulk_synth modules — Pillar B, Cluster 1)

> This cluster = **`bulk_synth_geom.py`** in the corpus program (~1.5M unique target),
> plus the Pillar-E CADGenBench-targeted generators (`gen_validity / gen_shape /
> gen_topology`) and Pillar-A NURBS/numerics overlap. Every generator emits JSONL
> `{messages:[system,user,assistant]}`; the assistant ends in one (or a short
> sequence of) **`forge.<wb>.<op>(args)` calls the kernel replays**. The §1 equations
> are the **answer keys**; the §1 judgment items are the **reasoning targets**.
>
> **Grounding rule (the whole point):** a geometric sample is only kept if **replaying
> its tool-call in forge-kernel produces a body whose measured property matches the
> claimed answer** (mass/volume/bbox/face-count/Betti via `forge.heal.checkValidity` +
> `MassProps` + topology signature). This is `ForgeCADScore`-as-filter — the literature's
> "kernel-measurement-in-the-loop" (CADSmith) applied at *data-generation* time, not
> just eval. Ungrounded geometric Q/A are discarded.

### 3.1 Generator catalogue (what to bulk-generate)

**G-KNOW — knowledge/recall Q/A (Tier B/M theory).** "State the Euler–Poincaré
formula for a solid with 2 through-holes and 3 inner-loop faces; verify on a given
V/E/F." "Give the de Boor evaluation of this NURBS curve at u=0.4." "Why does a naive
double-precision orient2d fail near-collinear, and what does Shewchuk's filter do?"
→ answer-key from §1; **closed-form, symbolically/numerically checkable**.

**G-CALC — geometric computation problem→solution.** Knot insertion/removal/degree-
elevation worked end-to-end (Piegl A5.x); curvature/torsion of a parametric curve;
SSI of plane∩cone (classify the Dandelin conic); convex hull / Delaunay of a point set;
polygon offset / Minkowski; closest-point projection (Newton iterations shown);
sketch DOF count. → **independently verifiable** (recompute the closed form / replay
geometry); these train the *reasoning trace*, then terminate in the matching
`forge.surfacing.*` or `forge.cg.*` call.

**G-BUILD — design→tool-call (the core CUA-driving generator).** A part spec (NL +
dimensions, optionally a drawing PNG for the VLM branch) → a CoT plan → a **minimal
correct `forge.part.*` / `forge.sketcher.*` sequence**. Args **256-bin quantized /
snapped** (DeepCAD's highest-leverage trick); references by **stable selector
(GeomType+position)** not index (build123d scheme); topology committed before geometry.
**Kept only if replay → watertight body with bbox/volume matching spec.** This is the
direct CADGenBench shape+validity+topology trainer.

**G-CRITIQUE — design→critique→fix (Tier I + Pillar-D repair primitive).** A given
(possibly broken/unmakeable) body → detect the violation (non-manifold / sliver /
self-intersection / non-uniform wall / no-draft / fillet-radius > cutter / over-
constrained sketch / DOF drift) → propose + **apply a validated fix** via
`forge.heal.* / forge.direct.* / forge.part.*` → **re-check valid + makeable**. Mirrors
the audited gaps so Archie learns to repair *exactly* the failure modes the kernel and
benchmark produce. Multi-round refinement traces (mrCAD recipe) — the differentiator,
since SOTA VLMs *degrade* designs on edit.

**G-ORDER — operation-ordering / op-physics judgment.** Given a feature set, choose the
order that stays watertight and in the exact-analytic family (fillet convex-before-
concave, large fillets last, boolean operands quadric-first, defeature-before-mesh).
Negative examples (the wrong order → empty geometry / mesh-fallback) as DPO pairs.

**G-EXCHANGE — import-heal-export round-trips.** A foreign/STEP/STL part (incl. ones the
native reader can't fully reconstruct) → import → heal (`forge.heal.sewShape /
autoRepairSelfIntersection / autoFillMissingFaces / simplifyShape`) → verify → export.
**Honesty-injected:** when the native path hits "unsupported analytic surface," the
ideal answer *surfaces the real limit and routes/decomposes* — never fabricates.

**G-NURBS-SURF — Class-A / surfacing.** Build/trim/sew NURBS patches to a continuity
target (G2); analyse with `forge.surfacing.classAAnalyse`; fair a reflection-line
defect → re-analyse. Ties Tier-P5 to `forge.surfacing.buildNurbsPatch / trimNurbsFace /
sewNurbsFaces / classAAnalyse`.

### 3.2 How grounding ties back to **driving Forge, not chatting**

Every generator's terminal artifact is a **replayable kernel op**, so the corpus
teaches Archie the *operate-the-CAD* skill, not prose. The training loop is the
literature consensus (`parametric_cad_literature_2026.md §4, §7`):

1. **SFT** on G-KNOW/G-CALC (reasoning) + G-BUILD/G-CRITIQUE/G-ORDER/G-EXCHANGE/
   G-NURBS-SURF (tool-calls), CAD-CoT `<think>/<tool_call>/<tool_response>` format,
   args quantized-as-classification. (Drop `--mask-prompt` on long samples — NaN guard.)
2. **Online RL (GRPO/GSPO)** with reward = **forge-kernel execution**: validity hard-
   gate + shape (Chamfer + Vol-IoU) + topology (Betti) + conciseness penalty + step-
   level execution feedback. `ForgeCADScore` is both the **data-generation filter** and
   the **RL reward** — owned, deterministic, offline, free (what TOOLCAD/CADSmith pay
   third-party kernels for).
3. **Plan-Generate-Verify best-of-N** at inference (CADMorph): emit N candidate
   sequences → replay all → keep the highest-scoring watertight one.

This directly attacks the v3 baseline (overall 0.38, shape 0.357) on the three axes
this cluster owns — **validity (→ ~100% by construction if the op is sound), shape
(256-bin snap + geometry-truth reward), topology (exact Betti via watertight booleans)**
— and makes the geometric reasoning *senior-engineer* grade rather than primitive-
blockout (the audited Archie-fidelity gap).

### 3.3 Scale, budget & hygiene
- **Target ~1.5M unique** for this cluster (corpus-program Cluster-1 budget), mixed:
  ~40% G-BUILD, ~20% G-CRITIQUE/refinement, ~15% G-CALC, ~10% G-KNOW, ~10% G-EXCHANGE/
  G-ORDER, ~5% G-NURBS-SURF. Plus replayed ABC-1M / DeepCAD (MIT) → tool-call
  supervision.
- **bulk_synth programmatic** (agents top out 40–60; programmatic = millions);
  `corpus_factory.py` + `merge_accumulator.py` dedup; coherence/critic gate; **download
  →process→delete** + `iter_batches` for ABC/DeepCAD/SketchGraphs; Fusion360 → scorer-
  training partition only (CC BY-NC, never shipped weights).
- **Curriculum slot:** S0 (math/NURBS-numerics) → **S1 geometry** (this cluster: gate =
  Forge-replay validity_rate ≥0.95 on 200-part smoke, shape/topo ≥0.80) → S8 DPO on
  ForgeCADScore-ranked pairs (this cluster's G-ORDER negatives are prime DPO fuel).

---

## 4. EXAMPLE TRAINING SAMPLES (depth illustration)

> Three samples spanning a math/CALC reasoning trace, a design→build tool-call, and a
> design→critique→repair. All terminate in (or operate via) replayable Forge ops.
> `system` is elided for brevity but is the standard Archie CAD-engineer + tool-schema
> prompt; assistant uses the CAD-CoT `<think>`/tool-call format.

### Sample 1 — G-CALC: knot insertion + continuity reasoning (Tier M / Pillar-A overlap)

**Prompt (user):**
> A cubic (p=3) clamped B-spline curve has knot vector
> U = {0,0,0,0, 0.5, 1,1,1,1} and 5 control points
> P0=(0,0), P1=(1,2), P2=(3,2), P3=(4,0), P4=(5,1).
> (a) Insert a knot at u=0.25 using Boehm's algorithm and give the new control
> polygon. (b) State the continuity of the curve at the existing interior knot u=0.5
> and explain why. (c) Reproduce the result in Forge and confirm the inserted curve is
> identical to the original.

**Ideal answer (assistant):**
> `<think>`
> Clamped cubic, n+1=5 ctrl pts, p=3, so U has m+1 = n+p+2 = 9 knots ✓. The interior
> knot u=0.5 has multiplicity 1, so the curve is Cᵖ⁻ᵏ = C³⁻¹ = **C²** there (parametric
> continuity = p − multiplicity). Inserting u=0.25 lands in span [0, 0.5) (index k=3,
> since U[3]=0 ≤ 0.25 < U[4]=0.5). Boehm (Piegl A5.1): new ctrl pts Q_i for
> i = k−p+1 … k get blended; the rest are copied. For each affected i:
>   α_i = (ū − U[i]) / (U[i+p] − U[i]),  Q_i = (1−α_i)·P_{i−1} + α_i·P_i.
> Affected i = k−p+1…k = 1,2,3 (with ū=0.25, p=3):
>   i=1: α = (0.25−U[1])/(U[4]−U[1]) = (0.25−0)/(0.5−0)=0.5 → Q1 = 0.5·P0+0.5·P1 = (0.5,1)
>   i=2: α = (0.25−U[2])/(U[5]−U[2]) = (0.25−0)/(1−0)=0.25 → Q2 = 0.75·P1+0.25·P2 = (1.5,2)
>   i=3: α = (0.25−U[3])/(U[6]−U[3]) = (0.25−0)/(1−0)=0.25 → Q3 = 0.75·P2+0.25·P3 = (3.25,1.5)
> New polygon: P0, Q1, Q2, Q3, P2(old idx2 shifts), P3, P4 → 6 ctrl pts, new knot
> inserted at 0.25 (multiplicity 1). Knot insertion is **geometry-preserving** — the
> curve C(u) is pointwise identical; only the representation is refined. So the kernel
> should report zero deviation. Forge's NURBS path implements Boehm single-knot
> insertion (NurbsCalculus A5.1), so this round-trips natively.
> `</think>`
>
> **(a)** New control polygon (6 pts): (0,0), (0.5,1), (1.5,2), (3.25,1.5), (3,2)→ wait,
> re-index: after inserting, the new net is **P0=(0,0), Q1=(0.5,1), Q2=(1.5,2),
> Q3=(3.25,1.5), P3=(4,0), P4=(5,1)** with original P2 absorbed; new knot vector
> U' = {0,0,0,0, 0.25, 0.5, 1,1,1,1}.
> **(b)** At u=0.5 the curve is **C²** (continuity = p − knot-multiplicity = 3 − 1).
> Curvature is continuous there.
> **(c)** Verify in Forge — build the original, insert the knot, assert identical eval:
>
> ```
> forge.surfacing.buildNurbsPatch({degreeU:3, degreeV:0, knotsU:[0,0,0,0,0.5,1,1,1,1],
>   ctrlPts:[[0,0,0],[1,2,0],[3,2,0],[4,0,0],[5,1,0]], weights:[1,1,1,1,1]})
> forge.surfacing.refineNurbs({insertKnots:[{dir:"U", u:0.25}]})
> forge.surfacing.eval({samples:64, compareToPreRefine:true, tol:1e-9})
> ```
> Expected: `maxDeviation < 1e-9` (knot insertion is exact), confirming the refined
> representation is geometrically identical — which is the whole point of inserting a
> knot (more local control without changing the shape).

*(Grounding: the control-point arithmetic is recomputed by the generator; the Forge
sequence is replayed and `maxDeviation` measured — sample kept only if < 1e-9.)*

### Sample 2 — G-BUILD: spec → manufacturable tool-call sequence (Tier I + CADGenBench shape/interface)

**Prompt (user):**
> Model a mounting bracket: an 80 × 50 × 6 mm steel base plate; four M6 clearance holes
> (Ø6.6 mm) on a 64 × 34 mm rectangular bolt pattern centred on the plate; a 30 mm-tall,
> 40 mm-wide vertical web rising from one long edge, 6 mm thick, with a 20 mm radius
> filleted transition where it meets the base. It will be CNC-milled from 6 mm plate.
> Keep it watertight and makeable.

**Ideal answer (assistant):**
> `<think>`
> Mill-from-plate ⇒ no draft needed; internal fillet at the web/base junction must be
> ≥ a real cutter radius — 20 mm is large but fine for a face mill; emit it as the LAST
> dressing op after the boolean so the blend surface trims cleanly. Holes are Ø6.6
> *clearance* for M6 (ISO 273 medium) — emit as a **rectangular pattern**, not 4 hand-
> placed holes (interface-axis: exact bolt-pattern positions). Build order: base
> extrude → web extrude (union) → fillet the concave junction edge → pattern the holes
> last (so the pattern references stable base faces). All dims snapped to the spec
> (no scale rescue). Reference the fillet edge by GeomType+position (the concave linear
> edge shared by the base-top and web-front faces), not an index.
> `</think>`
>
> Plan: base plate → vertical web (unioned) → 20 mm fillet at the junction → 4× Ø6.6
> clearance holes on the 64×34 pattern. CNC-from-plate, so no draft; fillet sized for a
> face-mill, applied last.
>
> ```
> forge.sketcher.createSketch({plane:"XY"})
> forge.sketcher.addRectangle({cx:0, cy:0, w:80, h:50})        // base footprint
> forge.sketcher.solve({})                                      // fully-constrained
> forge.part.extrudeProfile({dist:6, dir:"+Z"})                 // base plate, body=B0
> forge.sketcher.createSketch({plane:"XZ", offsetY:-25})        // web along one long edge
> forge.sketcher.addRectangle({cx:0, cy:18, w:40, h:30})        // 30 tall, 40 wide
> forge.sketcher.solve({})
> forge.part.extrudeProfile({dist:6, dir:"+Y", op:"union", target:"B0"})   // web fused
> forge.part.filletEdges({select:{geomType:"line", between:["base.top","web.front"],
>     concave:true}, radius:20})                                // junction blend, LAST
> forge.part.holeWizard({type:"clearance", standard:"M6", dia:6.6, depth:"through",
>     pattern:{kind:"rect", nx:2, ny:2, dx:64, dy:34, center:[0,0]}, ref:"base.top"})
> forge.heal.checkValidity({requireWatertight:true, requireManifold:true})
> forge.io.exportStep({path:"bracket.step", schema:"AP242"})
> ```
> Validity expectation: single closed 2-manifold solid (b₀=1), 4 through-holes
> (b₁=4), no voids (b₂=0). Makeability: all internal radii ≥ cutter, uniform 6 mm
> sections from plate, no undercuts → millable in 2 setups.

*(Grounding: replay → `checkValidity` must pass; bbox = 80×50×36, hole count = 4,
Betti (1,4,0) — sample discarded if any mismatch.)*

### Sample 3 — G-CRITIQUE: detect → repair an unmakeable / invalid body (Tier I + Pillar-D repair)

**Prompt (user):**
> Here is an imported STEP of a die-cast housing (handle H_in). FEA meshing failed and
> the mold engineer rejected it. Diagnose and fix the geometry, then confirm it's valid
> and castable.
> [attached: `forge.io.importStep` produced 1 shell, `checkValidity` reports 3
> self-intersections near a boss; faceCount jumps where two walls overlap; walls range
> 1.2–7.0 mm; the parting-line faces have 0° draft.]

**Ideal answer (assistant):**
> `<think>`
> Three independent defects: (1) **self-intersections** near a boss → invalid B-rep,
> blocks meshing and STEP-validity (root cause of the FEA mesh failure). (2) **Non-
> uniform wall** 1.2–7.0 mm → die-casting needs ~uniform walls (≈2–3 mm here);
> thin 1.2 mm sections risk cold-shut, 7 mm risks shrink porosity (Chvorinov: thick
> sections solidify last). (3) **0° draft on parting-line faces** → part can't eject.
> Fix order: heal validity FIRST (can't operate on an invalid body), then thicken/
> rebalance walls, then add draft, then re-verify. Heal before any feature op, per the
> kernel rule.
> `</think>`
>
> Diagnosis: (1) self-intersecting faces near the boss → invalid solid (this is why FEA
> meshing failed); (2) wall thickness varies 1.2–7.0 mm — not castable (cold-shut at
> 1.2, shrink porosity at 7.0); (3) zero draft on the parting-line faces — won't eject.
>
> Repair:
> ```
> forge.heal.autoRepairSelfIntersection({handle:"H_in"})        // fix (1) — restore valid B-rep
> forge.heal.sewShape({tol:1e-3})                               // close gaps from the repair
> forge.heal.checkValidity({requireWatertight:true})            // gate before editing
> forge.direct.faceCount({})                                    // confirm overlap faces resolved
> forge.part.shellMultiThickness({targetWall:2.5,
>     overrides:[{face:"boss.top", t:3.0}]})                    // fix (2) — uniform ~2.5 mm
> forge.part.draftFaces({about:"parting", angle:2,
>     select:{onSide:"both"}})                                  // fix (3) — 2° ejection draft
> forge.part.filletEdges({select:{geomType:"line", concave:true, maxRadius:0.8},
>     radius:1.0})                                              // soften sharp internal corners (Niyama)
> forge.heal.checkValidity({requireWatertight:true, requireManifold:true})
> forge.io.exportStepWithPmi({path:"housing_fixed.step", schema:"AP242"})
> ```
> After repair: valid watertight 2-manifold (meshes cleanly now), ~2.5 mm uniform wall
> (3.0 at the boss), 2° draft on both sides of the parting line, internal corners
> filleted → **castable and FEA-ready**. If `autoRepairSelfIntersection` cannot resolve
> a self-intersection (kernel limit on the trimmed-NURBS face it can't reconstruct), I
> would surface that explicitly and route the heal through the OCCT path rather than
> emit a fabricated patch.

*(Grounding: replay → `checkValidity` passes post-repair; min-wall ≥ 2.4 mm and all
parting faces have ≥2° draft are measured; the honesty branch is a real kernel-limit
sample, not invented.)*

---

## 5. SUCCESS CRITERIA FOR THIS CLUSTER (the gate before promotion)

1. **Forge-replay validity_rate ≥ 0.95** on a 200-part varied-prompt smoke (S1 gate),
   ≥0.99 after S8 RL — validity is requirement-zero.
2. **Shape ≥ 0.85 / Topology ≥ 0.85** (CADGenBench axes this cluster owns) on the
   held-out CADGenBench-style set — tracked **separately**, not as a mean.
3. **Refinement positive** — beat GPT-4o/Claude on multi-round edit (they score
   NEGATIVE / degrade designs); G-CRITIQUE + mrCAD traces are the mechanism.
4. **Makeability held** — G-BUILD outputs pass the DFM-geometry checks (cutter-radius,
   uniform wall, draft) at the rate set by the manufacturing cluster.
5. **Honesty held** — kernel-limit samples (unsupported NURBS read, concave-fillet
   skip, NURBS-pair mesh-fallback) surface the real limit; **no fabricated geometry**.
6. **No NaN-corrupted adapter** (drop `--mask-prompt` on long; NaN-guard); CI green;
   serve restarted fresh before any eval.

---

## 6. INTEGRATION (where this cluster sits)

- **Curriculum:** S0 math/NURBS-numerics → **S1 this cluster** → physics/mfg/etc. → S8
  DPO on ForgeCADScore (G-ORDER negatives = DPO pairs). Folds into
  `../../SCOPE_2026-06-21/programs/archie_corpus_program.md` Pillar B Cluster 1 +
  Pillar E.
- **bulk_synth module:** `bulk_synth_geom.py` (~1.5M unique) + `bulk_synth_cadgen.py`
  (`gen_validity/shape/topology`) + Pillar-A NURBS overlap (`bulk_synth_math.py` A3).
- **Kernel co-evolution:** the §1 judgment items are calibrated to the *current*
  audited kernel state (`../kernel/brep-nurbs.md`) — as Phase A/B/D/E land (inner
  loops, trimmed-NURBS read, NURBS SSI, analytic fillet), regenerate the affected
  generators so Archie's "what's exact vs mesh-fallback" knowledge stays truthful.
- **Eval:** `ForgeCADScore` (4 axes separately) + `forge_drive_smoke_14b_v2.py`
  (genuine CUA replay, varied prompts, ≥5 cam angles, headed) + DeepCAD/Fusion360
  recon comparability + CC3D OOD.

---

*Spec authored 2026-06-24 for the pure CAD/CAM/CAE 14B. Geometry is the validity
foundation under every other cluster; every geometric sample is kernel-replay-grounded
(ForgeCADScore-as-filter) and terminates in a replayable Forge op — the corpus teaches
Archie to DRIVE the CAD, not chat about it. Sources: in-repo Forge verb surface +
kernel audit + corpus program + parametric-CAD literature map; canon textbooks/courses/
standards distilled to answer-keys; datasets license-flagged (ABC/DeepCAD ship-OK,
Fusion360 scorer-only). Storage-safe streaming + bulk_synth-programmatic throughout.*
