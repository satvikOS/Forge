/**
 * ArchDisc Foundation — Isotropic Remeshing (Botsch-Kobbelt 2004).
 *
 * Reference: Botsch, M. & Kobbelt, L. (2004). "A Remeshing Approach to
 * Multiresolution Modeling." Proc. Symposium on Geometry Processing, pp. 185–192.
 *
 * Given a pre-welded triangle mesh {vertices, triangles}, iteratively:
 *   1. Split edges longer than (4/3)·L
 *   2. Collapse edges shorter than (4/5)·L (with normal-flip guard)
 *   3. Flip interior edges to improve vertex valence toward 6
 *   4. Tangential Laplacian relaxation (project displacement onto tangent plane)
 *
 * Boundary edges (single-triangle adjacency) are never flipped or collapsed
 * (split is allowed). Boundary vertices are not relaxed.
 *
 * Surface pull-back (optional):
 *   Pass `opts.projectVertex(vertexIdx, [x,y,z]) -> [x,y,z]` to snap vertices
 *   back onto the original surface after tangential relaxation (and after each
 *   new midpoint created during splitLongEdges). This is the standard retopo
 *   surface pull-back used by ZBrush ZRemesher / Houdini retopo.
 *   When the callback is omitted, behaviour is identical to the original
 *   Botsch-Kobbelt algorithm (no regression for existing callers).
 */

// ─── Low-level geometry helpers ───────────────────────────────────────────────

