# P-1 AI — Exhaustive Deep-Dive (Research for ArchDisc / Forge + Archie)

> Research date: 2026-06-21. Sources cited inline + at bottom. This file feeds the mission bible, Archie's training-corpus plan, the kernel 1:1-parity plan, and the enterprise UI/UX redesign.

---

## 0. EXECUTIVE FRAMING — why this is the single most important competitor doc

P-1 AI is **the closest thing in existence to what ArchDisc is building**, and the convergence is uncanny:

- **Their product is literally named "Archie."** P-1's tagline: *"We are building an AI engineer agent for the physical world. His name is Archie."* Our local 14B model is also named Archie. We are building the *same character*: a junior-engineer AI agent that **drives real engineering tools rather than replacing them**.
- **Their thesis = our thesis.** "Engineering AGI (eAGI)" for physical systems — an agent that distills requirements, sizes components, posits architectures, runs multiphysics analysis, and produces structured design artifacts (CAD, SysML, Modelica). This is exactly Archie-drives-Forge.
- **The one structural difference is the moat we must exploit.** P-1 explicitly **does NOT build a CAD kernel** — Archie "orchestrates existing engineering software" (Slack/Teams front-end → vendor CAD/CAE in the loop). ArchDisc owns a **native pure-C++20 geometry kernel (Forge)**. That means we can *close the loop deterministically and offline*, evaluate geometry-truth directly, and generate synthetic training data from our own kernel — none of which P-1 can do without third-party licenses. **Forge's kernel is the asset P-1 doesn't have.**
- **The macro threat above both of us is Project Prometheus** (Jeff Bezos, Nov 2025): $6.2B founding → **$12B raise at a ~$41B valuation** (Nov 2025 / TechCrunch Jun 2026), explicitly building an *"artificial general engineer"* for jet engines, chips, drug compounds. Same category, 1000× the capital. Our differentiation is **local/offline + owned kernel + verifiable geometry**, not capital.

**Strategic takeaway:** P-1 has published the cleanest public blueprint of the eAGI capability surface (the arXiv 2505.10653 evaluation paper + the Sequoia podcast architecture). We should treat P-1's 6-level cognition taxonomy and federated-model architecture as a **specification to meet and exceed**, while leaning on Forge's owned kernel as the structural advantage they lack.

---

## 1. COMPANY FACTS

| Field | Value | Source |
|---|---|---|
| Name | P-1 AI, Inc. | arXiv author affiliation |
| HQ | San Francisco, CA | arXiv paper |
| Founded | 2024 | choppingblock.ai |
| Stage / funding | **$23M seed** (closed ~2025-04-29), out of stealth 2025-04-25 | BusinessWire, Fortune |
| Lead investor | **Radical Ventures** (partner Molly Welch / Sonya-Pat at Sequoia podcast) | Fortune |
| Other institutional | Village Global, Schematic Ventures, Lerer Hippeau | Fortune, AI Insider |
| Angel investors | **Jeff Dean** (Google DeepMind chief scientist), **Peter Welinder** (OpenAI VP new-product), **Zak Stone** (Google Cloud), **Bob van Luijt** (Weaviate CEO), **Tim Junio** (Palo Alto Networks) | p-1.ai, AI Insider |
| Headcount | 11–50 (26+ named on site) | choppingblock.ai |
| Contact | silvio@p-1.ai (Silvio Memme, ops) | p-1.ai |

