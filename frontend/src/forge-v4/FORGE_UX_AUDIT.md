# Forge UX Audit — `frontend/src/forge-v4` vs CATIA / SolidWorks / NX

**Date:** 2026-06-21 · **Scope:** READ-ONLY audit of the Forge v4 application shell and
its UI surfaces. No files were modified. Citations are `file:line` against
`frontend/src/forge-v4/`.

**Method:** Read the full shell (`ForgeShellV4.jsx`, 3545 lines), every chrome
component (top menu, ribbon/toolbar, rails, docks, viewport overlays, status
bar, command bar/palette, dialogs, context menus, tooltips, onboarding,
iconography), the design-token sheet (`tokens.css`), and swept the whole tree
for `data-testid` and `window.__forge*` hooks.

**Reference bar:** "pro MCAD app" below means the table-stakes UX of SolidWorks
2024, CATIA V5/3DX, Siemens NX, Fusion 360, and Onshape — the products a Forge
evaluator will compare against.

---

## 0. Executive summary

Forge v4 has a **complete, professionally-structured zone layout** (top bar →
QAT → contextual toolbar → left workbench rail → viewport → right inspector →
status bar → always-on Archie command bar), a custom hand-drawn icon set, a
4-theme token system, a real command palette, a feature tree with
drag/suppress/rename, a rollback timeline, and a tool-param dialog driven from a
schema. That scaffolding is genuinely strong and reads as a real CAD app.

The gaps that separate it from a pro MCAD app are concentrated in a few areas:

1. **No interactive ViewCube.** The viewport ships only a drei `GizmoHelper`
   axis-triad (non-clickable faces/corners/edges). Every pro MCAD app has a
   clickable, draggable, named ViewCube. This is the single most-noticed
   "this isn't pro" tell. (`Viewport.jsx:251`)
2. **The "ribbon" is a single flat 48px icon strip,** not a tabbed ribbon with
   large/small buttons, flyouts, or group labels-as-launchers. Pro apps use a
   CommandManager/ribbon with tabs + dropdown split-buttons. (`Toolbar.jsx`,
   `tokens.css:471`)
3. **The Tools menu is a 134-item flat dropdown** (`Menus.jsx` Tools block).
   No submenus, no scroll affordance, no grouping headers. This is the worst
   single density offense in the app.
4. **Several primary affordances are dead clicks** — the empty-canvas
   right-click "Create box/cylinder/sphere/cone/torus", "Start sketch",
   "Duplicate", "Isolate", "Appearance", "Material", "Pattern", "Mirror",
   "Transform", "Suppress", "Hide" all fall through to the
   `"<id> · not wired yet"` toast. (`BodyContextMenu.jsx:50-72`,
   `ForgeShellV4.jsx:2964`)
5. **Two referenced icons are undefined** (`wb.part`, `wb.sketch`) → render as a
   defensive outlined square in the workbench rail, QAT, and several menu rows.
   (`icons/Icon.jsx:260`, used in `WorkbenchRail.jsx:84,116` etc.)
6. **The onboarding tour points two of its six steps at dead selectors**
   (`forge-cmd-bar`, `forge-timeline` — the real testids are `forge-cmdbar` and
   `forge-rollback`). Those steps highlight nothing. (`OnboardingTour.jsx:34,49`)
7. **The Properties panel is a 3-row stub** (Kind / Count / First id) with no
   editable parameters, no material, no appearance, no mass — far below the
   PropertyManager pro users expect. (`RightPanel.jsx:196`)

Everything below is the per-surface detail: current state → gap → concrete
change.

---

## 1. Top menu bar (`TopBar.jsx`, `Menus.jsx`)

**Current.** A 40px header (`tokens.css:160,366`): brand mark + "Forge" word
(`TopBar.jsx:13-16`), the 5-menu `MenuBar` (File/Edit/View/Tools/Help,
`Menus.jsx:480`), a spacer, a "Workbench · **<label>**" chip
(`TopBar.jsx:19-21`), and a tiny `0.4.0` version string (`TopBar.jsx:22-24`).
Dropdowns: click-to-open, hover-to-switch between open menus, Esc/outside-click
to close, mono shortcut hints right-aligned (`Menus.jsx:516-668`). Plugin menus
append dynamically. `-webkit-app-region: drag` makes the bar the window drag
handle (`tokens.css:373`).

**Gaps vs pro MCAD.**
- **No application/launcher button.** SolidWorks/NX/CATIA open with a primary
  menu button (the SW flyout, the NX File ribbon tab, the 3DX compass). Forge's
  File menu is a peer of Edit, with no "new from template" gallery.
- **The Tools menu is a 134-item flat `<ul>`** (`Menus.jsx:86-468`,
  `grep` count = 134 `tools.*` ids). It has `SEP` dividers but **no submenus and
  no scroll container** — on a laptop it overflows the viewport. A pro app
  nests these (Tools ▸ Simulation ▸ …, Tools ▸ CAM ▸ …). Note a
  `HierarchicalToolsMenu.jsx` already exists in the tree but the top-bar Tools
  menu does not use it.
- **No "recently used" or pinned commands** surfaced in menus (the `file.recent`
  item exists but no MRU preview).
- **Menu items have no enabled/disabled state.** Every item is always clickable;
  `Export STEP` is offered with zero bodies and only warns *after* the click
  (`ForgeShellV4.jsx:891`). Pro apps grey out inapplicable commands.
- **No keyboard mnemonics** (Alt+F to open File). Arrow-key navigation inside an
  open menu is also absent (the comment at `Menus.jsx:7` claims it but the
  render has no `onKeyDown` arrow handling).

**Concrete changes.**
1. Route the Tools menu through the existing `HierarchicalToolsMenu` /
   `CALCULATOR_TREE` so it nests into ≤ 8 top-level groups with hover-submenus
   (the CommandPalette already consumes `CALCULATOR_TREE` at
   `CommandPalette.jsx:31,132` — reuse it).
2. Add an `enabled(ctx)` predicate per `MENU_SPEC` item; grey out + `aria-disabled`
   when false (e.g. export with no native body, Undo with empty op-graph).
