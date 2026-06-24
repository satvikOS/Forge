# Mecado Alignment Plan — Winning Mecado as Forge + Archie's Reference User

_Compiled 2026-06-24 for SCOPE_2026-06-24/research. Goal: determine what makes Forge Mecado's go-to in-house testing environment, grounded in Mecado's public product/ideology and the LIVE CADGenBench leaderboard, mapped to our roadmap (CADGenBench program M0–M7, kernel-parity program, Archie corpus program)._

> **TL;DR.** Mecado is a Cambridge MA / MIT-rooted **mechanical-data + evaluation** company (product: **Vulcan**, an AI co-pilot for mechanical engineers; benchmark: **CADGenBench**, co-authored with Hugging Face). They sell CAD-native, expert-annotated, physics-informed datasets and hold everyone to **"manufacturable accuracy over visuals."** They are a **Link Ventures** portfolio company — the same fund the ArchDisc deck targets — so they are best read as a **warm, in-network technical-diligence proxy.** Winning them as the reference user is one act with three payoffs: a benchmark win, a partnership, and a Link Ventures signal. **The win condition is geometry truth, scored through CADGenBench's exact gates** — and the live ceiling is only **0.4514**, so a validated **≥0.85-every-axis** run is ~1.9× the field and category-defining. Forge's native pure-C++ kernel + STEP I/O + CAM/CAE/MBD is structurally the *right* environment for this; the gap is Archie reliably emitting **valid, interface-correct** parts.

---

## 1. Who Mecado is (verified 2026-06-24)

