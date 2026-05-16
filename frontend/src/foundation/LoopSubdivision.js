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
 */

/**
 * Subdivide a triangle mesh `levels` times with Loop subdivision.
 *
 * @param {{vertices: number[][], triangles: number[][]}} mesh
 * @param {number} levels   number of subdivision steps (default 1)
 * @returns {{vertices: number[][], triangles: number[][]}}
 */
export function loopSubdivide(mesh, levels = 1) {
  let m = { vertices: mesh.vertices.map(v => v.slice()), triangles: mesh.triangles.map(t => t.slice()) };
  for (let i = 0; i < Math.max(1, levels | 0); i++) {
    m = loopStep(m);
  }
  return m;
}

/** One Loop subdivision step. */
export function loopStep({ vertices, triangles }) {
  const V = vertices.length;

  // ── Edge table ────────────────────────────────────────────
  // key "min,max" → { a, b, tris: [opposite vertex per adjacent tri] }
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

  // ── Edge points ───────────────────────────────────────────
  const edgePointIndex = new Map();
  const newVerts = vertices.map(v => v.slice());   // start with originals (repositioned below)
  for (const e of edges.values()) {
    const v0 = vertices[e.a], v1 = vertices[e.b];
    let p;
    if (e.opp.length >= 2) {
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
    if (onBoundary[v]) {
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
      const nb = [...neighbours[v]];
      const n = nb.length;
      if (n === 0) continue;
      const t = 0.375 + 0.25 * Math.cos((2 * Math.PI) / n);
      const beta = (1 / n) * (0.625 - t * t);
      let sx = 0, sy = 0, sz = 0;
      for (const k of nb) { sx += vertices[k][0]; sy += vertices[k][1]; sz += vertices[k][2]; }
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

  return { vertices: newVerts, triangles: newTris };
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
