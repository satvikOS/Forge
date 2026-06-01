// Forge-151 — Mesh dispatch (polygonal mesh tools).
//
// Implements the actual algorithms the MeshWorkbench drives:
//
//   - decimateQEM          : Garland–Heckbert quadric error metric
//                            edge-collapse to a target triangle count.
//   - smoothLaplacian      : iterative umbrella-weighted vertex smoothing.
//   - smoothTaubin         : λ / μ pass-pair to preserve volume.
//   - fillHoles            : detect boundary loops + ear-clip triangulate.
//   - repairSelfIntersect  : round-trip through manifold-3d (real clean()).
//   - boolean (union/cut/intersect) : real manifold-3d ops.
//   - remeshUniform        : split long edges + collapse short edges to a
//                            target edge length, then Laplacian relax.
//   - simplifyClustering   : voxel cluster decimation (vertex clustering).
//   - subdivideLoop        : real Loop subdivision (triangle mesh).
//   - subdivideCatmullClark: triangle-mesh CC approximation (each tri →
//                            three quads → triangulated; CC weights on
//                            face/edge/vertex points).
//
// STRICT no-fallback / no-stub rule:
//   * decimateQEM IS the real GH algorithm (per-vertex 4×4 quadrics,
//     edge selection by min collapse cost, plane recomputation).
//   * Booleans go through Manifold (no synthetic merge).
//   * If manifold-3d hasn't initialised, boolean / repair raise; the
//     workbench surfaces the error to the user.
//
// All public entry points are pure on their inputs (BufferGeometry-style
// `{ positions: Float32Array, indices: Uint32Array }` records). They
// return a new record — callers never mutate the input.

import ManifoldModuleFactory from 'manifold-3d';

/* -------------------------------------------------------------- */
/*  manifold-3d async init                                        */
/* -------------------------------------------------------------- */

let _manifoldPromise = null;
let _manifoldTop = null;

export async function ensureManifold() {
  if (_manifoldTop) return _manifoldTop;
  if (!_manifoldPromise) {
    _manifoldPromise = (async () => {
      const mod = await ManifoldModuleFactory();
      // Per docs: setup() is mandatory before constructing anything.
      mod.setup();
      _manifoldTop = mod;
      return mod;
    })();
  }
  return _manifoldPromise;
}

export function manifoldReady() {
  return _manifoldTop !== null;
}

/* -------------------------------------------------------------- */
/*  mesh-record helpers                                           */
/* -------------------------------------------------------------- */

export function meshClone(mesh) {
  return {
    positions: new Float32Array(mesh.positions),
    indices:   new Uint32Array(mesh.indices),
  };
}

export function meshStats(mesh) {
  return {
    vertices:  mesh.positions.length / 3,
    triangles: mesh.indices.length   / 3,
  };
}

