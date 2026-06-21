# Forge v4 — Design System

The professional, monochrome, engineering-grade design system for ArchDisc Forge
(desktop MCAD, Electron + React + Vite). Area agents building or refining UI
**must** follow this spec. It is the contract that keeps every workbench, panel,
dock, and HUD looking like one calm, dense, CATIA / SolidWorks / NX-grade
application.

## Files

| File | Role |
| --- | --- |
| `theme/forge-tokens.css` | `--fds-*` design tokens (color ramp, type scale, spacing, radii, control heights, z-index, motion). Additive over the shell's existing `tokens.css`. |
| `theme/forge-base.css` | Reusable `fds-*` base/control classes built on the tokens (buttons, inputs, panels, toolbars, ribbon, tree rows, status bar, scrollbars, tooltips, menus, focus rings). |
| `FORGE_DESIGN_SYSTEM.md` | This spec. |

Both CSS files are imported **once**, in `ForgeShellV4.jsx`, immediately after
`./tokens.css`. Do **not** re-import them per component.

### Relationship to the existing shell `tokens.css`

`forge-v4/tokens.css` already defines the **shell** vocabulary (`--forge-*`):
themes (dark / light / sepia / high-contrast), the 4-zone grid, and the
`.forge-*` shell classes. **Do not duplicate or override those.** The design
system layers on top:

- `--fds-*` tokens **derive from** the live `--forge-*` theme vars, so dark /
  light / sepia / high-contrast all keep working automatically.
- `fds-*` classes are **opt-in**: apply them to **new** markup. They never
  restyle existing `.forge-*` classes, so nothing in the current shell shifts.

---

## 1. Color — refined neutral / monochrome

**One restrained neutral accent, at most.** Everything else is a graphite / ink /
paper grey ramp. No chromatic theme, no garish color. The accent (inherited from
`--forge-accent`) is reserved for: active/selected state, focus ring, the cmd-bar
glyph, and a single primary CTA. Status colors (`ok` / `warn` / `error`) are
grey-tinted signals used **sparingly** (a 7px dot, a thin rule) — never as a fill
that competes with the accent.

### Surfaces (back-to-front elevation)
| Token | Use |
| --- | --- |
| `--fds-surface-sunken` | rails, wells (deepest) |
| `--fds-surface-base` | app background |
| `--fds-surface-raised` | toolbars, headers |
| `--fds-surface-panel` | panels, docks, popovers |
| `--fds-surface-overlay` | inset fields, list rows |
| `--fds-surface-overlay-2` | hovered / nested surface |
| `--fds-scrim` | modal / dropdown scrim |

### Borders
`--fds-border` (default 1px hairline) · `--fds-border-strong` (emphasized) ·
`--fds-border-subtle`. **Engineering precision = 1px hairlines.** No thick or
rounded-heavy borders.

### Text
`--fds-text-primary` (values, active labels) · `--fds-text-secondary` (default
body / controls) · `--fds-text-tertiary` (captions, section labels) ·
`--fds-text-disabled` (disabled / placeholder) · `--fds-text-on-accent`.

### Interaction states
`--fds-state-hover` · `--fds-state-active` · `--fds-state-pressed` ·
`--fds-state-selected` (+ `--fds-state-selected-bd` border). Hover/active are
neutral ink washes; **selected** uses the accent-soft fill + accent-rim border.

### Accent
`--fds-accent` · `--fds-accent-hover` · `--fds-accent-press` ·
`--fds-accent-soft` (fills) · `--fds-accent-rim` (borders).

### Focus & signals
`--fds-focus-ring` (+ `-width` `2px`, `-offset` `1px`) ·
`--fds-signal-ok` / `-warn` / `-error`.

### Elevation
`--fds-elev-0..4`, `--fds-elev-up` (bottom dock). Subtle, dark, engineering-grade
— not soft floating blobs. Chips `elev-1`, popovers `elev-2`, drawers `elev-3`,
tool docks `elev-4`.

---

## 2. Type scale — when to use each

Two stacks:
- **`--fds-font-ui`** — clean technical sans (Inter / system). All labels, body,
  buttons, menus.
- **`--fds-font-num`** — tabular-numeric mono (JetBrains Mono / SF Mono /
  ui-monospace). **Mandatory** for any dimension, coordinate, unit, count, or
  status readout so digits align and never reflow. Use the `.fds-num` class or
  set `font-variant-numeric: tabular-nums lining-nums`.

