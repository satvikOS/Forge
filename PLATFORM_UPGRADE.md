# PLATFORM_UPGRADE.md — Forge: the prioritized, industry-grounded plan

**Goal.** Make the Forge platform (1) fully capable and more, (2) bring its UIUX to
fully-professional, industry-grounded quality, and (3) deliver the unified native kernel
(no external deps, no duplicate engines, no stubs/fallbacks).

This is a **synthesis** of six audits authored 2026-06-20 against the working tree at
`/Users/account_clawteam1/archdisc-Mech`. It does not re-derive their evidence; it
prioritizes their findings into three ordered tracks with a **validation gate per
increment**, then names the **Phase 1** first moves.

> **Source audits (read these for the underlying `file:line` / URL evidence):**
> `FORGE_PLATFORM_INVENTORY.md` (capability), `UIUX_CURRENT_STATE.md` (live UI audit),
> `UIUX_INDUSTRY_BENCHMARK.md` (competitor-grounded checklist),
> `COMMUNITY_TRENDS.md` (public-pain-point → roadmap map),
> `KERNEL_UNIFICATION.md` (one-kernel architecture + 7-9wk phased plan),
> `KERNEL_PARITY.md` (per-op PARITY/PARTIAL/NOT-STARTED matrix).

---

## 0. Honesty contract (Forge Engineering Bible §0/§9)

Every claim below is either **[BUILT&VALIDATED]** (a cited audit ran a test or read
`file:line`), **[TARGETED]** (planned, not yet built — explicit TODO), or
**[UNVERIFIED]** (plausibly present, not confirmed this pass). No fabricated numbers, no
stubs dressed as working, no plausible-but-unmeasured figures. A correct "not built"
beats a fake "working". Each increment is marked **actionable-now** or **aspirational**.

### 0.1 Two reconciliations I resolved before prioritizing (don't propagate the stale claims)

