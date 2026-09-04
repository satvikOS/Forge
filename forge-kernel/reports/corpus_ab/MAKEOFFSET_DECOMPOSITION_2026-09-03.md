# MAKEOFFSET's "different decomposition" is two classes, and neither is an edge partition

**Date:** 2026-09-03. Measured from a worktree pinned to `origin/archdisc`.
BEFORE run built and measured at **`ac0ca610`** (build stamp `git_head` == HEAD at run,
0 dirty files under `src`/`include`/`test`); AFTER run at **`483378aa`**. Same corpus both
times: `archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps`, stride
1, **all 600 parts, 0 part-level failures in both**. OCCT 7.x from
`/opt/homebrew/opt/opencascade`.

> **No option was flipped and no ledger row moved.** All nine family `FORGE_*_DROP_*`
> options keep their defaults; `--assert-closure 14` and `--assert-direct 9` are
> untouched; nothing under `src/` or `include/` changed. The whole diff is ONE file,
> `forge-kernel/test/corpus_ab_coverage.cpp`. No compiled kernel source changed, so the
> closure cannot have moved. `agree()` is byte-for-byte the function it was, so no
> verdict term was relaxed.

---

## 0. Headline

On record (`reports/corpus_ab/FLIP_GATE_REPLACEABILITY_2026-09-03.md` §3.1): family A's
285 disagreeing pairs "differ in EDGE COUNT with wire length ratio p50 0.999956 … Mostly
the same wire cut into different edges; a minority genuinely different."

Read at the source and measured as curves, that is not what they are.

1. **It is not an edge partition of one curve.** The native arm returned **105,843 edges
   over 600 parts and every single one is a `GeomAbs_Line`**; OCCT returned 4,437
   `OffsetCurve` + 2,103 `Line` + 1,044 `Circle`. `PolygonOffset2D` has no curve type at
   all — `Loop2{std::vector<Point2>}` in, `Loop2` out — so there is no partition to
   compare. The native answer is a **polyline tessellation**.
2. **38 of the 285 are an offset in the OPPOSITE DIRECTION** — a different operation, the
   PIPE/PIPESHELL class, not a decomposition one. Two-sided Hausdorff **3.06–10.75 mm**
   (p50 5.16), against a maximum of **9.72e-3 mm** across every same-direction pair: a
   separation of **315x**. All 38 are the parts whose largest planar face has a **single
   full circle** as its outer wire.