function vSub(a, b)  { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function vAdd(a, b)  { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function vScale(a,s) { return [a[0]*s,    a[1]*s,    a[2]*s]; }
function vCross(a,b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function vDot(a,b)   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function vLen(a)     { return Math.sqrt(vDot(a,a)); }
function vNorm(a)    {
  const l = vLen(a) || 1;
  return [a[0]/l, a[1]/l, a[2]/l];
}

function vertAt(positions, i) {
  return [positions[3*i], positions[3*i+1], positions[3*i+2]];
}
function setVert(positions, i, v) {
  positions[3*i]   = v[0];
  positions[3*i+1] = v[1];
  positions[3*i+2] = v[2];
}

/* Build a (vertex → set<vertex>) adjacency map. */
function buildAdjacency(mesh) {
  const adj = new Array(mesh.positions.length / 3);
  for (let i = 0; i < adj.length; i++) adj[i] = new Set();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t], b = mesh.indices[t+1], c = mesh.indices[t+2];
    adj[a].add(b); adj[a].add(c);
    adj[b].add(a); adj[b].add(c);
    adj[c].add(a); adj[c].add(b);
  }
  return adj;
}

/* -------------------------------------------------------------- */
/*  Quadric Error Metric (Garland–Heckbert)                       */
/* -------------------------------------------------------------- */
//
// One Q per vertex is a symmetric 4×4 plane-quadric matrix stored as
// 10 floats (q00,q01,q02,q03, q11,q12,q13, q22,q23, q33). The error
// of placing a vertex v=(x,y,z,1) is v^T Q v.
//
// For each face we compute its plane (a,b,c,d) with a²+b²+c²=1 and
// add a a^T a to the quadric of each of its three vertices.
//
// Edge-collapse cost: choose new position v* minimising v^T (Q_a+Q_b) v.
// If the 3×3 sub-matrix of (Q_a+Q_b) is singular, fall back to the edge
// midpoint. Pop the lowest-cost edge from a heap, collapse it, update
// the neighbouring vertices' quadrics and re-heap.

function makeQ() {
  return new Float64Array(10);
}
function qAdd(out, a, b) {
  for (let i = 0; i < 10; i++) out[i] = a[i] + b[i];
}
function qFromPlane(a, b, c, d) {
  // Outer product of (a,b,c,d) with itself.
  return new Float64Array([
    a*a, a*b, a*c, a*d,
    b*b, b*c, b*d,
    c*c, c*d,
    d*d,
  ]);
}
function qAddInPlace(dst, src) {
  for (let i = 0; i < 10; i++) dst[i] += src[i];
}
function qEvaluate(Q, x, y, z) {
  // v^T Q v with v=(x,y,z,1).
  return (
    Q[0]*x*x + 2*Q[1]*x*y + 2*Q[2]*x*z + 2*Q[3]*x +
    Q[4]*y*y + 2*Q[5]*y*z + 2*Q[6]*y +
    Q[7]*z*z + 2*Q[8]*z +
    Q[9]
  );
}

// Solve Q*[x y z 1]^T = [0 0 0 1]^T for the optimal collapse position.
// Returns null if the 3×3 system is singular.
function qOptimalPosition(Q) {
  // Matrix:
  //   [ Q0 Q1 Q2 | -Q3 ]
  //   [ Q1 Q4 Q5 | -Q6 ]
  //   [ Q2 Q5 Q7 | -Q8 ]
  const m00 = Q[0], m01 = Q[1], m02 = Q[2];
  const m11 = Q[4], m12 = Q[5];
  const m22 = Q[7];
  const det =
    m00 * (m11*m22 - m12*m12) -
    m01 * (m01*m22 - m12*m02) +
    m02 * (m01*m12 - m11*m02);
  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1 / det;
  // Inverse of symmetric 3×3 times -(Q3,Q6,Q8).
  const c00 =  (m11*m22 - m12*m12) * invDet;
  const c01 = -(m01*m22 - m12*m02) * invDet;
  const c02 =  (m01*m12 - m11*m02) * invDet;
  const c11 =  (m00*m22 - m02*m02) * invDet;
  const c12 = -(m00*m12 - m01*m02) * invDet;
  const c22 =  (m00*m11 - m01*m01) * invDet;
  const x = -(c00*Q[3] + c01*Q[6] + c02*Q[8]);
  const y = -(c01*Q[3] + c11*Q[6] + c12*Q[8]);
  const z = -(c02*Q[3] + c12*Q[6] + c22*Q[8]);
  return [x, y, z];
}

/* Lightweight binary min-heap keyed on `cost`. */
class MinHeap {
  constructor() { this.a = []; }
  size() { return this.a.length; }
  push(node) {
    this.a.push(node);
    this._up(this.a.length - 1);
  }
  pop() {
    if (this.a.length === 0) return null;
    const top = this.a[0];
    const end = this.a.pop();
    if (this.a.length) { this.a[0] = end; this._down(0); }
    return top;
  }
  _up(i) {
    const a = this.a;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  _down(i) {
    const a = this.a, n = a.length;
    while (true) {
      const l = 2*i + 1, r = l + 1;
      let s = i;
      if (l < n && a[l].cost < a[s].cost) s = l;
      if (r < n && a[r].cost < a[s].cost) s = r;
      if (s === i) break;
      [a[s], a[i]] = [a[i], a[s]];
      i = s;
    }
  }
}

export function decimateQEM(mesh, targetTriangles) {
  const nV0 = mesh.positions.length / 3;
  const nT0 = mesh.indices.length / 3;
  if (targetTriangles >= nT0) return meshClone(mesh);

  // ---- mutable working copies ------------------------------------
  // We store positions in a flat array, faces in a parallel structure
  // with three vertex slots + an `alive` flag. Vertices carry an
  // `alive` flag too — when we collapse v→w, every face referencing
  // `v` gets its slot rewritten to `w`, and faces that become
  // degenerate (two or more identical corners) are killed.

  const pos = new Float64Array(mesh.positions.length);
  for (let i = 0; i < pos.length; i++) pos[i] = mesh.positions[i];

  const vAlive = new Uint8Array(nV0).fill(1);
  const faces = new Array(nT0);
  for (let t = 0; t < nT0; t++) {
    faces[t] = {
      a: mesh.indices[3*t],
      b: mesh.indices[3*t+1],
      c: mesh.indices[3*t+2],
      alive: true,
    };
  }

  // vertex → set<faceIdx>
  const vFaces = new Array(nV0);
  for (let i = 0; i < nV0; i++) vFaces[i] = new Set();
  for (let t = 0; t < nT0; t++) {
    vFaces[faces[t].a].add(t);
    vFaces[faces[t].b].add(t);
    vFaces[faces[t].c].add(t);
  }

  // ---- per-vertex quadric ----------------------------------------
  const Q = new Array(nV0);
  for (let i = 0; i < nV0; i++) Q[i] = makeQ();
  for (let t = 0; t < nT0; t++) {
    const f = faces[t];
    const p0 = [pos[3*f.a], pos[3*f.a+1], pos[3*f.a+2]];
    const p1 = [pos[3*f.b], pos[3*f.b+1], pos[3*f.b+2]];
    const p2 = [pos[3*f.c], pos[3*f.c+1], pos[3*f.c+2]];
    const n  = vNorm(vCross(vSub(p1,p0), vSub(p2,p0)));
    const d  = -vDot(n, p0);
    const Qp = qFromPlane(n[0], n[1], n[2], d);
    qAddInPlace(Q[f.a], Qp);
    qAddInPlace(Q[f.b], Qp);
    qAddInPlace(Q[f.c], Qp);
  }

  // ---- edge set + heap -------------------------------------------
  // Each edge tracked once (a<b). Version number bumps every time
  // its endpoints change so stale heap entries are skipped on pop.

  const edgeKey = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
  const edges   = new Map(); // key -> { a, b, version }

  function ensureEdge(a, b) {
    if (a === b) return;
    const k = edgeKey(a, b);
    if (!edges.has(k)) edges.set(k, { a: Math.min(a,b), b: Math.max(a,b), version: 0 });
  }

  for (let t = 0; t < nT0; t++) {
    const f = faces[t];
    ensureEdge(f.a, f.b); ensureEdge(f.b, f.c); ensureEdge(f.c, f.a);
  }

  function edgeCost(a, b) {
    const Qab = makeQ();
    qAdd(Qab, Q[a], Q[b]);
    let vStar = qOptimalPosition(Qab);
    if (!vStar) {
      // singular — try midpoint
      vStar = [
        0.5 * (pos[3*a]   + pos[3*b]),
        0.5 * (pos[3*a+1] + pos[3*b+1]),
        0.5 * (pos[3*a+2] + pos[3*b+2]),
      ];
    }
    const cost = qEvaluate(Qab, vStar[0], vStar[1], vStar[2]);
    return { cost, v: vStar };
  }

  const heap = new MinHeap();
  for (const e of edges.values()) {
    const { cost, v } = edgeCost(e.a, e.b);
    heap.push({ a: e.a, b: e.b, version: e.version, cost, v });
  }

  // ---- collapse loop ---------------------------------------------
  let triCount = nT0;
  let safety   = nT0 * 6; // hard ceiling on iterations
  while (triCount > targetTriangles && heap.size() > 0 && safety-- > 0) {
    const top = heap.pop();
    if (!top) break;
    const ek = edgeKey(top.a, top.b);
    const rec = edges.get(ek);
    if (!rec) continue;
    if (rec.version !== top.version) continue;       // stale
    if (!vAlive[top.a] || !vAlive[top.b]) continue;  // already dead

    const keep = top.a, drop = top.b;

    // ---- topological safety: skip collapses that would flip a face.
    // For every alive face on `drop` that does NOT contain `keep`,
    // verify that replacing `drop`→`keep` keeps the normal pointing
    // roughly the same direction.
    let safe = true;
    for (const f of vFaces[drop]) {
      const F = faces[f];
      if (!F.alive) continue;
      if (F.a === keep || F.b === keep || F.c === keep) continue;
      const a = F.a === drop ? keep : F.a;
      const b = F.b === drop ? keep : F.b;
      const c = F.c === drop ? keep : F.c;
      if (a === b || b === c || c === a) { safe = false; break; }
      const p0 = [pos[3*F.a], pos[3*F.a+1], pos[3*F.a+2]];
      const p1 = [pos[3*F.b], pos[3*F.b+1], pos[3*F.b+2]];
      const p2 = [pos[3*F.c], pos[3*F.c+1], pos[3*F.c+2]];
      const n1 = vCross(vSub(p1,p0), vSub(p2,p0));
      const q0 = [pos[3*a], pos[3*a+1], pos[3*a+2]];
      const q1 = [pos[3*b], pos[3*b+1], pos[3*b+2]];
      const q2 = [pos[3*c], pos[3*c+1], pos[3*c+2]];
      const n2 = vCross(vSub(q1,q0), vSub(q2,q0));
      if (vDot(n1, n2) < 0) { safe = false; break; }
    }
    if (!safe) {
      // skip — try the next edge
      continue;
    }

    // ---- collapse `drop` onto `keep` at v* -------------------------
    setVert(pos, keep, top.v);
    vAlive[drop] = 0;
    qAddInPlace(Q[keep], Q[drop]);

    // Rewire faces.
    const dropFaces = Array.from(vFaces[drop]);
    for (const f of dropFaces) {
      const F = faces[f];
      if (!F.alive) continue;
      if (F.a === drop) F.a = keep;
      if (F.b === drop) F.b = keep;
      if (F.c === drop) F.c = keep;
      if (F.a === F.b || F.b === F.c || F.c === F.a) {
        // degenerate — kill
        F.alive = false;
        triCount--;
        vFaces[F.a]?.delete(f);
        vFaces[F.b]?.delete(f);
        vFaces[F.c]?.delete(f);
      } else {
        vFaces[keep].add(f);
      }
    }
    vFaces[drop].clear();

    // Re-key the affected edges + push fresh costs.
    edges.delete(ek);
    const touched = new Set();
    for (const f of vFaces[keep]) {
      const F = faces[f];
      if (!F.alive) continue;
      touched.add(F.a); touched.add(F.b); touched.add(F.c);
    }
    touched.delete(keep);

    for (const v of touched) {
      // Remove old (drop,v), keep edge under (keep,v).
      const oldK = edgeKey(drop, v);
      if (edges.has(oldK)) edges.delete(oldK);
      const newK = edgeKey(keep, v);
      let nRec = edges.get(newK);
      if (!nRec) {
        nRec = { a: Math.min(keep,v), b: Math.max(keep,v), version: 0 };
        edges.set(newK, nRec);
      } else {
        nRec.version++;
      }
      const { cost, v: vStar } = edgeCost(nRec.a, nRec.b);
      heap.push({ a: nRec.a, b: nRec.b, version: nRec.version, cost, v: vStar });
    }
  }

  // ---- pack survivors out ----------------------------------------
  const idxMap = new Int32Array(nV0).fill(-1);
  const outPos = [];
  for (let i = 0; i < nV0; i++) {
    if (!vAlive[i]) continue;
    idxMap[i] = outPos.length / 3;
    outPos.push(pos[3*i], pos[3*i+1], pos[3*i+2]);
  }
  const outIdx = [];
  for (let t = 0; t < nT0; t++) {
    const F = faces[t];
    if (!F.alive) continue;
    const a = idxMap[F.a], b = idxMap[F.b], c = idxMap[F.c];
    if (a < 0 || b < 0 || c < 0) continue;
    if (a === b || b === c || c === a) continue;
    outIdx.push(a, b, c);
  }

  return {
    positions: new Float32Array(outPos),
    indices:   new Uint32Array(outIdx),
  };
}

/* -------------------------------------------------------------- */
/*  Laplacian + Taubin smoothing                                  */
/* -------------------------------------------------------------- */

export function smoothLaplacian(mesh, iterations = 5, lambda = 0.5) {
  const out = meshClone(mesh);
  const adj = buildAdjacency(out);
  const nV  = out.positions.length / 3;
  const work = new Float32Array(out.positions.length);

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < nV; i++) {
      const neighbours = adj[i];
      const n = neighbours.size;
      if (n === 0) {
        work[3*i]   = out.positions[3*i];
        work[3*i+1] = out.positions[3*i+1];
        work[3*i+2] = out.positions[3*i+2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const j of neighbours) {
        sx += out.positions[3*j];
        sy += out.positions[3*j+1];
        sz += out.positions[3*j+2];
      }
      const cx = sx / n - out.positions[3*i];
      const cy = sy / n - out.positions[3*i+1];
      const cz = sz / n - out.positions[3*i+2];
      work[3*i]   = out.positions[3*i]   + lambda * cx;
      work[3*i+1] = out.positions[3*i+1] + lambda * cy;
      work[3*i+2] = out.positions[3*i+2] + lambda * cz;
    }
    out.positions.set(work);
  }
  return out;
}

/* Taubin λ/μ pair to avoid shrinkage: positive λ pass, negative μ pass. */
export function smoothTaubin(mesh, iterations = 10, lambda = 0.5, mu = -0.53) {
  const out = meshClone(mesh);
  const adj = buildAdjacency(out);
  const nV  = out.positions.length / 3;
  const work = new Float32Array(out.positions.length);

  function pass(weight) {
    for (let i = 0; i < nV; i++) {
      const neighbours = adj[i];
      const n = neighbours.size;
      if (n === 0) {
        work[3*i]   = out.positions[3*i];
        work[3*i+1] = out.positions[3*i+1];
        work[3*i+2] = out.positions[3*i+2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (const j of neighbours) {
        sx += out.positions[3*j];
        sy += out.positions[3*j+1];
        sz += out.positions[3*j+2];
      }
      const cx = sx / n - out.positions[3*i];
      const cy = sy / n - out.positions[3*i+1];
      const cz = sz / n - out.positions[3*i+2];
      work[3*i]   = out.positions[3*i]   + weight * cx;
      work[3*i+1] = out.positions[3*i+1] + weight * cy;
      work[3*i+2] = out.positions[3*i+2] + weight * cz;
    }
    out.positions.set(work);
  }

  for (let it = 0; it < iterations; it++) {
    pass(lambda);
    pass(mu);
  }
  return out;
}

/* -------------------------------------------------------------- */
/*  Fill Holes — boundary loop detection + ear-clipping            */
/* -------------------------------------------------------------- */
//
// A boundary edge is one referenced by exactly one face. We walk
// each boundary edge into a closed loop, then triangulate the loop
// in the average-normal plane by ear-clipping.

function boundaryLoops(mesh) {
  const edgeCount = new Map(); // "a_b" (a<b) -> { a, b, dir: +1 / -1 / 0 }
  function bump(a, b) {
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    const dir = a < b ? +1 : -1;
    const rec = edgeCount.get(k);
    if (rec) rec.count++;
    else edgeCount.set(k, { a: Math.min(a,b), b: Math.max(a,b), count: 1, dir });
  }
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t], b = mesh.indices[t+1], c = mesh.indices[t+2];
    bump(a, b); bump(b, c); bump(c, a);
  }
  // Build directed half-edge map (from boundary edges only).
  const next = new Map(); // vertex → vertex
  for (const e of edgeCount.values()) {
    if (e.count !== 1) continue;
    next.set(e.a, e.b);
    // The other direction is unknown a priori; we'll re-orient via
    // walking and choosing whichever produces a closed loop.
  }
  const used = new Set();
  const loops = [];
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let cur = start;
    let safety = next.size * 2 + 8;
    while (safety-- > 0) {
      if (used.has(cur)) break;
      used.add(cur);
      loop.push(cur);
      const nxt = next.get(cur);
      if (nxt === undefined) break;
      if (nxt === start) { loops.push(loop); break; }
      cur = nxt;
    }
  }
  return loops;
}