- **OCCT version is 7.9.3 — verified on this build machine, this session.**
  `FORGE_PLATFORM_INVENTORY.md` gap #12 flagged "7.9.3" as "likely wrong / unverified"
  because upstream's public release list shows 7.8 then 8.0.0. That doubt is now
  **closed by direct evidence**: `brew list --versions opencascade` → `opencascade
  7.9.3`, and `/opt/homebrew/opt/opencascade/include/opencascade/Standard_Version.hxx`
  → `#define OCC_VERSION_COMPLETE "7.9.3"` (read this session). `KERNEL_UNIFICATION.md`
  and `KERNEL_PARITY.md` cite the same header and are correct. **Resolution:** 7.9.3 is a
  real, brew-installed OCCT build (a homebrew/local revision, not necessarily on
  upstream's headline release page). The honest residual gap is only that the version is
  **not pinned in-repo** (it floats with brew) — fix is a one-line CMake assertion (Track
  C, increment C0). Do **not** keep repeating "7.9.3 is probably wrong."

- **The "live platform" is `forge-v4/` only — three other UI generations are dead.**
  Confirmed this session: `App.jsx:2` imports `ForgeShellV4`; `frontend/src/styles/index.css`
  has **zero importers**; `forge-app/` and `mechanical-cad/ToolExecutionEngine.js` are
  **not imported under `forge-v4/`**. Every UIUX increment below targets the **live
  `forge-v4` tree**; the dead trees are a cleanup item (Track B, B0), not the product.

---

## Session log — 2026-06-20: Phase 1 increments LANDED (honest status)

These "Phase 1" items are now **[DONE&VALIDATED]** in the working tree (uncommitted, pending review):

- **B0 — dead UI generations deleted.** Removed **272 files**: `frontend/src/forge-app/`,
  `frontend/src/components/`, `frontend/src/workbenches/`, `frontend/src/styles/index.css`.
  Safety proven 4 ways before deletion (506-file BFS import-closure with 0 reachable in those
  dirs; relative + bare-specifier grep; no vite alias; no e2e references) and **confirmed by
  `vite build` EXIT=0 (✓ 4.18s)** afterward. The live shell is now `forge-v4/` exclusively —
  one token system.
- **B0 guard — brand-guard test** (`frontend/src/__tests__/brand-guard.test.mjs`) wired into
  `npm test`; fails if `#4a90d9` / `var(--bg-secondary)` or the dead stylesheets reappear in the
  live tree. GREEN; proven to fail on injected regressions.
- **A1 — bridge↔prompt contract test** (`frontend/src/ai/__tests__/bridge-prompt-contract.test.mjs`);
  asserts the 93 trained prompt ids ⊆ 105 `ForgeToolBridge` verbs. GREEN; proven non-vacuous.
- **B4 — high-contrast viewport theme bug fixed** (`Viewport.jsx`: `'contrast'` → `'high-contrast'`).
- **B3 (partial) — feature-tree connector spine** ported into live `forge-v4/FeatureTree.jsx`;
  6/10 overlay affordances confirmed already at parity (no port). Remaining gaps stay
  **[TARGETED]**: `=expr` parametric resolver, CSYS vector picker, and 3 sketch overlays
  (cursor readout / auto-relation ghost / inline dimension editor) that need sketch-event
  channels not yet confirmed in forge-v4.

- **A6 — native-kernel CI** (`.github/workflows/kernel-tests.yml`, SEPARATE from the release
  pipeline): a `kernel` job (macOS) `brew install`s OCCT 7.9/Eigen/Boost, builds
  `forge-kernel.node`, runs `forge:kernel:test` + `forge:bridge:test`; a `guards` job (ubuntu)
  runs the frontend guards. Every command **validated locally** (`forge:kernel:test` EXIT=0
  `[assembly-hierarchy] ALL PASS`; `forge:bridge:test` EXIT=0 `[bridge-smoke] PASS`); CI-green is
  pending a push (Actions can't be run locally — stated honestly).
- **C0 — OCCT version pin + dependency ratchet.** `forge-kernel/CMakeLists.txt` now hard-errors on
  an OCCT major.minor ≠ 7.9 (**validated**: configure prints `OCCT 7.9.3 … pinned to 7.9.x`).
  `frontend/src/__tests__/deps-allowlist.test.mjs` (wired into `npm test`) fails on any
  un-reviewed new dependency and WARNs the 2 WASM CAD runtimes as sunset-pending. Kernel
  predicate decision recorded in `KERNEL_UNIFICATION.md §4`: **re-derive from scratch**; OCCT is
  the accepted foundation (removing it = separate multi-year track).

**Still open in Phase 1:** B1 (headed **Playwright** benchmark pass — now a MUST per the
headed-e2e rule: visible Mac-Electron, ≥5 cam angles), A5 (one error-path-accepting kernel test
→ real geometric assertion), A2 (wire/disable partial toolbar ids), C3-step-0 (measure whether
the `opencascade.js` WASM path is exercised).

---

## Track A — Platform capability ("fully capable and more")

Ordered by leverage = (community demand × honesty-gap size × unblocks-other-work).
Grounded in `FORGE_PLATFORM_INVENTORY.md` §7 gap ledger, `KERNEL_PARITY.md`, and
`COMMUNITY_TRENDS.md` §4 ("what communities are really asking for").

### A1. Close the bridge↔prompt drift with an automated contract test — **actionable-now**
**Why first:** cheapest high-leverage fix. The 104-verb bridge (`ForgeToolBridge.js`) and
the trained prompt id list (`ForgeRunner.js:48-112`) are kept in sync **by hand**
(`FORGE_PLATFORM_INVENTORY.md` gap #5); drift silently reintroduces "unknown tool id"
failures that kill Archie builds. This blocks reliability of every AI-driven demo.
- **Increment:** add a test that parses every `name:` in `ForgeToolBridge.js`, parses the
  id list from `HERMES_FORGE_SYSTEM`, and asserts the prompt list ⊆ bridge registry (and
  flags bridge verbs the prompt omits as informational).
- **Gate:** test fails on any prompt id not dispatchable by the bridge; green on current tree.
- **Status:** [TARGETED] — the drift is [BUILT&VALIDATED]-as-a-risk in the inventory; the guard is new.

### A2. Wire the partial toolbar ids to real kernel ops (no preview-only no-ops) — **actionable-now**
**Why:** `FORGE_PLATFORM_INVENTORY.md` gap #4 — several `sheet.*`, `weld.*`, `sim.*`,
`mfg.*`, `view.*`, `measure.*` ids in `kernelDispatch.js` (`:444-461`, `:612-632`) fall
through to classification/preview stubs, so "every toolbar button executes" is not yet
true. This directly violates the no-stub rule on the live surface.
- **Increment (iterate one group per gate):** for each unwired id, route to the existing
  `window.forge.*` op (the kernel verbs already exist per `KERNEL_PARITY.md` §10/§4/§12),
  or — if no honest mapping exists — disable the button rather than show a fake action.
- **Gate per group:** a headed multi-cam e2e (repo standard: ≥5 named camera angles)
  clicks each id in the group and asserts a real geometry/state change or an explicit
  "not supported" — **never** a silent no-op.
- **Status:** [TARGETED]; kernel ops underneath are mostly [BUILT&VALIDATED] (`KERNEL_PARITY.md`).

### A3. Promote the bound-not-bridged GD&T/PMI + tolerance verbs honestly — **actionable-now (narrow)**
**Why:** GD&T/MBD is the loudest community pain (`COMMUNITY_TRENDS.md` §3.2, §3.7) **and**
Forge's weakest axis (28% parity). The kernel *already* writes PMI into AP242 and runs a
1-D tolerance stack (`KERNEL_PARITY.md` §7, §13), but `COMMUNITY_TRENDS.md` is explicit
that **no geometric DRF/FCF/MMC evaluator exists** and PMI is carried as ISO-10303-21
**comments, not semantic AP242 entities** (`KERNEL_PARITY.md` C5).
- **Increment (now):** expose the *existing* PMI-annotation + tolerance-stack verbs in the
  UI with **labels that state what they are** ("PMI note / comment-carrier", "1-D
  worst-case + RSS + MC stack") — do not imply symbolic FCF compliance.
- **Increment (aspirational):** a real geometric FCF evaluator (datum-frame extraction,
  MMC/LMC bonus tolerance) — this is multi-week net-new and must be marked TARGETED, not
  shipped as a stub.
- **Gate (now):** e2e asserts the PMI block round-trips through STEP export→reimport
  (`stepRoundTrip` already exists, `KERNEL_PARITY.md` §7) and the UI copy names it
  honestly; **no** assertion of FCF semantics until the evaluator is built.
- **Status:** annotation/stack [BUILT&VALIDATED]; semantic FCF [TARGETED, explicitly not-built].

### A4. Assembly semantics: more mate kinds + fastener catalogue — **mixed**
**Why:** assembly is 35% parity and the #3 community pain (`COMMUNITY_TRENDS.md` §3.3).
`KERNEL_PARITY.md` §12 shows the mate solver converges (`assembly_smoke.js` residual
1.8e-10) but `MateLibrary.cpp` has a non-converging "short-iteration" case (residual
5.9e+0) and the audit names missing kinds (symmetric/screw/slot/gear, smart/auto mates,
fastener catalogue with threads+grades, sub-assembly internal mates).
- **Increment (actionable-now):** fix the one non-converging mate-library case and add a
  convergence assertion (currently the smoke test passes despite the bad residual).
- **Increment (aspirational):** new mate kinds + fastener catalogue (net-new C++ + bridge verbs).
- **Gate:** every mate kind exercised must converge below a stated residual in
  `matelib_smoke.js`; no kind ships behind an error-path-accepting test.
- **Status:** core solver [BUILT&VALIDATED]; extended kinds [TARGETED].

### A5. Upgrade the error-path-accepting Feature tests to real geometric assertions — **actionable-now**
**Why:** `KERNEL_PARITY.md` C2 — sweep, loft, variable-fillet, draft, rib tests **accept
the OCCT error path as a pass**, so those ops are proven *callable*, not *correct*. This
is the difference between "PARTIAL" and "PARITY" and is a real honesty debt on the kernel.
- **Increment (one op per gate):** author a demanding fixture (e.g. a swept volume with a
  known answer; a variable-radius fillet on a valid contour) and assert the geometric
  result, not the error path.
- **Gate:** the op's smoke test asserts a non-trivial volume/area within tolerance;
  remove the "accept error path" branch for that op.
- **Status:** ops [BUILT, PARTIAL-validated]; demanding-case validation [TARGETED].

### A6. Put the native kernel tests in CI — **actionable-now**
**Why:** `KERNEL_PARITY.md` C1 — `.github/workflows/build-app.yml` builds the Electron
app but **never** builds the `.node` addon or runs any `forge-kernel/test/*`. Every
PARITY row can silently regress. This is the single biggest *process* gap behind the
whole capability track; A1/A2/A4/A5 gates are only durable if CI runs them.
- **Increment:** add a CI job that runs `cmake-js` build + `npm run forge:kernel:test` +
  the cited `test/*.js` smokes (honoring the hardware-calm "one heavy step" rule — a
  dedicated job, not stacked with the Electron build).
- **Gate:** CI is red if any cited smoke regresses; green on the current artifact.
- **Status:** [TARGETED]; the tests themselves are [BUILT&VALIDATED] (run locally 2026-06-20).

### A7. Turbulent CFD, multi-turn agentic refinement, robust third-party STEP/IGES import — **aspirational**
**Why:** named gaps that are genuinely net-new, multi-week, and must not be faked.
- Turbulent CFD (RANS/k-ε/LES): laminar steady only today (`FORGE_PLATFORM_INVENTORY.md`
  gap #2). [TARGETED]
- Multi-turn agentic refinement in the live shell: `maxTurns:1` is deliberate today
  (`FORGE_PLATFORM_INVENTORY.md` gap #1); a real refinement loop is a research item gated
  by the ladder-probe (`COMMUNITY_TRENDS.md` §3.1: caps2 ladder 0.418, clears 0.70 on 0/10
  tasks — Archie's *driving* of complex parts is measured-weak). [TARGETED, gated on retrain]
- Robust import-and-heal of arbitrary third-party STEP/IGES as a *measured* workflow
  (`COMMUNITY_TRENDS.md` §3.4): healing exists, the arbitrary-import workflow is not
  measured. [TARGETED]
- **Gate (each):** an analytical/closed-form or hand-labeled fixture must pass before the
  capability is claimed; until then it stays explicitly TODO.

### A8. Delete the dead legacy engines from the tree — **actionable-now (cleanup)**
**Why:** `FORGE_PLATFORM_INVENTORY.md` gap #8 — `forge-app/ForgeApp.jsx` (placeholder
viewport) and `mechanical-cad/ToolExecutionEngine.js` (17,349-line three.js/manifold
engine, not the native kernel) confuse the capability surface and mislead future agents.
- **Gate:** removed; `App.jsx → ForgeShellV4` tree still builds and all forge-v4 e2e green.
- **Status:** [TARGETED]; non-reachability is [BUILT&VALIDATED] (grep this session).

---

## Track B — Professional UIUX ("fully-professional, industry-grounded")

Grounded in `UIUX_CURRENT_STATE.md` (the live `forge-v4` shell is already coherent),
`UIUX_INDUSTRY_BENCHMARK.md` §3 (the gradable competitor checklist), and the
`frontend-design` discipline. The big finding: **the live UI is genuinely professional**;
the work is (a) deleting the dead generations that drag the brand, then (b) converting the
benchmark's [PARTIAL]/[UNVERIFIED]/[TODO] rows to [BUILT] with live evidence.

### B0. THE single highest-leverage UIUX increment — delete the three dead UI generations — **actionable-now**
**This is the first move of the whole UIUX track.** `UIUX_CURRENT_STATE.md` §0 is
unambiguous: there are **four token systems**, three orphaned, and they are "the source of
every templated/inconsistent impression." The orphaned `components/` assets default to a
**blue `#4a90d9` accent** that directly violates the live "no chromatic break" monochrome
brand (`tokens.css:51`); the orphaned ribbon dumps **~140 buttons into one `Sculpt`
group** (`RibbonToolbar.jsx:254-403`) using **single-Unicode-glyph icons** — the single
most unprofessional artefact in the repo. Any accidental re-mount breaks the brand
instantly.
- **Why highest-leverage:** it is low-risk (verified dead this session: `styles/index.css`
  has zero importers; `forge-app/` and `WorkbenchMechanical` are off the `App.jsx` mount
  path), it removes the entire "inconsistent/templated" critique at the root, and it
  unblocks every later UIUX increment by leaving exactly one token system to grade against.
- **Increment:** delete (or quarantine behind an explicit `legacy/` with a build-time ban)
  `frontend/src/styles/index.css`, `forge-app/styles.css` + the `forge-app/` shell,
  `components/RibbonToolbar.{jsx,css}`, `components/SwUxOverlays.{jsx,css}`,
  `components/FeatureTreePanel.css`, `components/PropertyManager.css`, and the
  `mechanical-cad/WorkbenchMechanical` tree — **after** confirming each is unreachable.
- **Before deleting `SwUxOverlays`:** it is the *best* overlay UX in the set
  (Confirmation Corner, Heads-Up toolbar, parametric `=expr` PropertyManager, sketch-state
  badge). The live shell has its own equivalents (`ForgeShellV4.jsx:31-38`) but
  `UIUX_CURRENT_STATE.md` §4 marks live polish parity **UNVERIFIED**. So: **harvest any
  affordance the live versions lack first** (B3), then delete.
- **Gate:** repo grep proves zero importers for each deleted file; `App.jsx → ForgeShellV4`
  builds; a CI lint **fails if `var(--bg-secondary)`/`#4a90d9` or `styles/index.css`
  reappear** in the live tree; headed screenshot of the shell is unchanged.
- **Status:** [TARGETED]; the orphan-status evidence is [BUILT&VALIDATED] (this session).

### B1. Run the benchmark checklist on a headed build and convert UNVERIFIED rows — **actionable-now**
**Why:** `UIUX_INDUSTRY_BENCHMARK.md` §3 is an explicitly gradable checklist, but it was
authored from **static source** — many rows are [PARTIAL]/[UNVERIFIED] only because no one
booted the app (the benchmark's §4.4 and §5 say exactly this). The cheapest credibility
win is to *observe* them live.
- **Increment:** boot the Electron shell headed (per the repo's headed-Mac-Electron rule),
  drive each [UNVERIFIED]/[PARTIAL] row (C1 sub-entity pick, C5 hover pre-highlight, B5
  bidirectional tree↔graphics highlight, G1 middle-mouse mapping, F1 PropertyManager
  scope), capture ≥5-angle screenshots, and tick to [BUILT] or downgrade to [TODO] with
  fresh `file:line`/screenshot evidence.
- **Gate:** every benchmark row has a live verdict + evidence; no row left [UNVERIFIED].
- **Status:** [TARGETED]; the checklist + Forge component evidence is [BUILT&VALIDATED].

### B2. Make the right panel and docked panes user-resizable & grid-anchored — **actionable-now**
**Why:** `UIUX_CURRENT_STATE.md` §1 — the right column is a **fixed 340px** with only a
binary collapse to 36px; professional MCAD (SolidWorks/Fusion/NX) lets users drag panel
widths. Secondary panels use `position:fixed` offsets that **re-derive grid geometry by
hand** (`tokens.css:539-551`, `:704-716`, `:780-793`) and silently misalign if a zone
height changes. (Note `UIUX_INDUSTRY_BENCHMARK.md` F3/`RightPanel.jsx:14-41` says the
right panel *is* drag-resizable — reconcile this live: if resize exists, the gap is the
hard-coded fixed offsets, not the panel.)
- **Increment:** confirm/repair right-panel drag-resize with persisted width; move the
  `position:fixed` panels into the CSS grid (or bind to live zone-height CSS vars).
- **Gate:** headed test drags the panel boundary, asserts width persists across reload,
  and asserts no panel overlaps when a zone height changes.
- **Status:** [TARGETED]; resize-claim is [UNVERIFIED] pending the headed run (B1 closes it).

### B3. Verify the live overlays match the orphaned `SwUxOverlays` quality (harvest, then delete) — **actionable-now**
**Why:** the live `ConfirmationCorner`/`HeadsUpToolbar`/`SketchStateBadge` exist
(`ForgeShellV4.jsx:31-38`) but parity with the higher-polish orphaned versions is
**UNVERIFIED** (`UIUX_CURRENT_STATE.md` §4). This is the prerequisite to B0's `SwUxOverlays`
deletion.
- **Increment:** read the live counterparts; for each affordance the orphaned file has and
  the live one lacks (e.g. `=expr` parametric inputs, DoF readout, auto-relation ghost),
  port it into the live `--forge-*`-tokened component.
- **Gate:** a headed run shows each affordance live; then `SwUxOverlays` is deleted under B0.
- **Status:** [TARGETED]; live-component existence [BUILT&VALIDATED], polish parity [UNVERIFIED].

### B4. Fix the small real bugs the audit found — **actionable-now**
**Why:** `UIUX_CURRENT_STATE.md` §5 — `Viewport.jsx:543` checks `theme === 'contrast'`
but the shell sets `'high-contrast'` (`ForgeShellV4.jsx:231`), so the high-contrast
viewport background branch is **dead**. Small, but a real broken branch on the
accessibility theme.
- **Increment:** align the theme string; remove the redundant double-background path
  (`<color attach>` vs CSS radial gradient) if it adds no value.
- **Gate:** headed high-contrast theme shows the intended viewport background.
- **Status:** [TARGETED]; the bug is [BUILT&VALIDATED] (cited).

### B5. Close the genuine industry-norm UX gaps (differentiator-aware) — **mixed**
**Why:** `UIUX_INDUSTRY_BENCHMARK.md` §3 [TODO] rows that are real, named, competitor-grounded:
- C4 QuickPick-style disambiguation for overlapping entities (NX convention, S8) — [TARGETED]
- E3 selection filter reachable from the status bar (Creo convention, S12/S13) — actionable-now
- F2 selection-cue field coloring in dialogs (Onshape blue-field convention, S15) — actionable-now
- G2 navigation presets matching Fusion/SolidWorks/Inventor (Fusion ships these, S20) —
  differentiator-friendly, [TARGETED]
- **Gate (each):** the behavior matches the cited competitor convention in a headed run.
- **Status:** [TARGETED]; each is grounded in a verified competitor source
  (`UIUX_INDUSTRY_BENCHMARK.md` §6 confirmed 20/20 competitor claims).

### B6. Accessibility as a deliberate differentiator — **actionable-now (mostly built)**
**Why:** `UIUX_INDUSTRY_BENCHMARK.md` §1.10/J — competitors have **no public WCAG claim**
(UNVERIFIED), and Forge already has ARIA roles, `A11yAudit.jsx`, `:focus-visible`,
reduced-motion, and a high-contrast theme. The one open J-row is **J6 full keyboard
operability of every pane** (UNVERIFIED).
- **Increment:** audit keyboard-only operability of every pane; fix mouse-only paths.
- **Gate:** `A11yAudit` passes + a manual keyboard-only walkthrough reaches every command.
- **Status:** plumbing [BUILT&VALIDATED]; full keyboard coverage [TARGETED].

---

## Track C — Unified native kernel ("one kernel, no deps, no duplicates")

Grounded in `KERNEL_UNIFICATION.md` (the architecture + 7-9-week phased plan) and
`KERNEL_PARITY.md`. The directive "single native kernel / no dependencies" is in direct,
documented conflict with **two WASM npm packages** in `frontend/package.json:24-25`
(`manifold-3d`, `opencascade.js`) — confirmed present this session. `opencascade.js` is
literally a **second, duplicate copy of OCCT** in the browser.

> **This track is honestly multi-week (~7-9 weeks, `KERNEL_UNIFICATION.md` §5) and is the
> most aspirational of the three.** Sequence it after the cheap A/B wins; do not delete a
> dep until its native replacement passes that capability's gate.

### C0. Pin the OCCT version in-repo + the dep-reappearance CI guard — **actionable-now**
**Why:** the only residual honesty gap on the kernel version is that 7.9.3 floats with
brew (§0.1). And `KERNEL_UNIFICATION.md` §2.3 calls for a CI guard that fails if
`manifold-3d`/`opencascade.js` ever reappear — start it now (as a warning) so the
migration has a ratchet.
- **Increment:** add a CMake assert/log that the linked `OCC_VERSION_COMPLETE` matches a
  pinned expected string; add the dep-reappearance lint (warn-only until Phase 5/2 flip it
  to hard-fail).
- **Gate:** CMake errors on an unexpected OCCT version; lint warns on either token today.
- **Status:** [TARGETED]; version evidence [BUILT&VALIDATED] this session.

### C1. Phase 0 — native `mesh`/`implicit`/`lattice` namespaces that *honestly raise* — **actionable-now**
**Why:** `KERNEL_UNIFICATION.md` §5 Phase 0. Stand up the three new N-API namespaces in
`binding.cpp` returning a clear "not implemented" **error** (not a fake success), proving
the surface + handle plumbing without faking results.
- **Gate:** `forge.mesh`/`forge.implicit`/`forge.lattice` exist and raise a descriptive error.
- **Status:** [TARGETED]; aligns with the no-stub-that-fakes-success rule.

### C2. Phase 1 — exact predicates + exact mesh validity (the CGAL-class start) — **mixed**
**Why:** `KERNEL_UNIFICATION.md` §4/§5 Phase 1. Today `MeshRepair.cpp` is **float, not
exact** — no `orient3d`/Shewchuk robust-predicate layer (grep this session: none). This
phase carries the **one flagged no-deps decision** (`KERNEL_UNIFICATION.md` §6): vendor one
self-contained public-domain Shewchuk predicates file in-tree (recommended, same model as
the already-vendored planegcs) vs. re-derive from scratch. **This decision is for the
user.**
- **Gate:** known-degenerate mesh fixtures classified with no false negatives vs. a
  hand-labeled set; predicate unit tests reproduce Shewchuk's published sign results.
- **Status:** [TARGETED]; the float-not-exact gap is [BUILT&VALIDATED]; **DECISION REQUIRED** on §6.

### C3. Phase 5 first (reorder vs the doc) — retire `opencascade.js`, the duplicate OCCT — **actionable-now-ish**
**Why:** `KERNEL_UNIFICATION.md` §2.3 itself says `opencascade.js` is the **lowest-risk**
removal because it duplicates the native OCCT the `.node` already links — and §7 flags it
is **UNVERIFIED whether the WASM path is even exercised** in the shipped Electron app
(`kernelLoader.js:7-9` self-flags this). So **step 0 is a measurement**: determine if the
WASM path runs at all; if not, removal is nearly free.
- **Increment:** instrument/trace whether `kernel/brep/*` (WASM) is ever hit in the
  Electron app; re-point any live callers at `window.forge.*` native equivalents (add thin
  OCCT ops where a JS BRep op has no native equivalent); remove `opencascade.js` from
  `package.json:25`.
- **Gate:** `kernel/brep/*` ops match the native path within tolerance on a fixture set;
  then the dep is removed and the CI guard flips to hard-fail on that token.
- **Status:** [TARGETED]; WASM-path-exercised is [UNVERIFIED] (measure first).

### C4. Phase 2 — native guaranteed-manifold mesh booleans (replace `manifold-3d`) — **aspirational**
**Why:** `KERNEL_UNIFICATION.md` §5 Phase 2 — the bulk of the work; `manifold-3d` is the
JS backbone for **three** capability classes (Manifold-mesh, libfive-implicit,
PicoGK-voxel) across 111 files. Build `HalfEdgeMesh` + triangle-triangle intersection
(exact-predicate) + arrangement + re-triangulation; expose `mesh.*`.
- **Gate (the repo's own stated failure case):** "~30 sequential subtractions on a single
  envelope" (`manifoldKernel.js:8-9`) runs to completion with every intermediate passing
  `mesh.validate` (2-manifold, watertight); plus idempotence/empty/volume-conservation.
- **Status:** [TARGETED]; depends on C2 predicates.

### C5. Phases 3-4 — implicit/F-rep (libfive-class) + voxel/lattice (PicoGK-class) — **aspirational**
**Why:** `KERNEL_UNIFICATION.md` §5 Phases 3-4. Port the existing JS references
(`MarchingCubes.js`, `SmoothImplicit.js`, `LatticeTPMS.js`, …) to native `implicit.*` /
`lattice.*`, then re-point consumers and remove the last `manifold-3d` import sites.
- **Gate:** SDF sphere meshes converge to `4/3·π·r³` within a resolution-shrinking
  tolerance; gyroid infill produces a connected 2-manifold mesh at the analytic
  volume-fraction.
- **Status:** [TARGETED].

### C6. Phase 6 — unification hardening — **aspirational**
**Why:** `KERNEL_UNIFICATION.md` §5 Phase 6 — mixed-representation booleans via
characterized conversion (§3.3), persistent-naming provenance across round-trips (§3.4),
validity invariant on every new op (§3.5), multi-cam e2e. Also folds in
`KERNEL_PARITY.md` C6: the C++ kernel is stateless per-op; parametric history lives in JS
— a kernel-level rebuild graph is the long-horizon item.
- **Gate:** a B-rep→mesh-boolean→back-reference-a-B-rep-face survives (naming provenance);
  full suite green on all CI platforms.
- **Status:** [TARGETED].

> **No-deps tension to surface to the user (one decision):** matching CGAL's *proven-exact*
> (EPECK/Nef) guarantees is **not** honestly reachable in-house in this window
> (`KERNEL_UNIFICATION.md` §4/§6). The target is **robust-in-practice** (Shewchuk exact
> predicates + snap-rounding) — exactly what Manifold itself targets — and the plan will
> **say so**, not claim CGAL-exact. The only sub-decision is C2's vendor-one-file vs.
> re-derive-from-scratch.

---

## Cross-track dependency & sequencing notes

- **A6 (kernel tests in CI) and C0 (dep guard) are the ratchets** — land them early so every
  later A/C gate is durable, not a one-time local run.
- **B0 (delete dead UI) unblocks all of Track B** — with one token system, every benchmark
  row grades cleanly; it must precede B1's headed checklist run to avoid grading dead code.
- **Track C is the long pole** (~7-9 weeks) and the most aspirational; it is correctly
  *behind* the cheap A/B wins. Within C, the order is C0 → C1 → C3 (measure WASM path,
  cheap if dead) → C2 (predicates, the decision gate) → C4 → C5 → C6.
- **Hardware-calm constraint (repo memory):** the M4 Max OOMs when training + serve +
  Electron + Vite + agents stack. Run heavy steps (kernel rebuild, headed e2e, any training
  the ladder-probe needs) **strictly one at a time**.

---

## Phase 1 — this session / week (concrete first increments)

The highest-leverage, lowest-risk first moves, in order. The **single highest-leverage
UIUX increment to start immediately is B0** (delete the three dead UI generations) — it is
verified-safe this session, kills the entire "templated/inconsistent" critique at its root,
protects the monochrome brand from accidental blue-accent re-mounts, and leaves exactly one
token system for every subsequent UIUX increment to grade against.

1. **[UIUX, highest-leverage] B0 — delete the three dead UI generations** (`styles/index.css`
   [0 importers, confirmed], `forge-app/` shell, `components/RibbonToolbar`+`SwUxOverlays`+
   orphaned CSS, `mechanical-cad/WorkbenchMechanical`), **after** harvesting any overlay
   affordance the live shell lacks (B3 pre-check). Add a CI lint that fails if a blue-accent
   token (`#4a90d9`) or `styles/index.css` reappears in the live tree. **Gate:** zero
   importers proven; `App.jsx→ForgeShellV4` builds; headed screenshot unchanged.

2. **[Capability ratchet] A1 — automated bridge↔prompt contract test.** Assert the trained
   prompt id list ⊆ the 104-verb `ForgeToolBridge.js` registry so "unknown tool id" drift
   can never silently return. **Gate:** test green now, red on any drift.

3. **[Process ratchet] A6 + C0 — kernel tests in CI + OCCT-version pin + dep-reappearance
   guard.** Add a CI job that builds the `.node` and runs the `forge-kernel/test/*` smokes;
   assert `OCC_VERSION_COMPLETE` matches a pinned 7.9.3; warn if `manifold-3d`/
   `opencascade.js` reappear. **Gate:** CI red on any kernel-smoke regression or version drift.

4. **[UIUX credibility] B1 — headed benchmark pass.** Boot the shell headed, drive the
   [UNVERIFIED]/[PARTIAL] rows of `UIUX_INDUSTRY_BENCHMARK.md` §3, capture ≥5-angle
   screenshots, and convert each row to [BUILT] or [TODO] with fresh evidence (this also
   resolves B2's right-panel-resize UNVERIFIED). **Gate:** no benchmark row left [UNVERIFIED].

5. **[Capability honesty] B4 + A5(first op) — fix the high-contrast viewport theme bug**
   (`'contrast'` vs `'high-contrast'`) and upgrade **one** error-path-accepting Feature test
   (start with sweep or variable-fillet) to a real geometric assertion. **Gate:** HC theme
   shows the intended bg; the chosen op asserts a non-trivial volume within tolerance.

6. **[Kernel, cheap-if-dead] C3 step 0 — measure whether the `opencascade.js` WASM path is
   exercised** in the Electron app (it is the duplicate OCCT; `kernelLoader.js:7-9` self-flags
   this as unverified). If unused, schedule its removal next. **Gate:** a definitive
   used/unused verdict with trace evidence.

These six are all **actionable-now**, individually gated, and respect the no-deps /
no-stubs / one-heavy-step-at-a-time constraints. Everything in Track C beyond C0/C1/C3-step-0
(C2 predicates onward) is the **aspirational ~7-9-week** unification program and is
explicitly *not* a Phase-1 item.