- **Identity / tagline:** "Mecado: Mechanical Data." / "The Mechanical Data Company." HQ Cambridge, MA; MIT-rooted. (mecado.com, mecado.com/benchmark; PitchBook 919674-55)
- **People:** **Elie Cuevas** (CEO, MIT '24, MIT CSAIL) and **Dylan Ryan**, advised by **Blake Courter** (CAD/geometry-kernel veteran, ex-SpaceClaim/nTopology lineage). **Michael Rabinovich** (Hugging Face; X @MikushRab) is the CADGenBench technical lead and public face of the leaderboard — he personally runs frontier models through Mecado's CAD tasks (e.g. his "Opus 4.8 … ran it through our CAD tasks, 4.6→4.7→4.8 side by side" post).
- **Investor:** **Link Ventures** (Boston, MIT/Harvard-centric, seed→Series A). **The ArchDisc pitch deck is the "Link Ventures deck." Mecado is a Link Ventures portfolio company.** This is almost certainly *why* Mecado is the named evaluator — treat Mecado alignment as a Link Ventures diligence proxy.

### What Mecado builds / sells
- **Vulcan (the product):** an AI co-pilot for mechanical engineers that **integrates directly into mech-E design software** and **takes actions on the user's behalf — "a true extra hand."** Brand line: "Changing mechanical engineering, forever." (familyoffice.is/work/mecado; Daisy Chain Studio brand work). Vulcan is the *agentic-in-CAD* archetype Archie is the local-model analog of.
- **Mechanical Data (the business):** "CAD-native, expert-annotated, physics-informed datasets that capture how real products are engineered and evaluated." Customers (startups, enterprises, academia building mechanical AI) **download SOTA datasets** instead of scraping GrabCAD/3DContentCentral and hand-cleaning.
- **CADGenBench (the credibility instrument):** a Hugging Face × Mecado public, server-side-scored, live leaderboard (private ground truth) — simultaneously a methodology statement and a sales funnel for the dataset product.

### Mecado's ideology (the bar they hold everyone to — memorize)
"The majority of the world's engineering data is locked in proprietary silos." LLMs can do financial analysis or code review but **cannot do hand-calculations, design for 3-axis milling, or contribute to a design review.** Therefore mechanical AI "needs benchmarks that reflect how real products are designed, built, and validated" — **manufacturable accuracy over visuals.** This is the explicit rubric Forge/Archie are graded against: *real parts that bolt up and can be made*, not pretty meshes.

### What "go-to for in-house testing" actually means
Mecado is **not a CAD-tool buyer; they are a data + evaluation company.** "Forge as their home-testing environment" means Mecado would:
1. Use **Forge's kernel + Archie** as the reference *generation/validation environment* they recommend and run when evaluating mechanical AI ("test it on Forge");
2. Route Forge/Archie (and their dataset customers' systems) through **CADGenBench + their harder private internal sets** as the canonical scoring path; and
3. **Co-market** — Forge becomes the toolchain Mecado points dataset customers and benchmark submitters at.

To win that, Forge/Archie must be the system that (a) **scores highest on CADGenBench**, (b) **ingests/produces Mecado-grade artifacts losslessly** (STEP, B-rep, drawings, PMI), and (c) offers a **tool-agnostic, drop-in submission/eval harness** so Mecado runs "Forge as the rig" with zero glue.

---

## 2. CADGenBench — the literal scoring rubric (live state 2026-06-24)

CADGenBench measures "how well AI systems produce **engineering-grade** 3D parts." Two tasks; four metrics; a hard validity gate; weighted CAD Score. **It is tool-agnostic — submissions are just files**, so Forge's native kernel can submit directly (build123d/Onshape/Autodesk/no-LLM all allowed). Parts are **real mechanical parts with mating interfaces** from Mecado's library: locating jigs, bolt patterns, slots, bosses, pockets — parts that must *seat/bolt up to a fixture.*

- **81 fixtures:** 49 generation (drawing PNG → solid) + 32 editing (input.step + text change → edited solid).
- **Output:** `output.step`/`.stp` (B-rep, **preferred, high-trust watertight gate**) or mesh `{stl,obj,off,3mf,ply}`. Center at origin, documented orientation; grader **rigidly aligns (rotation+translation, never scale)** via multi-scale point-to-plane ICP over identity + 24 octahedral PCA poses.
- **CAD Score (gated by validity):**
  - Generation: `0.4·shape + 0.4·interface + 0.2·topology` (0 if invalid)
  - Editing: `0.6·s_renorm + 0.3·interface + 0.1·topology` where `s_renorm = max(0,(shape−b_shape)/(1−b_shape))` — **a no-op caps ~0.4**.
- **Validity (hard gate, ×0):** `BRepCheck_Analyzer.IsValid()` + watertight (no naked/free edges) + closed-orientable manifold mesh (`3F=2E`). Advisory diagnostics flagged-not-gated (min face area > 0.001 mm², aspect < 1000, BREP tol < 0.1 mm; healthy ~0.05 mm).
- **Shape (0.4 gen / 0.6 edit):** surface-distance-F1 (match iff nearest point ≤ **0.5% of GT bbox diagonal** AND normals ≤ **20°**) + volume-IoU (via `manifold3d`).
- **Interface (0.4 gen / 0.3 edit) — "does it bolt up?":** KOR (keep-out, empty) / KIR (keep-in, solid) IoU with thin opposite-material shell; bounded pose search ±1°, ±1% size; ramp **IoU ≥0.95→1, ≤0.80→0**; group = **min** of its features; sample = mean over groups. *One misplaced slot zeroes an entire interface.*
- **Topology (0.2 gen / 0.1 edit):** Betti (b0,b1,b2) fuzzy log-ratio `((min+1)/(max+1))²`, aggregate = **product** s0·s1·s2 — one wrong count collapses the axis.
- **Trust tiers (confirmed in live schema):** every row starts `validation_status: "unvalidated"`; maintainers promote to `"validated"` after methodology review via `validation_method ∈ {code, traces, api, manual}`. **Our north-star must land on the `validated` tier.**

### 2.1 LIVE LEADERBOARD (results.jsonl pulled 2026-06-24; 39 rows, 14 already `validated`/`manual`)

| Rank | Submission | Aggregate | Generation | Editing | Validity |
|---|---|---|---|---|---|
| 1 | **Claude Fable 5** HF Baseline + Build123d | **0.4514** | 0.3728 | 0.5718 | 0.963 |
| 2 | gpt-5.5 build123d-mcp 0.3.57-xhigh | 0.4452 | 0.3717 | 0.5578 | 0.975 |
| 3 | build123d-mcp + Claude Opus 4.8 (full 81) | 0.4282 | 0.3152 | 0.6013 | 0.951 |
| 4 | pzfreo / claude-opus-4.8-build123d-mcp-0.3.56 | 0.4266 | 0.3025 | 0.6165 | 0.988 |
| 6 | gpt-5.5 build123d-mcp 0.3.56-v2 | 0.4111 | 0.3453 | 0.5118 | 0.963 |
| — | Opus 4.8 — Claude Code + text-to-cad skill | 0.3868 | 0.2803 | 0.5499 | 0.864 |
| — | Gemini 3.1 Pro HF Baseline | 0.3106 | 0.2115 | 0.4624 | 0.778 |
| — | **Qwen3-VL-235B build123d FT (2-stage)** | 0.2382 | 0.1848 | 0.3199 | 0.963 |
| — | **CadReasoner** (specialist, partial / editing-only run) | — | — | — | — |

**Field-wide truths (these define the strategy):**
- **Live ceiling is 0.4514.** Nobody breaks 0.46 aggregate. The ≥0.85 north-star is **~1.9× the live field.**
- **Generation is the wall.** The single best generation-task score *anywhere on the board* is **0.3728**. Best editing-task is **0.6165**. ≥0.85 on generation is ~2.3× the field's best.
- **The field doesn't fail uniformly — it fails on generation + interface.** Across ALL 39 submissions, only **135 of 3078** individual sample-scores ever reach ≥0.85. The top entry hits ≥0.85 on just **2/49 generation** and **10/32 editing** samples. Editing's high scores cluster where the no-op renorm is forgiving; generation collapses on shape+interface placement.
- **Fine-tuned open VLMs are weak.** The best Qwen3-VL-235B fine-tune sits at **0.2382** — below every frontier-model+build123d baseline. This is the moat: a *better fine-tune alone won't win*; the **native kernel + interface-correct placement + STEP I/O** is what the build123d/text-to-mesh class structurally can't match.
- **CadReasoner now exists** (a CAD-reasoning specialist submitting to the board) — the competitive frontier is moving toward exactly the specialist-model approach Archie embodies. We are not first-movers; we must be best on the gates everyone dies on.

---

## 3. The seven things Forge + Archie MUST demonstrate to win Mecado

> Ordered by leverage on (a) the CAD Score and (b) Mecado's "manufacturable over visuals" ideology. Each is concrete, verifiable, and mapped to a roadmap milestone in §4.

**R1 — Beat the leaderboard on the `validated` tier, every axis.** A **validated** CADGenBench row with aggregate ≥0.85 AND each of shape/interface/topology ≥0.85 AND both `score_by_task_type.generation` and `.editing` ≥0.85 — not the mean. (Live SOTA 0.4514; gen-task best 0.3728.) This is the single headline. It only counts scored through CADGenBench's exact gates and promoted by Rabinovich's methodology review (`validation_method`).

**R2 — ~100% CAD-validity on watertight B-rep (requirement zero).** Every Forge/Archie output passes `BRepCheck_Analyzer.IsValid()` + watertight + closed-orientable manifold (`3F=2E`); `validity_rate ≥ 0.97`. An invalid solid scores a hard 0. The leaders already sit at 0.96–0.99 validity, so this is table-stakes, not a differentiator — but a miss here zeroes everything.

**R3 — Native STEP / B-rep I/O, lossless, high-trust path.** Submit `output.step`, not mesh. **Import** `input.step` for editing; **export** AP203/AP214/AP242 that round-trips through OCCT's reader without healing; keep advisory diagnostics in the healthy band (~0.05 mm tol). This is exactly what validates the "pure-C++ native kernel, no external CAD deps" claim against Mecado's STEP fixtures — and what the build123d/OpenSCAD-mesh competitor class can't cleanly do.

**R4 — Interface-grade feature placement (the make-or-break axis, weight 0.4 gen).** Bolt holes, slots, bosses, pockets, locating jigs land within **±1° and ±1% of part size** at IoU **≥0.95** against KOR/KIR sub-volumes (≤0.80 scores 0; worst-feature `min`-gated). This is where the entire field collapses and the strongest, most expensive-to-fake differentiator. Archie must reason about mating features as *functional interfaces*, not decoration — which requires full **assembly context** in training (the "mates with M6 / locates on Ø10 pin / clears this slot" framing).

**R5 — Engineering-drawing → solid (multimodal generation), dimensionally exact.** Archie's VLM path reads the orthographic PNG drawing(s) and emits a solid with surface-F1 within 0.5% bbox diagonal, normals within 20°, high volume-IoU — at correct *absolute mm scale* (rigid-align gives no scale rescue). This is the 49/81 generation task and the single hardest thing on the board (best 0.3728). It is the clearest place to *lap* the field rather than match it.

**R6 — STEP-editing that beats the no-op (caps 0.4) via real imported-B-rep editing.** Given `input.step` + a text edit, apply a *local* parametric change (add/remove/resize a hole, move a slot, change a thickness) while leaving the rest untouched — `s_renorm > 0`, topology/interface preserved. Requires **feature recognition + local edit on foreign geometry**, not rebuild-from-scratch. (32/81 fixtures; a known kernel frontier for us.)

**R7 — Manufacturability + tool-agnostic drop-in harness (the partnership ergonomics).** Demonstrate the things Mecado says LLMs *can't* do — hand-calculations, **design-for-3-axis-milling**, design-review contributions — via Forge's CAM/DFM + FEA/CFD/MBD, which no text-to-CAD competitor has. Then make Forge **trivial to run as the rig**: a one-command `forge-bench cadgen run` that emits the exact `results/<run>/<sample>/output.step` + `meta.json` + upstream-schema `run_summary.json`, with an HTML report parity. Low-friction integration is what converts "scores well" into "is our default."

### Secondary / durability requirements (necessary, lower leverage)
- **R8 — Topology by construction.** Match GT (b0,b1,b2) exactly; no floating bodies, no spurious through-holes/voids (the product metric punishes any single miscount). Validates Boolean/union watertightness (the Manifold/OCCT parity claim).
- **R9 — Generalize past the 81.** Real eval is server-side on private GT; Mecado also holds harder proprietary sets. Train on the CADGenBench *part class* (jigs/bolts/slots/bosses/pockets, full assembly + multimodal context), never overfit the 81.
- **R10 — IP-clean data.** Mecado's whole pitch is escaping scraped-GrabCAD silos. Archie's corpus + any imported assets must be CC0/synthetic/licensed so Mecado can recommend Forge with zero IP risk to *its* customers.
- **R11 — Robust, deterministic, auditable.** No crashes on valid CAD (grader treats a sub-metric exception as 0). Reproducible runs + methodology evidence for the `validated` tier. A reproducible, inspectable pipeline is itself an alignment signal to an eval company.
- **R12 — Assembly readiness (beyond single parts).** CADGenBench is single-part today, but Mecado's worldview is whole products. Forge's large-assembly + GD&T/PMI + interference/tolerance analysis is what positions Forge as the *professional* rig, not another toy — demonstrate importing a Mecado multi-part assembly + clash/tolerance analysis.

---

## 4. Mapping to our roadmap (the alignment plan)

Every requirement already has a home in the existing programs. This is the cross-walk; nothing new needs inventing — it needs executing in the M0→M7 order.

| Req | Roadmap milestone (CADGenBench program M0–M7) | Kernel-parity dependency | Corpus dependency |
|---|---|---|---|
| **R1** all-axis ≥0.85 validated | **M6** convergence + **M7** validated public submission | all of below | all four corpora |
| **R2** validity ~1.0 | **M1** Validity lockdown (`validity_rate ≥0.97`) | a2/a4/b15/c6/c17 — BRepCheck+ShapeFix/ShapeUpgrade on *every* export; harden exact predicates; tolerant boolean | validity-discipline drills (every gold output passes BRepCheck; negative "open shell → re-cap" samples) |
| **R3** native STEP/B-rep lossless | **M0** harness (STEP export path) + threads M1/M6 | data-exchange (AP203/214/242 read+write round-trip, no heal); diagnostics in healthy band | — |
| **R4** interface placement | **M4** Interface mating correctness (`interface ≥0.85`) | a21/a22/b14/c7/c14 — std thread/hole B-rep (ISO 261/ASME B1.1), instanced boolean, AP242 PMI/GD&T semantic round-trip, native clash | **KOR/KIR assembly-context** corpus keyed to jig failure taxonomy (wrong-spacing/missing-hole/wrong-Ø/narrow-slot/offset-slot/rotated-boss/shifted-holes) with full mating context |
| **R5** drawing→solid multimodal | **M3** Shape fidelity + Generation (`gen ≥0.85`) | a6–a18/c5 — exact fillet/chamfer/blend, shell, sweep/loft, crack-free faceter | **drawing→parametric multimodal** corpus (Qwen2.5-VL eager-RoPE; multi-view PNG + dims + GD&T + hole tables → tool-calls, exact mm scale) |
| **R6** STEP editing > no-op | **M5** STEP-editing (`editing ≥0.85`, `s_renorm>0`) | a23/a24/a25/b9/b13/c1/c2/c6 — direct/local edit, feature recognition/defeature, tolerant modeling on imported STEP, persistent-ID rebuild | **STEP-edit surgical-delta** corpus (paired input.step + instruction + minimal-delta gold) |
| **R7** manufacturability + harness | M0 harness (`forge-bench cadgen run`, upstream-schema JSON, HTML report) + existing CAM/DFM/FEA/CFD/MBD | data-exchange + sim-grounding (already MIT-PhD-validated per FORGE_PHYSICS_VERIFICATION) | manufacturing pillar (DFM/CAPP/semantic-PMI, `forge.mfg.autoProcess`) |
| **R8** topology | **M2** Topology-by-construction (`topology ≥0.90`) | a2/b2/c15 — watertight boolean, region/lump/void graph, Euler operators | topology-count drills (pin exact #holes/#voids/#bodies) |
| **R9** generalize | M6 held-out 81-mirror + internal GT corpus (M0 §1.2) | — | all corpora in the CADGenBench part class, never the 81 itself |
| **R10** IP-clean | corpus program hygiene | — | CC0/synthetic/licensed only |
| **R11** robust/auditable | M0 determinism + M7 reproducibility evidence | no-fallback/no-stub rule (surface real kernel error) | — |
| **R12** assembly | beyond-single-part demo (assembly-largemodel kernel doc) | assembly-largemodel + GD&T/PMI; native clash/interference | assembly-context corpus already required for R4 |

### Attack order (leverage ÷ cost — unchanged from the CADGenBench program, re-confirmed by live data)
**M0** build `ForgeCADScore v2` (faithful local re-impl of all four axes + internal GT mirror corpus) → **M1** validity gate (×0 on everything) → **M2** topology (cheap, counts-not-mm) → **M3** shape+generation (the field's biggest wall — best 0.3728 — highest *upside*) → **M4** interface (highest weight, most differentiating, where everyone dies) → **M5** editing (hardest kernel frontier) → **M6** all-axis convergence + CUA self-correction loop → **M7** validated public submission. The live data **sharpens the priority**: because generation (M3) is where the entire field caps at 0.37, that milestone is where Forge can *lap* rather than *match* — it is the highest-visibility win and should be resourced accordingly, with interface (M4) as the second lap point.

---

## 5. Strategic read for ArchDisc

- **Three birds, one shot.** A validated ≥0.85-every-axis CADGenBench row is simultaneously (1) a benchmark win (~1.9× field), (2) a Mecado partnership ("test it on Forge"), and (3) a Link Ventures diligence signal — because Mecado is a Link Ventures portfolio company and the deck targets Link Ventures.
- **Geometry truth, not rendering, is the win condition — and it favors us.** CADGenBench gates on watertight B-rep validity and scores feature placement to ±1%/±1° with hard ramps. This structurally favors Forge's **native pure-C++ OCCT/Manifold/CGAL kernel + true STEP I/O** over the build123d/OpenSCAD/text-to-mesh competitor class — *but only if Archie reliably emits valid, interface-correct parts.* Validity rate and interface match are the two axes to obsess over. The live board proves the point: the best open-VLM fine-tune (Qwen3-VL-235B, 0.2382) loses to frontier-LLM-as-build123d-coder, which loses to nothing yet — the kernel-native lane is open.
- **Generation is the open frontier.** Best generation-task score anywhere is 0.3728. That is where to plant the flag: a Forge+Archie generation-task result in the 0.8s would be visually undeniable and is the hardest thing to fake.
- **The editing task needs real imported-B-rep editing**, not rebuild-from-scratch (a kernel-parity frontier: feature recognition + local parametric edit on foreign STEP). It is also where the no-op renorm means *sloppy* attempts are worse than honest deltas.
- **Train Archie on Mecado-class data:** real mechanical parts with mating interfaces, multi-view drawings, paired STEP + edit requests, **full assembly context**, multimodal — exactly the four corpora already specified. This is the same direction as the assembly-context + drawing→STEP + GD&T/PMI corpus directives.
- **Make Forge the *rig*, not just the winner.** Beyond scoring, the partnership converts on ergonomics: a one-command CADGenBench harness on Forge + upstream-schema JSON + HTML-report parity + IP-clean data lets Mecado point its dataset customers at Forge as the default home-testing environment. That is the "go-to" — and it is a small, cheap deliverable relative to the kernel/corpus grind.
- **Watch the moving frontier.** CadReasoner (specialist CAD-reasoning model) and the Qwen3-VL fine-tunes show the field is converging on Archie's exact approach. The defensible edge is not "a specialist model" — it is "a specialist model **driving a native kernel** that emits valid interface-correct STEP." Ship the kernel lane.

---

## Sources

- Mecado: https://www.mecado.com , https://www.mecado.com/benchmark
- Mecado / Vulcan product + brand: https://familyoffice.is/work/mecado , https://www.daisychainstudio.net/projects/mecado-engineering
- Elie Cuevas: https://www.linkedin.com/in/eliecuevas/ , https://www.csail.mit.edu/person/elie-cuevas
- CADGenBench HF Space (leaderboard): https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench
- **Live leaderboard data (results.jsonl, pulled 2026-06-24):** https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions  (39 rows; SOTA 0.4514; 14 `validated`/`manual`; best generation-task 0.3728; best editing-task 0.6165; CadReasoner specialist + Qwen3-VL fine-tunes present)
- CADGenBench public inputs: https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data (private GT: `cadgenbench-data-gt`)
- CADGenBench code (Apache-2.0): https://github.com/huggingface/cadgenbench — metric/submission/validation docs
- Michael Rabinovich launch thread: https://x.com/MikushRab/status/2063999885796614522
- AINews benchmark framing (2026-06-08): https://news.smol.ai/issues/26-06-08-not-much
- Link Ventures (investor): https://www.linkventures.com/ , https://f4.fund/firms/link-ventures
- PitchBook (HQ/CEO): https://pitchbook.com/profiles/company/919674-55
- Internal: `docs/SCOPE_2026-06-21/research/mecado.md`, `docs/SCOPE_2026-06-21/programs/cadgenbench_program.md`, `docs/SCOPE_2026-06-21/programs/archie_corpus_program.md`, `docs/SCOPE_2026-06-24/kernel/*`, `docs/SCOPE_2026-06-24/training/*`, root `CADGENBENCH_SPEC.md`, `FORGE_PHYSICS_VERIFICATION.md`
