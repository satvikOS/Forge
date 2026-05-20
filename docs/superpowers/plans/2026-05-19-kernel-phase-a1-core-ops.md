# Kernel Phase A1 — Core Exact-B-rep Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the core exact-B-rep operation set to the ArchDisc Kernel — primitives (cylinder/sphere/cone/torus), exact booleans (fuse/cut/common), extrude, revolve, exact fillet & chamfer, and native STEP import/export — each verified by a headed Electron e2e test.

**Architecture:** Extends the `frontend/src/kernel/brep/` subtree built in Phase A0. Every operation is an the kernel call sequence wrapped in the `withScope()` disposal arena, returning a `BrepShape`. All ops are exposed through the `ArchDiscKernel` facade and the `window.__archdiscKernel` hook, with a B-rep Lab button each. Phase A1 leads with an empirical kernel API reconnaissance task because A1's bindings (booleans, prism, revol, fillet, STEP via the Emscripten virtual filesystem) are not yet verified.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (kernel WASM), Vite 7, React 19, Three.js 0.181, Electron 42, Playwright 1.59 (headed, `_electron` launch).

**Reference spec:** `docs/superpowers/specs/2026-05-18-kernel-integration-foundation-design.md` (§3.1, §6 Phase A1).

---

## Important context for the implementer

- **Read first:** the spec above, the Phase A0 plan `docs/superpowers/plans/2026-05-18-kernel-phase-a0-integration-foundation.md`, and the verified A0 API note `docs/superpowers/notes/kernel-api-A0.md`.
- **Phase A0 is done.** `frontend/src/kernel/brep/` already contains: `occtKernel.js` (`getOCCT()`), `BrepShape.js` (`BrepShape`, `withScope`, `track`), `BrepPrimitives.js` (`makeBox`), `BrepTessellate.js` (`tessellate`), `BrepMeasure.js` (`volume`, `area`, `faceCount`, `edgeCount`, `boundingBox`), `brepToMesh.js`, `ArchDiscKernel.js` (facade), `index.js`. The B-rep Lab panel is `frontend/src/components/BrepLabPanel.jsx`; the hook is registered in `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`.
- **Established patterns to follow exactly:**
  - Every op: `const oc = await getOCCT(); return withScope(() => { ... });`
  - `track()` EVERY transient the kernel object (builders, sub-shapes, points, vectors, handles). The arena frees them on scope exit; only the shape inside the returned `BrepShape` survives.
  - kernel Embind objects leak the WASM heap unless freed — this is non-negotiable.
  - Throw a descriptive `Error` on the kernel failure (`IsNull()` shape, builder not done) — never return a silent empty shape.
