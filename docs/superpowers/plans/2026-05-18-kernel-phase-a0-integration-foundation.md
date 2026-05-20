# Kernel Phase A0 — Integration Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the the underlying B-rep kernel WASM kernel into ArchDisc far enough to make a box, tessellate it, measure it, render it in the live Electron viewport, and verify the whole pipeline with a headed Electron e2e test.

**Architecture:** A new `frontend/src/kernel/brep/` subtree wraps `opencascade.js` behind a unified `ArchDiscKernel` facade. kernel objects (Embind) are lifecycle-managed via a `withScope()` disposal arena. Results are tessellated to plain triangle data and rendered as a Three.js mesh in the existing mechanical workbench, driven by a new `window.__archdiscKernel` hook. This phase de-risks the WASM/Embind/Vite/Electron integration before any real op set is built.

**Tech Stack:** `opencascade.js` (kernel WASM), Vite 7, React 19, Three.js 0.181, Electron 42, Playwright 1.59 (headed, `_electron` launch).

**Reference spec:** `docs/superpowers/specs/2026-05-18-kernel-integration-foundation-design.md`

---

## Important context for the implementer

- **You do not know the codebase.** Read `docs/superpowers/specs/2026-05-18-kernel-integration-foundation-design.md` first.
- **manifold-3d loader pattern to mirror:** `frontend/src/foundation/manifoldKernel.js` — a singleton WASM loader. The the kernel loader copies this shape exactly.
- **Window-hook pattern to mirror:** `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` lines ~412–440 register `window.__archdiscAtomic` in a `useEffect` keyed on `viewport`. The the kernel hook follows the same pattern.
- **Scene units:** the Three.js scene is in **meters**; geometry data is in **mm**. A rendered body is wrapped in a `THREE.Group` scaled by `0.001` (see `addFoundationManifoldToScene` in `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js:226`).
- **e2e runs the real Electron app:** specs use `import { _electron as electron } from '@playwright/test'`, launch `electron/main.js`, which loads `frontend/dist/index.html` — so **`cd frontend && npx vite build` must run before each Electron spec**. Example to copy: `e2e/atomic-sculpt-bracket-electron.spec.js`.
- **e2e gotcha (project memory):** spec files must NOT `import` from `node:*` — use bare `import fs from 'fs'`.
- **Run Playwright via** `./node_modules/.bin/playwright` (1.59), never `npx` (pulls 1.60).
- **WASM heap discipline:** kernel Embind objects leak unless `.delete()`d — the `withScope()` arena (Task 4) handles this.
- **opencascade.js API uncertainty:** the exact Embind binding names (overload suffixes like `_2`, triangulation accessors) are version-specific. **Task 3 performs API reconnaissance and records the verified surface to `docs/superpowers/notes/kernel-api-A0.md`.** Tasks 5–7 reference that note; the code blocks below target the `opencascade.js` 2.0 beta API and must be reconciled with the recorded surface.
- Work on branch `archdisc`. Commit after every task.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/package.json` | Add `opencascade.js` dependency (modify) |
| `frontend/src/kernel/brep/occtKernel.js` | Create — singleton `getOCCT()` WASM loader |
| `frontend/src/kernel/brep/BrepShape.js` | Create — `TopoDS_Shape` wrapper + `withScope()` disposal arena |
| `frontend/src/kernel/brep/BrepPrimitives.js` | Create — `makeBox` (A0 scope: box only) |
| `frontend/src/kernel/brep/BrepTessellate.js` | Create — shape → `{positions,normals,indices}` |
| `frontend/src/kernel/brep/BrepMeasure.js` | Create — `volume/area/boundingBox/faceCount/edgeCount` |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Create — unified facade |
| `frontend/src/kernel/brep/index.js` | Create — barrel export |
| `frontend/src/kernel/brep/brepToMesh.js` | Create — tessellation → `THREE.Mesh` |
| `frontend/src/components/BrepLabPanel.jsx` + `.css` | Create — minimal B-rep Lab UI panel |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | Modify — register `window.__archdiscKernel`, mount `BrepLabPanel` |
| `docs/superpowers/notes/kernel-api-A0.md` | Create — recorded kernel API surface (Task 3) |
| `e2e/brep-occt-load-electron.spec.js` | Create — Task 3 recon + load test |
| `e2e/brep-foundation-electron.spec.js` | Create — Task 10 full A0 gate |

---

## Task 1: Install opencascade.js

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

Run:
```bash
cd frontend && npm install --save opencascade.js@beta
```
Expected: `opencascade.js` added to `dependencies`.

- [ ] **Step 2: Record the resolved version**

Run:
```bash
cd frontend && node -e "console.log(require('opencascade.js/package.json').version)"
```
Expected: a `2.0.0-beta.*` version string. Note it — Task 3 references it.

- [ ] **Step 3: Verify the WASM + JS dist assets exist**

Run:
```bash
cd frontend && ls node_modules/opencascade.js/dist/ | grep -E 'opencascade.full.(js|wasm)$'
```
Expected: both `opencascade.full.js` and `opencascade.full.wasm` are listed. If the filenames differ (e.g. no `.full`), record the actual names — Task 2 imports them.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build: add opencascade.js (kernel WASM kernel) dependency"
```

