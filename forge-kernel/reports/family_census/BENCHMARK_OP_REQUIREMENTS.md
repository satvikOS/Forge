# What the benchmarks actually score, and which CAD op families a correct answer needs

**Measured 2026-08-31.** Repo pin `archdisc-Mech` @ `32ee748514af06447040e117760a8f2f7f01fb16`;
this branch is cut from `origin/claude/sacrosanct-execution-20260828` @ `161f1cf6`, which is
7 commits ahead. Checked before publishing rather than assumed: **`git diff 32ee7485..161f1cf6`
touches none of** `forge-kernel/include/forge/ft/FeatureTree.hpp`,
`forge-kernel/src/ft/FeatureTreeCompiler.cpp` or
`implementation/sacrosanct/archie_op_vocabulary.json` — every op-table and vocabulary claim
below holds at the branch tip unchanged. Data and harnesses read from
`archdisc-Models` (no remote; read-only here). Nothing in this file was fetched from the
network. Where a number came from an existing report rather than from a command run for
this census, the report is named.

This is the prioritisation key for the family census: every other census in this run is
ranked by what is below.

---

## 0. The bottom line, stated before the evidence

The owner's claim is that adding **all** CAD op families is how Archie takes first place,
because it could then execute any CAD model. Tested against what the eight target
benchmarks actually score:

**The claim is directionally right about the app and wrong about the benchmarks.**

1. **Vocabulary is not what is losing today, and the margin is not close.** On the
   BenchCAD holdout, `expert3d-v1` was asked for **93 interface features and produced 10,
   of which 0 matched** — interface F1 **0.000** on every one of the six scored families
   (`reports/composite_scores/expert3d_v1_benchcad41_cl64.json`). Every one of those six
   families is buildable with ops the model already emits by the thousand. The op existed.
   The feature did not.
2. **96.3 % of BenchCAD ground truth is already inside the 40-op kernel table**
   (1268 of 1317 harvested GT programs; measured this session over
   `data/forge/benchcad_ir_reharvest.jsonl`, mean voxel IoU 0.9992). The residual is
   **two op names — `ARC` and `HELIX` — covering 49 programs (3.7 %)**. Neither is Class A,
   SubD, wireframe or a BRep surfacing family. Both are *sketch/path* ops.
3. **The one BenchCAD family that genuinely needs free-form surfaces is unscoreable.**
   `bevel_gear` carries 3888 B-spline faces across 15 references — and all 3 of its holdout
   parts are **refused by the instrument** (300 s verifier timeout,
   `reports/composite_anchor/benchcad41_envelope_centred-longest_g64.json`). A perfect
   surfacing stack moves the BenchCAD holdout by exactly **0.000**.
4. **What *is* a hard vocabulary wall is user-invocability, and it is already assigned.**
   **0.0 %** of GT programs are expressible in the 18 user-invocable ops; add the 12
   primitives already assigned to another agent (CYL/BOX/ROTATE/POLY/…) and it jumps to
   **94.5 %**. That single already-scheduled change is worth 92.6 points of GT coverage.
   Everything my censuses cover is worth the remaining **1.8 %** plus `ARC`/`HELIX`.
5. **Where "all op families" *is* the right frame:** ParaCAD, Text2CAD-Bench, HistCAD and
   Drawing2CAD's *official* metric are all unreachable — not for want of solid ops, but
   because the IR has **no SKETCH value kind, no constraint layer, and no 2D terminator**;
   and MUSE needs an **ASSEMBLY** kind. Those are *value-kind* gaps, which is a stronger
   version of the owner's point than the surfacing one: a family whose values cannot be
   named in the IR cannot exist at all. But they are sketch/assembly kinds, not surface kinds.

**The binding constraint is fidelity, with a bounded and specific vocabulary tail.**
The honest ranking of BenchCAD-holdout headroom: **~85 % fidelity, ~15 % missing kernel op**
(§5.4). The two are not substitutes — a new op family only becomes worth points once the
emissions that use it land within the metric's tolerance, and today they do not land at all.

---

## 1. Readability census — is "only two of eight" still true?

The 2026-08-01 finding (`archdisc-Models/reports/BENCHMARK_READINESS.md`) was that two of
seven post-CADGenBench benchmarks were readable. **Re-verified today: still substantially
true, with a correction.** Three benchmarks (BenchCAD, neuralCAD-Edit, Drawing2CAD) now have
local reference geometry *and* a working composite scorer; the other five do not produce an
interpretable number. Task files, GT STEPs and `gt: {}` emptiness were each re-checked by
reading the files this session.

