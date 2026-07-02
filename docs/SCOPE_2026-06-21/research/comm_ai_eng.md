# Community Research — AI-in-Engineering / Emerging / Startups (the Frontier)

**Cluster:** Hacker News (CAD/AI/eng threads), r/MachineLearning (eng applications), r/cad (AI threads), X/Twitter eng-AI, plus the AI-CAD startup landscape (Zoo.dev/KittyCAD, AdamCAD, Leo AI/CADGPT, PhysicsX, Nabla, Augment, Spline) and the megafund frontier (Project Prometheus, P-1.ai).
**Date:** 2026-06-21
**Scope:** What the frontier is betting on, what it *can't* do yet (= our openings), hype vs. real engineer sentiment, and the hard-tech Forge/Archie must match or leapfrog.

---

## 0. The one-paragraph state of the frontier (read this first)

The AI-CAD frontier in mid-2026 has bifurcated. On one axis, **LLM-driven parametric code generation** (Zoo's KCL/Zookeeper, AdamCAD's OpenSCAD→WASM, Leo AI, the build123d agent ecosystem) is converging on the *exact architecture Forge/Archie already chose*: an agent that writes a parametric recipe, executes it against a real kernel, renders multi-view snapshots, reads back errors, and iterates. On the other axis, **ML physics surrogates / "Large Physics Models"** (PhysicsX, SimScale+NVIDIA PhysicsNeMo, Neural Concept) are collapsing CFD/FEA from hours to milliseconds. Hovering above both is the **world-model megafund bet** — Jeff Bezos's Project Prometheus ($12B / $41B valuation, an "artificial general engineer" Bezos literally calls "a very, very modern version of CAD"). The consistent, loudly-stated gap across *every* tool: **none of them reliably produce dimensionally-exact, tolerance-bearing, design-intent-preserving, editable B-rep that survives contact with manufacturing or simulation, and almost none handle assemblies or moving parts.** That gap is precisely Forge's thesis (real C++20 B-rep kernel + validated physics + assembly context + Archie CUA). The frontier has validated our architecture and left the hardest 20% — the engineering-grade core — wide open.

---

## 1. HOT / TRENDING TOPICS RIGHT NOW

### 1.1 Project Prometheus — "Artificial General Engineer" (the dominant story)
- Jeff Bezos + Vik Bajaj; **raised $12B at a $41B valuation** (TechCrunch, 2026-06-11), ~150 employees across SF/London/Zurich, researchers poached from Meta/OpenAI/DeepMind. Bezos says the bulk of capital goes to **compute**.
- Mission: "**artificial general engineer**" — software automating *design AND manufacturing* of complex physical systems "from jet engines to drug compounds." Bezos explicitly framed it as "**a very, very modern version of CAD**" and clarified it's **design tools for engineers, not robots**.
- Technical bet: **world models** (perceive/simulate physical environments, generate dynamic 3D representations) + the **General Agents acquisition** (Sherjil Ozair, ex-DeepMind) bringing a **video-language-action (VLA) model** that "interprets visual inputs and acts on natural-language commands." First commercialization signaled as "software tools for engineering simulations and design."
- Why it matters for us: This is the single biggest validation that *the* frontier prize is exactly Forge+Archie's combined surface (CAD + simulation + agent). But Prometheus is "keeping specifics under wraps" and starts from a clean sheet with no kernel — **we already ship a validated B-rep + physics kernel today**. Our moat is *being real and shippable now* while they spend years on a foundation model.
- **Forge/Archie capability needed:** Position Archie as the *VLA-for-CAD* that exists today — visual input (drawing/screenshot) + natural language → kernel actions. Lean into the "modern CAD" framing; the megafund just made it the category-defining narrative.

