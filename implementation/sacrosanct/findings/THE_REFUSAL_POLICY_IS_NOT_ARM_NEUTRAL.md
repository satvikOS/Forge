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
