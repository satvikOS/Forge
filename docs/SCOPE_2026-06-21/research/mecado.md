# Mecado — Deep Dive (the mechanical-CAD company evaluating Forge + Archie)

_Research compiled 2026-06-21 for SCOPE_2026-06-21. Feeds: mission bible, Archie training-corpus plan, kernel 1:1-parity plan, enterprise UI/UX redesign._

> **One-line:** Mecado is a Cambridge MA / MIT-rooted "mechanical data" startup that sells CAD-native, expert-annotated, physics-informed training datasets for mechanical-engineering AI, and — with Hugging Face — authors **CADGenBench**, the geometry-truth benchmark that decides whether an AI system can produce *manufacturable, engineering-grade* 3D parts. CADGenBench is the literal scoring rubric our north-star metric (>= 0.85, every dimension) is measured against. **Current public leaderboard ceiling is ~0.39–0.45** — so a credible 0.85 is a category-defining claim, and Mecado is exactly the right evaluator/partner to validate it.

---

## 1. Who Mecado is

- **Name / tagline:** "Mecado: Mechanical Data." (https://www.mecado.com, /benchmark)
- **HQ / industry:** Cambridge, MA; Business/Productivity Software. (PitchBook profile 919674-55)
- **Founders:** **Elie Cuevas** (CEO, MIT '24) and **Dylan Ryan**, advised by **Blake Courter** (a well-known CAD/geometry-kernel veteran — ex-SpaceClaim/nTopology lineage). (LinkedIn posts by eliecuevas, blakecourter, mecadoinc)
- **CADGenBench technical lead:** **Michael Rabinovich** — works at Hugging Face (email `michael.rabinovich@huggingface.co`, used for benchmark verification) and personally runs frontier models through Mecado's CAD tasks (e.g. his "Opus 4.8 just dropped and I ran it through our CAD tasks — 4.6 -> 4.7 -> 4.8 side by side" post). He is the public face of the leaderboard (X: @MikushRab).
- **Investor:** **Link Ventures** (Boston, MIT/Harvard-centric early-stage AI fund, seed -> Series A). **Note for the deck team:** the user's pitch deck is the "ArchDisc **Link Ventures** deck" — Mecado is a Link Ventures portfolio company. This is almost certainly *why* Mecado is the named evaluator: a warm, in-network technical-diligence partner. Treat alignment with Mecado as alignment with a Link Ventures diligence proxy.

### What Mecado sells / does
- **Core product:** "CAD-native, expert-annotated, physics-informed datasets that capture how real products are engineered and evaluated." Customers (startups, enterprises, academia building mechanical-engineering AI) download SOTA datasets directly instead of scraping GrabCAD/3DContentCentral and hand-cleaning. (blakecourter launch post)
- **Thesis / worldview (the bar they hold everyone to):** "The majority of the world's engineering data is locked in proprietary silos." LLMs can do financial analysis or code review but **cannot do hand-calculations, design for 3-axis milling, or contribute to a design review.** Mechanical AI therefore "needs benchmarks that reflect how real products are designed, built, and validated" — **manufacturable accuracy over visuals.** This is the explicit ideology Forge/Archie are being graded against: *real parts that bolt up and can be made*, not pretty meshes.
- **Benchmark business:** CADGenBench is their public credibility instrument — a private-ground-truth, server-side-scored, live leaderboard that doubles as a sales funnel for the underlying dataset product.

### What "go-to for home testing" partnership implies
Mecado is *not* a CAD-tool buyer; they are a **data + evaluation** company. A "go-to for home testing" partnership means Mecado would:
1. Use **Forge's kernel + Archie** as the reference *generation environment* they recommend/run when evaluating mechanical AI ("test it at home on Forge"),
2. Feed Forge/Archie through CADGenBench (and their proprietary harder internal sets) as the canonical scoring path, and
3. Potentially co-market: Forge becomes the toolchain Mecado points its dataset customers and benchmark submitters at.
To win that, Forge/Archie must be the system that **scores highest on CADGenBench and ingests/produces Mecado-grade artifacts losslessly** (STEP, B-rep, drawings, PMI), with a tool-agnostic submission path that drops straight into their pipeline.

---

## 2. CADGenBench — the exact thing Forge/Archie are graded on

CADGenBench is a **Hugging Face × Mecado** collaboration: "measure how well AI systems produce **engineering-grade** 3D parts… current models can generate 3D parts, but are far from precise enough to build **functional** parts." (X @MikushRab; AINews 2026-06-08; HF Space `HuggingAI4Engineering/CADGenBench`; GitHub `huggingface/cadgenbench`, Apache-2.0.)

### 2.1 The two tasks
1. **Generation** — from an **engineering drawing** (PNG, sometimes multi-view `input.png`/`input2.png`) of a part, produce a valid, geometrically correct 3D solid.
2. **Editing** — given an existing **STEP file** (`input.step`) + a natural-language change request (`edit_description.txt`), apply the change.

### 2.2 Dataset shape (public inputs; private ground truth)
- **81 fixtures total: 49 generation + 32 editing.** ~199 MB. (`HuggingAI4Engineering/cadgenbench-data`)
- Parts are **real mechanical parts with mating interfaces** sourced from Mecado's library: **locating jigs, bolt patterns, slots, bosses, pockets** — i.e. parts that must *seat/bolt up to a fixture*.
- **Generation fixture** = `description.yaml` (prompt + metadata) + engineering-drawing PNG(s).
- **Editing fixture** = `description.yaml` + `edit_description.txt` + `input.step` (starting solid) + `input.mesh.npz` (trusted watertight mesh sidecar) + `renders/` (ISO/front/top/right PNGs).
- **Ground truth is private** (`cadgenbench-data-gt`): the server-side leaderboard eval is the *only* path to a score. Two-tier trust: rows start `unvalidated`; maintainers manually promote to `validated` after methodology review (email Rabinovich, subject "CadGenBench verification").

### 2.3 Tool-agnostic submission contract (critical for our CUA path)
- **Submissions are just files**, no LLM required. "You can vary the LLM and the environment — build123d, Onshape, Autodesk, or no LLM at all." This means **Forge's kernel can submit directly** — we don't have to use anyone else's environment.
- Layout: one dir per sample, `results/<run>/<sample>/output.<ext>`; zip as `submission.zip` with a `meta.json`; upload via the Space's Submit tab. The Space validates, evals, publishes a leaderboard row, and emits a per-submission HTML report.
- **Accepted outputs:** `output.step`/`.stp` (B-rep) **preferred**, or triangle mesh `output.{stl,obj,off,3mf,ply}`. STEP is held to the stricter **watertight-BREP** gate; mesh to a **mesh-manifold** gate; both scored by the same downstream geometry math (grader meshes the B-rep). **Forge should emit STEP/B-rep, not mesh**, to take the high-trust path and to prove kernel-grade output.
- **Coordinate convention:** center model at `(0,0,0)`; orientation rules (longest axis, mounting frame). The grader still rigidly aligns (rotation+translation, **never scale**) before scoring, using Open3D multi-scale **point-to-plane ICP** over a pose pool (identity + 24 octahedral PCA orientations), selecting by bidirectional F1 / capped symmetric Chamfer / RMSE with a deterministic tie-break for near-symmetric parts.

### 2.4 The CAD Score — exact formulas, weights, tolerances
A **hard validity gate**, then a **weighted mean of three orthogonal [0,1] metrics**.

**Generation composition:**
```
cad_score = 0                                                        if NOT valid
cad_score = 0.4·shape_similarity + 0.4·interface + 0.2·topology     if valid
```

**Editing composition** (shape renormalized against the no-op baseline so "do nothing" can't win):
```
b_shape   = shape_similarity(input.step, GT)             # precomputed, in edit_baseline.json
s_renorm  = max(0, (shape_similarity - b_shape) / (1 - b_shape))
cad_score = 0.6·s_renorm + 0.3·interface + 0.1·topology   (0 if invalid)
# a no-op submission therefore caps at 0.4
```

**Metric 1 — CAD Validity (hard gate; failure => cad_score = 0).**
- STEP/B-rep must satisfy **all**: (a) well-formed BREP — `BRepCheck_Analyzer.IsValid()` reports no per-face/edge/vertex errors (no self-intersecting wires, edges off-surface, etc.); (b) **watertight** — every shell closed, no naked/free edges; (c) **meshable as a closed orientable manifold** — every edge in <=2 triangles, every edge in exactly 2 (`3F = 2E`), orientation-consistent.
- Mesh submissions: just the manifold/closed/orientation-consistent triangle gate.
- **Advisory diagnostics (flagged, NOT gated):** min face area < `0.001 mm²` (healthy bottoms out ~`0.05 mm²`); max face aspect ratio > `1000` (healthy single/double-digit; slivers `1e5`–`5e8`); max BREP tolerance > `0.1 mm` (healthy ~`0.05 mm`). Forge should keep exports well inside these even though they don't dock the score — Mecado reads them as "fragile export" tells.

**Metric 2 — Shape Similarity (weight 0.4 gen / 0.6 edit):** mean of two sub-metrics:
- **Surface Distance F1** (`shape_surface_distance_f1`): sample points + outward normals on both surfaces; a point is matched when the closest point on the *other mesh's surface* is within **0.5% of the GT bbox diagonal** AND normals agree within **20°**. Precision×recall -> F1.
- **Volume IoU** (`shape_volume_iou`): shared/combined volume via the **`manifold3d`** Boolean kernel.
- Tolerances scale with part size, so small features are intentionally *not* caught here — that's interface match's job.

**Metric 3 — Interface Match (weight 0.4 gen / 0.3 edit) — "does it bolt up?"**
- Each mating feature = a **Keep-Out Region (KOR, must be empty — holes/slots)** or **Keep-In Region (KIR, must be solid — bosses/pins)**, scored by volumetric **IoU measured with a thin shell of opposite material** (so oversize AND undersize both lose).
- **Bounded pose search** per feature: ±1° and ±1% of part size per axis; best fit kept.
- **Pass/fail ramp:** IoU ≥ 0.95 -> 1; ≤ 0.80 -> 0; linear between (sloppy fits score 0, not partial credit).
- A **mating group scores as its WORST feature (min)**; sample = **mean over independent groups**. One misplaced slot can zero an entire interface.

**Metric 4 — Topology Match (weight 0.2 gen / 0.1 edit).**
- Compares **Betti numbers** `(b0, b1, b2)` = (solid pieces, through-handles, internal voids). Coordinate/representation-invariant. Blind features (blind holes, fillets, chamfers) are topologically trivial and covered by shape/interface instead.
- Pipeline: union-find connected components; ray-cast containment for b0/b2; `b1 = b0 + b2 - χ/2` from Euler `χ = V-E+F`.
- Per-axis fuzzy log-ratio with sharpness **α = 2**: `s_i = ((min+1)/(max+1))^2`. **Aggregate = PRODUCT** `s0·s1·s2` — one wrong count collapses the whole metric (e.g. 4 holes vs 2 -> `(3/5)^2 = 0.36`; 2 pieces vs 1 -> `(2/3)^2 = 0.444`).

**Worked example (memorize for the demo):** a mounting plate where only the slot is shifted off-position scores `cad_score = 0.4·0.89 + 0.4·0.00 + 0.2·1.00 = 0.56` — shape and topology stay high, but the misplaced interface drags it down. This is the canonical "looks right, won't bolt up" failure CADGenBench is built to expose.

### 2.5 Reference baseline (what we're beating)
An iterative agent that writes **`build123d` Python**, renders the STEP, reviews renders, and refines in a loop until valid (also supports CadQuery for STEP, OpenSCAD for mesh; Python 3.12+, in-process PyVista/VTK render, no Chromium). **This is essentially the AdamCAD/Zoo/MecAgent class of system** — exactly the competitors Forge+Archie's native-kernel-CUA approach must outscore.

### 2.6 Current state of the art (the gap we exploit)
- Public leaderboard ceiling is **~0.39 overall**; an individual frontier result noted around **Claude "Fable 5" ≈ 0.4514**. Mecado/Rabinovich's framing: models are "far from precise enough to build functional parts."
- **Implication:** the >=0.85-every-dimension north-star is ~2× the current public best. Hitting it credibly = leadership. But it ONLY counts if scored through CADGenBench's exact gates above — invalid B-reps, missing watertightness, or misplaced interfaces zero out regardless of how good the render looks. **Validity rate** and **interface match** are where most submissions die; those are our two highest-leverage targets.

---

## 3. ALIGNMENT REQUIREMENTS — what Forge/Archie must demonstrate to become Mecado's go-to

> Ordered roughly by leverage on the CAD Score and on Mecado's stated "manufacturable accuracy over visuals" ideology. Each is concrete and verifiable.

1. **Beat the leaderboard, every dimension.** Forge+Archie must post a **validated** CADGenBench run with **aggregate CAD Score >= 0.85** AND **>= 0.85 on each of shape_similarity, interface, topology** AND **>= 0.85 on both `score_by_task_type.generation` and `.editing`** — not just the average. (Top public is ~0.39–0.45; this is the headline claim.)

2. **~100% CAD-validity rate on watertight B-rep.** Every Archie/Forge output must pass `BRepCheck_Analyzer.IsValid()` + watertight (no naked/free edges) + closed-orientable-manifold meshing (`3F=2E`). `run_summary.validity_rate` must be ~1.0. An invalid solid scores 0 no matter how close the geometry — so kernel robustness (no self-intersecting wires, no edges off-surface) is requirement zero.

3. **Native STEP / B-rep I/O, lossless, on the high-trust path.** Submit `output.step`, not mesh. Forge must **import** `input.step` for editing tasks and **export** AP203/AP214/AP242 STEP that round-trips through OCCT's reader without healing. Keep advisory diagnostics clean: min face area > `0.001 mm²`, aspect ratio < `1000`, BREP tolerance < `0.1 mm` (target the ~`0.05 mm` healthy band). Validates the "no external CAD deps / pure-C++ kernel" claim against Mecado's STEP fixtures.

4. **Engineering-drawing -> solid (multimodal generation).** Archie's VLM path must read the orthographic PNG drawing(s) (`input.png`/`input2.png`, multi-view) and produce a dimensionally correct solid — Surface-Distance-F1 within **0.5% of bbox diagonal** and normals within **20°**, Volume-IoU high. This is the generation task (49/81 fixtures) and exercises the assembly-context/multimodal training direction already in our corpus plan.

5. **Interface-grade feature placement (the make-or-break axis, weight 0.4).** Bolt holes, slots, bosses, pockets, locating jigs must land within **±1° and ±1% of part size**, with IoU **>= 0.95** against keep-out/keep-in sub-volumes (anything <=0.80 scores 0). Archie must reason about mating features as *functional interfaces*, not decoration. This is where almost everyone fails; it's the strongest differentiator and the most expensive to fake.

6. **STEP-editing workflow that beats the no-op (caps 0.4).** Given `input.step` + a text edit, Forge must apply a *local* parametric change (add/remove/resize a hole, move a slot, change a thickness) while leaving the rest untouched — `s_renorm > 0`, topology and interface preserved unless the edit demands otherwise. Requires real B-rep editing / feature recognition on *imported* geometry, not just rebuild-from-scratch. (32/81 fixtures.)

7. **Correct topology by construction.** Outputs must match GT `(b0,b1,b2)` exactly — right number of pieces, through-holes, internal voids. Since the metric is a *product*, a single spurious disconnected body or extra through-hole tanks it. Archie must not emit floating bodies or non-manifold unions; Forge's Boolean/union ops must be watertight (validates the Manifold/OCCT parity claim).

8. **Manufacturability, not visuals (Mecado's explicit ideology).** Demonstrate the things Mecado says LLMs *can't* do: hand-calculations, **design-for-3-axis-milling**, design-review contributions. Forge's CAM/DFM (3-axis toolpaths, draft/undercut checks) and FEA/CFD/MBD solvers are the differentiator vs every text-to-CAD competitor whose output is a pretty unmanufacturable mesh. Lead diligence with "it's manufacturable and analyzable," not "it renders nicely."

9. **Tool-agnostic, drop-in submission compatibility.** Produce the exact contract: `results/<run>/<sample>/output.step`, `meta.json`, zipped, centered at origin with the documented orientation rules; one candidate per sample; graceful `status: missing/invalid/valid`. Forge should script this end-to-end so Mecado can run "Forge as the home-testing environment" with zero glue. (Match `run_summary.json` / `result.json` schema exactly.)

10. **Pass Mecado's harder private/internal sets, not just the 81 public fixtures.** Public ground truth is private and the real evaluation is server-side; Mecado also holds proprietary datasets behind the benchmark. Forge/Archie must generalize — no overfitting to the 81. Our training corpus must mirror CADGenBench's part class: real mechanical parts with mating interfaces (jigs/bolt patterns/slots/bosses), full assembly context, multimodal (drawing + STEP + render).

11. **Robustness, determinism, and auditability.** No crashes on valid CAD (the grader treats a sub-metric exception as 0 and logs it). Deterministic, reproducible runs. Provide the methodology evidence Mecado/Rabinovich require for the **`validated`** tier (email-reviewed). A reproducible, inspectable pipeline is itself an alignment signal to a data/eval company.

12. **Scale and assembly readiness (beyond single parts).** CADGenBench today is single-part, but Mecado's worldview is "how real products are designed/built/validated" — assemblies, mates, BOMs, PMI/GD&T. Forge's large-assembly + GD&T/PMI capability (a verified moat vs AdamCAD/Zoo) is what lets Mecado position Forge as the *professional* environment rather than another toy. Demonstrate import of a Mecado multi-part assembly + interference/tolerance analysis.

13. **CC0/clean-data and IP hygiene.** Mecado's entire pitch is escaping "proprietary silos" and the legal mess of scraped GrabCAD data. Archie's training corpus and any imported assets must be demonstrably clean (CC0 / synthetic / licensed) so Mecado can recommend Forge without IP risk to its own customers.

14. **Co-evaluation / partnership ergonomics.** Provide a one-command "run CADGenBench on Forge" harness + HTML report parity, so Mecado can use Forge as the reference home-testing rig for *their* dataset customers. Low-friction integration is what converts "scores well" into "is our default."

---

## 4. Strategic read for ArchDisc

- **Mecado is the perfect external validator and likely a Link Ventures diligence proxy.** Winning CADGenBench publicly (validated tier, >=0.85 every axis, ~2× the field) is simultaneously a benchmark win, a Mecado partnership, and a Link Ventures signal — three birds.
- **The win condition is geometry truth, not rendering.** CADGenBench gates on watertight B-rep validity and scores feature placement to ±1%/±1° with hard ramps. This *favors* Forge's native pure-C++ OCCT/Manifold/CGAL kernel + STEP I/O over the build123d/OpenSCAD/text-to-mesh competitor class — but only if Archie reliably emits **valid, interface-correct** parts. Validity rate and interface match are the two axes to obsess over.
- **The editing task needs real imported-B-rep editing**, not rebuild-from-scratch — this is a kernel-parity requirement (feature recognition + local parametric edit on foreign STEP), and a known frontier for us.
- **Train Archie on Mecado-class data:** real mechanical parts with mating interfaces, multi-view drawings, paired STEP + edit requests, full assembly context. This directly aligns with the existing corpus directives (assembly-context + multimodal, drawing->STEP, GD&T/PMI).

---

## Sources
- Mecado site: https://www.mecado.com , https://www.mecado.com/benchmark
- CADGenBench HF Space: https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench
- CADGenBench public data: https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data (private GT: `cadgenbench-data-gt`; submissions: `cadgenbench-submissions`)
- CADGenBench code (Apache-2.0): https://github.com/huggingface/cadgenbench — `docs/metrics.md`, `docs/metrics/{cad_validity,shape_similarity,topo_match,interface_match}.md`, `docs/benchmark/{submission,validation}.md` (fetched verbatim via `gh api`)
- Michael Rabinovich launch thread: https://x.com/MikushRab/status/2063999885796614522
- Rabinovich "Opus 4.8 through our CAD tasks": https://www.linkedin.com/posts/michael-rabinovich-114aa952_opus-48-just-dropped-and-i-ran-it-through-activity-7466148382319816704-HEVE
- Mecado launch (Blake Courter): https://www.linkedin.com/posts/blakecourter_mecado-mechanical-data-activity-7427850332736479232-B9o8
- Elie Cuevas / Mecado posts: https://www.linkedin.com/in/eliecuevas/ , https://www.linkedin.com/posts/eliecuevas_mecado-mechanical-data-activity-7427799695382634496-nUyF , https://www.linkedin.com/posts/mecadoinc_mecado-mechanical-data-activity-7435828387350306817-GgZW
- AINews 2026-06-08 (benchmark framing): https://news.smol.ai/issues/26-06-08-not-much
- PitchBook (HQ/CEO): https://pitchbook.com/profiles/company/919674-55
- Link Ventures (investor): https://f4.fund/firms/link-ventures
- Comparable academic benchmark (context): CADBench, https://arxiv.org/abs/2605.10873
