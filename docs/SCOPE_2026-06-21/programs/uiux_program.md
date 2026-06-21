# PROGRAM — Forge Enterprise UI/UX Redesign

**Date:** 2026-06-21
**Owner doc:** part of the ArchDisc mission bible (Forge track)
**Sources synthesized:** `research/enterprise_uiux.md` (NX/CATIA/Creo component-by-component teardown + Forge gap ledger G1–G15), `research/communities.md` (Part C gripes #3/#4 history-tree brittleness + topological-naming fragility; Part D R8 edit-stability as a first-class metric; R14 local/offline).
**North-star tie-in:** the UI is the surface Archie's CUA *operates*. Every redesign item must (a) make a 10-hour-shift seat for a human engineer **and** (b) be driveable by Archie's tool-call loop, because Archie-driving-Forge is what must clear ≥0.85 on every CADGenBench dimension. UI affordances that a human flicks must also be reachable as a deterministic `dispatchToolCall` verb or a `window.__forge*` hook.

---

## 0. Governing model & current-state truth

**CAD as a visual database (carried from research):** the feature tree is the schema + transaction log; the viewport is the materialized view; a sketch is a constraint-satisfaction solve; a dashboard ghost is a *speculative recompute not yet committed*. Every surface below is a **read** (highlight/measure/tree), a **write** (commit a feature transaction), or a **what-if** (ghosted preview).

**What Forge already has (verified in `frontend/src/forge-v4/`):** a single CSS-grid shell `ForgeShellV4.jsx` with a real four-zone layout and reflow-not-float Archie dock; a contextual tabbed ribbon `Toolbar.jsx`; `FeatureTree.jsx` + `featureTreeOps.js` + `RollbackBar.jsx`; `sketchSession.js` (constraint session, `frameFromSpec`, `deriveFacePlane`, `dof()` estimate, kernel `window.forge.sketcher.*`); `ToolParamDialog.jsx` + `toolSchemas.js` (schema-driven dashboards, ✓/✗ corner); `ActionWheel.jsx` (8-spoke radial); `snapEngine.js` + `SnapIndicator.jsx` + `SnapStatusChip.jsx`; `CommandPalette.jsx` (852 lines, exists); `SelectionFilterStrip.jsx` (415 lines, exists); `MeasureToolPanel.jsx`, `DimensionTool.jsx`, `EquationManager.jsx` + `paramVars.js`, `NavSphere.jsx` — several "gap" components **already exist as files and need wiring, not creation**.

**The CUA driving contract (verified):** Archie's loop is `ForgeRunner.js` → `parseAssistant` → `dispatchToolCall(call, {forge, ctx})` in `ForgeToolBridge.js` (2779-line tool registry), plus `installForgeRunner()` exposing `window.__forgeEngine`. The shell exposes a large imperative surface: `window.__forgeOpenCommandPalette`, `__forgeOpenSelectionMode`, `__forgeFitToBounds`, `__forgeOpenSection`, `__forgeThree/__forgeScene/__forgeBodies`, `window.forge.sketcher.*`, `window.__forgeSelectionContext()` (fed back into Archie's prompt as viewport state). **Design rule for this program: every new interactive surface ships with BOTH a React event path (human) AND a `window.__forge*` imperative entry + a `dispatchToolCall` verb (Archie), wired to the same reducer action — never two code paths.**

**The architectural through-line (from research §G1/G2/§5):** three of the highest-value behaviors — live ghost preview, safe upstream-edit ripple, true time-travel rollback — all depend on **one kernel capability**: a side-effect-free preview path + a stable feature-replay engine with persistent topological naming. That kernel item is owned by the kernel-parity program; this UI program declares the **exact contract** it needs and sequences UI work to land the moment the kernel contract is ready. Everything else is pure front-end atop already-strong primitives.

---

## Phase map (6 phases, dependency-ordered)

