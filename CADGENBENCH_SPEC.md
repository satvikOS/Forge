# CADGenBench — Specification & Forge Alignment

**Research task A — "THE GATE".** Characterize CADGenBench from primary sources and
connect it to Forge's existing `ForgeCADScore` scorer
(`forge-kernel/test/cadscore_harness.mjs`).

> **Honesty contract (Forge Engineering Bible §0/§9).** Every external claim below
> carries a real, accessible source URL. Every repo claim carries `file:line`
> evidence. Anything non-public, unverified, or not-yet-built is marked
> **UNVERIFIED** / **TODO** explicitly. No invented dimensions, no invented numbers.
> Research date: 2026-06-20.

---

## Summary

**CADGenBench** is a real, public benchmark that "measures how well AI systems
produce correct 3D mechanical parts." It is a collaboration between **Hugging Face**
and **Mecado** (the Link Ventures mechanical-data company), published on Hugging Face
and GitHub. It is **NOT** an arXiv paper — the canonical artifacts are a GitHub repo
(scoring engine + reference baseline), a public input dataset, a private ground-truth
dataset, and a leaderboard Space.

Sources (all fetched and verified 2026-06-20):
- GitHub repo + README: <https://github.com/huggingface/cadgenbench>
  (raw README: <https://raw.githubusercontent.com/huggingface/cadgenbench/main/README.md>)
- Leaderboard Space: <https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench>
- Metrics explainer (Space source, verbatim formulas):
  `metrics_page.py` at
  <https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench/resolve/main/metrics_page.py>
- Public input dataset: <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data>
- Private GT dataset (access-gated): <https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data-gt>
- Canonical metric doc: `docs/metrics.md` at
  <https://raw.githubusercontent.com/huggingface/cadgenbench/main/docs/metrics.md>
- Mecado benchmark landing page: <https://www.mecado.com/benchmark>
  (page is JS-rendered; it surfaced in search as the Mecado side of the collaboration
  but returned an empty shell to a plain fetch — its substantive content is the same
  GitHub/Space material above).

**Headline finding for Forge:** Forge's `ForgeCADScore` was built directly against
this benchmark's CAD Score. The **generation** formula is **byte-identical** to
CADGenBench's published generation formula (`0.4·shape + 0.4·interface + 0.2·topology`,
gated by validity), and the **editing** no-op renormalization matches too. The main
remaining gaps are (a) Forge cannot self-score against the **real CADGenBench fixtures**
because the ground truth is private (Forge self-labels its own corpus instead), and
(b) two per-axis sub-formulas differ slightly from CADGenBench's exact definitions
(topology falloff and interface IoU ramp — see "Forge alignment").

### Do NOT confuse CADGenBench with these (separate benchmarks found in search)

The web search conflated several similarly-named 2026 benchmarks. These are **distinct
arXiv papers**, NOT CADGenBench, and must not be cited as CADGenBench:
- **CADBench** — arXiv 2605.10873 (Doris, Sony, Nehme, Syla, Heyrani Nobari, Ahmed;
  repo `github.com/anniedoris/CADBench`, MIT-licensed). Multimodal CAD *program*
  generation, five input modalities, "six metrics," ~1.4M programs, 18k eval samples.
  Source: <https://arxiv.org/abs/2605.10873>. **Note (corrected 2026-06-20):** the
  earlier "MIT-side authors" affiliation claim is **UNVERIFIED** — the abstract page lists
  no institutional affiliations; do not assert MIT authorship.
- **BenchCAD** — arXiv 2605.10865. Source: <https://arxiv.org/abs/2605.10865>.
- **Text2CAD-Bench** — arXiv 2605.18430. Source: <https://arxiv.org/abs/2605.18430>.

These overlap thematically (geometric/topological scoring of generated CAD) but are
separate efforts. CADGenBench is specifically the **Mecado × Hugging Face** STEP-file
benchmark with the four-axis CAD Score documented below.

---

## Dimensions (the four scored axes)