---

## Task 2: kernel WASM loader

**Files:**
- Create: `frontend/src/kernel/brep/occtKernel.js`
- Create: `frontend/src/kernel/brep/index.js`

- [ ] **Step 1: Create the loader**

Create `frontend/src/kernel/brep/occtKernel.js`:
```js
/**
 * ArchDisc Kernel — the underlying B-rep kernel WASM singleton loader.
 *
 * ArchDisc's exact B-rep / NURBS kernel. It ships as a large
 * Emscripten WASM module; we load it once and cache the promise. Mirrors
 * `foundation/manifoldKernel.js`. All `kernel/brep/` code awaits this.
 *
 * NOTE: the dist filenames are confirmed in Task 1 Step 3. If they are not
 * `opencascade.full.{js,wasm}`, update the two import specifiers below.
 */

import ocFactory from 'opencascade.js/dist/opencascade.full.js';
// eslint-disable-next-line import/no-unresolved
import ocWasmUrl from 'opencascade.js/dist/opencascade.full.wasm?url';

let cachedModule = null;
let loadPromise = null;

/**
 * Load (or return cached) the kernel WASM module.
 * @returns {Promise<object>} the `oc` API object (all kernel classes).
 */
export async function getOCCT() {
  if (cachedModule) return cachedModule;
  if (!loadPromise) {
    loadPromise = (async () => {
      const oc = await ocFactory({ locateFile: () => ocWasmUrl });
      cachedModule = oc;
      return oc;
    })();
  }
  return loadPromise;
}

/** Reset cache — for tests that verify load-from-scratch behavior. */
export function _reset() {
  cachedModule = null;
  loadPromise = null;
}
```

- [ ] **Step 2: Create the barrel export**

Create `frontend/src/kernel/brep/index.js`:
```js
/** ArchDisc Kernel — B-rep (the kernel) subtree barrel export. */
export { getOCCT, _reset } from './occtKernel.js';
```

- [ ] **Step 3: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -20
```
Expected: build succeeds (the `opencascade.full.wasm` asset is emitted to `dist/`). If Vite errors on the import path, fix the specifier per Task 1 Step 3 and rebuild.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/kernel/brep/occtKernel.js frontend/src/kernel/brep/index.js
git commit -m "feat(kernel): add kernel WASM singleton loader"
```

---

## Task 3: Register the kernel hook + kernel API reconnaissance

**Files:**
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`
- Create: `e2e/brep-occt-load-electron.spec.js`
- Create: `docs/superpowers/notes/kernel-api-A0.md`

- [ ] **Step 1: Register a minimal `window.__archdiscKernel` hook**

In `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`, add the import near the other kernel imports (after the `addFoundationManifoldToScene` import on line 10):
```js
import { getOCCT } from '../../kernel/brep/occtKernel.js';
```
Then add a new `useEffect` immediately after the `window.__archdiscComponents` effect (after line 467):
```js
    // Expose the the kernel-backed ArchDisc Kernel so headed Electron e2e specs
    // (and the B-rep Lab panel) can drive exact B-rep geometry.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscKernel = { getOCCT };
        return () => { delete window.__archdiscKernel; };
    }, []);
