# ARCHDISC MISSION BIBLE V2 — Forge + Archie (Expanded Scope)

**Status:** CANONICAL · re-issued 2026-06-21 · supersedes prior Forge/Archie briefs for the SCOPE_2026-06-21 program.
**Read FIRST every session.** This document is the single north-star for the Forge kernel, the Archie 14B model, the enterprise UI/UX, the grounded simulation suite, the manufacturability/PLM stack, and the CADGenBench attack plan.
**Assembled from** the four program docs (`programs/{kernel_parity,archie_corpus,uiux,cadgenbench}_program.md`) and the twelve research docs (`research/{p1ai,prometheus,cadgenbench,mecado,communities,parasolid_acis,manufacturing,sim_grounded,fields_direct,fields_indirect,fields_sister}.md`).

> **Operating doctrine for this scope:** *Leave nothing out of scope. No lite versions. No stubs, no fallbacks, no MVPs, no placeholders. Dynamic features only — transient/modal/forming/solidification/motion over static snapshots. Industrial-grade, verified/tested for real engineers. Codebase length is not a constraint.* If a dependency is missing, surface the real error (Bible §0/§9). Every capability is proven by HEADED Playwright e2e on the real app + kernel + model, ≥5 named camera angles, varied/distinct prompts each run; CI must be green between batches.

---

## 0. GOVERNING PRINCIPLE & NORTH-STAR

### 0.1 The Governing Principle — Archie drives Forge purely via CUA
ArchDisc is **two products that form one closed loop**:

- **Forge** — a professional MCAD/CAM/CAE desktop app (Electron + React + an in-house pure-C++20 geometry kernel `forge::native` that re-implements the union of OCCT + CGAL + libfive + PicoGK + Manifold; NO external CAD deps, NO WASM). It already has 70+ native kernel modules, FEA/CFD/MBD solvers, GD&T, and a CATIA-grade UI shell.
- **Archie** — a LOCAL 14B MLX model (Qwen2.5-14B-Instruct merged with DeepSeek-R1-Distill reasoning, engineering-LoRA fine-tuned) running on a Mac Studio M4 Max with 36 GB unified RAM.

**THE GOVERNING PRINCIPLE:** *Archie drives Forge **purely and only via computer-use (CUA)*** — a typed prompt enters the Archie console → the model emits schema-valid `forge.<workbench>.<op>(args)` tool-calls → Forge's kernel builds the part → render. The kernel, the UI, and the renders all exist **to serve that loop**. Builder scripts and `window.__forge*` composers are scaffolding, not the goal. Archie reaches Forge only through its console; manual UI clicks never post to Archie's thread. This is the same primitive Prometheus is building (Ace / `ace-control` VLA computer-control) and the same character P-1 ships ("Archie, the AI engineer agent") — but **local, offline, and grounded in an owned kernel**.

The corollary, owned by the UI/UX program: **every interactive surface must be dual-driven** — a React event path for the human AND a `window.__forge*` imperative entry + a `dispatchToolCall` verb for Archie, wired to the *same* reducer action (never two code paths). Archie must be able to operate **100% of the redesigned UI**; that is the precondition for the north-star run.

### 0.2 The North-Star — CADGenBench ≥ 0.85 on EVERY dimension
**Archie-driving-Forge must score ≥ 0.85 on CADGenBench (Mecado × Hugging Face) on the `validated` leaderboard tier, on EVERY dimension simultaneously — not a 0.85 mean:**

| Gate | Requirement |
|---|---|
| `validity_rate` | **≥ 0.97** (an invalid solid scores a hard 0 — requirement zero) |
| `shape_similarity` | **≥ 0.85** (mean of surface-distance-F1@0.5%bbox-diag/20°-normal + volume-IoU) |
| `interface` | **≥ 0.85** (KOR-empty/KIR-solid jig sub-volume IoU; worst-feature `min`-gating; 0.80→0.95 ramp) |
| `topology` | **≥ 0.85** (Betti product s₀·s₁·s₂) |
| `score_by_task_type.generation` | **≥ 0.85** (49 fixtures, `text+image`) |
| `score_by_task_type.editing` | **≥ 0.85** (32 fixtures, `text+step`, renormalized vs no-op cap ~0.4) |

Scoring (memorize):
```
Generation:  cad_score = 0.4·shape + 0.4·interface + 0.2·topology              (0 if invalid)
Editing:     s_renorm  = max(0,(shape−b_shape)/(1−b_shape))
             cad_score = 0.6·s_renorm + 0.3·interface + 0.1·topology           (0 if invalid; no-op caps ~0.4)
Pre-align:   rigid point-to-plane ICP only (rotation+translation, NEVER scale),
             over identity + 24 octahedral PCA poses.
```
**Public SOTA today is ~0.39–0.45 aggregate (Claude Fable 5 ≈ 0.4514).** The bar is ~2× the field, held structurally low by three unforgiving mechanisms: the hard validity ×0 gate, interface worst-feature `min`-gating, and multiplicative topology `s₀·s₁·s₂`. Clearing 0.85 on all six is a category-defining, Link-Ventures-grade claim — and it only counts scored through CADGenBench's exact gates. Mecado is a Link Ventures portfolio company and the named home-testing evaluator; alignment with Mecado is a diligence proxy.

### 0.3 The strategic moat (vs P-1 and Prometheus)
P-1 and Prometheus are the same thesis (a foundation model that drives modern CAD/CAE to design real hardware) with 100×–1000× the capital. ArchDisc's defensible wedge is **NOT capital, it is: (a) runs local + offline on a 36 GB Mac Studio (no cloud, no data egress, works behind any firewall); (b) an owned native BRep/CAE kernel with deterministic, verifiable geometry truth — the thing P-1 explicitly does NOT have (it orchestrates third-party CAD) and Prometheus has not publicly demonstrated; (c) a single integrated desktop app instead of orchestrating vendor tools.** The owned kernel lets us close the loop deterministically and offline, score geometry truth directly (ForgeCADScore), and *generate our own synthetic training data* — none of which the competitors can do without third-party licenses. **Canonical comparison line (deck/landing):** *Archie+Forge is the same "very, very modern version of CAD" thesis Bezos funded at $41B (Prometheus, $12B Series B, 2026-06-11) — but local, offline, on an owned kernel, with a published geometry-truth benchmark Prometheus has not shown.*

### 0.4 Prometheus parity fold — the FULL competitor scope, inside Archie's reach
Source of truth: `docs/SCOPE_2026-06-24/research/prometheus.md` (re-grounded against the 2026-06-11 $12B/$41B Series B and the first on-record Bezos+Bajaj interviews). Prometheus = a foundation-model **"artificial general engineer"** built on **world models** (rigorous physics, not just text), trained on **outcome-of-engineering-decision multimodal data** (CAD + simulation + sensor + experiment), wrapped in a **modern generative successor to SOLIDWORKS/NX/Fusion** (Bezos: *"a very, very modern version of CAD"; "nothing to do with robotics"*), driven by an **agentic VLA/computer-use core** (Ace / `ace-control`), fed by **robot-run physical experimentation**, and ultimately **vertically integrated into owned manufacturing** (~$100B fund). Its *entire* public scope is hereby declared **in scope for Archie+Forge**. The binding capability bar — the 9 things Archie-driving-Forge must demonstrably do:

