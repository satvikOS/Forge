# Class-A modelling workflow — Sub-project G, Task 7

> Notes for the class-A surfacing analysis tools: **Class-A Analyze**
> (Gaussian-curvature heatmap) and **Zebra Stripes** (striped-reflection
> continuity overlay). Pure-JS algorithms; no kernel-binding dependency.

## Step 0 — browser reference research

Authoritative references consulted before implementation (2026-05-21).

### Class-A surfacing & what curvature / zebra analysis reveals

- **Class-A surfaces** are the visible, aesthetic surfaces of a product; they
  typically require **G2 (curvature) continuity or better** — a class-A join
  must have "perfect" highlight reflections, often pushed to G3.
- Production tools — **Autodesk Alias** and **ICEM Surf** (now CATIA ICEM) —
  are the specialised class-A systems used in automotive styling. They verify
  surface quality with two instruments: a **Gaussian-curvature colour map**
  and **zebra stripes**.
- A **Gaussian-curvature heatmap** is the most common curvature colour map —
  it reveals *local imperfections* and *abrupt curvature changes* that a
  merely tangent-continuous (G1) join would hide from the eye.
- **Zebra stripes** reveal continuity directly:
  - **G0** (position only) — stripes are **broken / mismatched** at the join.
  - **G1** (tangent) — stripes **meet** at the join but **kink sharply**.
  - **G2** (curvature) — stripes pass **smoothly** across the join, no kink.

  Sources: Onshape surface-modeling help; ICEM-Surf vs CATIA class-A
  comparison (PSH Design); "Analyzing shapes through Zebra Lines"; bluesmith
  "Class A Quality Surfacing"; Plasticity continuity manual.

### Discrete Gaussian curvature on a triangle mesh — angle-deficit method

- The **Gauss-Bonnet / angular-deficit scheme**: the discrete Gaussian
  curvature at a vertex is the **angular defect** divided by the vertex's
  area:

  ```
  K_v = ( 2π − Σ θ_i ) / A_v
  ```

  where the **θ_i** are the interior angles, at v, of the triangles incident
  to v, and **A_v** is the vertex's area. **Formula confirmed** against
  libigl's chapter-1 tutorial (`k_G(v_i) = 2π − Σ θ_ij`, then normalised by
  the Voronoi mass matrix) and the Meyer–Desbrun–Schröder–Barr DDG-operators
  paper.
- **A_v is the mixed Voronoi area** — the genuine Voronoi-cell area for a
  non-obtuse triangle, with a barycentric fallback for obtuse triangles (so
  A_v stays positive on bad triangulations). For a non-obtuse triangle the
  corner P's Voronoi share is `(1/8) Σ_{edges at P} |edge|² · cot(opposite)`.
- The scheme is **intrinsic** (depends only on face angles and area, not on
  extrinsic dihedral angles) and **converges quadratically** to the smooth
  Gaussian curvature under mesh refinement.

  Sources: libigl python-bindings tutorial ch.1; Meyer, Desbrun, Schröder,
  Barr — "Discrete Differential-Geometry Operators for Triangulated
  2-Manifolds" (Caltech multires); MDPI "Approximation of Gaussian Curvature
  by the Angular Defect".

### Zebra-stripe shading

- A zebra render simulates the surface reflecting a **striped environment**
  (a striped fluorescent ceiling a body shop drags a panel under). Because
  the reflected ray is a continuous function of the surface normal, the
  stripe pattern **inherits the surface's continuity class** — a curvature
  break shows as a stripe kink, a tangent break as a stripe jump. A real-time
  approximation needs no environment cube-map: reflect the view ray about the
  interpolated normal and band the projection onto a stripe axis with a
  high-contrast cosine.

## Step 1 — Class-A Analyze (Gaussian-curvature heatmap)

### `frontend/src/foundation/ClassACurvature.js` (pure JS, node-importable)

- **`gaussianCurvatureField(mesh)`** — true discrete Gaussian curvature via
  the angle-deficit method above. Per vertex:
  - **Angular defect** `2π − Σ θ_i` accumulated over incident triangles. For
    a **boundary vertex** the reference is **π** (a half-turn), not 2π — so a
    flat boundary correctly reports K = 0. Boundary vertices are detected by
    finding edges bordering exactly one triangle.
  - **Mixed Voronoi area** A_v (Meyer et al.) — genuine Voronoi for non-obtuse
    triangles, barycentric (½ at the obtuse corner, ¼ each elsewhere) for
    obtuse ones.
  - **K_v = defect / A_v**.
  - A companion **discrete mean curvature** `|H_v|` from the **cotangent
    Laplace-Beltrami operator** (mean-curvature normal): `|H| = ½|Δx|/A_v`.
  - **Degenerate triangles** (zero-length edge / zero area) are detected and
    skipped so they never poison a vertex's accumulators; the count is
    reported (`degenerateTriangles`).
- **`curvatureColors(field, opts)`** — maps the field to per-vertex RGB on the
  **production class-A diverging convention**: **red = positive** (convex /
  elliptic), **white ≈ zero** (flat / developable), **blue = negative**
  (saddle / hyperbolic). A *diverging* white-centred ramp (not a rainbow)
  keeps the zero-curvature reference visually unambiguous — exactly how Alias
  / ICEM Surf present a Gaussian heatmap. A **gamma** exponent shapes the ramp
  contrast (`<1` lifts low-curvature detail).
- **`curvatureRange(field, percentile)`** — a robust symmetric ± range from a
  **percentile of |K|**, so a handful of sliver-triangle curvature spikes
  cannot wash the whole part to a flat mid-tone. The raw (un-clamped) extrema
  are returned separately for the panel's honest numeric readout.
