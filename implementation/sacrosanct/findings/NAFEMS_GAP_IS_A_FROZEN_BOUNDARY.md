# NAFEMS LE1/LE10: the gap is the mesher's boundary, and it is frozen at 0.625 m

**Measured 2026-08-28**, clean detached worktree at HEAD `9d5e507a`, Release build of
`forge-kernel.node` (`cmake --build`, 426 TUs). The gate reproduces the committed baseline
bit-for-bit on every `[nafems-case]` line: LE1 `35.6714` MPa, LE10 `-2.1252` MPa.
`test/fea_nafems_ratchet.sh` exits 0. No repo file was edited to obtain any number below;
every experiment is a separate script that copies the gate's helpers verbatim.

## Verdict

The residual 60 % is a **MESH-DELIVERY defect in `forge::fea::tet::meshShape`** -- the tet
mesher's boundary densification is a single non-recursive pass, so the boundary node set
**does not refine with `targetEdge` at all**. It is **not** a formulation defect and it is
**not** a boundary-condition defect. Shown conclusively for LE1 and LE10. LE11 could not be
measured: it is BLOCKED in this build.

## 1. The mechanism, read from the source and then measured

`src/FeaTet.cpp` densifies the CAD surface triangulation before Bowyer-Watson:

```cpp
std::size_t ntri = triangles.size();          // frozen BEFORE the loop
for (std::size_t ti = 0; ti < ntri; ++ti) {
    if ((B - A).norm() > minLen) tryAdd((A + B) * 0.5);   // ONE midpoint per edge
    ...
    if (area > minArea) tryAdd((A + B + C) * (1.0 / 3.0)); // ONE barycentre
}
```

`tryAdd` appends to `bndPts` and **never to `triangles`**, and the loop bound is captured
before it runs. So each CAD triangle contributes at most its edge midpoints and its
barycentre, **once**, and the boundary point spacing floors at a fraction of the original
BRepMesh/occtmesh facet size -- independent of `targetEdge`. Only the interior AABB lattice
tracks `targetEdge` (measured: interior spacing 0.271 -> 0.0485, `seedGridCapped=false`
throughout, so the seed cap of report section 4.1 never binds here).

The LE1/LE10 quarter model's `y=0` face is a single `1.25 x t` rectangle in the CAD
triangulation. Its node set, measured:

| targetEdge | tets | nodes on the y=0 face | distinct x | max x-gap | the x stations |
| --- | --- | --- | --- | --- | --- |
| 0.30 | 552 | 9 | 5 | 0.4167 | 2.000, 2.417, 2.625, 2.833, 3.250 |
| 0.22 | 848 | 9 | 5 | 0.4167 | *identical* |
| 0.17 | 1351 | 9 | 5 | 0.4167 | *identical* |
| 0.12 | 2260 | 9 | 5 | 0.4167 | *identical* |
| 0.09 | 7927 | 9 | 5 | 0.4167 | *identical* |
| 0.065 | 14650 | 11 | 5 | 0.4167 | *identical* |
| 0.05 | 38118 | 11 | 5 | 0.4167 | *identical* |

Byte-identical across a **69x** increase in tet count. LE10 the same across **42x**
(0.40 -> 0.09, 699 -> 29250 tets, 11 nodes, max gap 0.4163). Those five stations are exactly
the two rectangle corners, the long-edge midpoint `(2+3.25)/2 = 2.625`, and the two triangle
barycentres `(2+3.25+2)/3 = 2.4167` and `(2+3.25+3.25)/3 = 2.8333`. Nothing else is ever
added, at any requested edge length.

**The instrument was mutation-proven.** The same audit run against structured meshes that do
refine reports `distinctX = nr+1` and `maxXgap = 1.25/nr` for nr = 2,4,8,16,32 (3 -> 33
stations, 0.625 -> 0.039 m), all five predictions matching. The constant it reports for
`meshShape` is a property of `meshShape`, not of the audit.

## 2. What that does to the answer

The NAFEMS quantity is a **free-surface** stress at `D = (2, 0, .)`, recovered as a nodal
average over the incident constant-strain tets. Measured extent of that averaging patch:

| case | targetEdge sweep | tets | incident tets at D | **recovery reach** |
| --- | --- | --- | --- | --- |
| LE1 | 0.30 -> 0.09 | 552 -> 7927 | 8 -> 28 | **0.6250 m, frozen** |
| LE1 | 0.065, 0.05 | 14650, 38118 | 15, 32 | 0.4170 m, frozen |
| LE10 | 0.40 -> 0.09 | 699 -> 29250 | 4 -> 28 | **0.6249 m, frozen** |