| Phase | Theme | Gates on | Headline deliverables |
|---|---|---|---|
| **U0** | Foundations & brand-safety hardening | nothing | tokens, draggable splitters, dead-code purge, theme-branch fix, keymap.js, CUA-parity harness |
| **U1** | Modal sketch sandbox | U0 | plane prompt, ribbon lockdown, auto normal-to, sketch-mode wheel |
| **U2** | Constraint truth + color-coded DOF | U1 + kernel solver residuals | solver-true DOF, per-entity blue/black/red, on-sketch glyphs, auto-weak inference |
| **U3** | Contextual dashboards + ghost preview | **kernel preview path** | live ghost, mini-toolbar, reference collectors, commit→tree flash |
| **U4** | History time-travel + expressions | **kernel replay + persistent topo-ID** | regression visual state, ripple recompute, error surfacing, expressions table |
| **U5** | Power-user + assembly context + snapping + query | U1 | flick/mark wheels, single-key alphabet, assembly fade, OSNAP snaps, QuickPick, measure, ViewCube, datums |

Acceptance is **per phase**, verified by HEADED Playwright (≥5 cam angles per the mission rules) AND a CUA-parity test that drives the same surface through `dispatchToolCall`.

---

## U0 — Foundations & brand-safety (no kernel dependency; do first)

### U0.1 Token & theme hygiene
- **What:** add the five **information-bearing** sketch-state tokens to `tokens.css` — `--forge-sketch-under` (blue), `--forge-sketch-full` (ink/black), `--forge-sketch-over` (red), `--forge-sketch-dangling` (brown), `--forge-sketch-redundant` (gray). Documented as the *only* sanctioned chromatic break (matches Creo/SW canon; like a database "row status" color).
- **Fix the dead theme branch:** `getBgColor` in `Viewport.jsx` tests `theme==='contrast'` but the shell sets `'high-contrast'` → HC background never applies. One-line fix.
- **Replaces/extends:** extends `tokens.css`, `Viewport.jsx`.

### U0.2 Purge orphaned UI generations (brand-safety, P2)
- **What:** delete `components/RibbonToolbar.jsx` (Unicode-glyph 140-button anti-pattern), `SwUxOverlays`, `styles/index.css`, `forge-app/styles.css` so blue-accent/glyph artefacts can never re-mount and break the monochrome brand. Add a CI guard `frontend/test/no-orphan-ui.test.js` asserting these paths don't exist and that no live import references them.
- **Replaces:** removes 3 dead UI generations.

### U0.3 Draggable panel splitters (G13)
- **Component:** `PanelSplitter.jsx` (thin 4px hit-target, `onPointerDown` → write `--forge-left-w` / `--forge-right-w` CSS vars, clamp left 240–420px / right 240–560px, persist to `localStorage`).
- **State:** lives in the `WORKSPACE` reducer context (`leftW`, `rightW`); not React state on the viewport (per the window-API-no-setState memory rule — splitter writes a CSS var + localStorage, dispatches one reducer commit on pointer-up).
- **Replaces:** the binary collapse-to-36px behavior on `RightPanel.jsx` / left `FeatureTree` column.

### U0.4 `keymap.js` — single source of truth for the command alphabet
- **What:** one map `{key → {action, context, label}}` consumed by a global `useHotkeys` hook AND surfaced in every `Tooltip hint`. Alphabet: `L`line `C`circle `R`rect `A`arc `D`dimension `E`extrude `O`hole `F`fillet `H`chamfer `M`mirror `P`pattern `T`trim `X`constrain `Esc`cancel/finish. (Full wiring is U5; the *table* lands in U0 so tooltips, the command palette, and the wheels all read one source.)
- **Replaces/extends:** new file; consumed by `Toolbar.jsx`, `CommandPalette.jsx`, `ActionWheel.jsx`, `HeadsUpToolbar.jsx`.

### U0.5 CUA-parity test harness (cross-cutting, governs every later phase)
- **What:** a Playwright fixture `forge-cua-parity.spec.js` that, for each interactive surface added below, asserts the surface is reachable two ways with identical reducer effect: (1) synthetic user event; (2) `window.__forgeEngine.dispatchToolCall({name, args})`. This is the mechanism that keeps "Archie operates the UI" honest as the UI grows.
- **Replaces/extends:** new harness; references `ForgeRunner.installForgeRunner`.

