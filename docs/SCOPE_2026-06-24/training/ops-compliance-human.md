# Training Curriculum — CLUSTER: Operations, Compliance, Human-Factors & Facility

**Scope owner:** SCOPE_2026-06-24 / training
**Date:** 2026-06-24
**Cluster id:** `ops-compliance-human` (one of the field-cluster generators of the Archie 14B corpus program)
**Backbone:** Qwen2.5-14B-Instruct ⊕ DeepSeek-R1-Distill reasoning, 4-bit qLoRA on M4 Max / 36 GB
**North-star gate (inherited):** Archie-drives-Forge ≥ **0.85 on CADGenBench across every axis**; every Forge model must be **real-world makeable, releasable, compliant, and operable** — not just renderable.

> **THESIS FOR THIS CLUSTER.** A senior engineer does not stop at "the geometry is valid." They ask: *Can the line that builds this be balanced? Does the part pass ISO/ASME/CE/FDA before release? What is the cradle-to-grave carbon and is it the lowest-impact design that still works? Will the project schedule and the takt absorb this change? Can a 5th-to-95th-percentile human reach, see, lift, and service it without injury? Does the cell it is built in flow, or does it backtrack across the plant?* This cluster trains the **judgment layer that turns a manufacturable part into a deployable, certifiable, sustainable, operable product** — and binds every verdict to a Forge tool-call so Archie acts inside the CAD, not just chats about it.

This cluster spans **7 sub-disciplines**:

| # | Sub-discipline | One-line scope |
|---|---|---|
| 1 | **Lean Manufacturing** | TPS, waste, takt/cycle/lead, line balancing, kanban/pull, SMED, OEE, value-stream |
| 2 | **Operations Research** | LP/MILP/IP, queueing, inventory (EOQ/newsvendor), scheduling, networks, simulation, stochastic |
| 3 | **Regulatory Compliance** | ISO 9001/13485/14971, ASME BPVC/Y14.5, CE/Machinery Directive/EN, FDA 21 CFR 820/IEC 62304/510(k) |
| 4 | **Environmental / Sustainability (LCA)** | ISO 14040/44, cradle-to-grave, GWP/embodied carbon, circularity, eco-design (ErP), EPD |
| 5 | **Project Management & Agile** | CPM/PERT, EVM, critical chain, Scrum/Kanban/SAFe, stage-gate, risk (FMEA/Monte-Carlo) |
| 6 | **Human Factors & Ergonomics** | anthropometry, biomechanics (NIOSH/RULA/REBA), reach/vision/clearance, controls/displays, HMI/SA |
| 7 | **Facility & Plant Layout** | systematic layout planning (SLP), flow/AEIOU, from-to charts, cellular/U-line, material handling, AGV/queue |

---

## 0. WHAT EXISTS ALREADY (build ON, do not re-scaffold)

Verified by reading the repo. Forge verbs this cluster terminates in are **already bound**:

| Need | Existing Forge verb / engine | Evidence |
|---|---|---|
| Per-unit & project cost (drives line-balance, EVM, layout) | `forge.cost.computeUnit`, `forge.cost.computeProject` | `frontend/src/ai/ForgeRunner.js` + `Cost.*` |
| Cradle-to-grave LCA / embodied carbon | `forge.carbon.computeLca` | bound; feeds Sub-discipline 4 |
| Geometry-truth (reach/clearance/interference for ergonomics + layout) | `forge.assembly.detectInterference`, `forge.assembly.solve`, `forge.edges.points` | assembly + edges verbs |
| Material-handling routing / aisle flow | `forge.piperoute.route` (graph router; reuse pattern for AGV path), `forge.duct.*` | piperoute/duct |
| Layout geometry authoring | `forge.part.extrudeProfile`, `forge.sketcher.*`, `forge.part.linearPattern`, `forge.part.circularPattern` | part/sketcher |
| Release artifacts (the compliance sink) | `forge.io.exportStepWithPmi`, `forge.drawings.projectView/Section/Detail` | io/drawings |
| Programmatic synth at scale | `scripts/bulk_synth*.py` (3.5–13k+ unique/run), `corpus_factory.py`, `merge_accumulator.py` | archdisc-Models/scripts |
| Geometry-truth offline reward | Forge `ForgeCADScore` (replay 1.0 vs corrupt 0.456) | CADGenBench scorer |

