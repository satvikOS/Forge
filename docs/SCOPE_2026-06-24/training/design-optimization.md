# Training Curriculum — Cluster: Design & Optimization

**Cluster scope:** Industrial Design · Generative Design Engineering · Topology Optimization · Industrial Automation & Robotics
**Owner:** SCOPE_2026-06-24 / training · **Date:** 2026-06-24 · **Status:** curriculum spec (folds into `archie_corpus_program.md` Pillar B, clusters 3 & 5; Pillar D synthesis primitive)
**Target model:** ONE local 14B (Qwen2.5-14B + DeepSeek-R1 reasoning, 4-bit qLoRA, 36 GB M4 Max ceiling). Adapter homes: `arch14b-geom` (ID/Class-A), `arch14b-mfg` (generative/topopt/DfAM bridge), `arch14b-mech` (automation/robotics), `arch14b-eagi` (synthesis capstone).

> **THESIS.** Make Archie reason like a practising senior design-optimization engineer who PRODUCES MANUFACTURABLE GEOMETRY, not chat. Every sample terminates in a schema-valid `forge.<workbench>.<op>(args)` tool-call the kernel can replay and a geometry-truth scorer can grade. Synthetic dominates; we own a deterministic kernel that labels designs with real performance vectors — the moat P-1/Prometheus must license third-party sim for.

> **GROUNDING DISCIPLINE (read first).** The four fields divide into *kernel-mature* and *kernel-roadmap*:
> - **Mature / bound today:** B-Rep part/direct ops (`forge.part.*`, `forge.direct.*`), Class-A surfacing (`ClassASurfacing.cpp` → `forge.surf.classA`), FEA static/modal (`forge.fea.{analyseStatic,modal}`, validated 0.33 %/0.2 %), HHT-α multibody DAE (`forge.simulate.multibodyDynamics`, pendulum 0.016 %), mass-props (`forge.*.massProps/centerOfMass`), PMI export (`forge.io.exportStepWithPmi`), sketcher (`forge.sketcher.*`).
> - **Roadmap / partially-present:** `forge.topopt.*`, `forge.implicit.*` / `forge.gen.explore`, `forge.am.*`, `forge.robotics.*`. The implicit SDF primitive (`sdfSphereVolume`) and `simplifyShape` exist; the full SIMP/level-set/NSGA-II/Pieper-IK solvers are specified but NOT all A/B-proven.
> **CONSEQUENCE for the corpus:** where a verb is roadmap, the sample MUST either (a) target the verb at its specified signature so training pre-positions Archie for the bound version, AND (b) carry the honesty rule — if Archie is asked to invoke an unverified solver it surfaces the limit (e.g. "topopt.simp runs the validated linear-static stiffness solve; stress-constrained p-norm is unverified — I report compliance/volFrac, flag stress as advisory"). Never fabricate a converged optimum the kernel can't reproduce.

---

## 0. WHY THIS CLUSTER IS HARD (the senior-engineer judgment we must encode)

The four fields share one failure mode that defeats every text-to-CAD model: **they optimize a number and produce un-buildable geometry.** A topology-optimized bracket with 0.4 mm members no printer resolves; a Class-A surface with a G1 break that lights up under zebra; a generative lattice that's a watertight mesh but un-meshable for FEA; a robot cell whose "reachable" pose is in a wrist singularity. Senior judgment = holding the *manufacturing and physics envelope* fixed while optimizing, then re-checking the optimum is real. The curriculum's spine is therefore **optimize → re-validate against the make/physics constraint → emit replayable geometry**, never "report the objective."

---

## 1. KNOWLEDGE BREAKDOWN (bachelors → masters → PhD → industry)

### 1A. Industrial Design (ID) — form, ergonomics, Class-A surfacing
*(grounds: `ClassASurfacing.cpp`, `forge.surf.classA`, `forge.id.anthropometry`)*