```

- [ ] **Step 2: Write the failing recon spec**

Create `e2e/brep-occt-load-electron.spec.js`:
```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('kernel WASM loads inside the ArchDisc Electron app and exposes B-rep classes', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });

  // Load the kernel and introspect the binding surface this version exposes.
  const recon = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
    const names = Object.getOwnPropertyNames(oc);
    const pick = (re) => names.filter(n => re.test(n)).sort();
    return {
      hasMakeBox: pick(/^BRepPrimAPI_MakeBox/),
      hasMesh: pick(/^BRepMesh_IncrementalMesh/),
      hasBRepTool: names.includes('BRep_Tool'),
      hasGProp: pick(/^GProp_GProps|^BRepGProp/),
      hasExplorer: pick(/^TopExp_Explorer/),
      hasTopoDS: names.includes('TopoDS'),
      total: names.length,
    };
  });

  fs.mkdirSync(path.join(__dirname, '..', 'docs', 'superpowers', 'notes'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'superpowers', 'notes', 'kernel-api-A0-recon.json'),
    JSON.stringify(recon, null, 2),
  );
  console.log('kernel recon:', JSON.stringify(recon, null, 2));

  expect(recon.hasMakeBox.length).toBeGreaterThan(0);
  expect(recon.hasMesh.length).toBeGreaterThan(0);
  expect(recon.hasBRepTool).toBe(true);
  expect(recon.total).toBeGreaterThan(100);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 3: Build and run the spec — verify it fails first if the hook is missing, then passes**

Run:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js --project=chromium
```
Expected: the test PASSES (the kernel loads, classes found). If it fails on `__archdiscKernel` undefined, Step 1 was not applied. If it fails because the kernel did not load, inspect the printed `pageErrors` and the wasm asset path before proceeding — **do not continue until this is green.**

- [ ] **Step 4: Record the verified API surface**

Create `docs/superpowers/notes/kernel-api-A0.md` and fill it from the console output + `kernel-api-A0-recon.json` produced by Step 3. Record the exact names found for: the box constructor (e.g. `BRepPrimAPI_MakeBox_2`), the incremental mesher, `BRep_Tool`, `GProp`/`BRepGProp`, `TopExp_Explorer`. Tasks 5–7 reference this file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx e2e/brep-occt-load-electron.spec.js docs/superpowers/notes/kernel-api-A0.md docs/superpowers/notes/kernel-api-A0-recon.json
git commit -m "feat(kernel): register __archdiscKernel hook + verify the kernel loads in Electron"
```

---

## Task 4: BrepShape wrapper + withScope disposal arena

**Files:**
- Create: `frontend/src/kernel/brep/BrepShape.js`

- [ ] **Step 1: Create BrepShape + withScope**

Create `frontend/src/kernel/brep/BrepShape.js`:
```js
/**
 * ArchDisc Kernel — BrepShape: a managed wrapper over an the kernel TopoDS_Shape.
 *
 * kernel objects are Embind-wrapped C++ objects; they leak the WASM heap
 * unless `.delete()`d. Every kernel op runs inside `withScope()`, which
 * frees every the kernel object allocated during the op except the BrepShape(s)
 * the op returns.
 */

let _idCounter = 0;

export class BrepShape {
  /**
   * @param {object} shape  an the kernel TopoDS_Shape
   * @param {object} [meta] construction metadata { op, params, parents }
   */
  constructor(shape, meta = {}) {
    this.id = `brep-${++_idCounter}`;
    this.shape = shape;
    this.meta = meta;
    this._disposed = false;
    this._triangulation = null; // cached {positions,normals,indices}
  }

  /** Free the underlying kernel shape and any cached triangulation. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { if (this.shape && this.shape.delete) this.shape.delete(); } catch { /* already gone */ }
    this.shape = null;
    this._triangulation = null;
  }
}

// Stack of active disposal scopes. The innermost is at the end.
const _scopeStack = [];

/**
 * Track an kernel Embind object for disposal at the end of the current scope.
 * Called by kernel ops for every transient the kernel object (builders, sub-shapes).
 * @template T
 * @param {T} ocObject
 * @returns {T} the same object, for chaining
 */
export function track(ocObject) {
  const scope = _scopeStack[_scopeStack.length - 1];
  if (scope && ocObject) scope.push(ocObject);
  return ocObject;
}

/**
 * Run `fn` inside a disposal scope. Every object passed to `track()` during
 * `fn` is `.delete()`d on exit — except objects reachable from the value
 * `fn` returns (a BrepShape, or an array of them), which survive.
 * @param {() => (Promise<any>|any)} fn
 * @returns {Promise<any>} whatever `fn` returns
 */
export async function withScope(fn) {
  const scope = [];
  _scopeStack.push(scope);
  let result;
  try {
    result = await fn();
  } finally {
    _scopeStack.pop();
    const survivors = new Set();
    const keep = Array.isArray(result) ? result : [result];
    for (const r of keep) {
      if (r instanceof BrepShape && r.shape) survivors.add(r.shape);
    }
    for (const obj of scope) {
      if (survivors.has(obj)) continue;
      try { if (obj && obj.delete) obj.delete(); } catch { /* already gone */ }
    }
  }
  return result;
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepShape.js
git commit -m "feat(kernel): add BrepShape wrapper + withScope disposal arena"
```