### Founders / key team
- **Paul Eremenko — CEO.** Former **Airbus CTO** (at 35), former **United Technologies (Raytheon/RTX) CTO**, former **DARPA** program director (Adaptive Vehicle Make / FANG challenge — *the* DARPA program on AI-assisted vehicle design). Deep aerospace + defense + DARPA generative-design pedigree.
- **Aleksa Gordić — Head of AI.** Ex-**Google DeepMind** and **Microsoft** ML researcher (Serbian; well-known ML educator).
- **Adam Nagel — Head of Engineering.** Previously at **Acubed** (Airbus's Silicon Valley innovation center).
- **Susmit Jha** — program-synthesis researcher (2011 dissertation on program synthesis; SRI International lineage).
- **Sandeep Neema** — former DARPA PM (model-based design / CPS); lead author of the eAGI evaluation paper.
- **Ethan Lew, Chase Shimmin, Chandrasekar Sureshkumar, Hieu Nguyen** — co-authors / AI research staff.
- **Silvio Memme** — operations.

---

## 2. PRODUCT & TECHNICAL VISION

### 2.1 The vision statement
> "We are building an AI engineer agent for the physical world. His name is Archie." Goal: *"an Archie on every engineering team at every major industrial company."* North star (Sequoia podcast): design *"things we can't — the starships and Dyson spheres."*

### 2.2 What Archie is positioned to do (the automated workflow, end-to-end)
From the BusinessWire release, Fortune, IBM, and the Sequoia podcast, Archie does the **cognitive automation of a junior→college-grad mechanical/electrical engineer**:

1. **Distill requirements → key design drivers.** Parse a natural-language / spec brief into the dominant quantitative constraints (thrust, ΔT, power, weight, cost, envelope, redundancy).
2. **Posit one or more solution candidates** (architecture / topology selection).
3. **First-order sizing** — pick the relevant phenomenology and size components (motor Kv, prop diameter, heat-exchanger area, pump head, duct sizing).
4. **Tool selection + setup** — choose and configure the right detailed-analysis/simulation tool, generate valid inputs, ingest outputs. (Explicitly: Archie *calls* solvers/surrogates; it does NOT itself replace high-fidelity sim.)
5. **Multiphysics reasoning across modalities** — thermal ↔ electrical ↔ structural ↔ fluid ↔ control, coupled.
6. **Design trades** — explore the space, approach/improve the Pareto frontier (perf vs cost, weight vs strength).
7. **Regulatory / standards compliance checks** (AHRI, ASME, UL, MIL-STD).
8. **Communicate / collaborate** through a chat surface (**Slack / Teams**), "hired" as an entry-level remote engineer — *sell work, not software*.

### 2.3 Go-to-market & deployment model
- **"Sell work, not software."** Archie is hired like a remote junior engineer via Slack/Teams; **no change to the customer's existing CAD/PLM/sim tools or process.** Minimizes organizational friction.
- **First market: data-center cooling** (cooling + critical power), then automotive, aerospace & defense, building systems, heavy machinery, industrial.
- **Learning loop:** Phase 1 = non-proprietary synthetic data → entry-level competency; Phase 2 = behind-the-firewall access to the customer's PLM, real performance data, and quality-escape history → "entry level → average → expert engineer, fairly rapidly."
- First commercial capability: **product customization / variants** (e.g., airline-specific aircraft configs) — high-value, bounded (closed-world) design.

### 2.4 The scaling roadmap ("one order of magnitude per year")
| Vertical | Unique-part count | Timeline (per podcast) |
|---|---|---|
| Residential HVAC (toy demo) | ~100 | proof-of-concept (done) |
| **Data-center cooling** | **~1,000** | 2025 pilot |
| Industrial systems | ~10,000 | Year 2 |
| Automotive / heavy machinery | ~100,000 | Year 3 |
| **Aerospace / defense** | **~1,000,000** | Year 3–4 |
| Starships / Dyson spheres | beyond | north star |

Component-catalog requirement is **100–1000× the system part count** (so a million-part aircraft needs a 100M–1B-part catalog of components + hypothetical innovations to sample from).

---

## 3. AI ARCHITECTURE & APPROACH (the most important technical section)

### 3.1 Federated-model architecture (from the Sequoia podcast — most detailed public source)
Archie is **not one LLM**. It is a **federation of specialized models orchestrated by a central reasoner LLM**:

- **Orchestrator-Reasoner LLM** — the "brain." Interfaces with users (Slack/Teams), decomposes an engineering task into *primitive operations*, and routes each to a specialist model.
- **Physics-Surrogate model(s)** — **Graph Neural Networks (GNNs)** that predict a design's **performance vector** across the design space (fast multiphysics surrogate; replaces/accelerates full sim for inner-loop iteration).
- **Geometric-Reasoning model** — **VLMs + algorithmic solvers** for positioning, packing, interference/clearance, spatial layout.
- **"Lobotomized LLM"** — a language model *retrained off natural language* into a **programmatic structured-design representation** ("no longer good at English… very good at programmatic representations"). This is the design-as-graph/DSL encoder-decoder.
- **Physical World Models** — an *emerging, not-yet-deployed* category for higher-order spatial/physical reasoning.

### 3.2 The three primitive operations (everything reduces to these)
1. **Design evaluation** (forward: design → performance prediction).
2. **Design synthesis** (inverse: requirements → design).
3. **Error detection + in-filling** (diagnose/repair a partial or broken design).

### 3.3 Structured design representation ("on rails" reliability)
- Designs are represented as **structured artifacts / graphs**, not free text — components + discrete/continuous parameters + **topology (functional AND spatial)**.
- Real-world output targets **CAD, SysML, and Modelica** artifacts, validated by **syntactic + semantic checks in engineering software**.
- The structured representation is the mechanism that keeps the stochastic LLM "on rails" — it constrains generation to valid, physics-consistent, tool-ingestible artifacts. Eremenko's reliability argument: humans are stochastic too; existing org error-checks (reviews, milestones, testing) absorb a comparable error rate.

### 3.4 Semi-synthetic, physics-based training-data pipeline (their core IP)
The central bet (Eremenko): *"there just haven't been millions of airplanes designed since the Wright brothers"* — so real data is too scarce. They **manufacture** it:

1. **Component catalog** (100–1000× system size) — real supply-chain parts (motors, pipes, shafts, valves, heat exchangers) + hypothetical innovations. Built manually today; automating with AI.
2. **Intelligent composition** — *"not a tornado through a junkyard"*; structured rules model the phenomenological interactions between components so combinations are physically plausible.
3. **Sampling strategy** — **densely around dominant/known-good designs, sparsely around the corners and edges** → teaches boundary conditions and failure modes (the AlphaGo analogy: bootstrap from imitation of good play, then explore).
4. **Physics-based simulation** — every synthetic design gets a full multiphysics **performance vector** (thermal, electrical, vibration, EMI/structural/fluid).
5. Result: **millions of (design → performance) pairs** to train evaluation + synthesis + repair.

### 3.5 Evaluation framework — "Archie IQ" / eAGI levels (arXiv 2505.10653)
P-1 adapts **Bloom's taxonomy** into a **6-level engineering-cognition hierarchy**, measured along **3 complexity axes**: *directionality* (forward eval vs inverse synthesis), *behavior* (static vs dynamic), *scope* (closed- vs open-world).

| Level | Name | Directionality | Behavior | Scope | Engineering task |
|---|---|---|---|---|---|
| 1 | **Remember** | Forward | N/A | Closed | Recall equations, component props, standards/codes |
| 2 | **Understand** | Forward | Static | Closed | Identify components, read topology, design intent |
| 3 | **Apply** | Forward | Static+Dynamic | Closed | Predict perf of unseen designs, substitute parts, invoke solvers |
| 4 | **Analyze** | Forward + partial Inverse | Static+Dynamic | Closed | In-fill partial designs, detect errors/violations, propose fixes |
| 5 | **Create** | Forward + Inverse | Static+Dynamic | Semi-open | Synthesize full design from spec; adapt to new goals/regs; push Pareto frontier |
| 6 | **Reflect** | Bidirectional | Static+Dynamic | Fully open | Meta-reason, critique, abstract principles, recognize own limits/OOD |

**Secondary (domain) taxonomy — metadata tags** that drive adaptive test generation:
- **System Type:** eVTOL, HVAC (split/packaged/VRF), Aerospace/Spacecraft (radiators, attitude control, orbital mech), Energy (microgrids, battery packs, solar), Robotics/Mechatronics (actuator sizing, kinematics).
- **Design Scope:** component / subsystem / system level.
- **Domain (physics):** Thermal, Electrical, Control, Structural, Fluid/Airflow.
- **Modeling Requirements:** steady-state, transient, linear vs nonlinear (Ohm's law → Navier-Stokes), multiphysics (coupled, e.g. electro-thermal in batteries).
- **Applicable Standards:** AHRI (HVAC), ASME (pressure vessels), UL (electrical), MIL-STD (defense env qual).

**Worked example domain (in the paper): eVTOL propeller–motor matching.** Tests across all 6 levels with a concrete quadrotor (12 kg MTOW, 6S/22.2 V, 380 Kv, 18×6 props):
- L1: `T = C_T · ρ · n² · D⁴` (static thrust eq).
- L3: 18″→20″ at constant RPM ≈ +52% thrust/motor.
- L4: at 7,500 RPM the 18×6 gives 26.4 N vs 29.4 N required → insufficient.
- L5: design a 14 kg-MTOW quad, ≥12 min hover, ≤22 A/motor → recommend 340 Kv + 20×6, 34.3 N/motor, 19–21 A, 12–14 min.
- L6: reflect on why a sea-level performance map under-predicts high-altitude climb (density correction missing).

**Automated scoring strategy by level:**
- L1–L3: **objective** — symbolic math solvers, lookup tables, knowledge bases, sim models (deterministic).
- L4–L5: **simulation-augmented heuristics** — patch the design, simulate the fix, score on constraint satisfaction / subsystem consistency / Pareto-proximity, partial credit.
- L6: **expert-in-the-loop + LLM-as-judge / Agent-as-judge** (reward models for subjective trade-off reasoning).
- The eval harness must be **pluggable** — able to validate **structured artifacts (CAD, SysML, Modelica)** syntactically + semantically via real engineering software, not just text.

### 3.6 Stated open problems (their admitted gaps — our opportunities)
1. Automating scoring of **creativity/novelty** at L5–L6 is unsolved.
2. No shared semantic representation for **subjective trade-off reasoning** ("which design is better and why").
3. **Multi-step reasoning traceability** — hard to tell principled reasoning from surface heuristics without interpretable intermediate traces.
4. **Highly nonlinear domains** (structural reliability, control stability) need tighter coupling to high-fidelity sim + **formal verification**.

---

## 4. "PROJECT PROMETHEUS" — the bigger competitor flagged in the brief
The brief asked specifically about "Project Prometheus." **It is NOT P-1's project** — it is a separate, far larger company:

- **Founder:** Jeff Bezos (co-CEO with Vik Bajaj, ex-Google X / Foresite Labs). Founded **Nov 2025**.
- **Funding:** launched ~$6.2B; **raised $12B at ~$41B valuation** (Bezos + JPMorgan, Goldman Sachs, BlackRock) — *"one of the most valuable five-month-old startups ever."*
- **Mission:** an **"artificial general engineer"** — software to automate **design + manufacturing of complex physical systems**: jet engines, chips, drug compounds.
- **Relevance:** Prometheus is the same category as P-1 and ArchDisc but with ~1000× the capital. ArchDisc's differentiators vs *both*: **(a) local/offline 14B on a Mac Studio (no cloud dependency / data egress), (b) an owned native CAD/CAE kernel with verifiable geometry truth, (c) a single integrated desktop app (Forge) instead of orchestrating third-party tools.**

---

## 5. CONCRETE, NUMBERED CAPABILITY REQUIREMENTS — "Archie/Forge MUST be able to ___"

These map every P-1 capability (plus the Prometheus bar) onto concrete Forge-kernel + Archie-model requirements. Each must be **real, dynamic, industrial-grade, verifiable** — and live in the foundational model so P-1-grade work is easy.

### A. End-to-end engineering workflow (mirror P-1's pipeline)
1. Archie MUST **distill a natural-language / spec brief into a structured requirements object** — extracting quantitative design drivers (thrust, ΔT, power, mass budget, envelope, cost, redundancy, duty cycle) with units, tolerances, and priority weights.
2. Archie MUST **posit ≥1 candidate architecture / topology** (functional + spatial) for a given requirement set, not just a single primitive.
3. Archie MUST perform **first-order component sizing** for each candidate (analytic/handbook level) before invoking heavy sim — selecting the governing phenomenology automatically.
4. Archie MUST **select, configure, and invoke the correct Forge solver** (FEA/CFD/thermal/MBD/EM/acoustic) for a task, generate valid inputs, and ingest outputs — the "tool fluency" of eAGI L3.
5. Archie MUST **run design trades and produce a Pareto frontier** across ≥2 competing objectives (e.g. mass vs stiffness, cost vs efficiency, ΔP vs heat duty) with the trade table surfaced in the UI.
6. Archie MUST **check standards/regulatory compliance** and report pass/fail with the governing clause: at minimum **ASME BPVC/Y14.5, AISC 360, ACI 318, AHRI, UL, MIL-STD-810/461, ISO/ASHRAE, Eurocode** (Forge already has AISC/ACI/TMS/NFPA/ASHRAE/IEC/IEEE/SMACNA/Shigley calculators — wire them into the agent's compliance step).
7. Archie MUST operate in a **chat-driven, "hired-engineer" mode** (matches P-1 Slack/Teams) — but ours is the **Forge Archie console driving the real kernel via CUA**, fully offline.

### B. The three eAGI primitive operations (must be first-class kernel+model ops)
8. **Design EVALUATION** — Forge MUST, given a complete design, compute a full **multiphysics performance vector** (structural FoS/modes, thermal ΔT/peak, CFD ΔP/flow, EM, mass, cost, carbon) in one call. (Forge already has the physics-validated solvers — gate per FORGE_PHYSICS_VERIFICATION.md.)
9. **Design SYNTHESIS** — Forge MUST support **inverse/generative design**: requirements → parametric geometry. Real ops, not stubs (the existing 14 parametric verbs + SIMP topology optimizer are the seed; expand to full generative explorer).
10. **Design ERROR-DETECTION + IN-FILLING** — Forge MUST detect design-rule / physics / interference violations in a partial or supplied model and **propose + apply a validated fix** (patch → re-simulate → confirm), i.e. eAGI L4.

### C. Structured design representation (the "on-rails" mechanism)
11. Forge MUST have a **canonical structured design representation** — a graph of components + discrete/continuous parameters + **functional topology + spatial topology** — that Archie emits and the kernel consumes deterministically (extend the existing Tool Registry / ForgeRunner contract into a full design-graph IR).
12. Archie MUST emit **valid, schema-checked tool-calls only** (no free-text geometry) — syntactic + semantic validation before kernel execution, surfacing the real error on failure (no fallback, per the no-MVP rule).
13. Forge MUST **import/export the interop trio P-1 targets: STEP (CAD), SysML (MBSE), Modelica (system dynamics)** — plus glTF/DXF/STL/IGES — so the design-graph round-trips to industry artifacts. (STEP is a hard gate vs P-1, which lacks an owned kernel.)
14. The representation MUST capture **both static structure AND dynamic behavior** (P-1's L3+ requires dynamic) — see §D.

### D. Dynamic, multiphysics behavior (brief mandate: "no statics, only dynamic")
15. Forge MUST solve **transient / time-varying** behavior, not just steady-state: thermal transients (startup lag), motor ramp-up, transient CFD, **modal + harmonic + transient structural dynamics** (Forge has modal 0.2%, HHT-α multibody DAE pendulum 0.016% — keep these as the floor).
16. Forge MUST handle **nonlinear** governing equations across the spectrum P-1 names: Ohm's law → **Navier–Stokes**; linear elasticity → large-deformation/contact; linear control → nonlinear stability.
17. Forge MUST solve **coupled multiphysics** (P-1's explicit example: **electro-thermal effects in battery systems**) — at minimum thermal↔structural, electro↔thermal, fluid↔thermal (conjugate heat transfer), fluid↔structure (FSI).
18. Forge MUST cover all 5 of P-1's physics domains as solvers: **Thermal** (heat transfer, cooling loops, thermo cycles), **Electrical** (circuits, motors, batteries, signal integrity), **Control** (feedback loops, PID tuning, stability margins), **Structural** (stress-strain, beam loading, FoS), **Fluid/Airflow** (duct ΔP, fan/propeller selection, disk loading).
19. Forge MUST model **dynamic mechanisms / multibody / modal / transient** as training-corpus + kernel features (matches the user's 24B-dynamic-structures memory directive).

### E. Domain coverage (match P-1's system-type taxonomy + the brief's flagships)
20. Archie/Forge MUST natively handle P-1's named system types end-to-end: **eVTOL propulsion, HVAC (split/packaged/VRF), spacecraft thermal (radiators/attitude control), energy systems (microgrids/battery packs/solar), robotics/mechatronics (actuator sizing/kinematics)**.
21. Forge MUST handle the **data-center cooling + critical-power** domain (P-1's beachhead) as a first-class workflow: CRAC/CRAH sizing, cold/hot-aisle CFD, liquid cooling loops, PUE, redundancy (N+1/2N) — Archie should design a ~1,000-unique-part cooling system.
22. Forge MUST scale to the **part-count ladder** P-1 publishes — organized instancing to **~10k (industrial) → ~100k (automotive) → ~1M (aerospace)** components without confetti (matches the GE9X ~20k / 100k-environment memories: pack into structures, not scattered meshes).
23. Forge MUST deliver the **eVTOL prop–motor matching** workflow exactly as the P-1 paper poses it — given MTOW/voltage/current/thermal limits, recommend Kv + prop size with thrust/current/endurance numbers (this is a perfect, citable demo target).

### F. The synthetic-data engine (their core IP — we can do it BETTER with an owned kernel)
24. ArchDisc MUST run a **physics-based synthetic-design generator**: a **component catalog 100–1000× the target system size**, with **intelligent (rule-based) composition** ("not a tornado through a junkyard") so combos are physically plausible. (Extend `bulk_synth.py` / `bulk_synth_specs.py` + the corpus factory.)
25. The generator MUST label every synthetic design with a **full multiphysics performance vector computed by the Forge kernel** (our advantage: deterministic, owned, offline — P-1 needs third-party sim).
26. The generator MUST use **dense-near-dominant / sparse-near-edges sampling** to teach boundary conditions and failure modes (the AlphaGo bootstrap pattern).
27. Synthetic generation MUST honor the **download→process→delete storage discipline** and `iter_batches`/parquet streaming (per the M4-Max storage constraint memory).
28. The corpus MUST produce **(requirements → design) and (design → performance) and (broken design → fix)** triples to train all three eAGI primitives.

### G. Evaluation — implement "Archie IQ" / eAGI levels as our internal gate
29. ArchDisc MUST build an **eAGI 6-level eval harness** (Remember→Understand→Apply→Analyze→Create→Reflect) mirroring arXiv 2505.10653, tagged by the 5-axis metadata (system type / design scope / physics domain / modeling requirement / standard).
30. The harness MUST score **L1–L3 objectively** (symbolic solver + lookup + sim), **L4–L5 by simulation-augmented heuristics** (patch → re-sim → constraint/Pareto scoring), **L6 by LLM-as-judge / Agent-as-judge + expert-in-the-loop**.
31. The harness MUST validate **structured artifacts (STEP/SysML/Modelica), not just text** — syntactic + semantic checks against the real Forge kernel (our ForgeCADScore geometry-truth scorer is the seed: replay 1.0 vs corrupt 0.456).
32. Archie MUST demonstrate **L6 meta-reasoning** — critique its own design, flag OOD conditions (e.g. altitude-density correction), state its uncertainty/limits, and propose process improvements.
33. ArchDisc MUST **benchmark Archie against human cohorts** (entry / average / expert engineer) on the eAGI harness, the way P-1 does — and publish the curve internally. This sits alongside the existing **CADGenBench ≥0.85 every-dimension** north-star.

### H. Federated / multi-model architecture (match their model topology)
34. Archie MUST run an **orchestrator-reasoner** that decomposes a task into the 3 primitives and routes to specialists (we already have a per-discipline LoRA fleet + 2-brain split — formalize the router).
35. ArchDisc SHOULD add a **GNN physics-surrogate** for fast inner-loop performance prediction (so the agent can iterate without paying full-sim latency each step) — trained on the §F synthetic (design→performance) data.
36. ArchDisc SHOULD add a **geometric-reasoning specialist** (VLM + algorithmic solver) for packing / interference / clearance / spatial layout (Forge already has interference checking bound — bridge it to the agent).
37. Archie MUST have a **structured-design encoder/decoder** (P-1's "lobotomized LLM") — a model specialized to emit/parse the §C design-graph IR rather than English (this is the cua-realassets / interface-corpus direction, taken further).
38. (Watch) ArchDisc SHOULD track **physical world models** for higher-order spatial/physical reasoning — P-1's not-yet-deployed frontier; we should not be behind when it lands.

### I. Reliability / "on-rails" engineering correctness
39. Every Archie design output MUST be **physics-consistent and standards-compliant by construction** (torque-speed compatibility, energy balance, FoS ≥ target) — validated by the kernel before it reaches the viewport (matches the shared-ctx / context-verb correctness memories).
40. Archie MUST surface an **error rate vs human-engineer baseline** and slot into org review/milestone checkpoints (P-1's reliability argument) — i.e. produce auditable, reviewable artifacts, not opaque blobs.
41. Forge MUST give every deliverable an **interpretable reasoning trace** (the design-graph + the sequence of tool-calls + sim results) so multi-step reasoning is traceable (directly attacks P-1's admitted open problem #3).
42. For nonlinear/safety-critical domains, Forge SHOULD couple to **formal verification** of constraints (P-1's open problem #4) — at minimum interval/constraint-propagation checks on the design-graph.

### J. Strategic / moat requirements (beat P-1 and hedge Prometheus)
43. The whole loop MUST run **local + offline on a Mac Studio M4 Max (36 GB)** — P-1 and Prometheus are cloud; this is our defensible wedge (no data egress, works behind any firewall, no per-seat SaaS).
44. ArchDisc MUST keep the **owned native kernel** as the closed deterministic loop — Archie evaluates *real geometry truth* from Forge, not a third-party black box (the thing P-1 explicitly does not have).
45. ArchDisc MUST lead investor/customer demos with **Forge real-BRep deliverables** (meets the coherence/accuracy/visually-stunning bar) and the **eVTOL prop-motor + data-center-cooling** P-1-grade workflows, to show parity-or-better on their own published examples.
46. ArchDisc MUST train Archie **exhaustively on the flagship full specs** (components/dimensions/measurements/spatial/coherence/geometry/PBR/environments) and let the CUA run them (governing demo strategy memory) — so P-1-grade tasks are trivially in-distribution.

---

## 6. SOURCES
- P-1 AI homepage — https://www.p-1.ai
- arXiv 2505.10653, "On the Evaluation of Engineering Artificial General Intelligence" (Neema, Jha, Nagel, Lew, Sureshkumar, Gordic, Shimmin, Nguyen, Eremenko) — https://arxiv.org/abs/2505.10653
- Sequoia "Training Data" podcast w/ Paul Eremenko — https://www.sequoiacap.com/podcast/training-data-paul-eremenko/
- Sequoia inference essay, "From Data Centers to Dyson Spheres" — https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres
- BusinessWire stealth-exit release — https://www.businesswire.com/news/home/20250425073932/en/P-1-AI-Comes-Out-of-Stealth-Aims-to-Build-Engineering-AGI-for-Physical-Systems
- Fortune, "$23M to tackle engineering design with synthetic data" — https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/
- IBM Think, "The age of physical AI: Inside P-1's engineering brain" — https://www.ibm.com/think/news/physical-ai-age-p-1-engineering-brain
- Radical Ventures investment note — https://radical.vc/building-the-physical-worlds-first-ai-engineer-how-engineering-artificial-general-intelligence-could-transform-hardware/
- The AI Insider, "$23M seed to develop Archie" — https://theaiinsider.tech/2025/04/28/p-1-ai-raises-23-million-in-seed-funding-to-develop-engineering-agi-archie/
- ChoppingBlock company profile — https://www.choppingblock.ai/companies/p-1-ai
- Project Prometheus (Bezos) — TechCrunch https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/ ; Wikipedia https://en.wikipedia.org/wiki/Project_Prometheus_(company)
