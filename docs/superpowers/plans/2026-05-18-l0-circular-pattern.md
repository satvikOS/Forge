# Atomic-CAD L0 — Circular Pattern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `circularPattern` atomic operation — sketch one feature, and the AI builds N copies of it evenly spaced around the axis (gear teeth, bolt-circle holes). Verified by the AI sculpting a bolt-circle plate in the real ArchDisc desktop app.

**Architecture:** `circularPattern(part, mode, count, distance, angle)` extrudes the pending sketch profile into a seed solid, builds the union of `count` Z-rotated copies, and then unions (`mode:'extrude'`) or subtracts (`mode:'cut'`) the pattern into the part. Exposed to the AI sculptor with a prompt + op-schema entry. A headed Electron spec proves it.

**Tech Stack:** ES modules; `manifold-3d`; React. Tests: Node-mode Playwright for the sculptor schema/prompt; a headed `_electron` spec. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

**Plan 8** of the autonomous atomic-CAD sculptor. Plans 1–7 shipped the L0
atomic ops (`sketch / extrude / cut / revolve / sketch-on-face`) and the L2 AI
Sculptor (LLM decides the op sequence; closes a vision-verify loop).

Circular pattern is the operation behind gear teeth and bolt circles — directly
on the path to the watch movement.

**Verified facts:**
- `frontend/src/kernel/atomic/AtomicOps.js` exports `createPart, startSketch,
  sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve`.
  `extrude`/`cut`/`revolve` are async, `await getManifold()`, manage WASM heap.
- A manifold's boolean ops are static: `Mod.Manifold.union(a,b)`,
  `Mod.Manifold.difference(a,b)`. Transforms are immutable: `m.rotate([xDeg,
  yDeg,zDeg])` and `m.translate([dx,dy,dz])` return a NEW manifold (degrees for
  rotate). `.delete()` every intermediate.
- `Part` has `pendingProfile`, `pendingBaseZ`, `solid`, `addFeature(...)`.
- `frontend/src/ai/sculptor/PartSculptor.js`: `OP_SCHEMA` maps each op name to
  its required numeric params; `parseSculptPlan` validates against it;
  `executeSculptPlan` dispatches ops to `atomicApi`; `buildSculptPrompt`
  describes the ops to the LLM.
- The ArchDisc Electron desktop app loads `frontend/dist` — rebuild before
  launching. Electron pattern: `e2e/ai-sculptor-electron.spec.js`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — add `circularPattern`. |
| `frontend/src/ai/sculptor/PartSculptor.js` | MODIFIED — `OP_SCHEMA`, `executeSculptPlan`, `buildSculptPrompt`. |
| `e2e/ai-sculptor-plan.spec.js` | MODIFIED — tests for the new op schema/dispatch. |
| `e2e/ai-sculpt-boltcircle-electron.spec.js` | NEW — headed Electron test: AI sculpts a bolt-circle plate. |

---

