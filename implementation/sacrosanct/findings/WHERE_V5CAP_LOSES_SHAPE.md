# Where v5cap loses shape: it emits 1.8x the material and still misses an eighth of the part

**Measured 2026-08-29 from the scored artefacts of the final 600-row run** (pinned
verifier `45e9ad9a`, `--align centred-longest --grid 64`). D-011 established that
v5cap beats the bounding-box floor overall but LOSES on shape, 0.2568 vs 0.4239, and
said the next work points at shape. This decomposes that loss.

Every scored record carries `iou_cells` -- the candidate, reference, intersection and
union voxel counts -- so the shape score can be split into coverage and size without
re-running anything.

## v5cap is dominated by a bounding box on BOTH axes

    arm      recall   precision   candidate/reference volume
    box      1.000      0.479          2.09x   (median)
    v5cap    0.865      0.400          1.81x
    v1       0.849      0.285          2.51x

A bounding box has recall 1.000 by construction: it contains the part, so its shape
score IS its precision, i.e. the fraction of its own bbox the part fills (median
48%). v5cap is worse than that box on precision AND on recall.

**So v5cap is not simply "too big".** A merely oversized solid that contained the
part would have recall 1.0. v5cap emits 1.8x the reference volume and still fails to
cover an eighth of it: the material is misplaced, not just excessive.

## Two separable deficits, and the smaller one is the one that flips the result

For a candidate of fixed volume, the best IoU attainable is `min(ref,cand)/max(ref,cand)`
-- achieved when it covers the reference exactly. That is a CEILING imposed by the
size error alone, and the distance below it is the placement error. Paired on the
440 rows where both arms have cells:

    v5cap shape, actual                          0.3346
    v5cap shape, ceiling at its current volume   0.5052     <- size-error ceiling
    box shape                                    0.4613

    loss from size alone      1.000 - 0.5052 = 0.4948   (74% of the total loss)
    loss from placement       0.5052 - 0.3346 = 0.1706  (26%)

Size is the larger term. But the box's size error is WORSE (2.09x vs 1.81x) and it
still wins, because a box sits exactly ON its ceiling -- recall 1.0 leaves nothing
below it. v5cap is the only arm paying both penalties.

**Closing the placement gap alone would flip the shape comparison:**

    counterfactual v5cap - box:  +0.0440   95% CI [+0.0251, +0.0622]   EXCLUDES 0
    rows where covering the reference would beat the box: 291/440 (66%)

At the composite's 0.4 shape weight that is about +0.068 composite -- it would roughly
double v5cap's +0.0431 margin over the floor.

## What this does and does not license

This is a DECOMPOSITION, not a promise. "Cover the reference at your current volume"
is a diagnostic counterfactual; it is geometrically attainable (a 1.8x solid can
contain the reference) but nothing here shows a model change that achieves it.

What it does establish is the DIRECTION, which was the open question:

* **Shrinking the emitted solid is not the fix.** Scale is already normalised by the
  alignment, and the box beats v5cap while being bigger still. Volume error is the
  larger term but it is not what separates v5cap from the floor.
* **Coverage is the fix.** The 13.5% of the reference that v5cap never puts material
  into is worth +0.1706 shape on its own and is the whole of the gap to the floor.

The next question this poses, and does not answer: is the missing eighth concentrated
in a few rows or spread thin across all of them, and is it a pose error (right form,
wrong placement) or a form error? The stored records have no per-axis extents, so
answering it means re-verifying with bbox capture rather than re-reading these files.
