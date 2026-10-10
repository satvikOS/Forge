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
     cavity is grown by breadth-first search and then shrunk until it is star-shaped;
   - a cavity face counts as visible only if the new tet it would make is non-flat by
     more than the snap can move it (added in fix round 1, see below).

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

## Fix round 1: a numerically flat tet on the fea_smoke cantilever

The round-1 validator found a regression the gate could not see. On the `fea_smoke.cjs`
cantilever (box 0.1 x 0.01 x 0.01 m at targetEdge 0.002, all planar, so projection and
keep-out play no part), the exact-predicate Bowyer-Watson emitted one tet whose volume was
positive only because of the 2^-49 coordinate snap. Measured with the same native gate
(Part Q) against each library:

| Cantilever | pre-T-035 (fb98b794) | round 1 (60a8536e) | fix round 1 |
|---|---|---|---|
| tets | 20436 | 20477 | 20476 |
| min radius ratio | 0.104 | 1.48e-12 | 0.104 |
| min 6V / Lmax^3 | 0.00985 | 2.1e-13 | 0.00985 |
| static CG iterations | 1556 | 27430 | 1819 |
| tip deflection (200 um theory) | 184.15 um | 184.42 um | 184.42 um |
| peak von Mises (60 MPa theory) | 56.35 MPa | 80.67 MPa (+34.5 %) | 57.41 MPa |
| fea_smoke port incl. modal (validator's probe) | 159.6 s, f1 848.6 Hz | not finished after 54 min | 175.0 s, f1 841.7 Hz |

**Cause.** The four vertices were boundary samples on two box faces, mirrored across the
edge the faces share: an isosceles trapezoid, exactly coplanar and cocircular in the
reals. Snapping each coordinate independently perturbs them by ~q (3.6e-15 m here), and the
exact predicates then read the perturbation literally: the trapezoid ended up in a cavity
boundary with the new point as its fourth corner. The old float mesher's `<= r^2 + 1e-12`
test happened to absorb such near-ties.

**Fix.** A cavity face now counts as visible only when the tet it would create has
6V > (256 q + 1e-13 L) L^2, L its longest edge, which is >= 20x what a <= q move of every
coordinate plus the double evaluation can change. Otherwise the star-shaping step drops the
cavity tet behind that face, exactly as for an invisible face. P can be that close to a
face's plane only when it is also within the snap's reach of both circumspheres through that
face (they meet the plane in the same circle). Keeping the tet therefore resolves a tie and
never ignores a real conflict. The guard did not change a single slab mesh: tet counts
1604 / 6159 / 12210 / 23278 / 72679, LE10 errors 43.49 / 31.59 / 22.21 / 16.94 / 9.33 %, LE1
errors -26.04 / -17.43 / -9.22 % and CG counts are identical to round 1. On boxes it restores
the pre-T-035 quality:

| Box, targetEdge | pre-T-035 min radius ratio | fix round 1 |
|---|---|---|
| 0.1 x 0.01 x 0.01, 0.002 (fea_smoke) | 0.104 | 0.104 |
| 0.1 x 0.01 x 0.01, 0.004 | 0.0402 | 0.0402 |
| 0.2 x 0.01 x 0.01, 0.004 | 0.013 | 0.013 (round 1: 1.2e-12, 264 tets below 1e-6) |
| 0.02 cube, 0.004 | 0.329 | 0.329 |
| 1 cube, 0.125 / 0.0625 | 0.498 / 0.47 | 0.498 / 0.47 |
| 1 x 0.6 x 0.4, 0.1 | 0.144 | 0.144 |
| 1 x 0.6 x 0.4, 0.2 | 0.265 | 0.0641 |

Round 1 had the same defect in two more places where nobody had measured it. On the
slender box 0.2 x 0.01 x 0.01 at 0.004 (the `fea_boundary_refines_test.mjs` case), 264 tets
had radius ratio below 1e-6, min 1.2e-12; the minimum is now 0.013, as before T-035
(evidence `fix-round1/box_quality_census.log`, all three libraries). The cylinder meshes at
targetEdge 0.15 and 0.075 had tets with 6V/Lmax^3 = 9.8e-16 and 7.7e-16 (evidence
`fix-round1/gate_prim_on_ROUND1_lib_60a8536e.log`). With the guard the minimum is 7.6e-5 and
6.9e-6.

The last row is not a flat tet (6V/Lmax^3 = 0.0154). It is the same in round 1 and comes
from the keep-out, which drops lattice points next to the boundary: 166 nodes instead of 214.

**Measured and rejected: a tolerance on the in-sphere test.** The first attempt also
treated an in-sphere determinant within the snap's reach as a tie. That is wrong for slivers:
the determinant equals -6V (R^2 - |o - P|^2), so for a tet with 6V << L^3 it sits inside a
q-sized band for almost any P. Slivers then stopped being removed by later insertions. On the
LE10 slab at 0.075 this left 2 non-manifold boundary edges, an inner-surface vertex 0.054 m
off the ellipsoid, S1b / S1c / S2 / S4 RED and a min radius ratio of 1.0e-10. The in-sphere
test stays exact. Evidence: `~/.forge-program/evidence/T-035/fix-round1/gate_attemptA_tie_tolerance_all_REJECTED.log`.

**What the gate now asserts in addition.**
- **Part Q**: the cantilever above, static, solved natively. Checks: a valid mesh, no flat
  tet, min radius ratio >= 0.05, CG <= 3112 iterations (2x pre-T-035), tip deflection and
  peak von Mises within 15 % of theory. Part Q also meshes the slender box 0.2 x 0.01 x 0.01
  at 0.004 and checks that it is valid with no flat tet. It passes on fb98b794 and on this
  fix. On 60a8536e it fails 5 checks (evidence
  `fix-round1/gate_quality_on_ROUND1_lib_60a8536e.log`).
- **No numerically flat tet in any mesh of any part.** The check is min 6V / Lmax^3 >= 3e-11.
  It uses relative volume, not radius ratio. For four nearly coplanar points that are not
  cocircular, the radius ratio falls like (h/L)^2. For example, LE1 at 0.09 has radius ratio
  1.35e-11 but relative volume 2.84e-9; that tet is a geometric sliver (see below). The
  floor is 140x above the flat tet that was found (2.1e-13) and 95x below the flattest
  geometric sliver.
- **Every curved-boundary vertex lies on its ellipsoid to 1e-6 m** at every Part S and LE1
  level. Before, this was asserted only through the convergence ratios of the 0.30 / 0.15 /
  0.075 chain, so the keep-out mutant was killed by a single step.

## Mutation proofs (each built, run and then reverted)

Fix-round results come from the final gate binary run against the mutated library, with the
source restored and `cmp`-verified afterwards. Evidence:
`~/.forge-program/evidence/T-035/fix-round1/mutation_*.log`.

| Mutant | Round 1 | Fix round 1 |
|---|---|---|
| M1: projection disabled | Killed: S1a, S1b, S1c, S2, S3, S4 RED; non-manifold boundary on every slab level | Killed (Part P): cylinder vertex deviation and sag frozen at 0.0381 m; sphere steps x0.998 / x0.92 |
| M2: star-shaping shrink removed | **Survived** | Killed: cantilever 6V/L^3 2.1e-13, CG 27430, von Mises +34.5 % (4 RED); cylinder flat tets at 0.15 / 0.075 |
| M3: `orient3dNaive` / `insphereNaive` instead of the exact predicates | Killed: flat tets on box, cylinder and sphere; non-manifold cavity on the slab at 0.075 | **Survived** every part (quality, prim, surface, le1) |
| M4: lattice keep-out disabled | Killed by a single S1b step (slab at 0.15, 2.1e-4 m) | Killed three ways: S1b step, slab at 0.15 off the ellipsoid by 2.1e-4 m, LE1 at 0.09 off by 7.4e-4 m |
| M6: flat guard removed (= the round-1 code) | n/a | Killed: the same as M2 |

M2 is now killed because the shrink step is where the flat guard acts. M2 and M6 give
identical results: with exact predicates the shrink never fires on an exactly flat or
invisible face in these meshes. It fires only on faces inside the snap's reach.

M3 now survives. The guard decides every near-degenerate visibility question with a band 20x
wider than the snap's reach, and every wrong sign the naive orientation gives lies inside that
band, so those errors no longer reach the mesh. The slab meshes come out with the same tet
counts as with exact predicates. The only symptom left is one point that the walk could not
locate (LE1 at 0.09, 1 of 3367 points). The mesher reported it on stderr only, and the public
`Mesh` had no field for it, so the gate could not see it. The exact predicates are kept: they
are what guarantees that the location walk and the cavity's closed boundary are correct.

**T-256 closed this gap.** `Mesh` now carries the Bowyer-Watson insertion census
(`bwInputPoints`, `bwInsertedPoints`, `bwSkippedDuplicate`, `bwSkippedUnlocated`,
`bwSkippedNoCavity`, `bwFailed`), and the gate asserts on every mesh that every point was
inserted. M3 is now killed: `LE1 edge 0.090: Bowyer-Watson inserted every point (3366 of 3367;
... 1 unlocated ...)`, verdict FAIL (`~/.forge-program/evidence/T-256/mutation_M3.log`).

## Sliver removal (T-253)

The T-035 meshes are valid, but they are Delaunay meshes, and Delaunay meshes keep
**slivers**: four nearly coplanar, nearly cocircular vertices. Such a tet has a good
circumradius-to-edge ratio and almost no volume. Here they come from cospherical sampling by
construction. The cylinder's samples lie on rings. The LE1 slab's top and bottom faces are
sampled at the same (x, y), so every quad through the thickness is a near-rectangle. The
lattice is cubic. One sliver is enough to ruin the conditioning of the whole solve.

`improveSlivers()` (in `src/FeaTet.cpp`) runs on the carved tet set, before the nodes are
numbered. It uses four operations:

1. **Edge removal** on an interior edge whose ring has at most 8 tets (the 3-2 flip is the
   n = 3 case). The ring polygon is re-triangulated with the O(n^3) dynamic programme that
   maximises the minimum quality of the new tets (Shewchuk 2002). This operation does most
   of the work.
2. **2-3 flip** on an interior face.
3. **Smoothing of an interior (lattice) vertex** that belongs to a tet still bad after the
   flips. The vertex moves to its neighbours' centroid or along a compass search, snapped
   to the Bowyer-Watson grid, and only if the worst tet of its star improves.
4. **Removal of a flat cap**: a tet with radius ratio below 0.02 and exactly two boundary
   faces, where the surface is flat across their common edge (interior dihedral at least
   150 degrees). The cap is removed only if its opposite edge is not already a boundary
   edge and no vertex would be orphaned. This is a surface edge flip: the boundary
   vertices stay where they are, on the geometry.

Every operation must raise the minimum quality of the tets it touches. So the global
minimum never falls, and the loop terminates. Every new or moved tet must be exactly
positively oriented, so the result is still a valid tetrahedralization; the gate checks
this at every level. The whole step takes at most 81 ms on the gate's meshes (cylinder at
0.075). `FORGE_FEA_TET_IMPROVE=0` turns it off for A/B runs.

