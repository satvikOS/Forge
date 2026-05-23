# UX-Track Progress — SolidWorks + NX Conventions in ArchDisc

**Last updated:** 2026-05-23 (Tier-11a NX selection-priority pre-filter shipped)

This file tracks ArchDisc's progress closing the SolidWorks UX gap list documented in
[`solidworks-course-synthesis.md`](./solidworks-course-synthesis.md). The gap list is
organized by 10 tiers (universal conventions → workbench-scale additions). This file
records which items have shipped, are partial, or remain outstanding.

---

## Tier 1 — Universal SolidWorks conventions (4 of 10 done)

| # | Convention | Status | Implementation |
|---|---|---|---|
| 1 | Confirmation Corner (top-right viewport) | **DONE** | `frontend/src/components/SwUxOverlays.jsx::ConfirmationCorner` + `.sw-confirm-corner` CSS; event bus `confirmationBus` so any tool can request it; PropertyManagerDock auto-activates it when it opens |
| 2 | PropertyManager docked left | **DONE** (13 tools) | `SwUxOverlays.jsx::PropertyManagerDock` + `DOCKED_TOOLS` set (Extrude/Revolve/Loft/Sweep Boss + Cut, Fillet, Chamfer, Shell, Hole Wizard, Draft, Linear Pattern, Circular Pattern). Floating `ToolParamDialog` skips migrated tools so the two never collide. Sections collapsible (INPUTS + OPTIONS placeholder) |
| 3 | Sketch under/full/over-defined colour states | **DONE** | `SketchSolver.signedDOF()` (signed, replaces the previously-clamped DOF), `isOverConstrained()` now correct; `InteractiveSketch.applyDoFColouring()` recolours line/circle/arc entity visuals; bottom-left `SketchStateBadge` shows the state text + DoF count |
| 4 | Sketch live cursor coordinate readout | **NOT THIS PASS** | StatusBar exists but cursor X/Y feed not wired |
| 5 | Heads-up View Toolbar | **DONE (partial primitives)** | `SwUxOverlays.jsx::HeadsUpViewToolbar` with Zoom-Fit, Zoom-to-Area, Section View, View Orientation drop (7 standard views), Normal-To, Display Style drop (4 modes). **Honest gaps:** Zoom-to-Area falls back to focus-on-selection (no marquee-drag hook in viewport); Section View toggles X-Ray as the minimum visible effect (no foundation section-clip primitive exposed); Normal-To always faces Front rather than the picked-face normal (the picked-face data isn't reliably surfaced from the viewport handler) |
| 6 | Double-click-dimension-to-edit | **NOT THIS PASS** | |
| 7 | Auto-relations icon on cursor while drawing | **NOT THIS PASS** | |
| 8 | `(f)` fixed-component prefix in assembly tree | **NOT THIS PASS** | |
| 9 | Right-click conventions in FeatureManager (full audit) | **NOT THIS PASS** | Context menu exists with basic entries; SW completeness audit not done |
| 10 | Rollback bar in Feature Manager Design Tree | **NOT THIS PASS** | |

**Files added/changed for Tier-1:**

- `frontend/src/components/SwUxOverlays.jsx` (new — 4 components + event bus)
- `frontend/src/components/SwUxOverlays.css` (new — overlay styling)
- `frontend/src/components/ToolParamDialog.jsx` (modified — skip docked tools)
- `frontend/src/kernel/sketch/SketchSolver.js` (modified — `signedDOF()`, correct over-constrained)
- `frontend/src/kernel/sketch/InteractiveSketch.js` (modified — `applyDoFColouring()`, `addDistanceConstraint()`, status now exposes `state` + `signedDof`)
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` (modified — mount the four overlays in viewport)
- `e2e/ux-tier1-electron.spec.js` (new — motion-capture e2e with 10 frames + .webm)

**E2E:** `./node_modules/.bin/playwright test e2e/ux-tier1-electron.spec.js --workers=1 --reporter=list`.
Artifacts: `e2e-output/ux-tier1/01–10*.png` + `00-session.webm`.

---

## Tier 2a — High-impact sketch primitives (4 of 15 items shipped)

The Tier-2 gap list (synthesis §7) has 15 sketch tools missing relative to SW.
This pass shipped the four highest-impact items — the ones a user notices
within the first sketch-on-face workflow.

| Tier-2 # | Tool | Status | Implementation |
|---|---|---|---|
| 11 | **Center Line** | **DONE** | `frontend/src/kernel/sketch/InteractiveSketch.js::_createCenterLine` + `TOOLS.CENTER_LINE`; ribbon "Center Line" in Sketch→Draw. Construction line entity: `isConstruction: true`, dashed purple via `LineDashedMaterial`, excluded from `getSolidProfile()` |
| 12 | **"For construction" toggle** | **DONE** | `InteractiveSketch.setEntityConstruction(idx, bool)`; ribbon "Toggle Construction" in Sketch→Modify reads the viewport selection (`__archdiscSelectedSketchEntities`) or the last entity. Flips `isConstruction` + re-draws with dashed material |
| 13 | **Rectangle variants** | **PARTIAL (2 of 5)** | Center Rectangle variant shipped (`_createCenterRectangle(center, corner)` + ribbon entry). Tag each line with `rectId` / `rectVariant: 'center'` / `rectCenter` so the centre is verifiable. 3pt-corner / 3pt-center / parallelogram remain |
| 19 | **Sketch Chamfer** | **DONE** | `_createSketchChamfer(line1Idx, line2Idx, distance)`: finds the shared-endpoint corner, trims each source line by `distance` along its own direction toward the OTHER endpoint, inserts a new chamfer segment between the two trim points, and coincident-constrains the new segment's endpoints to the trimmed line endpoints. Ribbon "Sketch Chamfer" in Sketch→Modify; param-dialog-driven (PropertyManager dock; 5 mm default); selection-driven (uses `__archdiscSelectedSketchEntities` if set, else falls back to the most-recent line pair sharing an endpoint) |
| 20 | **Convert Entities** | **DONE** | The SolidWorks-Tier-2 critical item. Two pieces: (a) `InteractiveSketch.convertEntities(sources, {isConstruction, fixedToSource})` projects an array of source segments (line / arc / circle / spline) to the active sketch plane, with per-curve construction + fixed flags; (b) `InteractiveSketch.extractFaceBoundary(group, {z, tolerance})` walks a Three.js group's mesh, counts on-plane triangle edges, returns the ones appearing exactly once (boundary edges) as world-space `Vec3` segments. Ribbon "Convert Entities" in Sketch→Modify wires both via the body registry; PropertyManager dock dialog with `isConstruction` / `fixedToSource` enum toggles. **HONEST PARTIAL**: spline edges convert to a piecewise-line approximation (not a true NURBS sketch entity); off-plane edges project as the planar projection (correct SW semantics) |

**Files added/changed for Tier-2a:**

- `frontend/src/kernel/sketch/InteractiveSketch.js` — 5 new methods (`_createCenterLine`, `setEntityConstruction`, `_createCenterRectangle`, `_createSketchChamfer`, `convertEntities`), 1 static helper (`extractFaceBoundary`), `getSolidProfile()` for construction-aware extrusion. `_drawLine3D` / `_drawCircle3D` now take an `opts.dashed` flag and use `LineDashedMaterial` for construction visuals. `TOOLS` extended with `CENTER_LINE` / `CENTER_RECTANGLE` / `CONVERT_ENTITIES` / `SKETCH_CHAMFER`. `_redrawAll()` honours the construction flag.
- `frontend/src/components/RibbonToolbar.jsx` — Sketch→Draw gains **Center Line** + **Center Rectangle**; Sketch→Modify gains **Sketch Chamfer**, **Convert Entities**, **Toggle Construction**.
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` — 5 new handlers in the sketch block: `Center Line`, `Center Rectangle`, `Sketch Chamfer`, `Toggle Construction`, `Convert Entities`. Each integrates with the singleton `window.__archdiscSketch`. Convert Entities also reads the body registry for the source body and writes diagnostics to `window.__lastConvertEntities`. Sketch Chamfer writes to `window.__lastSketchChamfer`. Toggle Construction writes to `window.__lastConstructionToggle`.
- `frontend/src/foundation/ToolParamSchemas.js` — adds **Sketch Chamfer** schema (distance, default 5 mm) and **Convert Entities** schema (isConstruction / fixedToSource enum toggles).
- `frontend/src/components/SwUxOverlays.jsx` — `DOCKED_TOOLS` set extended with **Sketch Chamfer** + **Convert Entities** so they pop up in the PropertyManager Dock (Tier-1 pattern). Dock + floating dialog both now render `type: 'enum'` fields as `<select>` elements (was a longstanding silent gap).
- `frontend/src/components/ToolParamDialog.jsx` — same enum-as-select fix.
- `e2e/ux-tier2a-sketch-primitives-electron.spec.js` — bespoke motion-capture e2e: build a 60×80×8 mm mounting plate via atomic ops, sketch-on-face on the top, Convert Entities to project the 4 boundary edges, Center Line through the centroid, two intersecting lines + Sketch Chamfer (5 mm), Center Rectangle (30×20), Extrude Cut for the pocket. Iso framing + one orbit. Asserts: Convert Entities projects 4 of 4 source edges, all marked construction; Sketch Chamfer trims both source line endpoints to c1/c2; Center Rectangle has 4 lines with `rectVariant: 'center'` and a symmetric corner set; Center Line is `isConstruction: true`.

**E2E:** `./node_modules/.bin/playwright test e2e/ux-tier2a-sketch-primitives-electron.spec.js --workers=1 --reporter=list`
Artifacts: `e2e-output/ux-tier2a/01–06*.png` + `00-session.webm` (1.05 MB).

**Regression subset (Tier-2a):**
- `e2e/sketch-autodim.spec.js` + `sketch-on-face.spec.js` + `sketch-wiring.spec.js` + `sketch-workflow.spec.js` — all 13 pass
- `e2e/ribbon-test.spec.js` + `ux-tier1-electron.spec.js` — 2 pass
- `e2e/ux-tier2a-sketch-primitives-electron.spec.js` — 1 pass (new)
- `e2e/mechanical-cad.spec.js` — first 9 pass (primitives, extrude, fillet, chamfer, shell); test #10 (Boolean Subtract) failed in this run, **pre-existing**, unrelated to Tier-2a (SP-1 S5 area)
- `e2e/viewport-pick-selects-body.spec.js` — pre-existing failure (Extrude Boss in dev-server browser context times out at `__lastFoundationManifold`), unrelated to Tier-2a

**Honest gaps in Tier-2a:**

1. **Convert Entities — spline edges**: piecewise-line approximation, not a true NURBS sketch entity. Documented partial in the `convertEntities()` doc-comment and visible as `partialApproximation` in the result.
2. **Convert Entities — selection-driven face pick**: the handler reads the most-recent registered body's top face by default. A picked-face-with-Z hook (`__archdiscConvertSource = {group, z}`) exists for plan-step / e2e use. A real face picker (consuming `__archdiscRegistry.selectedBrepShapes()` + a face-id) is a follow-on.
3. **Rectangle variants — 3 of 5 not shipped**: 3-Point Corner, 3-Point Center, Parallelogram remain.
4. **Construction line — _redrawAll on toggle**: toggling construction state calls `_redrawAll()` which disposes + redraws ALL sketch entities. Cheaper to only swap the affected entity's material, but a full redraw is correct and keeps the construction → dashed transition trivially correct.

---

## Tiers 2 (remaining) – 10 — Outstanding (no work yet)

| Tier | Scope | Status |
|---|---|---|
| 2 (rest) | Slot tool (4 variants), Circle variants, Arc variants, Parabola, Text along curve, Linear/Circular Sketch Pattern, Move/Rotate/Copy/Scale/Stretch Entities, Display-Delete Relations, 3D Sketch, named relations (Concentric / Midpoint / Symmetric / Collinear / Fix) — 11 items remain | Not started |
| 3 | Missing feature tools (Boundary, Curve-driven/Sketch-driven Pattern, Rib, Wrap, Dome, Free Form) | Not started |
| 4 | Missing surfacing tool naming (Extruded Surface, Boundary Surface, Planar Surface, etc.) | Not started |
| 5 | Sheet Metal workbench (entire ribbon tab + kernel) | Not started |
| 6 | Weldments workbench (structural members + cut list) | Not started |
| 7 | Missing assembly capabilities (Parallel/Perpendicular/Tangent/Lock mates, all Advanced + Mechanical mates, Component Pattern, Toolbox) | Not started |
| 8 | Missing drawing capabilities (Auxiliary/Crop/Broken View, Model Items, BOM/Auto-Balloon, Title Block edit) | Not started |
| 9 | Mold Tools workbench (Draft/Undercut Analysis, Parting Line/Surface, Tooling Split) | Not started |
| 10 | Parametric infrastructure (Equation Manager, Global Variables, Design Tables, Configurations) | Not started |

---

## Tier 11a — NX selection-priority pre-filter (1 of 1 shipped)

NX's signature UX pattern: a top-of-viewport **Selection Bar** with mode
buttons that pre-filter the next viewport click before resolving it. The
SW course flagged this only implicitly (`siemens-nx-course-synthesis.md` §3.4
+ §6 item 100); the SolidWorks gap list does not have a direct analog. This
is the highest-leverage NX-distinctive UX item and the first shipped in
the Tier-11 NX-vocabulary block.

| Tier-11 # | Convention | Status | Implementation |
|---|---|---|---|
| 100 | **Selection-priority pre-filter** on the viewport Selection Bar | **DONE** | `SwUxOverlays.jsx::SelectionPriorityBar` (top-left of viewport, icon-only with active-label cue, NX styling). Six modes: Single / Solid Body (default) / Sheet Body / Face / Edge / Vertex. Stored on `window.__archdiscSelectionFilter`; `selectionFilterBus` pub/sub for non-window observers. Pick path in `Viewport3D.jsx::handleClick` consults the filter BEFORE the legacy gizmo-mode dispatch: solid/sheet filter the intersect list, face/edge/vertex override the resolution mode for the rest of the click. Foundation-manifold path gets per-triangle analytic-face clustering (flood-fill over co-planar triangles), per-edge picking (nearest edge of the hit triangle), and per-vertex picking (nearest triangle corner) — none of which existed before, so face/edge/vertex now actually do something visible on a foundation body |

**Files added/changed for Tier-11a:**

- `frontend/src/components/SwUxOverlays.jsx` — added `SelectionPriorityBar` component, `SELECTION_FILTERS` table, `selectionFilterBus` pub/sub, `resolveSelectionByFilter` + `matchesBodyKindFilter` helpers
- `frontend/src/components/SwUxOverlays.css` — `.sw-selection-bar*` styles (icon-only by default, active button reveals its label; sits at top:8 left:8 so it doesn't collide with the centre-anchored Heads-up View Toolbar)
- `frontend/src/components/Viewport3D.jsx` — pick-path integration: filter intersects on solid/sheet, override mode on face/edge/vertex; added helpers `ensureAnalyticFaceIds`, `flagAndHighlightAnalyticFace`, `pickNearestMeshEdge`, `drawEdgeHighlight`, `pickNearestMeshVertex`, `drawVertexMarker` so the foundation-manifold path gets analytic-face / edge / vertex resolution. Picks emit a `window.__lastViewportPick` snapshot for e2e + AI introspection
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` — mount `<SelectionPriorityBar />` alongside the existing Tier-1 overlays
- `e2e/ux-tier11a-selection-filter-electron.spec.js` — bespoke motion-capture e2e: builds a real bolted-plate flange-joint mockup (lower + upper plate + 4 fasteners + 1 sheet-body backdrop), parks ONE iso framing, cycles through ALL SIX filter modes by clicking the SAME viewport pixel + asserting the resulting `__lastViewportPick` matches; 8 stills + .webm

**E2E:** `./node_modules/.bin/playwright test e2e/ux-tier11a-selection-filter-electron.spec.js --workers=1 --reporter=list`
Artifacts: `e2e-output/ux-tier11a/01–08*.png` + `00-session.webm` (~1 MB).

**Regression subset (Tier-11a):**
- `e2e/ux-tier1-electron.spec.js` + `e2e/ux-tier2a-sketch-primitives-electron.spec.js` + `e2e/ribbon-test.spec.js` + `e2e/ux-tier11a-selection-filter-electron.spec.js` — 4/4 pass
- `e2e/mechanical-cad.spec.js` — 21 pass, 2 fail (Feature Tree + V12 Engine — pre-existing dev-server `__lastFoundationManifold` timeouts; unrelated to Tier-11a)
- `e2e/viewport-pick-selects-body.spec.js` + `e2e/body-selection-properties.spec.js` — pre-existing dev-server `__lastFoundationManifold` timeouts; documented in memory as "out of scope"

**Honest gaps in Tier-11a:**

1. **Sheet body filter needs an explicit tag.** The foundation-manifold path emits solids only; for the Sheet filter to work the caller must set `group.userData.bodyKind = 'sheet'` (or the spine body must expose `kind: 'sheet'`). When neither is set, `matchesBodyKindFilter` defaults to `'solid'` (so legacy bodies are still pickable under the default Solid Body filter). The e2e exercises the Sheet filter via an explicitly-tagged backdrop sheet mesh — the kernel sheet-body emission path is not wired here.
2. **Face picking on foundation manifolds clusters by co-planar / co-normal triangles.** The flood-fill uses a 2.5° dot-product tolerance, so a flat face → exactly one cluster. Curved analytic faces (cylinders) — each triangle has a slightly-different normal, so a fastener side wall fragments into many face ids. The kernelSolid path still uses `ThreeJSBridge.pickFace` and is correct; foundation-manifold clustering is the documented partial.
3. **Edge picking picks the nearest triangle edge, not the analytic edge.** On a flat face that's a true model edge (the e2e proves this — the picked edge on the upper plate is exactly the corner of the rectangle). On a triangulated curved surface it picks an internal mesh edge, which is honest but not what a true B-rep edge picker would return.
4. **Vertex picking picks the nearest mesh vertex of the hit triangle.** Same trade-off as edges: on a flat polygon's corner you get the right vertex; inside a curved face you get a mesh vertex.
5. **Hover-highlight follow-the-cursor is NOT wired** in this pass. The hover-highlight pattern that NX shows (preview-highlight before commit) would need a `pointermove` raycast loop and a separate transient overlay. Out of scope here — the same Selection Bar will pick up that work in a follow-on.
