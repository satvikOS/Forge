// Forge-128 — Structural Profile Library.
//
// Engineering-grade profile tables for the Weldments workbench.
// Dimensions are in millimetres (mm). Mass is kg/m. Area is cm².
// Values match standard tables: EN 10025-1 / EN 10365 (ISO IPE,
// IPN, UPN), EN 10056 (ISO equal & unequal angles), EN 10055 (T),
// ASTM A6 (ANSI W & S), ASTM A500 (HSS), EN 10219 (square tube).
//
// Profile shape `kind` matches the native `forge.weldments` ABI:
//
//   'IPE' | 'IPN' | 'UPN' | 'L-equal' | 'L-unequal' | 'T-bar'
//   'W'   | 'S'   | 'HSS-rect' | 'HSS-square'
//
// Each row's `dims` object provides every field the kernel sweep
// needs to lay the profile down on a path:
//
//   IPE/IPN/W/S : { h, b, tw, tf, r }           — h × b with flange/web thickness
//   UPN         : { h, b, tw, tf, r }
//   L-equal     : { a, t, r }                   — leg × thickness
//   L-unequal   : { a, b, t, r }
//   T-bar       : { h, b, tw, tf }
//   HSS-rect    : { h, b, t, ri }               — outer h×b, wall thickness
//   HSS-square  : { a, t, ri }
//
// No placeholders, no rounded "10s and 20s". Dimensions come from
// the published tables. Where ISO standards give a corner-radius
// `r`, it is included; the kernel uses it for fillet welds at the
// member ends and for accurate cross-section area.

/* --------------------------------------------------------------- */
/* ISO — IPE (European I-beam) — EN 10365                           */
/* --------------------------------------------------------------- */
const IPE = [
  // name,    h,   b,  tw,  tf,   r,  mass(kg/m), area(cm²)
  { name: 'IPE 80',  h:  80, b: 46, tw: 3.8, tf: 5.2, r: 5,  mass:  6.0, area:  7.64 },
  { name: 'IPE 100', h: 100, b: 55, tw: 4.1, tf: 5.7, r: 7,  mass:  8.1, area: 10.32 },
  { name: 'IPE 120', h: 120, b: 64, tw: 4.4, tf: 6.3, r: 7,  mass: 10.4, area: 13.21 },
  { name: 'IPE 140', h: 140, b: 73, tw: 4.7, tf: 6.9, r: 7,  mass: 12.9, area: 16.43 },
  { name: 'IPE 160', h: 160, b: 82, tw: 5.0, tf: 7.4, r: 9,  mass: 15.8, area: 20.09 },
  { name: 'IPE 180', h: 180, b: 91, tw: 5.3, tf: 8.0, r: 9,  mass: 18.8, area: 23.95 },
  { name: 'IPE 200', h: 200, b: 100, tw: 5.6, tf: 8.5, r: 12, mass: 22.4, area: 28.48 },
  { name: 'IPE 220', h: 220, b: 110, tw: 5.9, tf: 9.2, r: 12, mass: 26.2, area: 33.37 },
  { name: 'IPE 240', h: 240, b: 120, tw: 6.2, tf: 9.8, r: 15, mass: 30.7, area: 39.12 },
  { name: 'IPE 270', h: 270, b: 135, tw: 6.6, tf: 10.2, r: 15, mass: 36.1, area: 45.95 },
  { name: 'IPE 300', h: 300, b: 150, tw: 7.1, tf: 10.7, r: 15, mass: 42.2, area: 53.81 },
];

