# Sub-project D — Retopology (Isotropic Remeshing)

## Recon: Baseline Mesh Quality

**Artifact:** Box(40×40×40 mm³) → Fillet(r=2 mm) — rounded plate  
**Tessellation:** OCCT deflection 0.5 mm, welded with tolerance 1e-4 mm

### Baseline Metrics (from `retopology-D-recon.json`)

| Metric | Value |
|---|---|
| vertexCount | 312 |
| triangleCount | 620 |
| edgeCount | 930 |
| minEdge (mm) | 0.1934 |
| maxEdge (mm) | 50.9117 |
| meanEdge (mm) | 7.7156 |
| stddevEdge (mm) | 14.4321 |
| stddev / mean | 1.871 |

### Vertex-Valence Histogram

| Valence | Count |
|---|---|
| 4 | 35 |
| 5 | 18 |
| 6 | 195 |
| 7 | 56 |
| 8 | 5 |
| 9 | 2 |
| 10 | 1 |

**Observations:**

- **Edge-length distribution is highly non-isotropic.** stddev / mean = 1.87 — well above the 0.4 threshold that distinguishes non-isotropic meshes. The OCCT tessellator produces very long quad-diagonal edges on flat faces combined with very short edges on curved fillets.
- **Valence histogram is dominated by valence-6 (195 / 312 = 62.5%)**, which is a positive baseline. However, 35 valence-4 and 56 valence-7 extraordinary vertices indicate the mesh needs valence equalisation. A post-retopo mesh should shift these toward the valence-6 peak.
- **minEdge (0.19 mm) vs maxEdge (50.9 mm):** a 260× spread — isotropic remeshing targets a ≤ 5/3 × L spread (where the theoretical ratio is (4/3)L / (4/5)L = 5/3 ≈ 1.67).

---

## Verified Isotropic-Remeshing Algorithm (Botsch-Kobbelt 2004)

**Reference:** Botsch, M. & Kobbelt, L. (2004). "A Remeshing Approach to Multiresolution Modeling." In *Proc. Symposium on Geometry Processing*, pp. 185–192.

### Input

- A triangle mesh `{vertices: [[x,y,z], ...], triangles: [[a,b,c], ...]}` — pre-welded (caller invokes `weldMesh` first).
- Target edge length `L` (default: `meanEdge` of the baseline mesh = 7.72 mm for this artifact).
- Number of iterations `N` (default: 5).
- `splitFactor = 4/3` (split threshold multiplier).
- `collapseFactor = 4/5` (collapse threshold multiplier).

### Algorithm: One Iteration Step `isoStep(mesh, L)`

Each iteration performs four operations in sequence:

#### 1. Split Long Edges

For every edge with length > (4/3) · L:

1. Insert a new vertex at the edge midpoint.
2. For each of the (1 or 2) adjacent triangles, split it into two triangles by replacing the original triangle with two new ones sharing the midpoint vertex.
3. Repeat until no edges exceed the threshold (or until a single pass — practice uses a single pass per iteration to prevent infinite loops).

**Boundary edges:** split if over-length (they get a midpoint inserted, producing 1 new triangle for the single adjacent face).

#### 2. Collapse Short Edges

For every edge with length < (4/5) · L:

1. Candidate collapse: merge one endpoint into the other (use midpoint as surviving position).
2. **Skip** if any triangle incident on the collapsed edge would:
   - Invert its normal (degenerate collapse check: compute new triangle normals and compare to originals).
   - Produce a zero-area triangle.
   - Create a non-manifold configuration (e.g., collapsing a boundary vertex into an interior vertex).
3. **Boundary edges are never collapsed.**
4. Remove the two triangles adjacent to the collapsed edge; re-index all triangles that referenced either endpoint to the surviving vertex.

**Degenerate-collapse skip rule:** before committing a collapse, check every triangle that would be re-indexed. If any resulting triangle has all three vertices mapping to fewer than 3 distinct positions (i.e., the surviving triangle degenerates), skip the collapse.

#### 3. Flip Edges to Improve Valence

For every interior edge (i.e., shared by exactly 2 triangles):

Let the 4 incident vertices be `v0`, `v1` (edge endpoints), `v2`, `v3` (opposite vertices of the two adjacent triangles).