3. Add arrow-key roving focus inside the open dropdown (`role="menu"` already set
   at `Menus.jsx:599`).
4. Add a `max-height: calc(100vh - 80px); overflow-y: auto` to the dropdown
   `<ul>` style (`Menus.jsx:601-614`) so long menus never overflow.

---

## 2. Ribbon / contextual toolbar (`Toolbar.jsx`, `tokens.css:471-526`)

**Current.** A single 48px horizontal strip under the QAT
(`tokens.css:160 --forge-toolbar-h:48px`). Per-workbench `SPEC`
(`Toolbar.jsx:12-172`) renders groups, each = an uppercase group label
(`tokens.css:490`) + a row of 32px icon buttons (`tokens.css:500`). Groups are
divided by a 1px right border (`tokens.css:486`). `overflow-x: auto` when the row
is too wide (`tokens.css:479`). Active tool gets accent fill + rim
(`tokens.css:518`). Buttons are `Tooltip`-wrapped (`Toolbar.jsx:200`). Role
transformer can re-shape `SPEC` (`Toolbar.jsx:186-189`).

**Gaps vs pro MCAD.**
- **It is a toolbar, not a ribbon.** Pro MCAD (SW CommandManager, NX ribbon,
  CATIA action bar) uses **tabbed** command surfaces with **large primary
  buttons + small secondary buttons** and **split-button flyouts** (e.g. the
  fillet button has a dropdown for chamfer/full-round). Forge gives every tool
  the same 32px square with no hierarchy. (`feedback-forge-ui-hierarchy.md` in
  memory explicitly calls for ribbon tabs/flyouts.)
