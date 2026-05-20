# Kernel Phase A3 — Evaluation & Checking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the the kernel-backed evaluation operations to the ArchDisc Kernel — self-intersection detection and clash/interference detection — wired into the workbench ribbon and verified by headed Electron e2e tests.

**Architecture:** Extends the `frontend/src/kernel/brep/` the kernel (phases A0–A2). Unlike A0–A2, A3 operations are ANALYTICAL — they consume `BrepShape`s and return a verdict object (not new geometry). They are exposed through the `ArchDiscKernel` facade and wired into existing ribbon analysis tools; their result surfaces in the tool-status message. Phase A3 leads with an empirical kernel API reconnaissance task.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (kernel WASM, pinned exact), Vite 7, React 19, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference spec:** `docs/superpowers/specs/2026-05-18-kernel-integration-foundation-design.md` (§3.6, §6 Phase A3).

---

## Important context for the implementer

- **Read first:** the spec, the A2 plan, and the verified API notes `docs/superpowers/notes/kernel-api-A0.md` / `A1.md` / `A2.md`.
- **A0–A2 are done.** `frontend/src/kernel/brep/` has: `occtKernel.js` (`getOCCT()`), `BrepShape.js` (`BrepShape`, `withScope`, `track`), `BrepPrimitives.js`, `BrepBoolean.js` (`fuse`, `cut`, `common`), `BrepFeatures.js`, `BrepLocalOps.js`, `BrepSurfacing.js`, `BrepStep.js`, `BrepTessellate.js`, `BrepMeasure.js` (`volume`, etc.), `brepToMesh.js`, `ArchDiscKernel.js`, `index.js`.
- **Op pattern:** `const oc = await getOCCT(); return withScope(() => { ...track() every transient the kernel object...; return <verdict object>; });`. A3 ops return a plain verdict object (no `BrepShape`), so `withScope` frees ALL tracked kernel objects on exit.
- **Memory:** kernel Embind objects leak the WASM heap unless `track()`d.
- **opencascade.js binding convention:** `_1`/`_2`/… overload suffixes; Task 1 verifies every binding empirically.
- **Ribbon integration:** `ToolExecutionEngine.js` has the kernel-wired handlers in `TOOL_HANDLERS` that return `{ status, message }`. A3 handlers run a check and report the verdict in `message` — they do NOT render geometry, so they do NOT call `addBrepShapeToScene`.
- **e2e:** headed Playwright launching the real Electron app; drive via `window.__archdiscKernel.kernel.brep.*`. A3 ops are analytical — the e2e asserts the VERDICT (no angle/zoom capture needed; that applies to geometry-producing ops).
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepCheck.js` | Create — `checkSelfIntersection`, `checkClash` |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose A3 ops on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel exports |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire A3 ops into ribbon analysis tools |
| `docs/superpowers/notes/kernel-api-A3.md` | Create (Task 1) — verified kernel API for A3 ops |
| `e2e/brep-a3-recon-electron.spec.js` | Create (Task 1) — empirical recon |
| `e2e/brep-check-electron.spec.js` | Create (Task 4) — A3 e2e gate |

---

## Task 1: A3 kernel API reconnaissance (de-risk)

**Files:**
- Create: `e2e/brep-a3-recon-electron.spec.js`
- Create: `docs/superpowers/notes/kernel-api-A3.md`

Empirically verifies, inside the real Electron app, the complete working call sequences for the A3 operations. Mirrors `e2e/brep-a2-recon-electron.spec.js` (read it for the pattern).

- [ ] **Step 1: Write the recon spec**

Create `e2e/brep-a3-recon-electron.spec.js`. Launch the Electron app, get `oc` via `window.__archdiscKernel.getOCCT()`, and inside `win.evaluate(...)` empirically determine the COMPLETE working call sequence for each item below. try/catch each; on failure record the error and try alternatives (suffixes, arg counts, introspection via `Object.getOwnPropertyNames`). `.delete()` every the kernel object created. Write findings to `docs/superpowers/notes/kernel-api-A3-recon.json`, `console.log` them, `expect(...)` each item confirmed so the spec PASSES green. `test.setTimeout(600000)`.

Build input solids with `new oc.BRepPrimAPI_MakeBox_2(dx,dy,dz)` (verified in kernel-api-A1.md). To translate a box for overlap tests, use a `gp_Trsf` + `BRepBuilderAPI_Transform` — verify that chain too (item 3).

1. **Self-intersection check — clean shape.** Use `BOPAlgo_CheckerSI`. Determine: the constructor; how to feed the shape — `SetArguments(TopTools_ListOfShape)` (build the list with `TopTools_ListOfShape_1` + `.Append_1(shape)`); `.Perform(progressRange?)` (find the arity — it may need a `Message_ProgressRange_1`); how to read the result — `.HasErrors()` and/or the interferences map (`.Interferences()` or similar). Run it on a clean `BRepPrimAPI_MakeBox_2(20,20,20)` — confirm it reports NO self-intersection / no errors. Record the COMPLETE sequence and the exact result-reading calls.
2. **Self-intersection check — self-intersecting shape.** Build a deliberately self-intersecting shape: a `TopoDS_Compound` containing TWO OVERLAPPING boxes (build a compound via `new oc.TopoDS_Compound_1()` + `new oc.BRep_Builder_1()` + `.MakeCompound(compound)` + `.Add(compound, box1)` + `.Add(compound, box2)`, where box2 is translated to overlap box1). Run `BOPAlgo_CheckerSI` on the compound — confirm it DOES report self-intersection (errors present, or a non-empty interferences result). Record how to count/detect the intersections. (If a compound of overlapping solids does not trigger CheckerSI, find another reliable way to produce a self-intersecting shape and record it.)
3. **Shape transform (helper for clash tests).** Verify translating a shape: `new oc.gp_Trsf_1()` + `.SetTranslation_1(new oc.gp_Vec_4(dx,dy,dz))` + `new oc.BRepBuilderAPI_Transform_2(shape, trsf, false)` + `.Shape()`. Translate a 20mm box by (10,0,0); confirm via bounding box (`Bnd_Box_1` + `BRepBndLib.Add`) that it moved. Record the sequence.
4. **Clash — interference volume.** For two overlapping solids (box A at origin 20³, box B = A translated by (10,0,0)), the interference region is their boolean COMMON. The kernel already has `common` — but for the recon, verify directly: `new oc.BRepAlgoAPI_Common_3(a, b, progressRange)` + `.Build(pr)` + `.Shape()`, then measure the volume (`GProp_GProps_1` + `BRepGProp.VolumeProperties_1`). Confirm the overlap volume is ≈ 10·20·20 = 4000. Record the sequence.
5. **Clash — minimum distance.** `BRepExtrema_DistShapeShape`. For two DISJOINT solids (box A 20³ at origin, box B = A translated by (50,0,0)), determine the constructor (`BRepExtrema_DistShapeShape_2(shapeA, shapeB, ...)` — find the overload + args), `.Perform()` if needed, `.Value()` → the minimum distance. Confirm the distance is ≈ 30 (gap between a box ending at x=20 and one starting at x=50). Also run it on the two OVERLAPPING boxes from item 4 and confirm the distance is ≈ 0. Record the COMPLETE sequence.

For anything not confirmable after genuine effort, record `NOT CONFIRMED` with the error.

- [ ] **Step 2: Build and run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-a3-recon-electron.spec.js --project=chromium
```

