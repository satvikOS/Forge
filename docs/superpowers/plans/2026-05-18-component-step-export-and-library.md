# Component STEP Export + Component Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A completed component can be exported to a STEP file and saved into a component library with a stable id — the foundation for the Omega Seamaster deliverable ("all components in STEP files", "save each completed component with an id in the App").

**Architecture:** A new `ai/sculptor/ComponentLibrary.js`: `partToStep(part)` exports a sculpted `Part`'s solid to STEP text via ArchDisc's existing `foundation/StepExport.js`; a `ComponentLibrary` registry stores each saved component (`{id, name, stepText, volume}`). Exposed on `window.__archdiscComponents`. A headed Electron spec sculpts a component, saves it, exports its STEP to disk, and verifies the STEP is a valid ISO-10303 file.

**Tech Stack:** ES modules; `manifold-3d`; ArchDisc `foundation/StepExport.js`; React. Tests: Node-mode Playwright for the registry bookkeeping; a headed `_electron` spec for the real STEP export. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

This plan is part of the **Omega Seamaster build** — an autonomous loop
constructing a watch component by component. The deliverable is a ZIP of every
component as a STEP file plus the assembled watch as STEP. This plan builds the
first enabling capability: turning a sculpted component into a saved, STEP-
exportable library entry.

**Verified facts:**
- `frontend/src/foundation/StepExport.js` exports `manifoldToSTEP` — used by the
  "Export STEP" tool handler in `frontend/src/workbenches/mechanical-cad/
  ToolExecutionEngine.js` (`import { manifoldToSTEP } from '../../foundation/
  StepExport.js'`). The exact call shape (sync vs async, argument list) must be
  confirmed against that handler — Task 1 Step 1.
- A sculpted component is a `Part` (from `kernel/atomic/Part.js`); `part.solid`
  is its manifold-3d solid; `part.solid.volume()` gives mm³.
- `WorkbenchMechanical.jsx` registers `window.__archdiscAtomic` and
  `window.__archdiscSculptor`. A new `window.__archdiscComponents` will hold the
  component library.
