/**
 * ArchDisc Foundation — constructive rolling-ball blend surfaces.
 *
 * A true auto-trimming edge-fillet kernel for arbitrary B-Rep is a
 * full NURBS kernel (Parasolid-class). This module delivers the part
 * that IS bounded: the constructive rolling-ball blend surface.
 *
 *   blendArc          — the cross-section primitive: the circular arc a
 *                       ball of radius r traces between two contact
 *                       points, given the ball centre.
 *   dihedralFillet    — exact fillet surface between two planar faces.
 *   cylinderGroundFillet — exact fillet between a cylinder and a plane,
 *                       i.e. a genuine curved-surface blend.
 *   blendLoft         — loft a blend through arbitrary contact stations.
 *
 * Every blend produced here is G1 (tangent-continuous) with both base
 * surfaces along its contact curves — verified in the e2e. What it does
 * NOT do is auto-detect an edge on an imported solid and trim it; the
 * caller supplies the faces/edge.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

/** Spherical-linear interpolation of two unit vectors. */
function slerp(u0, u1, t) {
  const c = Math.max(-1, Math.min(1, dot(u0, u1)));
  const omega = Math.acos(c);
  if (omega < 1e-9) return unit(add(scale(u0, 1 - t), scale(u1, t)));
  const s = Math.sin(omega);
  return add(scale(u0, Math.sin((1 - t) * omega) / s), scale(u1, Math.sin(t * omega) / s));
}

/**
 * The rolling-ball cross-section: the circular arc of the ball (centre
 * `C`, radius |C−cA|) from contact point `cA` to contact point `cB`.
 * The ball centre is given explicitly so there is no normal-direction
 * ambiguity. Every arc point is exactly r from C; the arc is tangent to
 * each base surface at its contact point.
 *
 * @returns {{ points:number[][], center:number[], radius:number }}
 */
export function blendArc(C, cA, cB, nSeg = 12) {
  const r = norm(sub(cA, C));
  const uA = scale(sub(cA, C), 1 / r);
  const uB = scale(sub(cB, C), 1 / (norm(sub(cB, C)) || 1));
  const points = [];
  for (let i = 0; i <= nSeg; i++) {
    points.push(add(C, scale(slerp(uA, uB, i / nSeg), r)));
  }
  return { points, center: C, radius: r };
}

/** Outward normal of a blend arc at one end (radial from the centre). */
export function arcEndNormal(arc, whichEnd = 'start') {
  const P = whichEnd === 'start' ? arc.points[0] : arc.points[arc.points.length - 1];
  return unit(sub(P, arc.center));
}

/** Triangulate an (nLen+1)×(nArc+1) grid of vertices into a mesh. */
function gridMesh(grid) {
  const nLen = grid.length - 1, nArc = grid[0].length - 1;
  const vertices = [];
  for (const row of grid) for (const v of row) vertices.push(v);
  const index = (i, j) => i * (nArc + 1) + j;
  const triangles = [];
  for (let i = 0; i < nLen; i++) {
    for (let j = 0; j < nArc; j++) {
      triangles.push([index(i, j), index(i + 1, j), index(i + 1, j + 1)]);
      triangles.push([index(i, j), index(i + 1, j + 1), index(i, j + 1)]);
    }
  }
  return { vertices, triangles };
}

/**
 * Exact rolling-ball fillet surface between two planar faces meeting at
 * an edge. `nA`, `nB` are the OUTWARD face normals (unit). The ball of
 * radius r rolls in the dihedral; the fillet is the cylindrical patch it
 * sweeps, G1-tangent to both faces.
 *
 * @returns {{ mesh, contactA, contactB, axis, crossSectionRadius }}
 */
export function dihedralFillet(edgeOrigin, edgeDir, nA, nB, r, length, nArc = 16, nLen = 8) {
  const e = unit(edgeDir);
  const nAu = unit(nA), nBu = unit(nB);
  const c = dot(nAu, nBu);
  // Ball-centre offset: C lies r from each face, C = edge − (r/(1+c))(nA+nB).
  const alpha = -r / (1 + c);
  const grid = [], contactA = [], contactB = [], axis = [];
  for (let s = 0; s <= nLen; s++) {
    const ep = add(edgeOrigin, scale(e, (s / nLen) * length));
    const C = add(ep, scale(add(nAu, nBu), alpha));
    const cA = add(C, scale(nAu, r));     // contact on face A
    const cB = add(C, scale(nBu, r));     // contact on face B
    axis.push(C); contactA.push(cA); contactB.push(cB);
    grid.push(blendArc(C, cA, cB, nArc).points);
  }
  return { mesh: gridMesh(grid), contactA, contactB, axis, crossSectionRadius: r };
}

/**
 * Exact rolling-ball fillet between a cylinder (radius R, axis parallel
 * to +Y at height z=R, resting on the plane z=0) and that plane — a
 * genuine curved-surface blend. The ball of radius r rolls in the
 * concave corner.
 *
 * @returns {{ mesh, contactPlane, contactCylinder, planeNormal, cylinderNormal }}
 */
export function cylinderGroundFillet(R, r, length, nArc = 16, nLen = 8) {
  const xc = 2 * Math.sqrt(R * r);          // ball-centre x
  const grid = [], contactPlane = [], contactCylinder = [];
  let cylNormalRef = null;
  for (let s = 0; s <= nLen; s++) {
    const y = (s / nLen) * length;
    const C = [xc, y, r];
    const cP = [xc, y, 0];                  // contact on the plane
    const ax = [0, y, R];                   // cylinder axis point
    const dir = unit(sub(C, ax));
    const cC = add(ax, scale(dir, R));      // contact on the cylinder
    if (s === 0) cylNormalRef = dir;
    contactPlane.push(cP); contactCylinder.push(cC);
    grid.push(blendArc(C, cP, cC, nArc).points);
  }
  return {
    mesh: gridMesh(grid),
    contactPlane, contactCylinder,
    planeNormal: [0, 0, 1], cylinderNormal: cylNormalRef,
  };
}

/**
 * Loft a blend surface through a list of contact stations. Each station
 * gives the ball centre and the two contact points at one position
 * along the edge.
 *
 * @param {Array<{C:number[], cA:number[], cB:number[]}>} stations
 * @returns {{ mesh }}
 */
export function blendLoft(stations, nArc = 16) {
  const grid = stations.map((st) => blendArc(st.C, st.cA, st.cB, nArc).points);
  return { mesh: gridMesh(grid) };
}
