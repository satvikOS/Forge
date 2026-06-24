# CAD-Generation Ecosystem — Actionable Brief for Archie / Forge

_Synthesis of four primary-source research findings (earthtojake, build123d, Mecado,
CADGenBench). Compiled 2026-06-24 for `docs/SCOPE_2026-06-24/research/`._

> **Honesty contract (Forge Engineering Bible §0/§9).** Every external claim carries a
> real source URL. Repo claims carry `file:line`. Post-cutoff leaderboard model names
> (e.g. "Claude Fable 5", "GPT-5.5 Pro", "Gemini 3.1") are reported **verbatim from the
> live `results.jsonl`** and are **UNVERIFIED** as to identity/recency. Items that are
> non-public, JS-gated, or not-yet-built are flagged **UNVERIFIED** / **TODO**.
>
> This file is the *ecosystem-wide* synthesis. It is complementary to — not a
> replacement for — the deeper single-topic files already in this tree:
> `../../CADGENBENCH_SPEC.md` (the gate, with exact formulas + Forge-harness
> alignment) and `./mecado-alignment.md` (Mecado-as-reference-user plan). Where those
> go deeper, this points to them rather than re-deriving.

---

## 0. Executive summary — the 8 highest-leverage takeaways

1. **The ≥0.85-every-dimension target is ~1.9× current SOTA, not a "beat the field"
   bar.** Live `results.jsonl` ceiling is **Claude Fable 5 = 0.4514** (gen 0.3728 /
   edit 0.5718); the frontier clusters **0.31–0.45**. **No model is anywhere near
   0.85.** So 0.85 is a near-perfect, category-defining frontier result — "the
   instrument is validated; the gap is the model" is exactly right.
   Source: <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions/resolve/main/results.jsonl>.

2. **The benchmark is geometry-only and tool-agnostic — you submit a STEP/BREP (or
   watertight mesh), never code.** How you build it (build123d, CadQuery, OpenSCAD,
   Onshape, Forge-native, or no-LLM) is unconstrained. **This is Forge's biggest
   structural advantage:** Forge's native OCCT 7.9.3 kernel exports clean watertight
   B-rep STEP directly, so the validity gate (which zeroes ~10–18% of LLM-only
   baseline samples) should be ~100% for Forge.
   Source: <https://github.com/huggingface/cadgenbench>, README + `docs/metrics.md`.

3. **Therefore Archie should NOT switch to emitting build123d/OpenSCAD Python.** The
   model already emits **kernel tool-call verbs** that dispatch natively to OCCT
   (`frontend/src/ai/ForgeRunner.js`, `ForgeToolBridge.js` — a "build123d-style"
   implicit-part API, but executed in-kernel, not transpiled to Python). That path is
   *strictly superior* for the validity gate (no Python exec, no OCP version drift —
   Forge's OCCT is the same 7.9.3 that build123d's `cadquery-ocp` wraps). **Keep
   verb-emission as the primary path; add a STEP-export submission adapter.** See §3.

4. **Topology Match is the killer dimension and the one most likely to block 0.85.**
   It compares Betti numbers `b0·b1·b2` **multiplied** — one wrong hole/void/component
   count collapses the whole axis. To clear it, Archie must get **exact** feature
   counts right (N through-holes, N pockets, N bosses) and Forge must **verify Betti
   numbers in-kernel before submit.** Train on exact counts; gate on them. (Source:
   `metrics_page.py` per-axis formula; see `../../CADGENBENCH_SPEC.md`.)

5. **Forge already has the scorer; the gen formula is byte-identical to CADGenBench.**
   `forge-kernel/test/cadscore_harness.mjs` implements validity-gate →
   `0.4·shape + 0.4·interface + 0.2·topology` (gen) and the edit no-op renormalization.
   Two per-axis sub-formulas (topology falloff, interface IoU ramp) are slightly off
   vs the published verbatim forms and **should be reconciled to exact** so the local
   reward equals the real bench. Then it is a closed RL reward signal. (Detail:
   `../../CADGENBENCH_SPEC.md` "Forge alignment".)

