/**
 * Demonstrator Part 1 — Phone-stand bracket.
 *
 * A simple L-shaped bracket sized for a phone:
 *   - Base: 80 × 60 × 4 mm with 4 × Ø4 mm mounting holes
 *   - Vertical wall: 80 × 50 × 4 mm tilted back 15° for viewing angle
 *   - Lip on the vertical wall to retain the phone
 *
 * Built end-to-end with the foundation pipeline:
 *   sketch → CrossSection → extrude → boolean subtract → translate → union
 */

import { Sketch2D } from '../Sketch2D.js';
import { buildCrossSection } from '../Profile.js';
import { extrude, subtract, add, translate, rotate } from '../Features.js';
import { getManifold } from '../manifoldKernel.js';

export async function buildPhoneStandBracket() {
  const { Manifold } = await getManifold();

  // ---- Base plate ----
  const sBase = new Sketch2D();
  const a = sBase.addPoint(0, 0, true);
  const b = sBase.addPoint(80, 0);
  const c = sBase.addPoint(80, 60);
  const d = sBase.addPoint(0, 60);
  const baseProfile = await buildCrossSection([[
    sBase.addLine(a, b), sBase.addLine(b, c),
    sBase.addLine(c, d), sBase.addLine(d, a),
  ]]);
  let base = await extrude(baseProfile, 4);

  // 4 × Ø4 mounting holes (corners, 8 mm in)
  const hole = Manifold.cylinder(8, 2, 2, 24, true);
  for (const [x, y] of [[8, 8], [72, 8], [72, 52], [8, 52]]) {
    base = await subtract(base, hole.translate([x, y, 2]));
  }

  // ---- Vertical wall (tilted 15° back) ----
  const sWall = new Sketch2D();
  const e1 = sWall.addPoint(0, 0, true);
  const e2 = sWall.addPoint(80, 0);
  const e3 = sWall.addPoint(80, 50);
  const e4 = sWall.addPoint(0, 50);
  const wallProfile = await buildCrossSection([[
    sWall.addLine(e1, e2), sWall.addLine(e2, e3),
    sWall.addLine(e3, e4), sWall.addLine(e4, e1),
  ]]);
  let wall = await extrude(wallProfile, 4);
  // Rotate -15° about X (lean back) and translate to back edge of base
  wall = rotate(wall, [-15, 0, 0]);
  wall = translate(wall, [0, 56, 4]);  // base depth 60 - wall thickness 4 = 56

  // ---- Lip on vertical wall (catches the phone) ----
  const lip = Manifold.cube([80, 4, 8], false);
  // Place at front-top of base, 6 mm forward of base back edge
  const lipPositioned = lip.translate([0, 6, 4]);

  // ---- Combine everything ----
  let bracket = await add(base, wall);
  bracket = await add(bracket, lipPositioned);

  return bracket;
}