The wall at the probe line is `3.25 - 2.0 = 1.25` m. **0.6250 is exactly half of it.** The
patch is subdivided as the mesh refines -- 4 tets become 28 -- but its physical extent never
shrinks, because its far vertex is the permanent midpoint at x = 2.625. The model has, at
every refinement level, **three stress stations across the wall at the probe**.

Corroborating: boundary vertices lying **on** the CAD geometry (< 1e-6) are frozen at
LE1 68 / 68 / 80 (edge 0.17 / 0.12 / 0.065, total nodes 305 -> 496 -> 2853) and LE10
64 / 72 / 72 (edge 0.20 / 0.15 / 0.09, nodes 698 -> 1440 -> 5159). The *off*-geometry
boundary vertices grow instead (25 -> 25 -> 106 and 45 -> 73 -> 157, worst off-distance
0.050 m and 0.073 m): interior lattice points get exposed on the boundary, because the
Bowyer-Watson fill has no boundary recovery and the domain is carved by centroid
classification. The boundary surface area stays at 1.0-2.8x the exact area with **no trend**
(LE1 inner: 2.56, 2.53, 1.99, 2.80, 2.60). It is a single closed component with chi = 2, so
there are no interior cavities, and the volume error is only -1.7 % -- the domain is nearly
the right *size* and badly the wrong *surface*.

## 3. The kernel is exonerated, and then the gap is reproduced exactly

Same `forge.fea.tet.solveLinearStatic`, same element, same CG solver, same nodal recovery,
same facet-normal load lumping -- on a **structured exactly-conforming** elliptic-annulus
mesh built in JS, with `meshShape` bypassed:

| h at D | LE1 sigma_yy err | LE10 sigma_yy err (published BCs) |
| --- | --- | --- |
| 1.2500 | -72.13 % | +81.22 % |
| **0.6250** | **-59.36 %** | **+63.68 %** |
| 0.3125 | -44.71 % | +48.27 % |
| 0.1563 | -26.16 % | +25.27 % |
| 0.0781 | -14.51 % | +12.81 % |
| 0.0521 | -10.22 % | +10.69 % |
| 0.0391 | -7.32 % | -- |

Monotone in both cases; `sigma_xx` at the LE1 free surface (exactly 0 in truth) falls
15.2 -> 5.9 MPa. **The element, assembly, solver and stress recovery converge at rate.**

The closing measurement. The gate's frozen recovery reach is 0.625 m. **Predicted before
running**: a structured mesh at h = 0.625 should give LE1 in -58..-62 % and LE10 in
+55..+62 %.

| | structured at h = 0.625 | gate, measured |
| --- | --- | --- |
| LE1 | **-59.36 %** (nr2 nt8), -57.82 % (nr2 nt16) | **-61.52 %** |
| LE10 | **+63.68 %** (nr2 nt8), +65.51 % (nr2 nt16) | **+60.50 %** |

Both landed. The whole 60 % is accounted for by one frozen length scale. And because that
length scale is set by the CAD facet size rather than by `targetEdge`, the observed order of
accuracy is 0 -- which is what `p = -0.057` and `p = -0.181` are.

## 4. What distinguishes this from the alternatives

Each of these was a live hypothesis in `reports/FEA_NAFEMS_GAP.md` section 5. Each was
measured, not argued.

| hypothesis | measurement | verdict |
| --- | --- | --- |
| LE1 pressure is applied along each facet's own normal, so top/bottom rim faces are loaded in +-z | applied resultant Fx `2.7500e+6`, Fy `3.2500e+6`, Fz `7.60e+2` vs exact `2.7500e+6` / `3.2500e+6` / `0`; 100 % of the loaded area is outer side surface, **zero** top/bottom faces selected (the CAD flat-face triangles are far too big for all three vertices to fall in the band) | **REFUTED** |
| LE1 pins u_z = 0 over the whole z=0 face, which is not a plane-stress condition | structured A/B, whole face vs a single node: 51.258 vs 52.544 MPa coarse, **85.910 vs 86.076 MPa** fine | **REFUTED** (0.2 %) |
| the probe does not land on D | probe node is `(2.000, 0.000, 0.000)` and `(2.000, 0.000, 0.600)`, snap distance 0.05 / 0.0004 | **REFUTED** |
| the seed-grid cap inflates the spacing | `seedGridCapped = false` at every level in these sweeps; interior spacing tracks targetEdge 0.271 -> 0.0485 | **not binding here** |
| nodal averaging pulls the LE10 top-surface bending stress toward mid-depth | real, but O(h) and would therefore shrink; it does not shrink because the patch is frozen -- this is a *consequence* of section 1, not an independent cause | subsumed |
| linear Tet4 under-resolves a curved stress concentration | refuted independently by `test/fea_tet4_convergence.mjs` (p = 1.934 / 1.051) and again by section 3 | **REFUTED** |