| Level | Sub-topics & theory | Equations / criteria | Standards | Hard judgment |
|---|---|---|---|---|
| **BS** | Form, proportion, sketch→CAD, CMF (color/material/finish), human factors basics | Golden ratio φ=1.618; curvature κ=1/R | ISO 7250 (body measurements), SAE J833 | "A fillet is not a Class-A blend." Visual radius ≠ geometric radius. |
| **MS** | Class-A surfacing strategy (loft vs sweep vs network-of-curves vs boundary); curvature-continuous NURBS; CMF for perceived quality | G0 position / G1 tangent / G2 curvature / G3 curvature-rate continuity; curvature comb; reflection-line/zebra theory | DIN 33402 anthropometry, ISO 9241 (interaction ergonomics) | Reading a zebra stripe break → naming the continuity defect (G0 vs G1 vs G2) and the surfacing cause. |
| **PhD** | Curvature-flow surface fairing; minimal-energy / variational surfaces; perceptual quality metrics; isophote analysis | Bending energy ∫(κ₁²+κ₂²)dA; reflection-line = isophote n·v=const; Gaussian K=κ₁κ₂, mean H=(κ₁+κ₂)/2 | — | When G2 is *required* (highlight-critical Class-A panel) vs when G1 suffices (interior rib) — cost/quality trade. |
| **Industry** | Anthropometric clearance against a real assembly; reach/grip/percentile envelopes; design-language/brand consistency; sustainability/circularity in material choice | 5th–95th percentile reach; grip-diameter envelopes; clearance ≥ X mm | ISO 7250, SAE J833, DIN 33402 | "Will the 95th-percentile hand fit the grip with gloves AND clear the trigger guard?" — clearance is a *checkable assembly constraint*, not a sketch dim. |

### 1B. Generative Design Engineering — implicit/field-driven synthesis
*(grounds: `forge.implicit.*`, `forge.gen.explore`, convergent modeling — roadmap)*

| Level | Sub-topics & theory | Equations / criteria | Standards | Hard judgment |
|---|---|---|---|---|
| **BS** | Generative ≠ topology-opt (many Pareto candidates vs one solution); constraints+goals+manufacturing-method → candidate set | Pareto dominance; objective vector f(x) | — | A generative result is a *family*; selection is the engineering act. |
| **MS** | Implicit/SDF modeling (every body f(x,y,z)); FRep; R-functions (Rvachev) for exact booleans; smooth-min blends; field-driven per-point parameters | SDF booleans: ∪=min(f,g), ∩=max(f,g), ¬=−f; offset f±d; smooth-min `smin(a,b,k)=−k·log(e^{−a/k}+e^{−b/k})`; R-conjunction f₁∧f₂=f₁+f₂−√(f₁²+f₂²) | FRep/HyperFun, 3MF (+ beam-lattice ext) | When to use exact R-functions vs C∞ smooth-min (FEA-meshable vs C0 corner). |
| **PhD** | Multi-objective optimization (NSGA-II non-dominated sort + crowding distance, MOEA/D decomposition, SPEA2); surrogate-assisted (Kriging/GP-EI Bayesian, CMA-ES); convergent modeling (mesh↔B-Rep↔implicit in one model) | NSGA-II rank+crowd; EI(x)=(μ−f*)Φ(z)+σφ(z); marching cubes / dual contouring extraction | — | Surrogate trust region: when is the GP cheap-eval safe vs when must you spend a real kernel-FEA eval? |
| **Industry** | Manufacturing-aware synthesis per process (cast/machined/AM/sheet); graded/conformal lattices; heat-exchanger & conformal-cooling generative; convergent output to STEP/3MF | per-process DFM filter applied IN the loop, not after | nTop/Carbon DfAM guides, libfive/SDF refs | The Pareto-optimal candidate that *can't be cast* is not on the real frontier. Constraint-handling is the whole game. |

### 1C. Topology Optimization — density / level-set / evolutionary
*(grounds: `forge.topopt.{simp,levelset,beso}` over the validated in-house FEA — roadmap solver, mature FEA backbone)*