**Governing decision:** this cluster adds **NO new kernel ops**. It is a *judgment + tool-orchestration* corpus. Where a verdict is geometric (a control is out of reach, a clearance is violated, an aisle is too narrow, a part's embodied carbon), the answer terminates in an **existing** Forge verb whose output the kernel can replay → the claim is kernel-verifiable. Where a verdict is a standard/heuristic (a takt calc, an OEE number, a NIOSH lift index, a Cpk gate, an EVM index), it is computed correctly in Python at generation time (never fabricated) and cites the governing clause.

**Mandatory data hygiene (memory rules — inherited verbatim):** (a) bulk_synth programmatically, never agent hand-authoring; (b) strict **download→process→delete** + parquet `iter_batches`, one corpus at a time (the M4 Max storage was nearly killed once); (c) **never `--mask-prompt` on long corpora** (all-masked → NaN, silent adapter corruption) — guard loss + NaN per run; (d) every sample carries the chat template Archie was trained on; (e) **honesty** — where a method is empirical or a regime is unverified (e.g. discrete-event sim variance, supplier-specific EPD data, percentile anthropometry by population), the answer states the limit explicitly, no fabricated confidence.

---

## 1. KNOWLEDGE BREAKDOWN (bachelors → masters → PhD → industry)

For each sub-discipline: **(a)** sub-topics by level, **(b)** key theories/equations/standards (the *answer keys*), **(c)** the hard real-world judgment a senior engineer applies (the part that separates "ran green" from "shipped").

### 1.1 Lean Manufacturing

**(a) Topics by level.**
- *Bachelors:* TPS house (JIT + Jidoka), the 8 wastes (TIMWOODS — Transport, Inventory, Motion, Waiting, Overproduction, Overprocessing, Defects, Skills), 5S, standard work, takt/cycle/lead time, line balancing, pull vs push, kanban sizing, Little's law, OEE.
- *Masters:* value-stream mapping (current/future state), SMED (internal vs external setup), heijunka (level scheduling / mix-model sequencing), kanban with EPEI (every-part-every-interval), TPM, Six-Sigma DMAIC overlay, theory of constraints (drum-buffer-rope) interface with lean.
- *PhD / research:* lean–agile tradeoff under demand variability, queueing-theoretic justification of WIP caps (CONWIP), multi-objective line balancing (SALBP-1/-2, MALBP) as NP-hard combinatorial optimization, learning curves, lean for low-volume/high-mix.
- *Industry practice:* gemba, A3 problem solving, kaizen event facilitation, why a "balanced" line still misses takt (variability + reliability), the politics of WIP reduction.

**(b) Answer keys.**
- Takt time `T_takt = available_time / customer_demand`. Line is feasible iff every station cycle `C_i ≤ T_takt`.
- Number of stations (theoretical min) `N_min = ceil(ΣC_i / T_takt)`; **line efficiency** `η = ΣC_i / (N · C_max)`; **balance delay** `= 1 − η`; **smoothness index** `SI = √(Σ(C_max − C_i)²)`.
- Little's law `WIP = throughput · lead_time` (and its CONWIP/kanban corollaries).
- Kanban cards `K = ceil( (D · L · (1+α)) / Q )` (D=demand rate, L=lead, α=safety, Q=container qty).
- **OEE** `= Availability × Performance × Quality`; world-class ≈ 85%. Each factor's definition (run/planned, ideal-cycle·count/run, good/total).
- SMED target: setup → single-digit minutes; convert internal→external setup, parallelize, eliminate adjustment.
- EPEI = product of changeover frequency feasibility under available capacity.

**(c) Senior judgment.** A line balanced *on paper* to η=0.95 fails at takt if station reliability (OEE) and process variability aren't designed in — so size buffers from variability, not from a static cycle table. The lowest total-cost design is rarely the fastest single station; it is the one whose bottleneck = takt with margin for the *worst* reliable station. For high-mix/low-volume, a U-cell with cross-trained operators beats a rigid line. **Design coupling to CAD:** part feature choices (number of fasteners, hand vs powered assembly, symmetry/poka-yoke) directly set `C_i` — so DFMA and line balancing are one decision, and Archie should flag a part whose assembly time blows the takt budget.

### 1.2 Operations Research

**(a) Topics by level.**
- *Bachelors:* LP (graphical + simplex), sensitivity/duality, transportation/assignment, EOQ, basic queueing (M/M/1, M/M/c), CPM, deterministic DP.
- *Masters:* integer & mixed-integer programming (branch-and-bound/cut), network flows (max-flow/min-cut, min-cost-flow, shortest path), scheduling (job-shop, flow-shop, single/parallel machine, makespan/tardiness), inventory under uncertainty (newsvendor, (s,S), (Q,r)), Markov chains, discrete-event simulation, decision analysis.
- *PhD / research:* stochastic & robust optimization, column generation / Dantzig-Wolfe, Benders decomposition, Lagrangian relaxation, metaheuristics (SA/GA/tabu/ALNS), approximation algorithms & complexity, queueing networks (Jackson), stochastic DP / RL for control.
- *Industry practice:* modeling discipline (what is decision vs parameter vs constraint), solver selection & warm-starts, when an exact MILP is hopeless and you switch to a heuristic with a bound, validating a sim before trusting it.

**(b) Answer keys.**
- LP standard form, duality (weak/strong), complementary slackness, reduced costs / shadow prices.
- **EOQ** `Q* = √(2DS/H)`; total cost `TC = DS/Q + HQ/2 + Dc`; with backorders/quantity-discounts variants. Reorder point `ROP = d·L + z·σ_L`.
- **Newsvendor** `Q* = F⁻¹(Cu/(Cu+Co))` (critical ratio).
- **Queueing:** M/M/1 `L = ρ/(1−ρ)`, `W = 1/(μ−λ)`, `Wq = ρ/(μ−λ)`; M/M/c Erlang-C `Pwait`; utilization `ρ = λ/(cμ)`; Kingman/VUT approximation `Wq ≈ (ρ/(1−ρ))·((Ca²+Cs²)/2)·te` for G/G/1 (variability is the lever).
- **CPM/PERT:** forward/backward pass → ES/EF/LS/LF, total/free float, critical path = zero-float chain; PERT `te = (a+4m+b)/6`, `σ² = ((b−a)/6)²`, project σ = √(Σσ²_critical).
- MILP: LP relaxation as a bound; branch-and-bound; gap = (incumbent − bound)/incumbent.

**(c) Senior judgment.** The model is the deliverable, not the solve. A "feasible" MILP that ignores a real constraint produces a confidently wrong plan; a senior engineer spends 80% of effort on formulation and validation. Variability (`Ca², Cs²`), not mean utilization, is what makes queues blow up — so the high-leverage move is often reducing variability (level scheduling, smaller batches) rather than adding capacity. **Coupling to CAD/Forge:** layout flow, AGV dispatching, line balancing, and cutting-stock/nesting are all OR problems whose *decision variables are geometry* — Archie should be able to formulate them and emit the resulting placement/route as Forge geometry.

### 1.3 Regulatory Compliance (ISO / ASME / CE / FDA)

**(a) Topics by level.**
- *Bachelors:* what a standard *is* (consensus, normative vs informative), the GD&T language (ASME Y14.5 / ISO 1101 — already a kernel concern via PMI), drawing standards (Y14.x), material/test standards (ASTM), safety factors, the CE mark concept.
- *Masters:* **ISO 9001** QMS (process approach, PDCA, risk-based thinking), **ISO 13485** (med-device QMS), **ISO 14971** (med-device risk management), **ASME BPVC** (pressure vessels — allowable stress, design-by-rule vs design-by-analysis Sec VIII Div 1/2), **EU Machinery Directive 2006/42/EC** + harmonized EN ISO 12100 (risk assessment) / EN ISO 13849 (safety-related control, PL a–e) / EN 60204 (electrical), the **CE Declaration of Conformity** + technical file.
- *PhD / industry depth:* **FDA** — 21 CFR 820 (QSR / now QMSR harmonizing to 13485), **IEC 62304** (medical software lifecycle, Class A/B/C), **IEC 60601** (medical electrical), 510(k) substantial equivalence vs PMA vs De Novo, design history file (DHF) / device master record (DMR), **ISO 14971 + ISO 24971** risk file, biocompatibility (**ISO 10993**), traceability & UDI.
- *Industry practice:* reading a standard for what is *required* vs *recommended*, building the technical file/DHF as you design (not after), audit defense, change control, the cost of a recall.

**(b) Answer keys (the load-bearing clauses).**
- ASME BPVC Sec VIII Div 1: thin-wall circumferential stress `t = PR/(SE − 0.6P)` (UG-27); allowable `S` from Sec II-D; joint efficiency `E`; MAWP.
- Machinery Directive route: EN ISO 12100 risk assessment → risk reduction (inherently safe design → safeguarding → information) → EN ISO 13849-1 required **Performance Level** from S/F/P risk graph → DC/MTTFd/CCF → DoC + CE mark + technical file (Annex VII).
- ISO 14971 risk management process: risk = severity × probability; risk control option analysis; benefit-risk; residual risk; the **FMEA** as evidence (not a substitute).
- ISO 9001 clause spine: 4 context, 5 leadership, 6 planning (risk/opportunity), 7 support, 8 operation (8.3 design & development controls), 9 evaluation, 10 improvement.
- FDA design controls (820.30): design inputs → outputs → review → verification → validation → transfer → changes → DHF. IEC 62304 safety class drives required activities.
- GD&T datum reference frame, MMC/LMC bonus tolerance, true position — *tied to the kernel's existing `forge::native::gdt` evaluator.*

**(c) Senior judgment.** Compliance is a *design constraint discovered early*, not a gate at the end. The senior engineer knows which directive/standard applies (a pressure vessel >0.5 bar·L is PED-scoped; a machine with a hazardous moving part is Machinery-Directive-scoped; software that drives therapy is 62304 Class C), and folds the required evidence into the model from sketch one — so the STEP-with-PMI, the drawing set, the risk file, and the DoC fall out of the design rather than being reverse-engineered. The expensive failure is designing a beautiful part that cannot be certified for its market. **Coupling to Forge:** Archie's release path must emit `forge.io.exportStepWithPmi` + `forge.drawings.*` carrying the *correct* GD&T and the standard reference, and must refuse "release" when a compliance-blocking check (wall thickness vs MAWP, missing datum, undeclared hazard) fails.

### 1.4 Environmental / Sustainability — Life-Cycle Assessment

**(a) Topics by level.**
- *Bachelors:* the four LCA phases (goal & scope, inventory LCI, impact assessment LCIA, interpretation), functional unit, system boundary (cradle-to-gate / -grave / -cradle), embodied vs operational energy, recyclability.
- *Masters:* **ISO 14040/14044** rigor, **ISO 14067** product carbon footprint, **EN 15804 / ISO 14025** Environmental Product Declarations (EPD/PCR), impact categories (GWP100, AP, EP, ODP, POCP, ADP, water/land), characterization factors (e.g. CML/ReCiPe/TRACI), allocation (mass/economic/system-expansion), cut-off criteria, data quality (pedigree matrix), Monte-Carlo uncertainty.
- *PhD / industry:* consequential vs attributional LCA, dynamic LCA, **EU Ecodesign / ErP (2009/125/EC) + ESPR**, circular-economy metrics (Material Circularity Indicator), end-of-life (recycling credit, downcycling), design-for-disassembly, RoHS/REACH substance compliance, the **carbon vs cost vs performance** Pareto.
- *Industry practice:* getting *defensible* data (supplier EPDs vs generic databases — ecoinvent, GaBi), where the boundary choice swings the result, avoiding greenwashing, hotspot analysis to know where redesign actually moves the number.

**(b) Answer keys.**
- LCI → LCIA: `Impact_c = Σ_i (mass_i or energy_i) · CF_{i,c}`. GWP `= Σ m_gas · GWP100_gas` (CO₂=1, CH₄≈28–30, N₂O≈265).
- Embodied carbon of a part `≈ mass · EC_factor(material) + process_energy · grid_CF + transport`; e.g. virgin Al ≈ 8–18 kgCO₂e/kg vs recycled Al ≈ 0.5–2; steel ≈ 1.8–2.5; recycled steel ≈ 0.4–0.9; CFRP ≈ 20–50 (state ranges + cite database, never a false single figure).
- Functional unit normalizes everything (per part, per use, per lifetime-km).
- MCI (Ellen MacArthur) for circularity; recycling credit via system expansion.

**(c) Senior judgment.** The lowest-carbon design is *system-dependent*: a heavier part that lasts 3× or enables recycling can beat a lighter one. The functional unit and boundary choices dominate the answer — a senior engineer states them up front and does a hotspot analysis before optimizing. Material substitution (recycled feedstock, near-net-shape to cut machining scrap, topology-opt to cut mass) is the biggest lever, and it is *a geometry decision*. **Coupling to Forge:** `forge.carbon.computeLca` runs on the actual BRep mass + material + process; Archie should propose a redesign (lighter web, recycled alloy, fewer setups) and *re-run the LCA on the new geometry* to prove the reduction — closed-loop, kernel-grounded.

### 1.5 Project Management & Agile

**(a) Topics by level.**
- *Bachelors:* WBS, network scheduling (CPM/PERT), Gantt, resource leveling, basic risk register, stakeholder roles, PMBOK process groups.
- *Masters:* **Earned Value Management** (PV/EV/AC → CV/SV, CPI/SPI, EAC/ETC/TCPI/VAC), critical-chain PM (buffers), Monte-Carlo schedule/cost risk, agile (**Scrum** roles/events/artifacts, **Kanban** WIP-limited flow, velocity, burndown), stage-gate / phase-gate for hardware, design reviews (PDR/CDR).
- *PhD / industry:* hybrid/agile-for-hardware (set-based concurrent engineering — Toyota), portfolio optimization, real-options, scaled agile (**SAFe**, LeSS), resource-constrained project scheduling (RCPSP, NP-hard), procurement & contract types (FFP/CPFF) and incentive structure.
- *Industry practice:* schedules lie (pad detection), the 90%-done trap, why EVM SPI saturates near completion, running design sprints on hardware with long lead times, change-control board.

**(b) Answer keys.**
- EVM: `CV = EV − AC`, `SV = EV − PV`, `CPI = EV/AC`, `SPI = EV/PV`; `EAC = BAC/CPI` (or AC + (BAC−EV)/(CPI·SPI)); `TCPI = (BAC−EV)/(BAC−AC)`; `VAC = BAC − EAC`.
- CPM as in §1.2; PERT probabilistic completion `P(T ≤ x) = Φ((x − Σte)/√Σσ²)`.
- Scrum: velocity = Σ story points / sprint; burndown ideal vs actual; commitment vs forecast.
- Critical chain: project buffer ≈ 50% of removed safety, feeding buffers on merging paths.

**(c) Senior judgment.** Schedule and engineering decisions are coupled: choosing a long-lead casting over a machined block is a *schedule* decision as much as a cost/quality one. EVM tells you you're behind but not why; the senior PM reads the *cause* (scope creep, rework from a failed verification) and protects the critical chain/path. For hardware-agile, you iterate on *learning* (analysis, prototypes), not on a shippable increment every sprint. **Coupling to Forge:** `forge.cost.computeProject` is the cost baseline (BAC); a design change's schedule/cost impact (new lead time, added setups, rework) is computable, so Archie can quote the *project* consequence of a geometry decision, not just the part cost.

### 1.6 Human Factors & Ergonomics

**(a) Topics by level.**
- *Bachelors:* anthropometry (percentiles, design-for-extremes vs adjustable-range vs average), reach envelopes, clearance, sightlines, basic biomechanics, control/display compatibility, population stereotypes.
- *Masters:* biomechanics (static strength, L5/S1 compressive force), **NIOSH lifting equation**, **RULA / REBA** postural assessment, **OWAS**, **Snook tables** (push/pull), Fitts' law (movement time), Hick-Hyman law (decision time), workspace design (SAE J833/J826 for vehicles, ISO 14738 for machinery), display design, HMI.
- *PhD / industry:* cognitive ergonomics, situation awareness (Endsley), mental workload (NASA-TLX), human reliability (HEART/THERP), digital human modeling (DHM — e.g. RAMSIS/Jack-style percentile manikins), macroergonomics, anthropometric databases (ANSUR II, DINED, NHANES) and their population/secular limits, inclusive/accessible design (ISO 21542, ADA).
- *Industry practice:* designing the *workstation* and the *serviceability* of the product, not just the product; 5th-female-to-95th-male accommodation; why "average man" accommodates almost nobody.

**(b) Answer keys.**
- **NIOSH RWL** `= LC · HM · VM · DM · AM · FM · CM` (LC=23 kg; HM=25/H; VM=1−0.003|V−75|; DM=0.82+4.5/D; AM=1−0.0032A; FM,CM from tables). **Lifting Index** `LI = Load/RWL`; LI≤1 acceptable, >3 high risk.
- Anthropometry: design value `= mean ± z·SD` for the target percentile (e.g. 5th = mean − 1.645·SD; 95th = mean + 1.645·SD). Reach designed to the *small* user; clearance/escape to the *large* user.
- **Fitts' law** `MT = a + b·log₂(2D/W)` (index of difficulty).
- **Hick-Hyman** `RT = a + b·log₂(n+1)`.
- RULA/REBA → action level (1–4 / risk band) from posture+force+frequency scores.
- L5/S1 compression action limit ≈ 3400 N (NIOSH), max permissible ≈ 6400 N.

**(c) Senior judgment.** You design for the *range*, not the mean: reach to the 5th percentile, clearance to the 95th, with adjustability where the spread is costly. Ergonomic failures are geometric — a service access port behind a 95th-percentile arm's reach, a control out of the seated reach envelope, a 30 kg part with no lift point — and they are caught by *measuring the model against a manikin*, which is exactly what a CAD kernel can do. The senior engineer also designs the assembly/service *posture* (no overhead torquing, no awkward twist) because that sets injury risk and cycle time together. **Coupling to Forge:** reach/clearance/sightline checks are `forge.assembly.detectInterference` + `forge.edges.points` between a percentile manikin envelope and the part; a violated reach → an autoFix verb (relocate handle, add access port). NIOSH LI on a part's mass (from the BRep) gates "is this a one-person lift."

### 1.7 Facility & Plant Layout

**(a) Topics by level.**
- *Bachelors:* layout types (process/functional, product/line, cellular, fixed-position), flow patterns (I/L/U/S/comb), from-to charts, REL/activity-relationship (AEIOU) charts, basic material handling.
- *Masters:* **Systematic Layout Planning (Muther SLP)** full procedure, quantitative placement (load-distance / from-to minimization), **CRAFT / facility-location** (single/multi-facility, p-median, p-center), cellular manufacturing (group technology, **rank-order clustering / Production Flow Analysis**), line/U-cell balancing tie-in, **AGV/AMR** systems & guide-path design, queueing of material-handling, warehouse slotting.
- *PhD / industry:* the quadratic assignment problem (QAP — layout is NP-hard), continuous/dynamic layout, stochastic layout, simulation-based layout validation (discrete-event), Industry-4.0 reconfigurable layouts, digital-twin of the plant.
- *Industry practice:* aisle width vs forklift turning radius, safety egress & fire code, services routing (power/air/data) as a constraint, not designing flow on a blank sheet but around fixed columns/docks, the difference between a CAD-pretty layout and one that *flows*.

**(b) Answer keys.**
- SLP: input P-Q-R-S-T → flow analysis (from-to) + activity relationships (AEIOU) → relationship diagram → space requirements → space-relationship diagram → adjust for constraints → evaluate alternatives.
- **Load-distance objective** `min Σ_i Σ_j f_ij · d_ij` (flow × distance; rectilinear/Euclidean). This is the QAP `min Σ f_ij · c_{p(i)p(j)}`.
- Cellular: machine-part incidence matrix → rank-order clustering → cells; grouping efficiency / efficacy.
- Aisle/clearance from handling equipment turning radius + load width + safety margin (and code egress).
- AGV fleet sizing from flow demand, route length, speed, and queueing (Little's law on the transport system).

**(c) Senior judgment.** A layout that minimizes load-distance on paper can be unbuildable (ignores columns, docks, services, egress, expansion) or unsafe (aisles too tight, crossing forklift/pedestrian paths). The senior engineer treats layout as a *constrained* optimization on the *real* building shell, validates flow with simulation, and designs for change. Flow direction, distance, and adjacency are *geometric*, so layout is a CAD problem with an OR objective. **Coupling to Forge:** the plant shell + machine footprints are real geometry (`forge.part.extrudeProfile`, `linearPattern`); flow paths are `forge.piperoute.route` on the aisle graph; from-to distance and aisle-clearance are measured on the model (`detectInterference` for forklift-envelope vs rack); Archie minimizes load-distance by *moving the geometry* and re-measuring — kernel-grounded layout.

---

## 2. DATA SOURCES (premium / authoritative only)

> Streaming discipline applies to every downloadable source: **one at a time, parquet `iter_batches`, process→delete.** Standards documents are *not* redistributed — they are used to author *answer keys and clause citations* in synthetic samples (clause numbers, formulas, thresholds), never reproduced verbatim at length.

### 2.1 Textbooks (canonical)
- **Lean:** Womack & Jones, *Lean Thinking*; Liker, *The Toyota Way*; Rother & Shook, *Learning to See* (VSM); Ohno, *Toyota Production System*; Hopp & Spearman, *Factory Physics* (the queueing-grounded text — **core**).
- **OR:** Hillier & Lieberman, *Introduction to Operations Research*; Winston, *Operations Research: Applications and Algorithms*; Bertsimas & Tsitsiklis, *Introduction to Linear Optimization*; Nemhauser & Wolsey, *Integer and Combinatorial Optimization*; Law, *Simulation Modeling and Analysis*; Gross & Harris, *Fundamentals of Queueing Theory*.
- **Compliance / pressure & risk:** ASME BPVC (Sec II, VIII Div 1/2); Y14.5-2018; *Geometric Dimensioning and Tolerancing* (Krulikowski); *The ASQ Auditing Handbook*; ISO 14971 + ISO 24971 guidance; *Medical Device Regulation* texts; *Design Controls for the Medical Device Industry* (Teixeira).
- **LCA:** Baumann & Tillman, *The Hitch Hiker's Guide to LCA*; Hauschild, Rosenbaum & Olsen, *Life Cycle Assessment: Theory and Practice* (Springer, open-access); Ashby, *Materials and the Environment* (eco-selection — **core, geometry-coupled**).
- **PM/Agile:** PMBOK Guide (7th); Fleming & Koppelman, *Earned Value Project Management*; Goldratt, *Critical Chain*; Schwaber & Sutherland, *The Scrum Guide*; Reinertsen, *The Principles of Product Development Flow*.
- **Human factors:** Sanders & McCormick, *Human Factors in Engineering and Design*; Salvendy (ed.), *Handbook of Human Factors and Ergonomics*; Pheasant & Haslegrave, *Bodyspace* (anthropometry — **core**); Wickens et al., *Engineering Psychology and Human Performance*; Niebel & Freivalds, *Methods, Standards, and Work Design*.
- **Facility layout:** Tompkins, White, Bozer & Tanchoco, *Facilities Planning* (**core**); Muther, *Systematic Layout Planning*; Heragu, *Facilities Design*.

### 2.2 Courses (open / premium)
- **MIT OCW:** 2.810 *Manufacturing Processes & Systems*; 2.854/2.853 *Manufacturing Systems Analysis* (Factory Physics, OEE, variability — **core**); 15.066/6.251 *Optimization Methods* (LP/IP/networks); 16.842/16.842 *Systems Engineering*; ESD.273 *Logistics Systems*; 1.041 *Transportation*.
- **MIT OCW / MITx (MicroMasters in SCM):** Supply Chain Analytics, Design, Dynamics (EOQ, newsvendor, inventory, network design).
- **Stanford / Coursera:** MS&E LP/stochastic-modeling; *Six Sigma / Lean* (Georgia Tech / UMich on Coursera).
- **NPTEL:** *Industrial Engineering*, *Operations Research*, *Work System Design*, *Ergonomics for Beginners*, *Facility Planning and Design* — full lecture series with problem sets (rich answer-key source).
- **Human factors:** UMich / Penn State HF&E course materials; NASA *Human Integration Design Handbook (NASA-STD-3001 / HIDH)* — open, authoritative anthropometry & workspace.

### 2.3 Standards bodies (clause + formula source; not redistributed)
- **ISO:** 9001, 13485, 14971, 24971, 14040/44, 14025, 14067, 10993, 12100, 13849-1, 14738, 1101 (GPS/GD&T), 21542.
- **ASME:** BPVC (II/VIII), Y14.5-2018, Y14.x drawing series, B31 piping.
- **EU:** Machinery Directive 2006/42/EC (+ new Machinery Regulation 2023/1230), Ecodesign/ErP 2009/125/EC + ESPR, EN 15804, harmonized EN ISO 12100/13849/60204.
- **FDA / IEC:** 21 CFR 820 (QSR/QMSR), 21 CFR 11; IEC 62304, 60601, 62366 (usability — ties HF to med-device); ISO 14971.
- **OSHA / NIOSH:** NIOSH Lifting Equation (1991 revised), Applications Manual; OSHA 1910 (machine guarding, egress, aisle width references).
- **ASTM / SAE:** ASTM material/test specs; SAE J826/J833 (vehicle workspace, H-point manikin).

### 2.4 Papers / datasets (authoritative, downloadable where open)
- **Anthropometry datasets (open):** **ANSUR II** (US Army, public, ~93 measures × ~6000 subjects — the gold standard for percentile manikins), **DINED** (TU Delft), NHANES body-measures. → percentile reach/clearance answer keys + manikin envelopes for the geometry-coupled samples.
- **LCA data:** ecoinvent / GaBi (licensed — cite ranges, don't redistribute), **EXIOBASE** / USEEIO (open EEIO), ICE database (embodied carbon, open) for material EC factors. EPDs from EPD International (open declarations) for named-product hotspot examples.
- **OR / scheduling benchmarks:** **OR-Library** (Beasley — assignment, bin-packing, job-shop, SALBP, facility-location, p-median instances — open, ideal for problem→solution samples with known optima), TSPLIB, MIPLIB.
- **Line-balancing:** the classic SALBP instance sets (Scholl/Klein benchmark suite).
- **Layout / QAP:** QAPLIB (Burkard et al.).
- **Lean / Factory Physics:** the MIT 2.853 problem sets; *Factory Physics* worked examples.
- **Research literature:** *IISE Transactions*, *International Journal of Production Research/Economics*, *European Journal of Operational Research*, *Applied Ergonomics / Human Factors / Ergonomics*, *Journal of Cleaner Production* / *International Journal of LCA*, *Project Management Journal*. Used to author advanced problem→critique samples.

---

## 3. SYNTHETIC-DATA GENERATION PLAN

**Module:** `archdisc-Models/scripts/bulk_synth_ops_compliance_human.py` (new; mirrors `bulk_synth_mfg.py` exactly — stdlib only, seeded, in-memory hash dedup on USER text, hard `--cap`, all logging to STDERR, pure-JSONL stdout, chat-JSONL `{messages:[system,user,assistant]}`).

**System prompt (per generator family, varied):**
> "You are Archie, an expert operations / compliance / human-factors / facility engineer driving Forge. For each problem, name the governing standard, equation, or method; substitute the given values carrying units; give a verdict (PASS/FAIL/action-level) or the worked numeric result with the governing clause; propose the design fix; and where the verdict is geometric, terminate in the exact `forge.<wb>.<op>(args)` call that proves or applies it. Where a method is empirical, population-specific, or data-dependent, state the limit plainly — never fabricate confidence."

**Five Q/A archetypes (every sample is one of these):**

| Archetype | Shape | Grounding |
|---|---|---|
| **Q/A — worked calc** | spec → governing equation → substituted numeric answer + clause | Python-computed at gen time (`import math`); **never fabricated**; varied by seed+index |
| **Problem → solution** | OR/scheduling/layout instance → formulation → optimal/heuristic solution + bound | small instances solved exactly in Python (LP via simplex/`scipy`-free implementations or closed form; QAP/SALBP small → brute/known optimum from OR-Library); large → heuristic + stated gap |
| **Design → critique** | a part/workstation/cell/layout spec → what's wrong (out-of-reach control, un-balanced station, non-compliant wall, carbon hotspot, tight aisle) → the fix | verdict tied to a measurable threshold + standard; geometric ones reference the kernel measurement |
| **Tool-call (Forge verb)** | intent → the exact `forge.*` call sequence that *applies or proves* the judgment | **kernel-verifiable**: replay through Forge → `ForgeCADScore`/geometry-truth |
| **Compliance gate** | release request → run the checklist → PASS or BLOCK with the failing clause → emit release artifact or refuse | mixes standard-clause + geometric check; gate logic deterministic |

**Generators (one function family per sub-discipline; ≈ the `g_*` pattern of `bulk_synth_mfg.py`):**

- `g_lean(r)` — takt feasibility, station count `N_min`, balance efficiency/delay/SI, Little's-law WIP, kanban cards, OEE, SMED targets. Coupling: a part's *assembly time estimate* (from feature count) → does the station beat takt? Tool-call: `forge.cost.computeUnit` (labor time component), `forge.assembly.solve`.
- `g_or(r)` — EOQ/ROP/newsvendor, M/M/1·c & Kingman queue, CPM/PERT pass + float, small LP/MILP/transportation/assignment with known optimum, line-balancing (SALBP) from a precedence graph. Pull seed instances from OR-Library structure (deterministic regenerated, not the file).
- `g_compliance(r)` — ASME VIII wall `t = PR/(SE−0.6P)` + MAWP verdict; Machinery-Directive route + required PL from S/F/P; ISO 14971 risk score; ISO 9001 clause mapping; FDA 820.30 design-control / IEC 62304 class; GD&T true-position + MMC bonus (ties to kernel gdt). Gate archetype heavy.
- `g_lca(r)` — embodied carbon of a part from `mass · EC_factor`, GWP from gas inventory, material-substitution Δ (virgin vs recycled), functional-unit normalization, hotspot. Tool-call: `forge.carbon.computeLca` on the BRep + a *re-run after redesign* to prove reduction.
- `g_pm(r)` — EVM (CV/SV/CPI/SPI/EAC/TCPI/VAC), PERT probabilistic completion, critical-chain buffer, Scrum velocity/burndown. Coupling: `forge.cost.computeProject` as BAC; a geometry change's cost/schedule delta.
- `g_ergo(r)` — NIOSH RWL + LI, anthropometric percentile design value (mean ± z·SD), reach/clearance verdict, Fitts'/Hick-Hyman MT/RT, RULA/REBA action level. Coupling: ANSUR-II-derived percentiles → manikin envelope vs part → `forge.assembly.detectInterference` reach check + autoFix relocate.
- `g_layout(r)` — load-distance objective evaluation, from-to → relationship, SLP step reasoning, cellular ROC clustering, aisle width from forklift turning radius, AGV fleet sizing via Little's law, small QAP with known optimum. Tool-call: place machine footprints via `forge.part.extrudeProfile`/`linearPattern`, route flow via `forge.piperoute.route`, measure distance/clearance on the model.

**Grounding discipline (how each archetype stays honest):**
1. **Numbers are computed, never written.** Every numeric in an assistant answer is produced by Python at generation time (`math`, closed-form, or a tiny exact solver). Seed+index varies the inputs so samples are distinct (same seed+cap ⇒ identical output — reproducible).
2. **Geometric claims terminate in a replayable Forge call.** Reach, clearance, interference, aisle width, distance, embodied carbon, and unit/project cost are *measured on the kernel*, so the sample's verdict is checkable by replay through `ForgeCADScore` — this is the bridge from "knows the theory" to "drives the CAD correctly."
3. **Standards cite the clause, not a paraphrase of confidence.** Every compliance verdict names the standard + clause/equation id (e.g. "ASME VIII Div 1 UG-27", "NIOSH 1991 RWL", "EN ISO 13849-1 §6") so the model learns *traceable* reasoning.
4. **Empirical / data-dependent answers state their limit.** Anthropometry is population- and percentile-specific; LCA depends on boundary + database; queue results assume a distribution; the answer says so (matching the honesty rule that already governs turbulent-CFD and weld-line samples).
5. **Unit correctness.** SI primary, imperial recall where the standard is imperial (ASME allowable stresses, ±0.001″, NIOSH LC=23 kg / 51 lb).

**Why this makes Archie better INSIDE Forge (not just chat).** Every other cluster makes a part *exist*; this cluster makes a part *shippable*. The tool-call archetype trains Archie to: (i) **measure** its own model against a human (`detectInterference` vs a manikin envelope) and *move geometry* to fix a reach failure; (ii) **gate release** on a real compliance check and emit `forge.io.exportStepWithPmi` + `forge.drawings.*` only when it passes; (iii) **close the LCA loop** — propose a lighter/recycled redesign and *re-run `forge.carbon.computeLca` on the new BRep* to prove the carbon drop; (iv) **lay out the plant** by placing real footprints and routing real flow, minimizing load-distance by editing geometry; (v) **price the consequence** of a design change at the *project* level via `forge.cost.computeProject`. These are CADGenBench *interface* and *editing* axis behaviors — the model that can do them drives Forge like a senior engineer, not a chatbot.

**Scale & budget (per `--cap` run, bulk_synth scale).**

| Generator | Target unique samples/run | Notes |
|---|---|---|
| `g_lean` | ~120k | takt/balance/OEE/kanban combinatorics |
| `g_or` | ~180k | richest (LP/queue/CPM/scheduling instance space) |
| `g_compliance` | ~150k | clause × spec × verdict |
| `g_lca` | ~90k | material × mass × process × boundary |
| `g_pm` | ~80k | EVM/PERT/agile combinatorics |
| `g_ergo` | ~110k | NIOSH × anthropometry × posture × Fitts |
| `g_layout` | ~120k | from-to × SLP × QAP × AGV |
| **Cluster total** | **~850k unique / run** | after merge-accumulator dedup against the global corpus, expect ~600–700k net new |

Tool-call (Forge-verb-terminating) samples ≈ **35–40%** of the cluster (the geometry-coupled archetypes) so the model is biased toward *acting in Forge*, not narrating.

---

## 4. EXAMPLE TRAINING SAMPLES (prompt + ideal answer)

> Chat-JSONL; assistant shows the senior-engineer depth + (where geometric) the terminating Forge call. Numbers below are hand-computed for illustration; in production they are Python-generated.

### Sample 1 — Lean line balancing → takt feasibility (worked calc + tool-call)

**system:** *(cluster system prompt)*
**user:**
> A manual assembly line builds a gearbox housing. Customer demand is 480 units/shift over a 27,000 s available shift. The work content is 11 tasks with times (s): [62, 41, 58, 33, 70, 49, 55, 38, 66, 44, 51]. Tasks must keep precedence but assume the precedence allows a near-optimal pack. (1) What is takt time? (2) What is the theoretical minimum number of stations? (3) If you balance to 6 stations with a max station time of 80 s, what is the line efficiency and balance delay, and does the line meet takt? (4) The housing currently needs 11 manual fasteners; propose the highest-leverage design change and show how you'd check its assembly-time effect in Forge.

**assistant:**
> **(1) Takt time.** `T_takt = available_time / demand = 27000 s / 480 = 56.25 s/unit`. The line must deliver one housing every 56.25 s; every station cycle must be ≤ 56.25 s.
>
> **(2) Theoretical minimum stations.** Total work content `ΣC_i = 62+41+58+33+70+49+55+38+66+44+51 = 567 s`. `N_min = ceil(ΣC_i / T_takt) = ceil(567/56.25) = ceil(10.08) = 11 stations`. Note task 5 (70 s) and task 9 (66 s) each *individually exceed takt* — they are infeasible as single manual tasks and must be split or automated, or takt must be relaxed. This is the binding constraint, not the station count.
>
> **(3) Six-station balance.** With `N=6`, `C_max=80 s`: line efficiency `η = ΣC_i / (N·C_max) = 567 / (6·80) = 567/480 = 1.18` → **impossible**: η>1 means 567 s of work cannot fit in 6×80=480 s. The 6-station/80 s target is infeasible. Even at the takt ceiling, `6 × 56.25 = 337.5 s < 567 s` of work, so **6 stations cannot meet takt** regardless of balance. You need ≥ `ceil(567/56.25)=11` stations *and* you must break tasks 5 and 9 below 56.25 s. **Verdict: FAIL — re-balance to ≥11 stations and split the two over-takt tasks.**
>
> **(4) Highest-leverage design change.** The 11 manual fasteners dominate manual work content and serial precedence. The senior move is **DFMA fastener reduction** — convert to 4 self-locating snap/feature joints + 2 fasteners (target ≈ 6 join operations), which removes ~5 fastening tasks (~40–60 s of content) and lets the line hit takt with fewer stations. This is a *geometry* decision, so verify it on the model: re-feature the housing in Forge and re-estimate assembly time/cost.
>
> ```
> forge.assembly.solve()                        // re-evaluate mate graph after re-feature
> forge.cost.computeUnit({ part: "housing_v2", includeLaborTime: true })
> ```
> Compare the returned labor-time component against the per-station 56.25 s budget; if the reduced join count drops the dominant station below takt, the change is justified. **Honesty note:** the assembly-time saving is an *estimate* from join-operation count and standard times (e.g. MTM/MOST class), not a measured cycle — confirm with a time study before committing the line design.

### Sample 2 — Compliance gate: pressure vessel wall + release (compliance gate + tool-call)

**system:** *(cluster system prompt)*
**user:**
> A customer requests release of a cylindrical air receiver: internal radius R = 250 mm, internal design pressure P = 1.8 MPa, material SA-516 Gr 70 with allowable stress S = 138 MPa at design temperature, fully-radiographed butt weld (joint efficiency E = 1.0), corrosion allowance 1.5 mm. The model has a 6 mm wall. Can this be released? Give the governing rule, the verdict, and the release action.

**assistant:**
> **Governing rule.** ASME BPVC Section VIII Division 1, **UG-27(c)(1)** — circumferential (hoop) stress governs for a thin cylindrical shell under internal pressure: required thickness `t = P·R / (S·E − 0.6·P)`.
>
> **Worked calc.** `t = (1.8 · 250) / (138·1.0 − 0.6·1.8) = 450 / (138 − 1.08) = 450 / 136.92 = 3.287 mm`. Add corrosion allowance: `t_req = 3.287 + 1.5 = 4.787 mm`. The supplied wall is **6 mm ≥ 4.787 mm → the pressure-boundary thickness PASSES** with `6 − 4.787 = 1.213 mm` margin. MAWP at 6 mm (less CA) `= S·E·t / (R + 0.6·t) = 138·1.0·4.5 / (250 + 0.6·4.5) = 621 / 252.7 = 2.458 MPa > 1.8 MPa design` — confirms margin.
>
> **But this is a vessel.** Wall thickness PASS is necessary, not sufficient. Before release I must confirm: (i) the vessel is within the **PED / Sec VIII scope** and the correct design category; (ii) the longitudinal joint is *also* checked (UG-27(c)(2): `t = PR/(2SE+0.4P)` — smaller, not governing here); (iii) heads, nozzles, openings (UG-37 reinforcement), and the hydrostatic test pressure (1.3× MAWP, UG-99) are specified; (iv) the **technical file / DHF** carries the calc, material certs, NDE records, and the GD&T-bearing drawing. Release is BLOCKED until those are present.
>
> **Release action (when complete):** emit the PMI-bearing STEP + the certified drawing set, carrying the allowable-stress basis and the standard reference:
> ```
> forge.io.exportStepWithPmi({ part: "air_receiver", standard: "ASME_VIII_Div1" })
> forge.drawings.projectView({ part: "air_receiver", view: "section", annotateMAWP: true })
> ```
> **Verdict: wall PASS (4.787 mm req vs 6 mm actual); RELEASE CONDITIONAL** on nozzle reinforcement check, hydrotest spec, and a complete technical file. Do not mark "released" on thickness alone.

### Sample 3 — Ergonomics reach + LCA redesign loop (design→critique + tool-call, kernel-grounded)

**system:** *(cluster system prompt)*
**user:**
> A maintenance access cover on a machine is a solid 6061-T6 aluminium plate, 400 × 300 × 12 mm, secured by 8 bolts, located so the operator must reach it from a fixed standing position. The bolt circle's farthest fastener centroid is 740 mm horizontally from the operator's shoulder reference point. (1) Is the farthest bolt within the functional reach of a 5th-percentile female operator? (2) Is the cover a safe one-person lift? (3) Propose a redesign that improves both ergonomics and embodied carbon, and show the Forge checks that prove it.

**assistant:**
> **(1) Reach (anthropometry, design-to-the-small-user).** Functional (thumb-tip) reach must accommodate the 5th-percentile female so the *smallest* user can still operate it. From ANSUR II, 5th-percentile female functional reach ≈ 650–675 mm (seated/standing thumb-tip reach; population- and posture-specific — state the source). The farthest bolt is at **740 mm > ~665 mm → OUT OF REACH** for the 5th-percentile female. **Verdict: FAIL.** The operator must lean/step, adding awkward posture (RULA penalty) and time. Fix: bring the farthest fastener within ≤ ~650 mm, or reduce fastener count/relocate the access.
>
> **(2) One-person lift (NIOSH).** Plate mass `= ρ·V = 2700 kg/m³ · (0.400·0.300·0.012) m³ = 2700·0.00144 = 3.89 kg`. That mass is well under any NIOSH concern, so the *lift load* is fine. The risk is **posture + reach**, not weight: lifting a 3.9 kg plate at 740 mm horizontal reach drives the NIOSH **Horizontal Multiplier** `HM = 25/H = 25/74 ≈ 0.34`, collapsing the Recommended Weight Limit even for a light load and signaling a poor-posture extraction. **Verdict: load OK, but the reach geometry makes the task ergonomically poor.**
>
> **(3) Redesign (ergonomics + carbon, one decision).**
> - **Geometry:** add a captive quarter-turn latch + a relocated grab handle so the access point centroid sits ≤ 650 mm from the shoulder reference (fixes reach); reduce 8 bolts → 2 captive fasteners + 2 hinges (fixes posture/time/DFMA).
> - **Carbon:** the plate is over-massed for its load. Switch to **recycled 6061** feedstock and pocket/rib the plate (topology-style mass reduction) to ~7 mm effective wall. Virgin Al ≈ 8–18 kgCO₂e/kg vs recycled ≈ 0.5–2 kgCO₂e/kg (database- and grid-dependent — cite the range, not a false single figure), so feedstock + mass reduction compound.
>
> **Forge proof (kernel-grounded, closed loop):**
> ```
> // (a) reach check: 5th-pct manikin thumb-tip envelope vs the relocated handle
> forge.assembly.detectInterference({ a: "manikin_p05_reach_envelope", b: "access_handle_v2" })
> //    -> require the handle centroid INSIDE the reach envelope (no clearance gap)
>
> // (b) re-feature: pocket + rib the plate, then re-run LCA on the ACTUAL new BRep
> forge.part.shell({ part: "cover_v2", thickness: 2.0 })
> forge.part.rib({ part: "cover_v2", thickness: 3.0 })
> forge.carbon.computeLca({ part: "cover_v2", material: "Al6061_recycled", boundary: "cradle-to-grave" })
> //    -> compare GWP vs cover_v1 to PROVE the reduction on real geometry
> ```
> **Verdict:** v1 FAILS reach (740 mm vs ~665 mm) and is carbon-heavy for its function; v2 brings the access within 5th-percentile reach, cuts fastening/posture burden, and lowers embodied carbon via recycled feedstock + mass reduction — and every claim is re-measured on the kernel model, not asserted. **Honesty note:** the reach percentile is for a specified population (ANSUR II, US); for a different workforce, re-evaluate against the applicable anthropometric database.

---

## 5. INTEGRATION & RUN NOTES

- **Adapter topology:** this cluster folds into the **per-cluster LoRA** layer of the corpus program (under the foundational math/logic/reasoning adapter), routed per-request via the `adapters` field — same 2-brain serve pattern. It is *not* a standalone model.
- **Mixing:** generate → `merge_accumulator.py` (dedup against the global corpus on USER hash) → `corpus_factory.py` / `mix_forge_capability.py` to balance against Pillar A (math) and Pillar C (manufacturing) so the tool-call ratio of the *combined* corpus stays ≥ the CADGenBench-targeted threshold.
- **Eval:** the geometric (tool-call) samples are scored by Forge replay through `ForgeCADScore` (interface + editing axes); the calc/compliance samples are checked by re-running the Python answer-key and by a held-out clause-citation accuracy probe (`eval_archie.py` extension). NaN-guard + loss-watch every run; **no `--mask-prompt`** (samples are long).
- **Storage:** download→process→delete, one source at a time; standards/textbooks are read for clauses/formulas to author answer keys — never bulk-redistributed into the corpus.
- **What this cluster does NOT do:** add kernel ops (it consumes existing `forge.cost/carbon/assembly/io/drawings/part/piperoute` verbs), train vision (the drawing→intent branch is Pillar E/VLM), or replace the manufacturing cluster (it *layers* release/operability judgment on top of DFM).
