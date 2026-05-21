/**
 * ArchDisc Kernel — Catmull-Clark subdivision facade.
 *
 * Pipeline:
 *   1. Tessellate exact B-rep → triangle mesh (mm).
 *   2. Weld duplicate vertices (tessellation emits one copy per face).
 *   3. Convert triangles → quads via trianglesToQuads (near-coplanar pairing).
 *   4. Auto-detect crease edges on the QUAD mesh (inline quad-edge adjacency).
 *   5. Run catmullClarkSubdivide (levels, sharpness).
 *   6. Compute per-vertex normals by area-weighted face-normal averaging.
 *      NOTE: True CC limit-normal masks differ from Loop's tangent masks.
 *      Face-normal averaging is a sensible, simple default for production use.
 *      Document this gap: exact CC limit normals are NOT implemented.
 *   7. Return { positions, normals, indices, stats }.
 *      Quad faces are split into 2 triangles each (diagonal A→C) for rendering.
 */

import { tessellate } from './BrepTessellate.js';
import { weldMesh } from '../../foundation/LoopSubdivision.js';
import {
  trianglesToQuads,
  catmullClarkSubdivide,
} from '../../foundation/CatmullClarkSubdivision.js';

// ── Quad-mesh crease detection ───────────────────────────────────────────────
// Adapted from SubdivisionCreases.js (triangle mesh) for quad meshes.
// Returns Map<edgeKey "a_b" (a<b), 1.0> for edges whose dihedral exceeds the
// threshold, plus all boundary edges.