| Level | Sub-topics & theory | Equations / criteria | Standards / refs | Hard judgment |
|---|---|---|---|---|
| **BS** | Compliance minimization; volume-fraction constraint; the 99/88-line educational code structure | min compliance c=Uᵀ K U s.t. V(ρ)/V₀≤f, 0<ρ_min≤ρ≤1 | Sigmund 99/88-line, top99 | TO output is a *density field*, not a part — extraction is a separate, lossy step. |
| **MS** | **SIMP** (E(ρ)=E_min+ρ^p(E₀−E_min), penalty p≈3); RAMP; optimality-criteria (OC) update; density/sensitivity filtering for length-scale & mesh-independence | OC update with Lagrange λ for volume; filter radius r_min; checkerboard suppression | Bendsøe & Sigmund | Why p>1 (penalize grey) and why a filter is *mandatory* (mesh-dependence + checkerboarding without it). |
| **PhD** | **Adjoint sensitivity** (self-adjoint compliance ∂c/∂ρ_e = −p ρ_e^{p−1} u_eᵀ k₀ u_e); **MMA** (Svanberg moving asymptotes); **Heaviside projection** (β-continuation for crisp 0/1); robust formulation (eroded/intermediate/dilated); **level-set** (boundary = zero level-set of φ, Hamilton-Jacobi ∂φ/∂t+V|∇φ|=0, shape derivative); **BESO/ESO** | adjoint chain; MMA convex sub-problem; Heaviside H_β(ρ̃); HJ reinitialization; p-norm stress aggregation σ_PN=(Σσ_i^p)^{1/p} | Svanberg MMA, Wang/Allaire level-set | OC vs MMA selection (multi-constraint → MMA); when to add Heaviside (manufacturable boolean boundary) vs leave grey. |
| **Industry** | Manufacturing constraints baked in: **min member size** (`minMember(d)`), **AM overhang** (`constrainOverhang(45°)`), casting/extrusion mold-removal, symmetry; multi-load; stress-constrained; modal (eigenvalue); thermal/thermoelastic; buckling; then **re-fit to B-Rep** for downstream CAD/AM (marching cubes + Taubin smoothing) | overhang ≤45° self-support; min-member ≥ printer/tool resolution; eigenvalue/buckling derivatives | ISO/ASTM 52900 (for AM TO) | The min-member and overhang constraints are NOT post-filters — applied in the loop they change the optimum. A TO result that ignores them is academic, not buildable. |

### 1D. Industrial Automation & Robotics — kinematics, dynamics, motion, PLC, safety
*(grounds: `forge.robotics.*` atop the HHT-α multibody DAE — roadmap solver, mature multibody backbone)*

| Level | Sub-topics & theory | Equations / criteria | Standards | Hard judgment |
|---|---|---|---|---|
| **BS** | DH parameters; forward kinematics (homogeneous transforms); joint types (revolute/prismatic); workspace/reach/payload | FK: ⁰T_n=Π_i ⁱ⁻¹T_i(θ_i); DH transform from (a,α,d,θ) | IEC 61131-3 (LD/FBD/ST/IL/SFC) | The DH table IS the robot — sign/twist errors propagate silently to a wrong pose. |
| **MS** | Inverse kinematics (closed-form 6R w/ spherical wrist via **Pieper**; numerical **Jacobian/DLS** for redundant, all-solutions enumeration); differential kinematics & **Jacobian**; **singularities**; trajectory generation (joint-space cubic/quintic/trapezoidal/**S-curve** jerk-limited; Cartesian linear/circular with **SLERP** quaternion) | DLS: Δq=Jᵀ(JJᵀ+λ²I)⁻¹Δx; singularity det(J)→0; S-curve jerk-limited 7-segment; SLERP(q₀,q₁,t) | IEC 61499 (distributed FB), ISO 9283 (perf) | Near-singularity DLS damping λ trade (accuracy vs joint-velocity blow-up); choosing trapezoidal vs S-curve (jerk → cycle-time vs actuator/wear). |
| **PhD** | Recursive **Newton-Euler** inverse dynamics; Lagrangian; computed-torque control; motion planning (**RRT***, PRM, OMPL) with kernel-collision narrow-phase (**GJK/EPA**); continuous collision (CCD/swept-volume) | NE forward-backward recursion; τ=M(q)q̈+C(q,q̇)q̇+g(q); RRT* rewire; GJK support-mapping | — | RRT* is asymptotically optimal but discretized edge-checking misses thin obstacles — the known OMPL liability; kernel-exact CCD is the differentiator. |
| **Industry** | TCP/tool & payload calibration; cell layout with safety zones; **collaborative safety** (speed-and-separation, power-and-force limiting); offline programming; CAD→robot-description export (URDF/SDF) with kernel-computed inertia & separate collision mesh | force/power limits per body-region; safe-torque-off; SSM separation distance | **ISO 10218**, **ISO/TS 15066** (cobot), URDF/SDF | The SW2URDF pipeline is dead — kernel-accurate inertia tensor + COM + separate convex-decomposed collision geometry is the wedge; a wrong inertia tensor silently breaks the sim/twin. |

---

## 2. DATA SOURCES (premium / authoritative only)

> Streaming discipline applies to every downloadable artifact: **download → process → delete**, parquet `iter_batches`, accumulator-dedup. Standards text is *cited as answer-key reference*, never scraped wholesale (IP hygiene per Mecado).

### 2A. Textbooks (answer-key canon)
- **ID / surfacing:** *Curves and Surfaces for CAGD* (Farin); *The NURBS Book* (Piegl & Tiller); Henry Dreyfuss *The Measure of Man and Woman* (anthropometry); *Geometric Modeling* (Mortenson).
- **Generative / implicit:** Pasko/Adzhiev *Function Representation (FRep/HyperFun)*; Rvachev *R-functions*; Deb *Multi-Objective Optimization Using Evolutionary Algorithms* (NSGA-II canon); Rasmussen & Williams *Gaussian Processes for ML* (surrogate); libfive / *Inigo Quilez SDF* references.
- **Topology optimization:** **Bendsøe & Sigmund, *Topology Optimization: Theory, Methods, and Applications*** (the canon); Sigmund's *"A 99 line topology optimization code"* + *"Efficient topology optimization in MATLAB using 88 lines"*; Svanberg *MMA* papers; Allaire / Wang & Wang level-set TO papers; Bourdin density-filter; stress-constrained TO literature (Le, Norato, p-norm).
- **Robotics / automation:** **Craig, *Introduction to Robotics: Mechanics and Control***; **Spong, Hutchinson, Vidyasagar, *Robot Modeling and Control***; Lynch & Park *Modern Robotics*; Siciliano *Robotics: Modelling, Planning and Control*; LaValle *Planning Algorithms* (RRT*/PRM); Ogata / Franklin *control* texts (PID/state-space).