The gate now reports, for every level, the minimum radius ratio and the number of tets
below 0.02. It asserts that this number is 0 on the LE10 slab, the LE1 slab and the
primitives. It also asserts that LE1 at 0.09 converges in at most 4638 CG iterations,
one tenth of the 46,381 measured after T-035.

Measured on the same library build with the step off and on (T-035 meshes otherwise
unchanged; evidence `~/.forge-program/evidence/T-253/`):

| Mesh | Tets < 0.02, before -> after | Min radius ratio, before -> after | CG iterations, before -> after |
|---|---|---|---|
| LE1 0.17 / 0.12 / 0.09 | 4 / 4 / 16 -> 0 / 0 / 0 | 3.8e-7 / 6.4e-10 / 1.35e-11 -> 0.122 / 0.118 / 0.078 | 2739 / 6437 / **46381** -> 422 / 528 / **666** |
| LE10 0.30 / 0.20 / 0.15 / 0.115 / 0.075 | 14 / 109 / 210 / 23 / 792 -> 0 | 3.1e-5 / 1.6e-8 / 2.5e-6 / 2.6e-4 / 6.2e-7 -> 0.151 / 0.025 / 0.023 / 0.151 / 0.032 | 210 / 1403 / 1099 / 1165 / 1620 -> 188 / 335 / 441 / 556 / 829 |
| Cylinder 0.3 / 0.15 / 0.075 | 80 / 511 / 2473 -> 0 | 1.1e-4 / 6.1e-6 / 3.8e-7 -> 0.062 / 0.065 / 0.033 | |
| Sphere 0.4 / 0.2 / 0.1 | 0 -> 0 | 0.312 / 0.161 / 0.045 -> 0.312 / 0.161 / 0.152 | |
| Box 0.2 / 0.1 | 0 -> 0 | 0.064 / 0.144 -> 0.182 / 0.265 | |
| fea_smoke cantilever | 0 -> 0 | 0.104 -> 0.149 | 1819 -> 1776 |
| Slender box 0.2 x 0.01 x 0.01 | 56 -> 0 | 0.013 -> 0.086 | |

