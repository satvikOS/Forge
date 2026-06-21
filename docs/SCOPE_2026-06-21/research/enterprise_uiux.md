# Enterprise CAD UI/UX Adoption Spec — Forge vs Siemens NX / Dassault CATIA·3DEXPERIENCE / PTC Creo

**Date:** 2026-06-21
**Author:** research deep-dive (feeds: mission bible · Archie corpus · kernel parity plan · enterprise UI/UX redesign)
**North-star:** Forge must read, feel, and *respond* like a CATIA-grade seat to a mechanical engineer in hour 9 of a 10-hour shift — the UI is a **visual database** over the kernel's BRep + feature graph, not a toy modeler. Every interaction below is specified to the React-component / interaction / state-machine / data-wiring level, with the concrete current-Forge gap.

**Governing mental model — CAD as a visual database.** The model is a *query result*. The feature tree is the **schema + transaction log** (ordered, replayable mutations). The viewport is a **materialized view** (the recompute output). Sketches are **constraint satisfaction problems** (a sparse Jacobian solve). Every UI affordance below is a *read* (highlight/measure/tree), a *write* (commit a feature transaction), or a *what-if* (ghosted preview = a speculative recompute not yet committed). Designing each surface against that model is what makes a 10-hour shift survivable: low surprise, total reversibility, near-zero mouse travel, and a permanent answer to "what is the state of my model right now?"

---

## 0. What competitors actually do (grounded reference)

| Concept | Siemens NX | CATIA / 3DEXPERIENCE | PTC Creo |
|---|---|---|---|
| Top command surface | **Ribbon** + **Command Finder** (search any command; only ribbon/menu/toolbar cmds, *not* navigator/shortcut cmds) | **Action Bar** (bottom) + per-object **Action Pad** + **context menu next to cursor** suggesting the next command | **Ribbon** + context-sensitive **Dashboard** (dialog bar + panels + message area + control area) |
| Left model navigator | **Part Navigator** (feature/body tree; right-click edit/suppress/reorder; "roadmap to the model") in the **Resource Bar** (tabbed navigators/browser/palettes; Ctrl+Shift+Tab cycles) | **Specification Tree** (PartBody → Sketch → Pad → …) | **Model Tree** (features in regeneration order) |
| Commit affordance | Dialog with **OK / Apply / Cancel**, live **preview** before OK | green-check / red-X in robot-anchored dialog | **green-check ✓ / red-X** on the Dashboard control area; live preview |
| Cursor-local commands | **QuickPick** (cursor-radius disambiguation list), **mini dialogs** | **Robot/Compass** anchored handle + context menu at cursor | **Mini Toolbar** (commands for the selected entity — pick a surface → Extrude/Hole/Shell appear next to it) |
| Sketch constraint color | weak/auto vs applied distinguished | dimensional + geometric constraints, ISO/coincidence/tangency/concentricity glyphs | **weak = gray, strong = blue, locked = own color**; Creo *always* keeps the sketch fully-constrained with weak dims |
| Sketch geometry state | under/fully/over | under/iso-constrained/over | under/fully (weak)/over |
| Coordinate system readout | **WCS** XC/YC/ZC, `W` shows/hides | Compass + axis system | csys + dashboard message area |
| Param engine | **Expressions** (formula list, spreadsheet-driven, **inter-part/WAVE** links) | **Knowledgeware** formulas/rules/params | **Relations** + **Parameters** + family tables |
| Variants | (reuse libraries / part families) | **Design Tables** / EKL | **Family Tables** |

**SolidWorks color canon (the de-facto industry standard Forge must match exactly):**
- **Blue** = under-defined (free DOF remain) · **Black** = fully defined (DOF = 0, locked, will not drag) · **Red** = over-defined (conflicting/redundant constraints, error) · **Gray** = redundant/can't-be-modified · **Brown/Yellow** = dangling / unnecessary-relation / no-solution-found.

**Sources:** Siemens NX UI/Command Finder/Resource Bar/Part Navigator/QuickPick/WCS docs (community.sw.siemens.com, manualzz NX Interface, cad-tips.com QuickPick, prolim.com Resource Bar); CATIA 3DEXPERIENCE Action Pad/Action Bar/Compass/context-menu (help-3dexperience, rand3d.com, blog.3ds.com, goengineer V5→3DX); Creo Dashboard/Mini Toolbar/weak dimensions (support.ptc.com About_the_Dashboard, To_Control_the_Display_of_Dimensions, About_Sketcher_Constraints; ascented.com mini toolbar; community.ptc.com weak constraints); SolidWorks Sketch Geometry Status (help.solidworks.com c_Sketch_Geometry_Status); Maya Marking Menus (help.autodesk.com MAYAUL marking menus); NX Expressions/WAVE (mayahtt.com, prolim.com, ata-e.com); SolidWorks Configurations/Design Tables (help.solidworks.com, goengineer.com). Full URL list at end.

---

## 1. Four-zone workspace (the frame)

