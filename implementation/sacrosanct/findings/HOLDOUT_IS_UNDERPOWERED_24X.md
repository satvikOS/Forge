# v5cap: the collapse is undone, and the holdout cannot answer the question

**Measured 2026-08-28.** Emission and scoring both reproduced by the commands in
`reports/V4A_REEMIT_HONEST_NUMBER.md`, with the PINNED verifier and both sha assertions
(`--require-verifier-sha 45e9ad9a...`, `--require-kernel-sha 20fe6e74...`).

The expert LoRA was **confirmed loaded** this time -- the planner reported "config declares
36 switch key(s); the loaded model holds 36 LoRASwitchLinear module(s) (276 LoRA modules
total)". v4a's 0-of-72 not-loaded artifact is not in play here, so every number below is real.

## Paired, on the 25 rows every arm scored

| arm | composite | vs box floor |
| --- | --- | --- |
| box floor | 0.3270 | -- |
| expert3d-v1 (frozen) | 0.3555 | +0.0286 |
| v4a RE-EMIT | 0.2904 | **-0.0366** |
| **v5cap** | **0.3576** | **+0.0306** |

**v5cap undoes the v4a regression.** v4a sat *below* a box; v5cap is back at v1's level.

**v5cap does not beat v1.** The gap is **+0.0020**.

## Nothing here is significant, and that is the finding

Paired bootstrap, 20k resamples, n=25:

| comparison | effect | 95% CI | verdict |
| --- | --- | --- | --- |
| v5cap - v1 | +0.0020 | [-0.1194, +0.1313] | not significant |
| v5cap - box floor | +0.0306 | [-0.0725, +0.1373] | not significant |
| v1 - box floor | +0.0286 | [-0.0635, +0.1252] | not significant |
| v5cap - v4a | +0.0672 | [-0.0326, +0.1713] | not significant |

Every interval is roughly **+-0.12 wide** while every effect is **under 0.07**. The noise is
larger than everything being measured, including "is the model better than a box".

## What it would actually take

Per-row composite SD is **0.23 to 0.33** -- rows score 0.000 and 1.000, so the variance is
enormous relative to the differences. Required n for 80% power at the OBSERVED effects:

| comparison | effect | SD of paired diff | n needed | n available |
| --- | --- | --- | --- | --- |
| v5cap - box floor | +0.0306 | 0.2730 | **625** | 25 |
| v1 - box floor | +0.0286 | 0.2459 | **581** | 25 |
| v5cap - v1 | +0.0020 | 0.3253 | **>100,000** | 25 |

**The holdout is underpowered by roughly 24x for the question it is being asked.** Every arm
comparison this programme has run at n ~ 25-26 has been in this regime. "Does the model beat
a box" is not a question this holdout can answer at these effect sizes -- not with a better
adapter, not with more training, not ever, without changing the measurement.

Three ways out, and only three:

1. **Enlarge the evaluation set to ~600 scored rows.** Direct, expensive, and the only route
   that keeps the current effect size meaningful.
2. **Find a larger effect.** A +0.03 gain on a 0-1 scale is not worth 600 rows to prove; an
   adapter that moved the composite by 0.15 would need ~25.
3. **Cut per-row variance.** SD 0.28 comes from rows scoring exactly 0.000 and exactly 1.000.
   A metric or a task set with less all-or-nothing behaviour buys power for free.

Until one of those happens, **no adapter comparison on this holdout should be reported as a
win or a loss.** Both directions are noise.

## A separate observation: compile rate and composite are not aligned

v5cap compiled **11 of 36**; v4a RE-EMIT compiled **23 of 36**. v5cap nevertheless scores
**higher** paired (0.3576 vs 0.2904). Compiling more is not the same as building the right
part, and a compile-rate improvement should never be quoted as a quality improvement.


## What a properly-powered run would cost, and why the tail decides it

Measured wall clock for the 36-task v5cap emission (flag-off): **40.1 minutes**, median task
**19 s**, slowest task **559 s**.

| id | seconds | ops |
| --- | --- | --- |
| ho254 | 559 | 379 |
| ho225 | 286 | 586 |
| ho135 | 285 | 201 |
| ho126 | 284 | 11 |
| ho151 | 282 | 251 |

**The five slowest tasks are 71% of the total wall clock** (28.3 of 40.1 min). The median task
is 19 seconds; the distribution is the same bimodal shape as the op counts.

Extrapolated at this profile, the ~600 scored rows the power calculation demands cost roughly
**11 hours per arm** -- and an arm comparison needs at least two. That is what makes the
honest experiment unaffordable today, and it is the same tail described in
`NON_TERMINATION_IS_BIMODAL.md`.

So the two findings are one problem: **the runaway tail is not merely wasteful, it is the
thing standing between this programme and a measurement that can answer its own question.**
`NoveltyStop` exists, is off by default, and its neutrality has never been measured. If it is
neutral, the tail collapses and a 600-row eval becomes a few hours instead of eleven. That is
why the flag experiment is now the gating item for the whole MODEL track, above any further
adapter.

(ho126 is worth noting as a counter-example: 284 s for only 11 ops. Not every slow task is a
repetition loop, so the tail will not vanish entirely -- part of it is slow kernel work.)