- [ ] **Step 3: Write the verified API note**

Create `docs/superpowers/notes/kernel-api-A3.md`. For each of items 1–5, the COMPLETE verified copy-pasteable JavaScript call sequence. Mark it verified against `opencascade.js@2.0.0-beta.b5ff984`. Tasks 2 references this note.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-a3-recon-electron.spec.js docs/superpowers/notes/kernel-api-A3.md docs/superpowers/notes/kernel-api-A3-recon.json
git commit -m "test(kernel): empirical kernel API recon for Phase A3 ops"
```

---

## Task 2: BrepCheck — self-intersection & clash detection

**Files:**
- Create: `frontend/src/kernel/brep/BrepCheck.js`

> Fill each `withScope` body with the verified sequences from `docs/superpowers/notes/kernel-api-A3.md` (items 1/2 for self-intersection, items 4/5 for clash). `track()` every transient the kernel object.

- [ ] **Step 1: Create BrepCheck.js**

Create `frontend/src/kernel/brep/BrepCheck.js`:
```js
/**
 * ArchDisc Kernel — evaluation & checking (analytical, no new geometry):
 * self-intersection detection and clash / interference detection.
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A3.md.
 */

import { getOCCT } from './occtKernel.js';
import { withScope, track } from './BrepShape.js';

/**
 * Detect self-intersections in a solid (self-interfering faces/shells).
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @returns {Promise<{selfIntersects: boolean, count: number}>}
 */
export async function checkSelfIntersection(brepShape) {
  if (!brepShape || !brepShape.shape) throw new Error('checkSelfIntersection: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    /* verified BOPAlgo_CheckerSI sequence from kernel-api-A3.md items 1-2:
       feed brepShape.shape, Perform, read errors/interferences.
       Compute `selfIntersects` (boolean) and `count` (number). */
    return { selfIntersects, count };
  });
}

