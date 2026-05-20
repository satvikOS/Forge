# Sophistication Retrofit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit every OCCT ribbon handler shipped in Sub-projects A0–C to be **selection-driven + param-dialog-driven** instead of hardcoded-demonstrative — so each tool accepts real user inputs (selected bodies, dialog params) and runs in the same workflow a CAD user expects. Per user directives in `feedback_sophisticated_integrations` and `feedback_fully_sophisticated` (effort: max).

**Reinforcement (2026-05-19) — explicit user order:** "NOT to input any hardcoded stuff during the tests and in the platform, everything should be fresh groundup with workflows similar to human user (clicking, dragging, sketching, designing, rendering etc)". **No handler may fabricate its own input geometry. No e2e test may call `kernel.brep.*` to construct inputs.** All inputs come from real UI actions (clicking ribbon tools, sketching, dragging, dialog inputs). Recon specs are the single exception (they probe OCCT bindings directly).

**Architecture:** Reuse the existing `ToolParamDialog` + `requestToolParams(toolName)` + `ToolParamSchemas.js` infrastructure (already used by `Extrude Boss`, `Revolve Boss`, etc.). Reuse the existing `BodyRegistry` (`getBodyRegistry()`, `selectedBody()`, `selectedBodies()`) + selection state in `WorkbenchMechanical.jsx` for multi-body inputs. Every OCCT handler retrofitted to: read selection → ask for params via dialog → run op → render. Hardcoded demo inputs are removed. e2e tests retrofitted to the matching real-user workflow (create bodies via clicks → select → click op → fill dialog → assert).

**Tech Stack:** Unchanged. Vite 7 / React 19 / Three.js 0.181 / Electron 42 / Playwright 1.59.

**Reference:** memory files `feedback_sophisticated_integrations`, `feedback_fully_sophisticated`, `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_no_floating_panels`, `feedback_occt_deep_integration`.

---

## Important context for the implementer

- **Existing infrastructure already in place — read it first:**
  - `frontend/src/components/ToolParamDialog.jsx` — the dialog component (mounted in App). Fields have `data-field="<name>"`, run button `.tpd-btn-run`, cancel `.tpd-btn-cancel`.
  - `frontend/src/foundation/ToolParamDialog.js` — pub-sub: `onParamRequest`, `resolveOpen`, `requestToolParams(toolName)` returns `Promise<{values, cancelled}>`.
  - `frontend/src/foundation/ToolParamSchemas.js` — the schema source. Read it for the exact shape (`{title, blurb, fields: [{name, label, type, default, min, max, step, unit, hint}]}`).
  - `frontend/src/foundation/BodyRegistry.js` — `getBodyRegistry()`, `.selectedBody()`, `.selectedBodies()` (or similar — read it for the API), `.bodies()`, `.onChange(cb)`.
  - `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` — has `const [selection, setSelection]` and exposes `window.__archdiscSetSelection = setSelection` for e2e. The viewport selection event sets `selection.solidId` / `selection.bodyId` / `selection.brepShape`.
  - `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` — `addBrepShapeToScene(scene, viewport, brepShape, color)` registers the body in the BodyRegistry; bodies show in the Part Browser.