6. **The 81 public fixtures are immediately ingestible as an eval/training set** (49
   generation drawings + 32 edit STEP-pairs; 199 MB; **ODC-BY**). Pull them into the
   CUA eval harness now. The ground truth is **private** (server-side only), so you
   cannot self-score against the *real* GT — you self-label your own corpus and use
   the **live leaderboard as the external number.** Submitting Forge and beating ~0.45
   is a concrete, demo-worthy SOTA milestone.
   Source: <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data>.

7. **step.parts (earthtojake) is a separate, immediately-usable 12k–16k MIT-ish STEP
   part catalog with a public API** (`api.step.parts/v1`) — a candidate corpus for
   Forge std-parts / assembly-context / GD&T grounding, under the download→process→
   delete storage rule. **Watch third-party license tags** (read
   `THIRD_PARTY_NOTICES.md` before training use). earthtojake is otherwise a *harness*
   (no model, no quantitative bench, no sim) and **validates Archie's write→run→
   render→inspect→self-correct thesis** rather than competing with it.

8. **Do not conflate the players.** CADGenBench = **Mecado × Hugging Face** (Link
   Ventures portfolio — the *same fund the ArchDisc deck targets*, so this is a warm
   diligence proxy). build123d = the **reference baseline's codegen language** (and
   CadQuery's OCP sibling). earthtojake = an **independent Claude-Code/Codex plugin**,
   no link to Mecado. CadBench / BenchCAD / Text2CAD-Bench are **different arXiv
   benchmarks**, NOT the gate. Beating CADGenBench is also a Mecado-partnership +
   Link-Ventures-signal play (see `./mecado-alignment.md`).

---

## 1. The factual landscape — who/what each is + how they interconnect

### 1.1 The four players

| Entity | What it is | Has a model? | Has a scored bench? | Link to the gate |
|---|---|---|---|---|
| **Mecado Inc** | Cambridge MA / MIT-rooted "Mechanical Data" company (founders Elie Cuevas, Dylan Ryan; advisor Blake Courter). Sells CAD-native, expert-annotated, physics-informed datasets + product **Vulcan** (agentic-in-CAD co-pilot). Backed by **Link Ventures**. | 2 NX-CAD models on HF (`Mecado/nx-cad-lora-10k`, `Mecado/nx-cad-vllm-comp-8x128x21`); no public datasets under own org. | **Yes — owns CADGenBench** | Author of the gate. |
| **CADGenBench** | Mecado × Hugging Face ("HuggingAI4Engineering" org) generation+editing benchmark. Open-source scorer + live leaderboard + 2 datasets; **private ground truth.** | n/a (a benchmark) | **It IS the bench** | **The gate itself.** |
| **build123d** | Python parametric B-rep "CAD-as-code" lib (maintainer Roger Maitland / "gumyr"), OCCT-backed via `cadquery-ocp` (OCP). CadQuery's refactored sibling. | No (a library) | No | **The reference baseline agent's codegen language.** |
| **earthtojake** | Jake Fitzgerald (NYC, South Park Commons). `text-to-cad` agent-skill harness (6.9k★) installed into Claude Code/Codex; plus `step.parts` (12k–16k STEP catalog + API), `cad-viewer`, `implicit.js`. | **No (a harness on the host agent)** | **No (10 qualitative GIF demos, no scoring)** | **None — independent.** Mirrors Archie's thesis. |

### 1.2 How they interconnect

```
                         Link Ventures  ──────invests──────►  Mecado Inc
                              │                                   │
                       (also the fund                      builds & sells
                        ArchDisc's deck                   "Mechanical Data"
                          targets)                                │
                                                    co-releases with Hugging Face
                                                                  ▼
                                                          ┌──────────────┐
                                                          │ CADGenBench  │  ◄── THE GATE (≥0.85)
                                                          │  (the bench) │
                                                          └──────┬───────┘
                                          reference baseline agent│writes
                                                                  ▼
   earthtojake/text-to-cad ──── same "CAD-as-code" ────►  build123d (Python)
   (Claude Code plugin, 6.9k★)    thesis & target          │  ──also── CadQuery
        │                                                  │  (share cadquery-ocp / OCP)
        └── step.parts (12k–16k STEP catalog + API)        ▼
            ↑ candidate Forge corpus                 OCCT 7.9.3 B-rep (TopoDS)
                                                           │  ← SAME kernel version Forge
                                                           ▼     ships natively (forge-kernel.node)
                                                    STEP / BREP  ← submission format (tool-agnostic)
```