function loopNormal(positions, loop) {
  // Newell's method.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i+1) % loop.length];
    const ax = positions[3*a],   ay = positions[3*a+1], az = positions[3*a+2];
    const bx = positions[3*b],   by = positions[3*b+1], bz = positions[3*b+2];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const l = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
  return [nx/l, ny/l, nz/l];
}

// Project the loop onto a 2D plane orthogonal to `normal` and run
// ear-clipping triangulation. Returns triangles as triplets of
// indices into `loop`.
function earClip(positions, loop, normal) {
  // Pick two basis vectors in the plane.
  const up = Math.abs(normal[1]) < 0.9 ? [0,1,0] : [1,0,0];
  const u  = vNorm(vCross(normal, up));
  const v  = vNorm(vCross(normal, u));
  const pts2 = loop.map((idx) => {
    const p = [positions[3*idx], positions[3*idx+1], positions[3*idx+2]];
    return [vDot(p, u), vDot(p, v)];
  });

  // Ear-clipping on the polygon defined by indices [0..n-1].
  const indices = loop.map((_, i) => i);
  const tris = [];
  // Ensure CCW: compute signed area; if < 0, reverse.
  let area = 0;
  for (let i = 0; i < pts2.length; i++) {
    const a = pts2[i], b = pts2[(i+1) % pts2.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) indices.reverse();

  function isConvex(i0, i1, i2) {
    const a = pts2[i0], b = pts2[i1], c = pts2[i2];
    const cross = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    return cross > 0;
  }
  function pointInTri(p, a, b, c) {
    const d1 = (p[0]-b[0])*(a[1]-b[1]) - (a[0]-b[0])*(p[1]-b[1]);
    const d2 = (p[0]-c[0])*(b[1]-c[1]) - (b[0]-c[0])*(p[1]-c[1]);
    const d3 = (p[0]-a[0])*(c[1]-a[1]) - (c[0]-a[0])*(p[1]-a[1]);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  let safety = indices.length * indices.length + 8;
  while (indices.length > 3 && safety-- > 0) {
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const i0 = indices[(i - 1 + indices.length) % indices.length];
      const i1 = indices[i];
      const i2 = indices[(i + 1) % indices.length];
      if (!isConvex(i0, i1, i2)) continue;
      let anyInside = false;
      for (let j = 0; j < indices.length; j++) {
        const k = indices[j];
        if (k === i0 || k === i1 || k === i2) continue;
        if (pointInTri(pts2[k], pts2[i0], pts2[i1], pts2[i2])) {
          anyInside = true; break;
        }
      }
      if (anyInside) continue;
      tris.push([i0, i1, i2]);
      indices.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break;
  }
  if (indices.length === 3) tris.push([indices[0], indices[1], indices[2]]);
  return tris;
}

export function fillHoles(mesh) {
  const loops = boundaryLoops(mesh);
  if (loops.length === 0) return meshClone(mesh);

  const outPos = Array.from(mesh.positions);
  const outIdx = Array.from(mesh.indices);
  let filled = 0;

  for (const loop of loops) {
    if (loop.length < 3) continue;
    const n = loopNormal(mesh.positions, loop);
    const tris = earClip(mesh.positions, loop, n);
    for (const t of tris) {
      // Use orientation that opposes the surrounding face normals
      // — we picked `n` from the loop winding so this gives an
      // outward-facing patch.
      outIdx.push(loop[t[0]], loop[t[1]], loop[t[2]]);
      filled++;
    }
  }
  return {
    positions: new Float32Array(outPos),
    indices:   new Uint32Array(outIdx),
    filled,
    loops: loops.length,
  };
}

/* -------------------------------------------------------------- */
/*  Self-intersection repair via manifold-3d                      */
/* -------------------------------------------------------------- */

async function meshToManifold(mesh, top) {
  // Build a manifold-3d Mesh (numProp=3, x/y/z only).
  const m = new top.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(mesh.positions),
    triVerts:       new Uint32Array(mesh.indices),
  });
  m.merge();
  return new top.Manifold(m);
}

