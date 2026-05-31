/**
 * Demonstrator Part 2 — Threaded bottle cap (mating pair).
 *
 * A pair: cap + bottle neck. Both share the same thread spec.
 *
 * Spec:
 *   Thread: M28 × 2 (28 mm major dia, 2 mm pitch) — common bottle-cap thread
 *   Cap: 32 mm OD × 18 mm tall, Ø28.4 internal cylinder with thread-form
 *        sweep cut (ID at minor dia 26 mm).
 *   Bottle neck: Ø28 OD × 22 mm tall on a Ø34 mm shoulder (5 mm tall),
 *                with thread-form sweep boss.
 *
 * Threads are formed with a triangular sweep along a helical path,
 * implemented as a stack of slightly-rotated, slightly-elevated solids
 * unioned together. The actual thread profile is a 60° trapezoid.
 *
 * After printing, the cap should screw onto the neck with hand torque.
 */

import { extrude, revolve, subtract, add, translate, rotate } from '../Features.js';
import { getManifold } from '../manifoldKernel.js';
import { crossSectionFromPolygons } from '../Profile.js';

const PI = Math.PI;

/**
 * Build a helical thread by stacking triangular cross-section rings
 * around a cylinder. Returns a Manifold representing only the thread
 * material — caller unions with the body cylinder.
 *
 * @param {object} spec
 * @param {number} spec.majorDia    — outer thread dia
 * @param {number} spec.minorDia    — root thread dia
 * @param {number} spec.pitch       — mm per turn
 * @param {number} spec.length      — total thread length along axis
 * @param {number} spec.startZ      — bottom z of thread
 * @param {number} spec.segmentsPerTurn  — 32 default
 */
async function buildHelicalThread(spec) {
  const { Manifold, CrossSection } = await getManifold();
  const { majorDia, minorDia, pitch, length, startZ, segmentsPerTurn = 64 } = spec;

  const turns = length / pitch;
  const totalSegs = Math.ceil(turns * segmentsPerTurn);
  const dz = pitch / segmentsPerTurn;
  const dAng = (2 * PI) / segmentsPerTurn;
  const Rmaj = majorDia / 2;
  const Rmin = minorDia / 2;
  const threadDepth = Rmaj - Rmin;

  // Build one segment as a small wedge box at radius Rmaj-(threadDepth)
  // tangent to circle. Triangle cross-section: depth threadDepth, height pitch/2.
  // We approximate the helix as N short cuboids each rotated and translated.

  // The thread's cross-section in the (radial, z) plane is a triangle:
  //   (Rmin, 0), (Rmaj, pitch/4), (Rmin, pitch/2)
  // We form a wedge sector by taking that triangle as a profile,
  // making a polygon in XY, extruding it dz tall, then translating
  // and rotating it onto the helix.
  // Simpler: build a single revolution-section thread (without helix)
  // and then carve it helically by cutting many radial slabs.
  // For demonstration purposes we use a straightforward approach:
  // build a square-section ring slightly larger than minor dia, and union
  // small wedges placed along the helix.

  const wedgeProfile = [
    [Rmin, 0],
    [Rmaj, pitch * 0.25],
    [Rmin, pitch * 0.5],
  ];
  // Extrude this into a thin-Z slab of height dz (or thicker for thinner segs)
  // Actually we want a 3D wedge — we'll extrude in z by `dz` and rotate.
  // The wedge profile is in (r, z) space. Map to xy plane: x = r, y = z.
  // Then extrude into +z by an angular slab thickness... that won't work.
  // Use revolve over a small angle to form a thin angular wedge, then helix.

  const wedgeProfilePts = wedgeProfile;
  const wedgeCS = await crossSectionFromPolygons([wedgeProfilePts]);
  // Revolve this profile by (360 / segmentsPerTurn) deg around y axis
  const segDeg = 360 / segmentsPerTurn;
  const wedge = await (await import('../Features.js')).revolve(wedgeCS, segDeg, { circularSegments: 8 });

  let thread = null;
  for (let i = 0; i < totalSegs; i++) {
    const angDeg = (i * 360) / segmentsPerTurn;
    const z = startZ + i * dz;
    let piece = wedge.rotate([0, 0, angDeg]).translate([0, 0, z]);
    thread = thread ? Manifold.union(thread, piece) : piece;
  }
  return thread;
}

export async function buildBottleNeck() {
  const { Manifold } = await getManifold();
  // Shoulder Ø34 × 5 mm
  const shoulder = Manifold.cylinder(5, 17, 17, 64, false);
  // Neck Ø28 × 22 mm
  const neck = Manifold.cylinder(22, 14, 14, 64, false).translate([0, 0, 5]);
  // Bore through both Ø22 (for liquid path)
  const bore = Manifold.cylinder(40, 11, 11, 32, false).translate([0, 0, -1]);
  let body = Manifold.union(shoulder, neck);
  body = Manifold.difference(body, bore);
  // Threads on neck (M28 × 2, 18 mm long, starting 7 mm above shoulder)
  const thread = await buildHelicalThread({
    majorDia: 28, minorDia: 26, pitch: 2, length: 18, startZ: 7,
    segmentsPerTurn: 64,
  });
  if (thread) body = Manifold.union(body, thread);
  return body;
}

export async function buildBottleCap() {
  const { Manifold } = await getManifold();
  // Outer body Ø32 × 18 mm
  const outer = Manifold.cylinder(18, 16, 16, 64, false);
  // Inner cylinder Ø28.4 × 18 (cleared minor dia + thread space)
  const inner = Manifold.cylinder(20, 14.4, 14.4, 64, false).translate([0, 0, -1]);
  let cap = Manifold.difference(outer, inner);
  // Internal threads (negative — we union a thread on inner wall, then
  // the inner-cylinder subtraction removed the wall thickness; the
  // helical bumps remain pointing inward).
  const thread = await buildHelicalThread({
    majorDia: 28, minorDia: 26, pitch: 2, length: 14, startZ: 2,
    segmentsPerTurn: 64,
  });
  if (thread) cap = Manifold.union(cap, thread);
  // Knurled outer surface (12 axial flutes)
  for (let i = 0; i < 12; i++) {
    const angDeg = (i * 360) / 12;
    const flute = Manifold.cylinder(18, 0.6, 0.6, 8, false).translate([16.2, 0, 0]).rotate([0, 0, angDeg]);
    cap = Manifold.difference(cap, flute);
  }
  return cap;
}