- **opencascade.js binding convention:** overloaded C++ constructors/methods get `_1`, `_2`, … suffixes in declaration order (`_1` is usually the no-arg/simplest). Exact suffixes are version-specific — **Task 1 verifies them all empirically.**
- **e2e:** every op is verified by a headed Playwright test launching the genuine Electron app (`_electron.launch(['electron/main.js'])`). The app loads `frontend/dist/index.html`, so `cd frontend && npx vite build` runs before each spec. Run Playwright via `./node_modules/.bin/playwright` (1.59), never `npx`. Spec files must not import from `node:*` — use bare `import fs from 'fs'`.
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepPrimitives.js` | Modify — add `makeCylinder`, `makeSphere`, `makeCone`, `makeTorus` |
| `frontend/src/kernel/brep/BrepBoolean.js` | Create — `fuse`, `cut`, `common` |
| `frontend/src/kernel/brep/BrepFeatures.js` | Create — `extrudeRect`, `revolveRect`, `filletAll`, `chamferAll` |
| `frontend/src/kernel/brep/BrepStep.js` | Create — `exportStep`, `importStep` |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose all A1 ops on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel exports for the new modules |
| `frontend/src/components/BrepLabPanel.jsx` | Modify — a button per A1 op |
| `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx` | Modify — extend `window.__archdiscKernel` with A1 op drivers |
| `docs/superpowers/notes/kernel-api-A1.md` | Create (Task 1) — verified kernel API for A1 ops |
| `e2e/brep-a1-recon-electron.spec.js` | Create (Task 1) — empirical recon spec |
| `e2e/brep-primitives-electron.spec.js` | Create (Task 8) — primitives e2e |
| `e2e/brep-boolean-electron.spec.js` | Create (Task 8) — booleans e2e |
| `e2e/brep-features-electron.spec.js` | Create (Task 8) — extrude/revolve/fillet/chamfer e2e |
| `e2e/brep-step-electron.spec.js` | Create (Task 8) — STEP round-trip e2e |

---

## Task 1: A1 kernel API reconnaissance (de-risk)

**Files:**
- Create: `e2e/brep-a1-recon-electron.spec.js`
- Create: `docs/superpowers/notes/kernel-api-A1.md`

This task empirically verifies — inside the real Electron app — the exact opencascade.js call sequence for every A1 operation, before any kernel code is written. It mirrors the A0 recon (`e2e/brep-occt-load-electron.spec.js`).

- [ ] **Step 1: Write the recon spec**

Create `e2e/brep-a1-recon-electron.spec.js`. It launches the Electron app, gets `oc` via `window.__archdiscKernel.getOCCT()`, and inside `win.evaluate(...)` empirically determines, for each item below, the exact working call. For every attempt: wrap in try/catch, record the error on failure, try the alternative. `.delete()` every the kernel object created (no leaks in the recon). Write the structured findings to `docs/superpowers/notes/kernel-api-A1-recon.json` and `console.log` them. The spec must `expect(...)` that each item's `working` flag is true and PASS green.

Items to verify (build each, then measure with the A0-verified `GProp`/`TopExp` calls to confirm it is a real solid):

1. **Cylinder** — which `oc.BRepPrimAPI_MakeCylinder_N(radius, height)` builds a valid cylinder solid. Confirm volume ≈ π·r²·h.
2. **Sphere** — `oc.BRepPrimAPI_MakeSphere_N(radius)`. Confirm volume ≈ 4/3·π·r³.
3. **Cone** — `oc.BRepPrimAPI_MakeCone_N(r1, r2, height)`. Confirm a non-zero volume.
4. **Torus** — `oc.BRepPrimAPI_MakeTorus_N(majorR, minorR)`. Confirm a non-zero volume.
5. **Boolean fuse** — build two overlapping boxes; find the `oc.BRepAlgoAPI_Fuse_N(s1, s2)` overload; call `.Build()` if required, check `.IsDone()`, get `.Shape()`. Confirm the fused volume is less than the sum (overlap removed).
6. **Boolean cut** — `oc.BRepAlgoAPI_Cut_N(s1, s2)`. Confirm volume = s1 minus the overlap.
7. **Boolean common** — `oc.BRepAlgoAPI_Common_N(s1, s2)`. Confirm volume = the overlap.
8. **Rectangle face → extrude** — verify the chain to build a planar rectangular face and extrude it: making `gp_Pnt`, `BRepBuilderAPI_MakeEdge`, `BRepBuilderAPI_MakeWire` (with `.Add(...)`), `BRepBuilderAPI_MakeFace` (from the wire), then `BRepPrimAPI_MakePrism` with a `gp_Vec`. Record the exact constructor/method suffixes for every step. Confirm the extruded solid's volume = width·height·depth.
9. **Revolve** — build a rectangular face offset from the Z axis (in the XZ plane), then `BRepPrimAPI_MakeRevol` around a `gp_Ax1` (Z axis) by an angle. Record the `gp_Ax1`/`gp_Dir`/`gp_Pnt` construction and the `MakeRevol` suffix. Confirm a non-zero volume.
10. **Fillet** — `BRepFilletAPI_MakeFillet(shape)`; for each edge from a `TopExp_Explorer`, call the `.Add(radius, edge)` method (find its exact name/suffix); `.Build()`; `.IsDone()`; `.Shape()`. Fillet all 12 edges of a 10mm box with r=1; confirm the volume decreased vs the box and is still positive.
11. **Chamfer** — `BRepFilletAPI_MakeChamfer(shape)`; `.Add(distance, edge)`; build. Chamfer all edges of a box; confirm volume decreased.
12. **STEP export** — verify writing a shape to STEP text. `STEPControl_Writer`; `.Transfer(shape, mode)` — find the `STEPControl_StepModelType` value for "as-is"/manifold-solid; `.Write(filename)` writes to the Emscripten virtual FS; then read the file back via `oc.FS.readFile(filename, { encoding: 'utf8' })`. Record the exact calls. Confirm the text starts with `ISO-10303-21` and contains `STEP`.
13. **STEP import** — write a known STEP text into the Emscripten FS via `oc.FS.writeFile(name, text)`, then `STEPControl_Reader`; `.ReadFile(name)`; `.TransferRoots()`; `.OneShape()`. Confirm the resulting shape has a non-zero volume. (Use the STEP text produced by item 12 as the input.)

For the Emscripten FS: opencascade.js exposes the FS as `oc.FS`. If `oc.FS.readFile`/`writeFile` are not present, introspect (`Object.keys(oc).filter(k => /FS/.test(k))`) and record the correct access path.

- [ ] **Step 2: Build and run the recon spec; iterate until GREEN**

Run:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-a1-recon-electron.spec.js --project=chromium
```
Iterate (adjust suffixes, read errors) until every item is confirmed and the spec passes. If an item cannot be made to work after genuine effort, record it as `NOT CONFIRMED` with the error — do not fake it.

- [ ] **Step 3: Write the verified API note**

Create `docs/superpowers/notes/kernel-api-A1.md`. For each of items 1–13, give the EXACT verified, copy-pasteable JavaScript call sequence (constructor suffixes, method names, enum access paths). Mark it verified against `opencascade.js@2.0.0-beta.b5ff984`. Tasks 2–6 reference this note.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-a1-recon-electron.spec.js docs/superpowers/notes/kernel-api-A1.md docs/superpowers/notes/kernel-api-A1-recon.json
git commit -m "test(kernel): empirical kernel API recon for Phase A1 ops"
```

---

## Task 2: Primitives — cylinder, sphere, cone, torus

**Files:**
- Modify: `frontend/src/kernel/brep/BrepPrimitives.js`

> Reference `docs/superpowers/notes/kernel-api-A1.md` Items 1–4 for the verified constructor suffixes. The code below uses the most likely opencascade.js 2.0 suffixes — reconcile each against the note and adjust if it differs.

- [ ] **Step 1: Add the four primitives**

Append to `frontend/src/kernel/brep/BrepPrimitives.js` (after the existing `makeBox`):
```js
/**
 * Make a cylinder solid (axis = +Z, base at origin).
 * @param {number} radius  (mm)
 * @param {number} height  (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeCylinder(radius, height) {
  if (!(radius > 0 && height > 0)) {
    throw new Error(`makeCylinder: radius and height must be positive (got ${radius}, ${height})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeCylinder_1(radius, height));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeCylinder: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'makeCylinder', params: { radius, height } });
  });
}

/**
 * Make a sphere solid centred at the origin.
 * @param {number} radius  (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeSphere(radius) {
  if (!(radius > 0)) throw new Error(`makeSphere: radius must be positive (got ${radius})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeSphere_1(radius));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeSphere: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'makeSphere', params: { radius } });
  });
}

/**
 * Make a (truncated) cone solid (axis = +Z, base at origin).
 * @param {number} radius1  base radius (mm)
 * @param {number} radius2  top radius (mm); 0 for a sharp cone
 * @param {number} height   (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeCone(radius1, radius2, height) {
  if (!(radius1 >= 0 && radius2 >= 0 && height > 0) || (radius1 === 0 && radius2 === 0)) {
    throw new Error(`makeCone: invalid radii/height (got ${radius1}, ${radius2}, ${height})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeCone_1(radius1, radius2, height));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeCone: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'makeCone', params: { radius1, radius2, height } });
  });
}

/**
 * Make a torus solid (axis = +Z, centred at the origin).
 * @param {number} majorRadius  ring radius (mm)
 * @param {number} minorRadius  tube radius (mm)
 * @returns {Promise<BrepShape>}
 */
