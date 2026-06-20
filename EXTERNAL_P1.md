# EXTERNAL_P1 — P-1 AI ("Archie") competitive/landscape brief

**Live research task D — Forge Engineering Bible rules 0 & 9 (honesty).**
Compiled 2026-06-20. Every external claim cites a real accessible URL; every Forge repo claim
cites real `file:line` evidence in `~/archdisc-Mech`. Non-public / unverifiable / not-yet-built
items are marked **UNVERIFIED** or **TODO** explicitly. No fabricated numbers.

> **Naming collision, stated up front:** P-1 AI's product agent is *also* named **Archie**, and
> Forge's foundational model is *also* called **Archie**. These are two unrelated "Archie"s. P-1's
> Archie is a hosted commercial agent; Forge's Archie is the local MLX-LM fleet in `~/archdisc-Models`.
> This document is about **P-1's** Archie except where it explicitly says "Forge".

---

## 0. Who they are (substantiated)

- **Company:** P-1 AI, Inc., San Francisco, CA. Site: <https://p-1.ai>.
- **Tagline / mission:** "building engineering AGI for the physical world" via an AI engineer agent
  named **Archie**. (<https://p-1.ai>, <https://radical.vc/portfolio/p-1-ai-2/>)
- **Came out of stealth:** April 2025, with a **$23M seed** led by **Radical Ventures**; other
  investors Village Global, Schematic Ventures, Lerer Hippeau, plus angels including **Jeff Dean**
  (Google), **Peter Welinder** (OpenAI), Bob van Luijt (Weaviate).
  (<https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/>,
  <https://medium.com/lerer-hippeau-ventures/please-welcome-p-1-ai-the-company-building-engineering-agi-for-the-physical-world-956c613a2b02>)
- **Founders (substantiated, independently reported):**
  - **Paul Eremenko** — CEO; former Airbus CTO and United Technologies CTO; former DARPA program manager.
  - **Aleksa Gordić** — former Google DeepMind / Microsoft ML engineer (DeepMind + Microsoft/HoloLens
    confirmed via his own site and multiple independent profiles; exact internal P-1 title "head of AI"
    **UNVERIFIED** by a primary source).
  - **Adam Nagel** — engineering leader, previously at Acubed (Airbus's Silicon Valley innovation center).
  - **Susmit Jha** — deep-learning / neurosymbolic-AI background (ex-SRI); co-author on their eval paper.
  (<https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/>,
  <https://itlogs.com/p-1-ai-raises-23-million-to-build-engineering-agi-co-founded-by-a-serbian-ai-expert/>)
- **One peer-reviewable artifact exists:** arXiv **2505.10653**, *"On the Evaluation of Engineering
  Artificial General Intelligence"* (Neema, Jha, Nagel, Lew, Sureshkumar, Gordić, Shimmin, Nguyen,
  Eremenko; submitted 15 May 2025). <https://arxiv.org/abs/2505.10653>

---

## (a) Publicly substantiated

Claims that appear in their own primary materials and/or independent press, and (where noted) in a
public arXiv paper. "Substantiated" here means *publicly stated / documented*, not *independently
benchmark-verified* — P-1 has published **no benchmark results** (see the caveat at the end of this bucket).

1. **Product framing.** Archie is positioned as an AI engineer agent "at the level of a junior
   mechanical and electrical engineer, with a quantitative multiphysics intuition over the product
   design space and the ability to use complex engineering tools." (<https://p-1.ai>)
2. **Concrete tasks claimed today.** Requirements distillation/interpretation, generating early design
   concepts, component sizing, design-trade analysis, detailed design analysis, and regulatory/compliance
   checking. (<https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/>,
   <https://radical.vc/portfolio/p-1-ai-2/>)
3. **Training approach — synthetic / "semi-synthetic" physics data.** Because historical design data is
   scarce, they generate "large, physics-based synthetic datasets" from physics simulations of real
   components (motors, pipes, shafts), explicitly analogized to how AlphaGo was trained. They describe the
   sets as "proprietary semi-synthetic training data sets."
   (<https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/>,
   <https://p-1.ai>)
4. **Architecture claim — a federation of specialized models orchestrated by an LLM.** The "federation of
   specialized models orchestrated by an LLM" wording is confirmed in the Sequoia deep-dive. The further
   "structured design representation" / keeping the models **"on rails"** phrasing was **NOT found** in the
   Sequoia article on re-fetch (2026-06-20); it is attributed to P-1's own site only and is **UNVERIFIED**
   against the independent source. (<https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres>
   — federation only; "on rails" not present)
5. **First deployment domain — data-center cooling / HVAC.** Stated entry market; cited part-complexity
   anchor of ~**1,000 unique parts** for current data-center-cooling systems.
   (<https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres>)
6. **Scaling roadmap (stated plan, not achieved).** Increase system complexity by ~an order of magnitude
   per year, from ~1,000-part data-center cooling toward ~**1,000,000-part aerospace systems**.
   (<https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres>)
7. **Evaluation framework exists publicly (arXiv 2505.10653).** They specialize **Bloom's taxonomy**
   into an engineering-design context to produce an "extensible evaluation framework" that "can evaluate
   structured design artifacts such as CAD models and SysML models," spanning methodological knowledge
   through real-world design problems. (<https://arxiv.org/abs/2505.10653>)
8. **Delivery model.** Pitched as a remote teammate accessible via Slack/Teams rather than licensed
   software. (<https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres>)

> **Substantiation caveat (important, per honesty rules):** I found **no published quantitative
> benchmark/performance numbers** for P-1's Archie. The arXiv paper 2505.10653 is a *proposed evaluation
> framework with no reported scores for any model* (verified via fetch of the abstract page —
> <https://arxiv.org/abs/2505.10653>). The "junior mechanical/electrical engineer level" claim is a
> self-description, **UNVERIFIED** by any public benchmark. Treat every capability statement in this bucket
> as "publicly claimed/documented," not "independently measured."

---

## (b) Marketing / unverified

1. **"Engineering AGI" / "eAGI."** The framing itself is a marketing position; no public evidence of
   general engineering intelligence, only the data-center-cooling entry use case. (<https://p-1.ai>)
2. **"Junior mechanical and electrical engineer level."** Self-assessed capability with **no public
   benchmark** behind it. **UNVERIFIED.** (<https://p-1.ai>)
3. **"Starships and Dyson spheres."** Eremenko's stated long-horizon vision ("I want an AI
   superintelligence that can build us starships and Dyson spheres"); explicitly aspirational, not
   demonstrated. (<https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/>)
4. **The order-of-magnitude-per-year scaling roadmap** (1k → 1M parts) is a *plan*; no public evidence any
   rung beyond the ~1k-part data-center-cooling entry has been demonstrated. **UNVERIFIED.**
   (<https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres>)
5. **"Quantitative multiphysics intuition over the product design space."** Marketing phrasing; the only
   public technical artifact (arXiv 2505.10653) is an *evaluation* framework, not a demonstration of this
   intuition with results. **UNVERIFIED.** (<https://p-1.ai>, <https://arxiv.org/abs/2505.10653>)
6. **"Federation of specialized models orchestrated by an LLM."** Architecture is *described* but no
   public technical paper details or benchmarks it; treat as a claimed design, not a verified result.
   **UNVERIFIED.** (<https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres>)
7. **Non-public items I could not verify (explicit gaps):** team headcount accuracy, exact synthetic-data
   volume, model sizes, which simulation engines they use, any customer/revenue, and whether Archie ships
   working STEP/CAD output. The IBM "Think" deep-dive
   (<https://www.ibm.com/think/news/physical-ai-age-p-1-engineering-brain>) is referenced across the web but
   returned **HTTP 403** to automated fetch on 2026-06-20 — **UNVERIFIED from primary read**; cited here only
   as existing, not as a source I confirmed line-by-line.

---

## (c) Capability targets to aim toward for Forge's foundational model

Framed as **targets**, not equivalences. The honest stance: **Forge does NOT do what P-1 does.** Below,
each target names a P-1 pillar, then **what Forge has built & validated today** (with `file:line`), then a
**realistic Forge path**. "Built & validated" and "targeted" are kept strictly separate.

### C1. Physics-grounded synthetic training data ("the AlphaGo-for-engineering" pillar)
- **P-1 pillar:** large physics-based synthetic/semi-synthetic corpora to overcome design-data scarcity.
- **Forge today (built):** Forge already trains its Archie on a **self-labeled synthetic corpus where the
  kernel's own deterministic replay is the ground truth** — see the geometry-truth scorer header,
  `forge-kernel/test/cadscore_harness.mjs:3` ("dependency-free geometry-truth scorer") and `:787`
  ("The corpus IS the ground truth"); self-labeling pipeline at `:729` and `:1586-1587`. The runner's
  system prompt is pinned to the training corpus to avoid drift: `frontend/src/ai/ForgeRunner.js:38`,
  `:43`.
- **Realistic Forge path:** scale the *physics-labeled* fraction of that corpus. Forge has a verified
  in-house solver suite (truss/frame/modal/CFD-incompressibility, §C2) that can label synthetic parts with
  **real** computed quantities, not invented ones — the AlphaGo-style move P-1 describes. **TODO:** wire
  solver outputs into corpus rows as labels at volume. This is a build task, not done yet.

### C2. Multiphysics reasoning grounded in a real solver (not "intuition")
- **P-1 pillar:** "quantitative multiphysics intuition" (marketing; unverified, see (b)).
- **Forge today (built & validated, with the exact numbers from the file):** Forge has an **in-house FEA/CFD
  kernel with documented analytical benchmarks** in `FORGE_PHYSICS_VERIFICATION.md`:
  - Truss bar axial extension — **0.00%** error (`FORGE_PHYSICS_VERIFICATION.md:32`).
  - Frame longitudinal 1st mode 646.5 Hz analytic vs 646.4 Hz computed — **0.0%** (`:33`).
  - CFD lid-driven-cavity incompressibility enforced to ~**7e-16** (machine ε) (`:34`, `:53`).
  - **Honest limitation:** the hex-element **modal** case still shows ~**24%** error with a documented,
    attributed cause (single-element-through-depth shear locking) (`:68`, `:78-79`); and **turbulent/RANS
    CFD is NOT implemented** — only laminar lid-driven cavity is verified; the inlet/outlet duct path is
    numerically unstable and explicitly "do not demonstrate" (`:188-193`).
  - Solver source is real and named (`src/Fea.cpp:672` modal; `src/Cfd.cpp` projection; `src/FrameTruss.cpp`).
  > **Correction vs. internal memory:** an internal note recalled "static 0.33% / modal 0.2% / pendulum
  > 0.016%". Those specific figures are **not** what the committed `FORGE_PHYSICS_VERIFICATION.md` reports
  > (it reports the values above, including an open 24% hex-modal gap). The committed file is authoritative;
  > do not quote the memory numbers. **UNVERIFIED:** any multibody-pendulum 0.016% figure is not in the
  > current verification doc.
- **Realistic Forge path:** the *target* is matching P-1's framing with verifiable rigor — i.e., labels and
  agent feedback come from a solver whose error is published. Forge is **ahead on auditability** (real
  benchmarks committed) and **behind on coverage** (turbulent CFD, robust modal). Path: close the hex-modal
  locking gap and stabilize duct CFD before claiming "multiphysics."

### C3. Structured design representation that keeps the model "on rails"
- **P-1 pillar:** "structured design representation" to keep the federation on rails. **(Caveat:** this exact
  "on rails" / "structured design representation" phrasing was **not** found in the cited Sequoia article on
  re-fetch 2026-06-20 — see §(a).4; treat the pillar as P-1-self-described, not independently documented.)
- **Forge today (built):** Forge's equivalent is its **constrained parametric verb grammar** — the agent
  emits typed CAD verbs, not free geometry. See the verb catalogue in `frontend/src/ai/ForgeRunner.js`:
  `part.begin/add/subtract/intersect/finish` (`:66-68`), pattern verbs (`:69-71`), and the parametric/
  freeform set `part.extrude/revolve/loft/sweep/chamfer/shell/draft-faces/linear-pattern/circular-pattern`
  (`:72-77`), plus GD&T verbs like `gdt.position-relative-to-mate` (`:83`). Output is then **gated** by a
  hard validity check (closed && manifold && oriented && not self-intersecting) before scoring —
  `forge-kernel/test/cadscore_harness.mjs:6` and `:8-9`.
- **Realistic Forge path:** P-1's "on rails" ≈ Forge's "verb grammar + hard validity gate." The *target* is
  to extend the rails to **assembly/SysML-level structure and GD&T evaluation**, which P-1's eval paper
  explicitly targets (CAD + SysML artifacts, <https://arxiv.org/abs/2505.10653>). Forge has GD&T/PMI verbs
  bound but per internal notes lacks a geometric FCF (feature-control-frame) evaluator. **TODO/UNVERIFIED:**
  a geometry-truth GD&T scorer is *not yet built* — a correct "not implemented" beats a fake "working".

### C4. A published, Bloom's-taxonomy-style engineering eval (P-1's strongest real artifact)
- **P-1 pillar:** arXiv 2505.10653 — an extensible engineering-design eval over Bloom levels, able to grade
  CAD/SysML artifacts. This is their one genuinely substantiated technical contribution.
  (<https://arxiv.org/abs/2505.10653>)
- **Forge today (built):** Forge already has a **geometry-truth scorer** (ForgeCADScore) implementing a
  CADGenBench-style `cad_score = gate*(0.4*shape + 0.4*interface + 0.2*topology)`
  (`forge-kernel/test/cadscore_harness.mjs:6`), with shape via volume-IoU/bbox/surface-F1 (`:10`, `:464-490`)
  and a discrimination harness that down-scores deliberately corrupted parts (`:954`).
- **Realistic Forge path:** the *target* is to layer a **Bloom-style cognitive ladder** (recall → apply →
  analyze → synthesize) on top of Forge's existing geometry-truth scorer, so Forge evaluates *reasoning
  quality*, not only final geometry. P-1 publishes the rubric; Forge already has the geometry-truth backend
  to make such a rubric *measurable* rather than rhetorical. **TODO:** the Bloom-ladder layer is not built.

### C5. The product framing target: "AI teammate that does the boring engineering"
- **P-1 pillar:** requirements distillation, concept generation, sizing, trades, compliance — delivered as a
  Slack/Teams teammate. (<https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/>)
- **Forge today (built):** Forge's Archie is wired into the app as a driver (`frontend/src/ai/ForgeRunner.js`
  posts to the local MLX-LM fleet at `localhost:8080`, `:25`; adapter routing `:35`, `:217-225`) and emits the
  parametric verbs above to build real BRep geometry in the OCCT kernel.
- **Realistic Forge path:** Forge's verified differentiators vs. P-1's claims are **(i) a real BRep kernel**
  (OCCT) producing actual solids, and **(ii) committed solver benchmarks** — areas where P-1 publishes no
  results. The *target* is to grow Forge's task list toward P-1's (requirements → sizing → trades →
  compliance) **on top of** that real geometry+physics base, rather than matching P-1's "AGI/Dyson-sphere"
  marketing. Honest framing for any deck: "Forge aims at the same physical-engineering-AI category; its moat
  is verifiable geometry+physics, not a bigger marketing claim."

---

## Source list (all fetched/searched 2026-06-20)

- P-1 AI homepage — <https://p-1.ai> (fetched)
- Radical Ventures portfolio — <https://radical.vc/portfolio/p-1-ai-2/> (fetched)
- Fortune (independent press) — <https://fortune.com/article/startup-ai-funding-starship-google-deepmind-airbus-veterans/> (fetched)
- Sequoia "Inference" Substack deep-dive — <https://inferencebysequoia.substack.com/p/from-data-centers-to-dyson-spheres> (fetched)
- arXiv 2505.10653 *On the Evaluation of Engineering AGI* — <https://arxiv.org/abs/2505.10653> (fetched; framework only, no scores)
- Lerer Hippeau announcement — <https://medium.com/lerer-hippeau-ventures/please-welcome-p-1-ai-the-company-building-engineering-agi-for-the-physical-world-956c613a2b02> (search)
- IT Logs (founder backgrounds) — <https://itlogs.com/p-1-ai-raises-23-million-to-build-engineering-agi-co-founded-by-a-serbian-ai-expert/> (search)
- BusinessWire stealth-exit release — <https://www.businesswire.com/news/home/20250425073932/en/P-1-AI-Comes-Out-of-Stealth-Aims-to-Build-Engineering-AGI-for-Physical-Systems> (**fetch failed: timeout/socket-close**; UNVERIFIED from primary read, cited via search summary only)
- IBM Think deep-dive — <https://www.ibm.com/think/news/physical-ai-age-p-1-engineering-brain> (**HTTP 403 to automated fetch**; UNVERIFIED from primary read)

### Forge repo evidence cited
- `forge-kernel/test/cadscore_harness.mjs:3,6,8-12,464-490,729,787,954,1586-1587`
- `frontend/src/ai/ForgeRunner.js:25,35,38,43,66-77,83,217-225`
- `FORGE_PHYSICS_VERIFICATION.md:32,33,34,53,68,78-79,114,156,188-193`

---

## Verification (adversarial)

Independent re-check on **2026-06-20** under Engineering-Bible rules 0 & 9 (anti-fabrication). Every
external URL was re-fetched/re-searched; every Forge `file:line` citation was opened in
`~/archdisc-Mech`. Skepticism was the default: anything not confirmable from a real source is marked
UNVERIFIED in-line above.

### External claims — what was checked and held
- **arXiv 2505.10653** (re-fetched): title *"On the Evaluation of Engineering Artificial General
  Intelligence"*, **9 authors** (Neema, Jha, Nagel, Lew, Sureshkumar, Gordić, Shimmin, Nguyen, Eremenko),
  submitted **15 May 2025**. Abstract confirms it *specializes Bloom's taxonomy* into engineering design and
  proposes a *pluggable framework that evaluates structured design artifacts (CAD/SysML)*. **Confirmed: it
  reports NO benchmark scores** for any model — the file's central honesty caveat holds exactly. ✓
- **$23M seed led by Radical Ventures**, with **Village Global, Schematic Ventures, Lerer Hippeau** and
  angels **Jeff Dean (Google), Peter Welinder (OpenAI), Bob van Luijt (Weaviate)** — confirmed via
  independent press (theaiinsider, Converge Digest, multiple). ✓
- **Founders:** Eremenko (Airbus/UTC CTO, ex-DARPA), Gordić (DeepMind), Nagel (Acubed), Jha (paper
  co-author) — confirmed. ✓
- **"Starships and Dyson spheres"** quote and the **"not a 10-year moonshot"** clarifier — confirmed
  verbatim in Fortune. ✓
- **AlphaGo analogy + physics-based synthetic/"semi-synthetic" data from motors/pipes/shafts** — confirmed
  in Fortune (Gordić quote) and the Radical portfolio page. ✓
- **Data-center cooling ~1,000 parts → ~10×/yr → ~1,000,000-part aerospace** — confirmed verbatim in the
  Sequoia "Inference" deep-dive ("data center cooling with 1,000 unique parts", "aerospace systems (1
  million parts)"). ✓
- **Federation of specialized models orchestrated by an LLM** + **Slack/Teams delivery** — confirmed in
  Sequoia. ✓
- **Radical portfolio page** — re-fetched live: tagline *"building engineering AGI for the physical world"*,
  Archie, "multi-physics reasoning, spatial intelligence, and synthetic training datasets", tasks
  (requirements → concepts → trades), data-center-cooling first market — all confirmed. ✓
- **Stated fetch failures reproduced:** the **IBM Think** page returns **HTTP 403** and the **BusinessWire**
  release returns a **socket-close/timeout** on automated fetch — exactly as the file already states. Both
  remain UNVERIFIED-from-primary-read; they are cited only as existing. ✓

### Corrections made by this pass
1. **"On rails" / "structured design representation"** (§(a).4, §C3): the cited **Sequoia** article does
   **not** contain this phrasing on re-fetch — only the "federation of specialized models orchestrated by an
   LLM" wording is present. Downgraded to **UNVERIFIED** against the independent source and re-attributed to
   P-1's own site only.
2. **Aleksa Gordić "head of AI"** (§0): DeepMind + Microsoft background is independently confirmed, but the
   exact internal title "head of AI" is not in any primary source found — relabeled "ML engineer" and the
   title marked **UNVERIFIED**.

### Forge repo evidence — every cited line opened and verified
- `forge-kernel/test/cadscore_harness.mjs`: lines **3, 6, 8–12, 464–490, 729, 787, 954, 1586–1587** all
  match the descriptions (geometry-truth scorer header; `cad_score = gate*(0.4 shape + 0.4 interface + 0.2
  topology)`; hard validity gate; volume-IoU/bbox/surface-F1 in `scoreShape`; "the corpus IS the ground
  truth"; corruption/discrimination harness). ✓ File exists (1711 lines).
- `frontend/src/ai/ForgeRunner.js`: lines **25, 35, 38, 43, 66–77, 83, 217–225** all match (localhost:8080
  base URL; `hermes_forge` adapter; corpus-pinned system prompt; the full parametric verb catalogue incl.
  `gdt.position-relative-to-mate`; adapter-routing comments). ✓ File exists (562 lines).
- `FORGE_PHYSICS_VERIFICATION.md`: the §C2 numbers are accurate against the committed doc — **truss 0.00%**
  (`:32`), **frame longitudinal 646.5/646.4 Hz → 0.0%** (`:33`), **CFD incompressibility ~7e-16** (`:34`,
  `:53`), **hex modal ~24%** with attributed shear-locking cause (`:68`, `:78–79`), **turbulent/RANS NOT
  implemented + duct path diverges / "do not demonstrate"** (`:188–193`). The file's explicit **rejection of
  the internal-memory "static 0.33% / modal 0.2% / pendulum 0.016%" figures** is correct — those numbers are
  **not** in the committed verification doc, and the file rightly marks the 0.016% pendulum figure
  UNVERIFIED. ✓ (Out-of-scope note: the verification doc's own header states the kernel binary is 4.94 MB
  built 2026-06-17 18:07, but the on-disk binary is 5,019,840 B built 2026-06-18 06:12 — a discrepancy
  internal to that *other* file, not cited by EXTERNAL_P1.md, so not edited here.)

### Net verdict
Original document was **already strongly disciplined** — it pre-emptively marked the unverifiable items
(benchmarks, capability self-claims, the two failed fetches) and its repo citations are accurate. Two
external attributions were over-precise and have been downgraded to UNVERIFIED. No fabricated numbers were
found; every confirmable figure (funding, part counts, the arXiv author/date/no-scores facts, and the Forge
physics percentages) checks out against a real source.