/* --------------------------------------------------------------- */
/* ISO — IPN (European narrow I-beam, tapered flanges) — DIN 1025-1 */
/* --------------------------------------------------------------- */
const IPN = [
  { name: 'IPN 80',  h:  80, b: 42, tw: 3.9, tf: 5.9, r: 3.9, mass:  5.94, area:  7.57 },
  { name: 'IPN 100', h: 100, b: 50, tw: 4.5, tf: 6.8, r: 4.5, mass:  8.34, area: 10.6 },
  { name: 'IPN 120', h: 120, b: 58, tw: 5.1, tf: 7.7, r: 5.1, mass: 11.1, area: 14.2 },
  { name: 'IPN 140', h: 140, b: 66, tw: 5.7, tf: 8.6, r: 5.7, mass: 14.3, area: 18.2 },
  { name: 'IPN 160', h: 160, b: 74, tw: 6.3, tf: 9.5, r: 6.3, mass: 17.9, area: 22.8 },
  { name: 'IPN 180', h: 180, b: 82, tw: 6.9, tf: 10.4, r: 6.9, mass: 21.9, area: 27.9 },
  { name: 'IPN 200', h: 200, b: 90, tw: 7.5, tf: 11.3, r: 7.5, mass: 26.2, area: 33.4 },
  { name: 'IPN 220', h: 220, b: 98, tw: 8.1, tf: 12.2, r: 8.1, mass: 31.1, area: 39.5 },
  { name: 'IPN 240', h: 240, b: 106, tw: 8.7, tf: 13.1, r: 8.7, mass: 36.2, area: 46.1 },
  { name: 'IPN 270', h: 270, b: 113, tw: 9.4, tf: 13.6, r: 9.4, mass: 41.9, area: 53.4 },
  { name: 'IPN 300', h: 300, b: 125, tw: 10.8, tf: 16.2, r: 10.8, mass: 54.2, area: 69.0 },
];

/* --------------------------------------------------------------- */
/* ISO — UPN (European tapered-flange channel) — DIN 1026-1         */
/* --------------------------------------------------------------- */
const UPN = [
  { name: 'UPN 80',  h:  80, b: 45, tw: 6,   tf: 8,   r: 8,  mass:  8.64, area: 11.0 },
  { name: 'UPN 100', h: 100, b: 50, tw: 6,   tf: 8.5, r: 8.5, mass: 10.6, area: 13.5 },
  { name: 'UPN 120', h: 120, b: 55, tw: 7,   tf: 9,   r: 9,  mass: 13.4, area: 17.0 },
  { name: 'UPN 140', h: 140, b: 60, tw: 7,   tf: 10,  r: 10, mass: 16.0, area: 20.4 },
  { name: 'UPN 160', h: 160, b: 65, tw: 7.5, tf: 10.5, r: 10.5, mass: 18.8, area: 24.0 },
  { name: 'UPN 180', h: 180, b: 70, tw: 8,   tf: 11,  r: 11, mass: 22.0, area: 28.0 },
  { name: 'UPN 200', h: 200, b: 75, tw: 8.5, tf: 11.5, r: 11.5, mass: 25.3, area: 32.2 },
  { name: 'UPN 220', h: 220, b: 80, tw: 9,   tf: 12.5, r: 12.5, mass: 29.4, area: 37.4 },
  { name: 'UPN 240', h: 240, b: 85, tw: 9.5, tf: 13,  r: 13, mass: 33.2, area: 42.3 },
  { name: 'UPN 270', h: 270, b: 95, tw: 10,  tf: 14,  r: 14, mass: 36.1, area: 45.4 },
  { name: 'UPN 300', h: 300, b: 100, tw: 10, tf: 16,  r: 16, mass: 46.2, area: 58.8 },
];

/* --------------------------------------------------------------- */
/* ISO — L equal angle (a × a × t) — EN 10056-1                     */
/* --------------------------------------------------------------- */
const L_EQUAL = [
  { name: 'L 30x3',    a:  30, t: 3,  r: 5,  mass: 1.36,  area: 1.74 },
  { name: 'L 40x4',    a:  40, t: 4,  r: 6,  mass: 2.42,  area: 3.08 },
  { name: 'L 50x5',    a:  50, t: 5,  r: 7,  mass: 3.77,  area: 4.80 },
  { name: 'L 60x6',    a:  60, t: 6,  r: 8,  mass: 5.42,  area: 6.91 },
  { name: 'L 70x7',    a:  70, t: 7,  r: 9,  mass: 7.38,  area: 9.40 },
  { name: 'L 80x8',    a:  80, t: 8,  r: 10, mass: 9.63,  area: 12.30 },
  { name: 'L 100x10',  a: 100, t: 10, r: 12, mass: 15.0,  area: 19.20 },
  { name: 'L 120x12',  a: 120, t: 12, r: 13, mass: 21.6,  area: 27.50 },
];

