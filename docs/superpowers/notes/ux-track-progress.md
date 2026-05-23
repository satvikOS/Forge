# UX-Track Progress — SolidWorks Conventions in ArchDisc

**Last updated:** 2026-05-23

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

## Tiers 2–10 — Outstanding (no work yet)

| Tier | Scope | Status |
|---|---|---|
| 2 | Missing sketch tools (Center Line, slot variants, Convert/Offset, 3D Sketch, named relations) | Not started |
| 3 | Missing feature tools (Boundary, Curve-driven/Sketch-driven Pattern, Rib, Wrap, Dome, Free Form) | Not started |
| 4 | Missing surfacing tool naming (Extruded Surface, Boundary Surface, Planar Surface, etc.) | Not started |
| 5 | Sheet Metal workbench (entire ribbon tab + kernel) | Not started |
| 6 | Weldments workbench (structural members + cut list) | Not started |
| 7 | Missing assembly capabilities (Parallel/Perpendicular/Tangent/Lock mates, all Advanced + Mechanical mates, Component Pattern, Toolbox) | Not started |
| 8 | Missing drawing capabilities (Auxiliary/Crop/Broken View, Model Items, BOM/Auto-Balloon, Title Block edit) | Not started |
| 9 | Mold Tools workbench (Draft/Undercut Analysis, Parting Line/Surface, Tooling Split) | Not started |
| 10 | Parametric infrastructure (Equation Manager, Global Variables, Design Tables, Configurations) | Not started |
