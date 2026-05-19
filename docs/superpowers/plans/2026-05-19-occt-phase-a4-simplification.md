# OCCT Phase A4 — Geometry Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OCCT-backed geometry simplification to the ArchDisc Kernel — merging redundant coplanar faces and removing the now-redundant seam edges (and small edges) — wired into the workbench ribbon and verified by a headed Electron e2e test.

**Architecture:** Extends the `frontend/src/kernel/brep/` OCCT kernel (phases A0–A3). `simplify` consumes a `BrepShape` and returns a new, simplified `BrepShape` (an OCCT `ShapeUpgrade_UnifySameDomain` pass), wrapped in `withScope`, exposed on the `ArchDiscKernel` facade, wired into an existing ribbon healing/cleanup tool. Phase A4 leads with an empirical OCCT API reconnaissance task.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (pinned), Vite 7, React 19, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference spec:** `docs/superpowers/specs/2026-05-18-occt-kernel-integration-foundation-design.md` (§3.5, §6 Phase A4).

---

## Important context for the implementer

- **Read first:** the spec, the A3 plan, and the verified API notes `docs/superpowers/notes/occt-api-A0.md` … `A3.md`.
- **A0–A3 are done.** `frontend/src/kernel/brep/` has `occtKernel.js` (`getOCCT()`), `BrepShape.js` (`BrepShape`, `withScope`, `track`), `BrepPrimitives.js`, `BrepBoolean.js` (`fuse`/`cut`/`common`), `BrepFeatures.js`, `BrepLocalOps.js`, `BrepSurfacing.js`, `BrepCheck.js`, `BrepTransform.js`, `BrepStep.js`, `BrepTessellate.js`, `BrepMeasure.js` (`volume`, `faceCount`, `edgeCount`, …), `brepToMesh.js`, `ArchDiscKernel.js`, `index.js`.
- **Op pattern:** `const oc = await getOCCT(); return withScope(() => { ...track() every transient OCCT object...; if (shape.IsNull()) throw ...; return new BrepShape(shape, meta); });`. OCCT Embind objects leak the WASM heap unless `track()`d.
- **Ribbon integration:** `ToolExecutionEngine.js` has OCCT-wired `TOOL_HANDLERS` returning `{ status, message }`; `addBrepShapeToScene(scene, viewport, brepShape, color)` renders an OCCT result. `window.__lastBrepShape` holds the current OCCT body.
- **e2e:** headed Playwright launching the real Electron app; geometry-producing ops are verified from many camera angles + zoom levels via `e2e/helpers/orbitCapture.js` (`captureAllAngles(win, label, opts)`).
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepHeal.js` | Create — `simplify` |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose `simplify` on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel export |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire `simplify` into a ribbon cleanup/healing tool |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | Modify (only if a `renderSimplify` driver is needed) |
| `docs/superpowers/notes/occt-api-A4.md` | Create (Task 1) — verified OCCT API |
| `e2e/brep-a4-recon-electron.spec.js` | Create (Task 1) — empirical recon |
| `e2e/brep-simplify-electron.spec.js` | Create (Task 4) — A4 e2e gate |

---

## Task 1: A4 OCCT API reconnaissance (de-risk)

**Files:**
- Create: `e2e/brep-a4-recon-electron.spec.js`
- Create: `docs/superpowers/notes/occt-api-A4.md`

Empirically verifies, inside the real Electron app, the working call sequence for OCCT geometry simplification. Mirrors `e2e/brep-a3-recon-electron.spec.js`.

- [ ] **Step 1: Write the recon spec**

Create `e2e/brep-a4-recon-electron.spec.js`. Launch the Electron app, get `oc` via `window.__archdiscKernel.getOCCT()`, and inside `win.evaluate(...)` empirically determine the COMPLETE working call sequence for each item. try/catch each; on failure record the error and try alternatives (suffixes, arg counts, prototype introspection). `.delete()` every OCCT object. Write findings to `docs/superpowers/notes/occt-api-A4-recon.json`, `console.log` them, `expect(...)` each item confirmed so the spec PASSES green. `test.setTimeout(600000)`.

Build inputs with `new oc.BRepPrimAPI_MakeBox_2(dx,dy,dz)` and the verified boolean `new oc.BRepAlgoAPI_Fuse_3(a,b,pr)` + `.Build(pr2)` + `.Shape()` (see occt-api-A1.md). Count faces/edges with `new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE / TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)` (dedup edges with `.IsSame()` per occt-api-A0.md). Volume via `GProp_GProps_1` + `BRepGProp.VolumeProperties_1`.

1. **A shape with redundant faces — the simplification input.** Build two 20×20×20 boxes, the second translated by (20,0,0) so they ABUT face-to-face, and `fuse` them. The fused solid is a 40×20×20 bar — but its B-rep retains the internal seam: extra coplanar face fragments and seam edges. Measure the fused result's face count and edge count and volume; record them (expect more than the 6 faces / 12 edges of a clean bar). This is the test input for simplification.
2. **ShapeUpgrade_UnifySameDomain.** Determine: the constructor — likely `new oc.ShapeUpgrade_UnifySameDomain_2(shape, unifyEdges, unifyFaces, concatBSplines)` (4-arg) or `_1(shape)`; introspect for the right overload. Then `.Build()`; the result reader `.Shape()`. Run it on the fused bar from item 1. Confirm the simplified result has FEWER faces and edges than the input but the SAME volume (the seam was removed; a clean 40×20×20 bar is 6 faces / 12 edges). Record the COMPLETE verified sequence and the face/edge counts before vs after.
3. **(Optional, if quick) ShapeFix_Shape.** If `ShapeUpgrade_UnifySameDomain` does not also clean small edges, briefly check whether `new oc.ShapeFix_Shape_2(shape)` (or `_1`) + `.Perform(progressRange?)` + `.Shape()` is constructible and runs without error on the fused bar. Record what you find; if it is awkward or unbound, note that and skip — item 2 is the required capability.

For anything not confirmable after genuine effort, record `NOT CONFIRMED` with the error.

- [ ] **Step 2: Build and run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-a4-recon-electron.spec.js --project=chromium
```

