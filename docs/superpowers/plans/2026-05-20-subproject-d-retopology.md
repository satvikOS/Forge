# Sub-project D — Retopology (Isotropic Remeshing) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isotropic-remeshing retopology pipeline to ArchDisc — take an arbitrary input triangle mesh and produce a clean, uniformly-sized triangle mesh (regular valence, consistent edge length, smooth vertex distribution). Wire as a "Retopo Surface" ribbon tool driven by a real-world artifact e2e test.

**Architecture:** Pure-JS mesh work, mirroring Sub-project C's structure. Inputs come from the kernel tessellation (any kernel body → `tessellate(...)` → triangle mesh → retopo). New file `frontend/src/foundation/IsotropicRemesh.js` implements the algorithm; `frontend/src/kernel/brep/BrepRetopo.js` is the facade entry that orchestrates tessellate → weld → retopo → limit-normal → Three.js-ready arrays. Wire into a ribbon tool in the Part tab. Real user workflow + real artifact (filleted bracket) + all-angles capture.

**Tech Stack:** Pure JS (no kernel API beyond using its tessellation). Vite 7 / React 19 / Three.js 0.181 / Electron 42 / Playwright 1.59.

**Reference:** [Botsch & Kobbelt, "A Remeshing Approach to Multiresolution Modeling" (2004)] — the canonical isotropic-remeshing algorithm (split-long → collapse-short → tangential relax → flip-improve-valence, iterated). Also memory `feedback_complex_e2e_models` (real-world artifacts), `feedback_sophisticated_integrations`, `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_fully_sophisticated`.

---

## Important context for the implementer

- **Read first:** the spec; the C subdivision plan + result (`docs/superpowers/notes/subdivision-C.md`); `frontend/src/foundation/LoopSubdivision.js` (the existing `weldMesh` is reused here).
- **Op pattern (mesh side):** pure JS — no `withScope`/`track()`. Functions take/return `{vertices, triangles}` mesh dicts.
- **Kernel facade pattern:** `BrepRetopo.js` mirrors `BrepSubdivide.js` (tessellate → mesh → algorithm → Three.js-ready arrays).
- **Ribbon-handler pattern:** copy `Subdivide Surface` from `ToolExecutionEngine.js` — same shape (single-body selection, dialog, render result mesh into the scene as a `THREE.Mesh`).
- **e2e: real-world artifact, no hardcoded geometry** — build the input artifact via real ribbon clicks (e.g. Box → Fillet → "rounded plate") then click Retopo Surface.
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/foundation/IsotropicRemesh.js` | Create — the remeshing algorithm |
| `frontend/src/kernel/brep/BrepRetopo.js` | Create — kernel facade entry |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose `retopoShape` on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel export |
| `frontend/src/foundation/ToolParamSchemas.js` | Modify — add a `Retopo Surface` schema (targetEdgeLength, iterations) |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire `Retopo Surface` ribbon tool |
| `frontend/src/components/RibbonToolbar.jsx` + `WorkbenchMechanical.jsx` | Modify — add `Retopo Surface` ribbon entry |
| `docs/superpowers/notes/retopology-D.md` | Create (Task 1) — recon findings + verified algorithm |
| `e2e/retopo-recon-electron.spec.js` | Create (Task 1) — baseline metrics on a real artifact |
| `e2e/retopo-surface-electron.spec.js` | Create (Task 4) — Sub-project D e2e gate |

---

## Task 1: Recon — baseline metrics on a real-world artifact

Build a real artifact via ribbon clicks (e.g. `Box → Fillet`), tessellate it, measure its current mesh quality (edge-length variance, vertex valence histogram), and document the verified isotropic-remeshing algorithm. Mirrors `e2e/subdivide-recon-electron.spec.js`.

- [ ] **Step 1: Create `e2e/retopo-recon-electron.spec.js`**

The recon spec is allowed to use `kernel.brep.tessellate(...)` to READ the tessellation of the artifact (it's a read, not building inputs). The artifact ITSELF is built via the ribbon (per the no-hardcoded-inputs rule). Use the `uiWorkflow.js` helpers.

Build the artifact: `buildPrimitive(win, 'Box')` then `selectBodies(...)` then click `Fillet` with `radius=2` (a rounded plate — a recognisable real-world artifact). Then in `win.evaluate(...)` tessellate `window.__lastBrepShape` via `kernel.brep.tessellate(...)` and convert to a `{vertices, triangles}` mesh.

Measure baseline metrics — the platform's tessellation is per-face-duplicated (Sub-project C found this) so weld first via the existing `weldMesh` from `LoopSubdivision.js` (expose it via `window.__archdiscSubdiv = { ..., weldMesh }` if not already exposed — the C-T1 hook exposed `loopSubdivide`, `loopStep`; add `weldMesh` to that mirror). Compute:

- `vertexCount`, `triangleCount`.
- **Edge-length distribution:** for each edge of the welded mesh, compute its length. Record `minEdge`, `maxEdge`, `meanEdge`, `stddevEdge`. A clean isotropic mesh has stddev / mean ≈ 0.1; a non-isotropic mesh has stddev / mean > 0.4.
- **Vertex-valence histogram:** for each vertex, the count of incident edges. Record histogram (e.g. `{4: 2, 5: 8, 6: 24, 7: 8}` etc.). A clean isotropic mesh has most vertices at valence 6 (regular vertices) and few extraordinary vertices.

Write these metrics to `docs/superpowers/notes/retopology-D-recon.json` and `console.log` them. `expect(...)` that the metrics were recorded (`expect(typeof metrics.meanEdge).toBe('number')` etc.). `test.setTimeout(600000)`.

- [ ] **Step 2: Build + run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/retopo-recon-electron.spec.js --project=chromium
```

