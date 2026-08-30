# First corpus A/B coverage numbers: closure 11 is NOT shippable

**Measured 2026-08-29 on a 20-part STRIDE sample (stride 30, offset 0) of the 600 gold
reference solids.** Stride, not prefix: that corpus is sorted hardest-first and this
programme has already measured a prefix reading 0.2423 where the full set read 0.3617.

The twelve `FORGE_*_DROP_*` options all name the same flip condition -- "native success
rate >= the measured OCCT baseline". Until now nothing measured it. These are the first
numbers.

## Per family, never aggregated

| family | native arm | OCCT arm | valid native/OCCT | deletion bucket |
|---|---|---|---|---|
| **PIPE** | **DEFER 20** | OK 20 | **0 / 20** | **20 of 20** |
| **DRAFT** | **DEFER 19** | OK 17, THREW 2 | **0 / 16** | **19 of 19** |
| PIPESHELL | OK 15, DEFER 5 | OK 20 | 15 / 20 | 5, **and 15 DISAGREE** |
| THICKEN | OK 17, DEFER 3 | OK 20 | 17 / 20 | 3, 17 agree only up to orientation |
| FILLING | OK 17, DEFER 3 | OK 17, **THREW 3** | 17 / 17 | **0** — 17/17 agree fully |

## What this says

**PIPE and DRAFT defer on EVERY applicable part.** With their OCCT fallback compiled out
a defer becomes a thrown error, so turning those two options on deletes the capability
outright on this corpus. Neither is close to its own flip condition.

**PIPESHELL is worse than a defer on 15 parts: it DISAGREES.** A defer refuses loudly and
the caller knows. A disagreement returns a different solid and nobody is told. That is the
more dangerous of the two failure modes and it is the larger bucket for this family.

**FILLING is the one family that passes its own flip gate today** — 17 of 17 agree on the
full observable vector, and OCCT actually THREW on 3 parts where the native engine
deferred honestly, so native is not merely equal there.

**So the closure 14 -> 11 result stands as a BUILD fact and falls as a SHIP fact.** The
three toolkits do leave the closure, the tree builds, and the seven correctness A/Bs pass
— but correctness on hand-built cases was never the question. Coverage was, and on real
parts two of the five measured families have none.

## Caveats, stated rather than buried

* **n = 20 of 600**, and the full 600 x all-families run is in flight as this is written. This is a stride sample sized to answer "is there a problem at all",
  and it answers that. It is NOT the committed baseline; the full 600 run is the next step
  and the harness supports `run_corpus_ab_coverage.sh all`.
* **Five of the twelve families are covered here**, not all ten the harness implements —
  this run exercised PIPE, PIPESHELL, FILLING, THICKEN and DRAFT.
* ~~The build predates the canonize merge.~~ **RESOLVED BY MEASUREMENT, same night.**
  Rebuilt at HEAD `67507174` (canonize present, verified in the header) and re-ran both
  disagreement families. The numbers are IDENTICAL: THICKEN OK 17 / DEFER 3, 17 agree up
  to orientation, 17 disagree; PIPESHELL OK 15 / DEFER 5, 15 disagree. So the disagreement
  is NOT a `SurfaceOfLinearExtrusion` artifact and the rows above are quotable as they
  stand. Raw log: `post80_thicken_pipeshell.log`.
* The operations are DERIVED from each part's own geometry by the harness, not taken from
  real user workflows, so this measures engine coverage on plausible inputs rather than
  observed demand.

## CORRECTION (same night, before the full run landed)

**The first version of this document reported FIVE families. The harness measured TEN, and
had already computed the verdict, the delta, a 95% CI and an exact McNemar p for every one
of them.** I hand-read five per-family detail blocks off the tail of the log and never read
the summary table the aggregator printed at the top. Nothing was wrong with the harness;
the reporting was wrong, and this is the same failure mode this programme keeps tripping
over -- an artifact that misreports what it did.

What the complete table changes:

* **THREE families are total capability loss, not two.** THRUSECTIONS is 0.0% vs 100.0%,
  exactly like PIPE and DRAFT, and I had omitted it entirely.
* **TWO families pass, not one** -- and only one of those passes meaningfully. See below.
* **MAKEOFFSET is the nearest miss at 95.0% vs 100.0%**, a single part (ho876) from
  parity, and I had not reported it at all.

