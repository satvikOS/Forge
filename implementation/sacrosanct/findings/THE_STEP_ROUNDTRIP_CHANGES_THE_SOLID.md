# Writing a reference to STEP and reading it back changes its topology

**Measured 2026-08-29.** Found while trying to make `prep_composite_anchor.py`
record whether each gold reference is a valid solid. The fix did not work, and why
it did not work is the finding.

## The same shape, twice

Compiling `ho625`'s gold tree, then reading back the STEP that same call wrote:

    IN MEMORY (compile the gold tree)   valid=True    genus=13   volume=1249354.2
    AFTER STEP WRITE + READ BACK        valid=FALSE   genus=10   volume=1249233.7
                                        error: "not consistently oriented"

**Three handles disappear across the round-trip**, validity is lost, and the volume
moves by 120.5 (0.0097%).

## Why this matters more than one bad reference

Every reference in this programme is a STEP file that the kernel wrote and the
scorer later reads. The composite is 0.4 shape + 0.4 interface + **0.2 topology**,
and the topology term is computed against the genus of the shape AS READ BACK. If
the round-trip can change genus, then for any affected row the model is being
compared against a reference that is not the solid its gold tree defines.

It also explains a detail that looked like noise earlier: `ho625`'s genus was
recorded as 13 by prep and 10 by the scorer. Those are not two measurements of one
shape disagreeing. They are measurements of two different shapes -- before and
after the file round-trip.

## The attempted fix, and why it was reverted

The obvious repair was to record the census `valid` flag per reference at build
time and report unscoreable references up front. It was implemented, tested, and
**reverted**: on `ho625` it records `ref_valid=True`, because the shape IS valid at
that moment. The check would have shipped false assurance -- worse than no check,
because it looks like coverage.

Any real check must interrogate **the artifact that will actually be used**: write
the STEP, read it back, and record the validity and genus of what comes back. That
costs one extra verifier call per reference (roughly 741 s -> 1500 s for 600), which
is affordable and is the honest version.

NOT applied yet: the current anchor is being read by three live scoring shards, and
a rebuild mid-run would be exactly the "second arm compared against different
references" hazard that `--reuse-tasks` was added to prevent. It goes in after the
arms complete.

## How widespread -- MEASURED, and it cuts this finding down

A stratified audit over 30 references (every 20th row of the sorted holdout, so all
complexity bands):

    valid True -> False : 0 of 30   (0.0%)
    genus CHANGED       : 1 of 30   (3.3%)   ho114: genus 23 -> 21

**So the heading above overstates it, and this section is the correction.** Validity
loss did not reproduce at all in 30 draws -- `ho625` is unusual, not typical. Genus
drift is real but rare: one row in thirty, Wilson 95% CI roughly [0.6%, 16.7%].

That bounds the damage. Topology is 0.2 of the composite, so a drift affecting a few
percent of rows moves the aggregate by well under a point, and it moves BOTH arms
identically because every arm is scored against the same reference file. It is a
correctness wart in the reference pipeline, not a threat to the comparison.

The claim that survives is narrower and still worth having: **a reference STEP is not
guaranteed to be the solid its gold tree defines**, so any per-row topology argument
must be made against the read-back shape, and the "genus 13 vs 10" discrepancy on
`ho625` is explained -- two shapes, not two measurements.

A larger sample (every 5th row, 120 references) is running to tighten the interval.

## Incidental, and worth remembering

The first attempt at that audit produced nothing and reported success-shaped output:
a scratch file named `bisect.py` -- written earlier to bisect the unifyFaces crash --
**shadowed the standard library `bisect` module**, so `import random` failed and the
script died at line 1. Naming a scratch script after a stdlib module breaks every
later script that runs from that directory.
