# CADGenBench — Deep Dive (THE North-Star Benchmark)

> Research date: 2026-06-21. Sources are primary (the official Hugging Face `cadgenbench`
> GitHub repo, the `HuggingAI4Engineering` HF Space + dataset, the Mecado announcement,
> and the launch thread). Where a number is quoted it is verbatim from the source file.
> URLs are listed at the bottom.

---

## 0. TL;DR — what CADGenBench actually is

CADGenBench is a **tool-agnostic, STEP-in/STEP-out engineering-CAD benchmark** built jointly by
**Hugging Face** (`HuggingAI4Engineering`) and **Mecado Inc.** (Michael Rabinovich). It measures
whether an AI system can produce **functional, engineering-grade mechanical parts**, not just
plausible-looking shapes. The core thesis from the launch: *"while current models can generate 3D
parts, they are far from precise enough to build functional parts."*

It is **not** a code benchmark and **not** a token-match benchmark. You submit the **final solid
geometry** (a STEP/BREP file or a watertight mesh); the grader meshes it, rigidly aligns it to a
**private ground-truth solid**, and scores **geometric truth**. The CAD authoring tool is entirely
your choice (build123d, CadQuery, OpenSCAD, Onshape, Fusion, SolidWorks, Autodesk — anything that
emits STEP). This is exactly the contract Forge wins on: **Archie → tool-calls → Forge OCCT-grade
kernel → STEP**, scored on the same geometric-truth axes Forge's own `ForgeCADScore` already uses.

- **Two tasks:** (1) **Generation** — engineering drawing → valid 3D part; (2) **Editing** — input
  STEP + change request → modified STEP.
- **81 fixtures total:** **49 generation** + **32 editing** (single eval set, no train split).
- **Headline metric = `cad_score`** (a.k.a. CAD Score / `aggregate_score`), in **[0,1]**, **gated by validity**.
- **Four axes:** **Validity** (hard gate), **Shape Similarity**, **Interface Match**, **Topology Match**.
- **Dataset:** `HuggingAI4Engineering/cadgenbench-data` (public inputs, 199 MB, ODC-BY) +
  `cadgenbench-data-gt` (private ground truth, jig sub-volumes).
- **SOTA today is LOW:** a public datapoint shows **Claude Fable 5 ≈ 0.4514**. The benchmark is
  designed so frontier general models score well under 0.5 — **0.85 on every axis is wide open.**

---

## 1. The input → output contract

### 1.1 Inputs (per fixture, from `description.yaml`)
- **Generation fixture** (49): one or more **engineering drawing PNGs** + a **text task prompt**.
  Input modality field = `"text+image"`.
- **Editing fixture** (32): a **starting STEP** (`input.step`, the CAD solid) + a **mesh sidecar**
  (`.npz`) + **rendered views** (ISO / front / top / right PNGs) + a **text edit instruction**.
  Input modality field = `"text+step"`.
- `description.yaml` fields: task description, `task_type` (generation|editing), input file
  listing, input modality (`text+image` | `text+step`).

### 1.2 Output (what you submit)
- **One candidate solid per fixture**, named `output.<ext>`:
  - **Preferred:** `output.step` / `output.stp` (well-formed, watertight BREP).
  - **Also accepted:** `output.stl`, `output.obj`, `output.off`, `output.3mf`, `output.ply`
    (held to *stricter* mesh-manifold rules; STEP is preferred when both exist).
- **Packaging:** a ZIP, one folder per sample, plus a root `meta.json`; on-disk run layout is:
  ```
  results/<run_name>/
  ├── <sample_name>/output.<ext>
  ├── <sample_name>/output.<ext>
  └── run_summary.json
  ```
- **Per-sample grader output** `result.json`: `status` (`valid`/`invalid`/`missing`),
  `validation` (topology/volume/bbox), `alignment`, `gt_metrics`, `shape_diagnostics`,
  `cad_score`, and optional `interface_metrics`, `topology_metrics`, `edit_metrics`.
- **Run roll-up** `run_summary.json`: `aggregate_score` (headline), `validity_rate`, breakdown by
  `task_type` (generation vs editing), per-sample score map.

> **Archie/Forge implication:** the deliverable is a STEP file. Archie does **not** need to emit
> the benchmark's authoring code — it drives Forge, Forge's kernel exports STEP. The whole
> pipeline is judged on the geometry. This plays directly to Forge's native OCCT-class B-rep core.

---

## 2. The scoring framework (exact formulas)

### 2.0 Pre-scoring rigid alignment
Before any metric runs, the candidate is **rigidly aligned** to the GT (**rotation + translation
only, NEVER scaling**) via **Open3D multi-scale point-to-plane ICP**, choosing the best pose from a
candidate pose pool = **identity + 24 octahedral PCA orientations**, selected by *"bidirectional F1,
capped symmetric Chamfer, RMSE."* Because scaling is never applied, **absolute dimensional accuracy
matters** — a part at the wrong scale cannot be rescued by alignment.

