# v5cap beats the bounding-box floor, and it wins on interface while losing on shape

> **SUPERSEDED 2026-08-29 -- see `THREE_ARM_FINAL_600.md`.** Below is the INTERIM
> read (paired n=579, sensitivity n=598). Final, paired on the 570 rows all THREE
> arms scored: v5cap-box **+0.0431** [+0.0260,+0.0602]; sensitivity **+0.0336**
> [+0.0172,+0.0505] at n=600. The component story is unchanged and sharper: v5cap
> wins interface 0.2376 vs 0.0000 and topology 0.4103 vs 0.3357, and loses shape
> 0.2568 vs 0.4239. Final refusals: box 2 (0.33%), v5cap 20 (3.33%).


**FINAL, 2026-08-29. Both arms complete: 5/5 shards each, 600 rows presented per
arm.** (The interim figures below, taken at 347 and 464 rows, are kept because their
stability is itself evidence.)

## FINAL NUMBERS

    PAIRED on the 579 rows both arms scored:

      box     composite 0.2364    shape 0.4225
      v5cap   composite 0.2769    shape 0.2543

      v5cap - box  +0.0406   95% CI [+0.0238, +0.0580]   EXCLUDES 0

    Component split:
      shape       box 0.4225   v5cap 0.2543   -0.1683
      interface   box 0.0000   v5cap 0.2349   +0.2349
      topology    box 0.3367   v5cap 0.4063   +0.0696

    SENSITIVITY, v5cap's 19 candidate-side refusals charged as 0.0 (n=598):
      box 0.2344   v5cap 0.2681   diff +0.0337
      95% CI [+0.0170, +0.0508]   STILL EXCLUDES 0

    Refusals: box 2/600 (0.33%), v5cap 20/600 (3.33%).

**The estimate was stable the whole way up**, which is what a real effect looks like:

    n=347  +0.0367  [+0.0151, +0.0592]   width 0.0441
    n=464  +0.0359  [+0.0169, +0.0556]   width 0.0387
    n=579  +0.0406  [+0.0238, +0.0580]   width 0.0342

---

*(Original interim write-up follows; its conclusions are unchanged.)*

## The headline

    PAIRED on the 347 rows both arms scored:

      box     composite 0.2367
      v5cap   composite 0.2734

      v5cap - box  +0.0367   95% CI [+0.0151, +0.0592]   EXCLUDES 0

**This is the question the enlargement was built to answer.** At n=25 the paired CI
was about +-0.12 and every effect was under 0.07, so "does the adapter beat a box"
was unanswerable. It is now answered, and the answer is yes.

## And it survives being charged for its own failures

The refusal policy is not arm-neutral: only the model arm can emit a candidate that
defeats the kernel, and `composite_score` REFUSES those rows rather than scoring them
0. That flatters v5cap. Charging all 13 candidate-side refusals as 0.0:

      box 0.2346   v5cap 0.2636   diff +0.0289
      95% CI [+0.0072, +0.0512]   n=360   STILL EXCLUDES 0

So the result is not an artifact of the scoring convention. Report both figures
together; the gap between them, 0.0367 vs 0.0289, is the size of the thumb.

## The component split is the actual finding

    component      box      v5cap      diff
    shape       0.4231     0.2522   -0.1709
    interface   0.0000     0.2307   +0.2307
    topology    0.3372     0.4013   +0.0641
    composite   0.2367     0.2734   +0.0367

**v5cap wins entirely on INTERFACE, and loses badly on SHAPE.**

A bounding box is a genuinely decent shape approximation of these parts -- they are
mostly blocky envelopes, so filling the envelope scores 0.42 on shape. What a box
cannot do is have a bore, a counterbore, a bolt circle or a mating face: its
interface score is EXACTLY 0.0000 on every row, by construction.

v5cap earns 0.2307 of interface, which is what carries the composite over the floor,
while its shape agreement is 0.17 WORSE than simply filling the bounding volume.

Read plainly: **the adapter has learned to place functional features, and has not
learned to get the overall solid right.** That is a far more useful statement than
"+0.0367", and it points the next work at shape rather than at features.

It also retires a comfortable reading of the older result. "Beaten by a box" was
never a claim that the model produces nothing useful -- it is that a box's shape term
is hard to beat while the model's interface term was too small to compensate. On this
set the interface term is now large enough.

## Standing qualifications

* Interim: 3 of 5 v5cap shards. The direction and significance hold on a stratified
  347-row sample; the final number comes when all five land.
* Both arms are scored against IDENTICAL references (tasks.jsonl sha1
  8443c1062fa16be1 for both), guaranteed by `--reuse-tasks` rather than assumed.
* The box floor moves with target complexity (0.23 at gold_ops 20-35, 0.3076 above
  35), which is exactly why this comparison is paired row-by-row.