### 2B. Courses (MIT OCW + top-research)
- **MIT OCW 2.158J Computational Geometry**; **6.837 Computer Graphics** (SDF/marching cubes); **2.007 Design & Manufacturing**; **2.72/2.75 Precision Machine Design**.
- **MIT 6.832 / 6.881 Robotic Manipulation** (Tedrake — kinematics, planning, optimization-based control); **16.31 Feedback Control**.
- **Stanford CS223A Intro to Robotics** (Khatib); **CS237B**.
- **Caltech / Northwestern Modern Robotics MOOC** (Lynch & Park, with Coursera notebooks).
- **DTU 41525 / Sigmund's TopOpt group** open course materials + **TopOpt.dtu.dk** apps.

### 2C. Standards bodies (cite, don't scrape)
- **ISO 7250, ISO 9241, DIN 33402, SAE J833** (ID/ergonomics).
- **ISO/ASTM 52900 series** (AM/DfAM terminology for TO→AM).
- **ISO 10218-1/-2, ISO/TS 15066, ISO 9283** (robot safety/performance); **IEC 61131-3, IEC 61499** (PLC logic).
- **3MF Consortium spec** (+ beam-lattice & volumetric extensions), **STEP AP242** (PMI/convergent export).

### 2D. Papers / datasets
- **TO:** Bendsøe-Sigmund SIMP; Wang-Wang-Guo level-set; Svanberg MMA; Liu-Tovar 3D-88-line; AM-overhang TO (Langelaar self-support); the public 99/88-line codes themselves as *verifiable reference implementations* (re-implement, label outputs with the in-house FEA).
- **Generative:** NSGA-II (Deb 2002), MOEA/D (Zhang-Li 2007), SPEA2; nTop implicit-modeling blog series; Engineering-design Pareto benchmark functions (ZDT/DTLZ for optimizer correctness).
- **Robotics:** URDF model libraries (verify kinematic trees), OMPL/MoveIt docs, robot-kinematics datasets; **arXiv "Understanding URDF"** UX studies (failure taxonomy for the export corpus).
- **ID:** Poly Haven CC0 (CMF/render context only — already in fleet for photoreal).
- **CADGenBench public inputs** (`HuggingAI4Engineering/cadgenbench-data`, ODC-BY) — brackets/bosses/slots mirror the TO-extraction + interface part classes.

---

## 3. SYNTHETIC-DATA GENERATION PLAN

