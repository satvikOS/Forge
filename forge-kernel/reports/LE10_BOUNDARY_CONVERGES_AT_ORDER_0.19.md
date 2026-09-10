# The LE10 mesh boundary converges to the geometry at order 0.19

Third attempt at this measurement. The first two were confounded and are retracted in
`LE10_ROOT_CAUSE_RETRACTED.md`; both measured distance to a surface the vertex was
never on. This one classifies every boundary vertex against **all six** surfaces of
the quarter model — `z=0`, `z=T`, `x=0`, `y=0`, the inner ellipsoid and the outer —
and reports a deviation only for vertices whose nearest surface is an ellipsoid.

## Measured

| targetEdge | tets | boundary verts | on-ellipsoid | max \|dev\| | p95 \|dev\| | mean \|dev\| |
| --- | --- | --- | --- | --- | --- | --- |
| 0.30 | 2641 | 377 | 47 | 0.090165 | 0.080977 | 0.037478 |
| 0.24 | 3996 | 566 | 122 | 0.142042 | 0.100481 | 0.046010 |
| 0.20 | 6742 | 763 | 107 | 0.152748 | 0.109932 | 0.044818 |
| 0.15 | 13020 | 1400 | 198 | 0.115421 | 0.086042 | 0.032633 |
| 0.115 | 25125 | 2353 | 337 | 0.096301 | 0.067928 | 0.031142 |

`targetEdge` falls **2.61x** and the tet count rises **9.5x**. Over that range:

    mean  0.037478 -> 0.031142   1.203x better   observed order  p = +0.19
    p95   0.080977 -> 0.067928   1.192x better   observed order  p = +0.18
    max   0.090165 -> 0.096301   0.936x          observed order  p = -0.07

A mesh boundary that converges to a curved surface should improve at **order ≥ 1** —
flat facets against a curve have sagitta ~h²/8R, which is order 2. **0.19 is
essentially not converging**, and the maximum gets slightly worse.

The sequence is also not monotone: the max goes 0.090 → 0.142 → 0.153 → 0.115 → 0.096.

## What this establishes, and what it does not

**Established:** the surface the stress is read from does not approach the geometry as
the mesh refines. That is a property of `forge::fea::tet::meshShape`, measured on
47–337 ellipsoid-owned vertices per level rather than the 1–19 near-probe sample that
produced the retracted claim.

Together with the control already on record — the same element, assembly, solver and
recovery on a **structured exactly-conforming** mesh converge monotonically to
**+10.69 %**, against ~35 % here — the mesh's geometric fidelity is the difference.

**Not established:** the quantitative link. Deviation of ~0.03 m mean and a 35 % stress
error are both measured; deriving one from the other is not attempted. A boundary
recovery implementation should be judged by re-measuring both, not by that inference.

## Why the obvious fix was not the fix

`T-035` culled interior lattice points near the surface — classify with
`max(mergeTol, 0.45·targetEdge)` so they land `ON` rather than `IN` — on the theory
that exposed interior points were the steps. It produced **byte-identical** deviation
at every level while removing 5–8 % of the elements, and was not merged. Whatever puts
these vertices off the surface, it is not that.

## Method note

Three attempts, two wrong, and the wrong ones agreed with each other to three decimal
places (0.29133, then 0.291263) because they shared a defect. The model has six
boundary surfaces and only two are curved; any "error from the geometry" metric has to
decide which surface each vertex belongs to before it can subtract anything. Sample
size mattered as much: the retracted claim rested on a maximum over as few as **one**
vertex.