1. From a **terse intent**, infer unstated requirements (tolerances, load cases, standard parts), **emit an assumptions ledger**, and produce **producible parametric CAD tool-calls** (not primitive blockouts). *(→ §2, §3; CAD-fidelity program.)*
2. **Predict physical behavior before building** (stress/modal/thermal/fatigue/buckling/CFD/MBD) and **reject/revise** designs failing a standards verdict — new op **`forge.simulate.failurePredict`**. *(→ §4.)*
3. **Quantify the consequences of an engineering decision** (alloy/tolerance/geometry change → mass/cost/stiffness/yield/thermal deltas) — Prometheus' key differentiator, generated by **`bulk_synth_outcome.py`** over Forge DOE sweeps. *(→ §2.1 Pillar D.)*
4. **Close the design loop as optimization** (propose → simulate → score → revise), with the **verified owned kernel as the reward oracle** — ArchDisc's *substitute for Prometheus' robot-lab feedback* (the strategic crux of the fold). *(→ §5, §6.)*
5. **Operate the app purely by CUA** — from text state and (VLA branch) from viewport pixels, like Ace/`ace-control`, but **local + offline**. *(→ §0.1.)*
6. **Design in full assembly/system context across disciplines** (structural+thermal+fluid+modal) — the "thousand minds"; new coupled-physics ops **`forge.simulate.coupled{thermoMechanical,fluidStructure}`** + field-reconstruction viewport overlays (the "airflow around a wing" demo). *(→ §4.3.)*
7. **Guarantee producibility** (DFM/tooling-feasibility/cost/CAM toolpaths). *(→ §5.)*
8. **Span Prometheus' domains**: aerospace/space (priority), automotive, mechanical/structural, semiconductor **mechanical/thermal/EM** (litho/process physics OUT of a CAD kernel). **Molecular/drug design = adjacent, low-priority, honesty-gated — NOT claimed.** *(→ §2.2.)*
9. **Prove it** with headed e2e + the published geometry-truth benchmark (**CADGenBench ≥0.85 every dim**) — the one thing Prometheus has **not** publicly done; this is the demonstrable moat. *(→ §0.2, §6.)*

**Deliberately scoped DOWN with honesty rationale (not omitted):** robot-lab experimentation (substituted by the verified kernel oracle, item 4); semiconductor lithography/process physics (out of a CAD kernel); molecular/drug design (adjacent, not claimed). All other Prometheus scope is fully folded in.

---

## 1. KERNEL 1:1 PARASOLID / ACIS PARITY

**Mandate:** rebuild the unified `forge::native` kernel to **1:1 functional parity** with **Siemens Parasolid (PK interface, ~900 fns / 677 unique `PK_*`)** AND **Spatial 3D ACIS (husk/api architecture, 35 husks)** — pure C++20, no new deps, no WASM, OCCT retained as foundation + parity oracle, retired **per-capability** behind a parity gate (never big-bang, never a stub). Parity = covering operation *classes* + per-class robustness, not literal symbol count.

**Strategy spine:** (1) OCCT-anchored, retire-per-capability — each batch ships on OCCT first (CADGenBench-scorable now), then the `native::` reimplementation lands behind a parity gate before the OCCT path retires. (2) CADGenBench-first leverage order: **validity → shape → interface → topology**. (3) Four `[GAP-HARD]` moats decide ≥0.85. (4) A formal **Euler-operator substrate** precedes everything in-house. (5) One heavy step at a time (M4 Max / 36 GB; kernel rebuilds wait for the GPU to be free of training). (6) Every native op emits lineage (`Modified()/Generated()/Deleted()`) **from the op itself** — the persistent-ID foundation.

