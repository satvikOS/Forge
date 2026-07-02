# Parametric-CAD ML Literature & Training-Strategy Map — Archie-drives-Forge (#17)

**Scope:** SCOPE_2026-06-21 research synthesis for the Forge team. Consolidates named-paper reads (DeepCAD, Fusion360 Gallery, BRepNet, BRT, AutoBrep, build123d, mrCAD, CADMorph), a 5-cluster field sweep of text-to-CAD / B-rep generation / construction-sequence / datasets / editing+constraint work (2020–2026, emphasis 2024–2026), and an ML-simulation-surrogate cluster (for #20/#29). Aligns to the CADGenBench gate and Forge's own `ForgeCADScore`.

**Companion docs in this folder:** `cadgenbench.md` (the gate spec + 4-axis scorer), `mecado.md`, `sim_grounded.md`, `fields_direct.md`. This doc is the *training-strategy + literature map* layer above them.

---

## 1. EXECUTIVE SUMMARY

The parametric-CAD-ML field has, by 2026, converged on **exactly the bet Forge is making**, and converged hard enough that the recipe is no longer speculative — it is the published SOTA. Three things are settled:

1. **CAD is a program, not a static shape.** Every leading system represents a part as a *replayable sequence* — DeepCAD command-JSON, CadQuery/build123d Python, or (newest, most Forge-aligned) **tool-calls into a real kernel** (TOOLCAD, CAD-Assistant, RLCAD). Code/tool-call DSLs now beat opaque token vocabularies because they reuse the LLM's pretrained programming priors and stay human-editable. Direct B-rep generation (AutoBrep, HoLa, DTGBrepGen, BrepGPT) is a parallel, *complementary* line whose top validity is still only ~71–88% — i.e. the watertight-solid step belongs to the **kernel**, not the model. That validates "emit operations, let OCCT build."

2. **Training is two-stage: SFT then online RL on a geometry-truth reward.** SFT learns the format; then GRPO/GSPO/Dr.CPPO (online > offline, per *cadrille*) on a reward computed by **executing the sequence in a kernel and comparing geometry** (Chamfer / IoU / validity), *not* token overlap. RL is what crushed invalid-output rates from 2–15% to ~0% (cadrille hit 0.0% invalid on DeepCAD). Chain-of-Thought before the program cut invalidity >50% (CAD-Coder).

3. **The reward signal moved from render-similarity → geometry-truth → kernel-measured properties → physics.** CADFusion/Query2CAD used VLM render-critique; CAD-Coder/cadrille/ReCAD/FutureCAD use Chamfer/IoU from kernel execution; **CADSmith** uses exact OpenCASCADE measurements (bbox/volume/validity) in the loop and beat render-only critique; the **FEA-feedback paper** scores typed physical requirements where frontier agents pass ~0% strict. Forge's MIT-PhD-validated kernel physics is a moat no other text-to-CAD work has.

**The 3–4 decisions this implies for Forge:**

- **D1 — Keep the tool-call-into-own-kernel representation; it is the SOTA frontier, not a contrarian bet.** TOOLCAD (arXiv:2604.07960) is the published twin of Forge: LLM-as-tool-user → kernel primitives via MCP/ForgeToolBridge → step-level execution reward. Adopt its architecture ≈1:1.
- **D2 — Wire `ForgeCADScore` as an RL reward, not just an offline eval.** SFT on bulk_synth tool-call corpora, then GRPO with reward = validity gate + Chamfer/IoU (the CADGenBench shape axis) + format. This is the single highest-leverage change and directly attacks our v3 baseline (0.38 overall, shape 0.357).
- **D3 — Make the agent state-aware + add a plan-generate-verify edit loop.** Feed live kernel topology/state back between calls (CAD-Assistant, ToolCAD); for the STEP-change-request gate, localize→infill K candidates→re-execute all→select best geometry (CADMorph, CAD-Editor). Verify-by-execution, never by self-talk.
- **D4 — Adopt the standardized metric set + hard validity gate so numbers are externally comparable.** Implement CAD-MLLM topology metrics (SegE, DangEL, SIR, FluxEE) + OCCT validity + Chamfer + Vol-IoU; keep the hard-zero gate (watertight/manifold/meshable or score=0) exactly as CADGenBench/BenchCAD do.

---

## 2. REPRESENTATION CHOICE

Three families compete. The evidence below resolves which Forge should emit.

### 2.1 The three families

| Family | What the model emits | Watertight-solid responsibility | Examples |
|---|---|---|---|
| **A. B-rep-native generation** | Low-level geometry tokens (UV-grid shape codes + bbox) + topology/adjacency IDs | Model emits primitives; **kernel fits & sews** (OCCT) | AutoBrep, HoLa, BrepGen, DTGBrepGen, BrepGPT, SolidGen, BrepARG |
| **B. CAD construction-sequence / program** | A fixed-vocab op sequence (sketch-extrude-boolean) or executable code (CadQuery/build123d/FreeCAD-Py) | Model emits operations; **kernel builds** (replay) | DeepCAD, SkexGen, Text2CAD, CAD-Coder, CADmium, CAD-Recode, cadrille |
| **C. Tool-call / agentic DSL into a live kernel** | Typed tool-calls (`make_box`/`cut`/`fillet`/`bolt_circle`/`export_step`) executed step-by-step, with state read-back | Model emits operations; **kernel builds**, agent adapts mid-sequence | **TOOLCAD**, CAD-Assistant, RLCAD, **Forge/Archie** |

Families B and C are the same bet at different altitudes: emit operations, let the kernel produce the solid. Family C is B made *agentic* (state-aware, stepwise, RL-trainable against the live engine).

### 2.2 Evidence

- **A-family proves the kernel owns watertightness.** AutoBrep's headline is **70.8% validity** (the strongest AR result; ~50% at 100 faces), HoLa ~82–84%, DTGBrepGen 88.3% — i.e. *the best direct-B-rep generators still can't reliably produce a valid solid*, and they all lean on OCCT to fit-and-sew at the end. AutoBrep's geometry is *approximated* by fitting B-splines to UV grids (lossy), threads/thin-shells fail. **Conclusion: do not have the model emit geometry; have it emit operations the kernel executes exactly.** AutoBrep is the strongest argument *for* Forge's design — it shows the watertight step belongs to the kernel.
- **B-family proves operations→valid-solid works at high fidelity.** DeepCAD: ACC_cmd 99.5%, ACC_param 97.98%, **invalid ratio only ~2.7%** by deterministically replaying through pythonOCC. Fusion360 Gallery: best GNN agents hit **67% exact reconstruction** with ~1.0 conciseness from a 2-op DSL. cadrille: **0.0% invalid** on DeepCAD after RL. The op-sequence is learnable, replays valid, and round-trips to STEP.
- **Code/tool-call DSLs beat opaque token vocabularies.** CAD-Llama (+15.7% over GPT-4 via code-like SPCC), CAD-Coder (100% valid syntax, beats GPT-4.5), CADmium (Qwen2.5-Coder-14B). The reason: reuse of pretrained programming priors + human-editability + executability-as-validation.
- **C-family is the published SOTA for agentic kernel-driving.** TOOLCAD: Qwen3-8B hits **63.9% multi-part success**, beating GPT-4o ReAct (62.7%) and Text2CAD SFT (43.7%), via tool-calls + step-level engine-execution reward. CADSmith: kernel-measurement-in-the-loop pushed median IoU 0.81→0.96, mean Chamfer 28.37→0.74, 100% exec — **beating render-only critique**. State-aware tool-callers (CAD-Assistant) outperform blind one-shot generation because they read back live geometry.
- **Caveat from build123d / CADDesigner:** an easy-to-emit API does **not** guarantee shape accuracy — a build123d-emitting agent had the best Pass@1 (0.59) but the *worst* IoU (0.26). **High emit-success ≠ correct geometry**, which vindicates scoring shape/IoU/topology separately (exactly the CADGenBench axes).

### 2.3 Recommendation for Forge

**Emit Family-C tool-call sequences into the native OCCT-class kernel — this is correct and is the 2026 frontier.** Concrete representation decisions, with their evidence:

1. **Reference prior bodies/faces/edges by stable handle, not coordinate.** Fusion360's `{start_face, end_face, op}` face-extrusion triple and AutoBrep's *local* reference-token scheme (an edge may only reference faces from the previous BFS level; 200 IDs over a 2-level window) both prove handle-based topology references raise the interface/topology axes. Maps to Forge's context-verb shared-ctx. **Adopt topology selectors (pick edges/faces by GeomType + position, not index)** per build123d — robust to topological-naming fragility (OCCT IDs are *not* stable across edits).
2. **Quantize/snap every continuous arg to a fixed grid and classify, not regress.** DeepCAD's 256-bin (8-bit) quantization is "the single highest-leverage trick" — it makes geometric relations snap and cuts malformed-arg failures. CADMorph and FlexCAD use the same 256-bin recipe. Apply to Archie's dimensions/coords/counts.
3. **Commit topology/adjacency before geometry params.** DTGBrepGen (topology-first → 88.3% valid) shows decoupling raises validity. Favor a verb schema where the structural reference is fixed first.
4. **Use build123d's verb taxonomy as the schema oracle.** build123d verbs (`Box`, `Cylinder`, `extrude`, `revolve`, `sweep`, `loft`, `fillet`, `chamfer`, `Hole`, `CounterBoreHole`, boolean `Mode.SUBTRACT`, `PolarLocations`/`GridLocations` for bolt circles) map almost 1:1 onto Forge tool-calls. It is Apache-2.0 on an OCCT kernel — a **license-clean oracle/equivalence-checker**: replay an Archie sequence vs an equivalent build123d script and diff the B-reps. Forge's verb set is a *superset* (real fillet/chamfer, patterns, booleans, simulation) — do **not** cap Archie at sketch-extrude.

---

## 3. DATASETS

All sizes/licenses below are load-bearing. **Licensing warning for a free-but-not-OSS commercial product:** ABC and DeepCAD are MIT (safe to train shipped weights). **Fusion 360 Gallery is CC BY-NC 4.0 — NON-COMMERCIAL: use only for research/eval, never to train shipped Forge weights.** Replace with procedural data where needed.

### 3.1 CAD-program / B-rep corpora

| Dataset | Size | License | Format | Use for Forge tool-call corpus |
|---|---|---|---|---|
| **ABC** | ~1M B-rep CAD models (Onshape) | **MIT (commercial-OK)** | STEP + parametric curves/surfaces + differential GT | Root corpus. Replay STEP→kernel→back-derive op/feature labels; train a face-operation evaluator. |
| **ABC-1M** (AutoBrep) | ~1.3M dedup single-part solids from ABC | MIT (HF, ungated) | STEP, dedup-by-hash, ≤100 faces/≤1000 edges filter | **Immediately usable, ungated.** Replay each STEP→kernel→back-derive tool-call supervision; cleaning heuristics ready-made. |
| **DeepCAD** | ~178k sketch-extrude sequences (~150k/8k/8k) | **MIT** | 16-D command JSON + STEP | **Primary SFT bootstrap.** Convert 16-D command JSON → Forge tool-call sequences directly. 6-cmd DSL ⊂ Forge verbs. |
| **Fusion 360 Gallery** | Recon 8,625 seqs; Seg 35,858 face-labeled B-reps; Assembly 8,251 asm/154k parts; Joint 32,148 joints | **CC BY-NC 4.0 (NON-COMMERCIAL)** | JSON seqs + STEP + .smt + per-face op labels | **Research/eval & scorer-training ONLY.** 8 op-labels (ExtrudeSide/End, CutSide/End, Fillet, Chamfer, RevolveSide/End) map ~1:1 to verbs → train face↔verb scorer. Do NOT train shipped weights. |
| **SketchGraphs** | 15M Onshape 2D sketches as constraint graphs | research-oriented | constraint hyper-graphs | Sketch+constraint supervision for Forge's PLANEGCS auto-constrain (see §4.6). |
| **CPTSketchGraphs** (DAVINCI) | 80M constraint-preserving-augmented sketches | research | constraint graphs | Augmentation source for constraint-graph training. |
| **CC3D / CC3D-Ops / CC3D-PSE** | 50k+ real scans + CAD; 37k+ B-reps w/ revolve/chamfer/fillet | research | scan↔CAD pairs | **OOD / sim-to-real eval set.** Where prior methods collapse (CAD-SIGNet IR 15.5%). Never overfit to DeepCAD — test here. |
| **Text2CAD** | ~170k models / ~660k beginner→expert prompts over DeepCAD | research | text↔sequence | NL-conditioning SFT pairs for the CUA prompt path. |
| **Omni-CAD** (CAD-MLLM) | ~450k: text + multi-view img + points + commands | research | multimodal | Multimodal-conditioning SFT (drawing/image→tool-call). |
| **GenCAD-Code** (CAD-Coder VLM) | 163k image↔CadQuery code pairs | open | image↔code | Image→code SFT; convert CadQuery→Forge verbs. |
| **CAD-Coder triplets** | 110k text-CadQuery-3D + 1.5k CoT | open | text↔code↔3D | **Ready RL/SFT fuel.** CadQuery ⊂ Forge ops; reuse CoT samples. |
| **CADmium** | 170k+ DeepCAD models + GPT-4.1 multi-view captions + JSON seqs | **open (HF, weights+data)** | captions↔JSON seq | **Direct 14B precedent.** Qwen2.5-Coder-14B fine-tune — pull weights+data as fuel. |
| **CAD-Recode procedural set** | 1M procedurally-generated CadQuery sequences | license-clean synthetic | code | Mirrors bulk_synth; proof procedural-heavy works. |
| **TOOLCAD trajectories** | 982 tool-call demos (782 train/200 test) from L3 expert prompts | open | tool-call traces | **Template for mining Forge's own trajectories** — confirms RL needs only ~1k demos, not millions. |
| **mrCAD** | 6,082 human-human games / 15,163 multimodal refinement rounds | check repo | text+drawing edit rounds | **Refinement-trajectory template.** 2D only — use as recipe, not direct data. |
| **A2Z-10M+** | 10M multimodal annotations over 1M ABC; ~5TB | research (CVPR'26) | meshes+3D sketches+BRep co-edge/corner labels | BRep-supervision for a scorer. **5TB — stream/subset only.** |

### 3.2 Simulation-surrogate corpora (for #20/#29 — see §6)

| Dataset | Size | License | Use |
|---|---|---|---|
| **DaRUS racing-kart** | LS-DYNA R10.1 .key + disp/vel/accel/force fields | **BSD-3-Clause (public)** | **Best ready-made dynamic explicit-FE crash trainer.** |
| **CCSA 2012 Toyota Camry** | 2.25M elements / 1,086 parts, validated LS-DYNA | **free, public (~58.5MB v5a)** | Run a DoE → mint a Kneifl-style proprietary-grade crash corpus. |
| **DrivAerNet / ++ / Star** | 4,000 car shapes, 8–16M CFD cells, **5.6 TB** VTK | open-source | Aero (#20) corpus + RegDGCNN GNN baseline (R²≈0.90). **5.6 TB violates M4-Max storage — surface fields only, stream→process→delete.** |
| Nabian BIW (GM) / Shaikh EV / SIA Renault-Stellantis | 150 / 245 / 60 sims | proprietary/gated | Method references, not direct data. |

### 3.3 Storage-safe ingestion (M4-Max constraint)

Per the streaming-storage rule: **download → process → delete one-at-a-time**, parquet via `iter_batches`. For A2Z-10M+ (~5TB) and DrivAerNet (~5.6TB) this is mandatory — pull only the slice you need (surface fields, not volumetric VTK; the STEP+label, not the full mesh). ABC-1M, DeepCAD, CADmium, CAD-Coder triplets are small enough to hold locally. **Prefer procedural generation (bulk_synth) as the bulk of training data** — license-clean, infinite, storage-bounded — and validate on real sets (the CAD-Recode/cadrille proven pattern, matching our own strategy).

---

## 4. METHODS TO ADOPT

Mapped to Forge's tool-call + CADGenBench setup. Ordered by leverage.

### 4.1 TOOLCAD architecture ≈1:1 (the single most Forge-aligned paper)

LLM-as-tool-user calling kernel primitives via a typed interface (their **MCP → Forge's ForgeToolBridge**), with **CAD-CoT `<think>`/`<tool_call>`/`<tool_response>`** trace formatting, two-stage **SFT → curriculum online GRPO**. **Hybrid reward = Outcome-Reward-Model + step-level kernel execution feedback + format reward** — this is exactly what CADGenBench should compute. Their 982-trajectory regime confirms the RL stage needs ~1k demos, not millions. *Adopt the whole loop.*

### 4.2 Geometry-truth RL reward (cadrille / CAD-Coder-CoT / ReCAD / FutureCAD)

Execute the tool-call sequence in the kernel; compute **Chamfer/IoU vs ground truth**; train with **GRPO/GSPO — online beats offline (cadrille)**. RL drove invalid output from 2–15% → ~0%. CoT before the program cut invalidity >50% (CAD-Coder). **FutureCAD's BRepGround** validates grounding tokens to actual B-rep faces/edges rather than free coordinates. *This upgrades `ForgeCADScore` from an offline replay-scorer into the RL reward signal.*

### 4.3 Plan-Generate-Verify loop (CADMorph) + refinement-as-first-class (mrCAD)

- **CADMorph:** max-10-iteration loop — **(Plan)** attribute which prior ops/params drive the geometry delta and mask them; **(Generate)** sample N candidate sequences (masked-param infill); **(Verify)** re-execute all N, select best by geometry score; keep a **cross-round priority queue** of best-so-far. Ablation: removing Verify pushed invalid 3.1%→10.7%; removing Plan → 15.3%. Forge gets *exact* verification (real B-rep), strictly stronger than CADMorph's learned SDF-latent proxy. **Adopt: wrap ForgeRunner in a best-of-N replay+score+keep-queue loop scored by `ForgeCADScore`.**
- **mrCAD's hard lesson:** all SOTA VLMs score **NEGATIVE** on refinement (GPT-4o −0.119, Claude-3.7 −0.051) — they *degrade* designs when asked to edit; only humans are positive (+0.119). **Edit/modify verbs (move/remove/re-fillet/change-dim against existing bodies) must be first-class tool-calls, and the corpus must include multi-round refinement trajectories** (state→instruction→edit-call→improved state), not just one-shot generation. This is a concrete eval target: beat GPT-4o/Claude on refinement, where they go negative.

### 4.4 Autoregressive topology+geometry (AutoBrep) — informs data/eval, not the generator

AutoBrep emits *geometry* tokens then OCCT-sews; Archie emits *operations*. Take: **local reference-token scheme** (windowed handle space, 200 IDs/2 levels) to bound Archie's selection vocabulary; **complexity meta-token** (Easy <25 / Medium 25–50 / Hard >50 faces) as a cheap conditioning trick for synth + inference difficulty control; **validity = OCCT-sews-to-watertight rate + distributional Coverage/MMD/JSD/Novelty/Uniqueness** as headline metrics. The B-rep generation line (HoLa ~82–84%, DTGBrepGen 88.3%, BrepGPT/BrepARG single-token-stream) is **complementary** (perceive/score) not competitive — Forge does the generative half via replay.

### 4.5 B-rep message passing as a SCORER/VERIFIER, not a generator (BRepNet / UV-Net / BRT)

These are **discriminative encoders** — adopt as the geometry-truth *backbone for CADGenBench's topology/interface axes*, run on the realized solid after replay:

- **BRepNet** (~359k params, CPU-friendly): coedge/winged-edge message passing → per-face operation class (92.5% acc / 77.1% IoU). After Archie replays, re-segment and check predicted op-labels against the tool-call sequence (a `make_box` face → ExtrudeSide/End; a `fillet` face → Fillet). A concrete **topology-truth** signal that runs alongside the kernel without a GPU. Reusable feature taxonomy (surface type, curve type, edge convexity, coedge orientation, face area, edge length) — Forge's OCCT kernel already exposes all of these.
- **UV-Net:** the canonical "how to featurize a face/edge" recipe (UV-grids + adjacency graph).
- **BRT** (arXiv:2504.07134): native-B-rep transformer encoder, **continuous Bezier-triangle representation beats UV-grid discretization** (99.27 vs 98.14). Its **masking regularizer** (drop 25–50% of geometry, demand same output; ablation 99.27→94.79) is a cheap transferable trick for robustness to **incomplete/in-progress (not-yet-watertight) B-reps** — relevant to Archie predicting mid-build. Use as a candidate **B-rep verifier head** and continuous-embedding feature extractor inside CADGenBench. Public STEP corpora it ships: **TMCAD** (10k STEP, 10 classes), MFCAD++, Fusion360 — usable for a feature-recognition evaluator.

### 4.6 Constraint-solver-as-reward (Autodesk design-intent, ICCV'25) — for the sketch workbench

Post-train a constraint model with the **real solver's DOF status** (under/over/fully/unstable-constrained) as reward → **93% fully-constrained**. Forge ships **PLANEGCS** — use *it* as the reward to train auto-constrain. DAVINCI's single-stage joint primitive+constraint prediction from a raster sketch + Constraint-Preserving-Transformation augmentation is the supervised baseline (SOTA on SketchGraphs with 0.1% of data).

### 4.7 Kernel-measurement-in-the-loop > render-only (CADSmith / CAD-Judge / CAD-Assistant)

CADSmith's outer loop grounds on **exact OpenCASCADE measurements (bbox/volume/validity)** + an independent VLM judge → median IoU 0.81→0.96, 100% exec. CAD-Judge's **Compiler-as-a-Judge** (Chamfer as a fast verifiable reward) curbs reward-hacking and is cheaper than a VLM judge. **Use exact kernel measurements as the primary in-loop signal; keep a VLM judge only as an outer holistic check.**

### 4.8 RLCAD — wrap the in-house kernel as an RL gym

The blueprint for making forge-kernel an RL environment (policy emits a kernel op → kernel builds → feedback; 39× faster than the prior gym). Confirms **revolution/sweep ops matter beyond sketch-extrude** — extend Forge's verb set accordingly.

---

## 5. BENCHMARKS

### 5.1 CADGenBench (the north-star gate) and how ForgeCADScore relates

CADGenBench is **tool-agnostic** (submit STEP from any stack — build123d, CadQuery, OpenSCAD, Onshape, Fusion, SolidWorks, *or Forge's kernel→STEP*), scored on the same axes `ForgeCADScore` already implements. From `cadgenbench.md`:

```
HARD GATE: well-formed + watertight + meshable + manifold, else score = 0
cad_score = 0.4·shape_similarity + 0.4·interface + 0.2·topology_match    (if valid)
shape_similarity = ½·(surface_distance_F1 + volume_IoU)
  surface match = ≤0.5% bbox-diag distance AND ≤20° normal; IoU via manifold3d
Editing: shape axis renormalized vs no-op baseline → "doing nothing earns ~0"
```

`ForgeCADScore` should **re-implement these four axes 1:1** (validity / shape / interface / topology) for offline self-eval AND as the RL reward (§4.2). The target is **≥0.85 on all dims** (CLAUDE.md gate). The reference baseline is an iterative render-feedback agent — to beat it, Forge's render+kernel feedback must surface the same validity/shape/interface/topology read-outs to Archie before "submitting."

### 5.2 The field's evals and how they map

| Benchmark | What it scores | Maps to CADGenBench axis |
|---|---|---|
| **DeepCAD recon protocol** | ACC_cmd, ACC_param (within η=3-bin tolerance), median Chamfer, **Invalid Ratio** | op-selection / param-acc-with-tolerance / shape / **validity gate** |
| **Fusion360 Reconstruction ENV** | IoU, exact-recon (IoU=1), **conciseness** (pred len/GT len) | shape+validity; conciseness = program-economy (adopt) |
| **CAD-MLLM metric suite** | **SegE, DangEL (dangling-edge), SIR (self-intersection), FluxEE (flux-enclosure)** | **topology/interface — adopt these names so numbers are comparable** |
| **CadBench (2605.10873)** | Vol-IoU, Surface-IoU, Chamfer, Valid-Shape-Rate, token/op counts | shape + validity + economy |
| **BenchCAD (2605.10865)** | Vision2Code, Edit-Code, Code-QA, Vision-QA; essential-op recall; 4-level hierarchy | edit task + capability tiers |
| **Text2CAD-Bench (2605.18430)** | 600 examples, L1 primitives→L4 freeform | difficulty curriculum |
| **MUSE (2605.28579)** | Manufacturable / Functional / Assemblable | downstream-validity (Forge assembly goal) |
| **CC3D** | real-scan OOD recon | OOD generalization gate |
| **FEA-validated brief (2605.17448)** | typed physical/geometric reqs via FEA | **physics-truth — Forge's moat** |

**Report Chamfer + Vol-IoU + valid-ratio + topology-F1** so Forge numbers sit on the DeepCAD leaderboard. The key honest caution (build123d/CADDesigner): **high Pass@1 ≠ shape correctness** — keep shape/IoU/topology as *separate* dimensions.

### 5.3 Validity bars to target

AutoBrep 70.8% / HoLa ~82–84% / DTGBrepGen 88.3% validity are the B-rep-gen bars; DeepCAD ~2.7% invalid and cadrille 0.0% invalid (post-RL) are the sequence bars. **Forge targets watertight 1:1 kernel-parity (validity → ~100% by construction, since the kernel either builds or surfaces a real error)** — that is the structural advantage of the replay design.

---

## 6. SIM-SURROGATE NOTES (for #29 ML-surrogate/ROM and #20 grounded dynamic FEA/CFD)

Forge already has its own MIT-PhD-validated dynamic FEA (HHT-α multibody, Wilson-Q6 de-locking) per the physics-rigor memo — so it can **generate its own corpus** exactly as Kneifl/Nabian did (run a DoE on a high-fidelity model, store full-field nodal trajectories, train a surrogate), rather than depending on gated external data.

### 6.1 Surrogate architecture menu (by use case)

- **GNN / MeshGraphNet** (Nabian; DrivAerNet RegDGCNN): default for unstructured FE/CFD meshes; mesh-resolution-invariant; best when geometry varies. RegDGCNN: R²≈0.90, ~1000× fewer params than attention models.
- **Transformer / Transolver** (Nabian): linear-complexity attention for large meshes; strongest long-horizon transient stability.
- **GCN-autoencoder + MLP latent dynamics** (Kneifl): **tiny latent (dim 4)** ROM; **multi-LOD via residual cascade + transfer learning** (coarse→fine) — directly serves *one body at many resolutions*. Crash trajectories live on a very low-dim manifold.
- **CUR-ROM / Neural Fields** (SIA challenge): CUR for scarce data (<20 sims); Neural Fields overtake at ≥20 sims.
- **GPR** (Shaikh) / **BNN** (Lahoz): scalar/low-dim outputs with *calibrated UQ* on tiny data.
- **Plain FCN** (Sakaridis): sufficient for 1-D response curves (force-time), **>10,000× speedup**.

### 6.2 The dominant recipe (#29)

Run a DoE on a high-fidelity FE/CFD model → store full-field nodal trajectories → train a mesh-GNN (or GCN-AE ROM) with **autoregressive rollout training** (AR-RT) for transient stability. **Two cheap, high-leverage preprocessing tricks, both repeatedly cited as the difference between a usable and an unstable surrogate:** (a) Nabian's **autoregressive rollout training** for long-horizon stability; (b) SIA's **rigid-body + local-deformation displacement split**.

### 6.3 UQ / error-bound methods (ranked by takeability)

1. **GPR posterior variance + Monte-Carlo input-uncertainty propagation** (Shaikh: 5×10⁶ samples, 1–1.5% input σ → <0.5% output σ) — cleanest "design with error bars."
2. **BNN predictive uncertainty** (Lahoz) — flags low-confidence inputs; works at 140 samples.
3. **Physical-sensitivity bounding** (Sakaridis): "surrogate error ≈ FE's own geometric-imperfection scatter" — an honest *non-statistical* bound that fits Forge's no-fake-numbers rule.
4. **Held-out blind scoring on unseen designs** (SIA) — the right *validation protocol*.

### 6.4 Data availability

DaRUS kart (BSD-3, dynamic explicit, disp/vel/accel/force) = best ready-made dynamic crash trainer; CCSA Camry (free, validated, 2.25M-element) → DoE to mint a proprietary-grade set; DrivAerNet (open, 4,000 shapes, **5.6 TB — surface fields only, stream-process-delete**) = aero corpus. GM BIW / Shaikh EV / SIA Renault are proprietary (method refs only).

---

## 7. CONCRETE #17 TRAINING RECIPE

**Goal:** lift the CADGenBench baseline from **v3 = 0.38 overall, shape 0.357** toward the ≥0.85-all-dims gate, with focused attack on **shape accuracy** and **no over-generation** (emit minimal correct ops, not bloated sequences).

### 7.1 Corpus mix

| Source | Role | Notes |
|---|---|---|
| **bulk_synth_cadgen** (procedural geometry corpus) | **Bulk SFT (~70–80%)** | License-clean, infinite, storage-safe; mirror CAD-Recode (1M)/cadrille pattern. Quantize all args to 256 bins. |
| **DeepCAD → Forge tool-calls** (MIT) | SFT | Convert 16-D command JSON → Forge verbs; ~178k models. Primary real-data bootstrap. |
| **CADmium** (open, HF) + **CAD-Coder triplets** (110k) | SFT | Direct 14B precedent + CadQuery→Forge-verb conversion + reuse 1.5k CoT samples. |
| **ABC-1M** (MIT, ungated) | SFT + scorer | Replay STEP→back-derive tool-call/feature supervision. |
| **TOOLCAD-style mined trajectories** (~1k from L3 expert prompts) | **RL demos** | Mine our own from Forge API (no off-the-shelf corpus targets Forge verbs). ~1k suffices for RL. |
| **Multi-round refinement traces** (mrCAD-style, synthesized via CAD-Editor pipeline) | SFT + RL | **Mandatory** — first-class edit verbs; state→instruction→edit-call→improved state. Attacks the negative-PI failure mode. |
| **Fusion360 Gallery** (CC BY-NC) | **scorer/eval ONLY** | Train face↔verb scorer (BRepNet head); **never** shipped weights. |

### 7.2 Objective (two-stage, the field consensus)

1. **SFT** — next-token over CAD-CoT `<think>`/`<tool_call>`/`<tool_response>` traces (TOOLCAD format). Loss-as-classification on quantized args (DeepCAD). Learn syntactic validity + the format. **CAUTION (from memory):** drop `--mask-prompt` for long samples (all-masked → NaN loss silently corrupts the adapter); early-verify loss + NaN-guard.
2. **Online RL (GRPO/GSPO, online>offline)** — reward = **validity hard-gate (score 0 if not watertight/manifold) + shape (Chamfer + Vol-IoU, the CADGenBench shape axis) + interface + topology (CAD-MLLM SegE/DangEL/SIR/FluxEE) + format + step-level kernel-execution feedback**. Reward computed by **executing each candidate in forge-kernel** (CADSmith exact measurements > render-only). ~1k demos suffices. Plan-Generate-Verify best-of-N + cross-round priority queue at inference (CADMorph).

### 7.3 Shape-accuracy + no-over-generation focus (the v3 attack)

- **Shape (0.357 → target ≥0.85):** the v3 weakness is dimensional fidelity. Fixes: (a) 256-bin **arg quantization + snap-to-grid** so dimensions/fillet-radii/wall-thickness land on exact drawing values (no scaling rescue — CADGenBench uses rigid align only); (b) **geometry-truth RL reward** directly on surface-F1 + Vol-IoU; (c) **topology selectors** (GeomType+position) so fillets/holes attach to the right faces; (d) **BRT continuous-embedding verifier** to catch near-miss geometry SFT misses.
- **No over-generation:** adopt Fusion360's **conciseness metric** (pred-len/GT-len, target ≈1.0) as an auxiliary reward penalty; CADMorph's **minimal-diff edit attribution** (change only the ops that drive the geometry delta) prevents bloated regeneration; reward emitting the *shortest* valid sequence that hits the shape target.

### 7.4 Eval plan

- **Primary:** `ForgeCADScore` (4 axes, hard validity gate) on a held-out CADGenBench-style set; track **validity_rate / shape / interface / topology separately** (a 0.85 mean can hide a 0.5 axis).
- **Standard leaderboard comparability:** report Chamfer (median+mean), Vol-IoU, Surface-F1, Invalid-Ratio on **DeepCAD + Fusion360 recon** splits.
- **OOD:** **CC3D** (real-scan) + CadBench noisy-mesh/photoreal modalities — never overfit DeepCAD.
- **Refinement axis (the differentiator):** mrCAD-style multi-round edit eval; target **beating GPT-4o/Claude (who score NEGATIVE)**.
- **Engineering-truth (the moat):** FEA-validated typed-requirement eval (arXiv:2605.17448) using Forge's own kernel physics — frontier general agents pass ~0% strict here.
- **Topology checks Chamfer misses:** add **Euler-characteristic + manifold + mean-curvature/sphericity** (CADmium) to the scorer.

---

## 8. OPEN RESEARCH QUESTIONS + PAPERS TO READ NEXT

### 8.1 Open questions (the field is not exhausted)

1. **Multi-part / assembly context.** Every surveyed system is single-part. Forge's ~20k-component flagships (GE9X) and assembly-mating are *untested* in the literature. How to condition tool-call generation on surrounding-assembly context (the memory note: geometry-gen & GD&T need FULL assembly context)?
2. **PMI / GD&T / tolerance generation.** No surveyed work scores GD&T, PMI, or interface-fit semantics. Forge's kernel has PMI/tolerance bound-but-not-bridged and *no geometric FCF evaluator* — an open scorer to build.
3. **Editing robustness.** mrCAD proves SOTA models *degrade* designs on refinement (negative PI). Closing this with edit-trained Archie + verify-loop is unproven at scale.
4. **OCCT topological-naming fragility.** Stable handles across edits are heuristic — how to keep tool-call references valid through a long edit history?
5. **Physics-grounded generation.** Frontier agents pass ~0% strict FEA-typed briefs. Forge's validated kernel physics is the moat — but the closed-loop "generate→FEA→repair" trainer is unbuilt.
6. **Scale.** Largest surveyed parts are ~100 faces / <40 commands; Forge needs thousands of components via organized instancing. Does the tool-call + RL recipe hold at flagship scale?
7. **Online-RL reward-hacking** at the kernel boundary (CAD-Judge mitigates for Chamfer; unproven for multi-axis + topology rewards).

### 8.2 Papers to read next (chase order)

1. **TOOLCAD** (arXiv:2604.07960) — *read first*; the published Forge twin (tool-calls + step-level kernel reward + curriculum GRPO). Also CMU/arXiv:2604.07960 ToolCAD variant cross-check.
2. **cadrille** (arXiv:2505.22914, ICLR'26) — online-RL>offline proof; multimodal single model; 0% invalid recipe.
3. **CADSmith** (arXiv:2603.26512) — kernel-measurement-in-the-loop > render-only; 5-agent + nested correction loops.
4. **Self-Improving CAD Agents w/ FEA Feedback** (arXiv:2605.17448) — engineering-grounded eval; the physics moat; frontier agents ~0% strict.
5. **FutureCAD** (arXiv:2603.11831) — BRepGround: ground LLM tokens to actual B-rep faces/edges.
6. **CADMorph** (arXiv:2512.11480) + **CAD-Editor** (arXiv:2502.03997) — plan-generate-verify edit loop + synthetic edit-triplet pipeline (for the STEP-change-request gate).
7. **CADmium** (arXiv:2507.09792, TMLR) — direct 14B-code-LLM-drives-CAD precedent; open weights+data.
8. **Aligning Constraint Generation with Design Intent** (Autodesk, arXiv:2504.13178) — solver-as-reward → 93% fully-constrained (for PLANEGCS auto-constrain).
9. **HoLa** (arXiv:2504.14257) + **DTGBrepGen** (arXiv:2503.13110) — B-rep-gen validity bars + topology-first decoupling.
10. **BRT** (arXiv:2504.07134) + **Brep2Shape** (arXiv:2602.07429) — continuous B-rep encoders/verifiers + self-supervised B-rep pretext.
11. **CadBench/BenchCAD/Text2CAD-Bench/MUSE** (2605.10873 / 2605.10865 / 2605.18430 / 2605.28579) — metric-axis comparability + manufacturable/assemblable extension.
12. **RLCAD** (arXiv:2503.18549) — wrap forge-kernel as an RL gym (39× faster gym design).
13. **Nabian crash** (2510.15201) + **DrivAerNet** (2403.08055) + **Kneifl** (2402.09234) — the #20/#29 surrogate trio (rollout-training, GNN aero baseline, multi-LOD ROM).

---

*Synthesized 2026-06-21 for the Forge team, SCOPE_2026-06-21 / task #17. Sources: 8 named-paper deep reads + 5-cluster field sweep (text-to-CAD / B-rep gen / construction-seq / datasets / editing-constraint) + ML-sim-surrogate cluster. License flags and storage cautions are load-bearing — read §3 before any data pull.*
