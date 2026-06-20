# Forge — UI/UX Current State (Honest Assessment)

Date: 2026-06-20
Scope: the React frontend under `frontend/src/`.
Pairs with: `UIUX_INDUSTRY_BENCHMARK.md` (NOTE: not present in the repo at the
time of writing — see *Honest gaps* below).

Honesty rules followed (Forge Engineering Bible 0/9): every repo claim cites a
real `path:line`; nothing is fabricated; where something is orphaned, untested,
or unverifiable it is marked explicitly. I assessed the **code and stylesheets**,
not a running screenshot — I did not boot the app, so this is a static-source
audit, not a pixel review. Items that require seeing it rendered are marked
**UNVERIFIED (needs running app)**.

---

## 0. The single most important finding: there are FOUR token systems, and the
## live shell is only one of them

`frontend/src/App.jsx:2` imports and `:??` renders **`ForgeShellV4`** directly:

```
import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';
```
(`App.jsx:2`; mounted at `ForgeShellV4.jsx:131` / `:2976` `<div className="forge-app">`)

`main.jsx` mounts `App` and nothing else (`main.jsx` — 6 lines, renders `<App/>`).

Tracing imports, the live UI tree is **`forge-v4/` exclusively**:
`TopBar.jsx`, `Toolbar.jsx`, `WorkbenchRail.jsx`, `RightPanel.jsx`,
`StatusBar.jsx`, `CommandBar.jsx`, `Viewport.jsx`, `ArchieDock.jsx`,
`FeatureTree.jsx` — all under `forge-v4/`, all styled by `forge-v4/tokens.css`
(imported at `ForgeShellV4.jsx:7`).

**Three of the eight files I was asked to assess are NOT in the live app:**

| File asked to assess | Status | Evidence |
|---|---|---|
| `components/RibbonToolbar.jsx` (+ `.css`) | **ORPHANED** — only imported by `workbenches/mechanical-cad/WorkbenchMechanical.jsx` and sibling `components/Workbench.jsx`; neither is reachable from `App.jsx` | `grep -rln RibbonToolbar` → `WorkbenchMechanical.jsx`, `components/Workbench.jsx`, …; `App.jsx` does **not** import either |
| `components/SwUxOverlays.jsx` (+ `.css`) | **ORPHANED** — same `WorkbenchMechanical` tree only | importers are all `components/*` + `workbenches/mechanical-cad/*`; none in the `App → ForgeShellV4` tree |
| `components/FeatureTreePanel.css` | **ORPHANED** — `components/FeatureTreePanel` imported only by `WorkbenchMechanical.jsx` | the live tree uses `forge-v4/FeatureTree.jsx` instead |
| `components/PropertyManager.css` | **ORPHANED** — `components/PropertyManager` imported only by `WorkbenchMechanical.jsx` | the live tree uses `forge-v4/RightPanel.jsx` |
| `styles/index.css` | **ORPHANED** — no importer found anywhere | `grep -rln 'styles/index.css'` → no matches; `main.jsx`/`App.jsx` import no `.css` |
| `forge-app/styles.css` | **ORPHANED** — no `import` anywhere; a sibling file even calls it "legacy … kept temporarily" | `grep -rn 'forge-app/styles'` → only a comment in `forge-app/design-system/index.js:8` |
| `forge-v4/ForgeShellV4.jsx` | **LIVE** | `App.jsx:2` |
| `forge-v4/Viewport.jsx` | **LIVE** | imported by `ForgeShellV4.jsx:19` |

Token-system separation, measured:
- `var(--forge-*)` (the live system, defined in `forge-v4/tokens.css`): referenced by **272** files under `forge-v4/` (`grep -rl 'var(--forge-' forge-v4/ | wc -l`).
- `var(--bg-secondary)` / `var(--accent,…)` (the orphaned `components/` system, default blue `#4a90d9`): referenced by **0** files under `forge-v4/`.

The four palettes are mutually incompatible:

| System | Canvas | Accent | Where |
|---|---|---|---|
| `forge-v4/tokens.css` (**LIVE**) | `#000000` OLED black (`tokens.css:36`) | **monochrome** white `#ebecef` in dark / graphite in light (`tokens.css:53`, `:84`) — "no chromatic break" (`tokens.css:51-52`) | the app |
| `components/*` defaults | `#16162a` navy-purple (`RibbonToolbar.css:13`) | blue `#4a90d9` (`RibbonToolbar.css:51`, `FeatureTreePanel.css:86`, `PropertyManager.css:26`) | orphaned WorkbenchMechanical |
| `styles/index.css` | `#000000` w/ "matte black" greys (`index.css:17-37`) | matte black `#1d1d1d` (`index.css:27`) | orphaned, no importer |
| `forge-app/styles.css` | `#14171c` (`styles.css:15`) | blue `#4aa3ff` (`styles.css:18`) | orphaned, self-described legacy |

**Conclusion for this section:** the *live* product (`forge-v4`) is far more
coherent than the file list suggests. Most of the "templated/inconsistent"
material in the assessed files is **dead code from a prior generation
(`WorkbenchMechanical`) that the v4 rewrite replaced but never deleted.** The
honest UX risk is not that the live UI is inconsistent — it's that the repo
carries ~3 abandoned UI generations that will mislead anyone (including future
agents) about what ships, and that the `components/` blue-accent assets visibly
contradict the live monochrome brand if ever re-mounted by mistake.

---

## 1. Layout structure (LIVE shell — `forge-v4/tokens.css:213-248`)

The live shell is a clean CSS-grid app shell with **non-overlapping zones** —
a genuine strength:

```
topbar (40px) → qat (32px) → [wb-rail 72px | toolbar 48px | viewport | right 340px] → statusbar (26px) → cmdbar (52px)
```
(`tokens.css:215-236`; rail/right widths `tokens.css:175-178`)

Strengths (built & verifiable in source):
- A proper professional MCAD frame: left **workbench rail** (vertical
  discipline tabs, `tokens.css:419-469`), contextual **toolbar**, **viewport**,
  right **property/tree** column, **status bar**, plus an always-on **Archie
  command bar** at the bottom (`tokens.css:964-1058`). This maps to the
  SolidWorks/Fusion frame conventions.
- 4px spacing grid declared and used consistently (`tokens.css:164-172`,
  comment `tokens.css:29`).
- The Archie dock cleanly **reflows the grid** rather than floating over content:
  `forge-app[data-archie-open="true"]` swaps the right column width
  (`tokens.css:237-239`). Good discipline.
- Documented intent that "no element overlaps any other" (`tokens.css:29`) — and
  the grid backs that up.

Weaknesness / risks:
- The right column is a **fixed 340px** (`tokens.css:177`) with only a binary
  collapse to 36px (`tokens.css:178`, `:918-920`) — no user-draggable resize
  found. Professional MCAD lets users drag panel widths. **(gap)**
- Several secondary panels are `position: fixed` with hard-coded offsets
  computed from zone-height variables (e.g. tool dock `tokens.css:539-551`,
  library `:704-716`, preview `:780-793`). These are correct *today* but are
  brittle — they re-derive the grid geometry by hand instead of living in the
  grid, so any zone-height change silently misaligns them.

---

## 2. Ribbon / command organisation

Two very different stories depending on live vs orphaned:

### LIVE: `forge-v4/Toolbar.jsx` — a contextual icon toolbar (NOT a ribbon)
- Per-workbench tool groups with labels, icon buttons, tooltips + `aria-label`
  (`Toolbar.jsx:191-210`). Icon-only buttons (`Icon name={t.icon} size={18}`,
  `:210`) with `Tooltip` hover (`:200`). This is the cleaner, more modern
  surface and matches the monochrome brand.
- Grouped by category with uppercase group labels (`Toolbar.jsx:198`,
  styled `tokens.css:490-499`).