CADGenBench scores each candidate on **four axes**, the first being a hard gate.
Verbatim from the repo README "Metrics" table
(<https://raw.githubusercontent.com/huggingface/cadgenbench/main/README.md>):

| Axis | What it captures | Range |
|---|---|---|
| **Validity** | "Is the BREP well-formed/watertight, or is the submitted mesh watertight/manifold/orientable? **Gate: failure zeroes the rest.**" | {0, 1} |
| **Shape similarity** | "Geometry distance (surface distance F1, volume IoU)." | [0, 1] |
| **Interface match** | "Mating-feature correctness via authored keep-in / keep-out sub-volumes." | [0, 1] |
| **Topology match** | "Betti numbers (b0, b1, b2) of the tessellated boundary." | [0, 1] |

A separate **dimension-accuracy / numeric-L1** axis is **NOT** part of the public
CADGenBench CAD Score (it appears only in Forge's harness as a diagnostic — see Forge
alignment). **UNVERIFIED** whether `docs/metrics/` per-axis files add any further
diagnostic axes; the four above are the scored ones per README and `metrics_page.py`.

---

## Input format

Two task types, declared per sample in `description.yaml` (`generation` | `editing`).
Sources: README "Dataset" + dataset card
(<https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data>).

- **Generation:** "from an engineering drawing of a part, produce a valid,
  geometrically correct 3D model." Each generation sample ships an engineering
  **drawing image** (`input.png`, possibly multiple) plus a **text prompt**
  (`description.yaml`). Input is a 2D drawing + text — **not** a partial B-rep.
- **Editing:** "given an existing STEP file and a requested change, apply that change."
  Each editing sample ships an **input STEP** (`input.step`), a **mesh sidecar**
  (`input.mesh.npz`), render images, and a **text change instruction**
  (`edit_description.txt`).

**Sample count (verified):** 81 sample directories (ids `101`–`250`) in the public
input dataset, confirmed two ways: the dataset card states "81 fixtures … 49 generation
+ 32 editing," and the HF dataset API lists exactly **81 distinct sample folders**
(`HuggingAI4Engineering/cadgenbench-data` siblings). Split = ~60% generation / ~40%
editing. Data license: **ODC-BY** (`license:odc-by` tag on the dataset).

---

## Output format

A submission is **one candidate file per sample**, tool-agnostic. Verbatim accepted
names from the README:

- **B-rep / STEP:** `output.step`, `output.stp`
- **Triangle mesh:** `output.stl`, `output.obj`, `output.off`, `output.3mf`, `output.ply`

The benchmark is **tool-agnostic**: "It makes no assumption about how you build the
model (`build123d`, Autodesk Fusion, Onshape)." It does **not** require a feature tree
or a parametric script as the submission — only the resulting solid (preferably STEP/BREP;
meshes accepted but must already be watertight/manifold/orientable).

**Submission packaging:** zip (`submission.zip`) with one folder per sample plus a
root `meta.json`; upload via the Space's **Submit** tab. Rows publish "unvalidated";
promotion to a "validated tier" is a separate maintainer methodology review
(`docs/benchmark/validation.md`). A `sanity_check_submission.py` helper ships with the
public dataset to run the validity gate locally before upload. Source: README "How to
submit."

---

## Scoring rubric (CAD Score)

All formulas below are quoted **verbatim** from the Space's `metrics_page.py`
(<https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench/resolve/main/metrics_page.py>),
cross-checked against `docs/metrics.md`
(<https://raw.githubusercontent.com/huggingface/cadgenbench/main/docs/metrics.md>).

### Combined CAD Score

**Generation tasks** (verbatim):
```
cad_score = 0                                       if not valid
          = 0.4*shape + 0.4*interface + 0.2*topology   otherwise
```

**Editing tasks** (verbatim):
```
s_renorm  = max(0, (shape_similarity - b) / (1 - b))     where b = shape_similarity(input, GT)
cad_score = 0.6*s_renorm + 0.3*interface + 0.1*topology   (0 if not valid)
```
Editing renormalizes the shape axis against the **no-op baseline** `b` (the score of
just returning the unedited input). Per the page, an unedited echo "therefore caps at
0.3 + 0.1 = 0.4," so a real shape improvement is required to beat that.

### Validity gate (verbatim concepts from `metrics_page.py`)

Gate failure sets `is_valid = False` and forces `cad_score = 0`, "so an invalid solid
never beats a worse but valid one." A valid candidate must be:
- A **valid solid** — no self-intersecting wires, no edges off their surface, etc.
- **Meshable as a closed orientable manifold** — tessellates to a manifold, **closed
  (3F = 2E)**, orientation-consistent triangulation. A submitted **mesh** must directly
  satisfy the mesh gate: **manifold, closed, orientable**.

### Shape similarity (verbatim)

```
shape_similarity = 0.5 * (surface_distance_F1 + volume_IoU)
```
- **Surface Distance F1:** points sampled across both surfaces; a sampled point counts
  as matched if "the closest point on the other mesh's surface is **within 0.5% of the GT
  bounding-box diagonal**" (VERIFIED 2026-06-20 — the basis is the **bbox diagonal**, a
  size-proportional tolerance, not a fixed mm and not per-axis); precision + recall combine
  into F1. It also checks surfaces "face the same way" (normal-aware).
- **Volume IoU:** intersection-over-union of occupied volume.
- "Both use a tolerance **proportional to part size**," so small features can move
  without shifting the score.

### Topology match (verbatim)

Compares **Betti numbers (b0, b1, b2)** of candidate vs GT. "Each axis gets a **fuzzy
log-ratio** against GT," and "The three axis scores are **multiplied, not averaged**."
Worked example from the page: GT `(1,2,0)` vs candidate `(1,4,0)` → b0 and b2 match
(1.0 each), b1 mismatch scores `(3/5)² = 0.36`, topology product = `0.36`.
Blind features (blind pockets, fillets, chamfers) are "topologically trivial and
covered by the other" axes.

**Per-axis closed form (VERIFIED 2026-06-20, was previously marked UNVERIFIED).**
`metrics_page.py` states the exact per-axis function verbatim — it is **not** an
un-transcribed "log-ratio." Quoted:
```
s_i            = ((min(cand, gt) + 1) / (max(cand, gt) + 1)) ^ 2
topology_match = s_0 * s_1 * s_2
```
This reproduces the worked example exactly: b1 `2 vs 4` → `((2+1)/(4+1))² = (3/5)² = 0.36`.
So the canonical topology axis is a **squared (min+1)/(max+1) ratio**, multiplied across
the three Betti axes — confirmed against the cited Space source, not deferred.

### Interface match (verbatim)

Each mating feature = an authored **keep-in / keep-out sub-volume**; the candidate is
scored on how well its material matches that region "in shape, size, and position."
- **Per-feature fit:** volumetric IoU against the region.
- **Pass/fail ramp:** "IoU ≥ 0.95 → 1, ≤ 0.80 → 0, linear between; a sloppy fit scores 0."
- **Group = worst feature (minimum); fixture = mean over groups.** "Nailing one group
  while failing another" is penalized.

---

## Leaderboard / baselines

- **Leaderboard is live, server-side, and not a static file.** The Space
  (`HuggingAI4Engineering/CADGenBench`) renders the leaderboard at runtime from
  `leaderboard.py` / `app.py`, scoring submissions against the **private**
  `cadgenbench-data-gt`. The README is explicit: "the ground truth stays private so the
  leaderboard's server-side evaluation is the only path to a score." I probed for static
  results files (`results.json`, `state.json`, `leaderboard.json`, etc.) — **all HTTP 404**.
  So **no concrete leaderboard model scores are obtainable from the public repo.**
- **The "reference baseline" is a generator, not a fixed published number.** It is "an
  iterative agent that writes `build123d` Python, renders the resulting STEP, and reviews
  those renders to refine its code in a loop until valid." It supports `build123d` and
  CadQuery (STEP/BREP) and OpenSCAD (mesh), and any LiteLLM `provider/model` (the README
  examples include `anthropic/claude-opus-4-7`, `openai/gpt-5.5`,
  `gemini/gemini-3.1-pro-preview`). It only *generates* candidates; scoring happens on the
  Space after submission. There is **no fixed baseline CAD Score in the repo.**
- **"Top score ≈ 0.39" — UNVERIFIED.** A web-search summary asserted a current top score
  of ~0.39, but I could **not** confirm this against any primary source: the rendered HF
  Space leaderboard is JavaScript (returned an empty shell to a plain fetch) and the X/Twitter
  launch announcement (`x.com/MikushRab/status/2063999885796614522`, by Michael Rabinovich
  / Mecado) returned **HTTP 402** (paywalled). **Do not cite 0.39 as fact.** To get real
  numbers, open the Space in a browser or request them from Mecado.

---

## Forge alignment (`cadscore_harness.mjs`)

Forge's scorer is `forge-kernel/test/cadscore_harness.mjs` (the `ForgeCADScore`
module). It was written **against this exact benchmark** — its header docstring names it:

> `forge-kernel/test/cadscore_harness.mjs:5` — "Implements the CADGenBench 'CAD Score':"
> `:6` — `cad_score = gate * (0.4*shape + 0.4*interface + 0.2*topology)   [generation fixtures]`

### What aligns (strong)

| CADGenBench (verified) | Forge `cadscore_harness.mjs` (file:line) | Status |
|---|---|---|
| Generation `0.4·shape + 0.4·interface + 0.2·topology`, gated by validity | `cadscore_harness.mjs:1032` `const cad = 1 * (0.4 * sh.shape + 0.4 * itf.interface + 0.2 * tp.topology);` | **MATCH (exact weights)** |
| Validity gate zeroes the score | `:1014-1020` `if (!gate.valid) { return { cad_score: 0, ... } }`; gate in `checkValid()` `:433-440` (isClosed && isManifold && isOriented && !hasSelfIntersect && badFaces===0) | **MATCH (concept)** |
| `shape = 0.5·(surface_F1 + volume_IoU)` | Forge uses a 3-way mean: volume-IoU proxy + bbox extent-IoU + surface-F1 (`scoreShape` `:464-491`, `shape = (volScore + bboxScore + f1)/3`) | **PARTIAL** — Forge adds a bbox-IoU term and equal-weights three sub-scores; CADGenBench is a 2-way mean (no explicit bbox term). |
| Surface-F1 tolerance proportional to part size | `surfaceF1()` `:287-305` uses a **0.5 mm floor** scaled to ~2.5× sample spacing | **PARTIAL** — Forge's floor is **0.5 mm absolute**; CADGenBench's is **0.5% of the GT bbox** (relative). Different basis. |
| Interface = keep-in / keep-out sub-volumes | `scoreInterface()` `:532-558`, ray-parity point-in-solid keep-in/keep-out | **MATCH (concept)** — but Forge scores **point pass-rate** (min of in/out rates), NOT the **volumetric-IoU ramp (≥0.95→1, ≤0.80→0)** CADGenBench uses. |
| Interface group = worst feature, fixture = mean over groups | `:553` `Math.min(inRate, outRate)` per feature; `:557` `sum / features.length` mean | **MATCH (aggregation shape)** |
| Topology = Betti `(b0,b1,b2)`, axes **multiplied** | `scoreTopology()` `:699-706` `topology = c0 * c1 * c2`; Betti via `bettiNumbers()` `:358-419` | **MATCH (multiplicative)** |
| Topology per-axis falloff | `:701` `credit = 1/(1+|Δ|)` | **DIFFERS** — for b1 `2 vs 4`, Forge = `1/3 ≈ 0.333`; CADGenBench's verified canonical form is `((min+1)/(max+1))²` → `(3/5)² = 0.36`. Close but not identical; **TODO** to switch Forge to the squared (min+1)/(max+1) ratio to match exactly. |
| Editing `0.6·s_renorm + 0.3·interface + 0.1·topology`, `s_renorm = max(0,(shape−b)/(1−b))` | Editing path present: `shapeFromTess()` `:504-524` computes `b_shape` from input-vs-target; built-in editing fixtures `builtinEditingFixtures()` `:1214-1306`; (renorm + 0.6/0.3/0.1 reweight applied in the editing scorer further down the file, same module) | **MATCH (concept + baseline definition)** |
| STEP round-trip validity | `stepRoundTrip()` `:443-459` exports + re-imports + re-checks | **EXTRA** — Forge adds a STEP export/import round-trip beyond the gate; a useful superset. |