LE1 at 0.09 now needs 70x fewer CG iterations. The NAFEMS errors are reported, not
asserted. LE1 is unchanged (-26.04 / -17.43 / -9.22 %). LE10 moved slightly closer to the
target (42.9 / 30.1 / 19.5 / 16.4 / 8.9 % against 43.5 / 31.6 / 22.2 / 16.9 / 9.3 %).

**The cost of removing caps.** A removed cap is replaced on the surface by the other
diagonal of a near-planar quad, which lies slightly inside it. Removing the opposite edge
instead would keep the outer diagonal, but that is not possible: on the cylinder at 0.15,
all 355 caps were removed, 290 of them because that edge's ring has no valid
re-triangulation at all and the other 65 because it has only a worse one. On the LE10
slab the curved facet sag is unchanged at every level. On the cylinder (0.3 / 0.15 / 0.075)
the facet sag goes from 6.9e-3 / 1.7e-3 / 4.4e-4 m to 6.9e-3 / 2.5e-3 / 6.4e-4 m, and the
volume error from -0.83 / -0.15 / -0.030 % to -0.98 / -0.33 / -0.065 %. Both still converge
at the same order, and the gate's convergence checks still pass.

Mutation proofs for T-253 (each built in a separate build directory, run, then reverted
and `cmp`-verified):

