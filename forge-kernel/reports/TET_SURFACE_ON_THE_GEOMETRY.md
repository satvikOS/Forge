# The tet mesher's boundary now lies on the geometry (T-035)

`forge::fea::tet::meshShape` used to refine the CAD surface tessellation by bisecting
its chords and keeping the chord midpoints. A midpoint of a flat facet lies on that
facet, so every finer mesh kept the sag of the original tessellation. This note records
the measurements that showed it, the three changes in `src/FeaTet.cpp`, and the effect
of each. Every number here comes from a native C++ gate,
`test/fea_tet_surface_conformance_gate.cpp` (run with
`test/run_fea_tet_surface_conformance_gate.sh`), that links only `forge_kernel_core`.
No JS or Node was run for any number in this note.

## What changed in `src/FeaTet.cpp`

1. **Boundary samples go onto the CAD geometry** (`refineBoundaryOnCad`). The split
   rule is unchanged: longest-edge bisection with the same stopping lengths. What is new
   is where each new point goes:
   - a point on a tessellation edge shared by two faces goes onto the CAD edge curve
     that those faces share;
   - any other point goes onto its own face, using the in-house R1 projector limited to
     the face's UV box;
   - points on planes, and on edges between two planes, are already exact and are left
     alone.

   A projection that fails, or that would move a point by more than half the edge it
   splits, keeps the chord point and is counted. That count was 0 on every shape below.
2. **Interior lattice points stay away from the boundary.** A lattice point within
   0.5 x targetEdge of the refined boundary is not inserted. Without this rule, such a
   point ends up exposed on the surface once the outside tets are carved away.
3. **Exact-predicate Bowyer-Watson.** Samples that lie on the surface are cospherical by
   construction, and the old floating-point circumsphere test broke on them. The
   replacement works as follows:
   - coordinates are snapped to a 2^-49-relative grid, so that coordinate differences
     are exact;
   - orientation and in-sphere decisions use `forge::native::orient3d` and `insphere`;
   - tets store face adjacency, points are located by a visibility walk, and each
     cavity is grown by breadth-first search and then shrunk until it is star-shaped.

   The old test was not sound before T-035 either; the next section shows overlapping
   tets in the old meshes.

## How the gate measures, and why it can be trusted

The slab is built the same way as `fea_nafems_bc.mjs::buildEllipticSlab`. Deviations
are measured against the true ellipsoids `(x/a)^2+(y/b)^2+(z/30)^2=1`. Each boundary
face is assigned to one of the slab's six surfaces by elimination, using the method of
`outerEllipseSurface`. This matters because the retracted T-026 root cause measured
deviations against a surface the vertex was never on.

The C++ port of the LE1/LE10 constraint and load model reproduces the recorded JS A/B on
identical meshes from the pre-change library. The JS figures are the ones recorded in
`test/fea_nafems_baseline.txt` and in the stopped run's
`~/.forge-program/evidence/T-035/baseline_diag_le10.jsonl`; the JS was not re-run.

| Quantity | Port | JS |
|---|---|---|
| LE10 error at 0.20 / 0.15 / 0.115 | 35.32 / 33.64 / 31.71 % | 35.3 / 33.6 / 31.7 % |

The node counts, tet counts, outer-face sets, mid-plane lines and top-face areas also
match.

The gate checks every level of every shape for a **valid tetrahedralization**:

- no face belongs to more than two tets;
- the boundary is a closed 2-manifold;
- the summed tet volume equals the volume the boundary encloses.

The pre-change mesher fails this check. On the slab at 0.115, two faces each belong to
more than two tets, and the tets total 3.2230 m^3 while the boundary encloses only
3.0582 m^3. The sphere at 0.1 fails the same way, and several levels have
non-manifold boundary edges.

**Convergence is asserted only across ratio-2 steps (0.30, 0.15, 0.075).** Bisection
ends an edge of length L at L/2^k, so the boundary spacing changes in steps as
targetEdge changes. A refinement step smaller than 2x can leave a region unchanged. For
example, with projection on, the facet sag is 0.002749 m at both 0.15 and 0.115.

An n-section split (cutting each edge into ceil(L/minLen) parts) was tried and
measured, and it was rejected:
- n is an integer, so the spacing still changes in steps;
- it loses the node row that a bisected 0.6 m edge keeps at z = 0.3;
- on LE10 the mid-plane trace at 0.115 went from 7.5e-5 m to 0.1275 m, and the error
  went from 18.0 % to 19.2 %.

The 0.20 and 0.115 levels stay in the tables so the results can be compared with the
JS sweep.

## BEFORE (pre-T-035 library, fb98b794) and AFTER

LE10 slab, t = 0.6, Part S. Deviations are in metres. `outer`/`inner` are the maximum
curved-vertex deviations. `trace` is the worst |dz| of the LE10 mid-plane trace.

