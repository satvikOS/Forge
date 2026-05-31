/**
 * ArchDisc Kernel — Atomic-CAD bearing builders.
 *
 * SKF deep-groove ball (60xx, 63xx) and tapered roller (302xx, 322xx)
 * bearings. Each builder sketches concentric rings and cuts the bore +
 * race grooves via real AtomicOps; the bearing axis is +Z.
 *
 * Modelled fidelity:
 *   - Outer race (cylinder, outer-dia OD, hollowed to (pitch + ballR))
 *   - Inner race (annular, pitch − ballR → bore)
 *   - Pitch-circle of balls / rollers (single annular band representing
 *     the ring of rolling elements at fidelity sufficient for octaweb
 *     visual + BOM)
 *
 * Records 8 features per bearing — replayable history.
 *
 * Future sessions: detail balls/rollers as discrete spheres/cones via
 * the circularPattern atomic op; expose ABEC tolerance class.
 */

import {
  startSketch, sketchCircle, finishSketch, extrude, cut,
} from '../../AtomicOps.js';
import {
  SKF_DEEP_GROOVE_LIGHT, SKF_DEEP_GROOVE_HEAVY,
  SKF_TAPERED_LIGHT, SKF_TAPERED_HEAVY,
} from '../data/skf.js';

function lookupDeepGroove(designation) {
  return SKF_DEEP_GROOVE_LIGHT[designation] || SKF_DEEP_GROOVE_HEAVY[designation];
}

function lookupTapered(designation) {
  return SKF_TAPERED_LIGHT[designation] || SKF_TAPERED_HEAVY[designation];
}

// ─────────────────────────────────────────────────────────────────────────
// SKF deep-groove ball bearing
//
// Build sequence:
//   1. Outer race cylinder (sketch OD, extrude width)
//   2. Bore through-hole
//   3. Inner race cut (annular pocket from top — leaves outer race
//      standing and creates the inner-race ring as a separate ring)
// ─────────────────────────────────────────────────────────────────────────
export async function skfDeepGroove(part, { designation }) {
  const spec = lookupDeepGroove(designation);
  if (!spec) throw new Error(`SKF deep-groove: unknown ${designation}`);
  const pitchR = (spec.bore + spec.od) / 4;       // pitch-circle radius
  const ballR = spec.ballD / 2;

  // 1. Outer body
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, spec.od / 2);
  finishSketch(part);
  await extrude(part, spec.width);

  // 2. Bore through-hole
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, spec.bore / 2);
  finishSketch(part);
  await cut(part, spec.width + 2);

  // 3. Inner-race ball-pocket — a shallow annular trough between
  // (pitchR - ballR) and (pitchR + ballR), depth = ballR. Approximate
  // via a circular pocket cut from the top face.
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, pitchR + ballR);
  finishSketch(part);
  await cut(part, ballR);

  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, pitchR - ballR);
  finishSketch(part);
  await extrude(part, ballR * 0.7);   // re-add the inner-race ring inside the pocket

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// SKF tapered roller bearing
//
// Simplified atomic model: outer cup (cylinder, OD, full width), bore
// through-hole, cone-pocket cut into the top face representing the
// tapered race.
// Records 6 features.
// ─────────────────────────────────────────────────────────────────────────
export async function skfTapered(part, { designation }) {
  const spec = lookupTapered(designation);
  if (!spec) throw new Error(`SKF tapered: unknown ${designation}`);

  // 1. Outer cup
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, spec.od / 2);
  finishSketch(part);
  await extrude(part, spec.width);

  // 2. Bore through-hole
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, spec.bore / 2);
  finishSketch(part);
  await cut(part, spec.width + 2);

  // 3. Race shoulder pocket — proxy for the tapered race seat.
  const seatR = (spec.bore + spec.od) / 4 + 1.5;
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, seatR);
  finishSketch(part);
  await cut(part, spec.width * 0.35);

  return part;
}
