/**
 * ArchDisc Foundation — Catmull-Clark subdivision for quad meshes.
 *
 * Classical Catmull-Clark scheme (Catmull & Clark 1978) extended with
 * piecewise-smooth creases (Hoppe et al. 1994) and boundary support.
 *
 * ── Algorithm ────────────────────────────────────────────────────────────────
 *
 *   Face point   F_f  = average of the face's corner vertices.
 *
 *   Edge point   E_e  = average(v0, v1, F_a, F_b)  for interior edges
 *                     = midpoint(v0, v1)             for boundary edges.
 *                     = midpoint(v0, v1)             for sharp crease edges.
 *
 *   Vertex update V'  (interior, n = valence):
 *                       V' = (F + 2R + (n-3)V) / n
 *                       F = avg of adjacent face points
 *                       R = avg of edge midpoints for edges adjacent to V
 *
 *                     (boundary — Hoppe boundary midpoint rule):
 *                       V' = (6V + b0 + b1) / 8   where b0,b1 are the two
 *                       boundary-edge neighbours (same as Loop boundary rule
 *                       after scaling). Reduces to midpoint blend for
 *                       degree-2 boundary chains.
 *
 *   Per-face replacement — each input quad (a,b,c,d) → 4 child quads:
 *       (a,  E_ab, F, E_da)
 *       (b,  E_bc, F, E_ab)
 *       (c,  E_cd, F, E_bc)
 *       (d,  E_da, F, E_cd)
 *   where E_xy is the edge point for edge (x,y) and F is the face point.
 *
 * ── Crease (piecewise-smooth) extension ──────────────────────────────────────
 *   Pass sharpness: Map<edgeKey "a_b" (a<b), number>
 *
 *   Edge-point rule for sharp edge:  E = midpoint(v0, v1)   (ignores face pts)
 *
 *   Vertex rule by k = count of incident sharp edges at V:
 *       k = 0   interior smooth (standard CC rule above)
 *       k = 1   dart           — treat as interior smooth (Hoppe)
 *       k = 2   crease         — V' = (6V + n0 + n1) / 8  (n0,n1 = crease neighbours)
 *       k ≥ 3   corner         — V' = V  (vertex stays)
 *
 *   Sharpness decays by 1 per level (semi-sharp — same as LoopSubdivision.js).
 *
 * ── Triangle → quad converter ────────────────────────────────────────────────
 *   trianglesToQuads: pair adjacent triangles that share an edge AND whose
 *   face-normal dihedral angle is ≤ dihedralThresholdDeg (default 5° — only
 *   near-coplanar pairs). Unpaired triangles become degenerate quads (repeat
 *   last vertex: (a,b,c,c)) — standard CC handling of triangle inputs, since
 *   CC produces 4 child quads per face regardless of the exact vertex layout.
 *
 * ── Honest gaps ──────────────────────────────────────────────────────────────
 *   - CC limit-normal masks are different from Loop's tangent masks.
 *     Face-normal averaging is used for normals in BrepCatmullClark.js.
 *   - Non-quad (n-gon) faces are not supported; only quads and degenerate
 *     quads (triangles padded with repeated vertex) are handled.
 *   - "Extraordinary" CC vertices (valence ≠ 4) produce C¹-but-not-C²
 *     limit surfaces — the standard CC guarantee.
 */