### 1.2 Zoo's "Zookeeper" conversational CAD agent (shipped Jan 2026)
- Zoo shipped Zookeeper as a conversational agent in Design Studio v1.1. It does the full agentic loop: **Plan → Act (call tools) → Observe → Update → Repeat**, writing **KCL** (their parametric language), executing it, reading docs, and **reviewing geometry via multi-view snapshots**. Pricing is consumption-based (~$0.0083/sec GPU).
- Explicitly **chose LLM-code-gen over direct B-rep generation** to "preserve design intent through code." Admitted gaps: **text-only (no multimodal yet)**, **cannot reverse-engineer parametric intent from static STEP/STL**, **no multi-agent coordination yet.**
- This is the closest public mirror of Archie's architecture. They lead on polish + a hosted cloud kernel; **we can leapfrog on multimodal input (drawings/photos), STEP-import-to-parametric, and validated simulation** — all three are their stated gaps.

### 1.3 Cadence's "fully autonomous virtual engineer" for chip design (Computex 2026)
- Cadence announced the "industry's first **fully autonomous virtual agentic AI design engineer**" — ChipStack AI Super Agent at "Level-5 autonomy," running hundreds of simulations (Xcelium, Jasper), 40X faster RTL validation, 5-week loop → <1 day. Powered by NVIDIA.
- Trend signal: **"autonomy levels" (L0–L5) language is migrating from self-driving into EDA/CAD.** Whoever ships verified L4/L5 *mechanical* CAD wins the narrative. Archie's CUA loop is the L4/L5 mechanical analog.

### 1.4 ML physics surrogates going mainstream / "100k simulations a day"
- PhysicsX **closed $135M Series B** (Atomico lead; Siemens, Applied Materials, Temasek strategic; ~$170M total). Siemens podcast literally titled "**100,000 Simulations a Day**." They run **Large Physics Models (LPMs)** + **Large Geometry Models (LGMs)** — LGM-Aero is 100M params trained on 25M 3D shapes.
- SimScale + NVIDIA PhysicsNeMo shipped a **foundation AI model for centrifugal-pump/turbomachinery simulation** — **~2700x faster** than CFD, "thousands of design points in real-time," claims CFD-fidelity.
- Trend: the surrogate is becoming a *foundation model* per physics domain, not a per-part regression. **CFD/FEA-in-the-loop instant feedback is becoming table stakes for "AI CAD."**