### The complete measured table

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| FILLET | `FORGE_FILLET_DROP_NATIVE` | 20 | 8 | 1 | **9** | 2 | 45.0% | 85.0% | -40.0% [-65.6, -14.4] | 0.0215 | FAIL |
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 20 | 19 | 0 | **1** | 0 | 95.0% | 100.0% | -5.0% [-14.6, 4.6] | 1.0000 | FAIL |
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 20 | 1 | 0 | **7** | 12 | 5.0% | 40.0% | -35.0% [-55.9, -14.1] | 0.0156 | FAIL |
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 20 | 0 | 1 | **1** | 18 | 5.0% | 5.0% | 0.0% [-13.9, 13.9] | 1.0000 | PASS (CI straddles 0) |
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 20 | 0 | 0 | **20** | 0 | 0.0% | 100.0% | -100.0% [-100.0, -100.0] | 1.9e-6 | FAIL |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 20 | 0 | 0 | **20** | 0 | 0.0% | 100.0% | -100.0% [-100.0, -100.0] | 1.9e-6 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 20 | 15 | 0 | **5** | 0 | 75.0% | 100.0% | -25.0% [-44.0, -6.0] | 0.0625 | FAIL |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 20 | 17 | 0 | **0** | 3 | 85.0% | 85.0% | 0.0% [0.0, 0.0] | 1.0000 | PASS (CI straddles 0) |
| THICKEN | `FORGE_THICKEN_DROP_NATIVE` | 20 | 17 | 0 | **3** | 0 | 85.0% | 100.0% | -15.0% [-30.6, 0.6] | 0.2500 | FAIL |
| DRAFT | `FORGE_DRAFT_DROP_NATIVE` | 19 | 0 | 0 | **17** | 2 | 0.0% | 89.5% | -89.5% [-103.3, -75.7] | 1.5e-5 | FAIL |

The verdict rule is the gate's own words: **PASS iff native % >= occt %**. `(CI straddles
0)` is printed only alongside a PASS, as an explicit underpowered warning -- "not
significantly worse" is not "not worse". So MAKEOFFSET at 95% < 100% is correctly FAIL even
though its CI includes +4.6.

### One of the two passes is degenerate, and the distinction matters

**FILLING passes on merit**: 85% vs 85%, 17 of 17 agreeing on the full observable vector,
and OCCT THREW on 3 parts where native deferred honestly.

**OFFSETSHAPE passes because BOTH arms are broken**: native `DEFER:19 OK:1`, OCCT
`DEFER:15 CRASH:3 OK:1 THREW:1`, and BRepCheck valid results are **native 1, OCCT 0**. The
OCCT arm produces zero valid solids and segfaults three times. Native is not good there --
it is merely no worse than an arm that does not work. That is not a quality argument for
the drop, but it IS a real observation that the OCCT dependency buys nothing for this
family.

### OCCT is not the dependable reference arm this ladder assumes

23 contained OCCT crashes were recorded tonight across these runs, **every one the
identical stack**: `BRepOffset_MakeOffset` -> `BRepOffset_Inter2d::ConnexIntByInt` ->
`BRep_Tool::CurveOnSurface`, faulting at 0x60. One reproducible upstream defect, hit
repeatedly on real parts, in the toolkit these native engines exist to replace.

## Two refinements the re-measure bought

**THICKEN and PIPESHELL disagree in DIFFERENT WAYS, and only one is deep.** THICKEN's 17
disagreements all agree on `|volume|` and fail only the full observable vector — the solid
is the right size and differs in signed orientation. That is a concrete normal/orientation
defect with a bounded fix. PIPESHELL's 15 disagreements agree on NEITHER: 0 match even up
to `|volume|`, so the native engine is building different geometry, not the same geometry
wound the other way. PIPESHELL is the harder problem and should not be planned as if it
were THICKEN.

**OCCT itself SIGSEGVs on real parts, and the containment caught it.** One crash report
this session is `BRepOffset_Inter2d::ConnexIntByInt` -> `BRep_Tool::CurveOnSurface`
faulting at address 0x60 inside `libTKOffset` — the very toolkit the native engines would
replace — contained in its forked child and recorded as CRASH for that arm only. A second
report is the harness's OWN deliberate SIGSEGV from `--selftest`, which is the positive
control for that containment. The distinction matters for reading the table above:
`ARM_CRASH` is a separate status from `ARM_DEFER`, set on `WIFSIGNALED`, and the self-test
asserts that a deliberate segfault comes back as CRASH and never as a defer. So PIPE's
`DEFER 20` is twenty honest declines, not twenty crashes filed under a softer name.

## The next measurement, named

Re-run at HEAD (post-#80) across the full 600 and all ten families, and commit that as the
baseline. Until then the honest status of the OCCT drop is: **the ladder is real, one step
is demonstrated to build, and it must not be shipped.**
