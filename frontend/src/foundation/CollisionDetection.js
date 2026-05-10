/**
 * ArchDisc Foundation — Dynamic collision detection.
 *
 * Two modes:
 *
 *   1. Static pairwise check
 *        For an assembly of parts at their current transforms, test
 *        every pair for volumetric interference. Uses AABB pre-check
 *        (cheap), then full manifold-3d intersection only when AABBs
 *        overlap. Reports interference volume + intersection geometry.
 *
 *   2. Sweep / kinematic motion check
 *        Caller supplies a driver function `(t ∈ [0,1]) → assembly
 *        positions`. We sample N steps, check static collision at each.
 *        Reports time-of-first-contact, max interference, full per-
 *        frame collision history.
 *
 * AABB helper uses each part's manifold-3d boundingBox() applied to the
 * part transform. Manifold transforms are exact, so the bbox after
 * `Manifold.translate + rotate` is also exact.
 */

import { getManifold } from './manifoldKernel.js';

const D2R = Math.PI / 180;

function rotMatXYZDeg(rxDeg, ryDeg, rzDeg) {
  const rx = rxDeg * D2R, ry = ryDeg * D2R, rz = rzDeg * D2R;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [cy * cz, -cy * sz, sy],
    [sx * sy * cz + cx * sz, -sx * sy * sz + cx * cz, -sx * cy],
    [-cx * sy * cz + sx * sz, cx * sy * sz + sx * cz, cx * cy],
  ];
}

function transformPoint(p, R, t) {
  return [
    R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2] + t[0],
    R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2] + t[1],
    R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2] + t[2],
  ];
}

/**
 * Compute the world-space AABB of a Manifold under a transform.
 * For correctness with rotation, we evaluate all 8 local-bbox corners
 * after rotation+translation and take min/max.
 */
function transformedAABB(manifold, transform) {
  const bb = manifold.boundingBox();
  const corners = [
    [bb.min[0], bb.min[1], bb.min[2]],
    [bb.max[0], bb.min[1], bb.min[2]],
    [bb.min[0], bb.max[1], bb.min[2]],
    [bb.max[0], bb.max[1], bb.min[2]],
    [bb.min[0], bb.min[1], bb.max[2]],
    [bb.max[0], bb.min[1], bb.max[2]],
    [bb.min[0], bb.max[1], bb.max[2]],
    [bb.max[0], bb.max[1], bb.max[2]],
  ];
  const R = rotMatXYZDeg(...(transform.rotation ?? [0, 0, 0]));
  const t = transform.translation ?? [0, 0, 0];
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (const c of corners) {
    const p = transformPoint(c, R, t);
    if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0];
    if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1];
    if (p[2] < zmin) zmin = p[2]; if (p[2] > zmax) zmax = p[2];
  }
  return { min: [xmin, ymin, zmin], max: [xmax, ymax, zmax] };
}

function aabbsOverlap(a, b, slack = 0) {
  return !(
    a.max[0] < b.min[0] - slack || a.min[0] > b.max[0] + slack ||
    a.max[1] < b.min[1] - slack || a.min[1] > b.max[1] + slack ||
    a.max[2] < b.min[2] - slack || a.min[2] > b.max[2] + slack
  );
}

/**
 * Apply a part transform to a manifold. Returns a new Manifold.
 */
function applyTransform(manifold, transform) {
  const r = transform.rotation ?? [0, 0, 0];
  const t = transform.translation ?? [0, 0, 0];
  let m = manifold;
  if (r[0] !== 0 || r[1] !== 0 || r[2] !== 0) m = m.rotate(r);
  if (t[0] !== 0 || t[1] !== 0 || t[2] !== 0) m = m.translate(t);
  return m;
}

/**
 * Check pairwise interference between two parts.
 * @param {object} a - { manifold, transform: { translation, rotation } }
 * @param {object} b
 * @param {object} options
 * @param {number} options.minVolumeMm3 - threshold below which we treat
 *   the intersection as numerical noise (default 1e-6 mm³)
 * @returns {Promise<{ intersects, volume, aabbOverlap }>}
 */
export async function checkPair(a, b, options = {}) {
  const minVolume = options.minVolumeMm3 ?? 1e-6;
  const aabbA = transformedAABB(a.manifold, a.transform || {});
  const aabbB = transformedAABB(b.manifold, b.transform || {});
  if (!aabbsOverlap(aabbA, aabbB)) {
    return { intersects: false, volume: 0, aabbOverlap: false, intersectionAABB: null };
  }
  const { Manifold } = await getManifold();
  const ma = applyTransform(a.manifold, a.transform || {});
  const mb = applyTransform(b.manifold, b.transform || {});
  const inter = Manifold.intersection(ma, mb);
  const vol = inter.volume();
  const intersects = vol > minVolume;
  let interAABB = null;
  if (intersects) interAABB = inter.boundingBox();
  return { intersects, volume: vol, aabbOverlap: true, intersectionAABB: interAABB };
}

/**
 * Check all pairs in an assembly.
 * @param {Array<{ name, manifold, transform }>} parts
 * @param {object} options - same as checkPair
 * @returns {Promise<Array>}
 */
export async function checkAssembly(parts, options = {}) {
  const results = [];
  // Pre-compute AABBs once
  const aabbs = parts.map(p => transformedAABB(p.manifold, p.transform || {}));
  let aabbHits = 0, manifoldChecks = 0;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (!aabbsOverlap(aabbs[i], aabbs[j])) continue;
      aabbHits++;
      const r = await checkPair(parts[i], parts[j], options);
      manifoldChecks++;
      if (r.intersects) {
        results.push({
          a: parts[i].name, b: parts[j].name,
          volume: r.volume, aabbOverlap: true,
          intersectionAABB: r.intersectionAABB,
        });
      }
    }
  }
  return { collisions: results, aabbHits, manifoldChecks };
}

/**
 * Sweep through a parametric driver, checking collisions at each step.
 *
 * @param {Array} parts - same as checkAssembly
 * @param {function(number): void} driver - receives t ∈ [0, 1] and
 *   updates the .transform fields of the parts
 * @param {object} options
 * @param {number} options.steps - number of samples (default 32)
 * @param {boolean} options.stopAtFirstContact - early-exit on first
 *   collision (default false)
 * @returns {Promise<object>}
 */
export async function sweepCollision(parts, driver, options = {}) {
  const steps = options.steps ?? 32;
  const minVolume = options.minVolumeMm3 ?? 1e-6;
  const frames = [];
  let firstContactT = null;
  let maxVolume = 0;
  let maxVolumeT = null;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    driver(t);
    const r = await checkAssembly(parts, { minVolumeMm3: minVolume });
    let frameVolume = 0;
    for (const c of r.collisions) frameVolume += c.volume;
    frames.push({ t, collisions: r.collisions, totalVolume: frameVolume, aabbHits: r.aabbHits });
    if (r.collisions.length > 0 && firstContactT === null) firstContactT = t;
    if (frameVolume > maxVolume) { maxVolume = frameVolume; maxVolumeT = t; }
    if (options.stopAtFirstContact && r.collisions.length > 0) break;
  }
  return {
    steps: frames.length,
    firstContactT,
    maxVolume,
    maxVolumeT,
    collisionFreeRange: firstContactT === null ? [0, 1] : [0, firstContactT],
    frames,
  };
}