/**
 * Detect a clash between two solids. Reports whether they interfere, the
 * overlap (interference) volume in mm³, and the minimum clearance distance
 * in mm (0 when they touch or overlap).
 * @param {import('./BrepShape.js').BrepShape} a
 * @param {import('./BrepShape.js').BrepShape} b
 * @returns {Promise<{clash: boolean, interferenceVolume: number, minDistance: number}>}
 */
export async function checkClash(a, b) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error('checkClash: both operands must be BrepShapes with live shapes');
  }
  const oc = await getOCCT();
  return withScope(() => {
    /* verified sequences from kernel-api-A3.md items 4-5:
       - interference volume: BRepAlgoAPI_Common_3 + Build + measure the
         common volume → `interferenceVolume`
       - minimum distance: BRepExtrema_DistShapeShape → `minDistance`
       `clash` is true when interferenceVolume > 1e-6. */
    return { clash: interferenceVolume > 1e-6, interferenceVolume, minDistance };
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```
Expected: build succeeds (every `/* verified ... */` comment must be replaced with real code that defines the variables used in the `return`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepCheck.js
git commit -m "feat(kernel): add self-intersection & clash detection"
```

---

## Task 3: Facade, barrel & ribbon wiring

**Files:**
- Modify: `frontend/src/kernel/brep/index.js`
- Modify: `frontend/src/kernel/brep/ArchDiscKernel.js`
- Modify: `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`

- [ ] **Step 1: Update the barrel export**

In `frontend/src/kernel/brep/index.js`, add:
```js
export { checkSelfIntersection, checkClash } from './BrepCheck.js';
```

- [ ] **Step 2: Extend the ArchDiscKernel facade**

In `frontend/src/kernel/brep/ArchDiscKernel.js`, add the import:
```js
import { checkSelfIntersection, checkClash } from './BrepCheck.js';
```
And in the `brep:` object literal add:
```js
    checkSelfIntersection, checkClash,
```

- [ ] **Step 3: Wire A3 ops into the ribbon**

In `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`, wire two analysis ribbon tools to the A3 checks. READ `frontend/src/components/RibbonToolbar.jsx` to find suitable existing tool names and their tab/group, and READ an existing the kernel-wired handler for the pattern.

- **`Check Geometry`** (exists in the Part tab's Direct Edit / Import Repair group) → wire its handler to run `ArchDiscKernel.brep.checkSelfIntersection` on the current the kernel body (`window.__lastBrepShape` if present, else build a default `makeBox(40,40,40)`). These checks do NOT render geometry — return `{ status, message }` where `status` is `'success'` if no self-intersection (`message` e.g. `'Check Geometry: no self-intersections — geometry is clean (via ArchDisc Kernel BOPAlgo_CheckerSI)'`) and `'warn'` if self-intersections are found (`message` reports the count).
- **`Interference Detection`** / a clash tool — find a suitable existing ribbon tool in the Assembly tab (e.g. `Interference Detection`, `Clash`, or `Interference Check`). Wire it to run `ArchDiscKernel.brep.checkClash` between two representative the kernel solids built in the handler — a `makeBox(30,30,30)` and a `makeCylinder(10,40)` (which overlap). Return `{ status, message }`: `status` `'warn'` if `clash` is true (message reports the interference volume), `'success'` if clear (message reports the clearance distance). Dispose the two operand `BrepShape`s after the check.
- If neither ribbon tool name exists, add `Check Geometry` and `Interference Check` tools to a sensible tab/section in BOTH `RibbonToolbar.jsx` and `WorkbenchMechanical.jsx` `TOOL_GROUPS`, and add their handlers.

Each handler: try/catch, return `{ status: 'error', message }` on failure.

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -8
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js frontend/src/components/RibbonToolbar.jsx frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(kernel): expose A3 checks on facade + wire into ribbon tools"
```

---

## Task 4: Headed Electron e2e — A3 gate

**Files:**
- Create: `e2e/brep-check-electron.spec.js`

A3 ops are analytical — the e2e asserts the VERDICT (no angle/zoom capture; that is for geometry-producing ops). Copy the `launch()` helper + imports from `e2e/brep-features-electron.spec.js`.

- [ ] **Step 1: Create `e2e/brep-check-electron.spec.js`**

Copy the `launch()` boilerplate. `test.setTimeout(600000)`. Four tests:
```js
test('self-intersection: a clean box reports no self-intersection', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    return K.checkSelfIntersection(box);
  });
  expect(r.selfIntersects).toBe(false);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('self-intersection: a compound of two overlapping boxes is detected', async () => {
  const { app, win, pageErrors } = await launch();
  // Build the self-intersecting test shape the same way the A3 recon did.
  const r = await win.evaluate(async () => {
    return window.__archdiscA3SelfIntersectTest
      ? window.__archdiscA3SelfIntersectTest()
      : null;
  });
  // The recon proved a compound of two overlapping boxes self-intersects;
  // this test drives the same construction. If the kernel exposes a direct
  // way, use it; otherwise this asserts the verdict from that helper.
  expect(r).not.toBeNull();
  expect(r.selfIntersects).toBe(true);
  expect(r.count).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('clash: two overlapping solids report a clash with positive interference volume', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const b = await K.makeCylinder(8, 20); // overlaps the box near the origin
    return K.checkClash(a, b);
  });
  expect(r.clash).toBe(true);
  expect(r.interferenceVolume).toBeGreaterThan(0);
  expect(r.minDistance).toBeLessThan(1);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('clash: two disjoint solids report no clash with a positive clearance', async () => {
  const { app, win, pageErrors } = await launch();
  const r = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(20, 20, 20);
    const b = await K.makeBox(20, 20, 20);
    // a and b are both at the origin → they overlap. To make them disjoint,
    // the kernel needs a translate; if checkClash on two coincident boxes is
    // the only option, this test instead asserts the coincident case. The
    // implementer MUST make this a genuine disjoint test — see note below.
    return K.checkClash(a, b);
  });
  // SEE NOTE: this test must exercise genuinely DISJOINT solids.
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

> **IMPORTANT for the implementer — two things this task must resolve:**
> 1. **Self-intersecting test shape.** The kernel has no public op that returns a self-intersecting `BrepShape`. The recon (Task 1 item 2) proved a `TopoDS_Compound` of two overlapping boxes self-intersects. Expose a TEST-ONLY hook for the e2e: in `WorkbenchMechanical.jsx`'s `window.__archdiscKernel` object, add `__archdiscA3SelfIntersectTest` (or put it under `window.__archdiscKernel`) — an async function that builds that compound (per the recon) and runs `checkSelfIntersection` on it, returning the verdict. This mirrors the established `window.__archdisc*` test-hook pattern. The second e2e test drives that hook.
> 2. **Disjoint clash test.** `checkClash` on two coincident boxes is not a disjoint case. The kernel currently has no `translate`. Resolve this ONE of two ways: (a) if a translate/transform op is trivial to add given the Task-1-verified `gp_Trsf` + `BRepBuilderAPI_Transform` sequence, add a small `translate(brepShape, dx, dy, dz)` to the kernel (`BrepCheck.js` is the wrong home — add it to `BrepShape.js` helpers or a new tiny module, export it on the facade) and use it to place `b` clearly apart from `a`; OR (b) use two primitives that are naturally disjoint — e.g. `makeBox(10,10,10)` at the origin and a `makeSphere` built far from it is not possible without translate either. **Approach (a) is preferred** — a `translate` op is genuinely useful and the recon verified the exact sequence. Implement `translate`, then the disjoint test builds `a` and `translate(b, 50,0,0)`, asserts `clash === false`, `interferenceVolume === 0` (or `< 1e-6`), and `minDistance` ≈ 30 (±10%). Update the test accordingly and assert real disjoint values.

- [ ] **Step 2: Build and run the A3 gate spec**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-check-electron.spec.js --project=chromium
```
Expected: 4 tests PASS. Reconcile against `kernel-api-A3.md` on failure. Do not weaken assertions.

- [ ] **Step 3: Run the full brep e2e suite (regression)**

```bash
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js --project=chromium
```
Expected: ALL pass — confirms A3 did not regress earlier phases.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-check-electron.spec.js frontend/src/
git commit -m "test(kernel): A3 gate — headed Electron e2e for self-intersection & clash checks"
```
(Include any `frontend/src/` files touched for the `translate` op / the self-intersect test hook; mention them in the commit body.)

---

## Self-review notes

- **Spec coverage (§3.6 / §6 Phase A3):** self-intersection detection (Tasks 2, 4) ✓; clash/interference detection (Tasks 2, 4) ✓; facade + ribbon wiring (Task 3) ✓; headed Electron e2e (Task 4) ✓; kernel API de-risk (Task 1) ✓. A `translate` op is added as a supporting primitive (Task 4) — genuinely useful and needed for a real disjoint clash test.
- **Deferred (correctly out of this plan):** A4 geometry simplification; A5 hard blending; visual highlighting of the clash zone (A3 reports the interference numerically — visual clash-zone rendering is later); exact intersection-zone geometry beyond the common-volume measure.
- **Placeholder note:** the `/* verified ... */` markers in Task 2 are filled from Task 1's empirically-verified `kernel-api-A3.md` — the proven A0–A2 de-risk flow. Every other code block is complete.
- **Type consistency:** facade/barrel names (`checkSelfIntersection`, `checkClash`, `translate`) are consistent across Tasks 2–4; verdict object shapes (`{selfIntersects,count}`, `{clash,interferenceVolume,minDistance}`) match between `BrepCheck.js` and the e2e assertions.
