/**
 * Demonstrator Part 5 — Sealed enclosure (base + lid + 4 fasteners).
 *
 * A 100 × 60 × 30 mm box-style enclosure with:
 *   - 3 mm wall thickness
 *   - 4 × M3 PCB-mount bosses inside the base (Ø6 OD × Ø2.5 ID, 8 mm tall)
 *   - 4 × M3 fastener bosses on the corners (Ø8 OD × Ø3.2 clearance hole)
 *   - Mating lip + groove for an O-ring seal
 *   - Lid with through-holes aligned to the corner bosses
 *
 * Both parts print flat-side-down without supports (lip and bosses
 * are above 45° draft).
 */

import { Sketch2D } from '../Sketch2D.js';
import { buildCrossSection } from '../Profile.js';
import { extrude, subtract, add, translate } from '../Features.js';
import { getManifold } from '../manifoldKernel.js';

const ENCL = {
  outerW: 100, outerD: 60, baseH: 25, lidH: 5,
  wall: 3,
  cornerR: 5,
  bossOD: 8, bossClearance: 3.2,
  bossInsetXY: 6,
  pcbBossOD: 6, pcbBossID: 2.5, pcbBossH: 8,
  pcbBossPositions: [[20, 15], [80, 15], [20, 45], [80, 45]],
  lipH: 2,        // lip protrudes from base into lid
  lipInset: 1.5,  // lip is 1.5 mm inset from outer
  grooveDepth: 1.4,
  grooveWidth: 2.0,
};

async function buildOuterRect(w, d, h) {
  const s = new Sketch2D();
  const a = s.addPoint(0, 0, true);
  const b = s.addPoint(w, 0);
  const c = s.addPoint(w, d);
  const dd = s.addPoint(0, d);
  const profile = await buildCrossSection([[
    s.addLine(a, b), s.addLine(b, c),
    s.addLine(c, dd), s.addLine(dd, a),
  ]]);
  return extrude(profile, h);
}

export async function buildEnclosureBase() {
  const { Manifold } = await getManifold();
  const { outerW, outerD, baseH, wall, bossOD, bossClearance, bossInsetXY,
          pcbBossOD, pcbBossID, pcbBossH, pcbBossPositions, lipH, lipInset } = ENCL;

  // Outer wall
  let base = await buildOuterRect(outerW, outerD, baseH);
  // Hollow inside
  const cavityW = outerW - 2 * wall;
  const cavityD = outerD - 2 * wall;
  const cavity = (await buildOuterRect(cavityW, cavityD, baseH - wall + 1))
    .translate([wall, wall, wall]);
  base = await subtract(base, cavity);

  // Corner fastener bosses (Ø8 OD with Ø3.2 clearance, full height)
  const cornerBoss = Manifold.cylinder(baseH, bossOD / 2, bossOD / 2, 32, false);
  const cornerHole = Manifold.cylinder(baseH + 2, bossClearance / 2, bossClearance / 2, 24, false)
    .translate([0, 0, -1]);
  const cornerXYs = [
    [bossInsetXY, bossInsetXY],
    [outerW - bossInsetXY, bossInsetXY],
    [outerW - bossInsetXY, outerD - bossInsetXY],
    [bossInsetXY, outerD - bossInsetXY],
  ];
  for (const [x, y] of cornerXYs) {
    base = await add(base, cornerBoss.translate([x, y, 0]));
    base = await subtract(base, cornerHole.translate([x, y, 0]));
  }

  // PCB-mount bosses inside (Ø6 OD with Ø2.5 ID, 8 mm tall, on inside floor)
  const pcbBoss = Manifold.cylinder(pcbBossH, pcbBossOD / 2, pcbBossOD / 2, 24, false);
  const pcbHole = Manifold.cylinder(pcbBossH + 2, pcbBossID / 2, pcbBossID / 2, 16, false)
    .translate([0, 0, -1]);
  for (const [x, y] of pcbBossPositions) {
    base = await add(base, pcbBoss.translate([x, y, wall]));
    base = await subtract(base, pcbHole.translate([x, y, wall]));
  }

  // Sealing lip at top (protrudes lipH above base, sized to slip into lid groove)
  const lipW = outerW - 2 * lipInset;
  const lipD = outerD - 2 * lipInset;
  const lip = (await buildOuterRect(lipW, lipD, lipH)).translate([lipInset, lipInset, baseH]);
  // Carve a smaller cavity in the lip so it's a thin wall
  const lipCavityW = lipW - 2 * 1.5;
  const lipCavityD = lipD - 2 * 1.5;
  const lipCavity = (await buildOuterRect(lipCavityW, lipCavityD, lipH + 1))
    .translate([lipInset + 1.5, lipInset + 1.5, baseH - 1]);
  let lipNet = await subtract(lip, lipCavity);
  base = await add(base, lipNet);

  return base;
}

export async function buildEnclosureLid() {
  const { Manifold } = await getManifold();
  const { outerW, outerD, lidH, wall, bossClearance, bossInsetXY,
          lipH, lipInset, grooveDepth, grooveWidth } = ENCL;

  let lid = await buildOuterRect(outerW, outerD, lidH);
  // Through-holes for M3 corner fasteners
  const hole = Manifold.cylinder(lidH + 2, bossClearance / 2, bossClearance / 2, 24, false)
    .translate([0, 0, -1]);
  const cornerXYs = [
    [bossInsetXY, bossInsetXY],
    [outerW - bossInsetXY, bossInsetXY],
    [outerW - bossInsetXY, outerD - bossInsetXY],
    [bossInsetXY, outerD - bossInsetXY],
  ];
  for (const [x, y] of cornerXYs) {
    lid = await subtract(lid, hole.translate([x, y, 0]));
  }
  // Underside groove for the sealing lip
  const grooveW = outerW - 2 * (lipInset - 0.2);
  const grooveD = outerD - 2 * (lipInset - 0.2);
  const grooveCavityW = grooveW - 2 * grooveWidth;
  const grooveCavityD = grooveD - 2 * grooveWidth;
  const grooveOuter = (await buildOuterRect(grooveW, grooveD, grooveDepth))
    .translate([(outerW - grooveW) / 2, (outerD - grooveD) / 2, 0]);
  const grooveInner = (await buildOuterRect(grooveCavityW, grooveCavityD, grooveDepth + 1))
    .translate([(outerW - grooveCavityW) / 2, (outerD - grooveCavityD) / 2, -1]);
  const groove = await subtract(grooveOuter, grooveInner);
  lid = await subtract(lid, groove);
  return lid;
}

export const ENCLOSURE_SPEC = ENCL;
