# The refusal policy is generous to the model and free to the box

**Measured 2026-08-29, mid-run, from the first v5cap scoring shard.**

## Two kinds of refusal, and only one is arm-symmetric

    box arm     : 1 refusal in 360 rows  (0.28%)   -> ho625
    v5cap arm   : 3 refusals in  35 rows  (8.6%)   -> ho680, ho805, ho863

The box refusal is a REFERENCE property: `ho625`'s gold solid is invalid ("not
consistently oriented") and defeats the grid-64 voxel IoU. It drops from every arm
alike. That costs n and biases nothing.

The three v5cap refusals are NOT that. Their references measure clean
(`valid=True` for all three), and no new `forge_verify` crash report was filed, so
these are **300-second timeouts caused by the CANDIDATE** -- the model's own emitted
tree is what the scorer cannot measure in time.

**A bounding box never does this.** `%1 = BOX(...)` measures in under a second,
every time. So the two arms are not exposed to the refusal path equally.

## Why that is a thumb on the scale

`composite_score` classifies a timeout as "instrument failure, not a score" and
REFUSES the row rather than scoring it 0. Read in isolation that is the right call
-- a model should not be charged for the instrument's limits, and it is the same
policy that correctly protects every arm from `ho625`.

But the policy is not neutral when only one arm can trigger it. Applied here it
means:

  * v5cap is scored only over the rows whose output was cheap enough to measure;
  * the box floor is scored over essentially everything;
  * and every v5cap timeout also removes that row from the box arm through the
    pairing, so the floor never gets credit for the rows where the model produced
    something unmeasurable.

At 8.6% this is not a rounding error. If those rows were charged as 0 instead of
dropped, v5cap's mean would move by roughly 8.6% of its own value -- comparable to,
or larger than, every effect this programme has been trying to resolve.

## What to do about it, and what NOT to do

Do NOT change the scorer's policy mid-run. It is the same code path that produced
every prior number, and switching it now would make this run incomparable with the
n=25 result and with itself.

**Report both.** When the arms are complete, state:

  1. the paired mean under the current policy (timeouts refused and dropped), and
  2. a sensitivity figure with candidate-side timeouts charged as 0.0,

with the refusal counts per arm alongside. The gap between (1) and (2) IS the size
of the thumb, and a reader can then judge the result knowing it. A single number
without that pair would be an artifact that misreports what it did -- and by
construction it would flatter the model over the floor.

Also record which rows they were: a candidate that defeats the kernel for 300 s is
itself a finding about the model's output, not just a scoring inconvenience.

## The timeouts are a property of specific model outputs, not noise

`v5cap_shard0`'s refusals, as the shard progressed:

    ho680   ho805   ho863   ho1187   ho810

**`ho1187` and `ho810` are the same two rows that wedged the kernel during the v5cap
EMISSION**, where each hit the 180-second verifier timeout and forced a respawn. They
now defeat the scorer as well, at a different stage, with a different verifier
wrapper, hours apart.

That settles what these refusals are. They are not scheduler noise and not contention
-- they are reproducible properties of particular emitted trees. A tree that takes
more than 180 s to verify at emission takes more than 300 s to score.

It also strengthens the asymmetry argument. These rows are model OUTPUT, so only the
model arm can produce them; the box arm's candidate for the same task is
`%1 = BOX(...)` and measures instantly. The refusal path is reachable only from one
side, and reachable REPRODUCIBLY.

Running count at the time of writing: v5cap 5 refusals in 89 scored rows (5.6%),
against box 1 in 480 (0.21%).

## A process-counting trap worth writing down separately

Three times tonight a `pgrep -f <pattern>` count came back one too high. The cause is
not the pattern being too loose -- it is that **the shell running the pgrep has the
pattern in its own command line**, so any pattern is self-matching by construction.
Tightening the pattern cannot fix it; `MacOS/Python -u scripts/composite_score.py`
self-matched exactly as `composite_score.py --tasks` had.

The fix is to discriminate on the EXECUTABLE rather than the arguments:

    ps -A -o pid=,comm=,args= | awk '/composite_score\.py/ && $2 !~ /zsh|bash|sh$/'

A shell's `comm` is `zsh`; a scorer's is the Python binary. No pattern typed at a
prompt can make a shell satisfy that test. (The queue scripts were never affected --
their own command line is `zsh .../score_queue3.sh`, which contains no such pattern --
so their concurrency caps held correctly throughout.)

## Confirmed at both stages, and one of them is the unifyFaces crash

`v5cap_shard0` finished with **8 refusals in 119 scored rows (6.7%)**:

    ho680  ho805  ho863  ho1187  ho810  ho424  ho826  ho1139

**Four of the eight -- ho1187, ho810, ho826, ho1139 -- are the same rows that defeated
the kernel during the v5cap EMISSION**, hours earlier, through a different verifier
wrapper. Re-tested standalone against the pinned binary:

    ho826  : candidate alone TIMES OUT (wedges the kernel past 90 s)
    ho1139 : candidate alone rc=-11    SIGSEGV

`ho1139` is the row that produced the `unifyFaces` reproducer in the first place. So
the kernel defect documented in UNIFYFACES_SEGV_ON_SIX_CONCENTRIC_HOLES.md is not a
synthetic curiosity -- **real model output hits it, in the scoring path, and costs a
row of the comparison every time it does.**

That completes the argument:

  * the refusals are reproducible properties of specific emitted trees, not noise;
  * they occur at BOTH emission and scoring, so they are not stage-specific;
  * they arrive by two distinct mechanisms, timeout and segfault;
  * and only the model arm can produce them -- the box arm's candidate for every one
    of these tasks is `%1 = BOX(...)`, which measures instantly and cannot fail.

Final counts for this shard: v5cap 8/119 (6.7%) against box 1/480 (0.21%), a ratio of
about 32x. The sensitivity figure with candidate-side timeouts charged as 0.0 is
therefore not a formality -- at ~6-7% of rows it is a materially different number, and
it must be reported beside the headline.
