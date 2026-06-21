# PROGRAM — ARCHIE 14B TRAINING CORPUS

**Owner:** SCOPE_2026-06-21 / programs · **Date:** 2026-06-21 · **Status:** canonical (folds into mission bible)
**Synthesized from:** `research/{p1ai,prometheus,cadgenbench,mecado,communities,fields_sister,fields_direct,fields_indirect,manufacturing}.md`

> **THESIS.** Train ONE local 14B model (Archie) to be a junior-to-expert engineer that drives Forge purely via CUA, trained *fully and only* on **(1) deepest math/logic/reasoning**, **(2) all ~60 engineering fields** (20 direct + 15 indirect + 20 sister + manufacturing/DFM/CAPP/MBD/PLM), **(3) P-1.ai/Prometheus eAGI capability**, and **(4) CADGenBench-targeted geometry-truth data** — every sample terminating in a schema-valid `forge.<workbench>.<op>(args)` tool-call the kernel can replay.
>
> **NORTH-STAR GATE.** Archie-drives-Forge ≥ **0.85 on CADGenBench across EVERY axis** (validity ≥0.95 rate, shape ≥0.85, interface ≥0.85, topology ≥0.85, generation AND editing ≥0.85) — not the mean. Public SOTA is ~0.39–0.45 (Claude Fable 5 ≈ 0.4514); the bar is ~2× the field.
>
> **HARDWARE CEILING.** Mac Studio M4 Max, 36 GB unified RAM. 4-bit qLoRA, sequence-budgeted, storage-safe streaming (download→process→delete, parquet `iter_batches`, accumulator-dedup). Work one heavy step at a time (no simultaneous train + serve + Electron + Vite).

---

## 0. WHAT WE ALREADY HAVE (build ON, do not re-scaffold)

| Asset | Path | Role in this program |
|---|---|---|
| Reasoning-merged base + LoRA fleet | `archdisc-Models/models`, `adapters/` | DeepSeek-R1-Distill reasoning + 2-brain (foundational_studio / foundational_mech) + per-discipline LoRAs |
| Programmatic synth | `scripts/bulk_synth.py`, `bulk_synth_specs.py`, `bulk_synth_multidisci.py`, `bulk_synth_forge_flagship.py` | 3.5–13k+ unique Q/A per run; **agents top out at 40–60 — always use these** |
| Corpus assembly | `scripts/corpus_factory.py`, `merge_accumulator.py`, `compact_batches.py`, `mix_forge_capability.py` | dedup + mix + accumulator writes |
| Real-data ingest | `scripts/ingest_deepcad.py`, `cap3d_stream.py`, `cosmopedia_100k_stream.py`, `multi_stream_wave*.py` | streaming parquet ingest seam |
| Vision branch | `scripts/caption_via_vlm.py`, `lora_eager_rope.py` | Qwen2.5-VL (eager-RoPE fix, ~26 GB peak) for drawing→intent |
| Quality / eval | `scripts/coherence_gate.py`, `critic_synth.py`, `dpo_synth.py`, `gauntlet_staged.py`, `eval_archie.py`, `benchmark_archie.py`, `forge_drive_smoke_14b_v2.py` | self-critic + gauntlet + Forge-replay scoring |
| Training | `train_archie_14b_v2.sh`, `train_archie_14b_forge.sh`, `train_archie_14b_overnight.sh` | mlx_lm.lora 4-bit (DROP `--mask-prompt` for long samples — NaN risk) |
| Geometry-truth scorer | Forge `ForgeCADScore` (replay 1.0 vs corrupt 0.456) | re-implements the 4 CADGenBench axes for **offline reward** |

**Mandatory data hygiene (memory rules):** (a) bulk_synth programmatically, never agent hand-authoring; (b) strict download→process→delete + `iter_batches`; (c) **never `--mask-prompt` on long corpora** (all-masked → NaN, silent adapter corruption) — guard loss + NaN per run; (d) every sample carries the chat template Archie was trained on (raw `--prompt` produces garbled output); (e) honesty — where an engine is present-but-unverified (turbulent CFD), teach Archie to surface the real limit, never fabricate.