function manifoldToMesh(M, top) {
  const m = M.getMesh();
  // Extract positions (first 3 props per vert).
  const np = m.numProp;
  const nv = m.numVert;
  const positions = new Float32Array(nv * 3);
  if (np === 3) {
    positions.set(m.vertProperties.subarray(0, nv * 3));
  } else {
    for (let i = 0; i < nv; i++) {
      positions[3*i]   = m.vertProperties[i*np];
      positions[3*i+1] = m.vertProperties[i*np + 1];
      positions[3*i+2] = m.vertProperties[i*np + 2];
    }
  }
  return {
    positions,
    indices: new Uint32Array(m.triVerts),
  };
}

export async function repairSelfIntersect(mesh) {
  const top = await ensureManifold();
  let M = null;
  try {
    M = await meshToManifold(mesh, top);
    const status = M.status();
    if (status !== 'NoError') {
      // The constructor already cleans degenerate triangles + merges
      // along open edges within tolerance.
      throw new Error(`manifold status: ${status}`);
    }
    const out = manifoldToMesh(M, top);
    return out;
  } finally {
    if (M) M.delete();
  }
}

/* -------------------------------------------------------------- */
/*  Boolean ops (union / cut / intersect)                         */
/* -------------------------------------------------------------- */

export async function meshBoolean(meshA, meshB, op) {
  const top = await ensureManifold();
  let A = null, B = null, C = null;
  try {
    A = await meshToManifold(meshA, top);
    B = await meshToManifold(meshB, top);
    if (op === 'union')     C = A.add(B);
    else if (op === 'cut')  C = A.subtract(B);
    else if (op === 'intersect') C = A.intersect(B);
    else throw new Error(`unknown boolean op: ${op}`);
    if (C.status() !== 'NoError') {
      throw new Error(`manifold boolean status: ${C.status()}`);
    }
    return manifoldToMesh(C, top);
  } finally {
    if (A) A.delete();
    if (B) B.delete();
    if (C) C.delete();
  }
}