### 2.1 Headline formula

**Generation:**
```
cad_score = 0.4 · shape_similarity + 0.4 · interface + 0.2 · topology_match     (if valid)
cad_score = 0                                                                    (if invalid)
```

**Editing** (shape axis renormalized against a no-op baseline `b_shape`):
```
s_renorm  = max(0, (shape_similarity - b_shape) / (1 - b_shape))
cad_score = 0.6 · s_renorm + 0.3 · interface + 0.1 · topo_match                  (if valid)
```
The editing renormalization means **doing nothing earns ~0** — you only get shape credit for the
*delta* you correctly produced beyond the unmodified input.

**Aggregate / leaderboard:** `aggregate_score` = mean of per-sample `cad_score`; the leaderboard
also reports `validity_rate` and a generation-vs-editing breakdown. Rows sort by `aggregate_score`
descending (nulls last). Two tiers: `unvalidated` (auto) and `validated` (manual methodology review
by maintainers; request via email subject "CadGenBench verification").

---

### 2.2 AXIS 1 — Validity (the hard gate; failure ⇒ `cad_score = 0`)

A candidate must pass **all** of:
1. **Well-formed BREP** — `BRepCheck_Analyzer.IsValid()` (OCCT) — no per-face/per-edge/per-vertex
   defects (self-intersecting wires, misaligned edges).
2. **Watertight** — all shells closed, no free/exposed edges.
3. **Manifold tessellation** — meshes to a triangle surface where every edge is in **exactly 2**
   triangles (closed), ≤2 (manifold), and orientation-consistent.

Direct mesh submissions skip BREP checks but **must themselves** be manifold + closed +
orientation-consistent. Any failure ⇒ `is_valid = False`, `cad_score = 0`, with a human-readable
reason. **Non-gating advisory warnings:** face area < `0.001 mm²`, aspect ratio > `1000`, BREP
tolerance > `0.1 mm`.

> **Archie capability needed:** every emitted part must be a closed, valid solid. **This is the
> single highest-leverage axis** — a model with great shapes but leaky/non-manifold output scores
> **zero**. Forge's kernel `BRepCheck`-equivalent + healing must run on every export, and Archie's
> tool-calls must never produce open shells, zero-thickness walls, or self-intersections.

---

### 2.3 AXIS 2 — Shape Similarity ∈ [0,1]
```
shape_similarity = ½ · (surface_distance_F1 + volume_IoU)
```

**(a) Surface Distance F1 (`shape_surface_distance_f1`)** — sample points w/ outward normals on
both surfaces. A point is **matched** iff:
- nearest point on the other surface is within **0.5 % of the GT bounding-box diagonal**, **AND**
- surface normals agree **within 20°**.

Precision = fraction of candidate points matched; Recall = fraction of GT points matched; combine
to F1. (Normal agreement makes it penalize wrong orientation of faces, not just position.)

**(b) Volumetric IoU (`shape_volume_iou`)** — `vol(A ∩ B) / vol(A ∪ B)` computed with the
**manifold3d** boolean kernel (exact solid booleans, not voxels).

> **Archie capability needed:** dimensionally exact geometry. 0.5 % of bbox diagonal is a tight
> tolerance — a 100 mm-diagonal part allows ~0.5 mm surface error before points stop matching.
> Wrong fillet radii, missing chamfers, wrong wall thickness, or mis-located faces all bleed F1
> and IoU. Forge must produce parts to drawing dimensions, with correct feature placement.

---

### 2.4 AXIS 3 — Interface Match ∈ [0,1] (the "jig" / mating metric — Mecado's signature axis)

Each mating feature is a **sub-volume**:
- **Keep-Out Region (KOR):** candidate **must be empty** here (bolt holes, slots, clearance).
- **Keep-In Region (KIR):** candidate **must be solid** here (locating bosses, pins, mating pads).