### 1.1 Reference layout (target geometry)
```
┌──────────────────────────────────────────── TopBar 40px (app · file · global search · Archie) ───┐
├──────────────────────────────────────────── QAT 32px (quick-access + ribbon TAB strip) ──────────┤
│ WB   │  RIBBON 92px (contextual: Sketch│Surface│Assembly│Sheet-Metal│Evaluate tabs, dense icons)  │
│ RAIL │──────────────────────────────────────────────────────────────────────────────────────────│
│ 72px │  ┌── LEFT 300px ──┐                                                  ┌── RIGHT 340px ──┐    │
│ disc │  │ FEATURE TREE   │            DARK-MATTE 3D CANVAS (#000)           │ PROPERTY /      │    │
│ tabs │  │ (part DNA)     │   HUT toolbar(top-center) · ViewCube(corner)     │ DASHBOARD       │    │
│      │  │ Sketch1        │   Snap glyphs · ghost preview · triad            │ collectors      │    │
│      │  │ └Extrude1      │                                                  │ + RollbackBar   │    │
│      │  │  Hole1·Fillet1 │                                                  │ (right gutter)  │    │
│      │  └────────────────┘                                                  └─────────────────┘    │
├──────────────────────────────────────────── STATUS/SNAP BAR 26px ────────────────────────────────┤
│ LEFT: mode·selection   CENTER: X/Y/Z cursor · Vol·Area·Mass   RIGHT: units · snap · grid · DOF    │
├──────────────────────────────────────────── ARCHIE COMMAND BAR 52px (always-on CUA prompt) ──────┘
```

### 1.2 Forge implementation
- **`ForgeShellV4.jsx`** is the single CSS-grid shell (`forge-app` grid template in `forge-v4/tokens.css`). Keep the grid model (zones never overlap; Archie dock *reflows* the right column rather than floating — `forge-app[data-archie-open]`). This is already correct and is a genuine strength.
- **State machine — `useReducer` shell store** keyed `WORKSPACE`:
  ```
  states: IDLE → TOOL_ARMED → (SKETCH_MODE | DASHBOARD_MODE) → COMMIT → IDLE
  context: { activeWb, activeTab, activeTool, selection, sketchSession, dashboard, rollbackIndex, units, snap }
  ```
