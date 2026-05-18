# Component Build Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Decompose the watch into a component manifest, and build components one at a time — each through the **vision-verify loop** (so geometrically-wrong parts are caught and revised) — saving each with an id and a STEP file. Resumable across loop firings.

**Architecture:** A new `ai/sculptor/ComponentManifest.js` asks the LLM to decompose the product into `{id, name, description}` components. A headed Electron spec gets the manifest, then for each not-yet-built component runs the Plan-6 `sculptAndVerify` loop, saves the accepted part to the component library (Plan 11), and writes its STEP file to disk. Resumability: components already in the library / on disk are skipped.

**Tech Stack:** ES modules; `manifold-3d`; the BYO-LLM layer; React. Tests: Node-mode Playwright for the manifest prompt/parser; a headed `_electron` spec for the real build loop. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

This is part of the **Omega Seamaster autonomous build**. Plan 11 shipped the
component library + STEP export (`window.__archdiscComponents` with
`save({id,name,part})`, `get`, `list`, `count`). Plan 6 shipped `sculptAndVerify`
— a render→vision-verify→revise loop that takes injected callbacks.

**Critical finding driving this plan:** plain `sculptPart` has produced
geometrically-wrong parts three times (a mis-oriented pillar; a solid disc when
a ring was asked for). The component build loop MUST route every component
through `sculptAndVerify` so the vision LLM catches the error and revises —
otherwise the watch is assembled from wrong parts.

**Verified facts:**
- `frontend/src/ai/sculptor/PartSculptor.js` exports `sculptAndVerify({description,
  requestPlan, executePlan, renderAndCapture, verify, maxRounds})` and
  `requestSculptPlan({description, llm, providers})`.
- `frontend/src/ai/sculptor/PartVerifier.js` exports `verifyRender({description,
  imageDataUrl, llm})`.
- `window.__archdiscSculptor` exposes `requestSculptPlan`, `executeSculptPlan`,
  `sculptPart`, `sculptAssembly`. `window.__archdiscComponents` exposes
  `save({id,name,part})`, `get`, `list`, `count`. `window.__archdiscAtomic` has
  the ops + `render`.
- LLM creds: `.llm-credentials.local.json` (`{provider, endpoint→baseUrl,
  apiKey, model}`).
- The Electron desktop app loads `frontend/dist` — rebuild before launching.
  Pattern: `e2e/ai-verify-loop-electron.spec.js` (it runs `sculptAndVerify`
  Node-side with page-bridge callbacks + Playwright screenshots).
- Honest scope: a watch is 300-1000 components; one loop firing builds a small
  batch. This spec builds the first 2 as proof; later firings build more, the
  manifest + library making the build resumable.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/ai/sculptor/ComponentManifest.js` | NEW — `buildManifestPrompt`, `parseManifest`, `requestManifest`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — expose `requestManifest` on `window.__archdiscSculptor`. |
| `e2e/component-manifest.spec.js` | NEW — Node-mode tests for the manifest prompt/parser. |
| `e2e/seamaster-build-batch-electron.spec.js` | NEW — headed test: decompose + build the first components through the verify loop. |

---

## Task 1: `ComponentManifest.js` — decompose a product into components

**Files:**
- Create: `frontend/src/ai/sculptor/ComponentManifest.js`
- Test: `e2e/component-manifest.spec.js`

- [ ] **Step 1: Write the failing test** — create `e2e/component-manifest.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { buildManifestPrompt, parseManifest } from '../frontend/src/ai/sculptor/ComponentManifest.js';

test.describe('ComponentManifest — prompt', () => {
  test('the prompt asks for components with id, name and description', () => {
    const p = buildManifestPrompt();
    expect(p).toContain('components');
    expect(p).toContain('id');
    expect(p).toContain('description');
  });
});

