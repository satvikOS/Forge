# PROGRAM — CADGenBench ≥ 0.85 on EVERY Dimension (North-Star Attack Plan)

**Owner:** Forge + Archie joint workstream · **Status:** ACTIVE (authored 2026-06-21) · **Gate:** mission-bible north-star.
**Synthesis sources (read these first):**
[`research/cadgenbench.md`](../research/cadgenbench.md) ·
[`research/mecado.md`](../research/mecado.md) ·
[`research/parasolid_acis.md`](../research/parasolid_acis.md).
**Web-verified 2026-06-21:** HF Space `HuggingAI4Engineering/CADGenBench` + GitHub `huggingface/cadgenbench`
confirm the validity gate ("zeroes the rest"), the four axes, Betti-number topology, the weighted-combination
CAD Score, the build123d/CadQuery/OpenSCAD baseline loop, and the `output.<ext>` + `meta.json` submission contract.

---

## 0. The bar, stated precisely

The north-star is **NOT** a 0.85 mean. It is **≥ 0.85 on every dimension simultaneously**, on the
**`validated`** leaderboard tier, decomposed as:

| Gate | Requirement |
|---|---|
| `validity_rate` | **≥ 0.97** (an invalid solid scores a hard 0 — this is requirement zero) |
| `shape_similarity` | **≥ 0.85** (mean of surface-distance-F1 + volume-IoU) |
| `interface` | **≥ 0.85** (KOR/KIR jig sub-volumes; worst-feature gating) |
| `topology` | **≥ 0.85** (Betti product s₀·s₁·s₂) |
| `score_by_task_type.generation` | **≥ 0.85** (49 fixtures, `text+image`) |
| `score_by_task_type.editing` | **≥ 0.85** (32 fixtures, `text+step`, renormalized vs no-op) |

**Public SOTA today: ~0.39–0.45 aggregate (Claude Fable 5 ≈ 0.4514).** The bar is ~2× the field and is
structurally held low by three unforgiving mechanisms: (1) the hard validity gate, (2) interface
worst-feature `min`-gating with a 0.80→0.95 ramp, (3) multiplicative topology `s₀·s₁·s₂`. Clearing 0.85
on *all six* is a category-defining, Link-Ventures-grade claim — and it only counts scored through
CADGenBench's exact gates.

**Scoring recap (memorize):**
```
Generation:  cad_score = 0.4·shape + 0.4·interface + 0.2·topology      (0 if invalid)
Editing:     s_renorm  = max(0,(shape−b_shape)/(1−b_shape))
             cad_score = 0.6·s_renorm + 0.3·interface + 0.1·topology   (0 if invalid; no-op caps ~0.4)
Pre-align:   rigid ICP only (rotation+translation, NEVER scale) over identity + 24 octahedral PCA poses
```

---

## 1. The eval harness — `ForgeCADScore v2` (geometry-truth scorer; build FIRST)

We cannot tune toward a server-side private-GT leaderboard blind. **Milestone 0 is a faithful local
re-implementation of all four axes** that replays Archie's tool-calls through the *real* Forge kernel and
scores per dimension. This is the instrument every other milestone is measured on. It extends the existing
`ForgeCADScore` (replay 1.0 vs corrupt 0.456 already proven) to the full CADGenBench rubric.

### 1.1 Pipeline (`forge-bench/cadgenscore/`)
1. **Replay** — take Archie's emitted tool-call trace, run it through `ForgeRunner` → real kernel → `output.step`.
   No fallback, no stub: a failed op surfaces the real kernel error (per the no-MVP rule).
2. **Validity gate** — `BRepCheck_Analyzer.IsValid()` (OCCT, already linked via `TKBRep`) + watertight
   shell check (no naked/free edges) + manifold tessellation audit (every edge in **exactly 2** triangles,
   `3F = 2E`, orientation-consistent — this reuses the in-house mesh-gate 2-manifold/watertight audit).
   Emit advisory diagnostics: min face area, max aspect ratio, max BREP tolerance. Fail ⇒ `cad_score = 0`.
