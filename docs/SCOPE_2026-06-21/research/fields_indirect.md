# Indirect Fields Taxonomy — Capability + Corpus per Field

**Scope:** SCOPE_2026-06-21 deep-dive. Fifteen *indirect* engineering disciplines that surround MCAD/CAM/CAE. For each: (a) **core knowledge**, (b) **concrete Forge capability** (named modules, ops, data structures, function names, governing equations), (c) **standards/methods**, (d) **Archie training-data topics**.

**Governing constraints:** Forge kernel is pure-C++20 (re-implements OCCT + CGAL + libfive + PicoGK + Manifold; NO external CAD deps, NO WASM). Archie is a local 14B MLX model driving Forge purely via CUA. North-star: Archie→Forge ≥ 0.85 on CADGenBench across **every** dimension. No lite versions; industrial-grade only; dynamic (not static) features. All capabilities below assume real solvers, real algorithms, verified for real engineers.

**Naming conventions used below:** kernel ops are `forge::<domain>::<Verb>`; Archie tool-calls are `forge.<domain>.<verb>`; UI surfaces are `<Domain>Workbench`. These extend the existing 70+ native modules / FEA-CFD-MBD solvers / GD&T / PMI suite.

---

## 1. Systems Engineering

**(a) Core knowledge.** Lifecycle process model (concept → development → production → utilization → support → retirement); the V-model (left leg = decomposition/definition: stakeholder needs → system requirements → architecture → design; right leg = integration/verification: unit → integration → system → acceptance); functional / logical / physical architecture layering; requirement allocation and budgeting (mass, power, thermal, cost, latency, reliability); interface management (ICDs, N²/DSM matrices); MBSE — a single authoritative model with diagram/document *views*; trade studies (weighted-objective, Pugh, AHP, utility theory); technical performance measures (TPMs) and margins; configuration management and baselines; technical risk management; SoS (system-of-systems) integration. Four MBSE pillars: central modeling, requirements traceability, V&V, standards-based frameworks.

**(b) Concrete Forge capability.**
- **`SystemsWorkbench`** hosting a live **MBSE model graph** (`forge::sysml::ModelGraph`) backed by a typed property graph: nodes = Blocks / Requirements / Activities / Constraints / Parameters; edges = `satisfy`, `derive`, `refine`, `allocate`, `trace`, `verify`. Round-trips to **SysML v2 textual notation** and **ReqIF** via inline ASCII writers (no external libs).
- **Architecture↔geometry binding:** each SysML `Block` (`forge::sysml::Block`) can bind to a Forge `Body`/assembly node, so a logical decomposition drives an actual BRep assembly tree. Function `forge::sysml::allocateBlockToBody(blockId, bodyHandle)` — keeps the digital-thread link live during edits.
- **Budget roll-up engine** (`forge::sysml::BudgetSolver`): mass/power/cost/CG budgets computed by walking the assembly DAG, each leaf pulling true values from kernel mass-properties (`forge::massprops::compute`) — closes the loop between systems model and real geometry, with margin = (allocated − rolled-up)/allocated flagged red when negative.
- **DSM / N² interface matrix** view (`forge::sysml::DSMMatrix`) with partitioning (clustering) and tearing algorithms to expose feedback loops.
- **Trade-study solver** (`forge::sysml::TradeStudy`): weighted-sum, Pugh, AHP eigenvector weights, and Pareto-front extraction over design alternatives (each alternative a parametric Forge config), driving the existing SIMP/topology + parametric sweep engines.
- **`verb: forge.sysml.linkRequirementToFeature`** ties a Y14.5 PMI feature-control-frame to a requirement for end-to-end traceability into the existing GD&T suite.

**(c) Standards/methods.** ISO/IEC/IEEE 15288:2023 (lifecycle processes); INCOSE SE Handbook (5th ed.); OMG SysML v1.6 / **SysML v2** (KerML); ISO/IEC/IEEE 29148 (requirements); ReqIF (OMG); NASA SE Handbook SP-2016-6105; NASA-HDBK-1009 (modeling); OOSEM; AP233 (STEP systems-engineering). Methods: functional flow block diagrams (FFBD), DSM/N², QFD house-of-quality cascade, FMECA hooks.

**(d) Training-data topics.** Decomposing a stakeholder need into system→subsystem→component requirements with allocation; building a SysML block-definition + internal-block diagram from a prose spec; emitting `forge.sysml.*` tool-calls to create blocks, ports, and `satisfy` links; running mass/power budget roll-ups and reporting margins; constructing an N² matrix and identifying feedback loops; performing a weighted trade study over 3–5 Forge parametric variants; tracing a requirement to a geometric feature and its verification.

---

## 2. Requirements Engineering

**(a) Core knowledge.** Requirement types (stakeholder/business, system, functional, non-functional/quality, constraint, interface, derived); elicitation techniques (interviews, use cases, scenarios, prototyping); the "good requirement" rule set — unambiguous, complete, consistent, verifiable, traceable, atomic, feasible, necessary, bounded, implementation-free; requirement statement *patterns* (ISO 29148 / EARS: ubiquitous, event-driven, state-driven, unwanted-behavior, optional, complex); requirement quality attributes and ambiguity/weak-word detection; bidirectional traceability (upward to need, downward to design/test); requirement baselining, versioning, and change impact; verification methods matrix (Inspection / Analysis / Demonstration / Test — I/A/D/T); acceptance criteria; volatility metrics.

**(b) Concrete Forge capability.**
- **`RequirementsWorkbench`** with a **requirements database** (`forge::reqs::ReqStore`) — each requirement an object with id, text, rationale, type, priority (MoSCoW), V-method (I/A/D/T), status, owner, parent/child links, verification evidence handle.
- **EARS / ISO-29148 pattern linter** (`forge::reqs::QualityLinter`): scores each requirement for ambiguity (weak words "fast", "user-friendly"), passive voice, missing verifiability, compound statements; suggests an EARS rewrite. Returns a quality vector, not a binary pass.
- **Traceability matrix** (`forge::reqs::TraceMatrix`) cross-linking requirement ↔ SysML block ↔ Forge geometry/PMI ↔ simulation case ↔ test result; **orphan/coverage report** highlights un-traced requirements and un-justified design features.
- **Change-impact analysis** (`forge::reqs::impactSet(reqId)`): BFS over the trace graph to enumerate all affected blocks, bodies, sim cases, and tests when a requirement changes — closing the digital thread to the kernel.
- **Verification-evidence binding:** `forge.reqs.attachEvidence(reqId, simResultHandle | inspectionReportHandle)` pulls real FEA/CFD margins or CMM inspection outputs as objective verification.
- **ReqIF import/export** via inline writer; round-trips with the Systems workbench model graph.

**(c) Standards/methods.** ISO/IEC/IEEE 29148:2018 (requirements engineering); INCOSE Guide to Writing Requirements (rules + patterns); EARS (Easy Approach to Requirements Syntax); ReqIF (OMG); IEEE 830 (legacy SRS); DO-178C/DO-254 traceability discipline (where safety-relevant). Methods: QFD, use-case modeling, MoSCoW prioritization, Kano analysis, requirement reviews/inspections (Fagan).

**(d) Training-data topics.** Rewriting a vague prose requirement into an EARS-pattern, verifiable statement; classifying requirement type and assigning a V-method; running the quality linter and explaining each flagged defect; building a traceability matrix and finding orphans; performing change-impact analysis given a modified requirement; attaching an FEA factor-of-safety as verification evidence; emitting `forge.reqs.*` tool-calls end-to-end.

---

## 3. QA & Total Quality Management (TQM)

