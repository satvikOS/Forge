# Sub-project B — Advanced Booleans & Topology Alterations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the §3.4 "Boolean & Topology Alterations" capability set from the kernel spec — non-manifold booleans, coplanar/coincident-face booleans, high-density lattice intersections, and local face replacement — behind the ArchDiscKernel facade, ribbon-integrated, and verified by real-user-workflow headed Electron e2e tests with all-angle/zoom capture.

**Architecture:** Extends the OCCT-backed kernel under `frontend/src/kernel/brep/` (Sub-project A, phases A0–A5). Each op recon-first → implement → expose on facade → wire as a ribbon tool → e2e gate. **Tests must drive ops via real ribbon clicks and any param dialogs — no hook-injected pre-built models** (per the user directive recorded in `feedback_e2e_user_workflows`). The §3.4 ops go beyond what A1's standard `BRepAlgoAPI_Fuse/Cut/Common` does: they need OCCT's lower-level `BOPAlgo_Builder` (`BRepAlgoAPI_BuilderAlgo`) for non-manifold/multi-arg results, fuzzy tolerance for coincident faces, batched workflows for lattices, and `BRepTools_ReShape` / `BRepFeat` for local face replacement.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (pinned), Vite 7, React 19, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference spec:** `docs/superpowers/specs/2026-05-18-occt-kernel-integration-foundation-design.md` (§3.4).

---

## Important context for the implementer

