# Atomic-CAD L0 — Linear Pattern — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `linearPattern` atomic operation — sketch one feature, and the AI builds N copies in a straight row (a row of holes, repeated bosses). Verified by the AI sculpting a slotted plate in the real ArchDisc desktop app.

**Architecture:** `linearPattern(part, mode, count, distance, dx, dy)` mirrors `circularPattern` — extrude the pending profile into a seed, build the union of `count` translated copies, union (`'extrude'`) or subtract (`'cut'`) into the part. Exposed on `window.__archdiscAtomic` and to the AI sculptor.

**Tech Stack:** ES modules; `manifold-3d`; React. Tests: Node-mode Playwright for the sculptor schema; a headed `_electron` spec. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

**Plan 9** of the autonomous atomic-CAD sculptor. Plans 1–8 shipped the L0
atomic ops (`sketch / extrude / cut / revolve / sketch-on-face / circularPattern`)
and the L2 AI Sculptor (LLM decides + closes a vision-verify loop).

`linearPattern` is the straight-row counterpart of `circularPattern` — for rows
of holes, repeated ribs/bosses.

**Verified facts:**
- `frontend/src/kernel/atomic/AtomicOps.js` exports the ops above. `circularPattern`
  is the direct model to mirror. manifold transforms are immutable —
  `m.translate([dx,dy,dz])` returns a NEW manifold; `.delete()` every
  intermediate. Booleans are static `Mod.Manifold.union/difference`.
- `Part` has `pendingProfile`, `pendingBaseZ`, `solid`, `addFeature(...)`.
- `window.__archdiscAtomic` is registered in
  `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` — an op is
  ONLY callable by the AI if it is BOTH imported there AND placed in the
  `window.__archdiscAtomic` object literal. (Plan 8 forgot this for
  `circularPattern` — do not repeat that; Task 2 covers it.)
- `frontend/src/ai/sculptor/PartSculptor.js`: `OP_SCHEMA` (op → required numeric
  params), `parseSculptPlan`, `executeSculptPlan` (a `switch`), `buildSculptPrompt`.
- The ArchDisc Electron desktop app loads `frontend/dist` — rebuild before
  launching. Electron pattern: `e2e/ai-sculpt-boltcircle-electron.spec.js`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — add `linearPattern`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — expose `linearPattern` on `window.__archdiscAtomic`. |
| `frontend/src/ai/sculptor/PartSculptor.js` | MODIFIED — `OP_SCHEMA`, `executeSculptPlan`, `buildSculptPrompt`. |
| `e2e/ai-sculptor-plan.spec.js` | MODIFIED — schema/dispatch tests. |
| `e2e/ai-sculpt-slotplate-electron.spec.js` | NEW — headed Electron test. |

---

