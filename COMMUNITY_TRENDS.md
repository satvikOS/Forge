# Community Trends — Public Engineering-Community Survey → Forge Roadmap & CADGenBench Map

> **Live research task F (Forge Engineering Bible).** Targeted public-page survey
> (NOT a scrape) of engineering communities and forums — r/MechanicalEngineering
> and adjacent CAD / CFD / FEA / manufacturing / 3D-printing / GD&T / additive /
> PLM discussions, plus engineering forums (Eng-Tips) and CAD-vendor / review
> communities. Recurring pain points, in-demand capabilities, and hard technical
> problems are synthesized, then mapped to (i) Forge's roadmap and (ii) the
> CADGenBench scoring dimensions.
>
> **Honesty contract (Bible rules 0/9).** Every external claim carries a real,
> accessible source URL. Every repo claim carries a real `file:line` (or
> `file`-level) reference checked this session. Where a page was **bot-blocked
> (HTTP 403 / JS-rendered shell)** I say so and fall back to the search engine's
> own page-read summary, marked **[search-summarized, page not directly
> fetched]** — I do not pretend I read the page body. Anything non-public,
> unmeasured, or not-yet-built is marked **TODO / UNVERIFIED**. A correct "not
> implemented" beats a fake "working."
>
> _Compiled 2026-06-20._

---

## 0. Method & honesty notes

- **Search**: `WebSearch` across the named domains; queries listed inline per
  section. Search results return the engine's own model-read summary of the
  live pages — those summaries are quoted/attributed but are **not** a substitute
  for fetching the page body.
- **Fetch**: `WebFetch` was used to pull primary sources. Several high-signal
  pages **blocked automated fetch**: Xometry Pro (`xometry.pro`, HTTP 403),
  Quality Magazine (HTTP 403), Eng-Tips thread bodies (HTTP 403), The Gradient /
  arXiv PDF (paywalled preview / binary). These are cited as **search-summarized**
  and flagged. Pages that **did** fetch cleanly: the **CADGenBench GitHub README**
  (the external benchmark Forge maps to) and a CAD-interoperability failure-mode
  article — these anchor the load-bearing claims.
- **Reddit**: Direct r/MechanicalEngineering / r/cad thread URLs did **not**
  surface in US-only search (the engine returned forum/blog aggregations of the
  same sentiment instead). I therefore cite the **aggregated/secondary** community
  sentiment and mark it **[secondary — specific Reddit permalink not retrieved]**
  rather than fabricate a thread link. **TODO**: capture specific permalinks via a
  Reddit-native search if a primary-thread citation is required.
- **Repo state caveat**: `docs/ARCHDISC_VISION_AND_ROADMAP.md` is dated
  **2026-05-18** and describes the **manifold-3d (mesh-boolean) era**. The kernel
  has since moved to a **native OCCT 7.9.3 B-rep** kernel (confirmed below); where
  the old roadmap text conflicts with current state I note both. Do not read the
  2026-05-18 "mesh booleans only" framing as current.

---

## 1. Forge ground-truth (repo evidence, verified this session)

These are the internal anchors the community findings are mapped against. Each was
opened/grepped this session.

| Claim | Evidence (`file` / `file:line`) |
|---|---|
| Native **OCCT 7.9.3 B-rep** kernel (not mesh-only) | `README.md:4,10`; `forge-kernel/REQUIREMENTS.md:6,18`; `forge-kernel/CMakeLists.txt:36-39` |
| **ForgeCADScore** geometry-truth scorer (CADGenBench metric) | `forge-kernel/test/cadscore_harness.mjs:1-46` (header), score axes at `:464` (shape), `:532` (interface jig), `:596` (mate fit jig), `:699` (topology/Betti), `:709` (dimension-L1) |
| CAD-score formula `gate*(0.4*shape+0.4*interface+0.2*topology)` | `forge-kernel/test/cadscore_harness.mjs:6-17` |
| Validity gate = closed ∧ manifold ∧ oriented ∧ ¬self-intersect ∧ no bad faces | `forge-kernel/test/cadscore_harness.mjs:433-440` (`checkValid` → `heal.checkValidity`) |
| ≥6 diverse part fixtures, each a different prompt; corruption discrimination proof | `forge-kernel/test/cadscore_harness.mjs:925-951` (FIXTURE_SPECS), `:956+` (corruptCalls) |
| PMI / GD&T-as-annotation + interference + tolerance bound in C++ | `forge-kernel/src/binding.cpp`, `forge-kernel/src/IoExchange.cpp`, `forge-kernel/src/InterferenceDetection.cpp` (grep: `exportStepWithPmi`, `detectInterference`) |
| Honest parity scores (not aspirational) | `PARITY_AUDIT_2026-06-15.md` |
| Kernel capability roadmap (blending/surfacing/booleans/healing) | `docs/ARCHDISC_VISION_AND_ROADMAP.md:99-145` (§3) |
| Bridge registry exposes a subset of the kernel (the "bound-not-bridged" gap) | `frontend/src/ai/ForgeToolBridge.js` (173 KB; PMI/tolerance bound in C++ but absent from the verb registry — per `memory/archie-cadgenbench-program-20260616.md`) |

**Honest Forge parity snapshot** (`PARITY_AUDIT_2026-06-15.md`, self-described as
"honest, not aspirational"):

