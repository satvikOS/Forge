/**
 * ArchDisc Kernel — Atomic-CAD fastener builders.
 *
 * Each builder takes a fresh `Part` and runs real `AtomicOps` to sculpt the
 * geometry — `startSketch → sketchCircle/sketchPolygon → finishSketch →
 * extrude / cut / revolve`. Every step records a feature on the Part, so
 * the construction history is replayable and editable in the
 * FeatureTreePanel.
 *
 * No fixture imports. No sealed Manifold returns. No Math.random.
 *
 * All builders honour the 9-rule standing bar for the gap-closure roadmap.
 */

import {
  startSketch, sketchCircle, sketchPolygon, finishSketch,
  extrude, cut,
} from '../../AtomicOps.js';
import { ISO_4762, ISO_4014, ISO_4017, ISO_4032, ISO_7089, ISO_7090 } from '../data/iso.js';
import { ASME_B18_2_1, ASME_B18_3, INCH_TO_MM } from '../data/asme.js';

const SQRT3 = Math.sqrt(3);

// Convert wrench across-flats `s` to circumscribed (corner) radius for a
// regular hexagon: r = s / sqrt(3).
function hexFlatsToCircumR(s) {
  return s / SQRT3;
}

// ─────────────────────────────────────────────────────────────────────────
// ISO 4762 — Socket Head Cap Screw (Allen)
// Build sequence:
//   1. Sketch shank circle on XY plane
//   2. Extrude shank up by `length_mm`
//   3. Sketch head circle on top face
//   4. Extrude head up by `k`
//   5. Sketch hex socket polygon on new top face
//   6. Cut socket down by `tk`
// Records 6 features on the Part.
// ─────────────────────────────────────────────────────────────────────────
export async function iso4762(part, { size, length_mm }) {
  const c = ISO_4762[size];
  if (!c) throw new Error(`ISO 4762: unknown size ${size}`);
  if (!(length_mm > 0)) throw new Error(`ISO 4762: length_mm must be > 0 (got ${length_mm})`);

  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.D / 2);
  finishSketch(part);
  await extrude(part, length_mm);

  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.dk / 2);
  finishSketch(part);
  await extrude(part, c.k);

  await startSketch(part, 'top');
  sketchPolygon(part, 0, 0, hexFlatsToCircumR(c.s), 6);
  finishSketch(part);
  await cut(part, c.tk);

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// ISO 4014 — Hex Bolt, partial thread
// Geometrically identical to a full-thread bolt at our level of fidelity
// (we model the head + plain shank; threads are simplified to minor-dia
// cylinder elsewhere). Builder records 4 features.
// ─────────────────────────────────────────────────────────────────────────
export async function iso4014(part, { size, length_mm }) {
  const c = ISO_4014[size];
  if (!c) throw new Error(`ISO 4014: unknown size ${size}`);
  if (!(length_mm > 0)) throw new Error(`ISO 4014: length_mm must be > 0 (got ${length_mm})`);

  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.D / 2);
  finishSketch(part);
  await extrude(part, length_mm);

  await startSketch(part, 'top');
  sketchPolygon(part, 0, 0, hexFlatsToCircumR(c.s), 6);
  finishSketch(part);
  await extrude(part, c.k);

  return part;
}

// ISO 4017 ≡ ISO 4014 dimensionally at the head; geometry identical.
export async function iso4017(part, opts) {
  const c = ISO_4017[opts.size];
  if (!c) throw new Error(`ISO 4017: unknown size ${opts.size}`);
  return iso4014(part, opts);
}

