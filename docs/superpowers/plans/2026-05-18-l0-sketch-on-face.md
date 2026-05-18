# Atomic-CAD L0 — Sketch on Face — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the AI sculptor sketch on the **top (or bottom) face of an existing solid**, so a part can be built feature-on-feature — a boss standing on a plate — instead of every feature growing from z = 0.

**Architecture:** `startSketch` gains a `plane` of `'XY' | 'top' | 'bottom'`; `'top'`/`'bottom'` resolve to the current solid's bounding-box face Z. `finishSketch` carries that base Z; `extrude` lifts the new material to it. The sculptor prompt teaches the LLM to use `'top'`. A headed Electron spec proves the AI builds a bossed part.

**Tech Stack:** ES modules; `manifold-3d`; React. Tests: Node-mode Playwright for the prompt; a headed `_electron` spec for the in-app sculpt. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

**Plan 7** of the autonomous atomic-CAD sculptor. Plans 1–6 shipped the L0
atomic ops (`startSketch, sketchRectangle, sketchCircle, finishSketch, extrude,
cut, revolve`) and the L2 AI Sculptor with a vision-verify loop.

Until now every sketch is on the XY plane (z = 0) and `extrude` builds upward
from z = 0. So a part can only grow as one merged blob from the floor — you
cannot put a boss *on top of* a plate. This plan adds **sketch-on-face**: the
simplified, robust form that needs no topological-naming machinery — a face is
named by side (`'top'`/`'bottom'`), resolved against the solid's bounding box.

**Verified facts:**
- `frontend/src/kernel/atomic/AtomicOps.js` has `startSketch`, `sketchRectangle`,
  `sketchCircle`, `finishSketch`, `extrude`, `cut`, `revolve`. `Part` (in
  `Part.js`) has `activeSketch`, `pendingProfile`, `solid`.
- `extrude` builds `Mod.Manifold.extrude(cs, distance)` from z = 0 upward;
  manifold transforms are immutable (`.translate(...)` returns a NEW manifold —
  delete the old). Boolean ops use static `Mod.Manifold.union(a,b)`.
- manifold-3d exposes a bounding box on a `Manifold`. The exact API
  (`solid.boundingBox()` returning `{min:[x,y,z], max:[x,y,z]}`, or a property)
  must be confirmed against the codebase — `frontend/src/foundation/` and
  `ToolExecutionEngine.js` use it (e.g. mass-properties / framing code). Find a
  real call site and mirror it.
- `frontend/src/ai/sculptor/PartSculptor.js` `buildSculptPrompt()` describes the
  op set for the LLM. `parseSculptPlan` does not validate `startSketch`'s
  `plane` (startSketch has no required params) — so adding a `plane` value needs
  no schema change.
- The ArchDisc Electron desktop app loads `frontend/dist` — rebuild before
  launching. Electron pattern: `e2e/ai-sculptor-electron.spec.js`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — `startSketch` plane resolution; `finishSketch` base Z; `extrude` lift; `cut`/`revolve` reject a non-XY base. |
| `frontend/src/ai/sculptor/PartSculptor.js` | MODIFIED — teach the prompt about sketch-on-top. |
| `e2e/ai-sculptor-plan.spec.js` | MODIFIED — one test that the prompt mentions sketch-on-top. |
| `e2e/ai-sculpt-boss-electron.spec.js` | NEW — headed Electron test: the AI sculpts a bossed part. |

---