Each region is scored by **IoU of material correspondence**, evaluated *with a thin shell of the
opposite material around it* so that **both oversized and undersized features lose points** (you
can't pass by simply removing surrounding material). A small **pose search** is run per region
(**±1° rotation, ±1 % of part size translation per axis**), keeping the best fit.

**Soft ramp:** region IoU **≥ 0.95 → 1.0**, **≤ 0.80 → 0**, linear in between.

**Aggregation:** a mating **group** scores as its **worst (min) feature**; the sample's interface
score is the **mean over independent groups** (partial credit across groups, none within a group).

> **Archie capability needed:** *assembly-correct* features — hole diameters/positions, bolt-circle
> spacing, boss size/position, slot width — within ~5 % (the 0.80→0.95 ramp) and 1 % positional
> tolerance. This is where general text-to-CAD models collapse. Forge's parametric features
> (PolarLocations bolt circles, counterbore/countersink, slots) + GD&T must hit the jig sub-volumes.
> Fixtures in the repo (`jig_metric/test_*`) literally test wrong-spacing, missing-hole,
> wrong-diameter, narrow-slot, offset-slot, rotated-boss, shifted-holes failure modes.

---

### 2.5 AXIS 4 — Topology Match ∈ [0,1] (Betti numbers)

From the watertight manifold surface, compute **Betti numbers**:
- **b₀** = connected components — union-find on triangle adjacency.
- **b₂** = internal voids — ray-cast classify (even hits ⇒ outer shell, odd ⇒ inner void).
- **b₁** = through-handles — from Euler characteristic: **b₁ = b₀ + b₂ − χ/2**, where χ = V − E + F.

Per-axis fuzzy log-ratio score (α = 2):
```
s_i = ((min(c_i, g_i) + 1) / (max(c_i, g_i) + 1))^2
```
`= 1` when counts match, decays smoothly otherwise; +1 keeps it finite at zero.

**Aggregate = s₀ · s₁ · s₂** (multiplied, NOT averaged) — *"getting two of three invariants right is
not a partial match."*

> **Archie capability needed:** correct **count** of bodies, holes/handles, and internal cavities.
> Missing a hole (wrong b₁) or fusing two bodies (wrong b₀) tanks the whole topology axis
> multiplicatively. Forge must produce the right number of through-holes, voids, and disjoint solids.

---

## 3. Reference baseline (the bar to beat / how the harness drives a model)

The official baseline is an **iterative agent** (`src/cadgenbench/baseline/agent.py`):
- Writes **build123d Python** on the **OpenCascade BREP** pipeline (also supports CadQuery → STEP,
  OpenSCAD → mesh). Persistent working dir; tool = Python execution; finishes by emitting `[DONE]`.
- **Auto-feedback loop:** after every `output.step` export the agent is automatically shown
  **validation results** (watertight/topology/volume/bbox) **+ an ISO render PNG**, then iterates.
- **Editing:** detects `input.step`, loads via `import_step`, applies the change, re-exports.
- **Config (`default_config.yaml`):** `temperature 0.0`, `max_tokens 16384/call`,
  `max_total_tokens 1,000,000`, `max_iterations 1000`, `max_duration_s 1800` (30 min wall-clock),
  `runner_timeout 120 s`, `reasoning_effort` tunable. Multi-provider via **LiteLLM**.
- Ships **build123d / CadQuery / OpenSCAD cheat sheets** as the op vocabulary (primitives:
  Box/Cylinder/Sphere/Cone/Torus/Wedge; ops: extrude/revolve/loft/sweep/fillet/chamfer/offset/
  split/mirror; holes: Hole/CounterBore/CounterSink; patterns: Grid/Polar/Hex Locations).

> **Forge mirror:** Archie's CUA loop already mirrors this exactly — typed prompt → tool-calls →
> kernel build → render feedback → iterate. The op vocabulary above is a **subset** of Forge's
> 70+ kernel modules. To beat the baseline, Forge's render-feedback must surface the **same**
> validation signals (watertight/Betti/volume/bbox) so Archie can self-correct toward the gate.

---

## 4. SOTA & difficulty (why 0.85-on-every-axis is the real prize)

- The benchmark is explicitly framed as **hard and unsaturated** — frontier general models *"are
  far from precise enough to build functional parts."*
- Confirmed public datapoint: **Claude Fable 5 ≈ 0.4514** aggregate (via BenchmarkList tracking).
- The live leaderboard (`results.jsonl` behind the HF Space) is dynamically served and gated, but
  the **validity gate + tight tolerances (0.5 % bbox diag, ±1 % interface pose, multiplicative
  topology)** structurally hold scores low: a single invalid solid is a 0, and interface/topology
  are unforgiving. **No model is near 0.85 across all axes today.**

**What "≥ 0.85 on EVERY dimension" demands (not just a 0.85 mean):**
1. **Validity rate ≥ ~0.95+** — almost every part a clean, watertight, manifold solid.
2. **Shape ≥ 0.85** — surface F1 + volume IoU both high ⇒ dimensions correct to <0.5 % bbox diag.
3. **Interface ≥ 0.85** — essentially every KOR/KIR region at IoU ≥ ~0.92 (mid-ramp), worst-feature
   gating means **no** sloppy hole/boss/slot anywhere in a group.
4. **Topology ≥ 0.85** — every b₀/b₁/b₂ count correct (multiplicative ⇒ near-exact required;
   to clear 0.85 product you essentially need all three counts exact or off-by-trivial).

---

## 5. Per-dimension scorecard — what Archie+Forge must do to hit 0.85

| # | Dimension | What it tests | Exact metric | Archie/Forge capability to reach ≥0.85 |
|---|-----------|---------------|--------------|----------------------------------------|
| 1 | **Validity** (gate) | Closed, valid, manifold solid | OCCT `BRepCheck_Analyzer.IsValid()` + watertight shells + manifold mesh (edge∈exactly 2 tris) | Run BRep validity + auto-heal on **every** export; never emit open shells / zero-thickness / self-intersections. Validity_rate must be ≥0.95. **Highest leverage axis.** |
| 2 | **Shape Similarity** | Geometric fidelity to GT solid | `½(surface_F1 + volume_IoU)`; match = ≤0.5% bbox-diag dist **and** ≤20° normal; IoU via manifold3d | Build to **exact drawing dimensions**; correct fillet/chamfer radii, wall thickness, feature positions. No scaling rescue (rigid align only). |
| 3 | **Interface Match** | Assembly/mating correctness | KOR (must be empty) + KIR (must be solid) IoU w/ opposite-material shell; ramp 0.80→0.95; ±1°/±1% pose; group=min, sample=mean | Hole Ø+position, bolt-circle spacing (PolarLocations), boss size/pos, slot width all within ~5%/1%. **Where general models fail; Forge's GD&T + parametric features win.** |
| 4 | **Topology Match** | Correct count of bodies/holes/voids | Betti b₀ (union-find), b₂ (ray-cast), b₁=b₀+b₂−χ/2; per-axis `((min+1)/(max+1))²`; product s₀·s₁·s₂ | Emit the **exact** number of through-holes, internal cavities, disjoint solids. Multiplicative ⇒ all three counts must be right. |

**Cross-cutting capabilities Archie's training corpus must instill:**
- **Drawing reading (multimodal):** parse engineering-drawing PNGs (views, dims, GD&T callouts,
  hole tables, section views) into parametric intent — generation is `text+image`.
- **STEP editing:** load `input.step`, localize the feature to change, apply the delta, re-export
  without breaking unrelated geometry (editing renormalizes against no-op ⇒ surgical edits only).
- **Dimensional discipline:** mm units; absolute scale correct (no rigid rescue).
- **Assembly intent:** translate "mates with M6 bolt / locates on Ø10 pin / clears this slot" into
  geometry that fills KIR and vacates KOR sub-volumes.
- **Self-correction loop:** consume validation+render feedback each turn to converge to a valid,
  dimensionally-correct, assembly-correct, topologically-correct solid within the iteration budget.

---

## 6. Direct implications for the four ArchDisc workstreams

- **Mission bible / north-star:** ">=0.85 on CADGenBench across every dimension" decomposes into the
  4 axes above. Track `validity_rate`, shape, interface, topology **separately** — a 0.85 mean with
  a weak interface axis fails the bar.
- **Archie training corpus:** add (a) **drawing→parametric** multimodal samples (PNG views + dims →
  Forge tool-calls), (b) **KOR/KIR assembly-context** samples (the jig fixtures show the failure
  taxonomy: wrong-spacing/missing-hole/wrong-diameter/offset-slot/rotated-boss/shifted-holes), (c)
  **STEP-edit** samples (surgical deltas), (d) **topology-count** drills (right # holes/voids/bodies).
- **Kernel 1:1 parity:** the grader leans on OCCT `BRepCheck_Analyzer`, manifold3d booleans, and
  watertight tessellation — Forge's kernel must match these on validity + exact booleans + clean
  meshing, and Forge's **own** `ForgeCADScore` should re-implement these 4 axes for offline self-eval.
- **UI/UX:** surface live **validity / shape / interface / topology** read-outs (the same auto-
  feedback the baseline gives) so the human + Archie see the gate status before "submitting."

---

## 7. Sources
- GitHub repo (code, metric docs, baseline, fixtures): https://github.com/huggingface/cadgenbench
  - `docs/metrics.md`, `docs/metrics/{cad_validity,shape_similarity,interface_match,topo_match}.md`
  - `docs/benchmark/{submission,validation}.md`
  - `src/cadgenbench/baseline/{agent.py,prompt.py,default_config.yaml,build123d_cheat_sheet.md}`
  - `tests/fixtures/jig_metric/*` (KOR/KIR interface failure fixtures)
- HF Leaderboard Space: https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench
- HF public input dataset: https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data
- Mecado benchmark page: https://www.mecado.com/benchmark
- Launch thread (Michael Rabinovich / Mecado): https://x.com/MikushRab/status/2063999885796614522
- AINews recap (HF+Mecado launch): https://news.smol.ai/issues/26-06-08-not-much
- SOTA datapoint (Claude Fable 5 ≈ 0.4514): https://benchmarklist.com/
