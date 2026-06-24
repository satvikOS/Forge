# P-1 AI — Exhaustive Deep-Dive + "Make P-1's Tech Easy-Peasy for Forge" Plan

> Research date: **2026-06-24**. Grounded, cited inline + at bottom. Supersedes/refreshes `SCOPE_2026-06-21/research/p1ai.md`.
> Feeds: the Mission Bible, Archie 14B foundational corpus, the kernel 1:1-parity plan, the enterprise UI/UX redesign, and CADGenBench.
> Operating doctrine inherited from the bible: *leave nothing out of scope; no lite/stub/MVP/fallback; dynamic (transient/modal/forming/motion) over static; verified by HEADED Playwright e2e on the real app+kernel+model.*

---

## 0. EXECUTIVE FRAMING — why P-1 is THE competitor doc

P-1 AI is the closest thing in existence to what ArchDisc is building, and the convergence is uncanny:

- **Their product is literally named "Archie."** P-1's homepage tagline: *"We are building an AI engineer agent for the physical world. His name is Archie."* Our local 14B model is also named Archie. Same character: a junior-engineer AI agent that **drives real engineering tools rather than replacing them**. (The name traces to the sentient AI in Thomas J. Ryan's 1977 novel *The Adolescence of P-1*.) [p-1.ai]
- **Their thesis = our thesis.** "Engineering AGI (eAGI)" for physical systems: an agent that distills requirements, sizes components, posits architectures, runs multiphysics analysis, and produces structured design artifacts (CAD, SysML, Modelica). This is *exactly* Archie-drives-Forge. [arXiv 2505.10653; BusinessWire]
- **The single structural difference is our moat.** P-1 **explicitly does NOT build a CAD kernel.** Archie "doesn't replace existing engineering software; instead, it automates the complex reasoning that connects them and works *with* these existing tools." [Radical Ventures] ArchDisc **owns** a native pure-C++20 geometry kernel (Forge). We can close the loop deterministically and offline, score geometry-truth directly (ForgeCADScore), and *generate synthetic training data from our own kernel* — none of which P-1 can do without third-party licenses. **Forge's kernel is the asset P-1 doesn't have.**
- **The macro threat above us both is Project Prometheus** (Bezos): same "artificial general engineer" category, ~1000× the capital. Our differentiation is **local/offline + owned kernel + verifiable geometry**, not capital. (See `prometheus.md`.)

**Strategic takeaway:** P-1 has published the cleanest public *blueprint* of the eAGI capability surface — the arXiv 2505.10653 evaluation paper (full 6-level cognition taxonomy) + the Sequoia podcast architecture description (the federated model topology + the 3 primitive operations + the synthetic-data pipeline). **We treat that blueprint as a specification to meet and exceed**, then lean on Forge's owned kernel as the structural advantage they lack. This doc ends with a numbered, kernel-area-mapped plan for exactly that.

---

## 1. COMPANY FACTS

| Field | Value | Source |
|---|---|---|
| Name | P-1 AI, Inc. | arXiv author affiliation |
| HQ | San Francisco Bay Area, CA | p-1.ai careers |
| Founded | 2024 | Fortune / PitchBook |
| Out of stealth | **2025-04-25** | BusinessWire |
| Stage / funding | **$23M seed** | Fortune, BusinessWire, AI Insider |
| Lead investor | **Radical Ventures** | Fortune |
| Other institutional | Village Global, Schematic Ventures, Lerer Hippeau | Fortune, Lerer Hippeau |
| Angel investors | **Jeff Dean** (Google DeepMind chief scientist), **Peter Welinder** (OpenAI VP new-product), **Zak Stone** (Google Cloud), **Bob van Luijt** (Weaviate CEO), **Tim Junio** (Palo Alto Networks) | p-1.ai, AI Insider |
| Headcount | 11–50 (25+ named on site) | p-1.ai, Glassdoor |
| Contact | silvio@p-1.ai (Silvio Memme, ops/BD) | p-1.ai |
| Careers | jobs.ashbyhq.com/P-1%20AI (SF Bay + remote US/Canada; some roles need security-clearance eligibility) | p-1.ai |