function detectQuadCreases({ vertices, quads }, angleDeg = 30) {
  const cosThresh = Math.cos(angleDeg * Math.PI / 180);

  // Per-quad face normals (computed as average of the two diagonal cross-products
  // — robust for non-planar quads).
  const quadNormals = quads.map(([a, b, c, d]) => {
    const va = vertices[a], vb = vertices[b], vc = vertices[c], vd = vertices[d];
    // Diagonal 1: d0 = c-a, d1 = d-b
    const d0x = vc[0] - va[0], d0y = vc[1] - va[1], d0z = vc[2] - va[2];
    const d1x = vd[0] - vb[0], d1y = vd[1] - vb[1], d1z = vd[2] - vb[2];
    const nx = d0y * d1z - d0z * d1y;
    const ny = d0z * d1x - d0x * d1z;
    const nz = d0x * d1y - d0y * d1x;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  });

  const sharpKey = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`);
  const ekey     = (i, j) => (i < j ? `${i},${j}` : `${j},${i}`);

  // Build edge → adjacent quad list.
  const edgeAdj = new Map();
  quads.forEach(([a, b, c, d], qi) => {
    const edges = [[a, b], [b, c], [c, d], [d, a]];
    for (const [u, v] of edges) {
      if (u === v) continue; // skip degenerate edges
      const k = ekey(u, v);
      if (!edgeAdj.has(k)) edgeAdj.set(k, []);
      edgeAdj.get(k).push(qi);
    }
  });

  const sharpness = new Map();
  for (const [k, qIdxList] of edgeAdj) {
    if (qIdxList.length === 1) {
      // Boundary edge — always crease.
      sharpness.set(sharpKey(...k.split(',').map(Number)), 1.0);
      continue;
    }
    if (qIdxList.length !== 2) continue; // non-manifold
    const n0 = quadNormals[qIdxList[0]], n1 = quadNormals[qIdxList[1]];
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (dot < cosThresh) {
      sharpness.set(sharpKey(...k.split(',').map(Number)), 1.0);
    }
  }
  return sharpness;
}

// ── Face-normal averaging for per-vertex normals ─────────────────────────────
// CC limit-normal masks (different from Loop's) are not implemented here.
// Area-weighted face-normal averaging is used instead — adequate for real-time
// rendering and consistent with what BrepSubdivide.js does via loopLimitNormals.
function computeQuadNormals({ vertices, quads }) {
  const nV = vertices.length;
  const acc = new Float64Array(nV * 3); // accumulator
  const cnt = new Float64Array(nV);

  for (const [a, b, c, d] of quads) {
    const va = vertices[a], vb = vertices[b], vc = vertices[c], vd = vertices[d];
    // Split quad into 2 triangles for area-weighted normal.
    for (const [p0, p1, p2] of [[va, vb, vc], [va, vc, vd]]) {
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
      const wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nz = ux * wy - uy * wx;
      // Area = 0.5 * |n|; use unscaled cross-product for area weighting.
      for (const vi of [a, b, c, d]) {
        acc[vi * 3]     += nx;
        acc[vi * 3 + 1] += ny;
        acc[vi * 3 + 2] += nz;
        cnt[vi]++;
      }
    }
  }

  const normals = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const nx = acc[i * 3], ny = acc[i * 3 + 1], nz = acc[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3]     = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  }
  return normals;
}

// ─────────────────────────────────────────────────────────────────────────────
// catmullClarkShape — the facade entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catmull-Clark subdivision of an exact B-rep body.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]
 * @param {number} [opts.levels=2]          Number of CC steps.
 * @param {number} [opts.dihedralDeg=30]    Crease-detection threshold on the quad mesh (°).
 * @param {number} [opts.quadAngleDeg=5]    Max dihedral for triangle→quad pairing (°).
 * @param {number} [opts.deflection=0.5]    Tessellation deflection (mm).
 * @returns {Promise<{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   indices: Uint32Array,
 *   stats: {
 *     baseVerts: number, baseTris: number,
 *     weldedVerts: number,
 *     baseQuads: number, pairedQuads: number, degenerateQuads: number,
 *     refinedVerts: number, refinedQuads: number, refinedTris: number,
 *     creaseEdges: number
 *   }
 * }>}
 */
export async function catmullClarkShape(brepShape, opts = {}) {
  const {
    levels      = 2,
    dihedralDeg = 30,
    quadAngleDeg = 5,
    deflection  = 0.5,
  } = opts;

  if (!brepShape || !brepShape.shape) {
    throw new Error('catmullClarkShape: needs a BrepShape');
  }
  if (!(Number.isInteger(levels) && levels >= 1)) {
    throw new Error(`catmullClarkShape: levels must be a positive integer (got ${levels})`);
  }

  // ── 1. Tessellate B-rep → triangle mesh (mm) ──────────────────────────────
  const tess = await tessellate(brepShape, deflection);
  const baseVertices = [];
  for (let i = 0; i < tess.positions.length; i += 3) {
    baseVertices.push([tess.positions[i], tess.positions[i + 1], tess.positions[i + 2]]);
  }
  const baseTriangles = [];
  for (let i = 0; i < tess.indices.length; i += 3) {
    baseTriangles.push([tess.indices[i], tess.indices[i + 1], tess.indices[i + 2]]);
  }
  const baseTris = baseTriangles.length;

  // ── 2. Weld duplicate vertices ────────────────────────────────────────────
  const welded = weldMesh({ vertices: baseVertices, triangles: baseTriangles }, 1e-4);
  const weldedVerts = welded.vertices.length;

  // ── 3. Convert triangles → quads ─────────────────────────────────────────
  const quadMesh = trianglesToQuads(welded, quadAngleDeg);
  const baseQuads = quadMesh.quads.length;
  // Count how many quads are real pairs vs degenerate (tri-padded).
  let pairedQuads = 0, degenerateQuads = 0;
  for (const [a, b, c, d] of quadMesh.quads) {
    if (c === d) degenerateQuads++;
    else pairedQuads++;
  }

  // ── 4. Auto-detect creases on the quad mesh ───────────────────────────────
  const sharpness = detectQuadCreases(quadMesh, dihedralDeg);

  // ── 5. Run Catmull-Clark ───────────────────────────────────────────────────
  const refined = catmullClarkSubdivide(
    { vertices: quadMesh.vertices, quads: quadMesh.quads },
    levels,
    sharpness,
  );
  const refinedVerts = refined.vertices.length;
  const refinedQuads = refined.quads.length;

  // ── 6. Per-vertex normals (face-normal averaging) ─────────────────────────
  const normals = computeQuadNormals(refined);

  // ── 7. Pack typed arrays; split quads → 2 triangles for rendering ─────────
  const positions = new Float32Array(refinedVerts * 3);
  for (let i = 0; i < refinedVerts; i++) {
    positions[i * 3]     = refined.vertices[i][0];
    positions[i * 3 + 1] = refined.vertices[i][1];
    positions[i * 3 + 2] = refined.vertices[i][2];
  }

  // Split each quad (a,b,c,d) → triangles (a,b,c) + (a,c,d).
  const refinedTris = refinedQuads * 2;
  const indices = new Uint32Array(refinedTris * 3);
  let ii = 0;
  for (const [a, b, c, d] of refined.quads) {
    indices[ii++] = a; indices[ii++] = b; indices[ii++] = c;
    indices[ii++] = a; indices[ii++] = c; indices[ii++] = d;
  }

  return {
    positions,
    normals,
    indices,
    stats: {
      baseVerts:       baseVertices.length,
      baseTris,
      weldedVerts,
      baseQuads,
      pairedQuads,
      degenerateQuads,
      refinedVerts,
      refinedQuads,
      refinedTris,
      creaseEdges: sharpness.size,
    },
  };
}