| Benchmark | Data on this machine? | Input | Output the benchmark wants | Metric | Readable? |
|---|---|---|---|---|---|
| **CADGenBench** | **Inputs only** — **81** sample dirs under `data/cadgenbench-data/` (49 generation + **32 editing**, verified: 32 carry `input.step`). **No GT**, and a standing `NO_GROUND_TRUTH_HERE.md` in that directory. | drawing PNG + text (`input_type: text+image`), or input STEP + edit text | one solid: `output.step` / watertight mesh | `0.4·shape + 0.4·interface + 0.2·topology`, gated by validity (§2) | **NO — by law.** GT is server-side; `composite_score.py` hard-refuses any path under `cadgenbench*` (LAW 8) |
| **BenchCAD** | **YES** — 41 holdout tasks, 1393 HF tasks, **1104 + 1500 GT STEPs**, 1317 harvested GT IR programs | 2×2 composite of four **shaded 3D renders** | watertight solid | composite-form 0.4/0.4/0.2, `centred-longest`, grid 64 | **YES**, n=34 of 41 scoreable |
| **neuralCAD-Edit** | **YES** — 56 tasks, input STEP + GT STEP + face census in-prompt | input B-Rep + multimodal edit request | edited STEP | paper: validity, Chamfer, voxel IoU, DINOv2 sim, human acceptance. Local substitute: same composite | **YES**, n=47 scoreable; two floors that must never be crossed (composite 0.5554 null-edit vs gate 0/56) |
| **Drawing2CAD** | **YES** for geometry — 283 tasks, **292 GT STEPs**, plus `data/cad_vgdrawing/` (svg_raw/svg_vec/cad_vec, 95 shards) | 4 SVG views (front/top/right/iso) | **DeepCAD command sequence** (`.h5`) | official `ACC_cmd` / `ACC_param` (η=3/256), Invalid Ratio, Chamfer | **PARTLY.** Composite substitute runs (100 of 283 rows floored). The **official metric is unreachable from the Unified IR** — see §4.2 |
| **ParaCAD** | Tasks yes, **`gt: {}` on 400 of 400** (verified), 0 referenced drawings on disk | sketch image | **2D primitive listing + constraint tuples** (`<Line>`,`<Arc>`,`<Circle>` + `(type,src,tgt,ptType1,ptType2)`) + dimensions | primitive/constraint F1 (`pf1`/`cf1`/`acc`) | **NO.** Refused by `score_benchmarks.py`. The row's own `meta.contract_mismatch` says the two turns "cannot both be satisfied" |
| **Text2CAD-Bench** | Tasks yes, **`gt: {}` on 846 of 846** (verified). What is on disk is the **train** split, not the 600-item curated test set | NL prompt (geometric + procedural styles), L1–L4 | DeepCAD command sequence | `ACC_cmd`, `ACC_param`, per-primitive F1, IR, Chamfer | **NO.** Scoring it and calling it Text2CAD-Bench would be a false claim |
| **HistCAD** | **NO TASK FILE.** `data/forge/bench_tasks_histcad.jsonl` does not exist; HistCAD absent from `KNOWN_SETS` | base parametric history + text + a parameter EDIT | **edited constrained history** (sketch primitives + constraints + feature ops + 3D point refs) | ER, cPCSR, OES (constraint-aware editability) | **NO — nothing to run** |
| **MUSE** | **YES** — `data/muse/` (**106** case dirs, `metadata.jsonl`), 37 single + 106 all tasks, `gt` = **bbox + ±10 %** only | text Design Specification | editable B-Rep **assembly** (STEP) | 3-stage funnel: code executes → 4 OCCT checks → **VLM rubric** (functionality/manufacturability/assemblability) | **RUNS BUT VACUOUS.** Local gate floor is **100 %** — a featureless box of the stated envelope passes 37/37 and 106/106 |

**Correction to the prior audit worth recording:** Drawing2CAD's *geometry* is on disk and
its 292 GT STEPs are fully parseable (§3.3), so its op requirement is measurable even though
its official metric is not. "Not readable" was true of the metric, not of the data.

---

## 2. The composite metric, established precisely

There are **two** 0.4/0.4/0.2 composites in this programme and they are not the same
measurement. Both were read in full for this census.

### 2.1 The canonical CADGenBench score

Source: `archdisc-Mech/CADGENBENCH_SPEC.md`, which quotes the benchmark's own
`metrics_page.py` and `docs/metrics.md` verbatim with URLs.

```
generation:  cad_score = 0                                        if not valid
                       = 0.4*shape + 0.4*interface + 0.2*topology  otherwise
editing:     s_renorm  = max(0, (shape - b)/(1 - b))   b = shape(input, GT)
             cad_score = 0.6*s_renorm + 0.3*interface + 0.1*topology
```

- **validity** — a hard gate. Valid solid, tessellates to a closed (`3F = 2E`),
  orientable manifold. Fail and the whole score is 0.
- **shape** = `0.5·(surface_distance_F1 + volume_IoU)`; a sampled point matches if the
  closest point on the other surface is within **0.5 % of the GT bbox diagonal**.
- **interface** = per authored **keep-in / keep-out sub-volume**, volumetric IoU, then a
  **hard ramp: `IoU ≥ 0.95 → 1`, `IoU ≤ 0.80 → 0`, linear between.**
  **Group score = the WORST feature (min); fixture = mean over groups.**
