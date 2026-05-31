/**
 * ArchDisc Foundation — Sweep + Loft features.
 *
 * SWEEP: extrudes a closed 2D profile along a 3D path, producing a
 * tubular solid. The profile is placed perpendicular to the path
 * tangent at every sample, transported using a rotation-minimizing
 * frame (Wang et al., the "double-reflection" method) so the profile
 * does not twist around the path.
 *
 * LOFT: blends N cross-section profiles (each with its own placement
 * frame) into a smooth solid by connecting corresponding points with
 * quad strips. Start and end caps are added if the loft is open.
 *
 * Both build a triangle soup → MeshGL → manifold-3d Manifold so the
 * result is guaranteed manifold and immediately usable in boolean
 * operations.
 *
 * Profile contract:
 *   - 2D point list [[x, y], ...] forming a CLOSED polygon
 *   - Counter-clockwise winding (when viewed looking down -tangent)
 *   - First point should NOT be repeated as last (we do that
 *     automatically when building wall faces)
 *
 * Path contract for sweep:
 *   - Either a NURBSCurve (preferred — exact tangents)
 *   - Or a polyline [[x, y, z], ...]  (tangent computed by finite
 *     differences)
 *
 * Sweep validation:
 *   1. Circle profile R=2 mm swept along straight 50 mm path
 *      → cylinder, V = π(2)² · 50 = 628.32 mm³
 *   2. Circle R=1 mm swept along quarter-arc of radius 10 mm
 *      → torus quadrant, V = π · π · R · r² · (1/2) = π²(10)(1)²/2 ≈ 49.35 mm³
 *
 * Loft validation:
 *   1. Loft 4 circular profiles increasing in radius (truncated cone)
 *      → V = (πh/3)(r1² + r1·r2 + r2²)
 *   2. Loft from circle to square (impossible-by-extrusion shape)
 *      → just verify manifoldness and bounding box
 */

import { getManifold } from './manifoldKernel.js';

const EPS = 1e-12;

// ─────────────────────────────────────────────────────────────────
// Vector utilities
// ─────────────────────────────────────────────────────────────────

function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function vlen(a) { return Math.hypot(a[0], a[1], a[2]); }
function vnorm(a) {
  const L = vlen(a); return L > EPS ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 0];
}

// ─────────────────────────────────────────────────────────────────
// Polygon utilities
// ─────────────────────────────────────────────────────────────────

/** Signed 2D polygon area (positive = CCW). */
export function polygonSignedArea(pts) {
  let A = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    A += x0 * y1 - x1 * y0;
  }
  return A / 2;
}

/**
 * Ear-clipping triangulation of a simple polygon. Returns triangle
 * indices into the original point list. Assumes CCW winding (caller
 * reverses if signed-area < 0).
 */
