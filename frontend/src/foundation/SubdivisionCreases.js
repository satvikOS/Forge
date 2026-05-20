/**
 * ArchDisc Foundation — auto-detect crease edges of a triangle mesh by
 * dihedral angle. Sharp dihedral edges become creases in piecewise-smooth
 * Loop subdivision, preserving features (cube edges, fillet seams) that
 * a smooth subdivision would round off.
 *
 * Requires the mesh to be WELDED first (see weldMesh in LoopSubdivision.js)
 * so that adjacent triangles genuinely share vertex indices — without welding
 * each cube face has independent vertices and no inter-face edges exist.
 *
 * References:
 *   Hoppe H. et al. "Piecewise Smooth Surface Reconstruction." SIGGRAPH 1994.
 */

/**
 * Detect crease edges by dihedral angle threshold.
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 *   A WELDED mesh (adjacent triangles share vertex indices).
 * @param {number} [angleDeg=30]
 *   Dihedral threshold in degrees. Edges whose two adjacent face normals
 *   form an angle greater than this threshold are marked sharp.
 *   Default 30° correctly detects all 12 edges of a cube (dihedral 90°).
 * @param {{classifyConvexity?: boolean}} [opts]
 *   classifyConvexity (default false): if true, concave and convex edges
 *   are both detected as creases (same sharpness value) but the distinction
 *   is logged to console. When false the behaviour is identical — all sharp
 *   edges get sharpness 1.0 regardless of convexity.
 * @returns {Map<string, number>}
 *   Sharpness map ready for loopStep: edgeKey "a_b" (a<b) → sharpness (1.0).
 *   Boundary edges (only one adjacent triangle) always get sharpness 1.0.
 *   Non-manifold edges (3+ adjacent triangles) are silently skipped.
 */
export function detectCreases(mesh, angleDeg = 30, opts = {}) {
  const cosThresh = Math.cos(angleDeg * Math.PI / 180);
  const { vertices, triangles } = mesh;
  const classifyConvexity = !!(opts && opts.classifyConvexity);

  // ── Per-triangle normals ──────────────────────────────────────────────
  const triNormals = triangles.map(([a, b, c]) => {
    const va = vertices[a], vb = vertices[b], vc = vertices[c];
    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2];
    const wx = vc[0] - va[0], wy = vc[1] - va[1], wz = vc[2] - va[2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  });

  // ── Edge → adjacent triangle list ─────────────────────────────────────
  // edgeKey: "a_b" with a < b  (consistent with loopStep sharpness keys)
  const edgeAdj = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  triangles.forEach(([a, b, c], i) => {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = key(u, v);
      if (!edgeAdj.has(k)) edgeAdj.set(k, []);
      edgeAdj.get(k).push(i);
    }
  });

  // ── Classify edges ────────────────────────────────────────────────────
  const sharpness = new Map();
  for (const [k, tris] of edgeAdj) {
    if (tris.length === 1) {
      // Boundary edge — always a crease.
      sharpness.set(k, 1.0);
      continue;
    }
    if (tris.length !== 2) {
      // Non-manifold (3+ adjacent tris): skip silently.
      continue;
    }
    const n0 = triNormals[tris[0]];
    const n1 = triNormals[tris[1]];
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (dot < cosThresh) {
      // Dihedral angle exceeds threshold → sharp crease.
      if (classifyConvexity) {
        // Determine convexity: cross n0 × n1 relative to the edge direction.
        // Parse vertex indices from the key to get the edge midpoint direction.
        const us = k.indexOf('_');
        const va_idx = parseInt(k.slice(0, us), 10);
        const vb_idx = parseInt(k.slice(us + 1), 10);
        const va = vertices[va_idx], vb = vertices[vb_idx];
        const ex = vb[0] - va[0], ey = vb[1] - va[1], ez = vb[2] - va[2];
        // cross(n0, n1) · edge direction > 0 → convex; < 0 → concave
        const cx = n0[1] * n1[2] - n0[2] * n1[1];
        const cy = n0[2] * n1[0] - n0[0] * n1[2];
        const cz = n0[0] * n1[1] - n0[1] * n1[0];
        const convex = (cx * ex + cy * ey + cz * ez) > 0;
        // Both convex and concave get sharpness 1.0; convexity info is for
        // downstream callers who want to treat them differently.
        console.debug(`[SubdivisionCreases] edge ${k}: ${convex ? 'convex' : 'concave'} sharp (dot=${dot.toFixed(3)})`);
      }
      sharpness.set(k, 1.0);
    }
  }
  return sharpness;
}