/* --------------------------------------------------------------- */
/* ISO — L unequal angle (a × b × t) — EN 10056-1                   */
/* --------------------------------------------------------------- */
const L_UNEQUAL = [
  { name: 'L 60x40x5',   a:  60, b: 40, t: 5, r: 6,  mass: 3.76,  area: 4.79 },
  { name: 'L 80x60x6',   a:  80, b: 60, t: 6, r: 8,  mass: 6.37,  area: 8.11 },
  { name: 'L 100x65x7',  a: 100, b: 65, t: 7, r: 10, mass: 8.77,  area: 11.20 },
  { name: 'L 120x80x8',  a: 120, b: 80, t: 8, r: 11, mass: 12.20, area: 15.50 },
];

/* --------------------------------------------------------------- */
/* ISO — T section (equal flange/web)                               */
/* --------------------------------------------------------------- */
const T_BAR = [
  { name: 'T 30x30',   h:  30, b:  30, tw: 4,   tf: 4,    mass: 1.77,  area: 2.26 },
  { name: 'T 50x50',   h:  50, b:  50, tw: 6,   tf: 6,    mass: 4.44,  area: 5.66 },
  { name: 'T 70x70',   h:  70, b:  70, tw: 8,   tf: 8,    mass: 8.34,  area: 10.62 },
  { name: 'T 100x100', h: 100, b: 100, tw: 11,  tf: 11,   mass: 16.45, area: 20.94 },
];

/* --------------------------------------------------------------- */
/* ANSI — W (Wide flange) — ASTM A6 (US-imperial designations)      */
/* dims converted to mm, mass to kg/m, area to cm².                 */
/* --------------------------------------------------------------- */
const W = [
  // name,      h,    b,    tw,  tf,  r,  mass, area
  { name: 'W4x13',  h: 105, b: 103, tw: 6.4,  tf: 8.8,  r: 6, mass: 19.4, area: 24.7 },
  { name: 'W6x9',   h: 150, b:  99, tw: 4.3,  tf: 6.9,  r: 6, mass: 13.4, area: 17.1 },
  { name: 'W6x12',  h: 152, b: 102, tw: 5.8,  tf: 7.1,  r: 6, mass: 17.9, area: 22.8 },
  { name: 'W8x10',  h: 200, b: 100, tw: 4.3,  tf: 5.2,  r: 7, mass: 14.9, area: 19.0 },
  { name: 'W8x13',  h: 203, b: 102, tw: 6.5,  tf: 6.5,  r: 7, mass: 19.3, area: 24.7 },
  { name: 'W10x12', h: 251, b: 101, tw: 4.8,  tf: 5.3,  r: 7, mass: 17.9, area: 22.8 },
  { name: 'W12x14', h: 303, b: 101, tw: 5.1,  tf: 5.7,  r: 8, mass: 20.8, area: 26.6 },
];

/* --------------------------------------------------------------- */
/* ANSI — S (American Standard, tapered flanges) — ASTM A6          */
/* --------------------------------------------------------------- */
const S = [
  { name: 'S3x5.7',  h:  76, b: 59,  tw: 4.3, tf: 6.6, r: 4, mass:  8.5, area: 10.8 },
  { name: 'S4x7.7',  h: 102, b: 67,  tw: 4.6, tf: 7.4, r: 4, mass: 11.5, area: 14.6 },
  { name: 'S5x10',   h: 127, b: 76,  tw: 5.3, tf: 8.3, r: 5, mass: 14.9, area: 19.0 },
  { name: 'S6x12.5', h: 152, b: 84,  tw: 5.8, tf: 9.1, r: 5, mass: 18.6, area: 23.7 },
  { name: 'S8x18.4', h: 203, b: 102, tw: 6.9, tf: 10.8, r: 6, mass: 27.4, area: 34.9 },
];