test.describe('ComponentManifest — parseManifest', () => {
  test('parses a valid component manifest', () => {
    const m = parseManifest(JSON.stringify({ components: [
      { id: 'SM-CASE', name: 'case', description: 'a 42 mm watch case body' },
      { id: 'SM-BEZEL', name: 'bezel', description: 'a 42 mm rotating bezel ring' },
    ] }));
    expect(m.length).toBe(2);
    expect(m[0].id).toBe('SM-CASE');
  });

  test('strips a ```json fence', () => {
    const m = parseManifest('```json\n{"components":[{"id":"A","name":"a","description":"d"}]}\n```');
    expect(m.length).toBe(1);
  });

  test('rejects a component with no description', () => {
    expect(() => parseManifest('{"components":[{"id":"A","name":"a"}]}')).toThrow(/description/);
  });

  test('rejects a component with no id', () => {
    expect(() => parseManifest('{"components":[{"name":"a","description":"d"}]}')).toThrow(/id/);
  });

  test('rejects duplicate component ids', () => {
    expect(() => parseManifest('{"components":[{"id":"A","name":"a","description":"d"},{"id":"A","name":"b","description":"e"}]}'))
      .toThrow(/duplicate/);
  });

  test('rejects an empty component list', () => {
    expect(() => parseManifest('{"components":[]}')).toThrow(/components/);
  });

  test('rejects input that is not JSON', () => {
    expect(() => parseManifest('here is the watch')).toThrow(/could not parse/);
  });
});
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `./node_modules/.bin/playwright test e2e/component-manifest.spec.js --reporter=list`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/ai/sculptor/ComponentManifest.js`:**

```js
/**
 * ArchDisc — Component Manifest.
 *
 * The autonomous build's first step: the LLM decomposes a product (e.g. a
 * watch) into an ordered list of its manufacturable components, each with a
 * self-contained part description. The manifest is the work list the build
 * loop grinds through, component by component.
 */

/**
 * The system prompt: asks the LLM to decompose a product into components.
 * @returns {string}
 */
export function buildManifestPrompt() {
  return [
    'You are a CAD product architect for ArchDisc. Given a product to build,',
    'decompose it into an ordered list of its individual manufacturable',
    'components.',
    '',
    'Output ONLY a JSON object: {"components":[ ... ]}. No prose, no markdown.',
    'Each component: {"id":"unique short id", "name":"short name",',
    '"description":"<a self-contained part description with explicit mm',
    'dimensions, suitable for sculpting the part on its own>"}.',
    '',
    'Order components largest/structural first, smallest/detail last. Every id',
    'must be unique. Be concrete and realistic with millimetre dimensions.',
  ].join('\n');
}

/**
 * Parse and validate the LLM's component manifest.
 * @param {string} text  the raw LLM completion
 * @returns {Array<{id:string, name:string, description:string}>}
 */
export function parseManifest(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseManifest: could not parse LLM response as JSON');
  }
  const comps = Array.isArray(data) ? data : data?.components;
  if (!Array.isArray(comps) || comps.length === 0) {
    throw new Error('parseManifest: expected a non-empty {"components":[...]}');
  }
  const seen = new Set();
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    if (typeof c?.id !== 'string' || !c.id) {
      throw new Error(`parseManifest: component ${i} needs a non-empty string "id"`);
    }
    if (typeof c?.description !== 'string' || !c.description) {
      throw new Error(`parseManifest: component ${i} needs a non-empty string "description"`);
    }
    if (seen.has(c.id)) {
      throw new Error(`parseManifest: duplicate component id '${c.id}'`);
    }
    seen.add(c.id);
  }
  return comps;
}

/**
 * Ask the LLM to decompose `productDescription` into a component manifest.
 *
 * @param {object} args
 * @param {string} args.productDescription
 * @param {object} args.llm        { provider, apiKey, baseUrl, model }
 * @param {object} [args.providers]  PROVIDERS map (injected for testing)
 * @returns {Promise<Array<{id,name,description}>>}
 */