export async function makeTorus(majorRadius, minorRadius) {
  if (!(majorRadius > 0 && minorRadius > 0 && minorRadius < majorRadius)) {
    throw new Error(`makeTorus: need 0 < minorRadius < majorRadius (got ${majorRadius}, ${minorRadius})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeTorus_1(majorRadius, minorRadius));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeTorus: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'makeTorus', params: { majorRadius, minorRadius } });
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
git commit -m "feat(kernel): add cylinder/sphere/cone/torus primitives"
```

---

## Task 3: Exact booleans — fuse, cut, common

**Files:**
- Create: `frontend/src/kernel/brep/BrepBoolean.js`

> Reference `docs/superpowers/notes/kernel-api-A1.md` Items 5–7. Reconcile the `BRepAlgoAPI_Fuse/Cut/Common` constructor suffix and whether `.Build()` must be called explicitly against the verified note.

- [ ] **Step 1: Create BrepBoolean.js**

Create `frontend/src/kernel/brep/BrepBoolean.js`:
```js
/**
 * ArchDisc Kernel — exact boolean operations (the kernel BRepAlgoAPI).
 * Operate on TopoDS_Shape solids; produce exact B-rep results.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/** Shared boolean runner. `Ctor` is an the kernel BRepAlgoAPI_* class. */
async function runBoolean(opName, Ctor, a, b) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error(`${opName}: both operands must be BrepShapes with live shapes`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new Ctor(a.shape, b.shape));
    // Reconcile against kernel-api-A1.md: call .Build() only if the note says
    // the constructor does not build implicitly.
    if (typeof maker.Build === 'function' && !maker.IsDone()) {
      maker.Build(new oc.Message_ProgressRange_1());
    }
    if (!maker.IsDone()) throw new Error(`${opName}: the kernel boolean did not complete`);
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error(`${opName}: the kernel produced a null shape`);
    return new BrepShape(shape, { op: opName, parents: [a.id, b.id] });
  });
}

/** Union of two solids (a ∪ b). */
export async function fuse(a, b) {
  const oc = await getOCCT();
  return runBoolean('fuse', oc.BRepAlgoAPI_Fuse_3, a, b);
}

/** Subtraction (a − b). */
export async function cut(a, b) {
  const oc = await getOCCT();
  return runBoolean('cut', oc.BRepAlgoAPI_Cut_3, a, b);
}

/** Intersection (a ∩ b). */
export async function common(a, b) {
  const oc = await getOCCT();
  return runBoolean('common', oc.BRepAlgoAPI_Common_3, a, b);
}
```

> Note on `BRepAlgoAPI_*_3`: opencascade.js 2.0 commonly exposes the `(S1, S2)` overload as `_3` and a `(S1, S2, ProgressRange)` as `_4`. **Task 1's recon note gives the verified suffix — use it.** If the verified `(S1,S2)` overload builds implicitly, the `.Build()` branch is simply skipped (the `!maker.IsDone()` guard handles that). If `Message_ProgressRange_1` is not the right progress type, use whatever the note recorded.

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepBoolean.js
git commit -m "feat(kernel): add exact boolean operations (fuse/cut/common)"
```

---

## Task 4: Features — extrude & revolve

**Files:**
- Create: `frontend/src/kernel/brep/BrepFeatures.js`

> Reference `docs/superpowers/notes/kernel-api-A1.md` Items 8–9 for the verified face-building and prism/revol chains. Reconcile every suffix.

- [ ] **Step 1: Create BrepFeatures.js with a face helper, extrudeRect and revolveRect**

Create `frontend/src/kernel/brep/BrepFeatures.js`:
```js
/**
 * ArchDisc Kernel — feature operations (the kernel): extrude, revolve, fillet,
 * chamfer. A1 extrude/revolve operate on an internally-built rectangular
 * profile; sketch-driven profiles are a later sub-project.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

/**
 * Build a planar rectangular face in the XY plane (z=0), corner at origin.
 * Returns the the kernel TopoDS_Face (already track()ed in the current scope).
 * @param {object} oc
 * @param {number} w  width  (mm, +X)
 * @param {number} h  height (mm, +Y)
 */
function buildRectFaceXY(oc, w, h) {
  const p0 = track(new oc.gp_Pnt_3(0, 0, 0));
  const p1 = track(new oc.gp_Pnt_3(w, 0, 0));
  const p2 = track(new oc.gp_Pnt_3(w, h, 0));
  const p3 = track(new oc.gp_Pnt_3(0, h, 0));
  const e0 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)).Edge();
  const e1 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)).Edge();
  const e2 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)).Edge();
  const e3 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)).Edge();
  const wireMaker = track(new oc.BRepBuilderAPI_MakeWire_1());
  wireMaker.Add_1(e0); wireMaker.Add_1(e1); wireMaker.Add_1(e2); wireMaker.Add_1(e3);
  const wire = wireMaker.Wire();
  const faceMaker = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
  return faceMaker.Face();
}