### What does NOT come from CADGenBench (Forge extras / diagnostics)

- **`dimension-L1` axis** (`scoreDimensionL1()` `:709-726`) — relative-L1 over named
  numeric dims vs emitted tool-call args. The harness docstring is honest that this is
  "reported as a separate diagnostic axis; **not folded into cad_score**"
  (`cadscore_harness.mjs:17`). CADGenBench's public CAD Score has **no** such axis.
- **`scoreMate()` multi-body fit jig** (`:596-695`) — shaft/bore running-vs-press fit via
  `assembly.detectInterference` + radial ring probe. This is a Forge-specific assembly-context
  extension, **not** in CADGenBench's published rubric (CADGenBench interface jigs are
  single-candidate keep-in/keep-out).

### Ladder probe relationship

`forge-kernel/test/ladder_probe.mjs` is a **separate** measurement harness — it scores the
live model against the **10-task cadskills ladder** (`ladder_probe.mjs:56-113`), NOT against
CADGenBench fixtures. Its rubric (validity 0.40 / bbox 0.30 / body-count 0.20 / b1 0.10,
`ladder_probe.mjs:266-326`) is Forge-internal and does **not** match CADGenBench weights.
It imports the shared kernel utilities from `cadscore_harness.mjs` (`ladder_probe.mjs:41-44`)
but is a different benchmark. Treat ladder_probe as "cadskills ladder" and cadscore_harness
as "CADGenBench CAD Score."