> bulk_synth-style programmatic generation (agents top out at 40–60 samples; generators emit 10⁵–10⁶). Every sample = JSONL `{messages:[system,user,assistant]}`, assistant ending in ≥1 `forge.<wb>.<op>(args)` call, carrying Archie's chat template. **Grounded = the kernel can replay the call and a scorer (ForgeCADScore / analytical gate) can grade it.** Modules slot into existing `bulk_synth_*` families: ID→`bulk_synth_geom.py`, generative+topopt→`bulk_synth_mfg.py`, robotics→`bulk_synth_mechatronics.py`, synthesis→`bulk_synth_eagi.py`.

### 3.1 Generator families (per field)

**ID / Class-A (`gen_classA`, `gen_anthro`)**
- **Q/A:** continuity-defect diagnosis — given a zebra/reflection-line description or rendered isophote image (VLM branch) → name the break (G0/G1/G2), the cause, the fix. Curvature-comb interpretation; surfacing-strategy choice (loft vs sweep vs boundary-network) for a given form.
- **Design→critique:** "this panel shows a G1 break at the A-pillar seam" → critique + corrective surfacing tool-call.
- **Tool-call targets:** `forge.surf.classA(...)`, `forge.surf.continuityCheck(faceA, faceB)`, `forge.id.anthropometry(percentile)` clearance against an assembly; grounded by `mesh::Curvature`.
- **Grounding:** kernel computes actual G-continuity / curvature at the shared edge → the "ideal answer" continuity verdict is kernel-checked, not asserted.

**Generative / implicit (`gen_implicit`, `gen_pareto`)**
- **Q/A:** SDF construction (write f(x,y,z) for a primitive/boolean/lattice); smooth-min vs R-function choice; field-driven grading.
- **Problem→solution:** "fill this domain with a gyroid graded by a stress field, 0.3→0.7 density" → implicit field + `forge.implicit.lattice(domain, gyroid, gradeField)` + `forge.implicit.toMesh(f, grid)`.
- **Design-space exploration:** spec brief → `forge.gen.explore(goals, constraints, NSGA-II)` → Pareto set; teach candidate-selection reasoning.
- **Grounding:** marching-cubes mesh must be **watertight + manifold** (BRepCheck/edge∈2 tris) — the validity gate; optimizer correctness pre-verified on ZDT/DTLZ analytical Pareto fronts before any kernel eval.

**Topology optimization (`gen_simp`, `gen_to_manufacture`)**
- **Derivation Q/A:** derive the SIMP adjoint sensitivity; explain filter necessity (mesh-independence + checkerboard); OC vs MMA; Heaviside β-continuation; level-set shape derivative.
- **Problem→solution:** "min compliance, volFrac 0.3, p=3, r_min=2 elements, with 45° overhang + 3 mm min member, load+BC given" → `forge.topopt.simp(domain, loads, BCs, 0.3, 3)` + `forge.topopt.constrainOverhang(45)` + `forge.topopt.minMember(3)` → then `forge.topopt.toBRep(...)` re-fit.
- **Design→critique:** a TO result with sub-resolution members → "these 0.4 mm struts won't print at 0.2 mm layer / 0.4 mm nozzle; re-run with minMember≥3·feature." **This is the manufacturability re-validation spine.**
- **Grounding:** compliance/volFrac labeled by the **validated in-house linear-static FEA** (0.33 % accuracy); the educational 99/88-line code is the cross-check oracle for the un-constrained case; honesty rule fires on stress-constrained p-norm (advisory).

**Robotics / automation (`gen_dh_fkik`, `gen_traj_plan`, `gen_cell_safety`)**
- **Q/A:** DH table → FK pose; Jacobian/singularity analysis; Newton-Euler torque; trajectory-profile selection (trapezoidal vs S-curve, jerk → cycle-time).
- **Problem→solution:** "6R with spherical wrist, DH given, reach pose T" → Pieper closed-form IK → all-solutions → `forge.robotics.ik(dh, pose)`; collision-free path → `forge.robotics.plan(start, goal, obstacles)`.
- **Design→critique:** cobot cell where a target pose is in a wrist singularity OR violates ISO/TS 15066 separation → flag + re-pose.
- **Tool-call targets:** `forge.robotics.{fk,ik,jacobian,traj,plan,dynamics}`; `forge.simulate.multibodyDynamics` for closed-loop/contact; URDF/SDF export with kernel inertia.
- **Grounding:** FK/IK round-trip checkable (FK(IK(pose))≈pose to tolerance); torque cross-checked vs `forge.simulate.multibodyDynamics` (HHT-α, 0.016 %); inertia tensor from `forge.*.massProps` (kernel-exact, not user-entered → fixes the dead-exporter bug).