Key non-obvious facts:
- **build123d and CadQuery share the exact same OCCT binding** (`cadquery-ocp` =
  pybind11 wrap of OCCT 7.9.3.1.1). Objects interchange. So a CadQuery training corpus
  is reusable to emit build123d, and **Forge's native OCCT 7.9.3 is the same kernel
  version** — geometry-level parity is exact.
  Source: <https://pypi.org/project/cadquery-ocp/>.
- **earthtojake's "benchmarks 01–10" are NOT a bench** — qualitative prompt+GIF demos
  with no score/leaderboard/GT. Use the 10 prompts (impeller, planetary gear stage,
  radial-engine cylinder w/ cooling fins, spiral staircase, clevis bracket) as **eval
  prompt variety**, never as an eval metric.
- **Confirmed NEGATIVE:** no link earthtojake↔Mecado↔Adam/AdamCAD↔CADGenBench beyond
  "all in the text-to-CAD space."

---

## 2. CADGenBench — target representation + exact scoring + what ≥0.85 requires

> Authoritative formula source: `metrics_page.py` + `docs/metrics.md` (both fetched in
> the underlying research; verbatim per-axis forms transcribed in
> `../../CADGENBENCH_SPEC.md`). This section is the operational summary.

### 2.1 Tasks & I/O
- **Generation (49 fixtures):** engineering drawing PNG(s) (+ text) → valid 3D solid.
- **Editing (32 fixtures):** `input.step` + `edit_description.txt` → edited solid.
- **Input bundle per fixture:** `description.yaml` (+ for edits: `input.step`,
  `input.mesh.npz`, `renders/` iso/front/top/right PNGs).
- **Submission:** `submission.zip` with root `meta.json` + one `output.*` per sample:
  `output.{step,stp,brep}` **preferred** (high-trust watertight gate) or watertight
  mesh `{stl,obj,off,3mf,ply}`. Center at origin; document orientation. Pre-check with
  `sanity_check_submission.py`.
- **Alignment:** grader rigidly aligns **rotation+translation only, never scale** (ICP
  over identity + 24 octahedral PCA poses).

### 2.2 The CAD Score (range [0,1])

**Validity gate (binary {0,1}) runs first — fail ⇒ `cad_score = 0` for that sample.**
Validity = B-rep watertight + meshable as closed orientable manifold (no naked edges,
no topo errors); meshes must be watertight + manifold + orientation-consistent.

If valid, weighted sum of three orthogonal axes:

| Task | Formula |
|---|---|
| **Generation** | `cad_score = 0.4·shape + 0.4·interface + 0.2·topology` |
| **Editing** | `cad_score = 0.6·s_renorm + 0.3·interface + 0.1·topology` |

where `s_renorm = max(0, (shape − b_shape)/(1 − b_shape))` renormalizes against the
**no-op (unedited input) baseline** so trivial copies cap at ~0.4 → **real edits
required, not echoes.**

**The four dimensions:**