1. Compute current valences: `val[v0]`, `val[v1]`, `val[v2]`, `val[v3]`.
2. Compute pre-flip deviation: `Σ |val[vᵢ] − 6|` over i = 0..3.
3. Simulate the flip (edge goes from `v0−v1` to `v2−v3`): valences change by ±1 for each of the 4 vertices.
4. Compute post-flip deviation: `Σ |(val[vᵢ] + Δᵢ) − 6|`.
5. **Flip** if post-flip deviation < pre-flip deviation.

**Boundary edges are never flipped.**

#### 4. Tangential Laplacian Relaxation

For each vertex `v`:

1. Compute the 1-ring centroid: average position of all neighbours.
2. Compute the vertex normal `n̂` as the area-weighted average of the face normals of incident triangles, normalised.
3. Compute the displacement vector: `d = centroid − v`.
4. Project `d` onto the tangent plane: `d_tangential = d − (d · n̂) · n̂`.
5. Move the vertex: `v ← v + d_tangential`.

This "tangential Laplacian" slides vertices along the local surface without pulling them off it (no normal component), producing a uniform vertex distribution.

**Note:** This step does not reproject vertices onto the original B-rep surface. Vertices may drift slightly from the original surface during tangential relaxation, especially on high-curvature regions. Surface pull-back (reprojection via OCCT's `BRepExtrema_DistShapeShape`) is deferred to a future enhancement.

### Repeat

Apply steps 1–4 for `N` iterations.

### Expected Outcome (Post-Remesh)

| Metric | Baseline | Post-Remesh Target |
|---|---|---|
| stddev / mean | 1.87 | ≤ 0.50 (≥ 50% reduction) |
| minEdge | 0.19 mm | ≥ (4/5) · L = 6.17 mm |
| maxEdge | 50.9 mm | ≤ (4/3) · L = 10.29 mm |
| Valence-6 fraction | 62.5% | ≥ 80% |

### Helper Utilities

- `edgeIterator(triangles)` — yields unique edges as `{i, j, triA, triB}` where `triA` and `triB` are the indices of the (1 or 2) adjacent triangles.
- `oneRing(vertexIdx, triangles)` — yields the set of neighbour vertex indices for a given vertex.
- `buildValenceMap(vertexCount, edgeList)` — returns an array of valence per vertex.
- `computeFaceNormal(v0, v1, v2)` — returns the unnormalised face normal vector.

---

## Sub-project D — Deliverable Scope

### Task 1 (this document) — DONE
- Baseline mesh quality measurements on a real-world artifact (Box → Fillet).
- Verified algorithm description (Botsch-Kobbelt 2004).
- Spec `e2e/retopo-recon-electron.spec.js` PASSES green.

### Task 2 — Implement `IsotropicRemesh.js`
- `frontend/src/foundation/IsotropicRemesh.js`
- Exports `isotropicRemesh(mesh, opts)` and `isoStep(mesh, L)`.
- Implements all four steps of Botsch-Kobbelt 2004 with boundary-edge guards and degenerate-collapse skip rule.

### Task 3 — Kernel Facade + Ribbon Wiring
- `frontend/src/kernel/brep/BrepRetopo.js` — tessellate → weld → remesh → normals → Three.js arrays.
- Barrel export `frontend/src/kernel/brep/index.js`.
- `ArchDiscKernel.js` `brep.retopoShape`.
- `ToolParamSchemas.js` `Retopo Surface` schema (targetEdgeLength mm, iterations int).
- `RibbonToolbar.jsx` + `WorkbenchMechanical.jsx` — add `Retopo Surface` to Part tab Surface group.
- `ToolExecutionEngine.js` — `Retopo Surface` handler.

### Task 4 — e2e Gate
- `e2e/retopo-surface-electron.spec.js` — real-world artifact (Box → Fillet → Retopo Surface), full assertions:
  - `retopoTris > 0`, bounding box within 5% of input, stddev/mean improves by ≥ 20%.
- All-angles capture, no page errors.
- Honest outcome appended to this document.

### Known Deferred Items (Honest Gaps)
- **Surface pull-back:** vertices may drift during tangential relaxation. Reprojection onto the original B-rep is deferred. Document this in the Task 4 outcome.
- **Quadrangulation:** isotropic triangle remeshing only (no quad-dominant output).
- **Cross-field guided retopo:** uniform isotropic only (no curvature-aligned or sketch-directed retopo).
- **Anisotropic remeshing:** not planned for Sub-project D.