### ORPHANED: `components/RibbonToolbar.jsx` — a real ribbon, but bloated
- Genuinely ribbon-shaped: tab strip + grouped two-row tool columns with
  horizontal scroll (`RibbonToolbar.css:97-125`, `:64-73`), SolidWorks/Fusion
  convention, and per-tab accent colours (`RibbonToolbar.css:198-224`).
- **But the content is a maintenance red flag.** The `part` tab's **`Sculpt`
  group alone has ~140 buttons** (`RibbonToolbar.jsx:254-403`) — "Sculpt
  Whiffle Ball", "Sculpt Dumbbell", "Sculpt Coin", etc. — a flat dump of every
  demo recipe into one ribbon group. This is exactly the "30-entry flat list"
  anti-pattern the project's own memory warns against. It is **not in the live
  app**, but it is the single most unprofessional artefact among the assessed
  files.
- Icons are **single Unicode glyphs** (`RibbonToolbar.jsx:93-100` etc.:
  `⬜ ⬭ ● △ ◎`), with only the "top ~30 most-used" getting hand-drawn SVGs via
  `TOOL_ICONS` (`RibbonToolbar.jsx:734-746`). The glyph fallback renders
  inconsistently across platforms/fonts and reads as placeholder-grade. The
  live `forge-v4` toolbar avoids this by using a real `Icon` component.

Net: the **live** command surface is clean but is a contextual toolbar, not a
ribbon — which is a legitimate design choice but is *less* discoverable than a
ribbon for a tool-dense MCAD app. The ribbon that exists (`components/`) is
better-organised structurally but is dead and over-stuffed.

---

## 3. Feature tree

- LIVE tree is `forge-v4/FeatureTree.jsx` styled with `--forge-*` tokens
  (consistent with the shell).
- The assessed `components/FeatureTreePanel.css` is the **orphaned** tree. On its
  own merits it is actually well-built: connector dots/lines (`:97-122`),
  selected/suppressed/error states (`:84-95`), inline rename
  (`:271-280`), drag-reorder affordances (`:262-268`), a rollback marker
  (`:283-305`), and a context menu (`:313-365`). These are professional MCAD
  feature-tree behaviours. The problem is purely that it's the wrong-generation
  file using the blue `#4a90d9` accent (`:86`, `:301` orange `#ff6b35`) that
  clashes with the live monochrome brand.

**Honest gap:** I did not read `forge-v4/FeatureTree.jsx` itself (not in the
assigned file list), so I cannot certify the *live* tree has parity with the
orphaned one's affordances. **UNVERIFIED.**

---

## 4. Selection / contextual UI

### ORPHANED: `components/SwUxOverlays.jsx` (+ `.css`) — high-quality, but dead
This file is, ironically, some of the **best** UX work in the assessed set —
and it is not in the live app. It implements SolidWorks-convention overlays:
- Confirmation Corner (green-check / red-X commit/cancel) (`SwUxOverlays.jsx:76-102`).
- Heads-Up View Toolbar with orientation + display-style dropdowns
  (`:264-416`).
- A docked PropertyManager with collapsible sections, `=expr` parametric
  inputs, and a vector picker (`:503-963`).
- Live sketch-state badge (under/fully/over-defined + DoF) (`:985-1034`).
- Cursor X/Y readout, auto-relation ghost, inline dimension editor
  (`:1043-1287`).

Its CSS even defines a **deliberate, documented unified token set** and a
quadrant-placement map so overlays never collide (`SwUxOverlays.css:1-77`,
ASCII diagram `:24-50`). This is the most disciplined stylesheet in the whole
set — and it targets `--sw-*` tokens scoped to `.workbench-viewport`
(`SwUxOverlays.css:52-77`), which the live shell does not render.

