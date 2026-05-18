# Atomic-CAD L0 — Revolve Operation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `revolve` atomic operation — revolve a sketched profile around an axis into a solid of revolution — verified by sculpting a turned sleeve inside the real ArchDisc desktop app.

**Architecture:** Extend `AtomicOps.js` with `revolve` (manifold-3d `revolve`), expose it on `window.__archdiscAtomic`, and prove it with a headed Electron-app spec.

**Tech Stack:** ES modules; `manifold-3d` WASM; React. Tests: Playwright driving the ArchDisc Electron desktop app via `_electron`. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

**Plan 4** of the autonomous atomic-CAD sculptor. Plans 1–3 shipped: the
`kernel/atomic/` modules (`ParametricCurve`, `SketchProfile`, `Part`,
`AtomicOps` with `createPart, startSketch, sketchRectangle, sketchCircle,
finishSketch, extrude, cut`), and `window.__archdiscAtomic` registered by the
mechanical workbench (exposing those ops + `render`).

**Verified facts:**
- manifold-3d boolean ops use the static module form: `Mod.Manifold.union(a, b)`,
  `Mod.Manifold.difference(a, b)`. (Instance `.union` does NOT exist.)
- manifold objects hold WASM heap — `.delete()` every intermediate.
- `extrude` (in `frontend/src/kernel/atomic/AtomicOps.js`) is the model: get
  `Mod` via `await getManifold()`, build `Mod.CrossSection.ofPolygons(profile)`,
  produce a solid, union into `part.solid` if one exists, record a feature.
- ArchDisc has an existing **Revolve Boss** tool handler in
  `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` — it already
  calls manifold-3d's revolve. **If the `revolve` API call in this plan does not
  match the installed manifold-3d version, find the `Revolve Boss` handler in
  ToolExecutionEngine.js and mirror its exact revolve call.**
- manifold-3d's revolve revolves a 2-D `CrossSection` around an axis to make a
  solid. The cross-section profile must lie in the positive-X half-plane (x ≥ 0).
- The ArchDisc Electron desktop app loads `frontend/dist` — rebuild
  (`cd frontend && npx vite build`) before launching it.
- Headed Electron-driving pattern: see `e2e/atomic-sculpt-plate-electron.spec.js`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — add `revolve`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — expose `revolve` on `window.__archdiscAtomic`. |
| `e2e/atomic-sculpt-sleeve-electron.spec.js` | NEW — headed Electron-app test: sculpt a revolved sleeve. |

---