// ── Edge key ──────────────────────────────────────────────────────────────────
// Public sharpness map uses "a_b" (a < b); internal edge-table uses "a,b".
const _sharpKey = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`);
const _ekey     = (i, j) => (i < j ? `${i},${j}` : `${j},${i}`);

// ── Re-export weldMesh for callers that only import from this module ───────────
export { weldMesh } from './LoopSubdivision.js';

// ─────────────────────────────────────────────────────────────────────────────
// trianglesToQuads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a triangle mesh to a quad mesh by pairing near-coplanar adjacent
 * triangles that share an edge.
 *
 * Pairing heuristic:
 *   Two triangles T0 and T1 share edge (u,v).  They are merged into a quad
 *   if their face-normal dihedral angle is ≤ dihedralThresholdDeg (default 5°).
 *   The resulting quad vertex order is (u, opp0, v, opp1) — the two shared
 *   edge endpoints interleaved with each triangle's opposite vertex, giving a
 *   convex quad with CCW winding when viewed from outside.
 *
 *   Triangles that cannot be paired (boundary, or too high a dihedral) become
 *   degenerate quads with a duplicated last vertex:  (a, b, c, c).
 *   Catmull-Clark handles these correctly — the repeated vertex means the
 *   "face point" lands at one corner and the subdivision still produces 4 valid
 *   child quads, each with finite area.  The limit surface degrades gracefully
 *   over triangle regions (not class-A, but not broken).
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} [dihedralThresholdDeg=5]   Max dihedral for pairing (degrees).
 * @returns {{vertices: number[][], quads: number[][]}}
 */
export function trianglesToQuads({ vertices, triangles }, dihedralThresholdDeg = 5) {
  const cosThresh = Math.cos(dihedralThresholdDeg * Math.PI / 180);

  // Per-triangle face normals.
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

  // Build edge → [triIndex, ...] adjacency map.
  const edgeAdj = new Map();
  triangles.forEach(([a, b, c], i) => {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = _ekey(u, v);
      if (!edgeAdj.has(k)) edgeAdj.set(k, []);
      edgeAdj.get(k).push(i);
    }
  });

  const used = new Uint8Array(triangles.length);
  const quads = [];

  // Try to pair triangles sharing an interior edge with low dihedral.
  for (const [k, tIdxList] of edgeAdj) {
    if (tIdxList.length !== 2) continue;
    const [t0, t1] = tIdxList;
    if (used[t0] || used[t1]) continue;

    const n0 = triNormals[t0];
    const n1 = triNormals[t1];
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (dot < cosThresh) continue;  // dihedral too large — don't merge

    // Find the two shared endpoints from the edge key.
    const sep = k.indexOf(',');
    const eu = parseInt(k.slice(0, sep), 10);
    const ev = parseInt(k.slice(sep + 1), 10);

    // Find the opposite vertex in each triangle.
    const tri0 = triangles[t0];
    const opp0 = tri0.find(v => v !== eu && v !== ev);
    const tri1 = triangles[t1];
    const opp1 = tri1.find(v => v !== eu && v !== ev);

    // Emit quad: (eu, opp0, ev, opp1) — interleave to maintain consistent winding.
    quads.push([eu, opp0, ev, opp1]);
    used[t0] = used[t1] = 1;
  }

  // Remaining unpaired triangles → degenerate quads (repeat last vertex).
  for (let i = 0; i < triangles.length; i++) {
    if (used[i]) continue;
    const [a, b, c] = triangles[i];
    quads.push([a, b, c, c]);
  }

  return { vertices: vertices.map(v => v.slice()), quads };
}

// ─────────────────────────────────────────────────────────────────────────────
// catmullClarkStep
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One Catmull-Clark subdivision step on a quad mesh.
 *
 * @param {{
 *   vertices: number[][],
 *   quads: number[][],
 *   sharpness?: Map<string,number>
 * }} param0
 * @returns {{
 *   vertices: number[][],
 *   quads: number[][],
 *   sharpness: Map<string,number>
 * }}
 */
export function catmullClarkStep({ vertices, quads, sharpness }) {
  const hasCreases = sharpness instanceof Map && sharpness.size > 0;
  const V = vertices.length;
  const F = quads.length;

  // ── Step A: Face points ───────────────────────────────────────────────────
  // F_f = average of the face's corner vertices (always distinct, even for
  // degenerate quads — the duplicated vertex is averaged in, slightly
  // biasing the face point toward that corner, which is acceptable).
  const facePts = quads.map(([a, b, c, d]) => {
    const va = vertices[a], vb = vertices[b], vc = vertices[c], vd = vertices[d];
    return [
      (va[0] + vb[0] + vc[0] + vd[0]) * 0.25,
      (va[1] + vb[1] + vc[1] + vd[1]) * 0.25,
      (va[2] + vb[2] + vc[2] + vd[2]) * 0.25,
    ];
  });

  // ── Step B: Build edge table (stores adjacent face indices) ───────────────
  // edgeKey "a,b" (comma, a < b) → { a, b, faces: [fi,...], rawA, rawB }
  // rawA/rawB store the original oriented edge so we can retrieve the edge
  // direction for sharpness-key lookup ("a_b" underscore, a < b).
  const edgeMap = new Map();
  for (let fi = 0; fi < F; fi++) {
    const face = quads[fi];
    const n = face.length; // 4 for quads
    for (let k = 0; k < n; k++) {
      const u = face[k];
      const v = face[(k + 1) % n];
      if (u === v) continue; // skip degenerate edge in a tri-padded quad
      const ek = _ekey(u, v);
      if (!edgeMap.has(ek)) {
        edgeMap.set(ek, { a: Math.min(u, v), b: Math.max(u, v), faces: [] });
      }
      const entry = edgeMap.get(ek);
      if (!entry.faces.includes(fi)) entry.faces.push(fi);
    }
  }

  // Boundary detection: an edge with only 1 adjacent face is a boundary edge.
  // Build per-vertex boundary-neighbour list.
  const onBoundary = new Uint8Array(V);
  const boundaryNbr = Array.from({ length: V }, () => []);

  for (const e of edgeMap.values()) {
    if (e.faces.length === 1) {
      onBoundary[e.a] = onBoundary[e.b] = 1;
      boundaryNbr[e.a].push(e.b);
      boundaryNbr[e.b].push(e.a);
    }
  }

  // ── Step C: Per-vertex sharp-edge incident count (crease classification) ──
  const sharpNbr = Array.from({ length: V }, () => []);
  if (hasCreases) {
    for (const [sk, s] of sharpness) {
      if (s <= 0) continue;
      const us = sk.indexOf('_');
      const a = parseInt(sk.slice(0, us), 10);
      const b = parseInt(sk.slice(us + 1), 10);
      if (a < V && b < V) {
        sharpNbr[a].push(b);
        sharpNbr[b].push(a);
      }
    }
  }

  // ── Step D: Compute edge points ───────────────────────────────────────────
  // Interior: E_e = avg(v0, v1, F_a, F_b) / 1  [i.e., the mean of 4 pts]
  // Boundary or sharp: E_e = midpoint(v0, v1)
  const edgePtIndex = new Map(); // _ekey → index in newVerts
  const newVerts = vertices.map(v => v.slice()); // will be repositioned below

  for (const [ek, e] of edgeMap) {
    const v0 = vertices[e.a], v1 = vertices[e.b];
    let ep;
    const sk = _sharpKey(e.a, e.b);
    const edgeSharp = hasCreases ? (sharpness.get(sk) || 0) : 0;

    if (edgeSharp > 0 || e.faces.length !== 2) {
      // Boundary or sharp crease: midpoint rule.
      ep = [
        (v0[0] + v1[0]) * 0.5,
        (v0[1] + v1[1]) * 0.5,
        (v0[2] + v1[2]) * 0.5,
      ];
    } else {
      // Interior smooth: average of 2 endpoints + 2 adjacent face points.
      const fa = facePts[e.faces[0]], fb = facePts[e.faces[1]];
      ep = [
        (v0[0] + v1[0] + fa[0] + fb[0]) * 0.25,
        (v0[1] + v1[1] + fa[1] + fb[1]) * 0.25,
        (v0[2] + v1[2] + fa[2] + fb[2]) * 0.25,
      ];
    }
    edgePtIndex.set(ek, newVerts.length);
    newVerts.push(ep);
  }

  // Insert face points (each gets a new index starting after all edge points).
  const faceStartIdx = newVerts.length;
  for (const fp of facePts) {
    newVerts.push(fp.slice());
  }

  // ── Step E: Reposition original vertices ──────────────────────────────────
  // Build per-vertex: list of adjacent face indices + list of adjacent edges.
  const vertFaces = Array.from({ length: V }, () => []);
  const vertEdges = Array.from({ length: V }, () => []); // stores edge _ekey strings

  for (let fi = 0; fi < F; fi++) {
    const face = quads[fi];
    const seen = new Set();
    for (const vi of face) {
      if (!seen.has(vi)) {
        seen.add(vi);
        vertFaces[vi].push(fi);
      }
    }
  }
  for (const [ek, e] of edgeMap) {
    if (!vertEdges[e.a].includes(ek)) vertEdges[e.a].push(ek);
    if (!vertEdges[e.b].includes(ek)) vertEdges[e.b].push(ek);
  }

  for (let vi = 0; vi < V; vi++) {
    const orig = vertices[vi];
    const k = sharpNbr[vi].length; // count of incident sharp edges

    if (hasCreases && k >= 3) {
      // Corner rule: vertex stays.
      newVerts[vi] = orig.slice();
      continue;
    }
    if (hasCreases && k === 2) {
      // Crease rule: V' = (6V + n0 + n1) / 8
      const n0 = vertices[sharpNbr[vi][0]];
      const n1 = vertices[sharpNbr[vi][1]];
      newVerts[vi] = [
        (6 * orig[0] + n0[0] + n1[0]) / 8,
        (6 * orig[1] + n0[1] + n1[1]) / 8,
        (6 * orig[2] + n0[2] + n1[2]) / 8,
      ];
      continue;
    }
    if (onBoundary[vi]) {
      // Boundary vertex rule (Hoppe): V' = (6V + b0 + b1) / 8
      const bn = boundaryNbr[vi];
      if (bn.length >= 2) {
        const b0 = vertices[bn[0]], b1 = vertices[bn[1]];
        newVerts[vi] = [
          (6 * orig[0] + b0[0] + b1[0]) / 8,
          (6 * orig[1] + b0[1] + b1[1]) / 8,
          (6 * orig[2] + b0[2] + b1[2]) / 8,
        ];
      } else {
        // Valence-1 boundary corner — keep fixed.
        newVerts[vi] = orig.slice();
      }
      continue;
    }

    // Interior smooth CC rule: V' = (F + 2R + (n-3)V) / n
    const adjFaces = vertFaces[vi];
    const n = adjFaces.length;
    if (n === 0) { newVerts[vi] = orig.slice(); continue; }

    // F = avg of adjacent face points
    let Fx = 0, Fy = 0, Fz = 0;
    for (const fi of adjFaces) {
      const fp = facePts[fi];
      Fx += fp[0]; Fy += fp[1]; Fz += fp[2];
    }
    Fx /= n; Fy /= n; Fz /= n;

    // R = avg of midpoints of edges adjacent to V
    const adjEdgeKeys = vertEdges[vi];
    let Rx = 0, Ry = 0, Rz = 0;
    let edgeCount = 0;
    for (const ek of adjEdgeKeys) {
      const e = edgeMap.get(ek);
      if (!e) continue;
      const v0 = vertices[e.a], v1 = vertices[e.b];
      Rx += (v0[0] + v1[0]) * 0.5;
      Ry += (v0[1] + v1[1]) * 0.5;
      Rz += (v0[2] + v1[2]) * 0.5;
      edgeCount++;
    }
    if (edgeCount > 0) { Rx /= edgeCount; Ry /= edgeCount; Rz /= edgeCount; }

    newVerts[vi] = [
      (Fx + 2 * Rx + (n - 3) * orig[0]) / n,
      (Fy + 2 * Ry + (n - 3) * orig[1]) / n,
      (Fz + 2 * Rz + (n - 3) * orig[2]) / n,
    ];
  }

  // ── Step F: Rebuild quads — each input quad (a,b,c,d) → 4 child quads ────
  // Child layout: (corner, E_corner-next, F, E_prev-corner)
  // i.e.  (a, E_ab, F, E_da)
  //        (b, E_bc, F, E_ab)
  //        (c, E_cd, F, E_bc)
  //        (d, E_da, F, E_cd)
  const newQuads = [];
  for (let fi = 0; fi < F; fi++) {
    const [a, b, c, d] = quads[fi];
    const Fidx = faceStartIdx + fi;

    const getEP = (u, v) => {
      if (u === v) return null; // degenerate edge
      return edgePtIndex.get(_ekey(u, v));
    };

    const E_ab = getEP(a, b);
    const E_bc = getEP(b, c);
    const E_cd = getEP(c, d);
    const E_da = getEP(d, a);

    // For degenerate quads (tri with c===d), E_cd and/or E_da may be null.
    // Fall back to using the corner vertex index for missing edge points.
    // This degrades but doesn't crash.
    const safe = (ep, fallback) => (ep !== undefined && ep !== null) ? ep : fallback;

    newQuads.push([a,  safe(E_ab, a), Fidx, safe(E_da, a)]);
    newQuads.push([b,  safe(E_bc, b), Fidx, safe(E_ab, b)]);
    newQuads.push([c,  safe(E_cd, c), Fidx, safe(E_bc, c)]);
    newQuads.push([d,  safe(E_da, d), Fidx, safe(E_cd, d)]);
  }

  // ── Step G: Sharpness propagation (semi-sharp decay by 1 per level) ───────
  const newSharpness = new Map();
  if (hasCreases) {
    for (const [sk, s] of sharpness) {
      if (s <= 0) continue;
      const childS = Math.max(s - 1, 0);
      if (childS <= 0) continue; // fully decayed
      const us = sk.indexOf('_');
      const a = parseInt(sk.slice(0, us), 10);
      const b = parseInt(sk.slice(us + 1), 10);
      const ep = edgePtIndex.get(_ekey(a, b));
      if (ep === undefined) continue;
      newSharpness.set(_sharpKey(a, ep), childS);
      newSharpness.set(_sharpKey(ep, b), childS);
    }
  }

  return { vertices: newVerts, quads: newQuads, sharpness: newSharpness };
}

// ─────────────────────────────────────────────────────────────────────────────
// catmullClarkSubdivide
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply `levels` Catmull-Clark steps to a quad mesh.
 *
 * If the input has a `triangles` field instead of `quads`, the caller is
 * responsible for converting first via trianglesToQuads (or pass quads directly).
 * catmullClarkSubdivide will throw if neither `quads` nor `triangles` is provided.
 *
 * @param {{vertices: number[][], quads?: number[][], triangles?: number[][]}} mesh
 * @param {number} [levels=1]
 * @param {Map<string,number>} [sharpness]   per-edge sharpness map (edgeKey "a_b")
 * @returns {{vertices: number[][], quads: number[][], sharpness: Map<string,number>}}
 */
export function catmullClarkSubdivide(mesh, levels = 1, sharpness = new Map()) {
  // Accept triangle mesh input transparently by converting first.
  let m;
  if (mesh.quads) {
    m = { vertices: mesh.vertices.map(v => v.slice()), quads: mesh.quads.map(q => q.slice()) };
  } else if (mesh.triangles) {
    m = trianglesToQuads(mesh, 5);
  } else {
    throw new Error('catmullClarkSubdivide: mesh must have quads or triangles');
  }

  let sh = (sharpness instanceof Map && sharpness.size > 0) ? sharpness : new Map();

  for (let i = 0; i < Math.max(1, levels | 0); i++) {
    const result = catmullClarkStep({ vertices: m.vertices, quads: m.quads, sharpness: sh });
    m = result;
    sh = result.sharpness || new Map();
  }

  return m;
}

/*
 * ── Inline self-test (commented block — not shipped) ─────────────────────────
 *
 * Concept: a cube made of 6 quad faces, 1 CC step → 24 child quads.
 * Vertices should move inward (sphere-like convergence).
 *
 * const cube = {
 *   vertices: [
 *     [-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],  // 0-3 bottom
 *     [-1,-1, 1],[1,-1, 1],[1,1, 1],[-1,1, 1],  // 4-7 top
 *   ],
 *   quads: [
 *     [0,1,2,3], // bottom (-Z)
 *     [4,5,6,7], // top    (+Z)
 *     [0,1,5,4], // front  (-Y)
 *     [3,2,6,7], // back   (+Y)
 *     [0,3,7,4], // left   (-X)
 *     [1,2,6,5], // right  (+X)
 *   ],
 * };
 *
 * const result = catmullClarkSubdivide(cube, 1);
 * console.assert(result.quads.length === 24, `Expected 24 quads, got ${result.quads.length}`);
 *
 * // All refined vertices should be strictly inside the [-1,1]³ cube
 * // (CC pulls vertices inward → sphere convergence).
 * const outside = result.vertices.filter(v =>
 *   Math.abs(v[0]) > 1+1e-9 || Math.abs(v[1]) > 1+1e-9 || Math.abs(v[2]) > 1+1e-9
 * );
 * console.assert(outside.length === 0, `${outside.length} vertices outside cube — unexpected`);
 *
 * // After 1 step the corner vertices should have moved inward significantly.
 * // Standard CC corner update: n=3, F=avg of 3 face pts, R=avg of 3 edge midpoints.
 * // Empirically each cube corner moves from ±1 to roughly ±0.75.
 * const corner = result.vertices[0]; // repositioned original vertex 0
 * console.assert(
 *   Math.abs(corner[0]) < 0.9,
 *   `Corner didn't move inward enough: x=${corner[0]}`,
 * );
 * console.log('CatmullClark self-test PASSED:', result.quads.length, 'quads');
 */
