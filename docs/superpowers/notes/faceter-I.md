# SP-7 — Faceter Option Surface (Area I — Faceting & Tessellation)

**Date:** 2026-05-22
**Branch:** `archdisc`
**Program:** Kernel-Parity Program §4 — SP-7 (Phase K2, T1, no hard dependency)
**Status:** DONE — recon + facade + UI + in-motion e2e all green.

Brings ArchDisc Area I from **Thin** (single render mesh at a fixed deflection,
no faceter option surface, no silhouette/hidden-line) to a genuine
Parasolid/ACIS-grade faceter control surface.

---

## 1. Recon — what the bundled kernel faceter API actually exposes

**Spec:** `e2e/brep-i-faceter-recon-electron.spec.js` →
`docs/superpowers/notes/kernel-api-I-recon.json`. All 6 items PASS.

Bundled kernel: `opencascade.js@2.0.0-beta.b5ff984`.

| # | Probe | Verdict |
|---|---|---|
| 1 | `BRepMesh_IncrementalMesh` constructor forms | **Both bound.** `_2(shape, linDefl, isRelative, angDefl, parallel)` (explicit-args) and `_3(shape, IMeshTools_Parameters, progressRange)` (parameters form). |
| 2 | `IMeshTools_Parameters` writable fields | **All 9 bound & round-trip:** `Deflection`, `Angle`, `DeflectionInterior`, `AngleInterior`, `MinSize`, `Relative`, `InParallel`, `AllowQualityDecrease`, `ControlSurfaceDeflection`. |
| 3 | Chordal-deflection effect (sphere r=25) | **Works.** linear tol 2.0→0.5→0.05 mm ⇒ 128→520→5008 triangles (monotonic, 39× coarse→fine). |
| 4 | Angular-deflection effect (cylinder r=20) | **Works.** With linear tol fixed at 5.0 mm, angular tol 1.2→0.15 rad ⇒ 40→332 side facets (8.3×). |
| 5 | `HLRBRep_Algo` hidden-line / silhouette | **Fully bound.** Pipeline: `HLRBRep_Algo_1()` → `Projector_1(HLRAlgo_Projector_2(gp_Ax2))` → `Add_2(shape, 0)` → `Update()` → `Hide_1()` → `HLRBRep_HLRToShape(Handle_HLRBRep_Algo_2(algo))` with `VCompound_1` (visible sharp), `OutLineVCompound_1` (visible silhouette), `HCompound_1` (hidden sharp), `OutLineHCompound_1` (hidden silhouette). |
| 6 | Edge discretisation (HLR edge → polyline) | **Bound.** `BRepAdaptor_Curve_2(edge)` + `GCPnts_UniformDeflection_2(adaptor, defl, withControl)` — the **3-arg** overload. |

### Binding gotchas found (recorded honestly)

- **`IMeshTools_Parameters` ctor is UNDECORATED.** `new oc.IMeshTools_Parameters()`
  works; `IMeshTools_Parameters_1` is *not* a constructor. (Initially the facade
  hardcoded `_1`, silently fell back to the explicit-args form — caught by the
  e2e telemetry `usedParametersForm:false` and fixed.)
- **`HLRBRep_HLRToShape` wants a `Handle_HLRBRep_Algo`, not the raw object.**
  Passing the raw `HLRBRep_Algo` throws
  `Expected ... Handle_HLRBRep_Algo, got ... Standard_Transient`. The handle is
  obtained via `new oc.Handle_HLRBRep_Algo_2(algo)`.
- **`HLRBRep_Algo.Add` is multi-arg.** `Add_1` wants 3 args, `Add_2` wants 2;
  `Add_2(shape, 0)` (the `(shape, nbIso)` form) is the working call. The
  `Projector` must be set *before* `Add`.
- **`GCPnts_UniformDeflection` is the 3-arg `(adaptor, defl, withControl)`
  overload**, not the 5-arg `(adaptor, defl, U1, U2, withControl)` form.

**Net: there is NO binding gap for Area I.** The HLR pipeline is fully usable —
the facade uses OCCT hidden-line directly. (A pure-JS mesh-edge silhouette
extractor is *also* provided — not as a fallback for a gap, but as a fast
kernel-free path for live per-frame viewport silhouette overlays.)

---

## 2. Facade — `frontend/src/kernel/brep/BrepFaceter.js`

Exported through `kernel/brep/index.js` and `ArchDiscKernel.brep.*`.

### Controlled-deflection faceting