export function triangulatePolygon(pts) {
  const n = pts.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  const tris = [];
  let guard = 3 * n;
  while (idx.length > 3 && guard-- > 0) {
    let earCut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const p0 = pts[i0], p1 = pts[i1], p2 = pts[i2];
      // Convex test (CCW)
      const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      if (cross <= 0) continue;
      // No other point inside
      let inside = false;
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j];
        if (k === i0 || k === i1 || k === i2) continue;
        if (pointInTri(pts[k], p0, p1, p2)) { inside = true; break; }
      }
      if (inside) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      earCut = true;
      break;
    }
    if (!earCut) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function pointInTri(p, a, b, c) {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

// ─────────────────────────────────────────────────────────────────
// Path sampling + frame transport
// ─────────────────────────────────────────────────────────────────

/**
 * Sample a path at N equally-spaced parameter values, returning
 * positions and unit tangents.
 */
function samplePath(path, samples) {
  const positions = [];
  const tangents = [];
  if (typeof path.eval === 'function' && typeof path.evalDerivatives === 'function') {
    // NURBSCurve path
    const k = path.knots;
    const u0 = k[path.degree];
    const u1 = k[k.length - 1 - path.degree];
    for (let i = 0; i < samples; i++) {
      const u = u0 + (u1 - u0) * i / (samples - 1);
      const ders = path.evalDerivatives(u, 1);
      positions.push(ders[0]);
      tangents.push(vnorm(ders[1]));
    }
  } else {
    // Polyline. Resample at uniform arclength, with finite-difference tangents.
    const poly = path;
    const cumLen = [0];
    for (let i = 1; i < poly.length; i++) cumLen.push(cumLen[i - 1] + vlen(vsub(poly[i], poly[i - 1])));
    const total = cumLen[cumLen.length - 1];
    if (total < EPS) throw new Error('Zero-length path');
    for (let i = 0; i < samples; i++) {
      const s = total * i / (samples - 1);
      // Find segment
      let seg = 0;
      while (seg < poly.length - 2 && cumLen[seg + 1] < s) seg++;
      const segLen = cumLen[seg + 1] - cumLen[seg];
      const t = segLen > EPS ? (s - cumLen[seg]) / segLen : 0;
      const a = poly[seg], b = poly[seg + 1];
      positions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      tangents.push(vnorm(vsub(b, a)));
    }
  }
  return { positions, tangents };
}

/**
 * Build rotation-minimizing frames along a sampled path using the
 * double-reflection method (Wang et al. 2008). Each frame is
 * { tangent, normal, binormal } — orthonormal RH triad.
 *
 * @param {number[][]} positions
 * @param {number[][]} tangents
 * @param {number[]} initialUp - reference vector for the FIRST normal
 */
function rotationMinimizingFrames(positions, tangents, initialUp = [0, 0, 1]) {
  const N = positions.length;
  // Pick initial normal perpendicular to first tangent
  const t0 = tangents[0];
  let n0 = vsub(initialUp, vscale(t0, vdot(initialUp, t0)));
  if (vlen(n0) < 1e-6) {
    // initialUp is parallel to t0; pick any other
    const alt = Math.abs(t0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    n0 = vsub(alt, vscale(t0, vdot(alt, t0)));
  }
  n0 = vnorm(n0);
  let b0 = vnorm(vcross(t0, n0));
  const frames = [{ t: t0, n: n0, b: b0 }];

  for (let i = 0; i < N - 1; i++) {
    const ti = tangents[i];
    const tip1 = tangents[i + 1];
    const ni = frames[i].n;
    const bi = frames[i].b;
    // Compute reflection of (n_i, t_i) about plane bisector of (t_i, t_{i+1})
    const v1 = vsub(positions[i + 1], positions[i]);
    const c1 = vdot(v1, v1);
    if (c1 < EPS) {
      frames.push({ t: tip1, n: ni, b: bi });
      continue;
    }
    // Reflect n_i and t_i about a plane that swings t_i → predicted t
    let nL = vsub(ni, vscale(v1, (2 / c1) * vdot(v1, ni)));
    let tL = vsub(ti, vscale(v1, (2 / c1) * vdot(v1, ti)));
    // Second reflection — about the bisector of (-t_L) and t_{i+1}
    const v2 = vsub(tip1, tL);
    const c2 = vdot(v2, v2);
    let nNext;
    if (c2 < EPS) {
      nNext = nL;
    } else {
      nNext = vsub(nL, vscale(v2, (2 / c2) * vdot(v2, nL)));
    }
    nNext = vnorm(nNext);
    const bNext = vnorm(vcross(tip1, nNext));
    // Re-orthogonalize n in case of drift
    const nOrth = vnorm(vcross(bNext, tip1));
    frames.push({ t: tip1, n: nOrth, b: bNext });
  }
  return frames;
}

// ─────────────────────────────────────────────────────────────────
// Mesh assembly
// ─────────────────────────────────────────────────────────────────

/**
 * Build a triangulated tube mesh from per-station profiles (each an
 * array of 3D points, all with the same length M). Returns
 * { vertices, triangles } where vertices is flat [x, y, z, ...] and
 * triangles is flat [i0, i1, i2, ...].
 *
 * @param {boolean} cap - if true, add fan-triangulated caps at start/end
 */
function buildTubeMesh(stations, capStart, capEnd, profileTris) {
  // stations[i] = M points (M same for every station)
  const N = stations.length;
  const M = stations[0].length;
  const verts = [];
  const tris = [];
  const idxAt = (i, j) => i * M + j;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const [x, y, z] = stations[i][j];
      verts.push(x, y, z);
    }
  }
  // Wall quads → 2 tris each. With profile CCW in (n, b) plane and
  // stations advancing along +t (tangent), the outward normal at the
  // wall is +n. The right-hand-rule winding that yields +n from a
  // triangle starting at vertex a = (i, j) is  a → d → c  and
  // a → c → b (i.e. go in +profile direction first, then +tangent).
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      const a = idxAt(i, j);
      const b = idxAt(i + 1, j);
      const c = idxAt(i + 1, j1);
      const d = idxAt(i, j1);
      tris.push(a, d, c);
      tris.push(a, c, b);
    }
  }
  // Caps using existing 2D triangulation
  if (capStart) {
    // First station — winds CW when viewed from outside (start cap normal = -tangent)
    for (const [a, b, c] of profileTris) tris.push(a, c, b);
  }
  if (capEnd) {
    const off = (N - 1) * M;
    for (const [a, b, c] of profileTris) tris.push(off + a, off + b, off + c);
  }
  return { vertices: verts, triangles: tris };
}