### 3.2 The synthesis primitive (Pillar D tie-in) — what makes Archie *drive*, not chat
Each field also feeds **`gen_synth`** (requirements → parametric geometry) and **`gen_outcome`** (design-change → simulated outcome-delta, run through the owned kernel):
- TO: "tighten volFrac 0.3→0.2" → Δcompliance/Δmass labeled by kernel FEA.
- Generative: "lattice 0.3→0.5 density" → Δstiffness/Δmass.
- Robotics: "gear ratio 50→100" → Δreflected-inertia/Δtorque-RMS.
- ID: "G1→G2 at seam" → Δreflection-quality (kernel curvature metric).

These outcome pairs are the **AlphaGo-style** boundary-aware corpus (dense near known-good, sparse near failure) and the **DPO** source (ForgeCADScore-ranked: buildable optimum > un-buildable optimum).

### 3.3 Why this makes Archie better INSIDE Forge
Every generator terminates in a verb the **kernel replays** → the geometry-truth scorer grades validity/shape/interface/topology. A TO or generative answer that "reports a great compliance" but emits a non-manifold mesh **scores zero on the validity gate** — so the corpus is forced to teach buildable, replayable geometry. The cluster's contribution to the CADGenBench gate: **validity** (watertight lattice/TO extraction), **shape** (exact member/clearance dims), **interface** (anthropometric/cell-clearance + mounting bosses), **topology** (correct void/strut/disjoint-body counts). Robotics + ID + TO + generative are exactly where general models collapse (they chat about optimization; they can't emit a manifold, dimensioned, manufacturable part) — our differentiator.

### 3.4 Corpus budgets (per-run unique, bulk_synth scale)
| Module | Family | Target unique |
|---|---|---|
| `gen_classA` + `gen_anthro` | `bulk_synth_geom.py` | ~250 k |
| `gen_implicit` + `gen_pareto` | `bulk_synth_mfg.py` | ~350 k |
| `gen_simp` + `gen_to_manufacture` | `bulk_synth_mfg.py` | ~450 k |
| `gen_dh_fkik`+`gen_traj_plan`+`gen_cell_safety` | `bulk_synth_mechatronics.py` | ~500 k |
| `gen_synth` + `gen_outcome` (cluster slice) | `bulk_synth_eagi.py` | ~250 k |
| **Cluster total (per-run, pre-dedup)** | | **~1.8 M** |

---

## 4. EXAMPLE TRAINING SAMPLES (depth illustration)

> system prompt (abbrev.): *"You are Archie, a senior design-optimization engineer driving Forge. Reason with governing equations, SI units, and named standards; hold the manufacturing/physics envelope fixed while optimizing; terminate in replayable forge.<wb>.<op>(args) the kernel can verify. Surface real limits — never fabricate a converged result the kernel can't reproduce."*

### Sample 1 — Topology optimization with manufacturability re-validation (PhD/industry depth)
**User:** "Minimize the compliance of a steel motor-mount bracket in a 120×80×40 mm design domain. Fixed bolt face on the −X wall; 1.8 kN downward load on a 20 mm boss at +X. Volume fraction 0.30. It will be printed LPBF (0.4 mm nozzle equivalent, 0.03 mm layer, 45° self-support). Give me a buildable result."

**Ideal answer:**
Set up SIMP: modified density law E(ρ)=E_min+ρ³(E₀−E_min), penalty p=3 (penalizes intermediate density toward 0/1). Objective min c=UᵀK(ρ)U s.t. V(ρ)/V₀≤0.30. Sensitivities by the self-adjoint adjoint: ∂c/∂ρ_e=−p·ρ_e^{p−1}·u_eᵀk₀u_e (negative → adding material always reduces compliance, so the volume constraint is active). I'll use a density filter, r_min=2 elements, to guarantee mesh-independence and kill checkerboarding, and Heaviside projection with β-continuation (β:1→16) to drive a crisp 0/1 boundary that's manufacturable.

Manufacturing constraints go **in the loop, not after**: (a) **min member ≥ 3·process-resolution ≈ 1.2 mm** so struts survive LPBF + post-processing — but I'll set 3 mm for handling margin; (b) **overhang ≤45°** self-support along build-Z so I avoid support inside the lattice-like web. These change the optimum — an unconstrained SIMP run would give ~0.6 mm struts that don't build.

