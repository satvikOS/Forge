// ===========================================================================
// NAFEMS LE1 / LE10 boundary conditions and loads — ONE model, pure JS, no addon.
// ---------------------------------------------------------------------------
// fea_nafems_gate.mjs and fea_nafems_convergence.mjs each carried their own copy of these
// helpers, described as "lifted verbatim ... so the models are IDENTICAL". They were not:
// the gate's near() ignored its tolerance argument, so its LE10 mid-plane u_z support
// caught only nodes at exactly z = t/2 while the sweep's caught a ±0.6·edge band. Both
// also selected the outer elliptic edge with |f − 1| < 0.06 in normalised ellipse units,
// a collar ~0.1 m deep that clamps interior material: on the gate's own LE10 mesh at edge
// 0.15 it took 125 nodes where the true outer surface has 48
// (implementation/sacrosanct/findings/NAFEMS_GAP_IS_A_FROZEN_BOUNDARY.md §5).
//
// The published conditions (TNSB Rev.3, NAFEMS 1990) are SURFACE conditions:
//   LE1  outer edge loaded by 10 MPa outward normal pressure; x=0 / y=0 symmetry.
//   LE10 outer curved face u_x = u_y = 0; mid-plane line of that face u_z = 0;
//        1 MPa on the upper face; x=0 / y=0 symmetry.
// So the outer face is found the way a surface is found in a tet mesh: among the faces
// incident on exactly one tet, by eliminating the planes and the inner ellipse. A node below
// the surface is never selected however close it sits, and a node on the faceted or ragged
// surface is selected however far it has sagged from the analytic ellipse.
//
// fea_nafems_bc_sets_test.mjs proves the selectors on a structured mesh whose outer surface
// is known exactly, and keeps the old band as a positive control that must be caught.
// ===========================================================================

export const OUTER = Object.freeze({ a: 3.25, b: 2.75 });
export const INNER = Object.freeze({ a: 2.0, b: 1.0 });

export const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
export const NODE = (m, i) => [m.nodes[3 * i], m.nodes[3 * i + 1], m.nodes[3 * i + 2]];

// The elliptic annular quarter slab (LE1/LE10): a thin z-slice of a large-rz ellipsoid
// pair ≈ a true elliptic cylinder. Outer 3.25/2.75, inner 2.0/1.0, z ∈ [0, t]. The addon
// handle is passed in so this module stays loadable without it.
export function buildEllipticSlab(forge, t) {
  const RZ = 30.0;
  const o = forge.makeEllipsoid(OUTER.a, OUTER.b, RZ), i = forge.makeEllipsoid(INNER.a, INNER.b, RZ);
  const ann = forge.cut(o, i), cl = forge.makeBox(3.5, 3.0, t), q = forge.common(ann, cl);
  for (const h of [o, i, ann, cl]) forge.release(h);
  return q;
}

// Faces incident on exactly one tet; each is [v0, v1, v2, apex] with apex the opposite vertex.
export function tetBoundaryFaces(m) {
  const t = m.tets, nT = m.tetCount, cnt = new Map(), rep = new Map();
  const key = (a, b, c) => { const s = [a, b, c].sort((x, y) => x - y); return s[0] + '_' + s[1] + '_' + s[2]; };
  for (let e = 0; e < nT; e++) {
    const a = t[4 * e], b = t[4 * e + 1], c = t[4 * e + 2], d = t[4 * e + 3];
    for (const f of [[a, b, c, d], [a, b, d, c], [a, c, d, b], [b, c, d, a]]) {
      const k = key(f[0], f[1], f[2]); cnt.set(k, (cnt.get(k) || 0) + 1); if (!rep.has(k)) rep.set(k, f);
    }
  }
  const out = []; for (const [k, c] of cnt) if (c === 1) out.push(rep.get(k)); return out;
}

// area + UNIT outward normal (flipped to point away from the tet's apex vertex).
export function triAreaOutwardNormal(p0, p1, p2, apex) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1; const A = 0.5 * L; nx /= L; ny /= L; nz /= L;
  const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3, cz = (p0[2] + p1[2] + p2[2]) / 3;
  if ((apex[0] - cx) * nx + (apex[1] - cy) * ny + (apex[2] - cz) * nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
  return [A, nx, ny, nz];
}

// First-order signed distance from (x, y) to the ellipse (x/a)² + (y/b)² = 1, in metres:
// (f − 1) / |∇f|. Positive outside. Exact on the curve, O(d²) off it.
export function ellipseDistance(x, y, e = OUTER) {
  const f = (x / e.a) ** 2 + (y / e.b) ** 2;
  const g = Math.hypot(2 * x / (e.a * e.a), 2 * y / (e.b * e.b));
  return g > 0 ? (f - 1) / g : -Math.min(e.a, e.b);
}