| Role | Size / line-height | Weight | Use for |
| --- | --- | --- | --- |
| `micro` | 11 / 14 | 400–500 | status bar, captions, `kbd`, tree values |
| `small` | 12 / 16 | 400–500 | **default** — controls, body, list rows, menus |
| `base` | 13 / 18 | 400 | primary body text, input values, cmd-bar input |
| `medium` | 14 / 20 | 500 | panel titles, prominent labels |
| `large` | 16 / 22 | 600 | dialog / drawer headers |
| `display` | 20 / 26 | 600 | welcome / empty states only |

Weights: `--fds-fw-regular` 400 · `--fds-fw-medium` 500 (preferred for labels &
active items) · `--fds-fw-semibold` 600 (titles only, sparingly).
Tracking: `--fds-tracking-label` `0.06em` for UPPERCASE section labels,
`--fds-tracking-caps` `0.08em` for toolbar group labels.

Helper classes: `.fds-micro .fds-small .fds-body .fds-medium .fds-title
.fds-display .fds-label .fds-num`.

---

## 3. Spacing & density — strict 8px

`--fds-space-3` (**8px**) is the base unit; `--fds-space-2` (4px) is the half-step
for dense controls. Ladder: `1`=2 · `2`=4 · `3`=8 · `4`=12 · `5`=16 · `6`=24 ·
`7`=32 · `8`=48.

**Density rules:**
- Panels: `--fds-space-4` (12px) padding. Sections separated by `--fds-space-5`.
- Control horizontal padding: `--fds-space-4`. Icon-button clusters: `--fds-space-1`.
- This is a **dense pro tool**: prefer tight, scannable layouts over airy ones.
  Never pad a panel like a marketing page.

Radii: `--fds-radius-xs` 2 (chips/swatches) · `-sm` 3 (inputs) · `-md` 4
(buttons/tools, **default**) · `-lg` 8 (docks/dialogs) · `-pill`.
Border widths: `--fds-border-w` 1 · `--fds-border-w-2` 2 (active tab underline).

---

## 4. Control sizing — compact ladder

| Token | px | Use |
| --- | --- | --- |
| `--fds-control-h-xs` | 22 | QAT icons, inline pickers, mini chips |
| `--fds-control-h-sm` | 24 | compact buttons, menu items |
| `--fds-control-h-md` | 28 | **default** input / select / button |
| `--fds-control-h-lg` | 32 | primary tool buttons, ribbon icons |
| `--fds-row-h` | 24 | tree / list / property rows |
| `--fds-row-h-compact` | 22 | densest tree rows |

Icons: `--fds-icon-sm` 14 · `-md` 16 (default in controls) · `-lg` 20 ·
`-xl` 24 (workbench rail glyphs).

Never invent off-ladder heights. A button is 22 / 24 / 28 / 32 — nothing else.

---

## 5. Anatomy — where things live

The shell (`ForgeShellV4`) is a fixed CSS grid (see `tokens.css` header diagram):

```
topbar (40) ─ logo · menus · workbench chip
qat (32)    ─ quick-access icons
[ wb-rail 72 | toolbar 48 / viewport (fills) / statusbar 26 | right-panel 340 ]
cmdbar (52) ─ Archie command bar (always on)
```

- **Top bar** — brand, top menus, active-workbench chip. `--fds-surface-base`.
- **Workbench rail** (left, 72px) — vertical icon+label tabs; active tab gets the
  accent left-bar + `state-selected`. Glyphs `--fds-icon-xl`.
- **Toolbar / ribbon** — grouped tool buttons (`--fds-control-h-lg`) with
  `--fds-tracking-caps` group labels. Use `.fds-toolbar` / `.fds-ribbon` for new
  surfaces. **Strategically distribute tools** across ribbon tabs / sidebars /
  right-clicks / menus — never a flat 30-entry list.
- **Viewport** — the 3D canvas. Carries `data-testid="forge-v4-canvas"`. HUD
  overlays (nav sphere, heads-up toolbar, confirmation corner, rollback) float at
  `--fds-z-viewport-hud` (5) with a blurred translucent dark background and a 1px
  border; they must **never** obstruct the model center.
- **Right panel** (340px) — feature tree (top) + properties (bottom), each a
  `.fds-panel`-style section with an uppercase `.fds-section-head`.
- **Status bar** (26px) — `.fds-statusbar`, tabular-numeric, units / snap / fps /
  selection readouts.
- **Command bar** (52px, always on) — the Archie input. Accent caret + glyph.
- **Tool param dock / library / bottom preview / drawers** — floating
  `.fds-panel` surfaces at the correct `--fds-z-*` layer.

### Viewport HUD rules
Translucent dark backdrop + `backdrop-filter: blur` + 1px `--fds-border` +
`--fds-radius-md`. Keep them at screen edges. They are the only place a slightly
transparent surface is allowed; everywhere else is opaque.