### Critical limitation

Forge's harness scores against **its own self-labeled corpus** (it replays corpus tool-calls
in a fresh kernel to snapshot ground truth — `selfLabel()` `:789-799`, fixtures pulled from
`/Users/account_clawteam1/archdisc-Models/data/forge` `:62`). It does **NOT** score against
the **real 81 CADGenBench fixtures**, because the CADGenBench ground truth is private. So the
CAD Scores Forge prints today are *self-consistent and discriminative* but are **NOT** the
official CADGenBench number and are **not comparable** to the leaderboard. **TODO:** to put
Forge on the real benchmark, generate `output.step` for the 81 public samples and submit to
the Space (the only path to a real score).

---

## What to request from Mecado (Dylan / Elie)

The benchmark inputs + scoring engine are public, so most of it is self-serve. The
genuinely non-public items, and the things worth asking for directly:

1. **Private ground-truth dataset access** — `HuggingAI4Engineering/cadgenbench-data-gt`
   (the `ground_truth.step` + authored jig sub-volumes + `AUTHORING.md`). Needed to
   self-score offline against the *real* fixtures instead of submitting blind. This is the
   single biggest unlock. (Repo is private; access is "leaderboard-only" per the README.)
2. **Exact per-axis metric closed-forms** — mostly RESOLVED from `metrics_page.py`
   (2026-06-20): topology per-axis is `((min+1)/(max+1))²` and the surface-F1 tolerance is
   **0.5% of the GT bbox diagonal**. The one remaining unknown is the **surface-F1 point-sample
   budget** (how many points are sampled per surface), which the public Space source does not
   state — confirm with Mecado.
3. **Current leaderboard numbers + their baseline scores** — the live scores are server-side
   only. Ask for: the current top CAD Score, the per-model baseline scores
   (build123d/CadQuery/OpenSCAD reference agent across the frontier LLMs), and whether the
   "~0.39 top" figure (UNVERIFIED, from search) is real and current.
