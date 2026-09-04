# FILLET — the 58 at 2–5e-6 are a real geometric difference, the integrator is not the cause, and the tolerance must not move

`reports/corpus_ab/FLIP_GATE_REPLACEABILITY_2026-09-03.md` §3.1 classes FILLET's 58
valid-pair disagreements as **"a numerical margin"** — volume ratio 0.999995–0.999998,
2–5e-6 relative against the A/B comparator's bound — and §6 lists *"whether FILLET's 58
pairs at 2–5e-6 are a defect or a tolerance"* as a thing that run could not answer.

**It is neither.** Measured here, over the same 600 parts and reproducing the same 58
part for part:

| the three candidate causes | verdict | the measurement that settles it |
|---|---|---|
| (b) accumulated error in the volume integration | **refuted** | the harness's fixed-order integrator agrees with OCCT's adaptive Gauss and Gauss–Kronrod integrators to **≤ 2.825e-9** on the worst part and **1.40e-10** at the median — **766× smaller** than the *smallest* disagreement it is asked to explain |
| (c) a different but equally valid representation feeding the integrator | **refuted as the cause of the number**, confirmed as the cause of the *cause* | the 8 walls the native arm re-spells from `SurfaceOfLinearExtrusion` to `Plane`/`Cylinder` are the **same surfaces to 1.59e-14** over 464 sampled face pairs, and contribute at most **1.98e-9** to the volume gap — 6.8e-9 of the smallest gap they would have to explain |
| (a) a genuine geometric difference in the fillet surface | **CONFIRMED** | 100.0% of the whole-solid gap is the blend (ratio 1.00000 min/median/max, 58/58); against a closed form read off the input's own cap ring the native arm removes **1.000000× 58/58** and OCCT removes **0.999236–0.999350×**; OCCT's blend face departs from the exact radius-R rolling-ball surface by up to **0.00288 R** where the native arm's departs by **1.4e-14** |

And the cause of *that*, isolated in a from-scratch controlled experiment with **OCCT on
both sides and no corpus and no native engine involved**: one rounded-rectangle prism
built twice, the same point set to 3.55e-15, differing only in how its walls are spelled.
OCCT's own `BRepFilletAPI_MakeFillet` returns an **exact analytic blend** on the
elementary spelling (miss vs the closed form **2.18e-14**) and an **approximate B-spline
blend** on the extrusion spelling (miss **4.71e-4**), a whole-solid volume difference of
**3.28e-6** — inside the corpus band of 2.16e-6 to 5.00e-6.

**Consequence for the ledger owner.** The 58 are not a tolerance question, so nothing in
this change touches a tolerance, and the recommendation is that nothing should: the two
arms bound genuinely different solids, and the arm the flip gate calls the *bar* is the
approximate one. The `agree` term of `FORGE_FILLET_DROP_NATIVE`'s verdict is **correctly
red** on these 58, and it would still be red under any bound tight enough to be worth
having. The measurement improvement that *is* available is the opposite of a widening —
§7.

---

## 1. The instrument

`forge-kernel/test/fillet_nearmiss_probe.cpp`, driven by
`test/run_fillet_nearmiss_probe.sh`, one process per part over the same 600-part corpus
and the same derived operation (longest LINE edge, `R = 0.05 × min bbox extent`) copied
verbatim from `test/corpus_ab_coverage.cpp`. It links the **same** native engine and the
**same** OCCT as the A/B — it shares the A/B's own object archive precisely so the two
binaries cannot drift apart and answer for different engines.

It is a second, independent implementation, and it lands on the same population:

| | A/B (`corpus_ab_coverage`) | this probe | agree |
|---|---:|---:|---|
| parts where both arms build | 402 | 402 | ✅ |
| of those, both BRepCheck-valid | 311 | 311 | ✅ |
| **valid pairs whose volumes disagree at 1e-6 relative** | **58** | **58** | ✅ **the same 58 parts, by name** |
| per-part volumes, both arms | — | — | **0 mismatches at 10 significant figures** |

**Six controls run before the binary is emitted**, and a red control refuses it
(`reports/corpus_ab/fillet_nearmiss_probe_selftest.txt`):