**U0 acceptance:** monochrome brand cannot regress (CI guard green); splitters drag + persist across reload; `keymap.js` is the only place key bindings are defined; CUA-parity harness runs (even if empty) and is wired into CI. CI green on all platforms before U1.

---

## U1 — Modal sketch sandbox (highest adoption leverage; G3, P0)

The single highest-leverage adoption feature: entering a sketch must make the whole app *focus*.

### U1.1 `SKETCH_MODE` choreography in the shell reducer
- **State machine** (extends the `WORKSPACE` reducer; `sketchActive` already exists at `ForgeShellV4.jsx:204`):
  ```
  IDLE ─(tool: sketch.new)→ AWAIT_PLANE
       ├ pick XY/YZ/XZ ghost ─┐
       ├ pick planar face ────┤→ ENTER_SKETCH(frame)   // sketchSession.openSession(frame)
       └ Esc → IDLE
  ENTER_SKETCH: camera __forgeOrientNormalTo(frame) (easeInOutQuad ~350ms);
                dispatch SET_SKETCH_ACTIVE; ribbon lockdown; window.__forgeSketchPlane = frame
  SKETCH_MODE: draw (addLine/Rect/Circle/Arc/Spline) + constraints
       ├ Finish (✓ / E) → solveSession → store profile handle → IDLE, ribbon restored
       └ Cancel (✗ / Esc) → destroySession → IDLE
  ```
- **Reuses:** `sketchSession.js` (already implements the session model + `deriveFacePlane` + `entityWorldGeometry` + kernel wiring) and the existing `view.normalTo` HUT button machinery.

### U1.2 `SketchPlanePrompt.jsx` — "Where do you want to draw?"
- Portal overlay shown only in `AWAIT_PLANE`. Renders three semi-transparent **plane ghosts** (XY→green, YZ→red-orange, XZ→blue at ~12% opacity, edge-highlight to ~60% on hover, Front/Top/Right labels near cursor — Creo convention) + a hint pill. Raycast against plane quads + `deriveFacePlane(bodyHandle, faceId)` for faces. Gated by `window.__forgeSketchPickMode`.
- **CUA path:** Archie picks a plane by emitting `sketch.new` with `{plane:'XY'|faceRef}` → bridge sets the frame directly (skips the human prompt); the prompt is the human affordance only. Parity test asserts both reach `ENTER_SKETCH`.

### U1.3 Ribbon lockdown
- On `ENTER_SKETCH`, set `data-sketch="true"` on `forge-app`. Tag every ribbon tool in the `RIBBON` map with `context:'sketch'|'feature'|'always'`. CSS `[data-sketch="true"] .forge-ribbon-btn:not([data-ctx="sketch"]){opacity:.35;pointer-events:none}`. Only Sketch tab + Finish/Cancel + view/nav stay live; workbench rail dims; right panel swaps to `SketchConstraintsToolbar.jsx`.
- **Replaces/extends:** extends `Toolbar.jsx` render + `RIBBON` schema; uses existing `SketchConstraintsToolbar.jsx`.

### U1.4 Auto normal-to + smooth snap-to-2D
- `__forgeOrientNormalTo(frame)`: lerp camera quaternion to look down `-frame.normal`, `up=frame.v`, reusing `CameraCenterEffect`/`__forgeFitToBounds` easing in `Viewport.jsx`. Generalizes the existing per-face `view.normalTo` button to auto-fire on sketch entry.

### U1.5 Sketch-mode context wheel (down-payment on U5)
- Key `ActionWheel.jsx` off `sketchActive`: spokes Line/Circle/Trim/Dimension/Constrain/Finish. (Flick/mark mode + nested rings land in U5; the sketch wheel itself lands here so the modal sandbox is complete.)

**U1 acceptance:** picking Sketch → plane prompt appears → click a plane → camera animates normal-to in <400ms → ribbon collapses to Sketch tab, rest greyed → draw entities → Finish restores ribbon and commits a profile to the tree. CUA: `dispatchToolCall({name:'sketch.new', args:{plane:'XY'}})` then `addLine/addCircle` then `sketch.finish` produces the same tree node. Verified HEADED, ≥5 cam angles. **Replaces:** the silent "sketch defaults to XY, no focus" behavior.

