// Embossed text — real-font 3D lettering as a manifold solid (raised
// badges / logos like the VOLVO wordmark). Glyph outlines come from a
// bundled typeface (Three.js Font.generateShapes), then each contour is
// extruded and its holes subtracted, so the result is smooth (curve-
// tessellated, not blocky) AND a true manifold the kernel can boolean /
// export. Kernel-dependent — do NOT import at node level in e2e.

import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import fontJson from 'three/examples/fonts/droid/droid_sans_bold.typeface.json';
import { getManifold } from './manifoldKernel.js';

let _font = null;
function font() { if (!_font) _font = new Font(fontJson); return _font; }

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
 * Build raised 3D text centred about the origin, in the X-Y plane,
 * extruded `depth` in +Z. Caller rotates/translates onto a surface.
 *
 * @param {object} o
 * @param {string} o.text           the string to emboss
 * @param {number} o.size           cap height (mm)
 * @param {number} o.depth          extrusion / relief depth (mm)
 * @param {number} [o.curveSegments] glyph curve tessellation (>=2; higher = smoother)
 * @returns {Promise<Manifold>}
 */
export async function embossText({ text = 'VOLVO', size = 300, depth = 40, curveSegments = 8 }) {
  const Mod = await getManifold();
  const shapes = font().generateShapes(String(text ?? ''), size);
  let solid = null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const shape of shapes) {
    const ep = shape.extractPoints(Math.max(2, Math.floor(curveSegments)));
    const outer = (ep.shape || []).map((p) => [p.x, p.y]);
    if (outer.length < 3) continue;
    for (const [x, y] of outer) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const outerCS = Mod.CrossSection.ofPolygons([ccw(outer)]);
    let letter = Mod.Manifold.extrude(outerCS, depth);
    outerCS.delete();
    for (const h of (ep.holes || [])) {
      const hole = h.map((p) => [p.x, p.y]);
      if (hole.length < 3) continue;
      const holeCS = Mod.CrossSection.ofPolygons([ccw(hole)]);
      const tool = Mod.Manifold.extrude(holeCS, depth + 2).translate([0, 0, -1]);
      holeCS.delete();
      const cut = Mod.Manifold.difference(letter, tool);
      letter.delete(); tool.delete();
      letter = cut;
    }
    if (!solid) solid = letter;
    else {
      const u = Mod.Manifold.union(solid, letter);
      solid.delete(); letter.delete();
      solid = u;
    }
  }
  if (!solid) throw new Error(`embossText: no renderable glyphs in "${text}"`);

  // Centre about the origin (Font lays glyphs out from the x=0 baseline).
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const centered = solid.translate([-cx, -cy, 0]);
  solid.delete();
  return centered;
}