---

## 1. THE BASE MODEL (reasoning-merge) AND WHY

- **Backbone:** Qwen2.5-14B-Instruct merged with **DeepSeek-R1-Distill** reasoning (the existing fleet base). 14B not 24B — fits 36 GB at 4-bit with headroom for serve+eval (per the 14B overnight-program memory). This gives P-1's "orchestrator-reasoner" brain + R1 chain-of-thought for the math/logic pillar.
- **Adapter topology (mirrors P-1's federated architecture):** one **foundational** adapter (math+logic+cross-field reasoning) → **per-cluster** LoRAs (CAD-gen, CAE-physics, manufacturing, data-graph/PLM, sister-fields) → optional **specialist** merges. Route per-request via `adapters` field (the proven 2-brain serve pattern).
- **Vision branch:** Qwen2.5-VL LoRA (eager-RoPE, `lora_eager_rope.py`) for the `text+image` CADGenBench generation task (drawing PNG → parametric intent). Kept separate; ~26 GB peak so trained alone.
- **The "lobotomized" structured-design encoder (P-1):** a late curriculum stage that pushes Archie from English toward the **design-graph IR** (component+param+functional/spatial topology → tool-call sequence). This is the cua-realassets/interface-corpus direction taken further.

---

## 2. CORPUS PILLARS (the four mandated buckets) → bulk_synth modules

Every generator emits JSONL `{messages:[system,user,assistant]}`, assistant ending in one or more `forge.<wb>.<op>(args)` calls (or a structured answer + call). Cross-cutting rules from `fields_direct §`: tool-call grounding, unit-correctness (SI primary + imperial recall), dynamic-first (transient/modal/forming/solidification/motion over static snapshots), full assembly+multimodal context, honesty.

### PILLAR A — Math / Logic / Deepest Reasoning  (`bulk_synth_math.py`, `bulk_synth_numerics.py`)
The foundation under every physics dimension (`fields_indirect §13`). Generators:
- **A1 `gen_linear_algebra`** — LU/Cholesky/QR/SVD, eigen (QR/Lanczos/Arnoldi), condition number κ; sparse direct (multifrontal, AMD/METIS ordering) vs iterative (CG/MINRES/GMRES/BiCGStab) + preconditioner choice (Jacobi/ILU/AMG). Terminates in `forge.num.*` solver-config reasoning.
- **A2 `gen_nonlinear_ode`** — Newton-Raphson (line-search/trust-region/**arc-length Riks** for snap-through), RK45 (Dormand-Prince) vs BDF (stiff) vs **HHT-α/generalized-α** selection + stability justification.
- **A3 `gen_quadrature_interp`** — Gauss-Legendre per element, NURBS Cox-de-Boor/de-Boor/knot-insertion, least-squares fitting, FFT, adaptive Simpson.
- **A4 `gen_proof_logic`** — chain-of-thought math proofs, dimensional-analysis derivations, SAT/CSP reasoning (feeds configurator §CM), interval/constraint propagation (P-1 open-problem #4: formal verification).
- **A5 `gen_amr_locking`** — ZZ/residual error estimators, h/p/hp refinement, volumetric/shear-locking cure (Wilson-Q6/B-bar/EAS — the de-locking behind static 0.33% / modal 0.2%).
**Real-data seam:** verify against analytical gates (MMS, Richardson/GCI, ASME V&V 10/20).

### PILLAR B — All ~60 Engineering Fields  (cluster generators below)
Each field's `(a/b/c/d)` block in `fields_{direct,indirect,sister}.md` is the generator spec: (c) governing equations + standards are the answer keys; (d) training-data topics are the question templates; (b) named ops are the tool-call targets. Organized into **5 cluster modules** (§3).

### PILLAR C — Manufacturing / DFM / CAPP / Auto-MBD / PLM  (`bulk_synth_mfg.py`)
Per `manufacturing.md` — the 101 numbered requirements. Generators per process (machining/casting/injection/sheet/AM/welding/forging) + DFMA + CAPP + semantic-PMI + the `forge.mfg.autoProcess` single-intent payload + the autonomous-PLM `forge.plm.*` sequence. **Highest-leverage for CADGenBench interface axis** (semantic PMI + auto-datums + MMC clearance bonus).

### PILLAR D — P-1.ai / Prometheus eAGI Capability  (`bulk_synth_eagi.py`)
The three primitives × six cognition levels (§4) + outcome-of-decision pairs + the flagship/domain workflows. This is what makes P-1-grade tasks in-distribution.

### PILLAR E — CADGenBench-Targeted  (`bulk_synth_cadgen.py`)
Drawing→parametric (text+image), KOR/KIR jig-feature, STEP-edit surgical-delta, topology-count drills (§5). Mirrors the exact failure taxonomy in the benchmark fixtures.

---

## 3. FIELD-CLUSTER GENERATORS (Pillar B detail — bulk_synth modules per cluster)

> Five cluster modules cover all ~60 fields. Each lists the fields it spans, the answer-key equations/standards, and the tool-call targets. Sample budgets are per-run unique counts (bulk_synth scale).

### Cluster 1 — CAD Geometry & Modeling  `bulk_synth_geom.py`  (~target 1.5M unique)
**Fields:** Computational Geometry (§15 sister), CG/Geometric Modeling/NURBS (§16 sister), Industrial Design/Class-A (§12 direct), Reverse-Eng/Metrology (§14 sister + §6 indirect).
**Answer keys:** robust predicates (Shewchuk orient2d/3d, incircle/insphere + FP filters), convex hull/Delaunay/Voronoi, Bentley-Ottmann, Minkowski/straight-skeleton offset; NURBS (knot ops, SSI tracing, Catmull-Clark/Loop), QEM decimation, LSCM/ARAP; ICP/FPFH/RANSAC fitting, Poisson/BPA reconstruction; G0–G3 continuity, zebra/curvature.
**Tool-calls:** `forge.cg.*`, `forge.nurbs.*`, `forge.surf.classA`, `forge.reveng.*`, `forge.cmm.fit/evaluateFCF`.
**Why critical:** robust predicates fix the audited boolean fragility (empty geometry after ~30 subtractions) → directly defends CADGenBench **validity** + **topology**.

### Cluster 2 — CAE / Physics  `bulk_synth_physics.py`  (~target 2M unique, dynamic-first)
**Fields:** FEA (§4), CFD (§5), MBD (§6), Aeroacoustics (§7), EM (§8), Structural (§9), Fracture/Fatigue (§10), Kinematics (§11), Tribology (§22) — all direct; plus Materials/Metallurgy/Polymer (§1–3 direct) as property feeds.
**Answer keys (verbatim from research):** `[K]{u}={F}`, `([K]−ω²[M])φ=0`, Newmark/HHT-α; Navier-Stokes + SST k-ω blending + y⁺ + CFL; index-3 DAE `[M Φqᵀ; Φq 0]{q̈;λ}={Q;γ}`; FW-H/Lighthill + BPF; Maxwell + Steinmetz `P=k f^α B^β`; Euler buckling, von Mises, Mohr; Paris `da/dN=C(ΔK)^m`, Basquin/Coffin-Manson, Goodman, Miner, FKM 7th-ed; Gruebler DOF, involute, AGMA; Hertz/Archard/Reynolds/Stribeck.
**Tool-calls:** `forge.fea.{staticLinear,modal,transient,harmonic,nonlinearStatic,contact,buckling,thermalTransient}`, `forge.cfd.{steadyIncompressible,transient,turbulence,conjugateHeat,compressible}`, `forge.simulate.multibodyDynamics`, `forge.aeroacoustics.*`, `forge.emag.*`, `forge.struct.*`, `forge.fatigue.*`/`forge.fracture.*`, `forge.kinematics.*`, `forge.tribo.*`, `forge.material.*`.
**Honesty injection:** turbulent-CFD samples teach Archie to surface the verified-laminar / unverified-turbulent limit.

### Cluster 3 — Manufacturing & Manufacturability  `bulk_synth_mfg.py`  (Pillar C)
**Fields:** DFM/DFMA (§13–14 direct), DfAM (§15 + §11 sister), Mold/Die (§16), CNC/G-code (§17), Sheet-metal (§18), Injection (§19), Casting/Forging (§20), Welding (§21), Topology-Opt (§13 sister), Generative/Implicit (§12 sister), CIM/CAPP (§4 sister).
**Answer keys:** the 101 numbered rules+numbers in `manufacturing.md` (corner-radius 130%/6:1, depth 3:1/6:1, draft 1–2°/2–3°, Niyama G/√R, Chvorinov modulus, Cross-WLF/Tait/Folgar-Tucker, K-factor BA, min-bend nT, 45°/process self-support, AWS fillet 0.707·leg, SIMP ρ^p p=3, TPMS gyroid implicit).
**Tool-calls:** `forge.mfg.autoProcess`, `forge.manufacturing.dfm.{machining,casting,injection,sheetmetal,additive,welding,forging}`, `forge.capp.plan`, `forge.dfam.*`, `forge.am.*`, `forge.topopt.simp/levelset/beso`, `forge.implicit.*`, `forge.cim.recognizeFeatures`.

### Cluster 4 — Data-Graph / Lifecycle  `bulk_synth_plm.py`  (~target 1M)
**Fields:** PLM (§1), PDM (§2), CM (§18), ERP (§5), MES (§6), SCADA (§7), Digital-Twin (§9), Virtual-Commissioning (§19), IIoT (§20), BIM (§3) — all sister; plus indirect Systems-Eng (§1), Requirements (§2), QA/TQM (§3), Lean (§4), OR (§5), RAMS (§8), FMEA (§9), Compliance (§10), LCA (§11), PM (§12), Facility-Layout (§15).
**Answer keys:** ISO 10303/AP242, EBOM→MBOM, effectivity algebra; MRP gross-to-net + Wagner-Whitin; ISA-95/88 + OEE; swinging-door historian + Modbus/DNP3/OPC-UA; AAS/FMI co-sim master + EKF/UKF; MQTT/Sparkplug-B; SysML v2/ReqIF/EARS; SPC limits + Cp/Cpk + Gage-R&R; VSM/takt/SMED; LP/MIP simplex + branch-and-cut + job-shop + TSP/VRP + DES; Weibull/RBD/FTA-cutsets/Markov; AIAG-VDA 7-step + Action-Priority; ASME-VIII wall + stress-linearization; ISO 14040/44 GWP (CO₂=1, CH₄ 29.8, N₂O 273); CPM/EVM (te=(o+4m+p)/6, CPI/SPI/EAC); SLP/QAP.
**Tool-calls:** `forge.plm.*`, `forge.pdm.*`, `forge.cm.*`, `forge.erp.*`, `forge.mes.*`, `forge.scada.*`, `forge.twin.*`, `forge.vcommission.*`, `forge.iiot.*`, `forge.bim.*`, `forge.sysml.*`, `forge.reqs.*`, `forge.spc/msa/doe.*`, `forge.lean.*`, `forge.or.*`/`forge.sim.*`, `forge.rams.*`, `forge.fmea.*`, `forge.reg.*`, `forge.lca.*`, `forge.pm.*`, `forge.layout.*`.

### Cluster 5 — Robotics / Mechatronics / Inspection  `bulk_synth_mechatronics.py`  (~target 0.8M)
**Fields:** Industrial Automation & Robotics (§8 sister), Mechatronics (§10 sister), Metrology/CMM (§6 indirect), NDT (§7 indirect), Human-Factors/Ergonomics (§14 indirect), GD&T (§23 direct), Tolerance-Stack (§24 direct).
**Answer keys:** DH/FK, Pieper-IK + DLS, Jacobian/singularity, RRT*/PRM + GJK/EPA, recursive Newton-Euler, S-curve profiles; LQR(Riccati)/pole-placement/Ziegler-Nichols, Bode/margins, Tustin; ISO 26262 ASIL/FMEDA/FTA; LSQ-vs-min-zone-Chebyshev fitting, GUM uncertainty, DMIS; UT N=D²/4λ, Ug=F·t/d, PAUT focal laws; RULA/REBA/NIOSH RWL; ASME Y14.5-2018 (14 char/5 cat, MMC bonus, DRF 3-2-1); worst-case/RSS(√n)/Monte-Carlo + Cp/Cpk + 3.4 PPM.
**Tool-calls:** `forge.robotics.*`, `forge.mechatronics.*`, `forge.cmm.*`, `forge.ndt.*`, `forge.ergo.*`, `forge.gdt.*`, `forge.tolstack.*`.

---

## 4. P-1 / PROMETHEUS eAGI CORPUS (Pillar D detail — `bulk_synth_eagi.py`)

Implements P-1's **three primitives** × **six cognition levels** (arXiv 2505.10653), tagged with the 5-axis metadata (system-type / design-scope / physics-domain / modeling-requirement / standard) so the gauntlet can score per level.

- **Primitive 1 — Design EVALUATION** (forward: design → performance vector). `gen_eval`: complete design → `forge.simulate.*` full multiphysics vector (FoS/modes/ΔT/ΔP/mass/cost/carbon) in one call.
- **Primitive 2 — Design SYNTHESIS** (inverse: requirements → parametric geometry). `gen_synth`: spec brief → structured requirements object → candidate architecture → first-order sizing → parametric tool-call sequence + `forge.optimize.*`.
- **Primitive 3 — ERROR-DETECTION + IN-FILLING** (diagnose/repair partial or broken design). `gen_repair`: broken/partial design → detect rule/physics/interference violation → propose+apply validated fix → re-simulate → confirm.

**Six-level ladder (`tag.level`):** L1 Remember (recall eqn/prop/standard) → L2 Understand (read topology/intent) → L3 Apply (predict perf, substitute parts, invoke solver) → L4 Analyze (in-fill, detect errors, propose fix) → L5 Create (synthesize from spec, push Pareto frontier) → L6 Reflect (critique own design, flag OOD e.g. altitude-density correction, state uncertainty).

**Outcome-of-decision pairs (Prometheus' key differentiator):** `gen_outcome` runs Forge solvers over parametric sweeps to produce `(design-change → simulated outcome-delta)` — swap Al-6061→Ti-6Al-4V → Δmass/Δstiffness/Δcost/Δthermal; tighten tol 0.1→0.02 → Δfit/Δcost/Δyield; fillet R2→R5 → Δpeak-stress. **Owned-kernel advantage: deterministic, offline, free** — what P-1/Prometheus must license third-party sim for.

**Flagship workflows (in-distribution by training):** eVTOL prop–motor matching (the citable P-1 example: MTOW/V/A/thermal → Kv + prop size + thrust/current/endurance numbers), data-center cooling (~1k parts: CRAC/CRAH, cold/hot-aisle CFD, PUE, N+1/2N), GE9X ~20k, turbopump, gearbox — full specs (components/dimensions/spatial/PBR/environments) per the train-projects-exhaustive directive, organized instancing (no confetti).

**Sampling strategy (AlphaGo bootstrap):** dense near dominant/known-good designs, sparse near corners/edges → teaches boundary conditions + failure modes.

---

## 5. CADGenBench-TARGETED CORPUS (Pillar E detail — `bulk_synth_cadgen.py`)

Maps each benchmark axis to a generator that lifts it ≥0.85. The grader: rigid-align (rot+trans, NEVER scale) → validity gate → 0.4·shape+0.4·interface+0.2·topo (gen) / 0.6·s_renorm+0.3·interface+0.1·topo (edit).

| CADGenBench dimension | Exact metric | Generator → corpus that lifts it ≥0.85 |
|---|---|---|
| **Validity (hard gate, ≥0.95 rate)** | OCCT `BRepCheck_Analyzer.IsValid()` + watertight + manifold (edge∈2 tris) | `gen_validity`: every assistant call sequence ends watertight/closed; **never** open shells, zero-thickness walls, self-intersections. Run kernel BRep-validity + auto-heal on every export. Cluster-1 robust predicates underpin this. **Single highest-leverage axis** (invalid → 0). |
| **Shape Similarity (≥0.85)** | ½(surface-F1@0.5%bbox-diag,20°-normal + volume-IoU via manifold3d) | `gen_shape`: build to EXACT drawing dimensions; correct fillet/chamfer radii, wall thickness, feature placement. No scale rescue → mm-discipline, absolute scale. Pillar-A NURBS + Cluster-1 geometry. |
| **Interface Match (≥0.85, weight 0.4)** | KOR-empty/KIR-solid IoU w/ opposite-material shell; ramp 0.80→0.95; ±1°/±1% pose; group=min, sample=mean | `gen_interface`: bolt-hole Ø+position, bolt-circle (PolarLocations), boss size/pos, slot width within ~5%/1%. Mirror the jig fixture failure taxonomy: wrong-spacing/missing-hole/wrong-diameter/narrow-slot/offset-slot/rotated-boss/shifted-holes. **+ semantic PMI/auto-datum/MMC-bonus from Pillar C.** Where general models collapse → our strongest differentiator. |
| **Topology Match (≥0.85)** | Betti b₀/b₁/b₂; `((min+1)/(max+1))²`; **PRODUCT** s₀·s₁·s₂ | `gen_topology`: emit EXACT count of through-holes, internal voids, disjoint solids. Multiplicative → all three must be right. Watertight booleans (Cluster-1) prevent floating bodies / fused parts. |
| **Generation task (text+image, 49 fixtures)** | drawing PNG → solid | `gen_drawing2cad` (VLM branch): orthographic views + dims + GD&T callouts + hole tables → parametric intent → tool-calls. Uses Qwen2.5-VL eager-RoPE. |
| **Editing task (text+step, 32 fixtures)** | input STEP + change → modified STEP; renorm vs no-op (do-nothing caps 0.4) | `gen_stepedit`: load `input.step`, localize feature, apply SURGICAL delta, re-export without breaking unrelated geometry. Requires real imported-B-rep editing (feature-recog + local parametric edit), not rebuild-from-scratch. |

**Self-correction loop in-corpus:** include multi-turn samples where Archie consumes validation+render feedback (watertight/Betti/volume/bbox + ISO PNG) each turn and converges — mirroring the baseline agent's auto-feedback so Archie learns to self-heal toward the gate. **ForgeCADScore is the offline reward** (re-implements all 4 axes) — use for DPO pairs (`dpo_synth.py`) and gauntlet scoring.

---

## 6. CURRICULUM ORDER (storage-safe, one heavy step at a time)

> Each stage: generate (bulk_synth) → dedup/mix (`corpus_factory` + `merge_accumulator`) → coherence/critic gate → train 4-bit qLoRA (no `--mask-prompt` on long; NaN-guard) → restart serve fresh → gauntlet → promote-or-rollback. Process→train→delete; never co-host train + serve + Electron.

| Stage | Adapter | Corpus | Acceptance gate before promotion |
|---|---|---|---|
| **S0 Foundation** | `arch14b-math` | Pillar A (math/logic/numerics) | Analytical-gate Q/A ≥0.90; no NaN; reasoning traces coherent |
| **S1 Geometry** | `arch14b-geom` (on S0) | Cluster 1 + Pillar-E `gen_validity`/`gen_shape`/`gen_topology` | Forge-replay validity_rate ≥0.95 on a 200-part smoke; shape/topo ≥0.80 |
| **S2 Physics** | `arch14b-physics` | Cluster 2 (dynamic-first) + eAGI `gen_eval` | eAGI L1–L3 objective score ≥0.85; turbulent-CFD honesty held |
| **S3 Manufacturing** | `arch14b-mfg` | Cluster 3 + Pillar-C `autoProcess`/PLM + Pillar-E `gen_interface` | Interface axis ≥0.85 on jig smoke; `autoProcess` makeable-verdict valid |
| **S4 Lifecycle+Mechatronics** | `arch14b-data` / `arch14b-mech` | Clusters 4 & 5 + eAGI `gen_repair` | eAGI L4–L5 sim-augmented score ≥0.80; FMEA/RAMS/GD&T tool-calls schema-valid |
| **S5 Multimodal** | `arch14b-vlm` (Qwen2.5-VL) | Pillar-E `gen_drawing2cad` + `gen_stepedit` + assembly-context triples | CADGenBench generation ≥0.80 dry-run; editing s_renorm>0 |
| **S6 eAGI Capstone** | `arch14b-eagi` merge | Pillar-D full (3 primitives × 6 levels) + outcome-pairs + flagships | eAGI L6 reflect via LLM-as-judge; flagship workflows in-distribution |
| **S7 Structured-IR** | "lobotomized" encoder pass | design-graph IR sequences | emits valid IR > English on synthesis prompts |
| **S8 Alignment** | DPO on `arch14b-*` | ForgeCADScore-ranked pairs (`dpo_synth`→`dpo_to_sft`) | full CADGenBench ≥0.85 EVERY axis (gen AND edit), validated tier |

**Rationale:** math first (every physics dimension rests on it) → geometry (validity gate is requirement-zero) → physics → manufacturing (interface axis, the make-or-break) → breadth → multimodal → eAGI integration → IR specialization → preference alignment to the geometry-truth reward.

---

## 7. EVAL / GAUNTLET (the internal gate before the public benchmark)

- **`gauntlet_staged.py` extended to eAGI 6 levels** (mirror arXiv 2505.10653): L1–L3 objective (symbolic solver + lookup + Forge-sim), L4–L5 simulation-augmented heuristics (patch→re-sim→constraint/Pareto scoring, partial credit), L6 LLM-as-judge/Agent-as-judge + expert-in-the-loop. Tag every probe by the 5-axis metadata.
- **ForgeCADScore harness** re-implements the 4 CADGenBench axes offline (validity/shape/interface/topology) → run on every adapter; track the four axes **separately** (a 0.85 mean with weak interface FAILS).
- **`forge_drive_smoke_14b_v2.py`** — genuine CUA replay: typed prompt → tool-calls → kernel build → STEP → score. **Varied/distinct prompts each run** (no cherry-picking), ≥5 named camera angles for the headed e2e.
- **Real-data validation set:** held-out DeepCAD/Fusion360/ABC (`ingest_deepcad.py`) sketch-and-extrude sequences + the 81 CADGenBench public-input fixtures (GT private — server-side scored last).
- **Human-cohort curve (P-1 style):** benchmark Archie vs entry/average/expert engineer on the eAGI harness; publish internally alongside CADGenBench.
- **Promotion rule:** advance a stage ONLY when its gate is green AND no NaN/degradation; restart serve before any eval (output degrades over a session).

---

## 8. REAL DATASET SOURCES (CC0/clean — IP hygiene per Mecado)

- **DeepCAD** (~150k train/8k test sketch-and-extrude) + **Fusion360 Gallery** (human design sequences) + **ABC dataset** (B-rep) → geometry/validity/shape grounding via `ingest_deepcad.py` streaming.
- **CADGenBench public inputs** (`HuggingAI4Engineering/cadgenbench-data`, 199 MB, ODC-BY) → exact part-class mirror (jigs/bolt-patterns/slots/bosses).
- **Open standards text** — ISO 10303/AP242, IFC, ISA-95/88, ASME Y14.5-2018, AISC/ACI/Eurocode/FKM/AWS — as answer-key references for Pillars B/C (cite, don't scrape proprietary).
- **Poly Haven CC0** (HDRI/PBR) for the photoreal/environment branch only.
- **Synthetic dominates:** the physics-grounded synthetic engine (Forge-labeled performance vectors) is the bulk — P-1's core IP, which we do **better** with an owned deterministic kernel. Honor download→process→delete throughout.

---

## 9. SUCCESS CRITERIA (Definition of Done)

1. **CADGenBench ≥0.85 on EVERY axis** (validity-rate ≥0.95, shape ≥0.85, interface ≥0.85, topology ≥0.85, generation ≥0.85, editing ≥0.85) — validated tier, Forge-native STEP submission (high-trust path), verified by headed Playwright e2e (≥5 cam angles, varied prompts).
2. **eAGI L1–L6 curve** beats entry-engineer baseline, matches average on L1–L4, demonstrates L6 self-critique/OOD-flagging.
3. **All ~60 fields** represented with schema-valid tool-calls that the kernel replays (geometry-truth scorable).
4. **Runs local** — 14B 4-bit on 36 GB M4 Max, serve fresh; no cloud, no egress.
5. **No NaN-corrupted adapters; no fabricated numbers** (honesty gate held); CI green between stages.

---

## 10. TEN-LINE SUMMARY (for the mission bible)

1. Train ONE local 14B (Qwen2.5-14B + DeepSeek-R1 reasoning, 4-bit qLoRA, 36 GB ceiling, storage-safe stream) on four pillars, every sample ending in a replayable `forge.<wb>.<op>` tool-call.
2. **Pillar A** = deepest math/logic/numerics (`bulk_synth_math/numerics`) — the foundation under all physics dimensions; analytical-gate verified.
3. **Pillar B** = all ~60 fields via 5 cluster generators: geom, physics(dynamic-first), mfg, data-graph/lifecycle, mechatronics/inspection — research (c)-equations are answer keys, (d)-topics are questions, (b)-ops are targets.
4. **Pillar C** = manufacturing/DFM/CAPP/auto-MBD/PLM (`bulk_synth_mfg`, the 101 numbered rules) — drives the CADGenBench **interface** axis via semantic PMI + auto-datums + MMC bonus.
5. **Pillar D** = P-1/Prometheus eAGI: 3 primitives (evaluate/synthesize/repair) × 6 levels + Forge-labeled outcome-of-decision pairs (owned-kernel advantage) + flagship workflows.
6. **Pillar E** = CADGenBench-targeted: `gen_validity/shape/interface/topology` + drawing→CAD (VLM) + surgical STEP-edit + self-correction loop; mirrors the jig failure taxonomy.
7. **Curriculum S0→S8**: math → geometry(validity first) → physics → manufacturing(interface) → lifecycle/mechatronics → multimodal → eAGI capstone → structured-IR → DPO on the ForgeCADScore reward.
8. **Eval** = eAGI 6-level `gauntlet_staged` + offline ForgeCADScore (4 axes tracked separately) + genuine-CUA Forge replay smoke + human-cohort curve; promote only on green, serve fresh, no `--mask-prompt` on long corpora.
9. **Data** = DeepCAD/Fusion360/ABC + CADGenBench public inputs + open-standards text, CC0/clean; physics-grounded synthetic (Forge-labeled) dominates — built better than P-1 because the kernel is owned/offline/deterministic.
10. **DoD** = Archie-drives-Forge ≥0.85 on every CADGenBench dimension (gen AND edit), local 14B, headed-e2e verified, honest, CI-green — ~2× the public field (Fable 5 ≈ 0.4514).