| control | what it protects | reading |
|---|---|---|
| C1 a face against itself | the geometric comparator can see *identical* | maxdist 0 over 81 samples |
| C2 the same face displaced 0.25 along its own normal | the comparator is not stuck at 0 — **the negative control**; its first version translated *within* the plane and passed by luck | maxdist 0.25 |
| C3 a cylinder's volume vs `π r² h` | anchors "converged / not converged" to a known answer | fixed 1.28e-16, GK 2.44e-15 |
| C4 a box edge, both arms, vs `(1−π/4)R²L` | the derived operation and both engines are wired the way the A/B wires them | 1.000000000 / 1.000000000 |
| C5 the spelling experiment's two inputs | an experiment whose arms differ in geometry proves nothing about spelling | \|dV\|/V = 1.25e-16 |
| C6 UTF-8-safe JSON truncation | see §9 — the probe's first run wrote 67 of 600 rows a strict reader refuses | cut 159 / whole 162 |

---

## 2. Not (b): the integrator is converged, on both arms, by two independent methods

`BRepGProp::VolumeProperties(S, P)` — what the A/B calls — is **fixed-order** Gauss
quadrature. OCCT ships two adaptive integrators that report the relative error they
actually reached: `VolumeProperties(S, P, Eps)` (adaptive Gauss) and
`VolumePropertiesGK` (adaptive Gauss–Kronrod). Run at `Eps = 1e-12` on the same shapes:

| arm | \|v_fixed − v_GK\| / v | \|v_fixed − v_adaptive\| / v |
|---|---|---|
| the input | 7.26e-16 … **1.94e-15** | 0 … 4.96e-16 |
| native | 1.77e-16 … **1.14e-15** | 0 … 4.88e-16 |
| OCCT | 5.30e-16 … **2.825e-9** (p50 1.395e-10) | 0 … 2.826e-9 |

The quantity to be explained is 2.164e-6 to 5.00e-6. The **largest** disagreement any
integrator has with any other, on any of the 58, is **2.825e-9 — 766× smaller than the
smallest gap** — and 1.40e-10 at the median. Two integrators of different families cannot
both be wrong by 3e-6 and agree with each other to 1e-10.

Two further facts point the same way, and neither is compatible with accumulated
floating-point error:

* the **253 valid pairs that agree** do so to **≤ 2.06e-15 relative** — median **1.17e-16**,
  and **121 of the 253 bit-identical**. When the two arms build the same solid this
  integrator reproduces it to the last bit or the one before it, which is nine orders of
  magnitude below the gap under study;
