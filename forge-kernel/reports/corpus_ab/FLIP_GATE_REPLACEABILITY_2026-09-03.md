# The flip gate was measuring coverage, not replaceability — and four families that passed do not

**Date:** 2026-09-03 · Measured from a worktree pinned to `origin/archdisc`.
BEFORE run built and measured at **`26db603e`** (build stamp `git_head` == HEAD at run,
0 dirty files under `src`/`include`/`test`); AFTER run at **`9f309b52`**, same corpus,
same stride-1 sample of all 600 gold reference solids, **0 part-level failures in both**.

> **No option was flipped and no ledger row moved.** All nine family
> `FORGE_*_DROP_*` options keep their defaults; `--assert-closure 14` and
> `--assert-direct 9` in `.github/workflows/kernel-tests.yml` are untouched. The whole
> diff is `test/`, `reports/`, one additive CI step and one additive comment block in
> `CMakeLists.txt`. No compiled kernel source changed, so the closure cannot have moved.

---

## 0. Headline

The per-family verdict that decides whether a native engine may replace OCCT was one
line:

```js
const pass = natOk >= occtOk;      // natOk  = both + nat only
                                   // occtOk = both + OCCT only
```

It counts **whether each arm returned a shape** and nothing else. Measured at HEAD over
all 600 parts:

- **Five of the ten drop options passed it.** Of those five, **four are not
  replaceable**: they return different geometry, a different orientation, or a different
  B-Rep representation on 100% of the parts they build.
- **THICKSOLID's bar of 132 OCCT answers contains 132 BRepCheck-INVALID solids** and
  therefore a valid bar of **zero**.
- **OFFSETSHAPE's bar of 38 contains 33 invalid ones.** Its valid bar is **5**, and the
  native arm — which produces 24 answers, all of them valid — reproduces **none of the
  5**, because it declines on exactly those parts.

Four terms were added: validity, agreement, replaceability, centroid sanity. The
coverage line is kept **verbatim** as term 1, so **the gate can only have got stricter**;
that direction is asserted in CI, not claimed. **Under the five terms, no drop option
passes.**

<!-- rows 7796, parts 600, part errors 0 -->

## 1. BEFORE and AFTER — the same 7,796 rows, aggregated twice

Both columns come from ONE corpus run. The BEFORE column is `corpus_ab_aggregate.mjs`
as it stands at `origin/archdisc` (`26db603e`), run over the identical JSONL; the AFTER
column is the same file with the four terms added. The denominators are not merely
comparable, they are the same numbers.

### T1 — verdict, BEFORE and AFTER, over the identical rows

| family | option | N | nat % | occt % | BEFORE verdict (coverage only) | AFTER verdict (five terms) | changed | failing terms |
|---|---|---:|---:|---:|---|---|---|---|
| **FILLET** | `FORGE_FILLET_DROP_NATIVE` | 600 | 67.2% | 76.8% | FAIL | **FAIL** | no | coverage, validity, agreement, replaceability |
| **MAKEOFFSET** | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 100.0% | 99.0% | PASS | **FAIL** | **YES** | agreement, replaceability |
| **THICKSOLID** | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 0.0% | 22.0% | FAIL | **FAIL** | no | coverage |
| **OFFSETSHAPE** | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 4.0% | 6.3% | FAIL | **FAIL** | no | coverage, replaceability |
| **THRUSECTIONS** | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 83.0% | 94.5% | FAIL | **FAIL** | no | coverage, validity, agreement, replaceability |
| **PIPE** | `FORGE_PIPE_DROP_NATIVE` | 600 | 100.0% | 100.0% | PASS | **FAIL** | **YES** | agreement, replaceability |
| **PIPESHELL** | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 100.0% | 100.0% | PASS | **FAIL** | **YES** | agreement, replaceability |
| **FILLING** | `FORGE_FILLING_DROP_NATIVE` | 600 | 67.8% | 67.8% | PASS | **FAIL** | **YES** | agreement, replaceability |
| **THICKEN** | `FORGE_THICKEN_DROP_NATIVE` | 600 | 100.0% | 100.0% | PASS | **FAIL** | **YES** | agreement, replaceability |
| **DRAFT** | `FORGE_DRAFT_DROP_NATIVE` | 565 | 0.0% | 88.0% | FAIL | **FAIL** | no | coverage, validity, replaceability |
| PIPESHELL_RC *(diagnostic)* | `?` | 600 | 100.0% | 99.7% | PASS | **FAIL** | **YES** | agreement, replaceability |
| PIPESHELL_XOR *(diagnostic)* | `?` | 598 | 3.3% | 98.0% | FAIL | **FAIL** | no | coverage, validity, agreement, replaceability |
| PIPESHELL_XOR_POS *(diagnostic)* | `?` | 598 | 0.0% | 0.0% | PASS | **PASS** | no | - |