**(a) Core knowledge.** Quality management principles (customer focus, leadership, engagement, process approach, improvement, evidence-based decisions, relationship management); PDCA / PDSA cycle; cost of quality (prevention, appraisal, internal failure, external failure — PAF model); the 7 basic QC tools (Pareto, Ishikawa/fishbone, histogram, check sheet, control chart, scatter, stratification) and the 7 management tools (affinity, interrelationship, tree, matrix, prioritization, PDPC, arrow); **SPC** — variables vs attributes charts (X̄-R, X̄-s, I-MR, p, np, c, u), control limits = μ ± 3σ̂, Western Electric / Nelson run rules, common vs special cause; **process capability** Cp = (USL−LSL)/6σ, Cpk = min[(USL−μ),(μ−LSL)]/3σ, Pp/Ppk (long-term), Cpm (Taguchi, penalizes off-target); **MSA / Gage R&R** (%GRR, ndc, %P/T); APQP, PPAP, control plans; **Six Sigma DMAIC** (Define-Measure-Analyze-Improve-Control) and DMADV; corrective/preventive action (CAPA), 8D, 5-Why, RCA; sampling plans (ANSI/ASQ Z1.4 AQL).

**(b) Concrete Forge capability.**
- **`QualityWorkbench`** with an **SPC engine** (`forge::spc::ControlChart`): all variable + attribute chart families; computes control limits, applies all 8 Nelson rules + Western Electric zones; live charts fed by inspection/inline data streams. Stable algorithm with σ̂ from R̄/d2 or s̄/c4.
- **Process-capability calculator** (`forge::spc::capability`): Cp, Cpk, Pp, Ppk, Cpm, sigma level, expected DPMO, %out-of-spec — normality test (Anderson-Darling) gate first; non-normal path uses Box-Cox or percentile (0.135/99.865) method.
- **Gage R&R / MSA** (`forge::msa::gageRR`): ANOVA method (parts × operators × interaction), %study-variation, %tolerance, ndc = 1.41·(PV/GRR); crossed and nested designs.
- **Inspection-plan generation from PMI:** a part's Y14.5 feature-control-frames auto-generate a **control plan + characteristic accountability matrix (CAM/balloon report)**, function `forge::quality::ballooningFromPMI(bodyHandle)` — every dimension/FCF balloon-numbered with tolerance, method, sample size, Cpk target. Feeds CMM (field 6).
- **CoPQ dashboard** (`forge::quality::costOfQuality`) and **CAPA/8D tracker** linked to FMEA (field 9) and reliability (field 8).
- **DOE module** (`forge::doe`): full/fractional factorial, Plackett-Burman, central-composite/Box-Behnken RSM, Taguchi orthogonal arrays + S/N ratios — runs designed sweeps over Forge parametric models and the FEA/CFD solvers, then fits a response surface.

**(c) Standards/methods.** ISO 9001:2015 (QMS), ISO 9000 (vocabulary), IATF 16949 (automotive), AS9100 (aerospace), ISO 13485 (medical), ISO/TS 16949 legacy; AIAG core tools (APQP, PPAP, MSA-4, SPC-2, FMEA); ANSI/ASQ Z1.4 / Z1.9 (sampling); ISO 3534 (statistics vocab); Six Sigma (ASQ Body of Knowledge). Methods: DMAIC/DMADV, QFD, 8D, 5-Why, Ishikawa, Pareto 80/20.

**(d) Training-data topics.** Selecting the correct control chart for a data type and computing limits; flagging Nelson-rule violations and explaining common vs special cause; computing Cp/Cpk/Ppk and interpreting against a 1.33/1.67 target; running a Gage R&R and judging gauge acceptability via %GRR and ndc; ballooning a drawing from PMI into a control plan; designing and analyzing a fractional factorial DOE over a Forge model; walking a DMAIC project; building an 8D/CAPA. Emitting `forge.spc.*`, `forge.msa.*`, `forge.doe.*` tool-calls.

---

## 4. Lean Manufacturing

**(a) Core knowledge.** The 8 wastes (TIMWOODS: Transport, Inventory, Motion, Waiting, Overproduction, Overprocessing, Defects, Skills/underutilized talent); 5 lean principles (value, value stream, flow, pull, perfection); **Value Stream Mapping** (current/future state; process boxes, data boxes with C/T, C/O, uptime, FPY; information & material flows; timeline of value-added vs lead time); **takt time** = available time / customer demand; cycle time, lead time, WIP, Little's Law (WIP = throughput × lead time); **one-piece flow** and cellular layout; **kanban** pull (number of cards = (D·L·(1+SS))/container size); **heijunka** (production leveling, EPEI — every-part-every-interval); **SMED** (internal vs external setup conversion, sub-10-minute changeover); **standard work** (takt, sequence, SWIP); **5S** + visual management; **kaizen** / kaizen events; **jidoka** (autonomation, andon, poka-yoke); **OEE** = Availability × Performance × Quality; **TPM** (8 pillars, autonomous + planned maintenance); **Theory of Constraints** (identify–exploit–subordinate–elevate–repeat the constraint, drum-buffer-rope).

**(b) Concrete Forge capability.**
- **`LeanWorkbench`** with a **Value-Stream Map editor** (`forge::lean::VSM`): drag process/inventory/transport/kanban icons; auto-computes total lead time, value-added time, process-cycle-efficiency (VAT/LT), and a **future-state takt line**; data boxes carry C/T, C/O, uptime, FPY.
- **Takt / line-balance solver** (`forge::lean::lineBalance`): given task times + takt, assigns tasks to stations minimizing station count (a bin-packing/ranked-positional-weight heuristic — ties to OR, field 5), draws a **yamazumi (work-content) chart**, flags over-takt stations.
- **OEE calculator** (`forge::lean::oee`) = A×P×Q with six-big-losses breakdown; feeds the TPM dashboard. MTBF/MTTR cross-linked to reliability (field 8).
- **Kanban sizer** (`forge::lean::kanbanCards`) and **heijunka/EPEI box** (`forge::lean::heijunka`) for level-loading a mixed-model schedule.
- **SMED analyzer** (`forge::lean::smed`): classifies setup steps internal/external, models conversion + parallelization to a target changeover time.
- **Spaghetti / motion diagram** overlaid on the **plant layout** (ties to field 15) computing operator travel distance — drives motion-waste reduction.
- **Discrete-event simulation backbone** (`forge::sim::DESEngine`, shared with OR field 5) validates a future-state VSM by simulating flow, WIP, and throughput before committing the layout change.

**(c) Standards/methods.** Toyota Production System; Lean Enterprise Institute (Learning to See VSM conventions, Rother & Shook); SMED (Shingo); TPM (JIPM, Nakajima); SAE J4000 (lean implementation); ISO 22400 (manufacturing KPIs incl. OEE); Theory of Constraints (Goldratt). Methods: VSM, A3 problem-solving, kaizen events, 5S audits, standard-work combination sheets.

**(d) Training-data topics.** Building a current-state VSM from process data and computing lead time / PCE; balancing a line to takt and producing a yamazumi; computing OEE and decomposing the six losses; sizing kanban; designing a heijunka box for mixed-model demand; running a SMED conversion to hit a changeover target; reducing operator travel via spaghetti analysis on a Forge plant layout; validating a future state in DES. Emitting `forge.lean.*` tool-calls.

---

## 5. Operations Research

**(a) Core knowledge.** **Linear programming** (standard form, simplex method, duality, sensitivity/shadow prices, interior-point/Karmarkar); **mixed-integer programming** (branch-and-bound, branch-and-cut, cutting planes, big-M and indicator constraints, modeling logic with binaries); **network optimization** (shortest path Dijkstra/Bellman-Ford, max-flow/min-cut, min-cost-flow, assignment/Hungarian, transportation); **scheduling** (job-shop/flow-shop, NP-hard, disjunctive constraints, Johnson's rule, dispatching rules SPT/EDD, makespan/tardiness objectives); **routing** (TSP, VRP — NP-hard, MTZ/DFJ formulations, Christofides, savings, 2-opt/LK, ACO); **packing/cutting** (bin-packing, knapsack DP, cutting-stock, nesting); **queueing theory** (M/M/1, M/M/c, M/G/1, Little's Law, Erlang-C/B, Jackson networks); **inventory** (EOQ, (Q,r) and (s,S) policies, newsvendor, safety stock z·σ·√LT); **discrete-event simulation** (event calendar, random-variate generation, output analysis, variance reduction); **metaheuristics** (GA, simulated annealing, tabu, PSO); **dynamic & stochastic programming**, Markov decision processes.