### 1.1 The phased batches (acceptance-gated)
| Batch | Scope | Reimplements | CADGenBench axis |
|---|---|---|---|
| **B0 Validity substrate (CONTINUOUS, blocks all releases)** | B-rep validity (self-intersection, loop orientation, fin consistency, geometry-on-topology) + local op-output check; watertight closed-shell audit; manifold tessellation (every edge in exactly 2 tris); full heal (gap-close→sew→tolerant-edge-synth→sliver-removal→re-param). `validity_rate ≥ 0.95`. | OCCT `BRepCheck_Analyzer`, `BOPAlgo_CheckerSI`, `ShapeHealing` | **Axis 1 (Validity)** — a 0 zeroes the sample |
| **B1 Half-edge topology core + Euler operators** | `BODY→REGION→SHELL→FACE→LOOP→FIN(partner ptr)→EDGE→VERTEX` + wire/void bodies + exterior region; formal Euler API `{MEV,MEF,MVFS,MEKR,KEMR,KFMRH,expand,flatten,separate,combine}`; `disjoin/findFacesets`. | OCCT `BRep_Builder/TopoDS`; ACIS `EULR`+KERN; PK euler family | **Axis 4 (Topology)** — b₀ lumps, b₂ voids by construction |
| **B2 NURBS + analytic geometry engine (geometry pole)** | B-surfaces/B-curves rational + degree-elevate/remove/trim + G0/G1/G2; **pcurves** (param-space on faces) + **intcurves** (exact intersection curves); analytic plane/cyl/cone/sphere/torus + exact analytic↔analytic intersection; procedural lazy-eval surfaces (blend/offset/swept/spun). | OCCT `Geom_*`; PK B-geometry; ACIS spline | **Axis 2 (Shape)** — exact surfaces → exact dims |
| **B3 SS-intersector → exact booleans `[GAP-HARD #2]`** | Full SS/CS/CC intersector → exact intcurves+pcurves on **both** faces (the literal kernel core); B-rep boolean robust on degenerate/tangent; selective/graph-region booleans (`SBOOL`); local face-subset boolean; imprinting (curve/isocline/point with tag persistence). | OCCT `IntTools/BOPAlgo`; CGAL corefinement; ACIS `INTR`+`BOOL`+`SBOOL` | **Axis 2 (volume IoU)** + **Axis 4 (b₁ cut-holes)** |
| **B4 Blending engine `[GAP-HARD #3]`** | Const-radius rolling-ball fillet + **unfixed-blend-as-attribute**; variable-radius (linear + **conic**); chamfer (equal/two-dist/dist-angle/asym); **face-face blend** (G2 curvature-continuous, holdline, cliff-edge, notch, rib, multi-solution); setback/n-edge vertex corner blends; overflow handling. | OCCT `BRepFilletAPI`(`ChFi3d`/`BRepBlend`); ACIS `BLND`+`ABL`; PK FF-blend ch33 | **Axis 2 (fillet/chamfer radii)** |
| **B5 Sweeping, lofting, surfacing** | Sweep w/ guides/twist/scale law + self-intersect repair; loft/skin w/ per-profile derivative/tangency conditions + vertex matching + degenerate apex; extrude/revolve; emboss/pad/**wrap** (project+conform); cover/patch/N-sided G1 fill-hole; true tapered/variable-pitch **helical surfaces** (threads/augers/springs, ISO 261/ASME B1.1). | OCCT `BRepOffsetAPI_MakePipeShell/ThruSections`; ACIS `SWP`+`AS`+`COVR`; PK ch28 | **Axis 2 (Shape)** + **Axis 3 (threaded holes)** |
| **B6 Local/direct ops, shelling, offset, draft** | Shell/hollow w/ pierce+tangent-pierce + blend auto-removal; thicken w/ repair; offset surf/face w/ step + deselfx; draft (isocline steepness, neutral-plane vs parting-line); **tweak = replace-surface** (auto-extend/retrim); delete-face heal-wound; **feature-recognition defeature**; **midsurface extraction**; law-driven space-warp (bend/twist/taper/stretch); embed/wrap. | OCCT `BRepOffsetAPI`, `BRepTools_Modifier`, `ShapeUpgrade`; ACIS `LOP`+`REM`+`SHL`+`OFST`+`WARP` | **Axis 2** + feeds DFM/midsurface→shell |
| **B7 Patterns/features/sectioning/sew/mass-props/query** | Rib/web/boss recipes; hole-wizard w/ standards-driven **helical-thread B-rep**; patterns linear/circ/mirror/curve/**fill/table/skip** + **fast instanced boolean** (one-boolean-then-copy, ≥10× on 100-hole parts); tolerant sew/stitch/knit; sectioning (region/fence); convergent facet-in-boolean; full inertia tensor + principal axes; point-in-body, find-extreme, silhouette, uvbox; exact **clash** clear/touch/interfere/contained + interference volume. | OCCT `BRepGProp`, `BRepExtrema`, `BRepAlgoAPI_Section`, `BRepBuilderAPI_Sewing`, `BVH_Tree`; ACIS `CSTR`+`STITCH`+`CLR`+`INTR` | **Axis 3 (holes/bolt-circles/bosses/slots → KOR/KIR)** + **Axis 4 (counts → b₁)** |
| **B8 Operational paradigms `[GAP-HARD #4]`** | Native delta/mark/rollback bulletin-board + **partitions** (independent streams); **persistent topology IDs** w/ native lineage from the op → robust persistent-ID rebuild surviving topology change (solves FreeCAD topological-naming); general user-attribute system surviving ops; general symbolic **Laws engine** (parse/diff/eval, reused across blend/sweep/warp/pattern/lattice-grading); **deformable/freeform** (load/constraint-driven CP solve, multi-surface C1); subdivision (Catmull-Clark/Loop limit). | OCAF transaction/undo, `TDataStd`; ACIS `PID`/roll/`GA`/`LAWS`/`ADM`; PK `MARK`/`DELTA`/`PARTITION` | **Axis 4 (editing-task topology stability)** |
| **B9 Cellular/general/non-manifold + tolerant modeling `[GAP-HARD #1]`** | **Per-entity tolerant modeling** (per-edge/vertex tolerance band + tolerant intersect/snap); **tolerant booleans** on dirty imports; **cellular topology** (region cells for FE mesh/mixed material); **general/non-manifold** bodies (wire-as-hole, acorn vertices, internal partition faces); **convergent/facet** unified B-rep ∪ mesh (analytic + facet faces boolean/blend/offset together). | CGAL Nef_3 concept; Manifold (facet side); ACIS tolerant EDGE/VERTEX/`CT` | **Axis 1 (dirty-import validity)** + **Axis 2/4 (edit fixtures)** — the #1 Parasolid moat |
| **B10 Lattice/implicit/AM + faceter/HLR** | Beam/strut graph lattices, conformal lattices, **lattice→B-rep skinning**, grading fields (on `voxel::Tpms` gyroid/schwarz/diamond); curvature-adaptive **crack-free B-rep faceter** (independent of OCCT) + native **hidden-line (HLR)** for drawings; subdivision organic modeling. | PicoGK/libfive (partly HAVE) + OCCT `BRepMesh`/`HLRBRep`; ACIS `FCT`+`PHL/IHL` | **Axis 1 (faceter feeds tessellation gate)** + AM flagships |
| **B11 Interop completeness** | **AP242 PMI/GD&T semantic round-trip** (wire the bound-not-wired PMI; write semantic FCFs, not annotation curves) + native STEP writer; IGES; **JT read/write** (ISO 14306; tessellated + B-rep + PMI + LOD); **Parasolid XT/XB + ACIS SAT/SAB** read/write (the MCAD lingua franca + history markers); STL/OBJ/**3MF**(beam-lattice ext)/AMF/glTF; DXF/SVG/PDF + **DWG**; native assembly graph (transforms/shared-master-B-rep/partition-scoped rollback). | OCCT `TKDESTEP(AP242)/TKDEIGES/TKDESTL/XCAF`; ACIS InterOp | **all axes via STEP I/O** + **Axis 3 (AP242-PMI interface scoring)** |

### 1.2 The four `[GAP-HARD]` moat poles that decide ≥0.85
1. **Tolerant modeling + tolerant booleans + full heal** (B0, B9) — the #1 Parasolid moat; imported-STEP validity + editing fixtures.
2. **SS-intersector → exact intcurves/pcurves → boolean robustness** (B2, B3) — volume IoU (Shape) + cut-hole counts (Topology); the literal kernel core.
3. **Face-face + variable-radius + setback blending** (B4) — correct fillet/chamfer radii bleed Shape F1+IoU; Class-A.
4. **History/rollback/marks/partitions + persistent-ID rebuild** (B8) — editing-task topology stability; solves FreeCAD topological-naming.

Plus four foundational/per-batch poles: convergent/facet ∪ B-rep + lattice→B-rep (B9/B10); defeature/FR + midsurface + deformable (B6/B8); interop XT/SAT/JT/AP242-PMI (B11); cellular/general/non-manifold + Euler substrate (B1/B9).

**Program-level DoD:** ForgeCADScore ≥ 0.85 on every axis on the 81-fixture mirror corpus, `validity_rate ≥ 0.95`, each batch lineage-emitting + parity-gated + headed-e2e demonstrated.

---

## 2. ARCHIE 14B CORPUS — all ~60 fields, four pillars

**Thesis:** Train ONE local 14B (Qwen2.5-14B + DeepSeek-R1 reasoning, 4-bit qLoRA, 36 GB ceiling, storage-safe streaming) to be a junior-to-expert engineer that drives Forge purely via CUA, trained *fully and only* on four pillars, **every sample terminating in one or more schema-valid `forge.<wb>.<op>(args)` tool-calls the kernel can replay** (geometry-truth scorable).

**Adapter topology (mirrors P-1's federation):** one **foundational** adapter (math + logic + cross-field reasoning) → **per-cluster** LoRAs (CAD-gen, CAE-physics, manufacturing, data-graph/PLM, sister-fields, mechatronics) → optional specialist merges, routed per-request via the proven 2-brain `adapters` serve pattern. A **Qwen2.5-VL** vision branch (eager-RoPE fix, ~26 GB peak, trained alone) handles drawing→intent. A late **"lobotomized" structured-IR encoder** pass pushes Archie from English toward the design-graph IR (component + param + functional/spatial topology → tool-call sequence).

**Mandatory data hygiene:** (a) bulk_synth programmatically (agents top out at 40–60 samples vs 13k+/run); (b) strict download→process→delete + parquet `iter_batches` + accumulator-dedup (M4 Max storage was nearly killed once); (c) **never `--mask-prompt` on long corpora** (all-masked → NaN → silent adapter corruption) — guard loss + NaN per run; (d) every sample carries the chat template Archie was trained on; (e) honesty — teach Archie to surface verified limits (e.g. unverified turbulent CFD), never fabricate.

### 2.1 The four pillars
- **Pillar A — Math / Logic / Deepest Reasoning** (`bulk_synth_math.py`, `bulk_synth_numerics.py`): linear algebra (LU/Cholesky/QR/SVD, eigen QR/Lanczos/Arnoldi, κ; sparse multifrontal vs CG/MINRES/GMRES/BiCGStab + preconditioners); nonlinear ODE (Newton-Raphson line-search/trust-region/**arc-length Riks** for snap-through; RK45 Dormand-Prince vs BDF vs **HHT-α/generalized-α**); quadrature/interp (Gauss-Legendre, Cox-de-Boor/de-Boor/knot-insert, FFT, adaptive Simpson); proof/logic/dimensional-analysis + SAT/CSP + interval/constraint propagation; AMR + ZZ/residual estimators + h/p/hp + locking cures (Wilson-Q6/B-bar/EAS). Verified against MMS / Richardson-GCI / ASME V&V 10/20.
- **Pillar B — All ~60 engineering fields** (5 cluster generators, §2.2): research (c)-equations are the answer keys, (d)-topics are the questions, (b)-named ops are the tool-call targets.
- **Pillar C — Manufacturing / DFM / CAPP / Auto-MBD / PLM** (`bulk_synth_mfg.py`): the 101 numbered rules; per-process generators + DFMA + CAPP + semantic-PMI + the `forge.mfg.autoProcess` single-intent payload + the autonomous-PLM `forge.plm.*` sequence. **Highest-leverage for CADGenBench interface axis** (semantic PMI + auto-datums + MMC clearance bonus).
- **Pillar D — P-1 / Prometheus eAGI capability** (`bulk_synth_eagi.py` + **`bulk_synth_outcome.py`**): three primitives × six cognition levels + flagship workflows (§5) + the **outcome-of-decision corpus as a FIRST-CLASS generator** — paired `(design-change → Forge-simulated outcome)` samples over parametric DOE sweeps (alloy/tolerance/geometry change → mass/cost/stiffness/yield/thermal/modal deltas). This is Prometheus' key differentiator (training on the *consequences* of engineering choices), grounded in the owned deterministic kernel. Train the **reason→simulate→verify** control flow: Archie predicts behavior qualitatively, calls the Forge solver, then reconciles — never asserts a physical result it has not had the kernel verify.
- **Pillar E — CADGenBench-targeted** (`bulk_synth_cadgen.py`): drawing→parametric (text+image), KOR/KIR jig-feature, STEP-edit surgical-delta, topology-count drills (§6).

### 2.2 The five field-cluster generators (Pillar B — all ~60 fields)
- **Cluster 1 — CAD Geometry & Modeling** `bulk_synth_geom.py` (~1.5M unique): Computational Geometry, CG/Geometric-Modeling/NURBS, Industrial-Design/Class-A, Reverse-Eng/Metrology. Answer keys: Shewchuk robust predicates (orient2d/3d, incircle/insphere + FP filters), convex-hull/Delaunay/Voronoi, Bentley-Ottmann, Minkowski/straight-skeleton offset; NURBS knot-ops/SSI tracing/Catmull-Clark/Loop, QEM, LSCM/ARAP; ICP/FPFH/RANSAC, Poisson/BPA; G0–G3 continuity, zebra/curvature. Tool-calls: `forge.cg.*`, `forge.nurbs.*`, `forge.surf.classA`, `forge.reveng.*`, `forge.cmm.fit/evaluateFCF`. **Robust predicates defend validity + topology** (fix the empty-geometry-after-~30-subtractions fragility).
- **Cluster 2 — CAE / Physics** `bulk_synth_physics.py` (~2M unique, **dynamic-first**): FEA, CFD, MBD, Aeroacoustics, Electromagnetics, Structural, Fracture/Fatigue, Kinematics, Tribology + Materials/Metallurgy/Polymer property feeds. Answer keys: `[K]{u}={F}`, `([K]−ω²[M])φ=0`, Newmark/HHT-α; Navier-Stokes + SST k-ω blending + y⁺ + CFL; index-3 DAE `[M Φqᵀ; Φq 0]{q̈;λ}={Q;γ}`; FW-H/Lighthill + BPF; Maxwell + Steinmetz `P=k f^α B^β`; Euler buckling, von Mises, Mohr; Paris `da/dN=C(ΔK)^m`, Basquin/Coffin-Manson, Goodman, Miner, FKM 7th-ed; Gruebler DOF, involute, AGMA; Hertz/Archard/Reynolds/Stribeck. Tool-calls: `forge.fea.*`, `forge.cfd.*`, `forge.simulate.multibodyDynamics`, `forge.aeroacoustics.*`, `forge.emag.*`, `forge.struct.*`, `forge.fatigue/fracture.*`, `forge.kinematics.*`, `forge.tribo.*`, `forge.material.*`. **Honesty injection** on turbulent CFD.
- **Cluster 3 — Manufacturing & Manufacturability** `bulk_synth_mfg.py` (= Pillar C): DFM/DFMA, DfAM, Mold/Die, CNC/G-code, Sheet-metal, Injection, Casting/Forging, Welding, Topology-Opt, Generative/Implicit, CIM/CAPP. Answer keys: corner-radius 130%/6:1, depth 3:1/6:1, draft 1–2°/2–3°, Niyama G/√R, Chvorinov modulus, Cross-WLF/Tait/Folgar-Tucker, K-factor BA, min-bend nT, 45°/process self-support, AWS fillet 0.707·leg, SIMP ρ^p p=3, TPMS gyroid implicit. Tool-calls: `forge.mfg.autoProcess`, `forge.manufacturing.dfm.{machining,casting,injection,sheetmetal,additive,welding,forging}`, `forge.capp.plan`, `forge.dfam.*`, `forge.am.*`, `forge.topopt.*`, `forge.implicit.*`, `forge.cim.recognizeFeatures`.
- **Cluster 4 — Data-Graph / Lifecycle** `bulk_synth_plm.py` (~1M): PLM, PDM, CM, ERP, MES, SCADA, Digital-Twin, Virtual-Commissioning, IIoT, BIM, GIS + indirect Systems-Eng, Requirements, QA/TQM, Lean, OR, RAMS, FMEA, Compliance, LCA, PM, Facility-Layout. Answer keys: ISO 10303/AP242, EBOM→MBOM + effectivity algebra; MRP gross-to-net + Wagner-Whitin; ISA-95/88 + OEE; swinging-door historian + Modbus/DNP3/OPC-UA; AAS/FMI co-sim master + EKF/UKF; MQTT/Sparkplug-B; SysML v2/ReqIF/EARS; SPC + Cp/Cpk + Gage-R&R; VSM/takt/SMED; LP/MIP simplex + branch-and-cut + job-shop + TSP/VRP + DES; Weibull/RBD/FTA-cutsets/Markov; AIAG-VDA 7-step + Action-Priority; ASME-VIII wall + stress-linearization; ISO 14040/44 GWP; CPM/EVM. Tool-calls: `forge.plm/pdm/cm/erp/mes/scada/twin/vcommission/iiot/bim/sysml/reqs/spc/lean/or/rams/fmea/reg/lca/pm/layout.*`.
- **Cluster 5 — Robotics / Mechatronics / Inspection** `bulk_synth_mechatronics.py` (~0.8M): Industrial Automation & Robotics, Mechatronics, Metrology/CMM, NDT, Human-Factors/Ergonomics, GD&T, Tolerance-Stack. Answer keys: DH/FK, Pieper-IK + DLS, Jacobian/singularity, RRT*/PRM + GJK/EPA, recursive Newton-Euler, S-curve; LQR(Riccati)/pole-placement/Ziegler-Nichols, Bode/margins, Tustin; ISO 26262 ASIL/FMEDA/FTA; LSQ-vs-min-zone-Chebyshev, GUM uncertainty, DMIS; UT N=D²/4λ, PAUT focal laws; RULA/REBA/NIOSH RWL; ASME Y14.5-2018 (14 char/5 cat, MMC bonus, DRF 3-2-1); worst-case/RSS(√n)/Monte-Carlo + Cp/Cpk + 3.4 PPM. Tool-calls: `forge.robotics/mechatronics/cmm/ndt/ergo/gdt/tolstack.*`.