- Headed Electron specs launch the desktop app (loads `frontend/dist` — rebuild
  first); pattern: `e2e/ai-assembly-electron.spec.js`. Use bare imports
  (`import fs from 'fs'`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/ai/sculptor/ComponentLibrary.js` | NEW — `partToStep`, `ComponentLibrary` registry. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — register `window.__archdiscComponents`. |
| `e2e/component-library.spec.js` | NEW — Node-mode tests for the registry. |
| `e2e/component-step-export-electron.spec.js` | NEW — headed test: sculpt → save → STEP to disk. |

---

## Task 1: `ComponentLibrary.js` — the registry + STEP export

**Files:**
- Create: `frontend/src/ai/sculptor/ComponentLibrary.js`
- Test: `e2e/component-library.spec.js`

- [ ] **Step 1: Confirm the `manifoldToSTEP` API**

Read the "Export STEP" tool handler in `frontend/src/workbenches/mechanical-cad/
ToolExecutionEngine.js` (grep for `manifoldToSTEP`). Note exactly how it is
called — argument(s), whether it is `await`ed (async) or sync, and what it
returns (a STEP string). Task 1 Step 3's `partToStep` must mirror that call.

- [ ] **Step 2: Write the failing test** — create `e2e/component-library.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { ComponentLibrary } from '../frontend/src/ai/sculptor/ComponentLibrary.js';

test.describe('ComponentLibrary — registry', () => {
  test('a new library is empty', () => {
    const lib = new ComponentLibrary();
    expect(lib.count()).toBe(0);
    expect(lib.list()).toEqual([]);
  });

  test('saveComponent stores a component and returns its entry', () => {
    const lib = new ComponentLibrary();
    const entry = lib.saveComponent({ id: 'C001', name: 'mainplate', stepText: 'ISO-10303-21;', volume: 1234 });
    expect(entry.id).toBe('C001');
    expect(lib.count()).toBe(1);
    expect(lib.get('C001').name).toBe('mainplate');
  });

  test('saveComponent rejects a duplicate id', () => {
    const lib = new ComponentLibrary();
    lib.saveComponent({ id: 'C001', name: 'a', stepText: 's', volume: 1 });
    expect(() => lib.saveComponent({ id: 'C001', name: 'b', stepText: 's', volume: 2 }))
      .toThrow(/duplicate/);
  });

  test('saveComponent rejects a missing id or empty stepText', () => {
    const lib = new ComponentLibrary();
    expect(() => lib.saveComponent({ name: 'a', stepText: 's', volume: 1 })).toThrow(/id/);
    expect(() => lib.saveComponent({ id: 'C1', name: 'a', stepText: '', volume: 1 })).toThrow(/stepText/);
  });

  test('list returns saved components in insertion order', () => {
    const lib = new ComponentLibrary();
    lib.saveComponent({ id: 'C001', name: 'a', stepText: 's', volume: 1 });
    lib.saveComponent({ id: 'C002', name: 'b', stepText: 's', volume: 2 });
    expect(lib.list().map((c) => c.id)).toEqual(['C001', 'C002']);
  });

  test('get returns null for an unknown id', () => {
    const lib = new ComponentLibrary();
    expect(lib.get('nope')).toBe(null);
  });
});
```

- [ ] **Step 3: Run test, verify it FAILS**

Run: `./node_modules/.bin/playwright test e2e/component-library.spec.js --reporter=list`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `frontend/src/ai/sculptor/ComponentLibrary.js`:**

```js
/**
 * ArchDisc — Component Library.
 *
 * As the autonomous sculptor completes each component of a product, the
 * component is exported to a STEP file and saved here with a stable id. The
 * library is the running record of finished components — the basis of the
 * final deliverable ZIP (every component as a STEP file).
 */

import { manifoldToSTEP } from '../../foundation/StepExport.js';

/**
 * Export a sculpted Part's solid to STEP (ISO 10303-21) text.
 *
 * @param {object} part  a Part with a `.solid` manifold-3d object
 * @returns {Promise<string>} the STEP file text
 */
export async function partToStep(part) {
  if (!part || !part.solid) throw new Error('partToStep: part has no solid');
  // NOTE: mirror the exact manifoldToSTEP call shape used by the "Export STEP"
  // tool handler in ToolExecutionEngine.js (confirmed in Task 1 Step 1).
  const step = await manifoldToSTEP(part.solid);
  if (typeof step !== 'string' || !step) throw new Error('partToStep: STEP export produced no text');
  return step;
}

/**
 * An ordered registry of finished components.
 */
export class ComponentLibrary {
  constructor() {
    this._entries = new Map();   // id -> {id, name, stepText, volume}
  }

  /**
   * Save a finished component. Throws on a missing id, empty stepText, or a
   * duplicate id.
   * @param {{id:string, name:string, stepText:string, volume:number}} c
   * @returns {{id,name,stepText,volume}} the stored entry
   */
  saveComponent(c) {
    if (!c || typeof c.id !== 'string' || !c.id) throw new Error('saveComponent: a non-empty string id is required');
    if (typeof c.stepText !== 'string' || !c.stepText) throw new Error('saveComponent: non-empty stepText is required');
    if (this._entries.has(c.id)) throw new Error(`saveComponent: duplicate id '${c.id}'`);
    const entry = { id: c.id, name: c.name ?? c.id, stepText: c.stepText, volume: c.volume ?? 0 };
    this._entries.set(c.id, entry);
    return entry;
  }

  /** @param {string} id @returns {object|null} */
  get(id) {
    return this._entries.get(id) ?? null;
  }

  /** @returns {Array<object>} saved components in insertion order */
  list() {
    return [...this._entries.values()];
  }

  /** @returns {number} */
  count() {
    return this._entries.size;
  }
}
```

- [ ] **Step 5: Run test, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/component-library.spec.js --reporter=list`
Expected: PASS — 6 passed.

(Note: `partToStep` is not unit-tested here — it needs manifold-3d; Task 3's
headed spec exercises it. The `import` of `StepExport.js` may make this module
non-Node-importable IF `StepExport.js` transitively imports the manifold WASM
kernel. If Step 5 fails with a module-load error from `StepExport.js`, that is a
real finding: report it — the fix is to move `partToStep` into its own file
that the registry does not import, so `ComponentLibrary` (the registry) stays
Node-testable. Do NOT delete the tests to make them pass.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/ai/sculptor/ComponentLibrary.js e2e/component-library.spec.js
git commit -m "Add ComponentLibrary — STEP export + component registry"
```

---

## Task 2: Register `window.__archdiscComponents`

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Import**

Add an import alongside the other `ai/sculptor` imports:
```js
import { ComponentLibrary, partToStep } from '../../ai/sculptor/ComponentLibrary.js';
```

- [ ] **Step 2: Register a single shared library on `window`**

Add a `useEffect` (after the `window.__archdiscSculptor` effect) that creates one
`ComponentLibrary` for the session and exposes it plus `partToStep`:

```js
    // The session-wide component library: each finished component is saved
    // here (and exported to STEP) so the build never loses a completed part.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const library = new ComponentLibrary();
        window.__archdiscComponents = {
            library,
            partToStep,
            save: async ({ id, name, part }) => {
                const stepText = await partToStep(part);
                return library.saveComponent({ id, name, stepText, volume: part.solid.volume() });
            },
            list: () => library.list(),
            get: (id) => library.get(id),
            count: () => library.count(),
        };
        return () => { delete window.__archdiscComponents; };
    }, []);
