# Forge MCAD Parity Push — 2026-06-04 onward

User directive: bring all 18 dimensions to genuine, no-stub operational state with multi-cam e2e
proof. Tracks real parity %; no cosmetic counts. Updated after every CI-green batch.

| # | Dimension | Start | Target | Current | Last batch |
|---|---|---|---|---|---|
| 1 | Kernel (OCCT depth utilisation) | 35 % | 80 % | 40 % | PUSH-34 (edge polylines) |
| 2 | Solid modeling ops | 8 % | 80 % | 18 % | PUSH-34 (pick-edge fillet/chamfer) |
| 3 | Sketch / 2D constraints | 18 % | 80 % | 40 % | PUSH-35 (sketch on datum planes) |
| 4 | Assembly (mates, configs, BOM) | 4 % | 80 % | 4 % | — |
| 5 | Drawings / 2D output | 3 % | 80 % | 3 % | — |
| 6 | Sheet metal | 0 % | 80 % | 0 % | — |
| 7 | Surfacing | 0 % | 80 % | 0 % | — |
| 8 | Mold / casting / tooling | 0 % | 80 % | 0 % | — |
| 9 | Routing (piping / cable) | 0 % | 80 % | 0 % | — |
| 10 | CAM / manufacturing | 0 % | 80 % | 0 % | — |
| 11 | Simulation (FEA/CFD/motion) | 3 % | 80 % | 3 % | — |
| 12 | PMI / GD&T | 0 % | 80 % | 0 % | — |
| 13 | Standard parts libs | 4 % | 80 % | 4 % | — |
| 14 | PDM / PLM | 0 % | 80 % | 0 % | — |
| 15 | Generative / topology | 0 % | 80 % | 0 % | — |
| 16 | Engineering calculators | 200 % | 200 % | 200 % | held |
| 17 | UI/UX (ribbon/search/menus) | 12 % | 80 % | 16 % | PUSH-35 (Datum group + role) |
| 18 | API / customization | 5 % | 80 % | 5 % | — |
| 19 | Visualization | 8 % | 80 % | 8 % | — |

## Test workflows queued (progressive complexity)

- Ferrari V8 piston (single-part, drawings, FEA stress)
- Mercedes inline-6 crankshaft (multi-feature part, balance, fatigue)
- Boeing 787 wing rib (sheet metal + assembly + GD&T)
- Airbus A320 landing-gear strut (hydraulic routing + simulation)
- Industrial gearbox housing (mold + CAM + PDM)
- Factory conveyor frame (routing + standard parts + drawings)

## Batch log

(Each commit batch records: dimensions touched, CI run URL, multi-cam e2e snapshot dir.)

### PUSH-35 — Reference geometry / datum planes [2026-06-06]
- **Dimensions touched**: #3 Sketch (sketch on a datum plane), #17 UI/UX
  (Datum toolbar group + role wiring).
- **JS**: ReferenceGeometry.js gains parametric datum factories —
  offsetPlaneSpec, planeThrough3PointsSpec, midPlaneSpec,
  axisFrom2PointsSpec, axisFromPlaneIntersectionSpec (pure geometry,
  5/5 unit tests in DatumConstructors.test.mjs).
- **Wiring**: new 'Datum' toolbar group (offsetPlane/plane3pt/midPlane/
  axis2pt) + tool schemas; ForgeShellV4 datum.* handler registers the datum
  (datumPlanes state, window.__forgeDatums) and for planes auto-opens a
  sketch ON it — composing with the PUSH-32 custom-plane sketch path so a
  datum-plane sketch + extrude builds geometry at the datum's location.
- **Pitfall fixed (documented)**: the forge-v4 Toolbar is ROLE-FILTERED via
  roleTemplates.js — a new toolgroup silently won't render unless its label
  is in the active role's toolbarGroups. Added 'Datum' to the 'designer'
  role's mech groups.
- **E2E**: push-35-datum-planes.spec.js (headed, MP4) — create Offset Plane
  50mm above XY (auto-opens sketch, asserts origin z≈50), rect+extrude →
  assert solid spans z[50,70] (built on the datum, NOT world XY); 3-point +
  mid-plane datums register (mid = z40, halfway 0..80). 4/4 pass. Kernel
  smoke + V12 regression unaffected.
- **CI**: see commit push.

### PUSH-34 — Edge picking (fillet/chamfer on a picked edge) [2026-06-06]
- **Dimensions touched**: #1 Kernel (edge polylines), #2 Solid modeling
  (single-edge fillet/chamfer), #17 UI/UX (viewport edge-filter picking).
