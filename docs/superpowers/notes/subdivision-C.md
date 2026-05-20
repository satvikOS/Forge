# Sub-project C — Subdivision Surface Topology: Baseline Recon + Verified Algorithm

## Context

Goal: eliminate pinching at cube corners and shading errors at feature edges when
applying Loop subdivision to OCCT-tessellated triangle meshes.

Recon spec: `e2e/subdivide-recon-electron.spec.js`
Data file:  `docs/superpowers/notes/subdivision-C-recon.json`
Measured:   2026-05-19 against `frontend/src/foundation/LoopSubdivision.js` (pure standard Loop)

---

## Baseline Measurements (20×20×20 mm cube)

### Pre-subdivision (OCCT tessellate, deflection=0.5)

| Metric | Value | Notes |
|--------|-------|-------|
| Vertex count | 24 | 4 verts/face × 6 faces — vertices are duplicated per face |
| Triangle count | 12 | 2 triangles/face × 6 faces |
| baseCornerPinch | **0 mm** | Corners exactly at nominal positions |
| baseEdgeDrift | **28.28 mm** (= 20√2) | Artifact: cube corners at t=1 on an adjacent edge project onto the edge endpoint but are 20√2 away perpendicularly. Because OCCT duplicates vertices per face, the base mesh has no shared topology between different cube faces. |
| baseKinkCount | **0** | Vertex duplication per face means no shared edges exist between different cube faces — so no adjacent-face triangle pairs are detected. |

**Interpretation of base-mesh anomalies:**
The OCCT BRepMesh tessellation with deflection=0.5 produces a per-face vertex layout:
each of the 6 cube faces contributes 4 independent vertices (even though cube corners
are shared in 3D space, they are duplicated in the mesh arrays). As a result:
- Triangles on different faces share no mesh edges. `baseKinkCount = 0` even though
  face normals are perpendicular.
- `baseEdgeDrift = 20√2 ≈ 28.28 mm` because cube corner vertices project onto the
  endpoint (t=1.0) of adjacent edges at large perpendicular distance. This is a
  geometry truth, not an error — the corner vertex (20,20,20) genuinely lies 20√2 mm
  from the edge line through (0,0,0)→(20,0,0).

### Post-subdivision (2 Loop steps applied to the base mesh)

| Metric | Value | Notes |
|--------|-------|-------|
| Vertex count | 150 | 24 original + edge/face points after 2 steps |
| Triangle count | 192 | 12 × 4² = 192 (exact 4× per step, no boundary issues) |
| cornerPinch | **4.42 mm** | Worst corner pulled 4.42 mm inward (22% of 20 mm cube edge). All 8 corners equally affected. |
| edgeDrift | **27.85 mm** | Slightly reduced from 28.28 mm but still very high — Loop subdivision does not preserve sharp feature edges. |
| kinkCount | **0** | Subdivision smooths out the per-face boundaries so no 30°+ dihedral kinks remain, but also destroys the feature edges. |

**Root-cause diagnosis:**
1. **Pinching (cornerPinch = 4.42 mm):** Standard Loop repositions extraordinary
   vertices (valence ≠ 6) using smooth β-rules. Cube corners have valence 3 in the
   tessellation, making them extraordinary. The smooth rule pulls them significantly
   inward, producing the characteristic "rounded cube" with 4.42 mm corner recession.
2. **Edge destruction (edgeDrift ≈ 28 mm):** The OCCT tessellation produces duplicated
   vertices per face; Loop subdivision treats each copy independently and smooths them.
   Feature edges are not preserved — they dissolve into smooth curves.
3. **kinkCount = 0 (false green):** Subdivision smooths away the face-normal
   discontinuity because after subdivision the face-duplicated vertices become
   topologically distinct neighbourhoods. No sharding kinks > 30° survive, but this is
   because sharp edges have been destroyed, not because they have been properly handled.

---

## Verified Mitigation Algorithm for Tasks 2-5

### Algorithm: Piecewise-Smooth Loop (Hoppe et al. 1994)

References:
- Hoppe H., DeRose T., Duchamp T., et al. "Piecewise Smooth Surface Reconstruction."
  SIGGRAPH 1994. https://dl.acm.org/doi/10.1145/192161.192233
- Loop C. "Smooth Subdivision Surfaces Based on Triangles." M.S. Thesis, Utah 1987.
- DeRose T., Kass M., Truong T. "Subdivision Surfaces in Character Animation." SIGGRAPH 1998.