## Task 1: Add `circularPattern` to `AtomicOps.js`

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js` (append one function)

manifold-using code — not Node-unit-testable; Task 3's headed spec verifies it.

- [ ] **Step 1: Append the `circularPattern` function** to `frontend/src/kernel/atomic/AtomicOps.js`, after the `revolve` function:

```js
/**
 * Circular pattern: extrude the pending sketch profile into a seed solid,
 * make `count` copies evenly spaced around the Z axis over `angle` degrees,
 * and union them (mode 'extrude') or subtract them (mode 'cut') into the
 * part. Use this for gear teeth (extrude) and bolt-circle holes (cut).
 *
 * The seed is patterned about the ORIGIN — so sketch the feature offset from
 * the origin (e.g. a hole at (radius, 0)) to get a ring of features.
 *
 * @param {Part} part
 * @param {string} mode      'extrude' (additive) or 'cut' (subtractive)
 * @param {number} count     number of copies (>= 1)
 * @param {number} distance  extrude depth of each copy (mm, > 0)
 * @param {number} [angle]   total spread in degrees (default 360)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function circularPattern(part, mode, count, distance, angle = 360) {
  if (!part.pendingProfile) throw new Error('circularPattern: no finished sketch profile — call finishSketch first');
  if (part.pendingBaseZ) throw new Error('circularPattern: sketch on the XY plane for patterns');
  if (mode !== 'extrude' && mode !== 'cut') throw new Error("circularPattern: mode must be 'extrude' or 'cut'");
  if (!(count >= 1)) throw new Error('circularPattern: count must be >= 1');
  if (!(distance > 0)) throw new Error('circularPattern: distance must be > 0');
  if (mode === 'cut' && !part.solid) throw new Error('circularPattern: cut needs an existing solid');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const seed = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  // union of `count` Z-rotated copies of the seed
  let pattern = null;
  for (let i = 0; i < count; i++) {
    const copy = seed.rotate([0, 0, (angle * i) / count]);
    if (pattern === null) {
      pattern = copy;
    } else {
      const merged = Mod.Manifold.union(pattern, copy);
      pattern.delete();
      copy.delete();
      pattern = merged;
    }
  }
  seed.delete();

  let result;
  if (mode === 'cut') {
    const tool = pattern.translate([0, 0, -1]);   // start below z=0 for clean through-cuts
    pattern.delete();
    result = Mod.Manifold.difference(part.solid, tool);
    part.solid.delete();
    tool.delete();
  } else if (part.solid) {
    result = Mod.Manifold.union(part.solid, pattern);
    part.solid.delete();
    pattern.delete();
  } else {
    result = pattern;
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('circularPattern', { mode, count, distance, angle }, result);
  return result;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js` — expect exit 0 (skip if Node rejects ESM imports in `--check`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "Add AtomicOps circularPattern operation (atomic-CAD L0)"
```

---

## Task 2: Teach the AI sculptor about `circularPattern`

**Files:**
- Modify: `frontend/src/ai/sculptor/PartSculptor.js`
- Test: `e2e/ai-sculptor-plan.spec.js`

- [ ] **Step 1: Write the failing tests**

In `e2e/ai-sculptor-plan.spec.js`:

(a) Append to the `test.describe('PartSculptor — parseSculptPlan', ...)` block:

```js
  test('accepts a circularPattern op with numeric count and distance', () => {
    const plan = parseSculptPlan(JSON.stringify({ operations: [
      { op: 'circularPattern', mode: 'cut', count: 6, distance: 12 },
    ] }));
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('circularPattern');
  });

  test('rejects a circularPattern op missing the numeric count', () => {
    expect(() => parseSculptPlan('[{"op":"circularPattern","mode":"cut","distance":12}]'))
      .toThrow(/circularPattern/);
  });
```

(b) Append to the `test.describe('PartSculptor — executeSculptPlan', ...)` block —
note `fakeAtomicApi` (defined earlier in that block) must gain a `circularPattern`
recorder; add it by appending one more test that uses its own extended fake:

```js
  test('executeSculptPlan dispatches circularPattern to the atomic api', async () => {
    const calls = [];
    const api = {
      createPart: () => ({}),
      startSketch: () => calls.push(['startSketch']),
      sketchCircle: (p, cx, cy, r) => calls.push(['sketchCircle', cx, cy, r]),
      finishSketch: () => calls.push(['finishSketch']),
      circularPattern: async (p, mode, count, distance, angle) =>
        calls.push(['circularPattern', mode, count, distance, angle]),
    };
    await executeSculptPlan([
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchCircle', cx: 20, cy: 0, r: 4 },
      { op: 'finishSketch' },
      { op: 'circularPattern', mode: 'cut', count: 6, distance: 12 },
    ], api);
    expect(calls[calls.length - 1]).toEqual(['circularPattern', 'cut', 6, 12, 360]);
  });
```

- [ ] **Step 2: Run it, verify the new tests FAIL**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: the 3 new tests FAIL (`circularPattern` not in the schema / not dispatched).

- [ ] **Step 3: Update `PartSculptor.js`**

(a) In `OP_SCHEMA`, add a `circularPattern` entry. Find the `OP_SCHEMA` object
and add this line (after the `revolve:` line):
```js
  circularPattern: ['count', 'distance'],
```

(b) In `executeSculptPlan`, add a `case` for `circularPattern`. Find the
`switch (o.op)` and add this case (after the `revolve` case, before `default`):
```js
      case 'circularPattern': await atomicApi.circularPattern(part, o.mode, o.count, o.distance, o.angle ?? 360); break;
```

(c) In `buildSculptPrompt`, add the `circularPattern` op description. Find the
`revolve` op line in the prompt array and add these lines right after it:
```js
    '- {"op":"circularPattern","mode":"extrude"|"cut","count":N,"distance":N,"angle":N}',
    '       — extrude the finished profile and make `count` copies evenly spaced around',
    '       the Z axis over `angle` degrees (default 360); mode "extrude" adds them (gear',
    '       teeth), mode "cut" subtracts them (a bolt circle of holes). The profile is',
    '       patterned about the origin — sketch the single feature offset from the origin',
    '       (e.g. a hole centred at (bolt_circle_radius, 0)).',
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS — 16 passed (13 prior + 3 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartSculptor.js e2e/ai-sculptor-plan.spec.js
git commit -m "Teach the AI sculptor the circularPattern operation (atomic-CAD L0)"
```

---

## Task 3: Headed Electron spec — the AI sculpts a bolt-circle plate

**Files:**
- Create: `e2e/ai-sculpt-boltcircle-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`. Confirm `frontend/dist/index.html` exists.

- [ ] **Step 2: Create `e2e/ai-sculpt-boltcircle-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Circular pattern, end to end, in the real ArchDisc desktop app: the AI is
 * asked for a round plate with a ring of bolt holes. It must sketch ONE hole
 * and use circularPattern with mode "cut" — proof it patterns a feature
 * rather than placing each hole by hand.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI sculpts a round plate with a circular pattern of bolt holes', async () => {
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

  const description = 'A round cover plate 100 mm in diameter and 8 mm thick, with six '
    + '9 mm diameter bolt holes equally spaced on a 78 mm diameter bolt circle.';

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

  // The AI must have used circularPattern with mode "cut".
  const usedPattern = result.plan.some(o => o.op === 'circularPattern' && o.mode === 'cut');
  expect(usedPattern).toBe(true);

  // Disc pi*50^2*8 ~= 62832 mm^3; six Ø9 holes through 8 mm remove
  // 6*pi*4.5^2*8 ~= 3054 mm^3 -> ~59778 mm^3. Wide-ish band: the AI picks the
  // exact hole count/size, but a plain disc (no holes) would be ~62832 and a
  // wildly wrong result falls outside.
  expect(result.volume).toBeGreaterThan(52000);
  expect(result.volume).toBeLessThan(62000);

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-boltcircle.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/ai-sculpt-boltcircle-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The desktop window opens; a round plate with a ring
of holes appears in the viewport.

If it FAILS, diagnose honestly — do NOT loosen assertions or mock the LLM:
- `usedPattern` false → the AI placed holes individually instead of patterning.
  Print the plan; report DONE_WITH_CONCERNS (the prompt may need to be clearer —
  do not change it without instruction).
- Volume ~62832 (no holes) or wildly off → the pattern cut did not work. Report
  BLOCKED with the actual volume + plan.
- An AtomicOps error (e.g. `seed.rotate is not a function`) → the manifold
  rotate API differs; paste the exact error and report BLOCKED.
- LLM HTTP error → paste it; report BLOCKED.

- [ ] **Step 4: Verify the screenshot**

Confirm `autonomous-output/electron-ai-boltcircle.png` exists and is non-empty.
Open it: confirm it shows a round plate with a RING of distinct holes through
it (not a plain disc, not one hole). Report honestly what you see — how many
holes are visible.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-sculpt-boltcircle-electron.spec.js
git commit -m "Add headed spec — AI sculpts a bolt-circle plate via circularPattern (atomic-CAD L0)"
```

(Do NOT git-add `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** Adds `circularPattern` (L0) — the operation behind gear teeth
and bolt circles. `linearPattern` and `fillet`/`chamfer` remain for a later plan.

**Placeholder scan:** No placeholders — every step has complete code/commands.

**Type consistency:** `circularPattern(part, mode, count, distance, angle=360)`
mirrors the WASM-heap discipline of `extrude`/`cut`/`revolve`. `OP_SCHEMA.
circularPattern = ['count','distance']` (the numeric required params; `mode` is
a string validated inside `circularPattern`; `angle` optional). `executeSculptPlan`
passes `o.mode, o.count, o.distance, o.angle ?? 360`. The prompt documents the
same op shape `{op,mode,count,distance,angle}`.

---

## Subsequent Plans

- **Plan 9 — linearPattern + fillet/chamfer.**
- **Plan 10 — sketch constraints (`SketchSolver`) + `GeometryQuery` (L1).**
- **Plan 11+ — L3 part verification, L4 assembly, L5 dynamics, L6 render, L7 swarm.**
