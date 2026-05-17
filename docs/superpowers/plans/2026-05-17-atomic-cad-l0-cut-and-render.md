# Atomic-CAD L0 — Cut Operation + Render Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `cut` atomic operation (subtract a sketched profile from the solid) and fix `render` so an evolving part is ONE updating body, not a stack of accumulating bodies — verified by sculpting a plate-with-a-hole inside the real ArchDisc desktop app.

**Architecture:** Extend `AtomicOps.js` with `cut`. Fix the `window.__archdiscAtomic.render` hook in the workbench so each render replaces the previous atomic body in the scene. A headed Electron-app Playwright spec sculpts a plate, cuts a through-hole, and screenshots the genuine ArchDisc desktop window.

**Tech Stack:** ES modules; `manifold-3d` WASM; React. Tests: Playwright driving the **ArchDisc Electron desktop app** via `_electron`. Runner: `./node_modules/.bin/playwright` (never `npx`).

---

## Context for the Engineer

This is **Plan 3** of the autonomous atomic-CAD sculptor (spec:
`docs/superpowers/specs/2026-05-17-autonomous-atomic-cad-sculptor-design.md`).
Plans 1–2 shipped: `kernel/atomic/ParametricCurve.js`, `SketchProfile.js`,
`Part.js`, `AtomicOps.js` (`createPart, startSketch, sketchRectangle,
sketchCircle, finishSketch, extrude`), and `window.__archdiscAtomic` registered
by the mechanical workbench.

**Verified facts:**
- `AtomicOps.extrude` uses the static `Mod.Manifold.union(a, b)` (NOT an
  instance `.union` — that does not exist). Boolean ops on manifolds use the
  static module forms: `Mod.Manifold.union`, `Mod.Manifold.difference`,
  `Mod.Manifold.intersection`.
- manifold objects hold WASM heap — `.delete()` every intermediate.
- `window.__archdiscAtomic.render(part, color)` is registered in
  `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` inside a
  `useEffect([viewport])`; it calls the exported
  `addFoundationManifoldToScene(scene, viewport, part.solid, color)` which
  RETURNS the Three.js `group` it added, and ADDS a new group every call.
- The ArchDisc Electron desktop app: `e2e/atomic-sculpt-bracket-electron.spec.js`
  shows the working pattern — `electron.launch({ args: [path to electron/main.js] })`,
  `app.firstWindow()`, then `win.evaluate` / `win.screenshot`. The Electron app
  loads `frontend/dist` — so the frontend must be rebuilt (`cd frontend && npx
  vite build`) before launching it, or it serves stale code.