**(b) Concrete Forge capability.**
- **`OptimizationWorkbench`** exposing a native **LP/MIP solver** (`forge::or::MILP`): revised-simplex + branch-and-cut with Gomory/MIR cuts, presolve, and warm-start — implemented in-house (no external solver dependency). Models authored via a fluent builder (`addVar`, `addConstraint`, `setObjective`, `solve`).
- **Scheduler** (`forge::or::JobShop`): disjunctive-graph job/flow-shop with makespan/total-tardiness objectives, shifting-bottleneck + tabu; outputs a Gantt — drives CAM operation sequencing and shop scheduling.
- **Routing/TSP-VRP** (`forge::or::Routing`): for CNC tool-path ordering (minimize rapid travel between features), nesting torch/laser cut order, and inspection-point ordering on a CMM (field 6); LK + OR-opt local search.
- **Nesting/cutting-stock** (`forge::or::Nest`): true 2D irregular nesting (no-fit-polygon + bottom-left-fill + GA) for sheet-metal/laser stock utilization — uses kernel polygon-offset/boolean ops directly.
- **Queueing + EOQ/inventory calculators** (`forge::or::queue`, `forge::or::inventory`).
- **`forge::sim::DESEngine`** (shared with Lean): full discrete-event sim with statistically-valid output analysis (batch-means CI, warm-up via Welch) to evaluate line/layout/policy designs.
- **Topology/parametric optimization bridge:** ties OR solvers to the existing SIMP topology optimizer and parametric sweep for design-space exploration with manufacturing constraints.

**(c) Standards/methods.** Simplex/revised-simplex (Dantzig), branch-and-bound (Land-Doig), MTZ/DFJ TSP formulations, Hungarian algorithm, Erlang-C, Little's Law, Wagner-Whitin lot-sizing. References: Hillier & Lieberman; Winston; Nemhauser-Wolsey (integer); Law (simulation modeling & analysis). Modeling standards: MPS/LP file formats (inline writer); DES validation via I/O analysis.

**(d) Training-data topics.** Formulating a production-planning/blending problem as an LP and reading shadow prices; modeling on/off logic with binaries in a MIP; setting up and solving a job-shop schedule and reading the Gantt; ordering CNC features as a TSP to cut rapid time; nesting parts on stock and reporting utilization; sizing an M/M/c service desk via Erlang-C; computing EOQ and safety stock; building and analyzing a DES model. Emitting `forge.or.*` and `forge.sim.*` tool-calls.

---

## 6. Metrology & CMM Inspection

**(a) Core knowledge.** Dimensional metrology fundamentals (traceability to SI metre, calibration chain, environmental control at 20 °C ± 2 °C, Abbe principle, cosine error); CMM types (bridge, gantry, cantilever, horizontal-arm, portable arm, laser tracker, optical/vision, structured-light/CT); probing (touch-trigger, scanning/analog, optical), probe qualification, stylus error mapping; **substitute-geometry fitting** — Gaussian **least-squares** (L2) for size, **minimum-zone / Chebyshev** (L∞) for form, maximum-inscribed / minimum-circumscribed (L1-ish) for MMC/LMC features; **form errors** flatness, straightness, roundness/circularity, cylindricity, sphericity computed as min-zone separations; **datum establishment** (3-2-1, candidate-datum / constrained L1, mobile datums); **size** (two-point, LSQ, circumscribed/inscribed per Y14.5 size definitions); **measurement uncertainty** per GUM (Type A/B, combined uc, expanded U = k·uc, budget, k=2 for ~95 %); MSA/Gage R&R, ISO 10360 acceptance/MPE; sampling-density and filtering (Gaussian, spline, robust ISO 16610 filters); reverse engineering point-cloud → surface.

**(b) Concrete Forge capability.**
- **`MetrologyWorkbench`** with a **virtual CMM / DMIS path planner** (`forge::cmm::PathPlanner`): from a part's PMI feature-control-frames, auto-generates probe points (collision-free, accessibility-checked against the BRep), measurement sequence (TSP-ordered, field 5), and a **DMIS** program (inline ASCII writer).
- **Fitting engines** (`forge::cmm::fit`): Gaussian LSQ (Gauss-Newton/normal equations), **minimum-zone Chebyshev** (via convex-hull/exchange or LP, ties to OR), max-inscribed/min-circumscribed — for plane, line, circle, sphere, cylinder, cone, torus. Reports residuals + form error to nanometre precision.
- **GD&T verifier** (`forge::cmm::evaluateFCF`): evaluates every Y14.5 feature-control-frame against a measured/simulated point set — position (true-position diameter, **bonus tolerance** at MMC, datum-shift), flatness, perpendicularity, profile (unilateral/bilateral, composite), runout/total-runout — producing pass/fail with actual deviation. This is the missing **geometric FCF evaluator** the kernel needs.
- **Datum-reference-frame solver** (`forge::cmm::buildDRF`): constructs the primary→secondary→tertiary DRF from imperfect datum features per Y14.5-2018 stabilized solution (constrained L1 / candidate-datum-set).
- **GUM uncertainty calculator** (`forge::cmm::uncertaintyGUM`): builds the budget, combines uc, expands U=k·uc, supports Monte-Carlo (GUM Supplement 1) propagation.
- **Point-cloud reverse engineering** (`forge::cmm::pcReconstruct`): registration (ICP), region growing, NURBS/BRep surface fitting back into the kernel — reuses native surface modelling.
- Outputs an **AS9102 / balloon inspection report** linked to the Quality workbench (field 3).

**(c) Standards/methods.** ASME Y14.5-2018 + Y14.5.1 (math definition of GD&T); ISO GPS suite — ISO 1101 (geometrical tolerancing), ISO 5459 (datums), ISO 14405 (dimensional/size), ISO 12180/12181 (cylindricity), ISO 12780/12781 (straightness/flatness), ISO 16610 (filtration); ISO 10360 (CMM acceptance/MPE); ISO 17025 (lab competence); **GUM** (JCGM 100) + GUM-S1 (JCGM 101) Monte-Carlo; DMIS (ANSI/ISO 22093); QIF (Quality Information Framework, ANSI/DMSC); I++ DME interface; AIAG MSA-4. Algorithms: least-squares (Gauss), minimum-zone (Chebyshev), ICP registration.

**(d) Training-data topics.** Generating a collision-free CMM probing plan from a part's PMI; choosing LSQ vs minimum-zone for size vs form and explaining why; evaluating a position FCF with bonus tolerance and datum shift at MMC; building a DRF from imperfect datum features; computing flatness/cylindricity as a min-zone separation; assembling a GUM uncertainty budget and expanding U; reverse-engineering a point cloud to a NURBS surface; writing a DMIS program. Emitting `forge.cmm.*` tool-calls.

---

## 7. Non-Destructive Testing (NDT)

**(a) Core knowledge.** Six primary methods: **VT** (visual), **PT** (liquid penetrant — capillary action, dwell, developer), **MT** (magnetic particle — flux leakage, longitudinal/circular magnetization, continuous method), **UT** (ultrasonic — pulse-echo, A/B/C-scan, normal & angle beam, near/far field N=D²/4λ, attenuation, DAC/DGS/TCG, AVG), **RT** (radiographic — X/γ, film + digital DR/CR, IQI sensitivity, geometric unsharpness Ug=F·t/d), **ET** (eddy current — impedance plane, lift-off, skin depth δ=1/√(πfμσ)); advanced methods: **PAUT** (phased-array — electronic beam steering/focusing via element time delays, sectorial/linear scans, S-scan, FMC/TFM total-focusing), **TOFD** (time-of-flight diffraction — lateral wave + back-wall + diffracted tip signals, accurate through-wall sizing), digital/computed radiography & CT, guided-wave, acoustic emission, thermography, leak testing; flaw characterization (sizing, location, type — porosity, slag, lack-of-fusion, cracks, laminations); probability of detection (POD), a90/95.