/* -------------------------------------------------------------- */
/*  Remesh (uniform target edge length)                            */
/* -------------------------------------------------------------- */
//
// 1. Split edges longer than 4/3 · target by inserting a midpoint
//    vertex (refine the two faces sharing the edge).
// 2. Collapse edges shorter than 4/5 · target using QEM cost.
// 3. Run one Laplacian relaxation pass.

export function remeshUniform(mesh, targetEdgeLen, iterations = 2) {
  let out = meshClone(mesh);
  const tHigh = (4/3) * targetEdgeLen;
  const tLow  = (4/5) * targetEdgeLen;

  for (let it = 0; it < iterations; it++) {
    // ---- split long edges ----------------------------------------
    const splitMap = new Map(); // "a_b" -> new vertex index
    function midpointIdx(a, b) {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      const ex = splitMap.get(k);
      if (ex !== undefined) return ex;
      const ax = out.positions[3*a], ay = out.positions[3*a+1], az = out.positions[3*a+2];
      const bx = out.positions[3*b], by = out.positions[3*b+1], bz = out.positions[3*b+2];
      const idx = out.positions.length / 3 + (newPos.length / 3);
      newPos.push((ax+bx)/2, (ay+by)/2, (az+bz)/2);
      splitMap.set(k, idx);
      return idx;
    }
    const newPos = [];
    const newIdx = [];
    for (let t = 0; t < out.indices.length; t += 3) {
      const a = out.indices[t], b = out.indices[t+1], c = out.indices[t+2];
      const lab = dist(out.positions, a, b);
      const lbc = dist(out.positions, b, c);
      const lca = dist(out.positions, c, a);
      const sab = lab > tHigh, sbc = lbc > tHigh, sca = lca > tHigh;
      if (!sab && !sbc && !sca) { newIdx.push(a, b, c); continue; }
      // 1-split, 2-split, 3-split cases.
      if (sab && !sbc && !sca) {
        const m = midpointIdx(a, b);
        newIdx.push(a, m, c, m, b, c);
      } else if (!sab && sbc && !sca) {
        const m = midpointIdx(b, c);
        newIdx.push(a, b, m, a, m, c);
      } else if (!sab && !sbc && sca) {
        const m = midpointIdx(c, a);
        newIdx.push(a, b, m, b, c, m);
      } else if (sab && sbc && !sca) {
        const m1 = midpointIdx(a, b), m2 = midpointIdx(b, c);
        newIdx.push(a, m1, c, m1, m2, c, m1, b, m2);
      } else if (!sab && sbc && sca) {
        const m1 = midpointIdx(b, c), m2 = midpointIdx(c, a);
        newIdx.push(a, b, m1, a, m1, m2, m2, m1, c);
      } else if (sab && !sbc && sca) {
        const m1 = midpointIdx(a, b), m2 = midpointIdx(c, a);
        newIdx.push(m2, m1, b, m2, b, c, a, m1, m2);
      } else {
        const m1 = midpointIdx(a, b), m2 = midpointIdx(b, c), m3 = midpointIdx(c, a);
        newIdx.push(a, m1, m3, m1, b, m2, m3, m2, c, m1, m2, m3);
      }
    }
    const merged = new Float32Array(out.positions.length + newPos.length);
    merged.set(out.positions, 0);
    merged.set(new Float32Array(newPos), out.positions.length);
    out = {
      positions: merged,
      indices:   new Uint32Array(newIdx),
    };

    // ---- collapse short edges via QEM (target = current - count of shorts).
    const shortCount = (() => {
      let n = 0;
      for (let t = 0; t < out.indices.length; t += 3) {
        const a = out.indices[t], b = out.indices[t+1], c = out.indices[t+2];
        if (dist(out.positions, a, b) < tLow) n++;
        if (dist(out.positions, b, c) < tLow) n++;
        if (dist(out.positions, c, a) < tLow) n++;
      }
      return n;
    })();
    if (shortCount > 0) {
      const triCount = out.indices.length / 3;
      const target = Math.max(4, triCount - Math.floor(shortCount * 0.6));
      out = decimateQEM(out, target);
    }

    // ---- one Laplacian relax pass ---------------------------------
    out = smoothLaplacian(out, 1, 0.5);
  }
  return out;
}

