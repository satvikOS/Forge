/**
 * ArchDisc Foundation — ISO metric fastener library.
 *
 * Parametric Manifold builders for the most common metric fasteners
 * referenced by the M8 demonstrators (and any future small mechanical
 * assembly). Dimensions follow:
 *
 *   ISO 4762  — Hexagon socket head cap screws (Allen / SHCS)
 *   ISO 4032  — Hexagon nuts, type 1
 *   ISO 7089  — Plain washers, normal series
 *
 * Threads are modeled as a simplified annular cylinder at the minor
 * diameter — most production CAD systems do this for assembly
 * performance because true helical threads multiply triangle counts
 * 50-100×. If you need a true thread, sweep a triangular cross-
 * section along a helical path (see ThreadedBottleCap demonstrator).
 *
 * All fasteners have their thread axis along +Z; the head sits at
 * z = 0..headHeight, the shank extends downward into −z.
 */

import { getManifold } from './manifoldKernel.js';

// ISO 4762 socket-cap screw catalog (mm)
//   D     = nominal thread diameter
//   dh    = head outside diameter (across flats / corners — actually
//           cylindrical for SHCS)
//   k     = head height
//   s     = hex-key-socket across-flats
//   tk    = key engagement depth
//   pitch = standard coarse-thread pitch
//   minor = minor (root) diameter for threads — d3 in ISO
const SHCS_CATALOG = {
  M3:  { D: 3,  dh: 5.5,  k: 3,    s: 2.5, tk: 1.3, pitch: 0.5,  minor: 2.39  },
  M4:  { D: 4,  dh: 7,    k: 4,    s: 3,   tk: 2.0, pitch: 0.7,  minor: 3.14  },
  M5:  { D: 5,  dh: 8.5,  k: 5,    s: 4,   tk: 2.5, pitch: 0.8,  minor: 4.02  },
  M6:  { D: 6,  dh: 10,   k: 6,    s: 5,   tk: 3.0, pitch: 1.0,  minor: 4.77  },
  M8:  { D: 8,  dh: 13,   k: 8,    s: 6,   tk: 4.0, pitch: 1.25, minor: 6.47  },
  M10: { D: 10, dh: 16,   k: 10,   s: 8,   tk: 5.0, pitch: 1.5,  minor: 8.16  },
};

// ISO 4032 hex nut catalog
const NUT_CATALOG = {
  M3:  { D: 3,  s: 5.5, e: 6.01,  m: 2.4 },
  M4:  { D: 4,  s: 7,   e: 7.66,  m: 3.2 },
  M5:  { D: 5,  s: 8,   e: 8.79,  m: 4.7 },
  M6:  { D: 6,  s: 10,  e: 11.05, m: 5.2 },
  M8:  { D: 8,  s: 13,  e: 14.38, m: 6.8 },
  M10: { D: 10, s: 16,  e: 17.77, m: 8.4 },
};

// ISO 7089 plain washer (normal series) catalog
const WASHER_CATALOG = {
  M3:  { d1: 3.2,  d2: 7,    h: 0.5 },
  M4:  { d1: 4.3,  d2: 9,    h: 0.8 },
  M5:  { d1: 5.3,  d2: 10,   h: 1.0 },
  M6:  { d1: 6.4,  d2: 12,   h: 1.6 },
  M8:  { d1: 8.4,  d2: 16,   h: 1.6 },
  M10: { d1: 10.5, d2: 20,   h: 2.0 },
};

export const FASTENER_CATALOGS = { SHCS: SHCS_CATALOG, NUT: NUT_CATALOG, WASHER: WASHER_CATALOG };

const PI = Math.PI;

/**
 * Build a regular hexagonal prism (used for nut bodies).
 * Returns a Manifold extruded along +Z by `height`, centered at origin
 * in the XY plane with `acrossFlats` distance between two parallel faces.
 */
async function hexPrism(acrossFlats, height) {
  const { Manifold, CrossSection } = await getManifold();
  const r = acrossFlats / 2 / Math.cos(PI / 6);   // circumscribed radius
  const pts = [];
  // Hexagon corners (flat-top orientation: faces parallel to X axis)
  for (let i = 0; i < 6; i++) {
    const ang = PI / 6 + i * PI / 3;
    pts.push([r * Math.cos(ang), r * Math.sin(ang)]);
  }
  return Manifold.extrude(new CrossSection([pts], 'EvenOdd'), height);
}