---

## 6. Z-index — single authority

Use `--fds-z-*`; never write a raw z-index magic number.
`viewport-hud` 5 · `sticky` 50 · `dock` 600 · `library` 700 · `drawer` 1280 ·
`overlay` 1300 · `popover` 1500 · `tooltip` 1800 · `toast` 2000.

---

## 7. Motion

`--fds-dur-fast` **120ms** (hover / press / color feedback) ·
`--fds-dur-base` **180ms** (panel reveal, width transitions), both with
`--fds-ease` `cubic-bezier(.22,1,.36,1)`. Shorthands `--fds-motion-fast` /
`--fds-motion-base`. **No bounce, no spring, no decorative animation** — this is
engineering software. Respect `prefers-reduced-motion` (the tokens collapse
durations automatically).

### Shared motion / interaction-state utilities (`forge-base.css` §12)

So every area speaks one state language without re-authoring transitions, a
kit of **opt-in** motion utilities is provided. Apply them to your own markup;
they never restyle existing `.forge-*` shell classes or any testid'd node, and
they are reduced-motion-safe.

- **Transitions:** `.fds-transition` (all common state props) ·
  `.fds-transition-colors` · `.fds-transition-transform` · `.fds-transition-base`
  · `.fds-transition-none`.
- **Interactive surface:** `.fds-interactive` (pointer + hover/active/pressed/
  disabled washes) · `.fds-hoverable` · `.fds-ghost` (transparent→1px-hairline
  reveal) · `.fds-pressable` (0.5px tactile dip) · `.fds-selectable` (accent
  selected fill, keyed off `.is-selected` / `[data-active]` / `[data-selected]`
  / `aria-pressed` / `aria-selected`) · `.fds-disabled`.
- **Focus:** `.fds-focus-ring` (canonical 2px accent ring) ·
  `.fds-focus-ring--inset` (box-shadow ring for clipped containers).
- **Surfaces:** `.fds-surface-anim` (opacity/transform reveal) ·
  `.fds-collapsible` / `--w` / `--h` (standardized width/height transitions).
- **Reveals (single, non-looping):** `.fds-pop-reveal` · `.fds-anim-fade-in` ·
  `.fds-anim-pop-in` · `.fds-anim-slide-in-right` · `.fds-anim-slide-in-up`.
- **Working signals (the only allowed loops, reserved for active process):**
  `.fds-pulse` (opacity breathe) · `.fds-spin`.
- **Scrollbars:** `.fds-scroll-thin` (per-surface thin) · `.fds-scroll-hidden`.

---

## 8. Iconography

- Line icons, **1.5px stroke**, 16px box (`--fds-icon-md`) in controls; 24px on
  the workbench rail. Use the existing `forge-v4/icons` set; match its style.
- `currentColor` only — icons inherit text color and theme automatically. Never
  hard-code an icon color.
- One visual metaphor per concept across the whole app; do not mix filled and
  line styles in the same surface.

---

## 9. Interaction & state rules

- **Hover**: neutral ink wash (`--fds-state-hover`) + reveal a 1px border on
  ghost controls.
- **Active / pressed**: `--fds-state-active` / `--fds-state-pressed`.
- **Selected / toggled-on**: `--fds-state-selected` fill + `--fds-state-selected-bd`
  (accent) border. This is the **only** place the accent appears as a fill on a
  control.
- **Disabled**: `--fds-text-disabled`, `cursor: not-allowed`, no hover response.
- **Focus**: keyboard/AT only — `:focus-visible` shows the 2px accent ring;
  mouse focus shows nothing. Already wired app-wide; do not remove it.
- **Numeric fields**: always tabular (`.fds-input--num` or `.fds-num`),
  right-aligned in dimension contexts.
- Reuse the `fds-*` primitives (`.fds-btn`, `.fds-icon-btn`, `.fds-input`,
  `.fds-select`, `.fds-panel`, `.fds-tree-row`, `.fds-chip`, `.fds-menu`,
  `.fds-tooltip`, `.fds-statusbar`) before writing bespoke CSS.

---

## 10. Hard constraints — do NOT break the app

This is a working, shipping CAD application. Changes are **visual + UX + layout
only**.

**Do:**
- Add `fds-*` classes / `--fds-*` tokens to new or lightly-refined markup.
- Keep edits additive and surgical; mirror the existing React + CSS idiom.
- Keep imports exact-pinned. Keep JSX well-formed, mirroring sibling components.