I also predicted, wrongly, that **arc** resolution around the inner ellipse was the
controlling variable. A controlled ablation says the opposite and is worth recording:

* **arc held fixed (nt = 8, 9 stations), interior refined**: -44.71 -> -31.45 -> -23.59 ->
  -18.85 -> -17.12 % (nodes 90 -> 4851). Still improving.
* **interior held fixed (nr = 4, nz = 1), arc refined 9 -> 129 stations**: -44.71 -> -42.06
  -> -41.67 -> -41.66 -> -41.72 %. Stalls after one step.

The controlling variable is the element size **normal to the free surface** at the probe --
which is exactly the 0.625 m that is frozen. A fix that only put more points along the
surface would buy 3 pp and stop.

## 5. A second, real defect that is NOT the cause -- record it, it will bite next

`onOuterEllipse` uses `|f - 1| < 0.06` in **normalised** ellipse units, which at (3.25, 0) is
a radial collar **0.0975 m deep**. On the gate's own LE10 mesh at edge 0.15 it selects 125
nodes where the true outer surface has 48: **61.6 % of the constrained set is interior
material**, median depth 0.043 m. It is a genuine boundary-condition defect.

It is **not** what is costing 60 % today. Mesh held fixed, gate band vs the true boundary
surface derived from the mesh's own one-tet-incident faces:

| edge | tets | A: gate band | B: true surface | delta |
| --- | --- | --- | --- | --- |
| 0.30 | 1460 | 56.8 % | 60.0 % | -3.2 pp |
| 0.20 | 3741 | 53.5 % | 54.0 % | -0.5 pp |
| 0.15 | 7970 | 60.5 % | 60.4 % | +0.1 pp |
| 0.115 | 15380 | 56.4 % | 55.5 % | +0.9 pp |

But on a mesh that actually refines it **doubles the error and inverts the trend**, because a
finer mesh puts *more* interior node rings inside a fixed-width band: structured LE10,
published BCs vs the gate band, 12.81 % -> **30.57 %** at 16x32x8 and 10.69 % -> **20.54 %**
at 24x48x8. Fixing the mesher without fixing this will convert one flat gap into a diverging
one. Fix it in the same change.

Also measured, so it is not rediscovered the hard way: replacing LE10's mid-plane u_z ring
with a single-node rigid-body pin gives +387 % .. +622 % with the **wrong sign**. That ring
is load-bearing, not a rigid-body constraint.

## 6. What is missing: LE11