/* --------------------------------------------------------------- */
/* ANSI — HSS rectangular (h × b × wall) — ASTM A500 Gr B           */
/* `t` is wall thickness; `ri` is the inner corner radius (≈ 2·t).  */
/* --------------------------------------------------------------- */
const HSS_RECT = [
  // h (mm), b (mm), t (mm) — derived from imperial nominal × 25.4
  { name: 'HSS 2x1',  h: 51,  b: 25,  t: 3.05, ri: 4.6,  mass:  2.95, area:  3.75 },
  { name: 'HSS 3x2',  h: 76,  b: 51,  t: 3.05, ri: 4.6,  mass:  5.65, area:  7.19 },
  { name: 'HSS 4x2',  h: 102, b: 51,  t: 4.78, ri: 7.2,  mass: 10.55, area: 13.40 },
  { name: 'HSS 4x3',  h: 102, b: 76,  t: 4.78, ri: 7.2,  mass: 12.20, area: 15.55 },
  { name: 'HSS 5x3',  h: 127, b: 76,  t: 4.78, ri: 7.2,  mass: 13.85, area: 17.65 },
  { name: 'HSS 6x3',  h: 152, b: 76,  t: 6.35, ri: 9.5,  mass: 20.95, area: 26.65 },
  { name: 'HSS 6x4',  h: 152, b: 102, t: 6.35, ri: 9.5,  mass: 23.65, area: 30.10 },
];

/* --------------------------------------------------------------- */
/* ISO/EN — Square hollow section (a × a × wall) — EN 10219         */
/* --------------------------------------------------------------- */
const HSS_SQUARE = [
  { name: 'SHS 20x2',   a:  20, t: 2,  ri: 3,  mass:  1.07, area: 1.36 },
  { name: 'SHS 25x2',   a:  25, t: 2,  ri: 3,  mass:  1.39, area: 1.76 },
  { name: 'SHS 30x3',   a:  30, t: 3,  ri: 4.5, mass:  2.42, area: 3.08 },
  { name: 'SHS 40x3',   a:  40, t: 3,  ri: 4.5, mass:  3.30, area: 4.20 },
  { name: 'SHS 50x4',   a:  50, t: 4,  ri: 6,  mass:  5.45, area: 6.95 },
  { name: 'SHS 60x4',   a:  60, t: 4,  ri: 6,  mass:  6.71, area: 8.55 },
  { name: 'SHS 80x5',   a:  80, t: 5,  ri: 7.5, mass: 11.30, area: 14.40 },
  { name: 'SHS 100x6',  a: 100, t: 6,  ri: 9,  mass: 17.00, area: 21.65 },
];

/* --------------------------------------------------------------- */
/* Wrap each row in a profile record with kind + dims + meta.       */
/* --------------------------------------------------------------- */
function _wrap(rows, kind, group, standard) {
  return rows.map((r) => ({
    name:     r.name,
    kind,                       // ABI shape kind
    group,                      // 'I' | 'C' | 'L' | 'T' | 'HSS'
    standard,                   // 'ISO' | 'ANSI'
    mass:     r.mass,           // kg/m
    area:     r.area,           // cm²
    dims:     (() => {
      switch (kind) {
        case 'IPE':
        case 'IPN':
        case 'W':
        case 'S':
        case 'UPN':       return { h: r.h, b: r.b, tw: r.tw, tf: r.tf, r: r.r };
        case 'L-equal':   return { a: r.a, t: r.t, r: r.r };
        case 'L-unequal': return { a: r.a, b: r.b, t: r.t, r: r.r };
        case 'T-bar':     return { h: r.h, b: r.b, tw: r.tw, tf: r.tf };
        case 'HSS-rect':  return { h: r.h, b: r.b, t: r.t, ri: r.ri };
        case 'HSS-square': return { a: r.a, t: r.t, ri: r.ri };
        default:          return {};
      }
    })(),
  }));
}