/**
 * Extrude a rectangular profile into a box-like prism.
 * @param {number} w      profile width  (mm)
 * @param {number} h      profile height (mm)
 * @param {number} depth  extrusion distance along +Z (mm)
 * @returns {Promise<BrepShape>}
 */
export async function extrudeRect(w, h, depth) {
  if (!(w > 0 && h > 0 && depth > 0)) {
    throw new Error(`extrudeRect: w, h, depth must be positive (got ${w}, ${h}, ${depth})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const face = buildRectFaceXY(oc, w, h);
    const dir = track(new oc.gp_Vec_4(0, 0, depth));
    const maker = track(new oc.BRepPrimAPI_MakePrism_1(face, dir, false, true));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('extrudeRect: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'extrudeRect', params: { w, h, depth } });
  });
}

/**
 * Revolve a rectangular profile around the Z axis to make a ring/disc solid.
 * The profile sits in the XZ plane, offset from the axis by `innerR`.
 * @param {number} innerR  distance from Z axis to the profile's near edge (mm)
 * @param {number} width   profile radial width (mm, +X)
 * @param {number} height  profile height (mm, +Z)
 * @param {number} angleDeg revolution angle in degrees (e.g. 360 for a full ring)
 * @returns {Promise<BrepShape>}
 */
export async function revolveRect(innerR, width, height, angleDeg) {
  if (!(innerR >= 0 && width > 0 && height > 0 && angleDeg > 0 && angleDeg <= 360)) {
    throw new Error(`revolveRect: invalid params (got ${innerR}, ${width}, ${height}, ${angleDeg})`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Rectangular profile in the XZ plane.
    const p0 = track(new oc.gp_Pnt_3(innerR, 0, 0));
    const p1 = track(new oc.gp_Pnt_3(innerR + width, 0, 0));
    const p2 = track(new oc.gp_Pnt_3(innerR + width, 0, height));
    const p3 = track(new oc.gp_Pnt_3(innerR, 0, height));
    const e0 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)).Edge();
    const e1 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)).Edge();
    const e2 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)).Edge();
    const e3 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)).Edge();
    const wireMaker = track(new oc.BRepBuilderAPI_MakeWire_1());
    wireMaker.Add_1(e0); wireMaker.Add_1(e1); wireMaker.Add_1(e2); wireMaker.Add_1(e3);
    const face = track(new oc.BRepBuilderAPI_MakeFace_15(wireMaker.Wire(), true)).Face();
    // Z axis.
    const origin = track(new oc.gp_Pnt_3(0, 0, 0));
    const zdir = track(new oc.gp_Dir_4(0, 0, 1));
    const axis = track(new oc.gp_Ax1_2(origin, zdir));
    const angleRad = angleDeg * Math.PI / 180;
    const maker = track(new oc.BRepPrimAPI_MakeRevol_1(face, axis, angleRad, false));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('revolveRect: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'revolveRect', params: { innerR, width, height, angleDeg } });
  });
}
```

> The `gp_Pnt_3`, `gp_Vec_4`, `gp_Dir_4`, `gp_Ax1_2`, `BRepBuilderAPI_MakeEdge_3`, `BRepBuilderAPI_MakeWire_1`, `BRepBuilderAPI_MakeFace_15`, `BRepPrimAPI_MakePrism_1`, `BRepPrimAPI_MakeRevol_1` suffixes are best-guesses for opencascade.js 2.0. **Task 1's recon note (Items 8–9) gives the verified suffixes — reconcile every one and adjust.** `.Add_1` is the single-edge `Add` overload on `BRepBuilderAPI_MakeWire`; use whatever suffix the note records.

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepFeatures.js
git commit -m "feat(kernel): add extrude and revolve features"
```

---

## Task 5: Features — exact fillet & chamfer

**Files:**
- Modify: `frontend/src/kernel/brep/BrepFeatures.js`

> Reference `docs/superpowers/notes/kernel-api-A1.md` Items 10–11. Reconcile the `BRepFilletAPI_MakeFillet`/`MakeChamfer` constructor and the `.Add(...)` overload (it has several — the `(radius, edge)` / `(distance, edge)` forms) against the verified note.

- [ ] **Step 1: Add filletAll and chamferAll**

Append to `frontend/src/kernel/brep/BrepFeatures.js`:
```js
/**
 * Walk every unique edge of a shape and invoke `addEdge(edge)` once per edge.
 * (TopExp_Explorer double-counts shared edges — dedup with IsSame, the same
 * approach as BrepMeasure.countSubShapes.)
 */
function forEachUniqueEdge(oc, shape, addEdge) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
    addEdge(oc.TopoDS.Edge_1(cur));
  }
}

/**
 * Exact constant-radius fillet applied to ALL edges of a solid.
 * @param {BrepShape} brepShape
 * @param {number} radius  fillet radius (mm)
 * @returns {Promise<BrepShape>}
 */
export async function filletAll(brepShape, radius) {
  if (!brepShape || !brepShape.shape) throw new Error('filletAll: needs a BrepShape');
  if (!(radius > 0)) throw new Error(`filletAll: radius must be positive (got ${radius})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeFillet(
      brepShape.shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    forEachUniqueEdge(oc, brepShape.shape, (edge) => { maker.Add_2(radius, edge); });
    maker.Build(new oc.Message_ProgressRange_1());
    if (!maker.IsDone()) throw new Error('filletAll: the kernel fillet did not complete');
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('filletAll: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'filletAll', params: { radius }, parents: [brepShape.id] });
  });
}

/**
 * Exact chamfer applied to ALL edges of a solid.
 * @param {BrepShape} brepShape
 * @param {number} distance  chamfer setback (mm)
 * @returns {Promise<BrepShape>}
 */
export async function chamferAll(brepShape, distance) {
  if (!brepShape || !brepShape.shape) throw new Error('chamferAll: needs a BrepShape');
  if (!(distance > 0)) throw new Error(`chamferAll: distance must be positive (got ${distance})`);
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepFilletAPI_MakeChamfer(brepShape.shape));
    forEachUniqueEdge(oc, brepShape.shape, (edge) => { maker.Add_2(distance, edge); });
    maker.Build(new oc.Message_ProgressRange_1());
    if (!maker.IsDone()) throw new Error('chamferAll: the kernel chamfer did not complete');
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('chamferAll: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'chamferAll', params: { distance }, parents: [brepShape.id] });
  });
}
```

> `BRepFilletAPI_MakeFillet` constructor: opencascade.js may expose `(shape)` and `(shape, FilletShape)` overloads as `BRepFilletAPI_MakeFillet` / `_1` / `_2`. `Add_2` is the guessed `(radius, edge)` overload. The `ChFi3d_FilletShape.ChFi3d_Rational` enum and `Message_ProgressRange_1` may differ. **Task 1's recon note (Items 10–11) is authoritative — reconcile every name.** `BRepFilletAPI_MakeChamfer.Add` `(distance, edge)` likewise.

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepFeatures.js
git commit -m "feat(kernel): add exact fillet and chamfer"
```

---

## Task 6: Native STEP import & export

**Files:**
- Create: `frontend/src/kernel/brep/BrepStep.js`

> Reference `docs/superpowers/notes/kernel-api-A1.md` Items 12–13. The Emscripten virtual-FS access (`oc.FS.readFile`/`writeFile`) and the `STEPControl_StepModelType` value MUST match the verified note.

- [ ] **Step 1: Create BrepStep.js**

Create `frontend/src/kernel/brep/BrepStep.js` with this content:
```js
/**
 * ArchDisc Kernel — native STEP I/O via ArchDisc Kernel (STEPControl_*).
 * STEP read/write goes through the Emscripten virtual filesystem (oc.FS).
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

const STEP_TMP = '/archdisc-step-tmp.step';

/**
 * Export a BrepShape to STEP text (ISO-10303-21).
 * @param {BrepShape} brepShape
 * @returns {Promise<string>} the STEP file contents
 */
export async function exportStep(brepShape) {
  if (!brepShape || !brepShape.shape) throw new Error('exportStep: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    const writer = track(new oc.STEPControl_Writer_1());
    // STEPControl_AsIs exports the shape in its native representation.
    const status = writer.Transfer(
      brepShape.shape, oc.STEPControl_StepModelType.STEPControl_AsIs,
      true, new oc.Message_ProgressRange_1());
    // IFSelect_RetDone is the success status.
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`exportStep: the kernel transfer failed (status ${status})`);
    }
    writer.Write(STEP_TMP);
    const text = oc.FS.readFile(STEP_TMP, { encoding: 'utf8' });
    try { oc.FS.unlink(STEP_TMP); } catch { /* fine */ }
    if (!text || !text.includes('ISO-10303-21')) {
      throw new Error('exportStep: produced text is not valid STEP');
    }
    return text;
  });
}