#### Step 1: Auto-crease detection by dihedral threshold

Before subdividing, mark edges as sharp based on face-normal angle:

```
For each edge shared by two triangles:
  dot = dot(face_normal_A, face_normal_B)
  if dot < cos(threshold_degrees × π/180):
    mark edge as SHARP (sharpness = initial_sharpness, default 1.0 per level)
```

Default threshold: 30° (cos 30° ≈ 0.866). This correctly marks the 12 cube edges
as sharp (face normals are perpendicular: cos 90° = 0 < 0.866).

For the OCCT tessellation with per-face vertex duplication, the edge is identified
by matching vertex positions (not topology) to detect which edges are geometrically
shared between different cube faces.

#### Step 2: Piecewise-smooth vertex and edge rules

Per-edge sharpness decays by 1 per subdivision level (semi-sharp creases).

**Edge rule (new vertex at midpoint of edge ab):**
- Smooth interior edge (sharpness = 0):
  `e = 3/8·(a + b) + 1/8·(vL + vR)` (standard Loop)
- Sharp edge (sharpness ≥ 1):
  `e = 1/2·(a + b)` (simple midpoint — no pulling toward opposites)
- Semi-sharp edge (0 < sharpness < 1):
  interpolate: `e = sharpness · sharp_rule + (1-sharpness) · smooth_rule`

**Vertex rule (repositioning original vertex v):**
Count the number of incident SHARP edges `k`:
- `k = 0`: smooth interior — standard Loop β rule
  `v' = (1 − n·β)·v + β·Σ(neighbours)`  with `β = (1/n)·(5/8 − (3/8 + 1/4·cos(2π/n))²)`
- `k = 1`: one sharp edge — smooth (vertex is not a crease endpoint)
  use smooth rule (no constraint from single sharp edge)
- `k = 2`: crease vertex — two sharp edges n0, n1 (the crease neighbours)
  `v' = (6v + n0 + n1) / 8`
- `k ≥ 3`: corner vertex — holds its position
  `v' = v` (fixed)
- Boundary vertex (mesh boundary, not sharp): standard boundary rule
  `v' = 3/4·v + 1/8·(b0 + b1)`

**Fix for OCCT per-face vertex duplication:**
Before applying crease detection, the mesh must be "welded" — vertices within
epsilon (e.g. 1e-6 mm) of each other are merged into shared vertices so that
topological edges are correctly identified. After subdivision, vertices may be
un-welded back to per-face layout if needed by downstream code. The welding step
is what makes cross-face edge topology detectable.

#### Step 3: Loop limit-normal at extraordinary vertices

Replace face-normal averaging with the Loop limit-surface tangent frame:

At an interior vertex `v` with ordered ring of neighbours `v_0 ... v_{n-1}`:

```
t1 = Σ_{i=0}^{n-1}  cos(2πi/n) · v_i
t2 = Σ_{i=0}^{n-1}  sin(2πi/n) · v_i
limit_normal = normalize(t1 × t2)
```

This produces a smooth limit normal at extraordinary vertices (valence ≠ 6)
instead of the face-normal average, eliminating shading discontinuities at
e.g. cube corner vertices (valence 3 → extraordinary).

---

## Expected Post-fix Behaviour

After implementing piecewise-smooth Loop with auto-crease + limit normals:

| Metric | Baseline | Expected post-fix |
|--------|----------|-------------------|
| cornerPinch | 4.42 mm | < 0.1 mm (corners held by k≥3 rule) |
| edgeDrift | 27.85 mm | Reduced (crease rule keeps edge verts on edge line) |
| kinkCount | 0 (false green — edges destroyed) | 0 (true: edges preserved and smoothly shaded) |

The corner fix is the most dramatic: cube corners have `k = 3` incident sharp edges,
triggering `v' = v` (fixed). After 2 levels, corners remain at their nominal positions.

---

## Implementation Plan (Tasks 2-5)

- **Task 2:** Mesh welding utility — merge vertices within epsilon before
  subdivision, track weld map for normal computation.
- **Task 3:** Crease-detection pass — compute per-edge sharpness from face-normal
  dihedral angle with configurable threshold.
- **Task 4:** Piecewise-smooth Loop step — replace `loopStep` in
  `LoopSubdivision.js` with the Hoppe et al. vertex/edge rules keyed on
  per-edge sharpness. Sharpness decays by 1 per level.
- **Task 5:** Limit-normal computation — replace face-normal averaging at
  extraordinary vertices with the tangent-mask formula.
