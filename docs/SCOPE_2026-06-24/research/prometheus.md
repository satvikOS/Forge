# Project Prometheus — Full Scope, Folded Into Archie's 14B Scope + the Bible

**Research date:** 2026-06-24
**Author:** ArchDisc research agent
**Supersedes/extends:** `docs/SCOPE_2026-06-21/research/prometheus.md` (this doc re-grounds against the **2026-06-11 $12B / $41B Series B** and the **Bezos+Bajaj on-record interviews** — the first time the founders described the product themselves — and folds the *entire* program into Archie's 14B scope and the Mission Bible).
**Purpose:** (1) Disambiguate "Project Prometheus" via primary sources; (2) capture its full public scope, grounded and cited; (3) translate the *entire* program into explicit, numbered Archie-14B + Forge requirements; (4) state exactly which capabilities Prometheus implies for Archie and mark what is already in scope vs newly added by this fold.

---

## 0. Disambiguation — which "Prometheus"

The one relevant to AI-for-engineering / hardware design:

- **Prometheus (the Bezos company)** — launched **November 2025** by **Jeff Bezos** and **Vik Bajaj** (physicist/chemist; ex-Google X, co-founder of Verily and GRAIL, founder of Foresite Labs), both **co-CEOs**. Building an **"artificial general engineer" (AGE)** — a foundation model that designs (and helps manufacture) complex physical objects. Bezos's own words: *"a very, very modern version of CAD"* and *"We have nothing to do with robotics."* THIS is the target. [GeekWire, CNBC, TechCrunch]

Explicitly NOT the subject (one line each):
- **Prometheus monitoring** (CNCF time-series metrics/alerting) — DevOps, unrelated.
- **NASA Project Prometheus** (2003 nuclear-electric spacecraft propulsion, cancelled 2005) — historical, unrelated.
- Internal datacenter/LLM "Prometheus" codenames — unrelated.
- *Prometheus* (Ridley Scott film) — fiction, unrelated.

Everything below concerns the Bezos AGE company only.

---

## 1. Company facts & funding (June-2026 grounded)

| Item | Detail | Source |
|---|---|---|
| Founded | November 2025 (development since late 2024) | TechCrunch, New Space Economy |
| Co-CEOs | Jeff Bezos, Vik Bajaj | CNBC, GeekWire |
| Board | David Limp (Blue Origin CEO) | VKTR |
| Employees | ~120–150, across SF (HQ), London, Zurich; recruited from **OpenAI, Google DeepMind, Meta, Nvidia, Microsoft** | TechCrunch, CNBC, New Atlas |
| Series A | ~**$6.2B** (Nov 2025, primarily Bezos) | Crunchbase, eMarketer |
| Interim | +$10B → **~$38B valuation** (May 2026) | VKTR, GeekWire |
| **Series B** | **$12B at a $41B valuation (announced 2026-06-11)**; investors: **JPMorgan Chase, Goldman Sachs, BlackRock, DST Global, Arch Venture Partners** | **TechCrunch, CNBC** |
| Total raised | **~$18.2B** cumulative | New Space Economy |
| Future fund | In talks for a separate **~$100B** "manufacturing transformation vehicle" to **acquire and operationally rebuild** legacy manufacturers (vertical integration, not pure software) | AI Magazine, MattHopkins, Capacity |
| Acquisition | **General Agents** (Nov 2025) — agentic desktop AI **"Ace"** on custom **VLA (video-language-action)** foundation models `ace-control-small` / `ace-control-medium` | SiliconANGLE, ChatForest |
| Compute | "Very compute-intensive"; sources from multiple hyperscalers incl. AWS; expects to be a major customer | New Space Economy, CNBC |
| Status | Stealth, **no public website**, no product/benchmark/API/customer disclosed. Bezos: *"We're not being secretive… We're just being heads down and trying to do the work"*; progress *"really quite remarkable"*; disclosure *"premature."* | CNBC, GeekWire |

**Why this matters to ArchDisc:** Prometheus is the *exact category competitor* to the Archie+Forge thesis — a foundation model that drives a modern CAD/CAE system to design real hardware. Bezos's framing ("a very, very modern version of CAD") is almost word-for-word the ArchDisc north star. Their moats are capital/compute/talent. ArchDisc's counter (per Bible §0.3) is: **runs-local (14B on a 36 GB M4 Max), an owned real BRep/CAE kernel, and verifiable geometry-truth scoring (ForgeCADScore / CADGenBench ≥0.85 every dim)** — none of which Prometheus has publicly demonstrated.

---

## 2. Mission & paradigm (grounded quotes)

- **Artificial General Engineer (AGE):** automate the engineering *intellect* — design and conceptualization — for complex physical systems, end to end (concept → analyzed → producible). Not robots, not chatbots. Bezos: *"All societal wealth is driven by invention… What Prometheus seeks to do is offer a set of tools that dramatically accelerates that invention loop."* [New Space Economy]
- **"A very, very modern version of CAD"** — Bezos's own description, while noting he is *"really oversimplifying."* A generative, physics-reasoning successor to SOLIDWORKS / Siemens NX / Autodesk Fusion. [GeekWire, ChatForest]
- **"Nothing to do with robotics"** — Bezos's direct correction. Robotics data is used *as training signal* for physical dynamics, **not** as a product. The product is a **design tool for engineers**. [GeekWire, eciks]
- **Engineered / Physical Intelligence:** shift AI from *digital-convenience* (chatbots) to *physical reality* — gravity, motion, cause-and-effect, materials, multi-physics, manufacturing constraints. [IEN, FAF]
- **"A thousand human minds creatively working together":** the scope deliberately exceeds single-part CAD — full multidisciplinary, multi-physics system design. [New Space Economy]
- **Labor philosophy:** Bezos frames automation as creating *"labor scarcity"* (demand exceeding supply), not job losses. [TechCrunch]

---

## 3. Technical pillars (as publicly described)

### Pillar A — World Models (physical-simulation core)
AI that **perceives and simulates how the physical world behaves** — dynamic 3-D representations that predict how design choices propagate through physical reality: stress under load, manufacturing cost at scale, whether a tolerance is achievable with existing tooling. Cited demos: reconstruct airflow around a wing; predict component failure *before* manufacturing; reason about gravity/motion/cause-effect. Stated hard problem: *"move beyond the probabilistic limitations of current neural nets to incorporate rigorous physical laws."* [ChatForest, IEN, FAF]

### Pillar B — Multimodal, physics-grounded training data (the differentiator)
Training data extends far beyond scraped text/code/images to:
- **CAD geometries** (parametric + BRep)
- **Simulation outputs** (FEA / CFD / thermal / multi-physics fields)
- **Sensor telemetry** from real manufacturing
- **Robotics trajectories** (to *learn physical dynamics*, not to build robots)
- **Experimental results** from chemistry, biology, materials science
- **"Outcome-of-decision" data** — *what happens when you pick a particular alloy, adjust a tolerance, or modify a joint's geometry.* This is the key differentiator: models trained on the **consequences** of engineering choices, not just the geometry.
- *"Very compute-intensive"* because these specialized datasets must largely be **generated** (synthetic + real experimental). [ChatForest, CNBC, New Space Economy]

### Pillar C — Foundation-model "modern CAD" core
A generative successor to SOLIDWORKS / NX / Fusion built on a foundation-model core. Inverts the classic **draw → render → adjust** loop: instead of the human sketching and the software merely rendering, the model **reasons about intent and outcome** — infers what the engineer "probably needs," predicts stress/cost/tooling-feasibility, and produces *producible* designs. Target customer: mechanical/aerospace/process engineers inside Fortune-500 industrial firms. [ChatForest, GeekWire, eciks]

### Pillar D — Agentic VLA / computer-use core (from General Agents / Ace)
**VLA (video-language-action)** models (`ace-control-small/medium`) that interpret on-screen visual inputs and execute natural-language commands by **controlling a computer/desktop**. VLA is the same architecture family used to control robots; here it's repurposed to *operate engineering software*. **This is computer-use (CUA) at the core of Prometheus** — a direct parallel to ArchDisc's governing principle that *Archie drives Forge purely via CUA.* [SiliconANGLE, ChatForest]

### Pillar E — Robotics-driven / closed-loop physical experimentation
Robots that *"observe and run scientific experiments autonomously and at scale"* (à la Physical Intelligence / Periodic Labs) generate real-world experimental data feeding the world models. Blue Origin (rocket-engine design, David Limp on board) is an obvious internal proving ground. Note: the robotics is a *data source / feedback loop*, not the product. [New Atlas, New Space Economy]

### Pillar F — Vertical integration of manufacturing
A separate **~$100B fund** to acquire and *operate* manufacturers so the AGE is deployed end-to-end (design → tooling → production). Framed around compressing production timelines for everything from munitions to satellite components, and "sovereign control over the material basis of national security." [AI Magazine, MattHopkins, Capacity]

---

## 4. Target domains (full breadth, grounded)

Aerospace & space (jet/rocket engines, airframes, spacecraft, launch vehicles, satellites, habitats, propulsion, exotic materials, tight multi-disciplinary integration) · Automotive (pre-production engineering, prototyping, vehicle/systems) · Semiconductors / computing hardware · Advanced manufacturing & tooling · Materials science · **Drug & molecule design** (physical-chemistry-constrained) · Robotics & assembly (as data, not product). Bezos calls aerospace/space "the extreme end of engineering complexity." [TechCrunch, New Space Economy, New Atlas, ChatForest]

---

## 5. Roadmap (observed + implied)

1. **2025 Q4** — Launch ($6.2B); acquire General Agents (VLA/CUA core); recruit ~120 researchers.
2. **2026 H1** — Scale capital to ~$18B (+$12B Series B at $41B); build compute; *generate* specialized physics datasets; build the foundation-model "modern CAD" core. **No public product yet.**
3. **2026+** — Sell engineering-simulation & design software to industrial firms first (design tool for engineers).
4. **Strategic** — Raise ~$100B holding-co; acquire & operationally transform manufacturers (design → production owned).
5. **Long horizon** — Full AGE: end-to-end multidisciplinary, multi-physics, manufacturable design with closed-loop real-world experimental feedback. Bezos: *"many years of grinding ahead."*

---

## 6. FOLD — Prometheus' ENTIRE scope mapped into Archie-14B + Forge requirements

> **Fold rule:** every capability Prometheus aspires to must be *expressible inside Archie's 14B scope* and *executable/verifiable by Forge*. Tags: **[Archie]** (model capability/training), **[Forge]** (kernel/app), **[Both]**. Status tags: **[IN]** already in the Bible's scope (cite §) · **[+]** newly added/sharpened by this fold. North-star gate throughout (Bible §0.2): **Archie-drives-Forge ≥ 0.85 on CADGenBench on EVERY dimension** (validity ≥0.97; shape/interface/topology/generation/editing ≥0.85) — no lite versions, dynamic features only, verified by **HEADED Playwright e2e** with ≥5 named camera angles and varied/distinct prompts, CI green between batches.

### 6.1 World-model / physics core (Pillar A)
1. **[Forge][IN §4]** Real, analytically-validated **multi-physics solver suite** as first-class kernel ops: linear/nonlinear **static FEA** (Wilson-Q6 de-locking, ≤0.5% vs analytical), **modal** (≤0.2%), **transient/dynamic FEA**, **buckling**, **fatigue** (S-N/ε-N, Paris, Miner, Goodman, FKM), **thermal/thermo-mechanical**, **CFD** (incompressible verified; **turbulent-CFD is the one acknowledged hole** — close it), **multibody dynamics** (HHT-α index-3 DAE, pendulum ≤0.016%), **acoustics/aeroacoustics (FW-H)**, **EM (Maxwell/Steinmetz)**. Exposed as `forge.simulate.*` / `forge.{fea,cfd,fatigue,fracture,emag,aeroacoustics}.*`.
2. **[Forge][+]** **`forge.simulate.failurePredict`** — predict-failure-*before*-manufacture: returns factor-of-safety fields, hot-spots, first-failure mode, and a pass/fail verdict against a named standard, so Archie can *reject a design pre-build* (Prometheus' "predict component failure before manufacturing"). New op binding the existing FEA/fatigue/buckling solvers into one verdict.
3. **[Forge][+]** **Field-reconstruction to viewport** — streamlines + pressure/temperature/stress field overlays as renderable meshes (the literal "airflow around a wing" demo Prometheus cites). Bind to multi-cam headed e2e (≥5 angles). This is a *render/overlay* gap on top of the solved fields.
4. **[Archie][IN §2.1 Pillar A]** Train Archie to **reason about physical cause-effect qualitatively** (load-paths/stiffness/heat-flow/gravity/motion) *then verify with the Forge solver* (reason → simulate → check loop). Already the math/physics pillars; the **reason-then-verify control flow** is the fold-sharpened requirement.

### 6.2 Outcome-of-decision data (Pillar B — Prometheus' key differentiator)
5. **[Both][IN §2.1 Pillar D "outcome-of-decision pairs"; sharpened]** **Engineering-decision-outcome corpus at scale**: paired `(design-change → simulated/measured outcome)` samples generated by *running Forge solvers over parametric sweeps*: e.g. *Al-6061→Ti-6Al-4V* → {mass, stiffness, cost, thermal, modal} deltas; *tolerance 0.1→0.02 mm* → {fit, cost, yield} deltas; *fillet R2→R5 at a joint* → peak-stress delta. **This is exactly the synthetic-data engine Prometheus says it must build — but ArchDisc grounds it in an owned, deterministic kernel.** Make this a *first-class corpus generator* (`bulk_synth_outcome.py` over DOE sweeps), not just a sub-bucket of Pillar D.
6. **[Both][IN §2.2 Cluster 2/3]** **Material + process knowledge base**: queryable material DB (E, ν, ρ, yield/UTS, fatigue, CTE, k, cost, machinability, weldability — alloys/polymers/composites) + process constraints (machining/casting/injection/AM/sheet-metal). `forge.material.*` + DFM checkers; Archie trained on it.
7. **[Archie][IN §2 "multimodal triples"; §2.3 S5-VLM]** Train on **multimodal triples** (text spec + engineering drawing/image + 3-D/BRep) with **full assembly context** — geometry-gen and GD&T need surrounding design, not isolated parts. Qwen2.5-VL branch (eager-RoPE fix).
8. **[Both][IN §2 "data hygiene"]** **Storage-safe synthetic-data factory**: strict download→process→delete one-at-a-time, parquet `iter_batches`, accumulator-dedup, NaN-guard, no `--mask-prompt` on long corpora — so the M4 Max survives generating the outcome corpus at 14B scale.

### 6.3 Modern-CAD foundation core (Pillar C)
9. **[Forge][IN §1 B0–B11]** **1:1 BRep kernel parity with Parasolid + ACIS** (the full phased B0–B11 program): tolerant modeling/heal, NURBS, exact booleans, blending, sweep/loft/surfacing, shell/offset/draft, patterns/features/sectioning/mass-props, history/rollback/persistent-IDs, cellular/non-manifold, lattice/implicit/AM, interop (STEP AP242-PMI / IGES / JT / XT / SAT / 3MF / glTF / DXF / DWG).
10. **[Archie][IN §2.1 Pillar B/E; CAD-fidelity program]** Train Archie to **emit producible parametric CAD tool-calls** (extrude/revolve/sweep/loft/fillet/pattern/shell/draft/boolean/sketch-constraints), *not* straight-primitive blockouts. Fix the bridge/brain/defect 3-layer severance.
11. **[Both][+]** **Intent-reasoning over the draw-loop** — Archie infers *unstated* requirements ("understands what you probably need": default tolerances, standard fasteners, governing load cases) from a terse prompt **and justifies them**, then resolves inferred components against Forge's **standard-parts library** (ISO/ANSI fasteners, bearings, profiles). This is Prometheus' explicit inversion of draw→render→adjust; add an **intent-inference + justification** training objective and a per-prompt "assumptions ledger" the model must emit.
12. **[Both][IN §1 B8; §3]** **Parametric feature-tree + history + regeneration** so Archie *edits* by changing parameters/features (SOLIDWORKS/NX/Fusion editability) — the CADGenBench `editing` axis.

### 6.4 Agentic VLA / computer-use core (Pillar D) — literally ArchDisc's governing principle
13. **[Archie][IN §0.1]** **Genuine CUA**: Archie reads Forge screen/state and drives it via console tool-calls exactly like a human (NOT `window.__forge*` composer shortcuts), holding under varied prompts. This is the direct local analogue of Ace's VLA computer-control.
14. **[Both][IN §0.1 corollary; context-verb memory]** **Console-CUA grounding** — proven Stage-A 100% op-selection (capstack fold + subtractive few-shot / handle-verb rule); extend to Stage B multi-step assemblies with the shared-ctx context-verb dispatch so in-kernel parts reach the viewport.
15. **[Archie][IN §2 "Qwen2.5-VL vision branch"; sharpened]** **Vision-action (VLA) branch** so Archie can act from rendered viewport pixels + drawings, not just text state — closing the gap to `ace-control` while staying local. Make the VLM branch *act* (drive UI from pixels), not only *read* (drawing→intent).

### 6.5 Closed-loop / design-as-optimization (Pillar E + the "invention loop")
16. **[Both][IN §5; §2.2 Cluster 3 topopt]** **Closed-loop design optimization**: Archie proposes → Forge simulates → score → Archie revises. `forge.optimize.{topology,parametricDOE,shape}` (SIMP ρ^p, parametric DOE, gradient / CMA-ES). Treat engineering **as optimization** (Prometheus' framing) but grounded in the verified kernel.
17. **[Forge][IN §1 B10; §2.2 Cluster 3]** **Generative/topology design** (SIMP density, lattice/infill, TPMS implicit fields via the unified kernel) so Archie can request mass-minimized load-bearing structures — the "invention-loop" accelerator.
18. **[Both][IN §0.3; §6 benchmark]** **Physics-verification IS the reward signal** (ForgeCADScore geometry-truth + analytical-gate pass + standards verdict) — ArchDisc's *substitute for Prometheus' robot-lab feedback*: we can't run robot labs, but we *can* run a validated, deterministic, owned kernel as the closed-loop oracle. **This is the strategic crux of the fold.**

### 6.6 Domain breadth (§4) — Archie must cover all of it
19. **[Archie][IN §5 flagships; train-projects-exhaustive memory]** **Aerospace/space corpus**: airfoils/wings, jet & rocket engines (GE9X ~20k-component flagship; turbofan; turbopump; gearbox), spacecraft structures, propulsion, aero/thermal loads. Trained on *full flagship specs* (components/dimensions/spatial/PBR/environments).
20. **[Archie][IN §2.2 Cluster 2]** **Automotive corpus**: chassis, powertrain, suspension, BIW/assembly, crash/NVH basics.
21. **[Archie][IN §2.2 Clusters 2/5]** **Mechanical/structural corpus**: AISC/ACI/TMS/Eurocode/Shigley calculators + GD&T (ASME Y14.5-2018 / ISO GPS — FCFs, datums, tolerance stack-up).
22. **[Both][IN §2.2 Cluster 2 EM/thermal; sharpened]** **Semiconductor / computing-hardware** packaging & board-level **mechanical + thermal + EM** (the chip domain). Scope = mechanical/thermal/EM of packages and boards; **explicitly flag full lithography/process physics OUT of a CAD kernel's scope** (honest boundary).
23. **[Archie][+]** **Materials-science + (adjacent) molecular-design awareness**: a materials-science knowledge layer is in scope (Cluster 2 feeds). **Drug/molecule design is Prometheus' most distant domain from a CAD/CAE kernel — mark it ADJACENT, LOW-PRIORITY, honesty-gated**: Archie may *reason about* physical-chemistry-constrained materials/process selection, but ArchDisc does NOT claim molecular/biological design as a core competency. (Bible honesty rule §2 hygiene-e.)
24. **[Both][IN §5; §2.2 Cluster 3]** **Manufacturing/CAM + DFM/tooling**: toolpaths (2.5/3/5-axis mill, turn, AM slicing), tooling feasibility, cost & cycle-time estimation, DFM/DFA — designs must be *producible* (Prometheus' "manufacturing constraints / tooling feasibility").

### 6.7 Multidisciplinary "thousand minds" system design
25. **[Both][IN §1 B7 clash; assembly-context memory]** **Full assembly + system context**: mates/joints, kinematics, interference/clearance, BOM, mass properties, assembly-level PMI/GD&T. Archie designs *in context*, never isolated parts.
26. **[Both][IN §4.3; +]** **Multi-physics co-design**: couple structural + thermal + fluid + modal in one workflow so Archie can *trade across disciplines like a multidisciplinary team* — the literal "thousand minds." Add a **coupled-physics workflow op** (`forge.simulate.coupled{thermoMechanical, fluidStructure, ...}`) as the fold-explicit requirement.
27. **[Both][IN §5; §8]** **Standards-aware verification**: every Archie deliverable cites and is machine-checked against the governing code (ASME/ISO/AISC/Eurocode/IEC/IEEE/NFPA/ASHRAE/AWS) with a pass/fail verdict.

### 6.8 Product, UX & verification (enterprise / Prometheus-grade)
28. **[Forge][IN §3]** **CATIA/NX-grade enterprise UI/UX**: ribbon + sidebars + right-click + top/sub-menus (no flat list); workbenches strategically placed; CAD/CAE/CAM/PDM surfaces; every surface dual-driven (human React path + Archie tool-call path, one reducer).
29. **[Both][IN §1 B11; §5.2]** **PDM/data-management** (JSON-vault PDM, versioning; STEP/JT/glTF/DXF/SVG/PDF export via inline writers — no external deps).
30. **[Both][IN §0 doctrine; verify memories]** **Verification discipline**: every capability proven by **headed Playwright e2e** on real app+kernel+model, ≥5 named camera angles, **varied/distinct prompts each run** (no cherry-picking), reference-video fidelity; re-run on any doubt; CI green before advancing.
31. **[Both][IN §0.2; §6]** **Geometry-truth benchmark gate**: CADGenBench (Mecado × HuggingFace) **≥0.85 on every dimension** via ForgeCADScore (replay 1.0 vs corrupt 0.456 already demonstrated) — the explicit, *demonstrable* moat over Prometheus, who has shown **no benchmarks at all**.

### 6.9 Strategic / positioning (Pillar F + §0.3)
32. **[Both][IN §0.3]** **Local-first moat**: all of the above runs on a **14B model on a 36 GB M4 Max**. Prometheus' answer is ~$18B raised + a ~$100B fund + multi-hyperscaler compute; ArchDisc's is **efficiency + a real verified owned kernel + offline operation behind any firewall**. Keep `serve` fresh before any live CUA demo (output degrades over a session).
33. **[Both][IN business-model + landing memories]** **Honest positioning**: deck/landing sell only codebase-evidenced moats (real BRep, multi-physics analytical gates, geometry-truth scoring, runs-local, offline). **No fabricated benchmarks; no claim to robot labs we don't run; no molecular-design claim.** Lead investor demos with Forge (already real BRep). The ArchDisc pitch *vs* Prometheus is literally: *"the same 'modern CAD' thesis Bezos just funded at $41B — but local, offline, on an owned kernel, with a published geometry-truth benchmark Prometheus has not shown."*

---

## 7. What Prometheus EXPLICITLY implies Archie must be able to do (capability checklist)

Distilled from §6 — the concrete capability bar the *entire* Prometheus program puts on Archie. Each line is a thing Archie-driving-Forge must demonstrably do:

1. From a **terse natural-language intent**, infer unstated requirements (tolerances, load cases, standard parts) and **emit an assumptions ledger** + producible parametric CAD tool-calls. (Prometheus' "understands what you probably need.")
2. **Predict a design's physical behavior before building it** (stress/modal/thermal/fatigue/buckling/CFD/MBD fields) and **reject or revise** designs that fail a standards verdict. ("Predict component failure before manufacturing.")
3. **Quantify the consequences of an engineering decision** — alloy swap, tolerance change, geometry edit → mass/cost/stiffness/yield/thermal deltas. (Prometheus' outcome-of-decision differentiator.)
4. **Close the design loop** as optimization: propose → simulate → score → revise, using the verified kernel as the reward oracle. (Prometheus' "accelerate the invention loop"; their reward is robot labs, ours is the deterministic kernel.)
5. **Operate the CAD/CAE app purely by computer-use (CUA)** — from text state and (VLA branch) from viewport pixels — like Ace/`ace-control`, but local and offline.
6. **Design in full assembly/system context** across disciplines (structural+thermal+fluid+modal), not isolated parts — the "thousand minds."
7. **Guarantee producibility** — DFM/tooling-feasibility/cost/CAM toolpaths so every design is manufacturable.
8. **Span the domains** Prometheus targets: aerospace/space (priority), automotive, mechanical/structural, semiconductor mechanical/thermal/EM, materials. **Molecular/drug design = adjacent, honesty-gated, not claimed.**
9. **Prove every capability** with headed e2e + a published geometry-truth benchmark (CADGenBench ≥0.85 every dim) — the one thing Prometheus has *not* publicly done.

---

## 8. Bible fold-in (what was changed in the Mission Bible)

This research is folded into `docs/SCOPE_2026-06-21/00_MISSION_BIBLE_V2.md` (the canonical north-star) via a new subsection **§0.4 — Prometheus parity fold (the full competitor scope, inside Archie's reach)** plus three sharpening edits:
- **§0.4 (new):** the 9-capability Prometheus implication checklist (§7 above) declared as binding scope, tagged to the existing programs, with the strategic crux ("the verified owned kernel is our substitute for Prometheus' robot-lab feedback loop").
- **§2.1 Pillar D:** sharpened to name the **outcome-of-decision corpus as a first-class generator** (`bulk_synth_outcome.py`) and the **reason→simulate→verify** control flow.
- **§4 / §5:** the three **[+] newly-added Forge ops** (`failurePredict`, field-reconstruction overlays, `coupled*` multi-physics) flagged as fold-required.
- **§0.3 strategic moat:** the positioning line ("$41B 'modern CAD' thesis — but local/offline/owned-kernel/benchmarked") added as the canonical Prometheus comparison.

Net: **Prometheus' entire public scope is now inside Archie's 14B scope.** The only items deliberately scoped DOWN (with honesty rationale, not omission) are: full robot-lab experimentation (substituted by the verified kernel as oracle), full semiconductor lithography/process physics (out of a CAD kernel), and molecular/drug design (adjacent, low-priority, not claimed).

---

## 9. Sources

Primary (founders on record / funding):
- TechCrunch — Prometheus raises $12B for an "artificial general engineer for the physical world": https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/
- CNBC — Bezos & Bajaj open up about Prometheus ("We're not being secretive"): https://www.cnbc.com/2026/06/11/project-prometheus-bezos-bajaj-live-updates.html
- GeekWire — Bezos describes Prometheus for the first time ("modern version of CAD"; "nothing to do with robotics"): https://www.geekwire.com/2026/jeff-bezos-describes-his-38b-startup-prometheus-for-the-first-time-nothing-to-do-with-robotics/
- New Space Economy — AGE for engineering/manufacturing/space (Bezos "invention loop" quote): https://newspaceeconomy.ca/2026/06/14/jeff-bezos-prometheus-the-ai-startup-building-an-artificial-general-engineer-to-accelerate-engineering-manufacturing-and-space-innovation/

Technical framing & pillars:
- ChatForest — "The CAD of the Future" (draw-render-adjust inversion; world models; Ace/VLA; outcome-of-decision): https://chatforest.com/reviews/jeff-bezos-project-prometheus-artificial-general-engineer-manufacturing-ai-2026/
- IEN — Project Prometheus & the shift from Artificial to Engineered Intelligence: https://www.ien.com/artificial-intelligence/blog/22959167/project-prometheus-and-the-coming-shift-from-artificial-intelligence-to-engineered-intelligence
- VKTR — Inside Project Prometheus (AI for the physical economy; board; offices): https://www.vktr.com/ai-market/inside-project-prometheus/
- SiliconANGLE — Prometheus acquires General Agents (Ace / ace-control / VLA): https://siliconangle.com/2025/11/26/jeff-bezos-project-prometheus-reportedly-acquires-ai-startup-general-agents/
- New Atlas — Bezos AI manufacturing startup (robots run experiments autonomously; physical economy): https://newatlas.com/ai-humanoids/jeff-bezos-ai-manufacturing-startup-prometheus/
- eciks — Next-gen design tools for engineers, not robots: https://eciks.org/8177-95046-prometheus-bezos-artificial-general-engineer-design

Funding / strategy / $100B fund:
- Crunchbase — Bezos launches AI startup with $6.2B: https://news.crunchbase.com/venture/bezos-bajaj-ai-startup-prometheus/
- eMarketer — Bezos backs "physical AI" with $6.2B Prometheus launch: https://www.emarketer.com/content/bezos-backs-physical-ai-with-prometheus-launch
- AI Magazine — Inside Prometheus raising $10B: https://aimagazine.com/news/inside-jeff-bezos-project-prometheus-raising-us10bn-funding
- Capacity — Prometheus nears $10B raise / $38B: https://capacityglobal.com/news/bezos-ai-lab-funding-38-billion-dollars/
- MattHopkins — Bezos betting $100B on factories, not chatbots: https://matthopkins.com/business/project-prometheus-bezos-betting-100-billion-factories-not-chatbots/
- Built In — What is Project Prometheus: https://builtin.com/articles/what-is-project-prometheus
- Wikipedia — Project Prometheus (company): https://en.wikipedia.org/wiki/Project_Prometheus_(company)

Prior ArchDisc research: `docs/SCOPE_2026-06-21/research/prometheus.md` (the 33-requirement mapping this doc re-grounds and extends).
