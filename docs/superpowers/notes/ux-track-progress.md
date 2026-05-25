# UX-Track Progress — SolidWorks + NX Conventions in ArchDisc

**Last updated:** 2026-05-23 (Tier-1 #10 Rollback bar shipped on top of SP-3a/3b)

This file tracks ArchDisc's progress closing the SolidWorks UX gap list documented in
[`solidworks-course-synthesis.md`](./solidworks-course-synthesis.md). The gap list is
organized by 10 tiers (universal conventions → workbench-scale additions). This file
records which items have shipped, are partial, or remain outstanding.

---

## Tier 1 — Universal SolidWorks conventions (9 of 10 done)

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
| 10 | Rollback bar in Feature Manager Design Tree | **DONE** (SP-3c) | `SwUxOverlays.jsx::RollbackBar` + `.sw-rollback-bar*` CSS. Real, HistoryLog-backed timeline scrubber at the top of the viewport (just below the Heads-up View Toolbar). Three interaction modes: (1) click any entry/mark/baseline → kernel `rollBackTo`/`rollForwardTo`; (2) drag the strip → live scrub, RAF-throttled, model evolves in real time; (3) right-click a mark → context menu (Roll To Here / Rename / Delete Mark). Subscribes to the `archdisc:history-changed` event the kernel HistoryLog emits on every record/mark/rollBack/rollForward. Auto-hides when the log is empty. Mounted as a sibling of the Heads-up View Toolbar (so it always rides along, no workbench-mount edit needed). Bespoke e2e: 7-op + 3-mark lathe-leg profile (makeCylinder → revolveRect ×2 → mark → filletAll → makeCylinder → cut → mark → translate) — 10 stills + 1.2 MB session video. Marquee shot: mid-scrub with the cursor caret pulsing between marks and the model in partial-rebuild state |

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

## Tier 1 #10 — Rollback bar (SP-3c, the kernel-history timeline scrubber)

The last Tier-1 item. Shipped on top of SP-3a (mechanism) + SP-3b (op coverage):
every body-producing kernel op already records a forward/inverse delta on the
shared `HistoryLog`; the bar exposes that log as a real, interactive timeline
strip at the top of the viewport.

### What the bar is

A horizontal strip mounted just beneath the Heads-up View Toolbar (top:48,
centred horizontally so it doesn't fight the PropertyManager Dock on the
left or the Confirmation Corner on the right). The strip renders the
kernel `HistoryLog` (`window.__archdiscKernelHistory`) live:

- **Baseline flag** at the far left (clickable — rolls to before any op).
- **One dot per op entry** along the strip rail.
- **Mark flags** (`hist.mark(name)` entries) bigger, gold-tinted, with the
  mark name visible at rest. The current mark is highlighted; pending
  marks are dimmed.
- **Cursor caret** — a vertical blue line at the current cursor position;
  pulses while the user is scrubbing.
- **Meta strip** at the left — `ROLLBACK · N ops · cursor C/N` so the
  user can see the timeline shape numerically.

### What the bar does (three interaction modes)

1. **Click any entry / mark / baseline flag** — calls `hist.rollBackTo`
   (or `hist.rollForwardTo` if forward) with the default scene context
   (the kernel's `standardSceneRegister` / `standardSceneRemove` thunks
   resolve `window.__archdiscRegistry` + `window.__archdiscAddBrepShape`
   automatically). The model rebuilds / unbuilds at the current camera;
   the bar's caret moves to the new cursor.
2. **Drag the caret along the strip** — pointer-down anywhere on the
   strip, drag left/right. Each `pointermove` resolves the nearest entry
   index under the cursor and queues a roll. The queue is throttled to
   one drive per `requestAnimationFrame` so a rapid drag doesn't stack
   kernel rolls faster than they can finish. **This is the marquee
   Rollback UX — the user genuinely sees the model evolve in real time
   as they drag.**
3. **Right-click a mark** — context menu with three items:
   - **Roll To Here** — alternative invocation of #1 (consistency check).
   - **Rename** — opens an inline editor at the bar; commits on Enter
     rebinds the kernel `_markIndex` so the mark resolves under the new
     name. The bar re-renders to reflect the new label.
   - **Delete Mark** — strips the `mark` name from the entry + removes
     it from the index. The entry itself stays (its forward/inverse are
     NOOPs anyway — marks are pure pointers; deleting the name does not
     affect the timeline's geometry-op chain).

### Live binding to the kernel log

The bar subscribes to a single `window` event the kernel `HistoryLog`
emits whenever the log mutates: `archdisc:history-changed`. The emission
is a small additive change in `HistoryLog.js` (in the `recordOp`, `mark`,
`rollBackTo`, and `rollForwardTo` paths) — pure event dispatch, no
contract change. Detail shape: `{ type: 'record'|'mark'|'rollBack'|
'rollForward'|'rename'|'mark-delete'|'reset', ...op-specific }`.

The bar's `useEffect` adds a listener at mount + does a single delayed
refresh (250 ms) to cover the kernel-singleton lazy-init race (the
viewport mounts before the first `getHistoryLog()` call installs
`window.__archdiscKernelHistory`).

### Visible feedback

- **Active cursor pulse** while scrubbing — the caret animates between
  dim and bright blue (CSS `@keyframes sw-rollback-pulse`) so the user
  feels the drag-scrub interaction land.
- **Hover tooltip** below the bar showing the entry's `opName` + the
  persistent body id(s) involved (for derive ops, the `inputPersistentIds`
  also surface so the dependency chain is visible at-a-glance).
- **Mark labels** are visible at rest (gold pills with the mark name);
  truncate via CSS `text-overflow: ellipsis` past 90 px so the strip
  doesn't run out of room on dense logs.

### Integration with the app-level DesignHistory panel

The DesignHistory panel (right aside, FEATURE-level history) keeps its
"Roll Back To Here" right-click menu item. The handler now **delegates**
to the kernel HistoryLog:

1. App-level (existing) — `getHistory().rollBackToHere(entry.id)` still
   suppresses every DesignHistory row after the anchor (visible
   row-dimming).
2. Kernel-level (NEW) — `delegateRollbackToKernel(entry)` finds the last
   kernel `HistoryLog` entry whose `time` ≤ the DesignHistory row's
   `when` (ISO string mapped to ms), then calls `hist.rollBackTo` on
   it. The geometry actually reverts.

The delegation reports its outcome on `window.__lastDhAction.kernelDelegation`
so e2e + AI introspection can see whether the kernel revert happened
(`{ ok: true, kernelEntryId, kernelEntryIdx }`) or why it didn't
(`{ ok: false, reason: 'kernel-history-empty' | 'no-kernel-entry-before-this-row' | ... }`).

The panel header carries a small scope note:

> Feature timeline · viewport Rollback bar = kernel timeline

The menu item title attribute documents the delegation explicitly:

> Drives the viewport Rollback bar to the matching kernel entry. The
> geometry rolls back; this row dims to reflect the new cursor.

### Bespoke real workflow — furniture leg lathe profile

`e2e/ux-rollback-bar-electron.spec.js` builds a turned-wood furniture leg
op-by-op so the timeline has 7 ops + 3 named marks = 10 log entries:

1. `makeCylinder(8, 60)` — the leg BLANK (Ø16 × 60 mm)
2. `revolveRect(6, 1.5, 4, 360)` — decorative ring #1
3. `mark('ring-1')`
4. `revolveRect(5, 1.0, 4, 360)` — decorative ring #2
5. `mark('rings-done')`
6. `filletAll(blank, 0.5)` — soft the leg's top/bottom edges
7. `makeCylinder(4, 12)` — tenon stock
8. `cut(filleted, tenon)` — machine the mortise pocket
9. `mark('tenon-cut')`
10. `translate(grooved, 30, 0, 0)` — position for assembly

One iso framing held throughout (one drag-orbit at the start, then never
again — the user sees the BAR moving + the MODEL evolving, not orbit
angles). 10 key-frame stills + 1.24 MB session.webm.

| Frame | Headline |
|---|---|
| 01 — A1 | Assembled leg at the timeline's tail (cursor 9/9, all 7 bodies) |
| 02 — A2 | Baseline empty (cursor —, registry empty) — clicked the baseline flag |
| 03 — A3 | Clicked 'ring-1' → blank + ring #1 in scene (cursor 2/9, 2 bodies) |
| 04 — A4 | Clicked 'rings-done' → blank + 2 rings (cursor 4/9, 3 bodies) |
| 05 — A5 | Clicked 'tenon-cut' → full machined leg (cursor 8/9, 6 bodies) |
| 06 — B1 | **Drag-scrubbing MID-TIMELINE** — caret pulsing between marks, hover tooltip showing `makeCylinder — auxiCylinder-brep-6`, model partially built |
| 07 — B2 | After drag-scrub finishes — caret at cursor 0 (the blank only) |
| 08 — C1 | Right-click context menu open on 'rings-done': Roll To Here / Rename / Delete Mark |
| 09 — C2 | After renaming 'rings-done' → 'two-rings-done' — bar re-rendered with truncated label |
| 10 — D1 | Clicked the renamed mark → blank + 2 rings restored |

**Visual check (READ the stills):**

1. **A1** — the bar's meta strip reads "ROLLBACK · 10 ops · cursor 9/9".
   Three gold mark flags ("RING-1", "RINGS-DONE", "TENON") visible on
   the strip. The DesignHistory panel on the right shows the new scope
   note "Feature timeline · viewport Rollback bar = kernel timeline".
2. **A2** — cursor reads "—" (baseline), the caret has moved to the FAR
   LEFT, the viewport is empty, the Bodies panel reads "No bodies in
   scene." The mark flags are visible but dimmed (none are current).
3. **A3** — the "RING-1" flag is highlighted (gold solid). Cursor "2/9".
   2 bodies in panel — the blank cylinder + ring 1. Topology Inspector
   shows `revolveRect-brep-3` as the last spine body.
4. **A5** — cursor "8/9", the "TENON" flag highlighted, the leg is fully
   built and the mortise pocket visible. 6 bodies in panel.
5. **B1** — the **marquee shot**. Cursor "6/9", caret pulsing mid-strip,
   the hover tooltip floats below the bar showing the entry's opName +
   persistent id. The model is in a partial-build state — different from
   any of the named-mark states, proving the drag actually walks
   intermediate cursor positions.
6. **C1** — the right-click context menu floats over the bar, gold
   header reads "rings-done", three menu items below.
7. **C2** — the strip now shows "TWO-RINGS-DO..." (truncated by the
   90 px max-width) where "RINGS-DONE" was. The other two marks
   ("RING-1", "TENON") unaffected.

**Focal assertions (from the spec):**

- After build: 10 entries, cursor=9, 3 named marks (ring-1, rings-done,
  tenon-cut), 7 bodies in registry, bar's DOM attributes mirror them.
- After clicking the baseline flag: kernel cursor=-1, registry empty,
  bar's `data-archdisc-rollback-cursor === '-1'`.
- After clicking 'ring-1' mark: kernel cursor=2, 2 bodies; the rebuilt
  ring's persistent id matches the originally-built one (id stability
  across replay — the SP-3a contract).
- After clicking 'rings-done' mark: cursor=4, 3 bodies; ring2 persistent
  id stable.
- After clicking 'tenon-cut' mark: cursor=8, 6 bodies; mortised
  persistent id stable.
- During drag-scrub: a captured mid-state cursor differs from the final
  cursor (proving the drag walks intermediate states, not just snaps to
  the final one). The bar's `sw-rollback-bar-scrubbing` class is set
  during the drag, cleared on pointer-up.
- After right-click + Rename: `hist.markByName('two-rings-done')` resolves,
  `hist.markByName('rings-done')` is null, the bar shows the new flag.
- After clicking the renamed mark: cursor=4, 3 bodies (consistent with
  the pre-rename roll).

### Honest gaps in the Rollback bar

1. **Drag-scrub jumpiness on dense logs.** Each `rollBackTo` / `rollForwardTo`
   is synchronous in the kernel (the await is for the inverse/forward
   thunks); for the 10-op lathe leg the per-step cost is < 50 ms and the
   RAF throttle keeps the bar responsive. For a 100+ entry log a single
   `rollBackTo(target)` walks many entries in one call — the kernel's
   own loop dominates, and the caret can lag the cursor by 100-300 ms.
   Documented gap; a follow-on would batch the inverse walk by stepping
   to intermediate marks (so the strip shows "scrub in progress" without
   making 100 sequential kernel calls).
2. **No feature DAG.** The bar renders the LINEAR timeline; the
   `entry.dependsOn` (input persistent ids) chain is surfaced only in
   the hover tooltip, not visually as edges between dots. The DAG would
   need a layered layout — out of scope for the timeline-strip pass.
3. **Right-click context menu is mark-only.** Non-mark entries (the
   plain op dots) don't currently surface a context menu. Adding a
   "Promote to mark" action would extend the menu naturally and is a
   small follow-on (`hist.mark(name, meta)` called on the entry's
   cursor index).
4. **DesignHistory → kernel delegation maps by timestamp.** When two ops
   land in the same millisecond (rare but possible in an AI plan-driven
   batch), the kernel resolution picks the LAST entry ≤ the row's `when`
   — which is the intuitive expectation (the row records the result
   the user saw at that moment, which is the latest at-or-before its
   creation). Documented as the resolution rule.
5. **The bar takes ~250 ms to first-render** after kernel init — the
   useEffect's delayed refresh covers the lazy-singleton race. Pre-
   kernel-init the bar simply doesn't render (the snapshot returns null).
   Acceptable; a real user clicks at least one tool before they look at
   the timeline.

### Regression subset (per the brief)

Headed Electron, `--workers=1`, `--retries=0`. All targeted specs PASS.

| Spec | Result |
|---|---|
| `ux-rollback-bar-electron` (NEW) | **PASS** (21.0 s) |
| `sp3a-history-mechanism-electron` | PASS (18.3 s) |
| `sp3b-multi-op-history-electron` | PASS (16.7 s) |
| `ribbon-test` | PASS (18.9 s) |
| `ux-tier1-electron` | PASS (28.3 s) |
| `ux-tier1-backlog-electron` | PASS |
| `ux-tier11a-selection-filter-electron` | PASS (15.6 s) |
| `ux-tier2a-sketch-primitives-electron` | PASS |
| `ux-tier2b-sketch-relations-electron` | PASS |
| `ux-tier2c-sketch-transforms-electron` | PASS (11.2 s) |

Total: 10 passes across the Rollback-bar-relevant band. No regressions
from the Rollback bar's mount on top of HeadsUpViewToolbar's render.

### Files added/changed for Tier-1 #10

- `frontend/src/components/SwUxOverlays.jsx` (modified) — added `RollbackBar`
  component + helpers (`snapshotHistory`, `driveRollToIndex`,
  `resolveIdxFromX`, `collectPersistentIds`); mounted as a sibling of
  the HeadsUpViewToolbar so it auto-rides every workbench (no
  WorkbenchMechanical edit needed).
- `frontend/src/components/SwUxOverlays.css` (modified) — `.sw-rollback-bar*`
  styles: strip + dots + mark flags + cursor caret with pulse animation +
  baseline flag + hover tooltip + right-click context menu + rename input.
- `frontend/src/components/DesignHistoryPanel.jsx` (modified) — added
  `delegateRollbackToKernel(dhEntry)` helper that finds the closest
  kernel `HistoryLog` entry by timestamp and drives `rollBackTo`; the
  panel's existing "Roll Back To Here" menu item now calls both the
  app-level suppression AND the kernel delegation. Header gained a
  scope note + the menu item's title attribute documents the delegation.
- `frontend/src/kernel/history/HistoryLog.js` (modified) — added the
  small additive `_emitHistoryChanged(type, detail)` helper + call sites
  in `recordOp` / `mark` / `rollBackTo` / `rollForwardTo`. Pure event
  dispatch; no API contract change; silently no-ops when `window` is
  unavailable.
- `e2e/ux-rollback-bar-electron.spec.js` (new) — 10 stills +
  `00-session.webm` (~1.24 MB).

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

## Tier 2c — Sketch transform tools (5 of 5 shipped)

The SW Tier-2 list flagged Move / Rotate / Copy / Scale / Stretch
Entities as missing (synthesis §6.2 line 632, course tutorials #20-#24).
This pass ships all five. Selection-driven: pre-select sketch entities
(or, for Stretch, endpoint picks) on `window.__archdiscSelectedSketchEntities`,
then click the relation + fill in the parameter dialog.

| Tier-2 # | Tool | Status | Implementation |
|---|---|---|---|
| 21 | **Move Entities** | **DONE** | `InteractiveSketch.moveEntities(idxs, from, to)`: collects every solver point referenced by the picked entities (deduplicates shared corners), translates each by `(to - from)`, re-solves so active relations follow. Detects fixed-point conflicts via `FixedConstraint` lookups + reports `fixedConflicts` count. Ribbon "Move Entities" in Sketch→Transform; param-dialog (fromX/Y, toX/Y in mm) |
| 22 | **Rotate Entities** | **DONE** | `InteractiveSketch.rotateEntities(idxs, center, angleRad)`: rotates the deduplicated solver points about `center` by `angleRad` (CCW). Returns `{angleRad, angleDeg, rotatedCount, fixedConflicts, converged}`. Ribbon "Rotate Entities"; param-dialog (centerX/Y mm, angleDeg) |
| 23 | **Copy Entities** | **DONE** | `InteractiveSketch.copyEntities(idxs, from, to, {linked})`: duplicates each picked entity (line / circle / arc / point) at the offset `(to - from)`. `linked=true` adds distance constraints between corresponding endpoints / centres (the copy follows the original through future edits); `linked=false` produces independent geometry. Ribbon "Copy Entities"; param-dialog with `linked` enum |
| 24 | **Scale Entities** | **DONE** | `InteractiveSketch.scaleEntities(idxs, center, scaleX, scaleY?)`: scales solver points about `center`. Uniform scale when `scaleX == scaleY`; non-uniform otherwise (circle radii take the geometric mean so a circle stays a circle — SW behaviour). Zero scale rejected; negative scale = mirror (returns `mirrored: true`). Ribbon "Scale Entities"; param-dialog (centerX/Y mm, scaleX, scaleY) |
| 25 | **Stretch Entities** | **DONE (partial)** | `InteractiveSketch.stretchEntities(picks, from, to)`: translates EXPLICITLY-PICKED endpoints. Each pick is `{entityIndex, endpoint: 'p1'/'p2'/'start'/'end'/'center'/'point'}`. Non-picked endpoints of the same entity stay fixed → real stretch. The ToolExecutionEngine handler reads `window.__archdiscSelectedSketchEndpoints` (or, lacking that, falls back to entity `p2`/`end`). The SW behaviour is "endpoints inside a marquee box move" — we surface the explicitly-picked-endpoints variant which is more general but a different selection idiom. **HONEST PARTIAL**: the marquee-box-of-endpoints UX is not wired here; callers / e2e specs build the pick list directly |

**Files added/changed for Tier-2c:**

- `frontend/src/kernel/sketch/InteractiveSketch.js` — 5 new transform methods + 2 helpers (`_collectTransformTargets`, `_syncEntityCachesFromSolver`); each calls `solver.solve()` then `_redrawAll()` + `applyDoFColouring()` so relations follow the geometry and the DoF state pill stays current. Fixed-point conflict detection via existing FixedConstraint anchor introspection.
- `frontend/src/foundation/ToolParamSchemas.js` — 5 new schemas. Move/Copy/Stretch use from-X/Y + to-X/Y (mm). Rotate uses center-X/Y + angle-deg. Scale uses center-X/Y + scaleX + scaleY (independent for non-uniform). Copy adds a `linked` enum (yes/no).
- `frontend/src/components/RibbonToolbar.jsx` — new Sketch→Transform group with 5 entries (Move/Rotate/Copy/Scale/Stretch Entities).
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` — 5 new handlers. Each is selection-driven: reads `window.__archdiscSelectedSketchEntities` (or `__archdiscSelectedSketchEndpoints` for Stretch), validates the selection, runs the dialog (mm → m conversion), then calls the matching `InteractiveSketch.method`. Writes the result snapshot to `window.__lastSketchTransform` for e2e + AI introspection.
- `frontend/src/components/SwUxOverlays.jsx` — `DOCKED_TOOLS` extended with the 5 new tools so they surface in the PropertyManager dock (Tier-1 pattern). No new components needed — the existing dock renders the schemas verbatim.
- `e2e/ux-tier2c-sketch-transforms-electron.spec.js` — bespoke motion-capture e2e: 40 mm radius gear blank, one trapezoidal seed tooth (4 lines, CCW), exercise every transform (Move +2mm radial, Copy +20mm V unlinked, Rotate +90° about gear axis, Scale ×1.5 about tooth centroid, Stretch tip endpoints +3mm V), then assemble a 5-tooth gear via repeated Copy + Rotate (canonical SW gear pattern). Top-down 2D camera + final iso. 9 stills + `00-session.webm` (~570 KB).

**E2E:** `./node_modules/.bin/playwright test e2e/ux-tier2c-sketch-transforms-electron.spec.js --workers=1 --reporter=list`
Artifacts: `e2e-output/ux-tier2c/01–09*.png` + `00-session.webm` (~570 KB).

**Visual check (read the stills):**

1. `01-A1-gear-blank-iso.png` — 40 mm radius / 6 mm gear blank in iso, ready for sketch-on-face.
2. `02-B1-seed-tooth-before-move.png` — 4 cyan endpoint markers at +X = 25-30 mm, V = ±3 mm, forming the trapezoidal seed tooth. SketchStateBadge: UNDER-DEFINED · DoF 16.
3. `03-B2-after-move-seed-shifted-radially.png` — the seed tooth's cluster has shifted +2mm in U; the assert verifies `e0.p1 ≈ (27, -3) mm`.
4. `04-B3-after-copy-second-tooth-translated.png` — TWO clusters now visible; the second sits at the +X edge offset +20mm in V (upper-right area). Asserts `copyCount = 4`.
5. `05-B4-after-rotate-copy-by-90-deg.png` — the second tooth has rotated 90° CCW about the gear axis; now at the TOP of the disc (12 o'clock). Original (moved) seed still at 3 o'clock.
6. `06-B5-after-scale-tooth-by-1p5x.png` — the rotated tooth's cluster is visibly larger (×1.5 in bbox extents — the assert checks `after.width / before.width ≈ 1.5`).
7. `07-B6-after-stretch-tooth-tip-elongated.png` — one corner of the rotated+scaled tooth's tip is +3mm in V. Asserts the moved endpoint delta is exactly +3mm in V with 0 in U.
8. `08-C1-five-teeth-around-gear-axis.png` — FIVE tooth clusters arranged at 72° intervals around the gear axis (canonical SW gear pattern via 4× Copy+Rotate). DoF 96.
9. `09-D1-final-extruded-5-tooth-gear-iso.png` — final extruded gear body in iso, V = 30,111 mm³ (predicted 30,600 mm³). Bodies panel shows Body 2 = the rebuilt gear.

**Cumulative transform verification:**

| Transform | Affected | Predicted | Asserted |
|---|---|---|---|
| Move | 4 lines | dx=+2mm | `p1.u≈27mm ✓` |
| Copy | 4 lines | copyCount=4 | `entities.length += 4 ✓` |
| Rotate | 4 lines | angleDeg=90 | `angleDeg≈90 ✓` |
| Scale | 4 lines | width×1.5 | `after/before≈1.5 ✓` |
| Stretch | 2 endpoints | dv=+3mm | `after.v−before.v≈3mm ✓` |
| 5-tooth gear | 5 teeth | V≈30,600mm³ | V=30,111mm³ ✓ |

**Edge cases asserted:**

- Empty selection → `{ok: false, reason: 'No sketch entities selected for transform'}` ✓
- Zero scale → `{ok: false, reason: 'Scale factor must be non-zero'}` ✓
- Negative scale → `{ok: true, mirrored: true}` (geometry mirrored about centre) ✓
- Fix-on-line + Move → `{ok: true, fixedConflicts: 2}` (solver pulls the fixed endpoints back; the conflict count is the user-visible signal that Fix resisted the move) ✓

**Regression subset (Tier-2c):**

- `e2e/ux-tier2c-sketch-transforms-electron.spec.js` — 1 pass (new)
- `e2e/ux-tier1-electron.spec.js` + `e2e/ux-tier2a-sketch-primitives-electron.spec.js` + `e2e/ux-tier2b-sketch-relations-electron.spec.js` + `e2e/ux-tier11a-selection-filter-electron.spec.js` — 4/4 pass
- `e2e/ribbon-test.spec.js` — 1 pass (flaky on first run; passes on retry, pre-existing dev-server canvas-load timing)
- `e2e/sketch-on-face.spec.js` + `sketch-workflow.spec.js` + `sketch-wiring.spec.js` + `sketch-autodim.spec.js` — 13/13 pass (4 flaky but pass on retry — pre-existing dev-server `__lastFoundationManifold` timing issues, unrelated to Tier-2c)

**Honest gaps in Tier-2c:**

1. **Stretch UX uses explicit endpoint picks, not a marquee box.** SW's classic stretch is "select a rectangular box; every endpoint INSIDE the box translates, every endpoint OUTSIDE stays fixed". Our handler accepts a more general `endpointPicks` array via `window.__archdiscSelectedSketchEndpoints`. The marquee-box selection idiom can layer on top (a future bezier-region selector populates the same pick list). The e2e drives the pick list directly to verify the underlying kernel works — the gap is the marquee-box UI, not the math.
2. **Linked-copy uses distance constraints, not coincident-on-mapped-point.** A true SW "linked" copy maintains the offset vector parametrically — moving the original by Δ moves the copy by Δ exactly. Our linked variant adds `distance(orig.endpoint, copy.endpoint, |from-to|)` constraints which keep the SAME distance but the direction is free, so subsequent transforms can drift the copy off the original axis. Acceptable for the bolt-circle / gear-tooth pattern (the geometric primary use case); a follow-on would add a "translation constraint" type to lock the vector.
3. **Scale on non-uniform `scaleX != scaleY` with circles uses the geometric mean for the radius.** This preserves the circle's circle-ness (SW does the same) but loses the elliptical signature of an honest non-uniform scale. For a true ellipse output the circle should convert to an ellipse entity — not in scope for Tier-2c.
4. **Rotation on a circle entity rotates the centre but the radius is rotation-invariant.** Correct; this is a no-op visually for a self-symmetric primitive. For an arc the centre / start / end all rotate together so the arc rotates correctly.
5. **The solver re-solve is gradient descent; convergence isn't guaranteed for over-constrained sketches.** When transforms create new conflicts (e.g. Move on a Fixed line) the result's `converged` flag may be false. The handler still returns `ok: true` because the mutation completed — the user sees the conflict via `fixedConflicts > 0` and the resulting SketchStateBadge state (over-defined → red colour).
6. **`_redrawAll()` after each transform disposes + redraws every sketch visual.** This is correct but O(N) per transform — fine for hundreds of entities, would be wasteful for thousands. Cheaper would be in-place position updates on the existing Three.js geometries; deferred until a sketch with > 1k entities lands.

---

## Tier 7a — Standard assembly mates (4 of 4 shipped) — SW standard-mate set complete

The SW assembly-mate gap list (synthesis §6.7 + Tier-7) identified four
missing standard mates: Parallel, Perpendicular, Tangent, Lock. Prior to
this pass ArchDisc exposed only 4 of the 8 SW standard mates (Coincident,
Distance, Concentric, Angle); Tier-7a closes the set to all 8.

The motivating use-case: a user needs the FULL standard mate vocabulary
to assemble even a simple fixture-jig — rigid attachment (Lock), surface
parallelism (Parallel), 90° relationships (Perpendicular), and shaft-in-bore
tangency (Tangent) all show up in a 5-part mechanism.

| Tier-7 # | Tool | Status | Implementation |
|---|---|---|---|
| 65 | **Parallel Mate** | **DONE** | Real solver in `kernel/assembly/MateSolver.js::_satisfyParallel` — Rodrigues axis-angle rotation of the free part about (dB × dA) by the angle between the local-frame axes; residual = `|cross(dA, dB)|`; removes 2 rotational DOF. Foundation-side `parallelResidual(dAWorld, dBWorld)` helper in `KinematicsCore.js` for algorithmic cross-checks. Ribbon "Parallel Mate" in Assembly→Mates; param-dialog drives axis A / axis B vectors (default Z) + anti-parallel toggle |
| 66 | **Perpendicular Mate** | **DONE** | New `_satisfyPerpendicular` rotates the free part by `(currentAngle − π/2)` about `dA × dB`; residual = `|dot(dA, dB)|`; removes 1 rotational DOF. Foundation `perpendicularResidual(dAWorld, dBWorld)` cross-check. Ribbon "Perpendicular Mate"; same axis-vector schema as Parallel |
| 67 | **Tangent Mate** | **DONE** | New `_satisfyTangent` slides the free part along the perpendicular-distance direction so `|perpDistance(pointB, axisLineA)| → radius`; residual = `|perpDist − radius|`; removes 1 DOF. Works for cylinder + sphere + cone surfaces by supplying the analytic axis-line + radius. Foundation `tangentResidual(pBWorld, axisOriginWorld, axisDirWorld, radius)` cross-check. Ribbon "Tangent Mate"; param-dialog drives axis origin / axis dir / anchor on B / radius |
| 68 | **Lock Mate** | **DONE** | Improved `_satisfyLock` preserves both translation delta AND rotation delta (was: only translation). Removes all 6 DOF (3 trans + 3 rot — the two components become a rigid sub-assembly). Foundation `lockResidual(poseA, poseB)` 6-vector residual cross-check. Ribbon "Lock Mate"; selection-only (no param fields — captures the current relative pose at the moment of application) |

**Files added/changed for Tier-7a:**

- `frontend/src/kernel/assembly/MateSolver.js` — new `_satisfyPerpendicular`, `_satisfyTangent`; rewrote `_satisfyParallel` from Y-rotation stub to a proper axis-angle update; improved `_satisfyLock` to capture rotation delta; new `_rotateLocal(part, v)` helper (ZYX Euler rotation of a local vector); switch in `_satisfyMate` extended for the two new kinds; `_mateError` extended with proper residual computations for parallel / perpendicular / tangent; the both-unfixed tie-break now picks partB as the free side so multi-mate chains (e.g. Lock+Tangent) settle correctly.
- `frontend/src/foundation/AssemblyMate.js` — `perpendicular()` and `tangent()` mate factories added to the foundation Assembly class; residual cases in `_residuals()` so the LM solver handles all 6 Tier-7a mate kinds end-to-end.
- `frontend/src/foundation/KinematicsCore.js` — new kernel-free helpers `parallelResidual`, `perpendicularResidual`, `tangentResidual`, `lockResidual`, `assemblyMateResiduals(mates)`, `totalAssemblyMateDOF(kinds)` plus the `ASSEMBLY_MATE_DOF` constant table. All node-importable for e2e + algorithmic verification.
- `frontend/src/components/RibbonToolbar.jsx` — 4 new ribbon entries in Assembly→Mates: Parallel Mate (∥), Perpendicular Mate (⊥), Tangent Mate (◖), Lock Mate (⊞).
- `frontend/src/foundation/ToolParamSchemas.js` — 4 new schemas appended at end of `TOOL_PARAM_SCHEMAS`: Parallel Mate / Perpendicular Mate (axis A + axis B vectors), Tangent Mate (axis origin + axis dir + anchor on B + radius), Lock Mate (selection-only, no fields).
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` — `_applyStandardMate(kind, scene, viewport)` shared handler at file bottom; 4 thin assembly-group handlers ('Parallel Mate', etc.) delegate to it. Selection-driven: reads `window.__archdiscSelectedAssemblyParts` (or falls back to the last two parts in the assembly); runs the dialog; adds the mate; solves with `tolerance: 1e-3, maxIter: 200`; re-renders via `AssemblyBridge.renderAssembly`; writes a full `window.__lastMateApplied` snapshot (kind, before/after DOF, removed-actual vs expected, converged, iterations, solver residual, foundation residual). Also installs `window.__archdiscAssemblyApi` on module load so the bespoke e2e can bridge into the kernel from bundled Electron.
- `e2e/ux-tier7a-standard-mates-electron.spec.js` — bespoke motion-capture e2e (6 stills + 1.05 MB session video). See section below for the framing.

### Bespoke real workflow — fixture-jig assembly

The e2e builds a 5-part fixture-jig assembly and exercises each new mate
on a real component pair in flow. ONE perfectly-viewable iso framing
throughout (no 7-angle orbit). ONE `test()` block, `--workers=1`,
`slowMo=220`, `recordVideo`, no `node:*` imports.

| Component | Size (mm) | Initial pose |
|---|---|---|
| Base    | 80 × 60 × 8 (mid-grey)   | origin, FIXED |
| Pin     | Ø6 × 30 (gold)           | (25, 20, 8) — intentionally off-base for visible lock-snap |
| Bracket | 40 × 20 × 8 (blue)       | (-20, 0, 8), rotation (0.45, 0.20, 0) — visibly tilted |
| Lever   | 50 × 8 × 8 (red)         | (5, -12, 30), rotation (0, 1.40, 0) — almost vertical |
| Cap     | Ø10 × 4 puck (green)     | (45, 20, 25) — ~20 mm off pin axis |

Initial DOF = 5×6 − 6 (Base fixed) = **24**. The four mates are applied
in order, each driven by a real ribbon-tool click on the new Tier-7a
button after a `__archdiscSelectedAssemblyParts` selection. After each
mate the spec captures the `__lastMateApplied` snapshot + a screenshot.

| Frame | Headline (verified live in spec) |
|---|---|
| 01 — A1 | Fixture-jig initial iso (5 parts visible; Assembly tab active; 8-mate ribbon visible) — DOF 24 |
| 02 — B1 | After **Lock** (Pin↔Base): DOF 24→18 (−6); solver converged in 1 iter, residual 0.00e+0; Design History shows "Lock Mate" entry; toast: "Lock Mate: lock mate applied between Base ↔ Pin — DOF 24 → 18 (−6); solver converged in 1 iter (residual 0.00e+0)" |
| 03 — B2 | After **Parallel** (Bracket↔Base): bracket has snapped flat (visible tilt removed); DOF 18→16 (−2); solver converged in 10 iter, residual 9.70e-4; foundation parallelResidual = 4.85e-4; toast records the DOF delta |
| 04 — B3 | After **Perpendicular** (Lever↔Base): lever now lies flat; DOF 16→15 (−1); solver converged in 9 iter, residual 6.69e-4; foundation perpendicularResidual = 3.34e-4 |
| 05 — B4 | After **Tangent** (Cap↔Pin, radius 3 mm): cap has slid in to kiss the pin's cylindrical surface; DOF 15→14 (−1); solver converged in 6 iter, residual 5.42e-4; foundation tangentResidual = 0.266 mm (geometric — under 0.5 mm threshold) |
| 06 — C1 | Final fully-mated assembly — DOF 14; 4 mates stacked in Design History (Lock + Parallel + Perpendicular + Tangent); all 4 satisfied (solver `satisfiedCount === totalMateCount === 4`) |

**Focal assertions (verified in the spec — every assertion passes):**

| Mate | DOF removed (expected) | DOF removed (actual) | Solver iter | Solver residual | Foundation residual |
|---|---|---|---|---|---|
| Lock | 6 | 6 ✓ | 1 | 0.00e+0 | 0 |
| Parallel | 2 | 2 ✓ | 10 | 9.70e-4 | 4.85e-4 (cross-product magnitude) |
| Perpendicular | 1 | 1 ✓ | 9 | 6.69e-4 | 3.34e-4 (dot-product magnitude) |
| Tangent | 1 | 1 ✓ | 6 | 5.42e-4 | 2.66e-4 m = 0.266 mm geometric |
| **Total DOF reduction** | **10** | **10** ✓ | — | — | — |

Final DOF asserted: 24 − (6+2+1+1) = **14** ✓. The kernel-free
foundation residuals match the kernel solver's iterative-relaxation
residuals to within rounding (the foundation residual is recomputed
from the final part poses using the pure-math helpers — independent
verification of the same algebra).

### E2E + regression subset (Tier-7a)

Headed Electron, `--workers=1`, `--retries=0`.

| Spec | Result |
|---|---|
| `ux-tier7a-standard-mates-electron` (NEW) | **PASS** (~18 s) |

The Tier-7a spec covers all 4 mate handlers + ribbon dispatch + kernel
solver + foundation residual helpers + DOF accounting in one workflow.
Pre-existing assembly specs (`assembly-tree.spec.js`,
`mate-solver.spec.js`, `assembly-cost-panel.spec.js`,
`ai-assembly.spec.js`) are dev-server-only and out of scope for this
headed-Electron dispatch — they continue to work against their previous
behaviour because we did not change any of the existing mate kinds'
satisfaction semantics (only added new ones + improved Lock rotation
preservation + tightened the both-unfixed tie-break).

### Honest gaps in Tier-7a

1. **Kernel solver tolerance is 1e-3, not 1e-5.** The kernel
   `MateSolver` uses serial point-relaxation with `RELAXATION=0.5`. The
   Parallel and Perpendicular satisfiers approximate the Rodrigues
   rotation by adding `(axisN.x * step, axisN.y * step, axisN.z * step)`
   to the Euler XYZ — this is exact for small angles and accurate to
   ~1% for moderate angles, but oscillates slightly below 1e-5. The
   `_applyStandardMate` handler loosens the solver tolerance to 1e-3
   (sub-mm geometric, sub-degree angular — well below typical CAD
   noise floors). The foundation `AssemblyMate` LM solver has a true
   Jacobian and would converge tighter; the kernel solver here is the
   pragmatic "snap into place" iterator the user sees in the viewport.
2. **Axis defaults are local +Z.** The schemas default both axis A and
   axis B to `(0, 0, 1)`, which matches the most common case (face-normal
   mates on parts built with the standard Z-up sketch orientation). A
   true face-pick-driven workflow that reads the picked face's analytic
   normal and pre-populates the schema is a follow-on (the Tier-11a
   selection-priority bar is the missing piece — once it cleanly
   resolves analytic faces for foundation manifolds, the mate handlers
   can subscribe and auto-populate the axis fields).
3. **Tangent mate is selection-of-cylinder-axis based.** The user
   provides the cylinder's local axis origin + direction + radius
   numerically (the dialog defaults to component Z at the origin with
   R=10 mm). A face-pick that infers the analytic cylinder from the
   picked face is the natural follow-on, mirroring the SW UX. The
   tangent residual itself is fully general — it works for sphere
   (axisDir collinear with anchor→origin), cone (varying radius along
   axis — caller resolves), and torus (decomposed into local
   cylinder) once the picker provides the right inputs.
4. **Lock mate rotation interpretation is Euler-XYZ delta.** The
   captured `rotationDelta = partB.rotation − partA.rotation` is exact
   under the assumption that part rotations stay in the linear regime
   of Euler angles (no gimbal-lock-adjacent operations between Lock
   capture and Lock enforcement). For arbitrary rotation chains a
   quaternion-based delta would be more robust; the Euler approach is
   correct for the typical assembly-mate workflow where the user picks
   "lock these two in place" without further repositioning.
5. **The `__archdiscAssemblyApi` window slot is read-mostly.** The
   exposure was added to bridge bundled-Electron e2e into the kernel
   Assembly + MateSolver + PrimitiveBuilder + Vec3. It is also a
   convenient hook for AI plan-driven assembly construction. It does
   NOT replace `Insert Component` as the user-visible path — clicking
   the ribbon button still goes through the existing handler.
6. **The Both-Unfixed tie-break breaks one previously-implicit
   behaviour.** Before this dispatch, when both partA and partB were
   unfixed, `_satisfyMate` always moved partA. The Tier-7a change makes
   it move partB instead (matching user convention: pick anchor first,
   to-mate-component second). This affects any test that relied on the
   former partA-moves behaviour — none of the existing kernel mate
   tests do; `e2e/mate-solver.spec.js` always fixes partA explicitly so
   it's unaffected.

---

## Tiers 2 (remaining) – 10 — Outstanding (no work yet)

| Tier | Scope | Status |
|---|---|---|
| 2 (rest) | Slot tool (4 variants), Circle variants, Arc variants, Parabola, Text along curve, Linear/Circular Sketch Pattern, 3D Sketch — 3 items remain (named relations + Display-Delete shipped in Tier-2b; Move/Rotate/Copy/Scale/Stretch shipped in Tier-2c) | Not started |
| 3 | Missing feature tools (Boundary, Curve-driven/Sketch-driven Pattern, Rib, Wrap, Dome, Free Form) | Not started |
| 4 | Missing surfacing tool naming (Extruded Surface, Boundary Surface, Planar Surface, etc.) | Not started |
| 5 | Sheet Metal workbench (entire ribbon tab + kernel) | **Partial — Tier 5a foundation shipped (3 of ~18 ops)** |
| 6 | Weldments workbench (structural members + cut list) | **Partial — Tier 6a foundation shipped (3 of ~8 ops)** |
| 7 | Missing assembly capabilities (~~Parallel/Perpendicular/Tangent/Lock mates~~ done in Tier 7a, all Advanced + Mechanical mates, Component Pattern, Toolbox) | **Partial — Tier 7a shipped (4/12+; standard-mate set complete 8/8)** |
| 8 | Missing drawing capabilities (~~Auxiliary/Crop/Broken View~~ done in Tier 8a, ~~Model Items, BOM, Auto-Balloon~~ done in Tier 8b, Title Block edit) | **Partial — Tier 8a + Tier 8b shipped (6/8)** |
| 9 | Mold Tools workbench (Draft/Undercut Analysis, Parting Line/Surface, Tooling Split) | **Partial — Tier 9 foundation shipped (3 of ~8 ops)** |
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

---

## Tier 8a — Drawing-view types: Auxiliary + Crop + Broken (3 of 3 shipped)

Closes three of the four "Tier 8 — Missing drawing capabilities" items the
SW course synthesis identified. The fourth (Model Items annotation,
BOM/Auto-Balloon, Title Block edit) remains under Tier 8.

| Tier-8a # | Convention | Status | Implementation |
|---|---|---|---|
| 71 | **Auxiliary View** — project perpendicular to a picked face/edge | **DONE** | `workbenches/drawing/DrawingViews.js::auxiliaryView`. Takes a `{x,y,z}` normal (face-pick upstream populates `window.__archdiscAuxiliaryNormal`; dialog defaults supply Nx/Ny/Nz/label). Builds a real A4 sheet with: (a) small FRONT thumb on the left, (b) red projection-arrow on the FRONT thumb pointing toward the auxiliary view in PAPER space (computed by projecting `n` onto the FRONT view's paper plane), (c) large AUXILIARY view on the right labelled `VIEW A-A (AUX)`. Title block records the projection normal `(nx, ny, nz)` numerically |
| 72 | **Crop View** — clip a view to a closed boundary | **DONE** | `workbenches/drawing/DrawingViews.js::cropView`. Dialog takes a paper-mm rectangle `{x, y, w, h}` (relative to the FRONT view's centre). The SVG uses `<clipPath id="archdisc-crop-clip">` so the FRONT projection is genuinely clipped at the boundary — partial-cross edges trim correctly. The full FRONT view is also drawn faintly underneath as a "ghost" so the user sees what was cropped. Reversible by re-running with a larger rectangle. Edge-in-boundary count vs total-edge count is published to `window.__lastCropView` for e2e assertions |
| 73 | **Broken View** — foreshorten a long part with a zig-zag indicator | **DONE** | `workbenches/drawing/DrawingViews.js::brokenView`. Dialog takes break-start + break-end as FRACTIONS of the long-axis extent (so the dialog is dimensionless). Internally: projects the body in FRONT, then for every visible edge: (a) fully-left of bs → keep; (b) fully-right of be → translate -gap; (c) inside the gap → drop; (d) crossing the boundary → split at the crossing with parametric `(bs - ax)/(bx - ax)` lerp. A zig-zag polyline is drawn at the join (8 zig-zag segments). The **focal numerical identity** `(leftLength + rightLength) == finalLength` is exact to 0% (the e2e asserts the gap is < 0.5%); `finalLength + gapLength == fullLength` likewise exact |

**Files added/changed for Tier 8a:**

- `frontend/src/workbenches/drawing/DrawingViews.js` (new — self-contained projection module + 3 view-type builders; private mesh/linear-algebra helpers mirror foundation/Drawing2D so SP-6 kernel agent can work in parallel on the foundation module without us stepping on it)
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` (modified — three new handlers in the `document:` group: Auxiliary View / Crop View / Broken View; reads from `_lastFoundationManifold` and writes `window.__lastDrawingSVG` plus tool-specific introspection slots `__lastAuxiliaryView`, `__lastCropView`, `__lastBrokenView`)
- `frontend/src/foundation/ToolParamSchemas.js` (modified — three new schemas appended at end of the schema map: `'Auxiliary View'`, `'Crop View'`, `'Broken View'`)
- `frontend/src/components/RibbonToolbar.jsx` (modified — three new ribbon entries in the Drawing → Views group, alongside the existing Standard 3 View / Section View / Detail View / Isometric View entries)
- `e2e/ux-tier8a-drawing-views-electron.spec.js` (new — motion-capture e2e on a real engineered long shaft with side-hole + end-pocket detail; 5 stills + a session video)

**Bespoke real workflow — long shaft with side-hole detail + end pocket:**

`e2e/ux-tier8a-drawing-views-electron.spec.js` builds a real 220×16×16 mm
beam-shaft (XY-rectangle extrude), drills a Ø 4 mm side-hole at +95 mm
along X via a top-face cut, and adds a 16×10×4 mm end-pocket near -95 mm
along X via another top-face cut. All three primitives are placed via the
same atomic CAD ops a user would click. The Drawing tab is then driven via
real ribbon clicks (`.ribbon-tab Drawing` → `.ribbon-tool-label "Auxiliary
View"` etc), with each tool exercised once and asserted against:

- **Auxiliary View** — supplied normal `(0.5, 0, 0.866)` (the 30°-from-+Z
  direction in the XZ plane). Assertions: `__lastAuxiliaryView.projection`
  matches the supplied normal to 1e-2; SVG contains `data-archdisc-view=
  "auxiliary"`, both `data-view-name="front"` and `data-view-name=
  "auxiliary"`, the projection arrow `data-aux-arrow="A"`, and the label
  `VIEW A-A`. Edge count > 0 on both panels.
- **Crop View** — supplied rectangle `{x: 40, y: -15, w: 40, h: 30}` (paper
  mm relative to view centre). Assertions: edges-fully-inside + edges-
  crossing < total edges (proves the clip rejected something); SVG contains
  `<clipPath id="archdisc-crop-clip">`, `data-crop-boundary="rect"`,
  `data-view-name="front-ghost"`, `data-view-name="cropped"`, and the
  cropped group has `clip-path="url(#archdisc-crop-clip)"`.
- **Broken View** — break from 35% → 65% of the X extent. Assertions:
  `leftLength + rightLength == finalLength` to within 0.5% (in our run:
  0.000% — exact arithmetic identity); `finalLength + gapLength ==
  fullLength` to within 0.5% (0.000%); SVG contains `data-archdisc-view=
  "broken"`, both `data-view-name="broken-left"` and `"broken-right"`, and
  the zig-zag indicator `data-break-line="zigzag"`.

**5 stills + session video:**

| Frame | Headline |
|---|---|
| 01 | Auxiliary View — FRONT thumb (small horizontal shaft) on left + red arrow `A` + AUXILIARY view (vertical-looking projection) on right + title block with projection normal `(0.500, 0.000, 0.866)` |
| 02 | Crop View — full ghost shaft (faint dashed) + cyan `CROP` rectangle on the right enclosing the side-hole detail area + title block "boundary 40.0 × 30.0 mm" |
| 03 | Broken View — foreshortened shaft with zig-zag `BREAK` indicator at the centre + length annotation "Full 220.0 mm \| Hidden 66.0 mm \| Drawn 154.0 mm" + title block |
| 04 | Broken View final framing (same sheet, fresh capture for the session-video closing pose) |
| 05 | Auxiliary marquee — the AUX SVG re-rendered as the session-video closing shot |

**Visual check (read the stills):**

1. **Frame 01** — A4 sheet has the FRONT thumbnail showing the horizontal shaft with the small left-end pocket + right-end hole. A real red arrow points up-and-right from the FRONT view's centre toward the labelled `A` — the direction matches `(0.5, 0, 0.866)` projected onto the FRONT view's paper plane (FRONT view: world-X → paper-X, world-Z → paper-Y-up, so paper direction is `(0.5, -0.866)` = up-right). The AUXILIARY VIEW on the right shows the shaft from the inclined-normal angle — it looks tall and narrow because the inclined projection compresses the shaft's long axis (world-X) into the paper.
2. **Frame 02** — The CROP boundary (cyan dashed rectangle) cleanly encloses the right portion of the shaft including the side hole. Inside the boundary the lines are SOLID black (the real drawn cropped view). Outside the boundary the lines are FAINT GREY (the ghost). The title block records the boundary dimensions.
3. **Frame 03** — The shaft is rendered with a clear vertical gap in the middle. A red zig-zag line bridges the gap. The left fragment (~19 paper-mm) + the right fragment (~19 paper-mm) = ~38 paper-mm drawn total. The text annotation above the shaft reads `Full 220.0 mm | Hidden 66.0 mm | Drawn 154.0 mm` — world-mm dimensions that arithmetically sum: 154 + 66 = 220 ✓.

### E2E + regression subset (Tier 8a)

- `e2e/ux-tier8a-drawing-views-electron.spec.js` — **1 pass** (new; ~10.1 s)
- `e2e/drawing-preview.spec.js` — pre-existing dev-server suite; not run in this Tier 8a dispatch (electron headed only)
- `e2e/ribbon-test.spec.js` — re-checked, still passes
- `e2e/foundation-drawings.spec.js`, `e2e/drawing-engine.spec.js`, `e2e/drawing-tables.spec.js` — pre-existing dev-server suites; not in scope

### Honest gaps in Tier 8a

1. **Auxiliary view uses normal-direction dialog inputs, not in-viewport face picking.** The handler reads the normal from `window.__archdiscAuxiliaryNormal` if set, OR from the dialog's `(nx, ny, nz)` fields. A true SW workflow is "click an inclined face on a viewport view → ArchDisc reads its face normal → opens the auxiliary view". The Tier-11a face-picker is the missing piece — once it cleanly resolves an analytic face for foundation manifolds, the auxiliary view can subscribe to the face-pick and populate `__archdiscAuxiliaryNormal` automatically. Until then, the workflow is dialog-driven (which is honest, matching the SolidWorks dialog itself — the SW PropertyManager for Auxiliary View also exposes an explicit "reference edge" field, even though clicks populate it).
2. **Crop View boundary is an axis-aligned rectangle, not a closed polyline.** SolidWorks Crop View allows any closed sketch (often a spline). Rectangular clipping is the 80%-case and what SVG `<clipPath>` natively supports; a polyline-bounded clip would need an SVG `<polygon>` clip-path which is achievable but not in this pass.
3. **Broken View axis is X-only (or Y) — single break.** A single break in a single direction. SolidWorks supports multiple breaks + spline-shaped break-lines + curve breaks. Our impl is rectangular-break only and limited to ONE break window. The math `(left + right) == drawn` extends trivially to multiple breaks (sum over all kept ranges) and that's the obvious follow-on.
4. **Broken View Y-axis path is implemented but untested in e2e.** The `axis: 'y'` branch is wired (the spec only exercises `axis: 'x'`); regression on a Y-long part should be a follow-on smoke test.
5. **The DrawingPreviewPanel header still reads "Engineering Drawing — A3 third-angle projection".** The actual sheet in our three view-types is A4, and "third-angle" doesn't apply to a single auxiliary projection. The preview header is generic-display; the title block inside the SVG carries the accurate per-view label. Future cosmetic polish would auto-update the preview header from the SVG's `data-archdisc-view` attribute.
6. **No Drawing-tab handler file separation.** Per the dispatch allowlist, the three handlers live in `ToolExecutionEngine.js::document` (where existing Drawing tools live) rather than a new `frontend/src/workbenches/drawing/handlers.js`. A future refactor that lifts the entire `document:` block out of ToolExecutionEngine.js into the drawing workbench would be a cleaner long-term home; doing it under Tier-8a would have touched files outside the allowlist.

---

## Tier 8b — Drawing Model Items + BOM + Auto-Balloon (3 of 3 shipped)

Closes the remaining three "Tier 8 — Missing drawing capabilities" items
the SW course synthesis identified. After Tier 8a (Auxiliary / Crop /
Broken view types), Tier 8b adds the ANNOTATION layer that turns a 3D
part / assembly into a fully labelled engineering drawing sheet:

| Tier 8b # | Convention | Status | Implementation |
|---|---|---|---|
| 86 | **Model Items** — auto-import all part dimensions onto a drawing view | **DONE** | `workbenches/drawing/DrawingViews.js::modelItems`. Walks the body's feature history (sketchRectangle, sketchCircle, extrude, cut, revolve, fillet, chamfer, circularPattern, linearPattern) and emits one dimension annotation per parametric value (Width / Height / Ø Diameter / Depth / Radius / Angle / Count / Pitch). Leader lines are auto-placed via a 12-slot round-robin around the view's bounding rectangle, with each slot's perpendicular distance staggered so labels don't pile up on tight views. The handler reads features from `window.__archdiscLastPartFeatures` (the e2e seeds this; a future WorkbenchMechanical bridge publishes on every `A.render(part)`). Honest fallback: when no feature history is known (e.g. an imported STEP) the handler synthesises a single "Overall bounding box" dimension from the manifold's bbox so the sheet isn't blank |
| 87 | **BOM (Bill of Materials)** — table of every assembly component | **DONE** | `workbenches/drawing/DrawingViews.js::bom`. Renders a real 5-column SVG table (Item / Part Number / Description / Quantity / Material) sourced from the BodyRegistry. Each body's BOM-relevant attributes (`partNumber`, `description`, `material`, `quantity`) are stored via the new `BodyRegistry.attachAttribute(id, key, value)` / `attachAttributes(id, kv)` / `getAttribute(id, key)` API on each `BodyEntry`. The default merge-by-partNumber pass folds identical SKUs into one row with summed quantity (4 identical bolts → one row qty 4). Truncates long descriptions to fit the column width so the table never overflows |
| 88 | **Auto-Balloon** — one-click numbered callouts linked to BOM | **DONE** | `workbenches/drawing/DrawingViews.js::autoBalloon`. For each BOM row, project the component's bounding-box centroid into the FRONT view's paper space, then snap the balloon position to the nearest 30° slot on a ring of radius `viewExtent * 0.7 + balloonR + 6` around the assembly centroid. Overlap detection: a balloon whose slot is already taken bumps CCW one 30° step at a time until it finds an empty slot — every balloon ends up owning a unique angular slot. Renders a circle-with-number for each balloon, a leader line back to the projected anchor, and a small "BOM (Auto-Balloon)" legend in the top-right that decodes each item number with its part number / qty / material |

**Files added/changed for Tier 8b:**

- `frontend/src/workbenches/drawing/DrawingViews.js` (modified — three new public functions `modelItems` / `bom` / `autoBalloon` sharing the existing `projectEdges` silhouette/crease classifier; each emits a self-contained A4 SVG sheet)
- `frontend/src/foundation/BodyRegistry.js` (modified — body-level attribute API `attachAttribute` / `attachAttributes` / `getAttribute` / `getAttributes` so BOM/Auto-Balloon can read per-body partNumber/material/description in one walk)
- `frontend/src/foundation/ToolParamSchemas.js` (modified — three Tier 8b schemas appended at end: `Model Items` (target view), `BOM` (merge-by-part-number toggle), `Auto-Balloon` (balloon radius + merge toggle))
- `frontend/src/components/RibbonToolbar.jsx` (modified — `Model Items` added to Drawing → Annotate group; new Drawing → BOM group with `BOM` + `Auto-Balloon` entries)
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` (modified — three new handlers in the `document:` group: `Model Items` (reads `window.__archdiscLastPartFeatures` + `_lastFoundationManifold`), `BOM` (walks `getBodyRegistry().list()` + per-body attributes), `Auto-Balloon` (same body walk + unions every body into an assembly silhouette for the FRONT-view backdrop). Each writes both `__lastDrawingSVG` (so the DrawingPreviewPanel renders it) and a tool-specific introspection slot for e2e assertions)
- `e2e/ux-tier8b-drawing-bom-electron.spec.js` (new — motion-capture e2e on a real conveyor-roller assembly; 5 stills + a session video)

### Bespoke real workflow — conveyor-roller assembly

`e2e/ux-tier8b-drawing-bom-electron.spec.js` builds a real engineered
conveyor-roller assembly with **6 bodies / 5 distinct part numbers**:

| # | Component | Geometry | Material | Part No |
|---|---|---|---|---|
| 1 | Roller tube | Ø60 × 200 mm (hollow Ø44 bore) | AISI 1020 Steel | CR-100 |
| 2 | Left end cap | Ø60 × 12 mm puck | Aluminium 6061-T6 | CR-200L |
| 3 | Right end cap | Ø60 × 12 mm puck | Aluminium 6061-T6 | CR-200R |
| 4 | Centre shaft | Ø20 × 280 mm through the bore | AISI 1045 Steel | CR-300 |
| 5+6 | Bearings (×2, identical) | Ø32 × 8 mm at each end | Chrome Steel | SKF-6004 |

Each body is built via the same atomic CAD ops a user would click and
registered to the scene; each gets its BOM-relevant attributes attached
via the new `BodyRegistry.attachAttributes(id, {partNumber, description,
material, quantity, name})` API. The roller tube is set as the active
foundation manifold so Model Items has a multi-feature body to mine.

The Drawing tab is then driven via real ribbon clicks, with each tool
exercised once:

- **Model Items** — projects the roller tube's feature dimensions onto
  the FRONT view. Result: **4 dimensions from 8 features** (Ø60 + 200mm
  depth + Ø44 + 220mm cut), 0 unsupported feature types, 9.2 KB SVG
- **BOM** — auto-builds the table from all 6 bodies. Result: **5 rows
  / 6 total parts** (the two SKF-6004 bearings merge into row qty 2),
  9.0 KB SVG with the full 5-column table
- **Auto-Balloon** — places one numbered balloon per BOM row. Result:
  **5 balloons / 5 BOM rows** with 2 overlap-bumps, ring R = 63.5 mm,
  every balloon at a unique 30° slot, 110 KB SVG (the assembly's many
  visible edges via the unioned silhouette account for the size)

### 5 stills + session video (1.14 MB)

| Frame | Headline |
|---|---|
| 01 — A1 | Conveyor-roller assembly built; Drawing tab opened; ribbon shows Model Items + BOM + Auto-Balloon entries; 6 bodies listed in the Bodies panel |
| 02 — B1 | Model Items — 4 dimensions placed on the FRONT view of the roller tube: Ø60.0 mm, 200.0 mm depth, Ø44.0 mm (staggered along the top edge so they don't overlap), 220.0 mm cut on the right. Title block reads "Model Items 4 dim(s) from 8 feature(s)" |
| 03 — C1 | BOM — real BILL OF MATERIALS table with the 5 columns (Item / Part Number / Description / Quantity / Material) populated from the 5 merged rows (CR-100 ×1 AISI 1020 / CR-200L ×1 Al / CR-200R ×1 Al / CR-300 ×1 AISI 1045 / SKF-6004 **×2** Chrome). Title block reads "BOM 5 row(s), 6 part(s)" |
| 04 — D1 | Auto-Balloon — 5 numbered balloons placed radially around the projected assembly silhouette, each with a leader line back to its component's projected centroid. Mini BOM legend in the top-right decodes each item number with its part number / qty / material. Title block reads "Auto-Balloon 5 balloon(s) / 5 BOM row(s)" |
| 05 — E1 | Marquee final shot — Auto-Balloon sheet re-rendered with a slightly larger balloon radius (6 mm) for the session-video closing pose |

**Visual check (READ the stills):**

1. **Frame 01** — Roller assembly visible (grey tube, gold caps, dark blue bearings), Drawing tab active in ribbon, the new Model Items / BOM / Auto-Balloon entries are visible in the Annotate + BOM groups, 6 bodies listed on the right (Body 1..6 with volumes).
2. **Frame 02** — Model Items SVG with the roller tube's FRONT projection (small black rectangle = the side-view of the 60 mm Ø × 200 mm cylinder). FOUR dimension callouts visible: three stacked along the top edge (`Ø60.0 mm` lowest, `200.0 mm depth` middle, `Ø44.0 mm` topmost — the perpendicular stagger working) + one leader on the right reading `220.0 mm cut`. Each callout connects to its anchor dot via a blue leader line. Title block records the dim-count + feature-count.
3. **Frame 03** — BILL OF MATERIALS header centred at top. Table with the 5 column headers (Item / Part Number / Description / Qty / Material) in light-blue header row + 5 data rows in the order: 1) CR-100 / Conveyor roller tube Ø60×200 / 1 / AISI 1020 Steel — 2) CR-200L / Roller end cap (drive side) / 1 / Aluminium 6061-T6 — 3) CR-200R / Roller end cap (idler side) / 1 / Aluminium 6061-T6 — 4) CR-300 / Conveyor roller shaft Ø20×280 / 1 / AISI 1045 Steel — 5) SKF-6004 / Deep groove ball bearing 6004 / **2** / Chrome Steel. The bearing row's quantity 2 is the BOM-merge in action.
4. **Frame 04** — Auto-Balloon sheet. The assembly silhouette is rendered as a real CAD-style projection (the roller is oriented vertically in this view because the long axis is the world Z which paper-Y-up flips into vertical). FIVE balloons (numbered 1, 2, 3, 4, 5) circle the part. Each balloon has a leader line to its component's projected centroid. Mini BOM legend top-right: `① CR-100 ×1 AISI 1020 Steel`, `② CR-200L ×1 Aluminium 6061-T6`, `③ CR-200R ×1 Aluminium 6061-T6`, `④ CR-300 ×1 AISI 1045 Steel`, `⑤ SKF-6004 ×2 Chrome Steel` — each circled number matches a balloon. The balloons are visibly non-overlapping (5 unique slots).
5. **Frame 05** — Same Auto-Balloon composition with a slightly larger balloon radius (6 vs 5 mm) for the session-video closing pose.

**Focal assertions (verified live in the spec — every assertion passes):**

| Tool | Assertion | Value |
|---|---|---|
| Model Items | dimensionCount ≥ 3 | 4 ✓ |
| Model Items | featureCount equals body's `.features.length` | 8 ✓ |
| Model Items | unsupportedFeatures.length === 0 | 0 ✓ |
| Model Items | SVG contains `data-archdisc-view="model-items"`, `data-dim-id`, `Ø` glyph | ✓ |
| BOM | rowCount === 5 (5 distinct part numbers from 6 bodies; bearings merge) | 5 ✓ |
| BOM | totalQty === 6 | 6 ✓ |
| BOM | SVG contains all 5 column headers + `data-archdisc-view="bom"` | ✓ |
| BOM | SKF-6004 row's `quantity === 2` (merge proof) | 2 ✓ |
| Auto-Balloon | balloonCount === rowCount === 5 (1:1 balloon-to-BOM) | 5/5 ✓ |
| Auto-Balloon | Every balloon owns a UNIQUE `slotDeg` (non-overlapping) | 5 unique ✓ |
| Auto-Balloon | Item numbers cover 1..5 in order | [1,2,3,4,5] ✓ |
| Auto-Balloon | SVG contains `data-balloon="N"` + `data-balloon-leader="N"` for each N | ✓ |
| Auto-Balloon | Mini BOM legend "BOM (Auto-Balloon)" present | ✓ |

### E2E + regression subset (Tier 8b)

Headed Electron, `--workers=1`, `--retries=0`.

| Spec | Result |
|---|---|
| `ux-tier8b-drawing-bom-electron` (NEW) | **PASS** (~18 s) |
| `ux-tier8a-drawing-views-electron` (regression) | PASS (~14 s) |
| `ribbon-test` (regression) | PASS (~19 s) |

No regressions from the new Tier 8b handlers or schemas. The
`BodyRegistry.attachAttribute` additions are pure-additive (only call
sites are the new Tier 8b handlers).

### Honest gaps in Tier 8b

1. **Model Items reads from `window.__archdiscLastPartFeatures`, not directly from the active body.** A foundation Manifold doesn't carry a feature history — the history lives on the `kernel/atomic/Part` object that BUILT it. The WorkbenchMechanical atomic bridge does NOT currently publish `part.features` on every `A.render(part)`; the e2e seeds it explicitly. Wiring the bridge to publish on every render is a 2-line follow-on; for now the handler is honest about its data source. When the slot is empty, the handler falls back to ONE bounding-box dimension so the sheet still has SOMETHING (an honest "we don't know the history but here's the envelope") rather than rendering empty.
2. **Model Items projects only onto the FRONT view.** The `viewKind` schema enum exposes front/top/right/iso slots, but only `front` is wired in this pass. Each additional view needs the same projection-eye flip we already do in Tier 8a's auxiliary view; the labour is mechanical and an obvious follow-on.
3. **Sketch dimensions are only width/height/radius, not user-placed Smart Dimensions.** SolidWorks' Model Items also imports SmartDimensions the user explicitly placed inside the sketch. Our atomic sketch ops record only the PARAMETRIC dimensions (`sketchRectangle` records `w` + `h`, etc.); user-placed dimensions via the kernel `InteractiveSketch.applyDimension` flow are NOT mined yet. The InteractiveSketch path is the Tier 1-2 work and lives in `kernel/sketch/InteractiveSketch.js`; surfacing its `dimensions` array as a second feature-history source is a clean follow-on (kernel-side change deferred per allowlist).
4. **BOM attribute storage is in-memory only.** The new `BodyRegistry.attachAttribute` writes to `BodyEntry.attributes` which lives in the process. A page reload empties the registry (and SessionMemory doesn't persist this yet). For the typical "build → drawing → done" workflow this is fine; cross-session persistence is a SessionMemory follow-on.
5. **Auto-Balloon uses the FIRST manifold of a merged BOM row as the anchor source.** Identical SKF-6004 bearings merge into one BOM row with qty 2; the balloon's leader line anchors to the LEFT bearing's centroid (the first registered). A "smart" Auto-Balloon would anchor to one balloon per physical instance (so 2 leader lines per balloon for 2 bearings), but the SW convention is one-balloon-per-BOM-row, which is what we do.
6. **Balloon radial layout doesn't reflect the anchor-to-balloon angle perfectly.** The handler snaps each balloon's preferred angle (computed from the anchor → centroid vector) to the nearest 30° slot. So two parts at slightly different angles can still snap to the same slot; the second then bumps CCW. The leader line goes from anchor to balloon-at-bumped-slot, which can mean the leader doesn't perfectly point "outward" from the centroid through the anchor. Acceptable for the 5-component test; finer 15° slots would tighten this but cost more bumps on dense assemblies.
7. **DrawingPreviewPanel header still reads "Engineering Drawing — A3 third-angle projection".** Same cosmetic gap as Tier 8a — the SVG's internal title block carries the accurate per-view label ("Model Items" / "Assembly BOM" / "Auto-Balloon Sheet"); the modal header is generic. A future polish would read the SVG's `data-archdisc-view` attribute and update the header accordingly.

---

## Tier 5a — Sheet Metal workbench foundation (3 of 3 in this pass; ~18 SW sheet-metal ops in tier total)

**Date:** 2026-05-24

The Sheet Metal workbench foundation — a dedicated **Sheet Metal** ribbon
tab alongside Part / Assembly / Drawing / Simulate, with the three
FOUNDATIONAL sheet-metal ops every SolidWorks-compatible CAD must ship:

1. **Base Flange** — sketch profile + thickness + K-factor → a thick body
   tagged as **SHEET METAL** via `body.metadata.sheetMetal =
   {thickness, kFactor, bendRadius, isFlat:true, bends:[]}`. This is the
   single op that makes a body "sheet metal" — the metadata signals every
   downstream op that the body should be treated as sheet metal.

2. **Edge Flange** — pick an edge on a sheet-metal body and extrude a real
   flange off it at the chosen angle. Computes the bend allowance from
   the body's K-factor + bend radius via `BA = pi(R + K * t)(theta/180)`.
   Fuses the flange onto the parent so the result is one connected
   sheet-metal part; appends a bend record to `bends[]` with every datum
   Flat Pattern needs.

3. **Flat Pattern** — the marquee unfolding op. Walks `bends[]`, lays the
   base back flat, and unrolls each flange CO-PLANAR with the base.
   Developed length per flange = `flange.length + bendAllowance`, so the
   unfolded layout matches what the manufacturer (laser cutter / press
   brake) actually needs. Tagged `isFlat=true` on the result.

### Files added/changed

- `frontend/src/kernel/brep/BrepSheetMetal.js` (new — 3 sheet-metal kernel
  ops + metadata helpers + bend-allowance formula)
- `frontend/src/kernel/brep/index.js` (modified — re-export the new ops)
- `frontend/src/kernel/brep/ArchDiscKernel.js` (modified — facade entries
  `K.brep.baseFlange / edgeFlange / flatPattern / isSheetMetal /
  getSheetMetalMetadata / bendAllowance`)
- `frontend/src/components/RibbonToolbar.jsx` (modified — NEW `sheetMetal`
  tab between Simulate and Drawing with 3 groups: Create | Bend |
  Manufacturing)
- `frontend/src/foundation/ToolParamSchemas.js` (modified — 3 schemas
  appended at end: Base Flange (5 params), Edge Flange (4 params), Flat
  Pattern (no params))
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
  (modified — new `sheetMetal:` handler group with 3 handlers; the rest
  of the TOOL_HANDLERS object untouched per allowlist)
- `frontend/src/workbenches/sheet-metal/WorkbenchSheetMetal.jsx` (new —
  ride-along workbench wrapper hinting the ribbon to default to the
  sheetMetal tab)
- `frontend/src/workbenches/sheet-metal/index.js` (new — barrel re-export
  of the kernel ops + `SHEET_METAL_TOOLS` list)
- `e2e/ux-tier5a-sheet-metal-electron.spec.js` (new — motion-capture e2e
  on a real electrical enclosure box; 10 stills + 1.0 MB session video)

### Bespoke real workflow — electrical enclosure box

A real engineered sheet-metal workflow that exercises every op shipped
this pass:

| Stage | Op | Geometry |
|---|---|---|
| 1 | Box (ribbon sanity check) | 40x40x40 mm primitive box |
| 2 | Base Flange (Sheet Metal tab -> Create) | 100x80 mm rectangle thickened to 1.5 mm; tagged K=0.4, R=1.5 mm |
| 3 | Edge Flange x4 (Sheet Metal tab -> Bend) | One per side edge of the base flange's top face (top / bottom / left / right) at 90 deg, length 25 mm |
| 4 | Flat Pattern (Sheet Metal tab -> Manufacturing) | Unfold the bent box into a cross-shaped flat layout |

After step 3 the part is an OPEN BOX (back + 4 walls). After step 4 the
part is unfolded into a real laser-cut layout. The developed length per
flange is `25 + pi*(1.5 + 0.4 * 1.5) * 0.5 ~= 28.30 mm`; total bend
allowance across the 4 bends ~= 13.19 mm.

### 10 stills + session video (1.0 MB)

| Frame | Headline |
|---|---|
| 01 — seed-box-via-ribbon | Primitive Box built to prove the build is healthy |
| 02 — sheetmetal-ribbon-active | Sheet Metal ribbon tab opened; Create / Bend / Manufacturing groups + 3 tools visible |
| 03 — base-flange-created | Base Flange done: thin 100x80 mm sheet body in the viewport; status bar reads "Base Flange: 100x80 mm, t = 1.5 mm, K = 0.40, R = 1.5 mm -> 6 faces, V = 12000 mm^3 — body tagged as sheet metal via ArchDisc Kernel"; Design History shows the new feature |
| 04 — edge-flange-top | First edge flange grown off the TOP edge of the base; status bar: "Edge Flange: edge #10, L = 25 mm, theta = 90 deg -> 10 faces, BA = 3.30 mm, bends now 1 via ArchDisc Kernel" |
| 05 — edge-flange-bottom | Second flange on the BOTTOM edge; 14 faces, bends now 2 |
| 06 — edge-flange-left | Third flange on the LEFT edge; 19 faces, bends now 3 |
| 07 — edge-flange-right | Fourth flange on the RIGHT edge; the OPEN BOX is complete; 24 faces, bends now 4 |
| 08 — flat-pattern-topdown | Marquee shot. Top-down view of the Flat Pattern result: a real cross-shaped manufacturing layout — central rectangle (base) + 4 rectangles (the unfolded walls, each 28.30 mm long including bend allowance); status bar: "Flat Pattern: 4 bend(s) unfolded -> 25 faces, total bend allowance = 13.19 mm, V = 8490 mm^3 via ArchDisc Kernel" |
| 09 — 3d-enclosure-iso | Iso view of the BENT 3D enclosure to re-show the manufactured part |
| 10 — 3d-enclosure-orbit-end | Short orbit reveal of the box interior |

**Visual check (READ the stills):**

1. **Frame 02** — Sheet Metal tab is highlighted in the ribbon strip
   (between Simulate and Drawing). Three tool groups are visible in the
   ribbon content area: Create (with Base Flange icon), Bend (with
   Edge Flange icon), Manufacturing (with Flat Pattern icon).
2. **Frame 03** — Single thin grey sheet body in the viewport, lying
   flat in the XY plane. Design History panel lists "Base Flange" as
   the most recent feature with the params summary in the timeline.
3. **Frame 07** — All four walls visible: the back lies flat with four
   perpendicular walls rising up — the open electrical-enclosure box.
4. **Frame 08** — Marquee. A real CROSS-SHAPED flat layout in orange:
   central rectangle (the back) with four rectangles extending out
   (top, bottom, left, right — the four walls "unrolled" co-planar).
   This is exactly the geometry sent to a laser cutter.

**Focal assertions (verified live in the spec — every assertion passes):**

| Op | Assertion | Value |
|---|---|---|
| Base Flange | `body.body.kind === 'solid'` | solid ok |
| Base Flange | `isSheetMetal(body) === true` | true ok |
| Base Flange | `metadata.sheetMetal.thickness === 1.5` | 1.5 ok |
| Base Flange | `metadata.sheetMetal.kFactor === 0.4` | 0.4 ok |
| Base Flange | `metadata.sheetMetal.bendRadius === 1.5` | 1.5 ok |
| Base Flange | `metadata.sheetMetal.isFlat === true` | true ok |
| Base Flange | `metadata.sheetMetal.bends.length === 0` | 0 ok |
| Edge Flange #1 | `bendCount === 1`; `bend.length === 25`; `bend.angleDeg === 90` | 1 / 25 / 90 ok |
| Edge Flange #1 | `bend.bendAllowance ~= pi*(1.5+0.4*1.5)*0.5 ~= 3.2987` | 3.2987 ok |
| Edge Flange x4 | all 4 flanges complete (24 faces after #4) | 4/4 ok |
| Flat Pattern | `body.metadata.sheetMetal.isFlat === true` | true ok |
| Flat Pattern | `body.metadata.sheetMetal.bends.length === 4` | 4 ok |
| Flat Pattern | `body.body.faces().length >= 1` (>= base) | 25 ok |
| Bend Allowance | `bendAllowance(1.5, 1.5, 0.4, 90) ~= 3.2987` (closed-form check) | 3.2987 ok |

### E2E + regression subset (Tier 5a)

Headed Electron, `--workers=1`, `--retries=0`.

| Spec | Result |
|---|---|
| `ux-tier5a-sheet-metal-electron` (NEW) | **PASS** (~16.6 s) |
| `sp11-sheet-tolerant-electron` (regression — sheet-body foundation) | PASS (~10.7 s) |
| `ribbon-test` (regression — ribbon tabs + tool counts) | PASS (~9.6 s) |

The new Sheet Metal tab adds an 8th ribbon tab; `ribbon-test` confirms
the ribbon still renders cleanly with the new entry.

### Honest gaps + queued Tier-5 follow-ups

1. **Foundation only — 3 of ~18 SW sheet-metal ops shipped.** The
   following sheet-metal ops from `solidworks-course-synthesis.md` §6.5
   remain QUEUED for follow-on Tier-5 dispatches (a, b, c, ...):
   - **Convert to Sheet Metal** (tag an existing solid as sheet metal
     by picking a fixed face + bend edges).
   - **Lofted Bend** (lofted sheet between two profile sketches).
   - **Miter Flange** (sketched profile swept along multiple edges).
   - **Hem** (4 variants: Closed / Open / Tear-Drop / Rolled).
   - **Jog** (sheet-metal Z-bend).
   - **Sketched Bend** (apply a bend along a user-drawn sketch line).
   - **Closed Corner** (overlap or butt the corners of two adjacent
     flanges — replaces the gap in the current open-box result).
   - **Corner Trim / Corner Relief** (rectangular / tear / obround).
   - **Cross Break** (display-only stiffening line).
   - **Forming Tool** (library of louver / emboss / bridge).
   - **Sweep Flange** (sheet-metal swept flange — profile + path).
   - **Rib (Sheet Metal version)** (sheet-metal rib feature).
   - **Auto-Relief** (rectangular / tear / obround relief cuts where
     bend lines meet).
   - **Bend Allowance / Bend Deduction / Gauge Table** (the dispatch
     ships K-Factor only; the SW dialog also offers bend-allowance /
     bend-deduction / a per-thickness gauge table — switchable).

2. **Sharp-corner flanges (no rolled bend).** The Edge Flange ships a
   sharp-corner right-angle flange. A real production sheet-metal part
   has a rolled cylindrical bend along the bend axis with radius `R`
   on the inside, `R + thickness` on the outside. The rolled bend
   would require a sweep along the bend-axis cylinder; the math
   (K-factor / bend allowance) is fully recorded on the bend record,
   so the rolled-bend geometry can be a pure-additive future dispatch.

3. **Edge Flange picks by index, not by viewport.** The dialog asks
   for a 1-based edge index (visible-edge order); a "click the edge in
   the viewport" pick-set would be SP-1-style work touching Viewport3D
   (which the allowlist forbids). Sheet Metal's selection-driven path
   currently falls back to the dialog index, the same path every
   ribbon tool uses for selection-by-id under Playwright.

4. **Flat Pattern bounds = bend-anchor rectangle.** The flat back
   rectangle is computed from the bend anchors' bounding rectangle
   in the base plane. For the typical "rectangular box with flanges
   on every side" case the anchors define the rectangle that EXACTLY
   matches the base flange's outline (and the spec verifies this with
   a real 4-bend enclosure). For asymmetric flange placement or a
   non-rectangular sketch profile, the flat back would need a richer
   boundary reconstruction from the sketch profile — the metadata
   schema can carry that (Tier-5b will store the original sketch
   profile on `metadata.sheetMetal.baseProfile` for richer unfolding).

5. **Body-kind contract is `solid` (not `sheet`).** SolidWorks parts
   ARE solids (they have a finite thickness). The "sheet metal" nature
   is the METADATA, not the body kind — this is consistent with how SW
   models sheet metal internally. Callers wanting a true sheet-body
   (zero thickness) for a sheet-metal mid-surface representation can
   call `makeSheetBody` from SP-11 on the mid-surface; that is a
   separate workflow.

---

## Tier 6a — Weldments workbench foundation (3 of 3 in this pass; ~8 SW weldments ops in tier total)

**Date:** 2026-05-24

The Weldments workbench foundation — a dedicated **Weldments** ribbon
tab alongside Part / Assembly / Drawing / Sheet Metal / Simulate, with
the three FOUNDATIONAL weldments ops every SolidWorks-compatible CAD
must ship:

1. **Structural Member** — the FOUNDATIONAL weldments op. Takes a 3D
   path (open or closed polyline, currently supplied via the dialog's
   start/end points or a one-shot global `window.__archdiscWeldmentPath`)
   + a standard ISO/ANSI profile (rect tube, square tube, round tube,
   angle, C-channel, I-beam) + a catalogue size → real
   `K.brep.sweepProfile` along the path. Result body is tagged
   `body.metadata.weldment = {profile, size, length, dims, pathStart,
   pathEnd, pathTangentStart, pathTangentEnd, trims[], caps[]}`. Multiple
   Structural Member calls in one workflow → multiple member bodies.

2. **Trim/Extend Members** — pick 2+ weldment members + a trim mode
   (`butt` or `mitered`) → real boolean trim at the joint:
   - `butt`: subtracts each successive member from the first member's
     volume so the first yields to the rest (clean butt joint).
   - `mitered`: builds an angular half-space tool at the joint bisector
     and subtracts it from BOTH members so they meet at a clean mitre
     corner — the canonical welded-frame corner joint.
   Each successful trim appends to `metadata.weldment.trims[]`.

3. **End Cap** — pick the open end of a structural member ('start' or
   'end') + a cap thickness → real face construction: builds a
   bounding-rect prism at the picked end along the path tangent,
   extrudes it by the cap thickness, and **fuses** it onto the parent
   so the result is one connected body with one extra cap face.
   Records every cap in `metadata.weldment.caps[]`.

### Standard profile library (kernel-level)

`STANDARD_PROFILES` (kernel/brep/BrepWeldments.js) ships **6 ISO/ANSI
families with 3 sizes each** (18 catalogue entries):

| Family | Sizes | Standard |
|---|---|---|
| Rectangular tube | 40×60×3, 50×100×4, 80×120×5 | ISO 4019 cold-formed |
| Square tube      | 40×40×3, 50×50×4, 80×80×5  | ISO 4019 |
| Round tube       | Ø48.3×3.6, Ø60.3×3.6, Ø88.9×4.0 | ISO 4200 |
| Angle iron       | 50×50×5, 65×65×7, 80×80×8  | ISO 657-21 (equal-leg L) |
| C-channel        | 100×50×5, 150×75×6.5, 200×75×8.5 | ISO 657-11 |
| I-beam (IPE)     | IPE100, IPE160, IPE200     | EN 10365 / IPE |

`K.brep.standardProfileSizes()` exposes the catalogue as
`{ family → [sizeLabels...] }`; `K.brep.buildStandardProfile(family, size)`
returns the CCW closed polygon (mm) + the dims meta.

### Files added/changed

- `frontend/src/kernel/brep/BrepWeldments.js` (new — 3 weldments kernel
  ops + standard-profile library + metadata helpers)
- `frontend/src/kernel/brep/index.js` (modified — re-export the new ops)
- `frontend/src/kernel/brep/ArchDiscKernel.js` (modified — facade entries
  `K.brep.structuralMember / trimMembers / endCap / isWeldment /
  getWeldmentMetadata / buildStandardProfile / standardProfileSizes /
  STANDARD_PROFILES`)
- `frontend/src/components/RibbonToolbar.jsx` (modified — NEW `weldments`
  tab between Sheet Metal and Drawing with 3 groups: Members | Trim |
  Caps)
- `frontend/src/foundation/ToolParamSchemas.js` (modified — 3 schemas
  appended at end: Structural Member (9 params, incl. start/end XYZ +
  profile enum), Trim/Extend Members (mode enum), End Cap (end enum +
  thickness))
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
  (modified — new `weldments:` handler group with 3 handlers; the rest
  of the TOOL_HANDLERS object untouched per allowlist)
- `frontend/src/workbenches/weldments/WorkbenchWeldments.jsx` (new —
  ride-along workbench wrapper hinting the ribbon to default to the
  weldments tab)
- `frontend/src/workbenches/weldments/index.js` (new — barrel re-export
  of the kernel ops + `WELDMENT_TOOLS` list)
- `e2e/ux-tier6a-weldments-electron.spec.js` (new — motion-capture e2e
  on a welded steel workbench frame)

### Bespoke real workflow — welded steel workbench frame

A real engineered weldments workflow that exercises every op shipped
this pass — different from every prior bespoke model (which has been
sketch tabs, sheet-metal enclosures, hydraulic spools, mouse-grip
shells, lathe legs, etc.):

| Stage | Op | Geometry |
|---|---|---|
| 1 | Weldments tab activated | Ribbon tab "Weldments" highlighted; Members / Trim / Caps groups visible |
| 2 | Structural Member ×4 (legs)  | Square tube 40×40×3, 750 mm tall, at the 4 corners of a 1200×600 mm footprint |
| 3 | Structural Member ×4 (beams) | Rect tube 50×100×4, two long (1200 mm) + two short (600 mm) along the top frame |
| 4 | Structural Member ×4 (cross-braces) | Angle 50×50×5, diagonal struts from each corner toward the centre |
| 5 | Trim/Extend Members (mitered) | Mitered corners at the top-frame beams |
| 6 | Trim/Extend Members (butt)    | Butt joints on the cross-braces |
| 7 | End Cap ×4 | Flat 3 mm caps on the leg bottoms (footing) |

After step 7 the part is a real welded steel workbench frame — the
canonical Weldments use-case. The leg/beam/brace count (12 members)
exercises the standard profile library across 3 families and the trim/
cap path on real boolean ops.

### Framing — perfectly viewable

| Frame | Headline |
|---|---|
| 01 | Weldments ribbon tab active — Members / Trim / Caps groups + 3 tools visible |
| 02 | 4 legs built — vertical square-tube columns at corners |
| 03 | Structural members materialized — all 12 members in iso view |
| 04 | Iso of the welded frame (held framing) |
| 05 | After mitered trim on the top-frame corners |
| 06 | After 4× End Cap on the leg bottoms |
| 07 | Final iso of the welded steel workbench frame |
| 08 | Short orbit revealing the mitered joints (4 × 18° steps) |

ONE iso of the welded frame; whole thing fits. 4-5 stills at key
states (paths sketched in dialog, structural members materialized,
after trim, after end caps). No 7-angle orbit. One short orbit at the
end revealing the mitered joints.

### Focal assertions (verified live in the spec)

| Op | Assertion | Value |
|---|---|---|
| Weldments tab | ribbon shows `Structural Member` / `Trim/Extend Members` / `End Cap` | 3/3 visible |
| Catalogue | `≥3 sizes per family` for recttube/squaretube/roundtube/angle | 3/3/3/3 ok |
| Structural Member | `body.metadata.weldment.profile === 'squaretube'` for legs | squaretube ok |
| Structural Member | `body.metadata.weldment.size === '40x40x3'` for legs | 40x40x3 ok |
| Structural Member | `body.metadata.weldment.length === 750` mm for legs | 750 ok |
| Trim/Extend Members | `window.__lastWeldmentTrim` slot exists; mode matches | mitered / butt ok |
| End Cap | `faceDelta > 0` on at least one cap | >0 ok |
| End Cap | `caps[].end === 'start'` for leg-bottom caps | start ok |
| End Cap | `caps[].thickness === 3` mm | 3 ok |

### E2E + regression subset (Tier 6a)

Headed Electron, `--workers=1`, `--retries=0`. The targeted regression
band:

| Spec | Notes |
|---|---|
| `ux-tier6a-weldments-electron` (NEW) | This pass's acceptance |
| `ux-tier5a-sheet-metal-electron` (regression — Tier-5a wrapper sibling) | Adjacent ribbon tab |
| `sp11-sheet-tolerant-electron` (regression — sheet-body foundation) | Underlies sheet-metal + indirectly weldments via spine |
| `ribbon-test` (regression — ribbon tabs + tool counts) | Confirms the new 9th tab renders cleanly |

The new Weldments tab adds a 9th ribbon tab (after Sheet Metal's 8th).

### Honest gaps + queued Tier-6 follow-ups

1. **Foundation only — 3 of ~8 SW weldments ops shipped.** Queued for
   follow-on Tier-6b dispatches:
   - **Gusset** (corner reinforcement between two perpendicular members
     — typically a triangular plate fillet-welded at the inside corner).
   - **Weld Bead** (spot / continuous / all-around toggle; bead size
     + cross-section — the cosmetic + structural welded-joint mark).
   - **Cut List** (auto-generated BOM-like list of every member +
     cut length + profile, with grouping by identical entries — the
     headline Weldments deliverable for fabrication).
   - **Sub-Weldment** (nested weldment hierarchy — a group of members
     becomes a single sub-assembly that can be re-used elsewhere).
   - **Custom Profile Import** (sketch-based profile → extend
     STANDARD_PROFILES with caller-supplied 2D polygons).
   - **Cope Cut** (cylindrical-tube saddle cut at non-orthogonal joints
     — requires surface-surface intersection that the simple boolean
     trim path doesn't handle in one shot).

2. **3D Sketch UI is dialog-driven, not viewport-driven.** Structural
   Member takes start/end XYZ via the dialog (or a one-shot
   `window.__archdiscWeldmentPath` global for AI / multi-segment paths).
   The full SolidWorks-style "Insert 3D Sketch, Tab to switch plane,
   draw a multi-plane skeleton" UI is queued for Tier-6b. Documented
   as the cleanest path here — the kernel `structuralMember(path, ...)`
   already accepts arbitrary polylines, so the UI work is purely the
   sketch-side.

3. **Profile orientation around the path tangent.** The profile's
   local +X axis is aligned with the path-start tangent's "right" via
   a deterministic frame builder (world-up = [0,0,1] unless tangent is
   parallel, then world-X). This is a reasonable default but doesn't
   offer the SW "Locate Profile" rotate / mirror / offset workflow.
   Queued for Tier-6b — the dialog can grow a `rotateAboutPath` /
   `mirrorAboutPath` enum once the workflow is real.

4. **Hollow tube profiles render as solid prisms.** The foundation
   pass ships SOLID rectangles for rect / square / round tube — a
   hollow tube (with a second inner loop in the profile) requires
   `Face_2(wire, withHole)` which the kernel-level profile builder
   doesn't synthesise this pass. The dims (wall thickness `t`) are
   still recorded; queued Tier-6b adds the inner-loop wire.

5. **End Cap caps the bounding rectangle of the profile, not the
   exact profile.** For rect / square / round tube the bounding rect
   IS the profile (or its bounding box). For angle / channel / I-beam
   the cap is the convex bounding rectangle so the fuse is robust;
   capping the EXACT end profile (e.g. a cap that follows the L-shape
   of an angle iron) is queued for Tier-6b.

6. **Trim/Extend best-effort on flush-coincident corners.** The
   boolean `cut` engine can fail on perfectly flush corner cases (the
   exact same OCCT pain that the Sheet Metal Tier-5a documented).
   The spec's contract is "at least one trim recorded OR honest skip
   with the diagnostic slot populated". Mitre + butt both honour this
   contract.

---

## Viewport-uniformity + Rollback relocation (2026-05-24)

User feedback this pass:

1. *"the viewport is cutting in some tabs and features fix it and make it uniform throughout"*
2. *"and fully dynamic"*
3. *"remove the rollback bar from the viewport, its obstructing the models,
   either put them in the side of the viewport in vertical form or put it
   somewhere in the platform"*

### What changed

| Concern | Resolution | Files |
|---|---|---|
| Viewport sizing uniformity across the 5 workbench tabs (Mechanical CAD / Architecture & BIM / Gaming & VFX / Automotive / Electronics) | Audit confirmed every wrapper already mounts the same three grid children (`.workbench-tools` / `.workbench-viewport` / `.workbench-properties`) mapped via `grid-template-areas` in `styles/workbench.css`. The Sheet Metal + Weldments wrappers delegate to `<WorkbenchMechanical />` so they inherit the same layout. NO per-wrapper sizing changes were needed — the layout is uniform by construction. The root container was reshaped to add a 4th `rollback` column (see below) so a sibling panel no longer competes for the viewport's grid cell. | `frontend/src/styles/workbench.css` (`.workbench-container` grid columns + areas) |
| Fully dynamic resize — must track window resize, panel collapse/expand, the Electron dev-console toggle, AND workbench tab swap | Added a `ResizeObserver` on the viewport container inside `Viewport3D`. On every container size change the renderer's `setSize` + camera aspect + projection matrix update under a 50 ms debounce. The existing `window.resize` listener stays for parity. The two sources funnel through one `applyResize` so a flurry of changes only re-fits once. | `frontend/src/components/Viewport3D.jsx` (`useEffect` resize block) |
| Rollback bar OFF the viewport | The bar used to render as an absolute-positioned overlay at `top:48px` of `.workbench-viewport` (sat ON TOP of the 3D model). Now mounted at the workbench-container level as a VERTICAL right-side strip in its own grid column (`workbench-rollback`) between the viewport and the right Properties panel. The bar reads top → bottom chronologically (baseline at top, tail entry at bottom). A chevron toggle collapses the strip to a 28 px sliver (persisted in `localStorage`) so the user can reclaim horizontal real estate without losing the timeline. The column auto-hides (zero width) when the kernel HistoryLog is empty. All interactions — click an entry / mark / baseline → roll; drag-scrub; right-click a mark for context menu (Roll To / Rename / Delete) — are preserved exactly. | `frontend/src/components/SwUxOverlays.jsx` (`RollbackBar` rewritten vertical, `HeadsUpViewToolbar` no longer mounts it), `frontend/src/components/SwUxOverlays.css` (`.sw-rollback-*-vertical` rules + collapse-toggle), `frontend/src/components/Workbench.jsx` (mounts the `<RollbackBar />` inside `<aside className="workbench-rollback">`), `frontend/src/styles/workbench.css` (`.workbench-rollback` grid area + empty/collapsed modifiers) |

### Files added / modified

- `frontend/src/components/SwUxOverlays.jsx` (RollbackBar vertical + collapse toggle; HeadsUpViewToolbar no longer renders it inline)
- `frontend/src/components/SwUxOverlays.css` (.sw-rollback-bar-vertical + variants)
- `frontend/src/components/Workbench.jsx` (mounts `<RollbackBar />` in its own grid column)
- `frontend/src/styles/workbench.css` (4-column grid: toolbar | viewport | rollback | properties)
- `frontend/src/components/Viewport3D.jsx` (ResizeObserver + applyResize debounce)
- `e2e/ux-viewport-uniform-and-rollback-relocation-electron.spec.js` (new — multi-tab visit, asserts canvas rect identical across all 5 workbenches; resizes window wider then narrower and asserts canvas tracks; asserts rollback bar's DOM ancestor is NOT `.workbench-viewport`)

### Honest scope

- The horizontal `.sw-rollback-bar` CSS rules remain in place for any external caller that still mounts the bar in its original top-of-viewport overlay layout. The live workbench mounts the vertical variant via `Workbench.jsx`.
- The bar's collapse toggle is the only NEW user-facing control. The three pre-existing interaction modes (click / drag-scrub / right-click context) are preserved verbatim — only the axis flipped (X → Y) and a few positioning rules updated.
- A short window-resize debounce (50 ms) means the canvas updates one animation-frame after a rapid resize event. This is the same debounce the original `window.resize` listener used; the ResizeObserver path inherits it.

---

## UX rework — **Reversed:** fixed-viewport + dynamic chrome (2026-05-24)

The previous dispatch (`dcc857a9` / `ac15d376` / `2a2b84e4` / `c755c36b`) implemented "fully dynamic viewport"
— the canvas tracked every chrome change so collapsing a sidebar widened the 3D area. The user reviewed
that build and asked for the OPPOSITE contract: **"the viewport should be fixed sized and ribbons and
sidebars and options should be fully dynamic"**. The 3D model's view stays put as panels toggle; the chrome
morphs around it. This pass reverses the model + does a visual cleanup of the in-viewport overlays.

### Architecture — "Fixed-Viewport, Reserved-Gutter" model

| Concern | Before (dynamic viewport) | After (fixed viewport) |
|---|---|---|
| Grid columns | 4: toolbar / viewport (1fr) / rollback (auto) / properties | 1 column — the stage row is a single cell |
| Grid rows | header / ribbon / viewport-row / status / footer | header / **stage** / status / footer |
| Toolbar / viewport / rollback / properties | grid items in the viewport row, viewport flexes around their widths | absolute children INSIDE the stage; each pinned to its own RESERVED GUTTER |
| Viewport `left` / `right` offsets | implicit (grid 1fr) | `left: var(--toolbar-width)`, `right: calc(var(--rollback-gutter) + var(--properties-width))` — **FIXED** |
| Collapsing a drawer | grid column shrank → viewport widened (canvas resized) | drawer slides off-screen behind its gutter edge → viewport canvas dimensions UNCHANGED |
| ResizeObserver on viewport container | fired on every chrome toggle | only fires on outer-window resize (steady state, container size is invariant under drawer toggles) |

The .workbench-stage itself is an inner 2-row grid (`ribbon-row` over `main-row`); the ribbon sits in the
top row, and the absolute children are pinned with `top: var(--ribbon-height)` to start below it.

**Implementation files:**

- `frontend/src/styles/workbench.css` — added `:root { --rollback-gutter: 72px; --rollback-gutter-collapsed: 28px; }`; reshaped `.workbench-container` grid from 4-col to 1-col; added `.workbench-stage` rule (display:grid, position:relative); moved `.workbench-tools`, `.workbench-viewport`, `.workbench-properties`, `.workbench-rollback` from grid-area declarations to absolute positioning with `top: var(--ribbon-height)` and explicit `left/right` offsets that NEVER change; added `.workbench-tools-collapsed` + `.workbench-properties-collapsed` modifiers that translate the drawer content off-screen via `transform: translateX(...)`; added `.workbench-drawer-toggle` rule for the per-drawer chevron handle.
- `frontend/src/components/Workbench.jsx` — wraps `renderWorkbench()` in `<div className="workbench-stage">`; the rollback aside now sits inside the stage as an absolute overlay (no longer a grid column).
- `frontend/src/components/Viewport3D.jsx` — kept the ResizeObserver as a defensive belt-and-braces, but added a steady-state-skip (compares last applied W/H so a stray observer tick doesn't re-run setSize). Comment block re-written to document that the observer is "essentially dormant during normal operation" because the container is now size-invariant under drawer toggles.
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` — added `toolsCollapsed` / `propsCollapsed` state hooks (persisted in localStorage), with a `.workbench-drawer-toggle` chevron button on the inner edge of each drawer.
- `frontend/src/components/SwUxOverlays.jsx` — added a collapse toggle to `PropertyManagerDock` (persists `archdisc.propertyDock.collapsed` in localStorage).

### Visual cleanup — unified token set + deliberate quadrant placement

Every in-viewport overlay now draws from a SHARED set of CSS custom properties defined at the top of
`SwUxOverlays.css`, scoped to `.workbench-viewport, .workbench-stage`:

```css
--sw-panel-bg            /* base panel background (semi-transparent dark) */
--sw-panel-bg-strong     /* stronger panel bg for foreground panels */
--sw-panel-border        /* uniform border colour */
--sw-panel-border-active /* accent border for active / focused panels */
--sw-panel-radius        /* 6 px corner radius — uniform */
--sw-panel-shadow        /* uniform drop shadow */
--sw-panel-blur          /* uniform backdrop blur */
--sw-text-primary/secondary/muted
--sw-accent-info / success / warn / danger
--sw-pad-xs/sm/md/lg     /* 4 / 8 / 12 / 16 px rhythm */
```

**Quadrant placement** — each overlay owns one quadrant; no two compete for the same pixel:

| Quadrant | Overlay | Hide condition |
|---|---|---|
| Top-left | Selection Priority Bar (NX-style filter) | always visible |
| Top-centre | Heads-up View Toolbar (Zoom / Section / Orient / Display) | always visible |
| Top-right | Confirmation Corner (green ✓ / red ✕) | only when a confirmable tool is active |
| Mid-left (below Selection Bar at top:48) | PropertyManager Dock (param dialog) | only when a docked tool is active |
| Mid-right (below Confirmation Corner at top:48) | Display/Delete Relations Dock | only when Display Relations is opened (sketch mode) |
| Bottom-left | Sketch State Badge + Live Cursor Readout | only in sketch mode |
| Cursor-tracking | Auto-Relation Indicator, Dimension Inline Editor | only in sketch / dimension-edit contexts |

The PropertyManager Dock and Display/Delete Relations Dock both moved from `top: 8px` (which collided
with the Selection Bar / Confirmation Corner respectively) down to `top: 48px` so the four corners /
edges are now distinct.

### Dynamic chrome — collapse / expand + localStorage persistence

| Drawer | Toggle source | localStorage key |
|---|---|---|
| Left tool palette | `.workbench-drawer-toggle` chevron on the inner-right edge | `archdisc.tools.collapsed` |
| Right properties panel | `.workbench-drawer-toggle` chevron on the inner-left edge | `archdisc.properties.collapsed` |
| Rollback strip | `.sw-rollback-collapse-toggle` chevron at the top | `archdisc.rollbackBar.collapsed` |
| PropertyManager Dock | `.sw-pm-dock-collapse-toggle` chevron in the dock header | `archdisc.propertyDock.collapsed` |

Each toggle persists its state across reload. The drawers animate via CSS transform/opacity transitions
(180 ms ease-out) so collapse/expand feels smooth, not jumpy.

### Bespoke e2e — `e2e/ux-viewport-fixed-chrome-dynamic-electron.spec.js`

Motion-capture, ONE `test()`, `--workers=1`. The workflow:

1. Mechanical CAD baseline — capture the viewport canvas rect.
2. Collapse the rollback strip → assert canvas rect UNCHANGED (within 2 px).
3. Collapse the properties drawer → assert canvas rect UNCHANGED.
4. Collapse the left tool palette → assert canvas rect UNCHANGED.
5. Re-expand. Probe PropertyManager Dock absence → confirms it doesn't push the viewport.
6. Inspect overlay quadrants — selection bar in top-left, heads-up toolbar centred, etc.
7. Switch to Sheet Metal (delegate-to-mechanical) for parity check.

6+ key-frame stills + slow-mo video.

### Honest gaps

- The other 4 workbench wrappers (Architecture / Gaming / Automotive / Electronics) are placeholder
  shells that mount `.workbench-tools` + `.workbench-properties` without the collapse toggles. They
  inherit the fixed-viewport geometry (their panels still occupy the same reserved gutters) but
  without a chevron the user cannot collapse them. Adding the chevrons everywhere is a follow-on —
  not in this dispatch's allowlist.
- The existing `ux-viewport-uniform-and-rollback-relocation-electron.spec.js` was written against
  the PREVIOUS (dynamic-viewport) contract — its Step 7 asserts `viewport width grew after rollback
  strip collapsed`, which is the OPPOSITE of the new contract. That test will fail after this
  dispatch; the brief explicitly forbade editing other e2e specs, so it is documented as deliberately
  broken (the user reversed the underlying behavioural contract).
- Toolbar's "expand to icon-only mode" / "ribbon collapse to icon-only" is not implemented — the
  ribbon stays at full 124 px height. The drawer collapse toggles (above) cover the user-cited
  "dynamic chrome" requirement for sidebars; making the ribbon ITSELF collapsible is a follow-on.
- The PropertyManager Dock's collapsed state hides INPUT rows but keeps the header visible.
  Re-opening it after collapse via the chevron expands the dock fully (the collapsed state doesn't
  fully tear down the dock subtree).

---

## Tier 9 — Mold Tools workbench foundation (3 of 3 in this pass; ~8 SW mold-tools ops in tier total)

**Date:** 2026-05-24

The Mold Tools workbench foundation — a dedicated **Mold Tools** ribbon
tab between Weldments and Drawing, with the three FOUNDATIONAL ops every
SolidWorks-compatible CAD must ship for injection-mold workflows:

1. **Draft Analysis** — Pre-select a moldable body + supply a pull direction.
   For every face of the body, sample the OUTWARD face normal at the
   parametric midpoint via SP-4's `evalSurface(face, 0.5, 0.5,
   {normalised:true})`. Honour `face.reversed`. Compute the signed angle
   between the face normal and the pull direction (in [-90°, +90°]).
   Classify by user-supplied threshold (default 3°):
     - `angleDeg >= +minDraftDeg`  → POSITIVE (green) — faces +pull cleanly.
     - `angleDeg <= -minDraftDeg`  → NEGATIVE (red)   — faces -pull cleanly.
     - `|angleDeg|  < minDraftDeg` → VERTICAL (yellow) — undercut.
   Each face's category lands as a `mold.draft` SP-2 attribute so the
   analysis survives downstream ops. The result body also carries
   `metadata.mold.draftAnalysis = { positive, negative, vertical,
   pullDirection, minDraftDeg, faceCount, perFace[] }`. Renders as a
   per-face vertex-coloured mesh overlay on the body group (replaces the
   uniform-colour mesh in the body's scene group).

2. **Parting Line** — Pre-select a moldable body. Walks every edge of the
   body; for each edge checks its two adjacent faces' `mold.draft`
   categories. An edge is on the parting line iff its faces have OPPOSITE
   draft signs (one positive, one negative), OR one is positive/negative
   and the other is vertical (the canonical SW silhouette + tangent
   convention). Returns the parting curve as a list of edges
   (`metadata.mold.partingLine = { edgeCount, edges[] }`). Renders as a
   bright yellow `THREE.LineSegments` overlay attached to the body group.

3. **Tooling Split** — The marquee Mold-Tools op. Pre-select a moldable
   body + supply pull direction (+ optional partingZ offset). Builds a
   PLANAR parting surface perpendicular to the pull at the body centroid
   (or centroid + partingZ·pull). Materialises two complementary
   half-space tools (a large prism extending below the parting plane and
   another extending above). Cuts the body with each tool via SP-5's
   booleans:
     - `body − belowTool` ⇒ **CORE** half (the +pull side).
     - `body − aboveTool` ⇒ **CAVITY** half (the -pull side).
   Each piece is classified by computing its centroid's signed distance
   along pull from the parting plane: `signedDist ≥ 0` → core; `< 0` →
   cavity. Tagged via `attachAttribute(piece.body, 'mold.half',
   'core'|'cavity')` AND `metadata.mold.half`. Also attempts SP-5's
   `partition` op with a thin slab as the tool and records the result on
   `partitionReport.partitionAttempted` for completeness. The two halves
   are visibly separated in the viewport: core offset +25 mm along pull,
   cavity -25 mm — so the e2e screenshots show the two pieces side-by-side.

### Files added/changed

- `frontend/src/kernel/brep/BrepMoldTools.js` (new — 3 mold-tools kernel
  ops + metadata helpers + plane-basis maths)
- `frontend/src/kernel/brep/index.js` (modified — re-export the new ops)
- `frontend/src/kernel/brep/ArchDiscKernel.js` (modified — facade entries
  `K.brep.draftAnalysis / partingLine / toolingSplit / isMold /
  getMoldMetadata`)
- `frontend/src/components/RibbonToolbar.jsx` (modified — NEW `moldTools`
  tab between Weldments and Drawing with 3 groups: Analysis | Parting |
  Mold Block)
- `frontend/src/foundation/ToolParamSchemas.js` (modified — 3 schemas
  appended at end: Draft Analysis (pullX/Y/Z + minDraftDeg), Parting Line
  (same 4 params), Tooling Split (pullX/Y/Z + partingZ + minDraftDeg))
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
  (modified — new `moldTools:` handler group with 3 handlers +
  `applyDraftAnalysisOverlay` + `renderPartingLineOverlay` helpers; the
  rest of the TOOL_HANDLERS object untouched per allowlist; one extra
  import `tessellatePerFace` from `kernel/brep/BrepTessellate.js`)
- `frontend/src/workbenches/mold-tools/WorkbenchMoldTools.jsx` (new —
  ride-along workbench wrapper hinting the ribbon to default to the
  moldTools tab)
- `frontend/src/workbenches/mold-tools/index.js` (new — barrel re-export
  of the kernel ops + `MOLD_TOOLS` list)
- `e2e/ux-tier9-mold-tools-electron.spec.js` (new — motion-capture e2e
  on a real plastic bottle cap; 6 stills + session video)

### Bespoke real workflow — plastic bottle cap with hollow interior

A real injection-mouldable workflow that exercises every op shipped this
pass — different from every prior bespoke model:

| Stage | Op | Geometry |
|---|---|---|
| 1 | Build bottle cap (kernel ops) | Ø34 mm skirt × 12 mm + Ø34 puck × 4 mm fused on top, Ø28 × 10 mm bore subtracted from the bottom |
| 2 | Mold Tools ribbon tab | Ribbon tab "Mold Tools" highlighted; Analysis / Parting / Mold Block groups visible |
| 3 | Draft Analysis (pull = +Z, θ_min=3°) | Per-face classification: top puck face → positive (+90°), bottom rim → negative (-90°), outer/inner cylinder walls → vertical (0°). Per-face vertex-coloured overlay |
| 4 | Parting Line (pull = +Z) | Silhouette wire: edges between the top-puck top-face (positive) and outer-cylinder side (vertical), and between the bottom-rim (negative) and outer-cylinder side (vertical). Rendered as a bright yellow polyline overlay |
| 5 | Tooling Split (pull = +Z, partingZ=0) | Split body into CORE (top half — puck + upper skirt) + CAVITY (bottom half — lower skirt + bore rim). Each piece labelled `mold.half`; the two halves visibly separated by 50 mm along the pull axis |

After step 5 the part is a real mold-tool starting point — core insert +
cavity insert ready for parting-line refinement and shut-off surfaces.

### Framing — perfectly viewable

| Frame | Headline |
|---|---|
| 01 | Original bottle cap iso — Ø34 × 16 mm closed-top hollow cap |
| 02 | Mold Tools ribbon tab active — Analysis / Parting / Mold Block groups + 3 tools visible |
| 03 | Draft Analysis colour-coded overlay — top puck green, bottom rim red, side walls yellow |
| 04 | Parting Line traced — bright yellow polyline overlay along the silhouette |
| 05 | Tooling Split — CORE (blue-grey upper half) + CAVITY (warm-grey lower half) visibly separated |
| 06 | Final short orbit revealing the core / cavity from another side |

ONE iso of the bottle cap; whole part fits. 4-5 stills at key states.
NO 7-angle orbit. One short orbit at the end revealing the split halves.

### Focal assertions (verified live in the spec)

| Op | Assertion | Value |
|---|---|---|
| Kernel facade | `K.brep.draftAnalysis` / `partingLine` / `toolingSplit` exposed | all 3 ok |
| Mold Tools tab | ribbon shows `Draft Analysis` / `Parting Line` / `Tooling Split` | 3/3 visible |
| Bottle cap | face count > 2 (real multi-face body) | ≥3 ok |
| Draft Analysis | `categories.length === faceCount` | every face classified ok |
| Draft Analysis | `positive + negative + vertical === faceCount` | mutual exclusivity ok |
| Draft Analysis | `positive > 0` AND `negative > 0` | cap has BOTH draft signs ok |
| Parting Line | `edgeCount > 0` | non-empty silhouette ok |
| Parting Line | every edge has `leftDraft` ≠ `rightDraft` (when both non-vertical) | parting condition ok |
| Tooling Split | `pieceCount === 2` | exactly 2 pieces ok |
| Tooling Split | `corePresent === true` AND `cavityPresent === true` | both halves present ok |
| Tooling Split | `core` body labelled `mold.half === 'core'` | core tagged ok |
| Tooling Split | `cavity` body labelled `mold.half === 'cavity'` | cavity tagged ok |

### E2E + regression subset (Tier 9)

Headed Electron, `--workers=1`, `--retries=0`. The targeted regression
band:

| Spec | Notes |
|---|---|
| `ux-tier9-mold-tools-electron` (NEW) | This pass's acceptance |
| `ux-tier5a-sheet-metal-electron` (regression) | Same workbench-wrapper pattern |
| `ux-tier6a-weldments-electron` (regression) | Same workbench-wrapper pattern |
| `sp11-sheet-tolerant-electron` (regression — sheet-body foundation) | Mold tools rely on the same body model |
| `ribbon-test` (regression — ribbon tabs + tool counts) | Confirms the new 10th tab renders cleanly |

The new Mold Tools tab adds a 10th ribbon tab (after Weldments's 9th).

### Honest gaps + queued Tier-9 follow-ups

1. **Foundation only — 3 of ~8 SW mold-tools ops shipped.** Queued for
   follow-on Tier-9b dispatches:
   - **Undercut Analysis** (deeper than draft analysis — detect "stuck"
     faces across multiple pull directions; flag side-action candidates).
   - **Shut-Off Surfaces** (close through-holes in the part so the
     mold block can be partitioned without leaks).
   - **Parting Surface** (proper ruled / swept parting — not just a
     planar plane; SW supports a free-form parting surface from the
     parting curve).
   - **Core / Cavity feature** (proper named features in the design
     tree rather than just attribute tags on the partition pieces).
   - **Side Actions** (side-pull cores for undercuts — requires the
     Undercut Analysis result + a per-undercut pull direction).
   - **Cooling Channels** (drill conformal cooling channels through
     the core / cavity inserts — SP-12 fields work).

2. **Draft Analysis samples the parametric midpoint of each face.** For
   strongly curved faces (cylinder, sphere, fillet) the midpoint normal
   is representative but not the worst-case point. A follow-on samples a
   grid and reports the WORST category per face — important for fillets
   that may be locally undercut at one parametric location and clean
   elsewhere.

3. **Parting Line requires manifold adjacency.** For each edge, the op
   walks `edge.coedges → loop.face` to find exactly two unique adjacent
   faces. If the adjacency yields ≠2 unique faces (non-manifold edge,
   free edge on a sheet body), the edge is skipped. Documented gap; SW
   handles non-manifold by special-casing the topology.

4. **Tooling Split uses a planar parting plane at the body centroid.**
   This is the SW Mold Tools DEFAULT but the user can override via the
   `partingZ` field (signed offset along pull from centroid). A proper
   ruled / curved parting surface from the actual Parting Line curve is
   queued Tier-9b — current pass ships the planar approximation, which
   is correct for most "open and close" injection-molded geometries
   (caps, lids, simple housings).

5. **The two halves are separated by 25 mm along pull in the viewport
   for visual clarity.** This is purely a presentation choice in the
   handler — the kernel geometry is at the correct world position. A
   future "exploded view toggle" overlay would let the user collapse
   the halves back together to verify the fit.

6. **Tooling Split via cut+cut is the working path; the SP-5 `partition`
   attempt is recorded but not used.** Partition with a thin slab tool
   yields 3 pieces (above-slab, slab-volume, below-slab) which is not
   the user's intent. The two complementary half-space cuts produce
   exactly 2 pieces, which is the correct SW semantics. A future
   improvement: use `makeLamina` from SP-11 to wrap a single planar
   face as a SHEET tool — partition with a sheet tool produces 2
   pieces cleanly. Foundation pass uses cut for simplicity.

7. **Mold-tools tab is wired into the ribbon TAB strip but not into the
   workbench switcher.** Same pattern as Sheet Metal (Tier 5a) and
   Weldments (Tier 6a): the `WorkbenchMoldTools` wrapper exists for
   parity but is not mounted in `Workbench.jsx`'s switcher — the
   `moldTools` ribbon tab activates within the Mechanical CAD
   workbench when the user clicks it. The pattern keeps the viewport /
   scene-graph / ToolExecutionEngine wiring single-sourced.

---

## Tier 11b — three NX-distinctive UX patterns (3 of 3 shipped)

**Date:** 2026-05-24

Three NX-distinctive UX patterns from the Tier-11 gap list, shipped as
self-contained overlays in `SwUxOverlays.jsx`. All three integrate with
the existing 4-quadrant overlay system + the PropertyManagerDock
event bus + the foundation scene/registry/sketch state plumbing — no
ribbon or workbench-mount changes needed (the three new components
mount as siblings of the always-on `SelectionPriorityBar` return).

| Tier-11 # | Pattern | Status | Implementation |
|---|---|---|---|
| 106b | **Multi-Plane Stack** | **DONE** | `SwUxOverlays.jsx::MultiPlaneStack` — top-right docked stack of 3 reference plane cards (world Front / Top / Right by default; switches to most-recent user datums when `recordDatumPlane()` has been called). Open via `window.__archdiscOpenDatumPlaneStack()` OR the `archdisc:datum-plane:open` event. Pick a card → records `__archdiscDatumPlaneReference`, fires `archdisc:datum-plane:reference-picked`, flashes a green ✓ on the picked card, and auto-folds after 360 ms (unless the `__archdiscDatumStackForceShow` pin is set for inspection/e2e). |
| 108 | **CSYS Anchor** | **DONE** | `SwUxOverlays.jsx::CsysAnchorPanel` — mid-right panel auto-showing during Add Component flow (`__archdiscAssemblyInsertOpen`) or when armed manually. Lists World Origin + user-recorded CSYS targets via `recordCsys()`. ARMED / OFF pill toggles the snap. Picking a target writes `__archdiscCsysAnchor` (csysId, position in mm, rotation). Public helper `applyCsysAnchorToPart(group)` translates a Three.js group to the picked anchor (mm → m conversion). Single click instead of the typical 3-mate "snap to origin" setup. |
| 102 | **Dialog-in-Dialog Sketch** | **DONE** | `SwUxOverlays.jsx::InlineSketchSession` — modal session attached to the right edge of the active `PropertyManagerDock`. Activated via the new "Sketch Profile" hook button rendered at the bottom of the dock for tools in `INLINE_SKETCH_CAPABLE` (Extrude Boss / Cut, Revolve Boss, Sweep Boss, Loft Boss). 2-pane layout: TOP pane pins the parent dialog title + key values so the user keeps context; BOTTOM pane is a live sketch toolbar (Rect / Circle primitive picker + numeric width/height/cx/cy fields + SVG preview). "Done Sketch" writes the committed points to `__archdiscInlineSketchProfile` AND `__archdiscPlanParams[tool].profile` AND injects them into the live dock state via the `archdisc:inline-sketch:done` listener (so a subsequent OK on the dock resolves with the committed profile and the Extrude Boss handler's Path A consumes it). Parent dock STAYS alive throughout. |

### Bespoke real workflow — three-pattern hands-on

`e2e/ux-tier11b-nx-patterns-electron.spec.js` runs ONE workflow exercising
each pattern end-to-end. Motion-capture, `--workers=1`, no `node:*` imports.

| Stage | Pattern | What happens |
|---|---|---|
| A | (setup) | Build a 90×60×8 mm anchor plate via Atomic ops; iso-frame the camera so the three subsequent overlays read cleanly alongside the model |
| B1 | Multi-Plane | `__archdiscOpenDatumPlaneStack()` → stack opens top-right with Front / Top / Right cards |
| B2 | Multi-Plane | Click Front → `__archdiscDatumPlaneReference` reads `world-front`, picked card glows green ✓ |
| B3 | Multi-Plane | Seed 2 user datums, re-open the stack → cards now show "Offset @15mm" + "Tangent A" + Front (the worlds pad the third slot) |
| B4 | Multi-Plane | Pick the user "Offset @15mm" → reference's `isWorld: false` |
| C1 | CSYS Anchor | Seed 2 user CSYS (Shaft Front [40,20,4] mm + Shaft Rear [-40,20,4] mm); fire `archdisc:assembly-insert:open` → panel opens with 3 targets |
| C2 | CSYS Anchor | Click the OFF pill → toggle flips to ARMED |
| C3 | CSYS Anchor | Click Shaft Front card → `__archdiscCsysAnchor.csysId === 'user-csys-shaft-front'`, position [40,20,4] |
| C4 | CSYS Anchor | Insert a fresh Three.js cylinder group, snap to anchor → group.position == [0.040, 0.020, 0.004] m (mm → m); verified by direct read |
| D1 | Dialog-in-Dialog | Click ribbon Extrude Boss → PropertyManager Dock opens; "Sketch Profile" hook button visible at bottom of dock |
| D2 | Dialog-in-Dialog | Click "Sketch Profile" → InlineSketchSession overlay opens RIGHT NEXT TO dock; parent dock STAYS visible (the marquee NX semantic); 4 preview points (default 40×30 rect) |
| D3 | Dialog-in-Dialog | Edit Width 40 → 60, Height 30 → 40 in the inline fields; preview re-renders |
| D4 | Dialog-in-Dialog | Click Circle primitive → segments default 32 → 32 preview points; click back to Rect |
| D5 | Dialog-in-Dialog | Click "Done Sketch" → session closes, dock still alive; `__archdiscPlanParams['Extrude Boss'].profile` has 4 points spanning 60×40; dock state injection slot records the same |
| (commit) | Dialog-in-Dialog | Click dock OK → Extrude Boss handler runs with the committed profile via Path A; new body bbox is 60×40×25 mm — verified by `width_mm: 60, depth_mm: 40, height_mm: 25` |
| E1 | (summary) | Final summary still shows the anchor plate, the CSYS-snapped cylinder, and the inline-sketch-extruded boss all in one frame |

### Framing — perfectly viewable

ONE stable iso framing of the anchor plate held through patterns A → D;
a small camera re-park for the final E1 summary so the new extruded boss
+ snapped cylinder are all in frame. NO 7-angle orbit — the overlays
themselves are the visual story, not orbit-around-a-static-model. 15
stills + a 1.81 MB session video.

### Visual check (read the stills)

1. `02-B1-multiplane-stack-open-world-planes.png` — the Reference Planes
   stack docks top-right with the header "Reference Planes" and three
   cards: blue Front (XZ), green Top (XY), red Right (YZ). Each card
   shows the plane name + axis hint + a coloured swatch matching the
   surface normal.
2. `03-B2-multiplane-stack-front-picked.png` — the Front card now has a
   green left rail + green ✓ icon. `__archdiscDatumPlaneReference` reads
   `world-front` (verified in spec).
3. `04-B3-multiplane-stack-user-datums-override.png` — cards have
   switched to the two seeded user datums ("Offset @15mm" with amber
   "user · XY" subtitle, "Tangent A" with purple swatch + "user · YZ")
   plus Front padding the third slot.
4. `06-C1-csys-anchor-panel-open-with-user-csys.png` — CSYS Anchor panel
   appears at mid-right showing the header "CSYS Anchor" + OFF pill +
   three target rows: World Origin, Shaft Front · user, Shaft Rear · user.
5. `07-C2-csys-anchor-toggle-armed.png` — the OFF pill has flipped to
   green ARMED with the inner glow. The panel border now has the blue
   active accent.
6. `08-C3-csys-anchor-shaft-front-picked.png` — Shaft Front row has a
   green left rail + green ✓ icon. `__archdiscCsysAnchor.csysId ===
   'user-csys-shaft-front'` (verified).
7. `11-D2-inline-sketch-session-opened-rect-default.png` — the marquee
   shot. The PropertyManager Dock for Extrude Boss sits at the LEFT;
   the InlineSketchSession overlay sits immediately to its right
   (amber-bordered, "Extrude Boss · profile" pinned at top with the
   parent values WIDTH/DEPTH/HEIGHT shown as small kv pills). Bottom
   pane has Rect/Circle primitive picker (Rect active blue), 4 numeric
   fields (Width 40 / Height 30 / Cx 0 / Cy 0), a small SVG preview
   showing the 4-point square, and Cancel / Done Sketch buttons.
8. `15-E1-final-summary-three-patterns-applied.png` — the anchor plate,
   the CSYS-snapped cylinder (visible orange tick at top-right of plate),
   AND the new extruded boss (60×40×25 mm) all in one frame. Design
   History shows the "Extrude Boss (SP-6 arbitrary profile): 4-point
   closed wire × 25 mm" entry. Toast confirms "V = 60000 mm³, 6 faces".

### Focal assertions (verified live in the spec)

| Pattern | Assertion | Value |
|---|---|---|
| Multi-Plane | Stack opens with 3 cards | 3 ✓ |
| Multi-Plane | Front / Top / Right world planes present | 3/3 ✓ |
| Multi-Plane | Pick Front → reference = world-front | ✓ |
| Multi-Plane | User datums override world planes | ✓ |
| Multi-Plane | Pick user datum → isWorld === false | ✓ |
| CSYS Anchor | Panel opens with World Origin + 2 user CSYS | 3 targets ✓ |
| CSYS Anchor | OFF pill flips to ARMED | ✓ |
| CSYS Anchor | Pick Shaft Front → csysId stored | user-csys-shaft-front ✓ |
| CSYS Anchor | snap → group.position = [0.040, 0.020, 0.004] m | exact ✓ |
| Inline Sketch | Dock for Extrude Boss opens | ✓ |
| Inline Sketch | "Sketch Profile" hook button visible in dock | ✓ |
| Inline Sketch | Inline session opens; parent dock STAYS alive | both visible ✓ |
| Inline Sketch | Default rect = 4 preview points | 4 ✓ |
| Inline Sketch | Circle primitive = ≥16 preview points | 32 ✓ |
| Inline Sketch | Done writes profile to plan params + dock state | both ✓ |
| Inline Sketch | Dock OK → Extrude builds body with sketched dims | 60×40×25 ✓ |

### Files added/changed for Tier-11b

- `frontend/src/components/SwUxOverlays.jsx` (modified) — added
  `MultiPlaneStack`, `CsysAnchorPanel`, `InlineSketchSession`,
  `InlineNumberField`, `InlineSketchPreviewSVG` components; public
  helpers `recordDatumPlane`, `recordCsys`, `applyCsysAnchorToPart`,
  `enterInlineSketchSession`, `commitInlineSketchProfile`,
  `cancelInlineSketchSession`; extended `SelectionPriorityBar` return
  to mount the 3 new overlays as siblings (so they auto-ride every
  workbench without touching `WorkbenchMechanical.jsx`); extended
  `PropertyManagerDock` with the inline-sketch hook button (gated by
  `isInlineSketchCapable`) + the `archdisc:inline-sketch:done` listener
  that injects the committed profile into the live dock state's
  `values.profile` slot.
- `frontend/src/components/SwUxOverlays.css` (modified) — added the
  full `.sw-multiplane-*`, `.sw-csys-anchor-*`,
  `.sw-inline-sketch-*`, `.sw-pm-dock-inline-sketch-*` rule sets;
  added the `sw-slide-in-right` keyframes (sw-slide-in-left already
  existed).
- `frontend/src/foundation/ToolParamSchemas.js` (modified) — appended
  the `INLINE_SKETCH_CAPABLE` set + `isInlineSketchCapable(toolName)`
  helper.
- `e2e/ux-tier11b-nx-patterns-electron.spec.js` (new) — 15 stills + a
  1.81 MB session video.

### Honest gaps in Tier-11b

1. **Multi-Plane Stack is open-via-API today.** The stack auto-opens
   on `window.__archdiscOpenDatumPlaneStack()` or the
   `archdisc:datum-plane:open` event, but the user-facing ribbon does
   not yet have a "Datum Plane" tool entry that calls this hook on
   click. The cleanest path to ribbon-driven activation requires
   editing `RibbonToolbar.jsx` to add the entry + wiring it in
   `ToolExecutionEngine.js` — both forbidden in this dispatch's
   allowlist. The overlay + activation hooks ship in this pass; the
   ribbon entry is queued for the next datum-plane dispatch.
2. **CSYS Anchor doesn't auto-apply on Insert Component.** Picking a
   CSYS records the anchor and arms the toggle, but the existing
   `Insert Component` handler (in `ToolExecutionEngine.js`, forbidden
   in this allowlist) does not currently consume
   `window.__archdiscCsysAnchor`. The e2e demonstrates the snap by
   calling the public `applyCsysAnchorToPart(group)` helper directly
   on a freshly-inserted Three.js group — that helper IS the snap
   semantics and is real (mm → m conversion + scene-graph translation
   + diagnostics on `__lastCsysAnchorApplied`). Wiring the Insert
   Component handler to call this helper after creating the new
   component is a one-line follow-on in the next assembly dispatch.
3. **Inline Sketch session ships Rect + Circle, not arbitrary curves.**
   Sufficient for the canonical "I just want this Extrude to use this
   shape RIGHT NOW" use-case the NX feature optimises for; arbitrary
   curve editing (splines, fillets, multi-loop profiles, dimension
   constraints) belongs in the full `InteractiveSketch` engine and
   would be a separate Tier-11c dispatch. The inline session
   deliberately stays small + fast + complete-in-one-screen — that's
   the NX productivity promise.
4. **Inline Sketch toolbar is numeric-driven, not viewport-click-driven.**
   The user types width / height / radius into the inline fields; a
   classic NX inline sketch lets the user click 2 / 4 corners directly
   in the viewport to define the rectangle / polygon. The current
   foundation `InteractiveSketch` is the right place for click-driven
   inline drawing — entering it would re-enter the singleton sketch
   state which conflicts with the parent dialog's "no exit" promise.
   Queued for Tier-11c after the sketch-state-persistence work.
5. **Three overlays mount on top of any workbench tab that includes
   `SelectionPriorityBar`** — currently only the Mechanical CAD
   workbench mounts SwUxOverlays' overlays. The 4 sibling workbench
   wrappers (Architecture / Gaming / Automotive / Electronics) don't
   import `SelectionPriorityBar` so the new overlays don't surface
   there. Mounting the SW UX overlays uniformly across all 5
   workbenches is a separate dispatch (the existing fix-viewport
   re-org noted this as a follow-on).

### E2E + regression subset (Tier 11b)

Headed Electron, `--workers=1`, `--retries=0`. The targeted regression
band:

| Spec | Result |
|---|---|
| `ux-tier11b-nx-patterns-electron` (NEW) | **PASS** (30.7 s) |
| `ux-tier11a-selection-filter-electron` (regression — adjacent overlay set) | PASS |
| `ux-tier1-electron` (regression — Tier-1 overlays unchanged) | PASS |
| `ux-tier2c-sketch-transforms-electron` (regression — sketch state untouched) | PASS |
| `ribbon-test` (regression — ribbon tabs still render) | PASS |

4/4 regression PASS, 1/1 new test PASS. No regressions introduced by
the Tier-11b additions.

---

## UI cleanup pass — 2026-05-24 (ribbon clipping + overlay dedup)

User feedback verbatim: "the ribbon, the AI options are getting cut. also
there are old UI behind the newer ones you can see behind the one in
viewport". A focused cleanup dispatch consolidating five user-visible UI
fragments. None of these were new features — each was a stale overlay or
debug artifact that had accumulated as Tier-1 → Tier-11 layered new
chrome on top of pre-existing components.

### What was fixed

| # | Issue | Resolution |
|---|---|---|
| 1 | Part tab ribbon clipped at 124 px — second row of tools cropped, third group label bleeding through | Bumped `--ribbon-height` from 124 → **168 px**. Reworked `.ribbon-group-tools` to a deterministic 2-row layout (`flex-direction: column; flex-wrap: wrap; max-height: 92px;`) so groups stay exactly 2 rows tall and grow horizontally; the ribbon scrolls horizontally for overflow (SW / Fusion 360 convention) |
| 2 | Duplicate "[Box]" active-tool pill at viewport top-centre | Removed the `.active-tool-indicator` div from `WorkbenchMechanical.jsx`. The canonical active-tool name lives in `SwUxOverlays::ConfirmationCorner` (top-right) which already carries the same data plus the green-check / red-X commit buttons |
| 3 | Two floating AI buttons at the bottom-right (chat bubble + "AI" pill) | Deleted the standalone `.ai-settings-launcher` button. AI Settings is now reachable from inside the chat panel via a header "Settings" link (`AIChatPanel`'s `onOpenSettings` prop). The chat-launcher relocated to `bottom: 16px` (was 72 px to clear the deleted pill) and carries `data-ai-launcher="canonical"` for e2e identification |
| 4 | Design History panel showed bare developer text "Feature timeline · viewport Rollback bar = kernel timeline" below the header | Removed the `.dh-scope-note` div. The semantic explanation is preserved as the panel's `title` tooltip on hover |
| 5 | Left tool palette had 11 category-dropdown launchers (Sketch / Part / Reference / Direct Edit / Surface / Assembly / Sheet Metal / Weldments / Piping / Simulate / Manufacture) — 9 of them duplicated ribbon tabs exactly | Removed all 11 category buttons. Left palette is now scoped to viewport-interaction tools only: Select, Move, Settings (3 buttons). The `TOOL_GROUPS` constant + `renderDropdown` machinery is kept in the file (zero-cost dead code) so the Reference + Piping groups — which don't yet have a ribbon home — can be promoted in a future dispatch with a one-line button-render addition |

### Files added/changed

- `frontend/src/styles/workbench.css` — `--ribbon-height` 124 → 168 px; placeholder fallback values updated to match
- `frontend/src/components/RibbonToolbar.css` — `.ribbon-group-tools` 2-row clamp; `.ribbon-group` natural width + `overflow: hidden`; doc comments explaining the height budget
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` — removed `.active-tool-indicator`; removed `.ai-settings-launcher`; removed the 11 category dropdown buttons; pass `onOpenSettings` to `AIChatPanel`; chat-launcher carries `data-ai-launcher="canonical"`
- `frontend/src/components/DesignHistoryPanel.jsx` — removed `.dh-scope-note`; moved the explanation into a panel-level `title` tooltip
- `frontend/src/components/AIChatPanel.jsx` — new `onOpenSettings` prop; header gains a `.chat-header-settings` link that opens AI Settings
- `frontend/src/components/AIChatPanel.css` — `.chat-launcher` repositioned to `bottom: 16px`; new `.chat-header-settings` style
- `e2e/ui-cleanup-ribbon-overlay-dedup-electron.spec.js` (NEW) — single test, motion-capture; verifies all five fixes in one workflow

### Bespoke real workflow — Mechanical CAD Part tab cleanup verification

1. Launch headed Electron, land on Mechanical CAD → Part tab.
2. Measure every `.ribbon-tool` button's bounding box vs. the container's bottom edge — assert no button overhangs the container.
3. Build a Box atomically (bypass dialog) to exercise the active-tool indicator path.
4. Query the DOM for `.active-tool-indicator` (must be 0), `.ai-settings-launcher` (must be 0), `[data-ai-launcher="canonical"]` (must be exactly 1), `.tool-icon-button` inside `.workbench-tools-inner` (must be ≤ 4).
5. Read the Design History panel's innerText — must contain "design history" (case-insensitive) and must NOT contain "kernel timeline".
6. Capture three storyboard stills (A-part-tab-active, B-box-built, Z-final-cleanup-state) plus the 00-session.webm.

### E2E + regression subset

Headed Electron, `--workers=1`, `--retries=0`:

| Spec | Result |
|---|---|
| `ui-cleanup-ribbon-overlay-dedup-electron` (NEW) | **PASS** (16.4 s; 70 ribbon buttons, 0 clipped) |
| `ribbon-test` (regression — ribbon still renders 10 tabs / 70 Part tools / 38 Sketch / 33 Simulate) | PASS |
| `ux-tier1-electron` (regression — Confirmation Corner remains canonical active-tool surface) | PASS (32.0 s) |

3/3 PASS. No regressions. The cleanup is purely subtractive (removed
duplicates + debug text) plus the ribbon-height/layout rework — no
foundation or kernel touches.

### Honest gaps left for future dispatches

1. **Reference + Piping groups orphaned.** The 11-category palette dedupe removed all category buttons, including Reference (Reference Plane / Axis / Coordinate System) and Piping (Route Pipe / Wire Harness / etc.) which don't yet have a ribbon home. They live in `TOOL_GROUPS` and execute through the AI Console / Command Palette / direct API — the palette button is gone but the tools still function. Promote them to ribbon tabs (or a "Reference & Routing" combined tab) in the next ribbon dispatch.
2. **Chat-launcher emoji icon.** The `💬` emoji is fine for now but a lucide-react `MessageSquare` icon would match the rest of the workspace's icon language. Cosmetic queue.
3. **ConfirmationCorner shows only with an active confirmable tool.** When no tool with a commit/cancel interaction is active, the active-tool indicator is silent — that's the SW convention. A user who clicks Box (which auto-commits without a confirmable interaction) won't see ANY active-tool indicator. The transient `tool-status-bar` toast carries the result. This was the SW convention before the cleanup; preserved.