- [ ] **Step 3: Write `docs/superpowers/notes/retopology-D.md`**

Document:
- The baseline metrics from the recon (the actual numbers).
- The **verified isotropic-remeshing algorithm (Botsch-Kobbelt 2004)** — implementation plan for Task 2:

  Given target edge length L (default = mean baseline edge length) and N iterations (default 5):
  1. **Split long edges:** every edge with length > (4/3)·L is split at its midpoint (insert a new vertex, two new triangles per split).
  2. **Collapse short edges:** every edge with length < (4/5)·L is collapsed (one endpoint absorbed into the other). Skip collapses that would invert triangles or create non-manifold topology.
  3. **Equalise valences (edge flip):** for each interior edge, count the valence of its 4 incident vertices (2 endpoints + 2 opposite vertices of adjacent triangles). The "deviation" before flip = Σ |valence_i − 6|. Compute the same Σ for the post-flip configuration. Flip if post-flip deviation < pre-flip deviation.
  4. **Tangential Laplacian relaxation:** for each vertex, compute its 1-ring centroid, then project the centroid onto the tangent plane of the original vertex's normal (so the vertex slides along the surface, not into it). Move the vertex to that projected position. Repeat once per iteration.
  5. **Optional surface-pull-back step:** project relaxed vertices back onto the original surface (skip in this iteration — Task 2 is a first deliverable; surface-pull-back is a future enhancement noted in honest outcome).

  Repeat steps 1-4 for N iterations. Expected outcome: minEdge/maxEdge bracketed around (4/5)·L and (4/3)·L; vertex valence histogram strongly peaked at 6; stddev/mean of edge length drops by ≥ 50% from baseline.

- A clear "Sub-project D deliverable scope" section listing exactly what Tasks 2–4 will build.

- [ ] **Step 4: Commit**

```bash
git add e2e/retopo-recon-electron.spec.js docs/superpowers/notes/retopology-D.md docs/superpowers/notes/retopology-D-recon.json frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "test(retopo): D recon — baseline mesh quality + verified Botsch-Kobbelt algorithm"
```

---

## Task 2: Implement isotropic remeshing in `IsotropicRemesh.js`

**Files:** create `frontend/src/foundation/IsotropicRemesh.js`.

- [ ] **Step 1: Build the algorithm**

Export `isotropicRemesh(mesh, opts)` where `opts = { targetEdgeLength?: number, iterations?: number = 5, splitFactor?: number = 4/3, collapseFactor?: number = 4/5 }`. The function takes a `{vertices, triangles}` mesh (pre-welded — the caller welds via `weldMesh`) and returns the remeshed `{vertices, triangles}`.

Implement Botsch-Kobbelt 2004 (see retopology-D.md):
1. **Default L:** if `opts.targetEdgeLength` omitted, compute `L = meanEdgeLength(mesh)`.
2. **One iteration step `isoStep(mesh, L)`** does, in order: split-long-edges → collapse-short-edges → flip-to-improve-valence → tangential-Laplacian-relax. Each operates on a fresh copy of the previous step's mesh.
3. Apply `isoStep` `iterations` times.

For each helper:
- `splitLongEdges(mesh, L*splitFactor)`: iterate edges; for each edge longer than threshold, insert midpoint vertex and re-triangulate the two adjacent triangles.
- `collapseShortEdges(mesh, L*collapseFactor)`: iterate edges; for each edge shorter than threshold, collapse one endpoint into the other (use midpoint as the surviving position). Skip if collapse would cause normal flip on any incident triangle.
- `flipEdgesToImproveValence(mesh)`: iterate interior edges; for each, compute pre-flip and post-flip valence-deviation sums (Σ|val_i − 6|); flip if post < pre.
- `tangentialRelax(mesh)`: for each vertex, compute 1-ring centroid; compute vertex normal as the area-weighted face-normal average; project (centroid − vertex) onto the tangent plane (subtract the normal component); move vertex by that tangential offset.

