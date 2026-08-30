# The committed baseline: 600 parts, all ten families

**FULL_RC=0. parts: 600, rows: 6000, part-level errors: 0.** Stride 1 — every part in the
gold reference corpus, not a sample. This supersedes the 20-part stride result for every
purpose; that document is kept only for the record of how it was reached.

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| FILLET | `FORGE_FILLET_DROP_NATIVE` | 600 | 146 | 51 | **315** | 88 | 32.8% | 76.8% | -44.0% [-49.2, -38.8] | 1.4e-47 | FAIL |
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 567 | 0 | **27** | 6 | 94.5% | 99.0% | -4.5% [-6.2, -2.8] | 1.5e-8 | FAIL |
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 7 | 0 | **126** | 467 | 1.2% | 22.2% | -21.0% [-24.3, -17.7] | 2.4e-38 | FAIL |
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 0 | 7 | **38** | 555 | 1.2% | 6.3% | -5.2% [-7.3, -3.0] | 3.1e-6 | FAIL |
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 0 | 0 | **567** | 33 | 0.0% | 94.5% | -94.5% [-96.3, -92.7] | 4.1e-171 | FAIL |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 600 | 2 | 0 | **598** | 0 | 0.3% | 100.0% | -99.7% [-100.1, -99.2] | 1.9e-180 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 309 | 0 | **291** | 0 | 51.5% | 100.0% | -48.5% [-52.5, -44.5] | 5.0e-88 | FAIL |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 600 | 407 | 0 | **0** | 193 | 67.8% | 67.8% | 0.0% [0.0, 0.0] | 1.0000 | PASS (CI straddles 0) |
| THICKEN | `FORGE_THICKEN_DROP_NATIVE` | 600 | 407 | 0 | **193** | 0 | 67.8% | 100.0% | -32.2% [-35.9, -28.4] | 1.6e-58 | FAIL |
| DRAFT | `FORGE_DRAFT_DROP_NATIVE` | 565 | 0 | 0 | **497** | 68 | 0.0% | 88.0% | -88.0% [-90.6, -85.3] | 4.9e-150 | FAIL |

## Exactly ONE family earns its flip

**FILLING passes: 67.8% vs 67.8%, delta 0.0 [0.0, 0.0], p=1.0000, and a deletion bucket of
ZERO across 600 parts.** 407 both / 0 native-only / 0 OCCT-only / 193 neither. On six
hundred real parts the native filling engine never once declined where OCCT succeeded. That
is the only family in this table whose drop deletes no capability.

## The n=20 sample had a SECOND pass and it was an artifact

OFFSETSHAPE read 5.0% vs 5.0%, PASS, at n=20. At n=600 it reads **1.2% vs 6.3%, delta
-5.2% [-7.3, -3.0], p=3.1e-6 — a decisive FAIL.** The aggregator had flagged that very row
`(CI straddles 0)`, printed only alongside a PASS, precisely because "not significantly
worse" is not "not worse". **The underpowered warning was right and the sample was wrong.**
This is the second time this programme has been saved by refusing to read an underpowered
result as an answer, and the first time the guard fired on a result I had already written
into a document.

## Where native genuinely beats OCCT

`nat only` is the column that vindicates the native work, and it is not empty:

* **FILLET: 51 parts** where the native engine produced an acceptable result and OCCT did
  not — against 315 the other way, but 51 is not noise at n=600.
* **OFFSETSHAPE: 7 parts**, on a family where OCCT itself manages only 6.3%.

## Two disagreement families, diagnosed to root cause

Measured from the per-part observable vectors, not inferred:

**THICKEN's disagreement is almost entirely an ORIENTATION CONVENTION, and native is the
conventionally correct arm.** Of 17 both-OK parts in the sampled run, **16 are a pure sign
flip**: identical face/edge/vertex counts, identical area to 5 decimal places, identical
centre of mass, identical bounding box — and volume `+114690.606` native versus
`-114690.606` OCCT. A negative `BRepGProp::VolumeProperties` volume means the solid's faces
point inward, so it is OCCT returning the reversed solid. Only one part (ho876) differs for
real, and only in COM.

**PIPESHELL's disagreement is a SYSTEMATIC DIRECTION ERROR, and it is native's.** All 15
both-OK parts differ in volume, area, COM and bbox — but the volume ratio is
**1.07051 with sd 0.00327**, and 8 of the 15 land on exactly 1.07180. A ratio that tight
across differently shaped parts is one convention error, not per-part geometry noise.
Native builds the larger shell, consistent with thickening OUTWARD where OCCT thickens
INWARD; for a shell of radius R and wall t that predicts a ratio (2R+t)/(2R-t), constant
whenever the harness derives t proportionally, and 1.0718 implies t/R = 0.069.

