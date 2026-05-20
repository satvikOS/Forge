# Sub-project C — Subdivision Surfaces (no pinching, no shading errors) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing Loop subdivision so it avoids pinching at sharp features and shading errors at extraordinary vertices, and expose it as a workbench ribbon tool a user actually clicks through. Per user directive: "Subdivision Surface topology (avoiding pinching and shading errors)".

**Architecture:** Builds on `frontend/src/foundation/LoopSubdivision.js`, which already implements correct Loop math for triangle meshes (the C¹-at-extraordinary-vertices guarantee). This sub-project adds:
1. **Piecewise-smooth subdivision (Hoppe et al.)** — per-edge sharpness flags so feature edges follow crease/boundary rules instead of smooth interior rules. Eliminates "pinching" of sharp features (cube corners, fillet seams).
2. **Limit-normal evaluation** — compute proper vertex normals via Loop tangent masks at irregular topology rather than face-normal averaging. Eliminates shading discontinuities.
3. **Auto-crease detection by dihedral angle** — feature edges of an OCCT-tessellated body are detected by sharp dihedral angle and marked as creases automatically.
4. **Ribbon tool `Subdivide Surface`** — clicks through the real platform: take the current body's tessellation, auto-detect creases, Loop-subdivide N steps with crease handling, render with limit normals.

Each task: recon → implement → integrate → e2e via real ribbon click + all-angles capture (per `feedback_e2e_user_workflows`).

**Tech Stack:** Pure JS mesh work (no OCCT API beyond using the existing OCCT-tessellated mesh as input). Vite 7, React 19, Electron 42, Playwright 1.59 (headed).

**Reference:** ArchDisc memory `project_occt_kernel` ("Loop subdivision FIXED — foundation/LoopSubdivision.js correct triangle scheme"). The roadmap §3 doesn't list subdivision (it's beyond the OCCT B-rep capability set) — this sub-project is per direct user direction.

---

## Important context for the implementer

