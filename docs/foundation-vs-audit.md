# ArchDisc Foundation vs. industry CAD/CAE/CAM challenges

Audit of the 20 advanced-challenge bullets you raised, scored against
the foundation as it stands on `archdisc` branch as of 2026-05-10.

Legend:
- ✅ shipped + validated
- 🟨 partial / first cut / has known limits
- ⬜ not yet built

## 1. Computational geometry & core mechanics

| Challenge | Status | Notes |
|---|---|---|
| **Topological Naming Problem** | ⬜ | Foundation has feature lists in `Part.js` but no persistent face/edge identity that survives feature-tree edits. Real fix needs a "naming graph" that tracks {parent, operation, role-in-operation} so that fillet-of-edge-3 finds the right edge after parent extrude resizes. M14 candidate. |
| **Class-A Surfacing & G3/G4 continuity** | ⬜ | All faces in foundation are planar (manifold-3d output) or analytic-primitives. No NURBS/B-spline surfaces. Class-A needs full NURBS kernel + curvature-continuity solvers. Months of work or licensing OpenCascade/Parasolid. |
| **Non-Manifold Geometry Resolution** | 🟨 | manifold-3d guarantees manifold output of its own operations; we detect & report non-manifold meshes (`buildPrintReport`). We don't yet **repair** non-manifold input — e.g. zero-thickness walls in imported STL. M15 candidate. |
| **Reverse Engineering Point Clouds** | ⬜ | No point-cloud → solid pipeline. Would need Poisson reconstruction or Delaunay-tetrahedralization of points + surface fitting. |

## 2. Kinematics & assembly dynamics

| Challenge | Status | Notes |
|---|---|---|
| **Real-Time Kinematic Solvers** | 🟨 | `AssemblyMate.js` does 6-DOF LM solver with concentric/coincident/distance/parallel/angle/lock. Handles small-DOF assemblies <100 ms. **Singularity handling**: not robust on near-degenerate Jacobians. **IK chains**: not yet wired. M16 candidate. |
| **Dynamic Collision Detection** | ⬜ | We have manifold-3d intersection (volumetric clash detection at static positions). No swept-volume / time-of-impact yet. Could add via mate-solver kinematic loop + per-step intersection check. M17 candidate (achievable). |
| **Tolerance Stack-Up & Micro-Interferences** | ✅ | `ToleranceStack.js` — worst-case + RSS + Monte Carlo with Cp/Cpk, defects-per-million. Validated on 5-link analytical chain + hinge-pin clearance fit. |
| **Simulating Deformable Bodies (belts/hoses/snap-fits)** | ⬜ | Linear FEM is small-displacement; large-displacement nonlinear (geometric stiffness, contact, plasticity) is not built. Snap-fits in particular need nonlinear contact + buckling. Big work. |

## 3. Simulation & multi-physics (CAE)

| Challenge | Status | Notes |
|---|---|---|
| **Fluid-Structure Interaction (FSI)** | ⬜ | We have neither real CFD nor large-deformation structural. FSI needs both + a coupling scheme (partitioned or monolithic). |
| **Meshing for FEA/CFD** | 🟨 | `TetMesh.regularGrid` + `TetMesh.fromManifold` give regular voxel-fill linear tet meshes. Validated FEM works. **Missing**: hex meshing, boundary-layer refinement, adaptive remeshing, hex-dominant. |
| **Boundary Conditions in Topology Optimization** | ✅ | `TopologyOptimization.js` (SIMP) accepts arbitrary Dirichlet (fixed) + point-load BCs from `selectNodes` predicates. Volume constraint via OC + Lagrange bisection. Sensitivity filter for mesh independence. Demonstrated on cantilever → emergent truss. |
| **Thermal-Structural Coupling** | 🚧 **building now (M13)** | We have static structural FEM + steady thermal FEM. Coupling = thermal eigenstrain α·ΔT applied as force vector in structural solve. |

## 4. Manufacturing & material realities (CAM)

| Challenge | Status | Notes |
|---|---|---|
| **Automated Feature Recognition** | ⬜ | We don't yet detect "this is a Ø6 hole, it's a counterbore, it needs spot-drill+drill+ream". Algorithm: extract surface patches by curvature, classify (planar/cylindrical/spherical/conical), match against known feature templates. M18 candidate. |
| **Sheet Metal Unfolding** | ⬜ | No sheet-metal module. Algorithm: identify bend regions (cylindrical/conical), compute K-factor-corrected developed length, unfold via face-by-face affine flattening. M19 candidate. |
| **Design for Manufacturability (DFM) Rules** | 🟨 | We report overhang fraction + edge length range in `buildPrintReport`. **Missing**: draft analysis, undercut detection, minimum tool-reach checks, weld access checks. |
| **Standardized Hardware Implementation** | ⬜ | No fastener library yet. Could ship parametric M3/M4/M5/M6/M8/M10 ISO metric thread builders + nut/washer geometry as Manifold builders. M20 candidate (achievable, mostly catalog work). |

## 5. Software architecture & UI/UX integration

| Challenge | Status | Notes |
|---|---|---|
| **Precision Canvas and Camera Logic** | 🟨 | Foundation tests use the existing three.js viewport with `near=0.001, far=dist*30` and ACES tone mapping. **Not yet**: orthographic ↔ perspective seamless transition, large-coordinate-range jitter handling (which would need camera-relative coordinates or relative-error reduction). |
| **Level of Detail (LOD) Management** | 🟨 | Legacy kernel has `LODManager.js` (untested through foundation). manifold-3d output is uniform-resolution; for massive assemblies we'd need procedural simplification. |
| **Massive-assembly rendering (10⁶–10⁸ faces, illusion of infinite detail)** | ✅ | M29: `MassiveAssembly.js` ships InstancedMesh-based rendering, MultiResolutionPart with 3 LOD levels (stride decimation; quadric edge-collapse is tier-2), per-frame coarse frustum-group culling. Validated demo: 60 000 M5 fasteners on a virtual airframe = **28 M virtual triangles, 1 draw call, first render 0.37 s**. Tier-2 work to scale to 10⁸: GPU compute culling, out-of-core streaming, mesh compression (Draco / EXT_meshopt_compression), procedural-geometry on GPU, hierarchical-BVH selection. |
| **Predictive AI Modeling Workflows** | ⬜ | No AI sketch / intent inference. The legacy `agents/AgentBridge.js` exists as a stub. Would need a constraint solver + sketch-completion model. |
| **Synchronous vs. History-Based Translation** | ⬜ | `Part.js` re-evaluates the feature stack each `evaluate()` call. **Missing**: direct-edit (push-pull a face) → infer parametric back-edit on the responsible feature. Hard problem (the inverse of feature-recognition). |

## What's getting built next (M13–M20 candidates)

In order, by ratio of (engineering credibility gain) / (effort):

1. **M13 — Thermal–structural coupling** _(building now)_
2. **M14 — Topological naming** for stable feature trees
3. **M15 — Non-manifold repair** for imported STL/STEP
4. **M16 — Inverse-kinematics chains + singularity handling**
5. **M17 — Dynamic collision detection** during mate-solver motion
6. **M18 — Automated feature recognition** (planar/cylindrical/conical)
7. **M19 — Sheet-metal unfolding** with K-factor bend allowance
8. **M20 — ISO metric fastener library** (M3–M10)

NURBS / FSI / point-cloud reverse engineering / synchronous direct
modeling sit at the next tier — they are each multiple-month
undertakings or warrant kernel licensing decisions before starting.