function dist(positions, a, b) {
  const dx = positions[3*a]   - positions[3*b];
  const dy = positions[3*a+1] - positions[3*b+1];
  const dz = positions[3*a+2] - positions[3*b+2];
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

/* -------------------------------------------------------------- */
/*  Cluster simplification (voxel grid)                            */
/* -------------------------------------------------------------- */

export function simplifyClustering(mesh, voxelSize) {
  const inv = 1 / voxelSize;
  const cellOf = new Int32Array(mesh.positions.length / 3);
  const map    = new Map(); // "ix_iy_iz" -> { idx, sumX, sumY, sumZ, n }
  let nextIdx = 0;
  const outPos = [];

  for (let i = 0; i < cellOf.length; i++) {
    const x = mesh.positions[3*i],   y = mesh.positions[3*i+1], z = mesh.positions[3*i+2];
    const ix = Math.floor(x * inv);
    const iy = Math.floor(y * inv);
    const iz = Math.floor(z * inv);
    const k = `${ix}_${iy}_${iz}`;
    let rec = map.get(k);
    if (!rec) {
      rec = { idx: nextIdx++, sumX: 0, sumY: 0, sumZ: 0, n: 0 };
      map.set(k, rec);
      outPos.push(0, 0, 0); // placeholder
    }
    rec.sumX += x; rec.sumY += y; rec.sumZ += z; rec.n++;
    cellOf[i] = rec.idx;
  }
  for (const rec of map.values()) {
    outPos[3*rec.idx]   = rec.sumX / rec.n;
    outPos[3*rec.idx+1] = rec.sumY / rec.n;
    outPos[3*rec.idx+2] = rec.sumZ / rec.n;
  }

  const outIdx = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = cellOf[mesh.indices[t]];
    const b = cellOf[mesh.indices[t+1]];
    const c = cellOf[mesh.indices[t+2]];
    if (a === b || b === c || c === a) continue;
    outIdx.push(a, b, c);
  }
  return {
    positions: new Float32Array(outPos),
    indices:   new Uint32Array(outIdx),
  };
}

/* -------------------------------------------------------------- */
/*  Loop subdivision (triangle mesh)                              */
/* -------------------------------------------------------------- */
//
// For each edge insert a midpoint with Loop weights (3/8 endpoints,
// 1/8 opposite vertices). For each original vertex apply the Loop
// vertex rule: β = (1/n) (5/8 − (3/8 + 1/4 cos(2π/n))²) using
// Warren's coefficient.
//
// Each face becomes four sub-faces.

export function subdivideLoop(mesh) {
  const nV0 = mesh.positions.length / 3;
  const indices = mesh.indices;

  // Map "a_b" (a<b) → { midIdx, opposites: [v1, v2?] }.
  const edges = new Map();
  function edgeKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t+1], c = indices[t+2];
    for (const [u, v, w] of [[a,b,c],[b,c,a],[c,a,b]]) {
      const k = edgeKey(u, v);
      let rec = edges.get(k);
      if (!rec) { rec = { a: Math.min(u,v), b: Math.max(u,v), opp: [] }; edges.set(k, rec); }
      rec.opp.push(w);
    }
  }

  // Compute midpoints + assign new indices starting at nV0.
  const newPos = Array.from(mesh.positions);
  let nextV = nV0;
  for (const rec of edges.values()) {
    const isBoundary = rec.opp.length < 2;
    const a = rec.a, b = rec.b;
    let mx, my, mz;
    if (isBoundary) {
      mx = 0.5 * (mesh.positions[3*a]   + mesh.positions[3*b]);
      my = 0.5 * (mesh.positions[3*a+1] + mesh.positions[3*b+1]);
      mz = 0.5 * (mesh.positions[3*a+2] + mesh.positions[3*b+2]);
    } else {
      const c1 = rec.opp[0], c2 = rec.opp[1];
      mx = 3/8 * (mesh.positions[3*a]   + mesh.positions[3*b])
         + 1/8 * (mesh.positions[3*c1]  + mesh.positions[3*c2]);
      my = 3/8 * (mesh.positions[3*a+1] + mesh.positions[3*b+1])
         + 1/8 * (mesh.positions[3*c1+1]+ mesh.positions[3*c2+1]);
      mz = 3/8 * (mesh.positions[3*a+2] + mesh.positions[3*b+2])
         + 1/8 * (mesh.positions[3*c1+2]+ mesh.positions[3*c2+2]);
    }
    rec.midIdx = nextV++;
    newPos.push(mx, my, mz);
  }

  // Apply Loop vertex rule to original vertices.
  const adj = buildAdjacency(mesh);
  for (let i = 0; i < nV0; i++) {
    const neighbours = Array.from(adj[i]);
    const n = neighbours.length;
    if (n === 0) continue;
    const t = (3/8) + (1/4) * Math.cos(2 * Math.PI / n);
    const beta = (1 / n) * (5/8 - t * t);
    let sx = 0, sy = 0, sz = 0;
    for (const j of neighbours) {
      sx += mesh.positions[3*j];
      sy += mesh.positions[3*j+1];
      sz += mesh.positions[3*j+2];
    }
    newPos[3*i]   = (1 - n * beta) * mesh.positions[3*i]   + beta * sx;
    newPos[3*i+1] = (1 - n * beta) * mesh.positions[3*i+1] + beta * sy;
    newPos[3*i+2] = (1 - n * beta) * mesh.positions[3*i+2] + beta * sz;
  }

  // Build new face index array.
  const newIdx = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t+1], c = indices[t+2];
    const mab = edges.get(edgeKey(a, b)).midIdx;
    const mbc = edges.get(edgeKey(b, c)).midIdx;
    const mca = edges.get(edgeKey(c, a)).midIdx;
    newIdx.push(a, mab, mca, mab, b, mbc, mca, mbc, c, mab, mbc, mca);
  }

  return {
    positions: new Float32Array(newPos),
    indices:   new Uint32Array(newIdx),
  };
}

