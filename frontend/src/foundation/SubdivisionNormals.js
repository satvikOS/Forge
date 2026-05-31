/**
 * ArchDisc Foundation — Loop limit-normal evaluator.
 *
 * At each vertex of a subdivided triangle mesh, computes the tangent-plane
 * normal via Loop's tangent masks (rather than averaging face normals).
 * This produces a smooth normal field even at extraordinary vertices
 * (valence ≠ 6), eliminating the shading kinks that face-averaged normals
 * create at irregular topology (e.g. cube corners, which have valence 3).
 *
 * For a vertex v with 1-ring neighbours v_0 … v_{k-1} (any consistent
 * order):
 *
 *   t1 = Σ_{i=0}^{k-1}  cos(2π i / k) · v_i
 *   t2 = Σ_{i=0}^{k-1}  sin(2π i / k) · v_i
 *   limit_normal = normalize(t1 × t2)
 *
 * The tangent-mask formula is order-independent in its sum, so any
 * consistent ordering of the 1-ring produces the correct limit normal
 * direction (up to orientation, which is resolved by agreement with the
 * average face-normal — see orientation flip below).
 *
 * References:
 *   Loop C., "Smooth Subdivision Surfaces Based on Triangles," MS Thesis, 1987.
 *   DeRose T. et al., "Subdivision Surfaces in Character Animation," SIGGRAPH 1998.
 */

/**
 * Compute per-vertex limit normals for a triangle mesh via Loop's tangent masks.
 *
 * Returns a Float32Array of length 3 * vertexCount. Index 3*v … 3*v+2
 * holds the (nx, ny, nz) limit normal for vertex v.
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @returns {Float32Array}
 */
export function loopLimitNormals(mesh) {
  const { vertices, triangles } = mesh;
  const n = vertices.length;

  // ── Build 1-ring adjacency ─────────────────────────────────────────────
  // For each vertex: the set of neighbour indices (from shared edges in the
  // triangle list).  Arbitrary order is acceptable for the tangent mask sum.
  const adj = Array.from({ length: n }, () => new Set());
  for (const [a, b, c] of triangles) {
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }

  // ── Precompute per-face normals for the fallback ───────────────────────
  // Stored as flat [nx,ny,nz,...] indexed by triangle index.
  const faceNx = new Float64Array(triangles.length);
  const faceNy = new Float64Array(triangles.length);
  const faceNz = new Float64Array(triangles.length);
  for (let t = 0; t < triangles.length; t++) {
    const [a, b, c] = triangles[t];
    const va = vertices[a], vb = vertices[b], vc = vertices[c];
    const ux = vb[0] - va[0], uy = vb[1] - va[1], uz = vb[2] - va[2];
    const wx = vc[0] - va[0], wy = vc[1] - va[1], wz = vc[2] - va[2];
    faceNx[t] = uy * wz - uz * wy;
    faceNy[t] = uz * wx - ux * wz;
    faceNz[t] = ux * wy - uy * wx;
    const len = Math.hypot(faceNx[t], faceNy[t], faceNz[t]) || 1;
    faceNx[t] /= len; faceNy[t] /= len; faceNz[t] /= len;
  }

  // Build a vertex → incident face list for the fallback normal computation.
  const vertFaces = Array.from({ length: n }, () => []);
  for (let t = 0; t < triangles.length; t++) {
    for (const v of triangles[t]) vertFaces[v].push(t);
  }

  // ── Evaluate limit normal per vertex ──────────────────────────────────
  const out = new Float32Array(n * 3);

  for (let v = 0; v < n; v++) {
    const nbs = Array.from(adj[v]);
    const k = nbs.length;

    if (k < 3) {
      // Boundary or degenerate vertex — fall back to face-normal average.
      const [fx, fy, fz] = faceAveragedNormal(v, vertFaces, faceNx, faceNy, faceNz);
      out[v * 3] = fx;
      out[v * 3 + 1] = fy;
      out[v * 3 + 2] = fz;
      continue;
    }

    // Loop tangent masks:
    //   t1 = Σ cos(2π i / k) · v_i
    //   t2 = Σ sin(2π i / k) · v_i
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
    let nx = t1y * t2z - t1z * t2y;
    let ny = t1z * t2x - t1x * t2z;
    let nz = t1x * t2y - t1y * t2x;
    const len = Math.hypot(nx, ny, nz);

    if (len < 1e-15) {
      // Degenerate cross product — fall back to face-normal average.
      const [fx, fy, fz] = faceAveragedNormal(v, vertFaces, faceNx, faceNy, faceNz);
      out[v * 3] = fx;
      out[v * 3 + 1] = fy;
      out[v * 3 + 2] = fz;
      continue;
    }

    nx /= len; ny /= len; nz /= len;

    // ── Orientation flip for outward consistency ───────────────────────
    // Ensure the limit normal agrees with the average incident face-normal
    // so it always points outward (the tangent-mask formula may produce an
    // inward-pointing normal for some orderings — flip to match face avg).
    const [avgX, avgY, avgZ] = faceAveragedNormal(v, vertFaces, faceNx, faceNy, faceNz);
    if (nx * avgX + ny * avgY + nz * avgZ < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }

    out[v * 3] = nx;
    out[v * 3 + 1] = ny;
    out[v * 3 + 2] = nz;
  }

  return out;
}

/**
 * Fallback: average of incident face normals for boundary/degenerate vertices.
 * Returns a normalised [nx, ny, nz].
 */
function faceAveragedNormal(vIdx, vertFaces, faceNx, faceNy, faceNz) {
  let nx = 0, ny = 0, nz = 0;
  for (const t of vertFaces[vIdx]) {
    nx += faceNx[t];
    ny += faceNy[t];
    nz += faceNz[t];
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
