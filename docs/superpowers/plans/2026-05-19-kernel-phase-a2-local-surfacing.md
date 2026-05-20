# Kernel Phase A2 — Local & Surfacing Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the the kernel-native local & surfacing operations to the ArchDisc Kernel — shelling/hollowing, thickening sheets, face offsetting, draft angles, sweeping along a path, lofting through sections, and variable-radius fillet — each wired into the workbench ribbon and verified by a headed Electron e2e test.

**Architecture:** Extends the `frontend/src/kernel/brep/` the kernel (phases A0/A1). Every op is an the kernel call sequence wrapped in the `withScope()` disposal arena, returning a `BrepShape`, exposed through the `ArchDiscKernel` facade. Per the established UI policy, A2 ops are wired into EXISTING Part/Surface ribbon tools (Shell, Draft, Sweep Boss, Loft Boss, Variable Radius Fillet, Thicken, Offset) via `ToolExecutionEngine.js` — no floating panel. Phase A2 leads with an empirical kernel API reconnaissance task; A2's kernel classes (`BRepOffsetAPI_*`) are intricate and version-specific.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (kernel WASM), Vite 7, React 19, Three.js 0.181, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference spec:** `docs/superpowers/specs/2026-05-18-kernel-integration-foundation-design.md` (§3.2, §3.3, §6 Phase A2).

---

## Important context for the implementer

- **Read first:** the spec, the A1 plan `docs/superpowers/plans/2026-05-19-kernel-phase-a1-core-ops.md`, and the verified API notes `docs/superpowers/notes/kernel-api-A0.md` + `kernel-api-A1.md`.
- **A0/A1 are done.** `frontend/src/kernel/brep/` has: `occtKernel.js` (`getOCCT()`), `BrepShape.js` (`BrepShape`, `withScope`, `track`), `BrepPrimitives.js`, `BrepBoolean.js`, `BrepFeatures.js` (`extrudeRect`, `revolveRect`, `filletAll`, `chamferAll`, plus helpers `buildRectFaceXY`, `forEachUniqueEdge`), `BrepStep.js`, `BrepTessellate.js`, `BrepMeasure.js`, `brepToMesh.js`, `ArchDiscKernel.js`, `index.js`.
- **Established op pattern (follow exactly):**
  ```js
  export async function opName(args) {
    /* validate args, throw descriptive Error on bad input */
    const oc = await getOCCT();
    return withScope(() => {
      /* ...track() EVERY transient the kernel object... */
      const shape = maker.Shape();
      if (shape.IsNull()) throw new Error('opName: the kernel produced a null shape');
      return new BrepShape(shape, { op: 'opName', params: {...} });
    });
  }
  ```