Solver = the validated in-house linear-static stiffness solve (0.33 % vs analytic), OC update for this single volume constraint (MMA if I add the stress constraint later).

Honesty: I'll report **compliance and volume fraction** (kernel-verified). Stress-constrained p-norm aggregation is not yet A/B-proven in the kernel, so I treat peak von-Mises from the final design as **advisory** and recommend a confirmatory `forge.fea.analyseStatic` on the re-fit B-Rep.

```
forge.topopt.simp(
  domain={box:[120,80,40], mesh:"hex", elemSize:1.0},
  loads=[{type:"force", face:"bossPlusX", vec:[0,0,-1800], unit:"N"}],
  BCs=[{type:"fixed", face:"wallMinusX"}],
  volFrac=0.30, penal=3.0, filter:{type:"density", rMin:2.0},
  projection:{type:"heaviside", betaSchedule:[1,2,4,8,16]},
  update:"OC", maxIter:120, material:{name:"steel", E:210e9, nu:0.30}
)
forge.topopt.constrainOverhang(angle=45, buildDir=[0,0,1])
forge.topopt.minMember(d=3.0)
forge.topopt.toBRep(method:"marchingCubes", smooth:"taubin", refit:true)
forge.fea.analyseStatic(body="$lastRefit", loads="$loads", BCs="$BCs")  // confirm peak stress on the real B-Rep
```
*(Grounding: compliance/volFrac labeled by the validated FEA; constraints replayable; the un-constrained case cross-checks against the public 88-line code; stress flagged advisory per the honesty rule.)*

### Sample 2 — Class-A surface continuity diagnosis (ID, MS depth)
**User:** "Zebra analysis on my speaker-grille bezel shows the stripes kink — they stay connected but bend sharply — where the top sweep meets the side loft. What's wrong and how do I fix it for a Class-A finish?"

**Ideal answer:**
Connected-but-kinked zebra stripes = **G1 (tangent) continuity but a G2 (curvature) break**. Stripes that *split/step* would be G0; stripes that flow but with a visible bend are tangent-continuous yet have a curvature discontinuity — the surface normal is continuous, but κ jumps across the seam. The eye reads a curvature break as a faint highlight crease, which fails Class-A (highlight-critical exterior wants G2, ideally G3 on signature surfaces).

Cause: a `sweep` and a `loft` meeting with matched tangents but unmatched curvature combs. Fix: rebuild the seam edges so the boundary curves share **curvature** (G2) — either rebuild the side as a curvature-continuous boundary surface against the sweep's rail, or insert a small G2 transition/blend. Verify with the curvature comb (κ=1/R) across the seam and re-run zebra; for a signature edge, push to G3 (curvature-rate match).

```
forge.surf.continuityCheck(faceA="sweepTop", faceB="loftSide", report:["G0","G1","G2"])
// kernel returns: G0=true, G1=true, G2=false (kappa jump 0.018 -> 0.061 1/mm)
forge.surf.classA(
  operation:"rebuildBoundary", edge:"seamTopSide",
  target:"G2", railA:"sweepTop", railB:"loftSide",
  curvatureMatch:true
)
forge.surf.continuityCheck(faceA="sweepTop", faceB="loftSide", report:["G2","G3"])  // confirm G2 achieved
```
*(Grounding: the G0/G1/G2 verdict and the κ values come from `mesh::Curvature` / `forge.surf.continuityCheck`, kernel-computed — the diagnosis is verified, not asserted.)*

### Sample 3 — Robot IK + singularity + cobot safety (robotics, MS/industry depth)
**User:** "6R arm, spherical wrist, DH table attached. I need the TCP at position (650, 0, 420) mm, tool pointing −Z. It's a collaborative cell next to an operator. Give me joint angles and flag any problem."

**Ideal answer:**
Spherical wrist (last 3 axes intersect) → **Pieper's method** gives a closed-form IK: decouple position (first 3 joints solve the wrist-center from the target minus tool-length·ẑ) from orientation (last 3 solve the wrist Euler set). This yields up to **8 solutions** (shoulder left/right × elbow up/down × wrist flip). I'll enumerate all 8 and pick the one minimizing joint travel from the current pose while respecting limits.

