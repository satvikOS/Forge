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

## How widespread

A stratified audit (every 20th row of the sorted holdout, so all complexity bands)
is running to establish whether `ho625` is unusual or whether round-trip topology
drift is systemic. That number decides whether this is one bad row or a correction
that applies to the topology term generally.

## Incidental, and worth remembering

The first attempt at that audit produced nothing and reported success-shaped output:
a scratch file named `bisect.py` -- written earlier to bisect the unifyFaces crash --
**shadowed the standard library `bisect` module**, so `import random` failed and the
script died at line 1. Naming a scratch script after a stdlib module breaks every
later script that runs from that directory.
