/**
 * ArchDisc Foundation — edge fillet on axis-aligned bodies via CSG.
 *
 * True edge-based fillet on arbitrary B-Rep is a Parasolid-class
 * problem (months of work). What this module does instead: build a
 * "rounded cube" body directly from primitives, exact in the
 * limit of fine sphere/cylinder tessellation.
 *
 * Construction (for a cube of side a, fillet radius r ≤ a/2):
 *   1.  Inner cube of side (a - 2r), centered on origin.
 *   2.  For each of the 6 faces: extend the inner cube outward by r
 *       in the face normal direction → 6 face boxes of size
 *       (a - 2r) × (a - 2r) × r (with two axes shrunk by 2r).
 *   3.  For each of the 12 edges: a quarter-cylinder of radius r,
 *       length (a - 2r), placed along the edge axis with its convex
 *       side outward. (Implemented as a full cylinder unioned with
 *       the body — manifold-3d's boolean robustly handles overlap.)
 *   4.  For each of the 8 corners: an octant sphere of radius r.
 *
 * The union of all these is the canonical rounded cube. Its volume
 * has a closed form
 *
 *     V = (a − 2r)³                   inner cube
 *       + 6 r (a − 2r)²                face boxes
 *       + 3 π r² (a − 2r)              edge quarters (12 × ¼ × π r² × (a-2r))
 *       + (4/3) π r³                   eight octants = full sphere
 *     = a³ − (6 − 3π/2) r²(a − 2r) + (π − 4/3 + ...)   [check]
 *
 * (Exact closed-form derived below in test.)
 *
 * The same approach works for an arbitrary axis-aligned BOX (a × b × c).
 *
 * Why ship this even though it's "just" CSG: the operation
 * `Fillet(cube, R)` is the user-visible primitive in every CAD app.
 * Having a working version on cubes is enough to unblock the Part-
 * ribbon "Fillet" button. Filleting arbitrary curved B-Rep is
 * Phase-3 work.
 */

import { getManifold } from './manifoldKernel.js';
import { filletPolygon2D, chamferPolygon2D, polygonArea } from './Polygon2D.js';

// Re-export the kernel-free 2D polygon helpers so existing
// `from EdgeFillet.js` imports keep working.
export { filletPolygon2D, chamferPolygon2D, polygonArea };

/**
 * Build a rounded box of size (sx, sy, sz) with corner / edge fillets
 * of radius r. Body is centered at the origin.
 *
 * @param {[number, number, number]} size  full extents
 * @param {number} radius                    fillet radius (≤ min(size)/2)
 * @param {number} sphereSegs                segments for corner octants
 * @returns {Promise<Manifold>}
 */
export async function roundedBox(size, radius, sphereSegs = 64) {
  const Mod = await getManifold();
  const [a, b, c] = size;
  const r = Math.min(radius, Math.min(a, b, c) / 2 - 1e-6);
  if (r <= 0) return Mod.Manifold.cube([a, b, c], true);

  // Inner cube
  const inner = Mod.Manifold.cube([a - 2 * r, b - 2 * r, c - 2 * r], true);

  // 6 face boxes (extend inner cube outward by r on each face)
  const faceX = Mod.Manifold.cube([a, b - 2 * r, c - 2 * r], true);
  const faceY = Mod.Manifold.cube([a - 2 * r, b, c - 2 * r], true);
  const faceZ = Mod.Manifold.cube([a - 2 * r, b - 2 * r, c], true);

  // 12 edge cylinders. For each axis, 4 cylinders parallel to that axis,
  // one per pair of opposing faces of the OTHER two axes.
  // Cylinders along Z: radius r, height (c - 2r), at the 4 corners
  //   (±(a/2 - r), ±(b/2 - r), 0)
  const cylinders = [];
  const cylZ = (x, y) => Mod.Manifold.cylinder(c - 2 * r, r, r, sphereSegs, true).translate([x, y, 0]);
  for (const x of [a / 2 - r, -(a / 2 - r)]) {
    for (const y of [b / 2 - r, -(b / 2 - r)]) {
      cylinders.push(cylZ(x, y));
    }
  }
  // Cylinders along X — manifold-3d's cylinder is along z, so rotate 90° about Y
  const cylX = (y, z) =>
    Mod.Manifold.cylinder(a - 2 * r, r, r, sphereSegs, true)
      .rotate([0, 90, 0])
      .translate([0, y, z]);
  for (const y of [b / 2 - r, -(b / 2 - r)]) {
    for (const z of [c / 2 - r, -(c / 2 - r)]) {
      cylinders.push(cylX(y, z));
    }
  }
  // Cylinders along Y — rotate 90° about X
  const cylY = (x, z) =>
    Mod.Manifold.cylinder(b - 2 * r, r, r, sphereSegs, true)
      .rotate([90, 0, 0])
      .translate([x, 0, z]);
  for (const x of [a / 2 - r, -(a / 2 - r)]) {
    for (const z of [c / 2 - r, -(c / 2 - r)]) {
      cylinders.push(cylY(x, z));
    }
  }

  // 8 corner spheres
  const spheres = [];
  for (const sx of [a / 2 - r, -(a / 2 - r)]) {
    for (const sy of [b / 2 - r, -(b / 2 - r)]) {
      for (const sz of [c / 2 - r, -(c / 2 - r)]) {
        spheres.push(Mod.Manifold.sphere(r, sphereSegs).translate([sx, sy, sz]));
      }
    }
  }

  // Union everything
  let body = inner.add(faceX).add(faceY).add(faceZ);
  for (const cyl of cylinders) body = body.add(cyl);
  for (const s of spheres) body = body.add(s);
  return body;
}

