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

* **n = 20 of 600.** This is a stride sample sized to answer "is there a problem at all",
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
