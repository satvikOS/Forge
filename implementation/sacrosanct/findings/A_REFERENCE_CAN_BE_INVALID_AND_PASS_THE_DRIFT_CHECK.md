# A gold reference can be an invalid solid and still pass every check prep makes

**Measured 2026-08-29, chasing why `ho625` was refused during box-floor scoring.**

## The refusal is inherent, not something I caused

`ho617` and `ho625` were refused during the first box-floor run, which was also the
run that preceded the OOM incident -- five scoring shards, an emission, and a
99%-CPU orphan all competing. A timeout under that load would have been a selection
effect I introduced by over-parallelising, so it had to be separated from a real
property of the row.

Re-run at THREE shards with swap flat at ~705 MB, `ho625` was refused **again**, at
the same position in the shard. Inherent, not contention.

## But the cause is not the candidate

The box arm's candidate for `ho625` is `%1 = BOX(203.9,153.6,160.59,0,0,-80.295)`.
It measures clean in under a second. The failure is in the REFERENCE:

    ho625  reference : ok=True  valid=FALSE  genus=10  volume=1249233.66
                       error: "first invalid solid is produced by op %0 INPUT
                               (line 1): not consistently oriented"
    ho636  reference : ok=True  valid=True   genus=35  (a normal row, for contrast)

The gold solid itself is not consistently oriented. **That is arm-symmetric**: an
unmeasurable reference drops the row from box, v5cap and v1 alike, and
`compare_arms_paired.py` scores only the rows every arm completed. So this costs n,
it does not bias the comparison -- which is the distinction that mattered.

## Why prep did not catch it, which is the transferable part

`prep_composite_anchor.py` reports `built 600 failed 0` and excludes any reference
whose volume disagrees with the task's own scalar GT by more than 2%. `ho625` sailed
through:

    volume rebuilt        1249233.657
    task scalar GT        1249354.193
    relative difference   0.0097 %

**The volume was right to a hundredth of a percent while the solid was invalid.**
This programme has a standing law that volume cannot validate geometry, and here it
is again in a new place: the check that guards the REFERENCES is a volume check.

There is a second tell that was also not consulted: the genus came back **13** when
prep built the reference and **10** when the scorer measured the same file. A shape
whose genus is not stable across two measurements of the same STEP is not a shape
you can score against.

## What to change

`prep_composite_anchor.py` already receives `valid` in the census it uses to compute
the volume. It should record it per row and report the count, so an unscoreable
reference is known when the anchor is built rather than discovered as a mid-run
REFUSED line hours later. That converts a silent loss of n into a number stated up
front.

NOT changed yet: prep would have to re-run, and it is currently the artifact three
scoring shards are reading. The exact refusal set will fall out of the shard JSONs
when they complete, and the count of invalid references should be measured then.
