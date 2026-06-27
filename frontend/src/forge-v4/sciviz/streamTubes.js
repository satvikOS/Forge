// sciviz/streamTubes.js — Stream Tracer + Tube filter (ParaView "Stream Tracer"
// + "Tube").
// ============================================================================
// Task #65, Increment 5.
//
// Reuses the VALIDATED rk4Streamline + sampleVelocity from cfdVisualisation.js
// (4th-order Runge–Kutta on a trilinearly-sampled structured field) and adds:
//
//   • seed SOURCES — point / line / sphere(surface) / plane(grid),
//   • forward / backward / both integration directions,
//   • swept TUBE geometry via parallel-transport frames, with a radius that is
//     either constant OR scaled by a per-vertex scalar (ParaView "Tube" with
//     "Vary Radius By Scalar"),
//   • a head-less analytic-field → grid helper so the gate can integrate a
//     rigid-rotation / uniform field through the SAME rk4Streamline.
//
// THREE is injected only to build tube meshes; integration + the gate math run
// head-less.  No new deps.
// ============================================================================

import {
  rk4Streamline, sampleVelocity, fieldStats,
} from '../cfdVisualisation.js';

// re-export the reused integrator so callers can reach it through this module
export { rk4Streamline, sampleVelocity };

// ───────────────────────────────────────────────────────────────────────────
//  Analytic field → structured grid (so rk4Streamline can integrate it).
//  Because rk4Streamline samples trilinearly and trilinear reconstruction is
//  EXACT for an affine field, a rotation / uniform field is reproduced to
//  machine precision — the only error left is RK4 truncation (the gate).
// ───────────────────────────────────────────────────────────────────────────
export function gridFromField(fieldFn, opts = {}) {
  const nx = opts.nx || 24, ny = opts.ny || 24, nz = opts.nz || 24;
  const Lx = opts.Lx != null ? opts.Lx : 1;
  const Ly = opts.Ly != null ? opts.Ly : 1;
  const Lz = opts.Lz != null ? opts.Lz : 1;
  const dx = Lx / nx, dy = Ly / ny, dz = Lz / nz;
  const N = nx * ny * nz;
  const sliceXY = nx * ny;
  const u = new Float64Array(N), v = new Float64Array(N), w = new Float64Array(N);
  const p = new Float64Array(N);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = i + nx * j + sliceXY * k;
    const x = (i + 0.5) * dx, y = (j + 0.5) * dy, z = (k + 0.5) * dz;
    const vec = fieldFn(x, y, z);
    u[id] = vec[0]; v[id] = vec[1]; w[id] = vec[2];
  }
  return { nx, ny, nz, dx, dy, dz, Lx, Ly, Lz, N, sliceXY, u, v, w, p };
}

// ───────────────────────────────────────────────────────────────────────────
//  Seed sources.
// ───────────────────────────────────────────────────────────────────────────
/**
 * @param {object} source { type:'point'|'line'|'sphere'|'plane', … }
 *   point  : { point:[x,y,z] }
 *   line   : { p1, p2, count }
 *   sphere : { center, radius, count }      (Fibonacci surface points)
 *   plane  : { origin, u:[..], v:[..], nu, nv }  (grid over the parallelogram)
 * @returns {Array<[x,y,z]>}
 */
export function seedPoints(source = {}) {
  const type = source.type || 'point';
  if (type === 'point') {
    return [source.point ? source.point.slice() : [0, 0, 0]];
  }
  if (type === 'line') {
    const n = Math.max(1, source.count | 0 || 8);
    const a = source.p1, b = source.p2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
    return out;
  }
  if (type === 'sphere') {
    const n = Math.max(1, source.count | 0 || 32);
    const c = source.center || [0, 0, 0];
    const R = source.radius != null ? source.radius : 1;
    const out = [];
    const ga = Math.PI * (3 - Math.sqrt(5)); // golden angle
    for (let i = 0; i < n; i++) {
      const zz = n === 1 ? 0 : 1 - (2 * i) / (n - 1);  // [-1,1]
      const r = Math.sqrt(Math.max(0, 1 - zz * zz));
      const phi = i * ga;
      out.push([c[0] + R * r * Math.cos(phi), c[1] + R * r * Math.sin(phi), c[2] + R * zz]);
    }
    return out;
  }
  if (type === 'plane') {
    const o = source.origin || [0, 0, 0];
    const U = source.u || [1, 0, 0];
    const V = source.v || [0, 1, 0];
    const nu = Math.max(1, source.nu | 0 || 5);
    const nv = Math.max(1, source.nv | 0 || 5);
    const out = [];
    for (let b = 0; b < nv; b++) {
      for (let a = 0; a < nu; a++) {
        const ta = nu === 1 ? 0.5 : a / (nu - 1);
        const tb = nv === 1 ? 0.5 : b / (nv - 1);
        out.push([
          o[0] + U[0] * ta + V[0] * tb,
          o[1] + U[1] * ta + V[1] * tb,
          o[2] + U[2] * ta + V[2] * tb,
        ]);
      }
    }
    return out;
  }
  throw new Error(`streamTubes: unknown seed source type "${type}"`);
}