The live shell has its **own** equivalents (`forge-v4` `ConfirmationCorner` in
`tokens.css:621-656`, `HeadsUpToolbar.jsx`, `RollbackBar.jsx`,
`BodyContextMenu.jsx`, `SketchStateBadge.jsx` — all imported by
`ForgeShellV4.jsx:31-38`). So the capability exists in the live app, just
re-implemented. **Whether the live versions are as polished as the orphaned
`SwUxOverlays` ones is UNVERIFIED** (I read the dead file, not all the live
counterparts).

---

## 5. Viewport navigation (LIVE — `forge-v4/Viewport.jsx`)

Strengths (built & verifiable):
- r3f/three/drei lazy-loaded with SSR-safe fallback (`Viewport.jsx:95-131`).
- Proper CAD reference frame: origin XYZ triad with arrowheads + dashed
  negative axes + labels (`OriginAxes`, `:266-319`), drei `GizmoHelper`
  view-cube bottom-left (`:251-256`), infinite themed `Grid` (`:215-222`).
- Real engineering features: section/clipping planes with a live gizmo
  (`SectionGizmo` `:153-172`, `ClippingUpdater` `:137-147`), edge/face picking
  (`EdgePickOverlay` `:374-422`, face-id raycast `:711-719`), transform gizmos
  (`:235-244`), smart camera-fit (`__forgeFitToBounds` `:463-489`), animated
  view transitions (`CameraCenterEffect` easeInOutQuad `:510-523`).
- Serious scale engineering: octree frustum culling + LOD streaming +
  instancing for the 100k-part regime (`OctreeCullingTicker` `:922-968`,
  `LodSchedulerTicker` `:970-1034`, `InstancedGroup` `:1036-1208`), with a
  `visible / total` chip that only appears above 50 bodies (`ViewportHUD`
  `:1210-1265`). This is genuinely beyond hobby-grade.
- PBR material path for flagship renders (`meshPhysicalMaterial`,
  `:744-754`); role-based body colouring so a V12 reads as an engine, not a
  candy bowl (`colorForBody` `:781-823`).

Weaknesses / honesty:
- Theme handling has an inconsistency: `getBgColor` checks
  `theme === 'contrast'` (`Viewport.jsx:543`) but the theme value the shell
  actually sets is `'high-contrast'` (`ForgeShellV4.jsx:231`,
  `tokens.css:129`). So the high-contrast viewport background branch is likely
  **dead** — the viewport falls through to the default dark bg in HC mode.
  **(bug, low severity)**
- Background is set two ways — a `<color attach>` inside the canvas
  (`Viewport.jsx:211`) and a CSS radial gradient on `.forge-viewport`
  (`tokens.css:530-536`). The CSS gradient is occluded by the opaque GL canvas,
  so it only shows pre-load. Minor redundancy, not a defect.
- The viewport HUD was deliberately stripped ("viewport is now bare", comment
  `Viewport.jsx:1210-1214`) in favour of the status bar — a defensible
  less-is-more call, but it means no always-on view-name/scale-bar in-canvas.

---

## 6. Theming, color tokens

- **LIVE system is genuinely good and on-brand.** `forge-v4/tokens.css` defines
  4 themes (dark/light/sepia/high-contrast, `:33-155`) from one token set, all
  monochrome-by-design (`:51-52`), switched by a single
  `data-forge-theme` attribute (`ForgeShellV4.jsx:219-223`). Theme changes are
  event-synced across panels (`:229-240`). WCAG focus-visible ring is wired
  (`tokens.css:1108-1116`). This is the strongest part of the UI.
- **The repo-wide token story is the weakness.** Four parallel token systems
  exist (see §0), three orphaned. The orphaned `components/` files default to a
  blue `#4a90d9` accent that directly violates the live "no chromatic break"
  rule (`tokens.css:51`). If any orphaned tree is ever re-mounted, the brand
  breaks instantly.

---

## 7. Typography

- LIVE: Inter UI font + JetBrains Mono for numeric/code, one declaration
  (`tokens.css:194-196`), base 12px/1.4 (`:208-209`). Consistent.