- [ ] **Step 3: Write the verified API note**

Create `docs/superpowers/notes/occt-api-A4.md` — for items 1–3, the COMPLETE verified copy-pasteable JavaScript call sequences, plus the measured before/after face & edge counts for the fused-bar simplification. Mark it verified against `opencascade.js@2.0.0-beta.b5ff984`.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-a4-recon-electron.spec.js docs/superpowers/notes/occt-api-A4.md docs/superpowers/notes/occt-api-A4-recon.json
git commit -m "test(kernel): empirical OCCT API recon for Phase A4 simplification"
```

---

## Task 2: BrepHeal — geometry simplification

**Files:**
- Create: `frontend/src/kernel/brep/BrepHeal.js`

> Fill the `withScope` body with the verified `ShapeUpgrade_UnifySameDomain` sequence from `docs/superpowers/notes/occt-api-A4.md` item 2. `track()` every transient OCCT object.

- [ ] **Step 1: Create BrepHeal.js**

Create `frontend/src/kernel/brep/BrepHeal.js`:
```js
/**
 * ArchDisc Kernel — geometry healing & simplification (OCCT).
 * `simplify` merges adjacent faces lying on the same underlying surface
 * and removes the now-redundant seam/small edges (ShapeUpgrade_UnifySameDomain).
 * Verified OCCT sequence: docs/superpowers/notes/occt-api-A4.md item 2.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Simplify a solid: unify coplanar faces and drop redundant edges.
 * Volume is preserved; face and edge counts typically drop.
 * @param {BrepShape} brepShape
 * @returns {Promise<BrepShape>}
 */