## Task 1: Sketch-on-face in `AtomicOps.js`

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js`

This task changes manifold-using code — not Node-unit-testable; Task 3's headed
spec is its integration test.

- [ ] **Step 1: Confirm the bounding-box API**

Grep the codebase for `boundingBox` (e.g. `frontend/src/foundation/MassProperties.js`,
`ToolExecutionEngine.js`). Confirm how a `Manifold`'s bounding box is obtained
and the shape of the result (expected: `solid.boundingBox()` → an object with
`min` and `max`, each a 3-element `[x,y,z]` array). Note the exact form — Step 2
uses it.

- [ ] **Step 2: Replace `startSketch`**

In `frontend/src/kernel/atomic/AtomicOps.js`, replace the whole `startSketch`
function with:

```js
/**
 * Open a new sketch. `plane` selects where the sketch sits:
 *  - 'XY'     — the base XY plane at z = 0 (default).
 *  - 'top'    — the top face of the current solid (its max-Z) — for a boss.
 *  - 'bottom' — the bottom face of the current solid (its min-Z).
 * Only one sketch may be open at a time.
 *
 * @param {Part} part
 * @param {string} [plane]  'XY' | 'top' | 'bottom'
 * @returns {object} the open sketch
 */
export async function startSketch(part, plane = 'XY') {
  if (part.activeSketch) throw new Error('startSketch: a sketch is already open — finishSketch first');
  let baseZ = 0;
  if (plane === 'top' || plane === 'bottom') {
    if (!part.solid) {
      throw new Error(`startSketch: plane '${plane}' needs an existing solid — extrude a base first`);
    }
    const Mod = await getManifold();
    const bbox = part.solid.boundingBox();
    baseZ = plane === 'top' ? bbox.max[2] : bbox.min[2];
    void Mod;
  } else if (plane !== 'XY') {
    throw new Error(`startSketch: unknown plane '${plane}' (use 'XY', 'top', or 'bottom')`);
  }
  part.activeSketch = { plane, baseZ, loops: [] };
  part.addFeature('startSketch', { plane });
  return part.activeSketch;
}
```

NOTE: `startSketch` is now `async` (it may need the manifold module for the
bounding box). If `solid.boundingBox()` does NOT require the manifold module
(it is a method on the solid object itself), you may drop the
`const Mod = await getManifold(); ... void Mod;` lines and keep `startSketch`
**async anyway** (callers already `await` it or treat it as sync-returning;
`executeSculptPlan` does not await it — see Task note below). Confirm in Step 1
whether `boundingBox()` needs the module; keep the function `async` regardless
so the signature is stable.

**Important — `executeSculptPlan` compatibility:** `executeSculptPlan` in
`PartSculptor.js` currently calls `atomicApi.startSketch(part, o.plane ?? 'XY')`
WITHOUT `await`. Since `startSketch` is now async, update that one line in
`executeSculptPlan` to `await atomicApi.startSketch(part, o.plane ?? 'XY');`.
Make ONLY that one-word change to `executeSculptPlan`.

- [ ] **Step 3: Update `finishSketch` to carry the base Z**

Replace the whole `finishSketch` function with:

```js
/**
 * Close the open sketch. Its loops + base Z become the pending profile for
 * the next feature operation.
 * @param {Part} part
 * @returns {Array<Array<[number,number]>>} the closed profile loops
 */