## Task 1: Add the `revolve` operation to `AtomicOps.js`

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js` (append one function)

- [ ] **Step 1: Append the `revolve` function** to `frontend/src/kernel/atomic/AtomicOps.js`, after the `cut` function:

```js
/**
 * Revolve: revolve the pending sketch profile around the axis to form a
 * solid of revolution, and union it into the Part's current solid. The
 * profile must lie in the positive-X half-plane (x >= 0) — the revolve
 * axis is the Y axis. Records a 'revolve' feature.
 *
 * @param {Part} part
 * @param {number} [segments]  circular segment count (>= 3)
 * @param {number} [degrees]   revolve sweep angle in degrees (default 360)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function revolve(part, segments = 64, degrees = 360) {
  if (!part.pendingProfile) throw new Error('revolve: no finished sketch profile — call finishSketch first');
  if (!(segments >= 3)) throw new Error('revolve: segments must be >= 3');
  if (!(degrees > 0)) throw new Error('revolve: degrees must be > 0');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const body = Mod.Manifold.revolve(cs, segments, degrees);
  cs.delete();

  let result = body;
  if (part.solid) {
    result = Mod.Manifold.union(part.solid, body);
    part.solid.delete();
    body.delete();
  }
  part.solid = result;
  part.pendingProfile = null;
  part.addFeature('revolve', { segments, degrees }, result);
  return result;
}
```

- [ ] **Step 2: Verify the revolve API call**

`Mod.Manifold.revolve(crossSection, circularSegments, revolveDegrees)` is the
expected manifold-3d signature. Confirm it by finding the `Revolve Boss` handler
in `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` and checking
how it calls revolve. If the installed manifold-3d uses a different signature or
a `CrossSection.revolve(...)` instance form, adjust the `revolve` line in your
new function to match the Revolve Boss handler exactly — keep everything else
(guards, WASM-heap deletes, `addFeature`) the same.

- [ ] **Step 3: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js`
Expected: exit 0 (or skip if Node rejects ESM `import` in `--check`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "Add AtomicOps revolve operation (atomic-CAD L0)"
```

---

## Task 2: Expose `revolve` on `window.__archdiscAtomic`

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Add `revolve` to the AtomicOps import**

Find:
```js
import { createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut } from '../../kernel/atomic/AtomicOps.js';
```
Change to:
```js
import { createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve } from '../../kernel/atomic/AtomicOps.js';
```

- [ ] **Step 2: Add `revolve` to the exposed op set**

In the `useEffect` that registers `window.__archdiscAtomic`, find the line:
```js
            createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut,
```
Change it to add `revolve`:
```js
            createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve,
```
Make NO other change.

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds (also refreshes `frontend/dist`). Fix only import/syntax you introduced if it fails.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Expose revolve on window.__archdiscAtomic (atomic-CAD L0)"
```

---

## Task 3: Headed Electron spec — sculpt a revolved sleeve

**Files:**
- Create: `e2e/atomic-sculpt-sleeve-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`. Confirm `frontend/dist/index.html` exists.

- [ ] **Step 2: Create `e2e/atomic-sculpt-sleeve-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * The autonomous sculptor, in the real ArchDisc desktop app: revolve a
 * rectangular profile around the axis into a cylindrical sleeve (a turned
 * part) — startSketch -> sketchRectangle -> finishSketch -> revolve. The
 * rectangle sits in the +X half-plane so the revolve sweeps a tube.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test('AtomicOps revolves a sleeve in the ArchDisc desktop app', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  // A rectangle spanning x 10..20, y 0..40 -> revolved 360 deg about the Y
  // axis -> a cylindrical sleeve: inner radius 10, outer radius 20, height 40.
  const sleeve = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('Sleeve');
    window.__atomicPart = part;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 15, 20, 10, 40);   // centre (15,20), w 10, h 40 -> x 10..20, y 0..40
    A.finishSketch(part);
    await A.revolve(part, 96, 360);
    A.render(part);
    return { volume: part.solid.volume(), history: part.describe() };
  });

  // Analytical sleeve volume = pi*(R_out^2 - R_in^2)*height = pi*(400-100)*40
  //                          = pi*300*40 ~= 37699 mm^3
  expect(sleeve.volume).toBeGreaterThan(36000);
  expect(sleeve.volume).toBeLessThan(39000);
  console.log('  ArchDisc desktop app — construction history: ' + sleeve.history);
  console.log('  revolved sleeve volume: ' + sleeve.volume.toFixed(0)
    + ' mm^3 (analytical ~37699)');
  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-sleeve.png') });

  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/atomic-sculpt-sleeve-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The ArchDisc desktop window opens; a cylindrical sleeve appears in the viewport.

If it FAILS:
- A `revolve` error inside `page.evaluate` → the manifold revolve signature is
  likely wrong; paste the EXACT error and report BLOCKED so the `revolve` call
  can be matched to the `Revolve Boss` handler. Do NOT guess repeatedly.
- Volume far outside `(36000, 39000)` → the profile may be revolving around the
  wrong axis or the rectangle is mis-placed. The analytical sleeve volume is
  ~37699 mm³. Investigate honestly; report the actual number; do NOT just widen
  the bounds.

- [ ] **Step 4: Verify the screenshot**

Confirm `autonomous-output/electron-sleeve.png` exists and is non-empty. Open it
and confirm it shows a cylindrical/tubular solid (a sleeve) in the ArchDisc
viewport, and the BODIES panel lists ONE body.

- [ ] **Step 5: Commit**

```bash
git add e2e/atomic-sculpt-sleeve-electron.spec.js
git commit -m "Add Electron-app spec — revolve a sleeve in the ArchDisc desktop app (atomic-CAD L0)"
```

(Do NOT git-add `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** Plan 4 adds the `revolve` operation (spec L0 feature set).
Sketch constraints (`SketchSolver`), sketch-on-face, patterns, and fillet remain
for Plan 5+.

**Placeholder scan:** No placeholders — every step has complete code/commands.
Task 1 Step 2 is a deliberate verification step against the live manifold-3d API,
not a placeholder.

**Type consistency:** `revolve(part, segments, degrees)` mirrors `extrude` /
`cut` — same guard style, same WASM-heap discipline, same `addFeature` recording,
same `Mod.Manifold.union` for the multi-feature case. `revolve` is added to both
the `AtomicOps.js` exports and the workbench import + exposed op set.

---

## Subsequent Plans

- **Plan 5 — sketch constraints (`SketchSolver` wiring).**
- **Plan 6 — sketch-on-face** (needs a face-reference protocol — design first).
- **Plan 7 — patterns, fillet, `GeometryQuery` (L1).**
- **Plan 8+ — L2 AI Sculptor (the LLM brain) and beyond.**
