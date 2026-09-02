# The curve-entity gap is 548 models, and only 190 of them can be recovered exactly

Measured 2026-09-01 over the **same 9,846 non-empty OnShape FeatureScript trees / 492,223
sketch entities** that `ABC_TRANSLATION_YIELD_REMEASURED.md` scored
(`data/external/abc_ofs/abc_0000_ofs_v00.7z`).

Tools, both new:

- `implementation/sacrosanct/tools/abc_curve_entity_census.py` — what is in there, and how
  many models each candidate representation unblocks.
- `implementation/sacrosanct/tools/abc_curve_reconstruct_verify.py` — whether each candidate
  representation actually reproduces the curve.

**Positive control, asserted at startup and PASSING:** the census reproduces the yield
census's arm 1 exactly — 9,846 models, 5,629 clearing both gates, 882 geometry-gated. It
aborts rather than report an unpaired number. That is what licenses every figure below
against the prior round.

---

## 1. The census: what is actually in there

492,223 sketch entities. **9,315 of them (1.892%) are splines, ellipses or conics** — the
four `typeName`s the IR refuses.

| type | instances | models containing | construction |
|---|---|---|---|
| `BTCurveGeometrySpline` (NURBS) | 6,555 | 335 | 253 |
| `BTCurveGeometryInterpolatedSpline` | 2,145 | 603 | 21 |
| `BTCurveGeometryEllipse` | 612 | 138 | 46 |
| `BTCurveGeometryConic` | **3** | 2 | 0 |

For scale, what the IR *can* state today: 334,104 lines and 109,542 circles, of which
**48,111 are circular arcs** — bounded curved segments that arm 1 can only reach by POLY
tessellation, because SCIRC/SARC are in `forbidden_ops`.

### By degree — the B-spline is small, low-degree and almost never rational

| degree | instances | share | rational | closed | trimmed | ctrl pts min/med/max |
|---|---|---|---|---|---|---|
| 1 | 121 | 1.85% | 0 | 0 | 5 | 2 / 2 / 2 |
| 2 | 12 | 0.18% | 9 | 0 | 4 | 3 / 61 / 1537 |
| **3** | **6,422** | **97.97%** | 143 | 294 | 783 | 4 / 4 / 1132 |

**Nothing above degree 3 exists in the corpus.** Only 152 of 6,555 (2.3%) are rational, and
only 792 (12.1%) are trimmed to less than their own knot domain. The median cubic has **four
control points** — a single Bézier span.

### By interpolation-point count — and the split that matters

| points | 2 | 3 | 4 | 5 | 6 | 7 | 8+ |
|---|---|---|---|---|---|---|---|
| instances | **511** | 578 | 345 | 200 | 101 | 113 | 297 |
| share | **23.82%** | 26.95% | 16.08% | 9.32% | 4.71% | 5.27% | 13.85% |

The spec is complete and uniform on all 2,145: every instance carries both end derivatives
and both Bézier handles.

### Ellipses and conics