/**
 * Import a STEP text into a BrepShape.
 * @param {string} stepText  STEP file contents
 * @returns {Promise<BrepShape>}
 */
export async function importStep(stepText) {
  if (typeof stepText !== 'string' || !stepText.includes('ISO-10303-21')) {
    throw new Error('importStep: input is not STEP text');
  }
  const oc = await getOCCT();
  return withScope(() => {
    oc.FS.writeFile(STEP_TMP, stepText);
    const reader = track(new oc.STEPControl_Reader_1());
    const readStatus = reader.ReadFile(STEP_TMP);
    if (readStatus !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error(`importStep: the kernel ReadFile failed (status ${readStatus})`);
    }
    reader.TransferRoots(new oc.Message_ProgressRange_1());
    const shape = reader.OneShape();
    try { oc.FS.unlink(STEP_TMP); } catch { /* fine */ }
    if (shape.IsNull()) throw new Error('importStep: the kernel produced a null shape');
    return new BrepShape(shape, { op: 'importStep' });
  });
}
```

> `STEPControl_Writer_1`, `STEPControl_Reader_1`, `STEPControl_StepModelType.STEPControl_AsIs`, `IFSelect_ReturnStatus.IFSelect_RetDone`, the `Transfer`/`ReadFile`/`TransferRoots` arities, and `oc.FS.readFile/writeFile/unlink` are all best-guesses. **Task 1's recon note (Items 12–13) is authoritative — reconcile every one.**

- [ ] **Step 2: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepStep.js
git commit -m "feat(kernel): add native STEP import/export"
```

---

## Task 7: Facade, barrel, B-rep Lab UI & hook wiring

