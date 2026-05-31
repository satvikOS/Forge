// Spur gear — a parametric involute-style spur gear as a manifold solid.
// Teeth use a trapezoidal flank approximation (narrower at the tip, wider
// at the root) on the standard pitch / addendum / dedendum circles, so it
// reads and meshes like a real gear. Kernel-dependent.

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
 * @param {object} o
 * @param {number} o.module     gear module m (mm) — tooth size
 * @param {number} o.teeth      number of teeth z (>=6)
 * @param {number} o.thickness  face width (mm)
 * @param {number} o.boreR      central bore radius (mm; 0 = solid)
 * @returns {Promise<Manifold>}  gear, axis +Z, centred at origin
 */
export async function spurGear({ module = 8, teeth = 24, thickness = 120, boreR = 60 }) {
  const Mod = await getManifold();
  const z = Math.max(6, Math.floor(teeth));
  const m = module;
  const rp = m * z / 2;          // pitch radius
  const ra = rp + m;             // addendum (tip) radius
  const rf = rp - 1.25 * m;      // dedendum (root) radius
  const ta = 2 * Math.PI / z;    // angular tooth pitch
  const hTip = ta * 0.13, hPitch = ta * 0.25, hRoot = ta * 0.30, hValley = ta * 0.5;
  const at = (r, ang) => [r * Math.cos(ang), r * Math.sin(ang)];
  const pts = [];
  for (let i = 0; i < z; i++) {
    const c = i * ta;
    pts.push(at(rf, c - hValley));
    pts.push(at(rf, c - hRoot));
    pts.push(at(rp, c - hPitch));
    pts.push(at(ra, c - hTip));
    pts.push(at(ra, c + hTip));
    pts.push(at(rp, c + hPitch));
    pts.push(at(rf, c + hRoot));
    pts.push(at(rf, c + hValley));
  }
  const cs = Mod.CrossSection.ofPolygons([ccw(pts)]);
  let gear = Mod.Manifold.extrude(cs, thickness);
  cs.delete();
  if (boreR > 0) {
    const boreCS = Mod.CrossSection.circle(boreR, 48);
    const bore = Mod.Manifold.extrude(boreCS, thickness + 2).translate([0, 0, -1]);
    boreCS.delete();
    const g2 = Mod.Manifold.difference(gear, bore);
    gear.delete(); bore.delete();
    gear = g2;
  }
  return gear;
}

/** Standard meshing centre distance for two gears of the same module. */
export function gearCentreDistance(module, teethA, teethB) {
  return module * (teethA + teethB) / 2;
}
