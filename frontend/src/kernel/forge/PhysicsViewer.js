/**
 * ArchDisc Forge — PhysicsViewer (Forge-12b)
 *
 * Composer that wires a Forge solver result (dynamic / CFD / nonlinear) into
 * a `MotionPlayer` ready for the Three.js viewport. There is no React UI in
 * this slice — `PhysicsViewer` is the plain-JS plumbing the renderer reaches
 * for. The contract is:
 *
 *   const { player, mesh, colorbar } = buildPhysicsViewer({
 *     result, baseHandle, mode: 'dynamic' | 'cfd' | 'nonlinear',
 *     three, fea: optional `forge.fea` overload,
 *   });
 *
 * `player` is a `MotionPlayer`; `mesh` is the Three.js Mesh with displaced
 * positions; `colorbar` is a small descriptor `{ min, max, palette, label }`
 * the renderer can hand to its colorbar widget.
 *
 * The viewer calls `forge.tessellate(baseHandle)` exactly once to build the
 * base mesh — every animation frame mutates the same buffer rather than
 * re-tessellating. That's what makes the showcase real-time even on a
 * 100k-triangle part.
 */

import { MotionPlayer } from './MotionPlayer.js';
import { getForge } from './index.js';

/**
 * Map a per-node value (length nodeCount) onto per-vertex value (length
 * vertexCount) using a nearest-node lookup against the OCCT tessellation's
 * position attribute. Simple O(nodes × verts) — acceptable for the typical
 * smoke-test mesh (≤ 1000 vertices), and the renderer can cache the index
 * map between frames.
 */
export function buildNodeToVertexMap({ meshPositions, nodes }) {
  const V = meshPositions.length / 3;
  const N = nodes.length / 3;
  const out = new Uint32Array(V);
  for (let v = 0; v < V; v++) {
    const vx = meshPositions[3 * v];
    const vy = meshPositions[3 * v + 1];
    const vz = meshPositions[3 * v + 2];
    let bestId = 0, bestD = Infinity;
    for (let n = 0; n < N; n++) {
      const dx = nodes[3 * n]     - vx;
      const dy = nodes[3 * n + 1] - vy;
      const dz = nodes[3 * n + 2] - vz;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < bestD) { bestD = d; bestId = n; }
    }
    out[v] = bestId;
  }
  return out;
}

/**
 * Convert a (per-FEA-node) displacement array into a per-vertex displacement
 * array of length 3·vertexCount, using the precomputed node-to-vertex map.
 */
export function expandNodalToVertex(nodalU, nodeToVertex) {
  const V = nodeToVertex.length;
  const out = new Float64Array(3 * V);
  for (let v = 0; v < V; v++) {
    const n = nodeToVertex[v];
    out[3*v    ] = nodalU[3*n    ];
    out[3*v + 1] = nodalU[3*n + 1];
    out[3*v + 2] = nodalU[3*n + 2];
  }
  return out;
}

/**
 * Convert a (per-element scalar field) into a per-vertex scalar via
 * nearest-node lookup. For the brick-grid mesher we'd ideally smooth across
 * shared edges; for the smoke / showcase we keep the cheaper version.
 */
export function expandScalarToVertex(elemValues, mesh, nodeToVertex) {
  // Map elem → first node in its hex (cheap proxy). Then nodeToVertex.
  const N = nodeToVertex.length;
  const nodeValues = new Float32Array(mesh.nodes.length / 3);
  const nCount = new Uint32Array(mesh.nodes.length / 3);
  const elemNodeCount = mesh.elemNodeCount || 8;
  const E = mesh.tets.length / elemNodeCount;
  for (let e = 0; e < E; e++) {
    for (let q = 0; q < elemNodeCount; q++) {
      const nid = mesh.tets[e * elemNodeCount + q];
      nodeValues[nid] += elemValues[e];
      nCount[nid]++;
    }
  }
  for (let i = 0; i < nodeValues.length; i++) {
    if (nCount[i] > 0) nodeValues[i] /= nCount[i];
  }
  const out = new Float32Array(N);
  for (let v = 0; v < N; v++) out[v] = nodeValues[nodeToVertex[v]];
  return out;
}

/**
 * Build a colorbar descriptor for the renderer. min/max are the global
 * scalar bounds across all frames; palette and label match what the
 * MotionPlayer paints.
 */
export function buildColorbar({ min, max, palette = 'viridis', label = '' }) {
  return Object.freeze({ min, max, palette, label });
}

/**
 * Main composer. Returns `{ player, mesh, colorbar, nodeToVertex }`.
 *
 * @param {object} cfg
 * @param {object} cfg.result — Forge solver output (dynamic / CFD / nonlinear).
 * @param {number|object} cfg.baseHandle — OCCT shape handle OR a pre-built
 *   tessellation `{ positions, normals, indices }`.
 * @param {object} cfg.feaMesh — FEA mesh from `forge.fea.meshFromBrep` (only
 *   needed for `dynamic` / `nonlinear` modes).
 * @param {'dynamic'|'cfd'|'nonlinear'} cfg.mode
 * @param {object} cfg.three — Three.js module.
 * @param {object} [cfg.forge] — override `getForge()` (for tests).
 */