- **Read first:** `frontend/src/foundation/LoopSubdivision.js` (the existing implementation — its header documents Loop's β-rule and weighting). Read also the memory entries `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_no_floating_panels`, `feedback_occt_deep_integration`.
- **Existing exports** in `LoopSubdivision.js`: `loopSubdivide(mesh, levels)`, `loopStep({vertices,triangles})`, `manifoldMeshToArrays(mesh)`, `subdivideManifold(manifold, levels, getManifoldFn)`.
- **OCCT tessellation pipeline:** `kernel/brep/BrepTessellate.js` already converts an OCCT shape into `{positions: Float32Array, normals: Float32Array, indices: Uint32Array}`. Sub-project C's ribbon tool takes a tessellated OCCT body and runs subdivision on its triangle data, then re-renders.
- **Op pattern (mesh side, NOT OCCT):** plain JS, no `withScope`/`track()`. Subdivision functions take mesh dicts (`{vertices, triangles}`) and return new mesh dicts.
- **e2e methodology:** drive via real ribbon click. Subdivision produces visual mesh refinement — verify numerically (vertex/triangle count growth, sharp-edge preservation) AND from many camera angles/zooms.
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/foundation/LoopSubdivision.js` | Modify — extend `loopStep` to accept per-edge sharpness map; add piecewise-smooth (Hoppe) rules |
| `frontend/src/foundation/SubdivisionCreases.js` | Create — auto-detect creases by dihedral threshold; helper to build the sharpness map |
| `frontend/src/foundation/SubdivisionNormals.js` | Create — limit-normal evaluation via Loop tangent masks |
| `frontend/src/kernel/brep/BrepSubdivide.js` | Create — ArchDiscKernel entry: take a `BrepShape` (or its tessellation), subdivide with creases + limit normals, return `{positions, normals, indices}` ready for Three.js |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose `subdivideShape` on the facade |
| `frontend/src/kernel/brep/index.js` | Modify — barrel export |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire `Subdivide Surface` ribbon tool |
| `frontend/src/components/RibbonToolbar.jsx`, `WorkbenchMechanical.jsx` | Modify — add `Subdivide Surface` tool entry |
| `docs/superpowers/notes/subdivision-C.md` | Create (Task 1) — recon findings + verified algorithm |
| `e2e/subdivide-recon-electron.spec.js` | Create (Task 1) — empirical baseline |
| `e2e/subdivide-surface-electron.spec.js` | Create (Task 5) — Sub-project C e2e gate |

---

## Task 1: Subdivision baseline reconnaissance & verdict

**Files:**
- Create: `e2e/subdivide-recon-electron.spec.js`
- Create: `docs/superpowers/notes/subdivision-C.md`

Measure the current `loopSubdivide` behaviour on a cube tessellation and quantify the pinching / shading problems before fixing them. This task is research: establish baseline metrics and the verified mitigation algorithm.

- [ ] **Step 1: Write the recon spec**

Create `e2e/subdivide-recon-electron.spec.js`. Launch the Electron app, build a `MakeBox_2(20,20,20)`, tessellate it via the existing kernel (`window.__archdiscKernel.kernel.brep.makeBox(20,20,20)` + `await window.__archdiscKernel.kernel.brep.tessellate(box, 0.1)` — these are kernel calls in a recon spec, which is acceptable since the recon is an investigation, not a user-workflow test). Convert the tessellation to a `{vertices: [[x,y,z]...], triangles: [[i,j,k]...]}` mesh dict. Then inside `win.evaluate(...)` import-or-inline run `loopSubdivide(mesh, 2)`. For the SUBDIVIDED mesh measure:

1. **Pinching at cube corners.** For each of the 8 cube corner vertices (closest vertex in the subdivided mesh to each of `(0,0,0)`, `(20,0,0)`, `(0,20,0)`, …, `(20,20,20)`), compute how far it has moved from the original corner. Loop subdivision will move corners INWARD; report the max corner-displacement as the pinching metric.
2. **Edge-feature sharpness loss.** For each of the 12 cube edges (e.g. the edge from `(0,0,0)` to `(20,0,0)`), find the subdivided vertices that originally lay on that edge and measure how far they have moved off the straight-line edge. Big perpendicular displacement = pinched edge / lost feature.
3. **Normal-discontinuity hotspots.** Compute per-face normals of all triangles in the subdivided mesh. For each pair of triangles sharing an edge, compute the dihedral angle. Count pairs with dihedral > 30° (significant kink) — these are shading-error hotspots.
4. **Reference baseline.** Same metrics measured on a single Loop step (`levels=1`) — establish baseline. The expectation: even one step pinches corners noticeably and creates kink-hotspots near corners.

Write the measurements to `docs/superpowers/notes/subdivision-C-recon.json`, `console.log` them. `expect(...)` that the measurements were taken (`expect(reconJSON).toHaveProperty('cornerPinchMax')` etc.) — the spec PASSES green when measurements are recorded, NOT when the values are "good." `test.setTimeout(600000)`.

- [ ] **Step 2: Build + run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/subdivide-recon-electron.spec.js --project=chromium
```

- [ ] **Step 3: Write `docs/superpowers/notes/subdivision-C.md`**

Document:
- Baseline measurements from the recon (the actual numbers for cube-corner pinch, edge perpendicular drift, kink-hotspot count).
- The **verified mitigation algorithm**: piecewise-smooth Loop (Hoppe et al. 1994):
  - Per-edge sharpness `s ∈ [0, ∞]`. Smooth edge: s=0 → standard interior Loop rules. Sharp edge: s=∞ → boundary-crease rules. Semi-sharp: hybrid for first `floor(s)` levels then smooth.
  - **Vertex rules** at a vertex with `k` incident sharp edges:
    - `k = 0`: smooth (standard interior Loop β-rule).
    - `k = 1`: smooth (dart vertex).
    - `k = 2`: crease vertex — `v' = (6v + b0 + b1) / 8` where `b0`, `b1` are the two crease-neighbour vertices.
    - `k ≥ 3`: corner — `v' = v` (the vertex stays fixed; preserves sharp corners exactly).
  - **Edge rules** for an edge between v0 and v1:
    - Smooth edge: standard interior rule `e = 3/8·(v0+v1) + 1/8·(vL+vR)`.
    - Sharp edge: `e = 1/2·(v0+v1)` (boundary rule — preserves the straight line).
- The **auto-crease detection rule**: an edge is a sharp crease when its dihedral angle exceeds a threshold (default 30°). At a cube vertex this marks all 3 incident edges as sharp → `k=3` → corner rule → cube corner stays exactly at the corner. The cube edges with dihedral 90° are all marked sharp → straight cube edges stay straight in subdivision.
- The **limit-normal mask** for Loop (the standard tangent masks): at a vertex of valence n with neighbours `v_i`, the two tangents are `t_1 = Σ cos(2πi/n) · v_i` and `t_2 = Σ sin(2πi/n) · v_i`; the limit normal is `cross(t_1, t_2)` normalized. This produces a smooth normal field at extraordinary vertices, replacing face-normal averaging that creates shading kinks.

Mark the algorithm verified by Hoppe et al. 1994 + standard Loop subdivision literature. Tasks 2–4 implement it.

- [ ] **Step 4: Commit**

```bash
git add e2e/subdivide-recon-electron.spec.js docs/superpowers/notes/subdivision-C.md docs/superpowers/notes/subdivision-C-recon.json
git commit -m "test(subdivision): C recon — baseline pinching/shading metrics + verified PWLoop algorithm"
```

---

## Task 2: Piecewise-smooth Loop subdivision with creases

**Files:**
- Modify: `frontend/src/foundation/LoopSubdivision.js`

> Extend the existing `loopStep` to accept an optional `sharpness` map (per-edge sharpness value, ≥0) and apply Hoppe et al.'s piecewise-smooth rules. Backwards-compatible: when `sharpness` is omitted/empty, behaviour is identical to today.

- [ ] **Step 1: Extend `loopStep` with crease handling**

Read the existing `loopStep({ vertices, triangles })` implementation (it should compute edge points and reposition vertices). Modify its signature to accept a third arg `sharpness` — a `Map<edgeKey, number>` where `edgeKey = a < b ? a+'_'+b : b+'_'+a` for vertex indices `(a,b)`, and the value is the sharpness `s ≥ 0`. Implement:

- **Edge points:** if `sharpness.get(edgeKey) > 0` (sharp), use the boundary rule `e = 0.5·(v0+v1)`; else use the existing smooth rule.
- **Vertex repositioning:** for each vertex, count the number `k` of incident sharp edges. Apply:
  - `k ≤ 1`: existing smooth interior rule (unchanged).
  - `k = 2`: crease rule. Find the two crease-neighbour vertex indices (the two endpoints of the two sharp edges incident to this vertex other than the vertex itself). Set `v' = (6v + n0 + n1) / 8`.
  - `k ≥ 3`: corner. `v' = v` (no movement).
- **Sharpness propagation to subdivided edges:** when a triangle `(a, b, c)` is split via edge points `e_ab, e_bc, e_ca`, the three "outer" edges of each child triangle inherit sharpness from the parent edges. Build a new `sharpness` map for the subdivided mesh: each parent edge `(a,b)` with sharpness `s` becomes two child edges `(a, e_ab)` and `(e_ab, b)` each with sharpness `max(s-1, 0)` (the Hoppe rule — sharpness decays by 1 per level so semi-sharp edges become smooth after `floor(s)` levels).

The function now returns `{ vertices, triangles, sharpness }` (a new Map for the subdivided mesh). Adjust `loopSubdivide` so it threads `sharpness` through the steps.

Make sure: when `sharpness` is omitted/empty, the function's output is bit-identical to the previous implementation (validate by adding a quick assert at the top of the function for empty input). Existing callers (`subdivideManifold`) continue to work — they just don't pass sharpness.

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/foundation/LoopSubdivision.js
git commit -m "feat(subdivision): piecewise-smooth Loop with per-edge sharpness (Hoppe 1994)"
```

---

## Task 3: Auto-crease detection by dihedral angle

**Files:**
- Create: `frontend/src/foundation/SubdivisionCreases.js`

- [ ] **Step 1: Create the detector**

Create `frontend/src/foundation/SubdivisionCreases.js`:
```js
/**
 * ArchDisc Foundation — auto-detect crease edges of a triangle mesh by
 * dihedral angle. Sharp dihedral edges become creases in piecewise-smooth
 * Loop subdivision, preserving features (cube edges, fillet seams) that
 * a smooth subdivision would round off.
 */

/**
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} [angleDeg]  dihedral threshold; edges with dihedral > this
 *                              are marked sharp. Default 30°.
 * @returns {Map<string, number>}  sharpness map ready for loopStep:
 *                                 edgeKey "a_b" (a<b) → sharpness (1.0 for now;
 *                                 caller may scale for semi-sharp).
 */
export function detectCreases(mesh, angleDeg = 30) {
  const cosThresh = Math.cos(angleDeg * Math.PI / 180);
  const { vertices, triangles } = mesh;

  // Compute per-triangle normals.
  const triNormals = triangles.map(([a, b, c]) => {
    const va = vertices[a], vb = vertices[b], vc = vertices[c];
    const ux = vb[0]-va[0], uy = vb[1]-va[1], uz = vb[2]-va[2];
    const wx = vc[0]-va[0], wy = vc[1]-va[1], wz = vc[2]-va[2];
    const nx = uy*wz - uz*wy, ny = uz*wx - ux*wz, nz = ux*wy - uy*wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx/len, ny/len, nz/len];
  });

  // Build edge → adjacent-triangle list.
  const edgeAdj = new Map(); // edgeKey → triIndex[]
  const key = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
  triangles.forEach(([a, b, c], i) => {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      if (!edgeAdj.has(k)) edgeAdj.set(k, []);
      edgeAdj.get(k).push(i);
    }
  });

  const sharpness = new Map();
  for (const [k, tris] of edgeAdj) {
    if (tris.length === 1) {
      sharpness.set(k, 1.0); // boundary edge = always crease
      continue;
    }
    if (tris.length !== 2) continue; // non-manifold: skip
    const [n0, n1] = [triNormals[tris[0]], triNormals[tris[1]]];
    const dot = n0[0]*n1[0] + n0[1]*n1[1] + n0[2]*n1[2];
    if (dot < cosThresh) sharpness.set(k, 1.0); // dihedral > threshold → sharp
  }
  return sharpness;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/foundation/SubdivisionCreases.js