Helper utilities: `edgeIterator(triangles)` yielding unique edges with their two adjacent triangle indices; `oneRing(vertexIndex, triangles)` yielding neighbour vertex indices.

Sophisticated edge cases:
- **Boundary edges** (1 adjacent triangle): never collapse, never flip. Optionally split (treat as interior for split-only).
- **Degenerate collapses** (would produce zero-area triangle): skip.
- **Index management:** after splits/collapses, vertex/triangle indices renumber — use stable id-based bookkeeping or rebuild the arrays after each step.

Add an `export function isoStep(...)` for testability + the main `isotropicRemesh(...)`.

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/foundation/IsotropicRemesh.js
git commit -m "feat(retopo): isotropic remeshing (Botsch-Kobbelt 2004)"
```

---

## Task 3: Kernel facade `BrepRetopo.js` + ribbon wiring + schemas

**Files:** create `BrepRetopo.js`; modify barrel, facade, `ToolExecutionEngine.js`, `RibbonToolbar.jsx`, `WorkbenchMechanical.jsx`, `ToolParamSchemas.js`.

- [ ] **Step 1: `BrepRetopo.js`**

```js
/**
 * ArchDisc Kernel — retopology facade.
 * 1. Tessellate the B-rep to a triangle mesh.
 * 2. Weld duplicate vertices.
 * 3. Isotropic remesh (Botsch-Kobbelt 2004).
 * 4. Compute per-vertex normals via Loop limit-normal evaluator (re-use C's
 *    SubdivisionNormals so the rendered output is consistent with subdivision).
 * 5. Return Three.js-ready typed arrays.
 */

import { tessellate } from './BrepTessellate.js';
import { weldMesh } from '../../foundation/LoopSubdivision.js';
import { isotropicRemesh } from '../../foundation/IsotropicRemesh.js';
import { loopLimitNormals } from '../../foundation/SubdivisionNormals.js';

export async function retopoShape(brepShape, opts = {}) {
  const { targetEdgeLength, iterations = 5, deflection = 0.5 } = opts;
  if (!brepShape || !brepShape.shape) throw new Error('retopoShape: needs a BrepShape');
  if (!(Number.isInteger(iterations) && iterations >= 1)) {
    throw new Error(`retopoShape: iterations must be a positive integer (got ${iterations})`);
  }
  const tess = await tessellate(brepShape, deflection);
  const baseVertices = [];
  for (let i = 0; i < tess.positions.length; i += 3) {
    baseVertices.push([tess.positions[i], tess.positions[i+1], tess.positions[i+2]]);
  }
  const baseTriangles = [];
  for (let i = 0; i < tess.indices.length; i += 3) {
    baseTriangles.push([tess.indices[i], tess.indices[i+1], tess.indices[i+2]]);
  }
  const baseStats = { baseVerts: baseVertices.length, baseTris: baseTriangles.length };
  const welded = weldMesh({ vertices: baseVertices, triangles: baseTriangles }, 1e-4);
  const remeshed = isotropicRemesh(welded, { targetEdgeLength, iterations });
  const normals = loopLimitNormals(remeshed);

  const positions = new Float32Array(remeshed.vertices.length * 3);
  for (let i = 0; i < remeshed.vertices.length; i++) {
    positions[i*3]   = remeshed.vertices[i][0];
    positions[i*3+1] = remeshed.vertices[i][1];
    positions[i*3+2] = remeshed.vertices[i][2];
  }
  const indices = new Uint32Array(remeshed.triangles.length * 3);
  for (let i = 0; i < remeshed.triangles.length; i++) {
    indices[i*3]   = remeshed.triangles[i][0];
    indices[i*3+1] = remeshed.triangles[i][1];
    indices[i*3+2] = remeshed.triangles[i][2];
  }
  return {
    positions, normals, indices,
    stats: { ...baseStats, weldedVerts: welded.vertices.length,
             retopoVerts: remeshed.vertices.length, retopoTris: remeshed.triangles.length },
  };
}
```

- [ ] **Step 2: Barrel + facade**

`index.js`: `export { retopoShape } from './BrepRetopo.js';`. `ArchDiscKernel.js`: import + add to `brep:` literal.

- [ ] **Step 3: Schema + ribbon**

`ToolParamSchemas.js`: add `Retopo Surface` schema with fields `targetEdgeLength` (default 0 = auto, min 0, max 100, step 0.1, unit mm) and `iterations` (integer default 5, min 1, max 10). Comment that `targetEdgeLength=0` selects the auto-computed mean baseline edge length.

`RibbonToolbar.jsx` Part tab Surface group (alongside `Subdivide Surface`): add `Retopo Surface` tool entry. Mirror entry in `WorkbenchMechanical.jsx` `TOOL_GROUPS.surface`.

`ToolExecutionEngine.js` `TOOL_HANDLERS.surface`: add the handler. Pattern (copy from `Subdivide Surface`):
```js
'Retopo Surface': async (scene, viewport) => {
  try {
    const [body] = _pickBodies(1);
    const { values, cancelled } = await requestToolParams('Retopo Surface');
    if (cancelled) return { status: 'warn', message: 'Retopo Surface: cancelled' };
    const tgt = values.targetEdgeLength > 0 ? values.targetEdgeLength : undefined;
    const mesh = await ArchDiscKernel.brep.retopoShape(body, { targetEdgeLength: tgt, iterations: values.iterations });
    const THREE = await import('three');
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide });
    const m3 = new THREE.Mesh(geom, mat);
    const group = new THREE.Group();
    group.scale.set(0.001, 0.001, 0.001);
    group.add(m3);
    group.userData.pickable = true;
    group.userData.generatedModel = true;
    group.userData.retopo = true;
    scene.add(group);
    group.updateMatrixWorld(true);
    if (typeof window !== 'undefined' && typeof window.__archdiscFocusOnObject === 'function') {
      window.__archdiscFocusOnObject(group);
    }
    if (typeof window !== 'undefined') {
      window.__lastRetopoMesh = { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, stats: mesh.stats };
    }
    return { status: 'success', message: `Retopo Surface: ${mesh.stats.baseTris}→${mesh.stats.retopoTris} tris (target L = ${tgt ?? 'auto'}, ${values.iterations} iter) via isotropic remeshing` };
  } catch (err) {
    return { status: err.message && err.message.startsWith('select') ? 'warn' : 'error', message: 'Retopo Surface: ' + err.message };
  }
}
```

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npx vite build 2>&1 | tail -5
git add frontend/src/kernel/brep/BrepRetopo.js frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/foundation/ToolParamSchemas.js frontend/src/components/RibbonToolbar.jsx frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js
git commit -m "feat(retopo): retopoShape facade + Retopo Surface ribbon tool"
```

