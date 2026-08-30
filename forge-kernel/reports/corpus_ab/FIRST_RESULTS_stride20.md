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
* **The build predates the canonize merge.** This worktree branched from
  `kernel/corpus-ab-harness`, which forked before PR #80 restored `MakePrism`'s Canonize
  semantics to `occtPrism`. THICKEN's "17 agree up to orientation, 17 disagree on the full
  vector" may move once that fix is in the tree, so THICKEN's disagreement row in
  particular should be re-measured post-#80 before it is quoted.
* The operations are DERIVED from each part's own geometry by the harness, not taken from
  real user workflows, so this measures engine coverage on plausible inputs rather than
  observed demand.

## The next measurement, named

Re-run at HEAD (post-#80) across the full 600 and all ten families, and commit that as the
baseline. Until then the honest status of the OCCT drop is: **the ladder is real, one step
is demonstrated to build, and it must not be shipped.**