* the two full 600-part runs of this probe, from two builds, produced
  **0 volume mismatches over 600 parts**.

  *(An earlier draft of this line said "bit-identical, 253/253". That came from reading
  the A/B's JSONL, which prints volumes at `%.10g`; at ten significant figures 253 of 253
  look identical and only 121 are. Corrected against the probe's own `%.17g` output.)*

---

## 3. Not the re-spelling either: the walls are the same surfaces to 1.6e-14

The native arm rewrites eight of each part's walls from the STEP file's
`Geom_SurfaceOfLinearExtrusion` to the `Plane` / `Cylinder` they already are; OCCT keeps
the extrusion spelling. That is a representation difference of exactly the kind
hypothesis (c) names, and on the **walls** it is worth nothing at all:

| matched face pair, native vs OCCT | count | sampled surface distance | volume contribution difference |
|---|---:|---|---|
| `Cylinder` vs `SurfExtr`, `Plane` vs `SurfExtr` | 464 pairs over the 58 parts | 0 … **1.589e-14** (p50 7.105e-15) | p50 5.68e-14, max **1.98e-9** — **6.8e-9 of the smallest whole-solid gap** |

On a part with a 278 mm diagonal, 1.6e-14 mm is 5.7e-17 relative. The canonicalisation is
exact. **No part of the 2–5e-6 lives in the walls.**

---

## 4. All of it is the blend, and a closed form says which arm is right

`BRepFilletAPI_MakeFillet::Add` propagates a contour across tangent junctions, so on
these parts the operation both arms perform is the whole **rim**, not the picked edge
(`FILLET_RIM_ATTRIBUTION.md` §2). The material a radius-R rolling ball removes from such
a rim is elementary and exact:

```
|dV| = SUM over straight runs  (1 − π/4) R² L
     + SUM over corner arcs    θ · [ R²(2ρ−R)/2 − R³/3 − (ρ−R) π R²/4 ]
```

Every quantity in it — `L`, `ρ`, `θ` — is read off **the input's own cap ring**, so the
oracle is independent of both arms and can say which one is right rather than only that
they differ. On all 58 the ring is 4 lines and 4 arcs and is exactly G1 (worst tangent
break **2.45e-16**), which is the condition under which the model applies at all.

| | min | p50 | max |
|---|---|---|---|
| **native** removed / closed form | **1.000000** | **1.000000** | **1.000000** |
| **OCCT** removed / closed form | 0.999236 | 0.999278 | 0.999350 |
| 1 − OCCT/closed form | 6.50e-4 | 7.21e-4 | 7.64e-4 |

and the whole-solid gap **is** the blend gap, exactly:

| | min | p50 | max |
|---|---|---|---|
| whole-solid gap `V_occt − V_native` | 0.291733 | 1.06462 | 2.76736 |
| blend gap `removed_native − removed_occt` | 0.291733 | 1.06462 | 2.76736 |
| ratio | **1.00000** | **1.00000** | **1.00000** |

**100.0% of the disagreement is the blend and 0.0% is anything else.** OCCT under-removes
by 6.5–7.6e-4 of the blend; the native arm hits the closed form.

### The blend surface itself, measured without any integral

A constant-radius rolling-ball fillet surface is by definition at distance exactly `R`
from the ball's spine — a **cylinder** of radius R along each straight run, a **torus**
of minor radius R around each corner. Both are analytic and unbounded in their natural
parameters, so a point can be measured against them with no reference to how any face is
trimmed. Sampling each arm's blend faces:

| | min | p50 | max | in multiples of R |
|---|---|---|---|---|
| **OCCT's B-spline blend** vs the exact rolling-ball surface | 0.00610 | 0.00927 | 0.01356 | **0.00219 – 0.00288 R** |
| native's blend vs the same surface *(0 by construction — a consistency reading, not evidence)* | 5.33e-15 | 7.55e-15 | 1.42e-14 | — |
| **OCCT's blend** principal-curvature miss `max \| \|κ\|R − 1 \|` | 0.0196 | 0.0226 | **0.0244** | — |
| native's blend, same reading | 2.08e-16 | 3.41e-16 | 5.40e-16 | — |

OCCT's blend face is up to **0.29% of R** away from the surface a rolling ball of radius
R sweeps, and its curvature is off by up to 2.4%. That is **9.6e11 times** the native
arm's reading on the same measurement (0.01356 against 1.42e-14) and far above any
floating-point scale. **The two arms bound different solids.**

---

## 5. The controlled experiment: geometry held fixed, spelling varied, OCCT on both sides

Everything above says *what* differs. This says *why*, and it uses **no corpus, no
imported file, and not one line of the native engine** — so it cannot be an artefact of
either. `fillet_nearmiss_probe --spelling`
(`reports/corpus_ab/fillet_nearmiss_spelling_experiment.txt`):

One rounded-rectangle prism (80 × 50, corner radius 12, height 30), built twice:

* **A** — walls as OCCT's own prism builder makes them: `Plane:6 Cylinder:4`
* **B** — the same walls spelled `Geom_SurfaceOfLinearExtrusion` of the **same curves**
  along the **same direction**: `Plane:2 SurfExtr:8`

The two are asserted to be the same geometry before the experiment runs, and they are:

```
|dV|/V = 1.25e-16   |dA|/A = 1.22e-16
face pairing: 10 pairs, 0 unmatched, worst sampled surface distance 3.55e-15
```

Then OCCT's own `BRepFilletAPI_MakeFillet`, same rim, same `R = 4`, on each:

| | closed form | OCCT removed | removed / closed | the answer's faces |
|---|---|---|---|---|
| **A** elementary spelling | 802.728900171 | 802.728900171 | **1.000000000000** (miss **2.18e-14**) | `Plane:6 Cylinder:8 Torus:4` — **exact analytic blend** |
| **B** extrusion spelling | 802.728900171 | 802.350484828 | **0.999528588864** (miss **4.71e-4**) | `Plane:2 BSpline:8 SurfExtr:8` — **approximated blend** |

Both results are BRepCheck-valid; both volumes are converged (`gk_err` 5.4e-12 and
4.1e-11). The whole-solid difference between OCCT's two answers is
`115489.329778679 − 115488.951363337 = 0.378415342`, i.e. **3.28e-6 relative — inside the
corpus's 2.16e-6 … 5.00e-6 band.**

**OCCT's fillet gives a different solid for the same input geometry depending on how that
geometry is written down.** The corpus's parts arrive from STEP with extrusion-spelled
walls; that is the whole story of the 58.

> This confirms, as a controlled experiment, what `FILLET_RIM_ATTRIBUTION.md` §2 had
> inferred from the two populations being different ("on the canonical synthetic prism the
> same comparison is exact to machine precision, which is what identifies the residual as
> OCCT's approximation"). That inference was right. It is now a measurement with both arms
> in one experiment and the geometry held fixed between them.

### The route through the corpus is closed by an OCCT crash

The same experiment run *on the corpus parts* — rewrite only their spelling with
`ShapeCustom::SweptToElementary`, then fillet — is not available:
**`ShapeCustom::SweptToElementary` SIGSEGVs on 58 of 58**
(`fillet_nearmiss_sweptcheck_58.jsonl`, every row `process_rc_139`), while working on a
synthetic box and on the synthetic prism above. It is given its own process (`--sweptcheck`)
for exactly that reason, and its crash is recorded as data rather than taking the row with
it. This is the fourth OCCT engine this programme has measured dying on this corpus.

---

## 6. The error against part size

An integration error scales with **what is integrated**; a geometric error scales with
**the operation**. Over the 58:

| | value |
|---|---|
| corr( \|dV\| , closed form — i.e. the blend ) | **0.9971** |
| corr( \|dV\| , part volume ) | 0.8873 |
| corr( \|dV\| , part diagonal ) | 0.7175 |
| \|dV\| / part volume | 2.158e-6 … 4.999e-6 (p50 3.015e-6) — a **2.32×** spread |
| \|dV\| / closed form | 6.497e-4 … 7.640e-4 (p50 7.211e-4) — a **1.18×** spread |

Normalising by the **operation** collapses the spread to ±8% of its median. Normalising
by the **part** does not. The error is a fixed fraction of the blend, not of the body it
is cut from — which is what a geometric difference in the blend looks like, and is not
what integration error looks like.

The two correlations are confounded (bigger parts get a bigger R, because `R = 0.05 ×
min extent`), which is why the ratio spreads above, not the correlations, carry the
argument.

---

## 7. What follows — and it is not a wider tolerance

**Nothing in this change touches a tolerance, and the recommendation is that nothing
should.** `close_`'s 1e-6 is doing its job: it is flagging 58 pairs that really are
different solids. Widening it to 1e-5 would buy a green on this row by agreeing to stop
seeing a 0.29%-of-R geometric difference — and the same widening would then also swallow
whatever the next family's real difference turns out to be.

The measurement improvement that *is* available goes the other way. The A/B compares the
**whole solid's** volume, so a difference localised in the blend is diluted by the ratio
of the blend to the body. Measured on these 58:

| | min | p50 | max |
|---|---|---|---|
| blend / part volume | 0.002896 | 0.004358 | 0.006885 |
| **dilution of the comparison** | **145×** | **230×** | **345×** |

So the harness's 1e-6 whole-part bound is, in the operation's own terms, a bound of
1.5e-4 to 3.5e-4 on what the operation actually produced. **Scoring the operation's own
output — `V_in − V_out`, which both arms can be compared on directly and which has no
dilution — makes the instrument roughly 230× sharper at the same nominal tolerance.**

Measured, on the same 311 valid pairs, `|ΔV_native − ΔV_occt| / max(|ΔV_native|, |ΔV_occt|)`:

| | min | p50 | max | crosses 1e-6 |
|---|---|---|---|---|
| the **58** the whole-part metric already flags | 6.50e-4 | 7.21e-4 | 7.64e-4 | **58 of 58** — by 650× to 764× |
| the **253** it passes | 0 | **1.65e-13** | **3.6e-12** | **0 of 253** |

The proposed metric returns **exactly the same verdict on every one of the 311 parts**,
with the flagged population sitting 650–764× over the bound instead of 2–5× and the
passing population sitting **six orders of magnitude under it** instead of one. It buys
no number and moves no part; it only stops throwing away 200× of the signal. It is stated
here rather than made here: the A/B comparator is shared by ten families and PR #224 is
already open against it.

Three things this measurement does **not** license:

1. **It does not make the native arm's coverage acceptable.** `FORGE_FILLET_DROP_NATIVE`
   still fails on coverage (403 vs 461), on validity (91 of the native arm's own 403
   answers are BRepCheck-invalid) and on replaceability. This settles one of four failing
   terms and leaves three.
2. **It does not say the native arm is right everywhere.** It says the native arm matches
   an independent closed form on **these 58**, whose rim is 4 lines and 4 arcs, all G1,
   all convex, all 90°. Nothing here measures any other shape.
3. **It does not say OCCT is broken.** A 7e-4 approximation of a blend is a defensible
   engineering choice inside a modeller's own tolerance budget. It is only a *difference*,
   and a drop gate's question is exactly whether two engines are interchangeable — which,
   on these 58, they are not.

---

## 8. Corrections to the record

* `reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md` §5 says the 2.2–5.0e-6 residual "is
  larger than the A/B comparator's **1e-9** tolerance". The comparator is
  `close_(a, b, scale) = |a−b| <= 1e-6 · max(1, |scale|)` — **1e-6 relative**, three
  orders of magnitude looser than stated, which is the difference between "obviously over
  the bound" and "2–5× over it". Corrected in this change, with the attribution upgraded
  from an inference to §5's controlled experiment.
* `FLIP_GATE_REPLACEABILITY_2026-09-03.md` §3.1's class name for this row, **"a numerical
  margin"**, is the reading this document refutes: the margin is numerical only in the
  sense that a geometric difference was measured with a number. The row's `agree` failure
  is the same *kind* of finding as FILLING's and THRUSECTIONS's — two engines that are not
  interchangeable — and unlike those two it is **not** a case where the difference is
  representational only. That document is on an open branch (PR #224) and is not edited
  here.

---

## 9. Limits, and one defect this probe had

1. **One derived operation per part** (`CORPUS_AB_COVERAGE.md` §5.1). The 58 exist
   because the pick rule takes the longest LINE edge and that edge lands on a G1 rim.
2. **The closed form applies to a 4-line/4-arc convex 90° rim.** All 58 are that shape.
   It is not a general fillet oracle and is not offered as one.
3. **The spelling experiment is one construction at one size.** It reproduces the
   phenomenon and its magnitude; it does not map how the magnitude varies with R, ρ or
   the wall depth.
4. **`blenddev_native` and `curvmiss_native` are 0 by construction.** The analytic
   reference is taken from the native answer's own patches, so those two columns are a
   consistency reading and are never cited as evidence. The evidence is the closed form
   (§4), which is read off the input.
5. **This probe's first 600-part run wrote 67 of 600 rows that a strict UTF-8 reader
   refuses** — a byte-wise `substr(0, 160)` cut an em-dash in an engine defer reason in
   half. `node` parsed them (it substitutes) and `python3` did not, so the defect survived
   a whole aggregation pass unnoticed. Fixed, pinned by control C6, and the driver now
   gates its own artefact: every run re-reads `results.jsonl` with a strict decoder and
   fails if the row count and the parse count disagree. The committed artefact reads
   `600/600 rows parse strictly`.

---

## 10. Artefacts and re-running

**Provenance.** Every number in this document comes from one 600-part run of the probe
built at `c5e14000` with **0 dirty files** under `src`/`include`/`test`, stride 1, 0
part-level failures, `600/600 rows parse strictly`. The run was also performed at an
earlier build of the same source and the aggregation is **byte-identical between the
two**; the per-part volumes are identical across both runs on 600/600 parts.

| what | where |
|---|---|
| the probe | `forge-kernel/test/fillet_nearmiss_probe.cpp` |
| build (runs the 6 controls, refuses a red binary) | `forge-kernel/test/build_fillet_nearmiss_probe.sh` |
| driver (process per part, tree guard, artefact gate) | `forge-kernel/test/run_fillet_nearmiss_probe.sh` |
| aggregator | `forge-kernel/test/fillet_nearmiss_aggregate.mjs` |
| the 600-part rows | `reports/corpus_ab/fillet_nearmiss_600_results.jsonl.gz` (+ `_manifest.json`) |
| the aggregated tables above | `reports/corpus_ab/fillet_nearmiss_summary.txt` |
| the controls' output | `reports/corpus_ab/fillet_nearmiss_probe_selftest.txt` |
| the spelling experiment | `reports/corpus_ab/fillet_nearmiss_spelling_experiment.txt` |
| `SweptToElementary` on the 58 | `reports/corpus_ab/fillet_nearmiss_sweptcheck_58.jsonl` |

```sh
cd forge-kernel
test/build_fillet_nearmiss_probe.sh                 # the 6 controls first
.build-corpus-ab/fillet_nearmiss_probe --spelling   # the controlled experiment, ~1s
SKIP_BUILD=1 test/run_fillet_nearmiss_probe.sh all <outdir>   # ~10 min for 600 parts
node test/fillet_nearmiss_aggregate.mjs <outdir>/results.jsonl
```