export function buildPhysicsViewer({ result, baseHandle, feaMesh,
                                     mode, three, forge = null }) {
  if (!three) throw new Error('[PhysicsViewer] three module required');
  const f = forge || getForge();

  // 1. Tessellate (once) — or accept a pre-tessellated mesh for tests.
  const tess = (typeof baseHandle === 'number')
    ? f.tessellate(baseHandle, 0.1, 0.5)
    : baseHandle;

  // 2. Build the Three.js mesh.
  const geom = new three.BufferGeometry();
  geom.setAttribute('position', new three.BufferAttribute(new Float32Array(tess.positions), 3));
  if (tess.normals && tess.normals.length) {
    geom.setAttribute('normal', new three.BufferAttribute(new Float32Array(tess.normals), 3));
  }
  if (tess.indices && tess.indices.length) {
    geom.setIndex(new three.BufferAttribute(new Uint32Array(tess.indices), 1));
  }
  const N = tess.positions.length / 3;
  geom.setAttribute('color', new three.BufferAttribute(new Float32Array(3 * N).fill(1), 3));
  const material = new three.MeshStandardMaterial({ vertexColors: true });
  const mesh = new three.Mesh(geom, material);

  // 3. Build per-mode frame arrays.
  let frames = [];
  let scalarFrames = [];
  let times = null;
  let colorLabel = '';
  let nodeToVertex = null;

  if (mode === 'dynamic') {
    if (!feaMesh) throw new Error('[PhysicsViewer] feaMesh required for dynamic mode');
    nodeToVertex = buildNodeToVertexMap({
      meshPositions: tess.positions, nodes: feaMesh.nodes,
    });
    frames = result.displacements.map((u) =>
      expandNodalToVertex(u, nodeToVertex));
    // Use the per-element max-stress envelope (same for every frame — gives a
    // stable colour bar over the dynamic showcase).
    const envScalar = expandScalarToVertex(result.maxStressEnvelope, feaMesh, nodeToVertex);
    scalarFrames = frames.map(() => envScalar);
    times = Array.from(result.times || []);
    colorLabel = 'von-Mises stress envelope (Pa)';
  } else if (mode === 'nonlinear') {
    if (!feaMesh) throw new Error('[PhysicsViewer] feaMesh required for nonlinear mode');
    nodeToVertex = buildNodeToVertexMap({
      meshPositions: tess.positions, nodes: feaMesh.nodes,
    });
    frames = result.stepDisplacements.map((u) =>
      expandNodalToVertex(u, nodeToVertex));
    // Scalar = displacement magnitude per vertex per frame.
    scalarFrames = frames.map((vu) => {
      const N_ = vu.length / 3;
      const s = new Float32Array(N_);
      for (let v = 0; v < N_; v++) {
        const dx = vu[3*v], dy = vu[3*v + 1], dz = vu[3*v + 2];
        s[v] = Math.sqrt(dx*dx + dy*dy + dz*dz);
      }
      return s;
    });
    colorLabel = '|displacement| (m)';
  } else if (mode === 'cfd') {
    // CFD result has no displacement — we animate a static mesh with a
    // colour-only field (velocity magnitude per vertex). MotionPlayer still
    // applies "displacements" but they're zero per frame. We invent two
    // frames so MotionPlayer's "≥ 2" invariant holds — the renderer can
    // still drive it for showcase purposes (e.g. crossfade between
    // velocity and pressure colour modes).
    const zero = new Float64Array(tess.positions.length);
    frames = [zero, zero];
    const vMag = new Float32Array(N);
    // result.u/v/w are per CFD-cell, not per mesh vertex; for the showcase
    // we just take the magnitude of the cell at the closest centre. This
    // is honest-up: a proper CFD-on-BRep coupling is a follow-up slice;
    // for now the CFD showcase paints a flat colour by the global maxV.
    for (let v = 0; v < N; v++) vMag[v] = result.maxVelocity;
    scalarFrames = [vMag, vMag];
    colorLabel = 'velocity (m/s)';
  } else {
    throw new Error(`[PhysicsViewer] unsupported mode: ${mode}`);
  }

  // 4. Build the MotionPlayer.
  const player = new MotionPlayer({
    baseMesh: mesh,
    frames,
    scalarFrames,
    times,
    three,
  });

  // 5. Colorbar bounds.
  let smin = Infinity, smax = -Infinity;
  for (const sf of scalarFrames) {
    for (const s of sf) { if (s < smin) smin = s; if (s > smax) smax = s; }
  }
  if (!isFinite(smin)) smin = 0;
  if (!isFinite(smax)) smax = 1;
  const colorbar = buildColorbar({ min: smin, max: smax, palette: 'viridis',
                                   label: colorLabel });

  return { player, mesh, colorbar, nodeToVertex };
}

export default {
  buildPhysicsViewer,
  buildNodeToVertexMap,
  expandNodalToVertex,
  expandScalarToVertex,
  buildColorbar,
};