| Dimension | Peer | Forge parity |
|---|---|---|
| Solid + parametric modeling | SolidWorks / Fusion 360 | ~70% (one audit agent errored; estimate) |
| Freeform / NURBS surfacing + Class-A | CATIA / NX / Alias | 58% |
| Assembly + mates + standard parts | SolidWorks / Inventor | 35% |
| Drawings + GD&T + simulation + CAM | SolidWorks / ANSYS / Fusion CAM | 28% |
| AI-driven design (plan→drive→gate→staged) | text-to-CAD baseline | 72% (leading) |

So the community's pain points below should be read against where Forge is
**weak** (assembly 35%, GD&T/drawings/sim/CAM 28%) vs **strong/leading**
(AI-driven 72%, solid modeling ~70%).

---

## 2. The external CADGenBench (verified, directly fetched)

This is the public benchmark Forge's `ForgeCADScore` re-implements. The
**GitHub README fetched cleanly** (the HF Space itself is a JS-rendered shell that
returned only a loading page, so the README is the authoritative fetchable source).

- **Owner / collaboration**: HuggingFace × **Mecado** (a CAD-native engineering-AI
  data company). [search-summarized for the collaboration framing]
- **Two tasks** (verbatim from README via fetch):
  1. **Generation** — "from an engineering drawing of a part, produce a valid,
     geometrically correct 3D model."
  2. **Editing** — "given an existing STEP file and a requested change, apply that
     change."
- **Four scoring dimensions** (verbatim from README via fetch):
  - **Validity** — "Is the BREP well-formed/watertight…manifold/orientable?" Acts
    as a **gate** that "zeroes the rest" if failed.
  - **Shape Similarity** — "surface distance F1, volume IoU."
  - **Interface Match** — "mating-feature correctness via authored keep-in /
    keep-out sub-volumes."
  - **Topology Match** — "Betti numbers (b0, b1, b2) of the tessellated boundary."
- **CAD Score** — "a weighted combination of the applicable component scores,
  gated by validity" (README does not inline the weights).

**This is a 1:1 match with Forge's `cadscore_harness.mjs`** (`:6-17` formula,
`:287` surface-F1 Chamfer, `:464` volume-IoU + bbox + F1 shape, `:532`
keep-in/keep-out interface jig, `:699` Betti topology). Forge additionally adds a
**dimension-L1** diagnostic axis (`:709`) not in the four headline metrics, and a
**multi-body mate/fit jig** (`:596`) that extends interface scoring to two coaxial
bodies (shaft+bore running/press fit) — both are **Forge extensions beyond the
public benchmark**, validated in-repo (the harness proves discrimination: a
correct replay scores ≈1.0 vs a corrupted part ≈0.456, per
`memory/archie-cadgenbench-program-20260616.md`; that 1.000-vs-0.456 number is an
**internal measurement, not yet posted to the public leaderboard → UNVERIFIED
externally**).

