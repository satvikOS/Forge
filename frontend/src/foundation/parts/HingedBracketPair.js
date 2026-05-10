/**
 * Demonstrator Part 3 — Hinged bracket pair (3 parts).
 *
 * Two L-brackets hinged on a printed-in-place pin.
 *
 *   leaf_A    : 50 × 30 × 4 mm with a barrel knuckle (Ø10 OD, Ø6 ID, 12 mm tall)
 *               on one edge.
 *   leaf_B    : same but with two knuckles (one above, one below) that
 *               clear the leaf_A knuckle when assembled.
 *   pin       : Ø5.8 × 30 mm cylinder (slip fit through Ø6 knuckle bore).
 *
 * The two leaves rotate freely about the pin axis; the mate solver
 * verifies the rotation is unconstrained (one DOF active after the
 * concentric mate is applied).
 */

import { Sketch2D } from '../Sketch2D.js';
import { buildCrossSection } from '../Profile.js';
import { extrude, subtract, add, translate, rotate } from '../Features.js';
import { getManifold } from '../manifoldKernel.js';

async function buildLeaf(opts) {
  const { Manifold } = await getManifold();
  const { knuckleSplit } = opts;  // 'middle' = one centered knuckle, 'split' = two outer knuckles
  // Plate 50 × 30 × 4
  const s = new Sketch2D();
  const a = s.addPoint(0, 0, true);
  const b = s.addPoint(50, 0);
  const c = s.addPoint(50, 30);
  const d = s.addPoint(0, 30);
  const profile = await buildCrossSection([[
    s.addLine(a, b), s.addLine(b, c), s.addLine(c, d), s.addLine(d, a),
  ]]);
  let leaf = await extrude(profile, 4);

  // Knuckle barrel(s) along edge x=50 (right edge), spanning Y range
  if (knuckleSplit === 'middle') {
    // one knuckle 12 tall centered y=15
    const barrel = Manifold.cylinder(12, 5, 5, 32, false);
    const bore = Manifold.cylinder(14, 3, 3, 32, false).translate([0, 0, -1]);
    let knuckle = Manifold.difference(barrel, bore);
    // place at (50, 15, -4) so the barrel is centered z about leaf top (z=4)
    knuckle = knuckle.translate([50, 15, -4]);
    leaf = await add(leaf, knuckle);
  } else {
    // two knuckles 8 tall centered y=8 and y=22
    const barrel = Manifold.cylinder(8, 5, 5, 32, false);
    const bore = Manifold.cylinder(10, 3, 3, 32, false).translate([0, 0, -1]);
    const knuckle = Manifold.difference(barrel, bore);
    let k1 = knuckle.translate([50, 8, -2]);     // sits with center at y=8
    let k2 = knuckle.translate([50, 22, -2]);    // mirror at y=22
    leaf = await add(leaf, k1);
    leaf = await add(leaf, k2);
  }
  return leaf;
}

export async function buildLeafA() { return buildLeaf({ knuckleSplit: 'middle' }); }
export async function buildLeafB() { return buildLeaf({ knuckleSplit: 'split'  }); }

export async function buildHingePin() {
  const { Manifold } = await getManifold();
  // Ø5.8 × 30 mm with chamfered ends (cones) for easy entry
  const shaft = Manifold.cylinder(28, 2.9, 2.9, 32, true);
  const tipBottom = Manifold.cylinder(1, 2.9, 1.5, 16, false).translate([0, 0, -15]);
  const tipTop = Manifold.cylinder(1, 1.5, 2.9, 16, false).translate([0, 0, 14]);
  return Manifold.union(Manifold.union(shaft, tipBottom), tipTop);
}