4. **Submission / validation logistics** — how a validated-tier submission is reviewed
   (`docs/benchmark/validation.md` accepted-evidence types) and whether a non-build123d,
   non-OCCT-Python stack (Forge's native OCCT kernel emitting `output.step`) is eligible for
   the validated tier.
5. **Editing-task jig authoring** — for the 32 editing fixtures, the authored keep-in/keep-out
   sub-volumes and `b` (no-op) baselines per sample, so Forge's editing scorer can be
   calibrated to the real renorm baseline rather than Forge's synthetic one.

> Nothing above requires Mecado to send raw data we can't already see for the 81 *inputs* —
> items 1–5 are about **ground truth, exact rubric constants, and leaderboard state**, which
> are deliberately private.

---

## Honest gaps

- **No verified leaderboard numbers.** The "~0.39 top score" is **UNVERIFIED** (search
  summary only; HF Space leaderboard is JS-rendered, X launch post is HTTP-402 paywalled).
  Marked accordingly throughout. Real numbers require a browser or a Mecado ask.
- **Exact topology per-axis formula — RESOLVED (was: not transcribed).** `metrics_page.py`
  states it verbatim: `s_i = ((min(cand,gt)+1) / (max(cand,gt)+1))²`, multiplied across the
  three Betti axes. It is **not** a deferred "log-ratio." Forge currently uses `1/(1+|Δ|)`
  (TODO: switch Forge's per-axis credit to the squared (min+1)/(max+1) ratio to match exactly).
- **Surface-F1 tolerance basis — RESOLVED (was: not transcribed).** `metrics_page.py` states
  the tolerance is **0.5% of the GT bounding-box DIAGONAL** (not per-axis, not a fixed mm).
  The exact point-sample budget is still not stated in the public Space source. Forge uses a
  0.5 mm absolute floor + 8000 samples — a **different basis** (absolute mm vs relative diagonal).
- **Mecado landing page content** (`mecado.com/benchmark`) is JS-rendered and returned an empty
  shell to a plain fetch; its substantive content mirrors the GitHub/Space sources used here.
  Not a gap in facts, just a note on why that URL isn't quoted directly.
- **Forge is not yet on the real benchmark.** All Forge CAD Scores to date are against Forge's
  own self-labeled corpus, not the 81 CADGenBench fixtures (GT is private). Putting Forge on the
  leaderboard is a concrete unstarted TODO (generate 81 `output.step`, submit to the Space).
- **`docs/metrics.md` link targets** (`docs/metrics/`, `docs/benchmark/submission.md`,
  `docs/benchmark/validation.md`) exist per README/metrics references but were not all
  individually fetched; the per-axis deep-dive constants (items 2–3 in "What to request") are the
  unresolved specifics.

---

## Verification (adversarial)

Independent adversarial re-verification on **2026-06-20** (Forge Engineering Bible §9
anti-fabrication). Each external claim was re-fetched/re-searched against its cited primary
source; each repo claim was re-checked against the live file. Default posture: skepticism —
anything not confirmable from a real source is marked UNVERIFIED.

### External sources — re-fetched and confirmed HELD

| Claim | Source re-checked | Result |
|---|---|---|
| CADGenBench is a real Mecado × Hugging Face benchmark | `github.com/huggingface/cadgenbench`; search; `mecado.com/benchmark`; X launch post exists | **HELD** (repo + Space + dataset + X post all real) |
| Four scored axes (validity gate / shape / interface / topology) with the quoted descriptions | repo README (raw) | **HELD** — README table matches verbatim |
| Generation `0.4·shape + 0.4·interface + 0.2·topology`, gated by validity | `metrics_page.py` + `docs/metrics.md` | **HELD** — both quote it verbatim |
| Editing `0.6·s_renorm + 0.3·interface + 0.1·topology`, `s_renorm = max(0,(shape−b)/(1−b))`, no-op caps at 0.4 | `metrics_page.py` + `docs/metrics.md` | **HELD** |
| `shape_similarity = 0.5·(surface_F1 + volume_IoU)` | `metrics_page.py` | **HELD** verbatim |
| Interface IoU ramp `≥0.95→1, ≤0.80→0, linear between`; group=min, fixture=mean | `metrics_page.py` | **HELD** |
| Accepted output names (step/stp/stl/obj/off/3mf/ply); tool-agnostic; reference baseline is a build123d/CadQuery/OpenSCAD iterative agent; LiteLLM provider/model examples (Anthropic Claude / OpenAI GPT / Google Gemini) | README | **HELD** |
| **81 fixtures = 49 generation + 32 editing**; license **ODC-BY** | dataset card | **HELD** verbatim ("81 fixtures … Generation (49) … Editing (32)", "ODC-BY") |
| Private GT dataset is access-gated | `cadgenbench-data-gt` returned **HTTP 401** | **HELD** (gated) |
| Leaderboard is server-side; HF Space is a JS shell with no public scores | Space fetch returned only "Fetching metadata… Refreshing" | **HELD** (empty shell, no scores) |
| "~0.39 top score" | X post **HTTP 402** (paywalled); Space JS-only; a third-party aggregator instead surfaced ~0.4514 | **HELD as UNVERIFIED** — original file already refused to assert 0.39; correct. Treat any specific top-score number as unconfirmed. |
| CADBench arXiv 2605.10873; BenchCAD 2605.10865; Text2CAD-Bench 2605.18430 are distinct papers | all three arXiv pages fetched | **HELD** — all three exist with the stated titles/scope; `anniedoris/CADBench` repo also real (MIT) |

### Repo-side `file:line` claims — re-checked against live files

`forge-kernel/test/cadscore_harness.mjs` (1711 lines) and `ladder_probe.mjs` both exist.
Spot-checked line refs — **all confirmed exact**: header docstring `:5-6`; combine
`:1032` (`1 * (0.4*shape + 0.4*interface + 0.2*topology)`); gate `checkValid` `:433-440`;
`scoreShape` `:464-491` (3-way mean + 0.5 mm floor + 8000 samples); `scoreInterface`
`:532-558` (point pass-rate `min(inRate,outRate)`, mean over features — NOT the IoU ramp);
`scoreTopology` `:699-706` (`c0*c1*c2`, `credit = 1/(1+|Δ|)`); `scoreDimensionL1` `:709-726`
(diagnostic, not folded in); `stepRoundTrip` `:443-459`; `selfLabel` `:789-799`; corpus path
const `:62`; ladder rubric (validity .40/bbox .30/body .20/b1 .10). The PARTIAL/DIFFERS/EXTRA
labels in the "Forge alignment" tables are accurate.

### Corrected in this pass

1. **Topology per-axis closed form** — the file previously marked it UNVERIFIED / "fuzzy
   log-ratio … not transcribed." It IS stated verbatim in the cited `metrics_page.py`:
   `s_i = ((min+1)/(max+1))²`, products multiplied. Corrected the Scoring rubric, the Forge
   alignment table, the Honest gaps, and the Mecado-ask list to reflect the now-known form.
   (This was an *under-claim*, not an overclaim — the source had the answer.)
2. **Surface-F1 tolerance basis** — RESOLVED from `metrics_page.py`: **0.5% of the GT
   bounding-box DIAGONAL** (not per-axis, not absolute mm). Updated accordingly. Remaining
   unknown: the point-sample budget.
3. **CADBench "MIT-side authors"** — downgraded to UNVERIFIED. The arXiv page lists no
   institutional affiliations; "MIT-side" is not supportable from the cited source. (Author
   surname list and "Heyrani Nobari" spelling tightened to match the page.)

### Net assessment

The document is **substantively accurate and well-sourced**. Every quoted CADGenBench
formula, the 81/49/32 fixture split, the ODC-BY license, the private-GT gating, and the
empty-leaderboard / paywalled-X-post limitations all held against primary sources. The
file's standing UNVERIFIED markers (especially the refusal to assert a "0.39 top score")
are correct and were preserved. The only substantive edits were to *upgrade* two items the
file had been overly cautious about (topology formula, F1 tolerance basis — both
extractable from the already-cited source) and to *downgrade* one unsupported affiliation
detail ("MIT-side authors"). No fabricated numbers or invented dimensions were found.
