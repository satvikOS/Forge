// Radial cam — a disc cam whose radius rises over a nose sector by a
// smooth (raised-cosine) lift, giving the classic rise-dwell-fall profile
// a follower rides. Extruded to a cam disc with a central bore. Axis +Z.
// Kernel-dependent.

import { getManifold } from './manifoldKernel.js';

/**
 * @param {object} o
 * @param {number} o.baseR      base-circle radius (mm)
 * @param {number} o.lift       nose lift above the base circle (mm)
 * @param {number} o.noseCenter angular centre of the nose (deg)
 * @param {number} o.noseWidth  angular width of the rise+fall (deg)
 * @param {number} o.thickness  cam thickness (mm)
 * @param {number} o.boreR      central bore radius (mm; 0 = solid)
 * @param {number} [o.segments] profile resolution (>=64)
 * @returns {Promise<Manifold>}
 */
export async function camProfile({
  baseR = 120, lift = 70, noseCenter = 90, noseWidth = 120, thickness = 90, boreR = 40, segments = 180,
}) {
  const Mod = await getManifold();
  const n = Math.max(64, Math.floor(segments));
  const c = noseCenter * Math.PI / 180, hw = (noseWidth * Math.PI / 180) / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = 2 * Math.PI * i / n;
    // shortest angular distance to the nose centre
    let d = Math.abs(((th - c + Math.PI) % (2 * Math.PI)) - Math.PI);
    let r = baseR;
    if (d < hw) r = baseR + lift * 0.5 * (1 + Math.cos(Math.PI * d / hw)); // raised-cosine bump
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  const cs = Mod.CrossSection.ofPolygons([pts]);
  let cam = Mod.Manifold.extrude(cs, thickness);
  cs.delete();
  if (boreR > 0) {
    const boreCS = Mod.CrossSection.circle(boreR, 48);
    const bore = Mod.Manifold.extrude(boreCS, thickness + 2).translate([0, 0, -1]);
    boreCS.delete();
    const c2 = Mod.Manifold.difference(cam, bore);
    cam.delete(); bore.delete();
    cam = c2;
  }
  return cam;
}