- **`facetShape(brepShape, opts)`** — the controlled-deflection meshing entry
  point. Exposes BOTH **chordal (linear) deflection** AND **angular deflection**
  as independent real parameters. Uses the `IMeshTools_Parameters` constructor
  (sets boundary *and* interior tol — the Parasolid-grade path); falls back to
  the explicit-args `BRepMesh_IncrementalMesh_2` form if that ever fails.
  Returns `{positions, normals, indices, triangleCount, vertexCount, faceCount,
  degenerateFaces, params}`.
- **`facetRenderMesh` / `facetAnalysisMesh`** — the two quality-profile
  conveniences.
- **`resolveFaceterParams(bboxDiag, opts)`** — resolves effective chordal +
  angular + min-size from a profile or explicit overrides, with all edge-case
  clamping; pure, unit-testable.

### Render vs analysis quality profiles (`FACETER_PROFILES`)

| Profile | Chordal | Angular | Min-size | ControlSurfaceDeflection | Intent |
|---|---|---|---|---|---|
| `render` | bboxDiag / 800 | 28° | bboxDiag / 25000 | off | display-tuned, fast |
| `analysis` | bboxDiag / 6000 | 8° | bboxDiag / 200000 | **on** | simulation / curvature-grade (~7.5× finer) |

The analysis profile turns on `ControlSurfaceDeflection` so each triangle's
deviation from the true surface is re-validated — a genuinely finer mesh.

### Hidden-line / silhouette

- **`hiddenLineProjection(brepShape, opts)`** — exact OCCT HLR. Orthographic
  projector along a view direction; returns `{visibleSharp, visibleOutline,
  hiddenSharp, hiddenOutline}` as polyline arrays (mm) plus `edgeCount`.
- **`meshSilhouette(positions, indices, viewDir)`** — pure-JS silhouette: a
  mesh edge is a silhouette edge when its two adjacent triangles straddle the
  view direction (`dot(nA,view) · dot(nB,view) < 0`); open boundary edges are
  always silhouette. Welds vertices on a 0.1 µm grid so coincident-but-distinct
  indices are recognised. The standard real-time silhouette test
  (Hertzmann 1999). Fast, kernel-free — for live viewport overlay.

### Edge-case handling (all in `resolveFaceterParams` / `extractTriangles`)

- **Runaway guard:** an absurdly tight chordal tol vs a large model
  (`bboxDiag / chordal > 2e6`) is clamped and a warning is emitted — the
  triangle budget cannot explode.
- **Hard clamps:** chordal ∈ [1e-4, 1e4] mm; angular ∈ [1.1°, 80°].
- **Min-size** is forced below half the chordal tol so it never starves the
  mesher.
- **Degenerate faces:** faces with a null triangulation, < 3 nodes, or < 1
  triangle are skipped and counted in `degenerateFaces` (surfaced to the user).
- **Non-identity face locations** and **reversed face orientation** handled in
  triangle extraction.

---

## 3. UI — the faceter control surface (ribbon-integrated, no floating panel)

Two ribbon tools in a new **Faceting** group on the Part tab (alongside the
Surface group where Catmull-Clark / Retopo live). Registered in
`RibbonToolbar.jsx` (the e2e-driven ribbon) and `WorkbenchMechanical.jsx`
`RIBBON_TABS` (the left-toolbar dropdown). Handlers in
`ToolExecutionEngine.js` `surface` group; schemas in `ToolParamSchemas.js`.

### `Faceter Controls`

Selection-driven (consumes the viewport-selected body via `_pickFacetTarget`,
mirroring `_pickBodies(1)` priority). Param dialog:

- **Quality profile** — enum `render | analysis`.
- **Chordal (linear) deflection** — mm; 0 = profile default.
- **Angular deflection** — °; 0 = profile default.
- **Minimum triangle edge** — mm; 0 = auto.

Re-tessellates the selected body **in place** — `_replaceGroupMesh` rebuilds
the `THREE.Mesh` inside the body's *existing* scene group (same body, same id,
no churn) and adds a wireframe overlay so the facet-density change is visible
from any angle. The body re-tessellates live in the viewport.

### `Hidden Line / Silhouette`

Param dialog: view direction X/Y/Z + show-hidden toggle. Runs the OCCT HLR
projection and the pure-JS mesh silhouette; draws an overlay group — visible
sharp edges solid dark, silhouette outlines solid blue, hidden edges dashed.

`window.__lastFaceterMesh` and `window.__lastHiddenLine` mirror the result for
e2e introspection and AI introspection.

---

## 4. e2e gate — `e2e/brep-i-faceter-electron.spec.js`

In-motion spec using `motionCapture.js` (`launchWithCapture`, `clickBody`,
`addToSelection`, `dragOrbit`, `story.frame`/`finish`) + `orbitCapture.js`.
ONE `test()`. Drives the ENTIRE workflow via real ribbon clicks + real
viewport picks — no programmatic injection of geometry.