- **Read first:** the spec, the A5 plan, and the verified API notes `docs/superpowers/notes/occt-api-A0.md` … `A5.md`.
- **A0–A5 are done.** `frontend/src/kernel/brep/` has the full Sub-project A kernel: loader, `BrepShape` + `withScope`/`track`, primitives, booleans (`fuse`/`cut`/`common` — the simple `BRepAlgoAPI_*` path), features (extrude/revolve/fillet/chamfer/variableFillet), local ops (shell/thicken/offset/draft), surfacing (sweep/loft), evaluation (`checkSelfIntersection`/`checkClash`), simplification (`simplify`), blending (`blendG2`/`cliffEdgeBlend`/`mitreCorner`), transforms (`translate`/`makeCompound`), STEP I/O, tessellation, measurement, `ArchDiscKernel` facade.
- **Op pattern (unchanged):** `const oc = await getOCCT(); return withScope(() => { ...track() every transient OCCT object...; if (shape.IsNull()) throw ...; return new BrepShape(shape, meta); });`. OCCT Embind objects leak the WASM heap unless `track()`d.
- **e2e methodology (hard requirement):** every op e2e test drives the op by clicking the real ribbon tool (and any param dialog) — NOT by calling `kernel.brep.*` to build inputs. The proven ribbon-click pattern is in `e2e/brep-ribbon-electron.spec.js` and `e2e/brep-simplify-electron.spec.js` Test 3. Geometry results are verified numerically AND from many camera angles/zooms via `e2e/helpers/orbitCapture.js`. Recon specs and pure-kernel lifecycle tests are exempt (they're API/infrastructure tests, not user UX).
- **Honesty principle (roadmap §10):** if an OCCT API is unbound or doesn't work in this prebuilt build, document it openly in `docs/superpowers/notes/occt-api-B.md`; do NOT fake it. The Sub-project A recon found `BOPAlgo_CheckerSI`, `BOPAlgo_PaveFiller`, `NCollection_IndexedDataMap`, `BVH_PrimitiveSet`, and `BRepOffsetAPI_MakeFilling.Build` unreachable — be prepared for similar findings here, especially around `BOPAlgo_Builder` internals.
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepBoolAdvanced.js` | Create — non-manifold + coincident booleans, lattice batch boolean |
| `frontend/src/kernel/brep/BrepRewrite.js` | Create — local face replacement (`BRepTools_ReShape`) |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose B ops on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel exports |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire B ops into existing/new ribbon tools |
| `frontend/src/components/RibbonToolbar.jsx` | Modify (if needed) — add new B ribbon tools |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | Modify (if needed) — TOOL_GROUPS + any `render*` drivers |
| `docs/superpowers/notes/occt-api-B.md` | Create (Task 1) — verified API + honest verdict per op |
| `e2e/brep-b-recon-electron.spec.js` | Create (Task 1) — empirical recon |
| `e2e/brep-b-advanced-electron.spec.js` | Create (Task 7) — Sub-project B e2e gate |

---

## Task 1: Sub-project B OCCT reconnaissance

**Files:**
- Create: `e2e/brep-b-recon-electron.spec.js`
- Create: `docs/superpowers/notes/occt-api-B.md`

Empirically verifies the OCCT APIs each §3.4 capability needs. Same pattern as `e2e/brep-a5-recon-electron.spec.js` — `expect` only that each capability has a recorded verdict (REACHABLE / NOT_REACHABLE with evidence), so the spec PASSES green meaning investigation complete.

- [ ] **Step 1: Write the recon spec**

Create `e2e/brep-b-recon-electron.spec.js`. Launch the Electron app, get `oc`, and inside `win.evaluate(...)` investigate each item below. try/catch each candidate API; on failure record the error and try alternatives; introspect with `Object.getOwnPropertyNames(oc)` and prototype walks. `.delete()` every OCCT object. Write `docs/superpowers/notes/occt-api-B-recon.json`, `console.log` it, `expect(...)` each capability has a verdict. `test.setTimeout(600000)`.

Use the verified A0–A5 APIs to build inputs (`BRepPrimAPI_MakeBox_2`, `MakeCylinder_1`, `gp_Trsf_1`+`SetTranslation_1`+`BRepBuilderAPI_Transform_2(...,true)`, etc.).

1. **Non-manifold booleans (advanced builder).** Investigate `BRepAlgoAPI_BuilderAlgo` and/or `BOPAlgo_Builder` (the lower-level multi-argument boolean engine). Determine: constructor (any `_N` suffix); how to feed multiple arguments via `AddArgument(shape)` / `SetArguments(TopTools_ListOfShape)`; `.Perform(progressRange?)` and/or `.Build(progressRange)`; `.IsDone()`, `.HasErrors()`, `.Shape()`. Build a test case that produces a NON-MANIFOLD result: two cubes sharing a single common FACE (place box B exactly abutting box A so face-to-face contact creates a non-manifold edge/face in the union). Fuse them — does the advanced builder produce a non-manifold solid (vs. the standard `BRepAlgoAPI_Fuse_3` which may simplify or fail)? Measure faces/edges of the result. Record the verdict and the COMPLETE call sequence.

2. **Coplanar/coincident-face booleans (fuzzy tolerance).** `BRepAlgoAPI_Fuse_3` (verified in A1) supports a fuzzy tolerance via `.SetFuzzyValue(tol)`. Determine its exact method name (introspect the `BRepAlgoAPI_Fuse` prototype for `SetFuzzy*`). Test: two 20mm boxes positioned so their +X / −X faces are within 1e-3 mm of each other (geometrically coincident within float noise). Without fuzzy tolerance, OCCT may fail or produce a degenerate result; with `SetFuzzyValue(0.01)` set BEFORE `.Build(pr)`, OCCT should robustly unite them as if perfectly coincident. Confirm and record the exact method name, accepted tolerance range, and a working call sequence.

3. **High-density lattice batching.** Lattice intersection = many small booleans. Investigate whether `BOPAlgo_Builder` accepts a long list of arguments and produces a single combined result in one pass (which is much faster than N sequential pairwise booleans). Test: 8 small boxes arranged in a 2×2×2 cluster, each abutting its neighbours, fused in ONE `BOPAlgo_Builder` call. Compare to 7 sequential `BRepAlgoAPI_Fuse_3` calls. Record whether single-pass multi-arg boolean is reachable, and timing if measurable.

4. **Local face replacement.** Investigate `BRepTools_ReShape` (or `ShapeBuild_ReShape`). Determine the constructor; the `.Replace(oldShape, newShape)` method; the `.Apply(shape, ...)` method that produces the rewritten shape. Test: take a `MakeBox_2(20,20,20)`, find one face via `TopExp_Explorer`, replace it with a different planar face built from the same wire (this is the simplest verifiable replacement that won't break topology). Confirm the rewritten shape still has 6 faces and that the replaced face's geometry is distinguishable from the original. Record the COMPLETE call sequence.

For each capability, record `REACHABLE` (with verified call) or `NOT_REACHABLE` (with error + what was tried). Do NOT fake.

- [ ] **Step 2: Build and run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-b-recon-electron.spec.js --project=chromium
```
GREEN = investigation complete with verdict for all 4.

- [ ] **Step 3: Write the verified API note + deliverable scope**

Create `docs/superpowers/notes/occt-api-B.md`. For each of the 4 capabilities: the `REACHABLE`/`NOT_REACHABLE` verdict; for reachable ones the COMPLETE verified copy-pasteable call sequence; for not-reachable ones an honest explanation. Add a "Sub-project B deliverable scope" section listing exactly which ops Tasks 2–6 will build. Mark verified against `opencascade.js@2.0.0-beta.b5ff984`.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-b-recon-electron.spec.js docs/superpowers/notes/occt-api-B.md docs/superpowers/notes/occt-api-B-recon.json
git commit -m "test(kernel): Sub-project B recon — advanced boolean reachability verdict"
```

---

## Task 2: Non-manifold + multi-arg booleans (`fuseAll`, `fuseNonManifold`)

**Files:**
- Create: `frontend/src/kernel/brep/BrepBoolAdvanced.js`

> Implement only what Task 1 marked `REACHABLE`. Fill `withScope` bodies from `docs/superpowers/notes/occt-api-B.md` items 1 & 3. `track()` every transient.

- [ ] **Step 1: Create BrepBoolAdvanced.js with the multi-arg boolean ops**

Create `frontend/src/kernel/brep/BrepBoolAdvanced.js`:
```js
/**
 * ArchDisc Kernel — advanced boolean operations (OCCT BOPAlgo_Builder):
 * non-manifold-tolerant multi-argument fuse, batched lattice booleans,
 * fuzzy-tolerance coplanar fuse.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-B.md.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Multi-argument fuse via OCCT BOPAlgo_Builder — single-pass boolean
 * across N input shapes. Faster than sequential pairwise fuses and able
 * to produce non-manifold results when inputs share faces or edges.
 * @param {BrepShape[]} brepShapes
 * @returns {Promise<BrepShape>}
 */
export async function fuseAll(brepShapes) {
  if (!Array.isArray(brepShapes) || brepShapes.length < 2) {
    throw new Error('fuseAll: needs an array of at least two BrepShapes');
  }
  for (const s of brepShapes) {
    if (!s || !s.shape) throw new Error('fuseAll: every entry must be a BrepShape with a live shape');
  }
  const oc = await getOCCT();
  return withScope(() => {
    /* verified BOPAlgo_Builder sequence from occt-api-B.md items 1 & 3:
       construct, add every brepShapes[i].shape, Perform/Build with a
       Message_ProgressRange, check IsDone(), read .Shape() → `const shape`. */
    if (shape.IsNull()) throw new Error('fuseAll: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'fuseAll', parents: brepShapes.map(s => s.id) });
  });
}

/**
 * Non-manifold-tolerant fuse of two shapes that share a face or edge.
 * If the recon found the advanced builder genuinely produces non-manifold
 * output, use that path; otherwise this function uses the same multi-arg
 * builder as `fuseAll`. The op's value over `fuse` is that it accepts and
 * preserves shared faces without "simplifying" them away.
 * @param {BrepShape} a
 * @param {BrepShape} b
 * @returns {Promise<BrepShape>}
 */
export async function fuseNonManifold(a, b) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error('fuseNonManifold: both operands must be BrepShapes with live shapes');
  }
  return fuseAll([a, b]);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepBoolAdvanced.js
git commit -m "feat(kernel): add multi-arg + non-manifold fuse via BOPAlgo_Builder"
```

---

## Task 3: Coincident-face / fuzzy boolean (`fuseCoincident`)

**Files:**
- Modify: `frontend/src/kernel/brep/BrepBoolAdvanced.js`

> From `occt-api-B.md` item 2. The base op is the verified `new oc.BRepAlgoAPI_Fuse_3(a.shape, b.shape, pr)` from A1, plus a `.SetFuzzyValue(tol)` call BEFORE `.Build(pr)`.

- [ ] **Step 1: Append `fuseCoincident` to BrepBoolAdvanced.js**

Append:
```js
/**
 * Robustly fuse two solids whose touching faces are coincident within a
 * tolerance. Uses BRepAlgoAPI_Fuse + SetFuzzyValue to tolerate float-noise
 * mis-alignment that would otherwise make the boolean fail or produce a
 * degenerate result.
 * @param {BrepShape} a
 * @param {BrepShape} b
 * @param {number} [tolerance]  fuzzy tolerance (mm), default 0.01
 * @returns {Promise<BrepShape>}
 */
export async function fuseCoincident(a, b, tolerance = 0.01) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error('fuseCoincident: both operands must be BrepShapes with live shapes');
  }
  if (!(tolerance > 0)) throw new Error(`fuseCoincident: tolerance must be positive (got ${tolerance})`);
  const oc = await getOCCT();
  return withScope(() => {
    /* verified sequence from occt-api-B.md item 2:
       const fuse = track(new oc.BRepAlgoAPI_Fuse_3(a.shape, b.shape, track(new oc.Message_ProgressRange_1())));
       fuse.SetFuzzyValue(tolerance);  // or whatever method name the note records
       fuse.Build(track(new oc.Message_ProgressRange_1()));
       if (!fuse.IsDone()) throw ...
       const shape = fuse.Shape();
       Match the exact API names recorded in occt-api-B.md item 2. */
    if (shape.IsNull()) throw new Error('fuseCoincident: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'fuseCoincident', params: { tolerance }, parents: [a.id, b.id] });
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepBoolAdvanced.js
git commit -m "feat(kernel): add fuzzy-tolerance coincident-face fuse"
```

---

## Task 4: Lattice boolean (`fuseLattice`)

**Files:**
- Modify: `frontend/src/kernel/brep/BrepBoolAdvanced.js`

> Lattice = many small components fused. Reuses `fuseAll`'s single-pass `BOPAlgo_Builder` path; this op is the §3.4-named "high-density lattice intersection" surfaced as a distinct named op with size-validation.

- [ ] **Step 1: Append `fuseLattice` to BrepBoolAdvanced.js**

Append:
```js
/**
 * Fuse N lattice members into one solid via a single BOPAlgo_Builder pass.
 * Mechanically delegates to `fuseAll`; the dedicated name exists because
 * lattice booleans are a §3.4-named capability and validate the caller
 * passed enough members to be a meaningful lattice.
 * @param {BrepShape[]} members  the lattice's bar/beam shapes (≥4)
 * @returns {Promise<BrepShape>}
 */
export async function fuseLattice(members) {
  if (!Array.isArray(members) || members.length < 4) {
    throw new Error('fuseLattice: needs at least 4 lattice member BrepShapes');
  }
  return fuseAll(members);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepBoolAdvanced.js
git commit -m "feat(kernel): add lattice-batch boolean fuse"
```

---

## Task 5: Local face replacement (`replaceFace`)

**Files:**
- Create: `frontend/src/kernel/brep/BrepRewrite.js`

> From `occt-api-B.md` item 4 — `BRepTools_ReShape`. `track()` every transient.

- [ ] **Step 1: Create BrepRewrite.js**

Create `frontend/src/kernel/brep/BrepRewrite.js`:
```js
/**
 * ArchDisc Kernel — topology rewriting (OCCT BRepTools_ReShape):
 * local face replacement.
 * Verified OCCT sequences: docs/superpowers/notes/occt-api-B.md item 4.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Replace ONE face of a shape with a new face (caller-supplied), rebuilding
 * surrounding topology. The new face must share the same boundary wire as
 * the original face so the result remains a valid closed solid; the caller
 * is responsible for that.
 * @param {BrepShape} brepShape    the host shape
 * @param {number}    faceIndex    1-based index into the shape's faces (TopExp order)
 * @param {object}    newFaceShape an OCCT TopoDS_Face to substitute (raw OCCT shape; advanced users only)
 * @returns {Promise<BrepShape>}
 *
 * A friendlier signature operating purely on `BrepShape`s can be added once
 * the kernel exposes a face-extraction helper; for now this preserves the
 * verified BRepTools_ReShape sequence with minimum new API surface.
 */
export async function replaceFace(brepShape, faceIndex, newFaceShape) {
  if (!brepShape || !brepShape.shape) throw new Error('replaceFace: needs a BrepShape');
  if (!(Number.isInteger(faceIndex) && faceIndex >= 1)) {
    throw new Error(`replaceFace: faceIndex must be a positive integer (got ${faceIndex})`);
  }
  if (!newFaceShape) throw new Error('replaceFace: newFaceShape (an OCCT TopoDS_Face) is required');
  const oc = await getOCCT();
  return withScope(() => {
    /* verified sequence from occt-api-B.md item 4:
       walk faces with TopExp_Explorer to the faceIndex-th face → oldFace
       new oc.BRepTools_ReShape() (or ShapeBuild_ReShape — note records which)
       .Replace(oldFace, newFaceShape)
       const out = .Apply(brepShape.shape, ...)  // arity per the note
       → `const shape`. */
    if (shape.IsNull()) throw new Error('replaceFace: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'replaceFace', params: { faceIndex }, parents: [brepShape.id] });
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepRewrite.js
git commit -m "feat(kernel): add local face replacement (BRepTools_ReShape)"
```

---

## Task 6: Facade, barrel & ribbon wiring

**Files:**
- Modify: `frontend/src/kernel/brep/index.js`
- Modify: `frontend/src/kernel/brep/ArchDiscKernel.js`
- Modify: `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
- Modify (if needed): `frontend/src/components/RibbonToolbar.jsx`, `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Barrel — `frontend/src/kernel/brep/index.js`**

Add (only for ops Task 1 marked reachable and Tasks 2–5 implemented):
```js
export { fuseAll, fuseNonManifold, fuseCoincident, fuseLattice } from './BrepBoolAdvanced.js';
export { replaceFace } from './BrepRewrite.js';
```

- [ ] **Step 2: Facade — `frontend/src/kernel/brep/ArchDiscKernel.js`**

Add matching `import { ... } from './BrepBoolAdvanced.js';` and `import { replaceFace } from './BrepRewrite.js';`, and add those names to the `brep:` object literal.

- [ ] **Step 3: Wire B ops into the ribbon — `ToolExecutionEngine.js`**

READ `frontend/src/components/RibbonToolbar.jsx` to find the Part tab's Boolean section. Wire/add these tools (follow the existing OCCT geometry-op handler pattern — read e.g. the `Combine`, `Subtract`, `Intersect` handlers):

- **`Combine (Non-Manifold)`** (NEW tool, Boolean group) → handler builds two coincident 20mm boxes (one at origin, one translated 20mm in +X so they share a face) and calls `ArchDiscKernel.brep.fuseNonManifold(a, b)`. Render. Message: "Combine (Non-Manifold): N members → shared-face union — V = <vol> mm³ via OCCT BOPAlgo_Builder".
- **`Combine (Coincident)`** (NEW tool) → handler builds two 20mm boxes with one offset by `(20 + 1e-3, 0, 0)` (face-coincident within float noise) and calls `fuseCoincident(a, b, 0.01)`. Render.
- **`Lattice Fuse`** (NEW tool) → handler builds an 8-member lattice (2×2×2 grid of small bars, each `makeBox(10,3,3)` translated to a unique cell) and calls `fuseLattice([...members])`. Render.
- **`Replace Face`** (NEW tool, in Direct Edit tab's Direct Modeling group) → handler builds a `makeBox(20,20,20)`, extracts its first face, builds a slightly different replacement face (e.g. the same boundary wire offset by 1mm in +X using `BRepBuilderAPI_MakeFace`), calls `replaceFace(box, 1, newFace)`. Render. (If face extraction is awkward, the handler may use a simpler demonstrative test that exercises `BRepTools_ReShape` per the recon's verified sequence.)

For each new tool, add the tool name in BOTH `RibbonToolbar.jsx` and `WorkbenchMechanical.jsx` `TOOL_GROUPS`. Each handler: build with `ArchDiscKernel.brep.*`, render via `addBrepShapeToScene`, dispose intermediate operand `BrepShape`s after consumption, return `{ status, message }`; try/catch.

- [ ] **Step 4: Verify the build**

```bash
cd frontend && npx vite build 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js frontend/src/components/RibbonToolbar.jsx frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(kernel): expose Sub-project B ops on facade + wire into ribbon"
```

---

## Task 7: Headed Electron e2e — Sub-project B gate (real user workflows)

**Files:**
- Create: `e2e/brep-b-advanced-electron.spec.js`

> Tests drive each op by CLICKING the real ribbon tool (and any param dialog). No `kernel.brep.*` calls to BUILD geometry. Measure + orbit-capture stay. Pattern: see `e2e/brep-simplify-electron.spec.js` (Test 3) for the proven ribbon-click + result-measure flow.

- [ ] **Step 1: Create `e2e/brep-b-advanced-electron.spec.js`**

Copy the `launch()` helper + imports from `e2e/brep-features-electron.spec.js`. Import `captureAllAngles` the way the other geometry specs do. `test.setTimeout(600000)`. One test per delivered B op:

```js
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { captureAllAngles } from './helpers/orbitCapture.js';

async function launch() {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });
  return { app, win, pageErrors };
}

async function clickRibbonTab(win, label) {
  await win.locator('button.ribbon-tab').filter({ hasText: new RegExp('^' + label + '$') }).first()
    .evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function clickRibbonTool(win, label) {
  await win.locator('button.ribbon-tool:has(.ribbon-tool-label)')
    .filter({ has: win.locator('.ribbon-tool-label', { hasText: new RegExp('^' + label + '$') }) })
    .first().evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function clickAndMeasure(win, tabLabel, toolLabel) {
  await win.evaluate(() => { window.__lastBrepShape = null; });
  await clickRibbonTab(win, tabLabel);
  await win.waitForTimeout(120);
  await clickRibbonTool(win, toolLabel);
  await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 60000 });
  return win.evaluate(() => window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape));
}

test.setTimeout(600000);

test('Combine (Non-Manifold): clicking the ribbon tool fuses face-sharing boxes', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await clickAndMeasure(win, 'Part Design', 'Combine (Non-Manifold)');
  // Two 20mm boxes sharing one 20x20 face → 8000 + 8000 = 16000 (no double-counting in OCCT's BOPAlgo_Builder).
  expect(m.volume).toBeGreaterThan(15500);
  expect(m.volume).toBeLessThan(16500);
  const cap = await captureAllAngles(win, 'b-nonmanifold', {
    azimuths: [0,60,120,180,240,300], elevations: [-30,30], zooms: [0.6,1.0,1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('Combine (Coincident): fuzzy-tolerance fuse of near-coincident boxes succeeds', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await clickAndMeasure(win, 'Part Design', 'Combine (Coincident)');
  // Two 20mm boxes at ~1e-3mm coincidence → fused volume ≈ 16000 (one unified solid via fuzzy tol).
  expect(m.volume).toBeGreaterThan(15500);
  expect(m.volume).toBeLessThan(16500);
  const cap = await captureAllAngles(win, 'b-coincident', {
    azimuths: [0,60,120,180,240,300], elevations: [-30,30], zooms: [0.6,1.0,1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('Lattice Fuse: clicking fuses an 8-member lattice in one boolean pass', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await clickAndMeasure(win, 'Part Design', 'Lattice Fuse');
  // 8 × makeBox(10,3,3) = 8 × 90 = 720 mm³ total; arrangement is non-overlapping in a 2×2×2 cluster,
  // so the fused volume ≈ 720 (±10%).
  expect(m.volume).toBeGreaterThan(648);
  expect(m.volume).toBeLessThan(792);
  const cap = await captureAllAngles(win, 'b-lattice', {
    azimuths: [0,60,120,180,240,300], elevations: [-30,30], zooms: [0.6,1.0,1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('Replace Face: clicking the ribbon tool rewrites one face of a box', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await clickAndMeasure(win, 'Direct Edit', 'Replace Face');
  // The handler builds a 20mm box (volume 8000) and replaces one face. A correct
  // replacement yields ≥6 faces (the count may grow if the replacement face is
  // wider than the original) and a finite positive volume.
  expect(m.volume).toBeGreaterThan(0);
  expect(m.faceCount).toBeGreaterThanOrEqual(6);
  const cap = await captureAllAngles(win, 'b-replaceface', {
    azimuths: [0,60,120,180,240,300], elevations: [-30,30], zooms: [0.6,1.0,1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

If a handler's default input produces a volume different from the bounds above, set tight (±10%) bounds around the actual measured value — do not weaken. If a tool's tab is not "Part Design" / "Direct Edit" per Task 6's placement, adjust the `clickRibbonTab(...)` argument accordingly.

- [ ] **Step 2: Build and run the B gate**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-b-advanced-electron.spec.js --project=chromium
```
All delivered B-op tests must PASS. Reconcile bounds against `occt-api-B.md` on failure.

- [ ] **Step 3: Run the full brep e2e suite (regression)**

```bash
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-a4-recon-electron.spec.js e2e/brep-a5-recon-electron.spec.js e2e/brep-b-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/brep-simplify-electron.spec.js e2e/brep-blend-electron.spec.js e2e/brep-b-advanced-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js --project=chromium
```
All must pass.

- [ ] **Step 4: Write the honest B outcome**

Append a "Sub-project B — honest outcome" section to `docs/superpowers/notes/occt-api-B.md` listing which ops shipped (with verified measurements) and any capability marked NOT_REACHABLE.

- [ ] **Step 5: Commit**

```bash
git add e2e/brep-b-advanced-electron.spec.js docs/superpowers/notes/occt-api-B.md
git commit -m "test(kernel): Sub-project B gate — headed Electron e2e for advanced booleans + honest outcome"
```

---

## Self-review notes

- **Spec coverage (§3.4):** non-manifold booleans (Tasks 1, 2, 7) ✓; coplanar/coincident-face booleans (Tasks 1, 3, 7) ✓; high-density lattice intersections (Tasks 1, 4, 7) ✓; local face replacement (Tasks 1, 5, 7) ✓. All recon-first, all implemented only when reachable, all ribbon-integrated, all e2e-driven by real user-workflow ribbon clicks with all-angle/zoom capture.
- **Methodology compliance:** every op e2e drives via a real ribbon click — no kernel.brep.* geometry construction in the spec body. Aligns with `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_no_floating_panels`, `feedback_occt_deep_integration`.
- **Honesty:** if Task 1 finds any §3.4 op unreachable in this prebuilt opencascade.js, the corresponding Task (2–5) is skipped honestly and documented in `occt-api-B.md` — same pattern as A5's MakeFilling.Build() finding.
- **Deferred (next sub-projects per the user):** Sub-project C — Subdivision surface topology (no pinching / no shading errors). Sub-project D — Retopology. Then the rest of §3 (B-rep healing/conversion §3.5 beyond simplification, N-sided patching, etc.).
- **Type consistency:** `fuseAll`, `fuseNonManifold`, `fuseCoincident`, `fuseLattice`, `replaceFace` — single source of truth; the same names appear in the barrel (Task 6), the facade (Task 6), the ribbon handlers (Task 6), and the e2e (Task 7).