- **Memory:** kernel Embind objects leak the WASM heap unless freed — `track()` everything transient; `withScope` frees them.
- **opencascade.js binding convention:** overloaded constructors/methods get `_1`, `_2`, … suffixes; booleans/offsets often need an explicit `.Build(progressRange)` with `new oc.Message_ProgressRange_1()`. **Task 1 verifies every binding empirically.**
- **Ribbon integration pattern (from the A1.5 UX work):** `ToolExecutionEngine.js` has `addBrepShapeToScene(scene, viewport, brepShape, color)` — use it to render the kernel results. Ribbon tools dispatch via `executeTool(groupKey, toolName, ...)` → `TOOL_HANDLERS`. The handler returns `{ status, message }`. The Part tab handlers live in `TOOL_HANDLERS['part-design']`.
- **e2e:** every op verified by a headed Playwright spec launching the genuine Electron app. Build first (`cd frontend && npx vite build`). Run via `./node_modules/.bin/playwright` (1.59). Spec files must not import from `node:*`.
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepLocalOps.js` | Create — `shell`, `thicken`, `offsetShape`, `draft` |
| `frontend/src/kernel/brep/BrepSurfacing.js` | Create — `sweep`, `loft` |
| `frontend/src/kernel/brep/BrepFeatures.js` | Modify — add `variableFillet` |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose A2 ops on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel exports |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire A2 ops into the Shell/Draft/Sweep Boss/Loft Boss/Variable Radius Fillet/Thicken/Offset ribbon handlers |
| `docs/superpowers/notes/kernel-api-A2.md` | Create (Task 1) — verified kernel API for A2 ops |
| `e2e/brep-a2-recon-electron.spec.js` | Create (Task 1) — empirical recon |
| `e2e/brep-localops-electron.spec.js` | Create (Task 6) — shell/thicken/offset/draft e2e |
| `e2e/brep-surfacing-electron.spec.js` | Create (Task 6) — sweep/loft e2e |
| `e2e/brep-varfillet-electron.spec.js` | Create (Task 6) — variable-radius fillet e2e |

---

## Task 1: A2 kernel API reconnaissance (de-risk)

**Files:**
- Create: `e2e/brep-a2-recon-electron.spec.js`
- Create: `docs/superpowers/notes/kernel-api-A2.md`

This task empirically verifies — inside the real Electron app — the COMPLETE working opencascade.js call sequence for every A2 operation, before any kernel code is written. It mirrors `e2e/brep-a1-recon-electron.spec.js` (read that for the pattern).

- [ ] **Step 1: Write the recon spec**

Create `e2e/brep-a2-recon-electron.spec.js`. It launches the Electron app, gets `oc` via `window.__archdiscKernel.getOCCT()`, and inside `win.evaluate(...)` empirically determines, for each item below, the COMPLETE working call sequence. Wrap each attempt in try/catch; on failure record the error and try alternatives (suffixes, arg counts, introspection via `Object.getOwnPropertyNames`). Build each result, then VERIFY it with the A0/A1-verified measurement (`GProp_GProps_1` + `BRepGProp.VolumeProperties_1` + `.Mass()`). `.delete()` every the kernel object created. Write findings to `docs/superpowers/notes/kernel-api-A2-recon.json`, `console.log` them, and `expect(...)` each item confirmed so the spec PASSES green. `test.setTimeout(600000)`.

Items to verify (all dimensions mm; use `BRepPrimAPI_MakeBox_2`, `MakeCylinder_1` etc. from the A1 note to build inputs):

1. **Shell / hollow** — `BRepOffsetAPI_MakeThickSolid`. Hollow a 20mm box to wall thickness 2, removing its top face. Determine: the constructor/`MakeThickSolidByJoin` overload; how to build the `TopTools_ListOfShape` of faces to remove (find a top face via `TopExp_Explorer` + a face-normal or max-Z check); the offset sign convention; `.Build()`; `.Shape()`. A hollow 20mm box wall-2 has volume ≈ 20³ − 16³ + (one open face slab) — just confirm volume is positive and clearly less than 8000 and greater than 0; record the exact sequence.
2. **Thicken sheet** — turn an open face/shell into a solid. Build a single planar face (use the A1-verified `buildRectFaceXY`-style chain: `gp_Pnt_3` → `BRepBuilderAPI_MakeEdge_3` → `BRepBuilderAPI_MakeWire_1`+`Add_1` → `BRepBuilderAPI_MakeFace_15`). Then thicken it by 3mm via `BRepOffsetAPI_MakeThickSolid` (the "from open shape" mode) or `BRepOffsetAPI_MakeOffsetShape`. Confirm a solid with volume ≈ width·height·3. Record the exact sequence.
3. **Offset shape** — `BRepOffsetAPI_MakeOffsetShape`. Offset all faces of a 20mm box outward by 2mm. Determine the constructor + `.PerformByJoin(...)` (or equivalent) args, `.Build()`, `.Shape()`. Confirm the offset solid volume > the original 8000. Record the sequence.
4. **Draft angle** — `BRepOffsetAPI_DraftAngle`. Apply a 5° draft to the side faces of a 20mm box relative to the bottom face as neutral plane, pull direction +Z. Determine: constructor; the `.Add(face, direction, angle, neutralPlane)` call; `.Build()`; `.Shape()`. Confirm a valid solid with volume ≠ 8000. Record the sequence (including how `gp_Dir`, `gp_Pln` are built).
5. **Sweep along a path** — `BRepOffsetAPI_MakePipe`. Build a circular profile wire (use `BRepBuilderAPI_MakeEdge` with a `gp_Circ` + `gp_Ax2`, then `MakeWire`) and a path wire (a straight edge, or a polyline of 2-3 edges). Sweep the profile along the path. Determine the `MakePipe` constructor (spine wire, profile shape), `.Shape()`. Confirm a solid with positive volume. Record the full sequence including `gp_Circ`/`gp_Ax2` construction.
6. **Loft through sections** — `BRepOffsetAPI_ThruSections`. Build 2-3 closed section wires at different Z heights (e.g. a 20mm square wire at z=0 and a 10mm square wire at z=30). Determine: the `ThruSections` constructor (solid flag, ruled flag, precision); the `.AddWire(wire)` call; `.Build()`; `.Shape()`. Confirm a solid with positive volume. Record the sequence.
7. **Variable-radius fillet** — `BRepFilletAPI_MakeFillet` (the A1 note item 10 covers the constant-radius constructor `BRepFilletAPI_MakeFillet(shape, ChFi3d_FilletShape.ChFi3d_Rational)`). For a variable radius, find the `.Add` overload that takes two radii and an edge — `Add(r1, r2, edge)` (likely `Add_3` or similar; A1 uses `Add_2` for the `(radius,edge)` form, so the `(r1,r2,edge)` form is a different suffix). Pick ONE edge of a 20mm box, apply a fillet varying 1mm→4mm along it, `.Build(progressRange)`, `.Shape()`. Confirm a valid solid with volume < 8000. Record the exact `.Add` overload for variable radius.

For anything that cannot be confirmed after genuine effort, record it `NOT CONFIRMED` with the error — do not fake it.

- [ ] **Step 2: Build and run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-a2-recon-electron.spec.js --project=chromium
```
Iterate until every item is confirmed and the spec passes.