**(b) Concrete Forge capability.**
- **`NDTWorkbench`** for **inspectability / DfNDT analysis**: given a weld or casting in the assembly, checks access, scan-surface coverage, and beam reachability; flags blind zones a PAUT/TOFD setup cannot resolve.
- **UT/PAUT coverage simulator** (`forge::ndt::beamCoverage`): ray-traced (and optionally physics-based) sound-field over the BRep cross-section; computes near-field length, beam spread, S-scan angular coverage, and weld-volume coverage %; **PAUT focal-law calculator** (`forge::ndt::focalLaws`) emits element delays for sectorial/linear scans on a defined wedge.
- **RT technique/exposure planner** (`forge::ndt::rtPlan`): source-to-film distance, geometric unsharpness Ug, IQI selection, exposure (using material μ), and shot layout for full coverage of a weld map.
- **Weld-map manager** (`forge::ndt::weldMap`): every weld joint in the assembly carries inspection method, acceptance code, and result; auto-generated from the BRep weld features (ties to welding/casting workbenches already in the kernel).
- **Flaw library & acceptance evaluator** (`forge::ndt::evaluate`): given an indication (size, depth, type), evaluates against the chosen acceptance code (ASME BPVC Sec VIII/IX, AWS D1.1, API 1104) → accept/reject + rationale.
- **CT/point-cloud porosity analysis** ties to the reverse-engineering path (field 6) for as-built defect quantification feeding reliability/FMEA.

**(c) Standards/methods.** ASME BPVC **Section V** (NDE methods; Art. 4 UT, Art. 2 RT, Art. 7 MT, Art. 6 PT, Art. 8 ET) and Sec VIII/IX (acceptance); **ASNT SNT-TC-1A** / CP-189 / ACCP (personnel qualification); **ISO 9712** (NDT personnel certification); ISO 13588 (semi-automated PAUT of welds); ISO 16810/16827 (UT); ISO 17640 (UT of welds); ISO 10863 (TOFD); ISO 19232 (RT IQI); **AWS D1.1** (structural welding), **API 1104** (pipeline), **API 510/570/653** (in-service). Equations: N=D²/4λ, Ug=F·t/d, δ=1/√(πfμσ).

**(d) Training-data topics.** Selecting the right NDT method for a defect type and material; computing UT near-field length and beam spread; generating PAUT focal laws for a sectorial scan and reporting coverage; planning an RT exposure with acceptable Ug and IQI; building a weld map with method + acceptance code; evaluating an indication against ASME/AWS/API acceptance criteria; assessing part inspectability and flagging blind zones. Emitting `forge.ndt.*` tool-calls.

---

## 8. Reliability / Availability / Maintainability / Safety (RAMS)

**(a) Core knowledge.** **Reliability** R(t)=e^{−∫h(t)dt}; failure-rate models — exponential (constant λ, MTBF=1/λ), **Weibull** R(t)=e^{−(t/η)^β} (β<1 infant, β=1 random, β>1 wear-out — the bathtub), lognormal, normal; **MTBF/MTTF**; censored-data estimation (median-rank regression, MLE), B10/B-life; **reliability block diagrams** (series ∏R, parallel 1−∏(1−R), k-of-n, bridge); **fault-tree analysis** (top event, AND/OR gates, minimal cut sets, qualitative + quantitative top-event probability, importance measures Birnbaum/Fussell-Vesely); **event trees**; **Markov models** for repairable/redundant systems (state transition, steady-state availability); **availability** A=MTBF/(MTBF+MTTR) (inherent), operational availability A_o; **maintainability** (MTTR, MTBM, maintenance-task analysis, LORA, BIT/diagnostics, design-for-maintainability, accessibility — ties to ergonomics field 14); **safety** (hazard analysis, SIL/PL, risk = severity×probability, ALARP); **reliability growth** (Duane, Crow-AMSAA); spares (Poisson, METRIC); accelerated life testing (Arrhenius, inverse-power, Eyring); RCM, LCC, derating.

**(b) Concrete Forge capability.**
- **`ReliabilityWorkbench`** with a **Weibull/life-data analysis** engine (`forge::rams::lifeData`): fits Weibull/lognormal/exponential to (right/interval/left) censored data via MLE + median-rank regression; outputs β, η, R(t), B10, MTBF, confidence bounds; probability plots.
- **RBD solver** (`forge::rams::RBD`): series/parallel/k-of-n/bridge with analytic + Monte-Carlo evaluation; computes system R(t), MTBF, availability; reads component λ from the part library / MIL-HDBK-217 / FIDES models.
- **Fault-tree engine** (`forge::rams::FTA`): builds the tree, derives **minimal cut sets** (MOCUS/BDD), computes top-event probability, and **importance measures** (Birnbaum, Fussell-Vesely, RAW/RRW). Hooks the top events to FMEA failure modes (field 9).
- **Markov availability solver** (`forge::rams::Markov`): generator matrix, steady-state + transient state probabilities for redundant/repairable architectures.
- **Maintainability / accessibility analyzer** (`forge::rams::maintAccess`): uses the assembly BRep + a digital human (ties to field 14) to check that a serviceable component can be reached/extracted (swept-volume removal path), estimating MTTR from task times — design-for-maintainability scored on real geometry.
- **Availability + LCC dashboard** (`forge::rams::lcc`): A=MTBF/(MTBF+MTTR), life-cycle cost incl. spares (Poisson sparing), feeding sustainability (field 11) and the systems budget (field 1).
- **Reliability-growth** (`forge::rams::crowAMSAA`) tracker.

**(c) Standards/methods.** IEC 61508 (functional safety E/E/PE, SIL 1–4), ISO 26262 (automotive ASIL), IEC 61511, DO-178C/DO-254 + ARP4754A/ARP4761 (aerospace FHA/PSSA/SSA/FMEA/FTA), MIL-STD-882E (system safety), **MIL-HDBK-217F** + FIDES + Telcordia SR-332 (prediction), MIL-HDBK-338 (reliability), IEC 61078 (RBD), IEC 61025 (FTA), IEC 61165 (Markov), IEC 60300 (dependability), EN 50126 (railway RAMS), SAE JA1011/1012 (RCM). Distributions: Weibull, exponential, lognormal. Methods: FMECA, FTA, RBD, Markov, Monte-Carlo, ALT.

**(d) Training-data topics.** Fitting a Weibull to censored field data and interpreting β (infant vs wear-out); computing system reliability of a series/parallel/k-of-n RBD; building a fault tree, deriving minimal cut sets, and ranking basic events by importance; solving a 2-state/3-state Markov availability model; computing inherent vs operational availability; estimating MTTR from a geometry-based access/removal path; sizing spares via Poisson; SIL/ASIL allocation. Emitting `forge.rams.*` tool-calls.

---

## 9. Failure Mode & Effects Analysis (FMEA)

**(a) Core knowledge.** FMEA types — **DFMEA** (design), **PFMEA** (process), **FMEA-MSR** (monitoring & system response, for in-operation safety), system/functional FMEA, **FMECA** (adds criticality); the **AIAG-VDA 7-step** approach: (1) planning & preparation, (2) structure analysis, (3) function analysis, (4) failure analysis (failure mode/effect/cause chains), (5) risk analysis, (6) optimization, (7) results documentation; rating scales 1–10 for **Severity (S)**, **Occurrence (O)**, **Detection (D)**; legacy **RPN = S·O·D** vs new **Action Priority (AP)** — H/M/L from a lookup table weighting **S first, then O, then D** (so a high-severity item is never ignored even at low O / strong D); failure-cause→mode→effect linkage; interface with control plans, FTA (top events ↔ failure modes), and reliability data; criticality number Cr = Σ(β·α·λp·t) in FMECA; design controls (prevention/detection); special-characteristics flow-down.

