/**
 * ArchDisc Kernel — sophisticated subdivision-surface facade.
 *
 * 1. Tessellate the B-rep to a triangle mesh (mm).
 * 2. Weld duplicate vertices (tessellation duplicates per-face) so
 *    adjacent triangles share indices.
 * 3. Auto-detect crease edges by dihedral threshold.
 * 4. Piecewise-smooth Loop subdivision for `levels` steps — preserves
 *    sharp features at corners (k≥3 → corner rule) and edges (k=2 →
 *    crease rule); smooth interior elsewhere.
 * 5. Compute Loop limit-normals via tangent masks — clean shading at
 *    extraordinary vertices.
 * 6. Return Three.js-ready typed arrays.
 */

import { tessellate } from './BrepTessellate.js';
import { loopSubdivide, weldMesh } from '../../foundation/LoopSubdivision.js';
import { detectCreases } from '../../foundation/SubdivisionCreases.js';
import { loopLimitNormals } from '../../foundation/SubdivisionNormals.js';

/**
 * Subdivide a B-rep shape with piecewise-smooth Loop subdivision.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]
 * @param {number} [opts.levels=2]         Number of Loop subdivision steps.
 * @param {number} [opts.dihedralDeg=30]   Dihedral angle threshold for crease detection.
 * @param {number} [opts.deflection=0.5]   tessellation deflection (mm).
 * @returns {Promise<{
 *   positions: Float32Array,
 *   normals: Float32Array,
 *   indices: Uint32Array,
 *   stats: {
 *     baseVerts: number, baseTris: number,
 *     weldedVerts: number,
 *     refinedVerts: number, refinedTris: number,
 *     creaseEdges: number
 *   }
 * }>}
 */
export async function subdivideShape(brepShape, opts = {}) {
  const { levels = 2, dihedralDeg = 30, deflection = 0.5 } = opts;
  if (!brepShape || !brepShape.shape) {
    throw new Error('subdivideShape: needs a BrepShape');
  }
  if (!(Number.isInteger(levels) && levels >= 1)) {
    throw new Error(`subdivideShape: levels must be a positive integer (got ${levels})`);
  }

  // 1. Tessellate B-rep → triangle mesh (positions in mm).
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

  // 2. Weld duplicate vertices — tessellation gives one copy per face
  //    (e.g. 24 verts for a cube instead of 8).  After welding the 8 cube
  //    corners are shared, so dihedral-based crease detection can see the
  //    90° face-angle on every cube edge.  Tolerance 1e-4 mm is wide enough
  //    for tessellation coordinate noise while tight enough not to merge
  //    distinct vertices on small features.
  const welded = weldMesh({ vertices: baseVertices, triangles: baseTriangles }, 1e-4);

  // 3. Auto-detect sharp edges by dihedral angle (cube edges = 90° >> 30°).
  const sharpness = detectCreases(welded, dihedralDeg);

  // 4. Piecewise-smooth Loop subdivision (Hoppe et al. 1994).
  //    Corner vertices (k≥3 incident sharp edges) stay exactly in place.
  //    Crease vertices (k=2) follow the crease rule. Interior vertices smooth.
  const refined = loopSubdivide(welded, levels, sharpness);

  // 5. Loop limit-normals via tangent masks — smooth normals even at
  //    extraordinary vertices (valence ≠ 6, e.g. cube corners valence=3).
  const normals = loopLimitNormals(refined);

  // 6. Pack into Three.js-ready typed arrays (positions still in mm;
  //    the caller scales 0.001 to convert to metres for Three.js).
  const positions = new Float32Array(refined.vertices.length * 3);
  for (let i = 0; i < refined.vertices.length; i++) {
    positions[i * 3]     = refined.vertices[i][0];
    positions[i * 3 + 1] = refined.vertices[i][1];
    positions[i * 3 + 2] = refined.vertices[i][2];
  }
  const indices = new Uint32Array(refined.triangles.length * 3);
  for (let i = 0; i < refined.triangles.length; i++) {
    indices[i * 3]     = refined.triangles[i][0];
    indices[i * 3 + 1] = refined.triangles[i][1];
    indices[i * 3 + 2] = refined.triangles[i][2];
  }

  return {
    positions,
    normals,
    indices,
    stats: {
      ...baseStats,
      weldedVerts: welded.vertices.length,
      refinedVerts: refined.vertices.length,
      refinedTris:  refined.triangles.length,
      creaseEdges:  sharpness.size,
    },
  };
}