export function finishSketch(part) {
  if (!part.activeSketch) throw new Error('finishSketch: no open sketch');
  if (part.activeSketch.loops.length === 0) throw new Error('finishSketch: sketch has no geometry');
  part.pendingProfile = part.activeSketch.loops;
  part.pendingBaseZ = part.activeSketch.baseZ ?? 0;
  const loopCount = part.pendingProfile.length;
  part.activeSketch = null;
  part.addFeature('finishSketch', { loops: loopCount });
  return part.pendingProfile;
}
```

- [ ] **Step 4: Make `extrude` honor the base Z; make `cut`/`revolve` reject it**

In `extrude`, after the line `let block = Mod.Manifold.extrude(cs, distance);`
(rename the `const result`/`block` variable to `let block` if needed) and
`cs.delete();`, insert the lift, and clear `pendingBaseZ` at the end. The full
`extrude` function should read:

```js
export async function extrude(part, distance) {
  if (!part.pendingProfile) throw new Error('extrude: no finished sketch profile — call finishSketch first');
  if (!(distance > 0)) throw new Error('extrude: distance must be > 0');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  let block = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  const baseZ = part.pendingBaseZ ?? 0;
  if (baseZ !== 0) {
    const lifted = block.translate([0, 0, baseZ]);
    block.delete();
    block = lifted;
  }

  let result = block;
  if (part.solid) {
    result = Mod.Manifold.union(part.solid, block);
    part.solid.delete();
    block.delete();
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('extrude', { distance }, result);
  return result;
}
```

In `cut`, add — right after the `if (!(distance > 0)) ...` guard line — this guard:
```js
  if (part.pendingBaseZ) throw new Error('cut: sketch-on-face is not supported for cut yet — sketch on the XY plane for cuts');
```
and add `part.pendingBaseZ = 0;` next to the existing `part.pendingProfile = null;` line.

In `revolve`, add — right after the `if (!(degrees > 0)) ...` guard line — this guard:
```js
  if (part.pendingBaseZ) throw new Error('revolve: sketch-on-face is not supported for revolve yet — sketch on the XY plane');
```
and add `part.pendingBaseZ = 0;` next to the existing `part.pendingProfile = null;` line.

- [ ] **Step 5: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js` and
`node --check frontend/src/ai/sculptor/PartSculptor.js` — expect exit 0 (skip if
Node rejects ESM imports in `--check`).

- [ ] **Step 6: Confirm Plan 5/6 unit tests still pass**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js e2e/ai-verify-loop.spec.js --reporter=list`
Expected: PASS — 21 passed. (`executeSculptPlan`'s `startSketch` call is now
`await`ed; the fake-api tests must still pass — the fake's `startSketch` is sync
but `await` on a non-promise is harmless.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js frontend/src/ai/sculptor/PartSculptor.js
git commit -m "Add sketch-on-face (top/bottom) for extrude (atomic-CAD L0)"
```

---

## Task 2: Teach the sculptor prompt about sketch-on-top

**Files:**
- Modify: `frontend/src/ai/sculptor/PartSculptor.js`
- Test: `e2e/ai-sculptor-plan.spec.js`

- [ ] **Step 1: Write the failing test**

In `e2e/ai-sculptor-plan.spec.js`, append to the existing
`test.describe('PartSculptor — prompt', ...)` block this test:

```js
  test('the prompt explains sketching on the top face for a boss', () => {
    const p = buildSculptPrompt();
    expect(p).toContain('top');
    expect(p.toLowerCase()).toContain('boss');
  });
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: the new test FAILS (the prompt does not yet mention a boss / top face).

- [ ] **Step 3: Update `buildSculptPrompt`**

In `frontend/src/ai/sculptor/PartSculptor.js`, in `buildSculptPrompt`, find the
`startSketch` description line:
```js
    '- {"op":"startSketch","plane":"XY"} — open a new sketch (required before sketch entities).',
```
Replace it with these two lines:
```js
    '- {"op":"startSketch","plane":"XY"} — open a new sketch on the base plane.',
    '       Use plane "top" instead to sketch on the TOP face of the current solid —',
    '       a following extrude then builds a boss/step standing ON that face.',
    '       (cut and revolve require plane "XY".)',
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS — 13 passed (12 prior + 1 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartSculptor.js e2e/ai-sculptor-plan.spec.js
git commit -m "Teach the sculptor prompt about sketch-on-top bosses (atomic-CAD L0)"
```

---

## Task 3: Headed Electron spec — the AI sculpts a bossed part

**Files:**
- Create: `e2e/ai-sculpt-boss-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`. Confirm `frontend/dist/index.html` exists.

- [ ] **Step 2: Create `e2e/ai-sculpt-boss-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Sketch-on-face, end to end, in the real ArchDisc desktop app: the AI is
 * asked for a part that needs a boss standing ON a base plate. It must use
 * startSketch with plane "top" — proof the part is built feature-on-feature,
 * not as one blob from z = 0.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI sculpts a base plate with a cylindrical boss on its top face', async () => {
  test.skip(!fs.existsSync(CREDS), 'no .llm-credentials.local.json — BYO LLM not configured');
  const cred = JSON.parse(fs.readFileSync(CREDS, 'utf8'));
  const llm = { provider: cred.provider, apiKey: cred.apiKey, baseUrl: cred.endpoint, model: cred.model };
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscAtomic && !!window.__archdiscSculptor, null, { timeout: 60000 });

  const description = 'A base plate 50 mm x 50 mm and 10 mm thick, with a cylindrical '
    + 'boss 20 mm in diameter and 25 mm tall standing on the centre of its top face.';

  const result = await win.evaluate(async ({ description, llm }) => {
    const { part, plan } = await window.__archdiscSculptor.sculptPart({
      description, llm, atomicApi: window.__archdiscAtomic,
    });
    window.__archdiscAtomic.render(part);
    return { plan, history: part.describe(), volume: part.solid.volume() };
  }, { description, llm });

  console.log('  AI-decided plan: ' + JSON.stringify(result.plan));
  console.log('  construction history: ' + result.history);
  console.log('  sculpted volume: ' + result.volume.toFixed(0) + ' mm^3');

  // The AI must have used a "top" sketch for the boss.
  const usedTop = result.plan.some(o => o.op === 'startSketch' && o.plane === 'top');
  expect(usedTop).toBe(true);

  // base 50x50x10 = 25000 mm^3; boss pi*10^2*25 ~= 7854 mm^3; total ~= 32854.
  // If the boss were NOT lifted onto the top face it would overlap the base and
  // the union volume would be much lower — so this band confirms the lift.
  expect(result.volume).toBeGreaterThan(30000);
  expect(result.volume).toBeLessThan(36000);

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-boss-part.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/ai-sculpt-boss-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The desktop window opens; a plate with a cylinder
standing on top appears in the viewport.

If it FAILS, diagnose honestly — do NOT loosen assertions or mock the LLM:
- `usedTop` is false → the LLM did not use a top-face sketch. Print the plan;
  report DONE_WITH_CONCERNS — the prompt may need to be clearer.
- Volume near ~25000–28000 instead of ~32854 → the boss was NOT lifted onto the
  top face (it overlapped the base). That means the `baseZ` lift in `extrude`
  did not work — report BLOCKED with the actual volume and the plan.
- An AtomicOps error (e.g. `boundingBox` is not a function) → the bounding-box
  API was wrong in Task 1; paste the exact error and report BLOCKED.
- LLM HTTP error → paste it; report BLOCKED.

- [ ] **Step 4: Verify the screenshot**

Confirm `autonomous-output/electron-ai-boss-part.png` exists and is non-empty.
Open it: confirm it shows a flat base plate with a distinct cylindrical boss
standing UP from its top face (not a single flat blob, not a cylinder sunk into
the plate). Report honestly what you see.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-sculpt-boss-electron.spec.js
git commit -m "Add headed spec — AI sculpts a bossed part via sketch-on-face (atomic-CAD L0)"
```

(Do NOT git-add `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** Adds sketch-on-face (L0) in its simplified, robust form —
side-named faces resolved via the bounding box, no topological-naming machinery
(that fuller form is a later plan). `extrude` honors the face; `cut`/`revolve`
honestly reject a non-XY base rather than produce wrong geometry.

**Placeholder scan:** No placeholders — every step has complete code/commands.
Task 1 Step 1 is a deliberate API-verification step.

**Type consistency:** `startSketch` is now `async` and `executeSculptPlan`'s
call to it is `await`ed (the one compatibility edit). `Part` gains a
`pendingBaseZ` field, set by `finishSketch`, read+cleared by `extrude`, and
guarded against by `cut`/`revolve`. The sketch object gains `baseZ`. The
sculptor prompt gains the `'top'` plane; `parseSculptPlan` needs no change
(startSketch has no required params).

---

## Subsequent Plans

- **Plan 8 — patterns (linear/circular) + fillet/chamfer.**
- **Plan 9 — sketch constraints (`SketchSolver`) + `GeometryQuery` (L1).**
- **Plan 10+ — L3 part verification, L4 assembly, L5 dynamics, L6 render, L7 swarm.**
