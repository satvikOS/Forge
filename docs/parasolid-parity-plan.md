# ArchDisc kernel → Parasolid parity (and beyond) — scoping plan

## What we are honestly comparing against

Parasolid is **~2 million lines of C++** that Siemens has refined for
35 years. NX, SolidWorks, Onshape, Solid Edge, IronCAD, Bentley
MicroStation, ANSYS Fluent and dozens of others all license it. It
ships:

| Capability bucket | What's inside |
|---|---|
| **Geometry** | NURBS curves + surfaces with arbitrary degree + rational weights, blend surfaces with G2 / G3 continuity, swept / lofted / variational surfaces, offset surfaces, helix / spiral, conic-section curves |
| **Topology** | Persistent face / edge / vertex IDs, manifold + non-manifold support, history graph, tolerant modelling for non-watertight imports |
| **Booleans** | Robust on NURBS (not polygonal), 4-D coincident-face handling, sliver removal, exhaustively tested for 35 years |
| **Features** | Variable-radius fillets, hold-line fillets, face-blends, draft, shell, thicken, sweep with twist + scale rails, multi-section loft with derivative continuity, ISO threads with helical sweep |
| **Surfaces (Class A)** | Curvature combs, zebra analysis, draft analysis, surface continuity reports, automatic re-fit, isophote display |
| **Direct / synchronous** | Push-pull face → infer feature edit, replace face, move-to, group-by-rule selection |
| **Mass + properties** | Volume / centroid / moments of inertia computed analytically on NURBS (exact), not by tessellation |
| **I/O** | STEP AP203 / AP214 / AP242 with full topology + PMI + colour + tolerances; IGES; JT; native Parasolid x_t / x_b; CATIA / Creo / NX format readers |
| **Healing** | Auto-stitch gaps, fill missing faces, repair self-intersections, harmonise normals — all preserving named features |

Foundation today has:

| Capability | Status |
|---|---|
| Geometry kernel | manifold-3d (polygonal B-Rep, MIT) — boolean-robust, fast, validated, but **all faces are planar triangles** (no NURBS) |
| Topology IDs | originalID survives booleans (M14 NamedSolid) |
| Booleans | manifold-3d is best-in-class for polygonal CSG; survives 100+ sequential ops |
| Features | extrude / revolve / shell / pattern / mirror — all polygonal |
| Variable-radius fillet | ❌ |
| Class A surfacing | ❌ |
| Direct / synchronous | ❌ |
| Mass properties | exact via signed-tet integral — ✓ |
| I/O | STEP AP203 (planar faces only — Parasolid emits NURBS) — partial |
| Healing | M15 MeshRepair — basic |

## Honest gap

To reach Parasolid parity we need three multi-month efforts in
sequence:

1. **NURBS geometry layer** — curves + surfaces with proper algorithms
   (Cox-de Boor, de Boor-Cox, knot insertion, knot removal, surface
   intersection via Newton + subdivision). ~3-5 person-months for a
   solid first version.
2. **NURBS-aware booleans** — exact intersection curves between NURBS
   patches via numerical tracing on the parameter plane. Either build
   from scratch (~6+ months, hard) or wrap **OpenCascade** (LGPL,
   well-tested, ~1-2 months integration).
3. **Direct / synchronous + variable-radius features + Class A** —
   each its own multi-month effort, often built on top of the
   NURBS layer.

To go **better than Parasolid** in specific ways foundation can
realistically beat:

- **Web-native delivery** — foundation runs in any browser via WASM.
  Parasolid is a desktop C++ DLL that requires installer + machine-
  specific licence. Foundation lives at a URL.
- **Open-source numerics layer** — manifold-3d (MIT) + (eventually)
  OpenCascade (LGPL) or our own NURBS library with no commercial
  licence cost.
- **Full physics + manufacturing in one stack** — foundation has 7
  validated CAE solvers, SIMP topology opt, FSI coupling, slicer +
  G-code, CAM toolpath — all things Parasolid does NOT include
  (Siemens sells those as add-on Simcenter modules).
- **Modern code shape** — small focused JS files, every solver
  validated against textbook reference, single-page test specs.
  Parasolid is a closed binary; nobody outside Siemens reads its
  source.

## Sequencing — first 6 weeks of upgrade work

Phased so each step adds visible new capability + validation before
the next starts.

### Phase 1 — NURBS curves _(in progress now)_

- `NURBSCurve.js`: control points, weights, knot vector, degree
- de Boor evaluation
- Derivatives (curve + first / second derivative vectors)
- Knot insertion (preserves curve, doubles control point count locally)
- Bézier extraction (split a NURBS into Bézier segments)
- Tessellation to polyline with adaptive chord-length subdivision
- **Validation**: quarter-circle as rational quadratic Bézier — every
  evaluated point lies on the circle to machine precision

### Phase 2 — NURBS surfaces _(next iteration)_

- `NURBSSurface.js`: tensor-product B-spline with control net + 2
  knot vectors + weights
- de Boor evaluation in 2 directions
- Partial derivatives (∂/∂u, ∂/∂v, normals)
- Isoparametric curves
- Knot insertion in u or v
- Tessellation to triangle mesh with adaptive curvature-driven sampling
- **Validation**: sphere from 6 NURBS patches; cylinder as a single
  NURBS surface; both produce points on the analytic surface to
  10⁻¹² m

### Phase 3 — NURBS-polygonal interop _(then)_

- Tessellate NURBS to manifold-3d Manifold with controlled chord
  tolerance → unlocks all existing foundation modules (FEM, slicer,
  drawing, etc.) on NURBS-native input
- Boolean union / subtract / intersect: tessellate, do polygonal
  boolean, optionally re-fit NURBS on output (the **re-fit** is the
  hard step — Parasolid does it directly on NURBS)

### Phase 4 — STEP exporter upgrade

- Emit B_SPLINE_CURVE_WITH_KNOTS, B_SPLINE_SURFACE_WITH_KNOTS,
  RATIONAL_B_SPLINE_*, TRIMMED_CURVE — all the AP203 NURBS schema
  entities
- Round-trip foundation NURBS → STEP → NX → screenshot

### Phase 5 — Variable-radius fillet on NURBS

Real first feature operation that exploits NURBS exactness. Validate
against an FEM stress concentration on a filleted vs sharp corner.

### Phase 6 — Direct / synchronous prototype

Push-pull a face → infer the feature back-edit (extend or shorten an
extrude, change a fillet radius). Hardest item. Multi-iteration work.

## What ships **today** (Phase 1)

- `frontend/src/foundation/NURBSCurve.js` — full Cox-de Boor +
  de Boor evaluation, knot insertion, derivatives, Bézier extraction,
  adaptive tessellation
- `e2e/foundation-nurbs-curve.spec.js` — validation: quarter circle
  exact to 1e-15, helix, knot insertion preserves curve, tessellation
  chord error ≤ tolerance

After this, Phase 2 (NURBS surfaces) is the next concrete piece.