---

## U2 — Constraint truth + color-coded DOF (G4, P1)

### U2.1 Solver-true DOF (kernel-light dependency)
- **Contract from kernel:** `window.forge.sketcher.solve` must return **per-point residual DOF** + a per-entity status (under/full/over/redundant/dangling), not just a global ok flag. `sketchSession.dof()` stops being a heuristic and reads solver output.
- **Replaces/extends:** extends `sketchSession.js` + the `window.forge.sketcher.solve` contract (small kernel ask, distinct from the big U3/U4 kernel item).

### U2.2 Auto-weak inference layer
- `inferConstraints(session, newEntity)`: after each entity add, propose H/V/coincident/equal within tolerance, add them with `weak:true`, re-solve. A user-typed strong dimension over-writes the weak one (Creo behavior). Extends `sketchSession.addConstraint` with a `weak` flag.

### U2.3 Per-entity color (THE adoption signal)
- Each lifted entity in `entityWorldGeometry` carries `entityState` from §U2.1; material color = the §U0.1 token. Blue=under (draggable), black=full, red=over, brown=dangling, gray=redundant.
- **Replaces:** single-color sketch rendering in `Viewport.jsx`.

### U2.4 `ConstraintGlyphs.jsx` — on-sketch glyphs
- Reads `session.constraints`, projects each anchor to screen via `snapEngine.worldToScreen`, draws clickable glyph chips (`═`∥ `⊥`perp `○`concentric `=`equal `⌒`tangent `⌷`H `▯`V `△`sym, lock). Click → select/delete the constraint.
- **Replaces/extends:** complements the panel-only `SketchConstraintsExtendedPanel.jsx` with geometry-anchored glyphs. Add missing constraint kinds to `sketchSession.KIND_BY_NAME`: Collinear, Diameter, Point-on-entity, Equal-radius, Symmetry-about-axis.

### U2.5 DOF counter upgrade
- Feed `SketchStateBadge.jsx` solver-true DOF; clicking the badge highlights still-free entities (drag-test); mirror DOF into the status-bar right zone (a `DofCell`).

**U2 acceptance:** draw a rectangle → entities render blue → add constraints → they turn black as DOF→0 → over-constrain → offending entity turns red + glyph flagged; clicking the DOF badge highlights free entities. CUA: bridge can query `sketch.dof()` and read per-entity state in `__forgeSelectionContext` so Archie *knows* when a sketch is fully defined (feeds CADGenBench intent-alignment). **Replaces:** the estimated single-color DOF state.

---

## U3 — Contextual dashboards + real-time ghost preview (G1+G5, P0 — most visible enterprise gap)

**Gates on the kernel preview path.** Sequence so UI lands the moment the kernel exposes it.

### U3.1 Kernel contract (declared here, owned by kernel program)
- Every parametric op needs a **side-effect-free** entry: `window.forge.preview.<op>(args) → {positions, indices}` — builds into a scratch shape and tessellates **without** registering a body or mutating the tree.

### U3.2 Live ghost preview in `ToolParamDialog.jsx`
- On every field change (debounce ~120ms) call `forge.preview.<op>`. Render a `GhostBody` in `Viewport.jsx`: `meshStandardMaterial transparent opacity:0.45 depthWrite:false`, accent-tinted edges, no shadows. A depth drag-arrow on the ghost writes back into the dialog field (two-way bind). On ✓ → discard ghost, dispatch the real op (existing path), tree node appends + **flashes** (scroll-to + 1-frame highlight). On ✗ → discard ghost, no tree change.
- **Replaces/extends:** extends `ToolParamDialog.jsx` (keep the schema-driven dialog + ✓/✗ corner); adds `GhostBody` to `Viewport.jsx`.
- **CUA path:** Archie doesn't need the visual ghost, but the bridge gains `op.preview(args)` returning the tessellation + a validity flag so Archie can *check before committing* — a direct lever on CADGenBench Invalidity Ratio.

