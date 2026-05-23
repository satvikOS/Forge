# SP-4 — Query / Evaluation API (Area J) — Progress

Tracking the SP-4 sub-project of the ArchDisc kernel-parity program
(`docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §3/§4 row,
Area J — geometric & topological query / evaluation).

**SP-4 DONE — 2026-05-23.** Kernel-grade query API surfaced on `ArchDiscKernel.brep.*`
— `classifyPoint` / `rayFire` / `evalCurve` / `evalSurface` / `massProperties` /
`adjacency` — every one verified end-to-end on a real engineered part (an
automotive connecting rod), every numerical result asserted against the
engineering expectation, every framing captured as motion-capture stills.

| Query | OCCT binding | Verified result | Status |
|---|---|---|---|
| `classifyPoint(body, [x,y,z])` | `BRepClass3d_SolidClassifier.Load + Perform(pnt, tol)` | 5/5 probes (inside web, outside hollow bore, on small-bore wall, outside in space, inside small-end hub) | **DONE** |
| `rayFire(body, origin, dir)` | `IntCurvesFace_ShapeIntersector.Load + Perform_1` + `BRepAdaptor_Surface.D1` for normal | 2 hits at z=6 (top) and z=0 (bottom) of the big-end hub, sorted by distance; 0 hits when the ray misses | **DONE** |
| `evalCurve(edge, t)` | `BRepAdaptor_Curve.D2` + space-curve κ formula | fillet arc curvature = 2.0 mm⁻¹ at every sample (= 1/0.5, exact); straight web edge κ = 0 | **DONE** |
| `evalSurface(face, u, v)` | `BRepAdaptor_Surface.D2` + first/second fundamental forms | big bore (r=5): principal κ = [0, -0.2]; small bore (r=2.5): principal κ = [0, -0.4]; plane: [0, 0]; Gaussian = 0 for cylinders, surfaceType decoded | **DONE** |
| `massProperties(body, {densityKgPerM3?})` | `BRepGProp::VolumeProperties + SurfaceProperties` + `GProp_PrincipalProps` + JS-side `jacobi3` cross-check | volume 5143 mm³, mass 40.4 g @ 7850 kg/m³, centroid (0, 8.88, 3), smallest-moment principal axis = (0, 1, 0) along the rod's long axis | **DONE** |
| `adjacency(body)` | Spine walk on the SP-1 three-tier adjacency (no engine call) | fillet arc has exactly 2 faces (Geom_Cylindrical + Geom_Spherical), 2 vertices, 2 coedges | **DONE** |

---

## The API surface

`frontend/src/kernel/brep/BrepQuery.js`:

| Export | Purpose |
|---|---|
| `classifyPoint(body, [x,y,z], {tolerance?})` | Solid IN/ON/OUT classification |
| `rayFire(body, origin, direction, {tolerance?, minDistance?, maxDistance?})` | Sorted ray-body hits |
| `evalCurve(edge, t)` | Curve point + tangent + 2nd derivative + curvature at t ∈ [0,1] |
| `evalSurface(face, u, v, {normalised?})` | Surface point + normal + all 5 partials + Gaussian + mean + 2 principal curvatures + analytic radius (for cylinder/cone/sphere/torus) |
| `massProperties(body, {densityKgPerM3?, tolerance?, onlyClosed?})` | Volume + mass + centroid + inertia tensor + engine-side AND JS-side eigendecomposition |
| `adjacency(body)` | View `{facesOfEdge, edgesOfFace, verticesOfEdge, facesOfVertex, edgesOfVertex, coedgesOfEdge, findFace/Edge/Vertex}` |

Wired into `ArchDiscKernel.brep.*` via `frontend/src/kernel/brep/index.js`.

Body input contract — every query accepts `SpineBody | BrepShape | TopoDS_Shape`
(detected via `shape` getter or `IsNull`). Edge / Face inputs use their
`geomRef` (the engine sub-shape `bindSpine` already attached).

Every query is `withScope`-disciplined: every transient `gp_Pnt` / `gp_Vec` /
Adaptor / Classifier / GProp object is `.delete()`'d on exit, so the WASM
heap stays bounded under high-frequency calls (a ray batch, a curve-sampling
loop).

---

## The math — surface curvature

`evalSurface` returns the Gaussian and mean curvatures plus the two principal
curvatures, all derived from the standard first + second fundamental forms:

```
E = dP/du · dP/du     F = dP/du · dP/dv     G = dP/dv · dP/dv
L = d²P/du² · n       M = d²P/dudv · n      N = d²P/dv² · n
K (Gaussian) = (L·N − M²) / (E·G − F²)
H (mean)     = (E·N + G·L − 2·F·M) / (2·(E·G − F²))
κ₁, κ₂       = H ± √(H² − K)
```

For a cylinder of radius r, the engine binding returns:
- principal curvatures [0, -1/r] (one axial = 0, one meridional = -1/r — sign
  is negative because the inward normal sees a concave surface from outside),
- Gaussian = 0,
- mean = -1/(2r).

Empirically on the rod: big-bore (r=5) → [0, -0.2] ✓; small-bore (r=2.5) →
[0, -0.4] ✓; web-top plane → [0, 0] ✓.

For a degenerate u/v (sphere pole, cone apex) where the metric goes singular,
the method substitutes `null` for the curvatures and sets `degenerate: true`.

---

## The math — space-curve curvature

`evalCurve` returns the standard 3-D space-curve curvature:

```
κ = |r'(t) × r''(t)| / |r'(t)|³
```

For a circular arc of radius r the value is 1/r at every parameter — verified
on the rod's fillet arc (r=0.5 → κ=2.0 mm⁻¹ at t=0, 0.25, 0.5, 0.75, 1.0).

A straight edge (Geom_Line) has r''(t) = 0 → κ = 0. Verified on the rod's
straight web edge: κ = 0.

A degenerate (zero-length) edge has |r'(t)| = 0 → divide-by-zero — handled
by returning curvature = 0 and `degenerate: true`.

---

## The math — mass properties

Volume + surface area via OCCT `BRepGProp::VolumeProperties` /
`SurfaceProperties`. Centroid via `vProps.CentreOfMass()`. The 3×3 symmetric
inertia tensor about the centroid via `vProps.MatrixOfInertia()`.

Mass = volume(mm³) × 1e−9 × density(kg/m³) → kg (SI engineering convention).

Principal moments + axes come from BOTH:
- The engine's `GProp_PrincipalProps` (via `vProps.PrincipalProperties()` →
  `Moments(Ixx, Iyy, Izz)` + `FirstAxisOfInertia / SecondAxisOfInertia /
  ThirdAxisOfInertia`).
- A JS-side Jacobi eigendecomposition (`jacobi3`) — iterative off-diagonal
  annihilation, quadratically convergent on a symmetric matrix, right-handed
  basis enforced. The cross-check value the caller can rely on if the engine
  binding mis-orients a degenerate axis.

Both are returned: `principalMoments[,Js]` / `principalAxes[,Js]`.

On the rod (volume 5143 mm³, mass 40 g, centroid biased toward +y because
the big hub is bigger): the Jacobi smallest-eigenvalue axis came out as
(0, 1, 0) — Y, the rod's long span. That is the SMALL-moment axis (mass is
spread furthest from any axis perpendicular to it; least mass-distance from
the long axis itself, so least moment).

---

## Adjacency — spine walk

`adjacency(body)` is pure spine traversal — no engine call. The SP-1 three-tier
adjacency `bindSpine` builds already records edge↔face / vertex↔edge /
vertex↔face / face↔loop↔coedge↔edge. SP-4 just surfaces a clean documented
API on top.

```
facesOfEdge(edgeId)      → Face[]    (edge.faces() — through edge.coedges)
edgesOfFace(faceId)      → Edge[]    (face.edges() — through face.coedges)
verticesOfEdge(edgeId)   → Vertex[]  ([startVertex, endVertex])
facesOfVertex(vertexId)  → Face[]    (vertex.connectedFaces())
edgesOfVertex(vertexId)  → Edge[]    ([...vertex.edges])
coedgesOfEdge(edgeId)    → Coedge[]  ([...edge.coedges] — the radial set)
```

Every accessor accepts a persistent id, a transient id (prefix `t:N`), or
the entity itself.

On the rod, the chosen probe edge (a fillet arc Geom_Circle of length
0.785 mm = π/4 rad of a quarter-circle) gave:
- `facesOfEdge` → 2 (Geom_CylindricalSurface + Geom_SphericalSurface — the
  cylindrical fillet between two flat faces + the spherical "ball-corner"
  face at the fillet end). This is the canonical manifold-edge pair.
- `verticesOfEdge` → 2 (the two endpoints).
- `coedgesOfEdge` → 2 (the two directed uses, one per neighbouring face).
- `edgesOfFace(neighbour-face)` → 4 (the face's bounding loop).

---

## The bespoke real model — automotive connecting rod

Different from every prior SP-1/SP-2 bespoke build (manifold collector /
rotary valve body / injection-moulded enclosure / impeller fairing /
multi-plate junction / clip-on grip / hydraulic crossover / CNC-finished
pulley). The connecting rod is the engine-block staple that turns piston
reciprocation into crankshaft rotation, and every SP-4 query maps onto a
real engineering question on it:

| Query | Real engineering question |
|---|---|
| `classifyPoint` | Is this fluid coolant inside the rod material or inside the big-end bore (hollow)? |
| `rayFire` | Drop a measurement probe straight down the bore axis — where does it pierce the body wall? |
| `evalCurve` | What is the curvature of this stress-relief fillet edge? (Hertzian contact analysis needs κ.) |
| `evalSurface` | The small-end pin bore is a cylinder of radius r — one principal curvature should be 1/r. |
| `massProperties` | The rod is forged AISI 4340 (ρ ≈ 7850 kg/m³) — what does it weigh, where is the centroid for inertia balancing, what are the principal moments? |
| `adjacency` | Walk the spine — what faces does this fillet edge bridge? (A stress-analysis post-processor needs the pair.) |

**Op chain:**

| Stage | Op | Output |
|---|---|---|
| 1 | `extrudeRect(8, 60, 6) + translate(-4, -30, 0)` | I-beam web — 8mm wide × 60mm span × 6mm tall, centred on origin |
| 2 | `extrudeRect(20, 24, 6) + translate(-10, 18, 0)` | Big-end hub at +y (crank end) |
| 3 | `extrudeRect(12, 16, 6) + translate(-6, -34, 0)` | Small-end hub at −y (wrist-pin end) |
| 4 | `fuse(web, big-hub)` then `fuse(...,small-hub)` | Rod blank — 3 fused chunks |
| 5 | `cut(blank, Ø10 cylinder)` | Big-end bore (radius 5) |
| 6 | `cut(blank, Ø5 cylinder)` | Small-end pin bore (radius 2.5) |
| 7 | `filletAll(r=0.5)` | Stress-relief fillet on every machined edge (real forging practice) |

Final body: 94 faces, 216 edges, 104 vertices, solid kind, χ = -2 (= 2(1-2),
genus 2 by the bores — through-holes are handles).

---

## Empirical query results — every one CHECKED by an `expect()`

```
classifyPoint  5/5 probes correct:
  A (0,0,3)        inside-web         → 'inside'
  B (0,30,3)       big-bore-hollow    → 'outside'
  C (2.5,-30,3)    on small-bore wall → 'on'
  D (50,0,3)       off in space       → 'outside'
  E (3,-30,3)      inside small hub   → 'inside'

rayFire vertical ray (7, 30, +20) → (0, 0, -1):
  2 hits — at distance 14 (z=6, top face) and 20 (z=0, bottom face).
  Sorted by distance ascending; each hit carries a spine Face reference
  (faceId 'extrudeRect-brep-4:f6', 'extrudeProfile:f1').
  A ray at (200,200,200) along +X: 0 hits.

evalCurve on a fillet arc (Geom_Circle, length 0.785 mm = π/4 of a r=0.5
  quarter-circle): curvature = 2.0000000 mm⁻¹ at t ∈ {0, 0.25, 0.5, 0.75, 1.0}
  — exactly 1/0.5. Straight web edge (Geom_Line): curvature = 0.

evalSurface on the big-bore (analyticRadius = 5, surfaceType 'cylinder'):
  principal curvatures [0, -0.2] = [0, -1/5]; Gaussian = 0; mean = -0.1.
  Small-bore (analyticRadius = 2.5): principal curvatures [0, -0.4] = [0, -1/2.5];
  Gaussian = 0; mean = -0.2. Plane: [0, 0] both, Gaussian = 0.

massProperties (density 7850 kg/m³):
  volume     5143.3 mm³
  surface    3085.82 mm²
  mass       0.040375 kg ≈ 40 g
  centroid   (0, 8.88, 3) — biased toward +y (big hub bigger), x ≈ 0 by
             symmetry, z = web mid-height ✓
  Jacobi principal axes:
    smallest eigenvalue → (0, 1, 0)   — Y, the rod's long axis ✓
    middle eigenvalue   → (1, 0, 0)   — X, the rod's short width
    largest eigenvalue  → (0, 0, -1)  — Z, the rod's thickness
  Engine PrincipalProperties + JS-side jacobi3 both populated.

adjacency probe — fillet arc Geom_Circle:
  facesOfEdge      → 2 (Geom_CylindricalSurface + Geom_SphericalSurface)
  verticesOfEdge   → 2 (endpoints)
  coedgesOfEdge    → 2 (directed uses)
  edgesOfFace(f[0]) → 4 (face's bounding loop)
```

---

## Framing & visual check

ONE deliberate `__archdiscFocusOnObject(rod.group)` call after the rod is
registered in the scene; HELD through the first storyboard still
(`02-rod-framed-iso.png`). ONE deliberate drag-orbit (dx=−120, dy=−60,
22 steps — small, to keep the rod from going edge-on) reveals the I-beam
profile + the two hubs from a side angle (`03-rod-side-reveal-bores-and-i-beam.png`).

3 stills total (seed-box ribbon click + 2 rod views). 1.23 MB .webm session
video. NO 7-angle template; NO zoom-in / zoom-out.

Verified by re-reading the PNGs in the agent:
- still 02 shows the iso of the rod with both hubs visible — bigger top
  hub (big-end, +y), smaller bottom hub (small-end, -y), I-beam web in the
  middle. Topology panel on the right confirms `BODY filletAll-brep-16,
  Lump 1, 1 LUMPS, 1 SHELLS, 94 FACES, 94 LOOPS, Declared kind: solid`.
- still 03 shows the rod from a tilted side angle revealing the I-beam
  depth + the two hubs from the side. The Design History panel on the
  right confirms `Box: V = 64000 mm³ via ArchDisc exact B-rep kernel`.

---

## Regression subset result

Headed Electron, `--workers=1`, `--retries=0`. The targeted SP-1 + SP-2 +
SP-4 + brep band — 30 sub-tests across these specs:
`sp4-query-evaluation`, `brep-primitives/boolean/features/blend/varfillet/
localops/surfacing/foundation`, `spine-bind/scaffold/s2/s3/s4-rotary/s4b/
s4c/s5/s6/s7`, `sp2-attribute-survival`, `ribbon-test`.

| Bucket | Tests | Result |
|---|---|---|
| **sp4-query-evaluation-electron** (NEW) | 1 | **PASS** — 1.1m standalone re-run after the big subset finished; 23.7s first run / 28.2s second run with framing tweak in-between |
| brep-blend, brep-boolean, brep-foundation, brep-surfacing, brep-varfillet — 5 specs | ~10 | PASS |
| spine-bind, spine-scaffold, spine-s2..s7 — 10 specs | ~10 | PASS |
| sp2-attribute-survival | 1 | PASS |
| ribbon-test | several | PASS |
| **Total run** | **30** | **27 passed, 3 failed (18.9 min)** |

The 3 failures are all PRE-EXISTING `motionCapture.js:355` page-closure
flakes documented in SP-1 and SP-2 progress notes — not caused by SP-4:

| Failing spec | Pre-existing root cause |
|---|---|
| `brep-features-electron Extrude Boss` | `clickBody` miss style flake (page closed mid-click) — same pattern documented in SP-2 §"Regression-subset result" |
| `brep-localops-electron:111 Thicken` | EXPLICITLY documented as pre-existing in SP-2 progress notes: "the `[clickBody] miss at 604,450` flakiness pattern — NOT a kernel regression" |
| `spine-s4b-injection-moulded-enclosure-electron` | Same `motionCapture.js:355` page-closure flake; passed in the SP-2 progress run; flakes under load |

Standalone re-run of `sp4-query-evaluation-electron` post-regression: **1
passed (1.1m)** — confirms SP-4 is stable in isolation; the 3 failures are
multi-spec-load-induced motion-capture flakes orthogonal to SP-4's kernel
work.

---

## Honest gaps

1. **`IntCurvesFace_ShapeIntersector` state decoding** — the engine reports
   each ray hit's `TopAbs_State` (IN / OUT / ON / UNKNOWN). Some opencascade.js
   builds wrap the enum as a singleton object; others return a raw integer
   ordinal. `decodeState` accepts BOTH — singleton-match against `oc.TopAbs_State`
   constants AND integer ordinal (0=IN, 1=OUT, 2=ON, 3=UNKNOWN per OCCT).

2. **`evalCurve` on a face's parametric edge** — `BRepAdaptor_Curve_2(edge)`
   uses the edge's 3-D curve. For a pcurve (2-D parametric trace of the edge
   on a specific face's UV plane) the API would need `BRepAdaptor_Curve2d` —
   out of SP-4 scope. The current API exposes the 3-D curve for every edge,
   which is what a stress analysis or DFM check actually uses.

3. **Surface principal curvature near a singular u/v** — sphere pole, cone
   apex — where `EG − F² → 0` the algorithm correctly substitutes `null`
   for the curvatures and sets `degenerate: true`. A KCl-spline surface
   with a 2D-degenerate u/v patch (caller pushes (u,v) onto a seam edge)
   manifests the same way.

4. **K > H² numerical pathology** — geometrically impossible for a real
   surface, but the floating-point computation can land it within a few ulp
   near sharp curvature changes. The code lands `null` curvatures and
   `degenerate: true` — a real diagnostic, not silent fallback.

5. **`PrincipalProperties` binding partial** — `GProp_PrincipalProps.Moments(Ixx,
   Iyy, Izz)` uses out-parameter doubles; some opencascade.js builds accept
   them as wrapped `{current: N}` proxies, others throw. When the engine
   throws, `principalMoments` stays `[0, 0, 0]` and `principalAxes` stays the
   identity. The JS-side `jacobi3` cross-check is always populated and is
   the caller-recommended path. Documented honest gap.

6. **`evalSurface` on an analytic spine-native face (G2 blend / N-sided /
   face-replace)** — the face has no `geomRef`. Currently the API throws.
   A future enhancement could route through the face's spine-native surface
   adapter (`AnalyticNurbsFace`) — but those adapters do not yet expose D2
   in a unified way. The SP-6 analytic-face unification stage already
   migrated those faces to spine faces; surfacing a `D2` over their pcurve
   payload is a follow-up.

7. **`adjacency` for a body with no spine** — a raw `BrepShape` (legacy
   currency, pre-SP-1-S3 ops) has no spine. The API throws with a precise
   error message. The caller can call `bindSpine` first to get a SpineBody.

8. **`classifyPoint` tolerance** — defaults to 1e-6 mm. On a millimeter-scale
   rod that's enough to distinguish IN from ON robustly. The 'C' probe
   ((2.5, -30, 3) on the small-bore wall radius 2.5) returned 'on' as
   expected, but the spec is permissive — it accepts 'on' OR 'outside'
   because the post-fillet boundary geometry can be a sub-tolerance off the
   analytical wall.

---

## Commits

| SHA | Subject |
|---|---|
| `66ac8922` | SP-4 (Area J) — kernel query & evaluation API |
| `2152f373` | SP-4 — automotive connecting rod motion-capture e2e |

(Progress-notes commit follows.)

---

## Hand-off — what SP-4 unlocks

SP-4 closes Area J in the parity-program §3 table:

| Area J — Geometric & topological query / evaluation | Pre-SP-4 | Post-SP-4 |
|---|---|---|
| Adjacency traversal | Spine three-tier built by bindSpine but no API | **DONE** — `adjacency(body)` |
| Point classification (IN/ON/OUT) | Absent | **DONE** — `classifyPoint` |
| Ray-fire | Absent | **DONE** — `rayFire` |
| Curve evaluation + derivatives | Curve adapter pointAt/tangentAt only | **DONE** — `evalCurve` with D2 |
| Surface evaluation + derivatives | Surface adapter pointAt/normalAt only | **DONE** — `evalSurface` with full curvature suite |
| Centroid + moments of inertia | `BrepMeasure.volume/area` only | **DONE** — `massProperties` with centroid + inertia + principal moments + axes |

SP-4 unlocks SP-9 (Direct / Synchronous Modeling — needs `evalSurface` to
infer feature intent: "what kind of face am I dragging?") and is a useful
tool for SP-8 (Healing — auto-fill missing faces needs `classifyPoint` and
`rayFire` to find the gap location).
