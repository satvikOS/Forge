# Atomic-CAD L0 Feature Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI issues a sequence of atomic CAD operations and a real 3-D solid is sculpted, step by step, in the running ArchDisc viewport — with an editable construction history.

**Architecture:** A manifold-native `Part` (the construction-history record) plus an `AtomicOps` operation API (start a sketch, draw rectangle/circle entities, finish the sketch into a closed profile, extrude it into a manifold-3d solid). The mechanical workbench exposes `AtomicOps` on `window.__archdiscAtomic`, wired to the live Three.js scene, so a headed Playwright spec — standing in for the AI — sculpts a part in the visible app and a human watches it appear.

**Tech Stack:** Plain ES modules. `manifold-3d` WASM kernel (via `foundation/manifoldKernel.js`'s `getManifold`). React (the workbench component). Tests: a Node-mode Playwright spec for the pure-bookkeeping `Part`, and a **headed-browser** Playwright spec for the in-app sculpt. Runner: `./node_modules/.bin/playwright` (pinned 1.59 — never `npx`).

---

## Context for the Engineer

This is **Plan 2** of the autonomous atomic-CAD sculptor (spec:
`docs/superpowers/specs/2026-05-17-autonomous-atomic-cad-sculptor-design.md`).
**Plan 1** already shipped two kernel-free pure-math modules under
`frontend/src/kernel/atomic/`:
- `ParametricCurve.js` — exports `involute`, `involuteParamAtRadius`,
  `archimedeanSpiral`, `ellipseArc`, `circlePolyline`.
- `SketchProfile.js` — exports `signedArea`, `isClockwise`, `orient`,
  `chainLoops`.

Plan 2 builds the feature pipeline that turns those into real 3-D solids
visible in the app.

**Key facts about the existing codebase (verified):**
- `frontend/src/foundation/manifoldKernel.js` exports `async getManifold()` →
  the manifold-3d module. Notable members: `Manifold` (3-D solids),
  `CrossSection` (2-D shapes). Usage pattern:
  `const cs = Mod.CrossSection.ofPolygons([poly]); const m = Mod.Manifold.extrude(cs, height);`
  manifold objects hold WASM heap — call `.delete()` on every intermediate.
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` has a
  **non-exported** function `addFoundationManifoldToScene(scene, viewport,
  manifold, color)` (around line 226) that builds a Three.js mesh from a
  manifold, scales mm→m, adds it to the scene, registers the body, and
  auto-frames the camera. Task 3 exports it.
- `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` is the
  React component for the mechanical workbench. It calls `useViewport()` to get
  `viewport`, and `viewport.scene` is the live Three.js scene. The component is
  what loads at the app root `/`.
- Tests live in `e2e/`. `playwright.config.js` has `headless: false`,
  `baseURL: http://localhost:3000`, and a `webServer` that runs vite. Headed
  specs that use a browser `page` open a VISIBLE window.
- In spec files use bare imports (`import fs from 'fs'`) — never `node:*`.
- Run a spec: `./node_modules/.bin/playwright test e2e/NAME.spec.js --reporter=list`.

**Design note — why a manifold-native `Part`, not the old `FeatureTree`:**
The spec mentioned extending `kernel/features/FeatureTree.js`. On inspection,
that module is built on a separate, older geometry kernel (`PrimitiveBuilder` /
`TopoSolid`), NOT manifold-3d. The visible render path requires manifold-3d
objects. So Plan 2 gives `Part` its own manifold-native feature list — a real,
ordered, human-readable construction history — and leaves the legacy
`FeatureTree.js` untouched. This is a deliberate, scoped deviation from the
spec's wording, honoring its intent (an editable history) without a risky
cross-kernel refactor.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/Part.js` | The construction-history record: an ordered list of features + the current solid. Kernel-free bookkeeping (stores opaque solid values, computes no geometry). |
| `frontend/src/kernel/atomic/AtomicOps.js` | The atomic operation API: `createPart`, `startSketch`, `sketchRectangle`, `sketchCircle`, `finishSketch`, `extrude`. Drives `Part`, uses `manifold-3d` for solids. |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | MODIFIED — export `addFoundationManifoldToScene`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — register `window.__archdiscAtomic` wired to the live scene. |
| `e2e/atomic-part-record.spec.js` | Node-mode unit tests for `Part`. |
| `e2e/atomic-sculpt-bracket.spec.js` | Headed-browser test: sculpt a bracket in the running app. |

---

## Task 1: `Part.js` — the construction-history record

**Files:**
- Create: `frontend/src/kernel/atomic/Part.js`
- Test: `e2e/atomic-part-record.spec.js`

- [ ] **Step 1: Write the failing test**

Create `e2e/atomic-part-record.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { Part } from '../frontend/src/kernel/atomic/Part.js';

test.describe('Part — construction-history record', () => {
  test('a new Part is empty and unnamed-safe', () => {
    const p = new Part('Bracket');
    expect(p.name).toBe('Bracket');
    expect(p.featureCount()).toBe(0);
    expect(p.solid).toBe(null);
    expect(p.activeSketch).toBe(null);
  });

  test('addFeature appends to the history in order', () => {
    const p = new Part();
    p.addFeature('startSketch', { plane: 'XY' });
    p.addFeature('sketchRectangle', { w: 10, h: 5 });
    expect(p.featureCount()).toBe(2);
    expect(p.features[0].type).toBe('startSketch');
    expect(p.features[1].type).toBe('sketchRectangle');
  });

  test('addFeature with a solid updates the current solid', () => {
    const p = new Part();
    const fakeSolid = { volume: () => 100 };
    p.addFeature('extrude', { distance: 4 }, fakeSolid);
    expect(p.solid).toBe(fakeSolid);
  });

  test('addFeature without a solid leaves the current solid unchanged', () => {
    const p = new Part();
    const fakeSolid = { volume: () => 100 };
    p.addFeature('extrude', { distance: 4 }, fakeSolid);
    p.addFeature('startSketch', { plane: 'XY' });   // no solid arg
    expect(p.solid).toBe(fakeSolid);
  });

  test('addFeature copies params (later mutation of the caller object does not leak in)', () => {
    const p = new Part();
    const params = { w: 10 };
    p.addFeature('sketchRectangle', params);
    params.w = 999;
    expect(p.features[0].params.w).toBe(10);
  });

  test('each feature gets a unique id', () => {
    const p = new Part();
    const a = p.addFeature('startSketch', {});
    const b = p.addFeature('finishSketch', {});
    expect(a.id).not.toBe(b.id);
  });

  test('describe renders the history as an ordered arrow chain', () => {
    const p = new Part();
    p.addFeature('startSketch', {});
    p.addFeature('sketchRectangle', {});
    p.addFeature('extrude', {});
    expect(p.describe()).toBe('1. startSketch -> 2. sketchRectangle -> 3. extrude');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/playwright test e2e/atomic-part-record.spec.js --reporter=list`
Expected: FAIL — `Cannot find module '.../kernel/atomic/Part.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/kernel/atomic/Part.js`:

```js
/**
 * ArchDisc Kernel — Part: the atomic construction-history record.
 *
 * A Part is an ordered list of features; each feature stores its type and
 * its parameters. The Part IS the editable construction history a human can
 * read and replay. Kernel-free bookkeeping — it holds an opaque `solid`
 * value (a manifold-3d object, supplied by AtomicOps) but never computes
 * geometry itself.
 */

let _partId = 0;
let _featureId = 0;

export class Part {
  constructor(name = 'Part') {
    this.id = ++_partId;
    this.name = name;
    this.features = [];        // ordered construction history
    this.solid = null;         // current result — opaque (a manifold-3d object)
    this.activeSketch = null;  // the open sketch, or null
    this.pendingProfile = null;// a finished sketch's closed loops, awaiting a feature
  }

  /**
   * Append a feature to the history. If `solid` is provided, it becomes the
   * Part's current solid; if omitted, the current solid is left unchanged.
   *
   * @param {string} type    operation name (e.g. 'extrude')
   * @param {object} params  operation parameters (copied, not referenced)
   * @param {*} [solid]      the geometry this feature produced, if any
   * @returns {{id:number,type:string,params:object}}
   */
  addFeature(type, params, solid) {
    const feature = { id: ++_featureId, type, params: { ...params } };
    this.features.push(feature);
    if (solid !== undefined) this.solid = solid;
    return feature;
  }

  /** @returns {number} number of features in the history */
  featureCount() {
    return this.features.length;
  }

  /** @returns {string} the construction history as an ordered arrow chain */
  describe() {
    return this.features.map((f, i) => `${i + 1}. ${f.type}`).join(' -> ');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/playwright test e2e/atomic-part-record.spec.js --reporter=list`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/atomic/Part.js e2e/atomic-part-record.spec.js
git commit -m "Add Part construction-history record (atomic-CAD L0 feature pipeline)"
```

---

## Task 2: `AtomicOps.js` — sketch + extrude operations

**Files:**
- Create: `frontend/src/kernel/atomic/AtomicOps.js`

This module uses the `manifold-3d` WASM kernel, so it cannot be unit-tested in
Node — the headed spec in Task 4 is its integration test. There is no separate
test file for this task.

- [ ] **Step 1: Write the implementation**

Create `frontend/src/kernel/atomic/AtomicOps.js`:

```js
/**
 * ArchDisc Kernel — Atomic CAD Operations.
 *
 * The canonical, parametric operation set the AI (and a human) sequences to
 * sculpt a part feature by feature. Plan 2 surface: start a sketch, draw
 * rectangle / circle entities, finish the sketch into a closed profile, and
 * extrude it into a manifold-3d solid. Every operation records a feature on
 * the Part — the construction history.
 *
 * Constraints, cut, revolve, sketch-on-face and patterns are later plans.
 */

import { getManifold } from '../../foundation/manifoldKernel.js';
import { circlePolyline } from './ParametricCurve.js';
import { orient } from './SketchProfile.js';
import { Part } from './Part.js';

/**
 * Create a new, empty Part.
 * @param {string} [name]
 * @returns {Part}
 */
export function createPart(name = 'Part') {
  return new Part(name);
}

/**
 * Open a new sketch on a datum plane. Only one sketch may be open at a time.
 * @param {Part} part
 * @param {string} [plane]  datum plane id ('XY' for Plan 2)
 * @returns {object} the open sketch
 */
export function startSketch(part, plane = 'XY') {
  if (part.activeSketch) throw new Error('startSketch: a sketch is already open — finishSketch first');
  part.activeSketch = { plane, loops: [] };
  part.addFeature('startSketch', { plane });
  return part.activeSketch;
}

/**
 * Add an axis-aligned rectangle (centred at cx,cy) to the open sketch.
 * @param {Part} part
 * @param {number} cx  centre x (mm)
 * @param {number} cy  centre y (mm)
 * @param {number} w   width (mm, > 0)
 * @param {number} h   height (mm, > 0)
 * @returns {Array<[number,number]>} the CCW rectangle loop
 */
export function sketchRectangle(part, cx, cy, w, h) {
  if (!part.activeSketch) throw new Error('sketchRectangle: no open sketch — call startSketch first');
  if (!(w > 0) || !(h > 0)) throw new Error('sketchRectangle: w and h must be > 0');
  const hw = w / 2, hh = h / 2;
  const loop = orient(
    [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]],
    true,
  );
  part.activeSketch.loops.push(loop);
  part.addFeature('sketchRectangle', { cx, cy, w, h });
  return loop;
}

/**
 * Add a circle to the open sketch.
 * @param {Part} part
 * @param {number} cx        centre x (mm)
 * @param {number} cy        centre y (mm)
 * @param {number} r         radius (mm, > 0)
 * @param {number} [segments]  polyline segment count (>= 3)
 * @returns {Array<[number,number]>} the CCW circle loop
 */
export function sketchCircle(part, cx, cy, r, segments = 64) {
  if (!part.activeSketch) throw new Error('sketchCircle: no open sketch — call startSketch first');
  const loop = orient(circlePolyline(r, segments, cx, cy), true);
  part.activeSketch.loops.push(loop);
  part.addFeature('sketchCircle', { cx, cy, r });
  return loop;
}

/**
 * Close the open sketch. Its loops become the pending profile for the next
 * feature operation (e.g. extrude).
 * @param {Part} part
 * @returns {Array<Array<[number,number]>>} the closed profile loops
 */
export function finishSketch(part) {
  if (!part.activeSketch) throw new Error('finishSketch: no open sketch');
  if (part.activeSketch.loops.length === 0) throw new Error('finishSketch: sketch has no geometry');
  part.pendingProfile = part.activeSketch.loops;
  const loopCount = part.pendingProfile.length;
  part.activeSketch = null;
  part.addFeature('finishSketch', { loops: loopCount });
  return part.pendingProfile;
}

/**
 * Extrude the pending sketch profile by `distance` mm and union it into the
 * Part's current solid. Records an 'extrude' feature.
 * @param {Part} part
 * @param {number} distance  extrude depth (mm, > 0)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function extrude(part, distance) {
  if (!part.pendingProfile) throw new Error('extrude: no finished sketch profile — call finishSketch first');
  if (!(distance > 0)) throw new Error('extrude: distance must be > 0');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const block = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  let result = block;
  if (part.solid) {
    result = part.solid.union(block);
    part.solid.delete();
    block.delete();
  }
  part.solid = result;
  part.pendingProfile = null;
  part.addFeature('extrude', { distance }, result);
  return result;
}
```

- [ ] **Step 2: Verify the module parses (no syntax error)**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js`
Expected: no output, exit 0. (This only checks syntax — behavior is verified by Task 4's headed spec.)

If `node --check` reports an error on the `import` lines, that is expected ONLY
if your Node version rejects ESM in `--check`; in that case skip this step and
rely on Task 4. Do not "fix" it by changing the imports.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "Add AtomicOps sketch + extrude operations (atomic-CAD L0 feature pipeline)"
```

---

## Task 3: Wire `AtomicOps` into the live app

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Export `addFoundationManifoldToScene`**

In `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`, find the line
(around line 226):

```js
function addFoundationManifoldToScene(scene, viewport, manifold, color = 0x9aa3ad) {
```

Change it to add the `export` keyword:

```js
export function addFoundationManifoldToScene(scene, viewport, manifold, color = 0x9aa3ad) {
```

Make no other change to that file.

- [ ] **Step 2: Register `window.__archdiscAtomic` in the workbench**

In `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`:

(a) Ensure `useEffect` is imported from React. Find the React import line near
the top (it imports `useState`, `useCallback`, `useRef`). If `useEffect` is not
already in that list, add it. Example — if the line is
`import React, { useState, useCallback, useRef } from 'react';`
change it to
`import React, { useState, useCallback, useRef, useEffect } from 'react';`

(b) Add these two imports alongside the existing import of `executeTool` (which
is `import { executeTool, getCurrentAssembly } from './ToolExecutionEngine';`):

```js
import { addFoundationManifoldToScene } from './ToolExecutionEngine';
import { createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude } from '../../kernel/atomic/AtomicOps.js';
```

(c) Inside the `WorkbenchMechanical` component body, AFTER the line
`const viewport = useViewport();` and before the `handleToolExecute` callback,
add this effect:

```js
    // Expose the atomic CAD operation set on window so the autonomous
    // sculptor (and headed e2e specs) can drive ArchDisc's real tools and
    // see each feature appear in the live viewport.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const scene = viewport?.scene;
        if (!scene) return undefined;
        window.__archdiscAtomic = {
            createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude,
            render: (part, color) =>
                addFoundationManifoldToScene(scene, viewport, part.solid, color ?? 0x9aa3ad),
        };
        return () => { delete window.__archdiscAtomic; };
    }, [viewport]);
```

- [ ] **Step 3: Verify the app still builds**

Run: `cd frontend && npx vite build`
Expected: build completes with no error. Then `cd ..` back to the repo root.

If the build fails, read the error and fix the import path or syntax — do not
proceed until the build is green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Expose AtomicOps on window, wired to the live viewport (atomic-CAD L0 feature pipeline)"
```

---

## Task 4: Headed spec — sculpt a bracket in the running app

**Files:**
- Create: `e2e/atomic-sculpt-bracket.spec.js`

- [ ] **Step 1: Write the headed test**

Create `e2e/atomic-sculpt-bracket.spec.js`:

```js
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * The autonomous sculptor's first real product: a headed Playwright spec —
 * standing in for the AI — issues a sequence of atomic CAD operations and a
 * real 3-D solid is sculpted, step by step, in the running ArchDisc viewport.
 * No premade model, no generator: startSketch -> sketchRectangle ->
 * finishSketch -> extrude, twice, building an L-bracket.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test('AtomicOps sculpts a real solid, step by step, in the ArchDisc viewport', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await page.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 30000 });

  // ── Feature 1: sketch a 60x40 rectangle and extrude it 12 mm ──────────────
  const step1 = await page.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('L-Bracket');
    window.__atomicPart = part;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 60, 40);
    A.finishSketch(part);
    await A.extrude(part, 12);
    A.render(part);
    return { features: part.featureCount(), volume: part.solid.volume() };
  });
  expect(step1.volume).toBeGreaterThan(0);
  expect(step1.features).toBe(4);                 // start, rect, finish, extrude
  await page.waitForTimeout(2500);                // headed pause — watch it appear
  fs.writeFileSync(path.join(OUT, 'atomic-bracket-step1.png'),
    await page.locator('canvas').first().screenshot());

  // ── Feature 2: a second sketch + extrude unions an upstand -> L-bracket ───
  const step2 = await page.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = window.__atomicPart;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 24, 0, 12, 40);       // flush with the base's right edge
    A.finishSketch(part);
    await A.extrude(part, 40);                    // tall upstand
    A.render(part);
    return { features: part.featureCount(), volume: part.solid.volume(), history: part.describe() };
  });
  expect(step2.volume).toBeGreaterThan(step1.volume);
  expect(step2.features).toBe(8);
  console.log('  sculpted L-bracket — construction history:');
  console.log('  ' + step2.history);
  console.log(`  final volume: ${step2.volume.toFixed(0)} mm^3`);
  await page.waitForTimeout(3000);                // headed pause — watch the final part
  fs.writeFileSync(path.join(OUT, 'atomic-bracket-step2.png'),
    await page.locator('canvas').first().screenshot());
});
```

- [ ] **Step 2: Run the headed test**

Run: `./node_modules/.bin/playwright test e2e/atomic-sculpt-bracket.spec.js --reporter=list`
Expected: PASS — 1 passed. A visible browser window opens; a grey solid appears
in the 3-D viewport, then grows an upstand. `autonomous-output/atomic-bracket-step1.png`
and `atomic-bracket-step2.png` are written.

If it FAILS:
- `window.__archdiscAtomic` never appears → Task 3's effect did not run; check
  the effect is inside the component body and `viewport.scene` becomes truthy.
- An `extrude`/`union` error → report BLOCKED with the exact console error; do
  not guess at manifold-3d API changes.
- Fix only the spec or Task 3 wiring — never silently weaken an assertion.

- [ ] **Step 3: Verify the images**

Confirm `autonomous-output/atomic-bracket-step1.png` and
`atomic-bracket-step2.png` exist and are non-empty. Open `atomic-bracket-step2.png`
and confirm it shows a solid 3-D part in the viewport (a base block with a
taller upstand), not an empty scene.

- [ ] **Step 4: Commit**

```bash
git add e2e/atomic-sculpt-bracket.spec.js
git commit -m "Add headed spec — AtomicOps sculpts a bracket in the live app (atomic-CAD L0 feature pipeline)"
```

(Do NOT git-add the `autonomous-output/` images — generated artifacts.)

---

## Self-Review

**Spec coverage:** Plan 2 implements the spec's L0 feature-pipeline intent for
the sketch→extrude path: a parametric operation set (`AtomicOps`), a real
construction history (`Part`), and geometry that appears in the live viewport.
Constraints (`SketchSolver` wiring), `cut`/`revolve`, sketch-on-face, patterns,
and `GeometryQuery` (L1) are explicitly out of scope here — Plan 3+.

**Placeholder scan:** No `TBD`/`TODO`/"add error handling" placeholders. Every
code step shows complete code; every command shows expected output.

**Type consistency:** `Part` API — `addFeature(type, params, solid?)`,
`featureCount()`, `describe()`, fields `features`, `solid`, `activeSketch`,
`pendingProfile` — used identically across `Part.js`, `AtomicOps.js`, and both
specs. `AtomicOps` exports `createPart, startSketch, sketchRectangle,
sketchCircle, finishSketch, extrude` — the exact set imported by
`WorkbenchMechanical.jsx` and called in the headed spec. Point representation
is `[x,y]`; loops are CCW (via `orient`).

---

## Subsequent Plans

- **Plan 3 — sketch constraints + cut + revolve + sketch-on-face.** Wire
  `SketchSolver`; add `cut`, `revolve`; sketch on an existing face.
- **Plan 4 — patterns, fillet, `TopoNaming`, `GeometryQuery` (L1).**
- **Plan 5+ — L2 AI Sculptor and beyond** (per the spec).