### U3.3 `MiniToolbar.jsx` — cursor-anchored (Creo mini-toolbar)
- On a face/edge/vertex pick, pop a 1-row toolbar at `event.clientX/Y` with the 3–5 ops valid for that entity (face→Extrude/Hole/Shell/Offset; edge→Fillet/Chamfer; vertex→Dimension), from an `opsForSelection(selection)` map. Selecting an op opens its dashboard pre-seeded with that reference.
- **Replaces:** the fixed-left-dock-only dialog placement.

### U3.4 Reference collectors (NX/Creo typed pickers)
- Extend `toolSchemas.js` with field type `'ref'` `{filter:'face'|'edge'|'plane', count}`. `ToolParamDialog` renders a collector chip; when active it routes the next viewport pick into it and the status bar prompts "Select a face for direction".
- **CUA path:** Archie fills collectors by passing geometry refs in the tool-call args (it already addresses faces/edges by ID via `selectionContext.js`); the human fills them by clicking. Same dialog state.

**U3 acceptance:** select a face → mini-toolbar appears at cursor → click Extrude → dashboard opens with a live translucent ghost that updates as depth changes / as the drag-arrow is pulled → ✓ commits and the new tree node flashes. CUA: `op.preview` returns valid geometry; Archie commits only valid previews. HEADED, ≥5 angles. **Replaces:** commit-only dialogs with no preview, fixed-dock placement.

---

## U4 — History time-travel + expressions (G2+G10, P0/P1)

**Gates on the kernel replay engine + persistent topological naming** — the #1 community gripe (Part C #3/#4) and Part-D R8 ("edit-stability as a first-class metric").

### U4.1 Kernel contract (declared here, owned by kernel program)
- `recomputeUpTo(index)` — replay the feature transaction log [0..index] into a fresh kernel shape + re-tessellate; bodies beyond the marker not built.
- `recomputeFrom(i)` — replay forward after an upstream edit, re-binding downstream features by **persistent topological IDs** (face/edge GUIDs stable across rebuild). This is the topological-naming solve; without it upstream edits orphan downstream features.

### U4.2 Regression visual state in `RollbackBar.jsx`
- When `rollbackIndex < length`, wire it into `recomputeUpTo(index)` so downstream features **disappear** from the viewport; render the rolled-back tip body `wireframe:true` / dashed-edge ghost so the user *sees* they are in the past.
- **Replaces:** rollback marker that (today) likely only reselects the tree without re-running the kernel.

### U4.3 Edit-upstream → ripple recompute
- Double-click an upstream feature → dashboard reopens (with the U3 ghost) → change a value → ✓ replays via `recomputeFrom(i)` re-binding downstream by persistent IDs.
- Right-click context lives in `FeatureTree.jsx` / `featureTreeOps.js` (already present).

### U4.4 Rebuild-error surfacing
- If a downstream feature can't re-bind, mark its tree node `red △!` + a "What broke" panel naming the lost reference (NX Edit-Feature→Information). Port the selected/suppressed/**error** CSS states from the orphaned tree into the live `FeatureTree.jsx`.

### U4.5 "Insert here" / freeze band
- Author at the rollback point (new features insert before the marker, Creo Insert-Mode); `data-frozen` band below the marker.

### U4.6 Expressions / parameters table (G10)
- **Component:** `EquationManager.jsx` (393 lines, **already exists**) + `paramVars.js` — wire it as the global named-variable table (`width=100`, `height=width*0.6`, units-aware). Any dialog field accepts `=expr`; on edit, re-evaluate → trigger §U4.3 ripple recompute.
- **Replaces/extends:** completes the existing `EquationManager.jsx`/`paramVars.js` (the orphaned `SwUxOverlays` proved the `=expr` intent); ties into `ConfigurationsPanel.jsx` so a config row swaps the parameter set and rebuilds.
- **CUA path:** Archie sets/reads parameters via a `param.set`/`param.get` bridge verb; expression-driven edits are how Archie produces *parametric* output (Part D R1) that opens with a clean editable tree — the core thesis of the north-star.