- **topology** = Betti `(b0,b1,b2)`, per axis `s_i = ((min+1)/(max+1))²`, and the three axes
  are **multiplied, not averaged**.

★ **The interface ramp is the single most important fact in this file.** It is not a soft
similarity. A mating feature reproduced to 79 % volumetric IoU of its authored region scores
**zero**, and one sloppy feature zeroes its whole group. Having the op that can cut a bore
buys nothing until the bore is placed and sized inside a ~5 %-of-volume band. That is a
fidelity threshold that no amount of vocabulary crosses.

★ Likewise topology: multiplicative Betti credit means one wrong through-hole count scales
the *entire* 0.2 term. A GT `b1=4` answered with `b1=1` scores `(2/5)² = 0.16`, and the
measured genus deficit on the text holdout is **p50 −3**
(`reports/HOLDOUT_FAILURE_DECOMPOSITION.md` §5).

### 2.2 The local composite-form score

`archdisc-Models/scripts/composite_score.py` (1225 lines, read in full). Same *form*,
different components, computed on benchmarks whose GT is local:

- `W_SHAPE, W_INTERFACE, W_TOPOLOGY = 0.4, 0.4, 0.2` (line ~245).
- **shape** = voxel IoU from the pinned verifier under `centred-longest` (BenchCAD's own
  convention). **Scale-invariant by construction** — a uniform 1.10× scale scores 1.000.
- **interface** = **F1** from `scripts/interface_metrics.py` (§3), not recall.
- **topology** = `0.5·genus_score + 0.5·shell_score`, each `1 − |Δ|/max(1,ref)`.
- **Vacuity**: when the reference has no interface features and the candidate emits none,
  interface scores **1.000** flagged `interface_vacuous`.
- Every record stamps `NOT_a_cadgenbench_score: true`. A composite computed here is never a
  CADGenBench number and must never be quoted as 0.507-comparable.

**The vacuity term is arithmetically the box's whole interface score.** On the 41-part
holdout the bbox floor scores interface **0.2647** with `expected=106, found=0, matched=0`
— and 9 of 34 records are vacuous. `9/34 = 0.26471`. Exact. The box recovers **zero** real
mating features and still banks `0.4 × 0.2647 = 0.106` of composite.

---

## 3. What "interface" measures — verified by reading the extractor

`scripts/interface_metrics.py`, `FAMILIES = ["bore", "counterbore", "bolt_circle",
"bolt_pattern", "mating_face", "shaft_land"]` (line 946).

### 3.1 The two-face-kind proof

`extract_interface()` reads a kernel face census. **It tests exactly three `kind`
predicates in the whole 1141-line file** — verified by exhaustive grep:

| line | test |
|---|---|
| 465 | `if f.get("kind") != "cylinder": continue` — bores, counterbores, shaft lands |
| 587 | `if f.get("kind") != "plane": continue` — the counterbore seat |
| 704 | `if f.get("kind") != "plane": continue` — mating faces |

There is **no** branch for `torus`, `bspline`, `cone`, `sphere`, `surf_revolution` or any
other kind. Additionally `_find_mating_faces()` opens with `if not bores: return []` — a
part with no cylindrical void has no mating faces either.

★ **Therefore 40 % of the composite is computed entirely from planar and cylindrical faces.**
A B-spline, torus, cone or sphere face cannot contribute a single interface point. It can
only *subtract*, by enlarging `total_area` (the mating-face 2 % threshold denominator) or by
perturbing the bbox that sets the tolerance band.

★ **Corollary that runs against the owner's claim directly:** on an organic/free-form part —
exactly the part that needs Class A or SubD — the reference has no cylinders, interface is
**vacuous**, and the candidate banks interface **1.000 for emitting nothing**. Adding
surfacing families to such a part can only *lose* interface points, by inventing a spurious
`shaft_land` where the reference had none (precision 0 ⇒ F1 0.0).

### 3.2 How much interface each benchmark actually contains

`reports/interface/survey_*.json`, all four self-scoring at recall 1.000 (instrument sound):

| set | rows | with interface | features | bore | counterbore | bolt_circle | bolt_pattern | mating_face | shaft_land |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BenchCAD-holdout-41 | 41 | 31 (76 %) | 119 | 45 | 6 | 3 | 3 | 31 | 31 |
| BenchCAD-HF | 1393 | 1118 (80 %) | 6223 | 2575 | 118 | 83 | 181 | 1422 | 1844 |
| neuralCAD-Edit-56 | 56 | 49 (88 %) | 797 | 108 | 43 | 2 | 14 | 42 | 588 |
| Drawing2CAD-283 | 283 | 129 (46 %) | 415 | 105 | **0** | **0** | 5 | 120 | 185 |
| **total** | 1773 | 1327 | **7554** | 2833 | 167 | 88 | 203 | 1615 | 2648 |

Aggregated by what produces the feature:

- **cylindrical VOIDS** (bore + counterbore + bolt_circle + bolt_pattern) — **3291 / 7554 = 43.6 %**
- **external CYLINDERS** (shaft_land) — **2648 / 7554 = 35.1 %**
- **PLANAR FACES normal to a bore** (mating_face) — **1615 / 7554 = 21.4 %**

**100.0 % of the interface term, across every benchmark whose GT is on this machine, is a
plane or a cylinder.**

### 3.3 The reference face census — measured this session

Parsed `ADVANCED_FACE → surface entity` from every GT STEP on disk (script:
`stepcensus.py`, run over 2896 files, 0 unparsed). Reported as a STEP surface-entity census,
which is a proxy for the kernel's face census, not identical to it.

| set | files | plane | cylinder | bspline | cone | torus | sphere | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BenchCAD holdout GT | 1104 | **70.7 %** | **16.5 %** | 9.9 % | 2.0 % | 0.5 % | 0.06 % | 0.3 % |
| BenchCAD-HF GT | 1500 | **80.2 %** | **9.0 %** | 9.3 % | 1.1 % | 0.3 % | 0.04 % | 0.2 % |
| **Drawing2CAD GT** | 292 | **84.9 %** | **15.2 %** | **0** | **0** | **0** | **0** | **0** |
| neuralCAD-Edit inputs¹ | 56 | 66.9 % | 23.9 % | 2.0 % | 0.6 % | 4.8 % | 1.8 % | — |

¹ kernel face census read out of the task prompts' own `kind_histogram`, not from STEP.

**Drawing2CAD: 292 of 292 references are 100 % plane + cylinder.** Zero curved surfaces of
any kind. And in BenchCAD, B-spline faces are 9–10 % of faces but sit in only **5.2–5.7 % of
parts** — 11 of 106 families, of which four (`bevel_gear`, `helical_gear`, `twisted_bracket`,
`worm_screw`) hold **97.4 %** of them. Those are gear flanks and helical threads, not styling
surfaces. Torus faces are fillets and bent tube (`pipe_elbow`, `eyebolt`, `j_hook`, `u_bolt`),
and the harvested GT builds `pipe_elbow` at IoU **0.9992** with `CIRCLE/EXTRUDE/REVOLVE/
TRANSLATE/ROTATE/FUSE/CUT` — **no torus primitive and no sweep**.

---

## 4. The matrix — op family × benchmark

### 4.1 Method

Rows are op families as the kernel names them (`forge-kernel/include/forge/ft/FeatureTree.hpp`
`enum class OpCode`, 40 entries, verified by reading the enum and the `opFromName` table at
`src/ft/FeatureTreeCompiler.cpp:117-152`). Cells cite one of:

- **GT-IR** — measured over 1317 harvested BenchCAD GT programs (mean voxel IoU 0.9992).
- **FACE** — measured over the GT STEP surface census (§3.3).
- **METRIC** — read out of the scorer or the benchmark's own published metric.

"Score depends on it" is stated as a *share*, never as a guess.

### 4.2 The matrix

Legend — **R** required for a correct answer · **P** partial / some parts · **·** not required ·
**✗** the benchmark's answer is not a solid at all, so no solid op family applies.