So the two families were never one problem. THICKEN needs no geometric fix at all, and
PIPESHELL has a single named, testable hypothesis with a bounded fix.

## Verdict, unchanged and now properly powered

**Closure 14 -> 11 is a BUILD result, not a SHIP result.** Nine of ten families lose real
capability, three of them nearly all of it (PIPE 0.3%, THRUSECTIONS 0.0%, DRAFT 0.0%
against OCCT's 100%, 94.5% and 88.0%). FILLING alone is shippable on this evidence.

## INDEPENDENT REPLICATION

This baseline was produced TWICE, by two separately written harness drivers, in different
worktrees, at different build SHAs, hours apart. The per-family rates are **identical in
all ten rows** — same N, same native %, same OCCT % — across 6000 paired trials:

| family | N | native % | OCCT % |
|---|---:|---:|---:|
| DRAFT | 565 | 0.0 | 88.0 |
| FILLET | 600 | 32.8 | 76.8 |
| FILLING | 600 | 67.8 | 67.8 |
| MAKEOFFSET | 600 | 94.5 | 99.0 |
| OFFSETSHAPE | 600 | 1.2 | 6.3 |
| PIPE | 600 | 0.3 | 100.0 |
| PIPESHELL | 600 | 51.5 | 100.0 |
| THICKEN | 600 | 67.8 | 100.0 |
| THICKSOLID | 600 | 1.2 | 22.2 |
| THRUSECTIONS | 600 | 0.0 | 94.5 |

Both runs also independently reached the SAME two non-coverage findings, including the
same part and the same numbers to three decimals: OCCT's thicken returning a negatively
oriented solid (native `+114690.606` vs OCCT `-114690.606`), and PIPESHELL disagreeing
geometrically on every shared success rather than on an edge-case subset.

## What the second run adds that mine could not

**Ten per-family native POSITIVE CONTROLS, 10/10 OK.** Each engine was fed an input its own
header documents as in scope, on a box the native ruled loft builds itself. This is the
check that makes the native-0% families (PIPE, DRAFT, THRUSECTIONS) believable as ENGINE
results rather than a mis-wired arm — the exact question I flagged as open when the first
zeros appeared, and could not answer from my own run.

**The OCCT arm's own failures are counted, and they are large.** OCCT's OFFSETSHAPE arm
CRASHED on **66 of 600** parts and MAKEOFFSET's arm TIMED OUT on 5. That is the source of
the 23 contained crash reports observed on this machine, all one stack
(`BRepOffset_MakeOffset` -> `BRepOffset_Inter2d::ConnexIntByInt` ->
`BRep_Tool::CurveOnSurface` at 0x60).

**Reproducibility is proved, not asserted**: re-running the aggregator over the committed
`results.jsonl.gz` reproduces the committed `summary.md` byte for byte.

**A guard that could not fire was found and fixed.** The first build-SHA-vs-HEAD guard was
tested and found INERT — a poisoned stamp still exited 0, because the driver rebuilds and
re-stamps on the line above it. Fixed in `4645fd2f`, and both guards are now proved to fire
(exit 3 and exit 4) rather than assumed to. That is the same defect class as the four
harnesses that could not link: a check that cannot fail looks exactly like a check that
passes.

**A first full-corpus run was DISCARDED** because it was compiled at `876b179a` and measured
after the tree moved to `a70dd1da`, where three of the ten engines under test differ. Its
numbers are not reported anywhere.

## A live PRODUCTION consequence, not just a test observation

`Features.cpp` registers OCCT's thicken result unmodified:

    return ShapeRegistry::instance().add(mk.Shape());

Given that `mk.Shape()` is negatively oriented on all 407 shared successes, **`part::thickenSurface`
hands the ShapeRegistry a reversed solid today**, on the default (non-native) path. That is
a defect in shipping behaviour, found by a coverage harness that was not looking for it.
Recorded here; the fix is not made in this PR because the correct remedy (reverse the solid
vs. leave the convention to consumers) depends on what downstream consumers assume, and
that has not been measured.

## Two of twelve options remain unmeasured, with the reason stated

`FORGE_SHHEAL_DROP_NATIVE` and `FORGE_GEOM_DROP_NATIVE` are NOT measured. Both already
default ON and both replace low-level routines called from inside other ops (ValueOfUV,
curve projection, free bounds, ShapeFix_Solid; the R1/R2/R3 geom primitives), so there is
no "native declined where OCCT would have built it" event to count. Scoped out explicitly
rather than silently skipped.
