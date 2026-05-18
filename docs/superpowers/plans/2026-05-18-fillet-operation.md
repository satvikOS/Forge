# Fillet Operation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `fillet` atomic operation — round the edges of a sculpted part — using ArchDisc's existing `foundation/MorphologicalFillet.js`, and let the AI sculptor use it.

**Architecture:** `fillet(part, radius)` rolls a ball of `radius` over the part's solid (morphological rounding) via ArchDisc's existing `morphologicalFilletManifold`. Exposed on `window.__archdiscAtomic` and taught to the AI sculptor.

**Tech Stack:** ES modules; `manifold-3d`; ArchDisc `foundation/MorphologicalFillet.js`; React. Tests: a headed `_electron` spec. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

Part of the **Omega Seamaster autonomous build** — incremental geometry-
capability work. The atomic op set has sketch/extrude/cut/revolve/patterns/
translate but no edge rounding. Watch components have rounded edges everywhere;
`fillet` adds that.

**Verified facts:**
- `frontend/src/foundation/MorphologicalFillet.js` exports a function (around
  `morphologicalFilletManifold`) that rounds a manifold's edges via morphology
  (rolling-ball — morphological open rounds convex edges). It is used by the
  Part-tab "Volumetric Fillet" tool handler in
  `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`. Its exact
  signature (argument list — manifold, radius, and whether it needs the
  manifold module / `getManifold` passed in; sync vs async) MUST be confirmed
  against that handler — Task 1 Step 1.
- Honest property of this fillet: it is **voxel-based / staircased** — it
  voxelizes, applies morphology, re-meshes. The result is a real rounding but
  not a perfectly smooth exact fillet, and it is slower than the other ops.
  That is acceptable for this incremental op; it is documented in the JSDoc.
- `frontend/src/kernel/atomic/AtomicOps.js` — the L0 ops; `getManifold` is
  imported from `../../foundation/manifoldKernel.js`. manifold WASM-heap
  discipline: `.delete()` intermediates.
- `Part` has `solid`, `addFeature(...)`.
- `frontend/src/ai/sculptor/PartSculptor.js` — `OP_SCHEMA`, `executeSculptPlan`
  switch, `buildSculptPrompt`.
- `WorkbenchMechanical.jsx` registers `window.__archdiscAtomic` (an op is
  callable by the AI only if imported there AND in the object literal).
- The Electron desktop app loads `frontend/dist` — rebuild before launching.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — add `fillet`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — expose `fillet`. |
| `frontend/src/ai/sculptor/PartSculptor.js` | MODIFIED — `OP_SCHEMA`/`executeSculptPlan`/`buildSculptPrompt`. |
| `e2e/ai-sculptor-plan.spec.js` | MODIFIED — schema/dispatch tests. |
| `e2e/ai-sculpt-fillet-electron.spec.js` | NEW — headed test. |

---