| op family (kernel) | user-invocable? | BenchCAD | neuralCAD-Edit | Drawing2CAD | MUSE | CADGenBench | ParaCAD | Text2CAD-B | HistCAD | evidence & score share |
|---|---|---|---|---|---|---|---|---|---|---|
| `EXTRUDE` + a closed profile | ✔ | **R** | **R** | **R** | R (st.2) | R | ✗ | R (as `Ext`) | R | GT-IR: `EXTRUDE` in 65.2 % of programs. Drawing2CAD's official command set is `{Line, Arc, Circle, SOL, Ext, EOS}` — **`Ext` is the only 3D op it has** |
| `CUT` / `FUSE` / `COMMON` | ✔ | **R** | **R** | **R** | R | R | ✗ | P | R | GT-IR: `CUT` 79.6 % of parts, `FUSE` 49.5 %. Produces **43.6 %** of all interface features (every bore) |
| `CYL` / `BOX` / `SPHERE` / `CONE` / `TORUS` / `PRISM` / `TUBE` | **✗ forbidden** | **R** | **R** | **R** | R | R | ✗ | · | · | GT-IR: `CYL` 64.0 % of parts, `BOX` 48.7 %. **Already assigned to another agent** — see §5.2 for what it is worth |
| `TRANSLATE` / `ROTATE` | TRANSLATE ✔ / **ROTATE ✗** | **R** | **R** | **R** | R | R | ✗ | · | R | GT-IR: `TRANSLATE` 90.8 % of parts, `ROTATE` 67.7 %. **Placement is the whole interface term** — a bore in the wrong place scores 0 under the 0.95/0.80 ramp |
| `HOLE` / `CBORE` | ✔ | **R** | **R** | **R** | · | R | ✗ | · | P | METRIC: bore+counterbore = **39.7 %** of all interface features on this machine. Note GT never uses them — it writes `CUT(%body, CYL)` (GT-IR: `HOLE` 0 uses, `CBORE` 0 uses) |
| `PATTERN` | ✔ | **R** | P | P | · | R | ✗ | · | P | GT-IR: 35.1 % of parts. Produces `bolt_circle` + `bolt_pattern` = **3.9 %** of interface features |
| `CIRCLE` / `RECT` / `POLY` | CIRCLE,RECT ✔ / **POLY ✗** | **R** | **R** | **R** | R | R | ✗ | R | R | GT-IR: `CIRCLE` 30.8 %, `RECT` 27.1 %, `POLY` 20.1 % of parts |
| `FILLET` / `CHAMFER` / `BLEND` | ✔ | **P** | **P** | **·** | P | P | ✗ | · | P | GT-IR: `CHAMFER` 35.2 %, `FILLET` 14.2 % of parts. FACE: torus 0.3–0.5 % of BenchCAD faces, **0 in Drawing2CAD**. Contributes **no** interface feature (§3.1) |
| `REVOLVE` | ✔ | **P** | P | · | P | P | ✗ | · | P | GT-IR: 2.1 % of parts — but it is how the harvest builds every `pipe_elbow` torus at IoU 0.999 |
| `LOFT` + `RING`/`WIRE` sections | LOFT,RING ✔ / **WIRE ✗** | **P** | P | · | P | P | ✗ | · | · | GT-IR: `LOFT` 3.1 %, `RING` 1.4 %, `WIRE` 1.7 % of parts |
| `SWEEP` (path) | **✗ forbidden** | **P** | · | · | P | P | ✗ | · | · | GT-IR: **1 use in 1317 programs (0.08 %)**. Needed for `bolt` threads with `HELIX` |
| `SHELL` | ✔ | P | P | · | P | P | ✗ | · | P | GT-IR: 0 uses in the harvest; used in hand corpora |
| `MIRROR` | ✔ | P | P | · | P | P | ✗ | · | P | GT-IR: 0 uses in the harvest |
| `FOLD` (sheet metal) | **✗ forbidden** | P | · | · | P | P | ✗ | · | · | FACE: `sheet_metal_tray`, `mounting_angle` — both **zero-GT-IR** families |
| `TAG`/`INPUT`/`PUSHFACE`/`RESIZEBORE`/`DEFEATURE`/`VERIFY` | **✗ all forbidden** | · | **R** | · | · | **R** (editing) | ✗ | · | **R** | `INPUT` is how an edit task binds its input solid — **22.0 %** of all corpus IR rows use it. CADGenBench is 32 of 81 editing fixtures |
| **`ARC` — 2D profile arcs** | **NOT IN THE KERNEL** | **R** | P | **R** | P | R | **R** | **R** | **R** | GT-IR: **48 programs (3.6 %)**, 8 families. `grep -c ARC FeatureTreeCompiler.cpp` = **0** at this SHA. It is `Arc(1)` in DeepCAD, one of the **three** sketch primitives Drawing2CAD and Text2CAD-Bench score |
| **`HELIX`** | **NOT IN THE KERNEL** | P | · | · | P | P | · | · | · | GT-IR: **1 program.** Blocks `bolt` threads, `coil_spring`, `worm_screw`, `twisted_drill` |
| **SURFACE value kind / Class A / SubD / BRep surfacing** | **DOES NOT EXIST** | **·** | **·** | **·** | · | · | · | P (L3) | · | FACE: bspline in **5.2 %** of BenchCAD parts, 97.4 % of them in 4 gear/helix families; **0 %** of Drawing2CAD. METRIC: contributes **0** to the 40 % interface term (§3.1). `bevel_gear` is **unscoreable** |
| **SKETCH value kind + constraint solver** | **DOES NOT EXIST** | · | · | **R (official)** | · | · | **R** | **R** | **R** | ParaCAD's answer is `<Line>/<Arc>/<Circle>` + `(constraint, src, tgt, ptType1, ptType2)`. HistCAD's representation is "sketch primitives + **constraints** + feature ops". Drawing2CAD/Text2CAD score `ACC_cmd` over a DeepCAD command sequence |
| **ASSEMBLY value kind / mate / instance** | **DOES NOT EXIST** | · | · | · | **R** | P | · | · | · | `score_benchmarks.py` refuses MUSE-all: "**69 of its 106 rows are multi-component cases the IR cannot state at all** (RESULT takes one SOLID)" |

### 4.3 Reading the columns

- **BenchCAD** is the only column where the surfacing question is even askable, and there the
  answer is 5.2 % of parts, concentrated in a family the instrument refuses to score.
- **Drawing2CAD** is the cleanest refutation: **zero curved GT faces in 292 references**, and
  an official metric whose entire command alphabet is `Line, Arc, Circle, SOL, Ext, EOS`.
  Its correct answer needs **one** 3D op family and **three** sketch primitives.
- **ParaCAD / Text2CAD-Bench / HistCAD** never ask for a solid. No solid op family, of any
  kind, moves them. What moves them is a sketch representation with constraints.