// ───────────────────────────────────────────────────────────────────────────
//  Integrate one streamline (forward / backward / both) via rk4Streamline.
// ───────────────────────────────────────────────────────────────────────────
export function integrateStreamline(grid, seed, opts = {}) {
  const direction = opts.direction || 'forward';
  const base = { maxSteps: opts.maxSteps, dt: opts.dt, dtFactor: opts.dtFactor, stopMag: opts.stopMag };
  if (direction === 'forward') {
    return rk4Streamline(grid, seed, { ...base, direction: 'forward' });
  }
  if (direction === 'backward') {
    return rk4Streamline(grid, seed, { ...base, direction: 'backward' });
  }
  // both: reverse the backward path (drop its duplicated seed) + forward path.
  const fwd = rk4Streamline(grid, seed, { ...base, direction: 'forward' });
  const bwd = rk4Streamline(grid, seed, { ...base, direction: 'backward' });
  const out = [];
  for (let i = bwd.length - 1; i >= 1; i--) out.push(bwd[i]);
  for (let i = 0; i < fwd.length; i++) out.push(fwd[i]);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
//  Parallel-transport tube geometry (constant or scalar-varying radius).
// ───────────────────────────────────────────────────────────────────────────
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Build a tube BufferGeometry around a polyline.
 * @param {object} THREE
 * @param {Array<[x,y,z]>} points
 * @param {object} opts { radius=1, radii:[per-point], radialSegments=8 }
 */
export function buildTubeGeometry(THREE, points, opts = {}) {
  if (!THREE) throw new Error('streamTubes: THREE namespace required');
  const m = points.length;
  if (m < 2) throw new Error('streamTubes: need ≥2 points for a tube');
  const radial = Math.max(3, opts.radialSegments | 0 || 8);
  const radius = opts.radius != null ? opts.radius : 1;
  const radii = opts.radii && opts.radii.length === m ? opts.radii : null;

  // tangents
  const T = new Array(m);
  for (let i = 0; i < m; i++) {
    let a, b;
    if (i === 0) { a = points[0]; b = points[1]; }
    else if (i === m - 1) { a = points[m - 2]; b = points[m - 1]; }
    else { a = points[i - 1]; b = points[i + 1]; }
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    if (Math.hypot(t[0], t[1], t[2]) < 1e-12) t = T[i - 1] || [1, 0, 0];
    T[i] = norm3(t);
  }

  // initial normal ⟂ T[0]
  let ref = Math.abs(T[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let N0 = cross3(T[0], ref);
  if (Math.hypot(N0[0], N0[1], N0[2]) < 1e-9) N0 = cross3(T[0], [0, 0, 1]);
  N0 = norm3(N0);

  // parallel-transport the frame along the curve
  const Narr = new Array(m), Barr = new Array(m);
  Narr[0] = N0; Barr[0] = norm3(cross3(T[0], N0));
  for (let i = 1; i < m; i++) {
    const t0 = T[i - 1], t1 = T[i];
    const axis = cross3(t0, t1);
    const sin = Math.hypot(axis[0], axis[1], axis[2]);
    let n = Narr[i - 1];
    if (sin > 1e-9) {
      const a = norm3(axis);
      const cos = Math.max(-1, Math.min(1, t0[0] * t1[0] + t0[1] * t1[1] + t0[2] * t1[2]));
      const ang = Math.atan2(sin, cos);
      // Rodrigues rotation of n about axis a by ang
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const dotAN = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
      const crAN = cross3(a, n);
      n = [
        n[0] * ca + crAN[0] * sa + a[0] * dotAN * (1 - ca),
        n[1] * ca + crAN[1] * sa + a[1] * dotAN * (1 - ca),
        n[2] * ca + crAN[2] * sa + a[2] * dotAN * (1 - ca),
      ];
    }
    // re-orthonormalise against t1
    const dotTN = t1[0] * n[0] + t1[1] * n[1] + t1[2] * n[2];
    n = norm3([n[0] - t1[0] * dotTN, n[1] - t1[1] * dotTN, n[2] - t1[2] * dotTN]);
    Narr[i] = n;
    Barr[i] = norm3(cross3(t1, n));
  }

  const ringCount = radial + 1;            // duplicate seam vertex for UVs
  const positions = new Float32Array(m * ringCount * 3);
  const normals = new Float32Array(m * ringCount * 3);
  for (let i = 0; i < m; i++) {
    const r = radii ? radii[i] : radius;
    const P = points[i], Nn = Narr[i], Bb = Barr[i];
    for (let s = 0; s <= radial; s++) {
      const ang = (s / radial) * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const nx = Nn[0] * c + Bb[0] * sn;
      const ny = Nn[1] * c + Bb[1] * sn;
      const nz = Nn[2] * c + Bb[2] * sn;
      const vi = (i * ringCount + s) * 3;
      positions[vi] = P[0] + r * nx;
      positions[vi + 1] = P[1] + r * ny;
      positions[vi + 2] = P[2] + r * nz;
      normals[vi] = nx; normals[vi + 1] = ny; normals[vi + 2] = nz;
    }
  }
  const indices = [];
  for (let i = 0; i < m - 1; i++) {
    for (let s = 0; s < radial; s++) {
      const a = i * ringCount + s;
      const b = (i + 1) * ringCount + s;
      const c = (i + 1) * ringCount + s + 1;
      const d = i * ringCount + s + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setIndex(indices);
  return geom;
}

// ───────────────────────────────────────────────────────────────────────────
//  Full builder — seed → integrate → tube → coloured group (needs THREE).
// ───────────────────────────────────────────────────────────────────────────
export function buildStreamTubes(THREE, grid, opts = {}) {
  if (!THREE) throw new Error('streamTubes: THREE namespace required');
  const seeds = opts.seeds || seedPoints(opts.source || { type: 'point', point: [0, 0, 0] });
  const direction = opts.direction || 'forward';
  const radialSegments = opts.radialSegments || 8;
  const baseRadius = opts.radius != null ? opts.radius : Math.min(grid.dx, grid.dy, grid.dz) * 0.25;
  const varyByScalar = !!opts.varyRadiusByScalar;
  const radiusRange = opts.radiusRange || [0.4 * baseRadius, baseRadius];
  const tf = opts.transferFunction || null;

  // global |U|_max for colour / radius normalisation
  let umax = 0;
  for (let n = 0; n < grid.N; n++) {
    const mg = Math.hypot(grid.u[n], grid.v[n], grid.w[n]);
    if (mg > umax) umax = mg;
  }
  const denom = umax > 1e-12 ? umax : 1;

  const group = new THREE.Group();
  group.name = 'sciviz-stream-tubes';
  group.userData = { sciviz: 'streamTubes', seedCount: seeds.length, direction };

  let tubeCount = 0;
  for (let s = 0; s < seeds.length; s++) {
    const path = integrateStreamline(grid, seeds[s], opts);
    if (path.length < 2) continue;
    // per-vertex speed
    const speeds = path.map((pt) => {
      const vel = sampleVelocity(grid, pt[0], pt[1], pt[2]);
      return Math.hypot(vel[0], vel[1], vel[2]);
    });
    let radii = null;
    if (varyByScalar) {
      radii = speeds.map((sp) => {
        const t = Math.max(0, Math.min(1, sp / denom));
        return radiusRange[0] + (radiusRange[1] - radiusRange[0]) * t;
      });
    }
    const geom = buildTubeGeometry(THREE, path, { radius: baseRadius, radii, radialSegments });
    // colour per vertex through the TF (or speed ramp)
    const ringCount = radialSegments + 1;
    const colors = new Float32Array(path.length * ringCount * 3);
    for (let i = 0; i < path.length; i++) {
      const t = Math.max(0, Math.min(1, speeds[i] / denom));
      const rgb = tf ? tf.sampleColorUnit(t) : [0.4 + 0.6 * t, 0.6, 1 - 0.6 * t];
      for (let r = 0; r < ringCount; r++) {
        const ci = (i * ringCount + r) * 3;
        colors[ci] = rgb[0]; colors[ci + 1] = rgb[1]; colors[ci + 2] = rgb[2];
      }
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.6 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `sciviz-stream-tube-${s}`;
    mesh.userData = { sciviz: 'stream-tube', seedIndex: s, vertexCount: path.length };
    group.add(mesh);
    tubeCount++;
  }
  group.userData.tubeCount = tubeCount;
  return group;
}

export default {
  gridFromField, seedPoints, integrateStreamline,
  buildTubeGeometry, buildStreamTubes, rk4Streamline, sampleVelocity, fieldStats,
};
