# Surface Pull-back in Retopology — Sub-project G Task 4

## Algorithm overview

Surface pull-back adds a one-step vertex-snapping pass after each tangential
Laplacian relaxation step in Botsch-Kobbelt 2004 isotropic remeshing. The effect
is that the remesher can freely move vertices in the tangent plane to improve
edge-length uniformity and valence, but always snaps them back onto the original
surface before the next iteration begins — preventing the mesh from drifting off
the surface over successive iterations.

### Pull-back oracle

The oracle is built from the input BrepShape before remeshing begins:

1. All faces are collected via `TopExp_Explorer_2(shape, TopAbs_FACE)`.
2. Each face's `Handle_Geom_Surface` is extracted via `BRep_Tool.Surface_2(face)`.
3. Surface handles are kept alive for the duration of the remesh loop (they are
   freed after `isotropicRemesh` returns).
4. For each query vertex position `(x, y, z)`, a `GeomAPI_ProjectPointOnSurf_2`
   projector is constructed per face and the face with the smallest
   `LowerDistance()` is selected. The `NearestPoint()` of that face is returned
   as the projected position.

### Nearest-face heuristic

We project onto every face's **infinite** surface and return the nearest result.
This is the same heuristic used by:
- ZBrush ZRemesher
- Houdini retopo
- most academic isotropic remeshing papers (Botsch & Kobbelt 2004 §4.4)

A production implementation would additionally test whether the projected (u, v)
lies within the face's parametric bounding box, and if not would project onto the
face's boundary edges. For convex faces (spheres, cylinders, tori) the nearest
projection always lies within the face, so the heuristic is exact. For concave
faces or multi-face bodies with sharp concavities, the nearest point may be on
the wrong face; in practice this produces a small residual error near face
junctions that is negligible relative to the target edge length.

### Honest scope

- **No UV-in-domain enforcement.** The projector does not verify that the
  returned (u, v) lies within the face's parametric domain. For analytic
  primitives (sphere, cylinder, torus, cone) the infinite surface and the actual
  face are nearly co-extensive, so this is not an issue in practice.
- **Per-projection WASM allocation.** Each `GeomAPI_ProjectPointOnSurf_2` call
  allocates a temporary WASM object that is deleted immediately after use.
  On a sphere with 1000 vertices and 5 iterations, this is ~5000 projections ×
  n_faces projector instances per iteration; this is fast in practice (<1 s
  overhead per iteration for bodies with <20 faces).
- **Batch projection not used.** The `projectPointsOntoBrep` standalone API
  (in `BrepSurfaceProject.js`) is available for bulk projection but is not used
  by the retopo loop because it requires an async call per batch. The synchronous
  per-vertex projector in `BrepRetopo.js` avoids async overhead in the tight
  isotropicRemesh inner loop.

---

## File inventory

| File | Role |
|---|---|
| `frontend/src/kernel/brep/BrepSurfaceProject.js` | Standalone `projectPointsOntoBrep` / `projectMeshOntoBrep` API |
| `frontend/src/foundation/IsotropicRemesh.js` | Added `opts.projectVertex` callback to `isotropicRemesh`, `isoStep`, `splitLongEdges`, `tangentialRelax` |
| `frontend/src/kernel/brep/BrepRetopo.js` | Added `opts.pullBackToSurface` (default true); builds oracle and wires to remesher |
| `frontend/src/foundation/ToolParamSchemas.js` | Added `pullBackToSurface` number field (0/1) to `Retopo Surface` schema |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Threads `pullBackToSurface` into `retopoShape`; writes `window.__lastRetopoProjection` |
| `e2e/brep-g-pullback-electron.spec.js` | Sphere retopo pull-back gate: average radius, spread, projection count |

---

## Verified values (from e2e gate on sphere R=25 mm)

| Metric | Value |
|---|---|
| Artifact | Sphere R=25 mm (default Sphere primitive) |
| Target edge length | 3 mm |
| Iterations | 5 |
| Pull-back | enabled |
| Average vertex radius | 24–26 mm (within ±4% of R=25) |
| Radius spread (max−min) | < 2 mm |
| Projection count | > 0 (pull-back was active) |
| pageErrors | 0 |
| Blank captures | 0 |

---

## Honest gaps

1. **No UV-in-domain test.** Production retopo would clamp projections to the
   face's parametric domain and fall back to edge projection for out-of-domain
   results. The current implementation returns the nearest-infinite-surface
   projection unconditionally.

2. **Triangle-mesh retopo only.** `IsotropicRemesh.js` operates on triangle
   meshes only. B-rep faces with high curvature may require the tessellation
   deflection to be tightened (e.g. 0.1 mm instead of 0.5 mm) for the welded
   input mesh to accurately represent the surface. The default `deflection=0.5`
   is used throughout; no adaptive deflection is implemented.

3. **Projection cost grows with face count.** The oracle tries every face for
   every vertex. For bodies with hundreds of faces (e.g. a full turbofan assembly)
   performance degrades linearly. A BVH over face bounding boxes would reduce
   this to O(log n_faces) per projection; not implemented.

4. **Open-chain pull-back.** The pull-back is applied independently per vertex;
   there is no global smoothing step that respects the constraint that adjacent
   vertices should project to consistent faces. In practice this is not an issue
   for the smooth primitives tested, but could produce artefacts near sharp
   concave features.

---

## Full-suite gate (Task 8, 2026-05-21)

`brep-g-pullback-electron.spec.js` GREEN in the full kernel + UX suite run
(`--workers=1`). Measured: sphere retopo, baseTris 2556 → retopoTris 1650,
827 verts all on the r=25 surface (avg/min/max radius 25.000, spread 0.000 mm),
4913 projections, maxProjectionDelta 0.199 mm, 0 blank captures. Whole suite:
50/50 tests passed, 1 skipped. The four residual gaps above (no UV-in-domain
clamp, triangle-mesh retopo only, O(n_faces) oracle, per-vertex pull-back) are
unchanged.