- **Kernel**: `direct.edgeSegments(shape, deflection)` samples every edge
  into a world-space polyline (GCPnts_TangentialDeflection) tagged with the
  SAME 0-based TopExp_Explorer edge id that part.filletEdges/edgeById uses.
  Verified: box → 24 enumerated edges (12 unique ×2 shared faces), edge 0 =
  (0,0,0)→(0,0,20), filletEdges([0],5) drops exactly 160.95 mm³.
- **Wiring**: preload exposes edgeSegments; new `EdgePickOverlay` renders each
  edge as a clickable line (fat invisible hit-line + visible line) in
  edge-filter mode; click → {kind:'edge', bodyHandle, edgeId}; dispatch ctx
  gains selectedEdges + pickedBody; pickTarget honors pickedBody so
  fillet/chamfer round the PICKED edge (else the PUSH-31 all-edges fallback).
- **E2E**: push-34-edge-picking.spec.js (headed, MP4) — build 60×40×30 block,
  assert kernel emits pickable edges w/ fillet id convention, enter edge
  filter, pick edge 0, fillet R5, assert volume drop ≈161 mm³ (single edge,
  NOT all-edges). 4/4 pass. Pitfall fixed: dismiss stale autosave banner /
  context menu before the toolbar click (was intercepting it).
- **CI**: see commit push.

### PUSH-33 — Arbitrary-face picking (face-id tessellation) [2026-06-06]
- **Dimensions touched**: #1 Kernel (face-id mesh map), #3 Sketch (sketch on
  ANY picked face), #17 UI/UX (viewport face-filter selection).
- **Kernel**: `Mesh` gains a per-TRIANGLE `faceIds` array (1-based, same
  TopExp_Explorer order as inferFeature/faceById); tessellate() populates it
  and binding emits a Uint32Array `faceIds`. Verified: box → faceIds
  [1,1,2,2,3,3,4,4,5,5,6,6] (6 faces, 2 tris each).
- **Wiring**: Viewport keeps the faceIds map per mesh + on userData; a click
  in face-filter mode resolves intersection.faceIndex → BREP faceId and
  reports {kind:'face', bodyHandle, faceId, point}; sketch.new 'Top face of
  body' prefers the PICKED face, else auto top-face. deriveFacePlane now
  orients the face normal OUTWARD (inferFeature normals can point inward on
  -X/bottom faces) using the body AABB center, so boss=+normal / cut=-normal
  are always correct on any wall.
- **E2E**: push-32 spec extended — test 05 picks a vertical SIDE face via
  the kernel + __forgeSelect, opens a sketch on it (asserts horizontal
  normal + matching faceId), extrudes a boss, asserts volume GREW (boss grew
  outward off the wall). 7/7 pass. V12 regression unaffected.
- **CI**: see commit push.

### PUSH-32 — Sketch-on-face (#216) [2026-06-06]
- **Dimensions touched**: #3 Sketch/2D (sketch-on-arbitrary-plane), #2 Solid
  modeling (extrude-cut on a model face — the SW newcomer workflow).
- **Kernel**: new `forge::part::extrudeProfileOnPlane(sketch, distance,
  origin, normal, uDir, sign)` — relocates the local 2D profile onto an
  arbitrary world plane via `gp_Trsf`/`gp_Ax3` and extrudes along the normal
  (+sign boss / -sign cut). Real OCCT geometry, verified: tilted/offset/wall
  planes all place + extrude exactly; cut(plate, face-bore) = 931 725.67 mm³
  (= 200×120×40 − π·15²·40, exact).
- **Wiring**: preload exposes part.extrudeProfileOnPlane (was the missing
  link — contextBridge whitelist); sketchSession.js carries a custom plane
  frame {origin,normal,u,v} + deriveFacePlane() (kernel inferFeature →
  top-face plane); ForgeShellV4 'Top face of body' opens a sketch ON the
  picked/last body's top face; kernelDispatch solid.extrude uses the frame +
  honors Cut/Add/Intersect. Fixed: sketch.new/finish no longer swallowed by
  the entity-tool branch when a finished session lingers.
- **Hooks**: window.__forgeSelect, window.__forgeCurrentSketch.
- **E2E**: e2e/push-32-sketch-on-face.spec.js (headed, MP4) — builds a
  200×120×40 plate, opens a sketch on its TOP face (asserts custom plane,
  origin z≈40, normal≈+Z), bores Ø30 through with extrude-CUT, asserts final
  body volume dropped by the bore volume. 6/6 pass.
- **CI**: see commit push.