**(b) Concrete Forge capability.**
- **`FMEAWorkbench`** implementing the **AIAG-VDA 7-step** workflow natively: structure tree (system→subsystem→component, auto-seeded from the **assembly BRep tree**), function net, failure net (failure-mode↔effect↔cause linkage), risk table, optimization tracker.
- **Failure-mode library + auto-seed** (`forge::fmea::seedFromGeometry`): proposes candidate failure modes per feature/material (fatigue crack at a stress riser, fastener loosening, weld lack-of-fusion, seal leak) — informed by the part's FEA stress field, fatigue results, and material, so the FMEA is grounded in real geometry/physics rather than generic checklists.
- **AP engine** (`forge::fmea::actionPriority`): implements the full AIAG-VDA S/O/D → AP (H/M/L) lookup; also computes legacy RPN for traceability; flags safety/regulatory special characteristics. Severity scale anchored to real effects.
- **FMECA criticality** (`forge::fmea::criticality`): Cr from mode ratio β, failure-effect probability α, part λp (pulled from reliability field 8), exposure t.
- **Bidirectional links:** each FMEA failure mode ↔ FTA basic/intermediate event (field 8), ↔ control plan / SPC characteristic (field 3), ↔ requirement (field 2), ↔ inspection method (field 6/7). Closes the loop so a Cpk shortfall or NDT reject updates Occurrence/Detection.
- **Reverse-FMEA / robustness** view highlighting un-mitigated high-AP items needing design change (drives topology/parametric redesign).

**(c) Standards/methods.** **AIAG-VDA FMEA Handbook (2019)** — 7-step + Action Priority; SAE J1739 (legacy DFMEA/PFMEA); **MIL-STD-1629A** (FMECA + criticality); IEC 60812 (FMEA/FMECA procedure); ISO 26262 (safety-related FMEDA, diagnostic coverage, SPFM/LFM); ARP4761 (aerospace FMEA/FMES). Concepts: S/O/D rating tables, AP H/M/L, RPN, FMECA Cr, special characteristics.

**(d) Training-data topics.** Running the AIAG-VDA 7-step for a given subsystem (structure→function→failure→risk→optimize→document); writing proper failure-mode/effect/cause triplets; assigning S/O/D from anchored scales and deriving Action Priority from the table; explaining why AP replaces RPN (severity dominance); computing FMECA criticality; seeding failure modes from an FEA stress hot-spot; linking a failure mode to an FTA event and a control-plan SPC characteristic. Emitting `forge.fmea.*` tool-calls.

---

## 10. Regulatory Compliance (ISO / ASME / CE / FDA)

**(a) Core knowledge.** Conformity-assessment landscape: **CE marking** (EU New Approach, applicable directives/regulations — Machinery Reg 2023/1230, Pressure Equipment Directive 2014/68/EU, Low-Voltage 2014/35/EU, EMC 2014/30/EU, ATEX, RoHS/REACH; harmonized standards → presumption of conformity; technical file, Declaration of Conformity, notified-body modules A–H); **ASME** codes (BPVC Sections I–XII — design-by-rule + design-by-analysis Sec VIII Div 2/3, B31 piping, U-stamp, Code Cases); **FDA** (21 CFR 820 QSR / now QMSR harmonized to ISO 13485, 510(k)/PMA/De Novo, Design History File, Device Master Record, 21 CFR Part 11 e-records/e-signatures, design controls); machinery functional safety (ISO 13849 PL, IEC 62061 SIL); risk management (ISO 14971 for medical, ISO 12100 for machinery); material/pressure traceability (PMI, MTRs, EN 10204 3.1/3.2). Cross-cutting: standards hierarchy (international→regional→national→industry), essential requirements, documentation/audit trails.

**(b) Concrete Forge capability.**
- **`ComplianceWorkbench`** with a **regulation/standard knowledge graph** (`forge::reg::StdGraph`): maps product type + market → applicable directives/codes → harmonized standards → required analyses/tests/documents; produces a **compliance checklist** and gap report.
- **ASME design-by-rule + design-by-analysis assistant** (`forge::reg::asmeVIII`): for pressure parts, computes required wall thickness (Sec VIII Div 1 formulas, t=PR/(SE−0.6P) etc.), MAWP, and routes Div 2 cases into the existing FEA solver with **stress-linearization** (membrane/bending/peak classification along stress-classification lines) and the ASME elastic/limit/elastic-plastic acceptance criteria — a real code-check, not a lookup.
- **CE technical-file builder** (`forge::reg::ceTechFile`): assembles the DoC, essential-requirements checklist (Machinery/PED), risk assessment (ISO 12100), and links to FEA/test evidence.
- **PED category + module selector** (`forge::reg::pedCategory`): from fluid group, pressure, and volume → hazard category (I–IV) and conformity module.
- **Material/traceability ledger** (`forge::reg::traceLedger`): EN 10204 cert level per material, PMI, heat-number flow-down into the BOM — an immutable JSON vault (reuses the PDM vault), supporting FDA DHF/DMR and Part 11 audit-trail semantics (who/what/when on every change).
- **Standards-evidence binding:** every compliance line item links to a requirement (field 2), an analysis (FEA/CFD), an inspection (field 6/7), or a document — a complete compliance digital thread.

**(c) Standards/methods.** ISO 9001/13485/14001/45001 (management systems); ASME BPVC (I–XII), B31.1/B31.3, B16.5; EU CE: Machinery Reg (EU) 2023/1230, PED 2014/68/EU, LVD, EMC, ATEX 2014/34/EU, RoHS, REACH, MDR (EU) 2017/745; FDA 21 CFR 820 / QMSR, 21 CFR Part 11, 510(k)/PMA; ISO 14971 (medical risk), ISO 12100 / 13849 / IEC 62061 (machinery safety); EN 10204 (material certs); IEC 60601 (medical electrical). Methods: design-by-rule, design-by-analysis (stress linearization, limit-load, elastic-plastic), conformity-assessment modules.

**(d) Training-data topics.** Determining applicable directives/codes for a product+market and producing a compliance checklist; computing ASME Sec VIII Div 1 wall thickness and MAWP; running an FEA stress-linearization and classifying membrane/bending/peak against Div 2 limits; selecting a PED hazard category and conformity module; assembling a CE technical file with ISO 12100 risk assessment; building an FDA DHF index with design-control traceability and Part 11 audit trail; tracking EN 10204 3.1 material certs in the BOM. Emitting `forge.reg.*` tool-calls.

---

## 11. Environmental & Sustainability Engineering (LCA)

**(a) Core knowledge.** **Life-Cycle Assessment** four phases (ISO 14040/44): (1) goal & scope (functional unit, system boundary, cut-off), (2) **Life-Cycle Inventory (LCI)** — material/energy flows, allocation, background data, (3) **Life-Cycle Impact Assessment (LCIA)** — classification → characterization (Σ flow×CF) → optional normalization & weighting, (4) interpretation (contribution, sensitivity, uncertainty); **system boundaries** cradle-to-grave / cradle-to-gate / cradle-to-cradle / gate-to-gate; **impact categories & characterization factors** — climate change (GWP: CO₂=1, CH₄≈29.8, N₂O≈273, AR6 100-yr), acidification, eutrophication, ozone depletion, photochemical ozone, human/eco-toxicity, water scarcity, abiotic depletion, land use, particulate matter; LCIA method families — **ReCiPe** (midpoint+endpoint H/E/I), **TRACI** (US EPA), CML, ILCD/EF 3.1, IMPACT 2002+; **embodied carbon** & operational carbon; **EPDs** + **Product Category Rules** (EN 15804 for construction); circularity (MCI, DfD, recyclability), DfE; energy modelling, design-for-manufacture-environment trade-offs.

**(b) Concrete Forge capability.**
- **`SustainabilityWorkbench`** with a **parametric LCA engine** (`forge::lca::assess`): pulls **real bill-of-materials + mass** from kernel mass-properties per part, multiplies by material/process **emission factors** (embodied LCI database, JSON), adds use-phase + end-of-life, and rolls up the assembly DAG → **GWP (kgCO₂e)** plus full multi-category LCIA. Result is geometry-true, updates live as the design changes.
- **Process-energy estimator** (`forge::lca::processEnergy`): from CAM operations (machining MRR/time, additive build volume, casting/forging) estimates manufacturing energy and scrap → ties to the existing CAM workbench.
- **Multi-criteria LCIA** (`forge::lca::lcia`): applies ReCiPe/TRACI/EF characterization factors across all categories; supports normalization + weighting; contribution analysis (hotspot by part/stage).
- **Embodied-carbon optimizer** (`forge::lca::carbonOpt`): runs the OR/topology engines (fields 5/CAE) with **GWP as an objective or constraint** — e.g., minimize mass×CF subject to FEA factor-of-safety; produces a Pareto front of carbon vs cost vs performance (ties to the existing carbon roadmap module).
- **EPD/PCR report generator** (`forge::lca::epdReport`): EN 15804 module A1–A3/A4–A5/B/C/D structure, inline ASCII/PDF writer.
- **Circularity metrics** (`forge::lca::circularity`): Material Circularity Indicator, recyclability %, design-for-disassembly score from joint/fastener analysis on the BRep.