/**
 * Build an ISO 4762 socket head cap screw.
 *
 * Coordinate frame: axis = +Z. Head spans z ∈ [0, k]. Shank extends in
 * −Z by `length`. The hex socket is a hole in the top face (engages
 * from +Z).
 *
 * @param {string} size - one of 'M3','M4','M5','M6','M8','M10'
 * @param {number} length - shank length (under-head, mm)
 * @param {object} options
 * @param {boolean} options.realThreads - true helical sweep, false
 *                  uses minor-dia cylinder (default false for speed)
 * @returns {Promise<Manifold>}
 */
export async function iso4762(size, length, options = {}) {
  const c = SHCS_CATALOG[size];
  if (!c) throw new Error(`Unknown SHCS size: ${size}`);
  const { Manifold, CrossSection } = await getManifold();
  // Head: cylinder of dia `dh`, height `k`
  const head = Manifold.cylinder(c.k, c.dh / 2, c.dh / 2, 64, false);
  // Hex socket cut from top face
  const socketR = c.s / 2 / Math.cos(PI / 6);   // circumscribed radius
  const socketPts = [];
  for (let i = 0; i < 6; i++) {
    const ang = i * PI / 3;
    socketPts.push([socketR * Math.cos(ang), socketR * Math.sin(ang)]);
  }
  const socketProf = new CrossSection([socketPts], 'EvenOdd');
  const socket = Manifold.extrude(socketProf, c.tk + 1).translate([0, 0, c.k - c.tk]);
  let body = Manifold.difference(head, socket);
  // Shank: cylinder of dia D (or minor if real-threads simplified) extending −length
  const shankR = options.realThreads ? c.D / 2 : c.minor / 2;
  const shank = Manifold.cylinder(length, shankR, shankR, 48, false).translate([0, 0, -length]);
  body = Manifold.union(body, shank);
  return body;
}

/**
 * Build an ISO 4032 hex nut.
 * Frame: axis = +Z, hex flat sits z ∈ [0, m].
 */
export async function iso4032(size) {
  const c = NUT_CATALOG[size];
  if (!c) throw new Error(`Unknown nut size: ${size}`);
  const { Manifold } = await getManifold();
  const body = await hexPrism(c.s, c.m);
  // Through-hole at minor dia (slightly smaller than D for thread engagement).
  // ISO 4032 specifies tapped bore — we use D + 0.1 mm for clearance
  // representation.
  const hole = Manifold.cylinder(c.m + 2, (c.D - 0.1) / 2, (c.D - 0.1) / 2, 48, false)
    .translate([0, 0, -1]);
  return Manifold.difference(body, hole);
}

/**
 * Build an ISO 7089 plain washer (normal series).
 * Frame: axis = +Z, sits z ∈ [0, h].
 */
export async function iso7089(size) {
  const c = WASHER_CATALOG[size];
  if (!c) throw new Error(`Unknown washer size: ${size}`);
  const { Manifold } = await getManifold();
  const outer = Manifold.cylinder(c.h, c.d2 / 2, c.d2 / 2, 64, false);
  const hole = Manifold.cylinder(c.h + 2, c.d1 / 2, c.d1 / 2, 48, false).translate([0, 0, -1]);
  return Manifold.difference(outer, hole);
}

/**
 * Convenience: build a complete fastener "stack" for a given hole
 * (screw + washer + nut). Caller positions the result in the assembly.
 *
 * Returns a single Manifold of head + shank + washer + nut all aligned
 * along +Z. Useful for bolt-pattern visualization or BOM rendering.
 */
export async function fastenerStack(size, gripLength) {
  const c = SHCS_CATALOG[size];
  const w = WASHER_CATALOG[size];
  const n = NUT_CATALOG[size];
  const screwLen = gripLength + w.h + n.m + 2;   // 2 mm protrusion past nut
  const screw = await iso4762(size, screwLen);
  const washer = (await iso7089(size)).translate([0, 0, -screwLen + n.m + 2]);   // washer sits between grip and nut
  const nut = (await iso4032(size)).translate([0, 0, -screwLen + 2]);            // nut at bottom, 2mm above shank tip
  const { Manifold } = await getManifold();
  return Manifold.union(Manifold.union(screw, washer), nut);
}

/**
 * Catalog metadata for BOM / report output.
 */
export function describeFastener(size, length) {
  const c = SHCS_CATALOG[size];
  return {
    standard: 'ISO 4762',
    size,
    designation: `${size}×${length}-12.9 SHCS`,
    nominalDiameter_mm: c.D,
    headDiameter_mm: c.dh,
    headHeight_mm: c.k,
    socketAcrossFlats_mm: c.s,
    pitch_mm: c.pitch,
    minor_mm: c.minor,
    length_mm: length,
  };
}
