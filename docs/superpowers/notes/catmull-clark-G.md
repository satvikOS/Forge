# Catmull-Clark Subdivision — Sub-project G

## Algorithm

### Face points
`F_f = average of the face's corner vertices.`
For degenerate quads (triangle padded to (a,b,c,c)), the repeated vertex is
averaged in, slightly biasing the face point toward that corner — acceptable
for triangular regions, not class-A.

### Edge points
- **Interior smooth edge** (2 adjacent faces, sharpness = 0):
  `E_e = (v0 + v1 + F_a + F_b) / 4`
- **Boundary edge** (1 adjacent face) or **sharp crease edge** (sharpness > 0):
  `E_e = (v0 + v1) / 2`  (midpoint)

### Vertex update
- **Interior smooth** (standard CC rule, valence n):
  `V' = (F + 2R + (n-3)V) / n`
  where F = average of adjacent face points, R = average of edge midpoints for
  adjacent edges, n = vertex valence.
- **Boundary** (Hoppe boundary rule):
  `V' = (6V + b0 + b1) / 8`  where b0, b1 are the two boundary-edge neighbours.
- **Crease** (k=2 incident sharp edges):
  `V' = (6V + n0 + n1) / 8`  where n0, n1 are the crease-neighbour vertices.
- **Corner** (k≥3 incident sharp edges):
  `V' = V`  (vertex fixed).
- **Dart** (k=1 incident sharp edge):  treated as interior smooth (Hoppe).

### Topology (quad faces)
Each input quad `(a,b,c,d)` → 4 child quads:
```
(a,  E_ab, F, E_da)
(b,  E_bc, F, E_ab)
(c,  E_cd, F, E_bc)
(d,  E_da, F, E_cd)
```
After 1 step: `nQuads × 4`.  After n steps: `nQuads × 4^n`.

### Triangle → quad converter (`trianglesToQuads`)
Adjacent triangles sharing an edge are merged into a quad if their face-normal
dihedral angle is ≤ `dihedralThresholdDeg` (default 5°).
Unpaired triangles → degenerate quad `(a, b, c, c)`.

Vertex order for paired quads: `(eu, opp0, ev, opp1)` where eu/ev are the
shared edge endpoints and opp0/opp1 are the opposite vertices of each triangle.

### Crease support
`sharpness: Map<"a_b", number>` (edge key, a < b).  Same key format as
`LoopSubdivision.js`.  Sharpness decays by 1 per level (semi-sharp).

## Honest Gaps

1. **CC limit-normal masks not implemented.**
   True Catmull-Clark limit-normal evaluation uses tangent masks that differ
   from Loop's masks (different basis functions at extraordinary vertices).
   `BrepCatmullClark.js` uses face-normal averaging instead — correct for
   regular quads (valence 4), reasonable at extraordinary vertices (valence ≠ 4),
   but not exact CC limit normals.  For class-A rendering, implement proper
   CC limit-normal masks (future work).

2. **Quad-only after subdivision.**
   The CC implementation handles quads only.  Non-quad n-gon inputs are not
   supported directly.  Triangle inputs are converted to quads (including
   degenerate quads) via `trianglesToQuads` before subdivision.

3. **Degenerate quad degradation.**
   Triangles that cannot be paired (boundary triangles, high-dihedral tris)
   become degenerate quads `(a,b,c,c)`.  The limit surface over these regions
   is not class-A: the repeated vertex biases the face point and the child
   quads have unequal areas.  For full class-A results, input triangle meshes
   should be pre-converted to proper quad meshes by an external quad-meshing
   tool (e.g. Instant Meshes).

4. **Tri-pairing is greedy, not optimal.**
   The tri→quad pairing iterates over edges in map-insertion order and greedily
   pairs the first valid adjacent triangle pair.  A globally optimal pairing
   (minimising aspect ratio, maximising pair count) is not implemented.

## Sub-project G — Honest Outcome

- `CatmullClarkSubdivision.js` implemented with full CC face/edge/vertex rules,
  crease + corner + boundary support, sharpness decay, and tri→quad converter.
- `BrepCatmullClark.js` facade: tessellate → weld → tri→quad → crease detect →
  CC subdivide → face-normal averaging → typed arrays.
- Ribbon tool `Catmull-Clark Subdivide` wired to `ToolExecutionEngine.js` surface
  handler group; schema in `ToolParamSchemas.js`; `window.__lastCatmullClarkMesh`
  slot set for e2e introspection.
- e2e gate: `brep-g-catmullclark-electron.spec.js` — rounded bracket plate
  (Box + Fillet), 2 CC levels, bbox preserved ≥ 35 mm all axes.

### Full-suite gate (Task 8, 2026-05-21)

`brep-g-catmullclark-electron.spec.js` GREEN in the full kernel + UX suite run
(`--workers=1`). Measured: baseQuads 448 → refinedQuads 7168, 6618 refined verts,
212 crease edges, bbox 40.000 × 40.000 × 39.997 mm preserved, 0 blank captures.
Whole suite: 50/50 tests passed, 1 skipped. Residual gaps above (quads only,
degenerate quads from unpairable triangles, greedy tri-pairing) are unchanged.