---

## Task 5: makeBox primitive

**Files:**
- Create: `frontend/src/kernel/brep/BrepPrimitives.js`

> Reference `docs/superpowers/notes/kernel-api-A0.md` (Task 3) for the verified box-constructor binding name. The code below uses `BRepPrimAPI_MakeBox_2` (the three-double overload in opencascade.js 2.0 beta). If the recon note shows a different suffix, use that.

- [ ] **Step 1: Create BrepPrimitives with makeBox**

Create `frontend/src/kernel/brep/BrepPrimitives.js`:
```js
/**
 * ArchDisc Kernel — B-rep primitive solids (the kernel-backed).
 * A0 scope: box only. A1 adds cylinder/sphere/cone/torus.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Make an axis-aligned box solid with one corner at the origin.
 * @param {number} dx  size along X (mm)
 * @param {number} dy  size along Y (mm)
 * @param {number} dz  size along Z (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeBox(dx, dy, dz) {
  if (!(dx > 0 && dy > 0 && dz > 0)) {
    throw new Error(`makeBox: dimensions must be positive (got ${dx}, ${dy}, ${dz})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz));
    if (!maker.IsDone()) throw new Error('makeBox: the kernel BRepPrimAPI_MakeBox failed');
    const shape = maker.Shape(); // survives — owned by the returned BrepShape
    return new BrepShape(shape, { op: 'makeBox', params: { dx, dy, dz } });
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepPrimitives.js
git commit -m "feat(kernel): add the kernel makeBox primitive"
```

---

## Task 6: BrepTessellate — shape to triangle data

**Files:**
- Create: `frontend/src/kernel/brep/BrepTessellate.js`

> The the kernel triangulation read API is version-sensitive. Reconcile the accessor names (`Triangulation`, `Node`, `Triangle`, `Value`, `Orientation`) against `docs/superpowers/notes/kernel-api-A0.md`. The code below targets opencascade.js 2.0 beta. If `BRep_Tool.Triangulation` arity differs, adjust the call.

- [ ] **Step 1: Create BrepTessellate**

Create `frontend/src/kernel/brep/BrepTessellate.js`:
```js
/**
 * ArchDisc Kernel — tessellate an kernel shape into plain triangle data
 * ready for a Three.js BufferGeometry. Positions are in mm.
 */

import { getOCCT } from './occtKernel.js';
import { track } from './BrepShape.js';

/**
 * Tessellate a BrepShape.
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {number} [deflection]  linear chord deviation (mm); smaller = finer
 * @returns {Promise<{positions:Float32Array,normals:Float32Array,indices:Uint32Array}>}
 */