1. **CAD Validity** — the binary gate above. *(This is Forge's structural win.)*
2. **Shape Similarity** = `0.5·(surface_distance_F1 + volume_IoU)`.
   - Surface F1: points sampled on both surfaces; a match needs nearest point within
     **0.5% of bbox diagonal** AND normals agreeing within **20°**.
   - Volume IoU = solid intersection/union after rigid alignment (no scaling).
3. **Topology Match** — Betti `b0` (components), `b1` (through-handles/holes), `b2`
   (internal voids) of tessellated boundary. Per-axis
   `s_i = ((min(cand,gt)+1)/(max(cand,gt)+1))²`, then **MULTIPLIED across b0·b1·b2.**
   **One wrong count collapses the axis. Very unforgiving.**
4. **Interface Match** — mating features as keep-out (KOR) + keep-in (KIR) sub-volumes;
   per-feature volumetric IoU with ramp (**IoU≥0.95→1.0, ≤0.80→0**, linear between).
   Pose search ±1° and ±1% of part size per axis. **Group score = its WORST feature
   (min); fixture score = mean across groups.**

Tolerances are size-proportional throughout. Axes are deliberately orthogonal.

### 2.3 What ≥0.85 on EVERY dimension concretely requires

Because validity gates and topology multiplies, **0.85-every-axis is a near-perfect
part.** Concretely, per submission Archie/Forge must:

- **Validity → ~1.0:** every output a clean watertight B-rep STEP. **Forge native OCCT
  ⇒ structurally achievable; LLM-only baselines cannot.** *(Highest-leverage moat.)*
- **Topology → ≥0.85:** exact `b0`, `b1`, `b2`. With the multiplicative form, e.g.
  getting `b1` off by one hole on a 4-hole flange ⇒ `((4+1)/(5+1))² = 0.69` on that
  axis alone, before multiplying the others. **You must count features exactly.**
  → **Verify Betti in-kernel pre-submit; train on exact hole/pocket/boss counts.**
- **Interface → ≥0.85:** mating features placed to **IoU≥0.95** within ±1°/±1% slack,
  and the **worst** feature carries the group. → precise bolt-circle/slot/boss/jig
  placement; this is the PMI/GD&T/assembly-fit work flagged **bound-not-bridged** in
  Forge's kernel. → wire a geometric interface-IoU evaluator as a pre-submit gate.
- **Shape → ≥0.85:** 0.5%-bbox surface match + volume IoU + correct normals. Coarse
  blockout (Archie's historical failure mode) fails this. → dimensional accuracy +
  correct fillets/chamfers/draft, not primitive stand-ins.
- **Editing:** make a **real** change (no-op capped ~0.4) and preserve everything else
  (high `b_shape` ⇒ s_renorm punishes over-editing too).

**Reality check:** SOTA generation sub-scores sit ~0.37 today. Hitting 0.85 is a
genuine research result, not a tuning pass — plan accordingly.

---

## 3. Should Archie emit build123d (or OpenSCAD / STEP / Forge-native)?

**Recommendation: keep Forge-native kernel-verb emission as the primary path; add a
STEP-export submission adapter. Do NOT pivot Archie to generate build123d/OpenSCAD
Python as the runtime path.** Optionally keep build123d as a *secondary* offline
codegen target for corpus interop only.

### 3.1 Reasoning

| Option | Validity gate | Kernel parity | Pros | Cons |
|---|---|---|---|---|
| **Forge-native verbs → OCCT STEP** (current) | **Best (~100%)** | Exact (OCCT 7.9.3) | No Python exec, no OCP drift, full sim/CAM/assembly stack, already built (`ForgeToolBridge.js`), already scored (`cadscore_harness.mjs`) | Forge-only ecosystem; must add a STEP-submission packer |
| **Emit build123d Python** | Good (OCCT via OCP) but needs Python exec sandbox + can raise on bad code | Same OCCT version | It IS the bench reference language; large CadQuery corpus interops via OCP; LLM-friendly syntax | Adds a Python runtime path Forge doesn't need; loses native sim/CAM coupling; doubles the maintenance surface |
| **Emit OpenSCAD** | **Worst** — CSG→mesh, needs OpenSCAD binary, mesh validity fragile | None (not OCCT) | Simple syntax | Mesh-native ⇒ validity/topology risk; lowest-fidelity baseline |
| **Emit raw STEP** | n/a | n/a | — | LLMs cannot author valid STEP directly |

The benchmark scores **only the final solid** and is **tool-agnostic** — there is **no
credit for the build method.** Given that, the right move is to maximize validity +
geometric exactness, which the **native OCCT path does best.** Archie's current
emission is already a "build123d-style" implicit-part verb API
(`part.add`/`part.subtract`/pattern verbs, `frontend/src/ai/ForgeToolBridge.js:139,890`)
— it has build123d's *ergonomics* without build123d's *Python-exec liabilities.*

### 3.2 What this means for the Forge kernel

- **Add a CADGenBench submission packer:** Forge body → `export_step` → `output.step` +
  `meta.json`, zipped, passing `sanity_check_submission.py`. **(New, small. TODO.)**
- **Reconcile the two per-axis sub-formulas** in `cadscore_harness.mjs` (topology
  falloff, interface IoU ramp) to the verbatim CADGenBench forms so local reward ==
  real bench. (Detail in `../../CADGENBENCH_SPEC.md`.)
- **Wire pre-submit gates the kernel already *binds* but doesn't *bridge*:** in-kernel
  **Betti-number** computation on tessellated boundary; **interface keep-in/keep-out
  IoU** evaluator; watertight/manifold validity self-check. These become both a
  pre-submit guard and an RL reward.
- **No new external deps** (native-no-deps rule): all of the above is OCCT + existing
  Forge tessellation + in-house geometry.

### 3.3 What this means for the training corpus

- **Train on exact feature counts + dimensions**, not blockout primitives (Archie's
  documented straight-primitive failure mode). Topology multiply punishes count
  errors; shape F1 punishes coarse geometry.
- **Reuse CadQuery/build123d corpora cheaply:** because OCP interchanges, any
  text→CadQuery corpus (e.g. the ~170k Text-to-CadQuery pairs, arXiv 2505.06507) can
  be transpiled/retargeted to teach Forge-verb sequences — train on the *geometry
  intent*, emit Forge verbs. **(License-check each corpus first.)**
- **Add the build123d/CadQuery joint model** (Rigid/Revolute/Linear/Cylindrical/Ball +
  `connect_to`) to the **dynamic-structures / multibody corpus**
  (per `feedback-24b-dynamic-structures`) and the **assembly-context** direction
  (`feedback-assembly-context-multimodal`) — it maps cleanly onto interface_match.
- **Train on the 81 fixtures' task shapes** (drawing→solid, STEP+edit→solid) and on
  the **editing discipline** (real change + preserve-rest), since editing is weighted
  toward shape/renorm.

---

## 4. What Mecado's datasets give us (license-permitting)

| Asset | URL | Size / license | Use for Archie/Forge |
|---|---|---|---|
| **cadgenbench-data** (public inputs) | <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data> | 81 fixtures (49 gen + 32 edit), 199 MB, **ODC-BY** | **Ingest now** into CUA eval harness as the canonical eval prompt set + edit-task set. Drawings + renders + edit STEPs are real mechanical parts with mating interfaces. |
| **cadgenbench-data-gt** (ground truth) | <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data-gt> | Private, server-side, leaderboard-only | **Not directly usable.** Cannot self-score the real fixtures. → self-label own corpus; use leaderboard as external number. |
| **cadgenbench-submissions** | <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions> | ~14.7 GB, **CC-BY-4.0**, `results.jsonl` = live board | Mine competitor submissions/failure modes; `results.jsonl` is the live SOTA reference. Per-*dimension* sub-scores are **NOT** exposed (only aggregate + per-task + validity_rate). |
| **cadgenbench scorer + baseline** | <https://github.com/huggingface/cadgenbench> | **Apache-2.0** | Replicate exact scoring pipeline; align Forge's `cadscore_harness.mjs`; reuse the render-validate-refine loop shape (Forge plugs its kernel as backend + its scorer as reward). |
| **Mecado/nx-cad-lora-10k**, **nx-cad-vllm-comp-...** | <https://huggingface.co/mecado> | 2 NX-CAD text-gen models | Competitor reference (NX-CAD oriented); not training data. |

**Adjacent (NOT Mecado) — separate licenses, useful anyway:**
- **earthtojake/step.parts** — 12k–16k STEP parts + `api.step.parts/v1` (filter by
  category/family/standard) + GLB/PNG previews + SQLite. **MIT for original material;
  third-party STEP keeps original licenses → read `THIRD_PARTY_NOTICES.md` before
  training use.** Candidate Forge std-parts / assembly-context / GD&T-grounding corpus.
  **UNVERIFIED:** whether files are bulk-downloadable vs per-part API only.
- **CadBench (arXiv 2605.10873, MIT-licensed repo)** — ~1.4M programs / 18k eval,
  five modalities. **Separate bench**, but a usable corpus. *(Not the gate.)*

**Storage discipline (mandatory):** download → process → delete, one at a time,
parquet via `iter_batches` (`feedback-models-streaming-storage`). 199 MB fixtures are
small; step.parts/CadBench are large — stage carefully.

---

## 5. Gap analysis vs Archie's current approach + prioritized action list

### 5.1 Where Forge/Archie already stands (verified in-repo)

- **ForgeCADScore exists** (`forge-kernel/test/cadscore_harness.mjs`, 134 KB) and its
  **generation formula is byte-identical** to CADGenBench's (`0.4/0.4/0.2`, validity-
  gated; edit no-op renorm matches). Per `CADGENBENCH_SPEC.md`, replay = 1.0.
- **Native OCCT 7.9.3 kernel** (`forge-kernel.node`) — **same OCCT version** build123d
  wraps ⇒ exact geometry parity, clean watertight STEP export ⇒ structural validity win.
- **Archie emits kernel verbs**, a build123d-style implicit-part API, dispatched
  natively (`frontend/src/ai/ForgeRunner.js`, `ForgeToolBridge.js`) — the right
  representation already; no Python-exec liability.
- **CADGenBench characterized** in `CADGENBENCH_SPEC.md`; Mecado alignment planned in
  `mecado-alignment.md`.

### 5.2 The gaps (what blocks 0.85)

| # | Gap | Evidence | Blocks which axis |
|---|---|---|---|
| G1 | **The gap is the model, not the instrument.** Archie historically emits coarse/blockout primitives; SOTA gen is ~0.37. | `archie-cad-fidelity-program`; results.jsonl | Shape, Topology |
| G2 | **No in-kernel Betti / topology self-check pre-submit.** | kernel binds-not-bridges PMI/topology | Topology (the killer) |
| G3 | **Interface (keep-in/keep-out) IoU evaluator not bridged.** | PMI/GD&T flagged bound-not-bridged | Interface |
| G4 | **No CADGenBench submission packer** (Forge body → output.step + meta.json zip). | not present | all (can't submit) |
| G5 | **Two per-axis sub-formulas in `cadscore_harness.mjs` diverge** from verbatim CADGenBench. | `CADGENBENCH_SPEC.md` "Forge alignment" | reward fidelity |
| G6 | **81 public fixtures not yet ingested** into the CUA eval harness. | dataset not pulled | eval coverage |
| G7 | **Editing discipline weak** (no-op cap; must make real change + preserve rest). | edit task = 0.6/0.3/0.1 | edit cad_score |
| G8 | **Cannot self-score real fixtures** (GT private) ⇒ must self-label own corpus + use live board. | data-gt gated | eval ground truth |

### 5.3 Prioritized action list (highest leverage first)

**P0 — close the measurement loop (days, no new deps):**
1. **Ingest the 81 fixtures** (ODC-BY, 199 MB) into the CUA eval harness as canonical
   gen + edit eval sets. (G6)
2. **Build the submission packer** (Forge body → `output.step` + `meta.json` → zip →
   `sanity_check_submission.py`). (G4)
3. **Reconcile `cadscore_harness.mjs`** topology-falloff + interface-IoU-ramp to the
   verbatim forms; re-confirm replay=1.0. (G5)
4. **Bridge in-kernel pre-submit gates:** Betti `b0/b1/b2` on tessellated boundary +
   interface keep-in/keep-out IoU + watertight/manifold validity self-check. (G2, G3)
   → these double as RL reward terms.

**P1 — submit + establish the external number (this week):**
5. **Run Forge native through the local scorer on the 81 fixtures**, then **submit to
   the live HF leaderboard.** Beating ~0.45 aggregate is SOTA + demo-worthy. (G8)
6. **Stand up the closed RL loop:** Archie emits verbs → Forge builds → local
   CADGenBench-exact scorer = reward → iterate (the published ForgeCADScore replays
   1.0; the model is the gap). (G1)

**P2 — close the model fidelity gap (the multi-week frontier work):**
7. **Train on exact feature counts + dimensions + fillets/chamfers/draft**, not
   blockout primitives — directly attacks Topology (multiply) + Shape (F1). (G1, G2)
8. **Train the editing discipline:** real change + preserve-rest, anti-no-op. (G7)
9. **Train interface/mating precision** (bolt circles, slots, bosses, jig seats to
   IoU≥0.95) — the PMI/GD&T/assembly-context corpus. (G3)
10. **Retarget CadQuery/build123d corpora via OCP interop** to teach Forge-verb
    sequences (geometry intent → native verbs); add the joint/assembly model to the
    multibody corpus. (license-check each.)

**P3 — ecosystem leverage:**
11. **Evaluate step.parts** (read `THIRD_PARTY_NOTICES.md`; test `api.step.parts/v1`)
    as a std-parts / assembly-context corpus, storage-bounded.
12. **Add earthtojake's 10 prompts** (impeller, planetary gear, radial-engine cylinder,
    spiral staircase, clevis) to the **eval prompt-variety pool** (per
    `feedback-vary-test-prompts`) — as prompts, never as a metric.
13. **Frame the Mecado/Link-Ventures play** per `./mecado-alignment.md`: a validated
    ≥0.85 run is simultaneously a benchmark win, a partnership opener, and a
    Link-Ventures diligence signal.

---

## 6. Unknowns / unverified (carry forward)

- **Live leaderboard model names** ("Claude Fable 5", "GPT-5.5 Pro", "Gemini 3.1",
  "Opus 4.6/4.7/4.8") are **post-cutoff, read verbatim from `results.jsonl`** — identity
  unverified. Aggregate ceiling 0.4514 read via WebFetch summarizer, not byte-for-byte.
- **Per-dimension sub-scores per submission are NOT exposed** in `results.jsonl` (only
  aggregate + per-task + validity_rate). The Space's per-submission HTML report has
  them but is server-rendered (not fetched).
- **Exact `b_shape` no-op baseline values** and **surface-sampling point counts** are in
  code but were summarized, not line-verified.
- **mecado.com pages JS-gated** (title only); **PitchBook 403** (funding amount/round
  unconfirmed; Link Ventures investor confirmed, no YC).
- **step.parts:** part count inconsistent (12k vs 16k); bulk-download vs API-only
  **unverified**; per-part license split needs `THIRD_PARTY_NOTICES.md`.
- **The X announcement** (x.com/MikushRab/status/2063999885796614522) returned 402;
  CADGenBench attribution corroborated via GitHub/Space/datasets instead.
- **CADGenBench total sample count beyond the 81 public fixtures** and the private GT
  contents are inferred from data cards, not read.

---

### Sources (primary, all carried from the underlying research)

- CADGenBench code/scorer/baseline: <https://github.com/huggingface/cadgenbench> ·
  README <https://raw.githubusercontent.com/huggingface/cadgenbench/main/README.md> ·
  metrics <https://raw.githubusercontent.com/huggingface/cadgenbench/main/docs/metrics.md>
- Leaderboard Space + verbatim formulas:
  <https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench> ·
  `metrics_page.py` <https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench/resolve/main/metrics_page.py>
- Datasets: <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data> ·
  <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data-gt> ·
  <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions> ·
  live board <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-submissions/resolve/main/results.jsonl>
- Mecado: <https://www.mecado.com> · <https://www.mecado.com/benchmark> (JS-gated) ·
  <https://huggingface.co/mecado> · founders via PitchBook 919674-55 (403) + LinkedIn
- build123d: <https://github.com/gumyr/build123d> ·
  <https://build123d.readthedocs.io/en/latest/key_concepts.html> ·
  <https://build123d.readthedocs.io/en/latest/joints.html> ·
  OCP <https://pypi.org/project/cadquery-ocp/> · Text-to-CadQuery <https://arxiv.org/html/2505.06507v1>
- earthtojake: <https://github.com/earthtojake> ·
  <https://github.com/earthtojake/text-to-cad> · <https://github.com/earthtojake/step.parts> ·
  `api.step.parts/v1`
- Separate (NOT the gate): CadBench <https://arxiv.org/abs/2605.10873> · BenchCAD
  <https://arxiv.org/abs/2605.10865> · Text2CAD-Bench <https://arxiv.org/abs/2605.18430>

### In-repo cross-references
- `../../CADGENBENCH_SPEC.md` — the gate, exact formulas, ForgeCADScore alignment + the
  two divergent sub-formulas.
- `./mecado-alignment.md` — Mecado-as-reference-user / Link Ventures plan.
- `forge-kernel/test/cadscore_harness.mjs` — Forge's CADGenBench-aligned scorer.
- `frontend/src/ai/ForgeRunner.js`, `frontend/src/ai/ForgeToolBridge.js` — Archie's
  native kernel-verb emission (build123d-style implicit-part API, dispatched to OCCT).
- `MODEL_DATA.md` — Archie training-data inventory + license posture.