- **MUSE**'s scored stages are `code executes` → `4 OCCT validity checks` → `VLM rubric`.
  Stages 1 and 2 contain **no** op-family content at all; a box passes both.
- **CADGenBench** cannot be scored here and must not be. Its op requirement is inferred from
  its published metric only.

---

## 5. The owner's claim, tested

### 5.1 What the model actually emits — vocabulary is not the wall

Measured this session over four emission traces (`reports/archie_loop_*.jsonl`), classifying
every statement against the 40-op table:

| arm | rows | built | gate | op uses | **op names outside the 40-op table** |
|---|---:|---:|---:|---:|---|
| `expert3d-v1` e600 | 600 | 10.7 % | 0 | 34 861 | `PUSHDOWN` 7, `PUSH` 5, `CYLINDER` 4, `HLOB` 1 — **17 = 0.049 %** |
| `expert3d-v4a` RELOAD holdout | 36 | 63.9 % | 13.9 % | 7 584 | **none** |
| `expert3d-v5cap` holdout | 36 | 30.6 % | 5.6 % | 2 239 | `PLY` 99 (a typo for `POLY`) |
| `expert3d-v5cap` e600 | 416 | 26.2 % | 0 | 16 105 | `PLY` 869 |

And across the **entire training corpus** — 393 151 IR rows, 4 277 775 statements
(`reports/archie_vocab_audit_pinned.log`, 2026-08-30):

```
out_of_vocabulary_op            5 049      (0.118 % of statements)
forbidden_op                1 495 488      (the UI gate, not the kernel)
arg_count_not_emittable        95 484      (arity, not family)
```

★ **In four emission runs and 4.28 M corpus statements, the model has never once asked for a
CAD op family that does not exist.** Not one `LOFT`-heavy free-form emission, not one surface
op, not one SubD request. It emits `HOLE`, `EXTRUDE`, `FUSE`, `CUT`, `TRANSLATE`, `PATTERN`,
`CIRCLE`, `POLY` — the same eight ops the ground truth uses. The 0.118 % that is genuinely
out-of-vocabulary is typos and near-misses (`PLY`, `CYLINDER`, `PUSH`).

### 5.2 What the failures actually are

Gate complaints, classified from the same traces:

| complaint class | v1 e600 | v5cap e600 | v4a holdout |
|---|---:|---:|---:|
| bbox / envelope wrong | 379 | 298 | 18 |
| volume outside ±5 % | 267 | 276 | 12 |
| genus wrong | 267 | 268 | 12 |
| bore position missing | 187 | 208 | 9 |
| grammar / build error | 222 | 99 | 5 |
| **"your own assertion is false"** | 120+ | 61+ | — |
| degenerate repetition loop | — | — | 3 |
| **"this op family does not exist"** | **0** | **0** | **0** |

And the named terms in `reports/HOLDOUT_FAILURE_DECOMPOSITION.md`, all of them fidelity:
10 of 32 emissions are repetition loops; `CYL` takes a **radius** while `BOX` takes extents
and the census hands the model **diameters** (worst-axis envelope error p50 **49.1 %**, errors
piling on exactly 2.00× and 0.50×); **17 of 32** build the part in the wrong frame; **10 of 32**
build a round section for an elongated part; the model is denser than GT on 23 of 26 and
**0 of 26** emissions is a sparse part where GT has 7 of 26; and the model unrolls 92 `HOLE`
statements against a 9-op GT that used `PATTERN`.

The decomposer's own refusal histogram (`reports/DECOMP_YIELD_BLOCKER.md`, 695 parts) says the
same: of 217 gate-fails, **140 fail their own `VERIFY genus`**, 24 their own `VERIFY holes`,
32 are boolean watchdog timeouts, and **only 9 ever reached a real measured mismatch**.

### 5.3 The decisive measurement

`reports/composite_scores/expert3d_v1_benchcad41_cl64.json`, n=36:

| family | expected | **found** | matched | recall |
|---|---:|---:|---:|---:|
| bore | 36 | 5 | **0** | 0.000 |
| mating_face | 25 | 4 | **0** | 0.000 |
| shaft_land | 23 | 0 | **0** | 0.000 |
| counterbore | 4 | 0 | **0** | 0.000 |
| bolt_pattern | 3 | 0 | **0** | 0.000 |
| bolt_circle | 2 | 1 | **0** | 0.000 |
| **total** | **93** | **10** | **0** | **0.000** |

Instrument ceiling on the same set: 44/44, 27/27, 24/24, 5/5, 3/3, 3/3 — all 1.000. The
measurement is sound. The model's 0.2222 interface is `8/36` vacuous parts, nothing else.

On the text holdout (`ho_v4a_RELOAD_full36`, the strongest arm, expert LoRA loaded):
**311 bores expected, 48 found, 27 matched.** The model emits 15 % of the bores the target
needs and gets 56 % of those right. It emitted **zero** counterbores across 32 parts, using an
op (`CBORE`) that is both in the kernel and user-invocable.