async function meshToManifold(mesh) {
  const Mod = await getManifold();
  const meshGL = new Mod.Mesh({
    vertProperties: new Float32Array(mesh.vertices),
    triVerts: new Uint32Array(mesh.triangles),
  });
  return new Mod.Manifold(meshGL);
}

// ─────────────────────────────────────────────────────────────────
// SWEEP
// ─────────────────────────────────────────────────────────────────

/**
 * Sweep a 2D closed profile along a 3D path.
 *
 * @param {object} args
 * @param {Array<[x,y]>} args.profile2D    - closed CCW polygon in XY
 * @param {NURBSCurve|Array<[x,y,z]>} args.path
 * @param {number=} args.samples           - station count (default 64)
 * @param {Array=} args.referenceUp        - up vector for initial frame
 * @returns {Promise<Manifold>}
 */
export async function sweep({ profile2D, path, samples = 64, referenceUp = [0, 0, 1] }) {
  if (profile2D.length < 3) throw new Error('Profile must have >=3 points');
  // Ensure CCW winding
  let prof = profile2D.slice();
  if (polygonSignedArea(prof) < 0) prof = prof.slice().reverse();
  const profileTris = triangulatePolygon(prof);
  const { positions, tangents } = samplePath(path, samples);
  const frames = rotationMinimizingFrames(positions, tangents, referenceUp);

  const stations = [];
  for (let i = 0; i < samples; i++) {
    const P = positions[i];
    const { n, b } = frames[i];
    const pts3D = prof.map(([u, v]) => [
      P[0] + u * n[0] + v * b[0],
      P[1] + u * n[1] + v * b[1],
      P[2] + u * n[2] + v * b[2],
    ]);
    stations.push(pts3D);
  }
  const mesh = buildTubeMesh(stations, true, true, profileTris);
  return await meshToManifold(mesh);
}

// ─────────────────────────────────────────────────────────────────
// LOFT
// ─────────────────────────────────────────────────────────────────

/**
 * Loft N profile cross-sections in 3D into a single solid.
 *
 * Each profile is { points2D, frame: { origin, normal, up } }.
 * Profiles must have the same number of points (call resampleProfile
 * if needed).
 *
 * The implementation:
 *   - Lays each profile in its own frame
 *   - Optionally interpolates intermediate stations between consecutive
 *     profiles for smoother surfaces (controlled by `tweenSegments`)
 *   - Caps the first and last station
 *
 * @param {object} args
 * @param {Array<{points2D, origin, normal, up}>} args.profiles
 * @param {number=} args.tweenSegments   - extra interpolated stations
 *                                          between each consecutive pair
 *                                          (default 0)
 * @returns {Promise<Manifold>}
 */
