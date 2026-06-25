# FORGE/ARCHIE BIBLE SCOPE UPDATE 2026-06-25

Consolidation of 5 web-research briefs (P-1 AI, Project Prometheus, mech-eng/CAD community survey, enterprise CAD UI/UX, Mecado/CADGenBench) into actionable additions for Archie's 14B foundational scope, the Forge kernel+UX roadmap, and the bible. Each topic: (a) distilled findings, (b) concrete additions. A prioritized NET NEW SCOPE ITEMS checklist closes the doc.

---

## TOPIC 1 — P-1 AI (the direct namesake competitor)

### (a) Distilled findings
- **Identity & model:** P-1 AI builds "engineering AGI for the physical world" via an agent *also named Archie* — positioned as a remote junior engineer reached on Slack/Teams ("**sell work, not software**"). North star: engineering superintelligence (EAGI). Founders ex-Airbus/UTC/DARPA/DeepMind; $23M seed (Radical Ventures; angels Jeff Dean, Peter Welinder). [p-1.ai; sequoiacap.com/podcast/training-data-paul-eremenko; businesswire 20250425073932]
- **Federated architecture (NOT a monolith):** (1) orchestrator-reasoner LLM, (2) **GNN physics surrogates** for fast multiphysics, (3) classical **geometric reasoner** (packing/interference), (4) a **"lobotomized LLM"** degraded at English but specialized for programmatic multiphysics / program-synthesis, (5) **VLMs** for higher-order spatial reasoning, (6) deterministic algorithmic components. Gordić: "cannot be done with a thin wrapper around existing LLMs." [sequoiacap podcast]
- **Three primitives** all engineering reduces to: **Design Evaluation**, **Design Synthesis**, **Error-Finding & Infilling**. [sequoiacap podcast]
- **Synthetic-data moat:** physics-based, supply-chain-informed datasets; component catalogs **2–3 OOM larger** than a real system needs; **intelligent assembly rules**; every candidate **simulated → performance vector**; sampling **densely around dominant designs, sparsely at the edges** (so the model learns *why* bad designs fail); every design stays **realizable/buildable**. Training arc mirrors AlphaGo (bootstrap on synthetic → learn from real deployment feedback). [sequoiacap podcast]
- **"Archie IQ" eval:** custom 6-level Bloom-style cognitive benchmark — Recall → Understanding → Evaluation → Error-Correction → Synthesis → **Reflection (EAGI)**. Two AGI axes: within-domain complexity scaling + cross-domain generalization. [sequoiacap podcast]
- **Scaling roadmap:** ~1 year per order-of-magnitude of part count — residential cooling (toy) → **data-center cooling ~1,000 parts (current product)** → industrial → mobility → aerospace ~1,000,000 parts.
- **Current product (Computex 2026 + Daikin):** "AI mechanical & electrical engineer for data centers"; drives **PLM, SharePoint, SolidWorks, Excel, AutoCAD Electrical, vapor-cycle + power-system sw** CUA-style; end-to-end workflow (requirements → component selection → trade studies → design artifacts → power-systems study) in **23 min vs ~7–10 working days**. Customer: **Daikin Applied Americas**. Multiphysics scope: thermal/fluid, electrical, vibration/structural, **EMI**; engineers exercise **selective phenomenology** (pick which physics matter for first-order sizing). [p-1.ai/computex2026]

### (b) Concrete additions
- **14B foundational scope:** Frame the 14B explicitly as the **orchestrator-reasoner**; formalize the Forge-verb-emission head as the "programmatic-multiphysics" path (our analogue of the "lobotomized LLM"). Add the **three primitives as first-class skills**, with **Error-Find-&-Infill as a NEW corpus pillar** (defect-injection → detection → parametric repair) wired to the kernel-truth reward.
- **Corpus (near-term, bulk_synth):** add **supply-chain-grounded realizability** + **edge-of-design-space negative sampling** (why-designs-fail); **kernel-simulate every synthetic design** to attach a *true* performance vector (we have the MIT-PhD-validated kernel; P-1 only has surrogate GNNs — a genuine moat). Build/ingest **oversized parametric component catalogs (2–3 OOM)** with assembly rules.
- **Eval:** layer a **Bloom-style 6-tier "Archie IQ"** on top of CADGenBench (measure Evaluate/Synthesis/Error-Correction/Reflection, not just geometry validity).
- **Forge kernel+UX roadmap:** add **data-center cooling + critical-power-systems workbenches & corpora** (vapor-cycle, power-system study) — their beachhead, currently a Forge gap. Add **electrical / EMI multiphysics** to match their thermal+electrical+vibration+EMI scope. Add a **"which-physics-matters" first-order-sizing selection skill** (corpus: design → relevant-modalities labels).
- **Headline metric to beat:** define a timed **end-to-end junior-engineer workflow e2e** (requirements → component selection → trade study → artifacts → sim study) and beat their **23-min** benchmark.
- **Persona surface:** optionally add a Slack/Teams-style messaging surface so Archie reads as a teammate (mirrors their change-management edge); keep the existing console.
- **Where Forge already leads (assert in the bible):** (1) real validated multi-physics native kernel vs their surrogate GNNs; (2) CUA-drives-the-app is already our governing, proven principle; (3) our OCCT geometric reasoner is deeper than their packing/interference queries (real BRep).

