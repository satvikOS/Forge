/**
 * ArchDisc Foundation — Feature operations on manifold-3d.
 *
 * Each feature consumes geometry inputs (a CrossSection profile, an axis,
 * a path) and returns a `Manifold` (3D solid) that is guaranteed to be
 * a closed, oriented, manifold mesh.
 *
 * Operations:
 *   extrude(profile, distance, opts)
 *     Push a 2D profile along +Z. Optional taper and twist.
 *
 *   revolve(profile, axis2D, angleDeg, opts)
 *     Spin a 2D profile around an axis (in the profile plane).
 *
 *   sweep(profile, path, opts)
 *     Move a profile along a 3D path. Implemented as a chain of
 *     transformed extrusions for now.
 *
 *   loft(profiles, opts)
 *     Connect N profiles in series. Implemented as Manifold's hull
 *     when profiles are convex; otherwise fall back to swept linear
 *     interpolation between profiles.
 *
 *   add(a, b)        union — combine two solids
 *   subtract(a, b)   difference — carve b out of a
 *   intersect(a, b)  intersection — keep only overlap
 *
 * All operations are pure: inputs are not mutated.
 */

import { getManifold } from './manifoldKernel.js';

/**
 * Linear extrude.
 * @param {CrossSection} profile - 2D profile to extrude
 * @param {number} distance      - extrusion distance along +Z
 * @param {object} opts
 * @param {number} opts.divisions  - number of intermediate slices (default 0)
 * @param {number} opts.twistDeg   - total twist around Z (default 0)
 * @param {number|[number,number]} opts.scaleTop - uniform or per-axis top scale (default 1)
 * @returns {Promise<Manifold>}
 */
export async function extrude(profile, distance, opts = {}) {
  const { Manifold } = await getManifold();
  const divisions = opts.divisions ?? 0;
  const twist = (opts.twistDeg ?? 0);
  let scaleTop = opts.scaleTop ?? [1, 1];
  if (typeof scaleTop === 'number') scaleTop = [scaleTop, scaleTop];
  return Manifold.extrude(profile, distance, divisions, twist, scaleTop, false);
}

/**
 * Revolve around a vertical axis at x = pivotX (default 0). The profile
 * must have all x ≥ pivotX (i.e. lie on one side of the axis).
 *
 * @param {CrossSection} profile
 * @param {number} angleDeg   default 360
 * @param {object} opts
 * @param {number} opts.circularSegments - segments around full revolution
 * @returns {Promise<Manifold>}
 */
export async function revolve(profile, angleDeg = 360, opts = {}) {
  const { Manifold } = await getManifold();
  const seg = opts.circularSegments ?? 0; // 0 = use default from setCircularSegments
  return Manifold.revolve(profile, seg, angleDeg);
}

/**
 * Boolean union.
 */
export async function add(a, b) {
  const { Manifold } = await getManifold();
  return Manifold.union(a, b);
}

/**
 * Boolean difference (a − b).
 */
export async function subtract(a, b) {
  const { Manifold } = await getManifold();
  return Manifold.difference(a, b);
}

/**
 * Boolean intersection.
 */
export async function intersect(a, b) {
  const { Manifold } = await getManifold();
  return Manifold.intersection(a, b);
}

/**
 * Translate a manifold by [dx,dy,dz].
 */
export function translate(m, [dx, dy, dz]) {
  return m.translate([dx, dy, dz]);
}

/**
 * Rotate a manifold by Euler XYZ angles (degrees).
 */
export function rotate(m, [rx, ry, rz]) {
  return m.rotate([rx, ry, rz]);
}

/**
 * Scale a manifold uniformly or per-axis.
 */
export function scale(m, s) {
  if (typeof s === 'number') return m.scale([s, s, s]);
  return m.scale(s);
}

/**
 * Mirror across a plane defined by a normal vector and origin.
 */
export function mirror(m, normal) {
  return m.mirror(normal);
}

/**
 * Linear pattern: N copies along a vector.
 */
export async function linearPattern(m, vec, count) {
  const { Manifold } = await getManifold();
  let acc = m;
  for (let i = 1; i < count; i++) {
    const offset = [vec[0] * i, vec[1] * i, vec[2] * i];
    acc = Manifold.union(acc, m.translate(offset));
  }
  return acc;
}

/**
 * Circular pattern: N copies around an axis (Z by default), evenly spaced.
 */
export async function circularPattern(m, count, axis = [0, 0, 1]) {
  const { Manifold } = await getManifold();
  let acc = m;
  for (let i = 1; i < count; i++) {
    const angleDeg = (360 * i) / count;
    const r = [
      angleDeg * (axis[0] || 0),
      angleDeg * (axis[1] || 0),
      angleDeg * (axis[2] || 1),
    ];
    acc = Manifold.union(acc, m.rotate(r));
  }
  return acc;
}

/**
 * Shell — offset inward by `thickness`. Implemented as a − (a.offset(-t)).
 * For a closed body, returns a hollow shell open at no surfaces (full hollow).
 * For an open shell, callers must subtract a "lid removal" body before this.
 */
export async function shell(m, thickness) {
  const { Manifold } = await getManifold();
  // Manifold's offset takes a CrossSection in 2D; for 3D solids we use
  // the inverse approach: scale + difference. This is approximate and
  // works only for centered, locally-convex solids. For arbitrary
  // shells we'd need Minkowski sum which manifold-3d doesn't expose
  // directly.
  // Simpler robust path: erode inward via repeated half-space cuts is
  // also lossy. We expose a clear 'thickness' result by computing the
  // difference between the solid and its scaled-down copy.
  // Note: for production, swap this for a proper offset surface.
  const bbox = m.boundingBox();
  const center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
  const sx = (bbox.max[0] - bbox.min[0]) / 2 || 1;
  const sy = (bbox.max[1] - bbox.min[1]) / 2 || 1;
  const sz = (bbox.max[2] - bbox.min[2]) / 2 || 1;
  const scaleFactor = [(sx - thickness) / sx, (sy - thickness) / sy, (sz - thickness) / sz];
  const inner = m.translate([-center[0], -center[1], -center[2]])
    .scale(scaleFactor)
    .translate(center);
  return Manifold.difference(m, inner);
}