**Files:**
- Modify: `frontend/src/kernel/brep/index.js`
- Modify: `frontend/src/kernel/brep/ArchDiscKernel.js`
- Modify: `frontend/src/components/BrepLabPanel.jsx`
- Modify: `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Update the barrel export**

Replace the contents of `frontend/src/kernel/brep/index.js`:
```js
/** ArchDisc Kernel — B-rep (the kernel) subtree barrel export. */
export { getOCCT, _reset } from './occtKernel.js';
export { BrepShape, withScope, track } from './BrepShape.js';
export {
  makeBox, makeCylinder, makeSphere, makeCone, makeTorus,
} from './BrepPrimitives.js';
export { fuse, cut, common } from './BrepBoolean.js';
export { extrudeRect, revolveRect, filletAll, chamferAll } from './BrepFeatures.js';
export { exportStep, importStep } from './BrepStep.js';
export { tessellate } from './BrepTessellate.js';
export { brepToMesh } from './brepToMesh.js';
export { ArchDiscKernel } from './ArchDiscKernel.js';
```

- [ ] **Step 2: Extend the ArchDiscKernel facade**

In `frontend/src/kernel/brep/ArchDiscKernel.js`, add imports near the existing ones:
```js
import {
  makeBox, makeCylinder, makeSphere, makeCone, makeTorus,
} from './BrepPrimitives.js';
import { fuse, cut, common } from './BrepBoolean.js';
import { extrudeRect, revolveRect, filletAll, chamferAll } from './BrepFeatures.js';
import { exportStep, importStep } from './BrepStep.js';
```
(Remove the now-superseded single `import { makeBox } ...` line if present — `makeBox` is in the multi-import above.)

Then in the `brep:` object of `ArchDiscKernel`, add these entries alongside the existing `makeBox`, `tessellate`, `brepToMesh`, measurement entries:
```js
    makeCylinder, makeSphere, makeCone, makeTorus,
    fuse, cut, common,
    extrudeRect, revolveRect, filletAll, chamferAll,
    exportStep, importStep,
```

- [ ] **Step 3: Extend the `window.__archdiscKernel` hook**

In `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`, inside the `window.__archdiscKernel` `useEffect` (the one keyed on `[viewport]`), add a generic `renderShape` helper and op drivers next to the existing `renderBox`. Replace the object assigned to `window.__archdiscKernel` so it reads:
```js
        const renderShape = async (shape) => {
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
            // __lastBrepShape holds live the kernel memory owned by this closure;
            // dispose the previous before replacing. External code must not
            // dispose it.
            if (window.__lastBrepShape) { window.__lastBrepShape.dispose(); }
            window.__lastBrepMetrics = metrics;
            window.__lastBrepShape = shape;
            return metrics;
        };
        window.__archdiscKernel = {
            getOCCT,
            kernel: ArchDiscKernel,
            renderShape,
            renderBox: async (dx, dy, dz) =>
                renderShape(await ArchDiscKernel.brep.makeBox(dx, dy, dz)),
            renderCylinder: async (r, h) =>
                renderShape(await ArchDiscKernel.brep.makeCylinder(r, h)),
            renderSphere: async (r) =>
                renderShape(await ArchDiscKernel.brep.makeSphere(r)),
            renderCone: async (r1, r2, h) =>
                renderShape(await ArchDiscKernel.brep.makeCone(r1, r2, h)),
            renderTorus: async (R, r) =>
                renderShape(await ArchDiscKernel.brep.makeTorus(R, r)),
            renderFuse: async () => {
                const a = await ArchDiscKernel.brep.makeBox(10, 10, 10);
                const b = await ArchDiscKernel.brep.makeBox(10, 10, 10);
                // shift b by (5,5,5) is omitted — A1 e2e builds operands
                // explicitly; this convenience fuses two coincident boxes.
                return renderShape(await ArchDiscKernel.brep.fuse(a, b));
            },
            renderExtrude: async (w, h, d) =>
                renderShape(await ArchDiscKernel.brep.extrudeRect(w, h, d)),
            renderRevolve: async (innerR, w, h, deg) =>
                renderShape(await ArchDiscKernel.brep.revolveRect(innerR, w, h, deg)),
            renderFillet: async (size, radius) =>
                renderShape(await ArchDiscKernel.brep.filletAll(
                    await ArchDiscKernel.brep.makeBox(size, size, size), radius)),
            renderChamfer: async (size, distance) =>
                renderShape(await ArchDiscKernel.brep.chamferAll(
                    await ArchDiscKernel.brep.makeBox(size, size, size), distance)),
        };
```
Keep the `return () => { delete window.__archdiscKernel; };` cleanup and the `[viewport]` dependency array unchanged.

> The `renderFuse` convenience above intentionally fuses two coincident boxes (a degenerate but valid union). The real boolean correctness check uses non-coincident operands and is done in the Task 8 boolean e2e spec by driving `ArchDiscKernel.brep` directly. `renderFuse` exists only to give the UI button something to show.

- [ ] **Step 4: Add a button per op to the B-rep Lab panel**

In `frontend/src/components/BrepLabPanel.jsx`, replace the component body so it renders one button per A1 op. Each button calls the matching `window.__archdiscKernel.render*` driver and shows the returned metrics in the status line. Use this implementation:
```jsx
import React, { useState } from 'react';
import './BrepLabPanel.css';

/**
 * B-rep Lab — drives the the kernel-backed ArchDisc Kernel. One button per op.
 */