612 ellipses — **263 full, 349 elliptical arcs**, 4 degenerate (the two radii equal, i.e. a
circle wearing an ellipse's clothes). The field set is identical on all 612: centre, major
direction, two radii, orientation. **Three conics exist in the entire corpus**, all
parabolas.

---

## 2. Three encoding facts that a reader gets wrong by default

These were measured, and each one silently corrupts geometry if assumed the other way.

1. **Weights are inline, at stride 3.** There is no `weights` field. When `isRational` is
   true, `controlPoints` is a flat run of `(x, y, w)` triples; when false, of `(x, y)`
   pairs. No exception in 6,555 instances. A reader that assumes stride 2 reads weights as
   coordinates — the negative control below shows what that costs.
2. **`isPeriodic` does not mean an OCCT-periodic curve.** The knot vector always satisfies
   the *non*-periodic relation `#knots == #ctrlpts + degree + 1` (**6,555 / 6,555**). A
   closed instance is shipped as a clamped B-spline whose first and last poles coincide.
   Passing `periodic=true` to OCCT asks for a different pole count and it refuses — that was
   17.5% of splines failing to build until it was corrected.
3. **A full circle carries no parameter range at all.** 61,431 circles are closed and store
   no `startParam`/`endParam`; 48,111 carry an arc range. A "full iff startParam ==
   endParam" test calls almost every full circle an arc.

---

## 3. Does the proposed representation actually reproduce the curve?

The census says how many models a representation unblocks. It says nothing about whether it
unblocks them *as the right shape*. That is measured separately, and it is the measurement
that decides which stage may be called exact.

**The instrument — endpoint coincidence.** A sketch profile is a closed chain: each
segment's endpoint is shared with its neighbour's, and the two are stored *independently* (a
line as point + direction + arc-length range, a spline as control points + knots). So "does
my rebuilt spline end where the adjoining line begins" is a real question, and not a
tautology — nothing in the line's record was used to build the spline.

**Lines and circles are the positive control.** They are exactly representable today, so
their coincidence rate is this corpus's own connectivity baseline — how often sketches close
at all. A type that matches that baseline is being read correctly.

| type | rebuilt | endpoints | within 1 nm | rate | |
|---|---|---|---|---|---|
| `Line` | 334,104 / 334,104 | 663,022 | 581,775 | **87.75%** | ← positive control |
| `Circle` | 109,536 / 109,542 | 96,030 | 89,873 | **93.59%** | ← positive control |
| `Spline` | **6,555 / 6,555** | 12,812 | 12,247 | **95.59%** | above baseline |
| `Conic` | 3 / 3 | 4 | 4 | 100.00% | n = 4 |
| `Ellipse` | 612 / 612 | 698 | 608 | 87.11% | at baseline |
| `InterpolatedSpline` | 2,137 / 2,145 | 3,588 | 2,822 | **78.65%** | **below baseline** |

**Negative control — can the instrument see a wrong read?** Rational splines re-read at the
wrong stride move **112 / 112** endpoints, median **0.389 m**. With weights forced to 1,
**94 / 112** move, median 2.75 mm. The instrument detects a wrong read at a scale four to
eight orders of magnitude above the tolerance, so the passes above are evidence and not
insensitivity.

### The interpolated spline is the one that is lossy, and here is the proof

Reconstructed as the standard C2 cubic interpolant through the shipped points with the
shipped end derivatives, it:

- passes through **every one of its 10,229 interpolation points** — max error 1.8e-14 m;
- matches the shipped end-tangent **direction** on **3,834 / 3,834** — max 2.6e-8 rad;
- reproduces the shipped Bézier **handle** on **0 / 3,834** — median error **4.57 mm**.

Right points, right end directions, **wrong interior parameterisation**. Its endpoint
coincidence (78.65%) sits 9 points *below* the line baseline, which corroborates it through
a second, independent instrument.

**But the split is not uniform, and this is the most useful thing measured.** Checking the
handle identity against the raw data with no OCCT in the loop:

| | handle == P ± derivative/3 | handle == P ± derivative/(3(n−1)) |
|---|---|---|
| **2-point (511)** | **511 / 511 exact** (max 4.4e-16 m) | 511 / 511 exact |
| n > 2 (1,634) | 0 / 1,634 | 53 / 1,634 (3.2%) |

**A 2-point interpolated spline is exactly a cubic Bézier** — control polygon
`[P₀, P₀+d₀/3, P₁−d₁/3, P₁]`, fully determined by data already in the file, no
reconstruction. That is 23.8% of interpolated splines, recoverable *exactly*. Everything
with 3 or more points matches no uniform parameterisation and is a genuine approximation.

---

## 4. The proposed representation

**Two native entities, and one labelled reconstruction.**

### `SBSP` — a 2D NURBS curve entity (exact)

`degree, control_points[(x,y)], weights[]?, knots[], closed, trim[t0,t1]?`

Justified by the measurement, not by generality:

- It is a **copy, not a conversion**, for all 6,555 B-splines: every field is already in the
  file and OCCT accepts all 6,555 as-is.
- It **subsumes the conic in closed form**: a conic is a rational quadratic Bézier — 3
  poles, knots `[0,1]` with multiplicities `[3,3]`, weights `[1, ρ/(1−ρ), 1]`. No separate
  conic op is worth building for **3 instances**.
- It subsumes the 2-point interpolated spline in closed form, as above.
- The corpus bounds it hard: **degree ≤ 3**, 97.97% cubic, 2.3% rational, median 4 control
  points. This is not a general NURBS engine; it is a small, bounded entity.

### `SELLIPSE` — ellipse / elliptical arc (exact)

`centre, major_dir, major_r, minor_r, ccw, trim[θ0,θ1]?`

An ellipse *could* be a rational NURBS, but the corpus ships it as six scalars in a uniform
field set on all 612 instances, and it round-trips to `Geom2d_Ellipse` exactly. Encoding six
scalars as a nine-pole rational spline would make the IR less legible to Archie and no more
capable. **349 of 612 are arcs, so the trim is required, not optional.**

### The n>2 interpolated spline — reconstructed, and **labelled**

It must not be passed off as exact, because it measurably is not. Two admissible forms:

- `SBSP` carrying `approx: {from: "interpolated_spline", basis: "C2 cubic, chord-length",
  measured_handle_dev_m: <value>}`, or
- an `SINTERP` entity that stores Onshape's own inputs (points, derivatives, handles) and
  defers the choice of interpolant to the kernel.

The second is preferable: it stores what was actually given rather than one particular
reconstruction of it, so a later, better interpolant is a kernel change and not a corpus
re-translation. **Either way the lossy flag is mandatory** — silent approximation is the one
outcome worse than the current refusal.

**The construction-curve shortcut is NOT proposed.** Dropping curve entities marked
`isConstruction` would recover +9 models with no new IR, but its reference control **failed**
— zero of 452,961 curve entityIds are named by any feature parameter, so the instrument
cannot distinguish a referenced construction curve from an unreferenced one. +9 is not worth
shipping on an instrument that did not verify.

---

## 5. Measured recovery per stage

Baseline is arm 1 (46 emittable ops): **5,629 of 9,846 clear both gates**. Every row is
obtained by **re-running the model-level gate** with exactly that stage's types made
representable — never by summing instance counts.

| stage | | clear | cumulative | **marginal** |
|---|---|---|---|---|
| baseline (arm 1) | | 5,629 | — | — |
| **S1** ellipse / elliptical arc | EXACT | 5,692 | +63 | **+63** |
| **S2** + conic | EXACT | 5,694 | +65 | **+2** |
| **S3** + NURBS spline | EXACT | 5,767 | +138 | **+73** |
| **S4a** + 2-point interpolated spline | EXACT | 5,819 | +190 | **+52** |
| **S4b** + n>2 interpolated spline | **LOSSY** | 6,177 | **+548** | **+358** |

### Only 34.7% of the prize can be taken exactly

**S1–S4a recover +190 models with nothing labelled lossy. The remaining +358 (65.3%)
requires a representation that is measurably an approximation.** That is the central finding,
and it was not visible before this round: the yield census's "+548" is one number covering
two very different kinds of work.

### Why the stages must be measured jointly, and never summed

Each type alone, measured singly:

| alone | Spline | InterpolatedSpline | Ellipse | Conic | **sum** | **measured jointly** |
|---|---|---|---|---|---|---|
| models recovered | +63 | +302 | +63 | +2 | **+430** | **+548** |

The sum of singles **under-counts by 118 models (27%)**, because those models are gated by
two curve types at once and unlock only when both land. This is the same effect that made
the 34 not-yet-implemented ops sum to 594 against 634 measured jointly — and it errs in the
same direction here.

---

## 6. Scope, honestly

This branch ships the **census and the fidelity measurement**, not the implementation. No IR
schema, kernel op or emitter is changed; `archie_op_vocabulary.json` is untouched.

Against the standard set for this round — a candidate fix was killed last round when
measurement showed it recovered 2 of 55 — the honest statement of what these stages buy:

- **S1 + S3 + S4a: +188 models, all exact, and all three are closed-form reads of data
  already in the file.** No approximation, no interpolation algorithm, no new numerical code.
- **S2 (conic) recovers 2 models from 3 instances** and should be built only because `SBSP`
  gets it for free, never as its own entity. On its own it is exactly the kind of item that
  fails the bar.
- **S4b is the majority of the prize (+358) and the only lossy stage.** It is worth doing,
  and it is worth doing *labelled*.

Ceiling context: the yield census puts the all-ops-plus-all-curves ceiling at 6,957 of 9,846
(70.66%). Curve entities are 548 of the 1,328 models between today and that ceiling — still
the largest single item, and now resolved into an exact 190 and a lossy 358.

**LICENCE.** Corpus provenance stays UNVERIFIED per `MODEL_DATA.md`. These are capability
counts, not a training licence, and nothing here changes that.