★ **This is the whole argument.** Interface is 40 % of the score. It is produced entirely by
planes and cylinders. The model has every op it needs, emits `HOLE` 16 173 times in one run —
and recovers **0 of 93** mating features on BenchCAD. Vocabulary is not the constraint on that
number; nothing about a new op family changes it.

### 5.4 The bounded vocabulary tail, quantified honestly

Coverage of 1317 harvested BenchCAD GT programs (`VERIFY`/`RESULT` excluded as non-geometry):

| op set available | programs fully expressible | blocked by |
|---|---:|---|
| **18 user-invocable ops** | **25 (1.9 %)** | `ROTATE` 891, `CYL` 843, `BOX` 642, `POLY` 265, `ARC` 48, `SPHERE` 44, `WIRE` 23, `CONE` 17 |
| **18 + the 12 primitives already assigned** | **1245 (94.5 %)** | `ARC` 48, `WIRE` 23, `HELIX` 1, `SWEEP` 1 |
| **the full 40-op kernel table** | **1268 (96.3 %)** | `ARC` 48, `HELIX` 1 |

So the residual op-family work *not already assigned to another agent* is worth **1.8
percentage points of GT coverage** (94.5 → 96.3), and it is exactly two names: `ARC` and
`HELIX`. Verified absent: `grep -c ARC forge-kernel/src/ft/FeatureTreeCompiler.cpp` returns
**0**, and `archie_op_vocabulary.json` records `build_configuration: {declared: false, note:
"no op is gated by FORGE_FT_ARCHELIX at this revision"}`.

**Upper bound on the BenchCAD-holdout score, if every missing kernel op landed perfectly.**
Total headroom from `expert3d-v1` **0.3103** to the instrument ceiling **0.994** is **0.684**
composite. On the 34 scoreable parts the ARC/HELIX-blocked families are
`bearing_retainer_cap` (3) and `bolt` (2) = **5 of 34 = 14.7 %**; the other 29 are already
inside the vocabulary. Allocating the headroom by part count — the only split the data
supports, and it flatters the vocabulary case because those 5 are among the harder parts:

| where the headroom is | parts | share | composite |
|---|---:|---:|---:|
| behind a **missing kernel op** (`ARC`, `HELIX`) | 5 | 14.7 % | **+0.101** |
| behind **fidelity on ops that already exist** | 29 | 85.3 % | **+0.583** |

**~85 % of available headroom sits behind fidelity on parts the vocabulary already covers**,
and that is an upper bound on the vocabulary side, not a central estimate: it credits the
missing ops with taking those 5 parts all the way to the instrument ceiling in one step.

And of the three `bevel_gear` parts — the only holdout family that genuinely needs free-form
surfaces — **all three are refused by the instrument** (300 s verifier timeout). Their
contribution to any achievable BenchCAD score is **0.000**, today and after any surfacing work.

### 5.5 Where the owner's claim is right, and it is the stronger version

The claim survives, reframed, on the four benchmarks nobody can currently score at all:

- **ParaCAD, Text2CAD-Bench, HistCAD** and **Drawing2CAD's official metric** all want a
  **sketch representation** — `Line`, `Arc`, `Circle`, with constraints — as the *answer*,
  not as an intermediate. The IR produces `PROFILE`, `SOLID`, `WIRE` and nothing else
  (`archie_op_vocabulary.json → value_kind_closure.produced_by_allowed_ops`, verified). There
  is no SKETCH kind, no constraint, and no legal 2D terminator. ParaCAD's own task rows carry
  `meta.contract_mismatch` saying the two halves "cannot both be satisfied".
- **MUSE** wants an **assembly**. `RESULT` takes one `SOLID`; 69 of 106 rows cannot be stated.
- **CADGenBench is 32 of 81 editing fixtures**, and all six edit ops (`INPUT`, `TAG`,
  `PUSHFACE`, `RESIZEBORE`, `DEFEATURE`, `VERIFY`) are **user-forbidden**. `INPUT` alone
  appears in 22.0 % of all corpus IR rows.

This is the *value-kind* argument, and it is a better argument than the surfacing one, because
a family whose values cannot be named in the IR cannot exist at any fidelity. But it points at
**sketch, constraint and assembly**, not at Class A/B/C/D or SubD.

### 5.6 The answer

> **Is "all op families" the path to first place?**

**No — not as the first move, and not in the direction the surfacing families point.** Three
things must happen in this order, and the evidence says the ordering is not a preference:

1. **Fidelity on the vocabulary that already exists.** 0 of 93 interface features recovered;
   85 % of BenchCAD headroom; the radius/diameter convention, the frame, the sparsity habit
   and the degeneration loops. None of these is an op family. Until an emitted bore lands
   inside the 0.80–0.95 IoU ramp, a new family adds an op the model will place wrongly.
2. **User-invocability of the 12 primitives + the 6 edit ops.** 1.9 % → 94.5 % GT coverage.
   Already assigned; it is the largest single vocabulary move available and it is not a new
   family, it is a UI registry gap.