export async function requestManifest({ productDescription, llm, providers }) {
  const PROV = providers ?? (await import('../PlannerProviders.js')).PROVIDERS;
  const provider = PROV[llm?.provider];
  if (!provider) throw new Error(`requestManifest: unknown LLM provider '${llm?.provider}'`);
  const raw = await provider.generate({
    apiKey: llm.apiKey,
    model: llm.model,
    baseUrl: llm.baseUrl,
    system: buildManifestPrompt(),
    userMessage: `Product to decompose into components: ${productDescription}`,
  });
  return parseManifest(raw);
}
```

- [ ] **Step 4: Run test, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/component-manifest.spec.js --reporter=list`
Expected: PASS — 8 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/ComponentManifest.js e2e/component-manifest.spec.js
git commit -m "Add ComponentManifest — LLM decomposes a product into components"
```

---

## Task 2: Expose `requestManifest` on `window.__archdiscSculptor`

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Import**

Add an import alongside the other `ai/sculptor` imports:
```js
import { requestManifest } from '../../ai/sculptor/ComponentManifest.js';
```

- [ ] **Step 2: Expose it**

In the `useEffect` that registers `window.__archdiscSculptor`, add `requestManifest`
to the object literal — it should become
`{ sculptPart, requestSculptPlan, executeSculptPlan, sculptAssembly, requestManifest }`.

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds. Fix
only import/syntax you introduced if it fails.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Expose requestManifest on window.__archdiscSculptor"
```

---

## Task 3: Headed Electron spec — decompose the watch + build the first components

**Files:**
- Create: `e2e/seamaster-build-batch-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`.