// The outer elliptic face of a tet mesh of the quarter annulus, found by ELIMINATION.
// Every one-tet face is assigned to exactly one surface of the slab:
//   * all three vertices on x=0, on y=0, on z=zMin or on z=zMax  → that plane;
//   * otherwise it is curved, and belongs to whichever ellipse its centroid is nearer.
// Selecting by facet normal instead is NOT safe: meshShape does no boundary recovery, so at
// coarse targetEdge the tet boundary is ragged. MEASURED (fea_nafems_bc_ab.mjs, LE1 at
// targetEdge 0.20): a normal test (cos ≥ 0.7) applied a pressure resultant of only
// (2.38, 2.14)·10⁶ N against the exact p·t·(2.75, 3.25) = (2.75, 3.25)·10⁶ N, and the old
// collar (0.75, 0.38)·10⁶ N at 0.30. By elimination the outer set is the whole outer part
// of the discrete boundary, so ∮n dA = 0 makes its resultant exact whatever the facets do.
//   maxDev — a curved face whose centroid is further than this from its nearer ellipse is
//            a surface this geometry does not have; it is COUNTED (unassigned), never
//            dropped quietly. Faceting sag is NOT small: MEASURED 0.148 m at targetEdge
//            0.30 and 0.071 m at 0.20 on the gate's own slab, because densification
//            midpoints are not projected back onto the curve. The ellipses are ≥ 1.25 m
//            apart, so 0.5 m is far from both sides.
// Returns the outer faces, their node set, the worst node deviation from the analytic
// ellipse among them, and the unassigned count (a caller must treat any as an error).
export function outerEllipseSurface(m, bf = tetBoundaryFaces(m), { maxDev = 0.5, planeTol } = {}) {
  let zMin = Infinity, zMax = -Infinity, ext = 0;
  for (let k = 0; k < m.nodeCount; k++) {
    const z = m.nodes[3 * k + 2]; zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
    ext = Math.max(ext, Math.abs(m.nodes[3 * k]), Math.abs(m.nodes[3 * k + 1]), Math.abs(z));
  }
  const tol = planeTol ?? 1e-6 * Math.max(1, ext);
  const faces = [], nodes = new Set(); let worstDev = 0, unassigned = 0;
  for (const f of bf) {
    const p = [NODE(m, f[0]), NODE(m, f[1]), NODE(m, f[2])];
    const all = (fn) => p.every(fn);
    if (all(q => Math.abs(q[0]) < tol) || all(q => Math.abs(q[1]) < tol) ||
        all(q => Math.abs(q[2] - zMin) < tol) || all(q => Math.abs(q[2] - zMax) < tol)) continue;
    const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cy = (p[0][1] + p[1][1] + p[2][1]) / 3;
    const dO = Math.abs(ellipseDistance(cx, cy, OUTER)), dI = Math.abs(ellipseDistance(cx, cy, INNER));
    if (Math.min(dO, dI) > maxDev) { unassigned++; continue; }
    if (dI < dO) continue;                                   // the inner elliptic face
    const [A, nx, ny, nz] = triAreaOutwardNormal(p[0], p[1], p[2], NODE(m, f[3]));
    faces.push({ f, A, n: [nx, ny, nz] });
    for (let j = 0; j < 3; j++) { nodes.add(f[j]); worstDev = Math.max(worstDev, Math.abs(ellipseDistance(p[j][0], p[j][1], OUTER))); }
  }
  return { faces, nodes, worstDev, unassigned };
}

// The LE10 line support: the mid-plane line z = zMid of the outer face, traced on the mesh.
// Every outer facet that the line crosses contributes its vertex (or tied vertices) nearest
// the line. On a mesh with a node row at zMid this is exactly that row; otherwise it is the
// nearest-node trace, which converges to the line as the facets shrink. It is a ring along
// the whole arc — a single-node pin is NOT equivalent (measured +387..+622 %, wrong sign).
export function midPlaneTrace(m, outerFaces, zMid) {
  const nodes = new Set(); let worstDz = 0;
  for (const { f } of outerFaces) {
    const zs = [0, 1, 2].map(j => m.nodes[3 * f[j] + 2]);
    if (Math.min(...zs) > zMid || Math.max(...zs) < zMid) continue;
    const dz = zs.map(z => Math.abs(z - zMid)), best = Math.min(...dz);
    const tie = 1e-9 * Math.max(1, Math.abs(zMid));
    for (let j = 0; j < 3; j++) if (dz[j] <= best + tie) nodes.add(f[j]);
    worstDz = Math.max(worstDz, best);
  }
  return { nodes, worstDz };
}