export async function simplify(brepShape) {
  if (!brepShape || !brepShape.shape) throw new Error('simplify: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    /* verified ShapeUpgrade_UnifySameDomain sequence from occt-api-A4.md item 2:
       construct the unifier on brepShape.shape with edge+face unification on,
       .Build(), read .Shape() → `const shape`. track() every transient. */
    if (shape.IsNull()) throw new Error('simplify: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'simplify', parents: [brepShape.id] });
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```
Expected: build succeeds (the `/* verified ... */` comment must be replaced with real code defining `shape`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepHeal.js
git commit -m "feat(kernel): add geometry simplification (ShapeUpgrade_UnifySameDomain)"
```

---

## Task 3: Facade, barrel & ribbon wiring

**Files:**
- Modify: `frontend/src/kernel/brep/index.js`
- Modify: `frontend/src/kernel/brep/ArchDiscKernel.js`
- Modify: `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
- Modify (if needed): `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Update the barrel export**

In `frontend/src/kernel/brep/index.js`, add:
```js
export { simplify } from './BrepHeal.js';
```

- [ ] **Step 2: Extend the ArchDiscKernel facade**

In `frontend/src/kernel/brep/ArchDiscKernel.js`, add the import `import { simplify } from './BrepHeal.js';` and add `simplify,` to the `brep:` object literal.

- [ ] **Step 3: Wire `simplify` into the ribbon**

In `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`, wire a ribbon tool to `simplify`. READ `frontend/src/components/RibbonToolbar.jsx` to find a suitable existing tool — the Direct Edit tab's Import-Repair group has cleanup tools (e.g. `Remove Duplicates`, `Heal Faces`, `Simplify`). Pick the best-fitting existing tool name (prefer one literally about simplification/cleanup); if none fits, add a `Simplify Geometry` tool to that group in BOTH `RibbonToolbar.jsx` and `WorkbenchMechanical.jsx` `TOOL_GROUPS`.

The handler (follow the existing OCCT handler pattern — read e.g. the `Fillet` handler):
- body = `window.__lastBrepShape` if present, else build a representative redundant-face shape: `fuse` two abutting 20mm boxes (`makeBox(20,20,20)` + a `translate(makeBox(20,20,20), 20,0,0)` then `fuse`) so the simplification has something to do. Dispose the intermediate operands.
- `const result = await ArchDiscKernel.brep.simplify(body);`
- render it: `await addBrepShapeToScene(scene, viewport, result);`
- measure before/after face counts where possible and return `{ status:'success', message: 'Simplify: <n> → <m> faces (volume preserved) via OCCT ShapeUpgrade_UnifySameDomain' }`.
- try/catch; return `{ status:'error', message }` on failure.

If a `render*` driver is the cleaner path (consistent with other ops), add `renderSimplify` to the `window.__archdiscKernel` hook in `WorkbenchMechanical.jsx` following the existing `render*` pattern, and have the ribbon handler call it.

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -8
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js frontend/src/components/RibbonToolbar.jsx frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(kernel): expose simplify on facade + wire into ribbon"
```

---

## Task 4: Headed Electron e2e — A4 gate

**Files:**
- Create: `e2e/brep-simplify-electron.spec.js`

`simplify` produces geometry, so the e2e verifies it numerically AND from all camera angles/zooms (per the established `orbitCapture` helper). Copy the `launch()` helper + imports from `e2e/brep-features-electron.spec.js`, and import `captureAllAngles` from `./helpers/orbitCapture.js`.

- [ ] **Step 1: Create `e2e/brep-simplify-electron.spec.js`**

`test.setTimeout(600000)`. Two tests:
```js
test('simplify: a fused two-box bar loses its internal seam (fewer faces, volume preserved)', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const bRaw = await K.makeBox(20, 20, 20);
    const b = await K.translate(bRaw, 20, 0, 0);   // abuts `a`
    const fused = await K.fuse(a, b);
    const before = await K.measure(fused);
    const simplified = await K.simplify(fused);
    const after = await K.measure(simplified);
    return { before, after };
  });
  // volume preserved (40x20x20 = 16000), within 0.1%
  expect(Math.abs(r.after.volume - r.before.volume)).toBeLessThan(16);
  expect(r.after.volume).toBeGreaterThan(15800);
  // simplification removes the internal seam: face/edge counts drop to a
  // clean bar (6 faces / 12 edges) — at minimum, they do not INCREASE.
  expect(r.after.faceCount).toBeLessThanOrEqual(r.before.faceCount);
  expect(r.after.faceCount).toBe(6);
  expect(r.after.edgeCount).toBe(12);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('simplify: result renders correctly from all camera angles and zooms', async () => {
  const { app, win, pageErrors } = await launch();
  // Build + render the simplified bar via the ribbon driver, then sweep.
  await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const b = await K.translate(await K.makeBox(20, 20, 20), 20, 0, 0);
    const fused = await K.fuse(a, b);
    const simplified = await K.simplify(fused);
    await window.__archdiscKernel.renderShape(simplified);
  });
  const { captureAllAngles } = await import('./helpers/orbitCapture.js');
  const cap = await captureAllAngles(win, 'simplify', { azimuths: [0,60,120,180,240,300], elevations: [-30,30], zooms: [0.6,1.0,1.8] });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```
> If `r.after.faceCount` is not exactly 6 / `edgeCount` not exactly 12 (OCCT may leave some structure depending on how `UnifySameDomain` was configured in Task 2), reconcile: the simplified count MUST be strictly less than the un-simplified `before` count and the volume preserved; set the exact-count asserts to the real verified post-simplify counts from `occt-api-A4.md` item 2. Do NOT weaken to a trivial bound — assert the real reduced counts.
> The dynamic `import('./helpers/orbitCapture.js')` mirrors how other retrofitted specs import the helper; if those specs use a static top-of-file import instead, match that style.

- [ ] **Step 2: Build and run the A4 gate spec**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-simplify-electron.spec.js --project=chromium
```
Expected: 2 tests PASS. Reconcile against `occt-api-A4.md` on failure. Do not weaken assertions.

- [ ] **Step 3: Run the full brep e2e suite (regression)**

```bash
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-a4-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/brep-simplify-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js --project=chromium
```
Expected: ALL pass — confirms A4 did not regress earlier phases. (If `brep-boolean-electron.spec.js` shows an intermittent failure on the cut test, re-run that spec alone to confirm — it is a known pre-existing flake.)

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-simplify-electron.spec.js
git commit -m "test(kernel): A4 gate — headed Electron e2e for geometry simplification"
```

---

## Self-review notes

- **Spec coverage (§3.5 / §6 Phase A4):** geometry simplification — removing redundant/sliver faces and small/seam edges (Tasks 2, 4) ✓; facade + ribbon wiring (Task 3) ✓; headed Electron e2e incl. all-angles capture (Task 4) ✓; OCCT API de-risk (Task 1) ✓.
- **Deferred (correctly out of this plan):** tolerant modeling / stitching and convergent modeling (§3.5) — deferred to later sub-projects per the spec; A5 hard blending; feature-level defeaturing beyond same-domain unification.
- **Placeholder note:** the single `/* verified ... */` marker in Task 2 is filled from Task 1's empirically-verified `occt-api-A4.md` — the proven A0–A3 de-risk flow. Every other code block is complete.
- **Type consistency:** `simplify` is the single new op name, consistent across the barrel, facade, ribbon handler, and e2e. Verdict: `simplify` returns a `BrepShape` (geometry op), so the e2e measures it and sweeps all angles.
