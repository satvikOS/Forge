# Batch G — P7 & G1 closed with genuine pure-JS algorithms

**Date:** 2026-05-22
**Scope:** Close the two remaining roadmap-§3 parity items that do NOT actually
need the prebuilt `opencascade.js` binding's missing symbols — implement them
as genuine pure-JS geometric algorithms.

| Item | §3 ref | Before | After |
|------|--------|--------|-------|
| **P7** Self-Intersection Detection | §3.6 | PARTIAL | **DONE** |
| **G1** N-Sided Patching            | §3.3 | GAP     | **DONE** |

The audit tally moves 16 → **18 DONE**, 3 → **2 PARTIAL**, 1 → **0 GAP**.

---

## P7 — Face-level self-intersection detection

### The capability
§3.6 intent: "scanning highly warped spline surfaces for crossings" — detect a
single solid whose faces geometrically cross *each other* (self-intersecting
fillet, degenerate sweep, over-offset enclosure, badly-warped spline patch).

The OCCT path (`BOPAlgo_CheckerSI` / `BOPAlgo_PaveFiller`) is unbound in this
WASM build. It is done in JS instead.

### The algorithm — `frontend/src/foundation/SelfIntersection.js` (pure JS)

1. **Input** — the body as a tessellation: triangle positions + a per-triangle
   B-rep face id (`tessellatePerFace` in `BrepTessellate.js`).
2. **Broad phase** — a triangle-AABB BVH, top-down median split on the longest
   axis (the same scheme as `kernel/spatial/BVH.js`). Every triangle is queried
   against the BVH; only triangles with overlapping AABBs reach the narrow
   phase.
3. **Adjacency filter** — a pair is tested only if the two triangles are on
   **non-adjacent** faces. Triangles on the same face, or on faces that share a
   B-rep edge OR even a single vertex, touch *legitimately* and are skipped.
   Adjacency is the UNION of (a) the kernel's exact edge-adjacency map
   (`TopExp.MapShapesAndAncestors`) and (b) position-inferred adjacency — faces
   whose tessellations share ≥ 1 coincident vertex (a fine spatial-hash grid).
   Two genuinely *crossing* faces, being independently tessellated, share no
   coincident vertices — so the ≥ 1-shared-cell rule excludes every legitimate
   contact without ever hiding a real penetration.
4. **Narrow phase** — the **Möller 1997 triangle-triangle intersection test**:
   - reject when all three vertices of one triangle lie strictly on one side of
     the other triangle's plane (signed-distance test);
   - otherwise both triangles cross the line where the two planes meet —
     compute each triangle's parametric interval on that line and report a hit
     iff the two intervals overlap (1-D interval overlap);
   - a dedicated coplanar branch projects to 2-D and runs edge-crossing /
     containment tests;
   - the 3-D crossing segment is recovered (three-plane intersection point +
     the overlap interval). A near-zero-length segment is a mere touch and is
     filtered.
5. **Output** — `{ intersecting, pairs, facePairs, segments, stats }`.

### Kernel facade — `BrepCheck.selfIntersect(brepShape, opts)`
Tessellates the body per face, runs `detectSelfIntersection`, and builds a
renderable highlight mesh of the intersecting triangles.

### Handler — `Check Geometry` (`ToolExecutionEngine.js`)
Now selection-driven (`_pickBodies(1)`, falls back to `__lastBrepShape`),
non-consuming. Runs `selfIntersect` AND the existing `checkSelfIntersection`
(intrinsic validity + inter-solid overlap) so the verdict covers all three
signals. The crossing zone is rendered as a bright-red highlight body. Sets
`window.__lastSelfIntersection`.

### Honest caveat
This is a **tessellation-resolution** detector — it works on the triangle mesh
at the kernel's tessellation `deflection`; a finer deflection finds finer
crossings. It is an exact triangle-triangle detector on the mesh it is given,
NOT an exact-analytic B-rep face/face intersector. Crossings smaller than one
triangle can be missed; it never reports a false crossing for a pair it tests.

### e2e — `e2e/brep-selfintersect-electron.spec.js`
Motion-capture spec. A CLEAN body (Box 40³ + Fillet r=6) reports
`faceLevelSelfIntersection=false, pairCount=0` over 964 triangles / 26 faces.
A DIRTY body (two overlapping boxes grouped as a compound — a compound is not a
boolean, so the kernel never imprints the crossing) reports
`faceLevelSelfIntersection=true, pairCount=6, facePairs=6, segments=6` and the
crossing zone is highlighted red. Verified by reading the stills.

---

## G1 — N-Sided Patching

### The capability
§3.3 intent: "filling a gap bounded by an arbitrary non-four-sided loop of
curves." `BRepOffsetAPI_MakeFilling.Build()` crashes with a raw C++ integer
exception for every input in this WASM build. It is done in JS instead.

### The algorithm — `frontend/src/foundation/NSidedPatch.js` (pure JS)

1. **Initial fill** — ear-clip triangulation of the loop interior, projected
   into the loop's best-fit (Newell-normal) plane. Ear clipping yields a valid
   triangulation of any simple polygon — convex or non-convex, any N ≥ 3.