3. **Rigid alignment** — Open3D-equivalent multi-scale **point-to-plane ICP** over pose pool = identity + 24
   octahedral PCA orientations; select by bidirectional F1 / capped symmetric Chamfer / RMSE. **Never scale.**
4. **Shape** — surface-distance-F1 (match iff nearest point ≤ **0.5 % of GT bbox diagonal** AND normals
   agree ≤ **20°**) + volume-IoU via exact solid booleans (in-house `mesh::meshBooleanNative`, Manifold-class).
5. **Interface** — per-region KOR (must be empty) / KIR (must be solid) IoU measured with a thin opposite-material
   shell; bounded pose search **±1°, ±1 % part size** per axis; ramp **IoU ≥0.95→1, ≤0.80→0**, group = `min`,
   sample = `mean` over groups.
6. **Topology** — Betti `b₀` (union-find on tri adjacency), `b₂` (ray-cast containment), `b₁ = b₀+b₂−χ/2`,
   χ = V−E+F; per-axis `((min+1)/(max+1))²`; aggregate = **product** s₀·s₁·s₂.
7. **Report** — emit `result.json` + `run_summary.json` byte-compatible with the upstream schema
   (`aggregate_score`, `validity_rate`, `score_by_task_type`, per-sample map) so a run drops straight into the HF Space.

### 1.2 Self-eval fixtures
We do NOT have the private GT. So Milestone 0 also builds an **internal GT corpus that mirrors the
CADGenBench part class** (jigs, bolt patterns, slots, bosses, pockets — see corpus program). Author a
golden STEP + KOR/KIR sub-volumes + known Betti counts per part, plus the **failure-mode fixtures** the
upstream repo ships (`jig_metric/test_*`: wrong-spacing, missing-hole, wrong-diameter, narrow-slot,
offset-slot, rotated-boss, shifted-holes). Scorer must reproduce the canonical worked example
(`0.4·0.89 + 0.4·0.00 + 0.2·1.00 = 0.56` for a shifted-slot mounting plate) to ±0.01.

### 1.3 Acceptance (Milestone 0)
- Replay of a known-good golden part → `cad_score ≥ 0.97`; a deliberately corrupted variant scores per the
  exact formula (no axis cross-talk). All seven failure-mode fixtures zero the interface group they target.
- `validity_rate` matches OCCT `BRepCheck` 1:1 on 200 random in-house parts (0 false-valid, 0 false-invalid).
- One-command `forge-bench cadgen run --suite internal` produces upstream-schema JSON. Deterministic.

---

## 2. Per-dimension gap → work → acceptance (the core matrix)

Each dimension links to the **kernel-parity program** (rows from `parasolid_acis.md`) and the **corpus
program** (Archie training data). "Current gap" is the honest 2026-06-21 read.

### DIM-1 · VALIDITY (hard gate) — *highest leverage, attack first*
- **Current gap:** Archie's CUA traces occasionally emit open shells, zero-thickness walls, or
  self-intersecting unions; OCCT booleans are weaker on degenerate/tangent cases; in-house mesh repair is
  float, not exact-predicate. A single invalid solid = 0.
- **Kernel work** (→ parity rows **a2, a4, b15, c6, c17**): run `BRepCheck_Analyzer` + auto-heal
  (`ShapeFix`/`ShapeUpgrade`, already bound Forge-23) on **every** export; harden the exact predicates
  substrate (`Predicates` gate, incl. subnormal boundary) before any boolean depends on it; tolerant-boolean
  snap within per-entity tolerance band for imported-STEP edit tasks. Add a kernel-side **pre-flight
  validator** that rejects a tool-call result that is non-manifold/non-watertight and returns a structured
  error Archie can act on.
- **Corpus work:** validity-discipline drills — every training sample's gold output passes
  `BRepCheck`; negative samples teach "this op produced an open shell → re-cap / re-sew."
- **UI work:** live validity read-out in the Archie console + viewport badge (green/red gate status) before
  "submit," mirroring the baseline's auto-feedback.
- **Acceptance:** `validity_rate ≥ 0.97` on the internal suite AND on a held-out 81-mirror suite; zero
  crashes; advisory diagnostics inside healthy bands (min face area > 0.001 mm², aspect < 1000, tol < 0.1 mm,
  target ~0.05 mm).