---

## TOPIC 2 — Project Prometheus (Bezos's "artificial general engineer")

### (a) Distilled findings
- **Identity (unambiguous):** Prometheus Industries, Inc. — Jeff Bezos's stealth physical-AI company building an **"artificial general engineer" (AGE)** that automates **design → simulate/validate → manufacture** of complex physical systems end-to-end. Co-CEOs Bezos + Vik Bajaj (ex-Google X, Verily); David Limp (Blue Origin) on board; ~120–150 staff from Meta/OpenAI/DeepMind; SF + London + Zurich; stealth, no website. [en.wikipedia.org/wiki/Project_Prometheus_(company); techcrunch 2026/06/11; axios 2026/06/11; cnbc 2026/06/11]
- **Funding:** launched ~Nov 2025 with **$6.2B**; **2026: $12B Series B at ~$41B** (Bezos, JPMorgan, Goldman Sachs, BlackRock). Large share → compute. [techcrunch; axios; emarketer]
- **Thesis:** **"physical AI / world models" over LLMs** — train on massive multimodal real-world-interaction data, learn from **physical trial-and-error**, simulate/perceive how the physical world behaves. LLMs alone "fall flat" on physics.
- **Target domains:** aerospace/spacecraft, automobiles, computing/semiconductors, and **drug/molecule design (pharma)**. Robotics-driven experimentation. Acquired **General Agents** (maker of "Ace" computer-use agent, Nov 2025) — validating CUA. Separate **disrupt-and-acquire holding-company** play (business strategy, not training scope).

### (b) Concrete additions
- **14B foundational scope / bible identity:** adopt the explicit **"artificial general engineer / world-model"** north-star framing; make **design → simulate → validate → manufacture** a top-level training objective.
- **World-model / physics-grounded signal:** tie generation to **kernel simulation rewards** (extends the GRPO-with-kernel-reward plan); train on **physics envelopes**, not just geometry. Reinforce **full-assembly-context multimodal** training (text + drawings + 3D + workflow traces).
- **Domain decision (flag for the user):** aerospace/auto/computing already covered. **Pharma/molecular + materials design is a genuine gap** — Prometheus counts drug compounds as core "physical systems"; Archie omits them. *Decision needed:* add molecular/materials design as a foundational field, or scope it out. (Recommend: add **materials selection / materials-design** as a near-term field since it directly feeds mech-E sizing; treat full molecular/pharma as a longer-horizon optional pillar.)
- **Validation, not new scope:** CUA-only governing principle and design+manufacture (CAM/MBD/PLM) framing are both confirmed 1:1 — keep. The acquire-and-roll-up angle is out of training scope.

---

## TOPIC 3 — Mech-Eng + CAD/CAM/CAE community survey 2025–2026

