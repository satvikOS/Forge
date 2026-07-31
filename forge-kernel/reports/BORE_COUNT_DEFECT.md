# `bores` counts fillets as holes — measured, open, and NOT fixed by the obvious rule

**Status: OPEN.** A fix was attempted on 2026-07-31, regressed real bores to zero, and
was reverted. This document exists so the next attempt starts from the measurement
rather than from the same wrong hypothesis.

## The defect

`forge_verify` reports a bore for every **concave cylindrical face**
(`src/tools/forge_verify.cpp`, the `bores` block). A fillet is also a concave
cylindrical face, so edge blends are counted as holes.

Measured on this build:

| tree | bores reported | correct |
|---|---:|---:|
| `BOX(60,60,20)` + one Ø5 hole | **1** | 1 |
| the same, then `FILLET(%1, 3)` | **5** | 1 |
| `BOX(90,60,20)` + three Ø4 holes, then `FILLET(%3, 2)` | **9** | 3 |

## Why this matters more than it looks

`holes` is a **gate key**. `scripts/archie_loop.py::gate` enforces hole count on
every task that declares one, and `make_holdout_tasks.py` derives each task's
ground-truth `holes` from this same measurement. So on any filleted part:

- the ground truth itself is inflated, and
- a candidate is scored against that inflated number.

The two errors partially cancel, which is worse than a clean bias — it means the
gate is neither measuring hole count nor consistently failing, and the direction of
the error depends on how the candidate's fillets happen to land. Every pass rate
this programme has reported on filleted parts inherits this.

## The obvious fix does not work — this is the measurement, do not repeat it

The natural discriminator is angular sweep: a bore wraps ~2π, an edge blend sweeps
~π/2. It is derivable from `area / (radius × axial extent)`, where the axial extent
comes from `FaceInfo::vMin/vMax`. Accumulating per bore (a cylinder is often split at
its seam) and rejecting anything under 1.5π **counted zero bores on a plain hole**.

The reason, measured directly from `forge::faceInventory`:

```
--- plain hole (one Ø5 bore through 20 mm) ---
  concave=true  r=2.50 area= 78.54 axial=20.00  area/(r*axial)=1.5708   full cylinder would be 314.16
--- the same part after FILLET(3) ---
  concave=false r=3.00 area=254.47 axial=54.00  area/(r*axial)=1.5708
  concave=true  r=2.50 area= 14.59 axial=14.00  area/(r*axial)=0.4169
  concave=true  r=3.00 area=254.47 axial=54.00  area/(r*axial)=1.5708
  ...
```

A genuine bore reports **1.5708**, and so do the fillet faces. The ratio does not
separate them: `area` is not the full swept area the formula assumes, so the sweep
is not recoverable this way. Any rule built on it will either pass fillets or reject
holes.

## The approach that should work

Classify the **axis line**, not the face:

- a **bore's** axis runs through the void it cuts — points on it are OUTSIDE the solid;
- a **convex edge fillet's** axis sits just under the edge — points on it are INSIDE the solid.

`BRepClass3d_SolidClassifier` already does point-in-solid here (`src/VoxelIoU.cpp`),
so sampling a few points along `axisLocation ± (vMin..vMax)` is cheap and needs no
new geometry code. Concave internal-corner blends also have an outside axis and will
need a second discriminator (a corner blend's axis is a bounded segment ending on
adjacent faces, whereas a through-bore's axis exits the bounding box) — so gate the
fix on a fixture set containing all four cases: plain bore, blind bore, convex edge
fillet, internal-corner fillet.

**Do not ship a partial fix.** Under-counting bores is worse than over-counting,
because the gate then passes parts that are missing holes entirely.

## Provenance

Over-counting was first reported by the benchmark-harness engineer while building
`scripts/score_benchmarks.py`, as one of two pre-existing measurement defects
affecting every pass rate. (The other: `forge_verify` reads neuralCAD-Edit STEPs as
metres regardless of declared unit — separately open.) The quantification, the failed
sweep hypothesis and the axis-classification proposal above are from the follow-up.