Sources: [CADGenBench GitHub README](https://github.com/huggingface/cadgenbench)
(fetched); [CADGenBench HF Space](https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench)
(JS shell, not directly fetched — listed for completeness).

---

## 3. Synthesized community pain points → Forge roadmap → CADGenBench dimension

Each row: a recurring community theme, a representative source, the Forge roadmap
item it maps to (with repo evidence and honest status), and the CADGenBench
dimension it scores against.

### 3.1 Text-to-CAD / AI-CAD: accuracy collapses with complexity; output isn't editable / isn't STEP

**What the community says.** When **Xometry tested 7 text-to-CAD tools (Aug 2025)**:
simple parts (a 20 mm cylinder) were "reasonably" handled, but **most tools failed
at medium complexity (a 24-tooth gear)** and at **high complexity (a manifold block
with internal channels) "either produced simplified approximations or couldn't
generate results at all."** Identified limitations: **"lack of control, inconsistent
file exports, and minimal support for complex assemblies or functional constraints,"**
and the tools "aren't yet a substitute for professional CAD software." A recurring
export failure: tools "export in STL by default rather than STEP, so the parametric
nature of the script does not survive." Engineer sentiment on forums: *"I don't see
this being faster than just doing it yourself."*

- **Sources** (Xometry page **HTTP 403 — search-summarized, page not directly
  fetched**): [Xometry Pro: "We Tested 7 Text-to-CAD Tools"](https://xometry.pro/en/articles/text-to-cad-tools-test/).
  Corroborating essays (accessible): [The Gradient: Text-to-CAD Risks & Opportunities](https://thegradientpub.substack.com/p/text-to-cad-risks-and-opportunities)
  (preview only — full body not fetched); [Mechanomy: "Text to CAD?"](https://mechanomy.substack.com/p/text-to-cad).
  Sentiment **[secondary — Reddit permalink not retrieved]**.

- **→ Forge roadmap.** This is Forge's **core thesis and strongest axis** (AI-driven
  72%, `PARITY_AUDIT_2026-06-15.md`). Forge's answers to the three failure modes:
  - *Complexity collapse* → native **OCCT B-rep** build instead of mesh/script, so a
    gear or manifold is built with real `part.bolt-circle`, `part.pattern-feature`,
    `part.revolve`, `part.pipe` verbs (`cadscore_harness.mjs:91-101` system prompt
    enumerates them). **Honest status**: the **ladder probe** (`ladder_probe.mjs`,
    per `memory/archie-cadgenbench-program-20260616.md`) measured the **caps2 model
    at ladder_score 0.418, clearing 0.70 on ZERO of 10 tasks** — the model still
    breaks long multi-step boolean chains (wrong handle ids → disconnected solids)
    and **hallucinates fake one-shot verbs** (`asset.make-impeller`) on hard parts.
    So Forge's *kernel* can build these, but Archie's *driving* of complex parts is
    **measured-weak and actively being retrained → TODO**, not solved.
  - *Non-editable output* → Forge emits a **parametric tool-call sequence** with
    named dimensions, not a frozen mesh; the **dimension-L1** axis
    (`cadscore_harness.mjs:709`) directly scores whether emitted args match the
    prompt's named numbers.
  - *Not STEP* → Forge exports real **AP242 STEP** with PMI (`IoExchange.cpp`
    `exportStepWithPmi`); the scorer even round-trips export→reimport→revalidate
    (`cadscore_harness.mjs:443` `stepRoundTrip`).
- **→ CADGenBench dimension.** **Validity gate** (does it even produce a watertight
  solid — the thing most tools fail) + **Shape** (does the gear/manifold match) +
  **dimension-L1** (did the 24 teeth / channel sizes land). This row is the entire
  benchmark's reason to exist.

### 3.2 GD&T: datum-reference-frame and tolerance-stack-up errors are the #1 print mistake

**What the community says.** GD&T stack-ups are more complex than simple ±
arithmetic because geometric controls add tolerance budget in ways that depend on
datum sequence and feature relationships. The **datum reference
frame (DRF)** changes the effective stack path because locational controls
reference the DRF rather than chaining between features. **[Verification note:
the *directly-fetched* GD&T Basics "Avoiding Tolerance Stacks" article confirms the
DRF-not-chaining mechanism but does NOT itself discuss "part-size dependence" or
"complexity beyond simple addition"; that stronger framing rests on the 403-blocked
Eng-Tips / Quality Magazine sources and is therefore search-summarized, not
quote-verified. The earlier verbatim-quote styling has been softened accordingly.]** Recurring pitfalls:
**stacked/nested tolerance zones with unclear order of precedence; composite
position vs profile ambiguity (do datums apply simultaneously or separately);
over-tolerancing → rejects + cost; measurement method inconsistent with the
tolerance definition.** Eng-Tips threads debate concretely how **true position
interacts with datum references** in a stack.

- **Sources**: [Eng-Tips: "Simple GD&T Tolerance Stack-up — Influence of True Position…"](https://www.eng-tips.com/threads/simple-gd-t-tolerance-stack-up-influence-of-true-position-on-calculated-dimension.585478/)
  (**HTTP 403 — search-summarized, body not fetched**); [Quality Magazine:
  "Misused & Misunderstood: Common GD&T and Datum Pitfalls"](https://www.qualitymag.com/articles/99095-misused-and-misunderstood-common-gd-and-t-and-datum-pitfalls-on-engineering-prints)
  (**HTTP 403 — search-summarized**); [GD&T Basics: Avoiding Tolerance Stacks with GD&T](https://www.gdandtbasics.com/avoiding-tolerance-stacks-with-gdt/);
  [GD&T Basics: Chain vs Baseline Dimensioning](https://www.gdandtbasics.com/tolerance-stackup-chain-vs-baseline/).
  Semantic-GD&T-in-STEP adoption pain: [Springer/IJIDeM: Semantic GD&T from STEP AP242](https://link.springer.com/article/10.1007/s12008-023-01242-7).

- **→ Forge roadmap.** This is Forge's **weakest axis** (drawings/GD&T/sim/CAM **28%**,
  `PARITY_AUDIT_2026-06-15.md`). Honest current state:
  - Forge can **write** PMI/GD&T feature-control-frame strings + datum letters into
    **AP242 STEP** (`simulate`/`part.annotate-pmi` per `cadscore_harness.mjs:102`;
    `IoExchange.cpp` `exportStepWithPmi`) — but this is **annotation only**.
  - Tolerance stack-up exists as a **1-D numeric worst-case + RSS + Monte-Carlo**
    routine (`simulate.tolerance-stack`, `cadscore_harness.mjs:102`; C++
    `tolerance.compute` in `binding.cpp`).
  - **The hard part the community describes — a real geometric DRF / FCF evaluator
    with MMC/LMC bonus-tolerance math — does NOT exist.** Per
    `memory/archie-cadgenbench-program-20260616.md`: *"NO geometric GD&T evaluator
    (no datum-frame/FCF/MMC math) — honest gateable claim = fit/clearance via
    detectInterference, NOT symbolic FCF verification."* **TODO / explicitly
    not-built.** The `PARITY_AUDIT` top-gaps list literally names *"GD&T as live
    constraints (not annotations) + tolerance stack (worst-case/RSS)"* as the work
    remaining.
- **→ CADGenBench dimension.** **Interface Match** (keep-in/keep-out sub-volumes =
  the mating-feature / functional-fit axis; `cadscore_harness.mjs:532`) is the
  benchmark's GD&T-adjacent axis, and Forge's **multi-body fit jig**
  (`:596`, running/press fit via real `detectInterference` boolean) is the most
  defensible thing Forge can *measure* today — but note it scores **fit, not
  symbolic FCF compliance**. The full datum-frame math is roadmap, not built.

### 3.3 Large assemblies: slow loads, full rebuilds, lost mate/external references

**What the community says.** "Large CAD assemblies load slowly because full CAD
rebuilds all geometry"; as part counts grow the system "must load more geometry,
solve more functions… leading to slower performance" and "lags or crashes." A
single **mate flip or line-ID change can corrupt an entire assembly**, and
**"experienced CAD users have wasted entire days"** chasing it. **Top-down design
creates external references that break** when files are renamed/moved. Engineers
reportedly **"waste up to 19% of their time on non-value-added data management"**
(file search, revision hunting, rebuilding lost work).

- **Sources**: [Eng-Tips: How to Fix Broken External References](https://www.eng-tips.com/threads/how-to-fix-broken-external-references.517893/)
  (**HTTP 403 — search-summarized**); [GoEngineer: 7 Ways to Improve Large Assembly Performance](https://www.goengineer.com/blog/7-ways-improve-solidworks-large-assembly-drawing-performance);
  [CAD Rooms: Why Large CAD Assemblies Load Slowly](https://blog.cadrooms.com/why-large-cad-assemblies-load-slowly/);
  [Propel/Converged: PLM-CAD integration is brittle](https://converged.propelsoftware.com/blogs/solving-plm-cad-integration-inside-designhubs-multi-cad-solution).
  SolidWorks instability/large-assembly-lag complaints aggregated in
  [Capterra SolidWorks reviews](https://capterra.com/p/93121/SolidWorks-Premium/reviews/)
  (**review-aggregator, search-summarized**).

- **→ Forge roadmap.** Forge is **architecturally strong on the perf half, weak on
  the assembly-semantics half**:
  - *Perf* — `PARITY.md §2` claims **100k addInstance in 311 ms**, **500k BVH build
    84.8 ms**, **500k tiny-AABB query 0.011 ms**, **reference-counted BREP de-dup**,
    **GPU instancing by shared sourceHandle**, **dirty-propagation rebuild engine
    + FNV-1a input-hash cache**, off-main-thread tessellation. These are **in-repo
    claims with named measurements** (Forge-4/25/44) — directly aimed at the
    "full-rebuild-is-slow / large-assembly-lag" pain. (Measurements are
    **repo-asserted, not independently re-run this session → trust the file, verify
    on demand**.) The **107k-component zoned-facility generator**
    (`window.__forgeBuildEnvironment`, per `memory/forge-100k-environment-20260615.md`)
    is the stress demo.
  - *Assembly semantics* — Forge is **35%** here (`PARITY_AUDIT_2026-06-15.md`). It
    has `assembly.add-instance/add-mate/set-fixed/solve/query-aabb/detectInterference`
    (`cadscore_harness.mjs:82,617-619`) but the audit's own top-gap list names the
    missing pieces: *"more mate kinds (symmetric/screw/slot/gear), smart/auto mates,
    fastener catalogue with threads + material grades, sub-assembly internal
    mates."* The **broken-external-reference / persistent-selector** problem maps to
    Forge's **persistent topo-ID registry** (`PARITY.md §1`: Forge-47
    `ForgeTopoIdRegistry` + Forge-59 LineageEmitter) — but that note **honestly flags
    it derives survivor/split IDs by tessellation matching because the native OCCT
    `Modified()/Generated()` path "has not landed"** → **partial, TODO**.
- **→ CADGenBench dimension.** Mostly **out of the single-part benchmark's scope**
  today (CADGenBench scores a part, not a 10k-part assembly). The closest axes:
  **Interface Match** (do mates/fits hold) and **Topology Match** (`b0` =
  connected-component count, `cadscore_harness.mjs:358-419`) — a lost mate that
  leaves bodies disconnected shows up as wrong `b0`. **Multi-part assembly-context
  scoring is a Forge corpus direction** (`assembly_context`, `gdt_assembly`,
  `multibody` dirs exist in `archdisc-Models/data/forge/`) but **not part of the
  public CADGenBench metric → Forge extension, UNVERIFIED externally**.

### 3.4 Interoperability: STEP/IGES import yields broken, un-editable, healing-required geometry

**What the community says.** (Directly fetched source.) Imported models exhibit
**"micro-gaps, sliver faces, or non-manifold edges"** that crash meshing and fail
booleans; **fillets/chamfers disappear or change radius**; **surface normals flip**;
parametric history strips so **"features turn into 'dumb solids'"**; **holes shift
(even 0.2 mm) or merge**; **thread metadata and hole callouts get dropped**; solids
arrive as **"sheet bodies instead of solids"**; mass properties shift; **PMI,
layers, materials, colors get stripped**. Classic IGES failure = **topological
fragmentation** (a solid decomposes into disjoint surfaces needing stitch+heal).

- **Sources**: [ProtoTech: 10 Signs Your CAD Interoperability Workflow Is Breaking Models](https://blog.prototechsolutions.com/10-signs-cad-interoperability-workflow-breaking-models/)
  (**fetched cleanly**); [GoEngineer: STEP & IGES — Avoiding Import Issues](https://www.goengineer.com/blog/step-and-iges-files-avoiding-import-issues);
  [Engineers Rule: Is the CAD Interoperability Problem Over?](https://www.engineersrule.com/is-the-cad-interoperability-problem-over/).

- **→ Forge roadmap.** Maps to Forge's **healing suite** and the **validity gate**:
  - Healing = `heal.checkValidity` + 5 fixers (`PARITY.md §1` Forge-23;
    `cadscore_harness.mjs:433-440` calls `heal.checkValidity` for the gate). The
    gate's predicate (closed ∧ manifold ∧ oriented ∧ ¬self-intersect ∧ no bad faces)
    is **exactly the set of defects** the interoperability article lists
    (non-manifold edges, flipped normals, sliver/bad faces).
  - STEP round-trip validation already implemented (`cadscore_harness.mjs:443`
    `stepRoundTrip`) — Forge **re-imports its own export and re-gates it**, which is
    the discipline this pain-point demands.
  - **Honest gap**: the §3.6 roadmap items (`docs/ARCHDISC_VISION_AND_ROADMAP.md`)
    around convergent modeling / clash were the old plan; Forge does **author** clean
    geometry but a **robust import-and-heal of arbitrary third-party STEP/IGES** is
    **not a measured-validated workflow in-repo this session → TODO / UNVERIFIED**.
- **→ CADGenBench dimension.** **Validity gate** (the whole point — is the BREP
  watertight/manifold/orientable) + **Topology Match** (sheet-body-instead-of-solid
  → wrong `b2`; fragmented solid → wrong `b0`). This pain-point is *the* validity
  axis in human form.

### 3.5 FEA/CFD: meshing is tedious, mesh-dependent, and convergence/setup is the bottleneck

**What the community says.** **"Meshing can be a very tedious and lengthy process…
for a complex structure,"** and even after meshing, **"analysis setup may also take
a while."** Results carry **mesh dependency** — coarser meshes mean fewer nodes →
**less accurate solutions** → engineers must run **mesh-independence / convergence
studies** to trust a result. The most-frustrating-part sentiment names **setup time
+ trusting convergence** as the core pain.

- **Sources**: [Quora: "What is the most frustrating part about engineering simulations (FEA, CFD)?"](https://www.quora.com/What-is-the-most-frustrating-part-about-engineering-simulations-FEA-CFD-etc)
  (**search-summarized — page not directly fetched**); FEA mesh-independence study
  reviews on [Coursera](https://www.coursera.org/projects/finite-element-analysis-convergence-and-mesh-independence-study-mw7ah).

- **→ Forge roadmap.** Forge has a **real in-house FEA** (static / modal / dynamic;
  `cadscore_harness.mjs:85` `simulate.fea-static/-modal/-dynamic`) with an
  **off-main-thread worker pool** (`PARITY.md §2`: Forge-44 `FeaWorkerPool` +
  Forge-52 real worker file). Per `FORGE_PHYSICS_VERIFICATION.md` +
  `memory/forge-physics-rigor-met-20260618.md`, the kernel is described as
  **"MIT-PhD-validated, 7 analytical gates pass"** (static 0.33%, modal 0.2% via
  Wilson-Q6 de-locking, multibody pendulum 0.016% via a new HHT-α DAE solver),
  with **turbulent CFD the one named open gap**. These are **in-repo verification
  claims** — strong on the *solver-accuracy* axis the community cares about.
  **Honest status**: the community's deepest pain is **meshing UX + convergence
  automation**, and there is **no in-repo evidence this session of an automated
  mesh-independence / adaptive-refinement loop** — Forge's strength is solver
  correctness on given meshes, not the meshing-and-convergence workflow → that loop
  is **TODO / UNVERIFIED**. (The `PARITY_AUDIT` also lists *"thermal/nonlinear FEA"*
  as a remaining gap.)
- **→ CADGenBench dimension.** **Out of scope** — CADGenBench scores generated
  geometry, not simulation results. Mapped here as **adjacent demand**, not a
  benchmark axis. Forge's sim is a **differentiator vs pure text-to-CAD tools**
  (which have no sim at all — §3.1), not a CADGenBench score.

### 3.6 Additive / DfAM: supports, overhangs, min-feature-size, self-supporting topology optimization

**What the community says.** DfAM's hard problems: **support-structure optimization**
(supports stabilize the build but add material/cost/post-processing); **overhang
features** (layer-by-layer fabrication fails on overhangs unless inclination angles
are controlled → "overhang-free" / "self-supporting" topology optimization);
**minimum feature size** ("walls or void diameters too small may not be fabricable
even with AM"); **distortion compensation** preserving the optimized structure
through the print.

- **Sources**: [Springer/JOM: DfAM — A Comprehensive Review](https://link.springer.com/article/10.1007/s11837-025-07164-x);
  [arXiv: GNN-Based Topology Optimization for Self-Supporting AM Structures](https://arxiv.org/pdf/2508.19169);
  [arXiv: Explicit TO for self-supporting AM](https://arxiv.org/pdf/1704.06579);
  [Unionfab: DfAM guide](https://www.unionfab.com/blog/2023/11/dfam-design-for-additive-manufacturing).

- **→ Forge roadmap.** Partial. Forge has **generative/SIMP topology optimization**
  (per `memory/feedback-forge-native-no-deps.md` — "in-house … SIMP") and
  **degradation/weathering** generation (a capability the audit notes *"no MCAD peer
  has at all"*). **Honest gap**: **DfAM-specific constraints — overhang-angle limits,
  self-supporting enforcement, min-feature-size, distortion compensation — are NOT
  evidenced in-repo this session.** Topology optimization exists; **AM-constrained**
  topology optimization is **TODO / UNVERIFIED**. Forge's `manufacture.*` verbs
  (`cadscore_harness.mjs:84`) are **CAM (profile/pocket/drill/gcode)**, i.e.
  subtractive 2.5-D, not additive build-prep → the additive-prep workflow is not
  present.
- **→ CADGenBench dimension.** **Out of scope** (CADGenBench is geometry-correctness,
  not manufacturability). Relevant only insofar as min-feature-size / self-support
  affect whether a generated solid is **valid + topologically sound** (validity +
  topology axes). Adjacent demand, not a benchmark axis. (Note: the **MUSE**
  benchmark — surfaced in search — *does* target "Manufacturable, Functional,
  Assemblable" text-to-CAD, which is the manufacturability axis CADGenBench omits:
  [arXiv MUSE](https://arxiv.org/html/2605.28579). **Potential future Forge target,
  not currently implemented → TODO.**)

### 3.7 Model-Based Definition (MBD) / semantic PMI: machine-readable GD&T-in-STEP is demanded but inconsistently implemented

**What the community says.** MBD **"embeds all manufacturing information — dimensions,
GD&T tolerances, surface finish, materials, notes — directly into the 3D model,
removing the need for 2D drawings."** **Semantic PMI** (vs graphical/presentation
PMI) is **machine-readable** so CNC/CMM/inspection programs can consume it
automatically. **Challenges**: graphical PMI is human-readable but hard for machines;
**implementation varies by CAD version** (the cited Springer/IJIDeM source confirms
that only semantic PMI — structured/interpretable by software — enables downstream
automation, and that STEP AP242 ed2/ed3 is the neutral carrier; the **specific
version-comparison "Catia V5-6R2024 converts semantic PMI correctly into AP242 ed2
whereas R2021 did not" could NOT be confirmed from the cited source this session →
UNVERIFIED, do not rely on the exact release numbers**); standardization suffers from
"diversity of views."

- **Sources**: [Springer/IJIDeM: Using semantic GD&T from STEP AP242 for robotics](https://link.springer.com/article/10.1007/s12008-023-01242-7);
  [MDPI: 3D PMI visualization from STEP AP242 + WebGL](https://www.mdpi.com/2076-3417/15/19/10847);
  [CADinterop: MBD/MBE approach](https://www.cadinterop.com/en/your-needs/mbd-mbe-approach.html).

- **→ Forge roadmap.** Forge **writes PMI into AP242 STEP with topo anchors**
  (`IoExchange.cpp` `exportStepWithPmi`; `cadscore_harness.mjs:102`
  `part.annotate-pmi`). Whether that output is **semantic (machine-consumable FCF
  structure)** vs **graphical/presentation PMI** is **not verified at the byte level
  this session → mark UNVERIFIED**; the program note's wording ("PMI/GD&T **text**
  annotation w/ topo anchors") suggests it is **annotation/text, not a fully
  semantic FCF datum-frame model**, consistent with the §3.2 "no geometric GD&T
  evaluator" gap. So: **PMI export exists; full semantic-MBD round-trip is TODO.**
- **→ CADGenBench dimension.** **Interface Match** is the closest benchmark proxy
  (functional features), but **semantic-PMI fidelity is not a CADGenBench scored
  axis** — it is adjacent demand and a Forge differentiator-in-progress.

---

## 4. Cross-cut synthesis — what the communities are really asking for

1. **"Make valid, watertight, editable solids — not approximate meshes."** Across
   text-to-CAD (§3.1) and interoperability (§3.4) the single loudest theme is
   **geometric validity**. This is precisely CADGenBench's **gate** and Forge's
   strongest defensible claim (native OCCT B-rep + validity gate +
   export→reimport→regate). **Built & validated in-kernel; Archie's *driving* of
   complex valid solids is measured-weak (ladder 0.418) → targeted.**

2. **"Get GD&T / MBD right — as live constraints, not just text."** §3.2 + §3.7.
   This is Forge's **biggest honest gap** (28% parity; **no geometric DRF/FCF/MMC
   evaluator**). Forge has PMI-annotation export + 1-D tolerance stack + fit/clearance
   via interference, which is real but **not** symbolic GD&T verification. **Targeted,
   explicitly not-built.** Maps to CADGenBench **Interface Match**.

3. **"Handle big assemblies fast, and don't break references."** §3.3. Forge is
   **strong on perf primitives** (100k–500k instance/BVH numbers in `PARITY.md §2`)
   and **weak on assembly semantics** (35%; partial persistent topo-IDs). Mostly
   **outside** the single-part CADGenBench scope; topology `b0` is the partial proxy.

4. **"Automate the tedious loops — meshing/convergence (§3.5), supports/overhangs
   (§3.6)."** Forge has **accurate solvers** and **SIMP topology optimization** but
   **no evidenced mesh-independence loop and no AM-constraint (self-support/overhang)
   loop** → these are the clearest **adjacent, not-yet-built** opportunities, and
   they sit **outside CADGenBench** (which scores geometry, not manufacturability —
   the **MUSE** benchmark is the manufacturability analogue to watch).

5. **"AI-CAD must be faster than doing it by hand, and trustworthy."** The forum
   sentiment *"I don't see this being faster than just doing it yourself"* is the bar.
   Forge's answer — **plan → drive → validity-gate → AutoCorrector → staged
   refinement** (the 72% AI axis) — is the right shape, but its credibility depends on
   **closing the ladder-probe gap (0.418 → >0.70)**, which is the active retrain
   front and is **honestly unmet today**.

---

## 5. Honest gaps & TODOs (what this survey could NOT verify)

- **No primary Reddit permalinks retrieved.** US-only `WebSearch` returned
  forum/blog/review aggregations of r/MechanicalEngineering & r/cad sentiment, not
  thread URLs. Sentiment is cited as **secondary**. **TODO**: Reddit-native search
  for primary permalinks if a direct community-thread citation is mandatory.
- **Bot-blocked primaries (HTTP 403 / JS shell):** Xometry Pro text-to-CAD test,
  Quality Magazine GD&T pitfalls, Eng-Tips thread bodies, The Gradient full essay,
  arXiv PDF body, HF CADGenBench Space. Claims from these are **search-summarized
  and flagged**; the **CADGenBench GitHub README** and **ProtoTech interoperability
  article** are the two load-bearing **directly-fetched** anchors.
- **In-repo performance & physics numbers** (100k/500k timings; FEA 0.33%/0.2%;
  pendulum 0.016%) are **repo-asserted** (`PARITY.md`, `FORGE_PHYSICS_VERIFICATION.md`,
  memory notes) and were **not re-run this session** — trust-the-file, verify-on-demand.
- **Forge's internal CADGenBench score** (replay 1.000 vs corrupt 0.456) is an
  **internal measurement** from `cadscore_harness.mjs`; it is **NOT posted to the
  public HF leaderboard → externally UNVERIFIED**. The public leaderboard's reported
  frontier (Fable-5 ~0.45; frontier ~0.35–0.39, per the program note) was
  **[search-summarized, leaderboard page is a JS shell and could not be directly
  fetched]**. **Adversarial-verification update**: the HF Space genuinely returns a
  loading shell ("Fetching metadata from the HF Docker repository… Refreshing") on
  fetch, so the table itself is unreadable by tool — confirmed. Independent search
  *does* corroborate a top CADGenBench score of **0.4514** and a frontier band around
  **~0.39**, consistent with the quoted ~0.45 / 0.35–0.39 range, and **"Fable-5" is a
  real current frontier model** (Claude Fable 5, released 2026-06-09, has documented
  text-to-CAD capability) — so the model name is NOT fabricated. The score-to-model
  attribution still rests on search aggregation, not the live leaderboard table →
  **the precise pairing remains externally UNVERIFIED**.
- **Explicitly not-built in Forge** (per repo evidence): geometric DRF/FCF/MMC GD&T
  evaluator; semantic-MBD round-trip verification; automated FEA/CFD
  mesh-independence loop; turbulent CFD; AM/DfAM constraint loop (overhang /
  self-support / min-feature / distortion); robust third-party STEP/IGES
  import-and-heal as a measured workflow; native OCCT `Modified()/Generated()`
  lineage path (currently tessellation-derived). All marked **TODO** above.

---

## 6. Source index

**Directly fetched (page body read this session):**
- CADGenBench GitHub README — https://github.com/huggingface/cadgenbench
- ProtoTech: 10 Signs CAD Interoperability Is Breaking Models — https://blog.prototechsolutions.com/10-signs-cad-interoperability-workflow-breaking-models/

**Search-summarized (engine model-read the live page; body not directly fetched / 403 / JS shell):**
- Xometry Pro — We Tested 7 Text-to-CAD Tools — https://xometry.pro/en/articles/text-to-cad-tools-test/ (403)
- Quality Magazine — Common GD&T & Datum Pitfalls — https://www.qualitymag.com/articles/99095-misused-and-misunderstood-common-gd-and-t-and-datum-pitfalls-on-engineering-prints (403)
- Eng-Tips — Simple GD&T Tolerance Stack-up / True Position — https://www.eng-tips.com/threads/simple-gd-t-tolerance-stack-up-influence-of-true-position-on-calculated-dimension.585478/ (403)
- Eng-Tips — Fix Broken External References — https://www.eng-tips.com/threads/how-to-fix-broken-external-references.517893/ (403)
- Quora — Most frustrating part of FEA/CFD — https://www.quora.com/What-is-the-most-frustrating-part-about-engineering-simulations-FEA-CFD-etc
- HF Space — CADGenBench Leaderboard — https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench (JS shell)
- Capterra — SolidWorks Premium reviews (instability/large-assembly lag) — https://capterra.com/p/93121/SolidWorks-Premium/reviews/

**Accessible corroborating (search-surfaced; cited for context):**
- The Gradient — Text-to-CAD Risks & Opportunities — https://thegradientpub.substack.com/p/text-to-cad-risks-and-opportunities
- Mechanomy — Text to CAD? — https://mechanomy.substack.com/p/text-to-cad
- GD&T Basics — Avoiding Tolerance Stacks / Chain vs Baseline — https://www.gdandtbasics.com/avoiding-tolerance-stacks-with-gdt/ , https://www.gdandtbasics.com/tolerance-stackup-chain-vs-baseline/
- GoEngineer — Large Assembly Performance / STEP-IGES Import — https://www.goengineer.com/blog/7-ways-improve-solidworks-large-assembly-drawing-performance , https://www.goengineer.com/blog/step-and-iges-files-avoiding-import-issues
- CAD Rooms — Why Large Assemblies Load Slowly — https://blog.cadrooms.com/why-large-cad-assemblies-load-slowly/
- Propel/Converged — PLM-CAD integration brittleness — https://converged.propelsoftware.com/blogs/solving-plm-cad-integration-inside-designhubs-multi-cad-solution
- Springer/JOM — DfAM Comprehensive Review — https://link.springer.com/article/10.1007/s11837-025-07164-x
- arXiv — Self-supporting AM topology optimization — https://arxiv.org/pdf/2508.19169 , https://arxiv.org/pdf/1704.06579
- Springer/IJIDeM — Semantic GD&T from STEP AP242 — https://link.springer.com/article/10.1007/s12008-023-01242-7
- MDPI — 3D PMI from STEP AP242 + WebGL — https://www.mdpi.com/2076-3417/15/19/10847
- arXiv — MUSE manufacturable text-to-CAD benchmark — https://arxiv.org/html/2605.28579

**Repo evidence (this session):** `forge-kernel/test/cadscore_harness.mjs`,
`forge-kernel/src/{binding,IoExchange,InterferenceDetection}.cpp`,
`forge-kernel/{README.md,REQUIREMENTS.md,CMakeLists.txt}`, `README.md`,
`PARITY.md`, `PARITY_AUDIT_2026-06-15.md`, `FORGE_PHYSICS_VERIFICATION.md`,
`docs/ARCHDISC_VISION_AND_ROADMAP.md`, `frontend/src/ai/ForgeToolBridge.js`,
and auto-memory `archie-cadgenbench-program-20260616.md`,
`forge-physics-rigor-met-20260618.md`, `forge-100k-environment-20260615.md`.

---

## Verification (adversarial)

Independent adversarial re-check of every **external** claim in this document
(2026-06-20). Each cited source was re-fetched or re-searched; the goal was to break
the claims, not confirm them. Repo `file:line` anchors were NOT re-audited here (that
is a separate internal-evidence task) — only the public/external assertions.

**What I checked and what HELD (sources real, accessible, and supporting the claim):**

- **CADGenBench GitHub README** (`github.com/huggingface/cadgenbench`) — re-fetched
  cleanly. Confirms the two tasks (Generation from a drawing → valid 3D model;
  Editing a STEP file), the four scoring dimensions (Validity gate / Shape similarity
  via surface-distance F1 + volume IoU / Interface match via keep-in/keep-out
  sub-volumes / Topology match via Betti numbers b0,b1,b2 of the tessellated
  boundary), and the "weighted combination gated by validity" CAD Score framing. All
  load-bearing benchmark claims in §2 are **accurate**.
- **Mecado × Hugging Face collaboration** — the README body alone does not name
  Mecado, but search corroborates the partnership (Mecado's own benchmark page; the
  benchmark author Michael Rabinovich's launch post). The file's original
  `[search-summarized]` flag on this framing was correct. **HELD.**
- **ProtoTech "10 Signs Your CAD Interoperability Workflow Is Breaking Models"** —
  re-fetched cleanly; all listed failure modes (micro-gaps/sliver/non-manifold,
  dumb-solids, fillet/chamfer corruption, hole shift + dropped thread/callout,
  flipped normals, mass-property drift, repetitive healing, PMI/layers/materials/
  colors stripped) match §3.4 verbatim in substance. **HELD.**
- **Xometry "We Tested 7 Text-to-CAD Tools"** — page is 403 to direct fetch (as the
  file states), but search corroborates the specifics: 20 mm cylinder (simple) handled,
  24-tooth gear (medium) mostly failed, manifold block with internal channels (high)
  → simplified approximations or no result; "aren't yet a substitute for professional
  CAD software"; STL-default-not-STEP export issue. **HELD** (correctly flagged
  search-summarized).
- **MUSE benchmark** (arXiv 2605.28579) — real; title and "Manufacturable, Functional,
  Assemblable" three-stage (code/geometric/design-intent) VLM-judge description match.
  **HELD.**
- **Springer/IJIDeM semantic-GD&T-from-AP242 article** (10.1007/s12008-023-01242-7) —
  real; title/topic and the semantic-vs-graphical-PMI machine-readability point are
  supported (article + search). **HELD** for the general MBD/semantic-PMI claims.
- **"Engineers waste up to 19% of their time on non-value-added data management"**
  (§3.3) — corroborated (Hawk Ridge Systems). Note a related ColAb study cites 23%;
  the specific 19% figure is supported. **HELD.**

**What was CORRECTED / DOWNGRADED:**

1. **§3.7 "Catia V5-6R2024 converts semantic PMI correctly into AP242 ed2, whereas
   R2021 did not."** The cited Springer source supports semantic-PMI / AP242-ed2/ed3
   generally, but the **exact release-version comparison could not be confirmed**.
   Reworded to drop reliance on the specific version numbers and marked **UNVERIFIED**.
2. **§3.2 GD&T stack-up framing.** The verbatim-styled quote ("more complex than
   simple ± arithmetic … depend on part size, datum sequence …") was presented as if
   quotable. The *directly-fetched* GD&T Basics article supports the
   DRF-not-chaining mechanism but **not** the "part-size dependence / complexity
   beyond addition" framing — that stronger wording traces to the 403-blocked
   Eng-Tips / Quality Magazine pages. The quote styling was **softened** and the
   provenance gap noted inline.
3. **§5 leaderboard line.** Strengthened the honesty note: the HF Space is confirmed a
   JS loading shell (unreadable by tool). Search **does** corroborate a top score
   ≈0.4514 and a ~0.39 frontier band, and **"Fable-5" is a real model** (Claude
   Fable 5, 2026-06-09, documented text-to-CAD) — so it is NOT a fabricated name. The
   precise score-to-model pairing still rests on search aggregation, so it remains
   **externally UNVERIFIED** pending a readable leaderboard.

**Standing UNVERIFIED items (unchanged, already honestly flagged in the doc):**

- All **in-repo performance/physics numbers** (100k/500k timings; FEA 0.33%/0.2%;
  pendulum 0.016%; replay-1.000-vs-corrupt-0.456) — internal, not re-run, not posted
  publicly. Trust-the-file / verify-on-demand.
- No **primary Reddit permalinks** — community sentiment remains secondary.
- 403/JS-shell primaries (Xometry, Quality Magazine, Eng-Tips bodies, HF Space) — the
  doc's `[search-summarized / 403]` flags are accurate and were re-confirmed.

**Verdict:** The external-claims layer of this document is **substantially sound** —
the two load-bearing directly-fetched anchors (CADGenBench README, ProtoTech) and the
major secondary claims (Xometry, MUSE, semantic-GD&T, 19% stat, leaderboard band) all
hold up. Two **minor overclaims** were corrected (the Catia version-comparison detail;
the over-quoted GD&T part-size framing). No fabricated sources were found; the
document's pre-existing honesty flags were honest and accurate.