### (a) Distilled findings
**Rising hard-tech trends:**
1. **Agentic CAD** — frontier shifting from "generate geometry" to agents that *take actions inside existing CAD tools* on bounded verifiable tasks. *Exactly Forge's CUA thesis.* [colabsoftware/post/ai-cad-in-2026]
2. **Text-to-CAD producing editable parametric B-Rep** (Zoo.dev/KittyCAD, AdamCAD, CADGPT) — works for single brackets/gears, **breaks on assemblies >8–10 constrained parts, lacks STEP export.** [xometry.pro; pasqualepillitteri.it]
3. **ML/GPU surrogate sim** — NVIDIA Modulus/PhysicsNeMo, Fourier Neural Operators, geometry-aware GNN/transformer surrogates (SMART) → real-time parametric sweeps + inverse design. [developer.nvidia.com/blog/...physicsnemo; arxiv 2601.18707]
4. **Democratized simulation** — embedded FEA-in-CAD, guided/auto-setup, breakthrough = **analysis directly on imported CAD without simplification/meshing**. [engineering.com/simulation-is-becoming-democratized; nafems NWC25]
5. **Implicit/field-based modeling for DfAM + lattices** (nTopology/Carbon; TPMS/Voronoi/graded; diffusion + implicit reps). [link.springer 10.1007/s40964-025-01477-8; arxiv 2509.05345]
6. **Knowledge-Based Engineering** — rules + design intent automate whole product families. [citiuskbe.com]
7. **AI design review / automated DfM + GD&T checking** — CoLab AutoReview; "verification is the near-term money, not generation." [colabsoftware]
8. **2D drawing automation from 3D** — DraftAid, up to 90% time savings. [thecadhub.com]
9. **Predictive/autonomous digital twins** (battery thermal/SoH, large composite assemblies, multiphysics). [caeassistant.com; nature s41598-025-16439-x]
10. **Multi-axis / non-planar AM slicing** — ORNL Slicer 2, GPU slicers, implicit-neural-field collision-free printing. [ornl.gov]

**Recurring pain points:** (11) subscription/cloud lock-in revolt (74% call AutoCAD expensive; SW ~$2.6–7K/yr); (12) stability/rebuild failures/large-assembly slowdown (SW 2025 crashes; 10k+ parts sluggish); (13) **STEP "geometry lottery"** (sheet bodies not solids, vanished features, shifted CoG → cascading sim/cost errors); (14) CAD-to-CAE prep friction (manual defeature/mid-surface/suppress); (15) tolerance stackup still done in Excel despite MBD tools.

**Concrete feature demands directly takeable:** STEP export from any AI model; **assemblies that hold consistency past 10 parts**; **explainable feature-tree reasoning**; manufacturability/tolerance/interference baked-in not bolted-on; **analysis on raw imported CAD without defeaturing**; embedded FEA/CFD; **Git-style branch/merge for CAD** (Onshape model); auto-2D-drawings + auto-dimensioning; affordable perpetual-feel licensing without forced cloud.