export async function tessellate(brepShape, deflection = 0.1) {
  if (brepShape._triangulation) return brepShape._triangulation;
  const oc = await getOCCT();
  const shape = brepShape.shape;

  // Generate the mesh on the shape's faces.
  track(new oc.BRepMesh_IncrementalMesh_2(shape, deflection, false, 0.5, false));

  const positions = [];
  const indices = [];
  const explorer = track(
    new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE),
  );
  for (; explorer.More(); explorer.Next()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const loc = track(new oc.TopLoc_Location_1());
    const triHandle = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (triHandle.IsNull()) { continue; }
    const tri = triHandle.get();
    const trsf = loc.Transformation();
    const base = positions.length / 3;
    const nbNodes = tri.NbNodes();
    for (let i = 1; i <= nbNodes; i++) {
      const p = tri.Node(i).Transformed(trsf);
      positions.push(p.X(), p.Y(), p.Z());
    }
    const reversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const nbTri = tri.NbTriangles();
    for (let i = 1; i <= nbTri; i++) {
      const t = tri.Triangle(i);
      const a = base + t.Value(1) - 1;
      const b = base + t.Value(2) - 1;
      const c = base + t.Value(3) - 1;
      if (reversed) { indices.push(a, c, b); } else { indices.push(a, b, c); }
    }
  }

  const posArr = new Float32Array(positions);
  const idxArr = new Uint32Array(indices);
  const normals = computeNormals(posArr, idxArr);
  const result = { positions: posArr, normals, indices: idxArr };
  brepShape._triangulation = result;
  return result;
}

/** Per-vertex normals from face geometry (averaged). */
function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const idx of [ia, ib, ic]) {
      normals[idx] += nx; normals[idx + 1] += ny; normals[idx + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepTessellate.js
git commit -m "feat(kernel): add kernel shape tessellation"
```

---

## Task 7: BrepMeasure — geometry metrics

**Files:**
- Create: `frontend/src/kernel/brep/BrepMeasure.js`

> Reconcile `GProp_GProps`, `BRepGProp.VolumeProperties`/`SurfaceProperties`, and `TopExp_Explorer` names against `docs/superpowers/notes/kernel-api-A0.md`.

- [ ] **Step 1: Create BrepMeasure**

Create `frontend/src/kernel/brep/BrepMeasure.js`:
```js
/**
 * ArchDisc Kernel — geometry measurement for kernel shapes. Drives the
 * numeric assertions in e2e specs. All values in mm / mm² / mm³.
 */

import { getOCCT } from './occtKernel.js';
import { withScope, track } from './BrepShape.js';

/** Solid volume (mm³). */
export async function volume(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(brepShape.shape, props, false, false, false);
    return props.Mass();
  });
}

/** Total surface area (mm²). */
export async function area(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.SurfaceProperties_1(brepShape.shape, props, false, false);
    return props.Mass();
  });
}

/**
 * Count UNIQUE sub-shapes of a given TopAbs kind. A raw TopExp_Explorer
 * DOUBLE-COUNTS shared sub-shapes: a box edge is visited once per adjacent
 * face, so TopAbs_EDGE yields 24 hits for 12 real edges (empirically
 * verified — see docs/superpowers/notes/kernel-api-A0.md, Item 3). We
 * deduplicate with TopoDS_Shape.IsSame(). (A1+ may switch to
 * TopExp.MapShapes for O(n) counting on large shapes; IsSame dedup is
 * sufficient at A0 scope — box only.)
 */