**U4 acceptance:** drag rollback up → downstream features vanish, tip shows as ghost → edit an upstream extrude depth → push marker down → Hole1/Fillet1 re-attach to the correct faces with no orphan; break a reference deliberately → red △! + "what broke" names it. Expressions: `height=width*0.6`, change `width` → model rebuilds. **This phase is the literal answer to community gripes #3/#4 and is table-stakes for parametric MCAD.** HEADED, ≥5 angles, plus a regression suite of 10 edit-stability cases.

---

## U5 — Power-user UX, assembly context, snapping, query (G6–G9, G11, G12, G15)

### U5.1 Flick/mark mode + context wheels (G6, P1) — `ActionWheel.jsx`
- On `contextmenu`+drag, if release happens >8px before the ~150ms wheel fade-in timer, resolve the spoke by 8-way angle quantize and **suppress** rendering (the Maya expert "mark"). Shrink the 24px dead-zone. Add context wheels keyed off `selection.kind` + `sketchActive`: sketch wheel (U1.5), edge wheel (Fillet/Chamfer), face wheel (Extrude/Offset/Shell). Submenu spokes (Constrain → H/V/∥/⊥/tangent/equal) render ring-2 on dwell. SessionMemory/Archie can promote a user's top ops into a learned wheel.

### U5.2 Single-key alphabet + chord numeric input (G7, P1)
- Global `useHotkeys` consuming `keymap.js` (U0.4); each key fires the same `forge:menu-action`/tool-arm as the ribbon. Chord: `E` then `2 5 Enter` arms Extrude depth=25 (NX dynamic input) by routing number keys into the dashboard primary field. `?`-toggled cheat-sheet HUD (`HelpDrawer.jsx`/`HelpDrawer` exists).
- **CUA path:** the alphabet maps 1:1 to `dispatchToolCall` verbs already in the bridge — the parity harness asserts each key == its tool-call.

### U5.3 Edit-in-context assembly fade (G8, P1)
- `state.activeComponent = handle`. In `Viewport.jsx`, bodies where `componentId !== activeComponent` render `opacity:0.18, depthWrite:false, color:--forge-ink-mute` and become non-pickable unless `Alt` held (NX select-in-inactive); active component opaque + selectable. Keep a thin opaque silhouette on ghosted neighbors (drive from `EdgePickOverlay`) so mating faces stay findable. Mirror in `AssemblyTreePanel.jsx` (bold active, dim siblings). Assembly-level mates with live remaining-DOF readout per component (extends the §U2 DOF model to assemblies).
- **Reuses:** `assemblyHierarchy.js`, `AssemblyTreePanel.jsx`, `assemblyDispatch.js`, `colorForBody`/`BodyColorsPanel.jsx`.

### U5.4 OSNAP-grade snapping (G9, P2) — `snapEngine.js`
- Add candidate generation `snapCandidates(scene, plane)` harvesting endpoints, edge midpoints, arc/circle centers+quadrants, and **intersection** (edge×edge / edge×plane), **nearest/on-edge**, **quadrant** (◇), **parallel/extension** inference lines — cached per-edge, recomputed near-cursor only (100k regime). `SnapIndicator.jsx` switches glyph by `kind` (□ endpoint, △ midpoint, ○ center, ✕ intersection, ◇ quadrant, ⊥ perp, ⟋ nearest, ∥ dashed extension, + grid, ⊕ origin). New `AlignmentInference` overlay for X/Y alignment dashed lines.

### U5.5 QuickPick + selection-filter strip (G11, P2)
- `QuickPick.jsx`: when the cursor overlaps multiple entities, show a cursor-anchored disambiguation list from the raycast's *sorted* hit list (hover→3D highlight, click→pick). Surface `SelectionFilterStrip.jsx` (**already exists**, 415 lines) as an always-visible filter strip in the status bar / HUT constraining what's pickable (vertex/edge/face/body/feature/sketch).

### U5.6 Status-bar completeness (G12, P2) — `StatusBar.jsx`
- `CursorReadout` cell fed by a `forge:cursor-world` event the viewport emits on `pointermove` (rAF-throttled), `X 124.50 Y −12.00 Z 0.00 mm` in `--forge-mono`. Make the snap segment a click target opening the `SnapStatusChip` popover. Add the `DofCell` (U2.5). Inline units switcher + dual-unit (mm/in) + precision.