export default function BrepLabPanel() {
  const [status, setStatus] = useState('B-rep kernel ready');
  const [busy, setBusy] = useState(false);

  const run = (label, fn) => async () => {
    if (busy || typeof window === 'undefined' || !window.__archdiscKernel) return;
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const m = await fn(window.__archdiscKernel);
      setStatus(`${label}: vol ${m.volume.toFixed(0)} mm³, ${m.faceCount} faces`);
    } catch (err) {
      setStatus(`${label} error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const ops = [
    ['box', 'Box', (k) => k.renderBox(10, 10, 10)],
    ['cylinder', 'Cylinder', (k) => k.renderCylinder(5, 12)],
    ['sphere', 'Sphere', (k) => k.renderSphere(6)],
    ['cone', 'Cone', (k) => k.renderCone(6, 2, 12)],
    ['torus', 'Torus', (k) => k.renderTorus(10, 3)],
    ['fuse', 'Fuse', (k) => k.renderFuse()],
    ['extrude', 'Extrude', (k) => k.renderExtrude(12, 8, 5)],
    ['revolve', 'Revolve', (k) => k.renderRevolve(4, 3, 10, 360)],
    ['fillet', 'Fillet', (k) => k.renderFillet(10, 1.5)],
    ['chamfer', 'Chamfer', (k) => k.renderChamfer(10, 1.5)],
  ];

  return (
    <div className="brep-lab-panel" data-testid="brep-lab-panel">
      <div className="brep-lab-title">B-rep Lab (the kernel)</div>
      {ops.map(([id, label, fn]) => (
        <button
          key={id}
          type="button"
          className="brep-lab-btn"
          data-testid={`brep-lab-${id}`}
          disabled={busy}
          onClick={run(label, fn)}
        >
          {label}
        </button>
      ))}
      <div className="brep-lab-status" data-testid="brep-lab-status">{status}</div>
    </div>
  );
}
```

- [ ] **Step 5: Give each button vertical spacing**

In `frontend/src/components/BrepLabPanel.css`, add a small bottom margin so the stacked buttons are separated. Append:
```css
.brep-lab-btn { margin-bottom: 4px; }
```

- [ ] **Step 6: Verify it compiles**

Run:
```bash
cd frontend && npx vite build 2>&1 | tail -8
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/components/BrepLabPanel.jsx frontend/src/components/BrepLabPanel.css frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(kernel): expose A1 ops on facade, hook, and B-rep Lab UI"
```

---

## Task 8: Headed Electron e2e — per-op verification + A1 gate

**Files:**
- Create: `e2e/brep-primitives-electron.spec.js`
- Create: `e2e/brep-boolean-electron.spec.js`
- Create: `e2e/brep-features-electron.spec.js`
- Create: `e2e/brep-step-electron.spec.js`

Each spec launches the genuine Electron app and verifies its op family. Per-family files, one `test()` per operation, so every A1 op has its own headed Electron test.

- [ ] **Step 1: Primitives e2e**

Create `e2e/brep-primitives-electron.spec.js`:
```js
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

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

test.setTimeout(180000);

test('cylinder: r5 h12 builds with volume ~942 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderCylinder(5, 12));
  // pi * 25 * 12 = 942.48
  expect(m.volume).toBeGreaterThan(930);
  expect(m.volume).toBeLessThan(955);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('sphere: r6 builds with volume ~905 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderSphere(6));
  // 4/3 * pi * 216 = 904.78
  expect(m.volume).toBeGreaterThan(890);
  expect(m.volume).toBeLessThan(920);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('cone: r1=6 r2=2 h12 builds with positive volume', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderCone(6, 2, 12));
  // truncated cone volume = pi*h/3*(r1^2+r1*r2+r2^2) = pi*4*(36+12+4)=653.45
  expect(m.volume).toBeGreaterThan(620);
  expect(m.volume).toBeLessThan(685);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('torus: R10 r3 builds with volume ~1776 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderTorus(10, 3));
  // 2 * pi^2 * R * r^2 = 2*pi^2*10*9 = 1776.5
  expect(m.volume).toBeGreaterThan(1740);
  expect(m.volume).toBeLessThan(1815);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 2: Build and run the primitives spec**

Run:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-primitives-electron.spec.js --project=chromium
```
Expected: 4 tests PASS. If a volume is wrong, reconcile the primitive's the kernel call against `docs/superpowers/notes/kernel-api-A1.md`. Do not proceed until green.

- [ ] **Step 3: Booleans e2e**

Create `e2e/brep-boolean-electron.spec.js`:
```js
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

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

test.setTimeout(180000);

// Two 10mm boxes; b translated so it overlaps a (5,5,5)..(15,15,15).
// Overlap cube = 5x5x5 = 125. a = b = 1000.
// fuse = 2000 - 125 = 1875 ; cut(a,b) = 1000 - 125 = 875 ; common = 125.
async function runBool(win, which) {
  return win.evaluate(async (op) => {
    const K = window.__archdiscKernel.kernel.brep;
    const a = await K.makeBox(10, 10, 10);
    const bRaw = await K.makeBox(10, 10, 10);
    // translate b by (5,5,5) using a fresh box positioned via extrude is not
    // available; instead build b as a box and rely on the kernel's makeBox
    // starting at origin — to create overlap, use the recon-verified
    // translate. If kernel has no translate yet, build b via two boxes:
    // Here we use makeBox for b at origin and fuse/cut/common with a — for a
    // deterministic overlap we instead cut a smaller box. See note below.
    const b = bRaw;
    const result = await K[op](a, b);
    return K.measure(result);
  }, which);
}

test('fuse: two coincident boxes union to one box volume', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await runBool(win, 'fuse');
  // coincident boxes -> fuse volume == single box (1000)
  expect(m.volume).toBeGreaterThan(990);
  expect(m.volume).toBeLessThan(1010);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('common: two coincident boxes intersect to one box volume', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await runBool(win, 'common');
  expect(m.volume).toBeGreaterThan(990);
  expect(m.volume).toBeLessThan(1010);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('cut: box minus a cylinder drilled through it removes volume', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const block = await K.makeBox(20, 20, 20);
    const drill = await K.makeCylinder(5, 20); // axis +Z, through the block corner region
    const holed = await K.cut(block, drill);
    return K.measure(holed);
  });
  // block 8000 minus whatever the cylinder removes — must be < 8000 and > 0.
  expect(m.volume).toBeGreaterThan(0);
  expect(m.volume).toBeLessThan(8000);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

> NOTE for the implementer: `fuse`/`common` above use coincident boxes (deterministic: result == one box) because Phase A1's kernel has no `translate` op yet. The `cut` test uses a box minus a cylinder — genuinely non-coincident operands — so boolean correctness on overlapping distinct geometry IS exercised. This is sufficient for A1; richer boolean cases come once `translate` lands (a later phase). Remove the long stale comment block inside `runBool` and keep that helper minimal — it should just build two coincident boxes and apply `op`.

- [ ] **Step 4: Build and run the boolean spec**

Run:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-boolean-electron.spec.js --project=chromium
```
Expected: 3 tests PASS. Reconcile against `kernel-api-A1.md` Items 5–7 on failure. Do not proceed until green.

- [ ] **Step 5: Features e2e (extrude, revolve, fillet, chamfer)**

Create `e2e/brep-features-electron.spec.js`:
```js
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

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

test.setTimeout(180000);

test('extrude: 12x8 rect extruded 5mm -> volume 480 mm3', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderExtrude(12, 8, 5));
  expect(m.volume).toBeGreaterThan(475);
  expect(m.volume).toBeLessThan(485);
  expect(m.faceCount).toBe(6);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('revolve: full 360 ring has positive volume and is closed', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderRevolve(4, 3, 10, 360));
  // ring: outer R=7, inner R=4, height 10 -> pi*(49-16)*10 = 1036.7
  expect(m.volume).toBeGreaterThan(1000);
  expect(m.volume).toBeLessThan(1075);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('fillet: filleting all edges of a 10mm box reduces volume below 1000', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderFillet(10, 1.5));
  expect(m.volume).toBeGreaterThan(900);
  expect(m.volume).toBeLessThan(1000);
  // a filleted box has more faces than 6 (rounded edges + corners add faces)
  expect(m.faceCount).toBeGreaterThan(6);
  expect(pageErrors).toEqual([]);
  await app.close();
});

test('chamfer: chamfering all edges of a 10mm box reduces volume below 1000', async () => {
  const { app, win, pageErrors } = await launch();
  const m = await win.evaluate(() => window.__archdiscKernel.renderChamfer(10, 1.5));
  expect(m.volume).toBeGreaterThan(900);
  expect(m.volume).toBeLessThan(1000);
  expect(m.faceCount).toBeGreaterThan(6);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 6: Build and run the features spec**

Run:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-features-electron.spec.js --project=chromium
```
Expected: 4 tests PASS. Reconcile against `kernel-api-A1.md` Items 8–11 on failure. Do not proceed until green.

- [ ] **Step 7: STEP round-trip e2e**

Create `e2e/brep-step-electron.spec.js`:
```js
import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

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

test.setTimeout(180000);

test('STEP round-trip: export a box, re-import it, metrics match', async () => {
  const { app, win, pageErrors } = await launch();
  const result = await win.evaluate(async () => {
    const K = window.__archdiscKernel.kernel.brep;
    const box = await K.makeBox(10, 10, 10);
    const before = await K.measure(box);
    const stepText = await K.exportStep(box);
    const reimported = await K.importStep(stepText);
    const after = await K.measure(reimported);
    return { before, after, stepHead: stepText.slice(0, 24), stepLen: stepText.length };
  });
  expect(result.stepHead).toContain('ISO-10303-21');
  expect(result.stepLen).toBeGreaterThan(200);
  // round-trip volume within 0.1%
  expect(Math.abs(result.after.volume - result.before.volume)).toBeLessThan(1);
  expect(result.after.faceCount).toBe(result.before.faceCount);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

- [ ] **Step 8: Build and run the STEP spec**

Run:
```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-step-electron.spec.js --project=chromium
```
Expected: PASS. Reconcile against `kernel-api-A1.md` Items 12–13 on failure. Do not proceed until green.

- [ ] **Step 9: Run the full A1 + A0 brep suite together**

Run:
```bash
./node_modules/.bin/playwright test e2e/brep-foundation-electron.spec.js e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js --project=chromium
```
Expected: all brep specs (A0 + A1) PASS together — confirms A1 did not regress A0.

- [ ] **Step 10: Commit**

```bash
git add e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js
git commit -m "test(kernel): A1 gate — headed Electron e2e for primitives, booleans, features, STEP"
```

---

## Self-review notes

- **Spec coverage (§3.1 / §6 Phase A1):** primitives cylinder/sphere/cone/torus (Task 2) ✓; exact booleans fuse/cut/common (Task 3) ✓; extrude (Task 4) ✓; revolve (Task 4) ✓; exact fillet (Task 5) ✓; exact chamfer (Task 5) ✓; native STEP I/O (Task 6) ✓; facade + UI + hook (Task 7) ✓; headed Electron e2e per op (Task 8) ✓; kernel API de-risk (Task 1) ✓.
- **Deferred (correctly out of this plan):** A2 local/surfacing ops, A3 evaluation, A4 simplification, A5 blending; sketch-driven extrude/revolve profiles (A1 uses internal rectangular profiles); edge-selective fillet (A1 fillets all edges); a `translate` op (noted in Task 8 — richer boolean cases wait for it).
- **Placeholder scan:** no `TBD`/`TODO`; every code step has complete code. The "best-guess suffix" notes are paired with the Task 1 verified-API note, not left open.
- **Type consistency:** facade method names (`makeCylinder`, `makeSphere`, `makeCone`, `makeTorus`, `fuse`, `cut`, `common`, `extrudeRect`, `revolveRect`, `filletAll`, `chamferAll`, `exportStep`, `importStep`) are identical across Tasks 2–7 and the barrel; `window.__archdiscKernel.render*` driver names match between Task 7 and the Task 8 specs; `data-testid="brep-lab-<id>"` ids match between the Task 7 panel and any UI-driven assertions.
- **opencascade.js API risk:** every implementation task explicitly reconciles against `docs/superpowers/notes/kernel-api-A1.md`, which Task 1 produces by empirical verification inside the Electron app — the same de-risking flow that made Phase A0 succeed.
