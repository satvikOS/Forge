# Project Prometheus — Deep Dive & Mapping into Archie/Forge Scope

**Research date:** 2026-06-21
**Author:** ArchDisc research agent
**Purpose:** Capture the full scope of Jeff Bezos' "Project Prometheus" (the engineering/hardware AI company), then translate its *entire* program into concrete, numbered requirements for **Archie** (the local 14B engineering model) and **Forge** (the in-house CAD/CAM/CAE kernel + app) so that "the entire Project Prometheus is inside Archie's scope."

---

## 0. Disambiguation — which "Prometheus" this is

There are several unrelated things named "Prometheus." The one relevant to AI-for-engineering / hardware design is:

- **Prometheus (the Bezos AI company)** — founded **November 2025** by **Jeff Bezos** and **Vik Bajaj** (chemist/physicist, ex-Google X, co-founder of Verily and Foresite Labs), both co-CEOs. Building an **"artificial general engineer" (AGE)** — AI that designs and helps manufacture physical objects. THIS is our target.

Other "Prometheus" projects, explicitly NOT our subject (one line each):
- **Prometheus monitoring** (CNCF time-series metrics/alerting toolkit) — DevOps, unrelated.
- **NASA Project Prometheus** (2003 nuclear-electric spacecraft propulsion program, cancelled 2005) — historical, unrelated.
- **Meta/Google internal "Prometheus" LLM/datacenter codenames** — unrelated to engineering AI.
- **HBO *Prometheus* / Ridley Scott film** — fiction, unrelated.

Everything below concerns the Bezos AGE company only.

---

## 1. Company facts & funding (context)

| Item | Detail |
|---|---|
| Founded | November 2025 |
| Co-CEOs | Jeff Bezos, Vik Bajaj |
| Board | David Limp (Blue Origin CEO) |
| Employees | ~100–120 (Dec 2025), recruited from OpenAI, Google DeepMind, Meta, Anthropic |
| Offices | San Francisco (HQ), London, Zurich |
| Funding | Nov 2025: $6.2B launch → Apr/May 2026: +$10B (~$38B val) → Jun 2026: +$12B ($41B val). Cumulative ~$18–22B raised. |
| Future | Discussing a separate ~$100B fund/holding-co to *acquire* legacy manufacturing firms and deploy Prometheus tools operationally (vertical integration, not pure software). |
| Acquisition | **General Agents** (Nov 2025) — agentic desktop AI "Ace" running custom VLA foundation models `ace-control-small` / `ace-control-medium`. |
| Status | Stealth, no public website, no customers/benchmarks/API disclosed as of mid-2026. Bezos: "premature" to disclose; "many years of grinding ahead." |

**Why this matters to ArchDisc:** Prometheus is the *exact* category competitor to the Archie+Forge thesis (a foundation model that drives a modern CAD/CAE system to design real hardware). Their public framing — "a very, very modern version of CAD" — is almost word-for-word our north star. Their moats (compute, capital, talent) are enormous; ArchDisc's counter is **runs-local (14B on an M4 Max), real BRep kernel today, verifiable geometry-truth scoring (ForgeCADScore/CADGenBench)**, none of which Prometheus has publicly shown.

---

## 2. Mission & paradigm

- **Artificial General Engineer (AGE):** automate the *entire* engineering lifecycle (concept → analyzed → producible part/assembly), not generate text/images. Bezos: *"All societal wealth is driven by invention… offer a set of tools that dramatically accelerates that invention loop."*
- **Engineered Intelligence / Physical Intelligence:** shift from *digital-convenience AI* (chatbots) to *AI built for physical reality* — gravity, motion, cause-and-effect, materials, manufacturing constraints, multi-physics.
- **Engineering-as-optimization:** treat design as a constrained optimization/search problem over a physically-grounded world model, rather than a labor-intensive human draw→render→adjust loop.
- **AI as a horizontal enabling layer** (Bezos analogy: electricity/computing) applied to the physical economy.
- Scope deliberately exceeds "CAD": *"work that requires a thousand human minds creatively working together"* — i.e., full multidisciplinary system design.

---

## 3. Technical pillars (as publicly described)