- [ ] **Step 2: Create `e2e/seamaster-build-batch-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { sculptAndVerify, requestSculptPlan } from '../frontend/src/ai/sculptor/PartSculptor.js';
import { verifyRender } from '../frontend/src/ai/sculptor/PartVerifier.js';

/*
 * The Seamaster build loop, one batch: the AI decomposes the watch into a
 * component manifest, then builds the first 2 components — each through the
 * vision-verify loop so wrong geometry is caught — saving each with an id and
 * writing its STEP file to disk. Resumable: components already on disk are
 * skipped.
 */

const ROOT = path.resolve(__dirname, '..', 'autonomous-output', 'seamaster');
const COMPONENTS = path.join(ROOT, 'components');
const MANIFEST = path.join(ROOT, 'manifest.json');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const BATCH = 2;   // components to build this run

test('the AI decomposes the Seamaster and builds the next components, verified', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  test.setTimeout(600000);
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(COMPONENTS, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscSculptor && !!window.__archdiscComponents
      && !!window.__archdiscSculptor.requestManifest, null, { timeout: 60000 });

  // Manifest: build it once, then reuse it across runs (resumability).
  let manifest;
  if (fs.existsSync(MANIFEST)) {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } else {
    manifest = await win.evaluate(async (llm) => window.__archdiscSculptor.requestManifest({
      productDescription: 'An Omega Seamaster wristwatch — case, bezel, crystal, '
        + 'dial, hands, caseback, crown, and the mechanical movement components.',
      llm,
    }), llm);
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  }
  expect(manifest.length).toBeGreaterThan(0);
  console.log('  manifest: ' + manifest.length + ' components');

  // Resumability: skip components whose STEP file already exists on disk.
  const done = new Set(fs.readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.step')).map((f) => f.split('--')[0]));
  const todo = manifest.filter((c) => !done.has(c.id)).slice(0, BATCH);
  console.log('  already built: ' + done.size + ' | building this run: ' + todo.map((c) => c.id).join(', '));

  for (const comp of todo) {
    const built = await sculptAndVerify({
      description: comp.description,
      requestPlan: async () => requestSculptPlan({ description: comp.description, llm }),
      executePlan: async (plan) => win.evaluate(async (p) => {
        const part = await window.__archdiscSculptor.executeSculptPlan(p, window.__archdiscAtomic);
        window.__archdiscAtomic.render(part);
        window.__lastBuiltPart = part;
        return { volume: part.solid.volume() };
      }, plan),
      renderAndCapture: async () => {
        await win.waitForTimeout(1200);
        const buf = await win.locator('canvas').first().screenshot();
        return 'data:image/png;base64,' + buf.toString('base64');
      },
      verify: ({ description, imageDataUrl }) => verifyRender({ description, imageDataUrl, llm }),
      maxRounds: 3,
    });

    // Save the accepted (or best-effort) part to the library + STEP to disk.
    const saved = await win.evaluate(async ({ id, name }) => {
      const part = window.__lastBuiltPart;
      const entry = await window.__archdiscComponents.save({ id, name, part });
      return { id: entry.id, volume: entry.volume, step: entry.stepText };
    }, { id: comp.id, name: comp.name });

    fs.writeFileSync(path.join(COMPONENTS, `${comp.id}--${comp.name.replace(/\W+/g, '_')}.step`), saved.step);
    console.log(`  built ${comp.id} (${comp.name}) — accepted=${built.accepted}, `
      + `rounds=${built.rounds.length}, volume=${saved.volume.toFixed(0)} mm^3`);
    expect(saved.volume).toBeGreaterThan(0);
  }

  await win.screenshot({ path: path.join(ROOT, 'build-batch.png') });
  const builtCount = fs.readdirSync(COMPONENTS).filter((f) => f.endsWith('.step')).length;
  console.log('  total components built so far: ' + builtCount + ' / ' + manifest.length);
  expect(builtCount).toBeGreaterThanOrEqual(todo.length);

  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/seamaster-build-batch-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The desktop window opens; the AI decomposes the
Seamaster into a manifest (saved to `autonomous-output/seamaster/manifest.json`),
then builds the first 2 components through the verify loop, each saved with an
id and written as a STEP file under `autonomous-output/seamaster/components/`.

If it FAILS, diagnose honestly — do NOT loosen assertions or mock the LLM:
- `requestManifest` / `parseManifest` threw → the LLM's manifest was off-format;
  paste the raw output if visible; report DONE_WITH_CONCERNS or BLOCKED.
- A `sculptAndVerify` / AtomicOps / `verifyRender` error → paste the exact error;
  report BLOCKED.
- The build is slow but progressing → that is expected (LLM calls per round);
  the 600 s test timeout covers a 2-component batch.
- LLM HTTP error → paste it; report BLOCKED.

- [ ] **Step 4: Verify the artifacts**

Confirm `autonomous-output/seamaster/manifest.json` exists and lists components.
Confirm `autonomous-output/seamaster/components/` contains `.step` files (one per
built component), each non-empty with an `ISO-10303-21` first line. Open
`autonomous-output/seamaster/build-batch.png` and honestly describe what the
viewport shows. Report the manifest length, how many components were built, and
each built component's `accepted` verdict.

- [ ] **Step 5: Commit**

```bash
git add e2e/seamaster-build-batch-electron.spec.js
git commit -m "Add Seamaster build-batch spec — decompose + build components via verify loop"
```

(Do NOT git-add `autonomous-output/`.)

---

## Self-Review

**Spec coverage:** Establishes the resumable component build loop — decompose →
per-component `sculptAndVerify` → save + STEP. Every component goes through the
vision-verify loop (the fix for the wrong-geometry finding). Assembly, motion
render, and the deliverable ZIP are subsequent plans. One run builds a small
batch; the manifest + on-disk STEP files make it resumable across loop firings.

**Placeholder scan:** No placeholders.

**Type consistency:** `buildManifestPrompt()`, `parseManifest(text) ->
[{id,name,description}]`, `requestManifest({productDescription,llm,providers?})`.
The build spec reuses `sculptAndVerify` (Plan 6) and `window.__archdiscComponents.
save` (Plan 11) unchanged. STEP files are named `<id>--<name>.step` so
resumability can recover the built-id set by splitting on `--`.

---

## Subsequent Plans

- **Plan 13 — assemble the saved components + export the assembled-watch STEP.**
- **Plan 14 — motion render of the assembly → .mp4/.avi.**
- **Plan 15 — deliverable ZIP** (all component STEPs + assembled STEP + video).
- Then: the loop keeps firing `seamaster-build-batch` until the manifest is
  fully built, then runs 13→14→15.