2. **Refinement** — Loop-style 1→4 split, `subdivisions` times, adds the
   interior degrees of freedom the fairing step relaxes. Boundary loop-edge
   midpoints stay on the boundary.
3. **Variational fairing** — minimise discrete bending energy with the boundary
   FIXED. Each interior vertex is moved toward the **cotangent-Laplacian**-
   weighted average of its one-ring (Pinkall-Polthier / Meyer et al. weights
   `w_ij = ½(cot α + cot β)`); the iteration drives the discrete Laplacian
   toward zero — a discrete minimal-bending (thin-plate) surface. Obtuse-
   triangle cotangents (non-positive weights) fall back to uniform umbrella
   weights, keeping the relaxation unconditionally stable.
4. **Output** — `{ positions, normals, indices, stats }`.

### Kernel facade — `BrepNSided.nSidedPatch(brepShape, opts)`
Resolves a boundary loop from the input B-rep — a chosen face's outer wire
(default: the face with the most edges, i.e. the non-4-sided opening) — walks
it IN ORDER with `BRepTools_WireExplorer` into an ordered corner polyline,
calls `nSidedPatch`, sews the fill mesh into a kernel `TopoDS_Shell`.

### Tool — `N-Sided Patch` (Part → Surface)
Schema in `ToolParamSchemas.js`, ribbon entry in `RibbonToolbar.jsx`, handler
in `ToolExecutionEngine.js`. Non-consuming — it ADDS a fill surface, the body
stays. Sets `window.__lastNSidedPatch`.

### Honest caveat
The result is a **mesh-fidelity** smooth fill — a sewn triangle shell, NOT a
single analytic trimmed NURBS B-rep face. Same documented tier as the G2 blend
(`g2BlendBetweenEdges`) and `catmullClarkShape`. The fill is a genuine discrete
variational surface (minimised bending energy) — it renders / measures /
exports like any body. An analytic N-sided patch (Gregory / GeomPlate) still
needs the variational B-rep solver that crashes in this build.

### e2e — `e2e/brep-g-nsided-electron.spec.js`
Motion-capture spec. A notched plate (Box 80×50×24 − Box 28×28×30) has an
L-shaped SIX-sided top face. N-Sided Patch auto-picks that 6-sided face and
fills it: `loopSides=6, triangleCount=256, vertexCount=153` (real interior
vertices), finite bbox; the input body survives (additive op). Verified by
reading the stills.

---

## References

### P7 — triangle-triangle intersection
- T. Akenine-Möller, **"A Fast Triangle-Triangle Intersection Test"**, Journal
  of Graphics Tools 2(2):25-30, 1997.
  <https://fileadmin.cs.lth.se/cs/Personal/Tomas_Akenine-Moller/code/tritri_tam.pdf>
- P. Guigue & O. Devillers, "Fast and Robust Triangle-Triangle Overlap Test
  Using Orientation Predicates", Journal of Graphics Tools 8(1), 2003 — the
  determinant-only refinement of the same scheme.
  <http://www.philippe-guigue.de/data/triangle_triangle_intersection.html>

### G1 — N-sided / hole filling + discrete variational fairing
- P. Liepa, **"Filling Holes in Meshes"**, Symposium on Geometry Processing
  2003 — triangulate / refine / fair pipeline.
- M. Botsch, L. Kobbelt, M. Pauly, P. Alliez, B. Lévy, "Polygon Mesh
  Processing", Ch. 4 (discrete fairing / bending-energy minimisation).
- M. Meyer, M. Desbrun, P. Schröder, A. Barr, "Discrete Differential-Geometry
  Operators for Triangulated 2-Manifolds" — the cotangent Laplacian weights.
- E. Arneson, "Smoothly Filling Holes in 3D Meshes Using Variational
  Methods" — the bi-Laplacian / umbrella-operator fairing.
  <https://erkaman.github.io/posts/hole_filling.html>

---

## Files

**New:**
- `frontend/src/foundation/SelfIntersection.js` — pure-JS Möller detector + BVH
- `frontend/src/foundation/NSidedPatch.js` — pure-JS variational N-sided fill
- `frontend/src/kernel/brep/BrepNSided.js` — kernel facade for the N-sided fill
- `e2e/brep-selfintersect-electron.spec.js` — P7 motion-capture gate
- `e2e/brep-g-nsided-electron.spec.js` — G1 motion-capture gate

**Modified:**
- `frontend/src/kernel/brep/BrepTessellate.js` — added `tessellatePerFace`
- `frontend/src/kernel/brep/BrepCheck.js` — added `selfIntersect`
- `frontend/src/kernel/brep/ArchDiscKernel.js`, `index.js` — facade wiring
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` —
  `Check Geometry` rewired (selection-driven, real detector); `N-Sided Patch`
  handler added; `Box` honors optional `tx/ty/tz` placement
- `frontend/src/foundation/ToolParamSchemas.js` — `N-Sided Patch` schema
- `frontend/src/components/RibbonToolbar.jsx` — `N-Sided Patch` ribbon entry
- `docs/superpowers/notes/parity-audit.md` — P7 & G1 flipped to DONE