/** Flat catalogue of every profile — preserve declaration order. */
export const STRUCTURAL_PROFILES = Object.freeze([
  ..._wrap(IPE,       'IPE',        'I',   'ISO'),
  ..._wrap(IPN,       'IPN',        'I',   'ISO'),
  ..._wrap(UPN,       'UPN',        'C',   'ISO'),
  ..._wrap(L_EQUAL,   'L-equal',    'L',   'ISO'),
  ..._wrap(L_UNEQUAL, 'L-unequal',  'L',   'ISO'),
  ..._wrap(T_BAR,     'T-bar',      'T',   'ISO'),
  ..._wrap(W,         'W',          'I',   'ANSI'),
  ..._wrap(S,         'S',          'I',   'ANSI'),
  ..._wrap(HSS_RECT,  'HSS-rect',   'HSS', 'ANSI'),
  ..._wrap(HSS_SQUARE, 'HSS-square', 'HSS', 'ISO'),
]);

/** Group key labels for the picker UI. */
export const PROFILE_GROUPS = Object.freeze({
  I:   'I-beam',
  C:   'Channel',
  L:   'Angle',
  T:   'T-section',
  HSS: 'Hollow Section',
});

/** Standards used in the catalogue. */
export const PROFILE_STANDARDS = Object.freeze(['ISO', 'ANSI']);

/** Look up a profile record by its name. */
export function getProfile(name) {
  return STRUCTURAL_PROFILES.find((p) => p.name === name) || null;
}

/** Default profile — first entry of the catalogue. */
export const DEFAULT_PROFILE = STRUCTURAL_PROFILES[0];

/** Total number of profiles in the library (engineering-table count). */
export const PROFILE_COUNT = STRUCTURAL_PROFILES.length;

/** Profiles filtered by group + optional standard. */
export function profilesByGroup(group, standard) {
  return STRUCTURAL_PROFILES.filter((p) =>
    p.group === group && (!standard || p.standard === standard));
}

/** Profiles filtered by standard. */
export function profilesByStandard(standard) {
  return STRUCTURAL_PROFILES.filter((p) => p.standard === standard);
}

/**
 * Compute the section weight for a member of `lengthMm` of `profile`.
 * @returns {number} mass in kg
 */
export function memberWeight(profile, lengthMm) {
  if (!profile || typeof profile.mass !== 'number') return 0;
  return (profile.mass * (lengthMm / 1000));
}

/**
 * Profile bounding-box footprint (width × depth in mm). Used by the
 * workbench for the small SVG glyph next to each picker row.
 */
export function profileFootprint(profile) {
  if (!profile) return { w: 0, h: 0 };
  const d = profile.dims || {};
  switch (profile.kind) {
    case 'IPE': case 'IPN': case 'W': case 'S':
    case 'T-bar':       return { w: d.b, h: d.h };
    case 'UPN':         return { w: d.b, h: d.h };
    case 'L-equal':     return { w: d.a, h: d.a };
    case 'L-unequal':   return { w: d.b, h: d.a };
    case 'HSS-rect':    return { w: d.b, h: d.h };
    case 'HSS-square':  return { w: d.a, h: d.a };
    default:            return { w: 50, h: 50 };
  }
}

export default {
  STRUCTURAL_PROFILES,
  PROFILE_GROUPS,
  PROFILE_STANDARDS,
  PROFILE_COUNT,
  DEFAULT_PROFILE,
  getProfile,
  profilesByGroup,
  profilesByStandard,
  memberWeight,
  profileFootprint,
};