// Boundary faces lying in the plane z = zPlane whose outward normal is ±z (sign = +1 top).
export function planeFaces(m, bf, zPlane, sign, tol = 1e-6) {
  const out = [];
  for (const f of bf) {
    const p0 = NODE(m, f[0]), p1 = NODE(m, f[1]), p2 = NODE(m, f[2]);
    if (!near(p0[2], zPlane, tol) || !near(p1[2], zPlane, tol) || !near(p2[2], zPlane, tol)) continue;
    const [A, nx, ny, nz] = triAreaOutwardNormal(p0, p1, p2, NODE(m, f[3]));
    if (nz * sign <= 0) continue;
    out.push({ f, A, n: [nx, ny, nz] });
  }
  return out;
}

// The complete LE1 / LE10 constraint and load model for a tet mesh of the quarter annulus
// slab of thickness t (z ∈ [0, t]). Pure: takes the mesh arrays, returns the solver inputs
// plus the selection diagnostics a report must print.
//   symTol — the x=0 / y=0 symmetry planes. The mesher places those nodes on the plane to
//            round-off; 1e-4 m is far below any element size used here.
//   topTol — the LE10 loaded face z = t.
export function ellipticPlateModel(kind, m, t, { symTol = 1e-4, topTol = 1e-3 } = {}) {
  if (kind !== 'LE1' && kind !== 'LE10') throw new Error(`ellipticPlateModel: unknown case ${kind}`);
  const nd = m.nodes, ids = m.ids;
  const bf = tetBoundaryFaces(m);
  const outer = outerEllipseSurface(m, bf);
  const mid = kind === 'LE10' ? midPlaneTrace(m, outer.faces, t / 2) : { nodes: new Set(), worstDz: 0 };
  const prescribed = [];
  for (let k = 0; k < m.nodeCount; k++) {
    const x = nd[3 * k], y = nd[3 * k + 1], z = nd[3 * k + 2];
    const p = { nodeId: ids[k], fx: false, fy: false, fz: false, ux: 0, uy: 0, uz: 0 };
    if (near(x, 0, symTol)) p.fx = true;          // x=0 symmetry plane: u_x = 0
    if (near(y, 0, symTol)) p.fy = true;          // y=0 symmetry plane: u_y = 0
    if (kind === 'LE1') {
      if (near(z, 0, symTol)) p.fz = true;        // membrane: pin rigid-z on z=0 face
    } else {
      if (outer.nodes.has(k)) { p.fx = true; p.fy = true; }   // outer face: u_x = u_y = 0
      if (mid.nodes.has(k)) p.fz = true;                      // its mid-plane line: u_z = 0
    }
    if (p.fx || p.fy || p.fz) prescribed.push(p);
  }
  // loads → equivalent nodal forces (the tet path has no pressure API)
  const accum = new Map(), add = (vi, fx, fy, fz) => { const c = accum.get(vi) || [0, 0, 0]; c[0] += fx; c[1] += fy; c[2] += fz; accum.set(vi, c); };
  let loadedArea = 0;
  if (kind === 'LE1') {
    const pres = 10e6;                            // outward 10 MPa on the outer elliptic edge
    for (const { f, A, n } of outer.faces) { loadedArea += A; for (const vi of [f[0], f[1], f[2]]) add(vi, pres * A / 3 * n[0], pres * A / 3 * n[1], pres * A / 3 * n[2]); }
  } else {
    const pres = 1e6;                             // 1 MPa downward on the top face z=t
    for (const { f, A } of planeFaces(m, bf, t, +1, topTol)) { loadedArea += A; for (const vi of [f[0], f[1], f[2]]) add(vi, 0, 0, -pres * A / 3); }
  }
  const nodalForces = [];
  const R = [0, 0, 0];
  for (const [vi, fv] of accum) { nodalForces.push({ nodeId: ids[vi], fx: fv[0], fy: fv[1], fz: fv[2] }); R[0] += fv[0]; R[1] += fv[1]; R[2] += fv[2]; }
  // LE1: ∮n dA = 0 makes the IN-PLANE outer-edge resultant p·t·(b, a) exactly, for ANY
  // facets, when the outer set is the whole outer part of the boundary and the symmetry
  // planes and inner arc are whole (their in-plane resultants are fixed by their end
  // points). Its relative error is the completeness check on the selection. The z part is
  // NOT fixed: top and bottom need not have equal area on a ragged mesh, so it is reported
  // (resultant[2]) and not folded in.
  const le1Exact = [10e6 * t * OUTER.b, 10e6 * t * OUTER.a];
  const resultantErr = kind === 'LE1' ? Math.hypot(R[0] - le1Exact[0], R[1] - le1Exact[1]) / Math.hypot(...le1Exact) : 0;
  return {
    prescribed, nodalForces,
    diag: { outerNodes: outer.nodes.size, outerFaces: outer.faces.length, outerWorstDev: outer.worstDev, outerUnassigned: outer.unassigned,
            midNodes: mid.nodes.size, midWorstDz: mid.worstDz, loadedArea, resultant: R, resultantErr },
  };
}