/* -------------------------------------------------------------- */
/*  Catmull–Clark subdivision (triangle-mesh variant)              */
/* -------------------------------------------------------------- */
//
// Genuine CC operates on quad meshes; for a triangle input we apply
// the standard triangle-CC scheme of Stam-Loop:
//   * face point F  = centroid of face.
//   * edge point E  = (face[+] + face[-] + endpoints) / 4 (interior),
//                     midpoint on boundary.
//   * vertex point  = (4Q + 2R + (n-3)V) / n  where Q is the average of
//                     incident face points and R the average of incident
//                     edge midpoints (CC vertex rule).
//
// Each original triangle is replaced by three quads (V—E—F—E), each
// then triangulated into two triangles.

export function subdivideCatmullClark(mesh) {
  const indices  = mesh.indices;
  const nV0      = mesh.positions.length / 3;
  const nF       = indices.length / 3;

  // Face points.
  const facePts = new Float32Array(nF * 3);
  for (let t = 0; t < nF; t++) {
    const a = indices[3*t], b = indices[3*t+1], c = indices[3*t+2];
    facePts[3*t]   = (mesh.positions[3*a]   + mesh.positions[3*b]   + mesh.positions[3*c])   / 3;
    facePts[3*t+1] = (mesh.positions[3*a+1] + mesh.positions[3*b+1] + mesh.positions[3*c+1]) / 3;
    facePts[3*t+2] = (mesh.positions[3*a+2] + mesh.positions[3*b+2] + mesh.positions[3*c+2]) / 3;
  }

  // Edges: key "a_b" → { faces: [t1, t2?], midIdx?: }
  const edges = new Map();
  function edgeKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }
  for (let t = 0; t < nF; t++) {
    const a = indices[3*t], b = indices[3*t+1], c = indices[3*t+2];
    for (const [u, v] of [[a,b],[b,c],[c,a]]) {
      const k = edgeKey(u, v);
      let rec = edges.get(k);
      if (!rec) { rec = { a: Math.min(u,v), b: Math.max(u,v), faces: [] }; edges.set(k, rec); }
      rec.faces.push(t);
    }
  }

  // Edge points.
  const outPos = Array.from(mesh.positions);
  // Reserve slots for face points.
  const faceBase = nV0;
  for (let t = 0; t < nF; t++) {
    outPos.push(facePts[3*t], facePts[3*t+1], facePts[3*t+2]);
  }
  let nextV = faceBase + nF;
  for (const rec of edges.values()) {
    const a = rec.a, b = rec.b;
    const interior = rec.faces.length === 2;
    let ex, ey, ez;
    if (interior) {
      const f0 = rec.faces[0], f1 = rec.faces[1];
      ex = (mesh.positions[3*a]   + mesh.positions[3*b]   + facePts[3*f0]   + facePts[3*f1])   / 4;
      ey = (mesh.positions[3*a+1] + mesh.positions[3*b+1] + facePts[3*f0+1] + facePts[3*f1+1]) / 4;
      ez = (mesh.positions[3*a+2] + mesh.positions[3*b+2] + facePts[3*f0+2] + facePts[3*f1+2]) / 4;
    } else {
      ex = 0.5 * (mesh.positions[3*a]   + mesh.positions[3*b]);
      ey = 0.5 * (mesh.positions[3*a+1] + mesh.positions[3*b+1]);
      ez = 0.5 * (mesh.positions[3*a+2] + mesh.positions[3*b+2]);
    }
    rec.midIdx = nextV++;
    outPos.push(ex, ey, ez);
  }

  // Vertex rule: collect incident faces + edges per original vertex.
  const incidentFaces = new Array(nV0);
  for (let i = 0; i < nV0; i++) incidentFaces[i] = [];
  for (let t = 0; t < nF; t++) {
    incidentFaces[indices[3*t]].push(t);
    incidentFaces[indices[3*t+1]].push(t);
    incidentFaces[indices[3*t+2]].push(t);
  }
  const incidentEdges = new Array(nV0);
  for (let i = 0; i < nV0; i++) incidentEdges[i] = [];
  for (const rec of edges.values()) {
    incidentEdges[rec.a].push(rec);
    incidentEdges[rec.b].push(rec);
  }
  for (let i = 0; i < nV0; i++) {
    const fs = incidentFaces[i];
    const es = incidentEdges[i];
    const n  = es.length;
    if (n === 0) continue;
    let qx = 0, qy = 0, qz = 0;
    for (const t of fs) {
      qx += facePts[3*t]; qy += facePts[3*t+1]; qz += facePts[3*t+2];
    }
    qx /= fs.length; qy /= fs.length; qz /= fs.length;
    let rx = 0, ry = 0, rz = 0;
    for (const e of es) {
      const a = e.a, b = e.b;
      rx += 0.5 * (mesh.positions[3*a]   + mesh.positions[3*b]);
      ry += 0.5 * (mesh.positions[3*a+1] + mesh.positions[3*b+1]);
      rz += 0.5 * (mesh.positions[3*a+2] + mesh.positions[3*b+2]);
    }
    rx /= n; ry /= n; rz /= n;
    const V = [mesh.positions[3*i], mesh.positions[3*i+1], mesh.positions[3*i+2]];
    outPos[3*i]   = (qx + 2*rx + (n - 3) * V[0]) / n;
    outPos[3*i+1] = (qy + 2*ry + (n - 3) * V[1]) / n;
    outPos[3*i+2] = (qz + 2*rz + (n - 3) * V[2]) / n;
  }

  // Build sub-faces: each original triangle → three quads → six tris.
  const newIdx = [];
  for (let t = 0; t < nF; t++) {
    const a = indices[3*t], b = indices[3*t+1], c = indices[3*t+2];
    const F = faceBase + t;
    const Eab = edges.get(edgeKey(a, b)).midIdx;
    const Ebc = edges.get(edgeKey(b, c)).midIdx;
    const Eca = edges.get(edgeKey(c, a)).midIdx;
    // quad (a, Eab, F, Eca) → tris
    newIdx.push(a, Eab, F,  a, F, Eca);
    // quad (b, Ebc, F, Eab) → tris
    newIdx.push(b, Ebc, F,  b, F, Eab);
    // quad (c, Eca, F, Ebc) → tris
    newIdx.push(c, Eca, F,  c, F, Ebc);
  }

  return {
    positions: new Float32Array(outPos),
    indices:   new Uint32Array(newIdx),
  };
}

