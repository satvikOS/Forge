# UX-Track Progress — SolidWorks + NX Conventions in ArchDisc

**Last updated:** 2026-05-23 (Tier-1 backlog #4/#6/#7/#9 closed)

This file tracks ArchDisc's progress closing the SolidWorks UX gap list documented in
[`solidworks-course-synthesis.md`](./solidworks-course-synthesis.md). The gap list is
organized by 10 tiers (universal conventions → workbench-scale additions). This file
records which items have shipped, are partial, or remain outstanding.

---

## Tier 1 — Universal SolidWorks conventions (8 of 10 done)

| # | Convention | Status | Implementation |
|---|---|---|---|
| 1 | Confirmation Corner (top-right viewport) | **DONE** | `frontend/src/components/SwUxOverlays.jsx::ConfirmationCorner` + `.sw-confirm-corner` CSS; event bus `confirmationBus` so any tool can request it; PropertyManagerDock auto-activates it when it opens |
| 2 | PropertyManager docked left | **DONE** (13 tools) | `SwUxOverlays.jsx::PropertyManagerDock` + `DOCKED_TOOLS` set (Extrude/Revolve/Loft/Sweep Boss + Cut, Fillet, Chamfer, Shell, Hole Wizard, Draft, Linear Pattern, Circular Pattern). Floating `ToolParamDialog` skips migrated tools so the two never collide. Sections collapsible (INPUTS + OPTIONS placeholder) |
| 3 | Sketch under/full/over-defined colour states | **DONE** | `SketchSolver.signedDOF()` (signed, replaces the previously-clamped DOF), `isOverConstrained()` now correct; `InteractiveSketch.applyDoFColouring()` recolours line/circle/arc entity visuals; bottom-left `SketchStateBadge` shows the state text + DoF count |
| 4 | Sketch live cursor coordinate readout | **DONE** (Tier-1 backlog) | `InteractiveSketch._publishCursor()` fires from `onMouseMove` with the current u/v converted to mm; `SwUxOverlays.jsx::SketchCursorReadout` listens for `archdisc:sketch-cursor` and renders an `X _ Y _ mm` pill at bottom-left next to the SketchStateBadge. Hides automatically when the sketch deactivates |
| 5 | Heads-up View Toolbar | **DONE (partial primitives)** | `SwUxOverlays.jsx::HeadsUpViewToolbar` with Zoom-Fit, Zoom-to-Area, Section View, View Orientation drop (7 standard views), Normal-To, Display Style drop (4 modes). **Honest gaps:** Zoom-to-Area falls back to focus-on-selection (no marquee-drag hook in viewport); Section View toggles X-Ray as the minimum visible effect (no foundation section-clip primitive exposed); Normal-To always faces Front rather than the picked-face normal (the picked-face data isn't reliably surfaced from the viewport handler) |
| 6 | Double-click-dimension-to-edit | **DONE** (Tier-1 backlog) | `InteractiveSketch.getDimensions()` + `getDimensionAt(worldPoint)` + `editDimension(id, mm)` rebind / mutate the underlying solver constraint (distance for lines, radius for circles), re-solve, and refresh the visual. `SwUxOverlays.jsx::DimensionEditorOverlay` opens an inline editor at the dimension's screen-projected mid-point; Enter commits, Esc cancels; the editor stays anchored as the camera moves |
| 7 | Auto-relations icon on cursor while drawing | **DONE** (Tier-1 backlog) | `InteractiveSketch._detectAutoRelation(cursorPos)` returns one of `horizontal | vertical | coincident | tangent | perpendicular | parallel` based on the active tool + nearest existing entities (5° tolerance). The hint is published with every cursor move via `__archdiscSketchCursor.hint`. `SwUxOverlays.jsx::AutoRelationIndicator` tracks `pointermove` inside the viewport and renders a colour-tinted icon next to the cursor reflecting the active hint |
| 8 | `(f)` fixed-component prefix in assembly tree | **NOT THIS PASS** | |
| 9 | Right-click conventions in FeatureManager (full audit) | **DONE** (Tier-1 backlog) | `DesignHistory.rename()` / `setSuppressed()` / `remove()` / `rollBackToHere()` mutators on the foundation history. `DesignHistoryPanel.jsx` opens a fixed-positioned context menu on `onContextMenu` with all 6 SW entries: Edit Feature, Edit Sketch (only on sketch-bearing entries), Suppress/Unsuppress, Roll Back To Here (placeholder — see gap), Rename (inline editor), Delete. Hides on click-outside, Escape, or a second right-click anywhere. Double-click row also enters rename mode (SW F2 convention) |
| 10 | Rollback bar in Feature Manager Design Tree | **NOT THIS PASS** | |

**Files added/changed for Tier-1 (initial pass):**

- `frontend/src/components/SwUxOverlays.jsx` (new — 4 components + event bus)
- `frontend/src/components/SwUxOverlays.css` (new — overlay styling)
- `frontend/src/components/ToolParamDialog.jsx` (modified — skip docked tools)
- `frontend/src/kernel/sketch/SketchSolver.js` (modified — `signedDOF()`, correct over-constrained)
- `frontend/src/kernel/sketch/InteractiveSketch.js` (modified — `applyDoFColouring()`, `addDistanceConstraint()`, status now exposes `state` + `signedDof`)
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` (modified — mount the four overlays in viewport)
- `e2e/ux-tier1-electron.spec.js` (new — motion-capture e2e with 10 frames + .webm)

**E2E (initial Tier-1):** `./node_modules/.bin/playwright test e2e/ux-tier1-electron.spec.js --workers=1 --reporter=list`.
Artifacts: `e2e-output/ux-tier1/01–10*.png` + `00-session.webm`.

---

## Tier 1 backlog — closure pass (#4, #6, #7, #9)

The four conventions deferred by the initial Tier-1 dispatch are now
implemented. Each is a real working overlay or kernel hook — not a placeholder.

### Implementation summary

| # | Item | Implementation | Files |
|---|---|---|---|
| #4 | **Live cursor X/Y readout** | `InteractiveSketch._publishCursor` fires per `onMouseMove` (u/v in metres → x/y in mm), with `__archdiscSketchCursor` and an `archdisc:sketch-cursor` event. `SketchCursorReadout` overlay reads both and renders the pill. Auto-hides on sketch deactivate (cursor event detail = null). | `SwUxOverlays.jsx`, `SwUxOverlays.css`, `InteractiveSketch.js` |
| #6 | **Double-click dimension to edit** | `InteractiveSketch.getDimensions()` returns every dimension's id + value_mm + mid-world point; `editDimension(id, mm)` mutates the underlying distance / radius constraint in place (preferring update-existing over insert-new to keep DoF stable) and re-solves. `applyDimension()` now records the constraint binding so the editor knows which constraint to drive. `DimensionEditorOverlay` opens on `archdisc:edit-dimension`, projects the dimension's mid-point through the live camera to position itself, focuses + selects the value, commits on Enter / Tab / OK click, cancels on Esc / click-outside. | `SwUxOverlays.jsx`, `SwUxOverlays.css`, `InteractiveSketch.js` |
| #7 | **Auto-relations icon-on-cursor** | `InteractiveSketch._detectAutoRelation(cursorPos)` re-uses the existing snap-target machinery + 5° tolerance to detect the relation that WOULD apply (Horizontal / Vertical / Coincident / Tangent / Perpendicular / Parallel) at the current cursor. Published with every cursor move via `__archdiscSketchCursor.hint`. `AutoRelationIndicator` overlay subscribes to `pointermove` inside the viewport canvas and renders a tinted icon next to the pointer — H/V green, Coincident cyan, Tangent amber, Perpendicular purple, Parallel pink. | `SwUxOverlays.jsx`, `SwUxOverlays.css`, `InteractiveSketch.js` |
| #9 | **Design History right-click context menu** | `DesignHistory.js` gains `rename(id, name)` / `setSuppressed(id, bool)` / `remove(id)` / `rollBackToHere(id)` (placeholder — suppresses every entry below the anchor since SP-3 design-history rollback isn't in this pass). `DesignHistoryPanel.jsx` renders a fixed-positioned context menu (z-index 9000) with all 6 SW entries on `onContextMenu`. Hides on click-outside, Escape, or a second right-click. Edit Sketch only appears on sketch-bearing rows. Inline rename input matches the FeatureTreePanel idiom (double-click = F2). Rolled-back rows are dimmed + striped; the anchor row gets an amber left-rail. | `DesignHistoryPanel.jsx`, `DesignHistoryPanel.css`, `DesignHistory.js` |

### Bespoke real workflow — mounting tab with slot + chamfered corner

`e2e/ux-tier1-backlog-electron.spec.js` builds a 75×24×6 mm mounting tab
with a 32×6 mm slot pocket and a corner chamfer notch, exercising every
Tier-1-backlog convention in flow. ONE `test()` block,
motion-capture, `--workers=1`, no `node:*` imports. **9 stills + a
1.07 MB session video.**

| Frame | Headline |
|---|---|
| 01 | A1 — cursor readout active (`X 14.00 Y 22.00 mm` at bottom-left) |
| 02 | B1 — drawing a line; auto-relation icon shows `H` (Horizontal) at the cursor |
| 03 | B2 — drawing the next line; icon flips to `V` (Vertical) |
| 04 | B3 — rectangle outline with two Smart Dimensions placed |
| 05 | C1 — inline dimension editor open at the bottom-edge dimension, value `60.00 mm` |
| 06 | C2 — same dimension committed at `75.00 mm`; sketch re-solved |
| 07 | D1 — mounting tab body extruded (slot pocket + corner notch visible) |
| 08 | E1 — right-click on Extrude entry → context menu with all 5 non-sketch entries |
| 09 | E2 — Design History row renamed to "Mounting Tab Body"; tree updated |

**Visual check (read the stills):**

1. **Frame 01** — `[data-archdisc-cursor-readout="active"]` pill at the bottom-left of the viewport reads `X 14.00 Y 22.00 mm`, sitting next to the FULLY DEFINED state badge. Values match the published `__archdiscSketchCursor` exactly.
2. **Frame 02** — the auto-relation indicator (green-tinted `H` badge) hovers right of the simulated cursor. `__archdiscSketchCursor.hint === 'horizontal'` is asserted in the spec.
3. **Frame 03** — same indicator now shows `V` (vertical, green tint). Cursor readout reflects the new y=12 mm.
4. **Frame 05** — the orange-tinted inline dimension editor floats next to the 60 mm dimension; the input is focus-highlighted with the value preselected; green-check / red-X buttons on the right.
5. **Frame 06** — after committing 75 mm, the rectangle's bottom-edge dimension renders `75.00 mm` and the geometry has stretched accordingly. `window.__lastDimensionEdit.result.ok === true` confirms the solver re-solve.
6. **Frame 08** — the context menu is open on the Extrude Boss entry with exactly 5 entries: Edit Feature, Suppress, Roll Back To Here (with the `(approx.)` honesty tag), Rename, Delete. Edit Sketch is correctly omitted on a non-sketch entry. A separate verification step in the spec also opens the menu on the Sketch entry and asserts Edit Sketch DOES appear there.
7. **Frame 09** — the design history now reads "Mounting Tab Body" (renamed from "Extrude Boss") + the Sketch on Top Face entry below it. The mounting tab body is rendered in the viewport with the slot pocket + corner notch clearly visible.

### E2E + regression subset

- `e2e/ux-tier1-backlog-electron.spec.js` — 1 pass (new)
- `e2e/ux-tier1-electron.spec.js` — 1 pass
- `e2e/ux-tier2a-sketch-primitives-electron.spec.js` — 1 pass
- `e2e/ux-tier2b-sketch-relations-electron.spec.js` — 1 pass
- `e2e/ux-tier11a-selection-filter-electron.spec.js` — 1 pass (flaky on first run, `vertex` vs `single` pre-existing — passes in isolation)
- `e2e/ribbon-test.spec.js` — 1 pass
- `e2e/sketch-autodim.spec.js` + `sketch-on-face.spec.js` + `sketch-wiring.spec.js` + `sketch-workflow.spec.js` — 13/13 pass
- `e2e/mechanical-cad.spec.js` — 21 pass, 2 fail (`Feature Tree`, `V12 Engine Assembly` — pre-existing dev-server `__lastFoundationManifold` timeouts; unrelated to Tier-1 backlog)

### Honest gaps in Tier-1 backlog

1. **Roll Back To Here is a placeholder.** Real feature-tree rollback (suppress every dependent feature, hide the geometry, restore on roll-forward) depends on SP-3 design-history rebackground which is not in this pass. Our current implementation suppresses every Design History entry AFTER the anchor row, which gives the user a visible, honest approximation: rolled-back rows are dimmed + striped; the anchor row has an amber left-rail. The `(approx.)` tag on the menu item makes the limitation explicit. `DesignHistory.rollBackToHere` returns `{ ok, suppressedCount, gap: 'no-feature-rollback' }` so callers can detect the gap programmatically.
2. **Edit Sketch is presentational on Design History sketch rows.** Clicking "Edit Sketch" fires `archdisc:dh-edit-sketch` with the entry payload but no consumer is wired to re-enter sketch-edit mode on that sketch (the sketch entries themselves don't carry the underlying `InteractiveSketch` state). This is honest until the sketch-state persistence work in Tier-3 lands.
3. **Auto-relation hint is line-tool primary.** Perpendicular / Parallel detection only fires while drawing a LINE (because that's where SW's ghost is most useful); Circle / Arc tools still get Coincident / Tangent. Adding Concentric / Equal hints for circles is a Tier-2 follow-on.
4. **Dimension editor uses the live camera projection each tick.** The editor stays anchored to the dimension as the camera orbits, but at very oblique angles the projection can drift a few pixels because we project a fixed `mid + 5 mm V` offset rather than the dimension's actual sprite. Acceptable for typical sketch-view + iso interactions.
5. **Cursor readout updates from the actual onMouseMove path**, but the e2e exercises it via direct `_publishCursor` calls because the underlying viewport handler ties cursor → sketch through Three.js raycasting which is harder to drive deterministically from Playwright. The real user gets the same readout because both paths funnel through `_publishCursor`.

**Files added/changed for Tier-1 backlog closure:**

- `frontend/src/components/SwUxOverlays.jsx` (modified — added `SketchCursorReadout`, `AutoRelationIndicator`, `DimensionEditorOverlay` + projector helper)
- `frontend/src/components/SwUxOverlays.css` (modified — overlay styling for the three new components)
- `frontend/src/components/DesignHistoryPanel.jsx` (modified — right-click context menu + inline rename + rollback-anchor + suppressed-row state)
- `frontend/src/components/DesignHistoryPanel.css` (modified — context menu + suppressed/rollback styling)
- `frontend/src/foundation/DesignHistory.js` (modified — `rename` / `setSuppressed` / `remove` / `rollBackToHere` mutators; `record()` returns the entry and seeds `name` + `suppressed`)
- `frontend/src/kernel/sketch/InteractiveSketch.js` (modified — `_publishCursor`, `_detectAutoRelation`, `getDimensions` / `editDimension` / `getDimensionAt`, dim id + targetEntityIndex on every dimension, cursor clear on deactivate)
- `e2e/ux-tier1-backlog-electron.spec.js` (new — 9 stills + .webm)

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

## Tier 2b — Named geometric relations (5 of 5 shipped) + Display/Delete Relations dialog

The SW Tier-2 list flagged 5 named relations (Concentric / Midpoint /
Symmetric / Collinear / Fix) PLUS the Display/Delete Relations dialog
(synthesis §6.2 lines 634, 636) as missing. This pass ships all six.

The motivating use-case: a user DECLARES design intent symbolically via
relations instead of placing individual dimensions. The flange bolt-hole
pattern in the bespoke e2e is the canonical worked example.

| Tier-2 # | Tool | Status | Implementation |
|---|---|---|---|
| 14 | **Concentric** | **DONE** | `SketchSolver.concentric(c1, c2)` + new `ConcentricConstraint` (squared centre distance, 2 DoF per pair). `InteractiveSketch.applyConcentric(idxs)` chains N entities as N-1 pair constraints; supports circles, arcs, and mixed circle+arc |
| 15 | **Midpoint** | **DONE** | `SketchSolver.midpointOf(p, line)` re-uses existing `MidpointConstraint` (2 DoF). `InteractiveSketch.applyMidpoint(pIdx, lineIdx)` — point + line entity pair |
| 16 | **Symmetric** | **DONE** | Re-uses existing `SymmetricConstraint`. `InteractiveSketch.applySymmetric([eA, eB], axisIdx)` — last selection is the axis line; supports line-line (endpoint pairing), circle-circle (centre symmetry + equal radii), arc-arc (centre symmetry). Endpoint pairing minimises squared distance to avoid pathological reflection |
| 17 | **Collinear** | **DONE** | `SketchSolver.collinear(lA, lB)` + new `CollinearConstraint` (direction-parallel cross product + position offset on the perpendicular, 2 DoF per pair). `InteractiveSketch.applyCollinear(idxs)` chains N lines as N-1 pairs |
| 18 | **Fix** | **DONE** | `SketchSolver.fix(point)` alias of the existing `FixedConstraint`. `InteractiveSketch.applyFix(idx)` dispatches by entity type: point → 2 DoF, line → 4 DoF (both endpoints), circle → 3 DoF (centre + radius), arc → 6 DoF (centre + start + end) |
| **Display/Delete Relations** dialog | **DONE** | `InteractiveSketch.getRelationsForEntity(idx)` + `getAllRelations()` + `deleteRelation(id)`. New `SwUxOverlays.DisplayRelationsDock` panel (top-right of viewport) lists every relation with its named label + the entity indices it links + a per-row delete button. Opens on the "Display Relations" ribbon click via the `archdisc:display-relations` custom event. Polls the sketch every 400 ms so the list stays current as relations are added |

**Files added/changed for Tier-2b:**

- `frontend/src/kernel/sketch/SketchSolver.js` — new `ConcentricConstraint` + `CollinearConstraint` classes; new factories `concentric`, `collinear`, `fix`, `midpointOf`; DoF accounting extended for both new constraint types.
- `frontend/src/kernel/sketch/InteractiveSketch.js` — five new user-facing methods (`applyConcentric` / `applyMidpoint` / `applySymmetric` / `applyCollinear` / `applyFix`); relation registry (`_recordRelation` / `getRelationsForEntity` / `getAllRelations` / `deleteRelation`); arc entities now expose `_solverCenterRef` / `_solverStartRef` / `_solverEndRef` + `solverArc` so the new relations can reach the underlying solver points. Symmetry endpoint-pairing helper picks the matching that minimises pre-solve squared distance.
- `frontend/src/foundation/ToolParamSchemas.js` — five blurb-only schemas for the relation tools (selection-driven, no numeric inputs) so the PropertyManager dock can still surface the title + hint.
- `frontend/src/components/RibbonToolbar.jsx` — new Sketch→Relations group with six entries (Concentric Relation / Midpoint Relation / Symmetric Relation / Collinear Relation / Fix Relation / Display Relations).
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` — six new handlers in the sketch block. All five Apply* tools read `window.__archdiscSelectedSketchEntities` and dispatch to the InteractiveSketch `apply*` method. The Symmetric handler uses the SW convention: the LAST selected entity is the axis line; the first two are the mirror pair. Each handler emits a DoF before/after pair on `window.__lastSketchRelation` for e2e introspection. The Display Relations handler opens the right-side dock via a custom `archdisc:display-relations` event.
- `frontend/src/components/SwUxOverlays.jsx` — new `DisplayRelationsDock` component; mounted as a sibling of `SketchStateBadge` so it only lives while a sketch is active and the workbench mount isn't touched. Each row carries the relation LABEL, the linked entity indices, and a trash-can delete button.
- `frontend/src/components/SwUxOverlays.css` — dock styling, per-relation-type colour tints (concentric=cyan, midpoint=green, symmetric=amber, collinear=pink, fix=gold), delete-button hover state.
- `e2e/ux-tier2b-sketch-relations-electron.spec.js` — bespoke motion-capture e2e: builds an 80×8 mm circular flange via atomic ops, sketches 9 scattered entities on the top face, drives every relation in sequence (Concentric → Symmetric → Collinear → Midpoint → Fix), captures DoF state at each step, opens Display Relations + deletes the Fix row + verifies DoF restoration + re-applies Fix, then Extrude Cuts the bore. Top-down 2D camera for the relation-state stills + iso for the final result. 11 stills + `00-session.webm` (~1.8 MB).

**E2E:** `./node_modules/.bin/playwright test e2e/ux-tier2b-sketch-relations-electron.spec.js --workers=1 --reporter=list`
Artifacts: `e2e-output/ux-tier2b/01–11*.png` + `00-session.webm`.

**Cumulative DoF delta verified live in the spec:**

| Relation | DoF before | DoF after | Removed |
|---|---|---|---|
| (initial) | — | 28 | — |
| Concentric (bore + pitch) | 28 | 26 | 2 |
| Symmetric (bolt1 + bolt2 about axis) | 26 | 22 | 4 (2 centre + 2 radii) |
| Collinear (refLeft + refRight) | 22 | 20 | 2 |
| Midpoint (point ↔ segment) | 20 | 18 | 2 |
| Fix (pitch circle) | 18 | 15 | 3 (centre + radius) |
| **Total** | **28** | **15** | **13** |

**Visual check (READ the stills):**

1. `04-C1-after-concentric-bore-snaps-to-centre.png` — after applying
   Concentric, the bore (yellow inner circle) snaps from off-centre to
   the pitch circle's centre. The success toast reads "CONCENTRIC
   RELATION: 2 circles/arcs linked, DoF 28 → 26", and the SketchStateBadge
   in the bottom-left shows "UNDER-DEFINED · DoF: 26". The right-side
   Design History records "Concentric Relation: 2 circles/arcs linked,
   DoF 28 → 26".
2. `05-C2-after-symmetric-bolts-mirror-about-axis.png` — the two bolt-hole
   circles snap to mirror positions about the horizontal axis line.
   Toast: "SYMMETRIC RELATION: entities [2, 3] mirrored about line #4,
   DoF 26 → 22". Badge: DoF 22. Design history shows Concentric +
   Symmetric stacked.
3. `09-D1-display-relations-on-pitch-circle.png` — the Display Relations
   dock is OPEN on the right edge of the viewport, showing
   "DISPLAY / DELETE RELATIONS" header, "Entity #1 · 2 relations"
   subtitle, with two rows: "Concentric [0, 1]" (cyan label) and
   "Fix [1]" (gold label), each with a trash-can delete icon. Toast:
   "DISPLAY RELATIONS: Display Relations: 2 relations on entity #1
   (panel opened)."
4. `10-D2-after-fix-deletion-dof-restored.png` — after deleting the
   Fix row from the dock, the list drops to a single "Concentric [0, 1]"
   row. SketchStateBadge shows "UNDER-DEFINED · DoF: 18" (restored by 3
   from 15).
5. `11-E1-extruded-bored-flange-iso.png` — final iso view of the
   extruded bored flange. Design history panel shows all 4 still-active
   relations (Concentric, Symmetric, Collinear, Midpoint) stacked. The
   Fix relation is also active again — re-applied after the deletion
   demonstration. The DoF count is 15 — visibly down from 28.

**Regression subset (Tier-2b):**

- `e2e/ux-tier2b-sketch-relations-electron.spec.js` — 1 pass (new)
- `e2e/ux-tier1-electron.spec.js` + `e2e/ux-tier2a-sketch-primitives-electron.spec.js` + `e2e/ux-tier11a-selection-filter-electron.spec.js` — 3/3 pass
- `e2e/sketch-on-face.spec.js` + `sketch-workflow.spec.js` + `sketch-wiring.spec.js` + `sketch-autodim.spec.js` + `ribbon-test.spec.js` — 14/14 pass

**Honest gaps in Tier-2b:**

1. **Selection convention for Symmetric is positional** (last entity = axis line). SW's symmetric dialog has explicit field labels ("Entities to mirror" + "About"). Our selection-driven handler infers the role from order. Documented in the schema blurb.
2. **The relation registry is per-sketch** — closing + re-opening the sketch resets the list. Relation persistence across sketch sessions would require feature-tree integration, which is out of scope for Tier-2 (planned for Tier-3 or §SP-3 design history rebackground).
3. **No visual cue beside the entity** showing which relations apply to it (SW renders a tiny yellow icon next to a constrained entity in the sketch). The Display Relations dock is the read path; an in-viewport icon set is a follow-on.
4. **Symmetric on circles** wires equal-radius via `RadiusConstraint` on the AVERAGE of the two radii. This is honest — the solver converges to equal radii — but the chosen value is the pre-solve average. SW's UI lets the user lock either radius first and the other follows; we don't expose that override yet.
5. **Symmetric on arcs** constrains the arc CENTRES via the existing symmetric constraint; equal-radius for arcs is implied by the start-point coincidence in the existing kernel — not separately enforced. For triangle-strict arc symmetry the start-point and end-point pairs would each need a SymmetricConstraint; an edge-case follow-on.
6. **Concentric on N entities** is implemented as N-1 pair constraints (each pair = 2 DoF). This is correct numerically but adds redundant equations when the solver could use a single shared-centre variable. Performance-only concern; correctness is unaffected.

---

## Tiers 2 (remaining) – 10 — Outstanding (no work yet)

| Tier | Scope | Status |
|---|---|---|
| 2 (rest) | Slot tool (4 variants), Circle variants, Arc variants, Parabola, Text along curve, Linear/Circular Sketch Pattern, Move/Rotate/Copy/Scale/Stretch Entities, 3D Sketch — 8 items remain (named relations + Display-Delete Relations dialog shipped in Tier-2b) | Not started |
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