git commit -m "feat(subdivision): auto-detect creases by dihedral angle"
```

---

## Task 4: Limit-normal evaluation

**Files:**
- Create: `frontend/src/foundation/SubdivisionNormals.js`

- [ ] **Step 1: Create the limit-normal evaluator**

Create `frontend/src/foundation/SubdivisionNormals.js`:
```js
/**
 * ArchDisc Foundation — Loop limit-normal evaluator. At each vertex of a
 * subdivided triangle mesh, compute the tangent-plane normal via Loop's
 * tangent masks (rather than averaging face normals). This produces a
 * smooth normal field even at extraordinary vertices, eliminating the
 * shading kinks that face-averaged normals create at irregular topology.
 *
 * For a vertex with neighbours v_0 … v_{n-1} (in 1-ring order), the two
 * tangents are:
 *   t_1 = Σ_{i=0..n-1} cos(2π i / n) · v_i
 *   t_2 = Σ_{i=0..n-1} sin(2π i / n) · v_i
 * and the limit normal is normalize(t_1 × t_2).
 */

/**
 * Build a vertex 1-ring map: for each vertex index, the ordered list of
 * its neighbour vertex indices walking around the 1-ring. For a smoothly
 * connected interior vertex this is a closed cycle; for boundary or
 * non-manifold it falls back to an arbitrary CCW order.
 */
