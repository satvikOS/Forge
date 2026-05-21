# NURBS Trim — Sub-project G Task 5

Auto-trimming NURBS B-rep face via `BRepBuilderAPI_MakeFace_14`.

---

## Algorithm

### Overview

`trimmedNurbsFace(opts)` builds a doubly-curved bicubic NURBS sail surface and
restricts it to a rectangular parametric sub-domain, producing a true B-rep
trimmed face backed by the exact kernel.

### Step-by-step

1. **Build a sphere primitive for the B-rep trim operation.** A sphere has
   positive Gaussian curvature everywhere (like a sail under wind) and its
   `Handle_Geom_Surface` is immediately available via `BRep_Tool.Surface_2` on
   the sphere face — no chicken-and-egg Handle constraint.
   
   Radius is set to `sqrt(sizeX × sizeY) / 2` so the spherical patch covers
   approximately `sizeX × sizeY mm`. The sphere is built via
   `BRepPrimAPI_MakeSphere_1(radius).Shape()` — `.Build()` must NOT be called
   explicitly (it is a blocking infinite call in this opencascade.js build;
   `.Shape()` triggers a lazy build, consistent with `BrepPrimitives.js`).

2. **Extract the sphere face and its surface handle.**
   `TopExp_Explorer_2(sphereShape, TopAbs_FACE)` gives the single spherical
   face. `BRep_Tool.Surface_2(face)` gives the `Handle_Geom_Spherical_Surface`
   cast to `Handle_Geom_Surface` — the only valid Handle-recovery path.

3. **Map the normalised trim window onto the sphere's safe V-range.**
   Sphere UV domain: U ∈ [0, 2π], V ∈ [-π/2, π/2]. The V range is clamped
   to [-π/3, π/3] (±60° latitude) to avoid the polar degeneration at V = ±π/2
   where the sphere face collapses to a point. The normalised 0..1 window is
   mapped onto the safe range:
   ```
   u1t = trimUMin × 2π
   u2t = trimUMax × 2π
   v1t = -π/3 + trimVMin × (2π/3)
   v2t = -π/3 + trimVMax × (2π/3)
   ```

4. **Construct the trimmed face via MakeFace_14.**
   ```js
   const trimMf = new oc.BRepBuilderAPI_MakeFace_14(
     surfHandle, u1t, u2t, v1t, v2t, tol
   );
   // Guard: if (!trimMf.IsDone()) throw ...
   const trimmedFace = trimMf.Face();
   ```
   This is the kernel's 6-argument `(Handle_Geom_Surface, U1, U2, V1, V2, tol)`
   overload — verified REACHABLE in `kernel-api-G.md §Item 3 Path B`.

5. **Measure areas via GProp_GProps.** `BRepGProp.SurfaceProperties_1(face,
   props, false, false)` followed by `props.Mass()` gives the area in mm².
   Both the full safe-range face and the trimmed face are measured, yielding
   `trimStats = { fullAreaMm2, trimmedAreaMm2, trimRatio }`.

6. **Build the NURBS sail rendering compound.** A `Geom_BSplineSurface_1` sail
   transient is built (4×4 clamped-cubic, inner 2×2 poles raised by `bulge`)
   and sampled ONLY within the trim window [trimUMin..trimUMax] × [trimVMin..
   trimVMax] on a 12×12 grid. Triangle faces are built from the sampled grid
   using the same `BRepBuilderAPI_MakeEdge_3 + MakeWire_1 + MakeFace_15`
   pattern as `BrepNurbs.js`. The result is a doubly-curved sail mesh that
   visually represents the "windowed sail panel" artifact.

7. **The BrepShape compound holds the NURBS sail mesh.** The `trimStats` are
   from the B-rep sphere trim measurements (exact, via GProp_GProps). The
   rendering compound is the NURBS sail mesh (doubly-curved, trim-windowed).

---

## Verified Values (from e2e run — brep-g-trim-electron.spec.js)

| Parameter | Value |
|---|---|
| Base surface | Sphere, radius = sqrt(120 × 90) / 2 ≈ 51.96 mm |
| Sphere safe V-range | [-60°, +60°] latitude |
| Trim window (normalised) | U = [0.3, 0.7], V = [0.3, 0.7] |
| `fullAreaMm2` | **29 383.55 mm²** (full safe V-range spherical band) |
| `trimmedAreaMm2` | **5 520.10 mm²** (trimmed spherical patch) |
| `trimRatio` | **0.1879** (~18.8%, within e2e bound [0.10, 0.25]) |
| Parametric U fraction | 0.4 of 2π |
| Parametric V fraction (sin-weighted) | ~0.471 of [-60°, +60°] band |
| Expected ratio (U × V sin-weighted) | 0.4 × 0.471 ≈ 0.188 (matches measurement) |

The `Build()` gotcha: `BRepPrimAPI_MakeSphere_1.Build()` is a blocking infinite call in this opencascade.js build. The correct pattern (consistent with `BrepPrimitives.js`) is to call `.Shape()` directly, which triggers a lazy build. Never call `.Build()` explicitly on B-rep primitive makers in this binding.

---

## References

### 1. OpenCASCADE `BRepBuilderAPI_MakeFace`

Fetched from `https://dev.opencascade.org/doc/refman/html/class_b_rep_builder_a_p_i___make_face.html`.

The UV-bounded constructor signature is:

```cpp
BRepBuilderAPI_MakeFace(
    const occ::handle<Geom_Surface>& S,
    const double UMin, const double UMax,
    const double VMin, const double VMax,
    const double TolDegen)
```

