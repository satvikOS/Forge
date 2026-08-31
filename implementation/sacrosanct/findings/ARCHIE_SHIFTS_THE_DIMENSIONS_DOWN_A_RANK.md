# On the rows it fails, Archie has the right dimensions and puts them on the wrong axes

**Measured 2026-08-29.** Bounding boxes captured for all 441 scored rows by re-verifying
both sides through the pinned verifier (`45e9ad9a`) -- `INPUT()` binds the reference STEP,
the emission is compiled normally -- then comparing SORTED extents, which are invariant
under rotation.

This answers the question left open by `WHERE_V5CAP_LOSES_SHAPE.md`: the low-recall
population is a FORM error, not a pose error, and the form error has a specific shape.

## It is not pose

Sorted extents are rotation-invariant, so if a candidate were merely mis-oriented its
sorted extents would still match. They do not:

    group            n     sorted extents within 10% of the reference's
    recall >= 0.95   117        96  (82.1%)
    0.50 - 0.95      208        76  (36.5%)
    recall <  0.50   116         5  ( 4.3%)

Only 4.3% of the failing rows are pose-consistent. **No rotation maps these candidates
onto their references.**

## The largest axis is right and the others are not

Per-axis, counting rows whose extent matches the reference's to within 0.1%:

    group           largest      middle      smallest
    recall <  0.50  78 (67%)    16 (14%)     18 (16%)
    recall >= 0.95  96 (82%)    89 (76%)     97 (83%)

The blob rows get the whole envelope right (and then over-fill it, 2.66x). **The failing
rows get the overall LENGTH right two times in three and the cross-section wrong.**

## The failure is a RANK SHIFT, and it is far above chance

The extents are not random. In the failing rows the candidate's extent at rank *i*
repeatedly equals the reference's extent at rank *i-1*:

    ref [ 53.4,  73.8, 149.7]  ->  cand [ 36.9,  53.4, 149.7]
    ref [ 74.1, 111.4, 151.0]  ->  cand [ 55.7,  74.1, 151.0]
    ref [100.2, 226.0, 284.5]  ->  cand [ 29.1, 100.2, 251.8]
    ref [ 72.6, 144.9, 176.9]  ->  cand [ 17.3,  34.6, 144.9]

The reference's SMALLEST becomes the candidate's MIDDLE; a new, too-small value fills
the smallest slot. Counting rows with a STRICT shift-down (a match at rank i-1 that is
NOT also a same-rank match):

    observed                                          67 / 116  (58%)
    null, candidate extents shuffled across rows      median 4, 99th percentile 10

    per-slot rate      same-rank      shift-down
    low-recall           0.33            0.31
    high-recall          0.83            0.07

The shift is specific to the failing population: the rows that succeed show it 0.07 times
per slot, the rows that fail 0.31.

## What this means

**Archie is not failing to perceive the part's size. It emits the part's real dimensions
and binds them to the wrong axes**, shifted down one rank. The consequence is a body with
the correct overall length and a cross-section roughly one rank too small -- which is
exactly the "right size, wrong object" mode: median candidate volume 0.82x the reference
with recall under 0.5.

A plausible mechanism, consistent with the three zero-recall rows examined earlier
(`ho884`: profile 251.2 x 25.69 then `EXTRUDE(%1, 25.69)`, the width and depth the same
number): the emission builds `POLY(a x b)` then `EXTRUDE(c)`, and the three numbers are
drawn from the right set but placed in the wrong slots. **This is stated as a hypothesis
about the mechanism; what is MEASURED is the rank shift in the resulting solids.**

## The prompt hands the model an ORDERED TRIPLE, which is the thing being mis-bound

Found while auditing the training corpus for a different reason. The task prompt reads:

    Rebuild this exact solid from construction ops. Overall envelope 107.1 x 65.2 x 47.5 mm.
    TARGET GEOMETRY INVENTORY (full face census, kernel-measured): { "faces": ...

**The overall envelope is supplied as three bare numbers in a fixed order.** Nothing in
that string says which number is length, which is width and which is thickness; the
binding is positional and must be inferred. The measured failure is precisely a
mis-binding of an ordered triple, so the representation and the defect match.

This is corroboration of the mechanism, not proof of it -- the prompt format is a
plausible source of a positional error, and the rank shift is the observed consequence.
The obvious intervention is to name the axes rather than to supply a bare triple, and
that is a corpus change testable against the prediction below.

## Why this matters for the training programme

This is a BINDING defect, not a capacity or perception defect. The information is present
in the model's own output and assigned incorrectly. That argues for making the axis
binding explicit in the training representation -- naming which dimension is length,
width and thickness rather than emitting three bare numbers into positional slots --
rather than for more parameters.

It also predicts something checkable: a corpus intervention that fixes the binding should
move recall on the low-recall population WITHOUT changing the blob population, because the
two modes have different causes. That is the next experiment, and it must be read paired,
on the same 600 references, with an interval -- at n=25 a real +0.073 read as +0.0020.

**Not established here:** that fixing the binding fixes the score. This is a measured
regularity in the failures and a mechanism hypothesis, not a demonstrated cause.