---

## Task 4: e2e gate — real-world artifact retopology

**Files:** create `e2e/retopo-surface-electron.spec.js`.

Use the `uiWorkflow.js` helpers. Real-world artifact: a **filleted bracket plate** — `buildPrimitive 'Box'` → `selectBodies` → `Fillet` (radius 2) → "rounded bracket plate." Then select it → click `Retopo Surface` (Part tab) → fillDialog ({iterations: 5, targetEdgeLength: 0}).

Assertions:
- `window.__lastRetopoMesh.stats.retopoTris > 0`.
- `stats.retopoVerts > 0`.
- The retopo'd mesh's bounding box matches the input's within 5% per axis (no geometry loss — the artifact's outer envelope is preserved).
- Edge-length stddev / mean of the retopo'd mesh is meaningfully lower than the baseline — assert improvement (`postRatio < 0.8 * baselineRatio` or set a tight ratio from the recon-measured value).
- captureAllAngles blanks empty, pageErrors empty.

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/retopo-surface-electron.spec.js --project=chromium
```

Then run the full brep+UX suite to confirm no regressions:
```bash
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-a4-recon-electron.spec.js e2e/brep-a5-recon-electron.spec.js e2e/brep-b-recon-electron.spec.js e2e/subdivide-recon-electron.spec.js e2e/retopo-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/brep-simplify-electron.spec.js e2e/brep-blend-electron.spec.js e2e/brep-b-advanced-electron.spec.js e2e/subdivide-surface-electron.spec.js e2e/retopo-surface-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js --project=chromium
```
All must pass.

Append "Sub-project D — honest outcome" to `docs/superpowers/notes/retopology-D.md` with the measured before/after edge-length stddev ratio + retopo triangle count + the artifact recipe used.

```bash
git add e2e/retopo-surface-electron.spec.js docs/superpowers/notes/retopology-D.md
git commit -m "test(retopo): D gate — real-world artifact retopology e2e + honest outcome"
```

---

## Self-review notes

- Real-world artifact recipe: "filleted rounded plate" (Box → Fillet) is a recognisable bracket-like artifact.
- e2e drives via ribbon clicks + dialogs — no kernel `make*` for inputs.
- All-angles capture preserved.
- Honest gaps: optional surface-pull-back step deferred; the deliverable produces a clean isotropic mesh but doesn't reproject vertices onto the original B-rep surface — vertices may drift slightly from the input surface during tangential relax. Document.
- Deferred: quadrangulation; cross-field guided retopo; sketch-driven retopo direction.