```

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds. Fix
only import/syntax you introduced if it fails.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Register window.__archdiscComponents — session component library"
```

---

## Task 3: Headed Electron spec — sculpt → save → STEP to disk

**Files:**
- Create: `e2e/component-step-export-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`.

- [ ] **Step 2: Create `e2e/component-step-export-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Component STEP export, end to end, in the real ArchDisc desktop app: the AI
 * sculpts a component, it is saved into the component library with an id, and
 * its STEP file is written to disk — the unit operation of the Seamaster build.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output', 'seamaster', 'components');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('a sculpted component is saved with an id and exported to a STEP file', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscSculptor && !!window.__archdiscComponents, null, { timeout: 60000 });

  // Sculpt one component (a watch case-back ring is representative) and save it.
  const description = 'A flat ring (annulus) 40 mm outer diameter, 30 mm inner diameter, '
    + '3 mm thick.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const { part } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
    const entry = await window.__archdiscComponents.save({ id: 'SM-001', name: 'case-back-ring', part });
    return {
      count: window.__archdiscComponents.count(),
      id: entry.id, name: entry.name, volume: entry.volume,
      stepHead: entry.stepText.slice(0, 40),
      stepLength: entry.stepText.length,
    };
  }, { description, llm });

  console.log('  saved component: ' + JSON.stringify(result));

  expect(result.count).toBe(1);
  expect(result.id).toBe('SM-001');
  expect(result.volume).toBeGreaterThan(0);
  // a valid STEP (ISO 10303-21) file starts with the ISO-10303-21 token
  expect(result.stepHead).toContain('ISO-10303-21');
  expect(result.stepLength).toBeGreaterThan(200);

  // write the component's STEP file to disk — the deliverable artifact
  const stepText = await win.evaluate(() => window.__archdiscComponents.get('SM-001').stepText);
  fs.writeFileSync(path.join(OUT, 'SM-001-case-back-ring.step'), stepText);

  await win.waitForTimeout(2000);
  await win.screenshot({ path: path.resolve(__dirname, '..', 'autonomous-output', 'component-step-export.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/component-step-export-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. A component is sculpted, saved with id `SM-001`, and
`autonomous-output/seamaster/components/SM-001-case-back-ring.step` is written.

If it FAILS, diagnose honestly — do NOT loosen assertions or mock the LLM:
- `partToStep` / `manifoldToSTEP` error → the STEP-export call shape is wrong;
  paste the exact error, report BLOCKED — the call must match the "Export STEP"
  handler.
- STEP text missing the `ISO-10303-21` token → the export produced something
  that is not a STEP file; report BLOCKED with what it produced.
- `window.__archdiscComponents` undefined → Task 2 wiring did not take; BLOCKED.
- LLM / AtomicOps error → paste it; report BLOCKED.

- [ ] **Step 4: Verify the artifact**

Confirm `autonomous-output/seamaster/components/SM-001-case-back-ring.step`
exists, is non-empty, and its first line contains `ISO-10303-21`. Report its
byte size.

- [ ] **Step 5: Commit**

```bash
git add e2e/component-step-export-electron.spec.js
git commit -m "Add headed spec — sculpt, save with id, and STEP-export a component"
```

(Do NOT git-add `autonomous-output/`.)

---

## Self-Review

**Spec coverage:** Establishes "component → STEP file" and "save component with
an id" — the two explicit format requirements of the Seamaster deliverable. The
construct→verify→save build loop, assembly, render, and ZIP packaging are
subsequent plans.

**Placeholder scan:** No placeholders. Task 1 Step 1 is a deliberate
API-verification step.

**Type consistency:** `partToStep(part) -> Promise<string>`; `ComponentLibrary`
with `saveComponent({id,name,stepText,volume})`, `get(id)`, `list()`, `count()`.
`window.__archdiscComponents` exposes `save({id,name,part})`, `list`, `get`,
`count`, `library`, `partToStep` — consistent across the module, the workbench,
and the spec.

---

## Subsequent Plans (the Seamaster build pipeline)

- **Plan 12 — the component build loop:** decompose the watch into a component
  manifest; per component: sculpt → vision-verify → save+STEP. Resumable.
- **Plan 13 — assembly of saved components + assembled-watch STEP export.**
- **Plan 14 — motion render of the assembly → .mp4/.avi.**
- **Plan 15 — deliverable ZIP** (all component STEPs + assembled STEP + video).
- Then: iterate component construction across loop firings until the manifest
  is complete.