| Mutant | Result |
|---|---|
| `FORGE_FEA_TET_IMPROVE=0` (no sliver removal: the T-035 meshes, every level line identical to T-035's) | Killed, 12 RED: no-sliver on all 5 slab levels, all 3 LE1 levels and all 3 cylinder levels; LE1 0.09 CG 46381 > 4638 |
| M10: no edge removal | Killed on LE1: 3 / 2 / 8 slivers left (min 6.7e-6), CG 4932 > 4638. Prim and surface still pass: caps, smoothing and 2-3 flips cover them |
| M8: no flat-cap removal | Killed: cylinder 5 / 98 / 403 slivers left; slab 1 / 6 / 56 / 170 at 0.30 / 0.20 / 0.15 / 0.075 |
| M9: no interior smoothing | Killed: cylinder at 0.075 (1 left, 0.019); slab at 0.15 (1, 7.4e-4) and 0.075 (6, 2.9e-4) |

M8 and M9 were first run with a harness that did not force the mutated file to recompile
(GNU make 3.81 judged the object up to date), so they appeared to survive. Those runs are
kept, marked invalid, under `evidence/T-253/invalid_mutant_runs/`. The harness now deletes
the object before each build and checks that the build log shows `FeaTet.cpp` being
recompiled.

## Carving without one B-rep classifier call per tet (T-255)

After T-035, meshing the LE10 slab at 0.075 (14,775 nodes) took 76 to 126 s. In a sample,
94 % of the time was in `BRepClass3d_SClassifier::Perform` projecting onto the slab's
B-spline faces. `meshShape` called that classifier once per interior lattice point and once
per Delaunay tet.

Both questions are now answered against the refined boundary triangulation (the `leaves`
of `refineBoundaryOnCad`). Its vertices are all on the CAD geometry, and it is watertight
because each split point depends only on its edge. A point is classified by the parity of
the crossings of a ray cast in a fixed generic direction, using a uniform grid and a 3-D
DDA walk. The B-rep classifier is called only in three cases:

- the point is within `band` of the triangulation. `band` is 3 x the largest measured
  distance between a curved leaf and its CAD face, plus 10 x the merge tolerance. The
  distance is measured by projecting each curved leaf's centroid and edge midpoints onto its
  face;
- the ray passes through an edge, a vertex or the plane of a triangle it crosses
  (undecided);
- the triangulation is not watertight (a budget-capped refinement) or a projection failed.
  Then every point goes to the classifier, exactly as before.

`FORGE_FEA_TET_CARVE_VERIFY=1` also calls the classifier on every point that the parity
decided, and counts disagreements. `FORGE_FEA_TET_PROFILE=1` prints the counts and a
per-phase time.

Measured (evidence `~/.forge-program/evidence/T-255/`):

| Check | Result |
|---|---|
| LE10 at 0.075, wall time, T-253 vs T-255, 3 interleaved runs of the same binary driver | 103.8 / 92.6 / 88.2 s -> 3.65 / 2.32 / 2.47 s (about 37x at the median); CPU 98 / 92 / 95 s -> 6.1 / 6.4 / 6.9 s |
| Same mesh? | Same FNV hash of node coordinates and tets in all 6 runs |
| B-rep classifier calls, LE10 at 0.075 | 955, down from about 88,000 (87,194 decided by parity) |
| Gate `PART=all` | PASS, 115 ok; every level line the same as T-253's except for the times; whole gate 3 min 14 s |
| Gate `PART=all` with VERIFY | PASS; 0 disagreements on all 18 meshes |
| Independent probe (T-035 validator's 21 shapes: boxes, translated / rotated / scaled cantilevers, L-bracket, plate with hole) with VERIFY | 20 shapes: 0 disagreements, and node count, tet count, min quality and volume error identical to T-253. The 1e-4 m micro cantilever: 883 disagreements. There the classifier is the one that is wrong: its mesh has 27 non-manifold boundary edges and -0.15 % volume (the open item T-035's validator reported), and the parity mesh is valid with exact volume |
| Budget-capped refinement (`FORGE_FEA_TET_SEED_BUDGET=300`, LE10 at 0.15) | Falls back to the classifier only (1997 calls); same hash as T-253 |

Mutation proofs (forced recompile, restored and `cmp`-verified):

- M12, parity inverted: killed, 20 RED on Part P.
- M11, the measured sag removed from `band` (merge-tolerance band only): killed. With VERIFY
  on, the cylinder at 0.3 / 0.15 has 56 / 17 disagreements, which produce non-manifold
  boundaries (8 / 16 edges) and leftover slivers.

## What this does not fix (measured, open)

- **Geometric slivers and solver conditioning: fixed by T-253** (section above). As found
  by T-035: CG iterations for LE1 at
  0.17 / 0.12 / 0.09 are 2739 / 6437 / 46381; before T-035 they were 1310 / 1079 / 25736.
  The flattest tets are boundary slivers on the curved faces, not rounding artifacts:
  four samples on two near-vertical generators of the RZ = 30 ellipsoid, with 6V/Lmax^3
  down to 2.84e-9 (LE1 at 0.09, radius ratio 1.35e-11) and 4.6e-7 (slab at 0.2, radius
  ratio 1.55e-8). Their circumspheres lie outside the convex outer surface, so they are
  legitimate Delaunay tets; removing them needs sliver repair, not a predicate change. The
  box 1 x 0.6 x 0.4 at 0.2 drops from radius ratio 0.265 to 0.064 because the keep-out
  removes lattice points next to the boundary.
- **The JS harnesses were not run** (the user stopped JS work): `fea_smoke.cjs`,
  `fea_nafems_gate.mjs` with `fea_nafems_ratchet.sh`, `fea_nafems_convergence.mjs`,
  `fea_nafems_bc_ab.mjs`, `calculix_io.mjs`, `fea_boundary_refines_test.mjs` and
  `fea_tet_surface_conformance_test.mjs`. Native ports of the following passed on this fix:
  `fea_smoke.cjs` (static in Part Q; static plus modal in the validator's probe) and
  `fea_boundary_refines_test.mjs` (the validator's probe).
- **The native tet path** (`FORGE_NATIVE_FEATURES=1`, off by default) still keeps chord
  midpoints, so its surface error stays at the native tessellator's sag: 1.5e-4 m on the
  cylinder and 5.4e-4 m facet sag on the sphere, at every level. Its meshes are valid
  with the new Bowyer-Watson.
- **LE11** is still blocked by the native boolean fuse, so it was not measured.
- **Meshing time: fixed by T-255** (section above). As found by T-035: meshing time
  for the slab at 0.075 (14,775 nodes) is 76 to 126 s, depending on machine
  load. A sample of the run puts that time outside Bowyer-Watson: 94 % of the samples
  (6017 of 6434) are in `BRepClass3d_SClassifier::Perform`, which projects onto the
  B-spline faces (`Extrema_GenExtPS`). meshShape calls that classifier once per lattice
  point and once per carved tet.

## Reproduce

```
KERNEL_BUILD=<kernel build, NODE_ADDON=OFF> PART=all bash forge-kernel/test/run_fea_tet_surface_conformance_gate.sh
PART=quality   # the fea_smoke cantilever only (seconds)
FORGE_FEA_TET_PROFILE=1   # per-level projection / keep-out / carve census on stderr
```