**Complex real-world model (faceter as the climactic step):**
Cylinder (r=22, h=50) → Fillet rims (r=5) → Sphere (r=26) → Combine (union)
⇒ a curved compound capsule-like body.

**Climax steps:**
- A — `Faceter Controls`, render profile, chordal 4.0 mm / 45° → coarse mesh.
- B — `Faceter Controls` *again on the same body*, analysis profile,
  chordal 0.08 mm / 6° → fine mesh.
- C — `Hidden Line / Silhouette` along a view direction.

Multi-angle drag-orbit capture (`captureAllAngles`) after each re-faceting.

### Measured (gate run, all assertions green)

| Step | Result |
|---|---|
| COARSE facet | **271 triangles**, render profile, `usedParametersForm: true` |
| FINE facet | **12 719 triangles**, analysis profile, `usedParametersForm: true` |
| Coarse → fine ratio | **47×** — the IMeshTools interior-deflection control genuinely bites (floor asserted ≥ 8×) |
| Re-faceting in place | same `bodyId` both times — verified |
| OCCT HLR | 2 visible-sharp + 5 silhouette + 5 hidden = **12 edges** extracted |
| Pure-JS mesh silhouette | **91 straddling segments** |
| Blank frames | 0 across all 17 drag-orbits |
| Session video | 7.3 MB `.webm`, 29 storyboard stills |

### Visual verification (read the stills — past-lesson compliance)

The captured stills were inspected directly:
- `08-after-faceter-coarse.png` — chunky low-poly capsule, coarse orange
  wireframe, large triangular facets.
- `15-after-faceter-fine.png` — the SAME body re-tessellated to a dense, smooth
  green mesh (analysis-profile tint); facet density unmistakably higher.
- `orbit-faceter-coarse-03.png` / `orbit-faceter-fine-03.png` — the
  density contrast holds from other camera angles.
- `24-after-hiddenline.png` — HLR edge overlay rendered on the body.

The re-tessellation is genuinely visible — not a data-only check.

---

## 5. Honest gaps

1. **HLR overlay edges are placed in world space, not re-projected to a 2D
   drawing plane.** `hiddenLineProjection` extracts the correct visible/hidden/
   silhouette *3D* edges via OCCT HLR and the tool draws them as a viewport
   overlay. It does not yet flatten them into a 2D engineering-drawing sheet —
   that is the Drawing-tab's job; SP-7 delivers the kernel edge set + the live
   overlay, not the paper-space drawing composition.
2. **`Relative` deflection mode not surfaced in the dialog.** The facade always
   passes `Relative: false` (absolute tol — the predictable, Parasolid-default
   behaviour). The kernel field is bound; exposing the relative-tol mode is a
   small future dialog addition.
3. **No per-face faceter overrides.** Deflection is per-body. Parasolid allows
   per-face faceter tolerance; that needs the SP-1 unified topology spine
   (per-face attributes) and is out of SP-7 scope.
4. **Pure-JS silhouette is mesh-resolution-bound.** `meshSilhouette` finds
   silhouette edges on the *tessellated* mesh — its fidelity tracks the render
   mesh density. For an exact silhouette, `hiddenLineProjection` (OCCT HLR on
   the B-rep) is the authoritative path; the mesh silhouette is the fast
   per-frame approximation.

---

## 6. Files

**New**
- `frontend/src/kernel/brep/BrepFaceter.js` — the faceter facade.
- `e2e/brep-i-faceter-recon-electron.spec.js` — kernel API recon (6 items).
- `e2e/brep-i-faceter-electron.spec.js` — in-motion gate.
- `docs/superpowers/notes/kernel-api-I-recon.json` — recon output.
- `docs/superpowers/notes/faceter-I.md` — this note.

**Modified**
- `frontend/src/kernel/brep/index.js` — barrel export of the faceter API.
- `frontend/src/kernel/brep/ArchDiscKernel.js` — `brep.facetShape` /
  `facetRenderMesh` / `facetAnalysisMesh` / `hiddenLineProjection` /
  `meshSilhouette` / `resolveFaceterParams` / `faceterProfiles`.
- `frontend/src/foundation/ToolParamSchemas.js` — `Faceter Controls` +
  `Hidden Line / Silhouette` schemas.
- `frontend/src/components/RibbonToolbar.jsx` — `Faceting` ribbon group.
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` —
  `Faceting` dropdown section.
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` —
  `Faceter Controls` + `Hidden Line / Silhouette` handlers, `_pickFacetTarget`
  + `_replaceGroupMesh` helpers.