### U5.7 Query/inspect + datums + ViewCube polish (G15, P2)
- Complete `MeasureToolPanel.jsx`/`DimensionTool.jsx` into an interactive two-pick measure (distance/angle/radius/min-distance) with persistent on-screen annotations + a CoG triad (uses `computeBodyStats`/`MassPropsPanel.jsx`). Add **user datum features** (offset plane, plane-at-angle, plane-through-3-points) as first-class tree nodes that become sketch targets (extends `kernelDispatch.js`). Verify the drei `GizmoHelper` ViewCube / `NavSphere.jsx` named-face click snapping (Front/Top/Right/Iso) + rolled-corner drag. Capped sections (hatched cut face), multiple section planes in `SectionPlanePanel.jsx`/`SectionControl.jsx`. Display-style dropdown (Shaded / Shaded+edges / Wireframe / Hidden-line / X-ray) on `HeadsUpToolbar.jsx`.
- **Global search:** make `CommandPalette.jsx` (852 lines, exists) the canonical NX Command-Finder — index the full `RIBBON` map + `toolRegistry.js` + Archie verbs, run the action, and **flash the source ribbon button** ("reveal in ribbon"). Render `tools[].split` galleries (Extrude ▾ → Boss/Cut/Thin/Surface) and the per-group overflow chevron.

**U5 acceptance:** expert flicks NE→Extrude in <100ms with no visible wheel; `E 2 5 ↵` extrudes 25mm; activating a component ghosts the rest non-pickably; intersection/quadrant/nearest snaps fire with distinct glyphs + alignment inference lines; QuickPick disambiguates stacked hits; cursor X/Y/Z is live; ⌘K finds any command and flashes its ribbon home. Each item passes the CUA-parity harness. HEADED, ≥5 angles.

---

## Cross-cutting acceptance & dependencies

**Kernel asks owned elsewhere but blocking this program** (declared so the kernel-parity program sequences them first):
1. `window.forge.sketcher.solve` → per-point residual DOF + per-entity status (blocks **U2**; small).
2. `window.forge.preview.<op>(args) → {positions,indices}` side-effect-free (blocks **U3.2**; medium).
3. `recomputeUpTo / recomputeFrom + persistent topological IDs` (blocks **U4**; large — the topological-naming solve, also the #1 community gripe).

**Definition of done for the whole program:**
- All of G1–G15 closed; the gap ledger in `research/enterprise_uiux.md` retires.
- Every interactive surface is dual-driven (human event + `dispatchToolCall`/`window.__forge*`) and asserted by `forge-cua-parity.spec.js` — i.e., **Archie can operate 100% of the redesigned UI**, which is the precondition for the ≥0.85-every-dimension CADGenBench run.
- Monochrome brand uninvadable (orphan-UI CI guard); the only chromatic break is the five information-bearing sketch-state tokens.
- A 10-case edit-stability regression suite (U4) is green — directly answering community gripes #3/#4 and Part-D R8.
- All phases HEADED-Playwright verified at ≥5 camera angles; CI green on all platforms between phases (single-workflow rule).

---

## Sources
Carried from the synthesized research, with live URLs already cited in `research/enterprise_uiux.md` (NX Command-Finder/Resource-Bar/Part-Navigator/QuickPick/WCS/Expressions+WAVE; CATIA 3DEXPERIENCE Action-Bar/Compass/context-menu; Creo Dashboard/Mini-Toolbar/weak-dimensions; SolidWorks Sketch-Geometry-Status colors + Configurations/Design-Tables; Maya marking menus) and `research/communities.md` (Zoo "AI must generate parametric CAD"; Ondsel topological-naming; GrabCAD large-assembly; CADGenBench/MUSE/Text2CAD benchmark dimensions). Forge component names verified against `frontend/src/forge-v4/` and the CUA driving contract against `frontend/src/ai/ForgeRunner.js` + `ForgeToolBridge.js`.