- [ ] **Step 3: Write the verified API note**

Create `docs/superpowers/notes/kernel-api-A2.md`. For each of items 1–7, write the COMPLETE verified, copy-pasteable JavaScript call sequence (a self-contained block that builds the result from input shapes). Mark it verified against `opencascade.js@2.0.0-beta.b5ff984`. Tasks 2–4 paste these sequences into the kernel module structure.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-a2-recon-electron.spec.js docs/superpowers/notes/kernel-api-A2.md docs/superpowers/notes/kernel-api-A2-recon.json
git commit -m "test(kernel): empirical kernel API recon for Phase A2 ops"
```

---

## Task 2: BrepLocalOps — shell, thicken, offset, draft

**Files:**
- Create: `frontend/src/kernel/brep/BrepLocalOps.js`

> This task wraps the verified the kernel sequences from `docs/superpowers/notes/kernel-api-A2.md` items 1–4 in the standard kernel structure. The function shells below are COMPLETE — fill each `withScope` body by pasting the verified sequence from the note (items 1–4 respectively) and adapting variable names; every transient the kernel object MUST be `track()`ed; the final shape MUST be checked with `if (shape.IsNull()) throw ...`.

- [ ] **Step 1: Create BrepLocalOps.js**

Create `frontend/src/kernel/brep/BrepLocalOps.js`:
```js
/**
 * ArchDisc Kernel — local operations (the kernel BRepOffsetAPI):
 * shell/hollow, thicken sheet, offset, draft.
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A2.md items 1-4.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Hollow a solid into a thin-walled shell, removing the top (+Z) face.
 * @param {BrepShape} brepShape  the solid to hollow
 * @param {number} thickness     wall thickness (mm)
 * @returns {Promise<BrepShape>}
 */