**Singularity check:** with the tool pointing straight −Z and the wrist near full extension, watch for the **wrist singularity** (axes 4 and 6 collinear, det(J)→0). If the chosen solution sits within ~5° of it, the Jacobian is ill-conditioned — small Cartesian moves demand huge joint velocities. If so, I re-pose via an alternate IK branch or add a redundancy/elbow offset; if forced through, I'd switch to damped-least-squares (Δq=Jᵀ(JJᵀ+λ²I)⁻¹Δx) with λ scheduled by the smallest singular value.

**Safety (ISO 10218 / ISO/TS 15066):** collaborative operation needs speed-and-separation monitoring or power-and-force limiting. I verify the planned pose and approach keep the TCP and links outside the operator separation zone, and cap commanded speed so contact force stays within the body-region limits.

```
forge.robotics.ik(dh="$dhTable", pose={pos:[650,0,420], approach:[0,0,-1]}, method:"pieper", allSolutions:true)
forge.robotics.jacobian(q="$selectedSolution")          // -> sigma_min, det(J) for singularity margin
forge.robotics.plan(start="$current", goal="$selectedSolution",
                    obstacles=["operatorZone","fixture"], planner:"RRT*", ccd:true)
forge.simulate.multibodyDynamics(cfg={chain:"$arm", q:"$traj", contact:true})  // verify torques + contact forces vs ISO/TS 15066 limits
```
*(Grounding: FK(IK(pose))≈pose round-trip is kernel-checkable; the singularity margin comes from the real Jacobian SVD; torque/contact from the validated HHT-α multibody DAE; planner uses kernel-exact CCD — fixing the discretized-OMPL thin-obstacle miss.)*

---

## 5. CURRICULUM PLACEMENT & ACCEPTANCE GATES

| Stage (from corpus program) | This cluster's contribution | Acceptance gate |
|---|---|---|
| **S1 Geometry** (`arch14b-geom`) | `gen_classA` + `gen_anthro` | Class-A continuity verdicts match kernel `continuityCheck`; anthropometric clearance replayable; validity ≥0.95 on extracted surfaces |
| **S3 Manufacturing** (`arch14b-mfg`) | `gen_simp`, `gen_to_manufacture`, `gen_implicit`, `gen_pareto` | TO/lattice extraction watertight+manifold; min-member/overhang constraints respected; un-constrained SIMP cross-checks the 88-line oracle; honesty held on stress p-norm |
| **S4 Mechatronics** (`arch14b-mech`) | `gen_dh_fkik`, `gen_traj_plan`, `gen_cell_safety` | FK/IK round-trip within tol; torque vs HHT-α; ISO/TS 15066 separation flagged; URDF inertia = kernel mass-props |
| **S6 eAGI Capstone** (`arch14b-eagi`) | `gen_synth` + `gen_outcome` cluster slices | L4–L5 sim-augmented score ≥0.80; outcome-deltas reproduce under kernel replay; DPO prefers buildable optimum |

**Per-stage discipline (memory rules):** bulk_synth programmatically (never hand-author) → `corpus_factory` dedup/mix + `merge_accumulator` → coherence/critic gate → train 4-bit qLoRA (**drop `--mask-prompt` on long TO/derivation samples — NaN risk**; NaN-guard loss) → restart serve fresh → gauntlet → promote-or-rollback. **Process→train→delete; never co-host train + serve + Electron + Vite.** Every numeric answer carries SI units; dynamic-first (motion/transient over static snapshot) where the field allows; honesty injected on every roadmap-solver verb.

---

## 6. SUCCESS CRITERIA (cluster-local DoD)
1. Archie emits **manufacturable** geometry: TO/lattice results pass the validity gate (watertight+manifold) AND the in-loop min-member/overhang constraints — no sub-resolution struts, no un-buildable optima.
2. ID continuity diagnoses match kernel-computed G-continuity; anthropometric/cell clearances are checkable assembly constraints, not asserted numbers.
3. Robotics FK/IK round-trips, torques cross-check the validated HHT-α solver, inertia comes from kernel mass-props, and ISO/TS 15066 safety is flagged — not chatted.
4. Every sample replayable by the kernel and gradable by ForgeCADScore; honesty rule held on every roadmap-solver verb (no fabricated converged optima).
5. Contributes to CADGenBench ≥0.85 on validity/shape/interface/topology for the bracket/lattice/boss part classes where general models collapse.