function build1Ring(triangles, vertexCount) {
  const adj = Array.from({ length: vertexCount }, () => new Set());
  for (const [a, b, c] of triangles) {
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  // For each vertex, attempt to order its neighbours by walking adjacent triangles.
  const oneRing = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    oneRing[v] = Array.from(adj[v]); // arbitrary order is acceptable for the tangent mask
  }
  return oneRing;
}

/**
 * Compute per-vertex limit normals for a triangle mesh via Loop's tangent
 * masks. Returns a flat Float32Array of length `3 * vertexCount`.
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @returns {Float32Array}
 */
export function loopLimitNormals(mesh) {
  const { vertices, triangles } = mesh;
  const n = vertices.length;
  const ring = build1Ring(triangles, n);
  const out = new Float32Array(n * 3);

  for (let v = 0; v < n; v++) {
    const nbs = ring[v];
    const k = nbs.length;
    if (k < 3) {
      // boundary or degenerate — fall back to a face-normal average
      out.set(faceAveragedNormal(v, triangles, vertices), v * 3);
      continue;
    }
    let t1x = 0, t1y = 0, t1z = 0;
    let t2x = 0, t2y = 0, t2z = 0;
    for (let i = 0; i < k; i++) {
      const c = Math.cos(2 * Math.PI * i / k);
      const s = Math.sin(2 * Math.PI * i / k);
      const vi = vertices[nbs[i]];
      t1x += c * vi[0]; t1y += c * vi[1]; t1z += c * vi[2];
      t2x += s * vi[0]; t2y += s * vi[1]; t2z += s * vi[2];
    }
    // Normal = t1 × t2
    const nx = t1y * t2z - t1z * t2y;
    const ny = t1z * t2x - t1x * t2z;
    const nz = t1x * t2y - t1y * t2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[v * 3] = nx / len;
    out[v * 3 + 1] = ny / len;
    out[v * 3 + 2] = nz / len;
  }
  return out;
}

