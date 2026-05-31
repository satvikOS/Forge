/**
 * Demonstrator Part 4 — Planetary gearset (sun + ring + 4 planets).
 *
 * Real involute gears would require a sweep along an involute curve; we
 * approximate by building each tooth as a trapezoidal radial fin and
 * unioning them around the rim. For visual + assembly demonstration this
 * is enough; for power transmission you'd want true involute profiles.
 *
 * Numbers (real planetary gearset constraint):
 *   Z_sun + 2 × Z_planet = Z_ring   (so the planets fit exactly)
 *   We choose Z_sun = 12, Z_planet = 18, Z_ring = 48.
 *   Module m = 1.0 mm — pitch dia = m × Z.
 *     sun PD = 12, planet PD = 18, ring PD = 48
 *     center distance sun→planet = (PD_sun + PD_planet)/2 = 15
 *
 * Tooth: addendum = m, dedendum = 1.25 m; tooth tip width = 0.4 m,
 * tooth root width = 1.0 m; depth = 2.25 m radially.
 *
 * All gears 6 mm tall, with central bores:
 *   sun bore Ø4 (output shaft)
 *   planet bore Ø3 (planet pin)
 *   ring outer Ø50, with fastener flange.
 */

import { getManifold } from '../manifoldKernel.js';
import { crossSectionFromPolygons } from '../Profile.js';
import { extrude } from '../Features.js';

const PI = Math.PI;
const MODULE_MM = 1.0;
const HEIGHT_MM = 6;

function buildToothProfileMM(rPitch, addendum, dedendum, toothTipFactor = 0.4, toothRootFactor = 1.0) {
  // Local trapezoid tooth in (x = circumferential, y = radial)
  // Build at 0° and we'll rotate to position.
  const tipHalf = (MODULE_MM * toothTipFactor) / 2;
  const rootHalf = (MODULE_MM * toothRootFactor) / 2;
  // Polygon CCW:
  // (-rootHalf, -dedendum)
  // (+rootHalf, -dedendum)
  // (+tipHalf,  +addendum)
  // (-tipHalf,  +addendum)
  return [
    [-rootHalf, -dedendum],
    [+rootHalf, -dedendum],
    [+tipHalf, +addendum],
    [-tipHalf, +addendum],
  ];
}

async function buildExternalGear(numTeeth, rPitch, options = {}) {
  const { Manifold } = await getManifold();
  const addendum = MODULE_MM;
  const dedendum = MODULE_MM * 1.25;
  const rRoot = rPitch - dedendum;

  // Base disk = root cylinder
  let gear = Manifold.cylinder(HEIGHT_MM, rRoot, rRoot, Math.max(64, numTeeth * 6), false);

  // Build one tooth as a small radial slab and union N copies
  const toothPts = buildToothProfileMM(rPitch, addendum, dedendum);
  const toothCS = await crossSectionFromPolygons([toothPts]);
  const toothSolid = (await extrude(toothCS, HEIGHT_MM));
  // The tooth profile sits at origin; we translate it radially out by rPitch
  // and rotate around z.
  for (let i = 0; i < numTeeth; i++) {
    const angDeg = (i * 360) / numTeeth;
    const piece = toothSolid.translate([0, rPitch, 0]).rotate([0, 0, angDeg]);
    gear = Manifold.union(gear, piece);
  }

  // Optional bore
  if (options.boreDia) {
    const bore = Manifold.cylinder(HEIGHT_MM + 2, options.boreDia / 2, options.boreDia / 2, 32, false)
      .translate([0, 0, -1]);
    gear = Manifold.difference(gear, bore);
  }
  return gear;
}

async function buildInternalRing(numTeeth, rPitch, outerR, options = {}) {
  const { Manifold } = await getManifold();
  const addendum = MODULE_MM;
  const dedendum = MODULE_MM * 1.25;
  // For internal gear, tip of tooth points INWARD; so addendum reduces radius,
  // dedendum extends outward.
  // Outer disk (annulus)
  const outer = Manifold.cylinder(HEIGHT_MM, outerR, outerR, Math.max(64, numTeeth * 6), false);
  const innerHole = Manifold.cylinder(HEIGHT_MM + 2, rPitch + addendum, rPitch + addendum, Math.max(64, numTeeth * 6), false)
    .translate([0, 0, -1]);
  let ring = Manifold.difference(outer, innerHole);

  // Inward-pointing teeth: triangles with tip at smaller radius
  const tipHalf = (MODULE_MM * 0.4) / 2;
  const rootHalf = (MODULE_MM * 1.0) / 2;
  const toothPts = [
    [-rootHalf, +dedendum],
    [-tipHalf, -addendum],
    [+tipHalf, -addendum],
    [+rootHalf, +dedendum],
  ];
  const toothCS = await crossSectionFromPolygons([toothPts]);
  const toothSolid = await extrude(toothCS, HEIGHT_MM);
  for (let i = 0; i < numTeeth; i++) {
    const angDeg = (i * 360) / numTeeth;
    const piece = toothSolid.translate([0, rPitch, 0]).rotate([0, 0, angDeg]);
    ring = Manifold.union(ring, piece);
  }

  // Bolt-flange on top: 4 holes Ø3 at outer radius
  if (options.flangeBolts) {
    const flangeR = (rPitch + outerR) / 2;
    const bolt = Manifold.cylinder(HEIGHT_MM + 2, 1.5, 1.5, 24, false).translate([0, 0, -1]);
    for (let i = 0; i < options.flangeBolts; i++) {
      const ang = (i * 2 * PI) / options.flangeBolts;
      ring = Manifold.difference(ring, bolt.translate([flangeR * Math.cos(ang), flangeR * Math.sin(ang), 0]));
    }
  }
  return ring;
}

export async function buildPlanetary() {
  const Z_SUN = 12, Z_PLANET = 18, Z_RING = 48;
  const PD_SUN = MODULE_MM * Z_SUN;
  const PD_PLANET = MODULE_MM * Z_PLANET;
  const PD_RING = MODULE_MM * Z_RING;
  const center_distance = (PD_SUN + PD_PLANET) / 2;

  const sun = await buildExternalGear(Z_SUN, PD_SUN / 2, { boreDia: 4 });
  const planet = await buildExternalGear(Z_PLANET, PD_PLANET / 2, { boreDia: 3 });
  const ring = await buildInternalRing(Z_RING, PD_RING / 2, PD_RING / 2 + 4, { flangeBolts: 4 });

  return {
    sun, planet, ring,
    centers: {
      sun: [0, 0, 0],
      planets: [0, 1, 2, 3].map(i => {
        const a = (i * 2 * PI) / 4;
        return [center_distance * Math.cos(a), center_distance * Math.sin(a), 0];
      }),
      ring: [0, 0, 0],
    },
    spec: { Z_SUN, Z_PLANET, Z_RING, MODULE_MM, HEIGHT_MM },
  };
}