**LE11 was not measured.** In this clean worktree at HEAD it is BLOCKED before any solve --
`forge.fuse` refuses the ball+cone+cylinder operand class ("native analytic/mesh boolean
deferred on an all-native operand pair ... the OCCT BRepAlgoAPI fallback was removed (K2)").
The baseline's LE11 numbers (-59.664 MPa, p = -6.70) came from a worktree that no longer
exists and I could not reproduce them.

So LE11's cause is **inferred, not shown**. The inference is that it is the same defect: its
probe A = (1, 0, 0) is likewise a free-surface point at a triple junction of two symmetry
planes, so its recovery patch is built from the same permanently-coarse planar-face node set.
The missing measurement is the one that would settle it: **run the LE11 geometry once the
native boolean covers that operand class (or import it as a STEP solid, which routes through
the OCCT-backed path), and read the recovery reach at A across a targetEdge sweep.** If it is
frozen, LE11 is the same defect. Note also that LE11 carries a BC question this finding does
not answer: the gate pins `u_z = 0` on **both** z = 0 and z = zTop, and whether the published
setup restrains one face or two was not verified against TNSB Rev.3 here.

## 7. The experiment that confirms the cause, with a falsifiable prediction

Make the boundary densification **recursive**: loop, re-triangulating, until every boundary
edge is shorter than `targetEdge` (or adopt a refiner with constrained boundary recovery --
TetGen, Si, ACM TOMS 41(2):11, 2015). Change nothing else. Then:

1. The `y=0` face audit in section 1 must stop being constant: `distinctX` must grow like
   `1.25/targetEdge` and `maxXgap` must fall with it. **If it does not, this finding is
   wrong.**
2. The recovery reach at D must fall from 0.625 m toward `targetEdge`.
3. At `targetEdge = 0.09` the y=0 line would carry ~14 radial stations. By the section 3
   calibration that predicts **LE1 in -15 % .. -25 %** and **LE10 in +13 % .. +25 %**.
4. **The sharp test is the sign of p.** Both observed orders must flip from negative
   (-0.057, -0.181) to positive. That is falsifiable without either case passing its band,
   so it can be checked immediately and cheaply.

**Honest caveat on the ratchet.** Fixing the mesher is necessary but the measurements do not
promise it is sufficient. The structured study -- an exactly-conforming mesh, the best case
the mesher could ever reach -- still misses both bands at the finest level run: LE1 -7.32 %
against +-5 % at h = 0.0391 (10725 nodes), LE10 +10.69 % against +-6 % at h = 0.0521 (11025
nodes). Measured observed orders on the conforming mesh are p = 1.16 (LE1, last interval) and
p = 0.45..0.95 (LE10). Extrapolating LE1 to the +-5 % band needs h ~ 0.028, about 29k nodes --
affordable. LE10 is the harder one and its extrapolation spans 54k-520k nodes depending on
which interval is treated as asymptotic, so **the LE10 band may still need Tet10 after the
mesher is fixed**. That does not change the ordering: the mesher is what is costing 60 %
today, and no element order can recover a length scale the mesh never delivers.

## Reproduction

Scripts under the session scratchpad `nafems-exp/` (`audit_sets.mjs`, `audit_boundary.mjs`,
`topology.mjs`, `probe_support.mjs`, `frozen_face.mjs`, `instrument_check.mjs`,
`le1_structured.mjs`, `le10_structured.mjs`, `ab_on_gate_mesh.mjs`), each run against a
Release `forge-kernel.node` built in a clean detached worktree at `9d5e507a`. Owner gates
before and after: `test/fea_nafems_gate.mjs` exit 0 and bit-identical on every
`[nafems-case]` line; `test/fea_nafems_ratchet.sh` exit 0, GREEN, 2 misses / 1 blocked.


---

## Correction to the framing (not to the measurement), 2026-08-28

The measurement above is right and it is the important part: **the boundary node set does not
refine with `targetEdge`**, and that is why the NAFEMS error does not shrink under
h-refinement. Nothing below weakens that.

But calling it a *defect in* `meshShape` overstates it, and the overstatement is the kind that
gets a true finding thrown away. The behaviour is **documented and deliberate**. From the
source, immediately above the loop:

```
//   (a) surface points: subdivide every triangle edge whose length
//       exceeds 1.25 * targetEdge into ONE EXTRA MIDPOINT, plus the
//       triangle barycenter if its area is large.
```

and inside it:

```
// (a) Triangle midpoints + barycenters (operate on the original
// triangle list to avoid iterating new points).
```

So `ntri` being captured before the loop, and `tryAdd` appending only to `bndPts`, are not an
oversight -- they are how "one extra midpoint" is implemented. A reader sent to find a coding
slip will find an intentional comment instead, conclude the finding is wrong, and discard a
result that is actually correct.

**The accurate statement is stronger, not weaker:** the seeding strategy is single-pass BY
DESIGN, and a single pass cannot support h-refinement. Conclusive by construction, without
needing a rebuild: `triangles` never grows, and each edge contributes at most ONE midpoint, so
the boundary point set saturates at *original vertices + one midpoint per edge + one barycentre
per triangle*. Below the targetEdge at which every edge already exceeds `1.25 * targetEdge`,
shrinking targetEdge further adds nothing. The interior grid keeps refining; the boundary does
not. That asymmetry is the mechanism.

**What that changes about the fix.** It is not a one-line repair of a slip. It is a change of
strategy -- recursive subdivision that appends to `triangles`, or re-meshing at the target size
-- in numerical code, with a de-duplication rule (`tryAdd` rejects points within `mergeTol`)
that will silently drop sub-triangle vertices unless the subdivision accounts for it. Any
attempt must measure the boundary node count as a function of `targetEdge` FIRST, because that
is the symptom the fix has to move, and NAFEMS band results alone would not distinguish a real
improvement from a lucky one.

**Still blocked either way:** `forge-kernel/src/FeaTet.cpp` is one of the 37 user-owned
in-flight files (D-008). Recorded here so the next person starts from the right problem
statement. Their in-flight diff is 2 lines at 16 and 788 and does not touch this loop, so a
fix on a branch would not conflict.
