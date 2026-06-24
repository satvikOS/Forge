# Forge Enterprise CAD UI/UX Blueprint — Component-by-Component Implementation Spec

**Date:** 2026-06-24
**Pillar:** Enterprise adoption (the #5 / NX·CATIA·Creo UIUX pillar of the 2026-06-21 scope expansion).
**Inputs:** (a) the user's detailed NX/CATIA/Creo walkthrough — four-zone layout (canvas / feature-tree / ribbon / status-snap bar), modal sketch workflow, weak→strong dimensions blue→black, contextual dashboards, history rollback "time-travel," radial/pie menus + keyboard chaining to kill mouse travel; (b) grounded web research on NX/CATIA/Creo/SolidWorks/Maya/Onshape/FreeCAD UX (sources at end); (c) a fresh audit of the live `frontend/src/forge-v4/` shell (file-by-file, line counts cited).
**Relationship to prior docs:** This supersedes and *re-verifies* `docs/SCOPE_2026-06-21/research/enterprise_uiux.md` (gap ledger G1–G15) and its `uiux_program.md`. Several "MISSING" items from 21st have since partially landed (the `'ref'` reference-collector and `'enum'` field types now exist in `ToolParamDialog.jsx`) — those deltas are flagged inline. The three P0 kernel-gated behaviors (live ghost preview, safe upstream-edit ripple, true time-travel) remain open and are re-confirmed against current code here.

---

## 0. North-star and governing mental model

Forge must read, feel, and *respond* like a CATIA/NX-grade seat to a mechanical engineer in hour 9 of a 10-hour shift. The UI is a **visual database over the kernel's BRep + feature graph**, not a toy modeler.

**CAD as a visual database (the through-line):**
- The **feature tree** is the *schema + transaction log* — an ordered, replayable list of mutations.
- The **viewport** is a *materialized view* — the recompute output.
- A **sketch** is a *constraint-satisfaction problem* — a sparse Jacobian solve whose residual DOF drives the blue/black/red coloring.
- A **dashboard ghost** is a *speculative recompute not yet committed* — a what-if query.

Every UI affordance below is a **read** (highlight / measure / tree), a **write** (commit a feature transaction), or a **what-if** (ghosted preview). Designing each surface against that model is what makes a 10-hour shift survivable: low surprise, total reversibility, near-zero mouse travel, and a permanent answer to *"what is the state of my model right now?"*

**The dual-driver rule (Forge-specific, non-negotiable).** Forge's UI is also the surface Archie's CUA *operates*. Every interactive surface below must ship with **two paths to the same reducer action**: a React event path (human flick/click) **and** a `window.__forge*` imperative entry + a `dispatchToolCall` verb (Archie). Never two code paths to the same effect. The CUA-parity harness (`forge-cua-parity.spec.js`) asserts this for every surface — it is the precondition for the ≥0.85-every-dimension CADGenBench run.

---

## 1. What the competitors actually do (grounded reference table)

| Concept | Siemens NX | CATIA / 3DEXPERIENCE | PTC Creo | SolidWorks (de-facto canon) |
|---|---|---|---|---|
| **Top command surface** | **Ribbon** + **Command Finder** (search any *ribbon/menu/toolbar* command, upper-right of window) | **Action Bar** (bottom, customizable "personal toolbox") + per-object **context menu** at cursor suggesting next command; **Compass** (blue circular, top-left) opens apps | **Ribbon** + context-sensitive **Dashboard** for every feature op | CommandManager ribbon |
| **Left model navigator** | **Part Navigator** ("roadmap to the model") inside the **Resource Bar** (tabbed navigators/browser/palettes) | **Specification Tree** (PartBody → Sketch → Pad → …) | **Model Tree** (features in regeneration order) | FeatureManager design tree |
| **Commit affordance** | Dialog **OK / Apply / Cancel** + live **preview** | green-check / red-X in robot-anchored dialog | **green ✓ / red ✗** on Dashboard control area + live preview | green ✓ / red ✗ PropertyManager |
| **Cursor-local commands** | **QuickPick** (cursor-radius disambiguation list; toggle "QuickPick on Delay") + mini dialogs | **Robot/Compass** handle + context menu at cursor | **Mini Toolbar** — pops frequently-used commands *immediately after selection* on the graphics window / Model Tree | context toolbar on selection |
| **Sketch constraint color** | weak/auto vs applied | dimensional + geometric glyphs (ISO) | **weak = gray, strong = blue, locked = own color**; Creo *always* keeps the sketch fully-constrained with weak dims | **the canon — see below** |
| **Geometry state** | under / fully / over | under / iso-constrained / over | under / fully (weak) / over | under / fully / over |
| **Coordinate readout** | **WCS** XC/YC/ZC (`W` toggles) | Compass + axis system | csys + dashboard message area | origin triad |
| **Param engine** | **Expressions** (formula list, spreadsheet-driven, inter-part **WAVE** links) | **Knowledgeware** formulas/rules/params | **Relations** + **Parameters** + **Family Tables** | Equations + Configurations / Design Tables |
| **Rollback / time-travel** | drag a *current-feature* marker in the Part Navigator; "playback" until a Boolean, edit mid-playback, continue | activate component / in-context | **Insert Here** (insert mode) | **rollback bar** drag |
| **In-context edit** | **Work Part** opaque, rest dimmed | in-context, neighbors recessive | activate-component | edit-in-context |

### 1.1 SolidWorks sketch color canon (Forge must match exactly)

This is the single most learnable adoption signal in MCAD and is industry-standard:

| State | Color | Meaning |
|---|---|---|
| **Under-defined** | **Blue** | entity has free DOF — it will drag |
| **Fully-defined** | **Black** | DOF = 0, locked, will not drag |
| **Over-defined** | **Red** | conflicting / redundant constraints (error) |
| **Dangling** | **Golden-brown / yellow** | a reference went missing |
| **No solution found** | **Red** (variant) | solver failed |
| **Redundant / can't-be-modified** | **Gray** | extra relation; cannot edit |

The *goal* of every sketch is to reach **fully-defined (black)**. (Sources: SolidWorks Sketch Geometry Status; Boxer's SW blog.)

### 1.2 Creo weak/strong dimension behavior (the modal-sketch nuance)

Creo *always* keeps a sketch fully constrained by auto-attaching **weak dimensions** (displayed gray). A weak dim is provisional: the moment the user types a **strong** dimension over the same DOF, it overwrites the weak one. Display is controlled via *Setup → Show → (Weak) Dimensions Display*. This is the behavior Forge's auto-weak inference layer (§4.1) must reproduce.

### 1.3 Maya marking menus (the muscle-memory ceiling Forge's wheel must reach)

Marking menus exist *only for the duration of a hotkey/button press* and are drawn **at the cursor** — they "bring the interface to the mouse cursor, the focus point of every 3D app." They are muscle-memory based: once learned, an item is activated **by a flick in the right direction**, "so fast the entire menu won't even display." Items are placed at equal radial distances and are effectively huge targets — *"it doesn't matter how far you drag or if you hit the item exactly."* The expert experience is "like playing a musical instrument." (Source: Autodesk Maya marking-menu docs; vrntech marking-menu series.)

### 1.4 Pie-menu HCI grounding (why the radial layer is worth building)

Empirical HCI: pie menus reduce *target seek time* by fixing the distance factor and maximizing target size in **Fitts's Law** — effective target distance ~10px vs 13–200px for linear menus; the seminal 1988 study measured **~15% faster selection with fewer errors**. The known caveat: pie menus are *harder to learn* than linear menus, so the gain only materializes once familiar — which is precisely why Forge ships **both** a discoverable hover-wheel (novice) and a no-render flick mode (expert), keyed to the same spokes. (Sources: NN/g; Don Hopkins pie-menu retrospective; pie-menu HCI surveys.)

### 1.5 Topological naming — the load-bearing kernel risk for §5

The community's #1 parametric gripe: a downstream feature references a face/edge by an internal ID; edit an *upstream* feature and the regenerated geometry gets a *new* ID, the stale reference breaks, and the error cascades down the whole tree — "a single variable edit at the top can break dozens of features." FreeCAD 1.0 / Ondsel substantially mitigated it with a persistent-naming algorithm; it is "an inherent side effect of parametric modeling." Forge's time-travel rollback (§5) and upstream-edit ripple are *only* safe if the kernel exposes **stable topological IDs (face/edge GUIDs that survive recompute)**. This is the single kernel capability that unblocks the three highest-value UX behaviors. (Sources: Ondsel toponaming blog; FreeCAD docs/issue #17041; libdrone.)

### 1.6 Onshape in-context transparency (the assembly-fade reference)

When modeling in-context, **unselected parts cannot be edited and appear transparent**, with surrounding parts shown transparently in their true spatial relationship — "a powerful way to design top-down." LOD graphics were refined specifically to support transparent parts in assemblies. This is the exact behavior Forge's edit-in-context fade (§7) reproduces. (Source: Onshape "Modeling In-Context" help; Onshape changelog.)

---

## 2. Forge current-state audit (verified against `frontend/src/forge-v4/`)

The shell is genuinely strong and need not be rebuilt — only completed and wired. Verified files (with line counts):

| Concern | File(s) | State |
|---|---|---|
| Four-zone CSS-grid shell + reflow-not-float Archie dock | `ForgeShellV4.jsx` (3553) | **Solid.** Exposes the full `window.__forge*` imperative surface + `installForgeRunner()` → `window.__forgeEngine.dispatchToolCall` (Archie bridge). `sketchActive` is a bare `useState(false)` (line 204) — no state machine. |
| Contextual tabbed ribbon | `Toolbar.jsx` (720) | **Real ribbon.** `RIBBON[wb] = [{id,label,groups:[{label,tools:[{id,label,icon,hint,primary?,flyout?[]}]}]}]`. Has `primary` hero buttons, `flyout` split-buttons, overflow handling (per header comment). **No `context:` tag → no sketch lockdown.** |
| Feature tree + ops | `FeatureTree.jsx` (214), `featureTreeOps.js` | reorder/suppress/rename/delete + context menu present. |
| Rollback scrubber | `RollbackBar.jsx` (95) | **Visual only.** `onClick={() => onRollback?.(i)}` — no `recomputeUpTo`/`recomputeFrom`; jumps selection, does **not** re-run the kernel to the earlier state. Playhead at `activeIndex*26+12`. |
| Sketch session | `sketchSession.js` (366) | session model + `frameFromSpec` + `deriveFacePlane` + `dof()` *estimate* + `window.forge.sketcher.*`. **Choreography (plane prompt / lockdown / auto normal-to) absent.** |
| Schema-driven dashboards | `ToolParamDialog.jsx` (252), `toolSchemas.js` | 260px left dock + Confirmation Corner ✓/✗ (Enter=⌘↵ confirm, Esc cancel). **Field types now: number / vec3 / bool / enum / `ref` (reference collector).** `'ref'` writes `{kind, ids}` from `selection` — so the §4.4-21st collector gap is **partially closed**. **No ghost/preview path** (grep `ghost|preview|opacity` → 0 hits): dialog dispatches **only on commit**. |
| Radial menu | `ActionWheel.jsx` (142) | 8-spoke wheel on viewport right-click; `SPOKES` (empty) + `MARK_BODY` (hovered body). Hover-by-nearest-spoke, 24px dead-zone, dispatches `forge:menu-action`. **Always renders the wheel; no flick/mark mode; no sketch/edge/face context wheels; no submenu rings.** |
| Snapping | `snapEngine.js` (275), `SnapIndicator.jsx`, `SnapStatusChip.jsx` | `SNAP_MODES=[vertex,edgeMid,faceCenter,grid,origin,perpendicular,tangent]`; screen-space scoring; `window.__forgeSnap` + localStorage. **Missing: intersection / quadrant / nearest / parallel-extension; glyph not differentiated per kind.** |
| Command palette | `CommandPalette.jsx` (852) | exists; not yet the canonical NX Command-Finder over the full RIBBON tree (no "reveal in ribbon" flash). |
| Status bar | `StatusBar.jsx` (297) | three zones (mode+selection / Vol·Area·Mass / units·snap·grid). **No live cursor X/Y/Z; snap chip not click-to-toggle; no DOF cell.** |
| Selection filter | `SelectionFilterStrip.jsx` (421), `selectionFilterApi.js` | exists; surface as always-visible strip. |
| Expressions | `EquationManager.jsx` (393), `paramVars.js` | exists; wire as the global named-variable table feeding `=expr` fields. |

**Net delta vs the 2026-06-21 ledger:** the *reference collector* (G5 half) has landed in the dialog schema; everything else in the ledger is re-confirmed open. The three P0 kernel-gated behaviors are unchanged: **no ghost preview, no kernel-backed rollback regression, no persistent-ID upstream ripple.**

---

## 3. The four-zone workspace (the frame)

### 3.1 Reference layout (target geometry)

```
┌──────────── TOP BAR 40px (app · file · ⌘K global search/Command-Finder · Archie) ───────────────┐
├──────────── QAT 32px (quick-access + ribbon TAB strip) ──────────────────────────────────────────┤
│ WB   │  RIBBON 92px (contextual: Sketch│Features│Pattern│Evaluate│Drawing — dense, primary+flyout) │
│ RAIL │───────────────────────────────────────────────────────────────────────────────────────────│
│ 72px │  ┌── LEFT 300px (drag) ─┐                                          ┌── RIGHT 340px (drag) ─┐ │
│ disc │  │ FEATURE TREE (DNA)   │        OLED-BLACK 3D CANVAS (#000)        │ PROPERTY / DASHBOARD   │ │
│ tabs │  │  Sketch1             │  HUT(top-center) · ViewCube(corner)       │ collectors + ghost     │ │
│      │  │  └ Extrude1          │  Snap glyphs · ghost preview · triad      │ + RollbackBar (gutter) │ │
│      │  │    Hole1 · Fillet1   │                                           │                        │ │
│      │  └──────────────────────┘                                          └────────────────────────┘ │
├──────────── STATUS / SNAP BAR 26px ───────────────────────────────────────────────────────────────┤
│ LEFT: mode · selection   CENTER: X/Y/Z cursor · Vol·Area·Mass   RIGHT: units · snap chips · DOF     │
├──────────── ARCHIE COMMAND BAR 52px (always-on CUA prompt) ────────────────────────────────────────┘
```

### 3.2 Component contract

| Zone | Forge component | Action |
|---|---|---|
| TopBar | `TopBar.jsx` | add **⌘K Command-Finder** entry; show active units + doc name |
| Ribbon | `Toolbar.jsx` | tag every tool `context:'sketch'\|'feature'\|'always'`; render `flyout` galleries; verify overflow chevron |
| WB rail | `WorkbenchRail.jsx` | dims during sketch lockdown |
| Feature tree | `FeatureTree.jsx` | port error/suppressed CSS states; rollback marker (§5) |
| Canvas | `Viewport.jsx` | keep OLED-black `#000`; **fix dead theme branch** (`getBgColor` tests `'contrast'`, shell sets `'high-contrast'` → HC bg never applies; one-line fix); host ghost body, plane ghosts, sketch coloring, snap glyphs |
| Right panel | `RightPanel.jsx` | dashboard dock + RollbackBar gutter; **add draggable splitter** (binary collapse-to-36px today) |
| Status bar | `StatusBar.jsx` | cursor X/Y/Z + clickable snap chips + DOF cell (§3.4) |
| Archie bar | `CommandBar.jsx` | unchanged; the always-on CUA prompt |

**Splitter (G13):** new `PanelSplitter.jsx` — 4px hit-target, `onPointerDown` writes `--forge-left-w` / `--forge-right-w` CSS vars (clamp left 240–420px, right 240–560px), persists to localStorage, commits one reducer action on pointer-up. Do **not** drive it from React viewport state (per the window-API-no-setState rule — a re-render race deletes the `window.__forge*` functions).

---

## 4. Modal sketch sandbox (highest adoption leverage — P0)

Entering a sketch must make the whole app *focus*: the world dims, the plane snaps flat, non-sketch tools gray out, the camera animates normal-to, and the app asks *"where do you want to draw?"*

### 4.1 State machine — `SKETCH_MODE` (extends the `WORKSPACE` reducer)

```
IDLE
  └─(tool: sketch.new)──→ AWAIT_PLANE        // "Where do you want to draw?" overlay
        ├ pick XY/YZ/XZ plane ghost ─┐
        ├ pick a planar face ────────┤──→ ENTER_SKETCH(frame)
        └ Esc → IDLE
ENTER_SKETCH(frame):
   • session = sketchSession.openSession(frame)
   • __forgeOrientNormalTo(frame)            // camera lerp, easeInOutQuad ~350ms
   • dispatch SET_SKETCH_ACTIVE(frame)       // replaces the bare setSketchActive(true)
   • ribbon lockdown  (set data-sketch="true" on forge-app)
   • window.__forgeSketchPlane = frame       // snapEngine + viewport read it
SKETCH_MODE:
   draw addLine/addRect/addCircle/addArc/addSpline + constraints (+ auto-weak, §6)
        ├ Finish (✓ / E)  → solveSession → store profile handle → IDLE, ribbon restored
        └ Cancel (✗ / Esc) → destroySession → IDLE
```

`sketchSession.js` already implements the session model, `frameFromSpec`, `deriveFacePlane` (auto-picks the top planar face), `entityWorldGeometry` (2D→3D lift), `dof()`, and `window.forge.sketcher.*`. **What's missing is the modal choreography around it.**

### 4.2 `SketchPlanePrompt.jsx` — "Where do you want to draw?"

Portal overlay, shown only in `AWAIT_PLANE`. Renders three semi-transparent **plane ghosts** in the viewport at XY/YZ/XZ (axis-color: **XY → green, YZ → red-orange, XZ → blue**, ~12% opacity, edge-highlight to ~60% on hover, **Front/Top/Right** label near the cursor — Creo convention) + a hint pill *"Select a plane or planar face."* Driven by raycast against plane quads + `deriveFacePlane(bodyHandle, faceId)` for faces. Gated by `window.__forgeSketchPickMode`.
- **CUA path:** Archie emits `sketch.new {plane:'XY' | faceRef}` → bridge sets the frame directly and skips the human prompt. Parity test: both reach `ENTER_SKETCH`. **Gap: today the plane defaults silently to XY.**

### 4.3 Ribbon lockdown (non-essential tools gray out)

On `ENTER_SKETCH`, set `data-sketch="true"` on `forge-app`. Tag every ribbon tool `context`. CSS:
```css
[data-sketch="true"] .forge-ribbon-btn:not([data-ctx="sketch"]) { opacity:.35; pointer-events:none; }
```
Only the **Sketch** tab + Finish/Cancel + view/nav stay live; the workbench rail dims (can't switch discipline mid-sketch); the right panel swaps to `SketchConstraintsToolbar.jsx`. **Gap: ribbon never locks down today.**

### 4.4 Auto normal-to + smooth snap-to-2D

`__forgeOrientNormalTo(frame)` lerps the camera quaternion to look down `-frame.normal` with `up = frame.v`, reusing the `CameraCenterEffect` / `__forgeFitToBounds` easing already in `Viewport.jsx`. The per-face `view.normalTo` HUT button already does this for a selected face — generalize it and auto-fire on sketch entry. **Gap: normal-to exists as a button, not auto-fired.**

### 4.5 Sketch-mode context wheel

Key `ActionWheel.jsx` off `sketchActive`: spokes Line / Circle / Trim / Dimension / Constrain / Finish (full flick mode + nested rings land in §8).

---

## 5. History rollback "time-travel" + the kernel replay engine (P0)

This is the literal answer to community gripes #3/#4 and the topological-naming risk (§1.5) — **table-stakes for parametric MCAD.**

### 5.1 Kernel contract (declared here, owned by the kernel-parity program)

1. `recomputeUpTo(index)` — replay the feature transaction log `[0..index]` into a *fresh* kernel shape and re-tessellate; bodies beyond the marker are **not built**.
2. `recomputeFrom(i)` — after an upstream edit, replay forward, **re-binding downstream features by persistent topological IDs** (face/edge GUIDs stable across recompute). This is the topological-naming solve (§1.5). Without it, upstream edits orphan downstream features — the #1 cause of "rebuild errored."
3. `solve` returning **per-point residual DOF + per-entity status** (feeds §6).
4. `preview.<op>(args) → {positions, indices}` side-effect-free (feeds §7).

### 5.2 Regression visual state — `RollbackBar.jsx`

When `rollbackIndex < length`, wire `onRollback(i)` to call `recomputeUpTo(i)` so downstream features **disappear from the viewport**; render the rolled-back tip body `wireframe:true` / dashed-edge ghost so the user *sees* they are in the past (the NX/SW "solid reverts to wireframe" cue). **Gap: today `onRollback` only re-selects; it does not re-run the kernel.**

### 5.3 Edit-upstream → ripple recompute

Double-click an upstream feature → its dashboard reopens with current params (and the §7 live ghost) → change a value → on ✓, `recomputeFrom(i)` replays the log forward, re-binding Hole1/Fillet1 to the correct faces via persistent IDs. **Gap (kernel + UI).**

### 5.4 Rebuild-error surfacing

If a downstream feature can't re-bind, mark its tree node with a **red △!** glyph + a *"What broke"* panel naming the lost reference (NX *Edit Feature → Information*). Port the selected/suppressed/**error** CSS states already present in the orphaned tree into the live `FeatureTree.jsx`.

### 5.5 "Insert Here" / freeze band (Creo Insert-Mode)

Let the user *author* at the rollback point — new features insert before the marker. Add a `data-frozen` band below the marker.

### 5.6 NX "playback" parity

NX runs a *playback* of the feature log and lets you edit mid-stream, then continue (it pauses at Booleans). Forge's `recomputeUpTo` + double-click-edit + push-marker-down replicates this with a single mental model.

---

## 6. Geometric constraints + color-coded state (the adoption signal — P1)

### 6.1 Auto weak / "light-blue" dimensions (Creo behavior)

After each entity add, run an auto-constrain pass `inferConstraints(session, newEntity)` that proposes H/V/coincident/equal within tolerance, adds them with a **`weak:true`** flag, and re-solves — keeping the sketch fully constrained at all times (Creo). A user-typed **strong** dimension overwrites the weak one over the same DOF. Extend `sketchSession.addConstraint` with the `weak` flag. **Gap: no auto-weak layer; `dof()` is a heuristic.**

### 6.2 Per-entity color (THE signal — SW canon §1.1)

Each lifted entity in `entityWorldGeometry` carries an `entityState` derived from the solver's per-entity status; material color = a token:

| State | Token | Color |
|---|---|---|
| under-defined | `--forge-sketch-under` | **blue** (draggable) |
| fully-defined | `--forge-sketch-full` | **black/ink** (locked) |
| over-defined | `--forge-sketch-over` | **red** (conflict) |
| dangling | `--forge-sketch-dangling` | **brown/yellow** |
| redundant | `--forge-sketch-redundant` | **gray** |

These five tokens are the **only sanctioned chromatic break** in Forge's monochrome brand — acceptable because they are *information-bearing*, exactly like a database row-status color (document them as such in `tokens.css`). **Gap: sketch renders single-color.**

### 6.3 On-sketch constraint glyphs — `ConstraintGlyphs.jsx`

Read `session.constraints`, project each anchor to screen via `snapEngine.worldToScreen`, draw clickable glyph chips on the geometry: `═` parallel · `⊥` perpendicular · `○` concentric · `=` equal · `⌒` tangent · `⌷` horizontal · `▯` vertical · `△` symmetric · lock for fixed. Click → select/delete the constraint. Add missing kinds to `sketchSession.KIND_BY_NAME`: Collinear, Diameter, Point-on-entity, Equal-radius, Symmetry-about-axis. **Gap: constraints are panel-listed (`SketchConstraintsExtendedPanel.jsx`), not glyph-drawn on geometry.**

### 6.4 DOF counter

Feed `SketchStateBadge.jsx` **solver-true** DOF (not the heuristic). Clicking the badge **highlights the still-free entities** (SW drag-test). Mirror DOF into the status-bar right zone (`DofCell`).

---

## 7. Contextual dashboards + real-time ghosted preview (most visible enterprise gap — P0)

### 7.1 Target (NX dialog / Creo Dashboard / CATIA robot-dialog)

Pick a face/sketch, invoke Extrude → a **dashboard** demands values (depth / direction / draft / add-cut-intersect) with **OK·Apply·Cancel** (NX) or **✓·✗** (Creo/CATIA) and a **live semi-transparent ghost** of the result that updates *as you type/drag*. Creo's Dashboard = *dialog bar + tabbed panels + message area + control area* (with green ✓ / red ✗ / pause-resume). Creo's **Mini Toolbar** pops frequently-used commands *immediately on selection* at the entity.

### 7.2 Live ghost preview — `ToolParamDialog.jsx` + `Viewport.jsx` (THE gap)

`ToolParamDialog.jsx` is already the universal schema-driven dashboard (260px dock + Confirmation Corner ✓/✗, field types number/vec3/bool/enum/`ref`). Keep it. **Add the speculative-recompute path:**
- On every field change (debounce ~120ms), call the kernel **dry-run** `window.forge.preview.<op>(args)` → `{positions, indices}` (no feature committed, no tree mutation).
- Render a `GhostBody` in `Viewport.jsx`: `meshStandardMaterial` `transparent opacity:0.45 depthWrite:false`, accent-tinted edges, no shadows. A **depth drag-arrow** on the ghost two-way-binds back into the dialog field.
- On ✓ → discard ghost, dispatch the real op (existing path), the new tree node appends and **flashes** (scroll-to + 1-frame highlight so cause→effect is visible). On ✗ → discard ghost, no tree change.
- **CUA path:** the bridge gains `op.preview(args)` returning the tessellation + a **validity flag** so Archie can *check before committing* — a direct lever on the CADGenBench **Invalidity Ratio**.

**Gap: NO live ghost preview — the most visible missing enterprise behavior.**

### 7.3 Cursor-anchored mini-toolbar — `MiniToolbar.jsx` (Creo)

On a face/edge/vertex pick, pop a 1-row toolbar *at `event.clientX/Y`* with the 3–5 ops valid for that entity, from an `opsForSelection(selection)` map:
- face → Extrude / Hole / Shell / Offset
- edge → Fillet / Chamfer
- vertex → Dimension

Selecting an op opens its dashboard pre-seeded with that reference. **Gap: dialog opens as a fixed left dock; no entity-contextual mini toolbar.**

### 7.4 Reference collectors (NX/Creo typed pickers) — **partially landed**

Dashboards need typed **collector** fields ("First reference," "Direction," "Up-to face"). `ToolParamDialog.jsx` now has a `'ref'` field type that writes `{kind, ids}` from the current `selection` — the skeleton exists. **Remaining work:** (1) a `{filter:'face'|'edge'|'plane', count}` constraint on the collector; (2) an *active-collector* highlight that routes the *next* viewport pick into that specific collector (not just "use current selection"); (3) a status-bar prompt *"Select a face for direction."* **Partial: ref collector exists; multi-collector routing + filters missing.**

### 7.5 Commit → tree flash

Already wired (op dispatch appends a node). Add the ✓ animation: scroll-to the new node + 1-frame highlight.

---

## 8. Power-user UX — eliminate mouse travel (P1)

### 8.1 Flick/mark mode + context wheels — `ActionWheel.jsx`

Current: an 8-spoke wheel that **always renders**, 24px dead-zone, two static spoke sets. Upgrades to reach Maya muscle-memory grade (§1.3):
1. **Flick/mark mode (the expert behavior).** On `contextmenu`+drag, if release happens past a small radius (≥8px) *before* the wheel's fade-in timer (~150ms), resolve the spoke by **8-way angle quantize** and **suppress rendering** entirely — the expert flicks NE→Extrude in <100ms and never sees the menu. Shrink the 24px dead-zone to ~8px. (HCI: this is where the Fitts's-law gain in §1.4 actually lands.)
2. **Context-specific wheels** keyed off `selection.kind` + `sketchActive`: sketch wheel (Line/Circle/Trim/Dimension/Constrain/Finish), edge wheel (Fillet/Chamfer), face wheel (Extrude/Offset/Shell) — in addition to today's `SPOKES`/`MARK_BODY`.
3. **Submenu spokes (Maya nested rings):** a spoke can open a second ring on dwell (e.g., Constrain → H/V/∥/⊥/Tangent/Equal).
4. **Learned wheels:** Archie/SessionMemory promotes a user's top ops into the wheel.

### 8.2 Single-key tool alphabet + chord numeric input

Define a command alphabet (SW/NX `S`-shortcut style) as **one source of truth** `keymap.js` — consumed by `useHotkeys`, surfaced in every `Tooltip hint`, and read by the palette and the wheels:

```
L line · C circle · R rect · A arc · D dimension
E extrude · O hole · F fillet · H chamfer · M mirror · P pattern · T trim
X constrain · Esc cancel/finish · ? toggle cheat-sheet HUD
```
Each key fires the same `forge:menu-action` / tool-arm as the ribbon. **Chord chaining (NX dynamic input):** `E` then `2 5 Enter` arms Extrude and sets depth=25 by routing number keys into the dashboard's primary field. The ribbon `hint` field already carries single-key hints (`L`,`D`,`E`,`F`,`H`) — promote them into a real global handler. **Gap: HUT has view keys only; no comprehensive tool-arming alphabet.**
- **CUA path:** the alphabet maps 1:1 to existing `dispatchToolCall` verbs; the parity harness asserts `key == its tool-call`.

### 8.3 Muscle-memory-first invariants (apply everywhere)

Same op in the same place across wheel / ribbon / shortcut (spatial constancy). Confirm always ✓ top-right + `Enter`; cancel always ✗ + `Esc`. Right-drag = wheel everywhere. This consistency is what survives hour 9.

---

## 9. Assembly context — faded surrounding assembly (P1)

### 9.1 Target (NX Work-Part / Onshape in-context §1.6)

Editing a component *in the context of its assembly* ghosts the rest **semi-transparent** so you see spatial fit without clutter; neighbors are visible-but-recessive and **non-pickable** so you don't grab the assembly by accident.

### 9.2 Forge implementation — `Viewport.jsx` + `AssemblyTreePanel.jsx`

`state.activeComponent = handle`. Bodies where `body.componentId !== activeComponent` render `opacity:0.18, depthWrite:false, color:--forge-ink-mute` and become **non-pickable unless `Alt` is held** (NX "select in inactive"); the active component renders fully opaque + selectable. Keep a thin opaque **silhouette/edges** on ghosted neighbors (drive from `EdgePickOverlay`) so mating faces stay findable (CATIA/Onshape). Mirror the state in `AssemblyTreePanel.jsx` (bold active, dim siblings). Reuses `assemblyHierarchy.js`, `assemblyDispatch.js`, `colorForBody`/`BodyColorsPanel.jsx`. Add **assembly-level mates** (coincident/concentric/distance/angle) with a remaining-DOF readout per component — extends the §6 sketch-DOF model to the assembly level. **Gap: all bodies render equally opaque and equally pickable.**

---

## 10. Snapping engine — OSNAP-grade (P2)

`snapEngine.js` is real and good (screen-space scoring, `window.__forgeSnap`, localStorage, change event). **Add the missing snap kinds + per-kind glyphs** (AutoCAD OSNAP canon):

| Snap | Glyph | Status |
|---|---|---|
| endpoint (vertex) | □ | have (`vertex`) |
| midpoint | △ | have (`edgeMid`) |
| center | ○ | partial (`faceCenter`) — add arc/circle center |
| **intersection** | ✕ | **MISSING** — edge×edge / edge×plane |
| **quadrant** | ◇ | **MISSING** — N/E/S/W of arcs/circles |
| perpendicular | ⊥ | mode exists; needs candidate gen |
| tangent | ⌒ | mode exists; needs candidate gen |
| **nearest / on-edge** | ⟋ | **MISSING** — closest-point-on-edge |
| **parallel / extension** | ∥ dashed | **MISSING** — NX/AutoCAD inference lines |
| grid | + | have |
| origin | ⊕ | have |

The real work is **candidate generation**: `snapCandidates(scene, plane)` harvests endpoints, edge midpoints, arc/circle centers+quadrants, and intersections within the snap radius — cached per-edge, recomputed near-cursor only (100k regime). Add an `AlignmentInference` overlay: when the cursor aligns with another point's X or Y, draw a dashed alignment line and snap to it. `SnapIndicator.jsx` switches glyph by `kind`. **Gap: glyph not differentiated; 4 snap kinds missing.**

---

## 11. Additional enterprise surfaces Forge must adopt

| # | Surface | Reference | Forge file(s) | State |
|---|---|---|---|---|
| 11.1 | **QuickPick disambiguation** (cursor-anchored list when picks overlap; hover→3D highlight, click→pick) | NX QuickPick | new `QuickPick.jsx` over the raycast's *sorted hit list* | **Gap: front-hit only** |
| 11.2 | **Selection-filter strip** (vertex/edge/face/body/feature/sketch toggles, always visible) | NX selection bar | `SelectionFilterStrip.jsx` (421) exists | **Surface it in status bar/HUT** |
| 11.3 | **Command-Finder / ⌘K global search** over the full RIBBON tree + verbs, runs the action and **flashes the source ribbon button** ("reveal in ribbon") | NX Command Finder | `CommandPalette.jsx` (852) | **Wire to RIBBON map + reveal-flash** |
| 11.4 | **Interactive measure** (two-pick distance/angle/radius/min-distance) + persistent annotations + CoG triad | NX/Creo measure | `MeasureToolPanel.jsx`, `DimensionTool.jsx`, `computeBodyStats` | **Partial: passive readouts only** |
| 11.5 | **Expressions / parameters table** (`width=100`, `height=width*0.6`, units-aware; any field accepts `=expr`; edit → ripple recompute §5) | NX Expressions/WAVE · Creo Relations · CATIA Knowledgeware | `EquationManager.jsx` (393), `paramVars.js` | **Wire as global var table + `=expr` fields** |
| 11.6 | **Configurations / family tables** (a table row swaps the parameter set and rebuilds) | SW Design Tables · Creo Family Tables | `ConfigurationsPanel.jsx` | **Verify it swaps params + rebuilds** |
| 11.7 | **Datum features** (offset plane, plane-at-angle, plane-through-3-points) as first-class tree nodes that become sketch targets | Creo/CATIA datums · NX WCS (`W`) | `kernelDispatch.js` + tree | **Gap: only 3 world planes** |
| 11.8 | **Display-style dropdown** (Shaded / Shaded+edges / Wireframe / Hidden-line / X-ray) + capped sections (hatched cut face, multiple planes) | NX/Creo display styles | `HeadsUpToolbar.jsx`, `SectionPlanePanel.jsx` | **Partial** |
| 11.9 | **ViewCube named-face click** (Front/Top/Right/Iso snap + rolled-corner drag) | NX View Triad / ViewCube | drei `GizmoHelper`, `NavSphere.jsx` | **Verify clickable named faces** |
| 11.10 | **Units switcher + dual-unit (mm/in) + precision** inline | NX/Creo unit systems | `StatusBar.jsx` | **Gap: shown, not switchable** |
| 11.11 | **Live cursor X/Y/Z + clickable snap chips + DOF cell** in the status bar | NX selection-bar coords/snaps | `StatusBar.jsx` | **Gap: selection-centroid only** |

---

## 12. Prioritized gap ledger (the redesign program)

| # | Feature | Current state | Severity | Kernel-gated? |
|---|---|---|---|---|
| G1 | **Real-time ghosted preview in dashboards** (§7.2) | MISSING — commit-only | **P0 — most visible enterprise gap** | yes (`preview.<op>`) |
| G2 | **Persistent topological IDs → safe upstream-edit ripple** (§5.3) | MISSING — rollback only re-selects | **P0 — #1 cause of rebuild errors** | yes (`recomputeFrom` + GUIDs) |
| G3 | **Modal sketch lockdown + plane prompt + auto normal-to** (§4) | session exists; choreography MISSING | **P0** | no |
| G4 | **Per-entity sketch DOF coloring (blue/black/red) + glyphs** (§6) | single-color, panel-only | **P1** | light (solver residuals) |
| G5 | **Cursor-anchored mini-toolbar + collector routing/filters** (§7.3–7.4) | ref collector landed; mini-toolbar + multi-collector routing MISSING | **P1** | no |
| G6 | **Flick/mark mode + sketch/edge/face context wheels** (§8.1) | 8-spoke wheel, always renders | **P1** | no |
| G7 | **Single-key tool alphabet + chord numeric input** (§8.2) | view keys only | **P1** | no |
| G8 | **Edit-in-context assembly fade** (§9) | all bodies equally opaque/pickable | **P1** | no |
| G9 | **Kernel-backed rollback regression state** (§5.2) | visual-only marker | **P0** | yes (`recomputeUpTo`) |
| G10 | **Global expressions/parameters table + `=expr` fields** (§11.5) | EquationManager exists, unwired | **P1** | no (ties to G2 ripple) |
| G11 | **Intersection/quadrant/nearest snaps + per-kind glyphs + inference lines** (§10) | strong base, 4 kinds missing | **P2** | no |
| G12 | **QuickPick + selection-filter strip surfaced** (§11.1–11.2) | front-hit only; strip unwired | **P2** | no |
| G13 | **Live cursor X/Y/Z + clickable snap chips + DOF cell** (§11.11) | selection-centroid only | **P2** | no |
| G14 | **Draggable panel splitters** (§3.2) | binary collapse only | **P2** | no |
| G15 | **Command-Finder over RIBBON + flyout galleries + reveal-flash** (§11.3) | palette exists, not canonical | **P2** | no |
| G16 | **Measure w/ annotations, datum features, units switcher, capped sections, ViewCube faces** (§11) | passive readouts | **P2** | no |

**Architectural through-line:** G1, G2, and G9 all require **one kernel capability** — a stable feature-replay engine with persistent topological naming and a side-effect-free preview path. **Build that first; it unblocks the three highest-value UX behaviors.** Everything else is pure front-end atop the already-strong `forge-v4` grid shell, `snapEngine`, `sketchSession`, `ToolParamDialog`, `ActionWheel`, `RollbackBar`, and `FeatureTree` — none need rebuilding, only completing and wiring.

---

## 13. Phased implementation plan (dependency-ordered, against forge-v4)

| Phase | Theme | Gates on | Headline deliverables | Maps to |
|---|---|---|---|---|
| **U0** | Foundations & brand-safety | nothing | 5 sketch-state tokens; fix dead theme branch; `PanelSplitter.jsx`; `keymap.js` single source; **CUA-parity harness** `forge-cua-parity.spec.js`; purge any orphaned blue-accent UI generations | G14 |
| **U1** | Modal sketch sandbox | U0 | `SKETCH_MODE` reducer; `SketchPlanePrompt.jsx`; ribbon `context` lockdown; `__forgeOrientNormalTo`; sketch wheel | G3 |
| **U2** | Constraint truth + color | U1 + solver residuals | solver-true DOF; auto-weak inference; per-entity blue/black/red; `ConstraintGlyphs.jsx`; DOF cell | G4 |
| **U3** | Dashboards + ghost preview | **kernel `preview.<op>`** | live `GhostBody`; depth drag-arrow two-way bind; `MiniToolbar.jsx`; collector routing+filters; commit→tree flash | G1, G5 |
| **U4** | History time-travel + expressions | **kernel replay + persistent topo-ID** | `recomputeUpTo` regression state; `recomputeFrom` ripple; red △! error surfacing; Insert-Here; `EquationManager` wired | G2, G9, G10 |
| **U5** | Power-user + assembly + snapping + query | U1 | flick/mark wheels; single-key alphabet + chord; assembly fade; OSNAP snaps; QuickPick; filter strip; Command-Finder; cursor readout; measure; datums; ViewCube; units | G6, G7, G8, G11–G16 |

**Acceptance per phase:** HEADED Playwright at **≥5 named camera angles** (front/top/right/iso/close) **AND** a CUA-parity assertion that the same surface is reachable via `window.__forgeEngine.dispatchToolCall({name,args})` with the identical reducer effect. CI green on all platforms between phases (single-workflow rule).

**Definition of done:** all G1–G16 closed; **Archie can operate 100% of the redesigned UI** (the precondition for the ≥0.85-every-dimension CADGenBench run); the only chromatic break is the five information-bearing sketch-state tokens; a 10-case edit-stability regression suite (U4) green.

---

## 14. Forge / Archie implications (the pillar payoff)

1. **Enterprise adoption is a *response-quality* problem, not a feature-count problem.** Forge already has the zones, the ribbon, the wheel, the dialog, the rollback bar, the snap engine. What's missing is the *feel* — live ghost preview, modal focus, color-coded DOF, kernel-backed time-travel, flick-fast radial. Those five behaviors are what convince a CATIA seat-holder in the first ten minutes. Prioritize them over any new workbench.

2. **One kernel capability dominates the pillar.** The stable feature-replay engine with persistent topological naming + side-effect-free preview unblocks G1/G2/G9 — the three behaviors a senior engineer will judge first, and the literal answer to the community's #1 parametric gripe. It is the highest-leverage kernel ask in the whole UIUX track. Sequence it ahead of front-end polish.

3. **Every UX surface is also Archie's control surface.** The dual-driver rule means the ghost-preview `op.preview` validity flag, the per-entity DOF state in `__forgeSelectionContext`, and the `param.set/get` expression verbs are *exactly* the signals Archie needs to (a) check geometry before committing (CADGenBench Invalidity Ratio), (b) know when a sketch is fully defined (intent alignment), and (c) emit parametric output that opens with a clean editable tree. **Enterprise UIUX and CADGenBench score are the same work** — building the UI right is building the CUA's instrumentation.

4. **The color canon is free brand-and-correctness signal.** The blue→black→red sketch coloring is both the most-recognized MCAD adoption cue *and* a real-time correctness oracle Archie can read. It's the one place chromatic accent is not just allowed but mandatory.

5. **The radial/keyboard layer is the differentiator no web-CAD competitor ships.** AdamCAD, Zoo, and the text-to-CAD copilots have no muscle-memory layer at all. A genuine Maya-grade flick wheel + single-key alphabet + chord numeric input is a defensible enterprise moat — and, per the dual-driver rule, it costs nothing extra to make Archie-operable.

---

## Sources

- **Siemens NX** — Command Finder / Resource Bar / Part Navigator / rollback "current feature" + playback / QuickPick: https://manualzz.com/doc/26898314/nx-interface · https://engineeringtechnology.org/engineering-graphics/cad-siemens-nx/nx-part-navigator/ · https://www.eng-tips.com/threads/quot-make-current-feature-quot-or-rollback-option-in-siemens-nx.502695/ · https://www.eng-tips.com/threads/way-to-easily-roll-back-the-part-navigator.329278/ · https://community.sw.siemens.com/s/question/0D54O00006cf277SAA/nx1938-quickpick · https://blogs.sw.siemens.com/nx-design/whats-new-nx-june-2024-advanced-design/
- **CATIA / 3DEXPERIENCE** — Action Bar / Robot-Compass / context menu / V5→3DX transition: https://www.goengineer.com/blog/catia-v5-to-3dexperience-catia-tips-for-successful-transition · https://resources.rand3d.com/videos-webcasts/catia-3dexperience-2022x-action-bar-overview-and-customization · https://www.technia.com/en/faqs/how-does-the-catia-3dexperience-interface-compare-to-catia-v5/
- **PTC Creo** — Dashboard / Mini Toolbar / weak vs strong dimensions / main-window regions: https://support.ptc.com/help/creo/creo_pma/r11.0/usascii/part_modeling/sketcher/To_Control_the_Display_of_Dimensions.html · https://support.ptc.com/help/creo/creo_pma/r12/usascii/fundamentals/fundamentals/About_the_Pro_ENGINEER_Main_Window.html · https://community.ptc.com/t5/Creo-Parametric-Tips/Did-You-Know-A-Quicker-Way-to-Work-with-Features/ta-p/820159 · https://www.ptc.com/en/blogs/cad/creo-parametric-interface-introduced
- **SolidWorks** — sketch geometry status colors (blue/black/red/brown): https://help.solidworks.com/2022/english/SolidWorks/sldworks/c_Sketch_Geometry_Status.htm · https://gupta9665.wordpress.com/2011/01/17/colors-symbols-what-they-indicate/ · https://www.cadasio.com/post/getting-started-with-sketching-in-solidworks-a-beginners-guide-part-4 · https://blog.epectec.com/what-does-it-mean-to-constrain-a-solidworks-sketch
- **Maya marking menus** (radial/flick muscle-memory): https://help.autodesk.com/view/MAYAUL/2024/ENU/?guid=GUID-8BA1A3AA-4C44-4779-8B22-0AAE3627E8EB · https://vrntech.ro/blog/bAW/marking-menus-in-maya-part-1-the-basics · https://github.com/bohdon/maya-quickmenus
- **Pie-menu HCI / Fitts's law**: https://www.nngroup.com/articles/expandable-menus/ · https://donhopkins.medium.com/pie-menus-936fed383ff1 · https://en.wikipedia.org/wiki/Pie_menu
- **Topological naming problem** (rollback / upstream-edit risk): https://www.ondsel.com/blog/toponaming-problem-is-history/ · https://www.ondsel.com/blog/freecad-topological-naming/ · https://github.com/FreeCAD/FreeCAD/issues/17041 · https://libdrone.eu/reference/topological-naming-problem/
- **Onshape** in-context transparency / LOD: https://cad.onshape.com/help/Content/Assembly/modeling_in_context.htm · https://www.onshape.com/en/changelog/
- **Forge code** verified against `frontend/src/forge-v4/` (`ForgeShellV4.jsx`, `Toolbar.jsx`, `ToolParamDialog.jsx`, `ActionWheel.jsx`, `RollbackBar.jsx`, `sketchSession.js`, `snapEngine.js`, `CommandPalette.jsx`, `EquationManager.jsx`, `SelectionFilterStrip.jsx`, `StatusBar.jsx`) and the CUA bridge (`ForgeRunner.installForgeRunner` → `window.__forgeEngine.dispatchToolCall`, `frontend/src/ai/ForgeToolBridge.js`).
</content>
</invoke>