- `frontend/src/kernel/atomic/AtomicOps.js` `extrude` is the model to follow
  for `cut`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/AtomicOps.js` | MODIFIED — add `cut`. |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | MODIFIED — `render` replaces the previous atomic body. |
| `e2e/atomic-sculpt-plate-electron.spec.js` | NEW — headed Electron-app test: sculpt a plate, cut a hole. |

---

## Task 1: Add the `cut` operation to `AtomicOps.js`

**Files:**
- Modify: `frontend/src/kernel/atomic/AtomicOps.js` (append one function)

`cut` uses manifold-3d WASM — not Node-unit-testable. Task 3's headed spec is
its integration test.

- [ ] **Step 1: Append the `cut` function** to `frontend/src/kernel/atomic/AtomicOps.js`, after the `extrude` function:

```js
/**
 * Cut: extrude the pending sketch profile into a tool and subtract it from
 * the Part's current solid. The tool starts 1 mm below z = 0, so pass a
 * `distance` GREATER than the material thickness for a clean through-cut
 * (coincident faces in a boolean are fragile). Records a 'cut' feature.
 *
 * @param {Part} part
 * @param {number} distance  cut depth (mm, > 0; exceed the material thickness
 *                           for a through-cut)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function cut(part, distance) {
  if (!part.pendingProfile) throw new Error('cut: no finished sketch profile — call finishSketch first');
  if (!part.solid) throw new Error('cut: no solid to cut — extrude a base first');
  if (!(distance > 0)) throw new Error('cut: distance must be > 0');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const tool = Mod.Manifold.extrude(cs, distance);
  cs.delete();
  const loweredTool = tool.translate([0, 0, -1]);   // start below z=0 for a clean through-cut
  tool.delete();
  const result = Mod.Manifold.difference(part.solid, loweredTool);
  part.solid.delete();
  loweredTool.delete();
  part.solid = result;
  part.pendingProfile = null;
  part.addFeature('cut', { distance }, result);
  return result;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check frontend/src/kernel/atomic/AtomicOps.js`
Expected: exit 0 (or, if your Node rejects ESM `import` in `--check`, skip — do
not "fix" the imports).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/atomic/AtomicOps.js
git commit -m "Add AtomicOps cut operation (atomic-CAD L0)"
```

---

## Task 2: `render` replaces the previous atomic body

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

Today every `render(part)` call adds a new Three.js group, so an evolving part
shows as a stack of bodies. Fix: track the previous atomic group and remove it
before adding the new one.

- [ ] **Step 1: Update the `useEffect` that registers `window.__archdiscAtomic`**

In `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`, find the
effect that registers `window.__archdiscAtomic` (added in Plan 2). It currently
contains a `render` like:

```js
            render: (part, color) =>
                addFoundationManifoldToScene(scene, viewport, part.solid, color ?? 0x9aa3ad),
```

Replace the WHOLE effect body so it tracks and removes the previous atomic
group. The effect should read exactly:

```js
    // Expose the atomic CAD operation set on window so the autonomous
    // sculptor (and headed e2e specs) can drive ArchDisc's real tools and
    // see each feature appear in the live viewport. `render` replaces the
    // previous atomic body so an evolving part stays a single body.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const scene = viewport?.scene;
        if (!scene) return undefined;
        let lastAtomicGroup = null;
        window.__archdiscAtomic = {
            createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut,
            render: (part, color) => {
                if (lastAtomicGroup) {
                    scene.remove(lastAtomicGroup);
                    lastAtomicGroup = null;
                }
                lastAtomicGroup = addFoundationManifoldToScene(
                    scene, viewport, part.solid, color ?? 0x9aa3ad,
                );
                return lastAtomicGroup;
            },
        };
        return () => { delete window.__archdiscAtomic; };
    }, [viewport]);
```

Note this also adds `cut` to the exposed op set.

- [ ] **Step 2: Update the import of AtomicOps to include `cut`**

Find the import line (added in Plan 2):
```js
import { createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude } from '../../kernel/atomic/AtomicOps.js';
```
Add `cut`:
```js
import { createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut } from '../../kernel/atomic/AtomicOps.js';
```

- [ ] **Step 3: Verify the app builds**

Run: `cd frontend && npx vite build` then `cd ..`.
Expected: build succeeds. (This also refreshes `frontend/dist` for Task 3's
Electron run.) If it fails, fix the import/syntax you introduced — do not touch
other files.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "render replaces previous atomic body; expose cut (atomic-CAD L0)"
```

---

## Task 3: Headed Electron spec — sculpt a plate with a through-hole

**Files:**
- Create: `e2e/atomic-sculpt-plate-electron.spec.js`

- [ ] **Step 1: Ensure `frontend/dist` is current**

Run: `cd frontend && npx vite build` then `cd ..`. (If Task 2 Step 3 already
built and nothing changed since, this is a no-op refresh — still run it so the
Electron app loads the latest code.)

- [ ] **Step 2: Create the spec** — `e2e/atomic-sculpt-plate-electron.spec.js`:

```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * The autonomous sculptor, in the real ArchDisc desktop app: sculpt a plate,
 * then cut a circular through-hole in it — startSketch -> sketchRectangle ->
 * finishSketch -> extrude, then startSketch -> sketchCircle -> finishSketch ->
 * cut. No premade model, no generator: atomic operations, one updating body.
 */

const OUT = path.resolve(__dirname, '..', 'autonomous-output');