### (b) Concrete additions
- **Forge moats to assert in the bible (externally validated):** native-OCCT **STEP/B-Rep validity** (vs text-to-CAD's no-STEP failure), **assembly-context coherence past 10 parts** (universal competitor gap), **agentic CUA driving real CAD ops** (named 2026 frontier). All three already map to existing memory entries.
- **Kernel+UX roadmap (community-validated gaps, not SaaS filler):**
  - **Implicit/lattice DfAM kernel ops** (TPMS/Voronoi/graded lattices, watertight sim-ready).
  - **ML surrogate-sim path** for real-time parametric sweeps / inverse design (complements, not replaces, the validated solvers — feeds P-1-style fast evaluation).
  - **Automated STEP healing / defeaturing** (stitch surfaces, close gaps, remove slivers) — turns the "geometry lottery" into a Forge feature; also a corpus/skill for Archie.
  - **Analysis-on-raw-imported-CAD** (sim without manual defeature/mesh) — direct democratization demand.
  - **Explainable feature-tree generation** — Archie surfaces *why* each op was chosen (debug + knowledge transfer); pairs with the UI tree (Topic 4).
  - **Git-style branch/merge** layered on the JSON PDM vault.
  - **AI design-review / auto-DfM + GD&T checking** as a first-class Archie deliverable (the "verification ROI" wedge) — wire the bound-not-bridged PMI/tolerance/interference into an actual geometric FCF evaluator.
  - **Auto-2D-drawing + auto-dimensioning** from 3D (DXF/SVG inline writers already exist).
  - **Multi-axis / non-planar AM slicing** as a CAM kernel op (longer horizon).
- **14B corpus:** add **error-find/repair, DfM/GD&T-violation detection, and STEP-healing** examples (overlaps P-1's error-infilling pillar).

---

## TOPIC 4 — Enterprise CAD UI/UX paradigm (NX · CATIA · Creo · SolidWorks) → Forge blueprint

### (a) Distilled findings
The four enterprise MCAD systems converge on one operating model and six UI invariants:
1. **Universal 4-zone workspace** — maximized central 3D canvas + **left history/feature tree** (the editable "part DNA") + **top ribbon of context tabs** (with a **Command Finder** search) + **status/snap bar with live XYZ**; plus a heads-up view toolbar on-canvas.
2. **Sketching is a modal sandbox** — pick plane → **flatten normal-to-plane** → **lock toolset to sketch commands** → explicit **Exit Sketch / confirmation corner** auto-rotates back to 3D.
3. **Constraint state by color** — **blue = under-defined, black = fully-defined, red = over-defined**; auto-inferred relations (coincident/horizontal/tangent) + weak/auto dimensions promotable to strong/driving; glanceable "make it all black" goal.
4. **Features = modal dashboards** — Extrude/Fillet/Pattern open a context panel with **real-time ghosted preview** + on-canvas drag handles → **commit writes one tree node**; double-click re-opens.
5. **Edits ripple via rollback/time-travel** — SolidWorks Rollback Bar: regress up the tree, edit/insert, replay top-to-bottom in dependency order (ripple-safe regeneration).
6. **Power-user UX eliminates mouse travel** — right-click radial/pie menus, "S" cursor shortcut bar, "D"-key breadcrumbs + context mini-toolbar, single-key command chaining, custom mapkeys.
[help.solidworks.com FeatureManager/Rollback/PropertyManager; whole-spec.com NX; donaenam.com CATIA Sketcher; 3dconnexion Creo radial menus; innova-systems S-key/Mouse-Gestures]

### (b) Concrete additions
**Forge UI/UX roadmap — tiered, each ships CI-green + multi-cam headed e2e before the next (single-workflow rule):**
- **TIER 0 — workspace shell:** dark dominant canvas with camera bound to active `forgeBody`; **ghost/dim non-active assembly components**; **left feature/model tree = part DNA** (each node maps 1:1 to a Forge verb; re-orderable, suppressible, right-click-editable) — *the keystone, prioritize above polish*; **top context-tab ribbon + Command Finder search** (critical for the large verb surface; honors the no-flat-list hierarchy rule); **bottom status+snap bar with live XYZ**; heads-up view toolbar (reuses 5-camera infra).
- **TIER 1 — modal sketch sandbox:** plane select → flatten normal-to-plane → lock to sketch commands → explicit Exit Sketch auto-rotates back; plane hover/highlight.
- **TIER 2 — constraint color coding:** blue→black→red mapping of PLANEGCS DOF (already in stack); auto/inferred relations with cursor glyphs; weak/auto dimensions + DOF counter in status bar. *Highest credibility-per-line.*
- **TIER 3 — feature dashboards + rollback:** modal Extrude/Fillet/Pattern with **real-time ghosted preview** + drag handles, commit→one tree node, double-click re-opens; **history rollback/time-travel bar** with ripple-safe replay (requires the ordered tree + deterministic re-eval of the verb sequence). *Marquee differentiator vs AdamCAD-class tools — and what lets Archie **correct parametrically** instead of rebuilding.*
- **TIER 4 — power-user velocity:** right-click radial/pie menu; keyboard chaining + cursor-anchored "S" bar; "D"-key breadcrumbs + context mini-toolbar.
- **Cross-cutting (bible):** **every UI affordance must map to a Forge verb** so Archie's CUA drives the *same* surface a human uses (CUA-governing alignment). The **feature tree is the keystone** unlocking the whole "part DNA" + rollback story; constraint colors and live-XYZ/snap bar are the cheapest enterprise-grade wins.

---

## TOPIC 5 — Mecado / CADGenBench (the benchmark that gates the program)

### (a) Distilled findings
- **Mecado ("The Mechanical Data Company"):** Cambridge, MA pre-seed building **CAD-native, expert-annotated, physics-informed training+eval data** for mech-E AI. Thesis: best engineering data is siloed; frontier LLMs underperform on hand-calcs / 3-axis milling / design review. "Press Download and have SOTA on disk." Founders Elie Cuevas (MIT '24) + Dylan Ryan; advisor Blake Courter. **~$750K pre-seed + $450K compute credits; backed by Link Ventures** (the same fund in the user's deck memory) + angel Kush Bavaria. Origin: built on SpaceClaim API, then "training data was more valuable than the models." [mecado.com/benchmark; kushbavaria.substack.com; blakecourter LinkedIn]
- **CADGenBench (Mecado × Hugging Face, HuggingAI4Engineering org):** technical face **Michael Rabinovich** (ETH geometry-processing PhD) + HF's Wolf/von Werra/Tunstall. Two tasks — **Generation** (drawing PNG + text → 3D solid) and **Editing** (apply change to a STEP file). Dataset `cadgenbench-data` = **81 real mechanical fixtures (49 gen + 32 edit)** with real mating interfaces (bolt patterns, locating jigs); **ODC-BY**; public inputs, **private ground truth** (server-side eval via HF Jobs). **Submission = STEP files (tool-agnostic)**; open scoring engine + build123d baseline. **Four scored dims: geometric accuracy, topology correctness, interface compatibility, CAD validity.** **SOTA is brutal: ~0.39–0.45** (Claude "Fable 5" ≈ 0.4514 near top) — the **≥0.85 every-dim gate is ~1.9× SOTA.** [mecado.com/benchmark; huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data; huggingface.co/spaces/HuggingAI4Engineering/CADGenBench; x.com/MikushRab/status/2063999885796614522]
- **Mecado's needs:** a pipeline emitting **valid STEP scoring high on all 4 axes**; a **scriptable harness** to regression-test every new frontier model (Rabinovich's literal workflow); **topology/interface correctness** (Betti numbers, real mating interfaces) over visual shape; **at-scale annotated mating-aware CAD generation**; **open/reproducible/no-lock-in.**
- **Why Forge fits:** native OCCT 7.9.3 → ~100% STEP **validity** (the hardest-to-fake axis where build123d baselines produce invalid solids); already bridges **PMI/tolerance/interference + B-rep topology** (the two axes generic LLMs flunk); Archie is a **CUA agent driving a real kernel** (= the generation task); ForgeCADScore (replay=1.0 vs corrupt 0.456) mirrors their scoring philosophy. **Caveats to reconfirm:** mecado.com JS-rendered, PitchBook/LinkedIn paywalled — funding/headcount and FEA-platform-vs-data-company framing are from secondary posts. **Do not confuse** with MecAgent (separate French startup) or mecad.co.

### (b) Concrete additions
- **Forge roadmap (highest leverage):** build a **`forge cadgenbench` adapter** — input `{drawing.png | input.step, prompt}` → **valid STEP**, matching the exact `cadgenbench-data` fixture layout (49 gen + 32 edit); wire Forge's STEP exporter as the submission writer. **Pull the 81 ODC-BY fixtures** (commercially clean — fits the license rule) and run Archie end-to-end locally, scoring with the open scorer on all four dims.
- **Scorer parity:** extend **ForgeCADScore to report the four CADGenBench dims as separate numbers** — geometric accuracy + **topology (Betti b0·b1·b2)** + interface compatibility (bolt-pattern/mating fit) + CAD validity — so Forge's internal eval is 1:1 comparable to their leaderboard (makes Forge a drop-in in-house tester).
- **Win the editing task:** the **32 STEP-edit fixtures** are where script baselines collapse; Forge's **parametric/feature-edit verbs on native B-rep** are the natural answer — *lead the demo here* (hardest gap + Forge's strongest structural advantage; pairs with the Topic 4 rollback bar).
- **Packaging:** ship a **one-command headless CLI + HF-Jobs-compatible container** (`forge eval --bench cadgenbench --model <hf-id>` → STEP submissions + per-dim scores + multi-cam renders) — matches their 2-person "download and run" ethos.
- **14B corpus:** add **mating-aware, interface-grounded, topology-labeled** CAD generation+edit examples (bolt circles, locating jigs) targeting the four dims; this is the spine of the ≥0.85 push.
- **Relationship surface (bible/business note):** shared graph = **Link Ventures** (their backer + the user's deck fund) and **Thomas Wolf** (HuggingAI4Engineering + MecAgent angel) — position Forge as Mecado's go-to native-kernel STEP submission engine + reusable in-house model tester.

---

## NET NEW SCOPE ITEMS — prioritized checklist (fold into bible + tasks)

**P0 — gates the program / highest leverage**
1. **`forge cadgenbench` adapter** — `{drawing.png|input.step, prompt} → valid STEP`, exact 81-fixture layout (49 gen + 32 edit); STEP exporter as submission writer. [Mecado]
2. **ForgeCADScore → four CADGenBench dims** as separate numbers: geometric accuracy + topology (Betti b0·b1·b2) + interface compatibility + CAD validity; 1:1 with the HF leaderboard. [Mecado]
3. **Pull 81 ODC-BY fixtures (license-clean)** + run Archie end-to-end + score all four dims; target ≥0.85 every-dim (~1.9× the ~0.45 SOTA). [Mecado]
4. **14B corpus: Error-Find-&-Infill pillar** (defect-injection → detection → parametric repair) wired to kernel-truth reward — satisfies both P-1's 3rd primitive and CADGenBench editing + community "verification ROI." [P-1, Mecado, Community]
5. **Left feature/model tree (UI Tier 0, the keystone)** — ordered, editable "part DNA"; each node maps 1:1 to a Forge verb. Unlocks rollback + parametric story + CUA-correct-instead-of-rebuild. [UIUX]

**P1 — near-term corpus & kernel**
6. **bulk_synth upgrade:** supply-chain-grounded realizability + **edge-of-design-space negative sampling** + **kernel-simulate every design → true performance vector** (beats P-1's surrogate-only physics). [P-1]
7. **Oversized parametric component catalogs (2–3 OOM)** with intelligent assembly rules → feeds training data + Archie's selection skill. [P-1]
8. **Win-the-editing-task demo** on the 32 STEP-edit fixtures (parametric feature-edit verbs on native B-rep). [Mecado]
9. **Constraint color coding (UI Tier 2):** blue→black→red from PLANEGCS DOF + auto-inferred relations + weak/auto dims + DOF counter. Cheapest enterprise-grade credibility. [UIUX]
10. **Modal sketch sandbox (UI Tier 1)** + **feature dashboards w/ ghosted preview + history rollback bar (UI Tier 3)** — ripple-safe replay; the marquee differentiator + Archie parametric-correction substrate. [UIUX]
11. **Automated STEP healing/defeaturing** kernel op + corpus (stitch/close/remove-slivers) — solves the "geometry lottery." [Community]
12. **AI design-review / auto-DfM + GD&T (FCF) geometric evaluator** — wire bound-not-bridged PMI/tolerance/interference into a real checker; the near-term "verification money." [Community, P-1]

**P2 — domain expansion & framing**
13. **Data-center cooling + critical-power + electrical/EMI workbenches & corpora** (vapor-cycle, power-system study) — P-1's beachhead, current Forge gap. [P-1]
14. **"Which-physics-matters" first-order-sizing selection skill** (design → relevant-modalities labels). [P-1]
15. **Timed end-to-end junior-engineer workflow e2e** (requirements → component selection → trade study → artifacts → sim study) — beat P-1's **23-min** benchmark. [P-1]
16. **Bloom-style 6-tier "Archie IQ" eval** layered on CADGenBench (Recall→Reflection). [P-1]
17. **Bible identity update:** frame Archie as an **"artificial general engineer / world-model"** with a top-level **design→simulate→validate→manufacture** objective. [Prometheus]
18. **Implicit/lattice DfAM kernel ops** (TPMS/Voronoi/graded, watertight sim-ready). [Community]
19. **ML surrogate-sim path** for real-time parametric sweeps / inverse design (complements validated solvers; = P-1's fast evaluation). [P-1, Community]
20. **Git-style branch/merge** on the JSON PDM vault + **auto-2D-drawing/auto-dimensioning** from 3D. [Community]
21. **Explainable feature-tree generation** — Archie surfaces *why* each op was chosen. [Community, UIUX]

**P3 — power-user UX, persona, longer-horizon**
22. **Power-user UX (UI Tier 4):** right-click radial menus, "S" cursor bar, "D"-key breadcrumbs, single-key chaining. [UIUX]
23. **Slack/Teams-style teammate surface** for Archie (change-management edge; "sell work not software"). [P-1]
24. **Multi-axis / non-planar AM slicing** CAM kernel op. [Community]

**DECISIONS FLAGGED FOR THE USER**
- **Molecular / materials / pharma design** — Prometheus counts drug compounds as core "physical systems"; Archie omits them. Recommend adding **materials-selection/materials-design** near-term (feeds mech-E sizing); treat full molecular/pharma as optional long-horizon pillar. [Prometheus] — *decision needed.*
- **Subscription vs free framing** — community shows strong subscription/cloud-lock-in revolt; aligns with the existing "free, not open-source" business-model memory. No new action, but reinforces messaging. [Community]

**UNVERIFIED / TO RECONFIRM BEFORE LOAD-BEARING USE**
- Mecado funding (~$750K + $450K credits), headcount, and FEA-platform-vs-data-company framing — from secondary posts; mecado.com JS-rendered, PitchBook (402) + LinkedIn (403) paywalled. **Do not confuse Mecado with MecAgent or mecad.co.** [Mecado brief]
- P-1 IBM source (ibm.com/think/news/physical-ai-age-p-1) returned 403 — corroborated via search snippet only. [P-1 brief]
- Prometheus IEN source (ien.com) 403 on fetch — title/thesis only. [Prometheus brief]
- Community survey: Reddit/several forums blocked/403'd — sentiment substituted via practitioner/vendor aggregations, corroborated across multiple independent sources. [Community brief]