3. **The remaining 247 were measuring the HARNESS's own sampler, not the engine.** The
   arm sampled curved edges at a FIXED 24 points per edge where the shipped
   `tryNativeInwardOffset` samples to a chord deflection of `kSampleDeflection/16 =
   3.125e-3 mm`. Corrected to the shipped budget: **agreement 309/594 -> 324/594**, and
   the same-direction Hausdorff falls from **max 0.616 mm (81 of 247 outside the
   consumer's own 0.05 mm)** to **max 9.72e-3 mm (0 of 232 outside)**.
4. **A curve-level agreement term would not rescue this family.** At the consumer's own
   0.05 mm it reads 556/594, and **0 of the 38 pass at any tolerance that admits the
   232**. The recommendation below is therefore NOT to relax the comparison.
5. The direction observable's own control, run for the first time, went red and was right
   to: `src/Cam.cpp:295-296` offsets a CW-presenting wire **OUTWARD** under a function
   named `inwardOffset`. Pinned, not fixed — §6.

---

## 1. BEFORE and AFTER, same 600 parts, same denominator

Quoted from each run's own `summary.md`.

| | BEFORE (`ac0ca610`) | AFTER (`483378aa`) |
|---|---|---|
| native arm | `OK:600` | `OK:600` |
| OCCT arm | `OK:594 TIMEOUT:5 DEFER:1` | `OK:594 TIMEOUT:5 DEFER:1` |
| BRepCheck_Analyzer valid | native 600, OCCT 594 | native 600, OCCT 594 |
| **inside `both` (594)** | **309 agree, 285 disagree** | **324 agree, 270 disagree** |
| of the disagreements: opposite direction | 38 | **38** (identical set, part for part) |
| of the disagreements: same direction | 247 | **232** |
| coverage verdict (`natOk >= occtOk`) | PASS (600 >= 594) | PASS (600 >= 594) |

**+15 agree, 0 lost**; the agreeing set BEFORE is a strict subset of the set AFTER.

## 2. What the 285 actually are

### T1 — the three classes, AFTER, over the 594 both-OK pairs

| class | n | two-sided Hausdorff (mm) | hd / part diagonal (p50) | native edges (p50/max) | OCCT edges (p50/max) | `enc_area` nat/occt (p50) | source outer wire |
|---|---:|---|---:|---:|---:|---:|---|
| agree | 324 | 0 – 1.7e-13 | 7.6e-17 | 4 / 48 | 4 / 48 | 1.000000 | 309 all-`Line`, 15 `BSpline:48` |
| same direction, disagree | 232 | 1.07e-3 – **9.72e-3** (p50 3.02e-3) | 1.3e-5 | 260 / 1372 | 16 / 125 | 0.999999 | all curved |
| **opposite direction** | **38** | **3.06 – 10.75** (p50 5.16) | 2.5e-2 | 256 / 512 | **1 / 1** | **0.706536** | **`Circle:1`, all 38** |

Hausdorff is two-sided (native vertices -> OCCT wire AND OCCT sampled points -> native
polyline), computed from both arms' answers sampled by ONE instrument
(`GCPnts_QuasiUniformDeflection`) at ONE budget (1e-5 x part diagonal) in ONE frame (the
face's own plane), dumped by the `FORGE_MO_DUMP` hook this change adds.

### 2.1 The opposite-direction class, and which arm is wrong

All 38 parts' largest planar face has a **single full circular edge** as its outer wire.
Worked example, `ho211` (`d = 3.07577`, part diagonal 242.45):

```
source circle radius  R0 = 35.2000
OCCT   BRepOffsetAPI_MakeOffset(w, Arc).Perform(-d)  ->  1 Circle edge, radius 38.2758 = R0 + d   (GREW)
native PolygonOffset2D                               -> 24-gon, circumradius 32.0977 = R0 - d/cos(pi/24)  (SHRANK)
```

32.0977 is the inward offset of the inscribed 24-gon to 6 significant figures, so the
native answer is exactly right *as a polygon*; the disagreement is the sign. Measured over
the whole corpus with the new `enc_area` column: **native offsets inward on 594 of 594;
OCCT offsets inward on 556 of 594.**

The intent is not ambiguous. The op is labelled `inward wire offset`, the shipped function
is named `forge::cam::inwardOffset`, and `src/Cam.cpp:242-246` states the divergence
deliberately: *"OCCT's path negates (off.Perform(-offsetMm)) which moves INWARD for a CCW
wire … so we sign |offsetMm| by the loop's own orientation to ALWAYS move inward … matching
OCCT's inward intent regardless of the wire's winding."* On a lone closed circle OCCT's
sign follows the edge's parametric direction, and on these 38 faces that runs the other
way. **On this class the native arm is the one honouring the contract.** That is still a
behavioural difference a drop would ship, and it belongs in the ledger as one — it is not
a decomposition difference and must not be counted as one.

### 2.2 The same-direction class, and why 81 of it was the instrument

`corpus_ab_coverage.cpp`'s banner claimed **one** departure from the shipped
`tryNativeInwardOffset` ("working in the face's own plane frame instead of projecting to
XY"). There were two. The second was the input sampler:

```
harness  const int N = (ad.GetType() == GeomAbs_Line) ? 1 : 24;     // fixed COUNT
shipped  sampleWireXY(wire, kOffsetInputDeflection)                 // fixed DEFLECTION
         kOffsetInputDeflection = kSampleDeflection/16 = 3.125e-3 mm   (src/Cam.cpp:96-103)
```

A fixed count is wrong in **both** directions, and both were measured:

* **too coarse on a large arc.** 24 chords on a 40 mm-radius circle is a sagitta of
  0.34 mm — 110x the shipped budget and 7x the 0.05 mm the only two consumers
  (`Cam.cpp:485` `profile()`, `Cam.cpp:587` `pocket()`) already spend re-sampling the
  result. **81 of the 247** same-direction disagreements sat outside that 0.05 mm.
* **too fine on a near-straight spline.** 15 parts whose outer wire is `BSpline:48` were
  cut into 1116–1132 edges by the fixed count. At the deflection budget each of those
  splines needs 2 points, the native answer is 48 line edges, OCCT's is 48 offset-curve
  edges, and every scalar matches to 1e-13. **Those 15 are the whole of the +15 agree.**

### T2 — same-direction Hausdorff, BEFORE vs AFTER

| | BEFORE (24 samples/edge) | AFTER (3.125e-3 mm) |
|---|---|---|
| n (same-direction disagreements) | 247 | 232 |
| min / p50 / p90 / max (mm) | 8.0e-14 / 6.96e-3 / 1.57e-1 / **6.16e-1** | 1.07e-3 / 3.02e-3 / 6.33e-3 / **9.72e-3** |
| within the consumer's own 0.05 mm | 166 / 247 | **232 / 232** |
| within the shipped 3.125e-3 mm budget | 21 / 247 | 135 / 232 |
| **outside 0.05 mm** | **81 / 247** | **0 / 232** |
| over ALL 556 same-direction pairs: max | 6.16e-1 mm | **9.72e-3 mm**, 556/556 within 0.05 mm |

## 3. The question asked: (a), (b) or (c)?

**Not (a) — "same geometry, different edge partition".** 105,843 native edges, 105,843
of them `Line`. `PolygonOffset2D::offsetLoop` takes `std::vector<Point2>` and returns
`std::vector<Point2>`; `nativeInwardOffset` turns that back into topology with
`BRepBuilderAPI_MakePolygon`, which can only make line edges. There is no curve on the
native side to partition differently. What is true is the weaker claim: on 232 of the 270
the two wires **coincide to 9.72e-3 mm or better**, which is agreement to a *stated
tolerance*, not identity.

**Not (b) — "a missing merge/join step OCCT performs".** There is nothing to merge. No
join, weld or unify step can recover a circle from 512 chords; the missing thing is a
*curve* offset (a circle offsets to a circle, a line to a line, a spline to an
`OffsetCurve` — which is exactly the 4,437 `Offset` + 1,044 `Circle` edges OCCT returned),
and that is a capability `PolygonOffset2D` does not have and is not architected to have.

**(c), twice, at two magnitudes.** 38 parts are an offset in the opposite direction
(3.06–10.75 mm apart), and there the *OCCT* arm is the one that departs from the stated
intent. 232 parts are a tessellation whose error is bounded by, and now measured inside,
the budget the caller itself spends — 9.72e-3 mm worst case against the consumer's own
0.05 mm.

## 4. Should the gate compare geometry instead of edge count for this family? No.

The case for it is real and is worth stating, because it is the strongest argument
available: **the exact geometry of this family's result is never used.** Both consumers
of `forge::cam::inwardOffset` immediately call `sampleWireXY(w, kSampleDeflection)` and
only the 0.05 mm polyline reaches the toolpath (`src/Cam.cpp:200-212` argues exactly
this). Edge count is invisible to them.

**It still must not be adopted as the verdict term, and the numbers are why.**

### T3 — what a curve-level term would score, at every tolerance the evidence supports

| tolerance | curve-agree / 594 | of the 38 opposite-direction, how many pass |
|---|---:|---:|
| 1e-3 mm | 324 | **0** |
| 3.125e-3 mm (the shipped input budget) | 459 | **0** |
| 9.72e-3 mm (the measured same-direction max) | 556 | **0** |
| 0.05 mm (the consumer's own tolerance) | 556 | **0** |

1. **It cannot make the family pass.** Every tolerance that admits the 232 rejects all 38
   by a factor of at least 315. Term 3 (agreement) and term 4 (replaceability) would still
   fail. Adopting it would move a reported number and change no verdict.
2. **It would be a comparison to a tolerance, and the tolerance is not zero.** The two
   wires are provably 9.72e-3 mm apart at worst — not the same curve. Relaxing a
   comparison is only legitimate when you can prove the two describe the same curve, and
   this evidence proves the opposite: they describe curves that are close.
3. **The one thing it would legitimately buy is reporting**, and that is available without
   touching the verdict: report a curve-distance column beside the exact vector, with its
   tolerance NAMED and DERIVED from the consumer (0.05 mm), exactly as
   `FLIP_GATE_REPLACEABILITY` reports `agree` beside `agree_strict`. If the ledger owner
   wants that column it should be added that way. This change does not add it, because a
   number that changes no verdict should not be introduced in the same change that
   corrects an instrument.

**What this change does instead** is add the observable that was actually missing: a
direction. `enc_area` is the net area a wire-only result encloses, and it turns a class
that took a 16 MB dump and a numpy script to see into one column — verified against that
dump, part for part (`set(opp) == set(opp_from_dump)`, n=38, and `enc_area` reproduces the
dump-derived areas to 4.5e-10 relative).

## 5. Evidence, and the proof each piece is inert

* **The dump hook is inert.** 600-part runs diffed field by field: with `FORGE_MO_DUMP`
  UNSET, **0 of 600 rows differ** from the `ac0ca610` baseline; with it SET, **0 of 600
  rows differ**. (`AFTER600_nodump` and `AFTER600_dump` vs `BEFORE600`.)
* **`enc_area` is inert on every pre-existing field.** The final run vs the sampler-only
  run, compared on every field with `enc_area` and the extended `op` string stripped:
  **0 of 600 rows differ**. `agree()` was not touched.
* **The direction observable is proved in BOTH directions**, in `--selftest`, in the
  build script, so a corpus number cannot be produced by a binary whose observable is
  stuck: source square 100, inward 64 (`< 100`), outward 143.137 (`> 100`), and a
  not-vacuous check that the two differ by more than 1. 20 checks, 0 red.
* **The pin fires both ways.** With the tree as committed the CW-frame check reads
  143.138; with the proposed one-line fix applied as a mutation it reads 64 and the pin
  goes RED. The mutant was restored from a **backup file**, not `git checkout --`, and
  `cmp` confirms byte-identity.
* **One row is not reproducible run to run, and it is OCCT's.** `ho45`'s OCCT arm came
  back `DEFER` in one run and `TIMEOUT` ("killed after 20s") in another. Both are non-OK,
  so `occt_ok` is 594 in every run and no count or verdict moves. `ho45` is already on
  record as one of the 6 parts OCCT cannot do inside 20 s
  (`MAKEOFFSET_PARITY_2026-08-30.md` §6).

## 6. A defect this found and did NOT fix

`src/Cam.cpp:295-296`:

```cpp
// Sign |offsetMm| to move INWARD regardless of the wire's winding (see above).
const double signedDist = loop.isCCW() ? -offsetMm : offsetMm;
```

`PolygonOffset2D::offsetLoop`'s `d` is **not** winding-relative, so that rule is backwards
for a CW loop. Measured directly, 12 lines against the engine alone, on a 10 mm square:

```
CCW  d=-1  -> |area|  64.00000  SHRANK        CW  d=+1  -> |area| 143.13761  GREW
CCW  d=+1  -> |area| 143.13761  GREW          CW  d=-1  -> |area|  64.00000  SHRANK
```

The header's *"a CW hole is the mirror"* does not describe the code: both windings shrink
on `d<0` and grow on `d>0`. A wire that presents CW therefore offsets **outward** under a
function named `inwardOffset`, and the one-line fix is to drop the `loop.isCCW() ?`.

**The corpus cannot see it.** All 594 outer wires present CCW in their face's plane frame,
so the branch is never taken over 600 parts — this is a case where the A/B is blind by
construction and only a control reached it. It is PINNED rather than fixed because the fix
is a behaviour change to the shipped kernel on the `FORGE_OFFSET_DROP_MAKEOFFSET` seam,
`test/native/geom/polygonoffset2d_test.cpp` has no CW case to gate it, and a measurement
change must not carry a kernel behaviour change with it. **When the pin goes red the
defect has been fixed**; the check says so and says what to replace it with.

## 7. What this does not answer

* **Whether the 38 should be counted against the native arm at all.** The native honours
  the documented intent and OCCT does not; the gate says "not interchangeable", which is
  true, but the ledger owner has to decide whether a drop that *corrects* the direction on
  38 parts is a regression or a fix. This measurement cannot decide it.
* **Whether the 232 matter to any consumer other than CAM.** The 0.05 mm argument is
  specific to `profile()` and `pocket()`. If `inwardOffset`'s result ever reaches a
  consumer that keeps the exact wire, the argument does not transfer.
* **Whether OCCT's `ho45` boundary flake is one part or a class.** One part, two runs.
  Quantifying it needs repeat runs of the whole corpus.
* **Whether the CW defect is reachable from a shipped call path.** `resolveFace` can
  return a face by id whose plane frame is inverted; this was not driven end to end, and
  saying it is reachable would be a claim, not a measurement.

## 8. Reproducing

```sh
# the harness's own controls, including the direction observable, 20 checks
forge-kernel/test/build_corpus_ab_coverage.sh          # runs --selftest as part of the build

# the corpus (~4 min for 600 parts, MAKEOFFSET only, on this machine)
FAMILIES=MAKEOFFSET forge-kernel/test/run_corpus_ab_coverage.sh all <outdir>

# the curve dump the Hausdorff numbers come from (stderr -> <outdir>/run.log, ~16 MB)
FORGE_MO_DUMP=1 FAMILIES=MAKEOFFSET forge-kernel/test/run_corpus_ab_coverage.sh all <outdir>

# the CW sign defect, against the engine alone
clang++ -std=c++20 -O2 -I forge-kernel/include \
    forge-kernel/test/polygonoffset2d_winding_probe.cpp \
    forge-kernel/src/native/geom/PolygonOffset2D.cpp \
    forge-kernel/src/native/Predicates.cpp \
    forge-kernel/src/native/geom/Geom.cpp -o /tmp/winding && /tmp/winding
```
