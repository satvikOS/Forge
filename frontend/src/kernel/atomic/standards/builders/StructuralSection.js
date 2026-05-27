/**
 * ArchDisc Kernel — Atomic-CAD structural-section builders.
 *
 * AISC W-shape, L-shape, HSS rectangular tube. Each builder sketches the
 * exact cross-section profile from the published AISC table (inches →
 * millimetres) and extrudes it along the +Z axis.
 *
 * Records 2 features per section (W/L) or 4 features per section (HSS,
 * since hollow tubes need a cut for the inner void).
 *
 * Conventions:
 *   - Section axis = +Z (the long direction).
 *   - W-shape: web aligned with X, flanges horizontal (top + bottom of
 *     bounding box in Y). Centred at origin.
 *   - L-shape: legs along +X and +Y, vertex at origin (NOT centred — so
 *     the placement transform knows where the corner sits).
 *   - HSS: centred at origin.
 */

import {
  startSketch, sketchRectangle, sketchPolyline, finishSketch, extrude, cut,
} from '../../AtomicOps.js';
import {
  AISC_W_SHAPES, AISC_L_SHAPES, AISC_HSS_RECT, INCH_TO_MM,
} from '../data/aisc.js';

// ─────────────────────────────────────────────────────────────────────────
// AISC W-shape — Wide-Flange I-beam
//
// 12-point I-shape profile in XY plane (CCW), extruded along Z.
//
//   Y▲
//    │     ┌─────────────┐   ← top flange (tf thick)
//    │     │             │
//    │     └─┐   tw    ┌─┘
//    │       │  web    │
//    │     ┌─┘         └─┐
//    │     │             │
//    │     └─────────────┘   ← bottom flange
//    └────────────── X
//
//   width = bf (along X)
//   depth = d  (along Y)
// ─────────────────────────────────────────────────────────────────────────
export async function aiscW(part, { sizeKey, length_in }) {
  const c = AISC_W_SHAPES[sizeKey];
  if (!c) throw new Error(`AISC W: unknown ${sizeKey}`);
  if (!(length_in > 0)) throw new Error(`AISC W: length_in must be > 0 (got ${length_in})`);

  const length_mm = length_in * INCH_TO_MM;
  const d  = c.d  * INCH_TO_MM;
  const bf = c.bf * INCH_TO_MM;
  const tw = c.tw * INCH_TO_MM;
  const tf = c.tf * INCH_TO_MM;

  const hx = bf / 2;
  const hy = d / 2;
  const wy = hy - tf;       // inner Y of flange / outer Y of web
  const wx = tw / 2;

  // Start at top-right corner, CCW around the I.
  const profile = [
    [ hx,  hy],
    [-hx,  hy],
    [-hx,  wy],
    [-wx,  wy],
    [-wx, -wy],
    [-hx, -wy],
    [-hx, -hy],
    [ hx, -hy],
    [ hx, -wy],
    [ wx, -wy],
    [ wx,  wy],
    [ hx,  wy],
  ];

  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, length_mm);

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// AISC L-shape — Angle (equal or unequal legs)
//
// 6-point L profile, vertex at origin, legs along +X and +Y.
//
//   Y▲
//    │ ┌──┐
//    │ │  │
//    │ │  │   leg2
//    │ │  └─────────┐
//    │ │            │ t
//    │ └────────────┘
//    └────────── X
//          leg1
// ─────────────────────────────────────────────────────────────────────────
export async function aiscL(part, { sizeKey, length_in }) {
  const c = AISC_L_SHAPES[sizeKey];
  if (!c) throw new Error(`AISC L: unknown ${sizeKey}`);
  if (!(length_in > 0)) throw new Error(`AISC L: length_in must be > 0 (got ${length_in})`);

  const length_mm = length_in * INCH_TO_MM;
  const l1 = c.leg1 * INCH_TO_MM;
  const l2 = c.leg2 * INCH_TO_MM;
  const t  = c.t    * INCH_TO_MM;

  const profile = [
    [0,  0],
    [l1, 0],
    [l1, t],
    [t,  t],
    [t,  l2],
    [0,  l2],
  ];

  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, length_mm);

  return part;
}

// ─────────────────────────────────────────────────────────────────────────
// AISC HSS rectangular — Hollow Structural Section
//
// Outer rectangle (a × b), extruded; inner rectangle (a − 2t × b − 2t)
// cut through.
// ─────────────────────────────────────────────────────────────────────────
export async function aiscHSS(part, { sizeKey, length_in }) {
  const c = AISC_HSS_RECT[sizeKey];
  if (!c) throw new Error(`AISC HSS: unknown ${sizeKey}`);
  if (!(length_in > 0)) throw new Error(`AISC HSS: length_in must be > 0 (got ${length_in})`);

  const length_mm = length_in * INCH_TO_MM;
  const a = c.a * INCH_TO_MM;
  const b = c.b * INCH_TO_MM;
  const t = c.t * INCH_TO_MM;

  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, a, b);
  finishSketch(part);
  await extrude(part, length_mm);

  await startSketch(part, 'top');
  sketchRectangle(part, 0, 0, a - 2 * t, b - 2 * t);
  finishSketch(part);
  await cut(part, length_mm + 2);

  return part;
}
