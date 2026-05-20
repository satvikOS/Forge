/**
 * ArchDisc Foundation — Loop subdivision for triangle meshes.
 *
 * The legacy SubdivisionSurface applied Catmull-Clark to triangle
 * meshes — that is mathematically wrong (Catmull-Clark is a
 * quad-mesh scheme), which is why subdivision was disabled. Loop
 * subdivision is THE correct scheme for triangle meshes, and
 * manifold-3d bodies are triangle meshes, so this is the right
 * tool for the job.
 *
 * One Loop step (Charles Loop, 1987):
 *
 *   Edge points — one new vertex per edge:
 *     interior edge (2 adjacent tris):
 *       e = 3/8·(v0 + v1) + 1/8·(vL + vR)
 *       where v0,v1 are the edge endpoints, vL,vR the opposite
 *       vertices of the two adjacent triangles.
 *     boundary edge (1 adjacent tri):
 *       e = 1/2·(v0 + v1)
 *
 *   Vertex repositioning — every original vertex moves:
 *     interior, valence n:
 *       v' = (1 − n·β)·v + β·Σ(neighbours)
 *       β  = (1/n)·(5/8 − (3/8 + 1/4·cos(2π/n))²)
 *     boundary:
 *       v' = 3/4·v + 1/8·(b0 + b1)   (b0,b1 = boundary neighbours)
 *
 *   Each triangle (a,b,c) → 4 triangles via the 3 edge points
 *   e_ab, e_bc, e_ca:
 *     (a, e_ab, e_ca) (b, e_bc, e_ab) (c, e_ca, e_bc) (e_ab,e_bc,e_ca)
 *
 * The limit surface is C² everywhere except at extraordinary
 * vertices, where it is C¹ — the standard Loop guarantee.
 *
 * Piecewise-smooth extension (Hoppe et al. 1994):
 *   Pass a sharpness Map<edgeKey, number> (edgeKey = "a_b" with a<b)
 *   to loopStep / loopSubdivide. Sharpness ≥ 1 triggers:
 *   - Sharp edge point:  e = (v0+v1)/2  (midpoint, no smooth blend)
 *   - Vertex rule by k = count of incident sharp edges:
 *       k ≤ 1 → smooth β-rule (unchanged)
 *       k = 2 → crease:  v' = (6v + n0 + n1) / 8
 *       k ≥ 3 → corner:  v' = v  (held exactly at position)
 *   Sharpness decays by 1 per subdivision level (semi-sharp: sharp
 *   for floor(s) levels, then becomes smooth).
 *   Backward-compat: when sharpness is omitted/empty the output is
 *   bit-identical to the previous implementation.
 */

