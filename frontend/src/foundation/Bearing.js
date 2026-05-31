// Ball bearing — a rolling-element bearing as a manifold: an outer race
// ring, an inner race ring, and a ring of balls at the pitch circle.
// Axis +Z, width along Z (z∈[0,width]); caller reorients. Kernel-dependent.
// (Bearing ANALYSIS — life / load — lives elsewhere in Bearings.js.)

import { getManifold } from './manifoldKernel.js';

async function ring(Mod, ri, ro, h, seg = 64) {
  const outer = Mod.CrossSection.circle(ro, seg);
  const inner = Mod.CrossSection.circle(ri, seg);
  const annulus = outer.subtract(inner);
  outer.delete(); inner.delete();
  const solid = Mod.Manifold.extrude(annulus, h);
  annulus.delete();
  return solid;
}

/**
 * @param {object} o
 * @param {number} o.boreR    bore (inner) radius (mm)
 * @param {number} o.outerR   outer radius (mm)
 * @param {number} o.width    bearing width along the axis (mm)
 * @param {number} o.balls    number of rolling balls (>=4)
 * @param {number} [o.ballScale] ball size vs the race gap (0.5..1)
 * @returns {Promise<Manifold>}
 */
export async function ballBearing({ boreR = 80, outerR = 160, width = 90, balls = 10, ballScale = 0.9 }) {
  const Mod = await getManifold();
  const z = Math.max(4, Math.floor(balls));
  const rp = (boreR + outerR) / 2;                 // pitch radius
  const gap = (outerR - boreR) / 2;                // radial gap
  const ballR = Math.min(gap * 0.5, width * 0.45) * Math.max(0.4, Math.min(1, ballScale));
  // races leave a raceway gap for the balls
  const outerRace = await ring(Mod, rp + ballR * 0.65, outerR, width);
  const innerRace = await ring(Mod, boreR, rp - ballR * 0.65, width);
  let solid = Mod.Manifold.union(outerRace, innerRace);
  outerRace.delete(); innerRace.delete();
  for (let i = 0; i < z; i++) {
    const a = 2 * Math.PI * i / z;
    const ball = Mod.Manifold.sphere(ballR, 24).translate([rp * Math.cos(a), rp * Math.sin(a), width / 2]);
    const u = Mod.Manifold.union(solid, ball);
    solid.delete(); ball.delete();
    solid = u;
  }
  return solid;
}