- **Zone components (live, keep):** `TopBar.jsx`, `Toolbar.jsx` (the ribbon — see §1.3), `WorkbenchRail.jsx`, `FeatureTree.jsx`, `RightPanel.jsx`, `StatusBar.jsx`, `CommandBar.jsx` (Archie), `Viewport.jsx`.
- **Canvas:** keep `Viewport.jsx` OLED-black `<color attach>` (#000); it already has octree culling + LOD + instancing for the 100k regime, section/clip gizmos, PBR path, ViewCube via drei `GizmoHelper`, origin triad. **Fix the dead theme branch:** `getBgColor` tests `theme==='contrast'` but shell sets `'high-contrast'` → HC background never applies. Trivial one-line fix; do it.

### 1.3 TOP ribbon + command bar
- **Already a real ribbon**, not a flat toolbar: `Toolbar.jsx` is a *contextual, per-workbench, tabbed* ribbon — `RIBBON[wb] = [{id, label:'Sketch', groups:[{label, tools:[{id,label,icon,hint,primary,split?}]}]}]`. `mech` is fully tabbed (Sketch / Features / Pattern / Evaluate / Drawing); Sheet-Metal is tabbed by stage (Create / Form & Corner); Weld / Mold / Study tabs exist. Keep this structure — it matches NX/Creo ribbon + CATIA CommandManager convention.
- **Required upgrades to reach NX/Creo grade:**
  1. **Command Finder / global search** (NX *Command Finder*): a `⌘K` palette that fuzzy-searches every ribbon command (id, label, hint, workbench) + recent + Archie verbs, runs the action and *flashes the source ribbon button* so users learn its location. There is a `CommandPalette.jsx` — wire it to index the full `RIBBON` map and the `ToolRegistry`, and add "reveal in ribbon" highlight. **Gap: palette exists but is not the canonical command-finder over the ribbon tree.**
  2. **Split-button galleries** for hero ops (Extrude ▾ → Boss/Cut/Thin/Surface). `tools[].split` is already in the schema — render the dropdown.
  3. **Overflow → "more" chevron** per group when the row exceeds width (the header comment claims it; verify it renders).
  4. **Icon discipline:** all live ribbon icons come from the `Icon` component (vector). Do NOT revive the orphaned `components/RibbonToolbar.jsx` (Unicode-glyph icons, a 140-button "Sculpt" group — the project's own anti-pattern). **Gap: delete the three orphaned UI generations (`components/RibbonToolbar`, `SwUxOverlays`, `styles/index.css`, `forge-app/styles.css`) so the blue-accent/glyph artefacts can never re-mount and break the monochrome brand.**

### 1.4 LEFT feature tree (part "DNA")
Covered in depth in §5; the *layout* contract: fixed-but-**user-draggable** 300px column. **Gap: right column is a fixed 340px with only binary collapse-to-36px; no draggable splitter. Add a drag handle (`onPointerDown` → update a `--forge-right-w` CSS var, clamp 240–560px, persist to localStorage).** Same for the left tree column.

### 1.5 BOTTOM status / snap bar
- `StatusBar.jsx` already has three zones (LEFT mode+selection, CENTER measurement Vol/Area/Mass, RIGHT units·snap·grid+activity) with tabular numerals. **Two gaps vs NX/Creo:**
  1. **Live X/Y/Z cursor coordinates** — there is a `HeadsUpToolbar` viewport HUD showing the *selection* centroid, but NX/Creo show the *cursor* world position continuously while sketching/placing. Add a `CursorReadout` cell fed by a `forge:cursor-world` event the viewport emits on `pointermove` (throttle to rAF), formatted `X 124.50  Y −12.00  Z 0.00 mm` in `--forge-mono`. **Gap: no live cursor coordinate in status bar.**
  2. **Snap toggle chips clickable in the bar** (NX selection-bar snap toggles): the status bar shows snap On/Off but isn't a click target to toggle individual snap modes. Wire the snap segment to open the `SnapStatusChip` popover (which already manages `snapEngine.SNAP_MODES`).
- **Add a DOF cell** while in sketch mode (mirrors the badge; see §3).

---

## 2. Modal sketch sandbox

The single highest-leverage adoption feature. Entering a sketch must feel like the whole app *focuses*: the world dims, the plane snaps flat, non-sketch tools gray out, and the app asks **"where do you want to draw?"**

### 2.1 Target behavior (NX/CATIA/Creo)
- Pick *Sketch* → app asks for a plane/face → camera animates **normal-to** the plane → the rest of the ribbon collapses to the **Sketch** tab only → 3D solids fade to context → a 2D grid appears on-plane. Creo enters a dedicated sketcher; NX shows the *Sketch* group active and a *Finish Sketch* exit; CATIA enters the Sketcher workbench with the sketch plane highlighted.

### 2.2 Forge state machine — `SKETCH_MODE`
```
IDLE
  └─(tool: sketch.new)→ AWAIT_PLANE      // "Where do you want to draw?" overlay
       ├─ pick named plane (XY/YZ/XZ) ─┐
       ├─ pick planar face ────────────┤→ ENTER_SKETCH(frame)
       └─ Esc → IDLE                    
ENTER_SKETCH(frame):
  • sketchSession = openSession(frame)               // forge-v4/sketchSession.js
  • camera → normalTo(frame.normal)  (animated, easeInOutQuad, ~350ms)
  • shell.dispatch({type:'SET_SKETCH_ACTIVE', frame})
  • ribbon → lockdown (see 2.4)
  • set window.__forgeSketchPlane = frame  (snapEngine + viewport read it)
SKETCH_MODE:
  draw entities (addLine/addRect/addCircle/addArc/addSpline) + constraints
  • Finish (✓ / E) → solveSession → store profile handle → IDLE, ribbon restored
  • Cancel (Esc / ✗) → destroySession → IDLE
```
- `sketchSession.js` **already implements** the session model (points/edges/constraints, `frameFromSpec`, `deriveFacePlane` auto-picks the top planar face, `entityWorldGeometry` lifts 2D→3D, `dof()` estimate, kernel `window.forge.sketcher.*` wiring). The shell already has `sketchActive` state (`ForgeShellV4.jsx:204`) gating the `SketchStateBadge`. **What's missing is the *modal lockdown + plane-prompt + auto-orient* choreography around it.**

### 2.3 "Where do you want to draw?" prompt
- New component `SketchPlanePrompt.jsx`: a portal overlay shown only in `AWAIT_PLANE`. Renders three **plane ghosts** in the viewport (semi-transparent quads at XY/YZ/XZ) + a hint pill "Select a plane or planar face". On hover, the plane highlights (see 2.5); on click → `ENTER_SKETCH`. Driven by raycast against plane quads + `deriveFacePlane(bodyHandle, faceId)` for faces. **Gap: no plane-selection prompt today; sketch plane defaults silently to XY.**

### 2.4 Interface lockdown (non-essential tools gray out)
- On `ENTER_SKETCH`, set `data-sketch="true"` on `forge-app`. Ribbon renders with `disabled` on every tool whose `tool.context !== 'sketch'`; CSS `[data-sketch="true"] .forge-ribbon-btn:not([data-ctx="sketch"]){opacity:.35;pointer-events:none}`. Only the **Sketch** tab + Finish/Cancel + view/navigation stay live. Tag each ribbon tool with `context: 'sketch' | 'feature' | 'always'` in the `RIBBON` map. **Gap: ribbon does not lock down in sketch mode.**
- Workbench rail also dims (you can't switch discipline mid-sketch); the right panel swaps to the **Sketch Constraints** palette (`SketchConstraintsToolbar.jsx` exists).

### 2.5 Plane highlighting (X/Y/Z light orange/green)
- In `AWAIT_PLANE` and on hover, render plane quads with role color: **XY → green, YZ → red-orange, XZ → blue** (axis-color convention) at ~12% opacity, edge-highlight to ~60% on hover, label "Front/Top/Right" (Creo) near the cursor. Implement as three `<mesh>` in `Viewport.jsx` gated by `window.__forgeSketchPickMode`. **Gap: no on-hover plane highlight.**

### 2.6 Smooth snap-to-2D view
- Reuse the existing `CameraCenterEffect`/`__forgeFitToBounds` easing machinery in `Viewport.jsx`; add `__forgeOrientNormalTo(frame)` that lerps camera quaternion to look down `-frame.normal` with `up = frame.v`. The `view.normalTo` HUT button already requests this for a selected face — generalize it to the sketch-entry frame. **Gap: normal-to exists as a button but is not auto-fired on sketch entry.**

---

## 3. Geometric constraints + color-coded state

### 3.1 Auto weak / "light-blue" dimensions
- When the user draws an entity, the solver should auto-attach **weak inferred constraints** (horizontal/vertical/coincident snaps) and **weak driving dimensions** rendered light/dashed, exactly like Creo (gray weak dims keep the sketch fully constrained) — a *strong* dimension the user types over-writes the weak one (Creo behavior). Forge currently logs explicit constraints only. **Gap: no auto-weak inference layer; `dof()` is a heuristic, not solver-derived.**
- Implementation: extend `sketchSession.addConstraint` with a `weak:true` flag; after each entity add, run an **auto-constrain pass** (`inferConstraints(session, newEntity)`) that proposes H/V/coincident/equal based on tolerance, adds them weak, and re-solves. The kernel `window.forge.sketcher.solve` already returns a status; expose `solve` to also return **per-point residual DOF** so the badge/colors are *solver-truthful* not estimated.

### 3.2 Explicit constraints + on-sketch glyphs
- Full constraint set (match Creo/CATIA/SW), already half-present in `sketchSession.KIND_BY_NAME`:
  `Coincident, Horizontal, Vertical, Parallel, Perpendicular, Tangent, Concentric, Equal, Symmetric, Fix/Lock, Midpoint, Collinear, Distance, Angle, Radius, Diameter`.
  **Add missing:** Collinear, Diameter, Point-on-entity, Equal-radius, Pattern/Symmetry-about-axis.
- **On-sketch glyphs:** render a small badge near each constrained entity — `═` parallel, `⊥` perpendicular, `○` concentric, `=` equal, `⌒` tangent, `⌷` horizontal, `▯` vertical, `△` symmetric, lock for fixed. New component `ConstraintGlyphs.jsx`: reads `session.constraints`, projects each constraint's anchor to screen via the same `worldToScreen` in `snapEngine.js`, draws clickable glyph chips (click → select/delete the constraint). **Gap: constraints are listed in a panel (`SketchConstraintsExtendedPanel.jsx`) but not drawn as glyphs on the geometry.**

### 3.3 Color-coded state (THE adoption signal)
- Per-entity color must follow the SW canon, computed from the solver's DOF attribution:
  | State | Color token | Meaning |
  |---|---|---|
  | under-defined | **blue** `--forge-sketch-under` | entity has free DOF (draggable) |
  | fully-defined | **black/ink** `--forge-sketch-full` | DOF=0, locked |
  | over-defined | **red** `--forge-sketch-over` | conflicting/redundant |
  | dangling | **brown** `--forge-sketch-dangling` | lost reference |
  | redundant | **gray** | can't be modified |
- Wire colors in `Viewport.jsx` sketch-entity rendering: each lifted line/circle/arc in `entityWorldGeometry` carries an `entityState` derived from solver residuals; material color = token. Add the five tokens to `tokens.css` (they are intentionally the *only* sanctioned chromatic break — sketch state — which is acceptable because it's information-bearing, like Creo/SW; document it as such). **Gap: sketch entities render in one color; no per-entity DOF coloring.**

### 3.4 DOF counter
- `SketchStateBadge.jsx` already shows `UNDER/FULLY/OVER + c=… · dof=…` bottom-center. Two upgrades: (1) feed it **solver-true** DOF (3.1); (2) clicking the badge **highlights the still-free entities** (drag-test: SW colors the draggable ones blue). Also mirror DOF into the status-bar right zone (§1.5). **Partial: badge exists; DOF is estimated, not solver-derived; no "show free DOF" action.**

---

## 4. Contextual dashboards / command dialogs + real-time ghosted preview

### 4.1 Target (NX dialog / Creo Dashboard / CATIA robot-dialog)
- Selecting a face/sketch and invoking Extrude opens a **dashboard** demanding values (depth, direction, draft, add/cut/intersect) with **OK/Apply/Cancel** (NX) or **✓/✗** (Creo/CATIA) and a **live semi-transparent ghost** of the result that updates *as you type/drag*. Creo's dashboard = dialog bar + panels + message area + control area; NX's dialog has a real-time preview toggle; the **mini toolbar** (Creo) pops the relevant op (Extrude/Hole/Shell) right next to the picked entity.

### 4.2 Forge implementation
- `ToolParamDialog.jsx` already drives **every** op from one schema (`toolSchemas.js`: fields = number/vec3/bool/select), renders a 260px left dock, and shows a **Confirmation Corner ✓/✗** at viewport top-right (Enter=confirm, Esc=cancel). This is the dashboard skeleton — keep it. **Three gaps to reach NX/Creo grade:**
  1. **Real-time ghosted preview (the big one).** Today the dialog only dispatches *on commit*; there is no live preview (`grep ghost|preview|opacity` → none). Add a **speculative recompute** path:
     - On every field change (debounced ~120ms), call a kernel **dry-run**: `window.forge.preview.<op>(args)` returning a *throwaway* tessellation (no feature committed, no tree mutation).
     - Render it in `Viewport.jsx` as a `GhostBody` — `meshStandardMaterial` `transparent opacity:0.45 depthWrite:false`, accent-tinted edges, no shadows. Drag handles on the ghost (depth arrow) write back into the dialog field (two-way).
     - On ✓ → discard ghost, dispatch the real op (existing path), tree adds the node. On ✗ → discard ghost, no tree change.
     - Kernel contract: every parametric op needs a `previewArgs → {positions,indices}` entry point that builds into a scratch shape and tessellates without registering a body. (This is the kernel-parity item that unblocks the UX — note it for the kernel plan.)
     **Gap: NO live ghost preview — this is the most visible missing enterprise behavior.**
  2. **Cursor-anchored mini-toolbar (Creo).** On a face/edge/vertex pick, pop a tiny 1-row toolbar *at the cursor* offering the 3–5 ops valid for that entity (face→Extrude/Hole/Shell/Offset; edge→Fillet/Chamfer; vertex→Dimension). New `MiniToolbar.jsx` portal anchored to `event.clientX/Y`, populated by an `opsForSelection(selection)` map. Selecting an op opens its dashboard pre-seeded with that reference. **Gap: dialog opens as a fixed left dock, never at the cursor; no entity-contextual mini toolbar.**
  3. **Reference collectors (NX/Creo).** Dashboards need typed **collector** fields ("First reference", "Direction", "Up-to face") that the user fills by clicking geometry; the active collector highlights and the status bar prompts "Select a face for direction". Extend `toolSchemas.js` field type `'ref'` with `{filter:'face'|'edge'|'plane', count}`; `ToolParamDialog` renders a collector chip that, when active, routes the next viewport pick into it. **Gap: schema has number/vec3/bool/select but no geometry-reference collector.**
- **Commit → tree update:** already wired (op dispatch appends a feature node). Ensure the ✓ animation flashes the new tree node (scroll-to + 1-frame highlight) so the user sees cause→effect.

---

## 5. History rollback "time-travel" bar

### 5.1 Target
- Drag a rollback marker up the tree to **regress** the model to a prior step (downstream features hidden, solid may show as wireframe/earlier state), edit an upstream dimension, then push the marker back down → **ripple recompute** through Hole/Fillet/etc. without breaking them (or surfacing a rebuild error if a reference died). NX = drag in Part Navigator / *Edit with Rollback*; Creo = *Insert Here*; SW = rollback bar.

### 5.2 Forge implementation
- `RollbackBar.jsx` exists (vertical scrubber, playhead at `activeIndex*26+12`, click a card to jump, right-click suppress/rename/delete) and `FeatureTree.jsx` supports reorder (drag), suppress (eye toggle), rename, delete, context menu. `featureTreeOps.js` holds the ops. **The skeleton is real.** Gaps to make it true *time-travel*:
  1. **Regression visual state.** When `rollbackIndex < length`, features after the marker must **disappear from the viewport** and render the model as it existed at that step. Wire `rollbackIndex` into the recompute: `recomputeUpTo(index)` re-runs the feature transaction log [0..index] into a *fresh* kernel shape and re-tessellates; bodies beyond the marker are not built. The "solid reverts to wireframe" cue: render the rolled-back tip body with `wireframe:true` or a dashed-edge ghost so the user *sees* they're in the past. **Gap: rollback marker likely jumps tree selection but does not re-run the kernel to the earlier state (verify; if it only reselects, that's the gap).**
  2. **Edit-upstream → ripple recompute.** Double-click an upstream feature → its dashboard reopens with current params; change a value → on ✓, **replay the whole log from that feature forward** (`recomputeFrom(i)`), re-binding downstream features by **persistent topological IDs** (face/edge IDs that survive a rebuild) so Hole1/Fillet1 re-attach to the right faces. This requires the kernel to expose **stable topological naming** (a face/edge GUID stable across recompute) — the classic "topological naming problem." **Gap (kernel + UI): no verified persistent-ID rebind; without it, upstream edits orphan downstream features. Flag for the kernel-parity plan — this is table-stakes for parametric MCAD and is the #1 cause of "rebuild errored."**
  3. **Rebuild error surfacing.** If a downstream feature can't re-bind, mark its tree node with an error glyph (red `△!`) + a "What broke" panel naming the lost reference (NX *Edit Feature → Information*). `FeatureTree` already has selected/suppressed/error CSS states in the orphaned tree — port to the live tree.
  4. **"Insert here" / freeze bar** — let the user *author* at the rollback point (new features insert before the marker), like Creo Insert-Mode. Add a `data-frozen` band below the marker.

---

## 6. Power-user UX — eliminate mouse travel

### 6.1 Radial / marking menus (5px-flick = tool)
- `ActionWheel.jsx` already implements an **8-spoke radial** on right-click in the viewport (`SPOKES` for empty space, `MARK_BODY` for a hovered body), dispatches `forge:menu-action`, with hover-by-angle selection and a dead-zone (<24px). **This is good and on-pattern.** Upgrades to reach Maya/Alias muscle-memory grade:
  1. **Gesture/flick mode (the Maya behavior).** Right-press-**drag** past a small radius (≥8px) should select the spoke in that direction *without drawing the full wheel* — a "mark" — so an expert flicks NE→Extrude in <100ms. Add: on `contextmenu`+drag, if release happens >threshold before the wheel's fade-in timer (~150ms), resolve the spoke purely by angle (8-way quantize) and *suppress* rendering. This is the difference between a novice (sees the menu) and an expert (just flicks). **Gap: wheel always renders; no pre-render flick resolution; dead-zone 24px is large.**
  2. **Context-specific wheels** beyond body/empty: sketch-mode wheel (Line/Circle/Trim/Dimension/Constrain), edge wheel (Fillet/Chamfer), face wheel (Extrude/Offset/Shell). Key the wheel off `selection.kind` + `sketchActive`.
  3. **Submenu spokes** (Maya nested marking menus): a spoke can open a second ring (e.g., Constrain → H/V/Parallel/Perp/Tangent/Equal). Render ring-2 on dwell.
  4. **Custom/learned wheels:** let Archie/SessionMemory promote a user's top ops into the wheel.

### 6.2 Keyboard chaining (single-key tools)
- Define a **command alphabet** (SW/NX `S`-shortcut style): `L`=line, `C`=circle, `R`=rectangle, `A`=arc, `D`=dimension, `E`=extrude, `O`=hole, `F`=fillet, `H`=chamfer, `M`=mirror, `P`=pattern, `T`=trim, `X`=constrain, `Esc`=cancel/finish. Each fires the same `forge:menu-action`/tool-arm as the ribbon. Add a `keymap.js` (single source of truth) consumed by a global `useHotkeys` hook; show the key in every tooltip (`Tooltip hint` already supports it — HUT uses `H/F/1/T/R/Y`). **Gap: HUT has view shortcuts but there is no comprehensive single-key tool-arming chain for modeling/sketch ops.**
- **Chord chaining:** typing `E` then `2` `5` `Enter` should arm Extrude and set depth=25 (NX dynamic input). Route number keys after a tool-arm into the dashboard's primary field.
- **Hotkey HUD:** a `?`-toggled cheat-sheet overlay (there's `misc.kbd` icon usage) so the alphabet is learnable.

### 6.3 Muscle-memory-first principles (apply everywhere)
- Same op in the same place across wheels/ribbon/shortcuts (spatial constancy). Confirmation always ✓ top-right + `Enter`; cancel always ✗ + `Esc`. Right-drag = wheel everywhere. This consistency is what survives hour 9.

---

## 7. Assembly context (faded surrounding assembly)

### 7.1 Target
- When you open/edit a component **in the context of its assembly**, the rest of the assembly goes **semi-transparent / ghosted** so you see spatial fit without clutter (NX *Work Part* opaque, rest dimmed; CATIA in-context; Creo activate-component). Editing a part in-place keeps neighbors visible-but-recessive.

### 7.2 Forge implementation
- Forge has assembly machinery: `assemblyHierarchy.js`, `AssemblyTreePanel.jsx`, `SubAssemblyTreePanel.jsx`, `assemblyBuilder.js`, `assemblyDispatch.js`, `BodyColorsPanel.jsx`, `colorForBody` role-coloring in `Viewport.jsx`. Add an **edit-in-context mode**:
  - `state.activeComponent = handle`. In `Viewport.jsx`, every body where `body.componentId !== activeComponent` renders with `opacity:0.18, depthWrite:false, color:--forge-ink-mute` ("ghost context"); the active component renders fully opaque + selectable. Non-active bodies become **non-pickable** (so you don't accidentally grab the assembly) unless `Alt` is held (NX "select in inactive").
  - **Reference visibility:** keep a thin opaque silhouette/edges on ghosted neighbors so mating faces are still findable (CATIA-style). Drive from existing `EdgePickOverlay`.
  - Tree: bold the active component, dim siblings (mirror the viewport state in `AssemblyTreePanel`).
  - **Gap: no edit-in-context fade; all bodies render equally opaque and equally pickable.**
- **Mates/joints with live DOF** (assembly-level): coincident/concentric/distance/angle mates with a remaining-DOF readout per component (mirrors sketch DOF at the assembly level) — extends the "visual database" model to assemblies.

---

## 8. Snapping engine (OSNAP-grade)

### 8.1 Target
- Midpoint / center / endpoint / intersection / quadrant / perpendicular / tangent / nearest / on-grid snaps, each with a distinct **visual glyph** at the cursor and a priority order (geometric beats grid), with a snap radius in **screen pixels** (resolution-independent). NX selection-bar snap-point toggles; AutoCAD OSNAP is the canon glyph set.

### 8.2 Forge implementation
- `snapEngine.js` is real and good: `SNAP_MODES = [vertex, edgeMid, faceCenter, grid, origin, perpendicular, tangent]`, screen-space scoring (`worldToScreen` reimplements `Vector3.project` to avoid importing THREE), `screenDistPx` cutoff (default 8px), grid is lowest priority and only fires if no geometric snap won, state on `window.__forgeSnap` + localStorage, `forge-snap-change` event for React. `SnapIndicator.jsx` + `SnapStatusChip.jsx` render the active glyph + the toggle popover.
- **Gaps vs OSNAP canon — add these snap kinds + glyphs:**
  | Snap | Glyph | Status |
  |---|---|---|
  | endpoint (vertex) | □ square | have (`vertex`) |
  | midpoint | △ triangle | have (`edgeMid`) |
  | center | ○ circle | partial (`faceCenter`) — add **arc/circle center** |
  | **intersection** | ✕ | **MISSING** — add edge×edge / edge×plane |
  | **quadrant** | ◇ diamond | **MISSING** — add N/E/S/W of circles/arcs |
  | perpendicular | ⊥ | mode exists; needs candidate generation |
  | tangent | ○⌒ | mode exists; needs candidate generation |
  | **nearest / on-edge** | ⟋ | **MISSING** — closest-point-on-edge |
  | **parallel / extension** | ∥ dashed | **MISSING** (NX/AutoCAD inferred lines) |
  | grid | + | have |
  | origin | ⊕ | have |
- **Candidate generation** is the real work: the caller must feed `candidates:[{kind,world,meta}]`. Build a `snapCandidates(scene, plane)` that, per frame near the cursor, harvests endpoints, edge midpoints, arc/circle centers+quadrants, and computes intersections within the snap radius. Cache per-edge feature points; only recompute near-cursor for the 100k regime.
- **Inferencing lines** (NX/AutoCAD): when the cursor aligns with another point's X or Y, draw a dashed alignment line + snap to it. New `AlignmentInference` overlay.
- **Snap glyph upgrade:** `SnapIndicator.jsx` should switch glyph by `kind` (currently likely one dot). Add the glyph map above. **Gap: glyph not differentiated per snap kind.**

---

## 9. Additional enterprise surfaces (NX/CATIA/Creo) Forge must adopt

### 9.1 Selection filters + QuickPick
- **Selection filter** (vertex/edge/face/body/feature/sketch) — a toolbar of filter toggles (NX selection bar; CATIA selection toolbar). Forge has `aisSelection.js` and `selection.kind`; surface a **filter strip** in the status bar / HUT so the user constrains what's pickable. `BodyContextMenu.jsx` has a `edit.filterBody`. **Gap: no always-visible selection-filter strip.**
- **QuickPick (NX):** when the cursor overlaps multiple entities, show a small **disambiguation list** at the cursor (hover each → it highlights in 3D, click to pick). New `QuickPick.jsx` fed by the raycast's *sorted hit list* (the viewport already raycasts faces/edges). **Gap: ambiguous picks resolve to the front hit only; no QuickPick list.**

### 9.2 Measure / query / inspect
- A **Measure** tool (distance/angle/radius/min-distance between two entities) + **Mass Properties** (volume/area/mass/CoG/inertia) + **Geometry info** (face type, radius, area). Forge has `measure.distance` icon, status-bar Vol/Area/Mass, `computeBodyStats`, `caeViz.js`. Add a dedicated `MeasureTool.jsx` with persistent dimension annotations + a CoG triad marker. **Partial: passive readouts exist; no interactive two-pick measure with on-screen annotation.**

### 9.3 Section / clipping views
- `Viewport.jsx` has `SectionGizmo` + `ClippingUpdater` + a `view.section` HUT toggle — **good.** Add: capped section (show the cut face hatched, not hollow), multiple section planes, and a section-as-drawing-view export. **Partial.**

### 9.4 ViewCube / orientation triad
- drei `GizmoHelper` ViewCube is present (bottom-left) + origin XYZ triad. Add named-face click (Front/Top/Right/Iso) snapping + **rolled corner** drag. NX View Triad + ViewCube convention. **Partial: cube exists; verify clickable named faces.**

### 9.5 Expressions / parameters / relations (the parametric backbone)
- NX *Expressions* (formula list, spreadsheet-driven, inter-part/WAVE), Creo *Relations/Parameters*, CATIA *Knowledgeware*. Forge has `DimensionChainsPanel`, `LiveSketchDimsPanel`, and dialog fields accept `=expr` (per the orphaned `SwUxOverlays`, which proves the intent). Build an **Expressions panel**: a named-variable table (`width=100`, `height=width*0.6`, units-aware), referenced by `=expr` in any dialog field, re-evaluated on edit → triggers recompute (ties into §5 ripple). **Gap: no global expressions/parameters table; dialog fields are literal numbers.**

### 9.6 Configurations / family tables / design tables
- SW *Configurations*/*Design Tables*, Creo *Family Tables*, CATIA *Design Tables*. Forge has `ConfigurationsPanel.jsx`. Wire it to drive expression values → a config switch rebuilds the model with a different parameter set (a row of the table). **Partial: panel exists; verify it actually swaps parameter sets and rebuilds.**

### 9.7 Coordinate systems / datums
- WCS-style movable work CSYS (NX `W`), datum planes/axes/points as first-class tree features (Creo/CATIA). Forge has origin triad + named planes; add **user datum features** (offset plane, plane-at-angle, plane-through-3-points) that appear in the tree and become sketch targets. **Gap: only the three world planes; no constructed datum features.**

### 9.8 Heads-up view toolbar + display styles
- `HeadsUpToolbar.jsx` is present (orient/style/gizmo/normal-to) — good. Add display-style dropdown (Shaded / Shaded-with-edges / Wireframe / Hidden-line / X-ray) and per-body appearance. **Partial.**

### 9.9 Document/units + dual-unit readout
- Status bar shows units; add a **units switcher** + dual-unit display (mm / in) and a precision setting (decimals). NX/Creo unit systems. **Gap: units shown but likely not switchable inline.**

---

## 10. Prioritized gap ledger (for the redesign program)

| # | Feature | Forge state | Severity |
|---|---|---|---|
| G1 | **Real-time ghosted preview in dashboards** (§4) | MISSING — commit-only | **P0 — most visible enterprise gap** |
| G2 | **Persistent topological IDs → safe upstream-edit ripple** (§5) | likely MISSING; rollback may only reselect | **P0 — kernel+UI; #1 cause of rebuild errors** |
| G3 | **Modal sketch lockdown + plane prompt + auto normal-to** (§2) | session exists, choreography MISSING | **P0** |
| G4 | **Per-entity sketch DOF coloring (blue/black/red) + on-sketch glyphs** (§3) | single-color, panel-only constraints | **P1** |
| G5 | **Cursor-anchored mini-toolbar + reference collectors** (§4) | left-dock dialog only | **P1** |
| G6 | **Flick/mark mode + sketch/edge/face context wheels** (§6) | 8-spoke wheel exists, always renders | **P1** |
| G7 | **Single-key tool alphabet + chord numeric input** (§6) | HUT view keys only | **P1** |
| G8 | **Edit-in-context assembly fade** (§7) | all bodies equally opaque | **P1** |
| G9 | **Intersection/quadrant/nearest snaps + per-kind glyphs + inference lines** (§8) | strong base, 4 snap kinds missing | **P2** |
| G10 | **Global expressions/parameters table + `=expr` fields** (§9.5) | dialog fields literal | **P1** |
| G11 | **QuickPick disambiguation + selection-filter strip** (§9.1) | front-hit only | **P2** |
| G12 | **Live X/Y/Z cursor readout + clickable snap chips + DOF in status bar** (§1.5) | selection-centroid only | **P2** |
| G13 | **Draggable panel splitters** (§1.4) | binary collapse only | **P2** |
| G14 | **Delete 3 orphaned UI generations** (blue-accent/glyph artefacts) (§1.3) | dead code carried | **P2 — brand-safety** |
| G15 | **Interactive measure w/ annotations, datum features, units switcher, capped sections** (§9) | passive readouts | **P2** |

**Architectural through-line:** G1, G2, and the §5 ripple all require **one kernel capability — a stable feature-replay engine with persistent topological naming and a side-effect-free preview path**. Build that first; it unblocks the three highest-value UX behaviors (live preview, safe upstream edits, true time-travel). Everything else is front-end work atop the already-strong `forge-v4` grid shell, `snapEngine`, `sketchSession`, `ToolParamDialog`, `ActionWheel`, `RollbackBar`, and `FeatureTree` — none of which need to be rebuilt, only completed and wired to that kernel contract.

---

## Sources
- Siemens NX UI / ribbon / Command Finder / Resource Bar / Part Navigator: https://manualzz.com/doc/26898314/nx-interface · https://whole-spec.com/en/cad-tips/nx/shortcuts-ui/ · https://www.prolim.com/nx-extending-the-resource-bar-past-the-command-ribbon-in-nx-9/ · https://community.sw.siemens.com/s/question/0D54O000061xRJRSA2/how-to-change-items-on-the-ribbon-bar
- NX QuickPick / selection filters / WCS: http://www2.me.rochester.edu/courses/ME204/nx_help/en_US/tdocExt/content/k/ui_use_uiu_sel_rad_qck_pck.xml · https://cad-tips.com/siemens-nx/quickpick/ · https://blogs.sw.siemens.com/nx-design/nx-tips-and-tricks-general-selection-filtering-ui/ · https://qintech.wordpress.com/siemens-nx/basic-knowledge-for-new-nx-user/
- NX Expressions / WAVE / inter-part: https://www.mayahtt.com/blog/how-to-drive-nx-expressions-from-a-spreadsheet/ · https://www.prolim.com/accelerate-product-design-with-expressions-in-siemens-nx-cad/ · https://www.ata-e.com/software/training-support/free-resources/assembly-level-part-design-using-interpart-modeling-in-nx/
- CATIA 3DEXPERIENCE Action Pad / Action Bar / Compass / context menu: https://help-3dexperience.aesvietnam.com/English/TdfUserMap/tdf-r-ui-ActionPad.htm · https://resources.rand3d.com/videos-webcasts/catia-3dexperience-2022x-action-bar-overview-and-customization · https://blog.3ds.com/brands/catia/how-to-to-customise-your-action-pad-in-order-to-gain-efficiency-and-flexibility-catia-tutorial-catia-user-community/ · https://www.goengineer.com/blog/catia-v5-to-3dexperience-catia-tips-for-successful-transition
- Creo Dashboard / Mini Toolbar / weak dimensions / constraints: https://support.ptc.com/help/creo/creo_pma/r11.0/usascii/fundamentals/fundamentals/About_the_Dashboard.html · https://resources.ascented.com/creo/creo-parametric-3-0-to-4-0-update-ease-of-use-and-efficiency-with-the-mini-toolbar · https://support.ptc.com/help/creo/creo_pma/r9.0/usascii/part_modeling/sketcher/To_Control_the_Display_of_Dimensions.html · https://support.ptc.com/help/creo/creo_pma/r9.0/usascii/part_modeling/sketcher/About_Sketcher_Constraints.html · https://community.ptc.com/t5/3D-Part-Assembly-Design/How-to-Ensure-a-2D-Sketch-is-Fully-Defined-and-Managing-Weak/td-p/901782
- SolidWorks sketch geometry status / colors: https://help.solidworks.com/2024/English/SolidWorks/sldworks/c_Sketch_Geometry_Status.htm · https://gupta9665.wordpress.com/2011/01/17/colors-symbols-what-they-indicate/ · https://help.solidworks.com/2022/english/SolidWorks/sldworks/c_Sketch_Geometry_Status.htm
- SolidWorks Configurations / Design Tables: https://www.goengineer.com/blog/solidworks-design-tables-made-easy · https://help.solidworks.com/2024/english/solidworks/sldworks/c_Design_Table_Configurations.htm
- Maya marking menus (radial/flick muscle-memory): https://help.autodesk.com/view/MAYAUL/2024/ENU/?guid=GUID-8BA1A3AA-4C44-4779-8B22-0AAE3627E8EB · https://www.artstation.com/vrntech/blog/bAW/marking-menus-in-maya-part-1-the-basics