- **`analyzeClassACurvature(mesh, opts)`** — one-call entry: field + colours +
  ranges; returns `{ colors, gaussianRange:[min,max], meanRange:[min,max],
  samples, triangleCount, degenerateTriangles, robustRange, field }`.

### `frontend/src/kernel/brep/BrepClassA.js` (kernel facade)

- **`classAAnalyze(brepShape, opts)`** — tessellate the exact B-rep →
  triangle mesh → `analyzeClassACurvature` → pack. Returns
  `{ positions, normals, indices, colors, stats }`.
- The colour range defaults: **90th percentile** (a filleted solid is mostly
  K≈0 flats plus a thin band of genuine curvature — a high percentile would
  let one sliver spike wash the part white) and **gamma 0.6** (lifts the
  low-curvature detail so the genuine variation reads).

### Handler — `'Class-A Analyze'` in `ToolExecutionEngine.js` `TOOL_HANDLERS.surface`

- Arity 1 (`_pickBodies(1)`), VISUALIZATION + **non-consuming**: builds a
  `THREE.Mesh` with a `vertexColors:true` `MeshStandardMaterial` carrying the
  per-vertex heatmap colours, adds it to the scene, registers it as a body
  ("Class-A Heatmap"). **No `consumedInputs`** — the original body stays.
- The heatmap material uses **`polygonOffset`** (factor −2, units −4) +
  `renderOrder = 2` so the coloured mesh cleanly wins the depth test against
  the coincident original body — no z-fighting.
- Sets `window.__lastClassAAnalysis = { gaussianRange, meanRange, samples }`.

## Step 2 — Zebra Stripes (striped-reflection continuity overlay)

### `frontend/src/foundation/ZebraStripes.js` (may import THREE)

- **`buildZebraMaterial(opts)`** — a two-sided `THREE.ShaderMaterial`. The
  fragment shader reflects the view direction about the interpolated surface
  normal (`reflect(-V, N)`), projects the reflected ray onto a stripe axis,
  and bands it with a **sharpened cosine**, anti-aliased with screen-space
  derivatives (`fwidth`). A soft diffuse floor keeps the part reading as a 3D
  solid under the stripes. Params: `stripeFrequency` (band count),
  `direction` (0 horizontal / 1 vertical), `sharpness`, `ambient`, colours.
- **`applyZebraToObject(root, opts)`** — applies the zebra material to every
  mesh under a body group, **stashing each original material** so the overlay
  toggles: re-running the tool with the group already striped **restores** the
  originals. Returns `{ applied, stripeCount, meshes }`.

### Handler — `'Zebra Stripes'` in `TOOL_HANDLERS.surface`

- Arity 1, VISUALIZATION + non-consuming. Resolves the selected body's scene
  group from the registry and calls `applyZebraToObject` (toggle/overlay).
- Sets `window.__lastZebraStripes = { applied, stripeCount }`.

## Schema + ribbon

- `ToolParamSchemas.js`: `Class-A Analyze` (`gridSamples` 16..128, default 48
  — mapped to a tessellation deflection) and `Zebra Stripes`
  (`stripeFrequency` 4..64 default 16, `direction` 0/1).
- `RibbonToolbar.jsx` Surface group + `WorkbenchMechanical.jsx` surface
  sections gained both tools.

## e2e gate

`e2e/brep-g-classa-electron.spec.js` — ONE motion-capture test. Real-world
artifact with genuine curvature variation: **Box 40³ → Fillet r=4** (the
fillet creates curved regions), built via real ribbon clicks, selected with
real `clickBody`. Workflow: Box → Fillet → Class-A Analyze → Zebra Stripes on
the same body. Frames `input` / `after-fillet` / `after-classa` /
`after-zebra`; `dragOrbit` + `captureAllAngles` for all-angle capture.

**Measured (verified by reading the stills):**
- 616 vertices analysed, 788 tris. Gaussian-curvature range
  `[−7.4e-16, 28.8] 1/mm²` — flat faces ≈ 0, convex fillet edges positive.
  Mean-curvature range `[0.044, 9.7] 1/mm`.
- The heatmap still shows **white flat faces with vivid red rounded fillet
  edges** — the correct production class-A reading.
- Zebra applied with 18 stripes — **high-contrast bands flow over the body**,
  curving across the rounded fillet edges, clearly visible from every orbit
  angle.
- 0 blank frames, no page errors.

## Honest gaps

- **Discrete, not analytic.** `classAAnalyze` computes a *per-vertex discrete
  estimate* on the tessellation. It converges to the smooth Gaussian curvature
  under refinement (quadratically), and it is the instrument a class-A
  modeller actually reads — but it is not the exact analytic curvature of the
  underlying NURBS surfaces. The analytic path exists separately: `nurbsCurvature`
  / `foundation/SurfaceCurvature.js` (first/second fundamental forms) for
  evaluable NURBS patches. The two are complementary — discrete here for
  arbitrary triangle soup, analytic there for NURBS.
- **A filleted box is genuinely mostly white.** A cylindrical fillet edge has
  Gaussian curvature K = 0 (one principal curvature 1/r, the other 0). Only
  the *corner* patches where three fillets meet carry positive K. The heatmap
  showing white flats + a thin red band is *physically correct*, not a bug —
  the diverging white-centred convention is exactly the production reading.
- **Zebra is a real-time reflection approximation.** The stripes come from a
  reflected-ray fragment shader, not a sampled HDRI striped environment. It
  correctly inherits the surface continuity class (the property that matters
  for continuity inspection) but is not a photometric environment render.
- **Visualization, not surface editing.** These two tools are the *analysis*
  half of a class-A workflow — they reveal flaws. Interactive curvature-comb
  editing and surface-matching (dragging control points to chase a target
  curvature profile) remain a larger build; the G2-blend op (Task 6) is the
  constructive companion.