**(c) Standards/methods.** ISO 14040:2006+A1:2020 / ISO 14044:2006+A2:2020 (LCA); ISO 14025 (Type III EPD); ISO 14067 (carbon footprint of products); GHG Protocol Product Standard; **EN 15804** (construction PCR); ISO 14006 (eco-design / DfE), ISO 14062; PAS 2050; EU Product Environmental Footprint (PEF/EF 3.1). LCIA methods: ReCiPe 2016, TRACI 2.1, CML-IA, IMPACT 2002+. GWP factors per IPCC AR6.

**(d) Training-data topics.** Defining a functional unit and system boundary for a part; building an LCI from BOM + masses + material emission factors; computing cradle-to-grave GWP and decomposing it by life-cycle stage; running multi-category LCIA with ReCiPe vs TRACI and explaining differences; estimating manufacturing energy from CAM ops; minimizing embodied carbon under an FEA safety constraint (carbon-aware topology); generating an EN 15804 EPD; computing a Material Circularity Indicator. Emitting `forge.lca.*` tool-calls.

---

## 12. Project Management & Agile Engineering

**(a) Core knowledge.** Project lifecycle & process groups (initiate/plan/execute/monitor/close); **scheduling** — WBS, **critical-path method** (forward/backward pass, ES/EF/LS/LF, total & free float, critical path = zero-float chain), PERT (β-distribution, te=(o+4m+p)/6, σ), **critical-chain** (buffers, resource leveling), Gantt; **earned-value management** (PV/BCWS, EV/BCWP, AC/ACWP, CV=EV−AC, SV=EV−PV, CPI=EV/AC, SPI=EV/PV, EAC=BAC/CPI, TCPI, VAC); resource histograms & leveling (ties to OR scheduling, field 5); **risk management** (qualitative P×I matrix, quantitative Monte-Carlo schedule/cost, EMV, contingency/management reserve); stage-gate / phase-gate; **Agile** (Scrum — sprints, backlog, velocity, burndown; Kanban — WIP limits, cumulative-flow, lead/cycle time, Little's Law; SAFe for scaled hardware/PLM); hybrid (gated-agile for hardware); change control; stakeholder & communications management.

**(b) Concrete Forge capability.**
- **`ProjectWorkbench`** with a **CPM/PERT scheduler** (`forge::pm::CPM`): WBS → activity network, forward/backward pass, float computation, critical-path highlight, resource leveling (reuses `forge::or::*` from field 5); PERT three-point estimates + **Monte-Carlo schedule risk** (`forge::pm::scheduleRisk`) yielding P50/P80 completion. Native Gantt view.
- **Earned-value engine** (`forge::pm::evm`): computes CV/SV/CPI/SPI/EAC/ETC/TCPI/VAC from baselined cost + progress; S-curve view; variance alerts.
- **Engineering-task↔artifact linkage:** project tasks bind to Forge artifacts — a "design pressure vessel" task links to the BRep, FEA case, drawing, and compliance checklist — so **% complete is evidence-based** (does the FEA pass? is the drawing released?) not self-reported. Ties the digital thread (fields 1/2/10) to schedule.
- **Risk register + Monte-Carlo** (`forge::pm::riskRegister`): P×I matrix, EMV, contingency sizing; integrated with technical risks from RAMS/FMEA (fields 8/9).
- **Agile board** (`forge::pm::kanban`): backlog/sprint/Kanban with WIP limits, velocity, burndown, **cumulative-flow diagram**, and lead/cycle-time via Little's Law (shared with Lean field 4) — for the engineering work itself (slices/features).
- **Change-control workflow** tied to the PDM vault revisioning and requirement change-impact (field 2).

**(c) Standards/methods.** PMI PMBOK (7th ed., principles + performance domains) + PMI Practice Standard for Scheduling/EVM; ISO 21500/21502 (project management); ISO/IEC/IEEE 16326 (project management for systems/software); AACE for EVM/estimating; ANSI/EIA-748 (EVMS); Scrum Guide; SAFe; PRINCE2; critical-chain (Goldratt). Equations: te=(o+4m+p)/6, CPI/SPI, EAC=BAC/CPI.

**(d) Training-data topics.** Building a WBS and CPM network, computing ES/EF/LS/LF/float, and identifying the critical path; PERT te/σ and Monte-Carlo P80 completion; computing EVM metrics (CPI/SPI/EAC) and interpreting variances; sizing schedule/cost contingency from a risk register; setting up a Scrum/Kanban board with WIP limits and reading a CFD/burndown; linking a task's % complete to an FEA pass; resource-leveling an over-allocated schedule. Emitting `forge.pm.*` tool-calls.

---

## 13. Applied Mathematics & Numerical Methods

**(a) Core knowledge.** **Linear algebra** (LU/Cholesky/QR/SVD factorizations, eigenvalue problems — QR/Lanczos/Arnoldi, condition number κ=‖A‖‖A⁻¹‖, ill-conditioning); **sparse linear solvers** — direct (sparse Cholesky/LDLᵀ, multifrontal, fill-reducing ordering AMD/METIS nested dissection) and **iterative** (CG for SPD, MINRES, **GMRES** for nonsymmetric, BiCGStab) with **preconditioners** (Jacobi, ILU(k)/ILUT, SSOR, **algebraic & geometric multigrid**, domain decomposition); **nonlinear systems** — **Newton-Raphson** (full/modified, line search, trust-region, arc-length/Riks for snap-through), Broyden quasi-Newton; **ODE/DAE integration** — explicit/implicit Euler, **Runge-Kutta** (RK4, embedded RK45/Dormand-Prince adaptive), BDF (stiff), Newmark-β / HHT-α / generalized-α for structural dynamics, symplectic integrators; **interpolation/approximation** — Lagrange, Hermite, cubic/B-spline, **NURBS** (knot vectors, basis recursion, weights), least-squares fitting; **numerical integration** — Gauss-Legendre/Gauss quadrature, adaptive Simpson, Monte-Carlo; **FEM/numerics** — shape functions, isoparametric mapping, Jacobian, numerical locking & remedies (reduced/selective integration, B-bar, assumed-strain), **adaptive mesh refinement** (h/p/hp, a-posteriori error estimators ZZ/residual), stabilization (SUPG/PSPG); root-finding (bisection, secant, Brent); FFT; optimization (gradient, BFGS/L-BFGS, SQP, interior-point — shared with OR field 5).

**(b) Concrete Forge capability.** This is the **numerical core under the entire kernel** — not a separate workbench, but the verified engine the FEA/CFD/MBD solvers, fitting, and optimization all sit on:
- **`forge::num::SparseSolver`** — fill-reducing-ordered sparse Cholesky/LDLᵀ (multifrontal) + **GMRES/CG/BiCGStab** with ILU/AMG preconditioners; auto-selects direct vs iterative by problem size/conditioning; reports κ and residual history.
- **`forge::num::Newton`** — Newton-Raphson with line search, trust-region, and **arc-length (Riks)** continuation for buckling/snap-through; consistent-tangent assembly; convergence by energy + residual norms.
- **`forge::num::ODE`** — adaptive RK45 (Dormand-Prince), BDF for stiff systems, and **HHT-α / generalized-α** time integration (this is the validated multibody-DAE / transient-dynamics integrator already proven to 0.016 % on the pendulum benchmark).
- **`forge::num::quadrature`** — Gauss-Legendre rules per element type; **`forge::num::nurbs`** — de-Boor/Cox basis, knot insertion, refinement (already underpinning the geometry kernel).
- **`forge::num::AMR`** — ZZ + residual a-posteriori error estimators driving h/p adaptive remeshing; locking-free element formulations (Wilson incompatible-modes / B-bar / EAS — the de-locking that fixed the static-FEA 0.33 % gate).
- **`forge::num::eig`** — Lanczos/Arnoldi for modal/buckling eigenproblems (shift-invert).
- Every routine is **benchmark-verified** against analytical solutions (the 7 analytical gates) — this is the rigor that backs the ≥0.85 CADGenBench claim on physics dimensions.

**(c) Standards/methods.** Golub & Van Loan (matrix computations); Saad (iterative methods for sparse linear systems — GMRES, ILU, multigrid); Hughes / Zienkiewicz-Taylor (FEM); Hairer-Wanner (ODE/DAE, stiff & geometric integration); Piegl-Tiller (NURBS book); Nocedal-Wright (numerical optimization). Reference verification: IEEE 754 arithmetic, method-of-manufactured-solutions (MMS), Richardson extrapolation / grid-convergence index (GCI, ASME V&V 10/20 for CFD/CSM verification & validation).

**(d) Training-data topics.** Choosing a direct vs iterative sparse solver and a preconditioner for a given stiffness matrix and explaining conditioning; setting up Newton-Raphson with arc-length for a buckling problem; selecting RK45 vs BDF vs HHT-α for a dynamics problem and justifying stability; explaining and curing volumetric/shear locking; driving adaptive mesh refinement from a ZZ error estimate and reporting convergence (GCI); fitting a NURBS to points; performing a modal eigen-extraction. These topics teach Archie to reason about *why* a solver is appropriate when it drives Forge CAE — emitting `forge.num.*` / solver-config tool-calls.

---

## 14. Human Factors & Ergonomics

**(a) Core knowledge.** **Anthropometry** (percentile body dimensions 5th–95th %ile, population databases, reach/clearance/grip, design-for-extremes vs adjustable-range); **biomechanics** (joint torques, spinal compression L5/S1, static-strength prediction); **physical-ergonomics assessment tools** — **RULA** (rapid upper-limb assessment, posture+force+repetition → 1–7 action level), **REBA** (rapid entire-body assessment, whole-body + load + coupling → action levels), **OWAS**, Strain Index, ACGIH **HAL-TLV** (hand-activity), **NIOSH lifting equation** (RWL = LC·HM·VM·DM·AM·FM·CM, LC=23 kg, multipliers ≤1; **Lifting Index = Load/RWL**, LI>1 risk), **Snook (Liberty Mutual) push/pull/carry tables**; **reach envelopes & workspace** (zone of convenient reach, normal/maximum work area, sightlines, console layout); **cognitive ergonomics** (workload NASA-TLX, situation awareness, human-error HEART/THERP); **HMI/control-panel design** (Fitts' law T=a+b·log₂(2D/W), Hick-Hyman, control-display ratio, reach-to-controls); **safety/clearance** (whole-body & finger/limb access openings, guarding distances, escape); **digital human modeling** (DHM — posturing a virtual manikin in the geometry to assess reach, vision, posture, lift, and serviceability); maintainability ergonomics (access for tools/hands, ties to RAMS field 8).

**(b) Concrete Forge capability.**
- **`ErgonomicsWorkbench`** with a **digital human manikin** (`forge::ergo::Manikin`): scalable anthropometric model (5th/50th/95th %ile, configurable population) with an articulated skeleton, inserted into the assembly scene; inverse-kinematics posing to grab/reach a target on the real BRep.
- **Reach-envelope & vision analysis** (`forge::ergo::reachEnvelope`, `forge::ergo::sightline`): swept reach volumes, zone-of-convenient-reach overlay on the cockpit/console/workstation geometry; eye-point sightline/occlusion check.
- **Posture scorers** (`forge::ergo::rula`, `forge::ergo::reba`, `forge::ergo::owas`): from the posed manikin's joint angles + applied load/coupling → RULA/REBA/OWAS action levels with the worst-segment breakdown.
- **NIOSH lifting + Snook** (`forge::ergo::niosh`, `forge::ergo::snook`): RWL = 23·HM·VM·DM·AM·FM·CM from the manipulated-object geometry (horizontal/vertical location, travel, frequency, coupling) → **Lifting Index**; push/pull/carry against Snook percentiles.
- **Fitts'-law / control-layout evaluator** (`forge::ergo::fitts`) for HMI panels and the reach-to-controls problem.
- **Serviceability / maintainability bridge:** the manikin checks that a hand+tool can reach and extract a serviceable part (swept-volume removal path) — directly feeding RAMS MTTR (field 8) and DfMA. This makes ergonomics a *geometry-true, dynamic* analysis on the actual assembly, not a checklist.

**(c) Standards/methods.** ISO 6385 (ergonomic principles), ISO 11226 (static working postures), **ISO 11228-1/2/3** (manual handling — lifting/carrying, pushing/pulling, repetitive), ISO 14738 (workstation dimensions), ISO 15534 / EN 547 (access-opening / human-body dimensions for machinery), ISO 9241 (HMI/ergonomics of interaction), SAE J833/J826 (vehicle anthropometry, H-point manikin), MIL-STD-1472 (human engineering), HFES 100; NIOSH lifting equation (Waters et al. 1994); Snook & Ciriello tables. Tools: RULA, REBA, OWAS, Strain Index, NASA-TLX, Fitts/Hick-Hyman.

**(d) Training-data topics.** Posing a 95th-%ile manikin to check reach/clearance on a workstation and reading the reach envelope; scoring a working posture with RULA/REBA and explaining the dominant risk segment; computing the NIOSH RWL and Lifting Index for a manual-handling task and recommending redesign (reduce HM, raise origin); checking Snook push/pull acceptability; applying Fitts' law to a control layout; verifying tool+hand access for a service task and feeding MTTR. Emitting `forge.ergo.*` tool-calls.

---

## 15. Facility & Plant Layout Engineering

**(a) Core knowledge.** Layout types (process/functional, product/line, cellular/GT, fixed-position, hybrid); **Systematic Layout Planning (SLP, Muther)** — flow analysis (from-to chart, P-Q analysis), **activity-relationship chart** (A/E/I/O/U/X closeness codes), relationship diagram, space-relationship diagram, alternative generation & evaluation; **facilities-location & assignment** — quadratic-assignment problem (QAP, minimize Σ flow×distance), CRAFT/ALDEP/CORELAP/BLOCPLAN heuristics (ties to OR field 5); **material-flow & handling** (distance metrics rectilinear/Euclidean, travel-charting, AGV/conveyor/AS-RS sizing, dock & aisle design); **line balancing** (shared with Lean field 4); **capacity & space** planning (cube utilization, storage slotting, ABC/Pareto slotting); cellular manufacturing & **group technology** (part-family coding, machine-component matrix, rank-order clustering / ROC, similarity-coefficient clustering); **plant services** (HVAC zoning, utilities routing, egress/fire-code, clearances); **simulation & validation** (DES of the layout — throughput, congestion, queue, WIP, blocking); safety/ergonomic clearances (field 14), expandability.

**(b) Concrete Forge capability.**
- **`PlantLayoutWorkbench`** building on the proven **zoned-facility generator** (`window.__forgeBuildEnvironment` → 100k+ organized components; racks/machine-rows/aisles, not confetti). The layout is real geometry the kernel owns.
- **SLP engine** (`forge::layout::SLP`): from-to/flow matrix + activity-relationship chart (A/E/I/O/U/X) → relationship + space-relationship diagrams; generates candidate block layouts.
- **QAP / improvement optimizer** (`forge::layout::optimize`): minimizes total material-travel Σ(flow×distance) via CRAFT-style pairwise exchange + simulated annealing/tabu (reuses `forge::or::*`, field 5); supports fixed departments, aisle constraints, and area requirements. Distance metric configurable (rectilinear for aisle-based, Euclidean for AGV).
- **Group-technology / cell former** (`forge::layout::cellFormation`): rank-order clustering / similarity-coefficient on a machine-part matrix to form manufacturing cells; lays the cells out and balances them (field 4).
- **Material-handling & flow sim:** spaghetti/travel-chart overlay (shared with Lean field 4) + **`forge::sim::DESEngine`** (field 5) to validate throughput, congestion, queue lengths, and WIP **before** committing the layout — the dynamic-validation requirement.
- **Aisle/clearance & egress checker** (`forge::layout::clearance`): minimum aisle widths, equipment service clearances (ties to ergonomics field 14 reach envelopes), and code-required egress paths verified against the BRep facility model.
- **Capacity/space planner** (`forge::layout::capacity`): cube utilization, ABC slotting, AS-RS/rack sizing; expandability zoning.

**(c) Standards/methods.** Systematic Layout Planning (Muther's SLP, ARC A/E/I/O/U/X); QAP (Koopmans-Beckmann); CRAFT/ALDEP/CORELAP/BLOCPLAN heuristics; group-technology coding (Opitz) + rank-order clustering (King); FEM-free DES validation. References: Tompkins et al. *Facilities Planning*; Heragu *Facilities Design*. Codes for clearances/egress: NFPA 101 (life safety), OSHA aisle/egress, IBC; HVAC/utility routing standards (ties to the existing MEP/HVAC modules). Distance metrics rectilinear/Euclidean/Chebyshev.

**(d) Training-data topics.** Running SLP from a from-to chart + ARC to a relationship diagram and candidate layout; optimizing department placement to minimize material travel (QAP/CRAFT) and reporting the travel reduction; forming manufacturing cells via rank-order clustering on a machine-part matrix; validating a layout in DES (throughput/WIP/congestion) before committing; sizing aisles and verifying egress/service clearances against the facility BRep; ABC-slotting a storage area; building a zoned facility with the environment generator. Emitting `forge.layout.*` and `forge.sim.*` tool-calls.

---

## Cross-field digital thread (integration summary)

These 15 indirect fields are not silos — they form one **closed digital thread** anchored to the kernel's real geometry & physics, which is what lets Archie→Forge hit ≥0.85 on *every* CADGenBench dimension:

- **Requirement (2)** → **System block & budget (1)** → **geometry/PMI (kernel)** → **CAE solver (13)** → **verification evidence (2)** → **compliance (10)**.
- **PMI (kernel)** → **inspection plan / CMM (6)** + **NDT weld map (7)** → **SPC/Cpk (3)** → **FMEA Occurrence/Detection (9)** → **reliability λ & RBD/FTA (8)** → **maintainability access via manikin (14)** → **availability & LCC (8)**.
- **BOM + mass (kernel)** → **LCA GWP & circularity (11)**; **CAM ops** → **process energy (11)** + **scheduling/nesting (5)**.
- **Lean VSM/OEE (4)** + **OR scheduling/QAP (5)** + **plant layout SLP (15)** all validated in the shared **`forge::sim::DESEngine`**.
- **Project EVM/CPM (12)** binds task %-complete to real artifacts (FEA pass, drawing released, compliance checklist), making progress evidence-based.
- **Applied numerics (13)** is the verified solver core under all of the above — sparse solvers, Newton/arc-length, HHT-α, AMR, NURBS — benchmark-validated against analytical gates.

---

## Sources

- ASME Y14.5 / GD&T / DRF / FCF: https://www.sigmetrix.com/blog/ultimate-guide-to-asme-y14.5 ; https://geotol.com/symbol/2018-standards/ ; https://www.makerstage.com/resources/gdt-feature-control-frame ; https://www.nelpretech.com/blog/asme-y14-5-standard-the-backbone-of-metrology-labs
- FMEA (AIAG-VDA 7-step, Action Priority): https://quasist.com/fmea/action-priority-in-fmea/ ; https://fmea-training.com/key-changes-aiag-vda-fmea/ ; https://relyence.com/help/user-guide/fmea-ap.html ; https://www.smmtqmd.co.uk/wp-content/uploads/sites/14/2019/10/AIAG-VDA-Combined-Approach-to-FMEA-Adam-Woodward.pdf
- RAMS / reliability / FTA / RBD / Markov / MIL-HDBK-217 / IEC 61508: https://aldservice.com/reliability/mil-hdbk-217.html ; https://www.reliabilityeducation.com/glossary.html ; https://arxiv.org/pdf/2507.05509 ; https://reliability-safety-software.com/services/rams/
- NDT (UT/PAUT/TOFD/RT/ET, ASME Sec V, ISO 13588): https://www.bakerhughes.com/blog/ndt-standards ; https://www.ndts.co.in/phased-array-ultrasonic-testing/ ; https://blog.projectmaterials.com/epc-projects/testing-inspection/non-destructive-tests-types/ ; https://pmc.ncbi.nlm.nih.gov/articles/PMC12196977/
- LCA (ISO 14040/44, GWP, ReCiPe/TRACI, EPD/PCR/EN 15804): https://en.wikipedia.org/wiki/Life-cycle_assessment ; https://below280.com/knowledge-base/life-cycle-assessment/lca-life-cycle-assessment/how-to-conduct-a-life-cycle-assessment/ ; https://iso-library.com/standard/14040/ ; https://circularecology.com/wp-content/uploads/2026/01/Product-Category-Rules-v1.0.pdf
- Lean (VSM, takt, SMED, OEE, TPM, TOC) + Six Sigma/SPC/Cpk: https://kanbantool.com/kanban-guide/value-stream-mapping ; https://www.learnleansigma.com/continuous-improvement/lean-manufacturing/ ; https://kanbantool.com/kanban-guide/theory-of-constraints ; https://www.six-sigma-material.com/TPM.html ; https://www.6sigma.us/process-improvement/process-capability-index-cpk/ ; https://www.presentationeze.com/presentations/statistical-process-control/statistical-process-control-full-details/process-capability-cp-cpk-pk-ppk/
- Operations Research (LP/MIP, job-shop, TSP, bin-packing, DES): https://en.wikipedia.org/wiki/Job-shop_scheduling ; https://towardsdatascience.com/the-job-shop-scheduling-problem-mixed-integer-programming-models-4bbee83d16ab/ ; https://medium.com/data-science/a-comprehensive-guide-to-modeling-techniques-in-mixed-integer-linear-programming-3e96cc1bc03d
- Metrology / CMM (LSQ vs minimum-zone, ISO 10360-6, GUM, temperature): https://metrocalpro.com/guide-to-coordinate-measuring-machines/ ; https://www.sciencedirect.com/science/article/abs/pii/S0263224100000567 ; https://www.measurement.sk/2003/S3/Swornowski.pdf ; https://www.sciencedirect.com/science/article/pii/S1877705815044720
- Human Factors (RULA/REBA/NIOSH/DHM): https://www.treston.us/blog/exploring-reba-rula-and-niosh-lifting-equation-impact-ai-workspace-optimization ; http://www.ieomsociety.org/ieom2019/papers/582.pdf ; https://retrocausal.ai/blog/reba-rula-assessments-niosh-platform/
- Systems / Requirements Engineering (ISO 15288, INCOSE, SysML, ReqIF, 29148/EARS): https://www.jamasoftware.com/blog/the-complete-guide-to-iso-iec-ieee-152882015-systems-and-software-engineering/ ; https://www.jamasoftware.com/requirements-management-guide/systems-engineering/what-is-mbse-model-based-systems-engineering-explained/ ; https://visuresolutions.com/alm-guide/incose-guide-to-mbse/ ; https://arxiv.org/pdf/2410.21288
- Numerical methods (sparse solvers/GMRES/CG/ILU, Newton-Raphson, RK, AMR, NURBS, condition number): https://www-users.cse.umn.edu/~saad/IterMethBook_2ndEd.pdf ; https://fiveable.me/numerical-analysis-ii/unit-2/finite-element-methods/study-guide/gK8GA8fbeRa8KnRh ; https://www.researchgate.net/publication/341918085_On_the_condition_number_of_high_order_finite_element_methods
