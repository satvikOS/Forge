/**
 * ArchDisc Foundation — Fluid-Structure-Interaction (one-way) coupling.
 *
 * Pipeline architecture for one-way FSI:
 *   1. Run a flow solver (PotentialFlow or NavierStokes2D) on a domain
 *      containing the body. Sample pressure on the body's surface.
 *   2. For each surface triangle of a tet mesh of the body, integrate
 *      the pressure × outward normal × area to produce a nodal force.
 *   3. Drive LinearTetFEM with those nodal forces + Dirichlet BCs.
 *
 * Two-way (strong) FSI would iterate steps 1-3 with the deformed body
 * geometry feeding back into the flow solve. That requires re-meshing
 * the flow domain each iteration — significant additional work and out
 * of scope for this MVP.
 *
 * The connector logic in this module is independent of which flow
 * solver supplies the pressure. The simplest test case applies a
 * UNIFORM pressure on a chosen face — which has a closed-form analytical
 * answer (cantilever under uniform distributed transverse load):
 *
 *     δ_tip = q · L⁴ / (8 · E · I)         (free end, distributed q)
 *
 * Here q = pressure × width (force per unit length along the beam).
 *
 * Functions:
 *   - surfaceFacesByNormal(mesh, dir, dotThresh, region?):
 *         find the boundary tris whose outward normal aligns with `dir`
 *   - tetMeshOutwardNormals(mesh):
 *         compute outward normals on every boundary triangle (sign
 *         determined by signed-volume sweep from any interior point)
 *   - applyPressureLoad(mesh, surfaceTris, pressureMPa):
 *         convert pressure × triangle area × normal into 3 nodal forces
 *         (one per triangle vertex, 1/3 of total)
 *   - solveOneWay(args): orchestrates {pressure source} + {structural
 *         FEM} into a deflection solve.
 */

import { solveLinearStatic } from './LinearTetFEM.js';

/**
 * For each tet's 4 faces, count how many tets share that face. Faces
 * shared by exactly one tet are boundary (manifold).
 *
 * @returns {Array<{tri: [v0,v1,v2], owner: tetIdx, faceIdx: 0|1|2|3}>}
 */
export function extractBoundaryFaces(mesh) {
  const TET_FACES = [
    [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3],
  ];
  const faceMap = new Map();
  for (let t = 0; t < mesh.tets.length; t++) {
    const tet = mesh.tets[t];
    for (let f = 0; f < 4; f++) {
      const fi = TET_FACES[f];
      const a = tet[fi[0]], b = tet[fi[1]], c = tet[fi[2]];
      const sorted = [a, b, c].sort((x, y) => x - y);
      const key = `${sorted[0]},${sorted[1]},${sorted[2]}`;
      const entry = faceMap.get(key);
      if (entry) entry.count++;
      else faceMap.set(key, { count: 1, verts: [a, b, c], owner: t, faceIdx: f });
    }
  }
  const boundary = [];
  for (const v of faceMap.values()) if (v.count === 1) {
    boundary.push({ tri: v.verts, owner: v.owner, faceIdx: v.faceIdx });
  }
  return boundary;
}

/**
 * Compute outward-pointing unit normals for boundary triangles.
 * Method: for each boundary triangle compute the geometric face normal,
 * then check sign by ensuring (centroid_outside − face_centroid) · n > 0
 * where centroid_outside is the boundary face vertex moved AWAY from the
 * interior tetrahedron's 4th vertex. (Equivalent to "the normal points
 * away from the 4th vertex of the owning tet".)
 */