export async function loft({ profiles, tweenSegments = 0 }) {
  if (profiles.length < 2) throw new Error('Loft needs at least 2 profiles');
  const M = profiles[0].points2D.length;
  for (const p of profiles) {
    if (p.points2D.length !== M)
      throw new Error('All profiles must have the same point count — call resampleProfile to match');
  }

  // Build orthonormal frames (origin, normal, u, v) for each profile
  const frames = profiles.map(p => makeFrame(p.origin, p.normal, p.up));
  // Normalize 2D points to CCW (consistent winding)
  const points2DByProf = profiles.map(p =>
    polygonSignedArea(p.points2D) < 0 ? p.points2D.slice().reverse() : p.points2D.slice()
  );
  const profileTris = triangulatePolygon(points2DByProf[0]);

  // Sanity-check that all profiles share triangulation topology — for
  // simple convex profiles, points are corresponded by INDEX. For
  // dissimilar profiles a more sophisticated point-correspondence
  // step would be needed; we rely on the caller to align points.

  // Generate stations: at each profile + interpolated tweens between
  const stations = [];
  for (let s = 0; s < profiles.length - 1; s++) {
    const A = points2DByProf[s], B = points2DByProf[s + 1];
    const fA = frames[s], fB = frames[s + 1];
    const tCount = (s === profiles.length - 2) ? tweenSegments + 1 : tweenSegments + 1;
    for (let k = 0; k < tCount; k++) {
      const t = k / (tweenSegments + 1);
      const pts3D = [];
      for (let j = 0; j < M; j++) {
        const a2 = A[j], b2 = B[j];
        const u = a2[0] * (1 - t) + b2[0] * t;
        const v = a2[1] * (1 - t) + b2[1] * t;
        // Position by linearly blending the two frames' origins and basis
        const x = fA.origin[0] * (1 - t) + fB.origin[0] * t;
        const y = fA.origin[1] * (1 - t) + fB.origin[1] * t;
        const z = fA.origin[2] * (1 - t) + fB.origin[2] * t;
        const ux = fA.u[0] * (1 - t) + fB.u[0] * t;
        const uy = fA.u[1] * (1 - t) + fB.u[1] * t;
        const uz = fA.u[2] * (1 - t) + fB.u[2] * t;
        const vx = fA.v[0] * (1 - t) + fB.v[0] * t;
        const vy = fA.v[1] * (1 - t) + fB.v[1] * t;
        const vz = fA.v[2] * (1 - t) + fB.v[2] * t;
        pts3D.push([x + u * ux + v * vx, y + u * uy + v * vy, z + u * uz + v * vz]);
      }
      stations.push(pts3D);
    }
  }
  // Add the final profile as the last station
  {
    const idx = profiles.length - 1;
    const f = frames[idx];
    const A = points2DByProf[idx];
    const pts3D = A.map(([u, v]) => [
      f.origin[0] + u * f.u[0] + v * f.v[0],
      f.origin[1] + u * f.u[1] + v * f.v[1],
      f.origin[2] + u * f.u[2] + v * f.v[2],
    ]);
    stations.push(pts3D);
  }
  const mesh = buildTubeMesh(stations, true, true, profileTris);
  return await meshToManifold(mesh);
}

function makeFrame(origin, normal, up) {
  const n = vnorm(normal);
  let upRef = vnorm(up || [0, 0, 1]);
  // Make upRef perpendicular to n
  let v = vsub(upRef, vscale(n, vdot(upRef, n)));
  if (vlen(v) < 1e-6) {
    const alt = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    v = vsub(alt, vscale(n, vdot(alt, n)));
  }
  v = vnorm(v);
  const u = vnorm(vcross(v, n));
  return { origin: [...origin], normal: n, u, v };
}

// ─────────────────────────────────────────────────────────────────
// Profile helpers
// ─────────────────────────────────────────────────────────────────

/** Make a regular N-gon approximation of a circle of radius R, CCW. */
export function circleProfile(R, segments = 64) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = 2 * Math.PI * i / segments;
    pts.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return pts;
}

/** Make a square profile centered at origin, CCW. */
export function squareProfile(side) {
  const h = side / 2;
  return [[-h, -h], [h, -h], [h, h], [-h, h]];
}

/**
 * Resample a polyline profile to a target point count by uniform
 * arc-length sampling.
 */
export function resampleProfile(pts, count) {
  const n = pts.length;
  const cumLen = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1], b = pts[i % n];
    cumLen.push(cumLen[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cumLen[n];
  const out = [];
  for (let k = 0; k < count; k++) {
    const s = total * k / count;
    let seg = 0;
    while (seg < n - 1 && cumLen[seg + 1] < s) seg++;
    const segLen = cumLen[seg + 1] - cumLen[seg];
    const t = segLen > EPS ? (s - cumLen[seg]) / segLen : 0;
    const a = pts[seg], b = pts[(seg + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
