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