6 of 13 rows changed status; 5 of the 10 real drop options.

## 2. Where the bar actually is

### T2 — the two bars, and the deficit

| family | OCCT ok | of which **INVALID** | **valid bar** | native ok | native ok+valid | replaced | **deficit** | native absent | native invalid | disagree | deficit rate (95% upper) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| FILLET | 461 | 6 | **455** | 403 | 312 | 253 | **202** | 53 | 91 | 58 | 44.4% (<= 48.4%) |
| MAKEOFFSET | 594 | 0 | **594** | 600 | 600 | 309 | **285** | 0 | 0 | 285 | 48.0% (<= 51.4%) |
| THICKSOLID | 132 | 132 | **0** | 0 | 0 | 0 | **0** | 0 | 0 | 0 | 0.0% (<= 100.0%) |
| OFFSETSHAPE | 38 | 33 | **5** | 24 | 24 | 0 | **5** | 5 | 0 | 0 | 100.0% (<= 100.0%) |
| THRUSECTIONS | 567 | 0 | **567** | 498 | 498 | 0 | **567** | 69 | 0 | 498 | 100.0% (<= 100.0%) |
| PIPE | 600 | 0 | **600** | 600 | 600 | 0 | **600** | 0 | 0 | 600 | 100.0% (<= 100.0%) |
| PIPESHELL | 600 | 0 | **600** | 600 | 600 | 0 | **600** | 0 | 0 | 600 | 100.0% (<= 100.0%) |
| FILLING | 407 | 0 | **407** | 407 | 407 | 0 | **407** | 0 | 0 | 407 | 100.0% (<= 100.0%) |
| THICKEN | 600 | 0 | **600** | 600 | 600 | 0 | **600** | 0 | 0 | 600 | 100.0% (<= 100.0%) |
| DRAFT | 497 | 52 | **445** | 0 | 0 | 0 | **445** | 445 | 0 | 0 | 100.0% (<= 100.0%) |
| PIPESHELL_RC | 598 | 31 | **567** | 600 | 600 | 309 | **258** | 0 | 0 | 258 | 45.5% (<= 49.0%) |
| PIPESHELL_XOR | 586 | 2 | **584** | 20 | 3 | 0 | **584** | 571 | 10 | 3 | 100.0% (<= 100.0%) |
| PIPESHELL_XOR_POS | 0 | 0 | **0** | 0 | 0 | 0 | **0** | 0 | 0 | 0 | 0.0% (<= 100.0%) |

## 3. What each failure is made of

### T3 — agreement: what the strengthened vector added

| family | both | agree (old vector) | agree_strict (+kinds) | caught by kinds alone | agree up to orientation | COM fingerprint nat/occt |
|---|---:|---:|---:|---:|---:|---:|
| FILLET | 402 | 253 | 253 | **0** | 253 | 0/0 |
| MAKEOFFSET | 594 | 309 | 309 | **0** | 309 | 0/0 |
| THICKSOLID | 0 | 0 | 0 | **0** | 0 | 0/0 |
| OFFSETSHAPE | 0 | 0 | 0 | **0** | 0 | 0/0 |
| THRUSECTIONS | 498 | 498 | 0 | **498** | 498 | 0/0 |
| PIPE | 600 | 0 | 0 | **0** | 0 | 0/0 |
| PIPESHELL | 600 | 0 | 0 | **0** | 0 | 0/0 |
| FILLING | 407 | 407 | 0 | **407** | 407 | 0/0 |
| THICKEN | 600 | 0 | 0 | **0** | 595 | 0/0 |
| DRAFT | 0 | 0 | 0 | **0** | 0 | 0/0 |
| PIPESHELL_RC | 598 | 325 | 309 | **16** | 325 | 0/0 |
| PIPESHELL_XOR | 14 | 0 | 0 | **0** | 0 | 0/0 |
| PIPESHELL_XOR_POS | 0 | 0 | 0 | **0** | 0 | 0/0 |

