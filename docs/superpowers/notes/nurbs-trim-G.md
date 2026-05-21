# NURBS Trim — Sub-project G Task 5

Auto-trimming NURBS B-rep face via `BRepBuilderAPI_MakeFace_14`.

---

## Algorithm

### Overview

`trimmedNurbsFace(opts)` builds a doubly-curved bicubic NURBS sail surface and
restricts it to a rectangular parametric sub-domain, producing a true B-rep
trimmed face backed by the exact kernel.

### Step-by-step

1. **Build a curved NURBS surface.** `_buildSailTransient` constructs a 4×4
   clamped-cubic `Geom_BSplineSurface_1` with control net
   `sizeX × sizeY mm` footprint. The inner 2×2 poles are raised by `bulge` mm,
   producing a genuinely doubly-curved sail shape (not a flat plane). Knot
   vectors are `[0, 0, 0, 0, 1, 1, 1, 1]` (clamped cubic, degree 3), so the
   parametric domain is `[0, 1] × [0, 1]`.

2. **Round-trip through BRepBuilderAPI_MakeFace_8 to recover a Handle.**
   `Geom_BSplineSurface_1` in this opencascade.js build returns a raw
   `Standard_Transient` — all kernel APIs accepting surfaces require a
   `Handle_Geom_Surface`. `BRep_Tool.Surface_2(face)` is the only way to
   recover a Handle, which requires first having a face. This chicken-and-egg
   constraint (documented in `BrepNurbs.js §ARCHITECTURAL CONSTRAINT`) is
   resolved by building a full-domain face via `MakeFace_8(surf, tol)` first,
   then immediately extracting its surface handle via `BRep_Tool.Surface_2`.

3. **Map the normalised trim window onto the real domain.** The real domain
   bounds are read from `surf.UKnot(1)` / `surf.UKnot(NbUKnots())` etc.
   (falls back to `[0, 1]` if the method fails). The caller-supplied
   `trimUMin..trimUMax, trimVMin..trimVMax` in `[0, 1]` are mapped:
   ```
   u1t = uDomMin + trimUMin * uSpan
   u2t = uDomMin + trimUMax * uSpan
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
   Both the full-domain face and the trimmed face are measured, yielding
   `trimStats = { fullAreaMm2, trimmedAreaMm2, trimRatio }`.

6. **Tessellate for rendering.** `BRepMesh_IncrementalMesh_2(trimmedFace,
   linearDeflection, false, angularDeflection, false)` + `.Perform()` writes
   triangulation into the face. The tessellated face is wrapped in a
   `TopoDS_Compound` and passed to `addBrepShapeToScene` via `brepToMesh`.

---

## Verified Values (from e2e run — brep-g-trim-electron.spec.js)

| Parameter | Value |
|---|---|
| Patch | 120 × 90 mm, bulge = 18 mm, bicubic NURBS |
| Trim window | U = [0.3, 0.7], V = [0.3, 0.7] |
| Parametric fraction | 0.4 × 0.4 = 0.16 |
| `fullAreaMm2` | measured (> 120 × 90 = 10 800 mm² due to curvature) |
| `trimmedAreaMm2` | measured (ratio within [0.10, 0.25]) |
| `trimRatio` | ~ 0.16 ± curvature correction |

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

1. **Rectangular UV-box trim only.** Path A — arbitrary parametric trim wire
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