test('AtomicOps sculpts a plate with a through-hole in the ArchDisc desktop app', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')] });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscAtomic, null, { timeout: 60000 });

  // Feature 1: a 80 x 50 x 10 mm plate.
  const plate = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = A.createPart('Drilled-Plate');
    window.__atomicPart = part;
    A.startSketch(part, 'XY');
    A.sketchRectangle(part, 0, 0, 80, 50);
    A.finishSketch(part);
    await A.extrude(part, 10);
    A.render(part);
    return { volume: part.solid.volume() };
  });
  expect(plate.volume).toBeCloseTo(80 * 50 * 10, 0);     // 40000 mm^3
  await win.waitForTimeout(2500);
  await win.screenshot({ path: path.join(OUT, 'electron-plate-step1.png') });

  // Feature 2: cut a Ø20 mm hole clean through the 10 mm plate.
  const drilled = await win.evaluate(async () => {
    const A = window.__archdiscAtomic;
    const part = window.__atomicPart;
    A.startSketch(part, 'XY');
    A.sketchCircle(part, 0, 0, 10);                       // Ø20 hole at the centre
    A.finishSketch(part);
    await A.cut(part, 12);                                // 12 > 10 mm -> clean through-cut
    A.render(part);
    return { volume: part.solid.volume(), history: part.describe() };
  });
  // a Ø20 hole removes pi*10^2*10 ~= 3141.6 mm^3 -> ~36858 mm^3 remains
  expect(drilled.volume).toBeLessThan(plate.volume);
  expect(drilled.volume).toBeGreaterThan(36000);
  expect(drilled.volume).toBeLessThan(37500);
  console.log('  ArchDisc desktop app — construction history: ' + drilled.history);
  console.log('  plate volume: ' + plate.volume.toFixed(0)
    + ' mm^3 -> after cut: ' + drilled.volume.toFixed(0) + ' mm^3');
  await win.waitForTimeout(3000);
  await win.screenshot({ path: path.join(OUT, 'electron-plate-step2.png') });

  await app.close();
});
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/playwright test e2e/atomic-sculpt-plate-electron.spec.js --reporter=list`
Expected: PASS — 1 passed. The ArchDisc desktop window opens; a plate appears,
then a round hole is cut through it.

If it FAILS:
- `cut`/`difference` error → report BLOCKED with the exact error (do not guess
  at manifold API changes).
- Volume assertion off → investigate honestly (is the hole actually through?);
  do not just widen the bounds.
- Electron launch issue → adjust only the launch args in this spec, mirroring
  `e2e/atomic-sculpt-bracket-electron.spec.js`.

- [ ] **Step 4: Verify the screenshots**

Confirm `autonomous-output/electron-plate-step1.png` and
`electron-plate-step2.png` exist and are non-empty. Open `electron-plate-step2.png`
and confirm it shows a plate with a visible round hole in the ArchDisc viewport,
and the BODIES panel lists ONE body (not two) — proving the render-replace fix.

- [ ] **Step 5: Commit**

```bash
git add e2e/atomic-sculpt-plate-electron.spec.js
git commit -m "Add Electron-app spec — sculpt a drilled plate in the ArchDisc desktop app (atomic-CAD L0)"
```

(Do NOT git-add the `autonomous-output/` images or `frontend/dist`.)

---

## Self-Review

**Spec coverage:** Plan 3 adds the `cut` operation (spec L0 feature set) and
fixes render-accumulation so the construction history shows as one evolving
body. `revolve`, sketch constraints (`SketchSolver`), sketch-on-face, and
patterns remain for Plan 4+.

**Placeholder scan:** No placeholders — every step has complete code/commands.

**Type consistency:** `cut(part, distance)` mirrors `extrude(part, distance)` —
same guards, same WASM-heap discipline, same `addFeature` recording. `cut` is
added to both the `AtomicOps.js` exports and the workbench's import + exposed
`window.__archdiscAtomic` op set. `render` keeps its `(part, color)` signature
and still returns the group.

---

## Subsequent Plans

- **Plan 4 — `revolve` + sketch constraints (`SketchSolver`).**
- **Plan 5 — sketch-on-face** (needs a face-reference protocol — design first).
- **Plan 6 — patterns, fillet, `GeometryQuery` (L1).**
- **Plan 7+ — L2 AI Sculptor and beyond.**