export function computeBoundaryNormals(mesh, boundaryFaces) {
  const out = [];
  for (const bf of boundaryFaces) {
    const [i0, i1, i2] = bf.tri;
    const tet = mesh.tets[bf.owner];
    const fourth = tet.find(v => v !== i0 && v !== i1 && v !== i2);
    const p0 = mesh.vertices[i0];
    const p1 = mesh.vertices[i1];
    const p2 = mesh.vertices[i2];
    const p3 = mesh.vertices[fourth];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // Triangle face centroid
    const cx = (p0[0] + p1[0] + p2[0]) / 3;
    const cy = (p0[1] + p1[1] + p2[1]) / 3;
    const cz = (p0[2] + p1[2] + p2[2]) / 3;
    // Outward = away from 4th vertex of owning tet.
    const dx = cx - p3[0], dy = cy - p3[1], dz = cz - p3[2];
    if (nx * dx + ny * dy + nz * dz < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    out.push({
      tri: bf.tri,
      normal: [nx, ny, nz],
      centroid: [cx, cy, cz],
      area: 0.5 * len,
    });
  }
  return out;
}

/**
 * Filter boundary faces by outward-normal direction.
 * Keep face if (n · dir) ≥ dotThreshold.
 */
export function selectFacesByNormal(boundaryWithNormals, dir, dotThreshold = 0.7) {
  const [dx, dy, dz] = dir;
  return boundaryWithNormals.filter(f => {
    const dot = f.normal[0] * dx + f.normal[1] * dy + f.normal[2] * dz;
    return dot >= dotThreshold;
  });
}

/**
 * Convert a uniform pressure on a set of triangles into nodal force
 * loads suitable for solveLinearStatic.
 *
 * Force per triangle = pressure · area · outward_normal
 * Distributed equally to the 3 vertices (consistent linear-tet load
 * lumping for a uniform pressure field).
 *
 * Sign convention: positive `pressureMPa` pushes the face INWARD (in
 * the −normal direction), since fluid pressure compresses the body.
 *
 * @returns {Array<{node, dof, value}>}
 */
export function uniformPressureToNodalLoads(facesWithNormals, pressureMPa) {
  const map = new Map();   // node-dof key → accumulated force
  for (const f of facesWithNormals) {
    const F = pressureMPa * f.area;     // total scalar force on this triangle
    // Force vector points inward → opposite of outward normal
    const fx = -F * f.normal[0];
    const fy = -F * f.normal[1];
    const fz = -F * f.normal[2];
    for (const node of f.tri) {
      for (let d = 0; d < 3; d++) {
        const key = node * 3 + d;
        const v = (map.get(key) || 0);
        const inc = (d === 0 ? fx : d === 1 ? fy : fz) / 3;
        map.set(key, v + inc);
      }
    }
  }
  const loads = [];
  for (const [key, value] of map) {
    if (Math.abs(value) > 1e-12) {
      loads.push({ node: Math.floor(key / 3), dof: key % 3, value });
    }
  }
  return loads;
}

/**
 * One-way FSI solve with a uniform-pressure source.
 *
 * @param {object} args
 * @param {TetMesh} args.mesh
 * @param {object} args.material
 * @param {Array<number>} args.fixedNodes
 * @param {[number,number,number]} args.pressureFaceNormal - which face
 *           to apply pressure to (e.g. [0,1,0] for +y face)
 * @param {number} args.pressureMPa
 * @param {number} args.dotThreshold
 * @returns {object} {
 *    boundaryFaces, loadedFaces, totalLoad, fem
 * }
 */
export function solveUniformPressureFSI({
  mesh, material, fixedNodes,
  pressureFaceNormal, pressureMPa,
  dotThreshold = 0.7,
}) {
  const boundary = extractBoundaryFaces(mesh);
  const withNormals = computeBoundaryNormals(mesh, boundary);
  const loadedFaces = selectFacesByNormal(withNormals, pressureFaceNormal, dotThreshold);
  const loads = uniformPressureToNodalLoads(loadedFaces, pressureMPa);

  // Total applied force vector (summed over loaded faces) — diagnostic
  let totalFx = 0, totalFy = 0, totalFz = 0;
  for (const f of loadedFaces) {
    totalFx += -pressureMPa * f.area * f.normal[0];
    totalFy += -pressureMPa * f.area * f.normal[1];
    totalFz += -pressureMPa * f.area * f.normal[2];
  }

  const fem = solveLinearStatic({ mesh, material, fixedNodes, loads });

  return {
    boundaryTriCount: boundary.length,
    loadedFaceCount: loadedFaces.length,
    loadedTotalAreaMm2: loadedFaces.reduce((s, f) => s + f.area, 0),
    totalLoadVectorN: [totalFx, totalFy, totalFz],
    fem,
  };
}