3. **Then the genuinely missing families, in measured order:** `ARC` (48 GT programs, and the
   `Arc` of the DeepCAD alphabet that Drawing2CAD and Text2CAD-Bench score directly) → a
   **SKETCH value kind with constraints** (unlocks ParaCAD, HistCAD, Drawing2CAD-official,
   Text2CAD-Bench — four otherwise-unscoreable benchmarks) → an **ASSEMBLY value kind**
   (unlocks 69 of 106 MUSE rows) → `HELIX`/`SWEEP` → last, free-form surfaces.

**Class A/B/C/D surfacing and SubD rank last of everything on this list.** Not because they
are unimportant to a CAD application — for the *product* the owner is right that the op
families are the capability surface — but because on the eight named benchmarks they are worth,
measurably: 0 % of Drawing2CAD's GT faces, 0 of the 7554 interface features, 0.000 on the only
BenchCAD family that needs them, and they cannot move the 40 % interface term by construction.

---

## 6. Verified vs not verified

**Verified by reading an implementation or running a measurement this session:**

- The 40-op `OpCode` enum and the `opFromName` table; `ARC`/`HELIX` absent (`grep -c` = 0).
- 18 user-invocable / 22 forbidden, and `value_kind_closure = [PROFILE, SOLID, WIRE]`.
- `interface_metrics.py` reads exactly `kind == "cylinder"` (l.465) and `kind == "plane"`
  (l.587, l.704) and no other kind; `FAMILIES` is the six listed; F1 not recall enters the
  composite; `_find_mating_faces` returns `[]` when there are no bores.
- `W_SHAPE, W_INTERFACE, W_TOPOLOGY = 0.4, 0.4, 0.2` and the LAW-8 refusal list.
- Op histogram, GT-IR coverage and the ARC/HELIX residual over 1317 harvested programs.
- STEP surface census over 2896 GT files (1104 + 1500 + 292), 0 unparsed.
- neuralCAD-Edit input face-kind histogram over 56 task prompts.
- `gt: {}` on 400/400 ParaCAD and 846/846 Text2CAD-Bench rows; MUSE `gt` = bbox + tolerance
  only; `bench_tasks_histcad.jsonl` absent; CADGenBench dirs carry inputs and no GT.
- Emission op mixes, build rates and complaint classes over four `archie_loop_*.jsonl` traces.
- Per-family interface expected/found/matched from four `composite_anchor` / `composite_scores`
  JSONs, including the instrument's own 1.000 self-score.

**Taken from an existing report and NOT independently re-derived** (each named in place):
the BenchCAD box floor 0.4310 and `expert3d-v1` 0.3103; the neuralCAD-Edit dual floors; the
MUSE 100 % gate floor; the 300 s bevel_gear refusals; the decomposer's 695-part refusal
histogram; the holdout failure decomposition's per-habit counts; the corpus vocab audit of
2026-08-30; OCCT_CLOSURE.

**Could NOT verify:**

- Any CADGenBench score, floor or leaderboard position. GT is server-side; LAW 8 forbids it.
  `CADGENBENCH_SPEC.md` itself marks the "top score ≈ 0.39" claim UNVERIFIED. The directory's
  own `NO_GROUND_TRUTH_HERE.md` is blunter than any inference I could draw: "Interface
  sub-volumes are GT-side and **cannot be computed locally at all. No local metric can measure
  that 40 %**" — and it records that 49 of our own `output.step` files were once treated as GT
  there, making every "local proxy vs GT" number from v49 to v158 a model graded against itself.
- Whether the ARC/HELIX-using GT rows (which score IoU 0.9951 in the harvest) still build at
  this SHA. They were harvested against a build that had `FORGE_FT_ARCHELIX`; the current
  vocabulary generator records no op gated by that flag at this revision. **That gap is
  itself a finding: 49 GT programs on disk cannot be compiled by the kernel as it stands.**
- The 80.8 % build rate and 41.3 % false-self-assertion figures quoted in the brief. The
  traces I could read give build rates of 10.7 % / 26.2 % / 30.6 % / 63.9 %; I could not
  locate the artefact those two numbers came from and have not reproduced them. The
  qualitative claim they support — that a large share of failures is the model asserting a
  property its own output does not satisfy — **is** independently confirmed here
  (`"your own assertion is false"` is the 6th-largest complaint class, and
  `DECOMP_YIELD_BLOCKER.md` puts 164 of 217 gate-fails on failed self-assertions).
- Whether any op family exists in a form I did not find. I searched by op name in the kernel
  op table and compiler dispatch, not by exhaustive symbol census.

**One thing this file deliberately does not do:** recommend refusing anything. Every gap named
above is a REPRESENT/REPAIR item — `ARC` is a profile form to accept, `PLY` is a typo to
normalise, a 10-argument `PATTERN` is an arity to widen (50 359 statements in the corpus use
it). Refusal is the wrong tool for all of them, and it would fire hardest on the longest trees.