- ORPHANED files use `'Consolas', monospace` (`SwUxOverlays.css:442`,
  `PropertyManager.css:36` uses `'JetBrains Mono'`) — i.e. each generation
  picked its own mono font. Cosmetic, and dead, but it's another sign of the
  multi-generation drift.
- No fluid/scaled type ramp found; sizes are hard-coded per component
  (9–13px). Typical for desktop CAD; fine.

---

## 8. Information density

- LIVE toolbar/rail/status are tuned to a "comfortable" 36px tool row
  (`tokens.css:181`) — readable, not cramped.
- The orphaned ribbon's `Sculpt` 140-button group (`RibbonToolbar.jsx:254-403`)
  is the opposite extreme — pathologically over-dense. Again: dead, but it's the
  worst density offender in the set.

---

## 9. Polish — what's already good vs. what reads templated

**Already good (live):**
- The grid shell, zone discipline, and Archie-dock reflow (§1).
- The monochrome 4-theme token system (§6).
- The viewport engineering — culling/LOD/instancing/section/PBR (§5).
- Tooltips + `aria-label` + focus-visible accessibility hooks.

**Reads templated / unprofessional / inconsistent:**
- **Unicode-glyph icons** in the orphaned ribbon (`RibbonToolbar.jsx:93-100`,
  hundreds of `◎ ⬭ ⊞ ✦` glyphs). Placeholder-grade; renders differently per
  OS. (Dead, but if the ribbon is ever revived this is the first thing a
  reviewer will flag.)
- **Four token systems / three dead UI generations** left in the tree (§0).
  This is the clearest "unfinished refactor" smell.
- Hard-coded `position:fixed` panel offsets re-deriving grid geometry
  (`tokens.css:539-551`, `:704-716`, `:780-793`) — fragile.
- The `'high-contrast'` vs `'contrast'` viewport-bg mismatch (§5) — small, but
  it's a real broken branch.

---

## Honest gaps in THIS assessment

1. **No running app.** This is a static source/style audit. Anything about how
   it actually *looks* rendered (alignment in practice, contrast in a real
   panel, whether overlays truly never collide) is **UNVERIFIED**. To close
   this, boot the Electron shell and capture multi-angle screenshots.
2. **`UIUX_INDUSTRY_BENCHMARK.md` does not exist** in the repo
   (`ls UIUX_* → no matches`). I was told this file pairs with it; I could not
   read it, so I did not benchmark against whatever specific competitor numbers
   it contains. Cross-checking against it is a TODO once it exists.
3. **I assessed the files I was given, not the live equivalents.** Three of the
   assigned files (`RibbonToolbar`, `SwUxOverlays`, `FeatureTreePanel.css`,
   `PropertyManager.css`) are orphaned. The *live* counterparts
   (`forge-v4/Toolbar.jsx`, `forge-v4/HeadsUpToolbar.jsx`,
   `forge-v4/FeatureTree.jsx`, `forge-v4/RightPanel.jsx`) were only partially
   read. A full live-shell UX review should read those directly.
4. I did **not** verify nothing else (e.g. a settings router, a hash route, a
   build flag) re-mounts the orphaned `WorkbenchMechanical` tree. The evidence
   strongly says it's dead (`App.jsx` → `ForgeShellV4` only, no router import
   found), but I did not exhaustively prove un-reachability. **Mostly verified,
   not certified.**

## One-line takeaway

The **live Forge UI (`forge-v4`) is a coherent, professional, monochrome MCAD
shell** with a strong grid layout, a real 4-theme token system, and a
genuinely advanced viewport — but the repo also carries **three abandoned UI
generations** (the `components/` ribbon+overlays, `styles/index.css`, and
`forge-app/styles.css`) whose blue-accent, glyph-icon, 140-button-group
artefacts are the source of every "templated/inconsistent" impression and
should be deleted to prevent brand regressions and reviewer confusion.