// ─────────────────────────────────────────────────────────────────────────
// ISO 4032 — Hex Nut
// Hex prism, then drill the threaded bore (modelled as a clearance
// cylinder slightly under nominal D for thread engagement).
// Records 4 features.
// ─────────────────────────────────────────────────────────────────────────
export async function iso4032(part, { size }) {
  const c = ISO_4032[size];
  if (!c) throw new Error(`ISO 4032: unknown size ${size}`);

  await startSketch(part, 'XY');
  sketchPolygon(part, 0, 0, hexFlatsToCircumR(c.s), 6);
  finishSketch(part);
  await extrude(part, c.m);

  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, (c.D - 0.1) / 2);
  finishSketch(part);
  await cut(part, c.m + 2);  // through-cut

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// ISO 7089 — Plain Washer, normal series
// Annular disc — outer circle extruded, inner hole cut.
// Records 4 features.
// ─────────────────────────────────────────────────────────────────────────
export async function iso7089(part, { size }) {
  const c = ISO_7089[size];
  if (!c) throw new Error(`ISO 7089: unknown size ${size}`);

  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.d2 / 2);
  finishSketch(part);
  await extrude(part, c.h);

  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.d1 / 2);
  finishSketch(part);
  await cut(part, c.h + 2);

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// ISO 7090 — Spring Lock Washer (split-ring)
// Simplified atomic model: annular disc with the spec thickness `h` and
// outer/inner from the table. The split + helix are visual-only at this
// fidelity; the geometry function is preload-correct (right OD/ID, right
// stack height). Records 4 features.
// ─────────────────────────────────────────────────────────────────────────
export async function iso7090(part, { size }) {
  const c = ISO_7090[size];
  if (!c) throw new Error(`ISO 7090: unknown size ${size}`);

  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.d2 / 2);
  finishSketch(part);
  await extrude(part, c.h);

  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.d1 / 2);
  finishSketch(part);
  await cut(part, c.h + 2);

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// ASME B18.2.1 — Hex Cap Screw (imperial, UNC)
// Same build sequence as ISO 4014, dimensions converted from inches.
// ─────────────────────────────────────────────────────────────────────────
export async function asmeB18_2_1(part, { sizeKey, length_in }) {
  const c = ASME_B18_2_1[sizeKey];
  if (!c) throw new Error(`ASME B18.2.1: unknown size ${sizeKey}`);
  if (!(length_in > 0)) throw new Error(`ASME B18.2.1: length_in must be > 0 (got ${length_in})`);

  const D_mm = c.D * INCH_TO_MM;
  const F_mm = c.F * INCH_TO_MM;
  const H_mm = c.H * INCH_TO_MM;
  const len_mm = length_in * INCH_TO_MM;

  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, D_mm / 2);
  finishSketch(part);
  await extrude(part, len_mm);

  await startSketch(part, 'top');
  sketchPolygon(part, 0, 0, hexFlatsToCircumR(F_mm), 6);
  finishSketch(part);
  await extrude(part, H_mm);

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// ASME B18.3 — Socket Head Cap Screw (imperial)
// Same build sequence as ISO 4762, dimensions converted from inches.
// Records 6 features.
// ─────────────────────────────────────────────────────────────────────────
export async function asmeB18_3(part, { sizeKey, length_in }) {
  const c = ASME_B18_3[sizeKey];
  if (!c) throw new Error(`ASME B18.3: unknown size ${sizeKey}`);
  if (!(length_in > 0)) throw new Error(`ASME B18.3: length_in must be > 0 (got ${length_in})`);

  const D_mm = c.D * INCH_TO_MM;
  const A_mm = c.A * INCH_TO_MM;
  const H_mm = c.H * INCH_TO_MM;
  const S_mm = c.S * INCH_TO_MM;
  const T_mm = c.T * INCH_TO_MM;
  const len_mm = length_in * INCH_TO_MM;

  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, D_mm / 2);
  finishSketch(part);
  await extrude(part, len_mm);

  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, A_mm / 2);
  finishSketch(part);
  await extrude(part, H_mm);

  await startSketch(part, 'top');
  sketchPolygon(part, 0, 0, hexFlatsToCircumR(S_mm), 6);
  finishSketch(part);
  await cut(part, T_mm);

  return part;
}
