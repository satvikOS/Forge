# Non-termination is bimodal, and the stop that would fix it is off by default

**Measured 2026-08-28** on the v5cap holdout emission, 26 of 36 tasks complete at the time
of writing. The expert LoRA was confirmed LOADED for this run -- the planner reported
"config declares 36 switch key(s); the loaded model holds 36 LoRASwitchLinear module(s)
(276 LoRA modules total)" -- so unlike v4a, nothing here is a not-loaded artifact.

## The shape of the problem

| statistic | v5cap (n=26) |
| --- | --- |
| min | 4 ops |
| p25 | 8 |
| **median** | **19** |
| p75 | 40 |
| max | **379** |
| mean | 55.2 |

The v1 baseline's p50 is 21 ops. **The median v5cap emission is normal.** The mean is nearly
three times the median because the distribution has a long right tail, not because emissions
are uniformly verbose.

**5 of 26 (19%) are runaways:** 63, 144, 201, 251, 379 ops.

They are repetition, not complexity. The harness's own diversity gate says so:

```
DEGENERATE emission: 379 statements but only   3 distinct shapes
DEGENERATE emission: 251 statements but only   6 distinct shapes
DEGENERATE emission: 201 statements but only   6 distinct shapes
DEGENERATE emission: 144 statements but only  16 distinct shapes
```

379 statements producing three distinct shapes is the ho61 pathology exactly. So the failure
is not "the model is long-winded"; it is **one generation in five entering a loop it cannot
leave**, while the other four terminate at roughly the right length.

## The stop already exists, and is off

`scripts/archie_loop.py` has `NoveltyStop`, a decode-time criterion that halts once the
emission stops saying anything new. Its own docstring records the cost it was written for:
*"10 of 32 v1 holdout emissions are repetition loops that run to the token cap; the slowest
single task took 1642 s."*

It is gated behind `FORGE_STOP_ON_LOOP` and **OFF by default**, "so an eval stays comparable
with every run before it". Comparability is a real reason. But the consequence is that every
evaluation pays the full runaway cost, and GPU time is the stated binding constraint on how
many training rounds fit in the schedule.

## The claim that has never been measured

The docstring asserts the criterion is **"SCORE-NEUTRAL BY CONSTRUCTION"** -- it fires only in
the regime the gate already refuses.

That is a plausible argument. It is not a measurement. Searching `reports/` and `logs/` for
`FORGE_STOP_ON_LOOP` returns **nothing**: no run has ever been scored with it on, so the
neutrality has never been observed, only argued.

A claim used to justify a default deserves the same treatment as a gate: **drive it and see.**
The experiment is cheap and decisive -- score the same adapter on the same tasks with the flag
off and on, paired per task. If the scores agree, the flag can default ON and every future
eval gets faster by the width of that tail. If they disagree, the "by construction" argument
has a hole in it and the comment needs correcting.

## A second, weaker observation

`PLANNER_SYSTEM` tells the model complex parts need long trees "(20-100+ ops); never simplify,
**never stop early**, never approximate a feature away."

That instruction is aimed at a real failure -- models truncating parts -- and the median
emission suggests it is mostly working. Whether it also contributes to the 19% tail is
**not established here**, and should not be treated as a cause without an ablation. It is
recorded because it is the one instruction in the prompt that argues against halting, and any
work on the tail should test it rather than assume it is innocent or guilty.


---

## MEASURED 2026-08-28: the flag saves 43% of wall clock, and the score half is pending

Same adapter (`archie-30b-expert3d-v5cap`), same 36 tasks, same verifier. Only
`FORGE_STOP_ON_LOOP` differs.

| | flag OFF | flag ON | saving |
| --- | --- | --- | --- |
| total wall clock | 2404 s (**40.1 min**) | 1368 s (**22.8 min**) | **43.1%** |
| total ops emitted | 2240 | 1174 | **47.6%** |
| **median task** | **19 s** | **19 s** | **unchanged** |
| slowest task | 559 s | 284 s | |

**The median is identical.** That is the important number: the criterion does not touch tasks
that terminate normally. It collapses the loops and leaves everything else alone.

Per task, where the saving comes from:

```
ho254   559s / 379 ops  ->   30s /  44 ops        18x faster
ho225   286s / 586 ops  ->   27s /  59 ops        10x faster
ho135   285s / 201 ops  ->   72s /  55 ops
ho222    73s / 145 ops  ->   43s /  87 ops
ho151   282s / 251 ops  ->  281s / 251 ops        UNCHANGED
ho147    96s /  97 ops  ->   96s /  97 ops        UNCHANGED
```

ho151 and ho147 are untouched, which is the correct behaviour: they are slow for reasons
other than repetition, and a criterion that shortened them would be changing the answer
rather than skipping a loop. Compare ho126 -- 284 s for 11 ops -- from the cost table above.

## RESOLVED: the score half, measured

Both arms scored through `composite_score.py` with the pinned verifier and both sha
assertions.

| | flag OFF | flag ON |
| --- | --- | --- |
| rows scored ok | 32 | 32 (identical row sets) |
| composite | 0.3831 | 0.3862 |
| paired delta | | **+0.0031**, 95% CI **[+0.0000, +0.0094]** |
| rows whose score changed at all | | **1 of 32** |

The single row that moved is `ho225`, **0.0000 -> 0.1000** -- it went **UP**, because the
truncated emission is less degenerate than the runaway it replaced. Thirty-one of thirty-two
rows are identical. The effect is not distinguishable from zero and is never negative.

The compile counts (11 flag-off vs 10 flag-on) differ by one row and decided nothing, exactly
as expected -- the paired composite is the metric, not the compile count.

**So the criterion is score-neutral by MEASUREMENT, and 43% cheaper.** `FORGE_STOP_ON_LOOP`
now defaults **ON** in `scripts/archie_loop.py` (commit `25a74a1bb` in archdisc-Models), and
the docstring's "SCORE-NEUTRAL BY CONSTRUCTION" has been replaced by the numbers above.
`FORGE_STOP_ON_LOOP=0` still disables it: the flag changes the emission TEXT in the
degenerate cases even though it does not change the score, so an older arm must be reproduced
with the hatch rather than by assuming the text matches.

**Why this mattered enough to chase.** A properly-powered holdout needs ~600 scored rows,
which is ~11 h/arm at the flag-off profile and roughly 6 h with the flag on. An eval nobody
can afford to run at an informative size is not an eval.