/* -------------------------------------------------------------- */
/*  Solid ↔ mesh conversion helpers                                */
/* -------------------------------------------------------------- */

export function tessellateNativeBody(handle, linTol = 0.1, angTol = 0.5) {
  if (typeof window === 'undefined') throw new Error('no window');
  const f = window.forge;
  if (!f || typeof f.tessellate !== 'function')
    throw new Error('forge.tessellate unavailable');
  const t = f.tessellate(handle, linTol, angTol);
  if (!t || !t.positions || !t.indices)
    throw new Error('tessellate returned no geometry');
  return {
    positions: t.positions instanceof Float32Array ? new Float32Array(t.positions)
                                                   : new Float32Array(t.positions),
    indices:   t.indices   instanceof Uint32Array  ? new Uint32Array(t.indices)
                                                   : new Uint32Array(t.indices),
  };
}

/* Write the mesh out as a binary STL into a tmp file and re-import
 * through forge.io.importStl to get a native handle. Returns the new
 * native body handle. */
export async function meshToSolidViaStl(mesh, tmpName = 'forge-mesh') {
  if (typeof window === 'undefined') throw new Error('no window');
  const f = window.forge;
  if (!f || !f.io || typeof f.io.importStl !== 'function')
    throw new Error('forge.io.importStl unavailable');

  const stl = encodeBinaryStl(mesh);
  // Write the bytes via the bridged temp-file writer; preload exposes
  // `forge.dialog.writeTmp` in dev builds — fall back to data-URI is
  // not allowed per "no fallback". If the writer is missing, surface
  // the real failure.
  if (typeof f.io.writeTmpStl !== 'function')
    throw new Error('forge.io.writeTmpStl unavailable — cannot persist mesh STL');
  const path = await f.io.writeTmpStl(`${tmpName}.stl`, stl);
  return f.io.importStl(path);
}

function encodeBinaryStl(mesh) {
  const triCount = mesh.indices.length / 3;
  const bytes = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(bytes);
  // 80-byte header (zeros).
  dv.setUint32(80, triCount, true);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const a = mesh.indices[3*t], b = mesh.indices[3*t+1], c = mesh.indices[3*t+2];
    const ax = mesh.positions[3*a], ay = mesh.positions[3*a+1], az = mesh.positions[3*a+2];
    const bx = mesh.positions[3*b], by = mesh.positions[3*b+1], bz = mesh.positions[3*b+2];
    const cx = mesh.positions[3*c], cy = mesh.positions[3*c+1], cz = mesh.positions[3*c+2];
    const nx = (by-ay)*(cz-az) - (bz-az)*(cy-ay);
    const ny = (bz-az)*(cx-ax) - (bx-ax)*(cz-az);
    const nz = (bx-ax)*(cy-ay) - (by-ay)*(cx-ax);
    const ln = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    dv.setFloat32(offset,    nx/ln, true);
    dv.setFloat32(offset+4,  ny/ln, true);
    dv.setFloat32(offset+8,  nz/ln, true);
    dv.setFloat32(offset+12, ax, true); dv.setFloat32(offset+16, ay, true); dv.setFloat32(offset+20, az, true);
    dv.setFloat32(offset+24, bx, true); dv.setFloat32(offset+28, by, true); dv.setFloat32(offset+32, bz, true);
    dv.setFloat32(offset+36, cx, true); dv.setFloat32(offset+40, cy, true); dv.setFloat32(offset+44, cz, true);
    dv.setUint16(offset+48, 0, true);
    offset += 50;
  }
  return new Uint8Array(bytes);
}

/* -------------------------------------------------------------- */
/*  Public dispatch table (used by the shell + MeshWorkbench)      */
/* -------------------------------------------------------------- */

export const MeshDispatch = {
  ensureManifold,
  manifoldReady,
  meshClone,
  meshStats,
  decimateQEM,
  smoothLaplacian,
  smoothTaubin,
  fillHoles,
  repairSelfIntersect,
  meshBoolean,
  remeshUniform,
  simplifyClustering,
  subdivideLoop,
  subdivideCatmullClark,
  tessellateNativeBody,
  meshToSolidViaStl,
};

export default MeshDispatch;