### Pillar A — World Models (physical simulation core)
AI systems that **perceive and simulate how the physical world behaves**, producing *dynamic, 3-D representations* of environments and predicting how actions/decisions play out. Examples cited: reconstruct airflow around a wing; predict component failure *before* manufacturing; reason about gravity/motion/cause-effect. The stated hard problem: *"move beyond the probabilistic limitations of current neural nets to incorporate rigorous physical laws."*

### Pillar B — Multimodal, physics-grounded training data
Training data extends far beyond scraped text/code to include:
- **CAD geometries** (parametric + BRep)
- **Simulation outputs** (FEA/CFD/thermal/multi-physics fields)
- **Sensor telemetry** from real manufacturing
- **Robotics trajectories** (to learn physical dynamics, not to build robots)
- **Experimental results** from chemistry, biology, materials science
- **"Outcome-of-decision" data:** what happens when you *pick a particular alloy, tighten a tolerance, or change a joint's geometry*. This is the key differentiator — models trained on the *consequences* of engineering choices.
- "Very compute-intensive" because these specialized datasets must largely be *generated* (synthetic + real experimental).

### Pillar C — Foundation-model "modern CAD" core
A generative successor to **SOLIDWORKS / Siemens NX / Autodesk Fusion**, rebuilt around a foundation-model core. Instead of draw→render→adjust, the system *reasons about intent* ("understands what you probably need"), predicts stress/cost/tooling-feasibility, and produces producible designs. Target customer: mechanical/aerospace/process engineers inside Fortune-500 industrial firms.

### Pillar D — Agentic VLA control (from General Agents / Ace)
Video-Language-Action models (`ace-control-small/medium`) that interpret on-screen visual inputs and execute natural-language commands by **controlling a computer/desktop** (editing video, moving data between apps, booking, etc.; claims to beat OpenAI Operator on some tasks). VLA = the same architecture family used to control robots. **This is computer-use (CUA) at the core of Prometheus** — directly parallel to ArchDisc's governing principle that *Archie drives Forge purely via CUA.*

### Pillar E — Robotics-driven physical experimentation
Large-scale, robot-run scientific trials (à la Periodic Labs) to generate real-world experimental data feeding the world models; edge/embedded deployment, hardware-software co-integration. Blue Origin (rocket-engine design) is an obvious internal proving ground (David Limp on board).

### Pillar F — Vertical integration of manufacturing
The $100B fund to acquire and operate manufacturers, so the AGE is deployed end-to-end (design → tooling → production), with framing around "sovereign control over the material basis of national security" and dual-use/critical-infrastructure applications.

---

## 4. Target domains (full breadth)

Aerospace (jet/rocket engines, airframes, spacecraft) · Automotive (systems, pre-production engineering, assembly) · Semiconductors / chip fabrication · Advanced/computing hardware · Drug & molecule design (physical-chemistry-constrained) · Materials science · Manufacturing & tooling · Supply-chain / warehouse / logistics automation · Robotics.

---

## 5. Roadmap (observed + implied)

1. **2025 Q4** — Launch ($6.2B); acquire General Agents (VLA/CUA core); recruit ~120 researchers.
2. **2026 H1** — Scale capital (+$22B); build compute; *generate* specialized physics datasets; build foundation-model "modern CAD" core; no public product yet.
3. **2026+** — Sell engineering-simulation & design software tools to industrial firms first.
4. **Strategic** — Raise ~$100B holding-co; acquire & operationally transform manufacturers (design→production owned).
5. **Long horizon** — Full AGE: end-to-end multidisciplinary, multi-physics, manufacturable design with closed-loop real-world experimental feedback. Bezos: "many years of grinding."

---

## 6. Mapping Prometheus' ENTIRE scope into Archie + Forge requirements

Goal: everything Prometheus aspires to must be *expressible inside Archie's scope* and *executable by Forge*. Below, each requirement is numbered and tagged **[Archie]** (model capability/training), **[Forge]** (kernel/app capability), or **[Both]**. North-star gate throughout: **Archie-drives-Forge ≥ 0.85 on CADGenBench across every dimension** (no lite versions, dynamic features only, verified by headed Playwright e2e).