### DIM-2 · TOPOLOGY — *cheapest 0.85 after validity; attack second*
- **Current gap:** multiplicative `s₀·s₁·s₂` means one miscount (extra floating body, a missing or extra
  through-hole, an unintended internal void from a bad boolean) tanks the axis. Archie sometimes fuses two
  bodies or drops a hole.
- **Kernel work** (→ rows **a2, b2, c15**): watertight Boolean/union so unions don't spuriously split or
  leave voids; explicit region/lump/void-shell graph so `b₀`/`b₂` are computable by construction; formal
  Euler-operator substrate (MEV/MEF/MVFS…) as the safe primitive layer.
- **Corpus work:** **topology-count drills** — prompts that pin the exact number of through-holes, internal
  cavities, and disjoint solids; "count the holes in the drawing → emit exactly that many."
- **UI work:** live Betti read-out (`b₀ b₁ b₂` vs expected) in the console.
- **Acceptance:** topology axis ≥ 0.90 internal (headroom over 0.85 because it's `min`-fragile); on a 50-part
  count battery, b₀/b₁/b₂ all exact on ≥ 95 % of parts.

### DIM-3 · INTERFACE MATCH — *the make-or-break axis (weight 0.4 gen / 0.3 edit); attack third, hardest*
- **Current gap:** the axis general text-to-CAD models collapse on. Requires hole Ø + position, bolt-circle
  spacing, boss size/position, slot width all within ~5 % size / 1 % position, with worst-feature `min`-gating
  — one sloppy feature zeros its whole group. Forge has the parametric features bound (PolarLocations bolt
  circles, counterbore/countersink, slots, GD&T) but Archie's intent→placement is the weak link.
- **Kernel work** (→ rows **a21, a22, b14, c7, c14**): standards-driven thread/hole geometry as true B-rep
  (ISO 261 / ASME B1.1), fast instanced boolean for many-hole parts, AP242 PMI/GD&T **semantic** round-trip
  (currently bound-not-fully-wired), native clash/interference for assembly-context validation.
- **Corpus work** (the big one): **KOR/KIR assembly-context samples** keyed to the jig failure taxonomy —
  wrong-spacing / missing-hole / wrong-diameter / narrow-slot / offset-slot / rotated-boss / shifted-holes —
  each paired with the *correct* placement, trained with **full surrounding assembly context** (mating part /
  fixture), not isolated parts. "Mates with M6 bolt / locates on Ø10 pin / clears this slot" → geometry that
  fills KIR and vacates KOR.
- **UI work:** mating-feature inspector showing each KOR/KIR region's predicted IoU vs the 0.80→0.95 ramp,
  worst-feature highlighted.
- **Acceptance:** interface axis ≥ 0.85 internal; on the 7 failure-mode fixtures, the *corrected* part scores
  ≥ 0.95 IoU per region; no group `min` below ramp-pass on the 81-mirror suite.

### DIM-4 · SHAPE SIMILARITY — *broad but forgiving tolerances; attack fourth*
- **Current gap:** rigid-align-only (no scale rescue) ⇒ **absolute mm dimensions must be exact**. 0.5 % of
  bbox diagonal is tight (~0.5 mm on a 100 mm part). Wrong fillet radii, missing chamfers, wrong wall
  thickness, mis-located faces all bleed F1 + IoU. Archie's drawing-reading (generation) and dimensional
  discipline are the gaps.
- **Kernel work** (→ rows **a6–a10, a11, a16–a18, c5**): exact fillet/chamfer/blend radii (constant + variable
  + face-face), shell thickness, sweep/loft fidelity; curvature-adaptive crack-free faceter so the meshed
  surface the scorer samples is faithful.
- **Corpus work:** **drawing→parametric multimodal** samples (orthographic PNG views + dims + GD&T callouts +
  hole tables + section views → Forge tool-calls) with correct absolute mm scale; dimensional-discipline drills.
- **UI work:** dimension-overlay diff (predicted vs drawing callouts) in the console.
- **Acceptance:** shape axis ≥ 0.85 internal; surface-F1 ≥ 0.85 and volume-IoU ≥ 0.85 *both* on the generation
  mirror; no systematic scale error (median absolute scale error < 0.3 %).

### DIM-5 · GENERATION TASK (text+image) — *cross-cuts shape+interface+topology*
- **Gap/work:** the multimodal VLM path (Qwen2.5-VL) must reliably parse multi-view drawings into parametric
  intent. Corpus = the drawing→STEP multimodal set above, at scale, with the CADGenBench part class.
- **Acceptance:** `score_by_task_type.generation ≥ 0.85` on the 49-fixture mirror.

### DIM-6 · EDITING TASK (text+step) — *renormalized vs no-op; needs real imported-B-rep editing*
- **Current gap:** scoring renormalizes against a no-op baseline (`b_shape`), so **doing nothing earns ~0**;
  credit only for the correct *delta*. Requires loading `input.step`, **feature-recognizing** the target on
  foreign geometry, applying a **local** parametric edit, re-exporting without breaking unrelated geometry —
  a known frontier (rebuild-from-scratch will not preserve topology/interface).
- **Kernel work** (→ rows **a23, a24, a25, b9, b13, c1, c2, c6**): direct/local edit (tweak = replace-surface
  with auto-extend/retrim, move-face, delete-face + heal-wound), feature recognition/defeature, tolerant
  modeling on imported STEP, persistent-ID-driven rebuild (avoid the FreeCAD topological-naming trap).
- **Corpus work:** **STEP-edit samples** — paired (`input.step`, edit instruction, surgical-delta gold output);
  add/remove/resize a hole, move a slot, change a thickness — with topology/interface preserved unless the
  edit demands change.
- **Acceptance:** `score_by_task_type.editing ≥ 0.85`; `s_renorm > 0` on every edit fixture (beat the 0.4 no-op cap).

---

## 3. Leaderboard-attack order (lowest-hanging first) + phased milestones

Ordered by **leverage ÷ cost** — get the gate + cheap axes locked, then grind the expensive interface/edit work.

| Phase | Milestone | Dimensions | Gating exit criterion | Depends on |
|---|---|---|---|---|
| **M0** | `ForgeCADScore v2` harness + internal mirror corpus | (instrument) | §1.3 met; reproduces canonical 0.56 example ±0.01 | OCCT BRepCheck, mesh-gate audit, `meshBooleanNative` |
| **M1** | Validity lockdown | DIM-1 | `validity_rate ≥ 0.97`, 0 crashes, diagnostics in healthy band | M0; kernel a2/a4/b15/c6/c17 |
| **M2** | Topology-by-construction | DIM-2 | topology axis ≥ 0.90; b₀/b₁/b₂ exact ≥ 95 % | M1; kernel a2/b2/c15 + count-drill corpus |
| **M3** | Shape fidelity (generation) | DIM-4, DIM-5 | shape ≥ 0.85 (F1 & IoU both), gen ≥ 0.85 | M1; kernel a6–a18/c5 + drawing→STEP corpus + VLM |
| **M4** | Interface mating correctness | DIM-3 | interface ≥ 0.85; corrected fixtures ≥ 0.95 IoU/region | M2/M3; kernel a21/a22/c7/c14 + KOR/KIR corpus |
| **M5** | STEP-editing | DIM-6 | editing ≥ 0.85; `s_renorm>0` all fixtures | M1/M4; kernel a23–a25/b9/b13/c1/c6 + edit corpus |
| **M6** | All-axis convergence + self-correction loop | ALL | every dimension ≥ 0.85 on held-out 81-mirror | M1–M5 |
| **M7** | Validated public submission | ALL | **`validated` HF row, ≥0.85 every reported axis & both task types** | M6; reproducibility evidence for Rabinovich review |

**Why this order:** Validity is a multiplicative `×0` gate on *everything* → M1 first. Topology is the
cheapest remaining (counts, not millimeters) and `min`-fragile → M2. Shape has forgiving tolerances and
unlocks the generation task → M3. Interface is the highest-weight, most-expensive, most-differentiating axis
and depends on accurate placement that M3's dimensional discipline enables → M4. Editing needs real
imported-B-rep editing (hardest kernel frontier) and benefits from everything before it → M5.

---

## 4. Self-correction loop (the CUA mirror of the baseline agent)

The baseline iterates: export → show validation + ISO render → refine → `[DONE]`, budget 1000 iters / 30 min
wall / temp 0.0 / 16 384 tok-per-call. **Archie's CUA loop must surface the SAME signals** so it self-corrects
toward the gate. After each tool-call result, feed Archie: (a) `BRepCheck` validity + watertight/manifold
status, (b) Betti `b₀b₁b₂`, (c) volume + bbox vs target, (d) an ISO render PNG. This requires Forge's
render-feedback to emit the validation packet `ForgeCADScore v2` already computes — wire them to share one
path. The loop is the difference between "great shapes, leaky solid (0)" and "converged to valid + correct."

---

## 5. Dependencies on the other programs (link map)

- **Kernel-parity program** (`parasolid_acis.md` → `programs/kernel_parity_program.md` when authored):
  the §"biggest-gap synthesis" rows are the literal blockers — tolerant modeling/booleans + heal (b9/a4/c6) for
  DIM-1/DIM-6; surface-surface intersector + B-rep boolean robustness (b8/a2) for DIM-1/DIM-2; blending suite
  (a6–a10) for DIM-4; feature-recognition/defeature + persistent-ID rebuild (a25/b13/c1) for DIM-6; AP242 PMI
  round-trip (c7) for DIM-3. **Forge already HAS most analytic/primitive rows via OCCT** — the gate-clearing
  work is the `[GAP-HARD]` moats, plus running BRepCheck+heal on every export (cheap, do immediately).
- **Corpus program** (Archie training data): four corpora — (1) drawing→parametric multimodal, (2) KOR/KIR
  assembly-context (failure-taxonomy-keyed), (3) STEP-edit surgical deltas, (4) topology-count drills — all in
  the CADGenBench part class (jigs/bolts/slots/bosses/pockets), full assembly context, CC0/synthetic/licensed
  (IP-clean per Mecado's anti-silo ideology). Generated at scale via `bulk_synth` (13k+/run), strictly
  download→process→delete one-at-a-time for storage safety.
- **Mission bible:** track `validity_rate`, shape, interface, topology, gen, edit **separately** — a 0.85 mean
  with a weak interface axis FAILS the bar. This program is the canonical decomposition.
- **UI/UX program:** the live validity/shape/interface/topology read-outs + mating-feature inspector + Betti
  badge are enterprise-UI deliverables that double as Archie's self-correction feedback surface.

---

## 6. ACCEPTANCE GATE (the program is "done" when)

1. `ForgeCADScore v2` reproduces all four CADGenBench axes 1:1 on the failure-mode fixtures (M0).
2. On a held-out 81-fixture mirror: `validity_rate ≥ 0.97` AND `shape ≥ 0.85` AND `interface ≥ 0.85` AND
   `topology ≥ 0.85` AND `generation ≥ 0.85` AND `editing ≥ 0.85` — **every** axis, not the mean (M6).
3. A **validated** public CADGenBench leaderboard row (Rabinovich methodology review passed) with the same
   per-axis profile — ≥ 0.85 everywhere, ~2× the public field (M7).
4. One-command reproducible run; deterministic; no fallback/stub; clean advisory diagnostics; submission
   byte-compatible with the HF Space contract.

---

## Sources
- GitHub `huggingface/cadgenbench` — metric docs, baseline agent, jig fixtures (web-verified 2026-06-21): https://github.com/huggingface/cadgenbench
- HF Space leaderboard: https://huggingface.co/spaces/HuggingAI4Engineering/CADGenBench
- HF public input dataset: https://huggingface.co/datasets/HuggingAI4Engineering/cadgenbench-data
- Mecado benchmark page: https://www.mecado.com/benchmark
- SOTA datapoint (Claude Fable 5 ≈ 0.4514): https://benchmarklist.com/
- Internal research: `research/cadgenbench.md`, `research/mecado.md`, `research/parasolid_acis.md`
