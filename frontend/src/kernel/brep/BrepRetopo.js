/**
 * ArchDisc Kernel — retopology facade (Botsch-Kobbelt 2004 isotropic remeshing).
 *
 * 1. Tessellate the OCCT B-rep to a triangle mesh (mm).
 * 2. Weld duplicate vertices (OCCT tessellation duplicates per-face).
 * 3. Isotropic remeshing — split/collapse/flip/tangential-relax.
 * 4. Compute per-vertex normals via Loop limit-normal evaluator.
 * 5. Return Three.js-ready typed arrays + stats.
 */

import { tessellate } from './BrepTessellate.js';
import { weldMesh } from '../../foundation/LoopSubdivision.js';
import { isotropicRemesh } from '../../foundation/IsotropicRemesh.js';
import { loopLimitNormals } from '../../foundation/SubdivisionNormals.js';

/**
 * Retopologise an OCCT B-rep shape via isotropic remeshing.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]
 * @param {number}  [opts.targetEdgeLength]   Target edge length L (mm). Omit or 0 for auto (mean).
 * @param {number}  [opts.iterations=5]       Number of B-K iterations (1–10).
 * @param {number}  [opts.deflection=0.5]     OCCT tessellation deflection (mm).
 * @returns {Promise<{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   indices: Uint32Array,
 *   stats: {
 *     baseVerts: number, baseTris: number,
 *     weldedVerts: number,
 *     retopoVerts: number, retopoTris: number
 *   }
 * }>}
 */
export async function retopoShape(brepShape, opts = {}) {
  const { targetEdgeLength, iterations = 5, deflection = 0.5 } = opts;

  if (!brepShape || !brepShape.shape) {
    throw new Error('retopoShape: needs a BrepShape');
  }
  if (!(Number.isInteger(iterations) && iterations >= 1)) {
    throw new Error(`retopoShape: iterations must be a positive integer (got ${iterations})`);
  }

  // 1. Tessellate OCCT B-rep → triangle mesh (positions in mm).
  const tess = await tessellate(brepShape, deflection);
  const baseVertices = [];
  for (let i = 0; i < tess.positions.length; i += 3) {
    baseVertices.push([tess.positions[i], tess.positions[i + 1], tess.positions[i + 2]]);
  }
  const baseTriangles = [];
  for (let i = 0; i < tess.indices.length; i += 3) {
    baseTriangles.push([tess.indices[i], tess.indices[i + 1], tess.indices[i + 2]]);
  }
  const baseStats = { baseVerts: baseVertices.length, baseTris: baseTriangles.length };

  // 2. Weld duplicate vertices — OCCT tessellation gives one copy per face.
  const welded = weldMesh({ vertices: baseVertices, triangles: baseTriangles }, 1e-4);

  // 3. Isotropic remeshing (Botsch-Kobbelt 2004).
  //    targetEdgeLength=0 or omitted → auto-compute mean edge length of input.
  const tgt = (typeof targetEdgeLength === 'number' && targetEdgeLength > 0)
    ? targetEdgeLength
    : undefined;

  const remeshed = isotropicRemesh(welded, { targetEdgeLength: tgt, iterations });

  // 4. Loop limit-normals for smooth shading.
  const normals = loopLimitNormals(remeshed);

  // 5. Pack into Three.js-ready typed arrays (positions in mm; caller scales 0.001 → metres).
  const positions = new Float32Array(remeshed.vertices.length * 3);
  for (let i = 0; i < remeshed.vertices.length; i++) {
    positions[i * 3]     = remeshed.vertices[i][0];
    positions[i * 3 + 1] = remeshed.vertices[i][1];
    positions[i * 3 + 2] = remeshed.vertices[i][2];
  }
  const indices = new Uint32Array(remeshed.triangles.length * 3);
  for (let i = 0; i < remeshed.triangles.length; i++) {
    indices[i * 3]     = remeshed.triangles[i][0];
    indices[i * 3 + 1] = remeshed.triangles[i][1];
    indices[i * 3 + 2] = remeshed.triangles[i][2];
  }

  return {
    positions,
    normals,
    indices,
    stats: {
      ...baseStats,
      weldedVerts: welded.vertices.length,
      retopoVerts: remeshed.vertices.length,
      retopoTris:  remeshed.triangles.length,
    },
  };
}