/** Euclidean distance between two [x,y,z] points. */
function dist(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Cross product of two 3-vectors. */
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Dot product of two 3-vectors. */
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Magnitude of a 3-vector. */
function mag(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Normalise a 3-vector; returns [0,0,0] if near-zero. */
function norm3(v) {
  const m = mag(v);
  if (m < 1e-12) return [0, 0, 0];
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** Midpoint of two [x,y,z] points. */
function midpt(a, b) {
  return [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
}

/** Unnormalised face normal (area-scaled). */
function faceNormalUn(v0, v1, v2) {
  const ab = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const ac = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  return cross(ab, ac);
}

// ─── Edge-key helper ──────────────────────────────────────────────────────────

const ekey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

// ─── Edge-adjacency bookkeeping ───────────────────────────────────────────────

/**
 * Build edge adjacency map.
 * Returns: Map<edgeKey, [triA, triB|null]>
 */
function buildEdgeMap(triangles) {
  const edgeMap = new Map();
  for (let t = 0; t < triangles.length; t++) {
    const [a, b, c] = triangles[t];
    for (const k of [ekey(a, b), ekey(b, c), ekey(c, a)]) {
      if (!edgeMap.has(k)) edgeMap.set(k, [t, null]);
      else edgeMap.get(k)[1] = t;
    }
  }
  return edgeMap;
}

/**
 * Return unique edges as [{i, j, triA, triB}].
 * triB is null for boundary edges.
 */
export function edgeIterator(triangles) {
  const edgeMap = buildEdgeMap(triangles);
  const edges = [];
  for (const [key, [triA, triB]] of edgeMap) {
    const [i, j] = key.split('_').map(Number);
    edges.push({ i, j, triA, triB });
  }
  return edges;
}

/**
 * Build per-vertex one-ring (Set of neighbour vertex indices).
 * Returns Array<Set<number>>.
 */
function buildOneRings(vertexCount, triangles) {
  const rings = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) rings[v] = new Set();
  for (const [a, b, c] of triangles) {
    rings[a].add(b); rings[a].add(c);
    rings[b].add(a); rings[b].add(c);
    rings[c].add(a); rings[c].add(b);
  }
  return rings;
}

/** 1-ring neighbour indices for a single vertex. */
export function oneRing(vertexIdx, triangles) {
  const s = new Set();
  for (const [a, b, c] of triangles) {
    if (a === vertexIdx) { s.add(b); s.add(c); }
    else if (b === vertexIdx) { s.add(a); s.add(c); }
    else if (c === vertexIdx) { s.add(a); s.add(b); }
  }
  return [...s];
}

// ─── Boundary detection ───────────────────────────────────────────────────────

/**
 * Return a Set of vertex indices that lie on at least one boundary edge
 * (edge with only 1 incident triangle).
 */
function boundaryVertexSet(triangles) {
  const edgeMap = buildEdgeMap(triangles);
  const bv = new Set();
  for (const [key, [, triB]] of edgeMap) {
    if (triB === null) {
      const [i, j] = key.split('_').map(Number);
      bv.add(i);
      bv.add(j);
    }
  }
  return bv;
}

// ─── Mean edge length ─────────────────────────────────────────────────────────

/**
 * Compute the mean edge length of a mesh.
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @returns {number}
 */
export function meanEdgeLength(mesh) {
  const { vertices, triangles } = mesh;
  const seen = new Set();
  let sum = 0, count = 0;
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = ekey(u, v);
      if (!seen.has(k)) {
        seen.add(k);
        sum += dist(vertices[u], vertices[v]);
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

// ─── Step 1: Split long edges ─────────────────────────────────────────────────

/**
 * Split all edges longer than `lengthThreshold`.
 * Repeats passes until no edge exceeds threshold (up to 20 passes).
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} lengthThreshold
 * @param {((idx: number, pos: number[]) => number[])|undefined} [projectVertex]
 *   Optional surface pull-back callback. When provided, each newly created
 *   midpoint vertex is immediately projected onto the target surface.
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function splitLongEdges(mesh, lengthThreshold, projectVertex) {
  let cur = mesh;
  for (let pass = 0; pass < 20; pass++) {
    const { vertices, triangles } = cur;
    const newVerts = vertices.map(v => v.slice());
    const newTris = [];
    const edgeMap = buildEdgeMap(triangles);

    // Map: edgeKey → midpoint vertex index
    const midMap = new Map();
    for (const key of edgeMap.keys()) {
      const [i, j] = key.split('_').map(Number);
      if (dist(vertices[i], vertices[j]) > lengthThreshold) {
        const newIdx = newVerts.length;
        midMap.set(key, newIdx);
        let mp = midpt(vertices[i], vertices[j]);
        // Pull-back: project new midpoint onto the original surface immediately.
        if (typeof projectVertex === 'function') {
          mp = projectVertex(newIdx, mp) || mp;
        }
        newVerts.push(mp);
      }
    }

    if (midMap.size === 0) return { vertices: newVerts, triangles };

    // Re-triangulate each triangle based on which edges were split.
    for (const [a, b, c] of triangles) {
      const mab = midMap.get(ekey(a, b));
      const mbc = midMap.get(ekey(b, c));
      const mca = midMap.get(ekey(c, a));
      const splitCount = (mab !== undefined ? 1 : 0) +
                         (mbc !== undefined ? 1 : 0) +
                         (mca !== undefined ? 1 : 0);

      if (splitCount === 0) {
        newTris.push([a, b, c]);
      } else if (splitCount === 1) {
        if (mab !== undefined) {
          newTris.push([a, mab, c]);
          newTris.push([mab, b, c]);
        } else if (mbc !== undefined) {
          newTris.push([a, b, mbc]);
          newTris.push([a, mbc, c]);
        } else {
          newTris.push([a, b, mca]);
          newTris.push([b, c, mca]);
        }
      } else if (splitCount === 2) {
        if (mab !== undefined && mbc !== undefined) {
          newTris.push([a, mab, c]);
          newTris.push([mab, mbc, c]);
          newTris.push([mab, b, mbc]);
        } else if (mab !== undefined && mca !== undefined) {
          newTris.push([b, c, mca]);
          newTris.push([b, mca, mab]);
          newTris.push([mca, a, mab]);
        } else {
          // mbc and mca
          newTris.push([a, b, mca]);
          newTris.push([b, mbc, mca]);
          newTris.push([mbc, c, mca]);
        }
      } else {
        // All 3 split — 1-to-4 subdivision.
        newTris.push([a, mab, mca]);
        newTris.push([mab, b, mbc]);
        newTris.push([mca, mbc, c]);
        newTris.push([mab, mbc, mca]);
      }
    }

    cur = { vertices: newVerts, triangles: newTris };
  }
  return cur;
}

// ─── Step 2: Collapse short edges ─────────────────────────────────────────────

/**
 * Collapse all edges shorter than `lengthThreshold`.
 * Skip: boundary edges, boundary vertices, normal-flip collapses, degenerates.
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} lengthThreshold
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function collapseShortEdges(mesh, lengthThreshold) {
  let { vertices, triangles } = mesh;

  for (let pass = 0; pass < 10; pass++) {
    const edgeMap = buildEdgeMap(triangles);
    const bv = boundaryVertexSet(triangles);

    // Collect short interior-edge candidates (non-boundary edges, non-boundary verts).
    const candidates = [];
    for (const [key, [triA, triB]] of edgeMap) {
      if (triB === null) continue; // boundary edge
      const [i, j] = key.split('_').map(Number);
      if (bv.has(i) || bv.has(j)) continue;
      const d = dist(vertices[i], vertices[j]);
      if (d < lengthThreshold) candidates.push({ i, j, d });
    }

    if (candidates.length === 0) break;

    // Sort by length ascending — collapse shortest first.
    candidates.sort((a, b) => a.d - b.d);

    const collapsed = new Set();
    const remap = new Map(); // j → i

    for (const { i, j } of candidates) {
      if (collapsed.has(i) || collapsed.has(j)) continue;

      const newPos = midpt(vertices[i], vertices[j]);

      // Check all triangles incident to i or j for normal flips.
      let flipDetected = false;
      for (let t = 0; t < triangles.length; t++) {
        const [a, b, c] = triangles[t];
        if (a !== i && a !== j && b !== i && b !== j && c !== i && c !== j) continue;

        // Post-collapse: j → i at newPos, i → newPos.
        const na = a === j ? i : a;
        const nb = b === j ? i : b;
        const nc = c === j ? i : c;

        // Skip degenerate — will be dropped.
        if (na === nb || nb === nc || na === nc) continue;

        // Pre normal.
        const preN = faceNormalUn(vertices[a], vertices[b], vertices[c]);
        // Post normal (use newPos for i).
        const va = na === i ? newPos : vertices[na];
        const vb = nb === i ? newPos : vertices[nb];
        const vc = nc === i ? newPos : vertices[nc];
        const postN = faceNormalUn(va, vb, vc);

        const pm = mag(preN), qm = mag(postN);
        if (pm < 1e-12 || qm < 1e-12) continue; // degenerate — OK to drop

        if (dot(preN, postN) / (pm * qm) < 0.1) {
          flipDetected = true;
          break;
        }
      }
      if (flipDetected) continue;

      // Commit: j collapses into i at newPos.
      remap.set(j, i);
      vertices = vertices.map((v, idx) => idx === i ? newPos.slice() : v);
      collapsed.add(i);
      collapsed.add(j);
    }

    if (remap.size === 0) break;

    // Apply remap — follow chains (e.g. j→i, i→k).
    const remapV = idx => {
      let cur = idx;
      let iters = 0;
      while (remap.has(cur) && iters++ < 100) cur = remap.get(cur);
      return cur;
    };

    const newTris = [];
    for (const [a, b, c] of triangles) {
      const ra = remapV(a), rb = remapV(b), rc = remapV(c);
      if (ra !== rb && rb !== rc && ra !== rc) {
        newTris.push([ra, rb, rc]);
      }
    }

    // Compact vertices (remove unreferenced).
    const referenced = new Set();
    for (const [a, b, c] of newTris) { referenced.add(a); referenced.add(b); referenced.add(c); }
    const sortedRef = [...referenced].sort((a, b) => a - b);
    const compactMap = new Map();
    const compactVerts = [];
    for (const oldIdx of sortedRef) {
      compactMap.set(oldIdx, compactVerts.length);
      compactVerts.push(vertices[oldIdx]);
    }
    triangles = newTris.map(([a, b, c]) => [compactMap.get(a), compactMap.get(b), compactMap.get(c)]);
    vertices = compactVerts;
  }

  return { vertices, triangles };
}

// ─── Step 3: Flip edges to improve valence ────────────────────────────────────

/**
 * Flip interior edges to reduce Σ|valence_i - 6|.
 * Repeats until no improvement (up to 20 passes).
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function flipEdgesToImproveValence(mesh) {
  const { vertices } = mesh;
  let triangles = mesh.triangles.map(t => t.slice());

  for (let pass = 0; pass < 20; pass++) {
    // Build valence = degree (count of unique incident edges per vertex).
    const degree = new Array(vertices.length).fill(0);
    {
      const seen = new Set();
      for (const [a, b, c] of triangles) {
        for (const [u, w] of [[a, b], [b, c], [c, a]]) {
          const k = ekey(u, w);
          if (!seen.has(k)) {
            seen.add(k);
            degree[u]++;
            degree[w]++;
          }
        }
      }
    }

    // Build edge adjacency map for current triangles.
    const edgeMap = buildEdgeMap(triangles);

    let anyFlip = false;

    for (const [key, [triA, triB]] of edgeMap) {
      if (triB === null) continue; // boundary edge

      const [u, v] = key.split('_').map(Number);
      const tA = triangles[triA];
      const tB = triangles[triB];

      // Opposite vertices.
      const a = tA.find(idx => idx !== u && idx !== v);
      const b = tB.find(idx => idx !== u && idx !== v);
      if (a === undefined || b === undefined || a === b) continue;

      // Guard: new edge a-b must not already exist (non-manifold).
      if (edgeMap.has(ekey(a, b))) continue;

      // Pre-flip valence deviation.
      const pre = Math.abs(degree[u] - 6) + Math.abs(degree[v] - 6) +
                  Math.abs(degree[a] - 6) + Math.abs(degree[b] - 6);
      // Post-flip: u,v each lose 1; a,b each gain 1.
      const post = Math.abs(degree[u] - 1 - 6) + Math.abs(degree[v] - 1 - 6) +
                   Math.abs(degree[a] + 1 - 6) + Math.abs(degree[b] + 1 - 6);

      if (post >= pre) continue;

      // Rebuild triangles preserving winding.
      // tA contains u, v, a — find position of u and v.
      const uIdx = tA.indexOf(u);
      const vNext = tA[(uIdx + 1) % 3]; // vertex after u in tA
      // If v follows u in tA, the edge is u→v in tA's winding.
      // New tA: replace v with b (keep u→a or u→b consistent).
      let newTA, newTB;
      if (vNext === v) {
        // tA winding: ...u→v→a... so edge u-v is u→v.
        // After flip: u-a-b and v-b-a
        newTA = [u, a, b];
        newTB = [v, b, a];
      } else {
        // tA winding: ...v→u→a... so edge is v→u.
        // After flip: v-a-b and u-b-a
        newTA = [v, a, b];
        newTB = [u, b, a];
      }

      // Guard: no degenerate triangles.
      if (newTA[0] === newTA[1] || newTA[1] === newTA[2] || newTA[0] === newTA[2]) continue;
      if (newTB[0] === newTB[1] || newTB[1] === newTB[2] || newTB[0] === newTB[2]) continue;

      // Guard: no normal flip.
      const nOA = faceNormalUn(vertices[tA[0]], vertices[tA[1]], vertices[tA[2]]);
      const nOB = faceNormalUn(vertices[tB[0]], vertices[tB[1]], vertices[tB[2]]);
      const nNA = faceNormalUn(vertices[newTA[0]], vertices[newTA[1]], vertices[newTA[2]]);
      const nNB = faceNormalUn(vertices[newTB[0]], vertices[newTB[1]], vertices[newTB[2]]);
      const mOA = mag(nOA), mOB = mag(nOB), mNA = mag(nNA), mNB = mag(nNB);
      if (mOA < 1e-12 || mOB < 1e-12 || mNA < 1e-12 || mNB < 1e-12) continue;
      if (dot(nOA, nNA) / (mOA * mNA) < 0.1) continue;
      if (dot(nOB, nNB) / (mOB * mNB) < 0.1) continue;

      // Apply flip.
      triangles[triA] = newTA;
      triangles[triB] = newTB;

      // Update degree locally.
      degree[u]--;
      degree[v]--;
      degree[a]++;
      degree[b]++;

      anyFlip = true;
    }

    if (!anyFlip) break;
  }

  return { vertices, triangles };
}

// ─── Step 4: Tangential Laplacian relaxation ──────────────────────────────────

/**
 * Move each interior (non-boundary) vertex toward the centroid of its 1-ring,
 * projected onto the local tangent plane.
 * Damping factor 0.5 prevents over-relaxation / surface drift.
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} [damping=0.5]  0 = no move; 1 = full move
 * @param {((idx: number, pos: number[]) => number[])|undefined} [projectVertex]
 *   Optional surface pull-back callback. When provided, each interior vertex
 *   is projected back onto the target surface after tangential relaxation.
 *   Signature: `(vertexIdx, [x, y, z]) -> [x, y, z]`.
 *   When omitted, the step is pure tangential relaxation (original behaviour).
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function tangentialRelax(mesh, damping = 0.5, projectVertex) {
  const { triangles } = mesh;
  const vertices = mesh.vertices.map(v => v.slice());
  const nv = vertices.length;

  const bv = boundaryVertexSet(triangles);
  const rings = buildOneRings(nv, triangles);

  // Per-vertex area-weighted normal.
  const vNormal = new Array(nv).fill(null).map(() => [0, 0, 0]);
  for (const [a, b, c] of triangles) {
    const n = faceNormalUn(vertices[a], vertices[b], vertices[c]);
    vNormal[a][0] += n[0]; vNormal[a][1] += n[1]; vNormal[a][2] += n[2];
    vNormal[b][0] += n[0]; vNormal[b][1] += n[1]; vNormal[b][2] += n[2];
    vNormal[c][0] += n[0]; vNormal[c][1] += n[1]; vNormal[c][2] += n[2];
  }
  for (let vi = 0; vi < nv; vi++) {
    vNormal[vi] = norm3(vNormal[vi]);
  }

  // Move interior vertices.
  for (let vi = 0; vi < nv; vi++) {
    if (bv.has(vi)) continue;

    const ring = [...rings[vi]];
    if (ring.length === 0) continue;

    // Centroid of 1-ring.
    let cx = 0, cy = 0, cz = 0;
    for (const ni of ring) {
      cx += vertices[ni][0];
      cy += vertices[ni][1];
      cz += vertices[ni][2];
    }
    cx /= ring.length; cy /= ring.length; cz /= ring.length;

    // Displacement = centroid - vertex.
    const dx = cx - vertices[vi][0];
    const dy = cy - vertices[vi][1];
    const dz = cz - vertices[vi][2];

    // Project onto tangent plane (remove normal component).
    const n = vNormal[vi];
    const dn = dx * n[0] + dy * n[1] + dz * n[2];
    const tx = dx - dn * n[0];
    const ty = dy - dn * n[1];
    const tz = dz - dn * n[2];

    vertices[vi][0] += damping * tx;
    vertices[vi][1] += damping * ty;
    vertices[vi][2] += damping * tz;

    // Surface pull-back: after tangential displacement, snap back onto the
    // original surface so the mesh stays on-surface across iterations.
    if (typeof projectVertex === 'function') {
      const proj = projectVertex(vi, vertices[vi]);
      if (proj) {
        vertices[vi][0] = proj[0];
        vertices[vi][1] = proj[1];
        vertices[vi][2] = proj[2];
      }
    }
  }

  return { vertices, triangles };
}

// ─── One iteration step ───────────────────────────────────────────────────────

/**
 * One full Botsch-Kobbelt iteration:
 *   split-long → collapse-short → flip-valence → tangential-relax
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} L  target edge length
 * @param {object} [opts]
 * @param {number} [opts.splitFactor=4/3]
 * @param {number} [opts.collapseFactor=4/5]
 * @param {number} [opts.relaxDamping=0.5]
 * @param {((idx: number, pos: number[]) => number[])|undefined} [opts.projectVertex]
 *   Optional surface pull-back callback. Forwarded to `splitLongEdges` (new
 *   midpoints) and `tangentialRelax` (post-relax snap). When omitted, both
 *   steps behave as in the original Botsch-Kobbelt algorithm.
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function isoStep(mesh, L, opts = {}) {
  const {
    splitFactor = 4 / 3,
    collapseFactor = 4 / 5,
    relaxDamping = 0.5,
    projectVertex,
  } = opts;
  let m = mesh;
  m = splitLongEdges(m, L * splitFactor, projectVertex);
  m = collapseShortEdges(m, L * collapseFactor);
  m = flipEdgesToImproveValence(m);
  m = tangentialRelax(m, relaxDamping, projectVertex);
  return m;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Isotropic remeshing (Botsch-Kobbelt 2004).
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh  Pre-welded mesh.
 * @param {object} [opts]
 * @param {number}  [opts.targetEdgeLength]    Target edge length L (mm). Default = mean edge length.
 * @param {number}  [opts.iterations=5]        Number of B-K iterations.
 * @param {number}  [opts.splitFactor=4/3]     Split threshold multiplier.
 * @param {number}  [opts.collapseFactor=4/5]  Collapse threshold multiplier.
 * @param {number}  [opts.relaxDamping=0.5]    Tangential relaxation damping (0–1).
 * @param {((idx: number, pos: number[]) => number[])|undefined} [opts.projectVertex]
 *   Optional surface pull-back callback. Invoked after each tangential relax step
 *   for every moved interior vertex, and immediately after each split creates a
 *   new midpoint vertex.
 *   Signature: `(vertexIdx, currentPosition: [x,y,z]) -> projectedPosition: [x,y,z]`.
 *   Return `null` / `undefined` to leave the vertex unchanged.
 *   When omitted, behaviour is identical to the original Botsch-Kobbelt algorithm
 *   (no regression for callers that do not pass this option).
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function isotropicRemesh(mesh, opts = {}) {
  const {
    targetEdgeLength,
    iterations = 5,
    splitFactor = 4 / 3,
    collapseFactor = 4 / 5,
    relaxDamping = 0.5,
    projectVertex,
  } = opts;

  if (!mesh || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles)) {
    throw new Error('isotropicRemesh: mesh must be {vertices: number[][], triangles: number[][]}');
  }
  if (mesh.triangles.length === 0) return mesh;

  const L = (typeof targetEdgeLength === 'number' && targetEdgeLength > 0)
    ? targetEdgeLength
    : meanEdgeLength(mesh);

  if (L < 1e-10) throw new Error('isotropicRemesh: targetEdgeLength is effectively zero');

  let m = mesh;
  for (let i = 0; i < iterations; i++) {
    m = isoStep(m, L, { splitFactor, collapseFactor, relaxDamping, projectVertex });
  }

  return m;
}