## Task 1: Add `linearPattern` to `AtomicOps.js`

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js` (append one function)

- [ ] **Step 1: Append the `linearPattern` function** to `frontend/src/kernel/atomic/AtomicOps.js`, after the `circularPattern` function:

```js
/**
 * Linear pattern: extrude the pending sketch profile into a seed solid, make
 * `count` copies in a straight row each offset by (dx, dy) mm from the last,
 * and union them (mode 'extrude') or subtract them (mode 'cut') into the part.
 * Use this for rows of holes (cut) or repeated bosses/ribs (extrude).
 *
 * Copies are placed at i*(dx,dy) for i = 0..count-1 — so the first copy is at
 * the sketched position; sketch the single feature where the row should start.
 *
 * @param {Part} part
 * @param {string} mode      'extrude' (additive) or 'cut' (subtractive)
 * @param {number} count     number of copies (>= 1)
 * @param {number} distance  extrude depth of each copy (mm, > 0)
 * @param {number} dx        x step between copies (mm)
 * @param {number} dy        y step between copies (mm)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function linearPattern(part, mode, count, distance, dx, dy) {
  if (!part.pendingProfile) throw new Error('linearPattern: no finished sketch profile — call finishSketch first');
  if (mode !== 'extrude' && mode !== 'cut') throw new Error("linearPattern: mode must be 'extrude' or 'cut'");
  if (!(count >= 1)) throw new Error('linearPattern: count must be >= 1');
  if (!(distance > 0)) throw new Error('linearPattern: distance must be > 0');
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('linearPattern: dx and dy must be finite numbers');
  if (mode === 'cut' && !part.solid) throw new Error('linearPattern: cut needs an existing solid');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const seed = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  let pattern = null;
  for (let i = 0; i < count; i++) {
    const copy = seed.translate([dx * i, dy * i, 0]);
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
    const tool = pattern.translate([0, 0, -1]);
    pattern.delete();
    result = Mod.Manifold.difference(part.solid, tool);
    part.solid.delete();
    tool.delete();
  } else {
    const baseZ = part.pendingBaseZ ?? 0;
    let placed = pattern;
    if (baseZ !== 0) {
      const lifted = placed.translate([0, 0, baseZ]);
      placed.delete();
      placed = lifted;
    }
    if (part.solid) {
      result = Mod.Manifold.union(part.solid, placed);
      part.solid.delete();
      placed.delete();
    } else {
      result = placed;
    }
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('linearPattern', { mode, count, distance, dx, dy }, result);
  return result;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js` — expect exit 0 (skip if Node rejects ESM `import` in `--check`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "Add AtomicOps linearPattern operation (atomic-CAD L0)"
```

---

## Task 2: Expose `linearPattern` on `window.__archdiscAtomic`

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Add `linearPattern` to the AtomicOps import**

Find the import line that brings in the AtomicOps functions (it currently lists
`createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude,
cut, revolve, circularPattern`). Add `linearPattern` to that named-import list.

- [ ] **Step 2: Add `linearPattern` to the `window.__archdiscAtomic` object**

In the `useEffect` that registers `window.__archdiscAtomic`, find the object
literal line that lists the atomic ops (`createPart, startSketch, …,
circularPattern,`). Add `linearPattern` to that list.

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`. Expected: build succeeds. Fix
only the import/syntax you introduced if it fails.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "Expose linearPattern on window.__archdiscAtomic (atomic-CAD L0)"
```

---

## Task 3: Teach the AI sculptor about `linearPattern`

**Files:**
- Modify: `frontend/src/ai/sculptor/PartSculptor.js`
- Test: `e2e/ai-sculptor-plan.spec.js`

- [ ] **Step 1: Write the failing tests**

In `e2e/ai-sculptor-plan.spec.js`:

(a) Append to the `test.describe('PartSculptor — parseSculptPlan', ...)` block:

```js
  test('accepts a linearPattern op with numeric count, distance, dx, dy', () => {
    const plan = parseSculptPlan(JSON.stringify({ operations: [
      { op: 'linearPattern', mode: 'cut', count: 4, distance: 12, dx: 15, dy: 0 },
    ] }));
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('linearPattern');
  });

  test('rejects a linearPattern op missing the numeric dx', () => {
    expect(() => parseSculptPlan('[{"op":"linearPattern","mode":"cut","count":4,"distance":12,"dy":0}]'))
      .toThrow(/linearPattern/);
  });
```

(b) Append to the `test.describe('PartSculptor — executeSculptPlan', ...)` block:

```js
  test('executeSculptPlan dispatches linearPattern to the atomic api', async () => {
    const calls = [];
    const api = {
      createPart: () => ({}),
      startSketch: () => calls.push(['startSketch']),
      sketchCircle: (p, cx, cy, r) => calls.push(['sketchCircle', cx, cy, r]),
      finishSketch: () => calls.push(['finishSketch']),
      linearPattern: async (p, mode, count, distance, dx, dy) =>
        calls.push(['linearPattern', mode, count, distance, dx, dy]),
    };
    await executeSculptPlan([
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchCircle', cx: -22.5, cy: 0, r: 3 },
      { op: 'finishSketch' },
      { op: 'linearPattern', mode: 'cut', count: 4, distance: 12, dx: 15, dy: 0 },
    ], api);
    expect(calls[calls.length - 1]).toEqual(['linearPattern', 'cut', 4, 12, 15, 0]);
  });
```

- [ ] **Step 2: Run it, verify the 3 new tests FAIL**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: the 3 new tests FAIL; the 16 prior tests still pass.

- [ ] **Step 3: Update `PartSculptor.js`**

(a) In `OP_SCHEMA`, after the `circularPattern:` line, add:
```js
  linearPattern: ['count', 'distance', 'dx', 'dy'],
```

(b) In `executeSculptPlan`'s `switch`, after the `circularPattern` case, add:
```js
      case 'linearPattern': await atomicApi.linearPattern(part, o.mode, o.count, o.distance, o.dx, o.dy); break;
```

(c) In `buildSculptPrompt`, right after the `circularPattern` description lines,
add:
```js
    '- {"op":"linearPattern","mode":"extrude"|"cut","count":N,"distance":N,"dx":N,"dy":N}',
    '       — extrude the finished profile and make `count` copies in a straight row,',
    '       each offset by (dx,dy) mm; mode "extrude" adds them, "cut" subtracts them',
    '       (a row of holes). The first copy is at the sketched position — sketch the',
    '       single feature where the row should start.',
```

- [ ] **Step 4: Run it, verify it PASSES**

Run: `./node_modules/.bin/playwright test e2e/ai-sculptor-plan.spec.js --reporter=list`
Expected: PASS — 19 passed (16 prior + 3 new).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ai/sculptor/PartSculptor.js e2e/ai-sculptor-plan.spec.js
git commit -m "Teach the AI sculptor the linearPattern operation (atomic-CAD L0)"
```

---

## Task 4: Headed Electron spec — the AI sculpts a slotted plate

**Files:**
- Create: `e2e/ai-sculpt-slotplate-electron.spec.js`

- [ ] **Step 1: Rebuild the frontend**

Run: `cd frontend && npx vite build` then `cd ..`. Confirm `frontend/dist/index.html` exists.

- [ ] **Step 2: Create `e2e/ai-sculpt-slotplate-electron.spec.js`:**

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Linear pattern, end to end, in the real ArchDisc desktop app: the AI is
 * asked for a plate with a row of holes. It must sketch ONE hole and use
 * linearPattern with mode "cut" — proof it patterns a feature in a row.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');
const CREDS = path.resolve(__dirname, '..', '.llm-credentials.local.json');

test('the AI sculpts a plate with a linear row of holes', async () => {
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

  const description = 'A rectangular mounting bar 160 mm long, 30 mm wide and 8 mm thick, '
    + 'with a row of five 10 mm diameter holes evenly spaced 28 mm apart along its length.';

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

  const usedLinear = result.plan.some(o => o.op === 'linearPattern' && o.mode === 'cut');
  expect(usedLinear).toBe(true);

  // bar 160*30*8 = 38400 mm^3; five Ø10 holes through 8 mm remove
  // 5*pi*5^2*8 ~= 3142 mm^3 -> ~35258 mm^3.
  expect(result.volume).toBeGreaterThan(32000);
  expect(result.volume).toBeLessThan(38000);

  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-ai-slotplate.png') });
  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/ai-sculpt-slotplate-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The desktop window opens; a bar with a row of holes
appears in the viewport.

If it FAILS, diagnose honestly — do NOT loosen assertions or mock the LLM:
- `usedLinear` false → the AI placed holes individually. Print the plan; report
  DONE_WITH_CONCERNS.
- Volume ~38400 (no holes) or wildly off → the linearPattern cut did not work.
  Report BLOCKED with the actual volume + plan.
- An AtomicOps error → paste the exact error; report BLOCKED.
- `linearPattern is not a function` (on `window.__archdiscAtomic`) → Task 2's
  exposure did not take; report BLOCKED.
- LLM HTTP error → paste it; report BLOCKED.

- [ ] **Step 4: Verify the screenshot**

Confirm `autonomous-output/electron-ai-slotplate.png` exists and is non-empty.
Open it: confirm it shows a rectangular bar with a ROW of distinct holes (not a
plain bar, not one hole). Report honestly what you see — how many holes.

- [ ] **Step 5: Commit**

```bash
git add e2e/ai-sculpt-slotplate-electron.spec.js
git commit -m "Add headed spec — AI sculpts a slotted plate via linearPattern (atomic-CAD L0)"
```

(Do NOT git-add `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** Adds `linearPattern` (L0) — the straight-row counterpart of
`circularPattern`. `fillet`/`chamfer` remain for a later plan.

**Placeholder scan:** No placeholders — every step has complete code/commands.

**Type consistency:** `linearPattern(part, mode, count, distance, dx, dy)`
mirrors `circularPattern`'s WASM-heap discipline and `extrude`-mode baseZ lift.
`OP_SCHEMA.linearPattern = ['count','distance','dx','dy']` (numeric required
params; `mode` validated inside the op). `executeSculptPlan` passes
`o.mode, o.count, o.distance, o.dx, o.dy`. Task 2 exposes it on
`window.__archdiscAtomic` (import + object literal) — both required for the AI
to reach it.

---

## Subsequent Plans

- **Plan 10 — fillet/chamfer** (investigate the platform fillet path first).
- **Plan 11 — sketch constraints (`SketchSolver`) + `GeometryQuery` (L1).**
- **Plan 12+ — L3 part verification, L4 assembly, L5 dynamics, L6 render, L7 swarm.**
