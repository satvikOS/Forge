// Edge-blend fillet — a tangent-continuous (G1) rolling-ball quarter-
// round run along an axis-aligned edge. Unioned into a body it rounds a
// concave panel junction (the fillet a Class-A modeller adds where two
// panels meet). Analytic circular section (smooth, not voxelized);
// matches the G1 rolling-ball blend the BlendSurface helpers produce.
// Kernel-dependent — do NOT import at node level in e2e.

import { getManifold } from './manifoldKernel.js';

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
const ccw = (pts) => (signedArea(pts) < 0 ? pts.slice().reverse() : pts);

/**
 * Build a concave fillet fillet solid: the curved-triangle region between
 * a 90° corner and the rolling-ball arc of radius r, extruded `length`
 * along the edge. Local frame: edge along +Z at the origin; the fillet
 * fills the +X+Y quadrant (tangent to the y=0 and x=0 faces). The handler
 * rotates it onto any axis / quadrant and translates it to the edge.
 *
 * @param {object} o
 * @param {number} o.radius    fillet radius (mm)
 * @param {number} o.length    run length along the edge (mm)
 * @param {number} [o.segments] arc tessellation (>=4)
 * @returns {Promise<Manifold>}
 */
export async function edgeFillet({ radius = 80, length = 1000, segments = 28 }) {
  const Mod = await getManifold();
  const r = radius, n = Math.max(4, Math.floor(segments));
  // A small lip past the two faces (into the panels) so a subsequent
  // Merge welds cleanly instead of leaving coplanar touching faces.
  const lip = Math.max(4, r * 0.15);
  // cross-section (perpendicular to the edge): the square [-lip,r]² with
  // the rolling-ball quarter-disk (centre (r,r), radius r) removed — i.e.
  // the concave valley fill, overlapping each face by `lip`. Boundary:
  // (-lip,-lip) → (r,-lip) → concave arc (r,0)→(0,r) → (-lip,r) → close.
  const pts = [[-lip, -lip], [r, -lip]];
  for (let i = 0; i <= n; i++) {
    const th = (270 - 90 * (i / n)) * Math.PI / 180;   // (r,0) → (0,r)
    pts.push([r + r * Math.cos(th), r + r * Math.sin(th)]);
  }
  pts.push([-lip, r]);
  const cs = Mod.CrossSection.ofPolygons([ccw(pts)]);
  const solid = Mod.Manifold.extrude(cs, length);
  cs.delete();
  return solid;
}