## Task 1: Add `fillet` to `AtomicOps.js`

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js`

- [ ] **Step 1: Confirm the `morphologicalFilletManifold` API**

Grep `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` for the
"Volumetric Fillet" handler and for `morphologicalFillet`. Note the exact
import name from `foundation/MorphologicalFillet.js`, the call signature
(arguments and order — does it take `(manifold, radius)` or `(manifold, radius,
getManifold)` or an options object? is it `await`ed?), and what it returns (a
new manifold). Report what you found. Task 1 Step 2's `fillet` must mirror it.

- [ ] **Step 2: Append the `fillet` function** to `frontend/src/kernel/atomic/AtomicOps.js`, after `translate`. Use this as the template, adjusting the `morphologicalFilletManifold(...)` call to match the real signature from Step 1:

```js
/**
 * Fillet: round the edges of the part's current solid by `radius` mm, using
 * ArchDisc's morphological (rolling-ball) fillet. Honest note: this fillet is
 * voxel-based — a real rounding, but staircased at fine scale and slower than
 * the other ops; it is not an exact B-rep fillet.
 *
 * @param {Part} part
 * @param {number} radius  rolling-ball radius (mm, > 0)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function fillet(part, radius) {
  if (!part.solid) throw new Error('fillet: nothing to fillet — build a solid first');
  if (!(radius > 0)) throw new Error('fillet: radius must be > 0');
  const filleted = await morphologicalFilletManifold(part.solid, radius, getManifold);
  if (!filleted) throw new Error('fillet: morphological fillet produced no result');
  if (filleted !== part.solid) part.solid.delete();
  part.solid = filleted;
  part.addFeature('fillet', { radius }, filleted);
  return filleted;
}
```

Add the import at the top of the file alongside the other imports:
```js
import { morphologicalFilletManifold } from '../../foundation/MorphologicalFillet.js';
```
(If the export is named differently, use the real name from Step 1.)

- [ ] **Step 3: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js` — expect exit 0 (skip if Node rejects ESM `import` in `--check`).

- [ ] **Step 4: Confirm no regression**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: still passes — report the count.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "Add AtomicOps fillet operation (morphological rolling-ball)"
```

---

## Task 2: Expose `fillet` + teach the sculptor

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`
- Modify: `frontend/src/ai/sculptor/PartSculptor.js`
- Test: `e2e/ai-sculptor-plan.spec.js`

- [ ] **Step 1: Expose `fillet` on `window.__archdiscAtomic`**

In `WorkbenchMechanical.jsx`: add `fillet` to the AtomicOps named import (the
`createPart, …, translate` line), and add `fillet` to the `window.__archdiscAtomic`
object literal's op list.

- [ ] **Step 2: Write the failing tests**

In `e2e/ai-sculptor-plan.spec.js`:
(a) Append to the `test.describe('PartSculptor — parseSculptPlan', ...)` block:
```js
  test('accepts a fillet op with a numeric radius', () => {
    const plan = parseSculptPlan('[{"op":"fillet","radius":2}]');
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('fillet');
  });

  test('rejects a fillet op with no numeric radius', () => {
    expect(() => parseSculptPlan('[{"op":"fillet"}]')).toThrow(/fillet/);
  });
```
(b) Append to the `test.describe('PartSculptor — executeSculptPlan', ...)` block:
```js
  test('executeSculptPlan dispatches fillet to the atomic api', async () => {
    const calls = [];
    const api = {
      createPart: () => ({}),
      startSketch: () => calls.push(['startSketch']),
      sketchRectangle: (p, cx, cy, w, h) => calls.push(['sketchRectangle', cx, cy, w, h]),
      finishSketch: () => calls.push(['finishSketch']),
      extrude: async () => calls.push(['extrude']),
      fillet: async (p, radius) => calls.push(['fillet', radius]),
    };
    await executeSculptPlan([
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchRectangle', cx: 0, cy: 0, w: 40, h: 40 },
      { op: 'finishSketch' },
      { op: 'extrude', distance: 10 },
      { op: 'fillet', radius: 3 },
    ], api);
    expect(calls[calls.length - 1]).toEqual(['fillet', 3]);
  });
```

- [ ] **Step 3: Run it, verify the 3 new tests FAIL**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`

- [ ] **Step 4: Update `PartSculptor.js`**

(a) `OP_SCHEMA` — add (after the last entry):
```js
  fillet: ['radius'],
```
(b) `executeSculptPlan` switch — add (before `default`):
```js
      case 'fillet': await atomicApi.fillet(part, o.radius); break;
```
(c) `buildSculptPrompt` — after the `linearPattern` description, add:
```js
    '- {"op":"fillet","radius":N} — round all edges of the current solid by N mm',
    '       (a rolling-ball fillet). Use a radius small relative to the part.',
```

- [ ] **Step 5: Run it, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS — 3 more than before.

- [ ] **Step 6: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx frontend/src/ai/sculptor/PartSculptor.js e2e/ai-sculptor-plan.spec.js
git commit -m "Expose fillet + teach the AI sculptor the fillet operation"
```

---

## Task 3: Headed Electron spec — the AI sculpts a filleted part

**Files:**
- Create: `e2e/ai-sculpt-fillet-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`.

- [ ] **Step 2: Create `e2e/ai-sculpt-fillet-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Fillet, end to end, in the real ArchDisc desktop app: the AI is asked for a
 * block with rounded edges. It must use the fillet op. Verified by a real
 * solid in the viewport with a positive volume.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI sculpts a block and fillets its edges', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  test.setTimeout(240000);
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscSculptor, null, { timeout: 60000 });

  const description = 'A rectangular block 50 mm x 40 mm x 20 mm with all its edges '
    + 'rounded by a 4 mm fillet.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const { part, plan } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
    return { plan, history: part.describe(), volume: part.solid.volume() };
  }, { description, llm });

  console.log('  AI plan: ' + JSON.stringify(result.plan));
  console.log('  history: ' + result.history);
  console.log('  volume: ' + result.volume.toFixed(0) + ' mm^3');

  const usedFillet = result.plan.some((o) => o.op === 'fillet');
  expect(usedFillet).toBe(true);
  // a 50x40x20 block is 40000 mm^3; a 4mm fillet removes some corner/edge
  // material, so expect somewhat less than 40000 but well above half.
  expect(result.volume).toBeGreaterThan(25000);
  expect(result.volume).toBeLessThan(40000);

  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(OUT, 'ai-fillet-part.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/ai-sculpt-fillet-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The desktop window opens; a rounded-edge block appears.

If it FAILS, diagnose honestly — do NOT loosen anything:
- `fillet`/`morphologicalFilletManifold` error → paste the exact error, report BLOCKED (the API call may not match — re-check Task 1 Step 1).
- `usedFillet` false → the AI did not use the fillet op; print the plan; DONE_WITH_CONCERNS.
- Volume wildly off → report the actual number; the morphological fillet is voxel-based so some volume variance is expected, but a wildly wrong number is a real problem — report it.
- Timeout → the morphological fillet (voxelization) is slow; report how far it got.

- [ ] **Step 4: Verify the screenshot**

Open `autonomous-output/ai-fillet-part.png` and honestly describe what the
viewport shows — a block with visibly rounded edges, or not.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-sculpt-fillet-electron.spec.js
git commit -m "Add headed spec — AI sculpts a filleted block (fillet operation)"
```

(Do NOT git-add `autonomous-output/`.)

---

## Self-Review

**Spec coverage:** Adds the `fillet` atomic op via ArchDisc's existing
morphological fillet — incremental geometry capability. Honest: it is a
voxel-based / staircased rounding, not an exact B-rep fillet; documented in the
JSDoc. `chamfer` and exact filleting remain out of scope.

**Placeholder scan:** No placeholders. Task 1 Step 1 is a deliberate
API-verification step.

**Type consistency:** `fillet(part, radius)` — async, WASM-heap-safe.
`OP_SCHEMA.fillet = ['radius']`; `executeSculptPlan` dispatches `o.radius`;
the prompt documents `{op,radius}`. `fillet` is added to the AtomicOps import +
the `window.__archdiscAtomic` op list.