### 1.5 "AI CAD: hype vs. reality" is itself the trending meta-conversation
- Multiple 2026 round-ups (Xometry "We Tested 7," RapidDirect "Best 8 we tested," Leo's "What's Real What's Hype," The CAD Hub) — the discourse has shifted from "look, it generated a part!" to "**which of these actually survives manufacturing?**" The honest consensus: **mostly not yet.** This is the buyer's mindset Forge should target — credibility over demo-magic.

---

## 2. HARD TECHNOLOGIES — what engineers are excited about OR struggling with (the deep stuff)

### 2.1 LLM-code-gen vs. direct neural B-rep generation (the core architecture war)
- Two camps:
  1. **Code-gen** (Zoo/KCL, AdamCAD/OpenSCAD, Leo, build123d+OpenCascade agents): LLM writes a parametric program → real kernel compiles exact B-rep. **Pro:** exact, editable, preserves intent via the feature tree. **Con:** LLM spatial reasoning is weak; long programs blow the context window.
  2. **Direct neural geometry** (DreamCAD, GenCAD, NURBGen, Text2CAD, GACO-CAD): diffusion/transformer over parametric surfaces or command sequences.
- **DreamCAD** (Mar 2026, SoTA on ABC + Objaverse, >75% user preference) generates editable parametric surfaces as **rational Bézier patches with differentiable tessellation** trained on 1M+ meshes (CADCap-1M, captions via GPT-5). **NURBGen** does LLM-driven NURBS. The research frontier is **differentiable parametric surfaces** so geometry can be supervised by point clouds without CAD annotations.
- **The consensus from HN engineers:** "LLMs are very weak at spatial reasoning compared to diffusion models" — but code-gen wins on *editability and exactness*, which is what production needs. **The winning recipe is hybrid:** LLM writes the recipe, kernel verifies, vision model checks renders.
- **Forge/Archie capability needed:** Forge already *is* the code-gen camp (Archie → parametric verbs → C++ kernel → B-rep). To leapfrog: (a) add a **differentiable / point-supervised surface mode** so Archie can fit geometry to a reference image or scan, not just emit primitives (directly attacks the "blockout-level fidelity" ceiling in our own memory); (b) strengthen Archie's spatial reasoning with mandatory multi-view render-feedback in the loop (Zoo/AADvark both prove this is the unlock).

### 2.2 Multi-view render-feedback loops (the proven spatial-reasoning fix)
- The single most-cited "what actually works" across HN, Zoo, and the AADvark paper: **render the model from multiple ortho/iso views, feed images back to the model, let it self-correct.** HN: "rendering shots from all the sides and ortho view and then feed that back to Opus" caught spatial errors. Zookeeper does multi-view snapshots. AADvark added **unique edge colors + per-face textures** in FreeCAD so the vision model could tell components apart.
- **Forge/Archie capability needed:** This is exactly the headed-multi-cam-e2e discipline we already enforce — but it must be *in Archie's generation loop*, not just verification. Archie should render ≥5 named angles, VLM-inspect, and self-correct *before* declaring done. Per-face/edge color-coding for the VLM is a cheap, proven trick we should adopt.

### 2.3 Dynamic CAD / assemblies with moving parts (almost nobody can do this)
- **AADvark** ("Agent-Aided Design for Dynamic CAD Models," arXiv 2604.15184): the headline finding is that **"no existing system can build a piston, a pendulum, or even a pair of scissors."** They got scissors working (2 images, 20 iterations, 4.14 hrs) by putting Gemini-3-Flash in a loop writing JSON parts+joints, but are limited to **rectangular prisms + revolute joints only**, and switched OndselSolver from Euler angles to **quaternions** because the solver "assumed a human could flip the part in a GUI."
- This is a near-total whitespace. **Forge already has an HHT-α multibody DAE solver (pendulum validated to 0.016%)** bound as `forge.simulate.multibodyDynamics` (per our own kernel memory) — meaning Forge can do the *physics* of moving assemblies that AADvark struggles to even define.
- **Forge/Archie capability needed:** Make Archie a *first-class assembly+mechanism* generator: joints, DOF, mates, kinematic chains → drive the existing multibody solver. This directly answers the user's standing directive to "ADD dynamic structures (mechanisms/multibody/modal/transient) to the training corpus." **Dynamic assemblies are the frontier's biggest stated gap and Forge's biggest latent advantage.**

### 2.4 ML surrogates / differentiable simulation / Large Physics Models
- **PhysicsX LPMs/LGMs**: transformer/GNN architectures over point clouds, meshes, and implicit reps; learn how "any 3D shape relates to any other"; near-real-time physical reasoning. GNN-on-irregular-meshes is the workhorse for learned simulators.
- **NVIDIA PhysicsNeMo + Cosmos**: open framework to build/train physics-AI surrogates combining "physics-driven causality with simulation + observed data." Cosmos 3 / Cosmos-Predict2.5 (Computex 2026) = world-foundation-models (Text2World/Image2World/Video2World) for physical AI + synthetic data generation.
- **Differentiable meshing** is emerging (survey arXiv 2512.23719): embedding mesh generation *inside* the simulation-driven optimization loop so you can backprop through the mesh.
- **Forge/Archie capability needed:** A **learned surrogate layer over Forge's validated FEA/CFD** — train a small per-discipline surrogate on Forge's own solver outputs so Archie gets *instant* "good enough" physics during ideation, then falls back to the exact solver for the final number. This is the credible, shippable version of "100k sims a day" — and we have the validated ground-truth solver to train against (our own memory notes turbulent CFD is the only remaining gap).

### 2.5 Benchmarks finally exist — and they're geometry-truth, not text-similarity
- **CADGenBench** (HuggingFace × Mecado): measures engineering-grade part generation on two tasks — (1) **generate from an engineering drawing**, (2) **edit a given STEP file per a change request**. Scored on **geometric accuracy, topology correctness, interface compatibility, CAD validity.** Tool-agnostic; submissions are just **STEP files**.
- New 2026 papers chase exactly this: **STEP-LLM** (NL→STEP), **B-rep primitive grounding** for high-fidelity gen, **TOOLCAD** (tool-using RL), **CAD-Coder** (CoT + geometric reward), **Text-to-CadQuery**.
- **Forge/Archie capability needed:** This aligns precisely with our existing **ForgeCADScore geometry-truth scorer** and CADGenBench program. We should (a) publicly post a strong CADGenBench number (the credibility currency), and (b) make the **"edit an existing STEP" task** a first-class Archie skill — it's a named task on the benchmark *and* the #1 real-world workflow (see §3.4, "80% of work is adapting existing parts").

### 2.6 World-models / VLA for the physical world (Prometheus, Cosmos, Trillion Labs)
- The bet: a model that *simulates* physical reality and can act in it via video-language-action. NVIDIA Cosmos + Omniverse generate physics-accurate synthetic worlds; Trillion Labs builds "Industrial World Models for AI Factories."
- This is the long-horizon, capital-intensive frontier. **It's where Forge could lose the narrative** if we let "CAD = static geometry" framing stick.
- **Forge/Archie capability needed:** Frame Forge's kernel-as-simulator + Archie-as-VLA as a *grounded, deterministic* world model for engineering — one that produces exact STEP, not a hallucinated video. The differentiator: **our "world" is a real validated physics kernel, theirs is a learned approximation.**

---

## 3. PAIN POINTS / UNMET NEEDS / TOOL GRIPES (what makes engineers rage-quit)

### 3.1 Output is dimensionally wrong / non-manufacturable (the #1 rage-quit)
- Xometry/RapidDirect tests found AI tools **ignore "exact dimensions & tolerances," "material characteristics," "draft angles & undercuts"** — all manufacturing-essential. **No tested tool auto-validates wall thickness or moldability.** Concrete failures: **through-holes that don't actually pierce, gussets overlapping mounting holes** making parts unusable, rotation/orientation mismatches.
- Leo: "Most text-to-CAD tools generate geometry that looks impressive in a demo but **falls apart the moment you try to add tolerances, run stress analysis, or send it to manufacturing.**"
- **Forge/Archie capability needed:** A **DFM/validity gate baked into Archie's loop** — wall-thickness, draft, undercut, hole-piercing, interference checks (we have PMI/tolerance/interference *bound but not bridged* per memory — bridge it). Archie should *refuse to finish* on a part that fails geometric validity, the same way it refuses to finish without multi-view verification.

### 3.2 Mesh-not-parametric / no editability / no design intent
- The recurring split: tools either produce **simple parametric solids** OR **complex but non-editable mesh** — never both. Meshy/Hunyuan produce pretty meshes with "no physical dimension tracking" / "no mathematical precision for CNC." Leo: text-to-CAD outputs "**lack feature trees, parametric constraints, material assignments**... no design history, so no one on your team can understand the intent."
- **Forge/Archie capability needed:** This is Forge's home turf — exact parametric B-rep with a real feature tree. The capability to *advertise hard*: every Archie output is **editable, parametric, intent-bearing** (named features, constraints, history), not dead mesh. Add **STEP/STL → parametric feature-tree reconstruction** (Zoo's stated gap; CADCL/contrastive B-rep papers show it's tractable).

### 3.3 The "language barrier" — describing CAD in words is harder than drawing it
- HN engineers: "the language of drafting is able to describe it perfectly, wordlessly and unambiguous, in a single drawing sheet" — text prompts can't match a drawing. "I would need a visual dictionary of terms." Paradox: the non-experts text-to-CAD targets *can't describe what they want* either.
- **Forge/Archie capability needed:** **Drawing/image/sketch as primary input** (multimodal-first), not text-only. Archie ingesting an engineering drawing → exact model is *the* CADGenBench task *and* the user's standing "train LLM+VLM on text + images + 3D" + "GD&T needs full assembly context" directives. This is a concrete leapfrog over text-only Zookeeper.

### 3.4 The real bottleneck is *retrieval*, not generation (80/20 reality check)
- Leo's blunt thesis: **"80% of engineering work isn't starting from scratch."** Engineers spend **30–40% of design time on retrieval** — searching vaults, asking colleagues. 40,000-part vaults carry **8,000–12,000 duplicates** because retrieval fails. Generative design "solves problems engineers don't actually have."
- **Forge/Archie capability needed:** This is a *gap Forge currently ignores*. Add **part-search / PDM-vault retrieval + dedup + "find-and-adapt-existing"** to Archie's repertoire (the JSON-vault PDM we already have is a seed). The killer combo: retrieve the closest existing part **then parametrically edit it** (= the CADGenBench "edit STEP" task). This is where the *measurable* time-savings are, per every honest 2026 review.

### 3.5 Context-window / scaling collapse on real parts
- HN: hitting context limits on "relatively small OpenSCAD files like the adapters... 10–40kb." Research: "single-pass LLM generation yields inconsistent results in domains requiring high structural precision"; "lack of self-correction, limited tool library."
- **Forge/Archie capability needed:** **Hierarchical/feature-chunked generation** + a **rich, validated tool library** (Forge's kernel verbs) so Archie isn't emitting raw geometry tokens. Generate per-feature, verify per-feature, assemble — never one giant program. (Mirrors our "context-verb shared ctx" memory: parts build in-kernel but must reach the viewport.)

### 3.6 No assemblies, no moving parts, no global dependency tracking
- HN: "every change to that part needs to be aware of the other parts in the design" — current tools lack dependency tracking. AADvark: nobody can build a piston/pendulum/scissors. AdamCAD/Zoo both explicitly "fail on complex nested mechanical assemblies."
- **Forge/Archie capability needed:** Assembly-graph awareness + mate/joint propagation + the multibody solver hookup (see §2.3). **This is simultaneously the biggest pain and our biggest unfair advantage.**

### 3.7 Black-box, no traceability, vendor lock-in, slow time-to-value
- Engineers avoid: black-box recs without citations, tools needing months of setup, platform migration / mandatory cloud licenses, metadata-only (non-geometry) indexing.
- **Forge/Archie capability needed:** **Traceable, explainable outputs** (Archie shows its plan + the feature tree + the validity report), local-first (we already run a local 14B), no forced migration. Our local-model + deterministic-kernel story is a direct answer to the lock-in/black-box gripe.

---

## 4. EMERGING METHODS + WHICH TOOLS/STANDARDS DOMINATE

### Dominant standards / formats
- **STEP (B-rep)** is the lingua franca — CADGenBench submissions are *literally STEP files*. KCL (Zoo), build123d/CadQuery (Python+OpenCascade), OpenSCAD (AdamCAD), DWG/DXF (CADGPT, 2D). **OpenCascade is the de-facto open kernel everyone leans on — Forge's native OCCT-class C++20 kernel with no WASM is a genuine differentiator.**
- **GLTF** for viz; **point clouds / implicit reps / Bézier-NURBS patches** for the neural-gen camp.

### Emerging methods (ranked by momentum)
1. **Agentic Plan→Act→Observe loops over a real kernel** (Zookeeper, AADvark, FreeCAD-Python agents) — *the* dominant production pattern. Forge/Archie already here.
2. **Multi-view render-feedback for spatial self-correction** — proven unlock; should be in-loop, with per-face/edge color coding for the VLM.
3. **Differentiable parametric surfaces / point-supervised CAD gen** (DreamCAD, NURBGen) — the path past blockout fidelity to reference-matching geometry.
4. **Per-domain physics foundation models / surrogates** (PhysicsX LPM/LGM, SimScale+PhysicsNeMo, Neural Concept) — instant CFD/FEA; ~2700x speedups claimed.
5. **World-models + VLA for physical engineering** (Prometheus, NVIDIA Cosmos/Omniverse, Trillion Labs) — long-horizon, capital-intensive, narrative-defining.
6. **Geometry-truth benchmarks** (CADGenBench/Mecado, ForgeCADScore) replacing text-similarity metrics — credibility currency.
7. **RL + tool-use for CAD** (TOOLCAD, CAD-Coder geometric reward) — RL with a geometric reward over a kernel; natural next training stage for Archie.
8. **Autonomy-levels (L0–L5) framing** crossing over from EDA (Cadence) — own the "L4/L5 mechanical CAD" label.

### Who dominates which niche (competitive map)
- **Engineering-grade parametric gen:** Zoo (KCL/Zookeeper) — closest to us; gaps = multimodal, STEP→parametric, sim, multi-agent.
- **Hobbyist/creative text-to-CAD:** AdamCAD (YC W25, $4.1M) — web-only, no nested assemblies, manual tolerance verify.
- **Copilot / assemblies-from-text:** Leo AI (PhD-led, full assemblies but heavy rework, restrictive free tier).
- **2D/scripting:** CADGPT (DWG/DXF, scripts, no 3D viz), DraftAid (documents existing geometry only).
- **Mesh/aesthetic (NOT engineering):** Meshy, Hunyuan 3D — explicitly unfit for CNC/production.
- **Physics surrogates:** PhysicsX (best-funded), SimScale+NVIDIA, Neural Concept.
- **Megafund world-model:** Project Prometheus ($12B), with NVIDIA Cosmos/Omniverse as the infra layer.
- **Note:** *Nabla* in this list is a **healthcare** copilot (medical scribe, $70M+), **not CAD** — likely a brief mix-up; no CAD product found. *Augment* and *Spline* surfaced no engineering-CAD-specific 2026 signal in this pass (Spline = web 3D/design tooling, not engineering B-rep).

---

## 5. THE OPENINGS — what Archie/Forge must match or leapfrog (synthesis)

**Match (table stakes the frontier has set):**
- Agentic Plan→Act→Observe loop over a real kernel ✅ (have it).
- Multi-view render-feedback *inside* the generation loop (tighten: VLM self-correct before "done").
- A posted CADGenBench geometry-truth score (credibility currency; we have ForgeCADScore).
- STEP in/out as the universal interface.

**Leapfrog (their stated, unsolved gaps = our wedge):**
1. **Multimodal-first input** — engineering drawing / photo / sketch → exact model (beats text-only Zookeeper; = CADGenBench task #1; = user's VLM directive).
2. **STEP/STL → parametric feature-tree reconstruction** (Zoo's explicit gap; CADCL shows feasibility) — unlocks the "edit existing part" workflow that is 80% of real work.
3. **Dynamic assemblies + mechanisms** driven by Forge's already-validated multibody DAE solver (AADvark proves nobody else can; = user's dynamic-structures directive).
4. **DFM/validity gate that blocks completion** on tolerance/wall-thickness/draft/interference failures (bridge our bound-but-not-bridged PMI/tolerance/interference).
5. **Learned surrogate layer over Forge's validated FEA/CFD** for instant ideation-time physics (our ground truth > their approximations).
6. **Retrieval + adapt** (part search, dedup, find-and-edit) — the *measurable* time-saver every honest review names, which generative-only competitors ignore.
7. **Differentiable/point-supervised geometry mode** to break past blockout fidelity toward reference-matching detail.

**The narrative to own:** while Prometheus spends $12B and years building a learned world model from scratch, Forge already ships the *grounded* version — a real, validated physics+B-rep kernel that an agent (Archie) drives via computer-use to produce **exact, editable, manufacturable, simulation-verified** CAD today. The frontier has validated our architecture; the hard engineering-grade core they all punt on is exactly what we've built.

---

## Sources
- [Jeff Bezos's Prometheus raises $12B — TechCrunch](https://techcrunch.com/2026/06/11/jeff-bezoss-prometheus-raises-12b-to-build-an-artificial-general-engineer-for-the-physical-world/)
- [Inside Project Prometheus — Built In](https://builtin.com/articles/what-is-project-prometheus)
- [Project Prometheus (company) — Wikipedia](https://en.wikipedia.org/wiki/Project_Prometheus_(company))
- [Zookeeper: Conversational CAD Agent — Zoo](https://zoo.dev/research/zookeeper)
- [Zoo ML/Design API](https://zoo.dev/machine-learning-api)
- [Text-to-CAD — Hacker News (2026 thread)](https://news.ycombinator.com/item?id=47970497)
- [Text-to-CAD: Risks and Opportunities — Hacker News](https://news.ycombinator.com/item?id=37949504)
- [AI CAD Design in 2026: What's Real, What's Hype — Leo AI](https://www.getleo.ai/blog/ai-cad-design-2026-whats-real)
- [Best AI for CAD Generation 2026 — Leo AI](https://www.getleo.ai/blog/best-ai-for-cad-generation-2026)
- [Leo AI generates full CAD assemblies — Engineering.com](https://www.engineering.com/leo-ai-can-now-generate-full-cad-assemblies/)
- [We Tested 7 Text-to-CAD Tools — Xometry Pro](https://xometry.pro/en-eu/articles/text-to-cad-tools-test/)
- [Best 8 AI CAD Tools 2026 we tested — RapidDirect](https://www.rapiddirect.com/blog/best-ai-cad-tools-review/)
- [AdamCAD Review (YC W25, $4.1M)](https://pasqualepillitteri.it/en/news/3372/adamcad-text-to-cad-ai-review-2026)
- [Best AI CAD Software 2026 — The CAD Hub](https://thecadhub.com/blog/smarter-cad-with-ai/)
- [PhysicsX raises $135M Series B — TechFundingNews](https://techfundingnews.com/physicsx-135m-series-b-atomico-ai-engineering/)
- [100,000 Simulations a Day — Siemens podcast](https://blogs.sw.siemens.com/podcasts/engineer-innovation/100000-simulations-a-day-ai-powered-simulation-with-physicsx/)
- [PhysicsX: Foundation Models for Geometry and Physics (LPM/LGM)](https://www.physicsx.ai/newsroom/building-beyond-human-imagination-with-foundation-models-for-geometry-and-physics)
- [SimScale first foundation AI model for centrifugal pump (NVIDIA PhysicsNeMo)](https://www.simscale.com/blog/the-first-ai-foundation-model-for-pump-simulation-with-nvidia/)
- [NVIDIA Cosmos World Foundation Models](https://www.nvidia.com/en-us/ai/cosmos/)
- [NVIDIA PhysicsNeMo](https://developer.nvidia.com/physicsnemo)
- [Cadence Autonomous Virtual Engineer for Chip Design](https://www.cadence.com/en_US/home/company/newsroom/press-releases/pr/2026/cadence-unveils-industrys-first-fully-autonomous-virtual.html)
- [Agent-Aided Design for Dynamic CAD Models (AADvark) — arXiv 2604.15184](https://arxiv.org/html/2604.15184v1)
- [DreamCAD: Differentiable Parametric Surfaces — arXiv 2603.05607](https://arxiv.org/pdf/2603.05607)
- [NURBGen: Text-to-CAD via LLM-Driven NURBS — arXiv 2511.06194](https://arxiv.org/pdf/2511.06194)
- [TOOLCAD: Tool-Using LLMs for Text-to-CAD with RL — arXiv 2604.07960](https://arxiv.org/pdf/2604.07960)
- [STEP-LLM: NL → CAD STEP Models — arXiv 2601.12641](https://arxiv.org/pdf/2601.12641)
- [Survey of AI for Geometry/Mesh Generation in Simulation — arXiv 2512.23719](https://arxiv.org/html/2512.23719v1)
- [Topology Optimization vs Generative Design — Leo AI](https://www.getleo.ai/blog/topology-optimization-vs-generative-design)
- [Generative AI Topology Optimization — PatSnap](https://www.patsnap.com/resources/blog/rd-blog/generative-ai-topology-optimization-patsnap-eureka/)