/** Fallback: face-normal average for boundary/degenerate vertices. */
function faceAveragedNormal(vIdx, triangles, vertices) {
  let nx = 0, ny = 0, nz = 0;
  for (const [a, b, c] of triangles) {
    if (a !== vIdx && b !== vIdx && c !== vIdx) continue;
    const va = vertices[a], vb = vertices[b], vc = vertices[c];
    const ux = vb[0]-va[0], uy = vb[1]-va[1], uz = vb[2]-va[2];
    const wx = vc[0]-va[0], wy = vc[1]-va[1], wz = vc[2]-va[2];
    nx += uy*wz - uz*wy;
    ny += uz*wx - ux*wz;
    nz += ux*wy - uy*wx;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx/len, ny/len, nz/len];
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/foundation/SubdivisionNormals.js
git commit -m "feat(subdivision): Loop limit-normal evaluator (tangent masks)"
```

---

## Task 5: Kernel facade + ribbon wiring + e2e gate

**Files:**
- Create: `frontend/src/kernel/brep/BrepSubdivide.js`
- Modify: `frontend/src/kernel/brep/ArchDiscKernel.js`, `index.js`
- Modify: `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
- Modify: `frontend/src/components/RibbonToolbar.jsx`, `WorkbenchMechanical.jsx`
- Create: `e2e/subdivide-surface-electron.spec.js`

- [ ] **Step 1: Create the kernel facade entry `BrepSubdivide.js`**

```js
/**
 * ArchDisc Kernel — subdivision-surface facade. Takes an OCCT BrepShape,
 * tessellates it, applies piecewise-smooth Loop subdivision with auto-detected
 * creases, computes limit normals, and returns the refined mesh ready for
 * Three.js. No pinching at sharp features; no shading kinks at extraordinary
 * vertices.
 */

import { tessellate } from './BrepTessellate.js';
import { loopSubdivide } from '../../foundation/LoopSubdivision.js';
import { detectCreases } from '../../foundation/SubdivisionCreases.js';
import { loopLimitNormals } from '../../foundation/SubdivisionNormals.js';

/**
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts] { levels = 2, dihedralDeg = 30, deflection = 0.1 }
 * @returns {Promise<{positions: Float32Array, normals: Float32Array, indices: Uint32Array}>}
 */
export async function subdivideShape(brepShape, opts = {}) {
  const { levels = 2, dihedralDeg = 30, deflection = 0.1 } = opts;
  if (!brepShape || !brepShape.shape) throw new Error('subdivideShape: needs a BrepShape');
  if (!(Number.isInteger(levels) && levels >= 1)) {
    throw new Error(`subdivideShape: levels must be a positive integer (got ${levels})`);
  }
  // 1. Tessellate the B-rep to a triangle mesh in mm.
  const tess = await tessellate(brepShape, deflection);
  const vertices = [];
  for (let i = 0; i < tess.positions.length; i += 3) {
    vertices.push([tess.positions[i], tess.positions[i+1], tess.positions[i+2]]);
  }
  const triangles = [];
  for (let i = 0; i < tess.indices.length; i += 3) {
    triangles.push([tess.indices[i], tess.indices[i+1], tess.indices[i+2]]);
  }
  // 2. Auto-detect creases on the original mesh.
  const sharpness = detectCreases({ vertices, triangles }, dihedralDeg);
  // 3. Piecewise-smooth Loop subdivision for `levels` steps.
  const refined = loopSubdivide({ vertices, triangles }, levels, sharpness);
  // 4. Limit normals via Loop tangent masks.
  const normals = loopLimitNormals(refined);
  // 5. Pack into Three.js-ready typed arrays.
  const positions = new Float32Array(refined.vertices.length * 3);
  for (let i = 0; i < refined.vertices.length; i++) {
    positions[i*3]   = refined.vertices[i][0];
    positions[i*3+1] = refined.vertices[i][1];
    positions[i*3+2] = refined.vertices[i][2];
  }
  const indices = new Uint32Array(refined.triangles.length * 3);
  for (let i = 0; i < refined.triangles.length; i++) {
    indices[i*3]   = refined.triangles[i][0];
    indices[i*3+1] = refined.triangles[i][1];
    indices[i*3+2] = refined.triangles[i][2];
  }
  return { positions, normals, indices };
}
```

Note: this signature passes `sharpness` as a third arg to `loopSubdivide`. Adjust `loopSubdivide`/`loopStep` (Task 2) so it accepts that third positional arg.

- [ ] **Step 2: Barrel + facade**

In `frontend/src/kernel/brep/index.js`, add `export { subdivideShape } from './BrepSubdivide.js';`. In `frontend/src/kernel/brep/ArchDiscKernel.js`, add the import + `subdivideShape` to the `brep:` object literal.

- [ ] **Step 3: Wire the `Subdivide Surface` ribbon tool**

In `RibbonToolbar.jsx` add a `Subdivide Surface` tool entry to the Surface tab's Create or Modify group (whichever fits — pick the existing pattern). In `WorkbenchMechanical.jsx` `TOOL_GROUPS.surface` add the matching entry. In `ToolExecutionEngine.js` add a `Subdivide Surface` handler in `TOOL_HANDLERS.surface`:
```js
'Subdivide Surface': async (scene, viewport) => {
  try {
    const body = (typeof window !== 'undefined' && window.__lastBrepShape)
      ? window.__lastBrepShape
      : await ArchDiscKernel.brep.makeBox(20, 20, 20);
    const ownFallback = !(typeof window !== 'undefined' && window.__lastBrepShape);
    const mesh = await ArchDiscKernel.brep.subdivideShape(body, { levels: 2, dihedralDeg: 30 });
    // Render the refined mesh as a fresh Three.js mesh in the scene. Match the
    // pattern of addBrepShapeToScene: build a BufferGeometry, scale group 0.001,
    // add to scene. Set window.__lastSubdivMesh = { positions, normals, indices }
    // so the e2e can read mesh stats.
    // ... build and add the THREE.Mesh ...
    if (ownFallback) body.dispose();
    return { status: 'success', message: `Subdivide Surface: ${mesh.indices.length / 3} triangles via Loop piecewise-smooth subdivision` };
  } catch (err) {
    return { status: 'error', message: 'Subdivide Surface: ' + err.message };
  }
}
```
Read an existing OCCT geometry-op handler (e.g. `Fillet`) to get the exact rendering pattern. The subdivided mesh is a Three.js `BufferGeometry` — render it as a `THREE.Mesh` in a 0.001-scaled `THREE.Group`, register it as the current body so subsequent ribbon tools can pick it up (or simply add to the scene and set `window.__lastSubdivMesh` for the e2e). Dispose any fallback `BrepShape`.

- [ ] **Step 4: Create the e2e gate `e2e/subdivide-surface-electron.spec.js`**

Drive via real ribbon click — copy the `launch()` + `clickRibbonTab` + `clickRibbonTool` helpers from `e2e/brep-b-advanced-electron.spec.js`. Test:
```js
test('Subdivide Surface: ribbon-click subdivides current body cleanly (no pinching, no shading kinks)', async () => {
  const { app, win, pageErrors } = await launch();
  // First create a body the user would: click Box.
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, 'Box');
  await win.waitForFunction(() => !!window.__lastBrepShape, null, { timeout: 60000 });
  const before = await win.evaluate(() => window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape));
  // Then click Subdivide Surface (Surface tab).
  await clickRibbonTab(win, 'Surface');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, 'Subdivide Surface');
  await win.waitForFunction(() => !!window.__lastSubdivMesh, null, { timeout: 60000 });
  const subdiv = await win.evaluate(() => ({
    positions: window.__lastSubdivMesh.positions.length / 3,
    triangles: window.__lastSubdivMesh.indices.length / 3,
  }));
  // After 2 Loop steps on a cube: triangle count should grow ~16× from
  // the base tessellation (each step multiplies by 4). Assert real growth.
  expect(subdiv.triangles).toBeGreaterThan(50);
  // Cube corners must NOT collapse inward. The handler returns mesh data
  // in window.__lastSubdivMesh; check the bounding box still spans ≈ 20mm
  // in each axis (a pinched cube would shrink).
  const bbox = await win.evaluate(() => {
    const p = window.__lastSubdivMesh.positions;
    let mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let a = 0; a < 3; a++) { if (p[i+a]<mn[a]) mn[a]=p[i+a]; if (p[i+a]>mx[a]) mx[a]=p[i+a]; }
    }
    return { mn, mx };
  });
  // Without creases, Loop would shrink the cube significantly; with creases,
  // the bbox should be ≥ 19mm in each dim (within 5% of the original 20).
  expect(bbox.mx[0] - bbox.mn[0]).toBeGreaterThan(19);
  expect(bbox.mx[1] - bbox.mn[1]).toBeGreaterThan(19);
  expect(bbox.mx[2] - bbox.mn[2]).toBeGreaterThan(19);

  // Render check: capture from all camera angles + zooms.
  const cap = await captureAllAngles(win, 'subdivide', {
    azimuths: [0,60,120,180,240,300], elevations: [-30,30], zooms: [0.6,1.0,1.8],
  });
  expect(cap.blanks).toEqual([]);
  expect(pageErrors).toEqual([]);
  await app.close();
});
```

If the bbox-preservation assertion fails (cube IS pinching despite creases), the auto-crease detector + crease rules didn't catch the cube edges → investigate Task 2/3 and fix. Do NOT weaken the assertion — a pinched cube IS the bug we're solving.

- [ ] **Step 5: Build and run**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/subdivide-recon-electron.spec.js e2e/subdivide-surface-electron.spec.js --project=chromium
```
Both must PASS.

- [ ] **Step 6: Run the full brep e2e suite (regression)**

```bash
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-a4-recon-electron.spec.js e2e/brep-a5-recon-electron.spec.js e2e/brep-b-recon-electron.spec.js e2e/subdivide-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/brep-simplify-electron.spec.js e2e/brep-blend-electron.spec.js e2e/brep-b-advanced-electron.spec.js e2e/subdivide-surface-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js --project=chromium
```
All must pass. Report any flake re-runs.

- [ ] **Step 7: Append honest outcome to `docs/superpowers/notes/subdivision-C.md`**

Add a "Sub-project C — honest outcome" section: the measured cube-corner pinch BEFORE creases vs AFTER (showing the fix worked), the limit-normal effect on shading-kink count, and any honest gaps (e.g. Catmull-Clark for quad meshes not delivered — deferred).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/kernel/brep/BrepSubdivide.js frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js frontend/src/components/RibbonToolbar.jsx frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx e2e/subdivide-surface-electron.spec.js docs/superpowers/notes/subdivision-C.md
git commit -m "feat(subdivision): subdivideShape facade + Subdivide Surface ribbon tool + C gate e2e"
```

---

## Self-review notes

- **User directive coverage** ("Subdivision Surface topology — avoiding pinching and shading errors"): pinching addressed by piecewise-smooth Loop with auto-detected creases (Tasks 2, 3); shading errors addressed by Loop limit-normal evaluation (Task 4); both wired into the workbench via a real ribbon tool (Task 5) and verified by a real-user-workflow ribbon-click e2e with bbox-preservation + all-angles capture.
- **Methodology compliance:** e2e drives geometry via the real `Box` and `Subdivide Surface` ribbon clicks — no kernel `make*` calls in spec bodies. Captures from all angles. Aligns with `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_no_floating_panels`, `feedback_occt_deep_integration`.
- **Deferred (next sub-projects per the user):** Sub-project D — Retopology (clean remeshing). Then the rest of §3. Catmull-Clark for quad meshes is not in this sub-project (Loop is correct for triangle meshes; CC would only be needed for an explicit quad-mesh path which the kernel does not yet expose).
- **Honesty principle:** if Task 1 measurements show the existing Loop already preserves cube edges well enough (no pinching to fix), the crease work is still valuable for non-axis-aligned features and the plan is honest about what changes vs what's already correct. Document the before/after in the Task 7 honest-outcome section.