- **No tool text labels.** Pro ribbons label the big buttons ("Extruded Boss/
  Base", "Revolve"). Forge is icon-only, so a new user must hover every button.
- **Group labels don't act as launchers.** In SW the small arrow on a ribbon
  group opens the full command set; Forge's `forge-toolbar-group-label`
  (`tokens.css:490`) is inert text.
- **`overflow-x: auto` horizontal scroll** is a poor pattern — on the Sheet
  workbench (6 groups, `Toolbar.jsx:96-132`) the strip scrolls sideways instead
  of wrapping/collapsing into overflow chevrons.
- **No contextual ribbon switching.** When a sketch is active, pro apps swap to a
  Sketch ribbon. Forge keeps the same `mech` toolbar; the sketch tools are mixed
  into the Sketch group permanently (`Toolbar.jsx:14-25`).
- **Disabled state exists in CSS** (`tokens.css:523`) **but is never applied** —
  no tool is ever `disabled`, so e.g. Boolean tools show enabled with < 2 bodies.

**Concrete changes.**
1. Introduce ribbon **tabs** per workbench (Sketch / Features / Surface /
   Evaluate / …) so the 7-group `mech` strip becomes 3-4 navigable tabs.
2. Promote 1-2 hero ops per group to a **large labeled button**; keep the rest
   as the current 32px icons. Add `flyout: [...]` to `SPEC` tool entries to get
   split-button dropdowns (fillet→chamfer, linear→circular pattern).
3. Auto-switch to a **Sketch ribbon** when `sketchActive` is true
   (`ForgeShellV4.jsx:198`), restoring the part ribbon on finish.
4. Wire `disabled` from a per-tool `enabled(ctx)` predicate and render the
   already-styled `tokens.css:523` disabled state.

---

## 3. Left tree / browser dock — the Workbench Rail (`WorkbenchRail.jsx`)

**Current.** A 72px vertical rail (`tokens.css:175`). Renders ONLY the 11
`CORE_WORKBENCH_IDS` (mech/draft/drawing/sheet/weld/mold/sim/mfg/arch/mesh/robot)
even though `WORKBENCHES` has ~70 entries (`WorkbenchRail.jsx:20-142`, filtered at
`:141-142`). Active tab gets accent-mute fill + rim + a 3px left stripe
(`tokens.css:449-462`). Each tab = 24px glyph + 9px uppercase label
(`WorkbenchRail.jsx:159-160`), Tooltip-wrapped (`:150`).

**Gaps vs pro MCAD.**
- **This is a workbench *switcher*, not a model browser.** In pro MCAD the
  left dock is the **FeatureManager / Specification Tree / Part Navigator** — the
  primary model browser, always visible on the left. Forge puts its feature tree
  on the **right** (`RightPanel.jsx`) and uses the left rail purely for mode
  switching (a CATIA-workbench-rail idea, but pro users expect the tree on the
  left or as a dockable panel either side).
- **No assembly / instance hierarchy in the rail.** There is an
  `AssemblyTreePanel.jsx` and `SubAssemblyTreePanel.jsx` in the tree but they're
  not surfaced as the primary left browser.
- **Two rail icons are missing** — `wb.part` and `wb.sketch` are referenced
  (`WorkbenchRail.jsx:84,116` etc.) but **undefined in `icons/Icon.jsx`** → the
  defensive outlined-square fallback renders (`icons/Icon.jsx:260-269`).
- **The non-core workbenches are unreachable from the rail** by design; they live
  only in the (overcrowded) Tools menu + palette. A user scanning the rail can't
  discover Aero/Cost/Tolerance.
- **Labels are 9px uppercase** (`tokens.css:464-468`) — below comfortable read
  size on a 4K remote desktop (the user's setup per memory).

**Concrete changes.**
1. Define the two missing icons (`wb.part`, `wb.sketch`) in `icons/Icon.jsx`.
2. Add a **dockable model-browser tree on the left** (or make the right
   Inspector dock-to-either-side) so the FeatureManager equivalent is where pro
   users reach for it; keep the workbench rail as a thin mode strip beside it.
3. Add a rail **overflow affordance** ("⋯ More workbenches") that opens the
   hierarchical list, so non-core disciplines are discoverable without the Tools
   menu.
4. Bump label size to 10px and reduce the uppercase tracking for legibility.

---

## 4. Right properties / parameters dock (`RightPanel.jsx`, `FeatureTree.jsx`)

**Current.** A 340px dock (`tokens.css:176`), drag-resizable on its left edge
(260-640px, persisted, `RightPanel.jsx:14-41,69-73`). Header "Inspector" +
collapse toggle (`:74-95`). Three stacked sections (`tokens.css:921-946`):
**Feature Tree** (count badge + `FeatureTree`), **Bodies** (native-body count +
`BodyList` with eye-toggle + dbl-click rename), **Properties**
(`:126-141`). The feature tree (`FeatureTree.jsx`) has Cmd+F filter
(`:76-92`), drag-reorder (`:46-60`), suppress/rename/delete context menu
(`:174-195`), a connector spine + status dot per row (`:138-149`).

**Gaps vs pro MCAD.**
- **Properties is a 3-row stub:** Kind / Count / First id (`RightPanel.jsx:196-201`)
  with mono read-only values. A pro PropertyManager shows **editable feature
  parameters, material, appearance, mass properties, references, and an OK/Cancel
  header**. There is nothing editable here at all.
- **No PropertyManager-style modal panel.** When a feature is selected, pro apps
  replace the tree with the feature's editable parameter set; Forge keeps the
  static tree and opens parameters only via the separate left-side
  `ToolParamDialog` (different location, different mental model).
- **Feature tree has no folders, no rollback bar inline, no hierarchy.** It's a
  flat list (`FeatureTree.jsx:112`). Pro trees nest sketches under features,
  group with folders, and show the rollback line *in* the tree.
- **No "Origin / Planes / Axes" datum node** at the top of the tree. Forge tracks
  `datumPlanes` in state (`ForgeShellV4.jsx:139`) but they never appear as
  browsable tree nodes.
- **Bodies vs Features split is non-standard** — pro apps have a Solid Bodies /
  Surface Bodies folder *inside* the tree, not a separate panel section.
- **Rename uses `window.prompt`** for bodies (`RightPanel.jsx:180`) — a jarring
  native dialog vs the inline-edit the feature tree already uses
  (`FeatureTree.jsx:151-166`). Inconsistent.

**Concrete changes.**
1. Build a real **PropertyManager**: when `selection.kind === 'feature'|'body'`,
   render that node's `params` as editable fields (reuse `ToolParamDialog`'s
   `Field`/`FieldInput` from `ToolParamDialog.jsx:110-184`) with live regen.
2. Add **Origin / Planes / Axes / Material** standard nodes to the tree top from
   `datumPlanes` + active material.
3. Replace `window.prompt` body rename with the inline-edit pattern from
   `FeatureTree.jsx`.
4. Add folders + sketch-under-feature nesting to the tree data model.

---

## 5. Viewport + nav-cube + view gizmo + view controls + HUD (`Viewport.jsx`, `HeadsUpToolbar.jsx`)

**Current.**
- Canvas (`Viewport.jsx:200-257`): r3f `<Canvas>`, FOV 45, near/far 0.1/200000,
  `localClippingEnabled`. Radial-gradient background (`tokens.css:529-536`).
- **View gizmo:** drei `GizmoHelper` + `GizmoViewport` bottom-left, axis colors
  red/green/blue (`Viewport.jsx:251-256`).
- **Origin triad:** custom `OriginAxes` — 25mm XYZ lines + arrowheads + X/Y/Z
  Html labels + dashed negative stubs (`Viewport.jsx:266-314`).
- **Grid:** infinite drei `Grid` (`:215-222`).
- **HUD:** `HeadsUpToolbar` pill floats top-center (`HeadsUpToolbar.jsx`,
  `tokens.css:326-339`): Centre/Zoom-fit/Iso · Shaded/Wireframe/Section ·
  Move/Rotate/Scale gizmo · Normal-to. A `forge-viewport-cullchip` "visible/total"
  chip appears only above 50 bodies (`Viewport.jsx:1247`).
- **Orbit:** drei `OrbitControls`, damping, min/max distance 5–80000
  (`:245-247`); `TransformControls` gizmo when a body is selected + a mode set
  (`:235-244`). Smart-fit on view change (`ForgeShellV4.jsx:419-455`).
- Right-click anywhere in the viewport opens `BodyContextMenu`
  (`ForgeShellV4.jsx:2995-2999`).

**Gaps vs pro MCAD.**
- **No interactive ViewCube.** `GizmoHelper` is an orientation *indicator* — you
  can drag-orbit from it but its faces/edges/corners are **not clickable named
  views** the way the SW/NX/Inventor/Fusion ViewCube is (click "Top", click a
  corner for iso, click an edge for a rolled view, "Home" button). This is the
  #1 missing pro affordance. Named views are only reachable via keys 1-7
  (`ForgeShellV4.jsx:508-513`) or the HUD pill.
- **No on-screen navigation bar** (NX/Inventor have a persistent pan/zoom/orbit/
  look-at toolbar). Forge relies on mouse + the small HUD pill only.
- **HUD pill duplicates the toolbar** (Shaded/Wireframe/Section also exist as
  display states) and floats over the model center — it can occlude tall parts.
- **No coordinate/cursor readout, no scale bar, no measure-on-hover overlay** in
  the viewport. The `ViewportHUD` comment (`Viewport.jsx:1210-1214`) explicitly
  *removed* the scale bar + selection HUD as "redundant", but pro apps keep a
  triad + scale + cursor-coords for spatial grounding.
- **No section-view plane manipulator handles** — section is axis+offset only via
  a slider/event (`Viewport.jsx:224-227`, `sectionPlane` state), not a
  draggable in-scene plane with grab handles.
- **Selection feedback is minimal** — selected body uses a `selectedRef`
  highlight (`Viewport.jsx:233`) but there's no hover pre-highlight color, no
  edge/face roll-over highlight in the standard CAD cyan/orange.

**Concrete changes.**
1. **Build a real ViewCube** (or wire a clickable cube mesh into the
   `GizmoHelper` slot at `Viewport.jsx:251`): 6 faces + 12 edges + 8 corners,
   each dispatching the matching `setViewName`/fit; add a Home button and a
   compass ring. This single change most closes the "pro" gap.
2. Add a **persistent viewport navigation bar** (pan/zoom-window/zoom-fit/orbit/
   look-at/section) docked right-edge of the viewport.
3. Add **in-scene section-plane drag handles** for `sectionPlane`.
4. Add **hover pre-highlight** (face/edge/body) and a small cursor-coordinate
   readout; restore an optional scale bar toggle.

---

## 6. Bottom status bar (`StatusBar.jsx`, `tokens.css:948-962`)

**Current.** A 26px mono strip (`tokens.css:171`): Units · Snap · Ortho · WB ·
spacer · FPS · Selection summary · saved/unsaved (`StatusBar.jsx:14-25`).

**Gaps vs pro MCAD.**
- **Everything is hard-coded / read-only.** `units='mm'`, `snap=true`,
  `ortho=false`, `fps=60` are **default props that are never driven** — the shell
  renders `<StatusBar workbench={activeWb} selection={selection} />`
  (`ForgeShellV4.jsx:3120`) and passes nothing else, so Units/Snap/Ortho/FPS are
  static literals. The SolidWorks status bar's unit system, snap toggle, and
  "fully defined" indicator are all **clickable controls**; Forge's are inert
  text.
- **`savedAt` is never passed**, so it always reads "unsaved" even right after a
  save (`ForgeShellV4.jsx:804-815` saves a snapshot but doesn't feed
  `savedAt`).
- **No clickable unit-system switch, no measure quick-readout, no document
  modified dot, no tessellation/regen progress** in the bar.
- **FPS shows a fake constant 60**, which an evaluator will notice immediately.

**Concrete changes.**
1. Drive `units`/`snap`/`ortho`/`savedAt`/`fps` from real state; wire `fps` to
   the existing perf counters (`window.__forgePerfHUD`, `Viewport.jsx:424`).
2. Make Units, Snap, and Ortho **clickable toggles** (SW pattern); persist them.
3. Feed `savedAt` from `file.save` / autosave so the bar reflects real save time.
4. Add a regen/tessellation progress indicator (there's a `ProgressStrip.jsx`
   already in the tree to reuse).

---

## 7. Command palette + Archie command bar (`CommandPalette.jsx`, `CommandBar.jsx`, `ArchieDock.jsx`)

**Current.**
- **Always-on Archie cmd bar** (52px, `tokens.css:172`): spark glyph + NL input
  + ⌘K/↵ hints + "Open/Close thread" toggle, with a floating "Try:" preset-chip
  row (4 flagship presets) above it (`CommandBar.jsx:62-118`,
  `tokens.css:964-1058`). Submitting routes to `runArchie`
  (`ForgeShellV4.jsx:541`).
- **Command palette** (`CommandPalette.jsx`): Cmd+K overlay, fuzzy
  subsequence scoring (`:172-200`), indexes menus + toolbar tools + workbenches +
  features + bodies + the 270+ calculators (`:156-165`), breadcrumb + kind badge
  + shortcut per row, arrow/enter/esc nav (`:332-350`).
- **Archie dock** (`ArchieDock.jsx`): 380px right dock that *replaces* the
  Inspector when open (`ForgeShellV4.jsx:3062-3066`, `tokens.css:1060-1095`);
  thread bubbles by role, empty-state sample prompts.

**Gaps vs pro MCAD.**
- **Two Cmd+K owners.** `CommandPaletteHost` captures Cmd+K in the capture phase
  (`CommandPalette.jsx:424-433`) AND the shell's keydown also maps Cmd+K to focus
  the cmd bar (`ForgeShellV4.jsx:462-463`). The palette wins via `stopPropagation`,
  but the menu still advertises Cmd+K for *both* "Command Search" and "Command
  Palette" (`Menus.jsx:91,93`) — confusing duplicate entries.
- **The Archie dock hijacks the Inspector slot.** Opening Archie
  *hides the feature tree/properties* (`ForgeShellV4.jsx:3062`), forcing a choice
  between seeing the model browser and seeing Archie. Pro apps never make the
  assistant evict the tree; it should be a separate dock or an overlay.
- **Palette overlay testid is `forge-cmd-palette`** but the onboarding tour
  references `forge-cmd-bar` (which is the *Archie bar*, and that testid doesn't
  exist either — see §11).
- The Archie bar's running/idle spark icon is identical in both branches
  (`CommandBar.jsx:84` renders the same `archie.spark` whether running or not) —
  no spin/pulse to signal "working".

**Concrete changes.**
1. Pick one Cmd+K owner (palette), remove the cmd-bar Cmd+K mapping
   (`ForgeShellV4.jsx:462`) and the duplicate "Command Search" menu item
   (`Menus.jsx:91`).
2. Make the Archie dock a **separate panel** that does not evict the Inspector
   (e.g. a third column, or a bottom dock, or a floating overlay) — the Inspector
   must stay visible while Archie works.
3. Add a running-state animation to the cmd-bar spark (`CommandBar.jsx:84`).

---

## 8. Dialogs / modals / forms (`ToolParamDialog.jsx`, `CommandPalette.jsx`, panel hosts)

**Current.** The universal `ToolParamDialog` renders as a **260px left-side dock**
(not a centered modal) when `activeTool` has a schema (`ToolParamDialog.jsx:52`,
`tokens.css:538-619`): title + close, schema-driven fields
(number/vec3/bool/enum/ref/text via `FieldInput`, `:119-184`), Cancel/Confirm
footer (Esc / ⌘↵), plus a **Confirmation Corner** ✓/✗ pill at viewport top
(`:186-207`, `tokens.css:621-656`). Most other features open as portal-mounted
panels via `window.__forgeOpen*` hooks.

**Gaps vs pro MCAD.**
- **No reference-picking flow in the param dock.** The `ref` field just snapshots
  the current selection on click (`ToolParamDialog.jsx:164-176`) — there's no
  "now pick edges in the viewport, see them listed, remove individually" loop
  that SW/NX fillet/pattern dialogs have.
- **No live preview.** Pro feature dialogs preview the result as you type; the
  Forge dialog commits only on Confirm (`ToolParamDialog.jsx:96`).
- **No validation / error display in-form.** Out-of-range or missing inputs only
  surface as a toast *after* dispatch (`ForgeShellV4.jsx` toast paths), never
  inline next to the field.
- **The 200+ workbench panels are visually heterogeneous.** Each
  `*Workbench.jsx` defines its own `panelStyle` (e.g. `AerospaceWorkbench.jsx:251`,
  `CostWorkbench.jsx:150`) rather than a shared dialog chrome — inconsistent
  padding/header/buttons across the calculator suite.
- **`window.prompt` used for body rename** (`RightPanel.jsx:180`) — a native
  modal that breaks the visual language.

**Concrete changes.**
1. Add a **collect-references mode** to the `ref` field: enter pick mode, list
   picked entities with remove buttons, exit on confirm.
2. Add **live preview** (ghost geometry) driven by the dialog's `values` before
   Confirm.
3. Add **inline field validation** (min/max/required) using the schema's
   `min`/`max` already present (`ToolParamDialog.jsx:124`).
4. Extract a shared `ForgePanel` chrome component and migrate the workbench panels
   onto it for one consistent dialog language.

---

## 9. Iconography (`icons/Icon.jsx`, `icons/Logo.jsx`)

**Current.** A hand-built 16×16 SVG set, 1.5px stroke, rounded caps/joins,
`currentColor` so it inherits hover/active/disabled (`icons/Icon.jsx:1-26`).
~120 named glyphs across wb/menu/file/sketch/solid/pattern/bool/select/view/io/
archie/misc/gizmo categories. Missing names render a defensive outlined square
(`:260-269`).

**Gaps vs pro MCAD.**
- **Two referenced icons are undefined → squares:** `wb.part` and `wb.sketch`
  (used in `WorkbenchRail.jsx:84,116,etc.` and the Tools menu). Confirmed absent
  from `PATHS`.
- **Heavy glyph reuse hides meaning.** Many distinct ops share one icon —
  e.g. dozens of workbench-rail entries map to `wb.sim` (Aero/Cast/Acoust/Carbon/
  Beam/HX/Mohr/Buckle/Wind/Snow/Pump/Refrig/Fan all = `wb.sim`,
  `WorkbenchRail.jsx:36-136`); `datum.*` tools all reuse `sketch.rect`
  (`Toolbar.jsx:50-52`); Sheet-metal hems all reuse `solid.fillet`
  (`Toolbar.jsx:122-125`). Users can't visually distinguish ops.
- **Icons are monochrome-only** (one accent rule from `tokens.css:51`). Pro
  ribbons use limited color to disambiguate tool families (blue sketch, etc.) —
  a deliberate Forge constraint, but it raises the bar on glyph distinctiveness.
- **No 24/32px optical variants** — the same 16px paths are scaled to 18/24px,
  losing crispness on the 4K remote desktop.

**Concrete changes.**
1. Add the two missing glyphs (`wb.part`, `wb.sketch`).
2. Give the high-traffic reused glyphs unique drawings (datum planes, the sheet
   hem variants, and at least the rail's most-used disciplines).
3. Add an optional second size grid (24px) for ribbon hero buttons.

---

## 10. Tooltips (`Tooltip.jsx`, `HoverTooltip.jsx`)

**Current.** `Tooltip` — 350ms delay, viewport-clamped, label + mono shortcut
`kbd`, Esc-dismiss, fixed-positioned portal-less overlay (`Tooltip.jsx`). Wraps
every toolbar/QAT/HUT/rail button. `HoverTooltip` — a live body-info tip
(name/handle/mass/V/A/CG) following the cursor when `window.__forgeHovered` is
set, toggled by the `i` key (`HoverTooltip.jsx`).

**Gaps vs pro MCAD.**
- **No rich/extended tooltips.** SW/NX tooltips have a title + a paragraph
  description + sometimes a thumbnail/animation on a longer hover. Forge tips are
  one line + a key hint (`Tooltip.jsx:81-92`).
- **`Tooltip` clones a single child and injects refs/handlers**
  (`Tooltip.jsx:51-57`) — fragile: it assumes the child forwards `ref` and the 4
  mouse/focus handlers, and silently breaks for any child that doesn't (no
  `React.Children.only` guard).
- **No tooltip for the workbench-rail labels themselves** beyond the bare label
  (the rail tooltip just repeats the visible label, `WorkbenchRail.jsx:150`).
- **`HoverTooltip` depends on `window.__forgeHovered`** being populated by the
  viewport, but there's no hover-highlight to tell the user *which* body the tip
  describes.

**Concrete changes.**
1. Extend `Tooltip` to accept `{ title, description, shortcut }` and render the
   richer 2-line form for ribbon hero buttons.
2. Guard the `cloneElement` with `React.Children.only` and document the
   ref-forwarding contract.
3. Pair `HoverTooltip` with the viewport hover-highlight from §5.

---

## 11. Empty-states / onboarding (`OnboardingTour.jsx`, `ArchieDock.jsx`, `FeatureTree.jsx`, `RightPanel.jsx`)

**Current.**
- **First-run tour** (`OnboardingTour.jsx`): 6 highlighted steps, gated by
  `forge.v4.onboarded`, replayable via `window.__forgeStartTour`. Overlay +
  highlight box + tooltip with Back/Skip/Next.
- **Empty feature tree:** "No features yet. Start a sketch or run an op."
  (`FeatureTree.jsx:98-100`).
- **Empty bodies:** "No bodies yet." (`RightPanel.jsx:150`).
- **Empty properties:** "Select something in the viewport." (`RightPanel.jsx:133`).
- **Empty Archie thread:** sample prompts (`ArchieDock.jsx:54-79`).

**Gaps vs pro MCAD.**
- **Two tour steps point at non-existent selectors.** Step 3 targets
  `[data-testid="forge-cmd-bar"]` and step 5 targets `[data-testid="forge-timeline"]`
  (`OnboardingTour.jsx:34,49`). Neither testid exists — the real ones are
  `forge-cmdbar` (`CommandBar.jsx:66`) and `forge-rollback`
  (`RollbackBar.jsx:24`). Those two steps highlight **nothing** (the highlight box
  is gated on a found rect, `OnboardingTour.jsx:172`), so the user sees a tooltip
  floating with no anchor.
- **The tour describes features that don't match the UI.** Step 4 says "Cmd+N
  starts a fresh thread" (`OnboardingTour.jsx:46`) — there is no Cmd+N thread
  handler in the shell. Step 5 says "Shift+click to roll back / Backspace to
  truncate" — the RollbackBar uses plain click + context menu
  (`RollbackBar.jsx:34-38`), not Shift+click/Backspace.
- **No empty-viewport welcome / new-document gallery.** When the scene is empty
  the viewport shows only grid+triad; there's no "Start a sketch / Open a sample /
  Recent files" splash that Fusion/Onshape show on a blank document.
- **Empty-states are plain italic text**, not actionable (the feature-tree empty
  text isn't a button to start a sketch).

**Concrete changes.**
1. Fix the two dead tour selectors → `forge-cmdbar` and `forge-rollback`; fix the
   Cmd+N / Shift+click / Backspace copy to match the real interactions.
2. Add a **blank-document welcome** in the viewport (New sketch / New primitive /
   Open sample / Recent) — reuse `DemoProject.jsx` + `ProjectLibrary.jsx`.
3. Make empty-state text actionable (the feature-tree empty becomes a "Start
   sketch" button).

---

## 12. Typography (`tokens.css:194-211`)

**Current.** `Inter` UI font + `JetBrains Mono` for data/shortcuts
(`tokens.css:195-196`). Base 12px / 1.4 line-height (`:208-209`), antialiased.
Sizes range 9px (rail labels) → 16px (palette input). Uppercase + letter-spacing
on section headers/group labels.

**Gaps vs pro MCAD.**
- **9px is used in multiple primary surfaces** (rail labels `tokens.css:464`,
  status-bar-adjacent, menu shortcuts at 10px) — below comfortable legibility on
  a high-DPI remote desktop (the user's documented setup).
- **No font fallback guarantee.** `Inter`/`JetBrains Mono` are named but there's
  no `@font-face` / bundled font in the tree, so if the host lacks them the app
  silently falls back to system-ui — visual drift between machines.
- **Inconsistent label casing.** Section headers are uppercase
  (`tokens.css:933`) but the Inspector header "Inspector" is title-case
  (`RightPanel.jsx:83`) — minor but visible.

**Concrete changes.**
1. Raise the floor to 10-11px for any label a user must read (rail, menu
   shortcuts); reserve 9px for purely decorative tags.
2. Bundle Inter + JetBrains Mono via `@font-face` so typography is deterministic.

---

## 13. Density / spacing (`tokens.css:157-197`)

**Current.** A clean 4px grid (`tokens.css:164-170`), fixed zone heights
(topbar 40 / qat 32 / toolbar 48 / status 26 / cmdbar 52), 36px "comfortable"
tool row, 32px icon buttons, 3px tool gap (`:180-183`). Single-accent monochrome
discipline (`tokens.css:51-57`). Grid-template-areas layout
(`tokens.css:213-248`) with no overlap.

**Gaps vs pro MCAD.**
- **No density toggle.** Pro apps (and the user's 4K remote context) benefit from
  a Comfortable/Compact switch; Forge has one fixed density.
- **Stacked top chrome eats ~120px** before the viewport (topbar 40 + qat 32 +
  toolbar 48). On a laptop that's a lot of vertical chrome for a single-strip
  toolbar; a tabbed ribbon (§2) would reclaim the QAT or merge rows.
- **The right dock min is 260px** (`RightPanel.jsx:17`) and the Archie dock is a
  separate 380px (`tokens.css:176`) — but they can't both show (§7), so on a
  narrow window the user loses the tree entirely.

**Concrete changes.**
1. Add a Comfortable/Compact density toggle that swaps the `--forge-tool-row-h`
   / `--forge-tool-size` / zone-height tokens.
2. Allow the Inspector and Archie dock to coexist (resolves both §7 and the
   density loss).

---

## 14. Selection / hover feedback (`Viewport.jsx`, `SelectionHighlight.jsx`, `tokens.css`)

**Current.** Selected body tracked via `selectedRef` and highlighted in
`SceneMeshes` (`Viewport.jsx:233`); `TransformControls` gizmo attaches to it
(`:235-244`). Selection filters via Edit menu (`ForgeShellV4.jsx:1031-1046`) and
`tools.selectionMode` rotator (`:1219-1226`). Feature-tree/body-list rows
highlight active with `--forge-accent-mute`. Edge picking overlay exists
(`Viewport.jsx:229`).

**Gaps vs pro MCAD.**
- **No hover pre-highlight in the viewport.** Pro CAD shows a roll-over
  highlight (face glows, edge thickens) *before* you click; Forge only changes
  state on commit. `window.__forgeHovered` is read by `HoverTooltip` but nothing
  paints the hovered entity.
- **No standard selection color language.** Pro apps use consistent cyan
  (selected) / orange (hover) / green (pre-select edge). Forge selection uses the
  monochrome accent (white/graphite) which is subtle and easy to miss against the
  shaded model.
- **Selection in the status bar is text-only** (`StatusBar.jsx:20-23`), no
  selection-set chip you can clear inline.
- **Multi-select feedback is minimal** — Cmd-click multi-select is implied in
  measure flows (`ForgeShellV4.jsx:1073`) but there's no marquee/box-select or a
  visible selection list.

**Concrete changes.**
1. Add a **hover pre-highlight** material (face/edge/body) keyed off
   `window.__forgeHovered`.
2. Adopt a **selection color convention** (even within the monochrome rule, use a
   distinct selection rim brighter than the body) for selected/hover/preselect.
3. Add **box (marquee) selection** in the viewport and a clearable selection chip
   in the status bar.

---

## 15. Keyboard interaction (`ForgeShellV4.jsx:457-517`, component-local handlers)

**Current.** Global shortcuts in the shell keydown effect: Cmd+K (focus bar,
overridden by palette), Cmd+/ (dock), Cmd+T (theme), Cmd+D (display cycle),
Cmd+E (equations), Cmd+I (topology), F1 (help), T/R/Y (gizmo modes), Cmd+Z/⇧Z
(undo/redo), Cmd+P (preview), H (center), Esc (clear tool), 1-7 (named views)
(`ForgeShellV4.jsx:460-513`). Component-local: Cmd+F (feature filter,
`FeatureTree.jsx:21-38`), `i` (hover tip), Esc in dialogs/menus.

**Gaps vs pro MCAD.**
- **No discoverability surface.** SW/NX ship a customizable hotkey map and show
  shortcuts inline; Forge has a `tools.shortcuts` item that just opens the Help
  drawer (`ForgeShellV4.jsx:1127-1130`) — there's no editable keymap UI
  (a `RibbonCustomiser.jsx` exists but not a keymap editor).
- **Shortcut collisions / shadowing.** Cmd+K is double-claimed (§7). Plain `T`/`R`/
  `Y` toggle gizmos *only when focus isn't an input* (`ForgeShellV4.jsx:482-490`)
  — but `1-7` named views and `H` center have the same guard, so typing in any
  *non-input* focusable (a button) still fires them. The guard checks
  `tagName !== 'INPUT'/'TEXTAREA'` but not `isContentEditable` or `[role=...]`.
- **No spacebar/middle-mouse pro conventions.** No spacebar quick-view-menu (SW),
  no configurable mouse gestures.
- **Undo is inconsistent.** Cmd+Z calls `graphUndo` (`ForgeShellV4.jsx:493`) but
  the Edit-menu `edit.undo` just slices the last feature
  (`ForgeShellV4.jsx:1189-1191`) and the QAT `edit.undo` routes to the same
  menu handler — three "undo"s with two different behaviors.

**Concrete changes.**
1. Unify undo: route `edit.undo`/QAT/Cmd+Z all through `graphUndo`/`graphRedo`
   (`opGraph.js`); delete the feature-slice path at `ForgeShellV4.jsx:1189`.
2. Resolve the Cmd+K double-claim (§7).
3. Add an editable keymap UI and show the assigned key in every tooltip
   (`Tooltip` already supports `hint`).
4. Harden the no-input guard to also skip `isContentEditable` and form roles.

---

## 16. Cross-cutting dead-clicks / wiring defects (citable)

These are concrete, reproducible "click does nothing meaningful" issues an
evaluator will hit:

1. **Empty-canvas right-click → "Create box / cylinder / sphere / cone / torus",
   "Start sketch"** all fall through `handleMenuAction` to the default
   `"<id> · not wired yet"` warn toast — no geometry is created.
   (`BodyContextMenu.jsx:50-56`, routed via `ForgeShellV4.jsx:3043-3046`, default
   at `ForgeShellV4.jsx:2964`.) Verified: no `case 'create.box'` etc. exist.
2. **Body right-click → "Duplicate", "Isolate", "Appearance", "Material",
   "Pattern", "Mirror", "Transform", "Suppress", "Hide"** — same default toast,
   no action (`BodyContextMenu.jsx:13-26`). Verified: no handler cases.
3. **`wb.part` / `wb.sketch` icons render as squares** wherever referenced
   (rail, QAT, Tools menu) — `icons/Icon.jsx` has no path for them.
4. **Status bar Units/Snap/Ortho/FPS are static literals**, "unsaved" never
   clears (§6).
5. **Onboarding steps 3 & 5 anchor to dead testids** (§11).
6. **Two Cmd+K owners + duplicate menu entries** (§7).
7. **Three different "undo" behaviors** (§15).

Fixing #1-#3 is the highest-leverage credibility work: they are the first things
a reviewer touches (right-click the empty canvas, scan the rail).

---

# Appendix A — `data-testid` inventory (core shell surfaces — PRESERVE)

Implementers must keep these stable (they back the e2e suite, the CommandPalette
DOM-click dispatch, and the demo harness). Per source file:

| File | testids |
|---|---|
| `ForgeShellV4.jsx` | `forge-app`, `forge-viewport`, `forge-cmdbar-input` |
| `TopBar.jsx` | `forge-topbar`, `forge-topbar-wb-chip` |
| `Menus.jsx` | `forge-menus`, `forge-menu-file/edit/view/tools/help` (dynamic `forge-menu-${id}`) |
| `WorkbenchRail.jsx` | `forge-wb-rail` |
| `Toolbar.jsx` | `forge-toolbar` |
| `QuickAccessBar.jsx` | `forge-qat` |
| `HeadsUpToolbar.jsx` | `forge-hut` |
| `RightPanel.jsx` | `forge-right`, `forge-right-resize`, `forge-bodies-section`, `forge-body-list`, `body-visible-<handle>`, `body-name-<handle>` |
| `FeatureTree.jsx` | `forge-feature-tree`, `forge-feature-tree-filter`, `forge-feature-ctx` |
| `RollbackBar.jsx` | `forge-rollback` |
| `StatusBar.jsx` | `forge-statusbar` |
| `CommandBar.jsx` | `forge-cmdbar`, `forge-cmdbar-input`, `forge-cmdbar-toggle` |
| `CommandPalette.jsx` | `forge-cmd-palette-overlay`, `forge-cmd-palette`, `forge-cmd-palette-input`, `forge-cmd-palette-results` |
| `ArchieDock.jsx` | `forge-archie`, `forge-archie-cancel` |
| `ToolParamDialog.jsx` | `forge-tool-dock`, `forge-tool-confirm`, `forge-confirmation-corner` |
| `BodyContextMenu.jsx` | `forge-body-ctx` |
| `SketchStateBadge.jsx` | `forge-sketch-badge` |
| `Tooltip.jsx` | `forge-tooltip` |
| `HoverTooltip.jsx` | `forge-hover-tooltip` |
| `Viewport.jsx` | `forge-v4-canvas`, `forge-viewport-cullchip` |
| `OnboardingTour.jsx` | `forge-tour-overlay`, `forge-tour-highlight`, `forge-tour-tooltip`, `forge-tour-prev`, `forge-tour-skip`, `forge-tour-next` (targets: `forge-wb-rail`, `forge-viewport`, **`forge-cmd-bar`✗**, `forge-archie`, **`forge-timeline`✗**, `forge-app`) |

**Data-attribute selectors the CommandPalette + e2e rely on (PRESERVE):**
`data-wb=<id>` (rail), `data-tool=<id>` (toolbar), `data-menu=<id>` /
`data-menu-item=<id>` (menus), `data-qat-id=<id>` (QAT), `data-hut-id=<id>`
(HUD), `data-cmd-id` / `data-cmd-kind` (palette rows), `data-body-id`,
`data-field=<id>` (param dialog), `data-active`, `data-role-rev`,
`data-forge-v4-prompt-preset` / `data-forge-v4-prompt-presets` (cmd-bar chips).

> The full tree contains **hundreds** more `data-testid`s — one set per
> calculator/workbench panel (e.g. `forge-aero-*`, `forge-cost-*`, `forge-3p-*`,
> `forge-acoustics-*`, …). Those belong to individual workbench panels, not the
> shell; preserve them when touching their own files but they are out of scope
> for shell-chrome changes.

---

# Appendix B — `window.__forge*` hook inventory

**Total distinct `window.__forge*` hooks in the tree: 1268.** The vast majority
are per-workbench `window.__forgeOpen<Name>Workbench()` launchers (≈ 350+) plus
per-feature helper/state handles. Implementers touching the **shell** must
preserve this core set (defined or consumed by the shell + chrome):

**Shell state mirrors (published by `ForgeShellV4.jsx:267-388`):**
`__forgeBodies`, `__forgeFeatureTree`, `__forgeSelection`, `__forgeCurrentSketch`,
`__forgeDatums`, `__forgeActiveWb`, `__forgeTheme`, `__forgeConfigurations`.

**Shell setters / actions (the CUA + e2e + demo harness call these):**
`__forgeSelect`, `__forgeSetBodies`, `__forgeAppendBody`,
`__forgeReplaceFeatureTree`, `__forgeSelectFeature`, `__forgeSetActiveWb`,
`__forgeFit`, `__forgeCancelArchie`, `__forgeOpenDock`, `__forgeInjectPrompt`,
`__forgePromptPresets`.

**Archie turn surface (demo harness):** `__forgeArchieRunning`,
`__forgeArchieStep`, `__forgeArchieComplete`, `__forgeRun`, `__forgeEngine`.

**Viewport / renderer (read by view ops + perception):** `__forgeThree`,
`__forgeScene`, `__forgeRenderer`, `__forgeCamera`, `__forgeOrbit`,
`__forgeFitToBounds`, `__forgeVisibleBodies`, `__forgeSectionPlane`,
`__forgePerfHUD`, `__forgeHovered`, `__forgeHoverTooltip`, `__forgeWalk`.

**Overlays / panels opened from the shell menu/cmd:** `__forgeOpenCommandPalette`,
`__forgeOpenPathTracer`, `__forgeOpenRibbonCustomiser`, `__forgeOpenMaterialPicker`,
`__forgeOpenSelectionMode`, `__forgeOpenSection`, `__forgeOpenProjectFile`,
`__forgeOpenIfcExport`, `__forgeOpenDirectEdit`, `__forgeOpenHeal`,
`__forgeBuildEnvironment`, plus the ~350 `__forgeOpen<Workbench>` launchers
routed by `handleMenuAction`.

**Onboarding / role:** `__forgeStartTour`, `__forgeFinishTour`,
`__forgeTourActive`, `__forgeRoleApply`.

**Skeleton / regen:** `__forgeSkeleton`.

> Because the count is 1268, treat **any `window.__forge*` identifier as a public
> contract**: when refactoring a shell surface, grep `window.__forge<Name>` across
> the tree before renaming — the CommandPalette, ForgeRunner (Archie bridge),
> e2e specs, demo/render harnesses, and the per-workbench hosts all bind by exact
> name. The shell also dispatches/listens to ~190 `forge:<event>` CustomEvents
> (e.g. `forge:menu-action`, `forge:wb-changed`, `forge:section-update`,
> `forge:skeleton-update`, `forge:theme-changed`, `forge:selection-changed`,
> `forge:bodies-changed`) — preserve these event names identically.

---

# Appendix C — Prioritized change list

**P0 — credibility blockers (a reviewer hits these in the first 60 seconds):**
1. **Build an interactive ViewCube** (clickable faces/edges/corners + Home) into
   the `GizmoHelper` slot. (§5, `Viewport.jsx:251`)
2. **Wire the empty-canvas + body context-menu create/edit ops** (Create box…,
   Start sketch, Duplicate, Isolate, Material, Pattern, Mirror, Transform,
   Suppress, Hide) — no dead clicks. (§16 #1-2, `BodyContextMenu.jsx`,
   `ForgeShellV4.jsx:2964`)
3. **Add the two missing icons** `wb.part`, `wb.sketch`. (§9, `icons/Icon.jsx`)
4. **Stop the Archie dock from evicting the Inspector** — let tree + Archie
   coexist. (§7, `ForgeShellV4.jsx:3062`)

**P1 — pro-parity structure:**
5. **Convert the flat toolbar into a tabbed ribbon** with labeled hero buttons +
   split-button flyouts + sketch-context switching. (§2)
6. **Nest the 134-item Tools menu** into hover-submenus via the existing
   `HierarchicalToolsMenu`/`CALCULATOR_TREE`; add scroll + disabled states. (§1)
7. **Build a real PropertyManager** (editable params/material/mass) replacing the
   3-row Properties stub. (§4)
8. **Drive the status bar from real state** (units/snap/ortho/fps/savedAt) and
   make the toggles clickable. (§6)

**P2 — interaction polish:**
9. **Viewport hover pre-highlight + selection color convention + marquee select.**
   (§5, §14)
10. **Live preview + reference-pick loop + inline validation in `ToolParamDialog`.**
    (§8)
11. **Unify undo** through `opGraph`; resolve Cmd+K double-claim; add an editable
    keymap UI. (§15, §7)
12. **Blank-document welcome / new-from-template gallery**; make empty-states
    actionable. (§11)

**P3 — consistency / accessibility:**
13. **Fix the two dead onboarding selectors + the stale tour copy.** (§11)
14. **De-duplicate reused glyphs** for high-traffic ops; bundle fonts; raise the
    9px floor; add a density toggle; extract a shared `ForgePanel` chrome for the
    workbench panels. (§9, §12, §13, §8)
15. **Harden `Tooltip` cloneElement** + add rich tooltips. (§10)