**T3's "caught by kinds alone" column is the value of the strengthened observable
vector, measured.** 498 THRUSECTIONS pairs and 407 FILLING pairs matched on volume,
area, centre of mass, all six bbox bounds AND every face/edge/vertex/shell/solid count,
and are different B-Rep. Nothing in the old vector could see it.

### 3.1 Five distinct failure classes, and they are not equally serious

The verdict is one bit; the causes are not. Measured per family over the pairs where
both arms return a valid shape:

| class | families | signature |
|---|---|---|
| **A different operation** | PIPE, PIPESHELL | native/OCCT volume ratio **min 1.071797, p50 1.071797, max 1.071798** on PIPE — a constant to six figures, and `2/(1+cos 30°) = 1.071797`. PIPESHELL spreads 1.055405–1.097498 about the same median. The A/B's spine turns 30°; native mitres the section through the corner and OCCT's default `BRepBuilderAPI_Transformed` does not. Face counts differ on 505/600 (PIPE). |
| **A different orientation** | THICKEN | signed volume ratio **exactly −1.000000** on all 600, area ratio exactly 1.000000, and **595 of 600 agree up to orientation**. This is one sign bit on the solid, not different geometry — and it is still a real difference, because a negatively-oriented solid is not interchangeable in a boolean. |
| **A different representation** | FILLING, THRUSECTIONS, PIPESHELL_RC | every scalar identical, the surface/curve KINDS not. FILLING: **407 of 407** pairs are native `Plane` vs OCCT `BSplineSurface` on the same single face with the same 4 line edges — `BRepOffsetAPI_MakeFilling` builds a GeomPlate spline where the native engine returns an exact plane. THRUSECTIONS: native `SurfaceOfExtrusion` + `Line` edges vs OCCT `Plane`/`Cylinder`/`BSpline` + `Bezier` (309 of 498 are exactly `E.Line 12→8 \| E.Bezier 0→4`). |
| **A different topological decomposition** | MAKEOFFSET | 285 of 285 valid-pair disagreements differ in EDGE COUNT with wire length ratio **p50 0.999956** (min 0.836197, max 1.002247). Mostly the same wire cut into different edges; a minority genuinely different. This class was already visible to the old vector. |
| **A numerical margin** | FILLET | the 58 valid-pair disagreements sit at volume ratio **0.999995–0.999998**, i.e. 2–5e-6 relative against the harness's 1e-6 bound. That is a tolerance question for the ledger owner. **This change does not widen it**, and no tolerance anywhere in the harness was touched. |

**On FILLING and THRUSECTIONS the native answer is arguably the better one** — an exact
plane is not worse than a spline approximation of it. The gate does not adjudicate which
arm is right; it says the two are not interchangeable, which is the only question a drop
asks. Both readings are available from one run: `agree` and `agree_strict` are reported
side by side, and the per-family detail names the kinds.

## 4. The three prior observations, reproduced at HEAD

Each of these was on record from a different piece of work — `CMakeLists.txt:262-270`
for H, `reports/corpus_ab/THICKSOLID_ATTRIBUTION.md` §4 for G,
`reports/TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md` for E/F. None of them had reached the
verdict. Re-measured here from one run, they reproduce:

| | on record | measured here | agrees |
|---|---|---|---|
| **H OFFSETSHAPE** | native 24/600 vs OCCT 38/600, 33 of the 38 BRepCheck-invalid | `occt_ok` **38**, `occt_ok_invalid` **33**, valid bar **5**; `native_ok` **24**, all 24 valid | ✅ exactly |
| **G THICKSOLID** | native 0/600 vs OCCT 133/600, all 133 invalid | `occt_ok` **132**, `occt_ok_invalid` **132**, valid bar **0**; `native_ok` 0. (133 in the BEFORE run — see §6) | ✅ |
| **E PIPE / F PIPESHELL** | coverage-passing, agree on 0 of 599, constant ratio 1.071797 | both 100.0% vs 100.0%, `both_ok` **600** (was 599), `agree` **0**, PIPE ratio constant 1.071797 — the same finding, now on the full 600 | ✅ exactly |