export async function shell(brepShape, thickness) {
  if (!brepShape || !brepShape.shape) throw new Error('shell: needs a BrepShape');
  if (!(thickness > 0)) throw new Error(`shell: thickness must be positive (got ${thickness})`);
  const oc = await getOCCT();
  return withScope(() => {
    /* PASTE verified sequence from kernel-api-A2.md item 1.
       Build the result shape into `const shape`. track() every transient. */
    if (shape.IsNull()) throw new Error('shell: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'shell', params: { thickness }, parents: [brepShape.id] });
  });
}

/**
 * Thicken a planar sheet of size w×h into a solid slab of `thickness`.
 * (A2 builds the sheet internally; sketch-driven sheets come later.)
 * @param {number} w          sheet width  (mm)
 * @param {number} h          sheet height (mm)
 * @param {number} thickness  (mm)
 * @returns {Promise<BrepShape>}
 */
export async function thicken(w, h, thickness) {
  if (!(w > 0 && h > 0 && thickness > 0)) {
    throw new Error(`thicken: w, h, thickness must be positive (got ${w}, ${h}, ${thickness})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    /* PASTE verified sequence from kernel-api-A2.md item 2 (builds a w×h face,
       then thickens it by `thickness`). Build into `const shape`. */
    if (shape.IsNull()) throw new Error('thicken: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'thicken', params: { w, h, thickness } });
  });
}

/**
 * Offset every face of a solid outward by `distance`.
 * @param {BrepShape} brepShape
 * @param {number} distance  outward offset (mm)
 * @returns {Promise<BrepShape>}
 */
export async function offsetShape(brepShape, distance) {
  if (!brepShape || !brepShape.shape) throw new Error('offsetShape: needs a BrepShape');
  if (!(distance > 0)) throw new Error(`offsetShape: distance must be positive (got ${distance})`);
  const oc = await getOCCT();
  return withScope(() => {
    /* PASTE verified sequence from kernel-api-A2.md item 3. Build into `const shape`. */
    if (shape.IsNull()) throw new Error('offsetShape: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'offsetShape', params: { distance }, parents: [brepShape.id] });
  });
}

/**
 * Apply a draft angle to the side faces of a solid.
 * @param {BrepShape} brepShape
 * @param {number} angleDeg  draft angle (degrees)
 * @returns {Promise<BrepShape>}
 */
export async function draft(brepShape, angleDeg) {
  if (!brepShape || !brepShape.shape) throw new Error('draft: needs a BrepShape');
  if (!(angleDeg > 0 && angleDeg < 90)) throw new Error(`draft: angle must be 0-90° (got ${angleDeg})`);
  const oc = await getOCCT();
  return withScope(() => {
    /* PASTE verified sequence from kernel-api-A2.md item 4 (angle in RADIANS:
       angleDeg * Math.PI / 180). Build into `const shape`. */
    if (shape.IsNull()) throw new Error('draft: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'draft', params: { angleDeg }, parents: [brepShape.id] });
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds (every `/* PASTE ... */` must be replaced with real verified code — the file will NOT compile while a placeholder comment is where `const shape` should be defined).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepLocalOps.js
git commit -m "feat(kernel): add local ops — shell, thicken, offset, draft"
```

---

## Task 3: BrepSurfacing — sweep & loft

**Files:**
- Create: `frontend/src/kernel/brep/BrepSurfacing.js`

> Wraps the verified the kernel sequences from `kernel-api-A2.md` items 5–6. Fill each `withScope` body with the verified sequence; `track()` every transient; check `IsNull()`.

- [ ] **Step 1: Create BrepSurfacing.js**

Create `frontend/src/kernel/brep/BrepSurfacing.js`:
```js
/**
 * ArchDisc Kernel — surfacing operations (the kernel): sweep along a path,
 * loft through sections. A2 builds profiles/sections internally.
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A2.md items 5-6.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Sweep a circular profile (radius `r`) along a straight path of `length`
 * along +Z, producing a solid rod.
 * @param {number} r       profile radius (mm)
 * @param {number} length  path length along +Z (mm)
 * @returns {Promise<BrepShape>}
 */
export async function sweep(r, length) {
  if (!(r > 0 && length > 0)) throw new Error(`sweep: r and length must be positive (got ${r}, ${length})`);
  const oc = await getOCCT();
  return withScope(() => {
    /* PASTE verified sequence from kernel-api-A2.md item 5 (circular profile
       wire of radius r, straight path wire of `length`, MakePipe).
       Build into `const shape`. */
    if (shape.IsNull()) throw new Error('sweep: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'sweep', params: { r, length } });
  });
}

/**
 * Loft a solid through two square section wires: side `bottomSize` at z=0
 * and side `topSize` at z=`height`.
 * @param {number} bottomSize  bottom square side (mm)
 * @param {number} topSize     top square side (mm)
 * @param {number} height      (mm)
 * @returns {Promise<BrepShape>}
 */
export async function loft(bottomSize, topSize, height) {
  if (!(bottomSize > 0 && topSize > 0 && height > 0)) {
    throw new Error(`loft: all params must be positive (got ${bottomSize}, ${topSize}, ${height})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    /* PASTE verified sequence from kernel-api-A2.md item 6 (build a square wire
       of `bottomSize` at z=0 and one of `topSize` at z=height, ThruSections
       with the solid flag, AddWire each, Build). Build into `const shape`. */
    if (shape.IsNull()) throw new Error('loft: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'loft', params: { bottomSize, topSize, height } });
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepSurfacing.js
git commit -m "feat(kernel): add surfacing ops — sweep and loft"
```

---

## Task 4: Variable-radius fillet

**Files:**
- Modify: `frontend/src/kernel/brep/BrepFeatures.js`

> Uses the verified `BRepFilletAPI_MakeFillet` constructor (A1 note item 10) plus the variable-radius `.Add` overload verified in `kernel-api-A2.md` item 7.

- [ ] **Step 1: Append `variableFillet` to BrepFeatures.js**

Append to `frontend/src/kernel/brep/BrepFeatures.js`:
```js
/**
 * Variable-radius fillet on ALL edges of a solid: the radius ramps
 * linearly from `r1` at one end of each edge to `r2` at the other.
 * @param {BrepShape} brepShape
 * @param {number} r1  start radius (mm)
 * @param {number} r2  end radius (mm)
 * @returns {Promise<BrepShape>}
 */
export async function variableFillet(brepShape, r1, r2) {
  if (!brepShape || !brepShape.shape) throw new Error('variableFillet: needs a BrepShape');
  if (!(r1 > 0 && r2 > 0)) throw new Error(`variableFillet: r1, r2 must be positive (got ${r1}, ${r2})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      brepShape.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    // forEachUniqueEdge is defined earlier in this file (added in A1 Task 5).
    forEachUniqueEdge(oc, brepShape.shape, (edge) => {
      /* Variable-radius Add: PASTE the verified `.Add(r1, r2, edge)` call
         (the exact overload suffix) from kernel-api-A2.md item 7. */
    });
    maker.Build(track(new oc.Message_ProgressRange_1()));
    if (!maker.IsDone()) throw new Error('variableFillet: the kernel fillet did not complete');
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('variableFillet: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'variableFillet', params: { r1, r2 }, parents: [brepShape.id] });
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepFeatures.js
git commit -m "feat(kernel): add variable-radius fillet"
```

---

## Task 5: Facade, barrel & ribbon wiring

**Files:**
- Modify: `frontend/src/kernel/brep/index.js`
- Modify: `frontend/src/kernel/brep/ArchDiscKernel.js`
- Modify: `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`

- [ ] **Step 1: Update the barrel export**

In `frontend/src/kernel/brep/index.js`, add these export lines (alongside the existing ones):
```js
export { shell, thicken, offsetShape, draft } from './BrepLocalOps.js';
export { sweep, loft } from './BrepSurfacing.js';
```
And add `variableFillet` to the existing `export { ... } from './BrepFeatures.js';` line.

- [ ] **Step 2: Extend the ArchDiscKernel facade**

In `frontend/src/kernel/brep/ArchDiscKernel.js`, add imports:
```js
import { shell, thicken, offsetShape, draft } from './BrepLocalOps.js';
import { sweep, loft } from './BrepSurfacing.js';
```
Add `variableFillet` to the existing `import { ... } from './BrepFeatures.js';` line. Then in the `brep:` object literal add:
```js
    shell, thicken, offsetShape, draft,
    sweep, loft,
    variableFillet,
```

- [ ] **Step 3: Wire A2 ops into the ribbon handlers**

In `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`, the A1.5 UX work re-wired Part-tab tools to the kernel via `addBrepShapeToScene` and `ArchDiscKernel`. Add/​re-wire these ribbon tool handlers in `TOOL_HANDLERS['part-design']` (read the existing the kernel-wired handlers like `Fillet`/`Combine` for the exact pattern: try/catch, build via `ArchDiscKernel.brep.*`, render via `addBrepShapeToScene`, measure, return `{ status, message }` mentioning "via exact B-rep kernel"):

- **`Shell`** → `ArchDiscKernel.brep.shell(body, thickness)` — operate on `window.__lastBrepShape` if present else a default `makeBox(40,40,40)`; thickness default 3 (or from `requestToolParams('Shell')` if a schema exists).
- **`Draft`** → `ArchDiscKernel.brep.draft(body, angleDeg)` — body as above; angle default 5.
- **`Thicken`** → `ArchDiscKernel.brep.thicken(60, 40, 3)` (a representative sheet→slab).
- **`Sweep Boss`** → `ArchDiscKernel.brep.sweep(8, 60)` (representative rod).
- **`Loft Boss`** → `ArchDiscKernel.brep.loft(40, 16, 50)` (representative tapered loft).
- **`Variable Radius Fillet`** → `ArchDiscKernel.brep.variableFillet(body, 1, 4)` — body as above.
- **`Offset`** or the offset tool present in the Part tab — if a suitable tool name exists, wire it to `ArchDiscKernel.brep.offsetShape(body, 2)`. If no such ribbon item exists, add `'Offset Shape'` to the Part tab's Modify section in BOTH `components/RibbonToolbar.jsx` (the rendered ribbon) and `WorkbenchMechanical.jsx` `TOOL_GROUPS` (the secondary listing), and add its handler.

For each handler: wrap in try/catch, dispose any intermediate operand `BrepShape`s, return `{ status: 'error', message }` on failure.

If a tool name above is currently handled elsewhere or routed through `smartFallback`, trace `executeTool` (~line 157) and ensure the new/​re-wired handler in `TOOL_HANDLERS['part-design']` is the one that runs for `groupKey` `'part'`/`'surface'` as appropriate. `Thicken` may belong to the Surface tab — wire it wherever its ribbon item lives; read `RibbonToolbar.jsx` to confirm which tab/group each of these tools sits in and wire the handler under the matching `TOOL_HANDLERS` group.

- [ ] **Step 4: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -8
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js frontend/src/components/RibbonToolbar.jsx frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(kernel): expose A2 ops on facade + wire into ribbon tools"
```

---

## Task 6: Headed Electron e2e — A2 gate

**Files:**
- Create: `e2e/brep-localops-electron.spec.js`
- Create: `e2e/brep-surfacing-electron.spec.js`
- Create: `e2e/brep-varfillet-electron.spec.js`

Each spec launches the genuine Electron app and drives the A2 ops through the `window.__archdiscKernel.kernel.brep.*` facade (the established e2e pattern — see `e2e/brep-features-electron.spec.js`). One `test()` per operation. `test.setTimeout(600000)`. The `launch()` helper, imports, and structure are identical to `e2e/brep-features-electron.spec.js` — copy that file's boilerplate.

- [ ] **Step 1: Create `e2e/brep-localops-electron.spec.js`**

Copy the `launch()` helper + imports from `e2e/brep-features-electron.spec.js`. Then one test per local op:
```js
test('shell: hollowing a 20mm box yields a positive volume below the solid', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    const hollow = await K.shell(box, 2);
    return K.measure(hollow);
  });
  expect(m.volume).toBeGreaterThan(0);
  expect(m.volume).toBeLessThan(8000);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('thicken: a 60x40 sheet thickened 3mm -> volume ~7200 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.kernel.brep
    .thicken(60, 40, 3).then(s => window.__archdiscKernel.kernel.brep.measure(s)));
  expect(m.volume).toBeGreaterThan(6800);
  expect(m.volume).toBeLessThan(7600);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('offsetShape: offsetting a 20mm box outward 2mm increases volume above 8000', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    const off = await K.offsetShape(box, 2);
    return K.measure(off);
  });
  expect(m.volume).toBeGreaterThan(8000);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('draft: applying a 5° draft to a 20mm box yields a valid solid', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    const drafted = await K.draft(box, 5);
    return K.measure(drafted);
  });
  expect(m.volume).toBeGreaterThan(0);
  expect(m.faceCount).toBe(6);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 2: Build and run the local-ops spec**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-localops-electron.spec.js --project=chromium
```
Expected: 4 tests PASS. If a result is off, reconcile the op against `docs/superpowers/notes/kernel-api-A2.md`. If the empirically-measured volume for `shell`/`draft` differs from the loose bounds above, set tight bounds (±3%) around the TRUE measured value (do not loosen — make the assertion meaningful). Do not proceed until green.

- [ ] **Step 3: Create `e2e/brep-surfacing-electron.spec.js`**

Copy the `launch()` boilerplate. Then:
```js
test('sweep: a r8 circular profile swept 60mm -> rod volume ~12064 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.kernel.brep
    .sweep(8, 60).then(s => window.__archdiscKernel.kernel.brep.measure(s)));
  // pi * 64 * 60 = 12063.7
  expect(m.volume).toBeGreaterThan(11400);
  expect(m.volume).toBeLessThan(12700);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('loft: lofting a 40mm square to a 16mm square over 50mm yields a positive volume', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.kernel.brep
    .loft(40, 16, 50).then(s => window.__archdiscKernel.kernel.brep.measure(s)));
  // a frustum between 40² and 16² over h=50 — positive, well under 40²·50=80000
  expect(m.volume).toBeGreaterThan(0);
  expect(m.volume).toBeLessThan(80000);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 4: Build and run the surfacing spec**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-surfacing-electron.spec.js --project=chromium
```
Expected: 2 tests PASS. Reconcile against `kernel-api-A2.md` items 5–6 on failure. After it passes, tighten the `loft` upper bound to a ±3% window around the real measured volume. Do not proceed until green.

- [ ] **Step 5: Create `e2e/brep-varfillet-electron.spec.js`**

Copy the `launch()` boilerplate. Then:
```js
test('variableFillet: 1mm->4mm variable fillet on a 20mm box reduces volume below 8000', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(20, 20, 20);
    const vf = await K.variableFillet(box, 1, 4);
    return K.measure(vf);
  });
  expect(m.volume).toBeGreaterThan(6000);
  expect(m.volume).toBeLessThan(8000);
  expect(m.faceCount).toBeGreaterThan(6);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 6: Build and run the variable-fillet spec**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-varfillet-electron.spec.js --project=chromium
```
Expected: PASS. Reconcile against `kernel-api-A2.md` item 7 on failure. Do not proceed until green.

- [ ] **Step 7: Run the full brep e2e suite (regression)**

```bash
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js --project=chromium
```
Expected: ALL brep specs (A0 + A1 + A2 + UX) PASS together — confirms A2 did not regress earlier phases.

- [ ] **Step 8: Commit**

```bash
git add e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js
git commit -m "test(kernel): A2 gate — headed Electron e2e for local & surfacing ops"
```

---

## Self-review notes

- **Spec coverage (§3.2 / §3.3 / §6 Phase A2):** shelling/hollowing (Task 2) ✓; thickening sheets (Task 2) ✓; complex face offsetting (Task 2) ✓; draft angles (Task 2) ✓; sweeping along a path (Task 3) ✓; lofting (Task 3) ✓; variable-radius fillet (Task 4) ✓; facade + ribbon wiring (Task 5) ✓; headed Electron e2e per op (Task 6) ✓; kernel API de-risk (Task 1) ✓.
- **Deferred (correctly out of this plan):** A3 evaluation (self-intersection, clash), A4 simplification, A5 hard blending; sketch-driven profiles/sections (A2 builds them internally); tangency-constraint lofting beyond the basic ThruSections (basic loft only); edge-selective draft/shell (A2 uses representative face selection).
- **Placeholder note:** the `/* PASTE verified sequence ... */` markers in Tasks 2–4 are deliberate — the the kernel call bodies are produced empirically by Task 1's recon and pasted from `kernel-api-A2.md`. The recon (Task 1) gives complete, copy-pasteable verified code; this is the proven A0/A1 de-risk flow, not an open placeholder. Every other code block is complete.
- **Type consistency:** facade/barrel names (`shell`, `thicken`, `offsetShape`, `draft`, `sweep`, `loft`, `variableFillet`) are identical across Tasks 2–6; the ribbon handlers call `ArchDiscKernel.brep.<sameName>`; e2e specs call `window.__archdiscKernel.kernel.brep.<sameName>`.
- **opencascade.js API risk:** Task 1 empirically verifies every `BRepOffsetAPI_*` sequence inside the Electron app before any kernel code — the same de-risking flow that made A0 and A1 succeed.