### 6.1 World-model / physics core (Pillar A)
1. **[Forge]** Ship a real, validated **multi-physics solver suite** as first-class kernel ops, each with analytical-gate verification: linear/nonlinear **static FEA** (Wilson-Q6 de-locking, target ≤0.5% vs analytical), **modal** (≤0.2%), **transient/dynamic FEA**, **buckling**, **fatigue** (S-N/ε-N, Miner), **thermal/thermo-mechanical**, **CFD** (incompressible channel verified; close turbulent-CFD gap, the one acknowledged hole), **multibody dynamics** (HHT-α DAE solver, pendulum ≤0.016%), **acoustics/vibration**. Expose as `forge.simulate.{staticFEA,modal,transient,buckling,fatigue,thermal,cfd,multibodyDynamics,acoustics}`. *Dynamic features only — no static-only stubs.*
2. **[Forge]** **Predict-failure-before-manufacture**: a `forge.simulate.failurePredict` op returning factor-of-safety fields, hot-spots, first-failure mode, and a pass/fail verdict against a named standard (AISC/ASME/Eurocode), so Archie can reject a design pre-build (mirrors Prometheus' "predict component failure before manufacturing").
3. **[Forge]** **Airflow/field reconstruction** to viewport: streamlines, pressure/temperature/stress field overlays as renderable meshes (the "airflow around a wing" demo). Bind to multi-cam headed e2e (≥5 angles).
4. **[Archie]** Train Archie to **reason about physical cause-effect**: corpora teaching gravity/motion/load-paths/stiffness/heat-flow so the model can predict *qualitatively* before calling the solver, then *verify* with the Forge solver (reason→simulate→check loop).

### 6.2 Outcome-of-decision data (Pillar B — the key differentiator)
5. **[Both]** Build an **"engineering-decision-outcome" corpus**: paired (design-change → simulated/measured outcome) samples — e.g., *swap Al-6061→Ti-6Al-4V* → mass/stiffness/cost/thermal deltas; *tighten tolerance 0.1→0.02mm* → fit/cost/yield deltas; *fillet R2→R5 at a joint* → peak-stress delta. Generate at scale via `scripts/bulk_synth*.py` by *running Forge solvers* over parametric sweeps (this is the synthetic data engine Prometheus says it must build, but ArchDisc can ground it in the real kernel).
6. **[Both]** **Material/process knowledge base**: a queryable material DB (alloys, polymers, composites — E, ν, ρ, yield/UTS, fatigue, CTE, k, cost, machinability, weldability) plus process constraints (machining/casting/injection/AM/sheet-metal). Archie trained on it; Forge exposes `forge.material.*` and DFM checkers.
7. **[Archie]** Train on **multimodal triples** (text spec + engineering drawing/image + 3-D/BRep), per the assembly-context+multimodal memory: geometry-gen and GD&T need full assembly context, not isolated parts. Use the Qwen2.5-VL pipeline (eager-RoPE fix) for the vision branch.
8. **[Both]** **Storage-safe synthetic-data factory**: strict download→process→delete one-at-a-time, parquet `iter_batches`, accumulator-dedup (per Models streaming-storage rules) so the M4 Max isn't killed while generating the outcome corpus at 14B scale.

### 6.3 Modern-CAD foundation core (Pillar C)
9. **[Forge]** Achieve **1:1 BRep kernel parity** with Parasolid + ACIS: full NURBS curves/surfaces, Boolean (union/subtract/intersect), fillet/chamfer (constant + variable radius), shell/offset/thicken, draft, sweep/loft/blend, sheet-metal (bend/unfold/flat-pattern), pattern/mirror, healing/repair, tolerant modeling, STEP/IGES/Parasolid I/O. Preflight `grep forge::<topic>` to avoid the ~50% duplicate-pick rate.
10. **[Archie]** Train Archie to **emit producible parametric CAD tool-calls** (not straight-primitive blockouts): bridge the full parametric verb set (extrude/revolve/sweep/loft/fillet/pattern/shell/draft/boolean/sketch-constraints) so the model designs like an engineer. Fix the 3-layer bridge/brain/defect severance identified in the CAD-fidelity program.
11. **[Both]** **Intent-reasoning over draw-loop**: Archie should infer unstated requirements ("understands what you probably need") — default tolerances, standard fasteners/parts, load cases — from a terse prompt, then justify them. Forge supplies a **standard-parts library** (ISO/ANSI fasteners, bearings, profiles) so inferred components resolve to real geometry.
12. **[Both]** **Parametric + feature-tree + history** with regeneration, so Archie can *edit* designs by changing parameters/features, matching SOLIDWORKS/NX/Fusion editability.

### 6.4 Agentic VLA / computer-use core (Pillar D) — directly ArchDisc's governing principle
13. **[Archie]** Lock in **genuine CUA**: Archie reads the Forge screen/state and drives it via tool-calls/console exactly like a human (NOT `window.__forge*` composer shortcuts). This is the literal analogue of Ace's VLA computer-control; it is ArchDisc's MUST rule and must hold under varied prompts.
14. **[Both]** **Console-CUA grounding**: maintain the proven Stage-A 100% op-selection (capstack fold + subtractive few-shot/handle-verb rule); extend to Stage B (multi-step assemblies) with the shared-ctx context-verb dispatch so parts built in-kernel actually reach the viewport.
15. **[Archie]** Optionally add a **vision-action branch** (VLA-style) so Archie can act from rendered viewport pixels + drawings, not just text state — closing the gap to `ace-control` while staying local.

### 6.5 Robotics-driven / closed-loop experimentation (Pillar E)
16. **[Both]** **Closed-loop design optimization**: Archie proposes → Forge simulates → score → Archie revises (SIMP/topology optimization, parametric DOE, gradient/CMA-ES search). Expose `forge.optimize.{topology,parametricDOE,shape}`; treat engineering as optimization (Prometheus' framing) but grounded in the verified kernel.
17. **[Forge]** **Generative/topology design** (SIMP density method, lattice/infill, PicoGK-style implicit fields via the unified kernel) so Archie can request mass-minimized, load-bearing structures — the "invention loop" accelerator.
18. **[Both]** Treat **physics-verification as the reward signal** (ForgeCADScore / geometry-truth + analytical-gate pass) — ArchDisc's substitute for Prometheus' real-world experimental feedback, since we can't run robot labs but *can* run a validated kernel.

### 6.6 Domain breadth (Section 4) — Archie must cover all of it
19. **[Archie]** **Aerospace corpus**: airfoils/wings, jet & rocket engines (the GE9X ~20k-component flagship; turbofan; turbopump; gearbox), spacecraft structures, propulsion, aero loads, thermal. Trained on full flagship specs (components/dimensions/spatial/PBR/environments) per the train-projects-exhaustive-CUA directive.
20. **[Archie]** **Automotive corpus**: chassis, powertrain, suspension, BIW/assembly, crash/NVH basics.
21. **[Archie]** **Mechanical/structural corpus**: AISC/ACI/TMS/Eurocode/Shigley calculators (already ~45 in Forge) + GD&T per ASME Y14.5 / ISO GPS (PMI, FCFs, datums, tolerance stack-up).
22. **[Both]** **Semiconductor/computing-hardware** packaging/board-level mechanical+thermal (the chip-fab domain) — at least mechanical/thermal scope; flag full litho/process as out-of-scope for a CAD kernel.
23. **[Archie]** **Materials/chemistry/drug-design** awareness — at minimum a materials-science knowledge layer; mark molecular/biology design as *adjacent, lower-priority* (honest scoping; not a CAD-kernel core competency).
24. **[Both]** **Manufacturing/CAM + DFM/tooling**: toolpaths (2.5/3/5-axis mill, turn, AM slicing), tooling feasibility, cost & cycle-time estimation, DFM/DFA checks — so designs are *producible*, matching Prometheus' "manufacturing constraints/tooling feasibility."

### 6.7 Multidisciplinary "thousand minds" system design
25. **[Both]** **Full assembly + system context**: mates/joints, kinematics, interference/clearance, BOM, mass properties, PMI/GD&T at assembly level. Archie must design *in context*, not isolated parts (per the assembly-context memory).
26. **[Both]** **Multi-physics co-design**: couple structural+thermal+fluid+modal in one workflow so Archie can trade across disciplines like a multidisciplinary team.
27. **[Both]** **Standards-aware verification**: every Archie deliverable cites and is checked against the governing standard/code (ASME/ISO/AISC/Eurocode/IEC/IEEE/NFPA/ASHRAE), with a machine-checkable verdict.

### 6.8 Product, UX & verification (to be enterprise/Prometheus-grade)
28. **[Forge]** **CATIA/NX-grade enterprise UI/UX**: ribbon tabs + sidebars + right-click + top/sub-menus (no flat 30-item list); workbenches strategically placed; CAE/CAM/CAD/PDM surfaces.
29. **[Both]** **PDM/data-management** (JSON-vault PDM, versioning, glTF/STEP/DXF/SVG/PDF export via inline writers — no external deps) for enterprise workflows.
30. **[Both]** **Verification discipline**: every capability proven by **headed Playwright e2e** on the real app+kernel+model, ≥5 named camera angles, *varied/distinct prompts each run* (no cherry-picking), reference-video fidelity; re-run on any doubt. Monitor CI; advance only on green.
31. **[Both]** **Geometry-truth benchmark gate**: CADGenBench (Mecado + Hugging Face) ≥ 0.85 on **every** dimension via ForgeCADScore (replay 1.0 vs corrupt 0.456 already demonstrated) — the explicit moat over Prometheus, who has shown no benchmarks.

### 6.9 Strategic / positioning (Pillar F)
32. **[Both]** **Local-first moat**: everything above must run on a 14B model on a 36GB M4 Max — Prometheus' answer is $100B of compute; ArchDisc's is efficiency + a real verified kernel. Keep `serve` fresh (it degrades over a session) before any live CUA demo.
33. **[Both]** **Honest dual-use/critical-infra framing** in deck/landing: sell only codebase-evidenced moats (real BRep, multi-physics gates, geometry-truth scoring, runs-local); no fabricated benchmarks; lead investor demos with Forge (already real BRep) per the coherence/accuracy/investor rule.

---

## 7. One-paragraph synthesis

Prometheus = a foundation-model **"artificial general engineer"** built on **world models** (rigorous physics, not just text), trained on **outcome-of-engineering-decision multimodal data** (CAD + simulation + sensor + experiment), wrapped in a **modern generative successor to SOLIDWORKS/NX/Fusion**, driven by an **agentic VLA/computer-use core** (Ace / `ace-control`), fed by **robot-run physical experimentation**, and ultimately **vertically integrated into owned manufacturing**. ArchDisc's Archie+Forge is the *same thesis at 14B-local scale*: the requirements above (33, numbered) put Prometheus' entire public scope inside Archie's reach — with ArchDisc's distinct, defensible edge being a **real validated geometry kernel + geometry-truth benchmark (≥0.85 on every CADGenBench dimension)**, which Prometheus has not publicly demonstrated.

---

## 8. Sources

- Wikipedia — Prometheus (company): https://en.wikipedia.org/wiki/Project_Prometheus_(company)
- BuiltIn — Inside Project Prometheus: https://builtin.com/articles/what-is-project-prometheus
- VKTR — Inside Project Prometheus: https://www.vktr.com/ai-market/inside-project-prometheus/
- IEN — Project Prometheus & the shift to Engineered Intelligence: https://www.ien.com/artificial-intelligence/blog/22959167/project-prometheus-and-the-coming-shift-from-artificial-intelligence-to-engineered-intelligence
- Foreign Affairs Forum — The Emergence of Prometheus: A Paradigm Shift in Physical Intelligence: https://www.faf.ae/home/2026/6/11/the-emergence-of-prometheus-a-paradigm-shift-in-physical-intelligence
- ChatForest — "The CAD of the Future": https://chatforest.com/reviews/jeff-bezos-project-prometheus-artificial-general-engineer-manufacturing-ai-2026/
- SiliconANGLE — Prometheus acquires General Agents (Ace / ace-control / VLA): https://siliconangle.com/2025/11/26/jeff-bezos-project-prometheus-reportedly-acquires-ai-startup-general-agents/
- New Space Economy — AGE for engineering/manufacturing/space: https://newspaceeconomy.ca/2026/06/14/jeff-bezos-prometheus-the-ai-startup-building-an-artificial-general-engineer-to-accelerate-engineering-manufacturing-and-space-innovation/
- TechFundingNews — $6.2B manufacturing & aerospace: https://techfundingnews.com/jeff-bezos-ai-startup-project-prometheus-ceo-return-manufacturing-aerospace/
- eWEEK — Jeff Bezos unveils AI startup: https://www.eweek.com/news/jeff-bezos-ai-startup/