| edge | BEFORE outer | BEFORE inner | BEFORE facet sag | BEFORE trace | BEFORE top area % | AFTER outer | AFTER inner | AFTER facet sag | AFTER trace | AFTER top area % |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.30  | 0.272  | 0.145  | 0.193  | 3e-13 | -12.37 | 1.3e-8 | 1.9e-8 | 0.0103  | 0.113  | -0.011 |
| 0.20  | 0.203  | 0.153  | 0.143  | 0.060 | -6.81  | 1.5e-8 | 2.3e-8 | 0.00368 | 0.075  | -0.003 |
| 0.15  | 0.0701 | 0.118  | 0.0602 | 0.100 | -3.68  | 1.5e-8 | 2.3e-8 | 0.00275 | 0.075  | -0.003 |
| 0.115 | 0.0701 | 0.0964 | 0.0681 | 0.129 | -3.57  | 1.5e-8 | 2.3e-8 | 0.00275 | 7.5e-5 | +0.014 |
| 0.075 | 0.0701 | 0.0645 | 0.0523 | 0.120 | -3.47  | 1.5e-8 | 2.3e-8 | 0.00070 | 0.038  | -0.001 |

Along the ratio-2 chain after the change:
- facet sag falls 3.76x and then 3.93x per halving (order 1.94);
- top-area error falls 4.39x and then 4.07x;
- the trace falls 1.5x and then 2.0x;
- vertex deviation is at geometric precision (about 1e-8 m) at every level.

The gate's verdict on the slab goes from RED (S1a, S1b, S1c, S2, S3, S4 and validity)
to GREEN.

NAFEMS accuracy is measured and reported here, not asserted. The table gives σ_yy error
at D.

| edge | LE10 BEFORE | LE10 AFTER | LE1 edge | LE1 BEFORE | LE1 AFTER |
|---|---|---|---|---|---|
| 0.30  | +63.7 % | +43.5 % | 0.17 | -24.5 % | -26.0 % |
| 0.20  | +35.3 % | +31.6 % | 0.12 | -20.9 % | -17.4 % |
| 0.15  | +33.6 % | +22.2 % | 0.09 | -25.2 % | -9.2 % |
| 0.115 | +31.7 % | +16.9 % | | | |
| 0.075 | +31.6 % | +9.3 %  | | | |

Before the change, the LE10 error stayed between 31.6 and 33.6 % from 0.15 down to
0.075, a 2x refinement. After the change it converges monotonically: observed order 1.26
between 0.15 and 0.075 (22.2 -> 9.3 %, a 2.4x error ratio for a 2x refinement). LE1 is now monotone; it was
not before.

Both cases still miss their NAFEMS bands (±5 % and ±6 %) at the JS gate's own levels
(LE1 at 0.12, LE10 at 0.15). The ratchet's miss set is therefore unchanged; see
`test/fea_nafems_baseline.txt`.

Primitives (Part P):

| Shape | BEFORE | AFTER |
|---|---|---|
| Cylinder r 0.5 at 0.3 / 0.15 / 0.075 | Meshed as the same octagonal prism at 0.30 and 0.15 (vertex deviation 0.0381 m at all three levels, volume -10.0 / -10.0 / -4.8 %) | Facet sag 6.9e-3 / 1.7e-3 / 4.4e-4 m, volume -0.83 / -0.15 / -0.03 % |
| Sphere r 1 at 0.4 / 0.2 / 0.1 | Volume -19.4 / -10.7 / -6.5 %; overlapping tets at 0.1 | Facet sag 0.0246 / 0.0064 / 0.0016 m, volume -4.0 / -1.0 / -0.26 % |
| Box | Exact | Exact |

## Mutation proofs (each built, run and then reverted)

| Mutant | Result |
|---|---|
| M1: projection disabled | Killed: S1a, S1b, S1c, S2, S3, S4 RED; non-manifold boundary on every slab level |
| M2: star-shaping shrink and visibility check removed | **Survived** |
| M3: `orient3dNaive` / `insphereNaive` instead of the exact predicates | Killed: flat tets on box, cylinder and sphere; non-manifold cavity on the slab at 0.075, which fell back to a shell mesh |
| M4: lattice keep-out disabled | Killed: 7 lattice vertices exposed on the slab at 0.15 (S1b 2.1e-4 m); 12 exposed on LE1 at 0.09 |

M2 survives because, with exact predicates, the strict-insphere cavity of a Delaunay
triangulation is already star-shaped. The shrink step is therefore a guarantee for a
case that should not occur, not a repair that actually runs.

## What this does not fix (measured, open)

- **Slivers and solver conditioning.** CG iterations for LE1 at 0.17 / 0.12 / 0.09 are
  2739 / 6437 / 46381; before the change they were 1310 / 1079 / 25736. The minimum
  radius ratio on the slab reaches 1.5e-8. The meshes are valid, but they contain
  near-flat tets.
- **The native tet path** (`FORGE_NATIVE_FEATURES=1`, off by default) still keeps chord
  midpoints, so its surface error stays at the native tessellator's sag: 1.5e-4 m on the
  cylinder and 5.4e-4 m facet sag on the sphere, at every level. Its meshes are valid
  with the new Bowyer-Watson.
- **LE11** is still blocked by the native boolean fuse, so it was not measured.
- **Meshing time** for the slab at 0.075 (14,775 nodes) is 76 to 126 s, depending on machine
  load. A sample of the run puts that time outside Bowyer-Watson: 94 % of the samples
  (6017 of 6434) are in `BRepClass3d_SClassifier::Perform`, which projects onto the
  B-spline faces (`Extrema_GenExtPS`). meshShape calls that classifier once per lattice
  point and once per carved tet.

## Reproduce

```
KERNEL_BUILD=<kernel build, NODE_ADDON=OFF> PART=all bash forge-kernel/test/run_fea_tet_surface_conformance_gate.sh
FORGE_FEA_TET_PROFILE=1   # per-level projection / keep-out / carve census on stderr
```