### 2.3 Curriculum S0→S8 (storage-safe, one heavy step at a time)
S0 `arch14b-math` (Pillar A; analytical-gate ≥0.90, no NaN) → S1 `arch14b-geom` (Cluster 1 + Pillar-E validity/shape/topology; replay validity ≥0.95, shape/topo ≥0.80) → S2 `arch14b-physics` (Cluster 2 dynamic-first + eAGI eval; L1–L3 ≥0.85) → S3 `arch14b-mfg` (Cluster 3 + Pillar-C autoProcess/PLM + Pillar-E interface; interface ≥0.85) → S4 `arch14b-data`/`-mech` (Clusters 4&5 + eAGI repair; L4–L5 ≥0.80) → S5 `arch14b-vlm` (Pillar-E drawing2cad + stepedit + assembly-context triples; gen ≥0.80 dry-run, edit s_renorm>0) → S6 `arch14b-eagi` (Pillar-D full + outcome-pairs + flagships; L6 via LLM-judge) → S7 structured-IR encoder pass → S8 DPO on ForgeCADScore-ranked pairs (full CADGenBench ≥0.85 EVERY axis, gen AND edit). Promote a stage only when its gate is green AND no NaN; restart serve fresh before any eval (output degrades over a session).

**Eval/gauntlet:** `gauntlet_staged.py` extended to the eAGI 6 levels (L1–L3 objective, L4–L5 sim-augmented heuristics, L6 LLM/Agent-as-judge + expert-in-loop); ForgeCADScore tracks the 4 axes **separately** (a 0.85 mean with weak interface FAILS); `forge_drive_smoke_14b_v2.py` genuine-CUA replay with varied prompts + ≥5 cam angles; held-out DeepCAD/Fusion360/ABC + the 81 CADGenBench public fixtures; human-cohort curve (entry/average/expert).