## 5. The added terms, and the proof that they can fail

Five terms; term 1 is the original line, verbatim:

| term | assertion | fires on |
|---|---|---|
| 1 coverage | `natOk >= occtOk` (**unchanged**) | FILLET, THICKSOLID, OFFSETSHAPE, THRUSECTIONS, DRAFT |
| 2 validity | native OK-and-valid >= OCCT OK-and-valid | FILLET, THRUSECTIONS, DRAFT |
| 3 agreement | 0 disagreeing pairs among parts where BOTH arms are valid | FILLET, MAKEOFFSET, THRUSECTIONS, PIPE, PIPESHELL, FILLING, THICKEN |
| 4 replaceability | 0 deficit against the VALID bar | every family except THICKSOLID (whose valid bar is 0) |
| 5 sanity | no native COM >1000x its own diagonal outside its own bbox | nothing on this corpus — see below |

**The valid bar is reported, never substituted.** Term 1 still measures against ALL of
OCCT's answers, invalid ones included, because dropping them would LOWER the bar and this
change is not permitted to lower anything. That is why THICKSOLID still reads
`FAIL (coverage)` even though its valid bar is zero: the corrected bar is printed beside
the coverage bar so the ledger owner can act on it deliberately.

**Proof the terms can fail, in both directions** — `test/corpus_ab_gate_selftest.mjs`,
38 checks, in CI, invoking the aggregator **as a subprocess** on real JSONL:

- **A1–A6**: a family that passes coverage and disagrees on every part (E/F's shape) —
  old gate `PASS`, new gate `FAIL (agreement, replaceability)`.
- **A7–A10**: the *same fixture* with agreement restored — `PASS`, no failing terms. A
  term stuck at FAIL is as useless as one stuck at PASS; only the pair distinguishes them.
- **A11–A13**: `agree=true, agree_strict=false` is scored as a disagreement — the gate
  reads the strict vector, and the loose column still reports the loose count.
- **B1–B7**: 10 BRepCheck-invalid OCCT answers — `occt_ok` **10**, `occt_ok_invalid`
  **10**, valid bar **0**, and the coverage verdict still `FAIL`. **Reported, not
  discarded, and the bar not lowered.**
- **B8–B13**: 10 OCCT answers of which 7 invalid, native reproducing exactly the 3 valid
  ones — valid bar 3, deficit 0, replaceability `PASS`, coverage still `FAIL` (3 < 10).
- **C1–C4**: a native arm that answers everywhere with an INVALID solid — old gate
  `PASS`, new gate `FAIL (validity, replaceability)`.
- **D1–D3**: a JSONL with no `agree_strict` falls back to `agree`, and every such row is
  counted and the table banners it. The fallback is never silent.
- **E1–E5 / E6–E8**: a COM of 1e33 on a 10 mm part fires term 5; a centroid one diagonal
  outside a VERTEX bbox does not (see §5.1).
- **M1**: over every fixture, `verdict == PASS` implies `coverage_only_verdict == PASS`.
- **R1/R2/R3 — mutations on REAL rows.** On the BEFORE run: FILLING passes, and breaking
  **one** real part's agreement flips it to `FAIL`. On both runs: repairing every
  offending real row of MAKEOFFSET (285 in the AFTER run) flips it to `PASS`. On the
  AFTER run R2 is **SKIPPED and says so** — no family passes, so there is no PASS to
  break.

`corpus_ab_coverage --selftest` gained matching C++ controls (27 checks, was 15): a box
and an analytic cylinder must land in different NAMED kind bins — a histogram that binned
everything as "Other" would make the comparison vacuously true — and two `ArmResult`s
identical in every scalar the old vector compares, with one face moved from the plane bin
to the B-spline bin, must be `agree == true` and `agree_strict == false`.

### 5.1 Term 5's threshold was measured, not chosen

The first version of term 5 simply asked whether the centre of mass was outside the
bounding box. **It fired on 12 of 61 real THICKEN rows and 1 of 45 real FILLING rows.**
Those are not defects: `bb` is VERTEX-derived (deliberately — `Bnd_Box` inflates by the
shape tolerance and would blur the very disagreement the vector exists to see), and a
curved face bulges past its own vertex hull. A full cylinder's only vertices lie on its
seam, so its vertex bbox is a **line** and its centroid is legitimately outside it. **A
term that reds a valid cylinder is not a stricter gate, it is a wrong one.** The gate
term is 1000× the shape's own diagonal — three orders clear of any curvature bulge and
~28 orders inside the 1e33-on-a-50 mm-part fingerprint this repo has hit twice with the
volume clean or exact. The tight count is kept as **reporting only**, under a name that
says so: on this corpus it reads 171/167 for THICKEN and 0/0 for the fingerprint.

## 6. What could not be measured, and one thing that measured itself

**The harness change is INERT on every pre-existing observable**, proved on the full
corpus rather than argued. The 600-part BEFORE and AFTER runs were diffed field by field
over all 7,796 common (part, family) rows:

```
identical on every pre-existing field   : 7781/7796
differ ONLY in a centre-of-mass component:   14
rows with any other difference          :    1
```

The 14 are the pre-existing `BRepGProp::VolumeProperties` summation-order noise in
THICKSOLID that `reports/corpus_ab/THICKSOLID_ATTRIBUTION.md` §1 already measured (y
centroid exactly zero, ~1e-15 against |com| ~1e2) — in an arm this change cannot reach.

**The one remaining row is OCCT crashing on the ground truth, intermittently.** On
`ho317`/THICKSOLID the OCCT arm returned `OK` (an invalid solid, volume 1292290.276) in
the BEFORE run and `CRASH, signal 11` in the AFTER run. That is **not** an effect of the
change, and it was measured rather than asserted: **the same AFTER binary run five times
on ho317 returns `OK` five times out of five.** `MakeThickSolidByJoin` SIGSEGVs
intermittently on this part, the harness's fork containment caught it exactly as
designed, and it is the whole of the difference between THICKSOLID's `occt_ok` of 133
(BEFORE) and 132 (AFTER). **Family G's coverage bar is not even stable run to run.**

**What this cannot answer.**

- **Which arm is right** where they differ in representation (FILLING, THRUSECTIONS).
  The A/B has no oracle for that; it has two engines. Settling it needs a closed form or
  a third implementation, per family.
- **Whether FILLET's 58 pairs at 2–5e-6 are a defect or a tolerance.** Deciding it means
  moving `close_`'s 1e-6, which this change deliberately does not touch.
- **The 5 OFFSETSHAPE parts in the valid deficit.** The native arm declines on exactly
  the parts where OCCT is valid, and this run does not say why. `NativeThickSolid`'s defer
  channel would attribute them; that is a separate measurement.
- **Whether ho317's SIGSEGV is one part or a class.** One part was re-run five times; the
  other 599 were not. Quantifying OCCT's flake rate needs repeat runs of the whole corpus.

## 7. Reproducing

```sh
# the gate's own controls — no build, ~2s
node forge-kernel/test/corpus_ab_gate_selftest.mjs
node forge-kernel/test/corpus_ab_gate_selftest.mjs --corpus <results.jsonl>

# the harness controls — 27 checks
forge-kernel/test/build_corpus_ab_coverage.sh      # runs --selftest as part of the build

# the corpus (about 45 min for 600 parts on this machine)
forge-kernel/test/run_corpus_ab_coverage.sh all <outdir>

# the same rows under the OLD gate, for a BEFORE column
git show 26db603e:forge-kernel/test/corpus_ab_aggregate.mjs > /tmp/agg_old.mjs
node /tmp/agg_old.mjs <outdir>/results.jsonl --md before.md
```

## 8. A caution paid for here

The BEFORE run's driver aborted *after* its 600th part with
`syntax error near unexpected token` — because this file's author edited
`run_corpus_ab_coverage.sh` while bash was still executing it, and bash reads a script
incrementally by byte offset. The 600 parts and 7,796 rows were already complete and
were produced by the clean-tree binary; the tail's two tree checks were re-run by hand
(build stamp `git_head` == HEAD == `26db603e`, unchanged across the run) and the
aggregation was done separately. **Do not edit a shell script that is running.**