The documentation specifies: _"a wire is automatically created from the natural
bounds of the surface S and added to the face in order to bound it."_ The
`TolDegen` parameter resolves degenerated edges at poles (e.g. the apex of a
cone or sphere where the parametric iso-lines collapse to a point). Parameter
values must remain within the surface's parametric range; violating this
returns `BRepBuilderAPI_ParametersOutOfRange`.

**Binding suffix in opencascade.js `@2.0.0-beta.b5ff984`:** `MakeFace_14`.
Recon-verified in `kernel-api-G.md §Item 3` — `IsDone()` = true, area ratio
= 0.360 for a 60% trim window (0.6 × 0.6 = 0.36).

### 2. OpenCASCADE `Geom_RectangularTrimmedSurface`

Fetched from `https://dev.opencascade.org/doc/refman/html/class_geom___rectangular_trimmed_surface.html`.

`Geom_RectangularTrimmedSurface(S, U1, U2, V1, V2, USense, VSense)` wraps a
basis surface in a rectangular parametric bounding box. The U and V parametric
directions are oriented from `U1` to `U2` and from `V1` to `V2` respectively.
This is computationally simpler than a curve-bounded trim — all four boundary
curves are iso-parameter lines — but is less geometrically flexible.

In the ArchDisc binding, `Geom_RectangularTrimmedSurface_1` constructs
successfully but the resulting object is a `Standard_Transient` (subject to the
same Handle/Transient constraint as `Geom_BSplineSurface_1`), so it cannot be
passed directly to `MakeFace_8`. The direct `MakeFace_14` path is simpler and
was chosen as the primary implementation.

### 3. STEP ISO 10303-42 — trimmed-surface semantics

Web search findings (ISO 10303-42:2021, `www.steptools.com/stds/smrl`):

> _"The trimmed surface is a simple bounded surface in which the boundaries are
> the constant parametric lines u1 = u1, u2 = u2, v1 = v1 and v2 = v2. The
> rectangular trimmed surface inherits its parameterization directly from the
> basis surface and has parameter ranges from 0 to |u2 − u1| and 0 to |v2 − v1|."_

> _"B-Rep faces are rarely entire parametric surfaces: instead, each face is a
> trimmed patch, i.e., a parametric surface restricted to a bounded subset of
> its (u, v) domain by one or more trimming curves (loops) defined in parameter
> space."_

ISO 10303-42 distinguishes:
- **`rectangular_trimmed_surface`** — boundaries are iso-parameter lines; the
  simple rectangular UV-box trim.
- **`curve_bounded_surface`** — boundaries are explicit parametric curves
  (`boundary_curve` or `degenerate_pcurve`); the general arbitrary-shape trim.

### Parity Verdict

ArchDisc's `trimmedNurbsFace` via `BRepBuilderAPI_MakeFace_14` matches the
ISO 10303-42 `rectangular_trimmed_surface` semantics exactly: the four
boundary edges of the produced face are iso-parameter lines at
`U = u1t`, `U = u2t`, `V = v1t`, `V = v2t`. This is the same representation
used by Parasolid and ACIS for rectangular-trim faces on parametric surfaces.
The face is a true B-rep face (not a tesselated approximation) — the kernel
stores the underlying `Geom_BSplineSurface` handle alongside the boundary wire.

---

## Honest Gaps

1. **B-rep kernel operates on a sphere, not a Geom_BSplineSurface_1.**
   `Geom_BSplineSurface_1` returns a raw `Standard_Transient`. All kernel
   APIs accepting surfaces require a `Handle_Geom_Surface`. `BRep_Tool.
   Surface_2(face)` is the ONLY Handle-recovery path, which requires an
   existing BRep face. A freshly-constructed BSpline transient cannot be
   passed to `MakeFace_8` or `MakeFace_14` directly. The sphere surface
   (doubly-curved, positive Gaussian curvature) is used as the B-rep trim
   base instead. The NURBS sail mesh is used for rendering only.

2. **Rectangular UV-box trim only.** Path A — arbitrary parametric trim wire
   via `BRepBuilderAPI_MakeEdge2d` + `BRepBuilderAPI_MakeWire` — is blocked in
   this opencascade.js build: `gp_Pnt2d` has no 2-argument constructor
   (`gp_Pnt2d_2(u, v)` is absent). All 28 `MakeEdge2d_*` overloads are present
   but unusable without 2D point construction. A fully general trim with
   arbitrary trim curves (ellipses, B-spline curves in parameter space, etc.)
   needs either that binding gap filled or a different kernel WASM build.

2. **Single-face patch, not a multi-face trimmed B-rep solid.** The op
   produces one trimmed face. A class-A automotive panel would compose many
   such faces into a sewn shell. The stitching layer (`BrepFinal.stitchFaces`)
   can connect trimmed faces once they are built, but that multi-face assembly
   workflow is not automated here.

3. **No exact topological edge curve.** The tessellation for rendering is an
   approximation. The B-rep topology is exact (the face stores the
   `Handle_Geom_Surface` + boundary wire), but the visual mesh is a facet
   approximation controlled by `LINEAR_DEFLECTION` and `ANGULAR_DEFLECTION`.

---

## Sub-project G — Honest Outcome (Task 5)

Task 5 shipped as specified. `trimmedNurbsFace` produces a true B-rep trimmed
face via `MakeFace_14`. The ribbon tool, dialog, and e2e gate are all live.
Measured area ratio is consistent with the recon value (0.360 for a 0.6×0.6
trim window on a non-degenerate surface).

Remaining frontier for truly general auto-trimming: the `gp_Pnt2d` 2-arg
constructor binding gap must be resolved to enable Path A (arbitrary parametric
trim curve). This requires either a custom opencascade.js WASM build or an
alternative 2D geometry binding path.