- **Op pattern remains the same.** Kernel ops in `frontend/src/kernel/brep/*.js` don't change. Only the ribbon handlers + the e2e change.
- **e2e workflow pattern (the new bar):** the test creates each input body by clicking a real Primitives ribbon tool (Box/Cylinder/Sphere/…), the helper uses `window.__archdiscSetSelection` to select one or more bodies (faster than viewport picking), then clicks the op's ribbon tool; the param dialog fields are filled via `.tpd-input[data-field="<name>"].fill('<value>')`, then `.tpd-btn-run` is clicked; result is measured via `window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape)` and orbit-captured.
- **Honest UX rule:** if a handler needs N selected bodies and only M < N are selected, the handler returns `{ status: 'warn', message: '<Tool>: select <N> bodies first' }` — NO silent fallback to a fabricated `makeBox` demo. Same for missing required params (the dialog enforces them; the handler validates after).
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/foundation/ToolParamSchemas.js` | Modify — add schemas for every OCCT op missing one |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — retrofit every OCCT handler to be selection + dialog driven; add a shared `_pickBodies(n)` helper that reads `BodyRegistry`/selection |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | Modify (small) — expose `window.__archdiscRegistry = getBodyRegistry()` for e2e if not already; ensure `window.__archdiscSetSelection` accepts an array for multi-select |
| `e2e/helpers/orbitCapture.js`, `e2e/helpers/uiWorkflow.js` (NEW) | Create `uiWorkflow.js` — shared `clickRibbonTab`, `clickRibbonTool`, `selectBodies`, `fillDialog` helpers so every retrofitted spec uses the same pattern |
| `e2e/brep-*.spec.js` (many) | Modify — retrofit each op's tests to the new workflow |
| `docs/superpowers/notes/sophistication-retrofit.md` | Create — record the unified pattern + the per-tool schema + selection-arity map |

---

## Task 1: Infrastructure recon + unified pattern doc

**Files:** read; create `docs/superpowers/notes/sophistication-retrofit.md` and the new `e2e/helpers/uiWorkflow.js`.

- [ ] **Step 1: Recon — read and document the infrastructure**

Read these files top-to-bottom and produce a short note in `docs/superpowers/notes/sophistication-retrofit.md`:
- `frontend/src/components/ToolParamDialog.jsx`
- `frontend/src/foundation/ToolParamDialog.js`
- `frontend/src/foundation/ToolParamSchemas.js`
- `frontend/src/foundation/BodyRegistry.js`
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` (the selection state + the existing window hooks)
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` (the existing OCCT handlers — `Combine`, `Fillet`, `Box`, `Subdivide Surface`, etc.)
- one existing dialog-using handler — read `Extrude Boss` (around line 718 of ToolExecutionEngine) for the canonical pattern: `const { values, cancelled } = await requestToolParams('Extrude Boss'); if (cancelled) return { status:'warn', message: '... cancelled' };`.

In the note: write
- The exact `requestToolParams` shape + how the dialog fields are wired.
- The exact BodyRegistry API for reading the current selection + the multi-select mechanism (if any). If multi-select isn't supported by the registry, document how it COULD be added (e.g. a `Set<bodyId>` plus toggle on shift+click); flag whether it exists and document either the real path or the addition plan.
- A complete unified RETROFIT pattern for any OCCT handler:
  ```js
  '<Tool>': async (scene, viewport) => {
    try {
      // 1. Read selection.
      const bodies = _pickBodies(<arity>);  // throws clear message if insufficient
      // 2. Open param dialog.
      const { values, cancelled } = await requestToolParams('<Tool>');
      if (cancelled) return { status: 'warn', message: '<Tool>: cancelled' };
      // 3. Run op.
      const result = await ArchDiscKernel.brep.<op>(bodies[0], values.<param>, ...);
      // 4. Render + report.
      await addBrepShapeToScene(scene, viewport, result);
      const m = await ArchDiscKernel.brep.measure(result);
      return { status: 'success', message: `<Tool>: V = ${m.volume.toFixed(0)} mm³ via ...` };
    } catch (err) {
      return { status: 'error', message: '<Tool>: ' + err.message };
    }
  }
  ```
  with the variant for `arity === 0` (no selection — op generates its own input, e.g. primitives) and the variant for `arity === 1` (single body — read selection else `window.__lastBrepShape`, else `{status:'warn', message:'select a body first'}`).

- A per-tool table: every OCCT-wired ribbon tool name, its kernel op, its required selection arity (0 / 1 / 2), and its dialog schema fields. The full list from Sub-projects A0-C:
  - **Primitives (arity 0):** `Box`, `Cylinder`, `Sphere`, `Cone`, `Torus`. Each gets a dialog for its size params (Box: dx, dy, dz; Cylinder: r, h; Sphere: r; Cone: r1, r2, h; Torus: R, r). Removes the current hardcoded defaults — defaults stay as schema defaults so the user can just click Run.
  - **Features (arity 1):** `Extrude Boss` (already dialog-driven — confirm; arity 0 actually, builds its profile), `Revolve Boss` (same), `Fillet`, `Chamfer`, `Variable Radius Fillet`, `Shell`, `Draft`, `Thicken` (Surface, arity 0 currently — leave 0 or move to 1 with a sheet input later), `Offset Shape`, `Face Fillet` (G2), `Full Round Fillet` (cliff), `Corner Mitre`, `Simplify Geometry`, `Subdivide Surface`. Each on a single selected body + a dialog for its scalar params.
  - **Booleans (arity 2):** `Combine`, `Subtract`, `Intersect`, `Combine (Non-Manifold)`, `Combine (Coincident)` (also a tolerance dialog), `Lattice Fuse` (arity ≥4 — actually a multi-body op; document special handling: select N bodies, fuse them).
  - **Topology (arity 1):** `Replace Face` — read a selected body + faceIndex dialog input.
  - **Sweep / Loft (arity 0 currently — internally-built profile)**: leave arity 0 with dialog params (radius, length / bottomSize, topSize, height) — promoting to wire-selection is a future enhancement.

- [ ] **Step 2: Create `e2e/helpers/uiWorkflow.js`**

A shared helper file (plain ES module; e2e helpers may use bare `import fs from 'fs'`, `import path from 'path'`). Exports:
```js
export function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export async function clickRibbonTab(win, label) {
  await win.locator('button.ribbon-tab').filter({ hasText: new RegExp('^' + escapeRe(label) + '$') }).first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

export async function clickRibbonTool(win, label) {
  await win.locator('button.ribbon-tool:has(.ribbon-tool-label)')
    .filter({ has: win.locator('.ribbon-tool-label', { hasText: new RegExp('^' + escapeRe(label) + '$') }) })
    .first().evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

/** Wait for the ToolParamDialog to open. */
export async function waitForDialog(win) {
  await win.locator('.tpd-dialog').first().waitFor({ state: 'visible', timeout: 30000 });
}

/** Fill named fields in the open dialog and click Run. */
export async function fillDialog(win, values) {
  for (const [name, value] of Object.entries(values)) {
    const input = win.locator(`.tpd-input[data-field="${name}"]`);
    await input.fill(String(value));
  }
  await win.locator('.tpd-btn-run').first().click({ force: true });
  await win.locator('.tpd-dialog').first().waitFor({ state: 'detached', timeout: 30000 });
}

/** Build a body by clicking a Primitives tool (Box/Cylinder/Sphere/Cone/Torus). Returns the new body's id from window.__lastBrepShape after the dialog runs. */
export async function buildPrimitive(win, toolName, params) {
  const before = await win.evaluate(() => (window.__lastBrepShape && window.__lastBrepShape.id) || null);
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, toolName);
  // The new sophisticated primitives open a dialog. If `params` is omitted, the defaults are accepted.
  await waitForDialog(win);
  await fillDialog(win, params || {});
  await win.waitForFunction((b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b, before, { timeout: 60000 });
  return win.evaluate(() => window.__lastBrepShape.id);
}

/** Select one or more BrepShapes by id. Uses the registry's selection API. */
export async function selectBodies(win, ids) {
  await win.evaluate((ids) => {
    const reg = window.__archdiscRegistry;
    if (!reg) throw new Error('selectBodies: __archdiscRegistry not exposed — see Task 2');
    reg.selectMany ? reg.selectMany(ids) : (ids.forEach(id => reg.select && reg.select(id)));
  }, ids);
}
```

If the BodyRegistry doesn't expose a multi-select API yet, the Task 2 work adds it (and `window.__archdiscRegistry`). Document the dependency in the helper's docstring.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/sophistication-retrofit.md e2e/helpers/uiWorkflow.js
git commit -m "docs: sophistication-retrofit pattern + shared e2e workflow helpers"
```

---

## Task 2: Add param schemas + selection/registry hooks + `_pickBodies` helper

**Files:** modify `frontend/src/foundation/ToolParamSchemas.js`, `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`, `frontend/src/foundation/BodyRegistry.js` (if multi-select is missing), `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` (add the helper, do not yet retrofit handlers).

- [ ] **Step 1: Add ToolParamSchemas for every OCCT op missing one**

Add entries to `ToolParamSchemas.js` for: `Box`, `Cylinder`, `Sphere`, `Cone`, `Torus`, `Fillet` (radius), `Chamfer` (distance), `Variable Radius Fillet` (r1, r2), `Shell` (thickness), `Draft` (angleDeg), `Thicken` (w, h, thickness), `Offset Shape` (distance), `Face Fillet` (G2 — holeBoxSize), `Full Round Fillet` (cliff radius), `Corner Mitre` (radius), `Simplify Geometry` (no params or a `dihedralDeg` and `aggressive` toggle), `Subdivide Surface` (levels: integer 1..4, dihedralDeg: 0..90 default 30, deflection: 0.01..2 default 0.5), `Combine`/`Subtract`/`Intersect` (no params; bodies come from selection), `Combine (Non-Manifold)` (no params), `Combine (Coincident)` (tolerance), `Lattice Fuse` (no params — N from selection), `Replace Face` (faceIndex). Reasonable defaults that produce the current demo values when accepted as-is, so existing tests still pass after dialog-fill.

- [ ] **Step 2: Expose the BodyRegistry on `window.__archdiscRegistry`**

In `WorkbenchMechanical.jsx`, in a small `useEffect` keyed on `[]`, set `window.__archdiscRegistry = getBodyRegistry()`. If multi-select isn't supported, extend `BodyRegistry.js` with a `Set<bodyId>` of selected ids + `select(id)` / `deselect(id)` / `selectMany(ids)` / `clearSelection()` / `selectedIds()` / `selectedBrepShapes()` methods that map to the registered groups' `userData.brepShape` (which `addBrepShapeToScene` already sets). Trigger `onChange` callbacks on selection changes.

- [ ] **Step 3: Add `_pickBodies(arity)` in `ToolExecutionEngine.js`**

```js
function _pickBodies(arity) {
  const reg = (typeof window !== 'undefined') ? getBodyRegistry() : null;
  const selected = (reg && reg.selectedBrepShapes && reg.selectedBrepShapes()) || [];
  if (arity === 0) return [];
  if (arity === 1) {
    if (selected.length >= 1) return [selected[0]];
    if (typeof window !== 'undefined' && window.__lastBrepShape) return [window.__lastBrepShape];
    throw new Error('select a body first');
  }
  if (arity === 2) {
    if (selected.length >= 2) return [selected[0], selected[1]];
    throw new Error('select two bodies first');
  }
  // arity > 2: e.g. Lattice Fuse — caller passes Infinity for "all selected".
  if (selected.length >= 2) return selected;
  throw new Error('select at least 2 bodies first');
}
```

Hook this into the handler return path: handlers that catch `_pickBodies`'s error return `{ status:'warn', message: '<Tool>: ' + err.message }`.

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npx vite build 2>&1 | tail -5
git add frontend/src/foundation/ToolParamSchemas.js frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx frontend/src/foundation/BodyRegistry.js frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js
git commit -m "feat(ui): tool param schemas, multi-select registry, _pickBodies helper"
```

---

## Task 3: Retrofit primitives & single-body feature handlers

**Files:** modify `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`.

Apply the unified pattern to every primitive + single-body feature handler. Each handler:
- (primitives, arity 0): `requestToolParams('Box')` → `makeBox(values.dx, values.dy, values.dz)` → render → report.
- (single-body, arity 1): `_pickBodies(1)` → `requestToolParams('<Tool>')` → run op with body + values → render → report. NO `makeBox` fallback.

Retrofit: `Box`, `Cylinder`, `Sphere`, `Cone`, `Torus`, `Fillet`, `Chamfer`, `Variable Radius Fillet`, `Shell`, `Draft`, `Thicken`, `Offset Shape`, `Face Fillet`, `Full Round Fillet`, `Corner Mitre`, `Simplify Geometry`, `Subdivide Surface`, `Replace Face` (with `faceIndex` dialog input).

Build + commit:
```bash
cd frontend && npx vite build 2>&1 | tail -5
git add frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js
git commit -m "feat(ui): retrofit primitives + single-body feature ribbon handlers to selection + dialog driven"
```

---

## Task 4: Retrofit boolean handlers (arity 2 / N)

**Files:** modify `ToolExecutionEngine.js`.

Retrofit: `Combine`, `Subtract`, `Intersect`, `Combine (Non-Manifold)`, `Combine (Coincident)`, `Lattice Fuse`. Use `_pickBodies(2)` (or `Infinity` for Lattice). `Combine (Coincident)` also opens a dialog for `tolerance`. The hardcoded `makeBox` + `makeCylinder` demo inputs are REMOVED — booleans require user-selected bodies.

Build + commit:
```bash
cd frontend && npx vite build 2>&1 | tail -5
git add frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js
git commit -m "feat(ui): retrofit boolean ribbon handlers to require selected bodies"
```

---

## Task 5: Retrofit e2e specs to the new workflow

**Files:** modify every brep op e2e spec.

For each op spec, the test now:
1. `await buildPrimitive(win, 'Box')` (the dialog defaults give a 40mm box if the schema default is 40, etc.).
2. For multi-body ops: `await buildPrimitive(win, 'Cylinder')` (second body), `await selectBodies(win, [id1, id2])`.
3. `await clickRibbonTab(win, 'Part')`; `await clickRibbonTool(win, '<Op>')`; `await waitForDialog(win)`; `await fillDialog(win, { <params> })`.
4. `await win.waitForFunction(() => !!window.__lastBrepShape && window.__lastBrepShape.id !== <id-before>, ...)`.
5. Measure + assert + capture all angles.

Apply to: `brep-primitives-electron.spec.js`, `brep-features-electron.spec.js`, `brep-localops-electron.spec.js`, `brep-surfacing-electron.spec.js`, `brep-varfillet-electron.spec.js`, `brep-boolean-electron.spec.js`, `brep-blend-electron.spec.js`, `brep-simplify-electron.spec.js`, `brep-b-advanced-electron.spec.js`, `subdivide-surface-electron.spec.js`, `brep-foundation-electron.spec.js` (the Box-via-ribbon), `brep-check-electron.spec.js` (Check Geometry + Interference — these may not need bodies).

Adjust the numeric bounds against the actual measured values produced by the dialog defaults. Do NOT weaken assertions — set tight ±10% windows around real measurements.

Build + run full brep suite:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test --project=chromium e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-a4-recon-electron.spec.js e2e/brep-a5-recon-electron.spec.js e2e/brep-b-recon-electron.spec.js e2e/subdivide-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/brep-simplify-electron.spec.js e2e/brep-blend-electron.spec.js e2e/brep-b-advanced-electron.spec.js e2e/subdivide-surface-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js
```

Commit:
```bash
git add e2e/
git commit -m "test(ui): retrofit op e2e to selection + dialog driven user workflows"
```

---

## Self-review notes

- **Methodology compliance:** the retrofit aligns ALL ribbon handlers with `feedback_sophisticated_integrations`, `feedback_fully_sophisticated`, `feedback_e2e_user_workflows`. Hardcoded demo inputs are removed; selection + dialogs become the universal pattern. Errors are honest (no silent fallbacks).
- **Methodology preserved:** real-user-workflow e2e (`feedback_e2e_user_workflows`) and all-angles capture (`feedback_e2e_all_angles`) remain — the tests now go through MORE of the real workflow (selection + dialog), not less.
- **Risk of weakening assertions during retrofit:** explicit guardrail in Task 5 — set tight ±10% windows around real measurements, never widen to triviality.
- **Deferred (next per the user direction):** Sub-project D — Retopology. Sub-project E — fully advanced NURBS operations. Then the rest of §3.