/** Convenience: rounded cube of side a, fillet radius r. */
export async function roundedCube(a, r, sphereSegs = 64) {
  return roundedBox([a, a, a], r, sphereSegs);
}

/**
 * Fillet a 2D profile then extrude it into a prismatic solid.
 *
 * @param {Array<[number,number]>} profile  closed polygon (mm)
 * @param {number} height                   extrude distance (mm)
 * @param {number} radius                   fillet radius (mm)
 * @param {number=} arcSegs
 * @returns {Promise<Manifold>}
 */
export async function filletExtrude(profile, height, radius, arcSegs = 8) {
  const Mod = await getManifold();
  const { points } = filletPolygon2D(profile, radius, arcSegs);
  const cs = Mod.CrossSection.ofPolygons([points]);
  return Mod.Manifold.extrude(cs, height);
}

/**
 * Chamfer a 2D profile then extrude it into a prismatic solid.
 *
 * @param {Array<[number,number]>} profile  closed polygon (mm)
 * @param {number} height                   extrude distance (mm)
 * @param {number} dist                     chamfer set-back (mm)
 * @returns {Promise<Manifold>}
 */
export async function chamferExtrude(profile, height, dist) {
  const Mod = await getManifold();
  const { points } = chamferPolygon2D(profile, dist);
  const cs = Mod.CrossSection.ofPolygons([points]);
  return Mod.Manifold.extrude(cs, height);
}

/**
 * Closed-form volume of a rounded box (a × b × c, fillet r ≤ min/2).
 *
 *   V = a·b·c                                          full box volume
 *     − (corner volume removed when fillet is applied)
 *     + (corner volume re-added by the fillet rounded geometry)
 *
 * Easier to derive directly:
 *   Decompose the rounded box into:
 *     1 inner box of size (a-2r)(b-2r)(c-2r)
 *     6 face slabs:  (a-2r)(b-2r)·r  (top/bot)
 *                    (a-2r)(c-2r)·r  (front/back)
 *                    (b-2r)(c-2r)·r  (left/right)   — total 2 of each
 *     12 edge ¼-cylinders: ¼π r² × (length)
 *           4 along x of length (a-2r)
 *           4 along y of length (b-2r)
 *           4 along z of length (c-2r)
 *     8 corner ⅛-spheres:  total = full sphere = (4/3)π r³
 */
export function roundedBoxVolume([a, b, c], r) {
  if (r <= 0) return a * b * c;
  const inner = (a - 2 * r) * (b - 2 * r) * (c - 2 * r);
  const slabs = 2 * (a - 2 * r) * (b - 2 * r) * r
              + 2 * (a - 2 * r) * (c - 2 * r) * r
              + 2 * (b - 2 * r) * (c - 2 * r) * r;
  const edges = (Math.PI * r * r / 4) * 4 * ((a - 2 * r) + (b - 2 * r) + (c - 2 * r));
  const corners = (4 / 3) * Math.PI * r * r * r;
  return inner + slabs + edges + corners;
}