### Founders / key team (also the arXiv 2505.10653 author list — confirms staffing)
- **Paul Eremenko — CEO.** Former **Airbus CTO**, former **United Technologies (RTX) CTO**, former **DARPA** program director (Adaptive Vehicle Make / FANG — *the* DARPA program on AI-assisted vehicle design). Deep aerospace + defense + DARPA generative-design pedigree. Stated north star: an AI superintelligence that "can build starships and Dyson spheres." [Fortune; Sequoia podcast]
- **Aleksa Gordić — Head of AI / co-founder.** Ex-**Google DeepMind** and **Microsoft** ML researcher; well-known ML educator. [Fortune]
- **Adam Nagel — Head of Engineering / co-founder.** Previously at **Acubed** (Airbus's Silicon Valley innovation center). [Fortune]
- **Sandeep Neema** — former DARPA PM (model-based design / CPS); lead author of the eAGI evaluation paper. [arXiv 2505.10653]
- **Susmit Jha** — program-synthesis / formal-methods researcher (SRI International lineage). [arXiv 2505.10653]
- **Ethan Lew, Chase Shimmin, Chandrasekar Sureshkumar, Hieu Nguyen** — AI research staff / co-authors. [arXiv 2505.10653]
- **Silvio Memme** — operations / BD. [p-1.ai]

> Note: Eremenko's DARPA Adaptive Vehicle Make / META lineage is significant — that program produced the *original* attempt at automated, correct-by-construction complex-system design (the META "design flow" + foundry). P-1 is the LLM-era reboot of that idea with the same CTO. Forge should internalize that any "model-based design + verify-by-simulation" pattern P-1 ships descends from META.

---

## 2. PRODUCT & VISION — EVERYTHING ARCHIE DOES

### 2.1 Vision statement (verbatim)
> "We are building an AI engineer agent for the physical world. His name is Archie." Goal: *"an Archie on every engineering team at every major industrial company."* North star (Sequoia podcast): design *"the starships and Dyson spheres"* humans can't. [p-1.ai; Sequoia]

P-1 deliberately **maximizes anthropomorphism** so Archie "integrates into existing engineering teams" — he "shows up on Slack or Teams… you task him as you would a junior engineer." [p-1.ai; Sequoia]

### 2.2 The full automated workflow (end-to-end) — Archie's capability surface
Synthesized from BusinessWire, Fortune, IBM, Radical Ventures, and the Sequoia podcast. Archie does the **cognitive automation of a junior→college-grad mechanical/electrical engineer**:

1. **Distill requirements → key design drivers.** Parse a natural-language / spec brief into the dominant quantitative constraints (thrust, ΔT, power, weight, cost, envelope, redundancy). [BusinessWire]
2. **Postulate solution candidates** — architecture / topology selection ("developing product concepts and derivatives"). [p-1.ai; Radical]
3. **First-order sizing / first-order design trades** — pick the relevant phenomenology and size components (motor Kv, prop diameter, heat-exchanger area, pump head, duct sizing). [Sequoia; p-1.ai]
4. **Tool selection + setup** — *"selecting and utilizing the right engineering tools for detailed design"*; generate valid inputs, ingest outputs. Archie **calls** solvers/surrogates; it does NOT replace high-fidelity sim. *"We don't try to replace the tool… we just learn that they are there."* [Sequoia]
5. **Multiphysics reasoning across modalities** — thermal ↔ electrical ↔ structural ↔ fluid ↔ control, coupled, plus EMI/vibration. [Sequoia; arXiv]
6. **Design trades / Pareto exploration** — perf vs cost, weight vs strength. [Radical]
7. **Regulatory / standards compliance checks** — AHRI, ASME, UL, MIL-STD certifications. [arXiv 2505.10653 §metadata]
8. **Spatial / geometric reasoning** — positioning, packing, interference ("quantitative and spatial reasoning"). [BusinessWire; Sequoia]
9. **Collaborate / communicate** through a chat surface (Slack/Teams) — "hired" as an entry-level remote engineer. *Sell work, not software.* [Sequoia]

### 2.3 Go-to-market & deployment model
- **"Sell work, not software."** Archie is hired like a remote junior engineer via Slack/Teams; **no change to the customer's existing CAD/PLM/sim tools or process.** Minimizes organizational/integration friction (their stated reason to avoid being a tools vendor). [Sequoia]
- **First market: data-center cooling** (cooling + critical power systems), then automotive, aerospace & defense, building systems, heavy machinery/industrial. [p-1.ai]
- **First commercial capability: product customization / "specials"** — adapting an existing platform for a specific customer (data-center cooling "specials"; aerospace derivatives; airline-specific aircraft variants). High-value, *bounded/closed-world* design — the easiest win. [Sequoia]
- **Op-ed signal:** Fortune op-ed co-authored with **Daikin Applied** (HVAC OEM) — confirms a real data-center-cooling design partner. [p-1.ai links]

### 2.4 Learning loop (2 phases)
- **Phase 1 — non-proprietary synthetic data → "college-grad" / entry-level competency.** *"We train Archie on synthetic data to get him to kind of a college-grad level of engineer."* [Fortune]
- **Phase 2 — behind-the-firewall customer data** (PLM systems, real performance data, quality-escape history) → "entry level → average → expert engineer, fairly rapidly." Archie also "learns from human feedback and real-world data." [Fortune; Sequoia]

### 2.5 Scaling roadmap — "roughly one year per order of magnitude" [Sequoia]
| Vertical | Unique-part count | Timeline |
|---|---|---|
| Residential HVAC (toy demo) | ~100 | proof-of-concept (done; public demo) |
| **Data-center cooling** | **~1,000** | 2025 pilot |
| Industrial systems (material handling, robots, mills) | ~10,000 | Year 2 |
| Automotive / heavy machinery / mining / ag | ~100,000 | Year 3 |
| **Aerospace / defense** | **~1,000,000** | Year 3–4 |
| Starships / Dyson spheres | beyond | north star |

**Component-catalog requirement is 100–1000× the system part count** — a million-part aircraft needs a 100M–1B-part catalog of real-supply-chain components + hypothetical innovations to sample from. Catalogs are currently hand-built with AI automation in development. Eremenko flags **GPU/CPU scaling for million-part systems as a current infrastructure limit.** [Sequoia]

---

## 3. AI ARCHITECTURE & APPROACH (the most important technical section)

> Most detailed public source = the **Sequoia "Training Data" podcast with Eremenko** (verbatim architecture); reinforced by IBM, Radical, Fortune. This is the part we mirror in Archie's federated topology + corpus.

### 3.1 Federated multi-model architecture
Archie is **not a single LLM.** It is *"a federated assembly of models that are all orchestrated by an LLM reasoner that is also the interface to the user."* Components: [Sequoia; IBM; Radical]

| P-1 component | Role | What it actually is |
|---|---|---|
| **Orchestrator-reasoner LLM** | Central coordinator + the user/chat interface (Slack/Teams) | A normal instruction-following LLM that plans, routes to sub-models, and talks to the human |
| **"Lobotomized" LLM** | The multiphysics-representation engine | An LLM *"no longer good at English, but very good at doing programmatic … multiphysics representations of physical system designs and reasoning over those."* Trained on the structured design language, not prose |
| **Physics-based surrogate models** | Fast performance prediction | **Graph neural networks** mapping a design graph → performance space (thrust, ΔT, η, stress) — a learned, differentiable stand-in for the high-fidelity solver |
| **Geometric reasoners** | Positioning / packing / interference | Algorithmic + **VLM-based** spatial reasoning over geometry |

"They break engineering tasks into primitive operations and use a federated approach combining multiple AI models." Training uses **reinforcement learning and graph neural networks** to generate synthetic datasets, model design variations, and simulate physical-system behavior. [VentureRadar/Tracxn synthesis; Radical]

### 3.2 The three primitive operations (everything reduces to these) [Sequoia]
> *"The vast majority of things that design engineers do are reducible to a few primitive operations."*
1. **Design evaluation** — given a specific design, determine its performance. (forward analysis)
2. **Design synthesis** — given performance/requirements, generate a design that meets them. (inverse synthesis)
3. **Error infilling** — find and correct mistakes in a design. (diagnose + repair)

These three are the spine of both the architecture AND the eAGI eval taxonomy (§3.5). **Forge must expose all three as first-class kernel+model ops.**

### 3.3 Structured design representation ("on rails" for reliability)
Archie reasons over an **internal multi-physics representation of a product design that encompasses both geometry AND function** — not free-text. [Fortune; IBM] In real deployment this maps to **structured artifacts compatible with engineering tools: CAD, SysML, Modelica.** [arXiv 2505.10653] The eAGI paper's appendix demonstrates this concretely with **SysML** for an eVTOL: Requirements diagrams, Block Definition Diagrams (BDD = system architecture), Internal Block Diagrams (IBD = component interactions / ports/flows), and **Parametric diagrams** that carry the constraint equations (e.g., hover thrust = m·g; hover power from disk-loading theory × efficiency). The "lobotomized LLM" is the thing fluent in this representation. **Putting Archie on structured rails is their core reliability mechanism** — the model emits a constrained, checkable artifact, not prose.

### 3.4 Semi-synthetic, physics-based training-data pipeline (their core IP)
The headline problem: *"to answer that, your model has to be trained on millions of airplane designs … but there just haven't been millions of airplanes designed since the Wright brothers."* [Sequoia] Solution: [Sequoia; Fortune; IBM; Radical]
1. Build **virtual models of real-world components** (motors, pipes, shafts, heat exchangers, pumps) reflecting **real supply-chain items** (+ hypothetical innovations to keep designs realizable).
2. **Combine components in many configurations** → millions of candidate system designs.
3. **Validate each with a suite of multi-physics simulation tools** (the physics ground-truth labels).
4. **Train a model that *implicitly learns the underlying physics*** of the domain from this dataset — capable of quantitative + spatial reasoning. (RL + GNN surrogates.)
5. **Intelligent sampling:** dense around dominant/proven designs, sparse around "corners and edges" where innovations live.

This is "**semi-synthetic**" because component models are anchored to real catalogs; it sidesteps the training-data-scarcity problem **without proprietary customer data.** Catalog is 100–1000× the system size.

### 3.5 Evaluation framework — "Archie IQ" / eAGI 6-level taxonomy (arXiv 2505.10653)
P-1's eval grounds **Bloom's taxonomy in engineering design** along three complexity axes:
- **Directionality:** forward (evaluate performance) vs inverse (requirements → design).
- **Design behavior:** static properties vs dynamic/transient; steady-state vs time-varying; linear vs nonlinear.
- **Design scope:** closed-world (bounded space) vs semi-open vs fully-open-world.

**The six cognition levels:**
| Lvl | Name | Directionality / behavior / scope | What it tests |
|---|---|---|---|
| 1 | **Remember** | forward · static · closed | factual recall of equations & component properties |
| 2 | **Understand** | forward · static · closed | interpret structure + causal relationships |
| 3 | **Apply** | forward · static+dynamic · closed | apply principles using **external tools** to assess/manipulate a design |
| 4 | **Analyze** | forward + partial-inverse · static+dynamic | diagnose design issues + propose corrections (= error-infilling) |
| 5 | **Create** | forward+inverse · static+dynamic · semi-open | synthesize novel designs under constraints (= synthesis) |
| 6 | **Reflect** | bidirectional · fully-open | meta-cognitive critique; identify methodology limits ("EAGI") |

**Secondary (domain) taxonomy / metadata tags** used for targeted sampling:
- **System type:** eVTOL, HVAC, aerospace, energy systems, robotics.
- **Design scope:** component / subsystem / system level.
- **Domain:** thermal, electrical, control, structural, fluid/airflow.
- **Modeling requirements:** steady-state, transient, linear/nonlinear, multiphysics.
- **Applicable standards:** AHRI, ASME, UL, MIL-STD.

**Tiered scoring (the "pluggable evaluator"):**
- **Levels 1–3 — objective scoring:** symbolic math, lookup tables, domain simulators compute thrust/efficiency/etc. (deterministic correct/incorrect).
- **Levels 4–5 — simulation-augmented heuristics:** simulate the proposed fix/design; award **partial credit** by constraint satisfaction + proximity to a reference solution.
- **Level 6 — expert-in-the-loop / LLM-as-judge / Agent-as-judge:** nuanced trade-off & uncertainty judgments.

**Reusable semantic question templates** (instantiated with metadata): *"Given —, what happens if —"; "Design a system that meets — constraints"; "Explain why — fails under — conditions"; "Compare design A and B for performance under —."*

**"Archie IQ":** Eremenko (podcast) says these evals are administered to **entry-level, average, and expert human engineers AND to Archie**, side-by-side — Archie's "IQ" is its position on that human curve. The worked example throughout is **propeller–motor matching for an eVTOL** spanning all six levels (Lvl-1 thrust equation → Lvl-5 full propulsion-system design under payload/voltage/endurance constraints → Lvl-6 altitude/battery-chemistry-transfer reflection).

> The eAGI paper proposes a *framework*, not a published fixed benchmark dataset — they generate questions dynamically from templates × metadata. That is exactly how **Forge can self-generate its own eAGI gate from its kernel** (we have the simulators in-house).

### 3.6 Stated open problems / admitted gaps (= our opportunities)
- **No owned geometry kernel** — orchestrates third-party CAD; cannot score geometry-truth deterministically. *(Forge's moat.)*
- **No published fixed benchmark** — only a framework.
- **Catalog automation incomplete** — component catalogs are largely hand-built today.
- **GPU/CPU scaling** is the gating limit for million-part systems.
- **Cloud-only / data-egress** — Slack/Teams SaaS; customers must send work to P-1. *(Forge runs local/offline behind any firewall — our moat.)*
- **No fundamental research breakthrough required** (their words) — it is applied research combining existing techniques. → there is no secret sauce we cannot replicate; the differentiator is the kernel + local + corpus.

---

## 4. CAPABILITY → FORGE/ARCHIE MAPPING ("how we already do it / what's missing")

Legend: ✅ Forge already has it · 🟡 partially (bound-not-bridged / corpus-thin) · ⛔ must add.

| # | P-1 capability | How Forge+Archie achieves it today | Status | What must be ADDED |
|---|---|---|---|---|
| C1 | Requirements → key design drivers | Archie console prompt → CUA; corpus has spec/dimension Q&A (`bulk_synth_specs.py`) | 🟡 | **Requirements-parsing corpus**: brief → ranked quantitative drivers (thrust/ΔT/power/envelope/redundancy/cost), as a structured object Forge can consume. |
| C2 | Postulate architecture / concept candidates | Forge builds parametric bodies; Archie emits `forge.<wb>.<op>` calls | 🟡 | **Architecture-selection corpus** + a Forge "concept graph" representation (topology choice before geometry). |
| C3 | First-order sizing | Kernel has 45+ engineering calculators (AISC/ACI/Shigley/ASHRAE/IEC…); spec corpus | ✅/🟡 | Bridge sizing calculators as **callable Archie verbs returning numbers** + a sizing-trade corpus. |
| C4 | Tool selection + setup | Forge IS the integrated tool — no orchestration needed; ForgeRunner dispatches verbs | ✅ | **Tool-routing corpus**: "which Forge workbench/op for this sub-problem" (mirrors P-1's tool-selection, but inside one app). |
| C5 | Multiphysics reasoning (T/E/S/F/control coupled) | In-house FEA + CFD + MBD (HHT-α DAE) + thermal + modal + fatigue + buckling solvers; MIT-PhD-validated gates | ✅ | **Coupled/co-sim corpus** (thermal↔structural, electromagnetic↔thermal); add EMI + vibration verbs; turbulent CFD (only remaining solver gap). |
| C6 | Design trades / Pareto | SIMP topology-opt; parametric sweep infra | 🟡 | **Multi-objective trade corpus** + a Forge `forge.optimize.paretoExplore` verb wrapping the surrogate. |
| C7 | Standards / compliance checks (AHRI/ASME/UL/MIL-STD) | Some codebooks in calculators (AISC/ACI/TMS/NFPA/ASHRAE/IEC/IEEE) | 🟡 | **Compliance-check corpus + verbs** for AHRI/ASME/UL/MIL-STD with pass/fail + cited clause; GD&T already bound. |
| C8 | Spatial / packing / interference | Kernel has interference/collision; assembly context | 🟡 | **VLM geometric-reasoner** (Qwen2.5-VL already in fleet) trained on packing/interference; bridge `forge.assembly.interferenceCheck`. |
| C9 | Structured design representation (CAD+SysML+Modelica) | Owned BRep/STEP CAD ✅; **no SysML/Modelica** ⛔ | 🟡/⛔ | **Add MBSE layer**: SysML BDD/IBD/Requirements/Parametric emit + a Modelica-style acausal system model exporter; the "function" half of geometry+function. |
| C10 | The 3 primitive ops (evaluate / synthesize / error-infill) | Evaluate ✅ (kernel+solvers); synthesize 🟡 (parametric verbs); error-infill ⛔ | 🟡 | **Make all 3 first-class**: `forge.design.evaluate`, `forge.design.synthesize`, `forge.design.repairErrors`; error-infill corpus (defect→fix) is the big gap. |
| C11 | GNN physics surrogates | Solvers exist; no learned surrogate | ⛔ | **Train GNN surrogates** on Forge-generated (geometry+sim-label) data → fast differentiable performance prediction; powers C6. |
| C12 | Semi-synthetic physics-validated data pipeline | `bulk_synth*.py`; ForgeCADScore; owned kernel CAN generate AND label | 🟡 | **Component-catalog + config-combinator + auto-sim-label pipeline** — we do it BETTER (deterministic, owned, offline). |
| C13 | eAGI 6-level / "Archie IQ" eval | CADGenBench + ForgeCADScore (geometry truth) | 🟡 | **Implement the 6-level eAGI gate internally**, generated from kernel simulators (templates × metadata); report Archie-vs-human-engineer curve. |
| C14 | Federated multi-model topology | Single 14B + per-discipline LoRAs + Qwen2.5-VL | 🟡 | **Adopt the federation explicitly**: orchestrator-LLM (14B) + "lobotomized" structured-rep LLM (LoRA on the Forge tool-DSL) + GNN surrogate + VLM geometric reasoner. |
| C15 | Slack/Teams remote-employee UX | Forge console + floating Archie chat overlay | ✅ | (We intentionally diverge: in-app console, local/offline — a feature, not a gap.) |
| C16 | Domain coverage (eVTOL/HVAC/aero/energy/robotics) | Forge flagships (GE9X, turbofan, gearbox, turbopump) + discipline workbenches | 🟡 | **Add HVAC/data-center-cooling + eVTOL propulsion** flagships to corpus + builders (their beachhead = our easy proof). |

---

## 5. WHAT TO ADD so "P-1 tech is easy-peasy for Forge" — NUMBERED REQUIREMENTS

These are the concrete additions to **Archie's 14B foundational scope** + **the Mission Bible**. Each maps to a Forge kernel/model area and a rough LOC band.

### A. The three primitive operations as first-class kernel+model verbs *(spine; ~600–900 LOC kernel + corpus)*
- **A1** `forge.design.evaluate(design) → performance{}` — wraps existing solvers; returns the scalar/field perf vector. *(mostly wiring; solvers exist)*
- **A2** `forge.design.synthesize(requirements{}, catalog) → design` — inverse: pick architecture + size components to meet constraints. *(new; calls A1 in a loop / surrogate)*
- **A3** `forge.design.repairErrors(design) → {issues[], fixedDesign}` — **error-infilling** (the largest gap). Detect invalid/under-performing features, propose+apply fixes. Corpus = defect→fix pairs (extends the existing `modeling-defect` adapter).

### B. Structured design representation — the MBSE/function layer *(~1,500–2,500 LOC; biggest net-new module)*
- **B1** SysML emit/parse: **Requirements diagram, BDD, IBD, Parametric diagram** as a `forge::sysml` module + Archie verbs (`forge.mbse.*`). Geometry already owned — this adds the **function** half so Archie reasons over "geometry AND function" like P-1.
- **B2** A **Modelica-style acausal system model** (or our own lumped-parameter network: thermal-resistance/fluid/electrical nets) exporter+solver for first-order multiphysics — the "lobotomized LLM" target representation.
- **B3** Make this the **"on-rails" output contract**: Archie emits the structured artifact (validated by the kernel) → then geometry. Reliability-by-construction.

### C. Federated model topology — match (and localize) their architecture *(corpus + LoRA training; no new kernel)*
- **C1 Orchestrator-LLM** = the 14B (already the console interface).
- **C2 "Lobotomized" structured-rep LLM** = a LoRA fine-tuned hard on the Forge tool-DSL + SysML/Modelica artifacts (de-emphasize prose, maximize valid structured emission). **Train this.**
- **C3 GNN physics surrogate** = train on Forge-generated (graph, sim-label) pairs → fast differentiable perf prediction; feeds Pareto/trades.
- **C4 VLM geometric reasoner** = Qwen2.5-VL (already in fleet) LoRA'd on packing/interference/positioning from rendered Forge scenes.

### D. Semi-synthetic, physics-validated data engine — do it BETTER with the owned kernel *(~800–1,200 LOC pipeline; storage-bounded per memory rules)*
- **D1 Component catalog** — real-supply-chain parametric components (motors, HX, pumps, ducts, fasteners, bearings, valves) as Forge parametric families; 100–1000× target system size.
- **D2 Configuration combinator** — assemble catalog parts into millions of valid system configs (constraint-guided).
- **D3 Auto-sim-labeler** — run Forge's in-house solvers on each config → physics-truth labels. **This is the advantage: we own both the generator and the labeler, deterministic + offline.** Strict download→process→delete cadence (memory rule).
- **D4 Intelligent sampler** — dense around dominant designs, sparse at edges (their stated heuristic).

### E. The eAGI / "Archie IQ" internal gate — generate it from our kernel *(~700–1,000 LOC eval harness)*
- **E1** Implement the **6-level taxonomy** (Remember→Reflect) × **secondary metadata** (system-type/scope/domain/modeling-req/standard) as a question generator using the **4 semantic templates**.
- **E2** Tiered scorer: L1–3 objective (kernel/symbolic), L4–5 sim-augmented partial credit, L6 LLM/Agent-as-judge. Reuse ForgeCADScore for geometry truth.
- **E3** Report **Archie-vs-human-engineer** curve (entry/avg/expert) — the headline metric to publish against P-1. This **complements** CADGenBench ≥0.85 (which stays the north-star geometry gate).

### F. Domain corpora + flagships to match P-1's beachhead *(corpus via bulk_synth; builders per flagship)*
- **F1 HVAC / data-center cooling** (their #1 market): cooling loops, CRAH/CDU, critical power, AHRI/ASHRAE compliance. Make it a Forge flagship — proves we beat them on *their own* first vertical.
- **F2 eVTOL propulsion (prop–motor matching)** — their canonical eAGI worked example; replicate all six levels in Forge to demonstrate parity directly against the paper.
- **F3** Keep existing flagships (GE9X ~20k parts, turbofan, gearbox, turbopump) as the aerospace/million-part trajectory.

### G. Multiphysics / dynamic completeness (bible mandate: dynamic-only) *(targeted solver work)*
- **G1** Add **coupled co-simulation** (thermal↔structural, EM↔thermal) verbs.
- **G2** Add **EMI + vibration** phenomenology (P-1 explicitly lists these).
- **G3** Close the **turbulent CFD** gap (the one remaining physics-gate weakness per `forge-physics-rigor-met`).

### H. Strategic / moat hardening *(doctrine, not code)*
- **H1** Every demo leads with **local/offline + owned-kernel + deterministic geometry-truth** — the three things P-1 structurally lacks.
- **H2** Frame Forge as **"P-1's eAGI thesis, but with the kernel they chose not to build + runs behind your firewall."**
- **H3** Hedge Prometheus on **integration + locality**, never capital (see `prometheus.md`).

---

## 6. WHAT TO ADD TO THE BIBLE (precise edits)

1. **§0.3 (strategic moat)** — already names P-1; **append** the federated-topology spec (C1–C4) as the explicit Archie architecture target, and the eAGI 6-level gate (E) as a *second* north-star eval alongside CADGenBench ≥0.85.
2. **New §11 "eAGI capability surface (P-1 parity+)"** — embed the 3 primitive ops (A), the MBSE/function layer (B), and the 6-level taxonomy table as a normative checklist Forge must clear.
3. **Kernel plan (§1)** — add a batch **"B-MBSE: SysML+acausal system model"** (B above) and **"B-SURROGATE: GNN perf model + auto-sim-labeler"** (C3+D) to the phased acceptance-gated batches.
4. **Archie corpus program** — add corpora: requirements-parsing (C1/A), tool-routing (C4), error-infilling (A3), compliance (C7), multi-objective trades (C6), HVAC/data-center-cooling + eVTOL prop-motor (F1/F2).
5. **Doctrine line** — "Forge = P-1's eAGI thesis executed *with* the owned kernel P-1 declined to build, *locally/offline*." (H2.)

---

## 7. SOURCES
- **p-1.ai** (homepage, team, investors, links, careers) — mission, "Archie," anthropomorphism, data-center-cooling focus, Daikin op-ed.
- **arXiv 2505.10653** — *On the Evaluation of Engineering Artificial General Intelligence* (Neema, Jha, Nagel, Lew, Sureshkumar, Gordić, Shimmin, Nguyen, Eremenko; 2025-05-15). eAGI definition, 6-level taxonomy, secondary metadata, tiered pluggable scorer, semantic templates, SysML/CAD/Modelica artifacts, eVTOL prop–motor example.
- **Sequoia Capital "Training Data" podcast — Paul Eremenko** (sequoiacap.com/podcast/training-data-paul-eremenko) — federated architecture, "lobotomized LLM," orchestrator-reasoner, GNN surrogates, VLM geometric reasoners, 3 primitive ops, synthetic-data pipeline + sampling, scaling roadmap (1 OOM/yr; ~100→~1M parts), 100–1000× catalog, "Archie IQ," GPU scaling limit, "sell work not software," "starships and Dyson spheres."
- **Fortune** (startup-ai-funding-starship-google-deepmind-airbus-veterans) — $23M seed, founders, "college-grad via synthetic data," human-feedback phase-2, data-center cooling first.
- **IBM Think** (physical-ai-age-p-1-engineering-brain) — multi-model architecture, "automates the reasoning that connects existing tools," geometry+function representation, primitive operations.
- **Radical Ventures** (portfolio + thesis essay) — "multi-physics reasoning + spatial intelligence + synthetic datasets," training-data-scarcity solution, cognitive-automation positioning, market expansion path.
- **BusinessWire** (de-stealth release, 2025-04-25) — capability list, investors, target industries.
- **AI Insider / Pulse2 / Lerer Hippeau / VentureRadar / Tracxn** — funding/investor confirmation, RL+GNN synthetic-data synthesis.
- **arXiv 2509.16204 (EngDesign, NeurIPS 2025 D&B)** — *not* P-1, but the simulation-based engineering-design LLM benchmark in the same space; useful external eAGI yardstick.