// ── Edge key format ───────────────────────────────────────────────────────────
// The public sharpness map uses "a_b" (underscore, a<b) — used in both
// loopStep and SubdivisionCreases.js. Internal edge-table key uses "a,b"
// (comma) to avoid collision. Both are normalised to min_max.
const _sharpKey = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`);

/**
 * Weld duplicate vertices in a triangle mesh.
 *
 * BRepMesh tessellation duplicates vertices per face (24 verts
 * for a cube instead of 8). weldMesh merges vertices within `tol` mm
 * in all three coordinates so that adjacent triangles share indices —
 * a prerequisite for dihedral-based crease detection.
 *
 * Implementation: spatial hash keyed on rounded coordinates for O(n)
 * welding. Triangles are re-indexed.
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} [tol=1e-6]  merge tolerance in mm
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function weldMesh(mesh, tol = 1e-6) {
  const inv = 1 / tol;
  const { vertices, triangles } = mesh;
  const map = new Map();          // hash → canonical index in newVerts
  const remap = new Array(vertices.length);
  const newVerts = [];

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    // Round to grid to form a deterministic hash key
    const hx = Math.round(v[0] * inv);
    const hy = Math.round(v[1] * inv);
    const hz = Math.round(v[2] * inv);
    const key = `${hx},${hy},${hz}`;
    if (map.has(key)) {
      remap[i] = map.get(key);
    } else {
      const idx = newVerts.length;
      map.set(key, idx);
      newVerts.push(v.slice());
      remap[i] = idx;
    }
  }

  // Re-index triangles; skip degenerate tris that collapsed to a line/point.
  const newTris = [];
  for (const [a, b, c] of triangles) {
    const ra = remap[a], rb = remap[b], rc = remap[c];
    if (ra !== rb && rb !== rc && ra !== rc) {
      newTris.push([ra, rb, rc]);
    }
  }

  return { vertices: newVerts, triangles: newTris };
}

/**
 * Subdivide a triangle mesh `levels` times with Loop subdivision.
 *
 * When sharpness is omitted or empty the output is bit-identical to
 * the original pure-smooth implementation — backward compatible with
 * all existing callers (subdivideManifold etc.).
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} [levels=1]   number of subdivision steps
 * @param {Map<string,number>} [sharpness]  per-edge sharpness map (edgeKey "a_b", a<b)
 * @returns {{vertices: number[][], triangles: number[][], sharpness: Map<string,number>}}
 */
export function loopSubdivide(mesh, levels = 1, sharpness) {
  // Normalise: empty/missing sharpness → new Map() for consistent threading.
  let sh = (sharpness instanceof Map && sharpness.size > 0) ? sharpness : new Map();
  let m = { vertices: mesh.vertices.map(v => v.slice()), triangles: mesh.triangles.map(t => t.slice()) };
  for (let i = 0; i < Math.max(1, levels | 0); i++) {
    const result = loopStep({ vertices: m.vertices, triangles: m.triangles, sharpness: sh });
    m = result;
    sh = result.sharpness || new Map();
  }
  return m;
}

/**
 * One Loop subdivision step.
 *
 * Signature extended to accept an optional sharpness map.
 * When sharpness is empty/undefined, behaviour is IDENTICAL to
 * the original implementation.
 *
 * @param {{vertices: number[][], triangles: number[][], sharpness?: Map<string,number>}} param
 * @returns {{vertices: number[][], triangles: number[][], sharpness: Map<string,number>}}
 */
export function loopStep({ vertices, triangles, sharpness }) {
  // Backward-compat guarantee: empty or missing sharpness → pure smooth.
  const hasCreases = sharpness instanceof Map && sharpness.size > 0;
  const V = vertices.length;

  // ── Edge table ────────────────────────────────────────────
  // key "min,max" (comma) → { a, b, opp: [] }
  const edges = new Map();
  const ekey = (i, j) => (i < j ? `${i},${j}` : `${j},${i}`);
  for (const [a, b, c] of triangles) {
    for (const [i, j, opp] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const k = ekey(i, j);
      let e = edges.get(k);
      if (!e) { e = { a: Math.min(i, j), b: Math.max(i, j), opp: [] }; edges.set(k, e); }
      e.opp.push(opp);
    }
  }

  // ── Vertex adjacency + boundary detection ─────────────────
  const neighbours = Array.from({ length: V }, () => new Set());
  const onBoundary = new Array(V).fill(false);
  const boundaryNbr = Array.from({ length: V }, () => []);
  for (const e of edges.values()) {
    neighbours[e.a].add(e.b);
    neighbours[e.b].add(e.a);
    if (e.opp.length === 1) {            // boundary edge
      onBoundary[e.a] = onBoundary[e.b] = true;
      boundaryNbr[e.a].push(e.b);
      boundaryNbr[e.b].push(e.a);
    }
  }

  // ── Per-vertex sharp-edge incident count (Hoppe crease classification) ─────
  // sharpIncident[v] = list of OTHER endpoints of sharp edges incident to v.
  const sharpNbr = Array.from({ length: V }, () => []);
  if (hasCreases) {
    for (const [sk, s] of sharpness) {
      if (s <= 0) continue;
      // sk format is "a_b" (underscore, a<b)
      const us = sk.indexOf('_');
      const a = parseInt(sk.slice(0, us), 10);
      const b = parseInt(sk.slice(us + 1), 10);
      if (a < V && b < V) {
        sharpNbr[a].push(b);
        sharpNbr[b].push(a);
      }
    }
  }

  // ── Edge points ───────────────────────────────────────────
  const edgePointIndex = new Map();
  const newVerts = vertices.map(v => v.slice());   // start with originals (repositioned below)
  for (const e of edges.values()) {
    const v0 = vertices[e.a], v1 = vertices[e.b];
    let p;
    const sk = _sharpKey(e.a, e.b);
    const edgeSharp = hasCreases ? (sharpness.get(sk) || 0) : 0;
    if (edgeSharp > 0) {
      // Sharp edge point: simple midpoint (Hoppe boundary/crease rule).
      p = [0.5 * (v0[0] + v1[0]), 0.5 * (v0[1] + v1[1]), 0.5 * (v0[2] + v1[2])];
    } else if (e.opp.length >= 2) {
      const vL = vertices[e.opp[0]], vR = vertices[e.opp[1]];
      p = [
        0.375 * (v0[0] + v1[0]) + 0.125 * (vL[0] + vR[0]),
        0.375 * (v0[1] + v1[1]) + 0.125 * (vL[1] + vR[1]),
        0.375 * (v0[2] + v1[2]) + 0.125 * (vL[2] + vR[2]),
      ];
    } else {
      p = [0.5 * (v0[0] + v1[0]), 0.5 * (v0[1] + v1[1]), 0.5 * (v0[2] + v1[2])];
    }
    edgePointIndex.set(ekey(e.a, e.b), newVerts.length);
    newVerts.push(p);
  }

  // ── Reposition original vertices ──────────────────────────
  for (let v = 0; v < V; v++) {
    const orig = vertices[v];
    const k = sharpNbr[v].length; // number of incident sharp edges

    if (hasCreases && k >= 3) {
      // Corner rule: vertex stays exactly in place.
      newVerts[v] = orig.slice();
    } else if (hasCreases && k === 2) {
      // Crease rule: v' = (6v + n0 + n1) / 8
      const n0 = vertices[sharpNbr[v][0]];
      const n1 = vertices[sharpNbr[v][1]];
      newVerts[v] = [
        (6 * orig[0] + n0[0] + n1[0]) / 8,
        (6 * orig[1] + n0[1] + n1[1]) / 8,
        (6 * orig[2] + n0[2] + n1[2]) / 8,
      ];
    } else if (onBoundary[v]) {
      // Boundary smooth rule
      const bn = boundaryNbr[v];
      if (bn.length === 2) {
        newVerts[v] = [
          0.75 * orig[0] + 0.125 * (vertices[bn[0]][0] + vertices[bn[1]][0]),
          0.75 * orig[1] + 0.125 * (vertices[bn[0]][1] + vertices[bn[1]][1]),
          0.75 * orig[2] + 0.125 * (vertices[bn[0]][2] + vertices[bn[1]][2]),
        ];
      }
      // valence-≠2 boundary vertex (corner) → keep fixed.
    } else {
      // Smooth interior rule (Loop β-formula) — unchanged from original.
      const nb = [...neighbours[v]];
      const n = nb.length;
      if (n === 0) continue;
      const t = 0.375 + 0.25 * Math.cos((2 * Math.PI) / n);
      const beta = (1 / n) * (0.625 - t * t);
      let sx = 0, sy = 0, sz = 0;
      for (const kk of nb) { sx += vertices[kk][0]; sy += vertices[kk][1]; sz += vertices[kk][2]; }
      newVerts[v] = [
        (1 - n * beta) * orig[0] + beta * sx,
        (1 - n * beta) * orig[1] + beta * sy,
        (1 - n * beta) * orig[2] + beta * sz,
      ];
    }
  }

  // ── Rebuild faces — each triangle → 4 ─────────────────────
  const newTris = [];
  for (const [a, b, c] of triangles) {
    const eab = edgePointIndex.get(ekey(a, b));
    const ebc = edgePointIndex.get(ekey(b, c));
    const eca = edgePointIndex.get(ekey(c, a));
    newTris.push([a, eab, eca]);
    newTris.push([b, ebc, eab]);
    newTris.push([c, eca, ebc]);
    newTris.push([eab, ebc, eca]);
  }

  // ── Sharpness propagation (Hoppe semi-sharp decay) ─────────
  // Each parent edge (a,b) with sharpness s → two child edges
  // (a, e_ab) and (e_ab, b), each with sharpness max(s-1, 0).
  const newSharpness = new Map();
  if (hasCreases) {
    for (const [sk, s] of sharpness) {
      if (s <= 0) continue;
      const childS = Math.max(s - 1, 0);
      if (childS <= 0) continue; // fully decayed — omit from map (smooth)
      const us = sk.indexOf('_');
      const a = parseInt(sk.slice(0, us), 10);
      const b = parseInt(sk.slice(us + 1), 10);
      // The edge-point index was stored under the comma key
      const ep = edgePointIndex.get(ekey(a, b));
      if (ep === undefined) continue;
      newSharpness.set(_sharpKey(a, ep), childS);
      newSharpness.set(_sharpKey(ep, b), childS);
    }
  }

  return { vertices: newVerts, triangles: newTris, sharpness: newSharpness };
}

/**
 * Convert a manifold-3d Mesh into the {vertices, triangles} form
 * loopSubdivide expects.
 */
export function manifoldMeshToArrays(mesh) {
  const np = mesh.numProp;
  const verts = [];
  for (let i = 0; i < mesh.vertProperties.length; i += np) {
    verts.push([mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]]);
  }
  const tris = [];
  for (let i = 0; i < mesh.triVerts.length; i += 3) {
    tris.push([mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]]);
  }
  return { vertices: verts, triangles: tris };
}

/**
 * Loop-subdivide a manifold and rebuild it as a manifold-3d Manifold.
 * @param {Manifold} manifold
 * @param {number} levels
 * @param {Function} getManifoldFn  the foundation getManifold()
 */
export async function subdivideManifold(manifold, levels, getManifoldFn) {
  const Mod = await getManifoldFn();
  const arrays = manifoldMeshToArrays(manifold.getMesh());
  const sub = loopSubdivide(arrays, levels);
  const vertProperties = new Float32Array(sub.vertices.length * 3);
  for (let i = 0; i < sub.vertices.length; i++) {
    vertProperties[i * 3]     = sub.vertices[i][0];
    vertProperties[i * 3 + 1] = sub.vertices[i][1];
    vertProperties[i * 3 + 2] = sub.vertices[i][2];
  }
  const triVerts = new Uint32Array(sub.triangles.length * 3);
  for (let i = 0; i < sub.triangles.length; i++) {
    triVerts[i * 3]     = sub.triangles[i][0];
    triVerts[i * 3 + 1] = sub.triangles[i][1];
    triVerts[i * 3 + 2] = sub.triangles[i][2];
  }
  return Mod.Manifold.ofMesh(new Mod.Mesh({ numProp: 3, vertProperties, triVerts }));
}