async function countSubShapes(brepShape, kind) {
  const oc = await getOCCT();
  return withScope(() => {
    const ex = track(new oc.TopExp_Explorer_2(
      brepShape.shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    const unique = [];
    for (; ex.More(); ex.Next()) {
      const cur = track(ex.Current());
      if (!unique.some((s) => s.IsSame(cur))) unique.push(cur);
    }
    return unique.length;
  });
}

/** Number of faces. */
export async function faceCount(brepShape) {
  const oc = await getOCCT();
  return countSubShapes(brepShape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
}

/** Number of edges. */
export async function edgeCount(brepShape) {
  const oc = await getOCCT();
  return countSubShapes(brepShape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
}

/** Axis-aligned bounding box: {min:[x,y,z], max:[x,y,z]} in mm. */
export async function boundingBox(brepShape) {
  const oc = await getOCCT();
  return withScope(() => {
    const bbox = track(new oc.Bnd_Box_1());
    oc.BRepBndLib.Add(brepShape.shape, bbox, false);
    const min = bbox.CornerMin();
    const max = bbox.CornerMax();
    return {
      min: [min.X(), min.Y(), min.Z()],
      max: [max.X(), max.Y(), max.Z()],
    };
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepMeasure.js
git commit -m "feat(kernel): add the kernel geometry measurement"
```

---

## Task 8: brepToMesh + ArchDiscKernel facade + extend the hook

**Files:**
- Create: `frontend/src/kernel/brep/brepToMesh.js`
- Create: `frontend/src/kernel/brep/ArchDiscKernel.js`
- Modify: `frontend/src/kernel/brep/index.js`
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Create brepToMesh**

Create `frontend/src/kernel/brep/brepToMesh.js`:
```js
/**
 * ArchDisc Kernel — convert a tessellated BrepShape into a THREE.Mesh.
 * Geometry is in mm; the caller wraps the mesh in a 0.001-scaled group.
 */

import * as THREE from 'three';
import { tessellate } from './BrepTessellate.js';

/**
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts] { color, deflection }
 * @returns {Promise<THREE.Mesh>}
 */
export async function brepToMesh(brepShape, opts = {}) {
  const { color = 0x9aa3ad, deflection = 0.1 } = opts;
  const { positions, normals, indices } = await tessellate(brepShape, deflection);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshStandardMaterial({
    color, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.brepShapeId = brepShape.id;
  return mesh;
}
```

- [ ] **Step 2: Create the ArchDiscKernel facade**

Create `frontend/src/kernel/brep/ArchDiscKernel.js`:
```js
/**
 * ArchDisc Kernel — the unified facade. The single entry point for exact
 * B-rep geometry. the kernel internals never leak past this module. A0 scope:
 * makeBox + measurement + tessellation. A1+ extend `brep`.
 */

import { getOCCT } from './occtKernel.js';
import { makeBox } from './BrepPrimitives.js';
import { tessellate } from './BrepTessellate.js';
import { brepToMesh } from './brepToMesh.js';
import * as Measure from './BrepMeasure.js';

export const ArchDiscKernel = {
  /** Ensure the kernel WASM module is loaded. */
  init: getOCCT,
  /** Exact B-rep operations. */
  brep: {
    makeBox,
    tessellate,
    brepToMesh,
    volume: Measure.volume,
    area: Measure.area,
    faceCount: Measure.faceCount,
    edgeCount: Measure.edgeCount,
    boundingBox: Measure.boundingBox,
    /** All metrics in one call — convenient for e2e assertions. */
    async measure(brepShape) {
      return {
        volume: await Measure.volume(brepShape),
        area: await Measure.area(brepShape),
        faceCount: await Measure.faceCount(brepShape),
        edgeCount: await Measure.edgeCount(brepShape),
        boundingBox: await Measure.boundingBox(brepShape),
      };
    },
  },
};
```

- [ ] **Step 3: Update the barrel export**

Replace the contents of `frontend/src/kernel/brep/index.js`:
```js
/** ArchDisc Kernel — B-rep (the kernel) subtree barrel export. */
export { getOCCT, _reset } from './occtKernel.js';
export { BrepShape, withScope, track } from './BrepShape.js';
export { makeBox } from './BrepPrimitives.js';
export { tessellate } from './BrepTessellate.js';
export { brepToMesh } from './brepToMesh.js';
export { ArchDiscKernel } from './ArchDiscKernel.js';
```

- [ ] **Step 4: Extend the `window.__archdiscKernel` hook to render a box**

In `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`, replace the import added in Task 3 Step 1 with:
```js
import { getOCCT } from '../../kernel/brep/occtKernel.js';
import { ArchDiscKernel } from '../../kernel/brep/ArchDiscKernel.js';
import * as THREE from 'three';
```
(If `THREE` is already imported in this file, do not add it twice.)

Then replace the `window.__archdiscKernel` `useEffect` from Task 3 with this version (it must be keyed on `viewport` so it has the scene):
```js
    // Expose the the kernel-backed ArchDisc Kernel so headed Electron e2e specs
    // (and the B-rep Lab panel) can drive exact B-rep geometry and see it
    // render in the live viewport.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const scene = viewport?.scene;
        if (!scene) return undefined;
        let lastBrepGroup = null;
        window.__archdiscKernel = {
            getOCCT,
            kernel: ArchDiscKernel,
            /** Build a box, render it, return its metrics. */
            renderBox: async (dx, dy, dz) => {
                const shape = await ArchDiscKernel.brep.makeBox(dx, dy, dz);
                const mesh = await ArchDiscKernel.brep.brepToMesh(shape);
                if (lastBrepGroup) { scene.remove(lastBrepGroup); lastBrepGroup = null; }
                const group = new THREE.Group();
                group.scale.set(0.001, 0.001, 0.001);
                group.add(mesh);
                group.userData.pickable = true;
                group.userData.generatedModel = true;
                scene.add(group);
                group.updateMatrixWorld(true);
                lastBrepGroup = group;
                if (typeof window.__archdiscFocusOnObject === 'function') {
                    window.__archdiscFocusOnObject(group);
                }
                const metrics = await ArchDiscKernel.brep.measure(shape);
                window.__lastBrepMetrics = metrics;
                window.__lastBrepShape = shape;
                return metrics;
            },
        };
        return () => { delete window.__archdiscKernel; };
    }, [viewport]);
```

- [ ] **Step 5: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -8
```
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/kernel/brep/ frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(kernel): add ArchDiscKernel facade + box render via __archdiscKernel"
```

---

## Task 9: B-rep Lab UI panel

**Files:**
- Create: `frontend/src/components/BrepLabPanel.jsx`
- Create: `frontend/src/components/BrepLabPanel.css`
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Create the panel component**

Create `frontend/src/components/BrepLabPanel.jsx`:
```jsx
import React, { useState } from 'react';
import './BrepLabPanel.css';

/**
 * B-rep Lab — minimal panel that drives the the kernel-backed ArchDisc Kernel.
 * A0 scope: a single "Box" button. A1+ add a button per operation.
 */
export default function BrepLabPanel() {
  const [status, setStatus] = useState('B-rep kernel ready');
  const [busy, setBusy] = useState(false);

  const makeBox = async () => {
    if (busy || typeof window === 'undefined' || !window.__archdiscKernel) return;
    setBusy(true);
    setStatus('Building box…');
    try {
      const metrics = await window.__archdiscKernel.renderBox(10, 10, 10);
      setStatus(`Box: vol ${metrics.volume.toFixed(0)} mm³, ${metrics.faceCount} faces`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brep-lab-panel" data-testid="brep-lab-panel">
      <div className="brep-lab-title">B-rep Lab (the kernel)</div>
      <button
        type="button"
        className="brep-lab-btn"
        data-testid="brep-lab-box"
        disabled={busy}
        onClick={makeBox}
      >
        Box 10×10×10
      </button>
      <div className="brep-lab-status" data-testid="brep-lab-status">{status}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create the panel styles**

Create `frontend/src/components/BrepLabPanel.css`:
```css
.brep-lab-panel {
  position: absolute;
  top: 120px;
  right: 16px;
  z-index: 30;
  width: 200px;
  padding: 10px;
  background: rgba(28, 32, 38, 0.94);
  border: 1px solid #3a4350;
  border-radius: 6px;
  color: #d6dbe2;
  font-size: 12px;
}
.brep-lab-title { font-weight: 600; margin-bottom: 8px; }
.brep-lab-btn {
  width: 100%;
  padding: 6px 8px;
  background: #2f6df0;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.brep-lab-btn:disabled { opacity: 0.5; cursor: default; }
.brep-lab-status { margin-top: 8px; color: #9aa3ad; }
```

- [ ] **Step 3: Mount the panel in the workbench**

In `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`, add the import next to the other component imports:
```js
import BrepLabPanel from '../../components/BrepLabPanel.jsx';
```
Then render it inside the workbench's main viewport container. Find the JSX around line 952 where `scene={... window.__three_scene ...}` is passed to a child; add `<BrepLabPanel />` as a sibling element within the same parent container `<div>` that holds the viewport, immediately after that child component's closing tag.

- [ ] **Step 4: Verify it compiles and the panel renders**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BrepLabPanel.jsx frontend/src/components/BrepLabPanel.css frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(ui): add minimal B-rep Lab panel"
```

---

## Task 10: Phase A0 gate — full headed Electron e2e

**Files:**
- Create: `e2e/brep-foundation-electron.spec.js`

- [ ] **Step 1: Write the A0 gate spec**

Create `e2e/brep-foundation-electron.spec.js`:
```js
import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SHOT = path.resolve(__dirname, 'screenshots');

test('A0 gate: the kernel box builds, measures, renders, and leak-guards in the Electron app', async () => {
  fs.mkdirSync(SHOT, { recursive: true });
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });

  // ── Drive the op via the real B-rep Lab button (UI wiring check) ──
  const boxBtn = win.locator('[data-testid="brep-lab-box"]');
  await expect(boxBtn).toBeVisible({ timeout: 30000 });
  await boxBtn.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await win.waitForFunction(() => !!window.__lastBrepMetrics, null, { timeout: 60000 });

  // ── Assert geometry metrics: 10mm box -> volume ~1000 mm3, 6 faces ──
  const metrics = await win.evaluate(() => window.__lastBrepMetrics);
  expect(metrics.volume).toBeGreaterThan(990);
  expect(metrics.volume).toBeLessThan(1010);
  expect(metrics.faceCount).toBe(6);
  expect(metrics.edgeCount).toBe(12);
  console.log(`  A0 box metrics: vol ${metrics.volume.toFixed(2)} mm3, ` +
    `${metrics.faceCount} faces, ${metrics.edgeCount} edges`);

  // ── Assert the viewport is non-blank (geometry actually rendered) ──
  await win.waitForTimeout(500);
  const shot = await win.locator('canvas').first().screenshot({
    path: path.join(SHOT, 'brep-a0-box.png'),
  });
  expect(shot.length).toBeGreaterThan(2000); // a blank canvas PNG is tiny

  // ── Leak guard: build the box 20x and assert the WASM heap is bounded ──
  const heap = await win.evaluate(async () => {
    const before = (await window.__archdiscKernel.getOCCT()).HEAPU8.length;
    for (let i = 0; i < 20; i++) {
      await window.__archdiscKernel.kernel.brep.makeBox(5, 5, 5)
        .then(s => s.dispose());
    }
    const after = (await window.__archdiscKernel.getOCCT()).HEAPU8.length;
    return { before, after };
  });
  // Emscripten heap may grow once, but must not grow per-iteration.
  expect(heap.after - heap.before).toBeLessThan(8 * 1024 * 1024);
  console.log(`  Leak guard: heap ${heap.before} -> ${heap.after}`);

  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 2: Build and run the gate spec — expect FAIL first if run before Tasks 8–9, else PASS**

Run:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-foundation-electron.spec.js --project=chromium
```
Expected: PASS — box builds, metrics correct, canvas non-blank, heap bounded, zero page errors. If the leak guard fails, check that `withScope`/`dispose` free the maker and shape. If metrics are wrong, reconcile the kernel API names against `docs/superpowers/notes/kernel-api-A0.md`. **Do not mark A0 done until this is green.**

- [ ] **Step 3: Regression check — existing e2e suite still passes**

Run:
```bash
./node_modules/.bin/playwright test --project=chromium 2>&1 | tail -15
```
Expected: the pre-existing ~388 tests still pass (no regression — the kernel is purely additive).

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-foundation-electron.spec.js e2e/screenshots/brep-a0-box.png
git commit -m "test(kernel): A0 gate — headed Electron e2e for the kernel box pipeline"
```

---

## Self-review notes

- **Spec coverage (A0 scope of §6):** the kernel loaded (Tasks 1–3) ✓; `kernel/brep/` facade + lifecycle/`withScope` (Tasks 4, 8) ✓; tessellation (Task 6) ✓; viewport render (Task 8) ✓; B-rep Lab panel shell (Task 9) ✓; `window.__archdiscKernel` hook (Tasks 3, 8) ✓; `BrepMeasure` (Task 7) ✓; headed Electron e2e + leak guard + regression (Tasks 3, 10) ✓.
- **Deferred to A1+ (correctly out of this plan):** cylinder/sphere/cone/torus, booleans, extrude/revolve, fillet/chamfer, STEP I/O, and Phases A2–A5. Each gets its own plan written after the preceding phase is verified green.
- **opencascade.js API risk:** handled by the Task 3 reconnaissance + `docs/superpowers/notes/kernel-api-A0.md`; Tasks 5–7 explicitly reconcile against it.
- **Type consistency:** `BrepShape`, `withScope`, `track` (Task 4) are used unchanged in Tasks 5–8; `ArchDiscKernel.brep.*` method names match between Task 8's facade and Task 10's spec; `renderBox`, `__lastBrepMetrics`, `data-testid="brep-lab-box"` match between Tasks 8, 9, 10.
