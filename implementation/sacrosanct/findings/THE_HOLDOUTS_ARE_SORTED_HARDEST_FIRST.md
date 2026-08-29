# Every holdout in this programme is sorted hardest-first, so any partial run is biased

**Measured 2026-08-28.** Rank correlation between a task's POSITION IN THE FILE and
its gold tree size:

    data/forge/holdout_true.jsonl            n= 36   Spearman(position, _ops) = -0.987
    data/forge/holdout_true_grounded.jsonl   n= 36   Spearman(position, _ops) = -0.987
    data/forge/holdout_enlarged_600.jsonl    n=600   Spearman(position, _ops) = -0.973

These files are not shuffled. They are almost perfectly ordered by DESCENDING
complexity. Median gold_ops by decile of the 600-row file:

    rows   0- 60 : 36        rows 300-360 : 26
    rows  60-120 : 33        rows 360-420 : 24
    rows 120-180 : 32        rows 420-480 : 21
    rows 180-240 : 30        rows 480-540 : 21
    rows 240-300 : 27        rows 540-600 : 20

So **a prefix is a hard sample and a suffix is an easy one**, and a run that stops
early does not produce a noisy estimate of the whole -- it produces a biased one.

## How large the bias actually is

Two partial scorings of the v4a RELOAD arm survive alongside the complete one, so
this can be measured rather than argued. Scoring each row through the FULL run and
splitting by whether the partial contained it:

    partial      its own mean   those rows in full   the rows it MISSED
    interim17    0.2423         0.2547               0.4687   (n=16)
    seg4_n31     0.2241         0.2241               0.9581   (n= 6)
    full36       --             0.3617 (n=32)        --

`interim17` reported **0.2423** where the complete set gives **0.3617**. That gap,
0.119, is the same size as the entire 95% CI that made the whole n=25 comparison
unanswerable. `seg4_n31` missed six rows averaging **0.958** -- nearly the ceiling.

Any interim number taken from these files is low, and low by an amount comparable
to every effect this programme has tried to measure.

## Why it nearly mattered today

The 600-row v5cap emission died at row 415 when its verifier became a zombie. Had
that gone unnoticed, the natural move would have been to score the 415 rows that
existed. Those 415 are the HARD 69% of the set (median gold_ops 30, genus 21)
against a remainder of median 21 ops and genus 4. The resulting number would have
been compared against a bounding-box floor computed on all 600 -- a model measured
on the hard half against a floor measured on everything.

Nothing in that comparison would have looked wrong. Both arms would have carried
the right pin, the right alignment, the right grid, and an honest n.

## What follows

1. **Never report a partial run of these files.** Not as provisional, not as an
   interim signal. The bias has a known sign and a size that swamps the effects.
2. **Shard round-robin, never in contiguous blocks.** The box-floor scoring was
   split `i % N`, which makes every shard a stratified sample of the whole and
   leaves a partial result roughly unbiased. Contiguous blocks would have given
   five shards with five different difficulty profiles.
3. **Pair on the intersection.** `compare_arms_paired.py` already scores only the
   rows every arm completed, which is the defence against two arms stopping at
   different points.
4. The ordering itself is inherited from the source corpus and is not a defect to
   fix in the file -- fixing it would invalidate comparability with every number
   already taken. It is a property to KNOW.