**Don't:**
- ❌ Rename or remove **any** `data-testid` (`forge-v4-canvas`, `forge-cmdbar`,
  `forge-cmdbar-input`, `forge-cmd-palette-input`, `forge-cmd-palette-results`,
  `forge-cmd-palette-overlay`, `forge-archie`, `forge-archie-msg`,
  `forge-archie-cancel`, `forge-app`, `forge-viewport`, `forge-topbar`,
  `forge-statusbar`, `forge-right`, `forge-body-list`, `forge-bodies-section`, …).
  e2e tests and the Archie CUA select on them.
- ❌ Touch any `window.__forge*` hook, `runArchie` / `ForgeRunner` /
  `ForgeToolBridge` wiring, `forge:menu-action` events, or any `onClick` /
  handler behavior. No logic / behavior changes, no removed features.
- ❌ Introduce chromatic / garish color, a second accent, or override the shell's
  `--forge-*` theme vars / `.forge-*` classes.
- ❌ Run `npm run build` or Playwright (the orchestrator owns the consolidated
  build + headed e2e). Do not add npm packages or `@font-face` web fonts — the
  type stacks are pure system/web-safe fallbacks by design.
- ❌ Invent off-ladder spacing, sizes, radii, or z-index values.

---

## Quick reference — token name index (for area agents)

**Surfaces:** `--fds-surface-{sunken,base,raised,panel,overlay,overlay-2}`,
`--fds-scrim`
**Borders:** `--fds-border`, `--fds-border-strong`, `--fds-border-subtle`,
`--fds-border-w`, `--fds-border-w-2`
**Text:** `--fds-text-{primary,secondary,tertiary,disabled,on-accent}`
**States:** `--fds-state-{hover,active,pressed,selected,selected-bd}`
**Accent:** `--fds-accent`, `--fds-accent-{hover,press,soft,rim}`
**Focus:** `--fds-focus-ring`, `--fds-focus-ring-width`, `--fds-focus-ring-offset`
**Signals:** `--fds-signal-{ok,warn,error}`
**Elevation:** `--fds-elev-{0,1,2,3,4,up}`
**Type:** `--fds-font-{ui,num}`, `--fds-font-feature-num`,
`--fds-fs-{micro,small,base,medium,large,display}`,
`--fds-lh-{micro,small,base,medium,large,display}`,
`--fds-fw-{regular,medium,semibold}`,
`--fds-tracking-{tight,normal,label,caps}`
**Spacing:** `--fds-space-0..8`
**Radii:** `--fds-radius-{xs,sm,md,lg,pill}`
**Controls:** `--fds-control-h-{xs,sm,md,lg}`, `--fds-row-h`, `--fds-row-h-compact`,
`--fds-icon-{sm,md,lg,xl}`
**Z-index:** `--fds-z-{base,viewport-hud,sticky,dock,library,drawer,overlay,popover,tooltip,toast}`
**Motion:** `--fds-ease`, `--fds-dur-{fast,base}`, `--fds-motion-{fast,base}`

**Base classes:** `.fds-btn` (`--primary`/`--ghost`/`--sm`/`--lg`),
`.fds-icon-btn` (`--xs`/`--lg`), `.fds-input` (`--num`), `.fds-select`,
`.fds-textarea`, `.fds-field`, `.fds-panel` (+ `-header`/`-body`/`-footer`),
`.fds-section` (+ `-head`), `.fds-divider`, `.fds-toolbar` (+ `-group`/`-group-label`),
`.fds-ribbon` (+ `-tabs`/`-tab`), `.fds-segmented` (+ `-item`),
`.fds-tree` (+ `-row`/`-twisty`/`-icon`/`-label`/`-value`/`-children`),
`.fds-prop-row` (+ `-key`/`-val`), `.fds-statusbar` (+ `-item`/`-spacer`),
`.fds-chip`, `.fds-badge`, `.fds-dot` (`--ok`/`--warn`/`--error`/`--idle`),
`.fds-tooltip`, `.fds-kbd`, `.fds-menu` (+ `-item`/`-item-shortcut`/`-sep`).

**Motion / state utilities (§12):** `.fds-transition` (+ `-colors`/`-transform`/
`-base`/`-none`), `.fds-interactive`, `.fds-hoverable`, `.fds-ghost`,
`.fds-pressable`, `.fds-selectable` (`.is-selected`), `.fds-disabled`,
`.fds-focus-ring` (+ `--inset`), `.fds-surface-anim`, `.fds-collapsible`
(+ `--w`/`--h`), `.fds-pop-reveal`, `.fds-anim-{fade-in,pop-in,slide-in-right,slide-in-up}`,
`.fds-pulse`, `.fds-spin`, `.fds-scroll-thin`, `.fds-scroll-hidden`.