**Data sources (CC0/clean, IP-hygiene per Mecado):** DeepCAD (~150k/8k) + Fusion360 Gallery + ABC + CADGenBench public inputs (`HuggingAI4Engineering/cadgenbench-data`, ODC-BY) + open-standards text (ISO 10303/AP242, IFC, ISA-95/88, ASME Y14.5, AISC/ACI/Eurocode/FKM/AWS — cite, don't scrape) + Poly Haven CC0 (photoreal branch). **Synthetic dominates** — the physics-grounded Forge-labeled engine, which we do better than P-1 because the kernel is owned/offline/deterministic.

---

## 3. ENTERPRISE UI/UX REDESIGN

**North-star tie-in:** the UI is the surface Archie's CUA *operates*. Every redesign item must (a) make a 10-hour-shift seat for a human engineer AND (b) be driveable by Archie's tool-call loop. **CAD as a visual database:** the feature tree is the schema + transaction log; the viewport is the materialized view; a sketch is a constraint-satisfaction solve; a dashboard ghost is a speculative recompute not yet committed. Every surface is a read (highlight/measure/tree), a write (commit a feature transaction), or a what-if (ghosted preview).

**Design rule (load-bearing):** every new interactive surface ships with BOTH a React event path (human) AND a `window.__forge*` imperative entry + a `dispatchToolCall` verb (Archie), wired to the same reducer action — never two code paths. Verified by `forge-cua-parity.spec.js`.

### 3.1 The six phases (dependency-ordered)
| Phase | Theme | Gates on | Headline deliverables |
|---|---|---|---|
| **U0** Foundations & brand-safety | nothing | 5 information-bearing sketch-state tokens (the only sanctioned chromatic break); fix dead `high-contrast` theme branch; **purge orphaned UI** (`RibbonToolbar.jsx` 140-button glyph anti-pattern, `SwUxOverlays`, dead CSS) + CI guard; draggable `PanelSplitter.jsx`; `keymap.js` single source of truth; **CUA-parity harness**. |
| **U1** Modal sketch sandbox (highest adoption, P0) | U0 | `SKETCH_MODE` reducer choreography; `SketchPlanePrompt.jsx` ("where do you want to draw?" plane ghosts); ribbon lockdown; auto normal-to camera (<400ms); sketch-mode context wheel. CUA: `sketch.new({plane})` reaches `ENTER_SKETCH`. |
| **U2** Constraint truth + color-coded DOF (P1) | U1 + kernel solver residuals | **solver-true per-point residual DOF** + per-entity status; auto-weak inference; per-entity blue/black/red/brown/gray; `ConstraintGlyphs.jsx`; DOF badge → Archie reads "fully defined" in `__forgeSelectionContext`. |
| **U3** Contextual dashboards + real-time ghost (P0, most visible enterprise gap) | **kernel preview path** | live translucent **ghost preview** in `ToolParamDialog.jsx` (debounce ~120ms `forge.preview.<op>`); `MiniToolbar.jsx` cursor-anchored; reference collectors (typed face/edge/plane pickers); commit→tree-node flash. CUA: `op.preview(args)` returns tessellation + validity flag → Archie checks before committing (direct lever on Invalidity Ratio). |
| **U4** History time-travel + expressions (P0/P1) | **kernel replay + persistent topo-ID** | `recomputeUpTo/recomputeFrom`; regression visual state (downstream vanish, tip ghost); edit-upstream→ripple recompute re-binding by persistent IDs; rebuild-error surfacing (red △! + "what broke"); insert-here/freeze band; **expressions/parameters table** (`EquationManager.jsx`, `height=width*0.6`). CUA: `param.set/get` — how Archie produces parametric output that opens with a clean editable tree. **The literal answer to community gripes #3/#4.** |
| **U5** Power-user UX, assembly, snapping, query | U1 | flick/mark wheels; single-key alphabet + chord numeric (`E 2 5 ↵`); edit-in-context assembly fade; OSNAP-grade snapping (intersection/quadrant/nearest + alignment inference); QuickPick + selection-filter strip; status-bar completeness (live X/Y/Z cursor readout, DofCell, dual-unit); query/measure + user datums + ViewCube + sections + display-style + Command-Finder. |

### 3.2 The three kernel asks the UI program declares (owned by the kernel program)
1. `window.forge.sketcher.solve` → per-point residual DOF + per-entity status (blocks U2; small).
2. `window.forge.preview.<op>(args) → {positions,indices}` side-effect-free (blocks U3.2; medium).
3. `recomputeUpTo / recomputeFrom + persistent topological IDs` (blocks U4; large — the topological-naming solve, the #1 community gripe).

**DoD:** G1–G15 closed; every surface dual-driven and asserted by `forge-cua-parity.spec.js` (Archie operates 100% of the UI); monochrome brand uninvadable (only chromatic break = the 5 sketch-state tokens); a 10-case edit-stability regression suite green; all phases HEADED-Playwright at ≥5 cam angles, CI green between phases.

---

## 4. GROUNDED DYNAMIC SIMULATION

**Mandate:** every simulation Forge renders ON the model must be *grounded* (driven by a real, verified numerical solver — never a decorative colormap), *fully-visual* (field-on-geometry, GPU-accelerated, Ansys/Abaqus-grade post), and *fully-dynamic* (time-resolved — NO statics: deformation animates, flow advects, mechanisms move, modes oscillate). **Honesty contract:** a field is rendered only when the solver ran, converged, and has a characterized error vs an analytical/benchmark truth; if the kernel is offline or diverged the pipeline returns `{error}` and paints nothing (`caeViz.js` `kernel()` guard is canonical — never fabricate physics).

### 4.1 The validated solver floor (build ON, do not duplicate)
Linear static FEA (hex8 Wilson-Q6 incompatible-modes, **0.33%** vs PL³/3EI) · Modal (consistent mass, **0.2%**) · Transient (Newmark-β ¼,½) · Steady thermal (∇·(k∇T)+q=0, **0%**) · Buckling (geometric-stiffness eig, within Euler band) · Fatigue (rainflow ASTM-E1049 + Basquin/Goodman/Miner) · J2 plasticity (radial-return Simo-Hughes, machine-ε) · Incompressible CFD (Chorin projection / Harlow-Welch MAC, ∇·u→1e-13, **LAMINAR only**) · **Multibody dynamics** (index-3 DAE, HHT-α + Baumgarte, pendulum **0.016%**, rotor 0.00%) · GPU post-processor (turbo contour, nodal averaging, streamlines, deformed-shape, modal animation).

### 4.2 The gaps to close (this scope)
(1) **Turbulent/RANS CFD** — SST k-ω blending + y⁺ + boundary-layer prism mesh (the one acknowledged hole; honesty-flagged in corpus until verified). (2) **Hertz contact** validation (Lagrange + refine; currently 59% off, ILLUSTRATIVE). (3) Contact-pressure magnitude physicality. (4) **Transient CFD animation** (particle advection, pathlines/streaklines, LIC/UFLIC, volume ray-march). (5) **FSI** (fluid↔structure). (6) **Electromagnetics + acoustics** solvers (Maxwell, FW-H/Lighthill). (7) **AUTO-MBD** — mechanism auto-extraction from assembly mates. (8) GPU compute pipeline (Metal/WebGPU, M4 Max 40-core GPU) for ≥60 fps on big fields (element-K assembly, PCG mat-vec, MAC projection, particle advection move to compute shaders). (9) **Swept-volume / motion-capture trajectory** rendering (trajectory ribbons + swept volumes via kernel boolean → collision/clearance). (10) **Close-loop redesign** — Archie interprets a field result and acts (re-sim). **(11) `forge.simulate.failurePredict` [Prometheus-fold]** — one op binding FEA/fatigue/buckling/thermal into a *predict-failure-before-manufacture* verdict (FoS field + hot-spots + first-failure mode + pass/fail vs named standard) so Archie can reject a design pre-build. **(12) `forge.simulate.coupled{thermoMechanical,fluidStructure}` [Prometheus-fold]** — explicit coupled-physics workflow ops for cross-discipline trade-offs (the "thousand minds" multidisciplinary design). **(13) Field-reconstruction viewport overlays [Prometheus-fold]** — streamlines + pressure/temperature/stress fields as renderable meshes bound to multi-cam headed e2e (Prometheus' literal "airflow around a wing" demo).

### 4.3 The universal pipeline
`PRE (tet10 + boundary-layer prism, curvature-adaptive, face-based BC tagging) → SOLVE (Eigen sparse direct + in-house PCG; Lanczos/subspace for large eigen; Metal compute offload) → FIELD (nodal averaging + super-convergent patch recovery SPR/Zienkiewicz-Zhu + free error estimator η → adaptive remesh; derived σ₁₂₃/ε/FoS/∇T/q/vorticity/**Q-criterion**/λ₂/Cp/τ_w/Mach) → MAP (per-vertex contour, deformation morph, GPU marching-cubes iso-surface, glyphs/tensor-ellipsoids, RK4 streamlines/pathlines/streaklines, GPU particle pool, LIC, cut-planes/volume ray-march, trajectory ribbons/swept volumes) → RENDER → DYNAMICS (time playback / real-time advect / morph / motion-capture of moving parts)`. Materials extend to anisotropic Cᵢⱼₖₗ, temperature-dependent E(T), hyperelastic (Neo-Hookean/Mooney-Rivlin/Ogden).

This is the engine behind the eAGI **Design EVALUATION** primitive (`forge.simulate.*` full multiphysics performance vector: FoS/modes/ΔT/ΔP/mass/cost/carbon in one call) and the outcome-of-decision corpus (the owned-kernel advantage P-1 must license third-party sim for).

---

## 5. MANUFACTURABILITY + AUTO-MBD + AUTONOMOUS PLM

**Mandate:** every Forge model must be **real-world makeable**, not just renderable. Consolidate to ONE `forge::manufacturing` C++ namespace for geometry-truth checks (access, draft, thickness, undercut, flat-pattern) + ONE `forge.mfg.*` JS facade Archie calls; collapse the 3 PLM stacks into one `forge::plm` item-graph with file-backed persistence.

### 5.1 Per-process DFM/DFMA engines (the 101 numbered rules)
Each process emits a structured `DFMReport` (`{process, ruleId, severity, faceIds/edgeIds, measured, threshold, message, autoFixVerb?}`; any `error` blocks "release"):
- **CNC machining** `forge::manufacturing::dfm::machining` (access-cone face-normal queries, concave-edge radius, ray-cast tool-reach, medial-axis thin-wall): internal corner r ≥ 1.3× tool_radius + r ≥ depth/6; pocket depth ≤ 4× tool_dia (3:1 std, 6:1 cost); min wall 0.8 mm metal / 1.5 mm plastic, aspect ≤15:1; undercut detection via access cones (+30–50% cost); deep holes >10×Ø (peck); tolerance feasibility (mill ±0.025 / precision ±0.0125 mm); material `K_c` coupling.
- **Casting** `forge::manufacturing::dfm::casting` (layered on the enthalpy-FD `solidify` solver + Niyama): draft 1–2°/2–3°; wall thick:thin ≤3:1; fillets ≥0.5–1.0 mm; per-alloy shrink (Fe 1.0%, Al 1.3%, steel 2.0%); **dynamic hot-spot** from the solidification-time field; Chvorinov modulus M=V/A riser sizing (riser M ≥ 1.2× section M); cores/undercuts; fluidity min section.
- **Injection molding** `forge::manufacturing::dfm::injection` (+ moldflow): wall 1.2–3.5 mm material-specific + uniform ±10%; draft ≥1–2°/side (+1°/0.025 mm texture); rib ≤50–60% nominal; boss design; **sink-mark** prediction; **weld-line** prediction (flow-front advance, 10–60% knockdown); gate Ø ≈0.5–0.75×wall + runner sizing; undercut→side-action; cooling uniformity; **dynamic L/t fill** feasibility.
- **Sheet metal** `forge::manufacturing::dfm::sheetmetal` (on `flatPattern`/K-factor): bend relief, edge-distance, min radius, hole-to-bend, K-factor bend allowance.
- Plus **AM/DfAM** (45°/process self-support, overhang, lattice, support optimization, process-distortion), **welding** (AWS fillet 0.707·leg, joint access, distortion), **forging**.

### 5.2 CAPP, Auto-MBD, the auto pipeline, autonomous PLM
- **CAPP** `forge.capp.plan`: feature recognition → operation sequencing → setup planning (from access-cone reorientation count) → tool selection → fixturing.
- **Auto-MBD / semantic PMI** (`forge::native::gdt` is eval-only today — add **authoring** + a **semantic PMI graph**): auto-datum selection (3-2-1 DRF), FCF authoring per ASME Y14.5-2018 / ISO GPS, MMC bonus, tolerance-stack auto-driven from the PMI graph (worst-case/RSS/Monte-Carlo + Cp/Cpk). **The CADGenBench interface-axis lever.**
- **Auto model→process pipeline** `forge.mfg.autoProcess`: single-intent payload → recognize features → pick process → run DFM → emit makeable verdict + cost/cycle-time + drawing/g-code/PMI.
- **Autonomous pre-manufacturing PLM** `forge.plm.*`: one `forge::plm` item-graph (EBOM→MBOM, effectivity, versioning, config management) with file-backed persistence → vendor handoff `buildVendorPackage` ZIP (drawing + g-code + cost + DFM).

This stack is Pillar C of the corpus and the in-distribution path for Prometheus' "manufacturing constraints / tooling feasibility" and P-1's compliance step (ASME BPVC/Y14.5, AISC 360, ACI 318, AHRI, UL, MIL-STD, ISO/ASHRAE, Eurocode — Forge already has the calculators; wire them into Archie's compliance step).

---

## 6. CADGENBENCH PROGRAM (the north-star attack plan)

**Milestone 0 — `ForgeCADScore v2` (build FIRST):** a faithful local re-implementation of all four axes (`forge-bench/cadgenscore/`) that replays Archie's tool-calls through the real kernel and scores per dimension. Pipeline: **replay** (real kernel `output.step`, no fallback) → **validity gate** (`BRepCheck_Analyzer.IsValid()` + watertight + manifold `3F=2E`; fail ⇒ score 0; advisory min-face-area/aspect/tolerance) → **rigid ICP** (identity + 24 octahedral PCA poses, point-to-plane, **never scale**) → **shape** (surface-F1@0.5%bbox-diag/20°-normal + volume-IoU via `meshBooleanNative`) → **interface** (KOR-empty/KIR-solid IoU, ±1°/±1% pose, ramp 0.80→0.95, group `min` / sample `mean`) → **topology** (b₀ union-find, b₂ ray-cast, b₁=b₀+b₂−χ/2, per-axis `((min+1)/(max+1))²`, **product** s₀·s₁·s₂) → upstream-schema `result.json`. Reproduce the canonical worked example `0.4·0.89+0.4·0.00+0.2·1.00=0.56` (shifted-slot mounting plate) to ±0.01; build an internal GT mirror corpus (jigs/bolts/slots/bosses/pockets + the 7 failure-mode fixtures: wrong-spacing/missing-hole/wrong-diameter/narrow-slot/offset-slot/rotated-boss/shifted-holes).

**Leaderboard-attack order (leverage ÷ cost):** M0 harness → **M1 Validity lockdown** (DIM-1, `validity_rate≥0.97`; kernel a2/a4/b15/c6/c17 + BRepCheck+heal on every export) → **M2 Topology-by-construction** (DIM-2, axis ≥0.90; kernel a2/b2/c15 + count-drill corpus) → **M3 Shape fidelity + generation** (DIM-4/DIM-5, ≥0.85; kernel a6–a18/c5 + drawing→STEP corpus + VLM) → **M4 Interface mating** (DIM-3, ≥0.85, corrected fixtures ≥0.95 IoU/region; kernel a21/a22/c7/c14 + KOR/KIR assembly-context corpus — the make-or-break, highest-weight axis) → **M5 STEP-editing** (DIM-6, ≥0.85, s_renorm>0 all fixtures; kernel a23–a25/b9/b13/c1/c6 + surgical-delta corpus — the hardest kernel frontier) → **M6 all-axis convergence + self-correction loop** → **M7 validated public submission** (Rabinovich methodology review).

**Self-correction loop (the CUA mirror of the baseline agent):** after each tool-call, feed Archie (a) `BRepCheck` validity + watertight/manifold, (b) Betti b₀b₁b₂, (c) volume + bbox vs target, (d) an ISO render PNG — wire Forge's render-feedback to share one path with the `ForgeCADScore v2` validation packet. The loop is the difference between "great shapes, leaky solid (0)" and "converged to valid + correct."

---

## 7. MECADO ALIGNMENT

Mecado (Cambridge MA / MIT; founders Elie Cuevas + Dylan Ryan, advised by Blake Courter ex-SpaceClaim/nTopology; CADGenBench tech lead Michael Rabinovich @ Hugging Face; investor **Link Ventures** — the user's pitch-deck fund) is a **data + evaluation** company, the named home-testing evaluator and a Link Ventures diligence proxy. Their ideology is the bar Forge/Archie are graded against: *"manufacturable accuracy over visuals"* — "real parts that bolt up and can be made," not pretty meshes; "the majority of the world's engineering data is locked in proprietary silos." To win the partnership Forge/Archie must (1) score highest on CADGenBench, (2) **emit STEP/B-rep, not mesh** (the high-trust watertight-BREP gate that proves kernel-grade output), and (3) ingest/produce Mecado-grade artifacts losslessly (STEP, B-rep, drawings, PMI) via a tool-agnostic submission path (`output.step` + `meta.json`, zip → HF Space Submit) that drops straight into their pipeline. IP hygiene per Mecado: CC0/synthetic/licensed only, never scrape proprietary GrabCAD/3DContentCentral.

---

## 8. COMMUNITY TRENDS (what engineers actually want)

From `research/communities.md`, the field's emerging requirements — each a Forge/Archie target:
- **R1 / A1 — AI must emit PARAMETRIC B-rep via tool-calls, never mesh** (Zoo.dev's "parametric recipe": sketches+constraints, dimensions encoding intent, named features, patterns/mirrors/references → real kernel ops; mesh = "triangle soup," a hole is not a referenced cylinder). **This validates Forge's whole architecture** (Archie emits tool-calls → real kernel builds B-rep) over every mesh-generating competitor.
- **A2 — simulation democratization / "shift-left" sim** (the §4 grounded suite).
- **A3 — generative design / topology optimization** gated by manufacturability (§5 DFM + SIMP/lattice).
- **A4 / C6 / R14 — local-desktop, own-your-data, offline-capable** directly answers cloud-subscription lock-in ("lose access if you stop paying") and the offline-CAD gap — Forge's exact moat.
- **A5 / MBD-PMI** — Model-Based Definition, GD&T-on-the-model (§5 semantic PMI).
- **C2 — interoperability is a "geometry lottery"** (STEP/IGES strip parametric features, PMI, assembly constraints) — answered by §1 B11 AP242 PMI semantic round-trip + XT/SAT/JT.
- **C3/C4 / R8 — history-tree brittleness + topological-naming fragility** (FreeCAD's TNP *mitigated not solved*) → **edit-stability as a first-class metric** → §1 B8 persistent-ID rebuild + §3 U4. The whole community treats edit-stability as a first-class metric; this is table-stakes parametric MCAD and the CADGenBench editing axis.
- Benchmark science maturing (Text2CAD-Bench, MUSE) — CADGenBench is the canonical gate.

---

## 9. PRIORITIZED TASK PROGRAM

> Priority bands: **P0** = on the critical path to CADGenBench ≥0.85 every axis (the north-star), or a blocking dependency for it. **P1** = required for the expanded scope (P-1/Prometheus parity, enterprise grade) but not the immediate gate. **P2** = breadth/polish that completes "leave nothing out of scope." Areas: kernel · model · uiux · benchmark · manufacturing · sim · plm · research · infra.

The full task array is returned in the structured output. Top of the program (abridged):

1. **[P0 benchmark] `ForgeCADScore v2` harness + internal mirror corpus** — reproduce the 0.56 example ±0.01; the instrument every other milestone is measured on.
2. **[P0 kernel] B0 validity substrate + heal on every export** — BRepCheck-equivalent + watertight + manifold + full heal; `validity_rate≥0.97`. The ×0 gate.
3. **[P0 kernel] B1 half-edge topology core + Euler operators** — the safe primitive substrate; b₀/b₂ by construction.
4. **[P0 kernel] B2 NURBS + analytic geometry + pcurves/intcurves** — the geometry pole under shape fidelity.
5. **[P0 kernel] B3 SS-intersector → exact booleans** `[GAP-HARD #2]` — the literal kernel core; volume IoU + cut-hole topology.
6. **[P0 model] S0 Pillar-A math/logic foundation adapter** — the foundation under every physics dimension.
7. **[P0 model] S1 geometry + validity/shape/topology corpus** — replay validity ≥0.95.
8. **[P0 kernel] B4 blending engine** `[GAP-HARD #3]` — exact fillet/chamfer/FF-blend radii (Shape).
9. **[P0 benchmark] M1 validity lockdown + M2 topology-by-construction.**
10. **[P0 manufacturing] semantic PMI authoring + auto-datum + KOR/KIR interface corpus** — the make-or-break interface axis (M4).
11. **[P0 uiux] U0 foundations + CUA-parity harness; U1 modal sketch sandbox.**
12. **[P0 kernel] B8 history/rollback/persistent-ID rebuild** `[GAP-HARD #4]` + U4 time-travel — edit-stability, the editing axis + community gripes #3/#4.
13. **[P0 kernel] B9 tolerant modeling + tolerant booleans + cellular/non-manifold** `[GAP-HARD #1]` — dirty-import validity + edit fixtures (M5).
14. **[P0 model] S5 multimodal drawing→CAD + S8 DPO on ForgeCADScore** — generation axis + final all-axis alignment; **M7 validated public submission**.

(See structured output for the complete 15–40-task program across all areas, with priority, scope, acceptance criterion, and dependencies.)

---

## 10. GAP ANALYSIS

The biggest gaps between Forge/Archie **today** and the expanded scope are returned as `topGaps` in the structured output. In brief: (1) no full-rubric ForgeCADScore v2 — cannot tune blind toward the private GT; (2) the four `[GAP-HARD]` kernel poles (tolerant modeling/booleans/heal; SS-intersector→exact booleans; FF/variable blending; history/persistent-ID rebuild) are the multi-year poles that literally decide ≥0.85 and are not yet in-house; (3) Archie emits straight-primitive blockouts, not parametric feature-based B-rep (the bridge/brain/defect severance); (4) semantic PMI is eval-only, no authoring/graph — the interface axis lever is missing; (5) STEP-editing (imported-B-rep feature-recognition + surgical local edit) is the hardest kernel frontier and unbuilt; (6) sim gaps: turbulent CFD, FSI, EM/acoustics, auto-MBD, transient-CFD viz, GPU-compute post; (7) UI gaps: ghost preview path, replay+persistent-ID (the topological-naming solve), full CUA-parity coverage; (8) the eAGI federation (GNN surrogate, geometric-reasoning VLM specialist, structured-IR encoder, 6-level harness) is specced but not built; (9) the synthetic outcome-of-decision data engine at 14B scale (`bulk_synth_outcome.py`, §0.4 item 3 — the Prometheus differentiator, not yet built); (10) the public SOTA is ~0.45 and the bar is ~2×; (11) **[Prometheus-fold]** the three new sim ops `forge.simulate.{failurePredict,coupled*}` + field-reconstruction overlays (§4.2 gaps 11–13), the intent-inference + assumptions-ledger objective (§0.4 item 1), and the act-from-pixels VLA branch (§0.4 item 5) are specced but unbuilt.

---

## Sources
All inherited from the four program docs and twelve research docs in `docs/SCOPE_2026-06-21/{programs,research}/`, plus the **Prometheus parity fold** in `docs/SCOPE_2026-06-24/research/prometheus.md` (re-grounded against the 2026-06-11 $12B/$41B Series B + first on-record Bezos/Bajaj interviews; folded into §0.3/§0.4/§2.1/§4). Key external: Parasolid PK V13 index (677 `PK_*`) http://www.q-solid.com/Parasolid_Docs/pk_index_long.html ; 3D ACIS 35 husks http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisgsTechArticles/SPAacisgs_arcomp.htm ; OCCT toolkits https://dev.opencascade.org/doc/overview/html/ ; CGAL Nef_3 https://doc.cgal.org/latest/Nef_3/index.html ; Manifold https://github.com/elalish/manifold ; CADGenBench https://github.com/huggingface/cadgenbench + https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench + https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data ; Mecado https://www.mecado.com/benchmark ; P-1 eAGI eval arXiv 2505.10653 https://arxiv.org/abs/2505.10653 ; P-1 https://www.p-1.ai ; Project Prometheus https://en.wikipedia.org/wiki/Project_Prometheus_(company) + https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/ ; Zoo "AI must generate parametric CAD" https://zoo.dev/blog/why-ai-must-generate-parametric-cad ; Ondsel TNP https://www.ondsel.com/blog/toponaming-problem-is-history/ ; SOTA datapoint (Fable 5 ≈ 0.4514) https://benchmarklist.com/ . In-repo ground truth: `KERNEL_INHOUSE_ROADMAP.md`, `KERNEL_UNIFICATION.md`, `KERNEL_PARITY.md`, `PLM_STATUS.md`, `SIM_VALIDATION.md`, `frontend/src/forge-v4/`, `frontend/src/ai/{ForgeRunner,ForgeToolBridge}.js`.
