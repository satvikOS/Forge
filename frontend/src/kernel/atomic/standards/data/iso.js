/**
 * ArchDisc Kernel — ISO metric fastener catalog.
 *
 * Pure-data dimension tables for the ISO fastener standards exercised by the
 * SP-1 Falcon 9 octaweb e2e. Every value is the nominal-spec dimension from
 * the published ISO standard; no synthetic values.
 *
 * Standards covered:
 *   ISO 4762 — Hex socket head cap screws (SHCS / Allen)
 *   ISO 4014 — Hex-head bolts, partial thread
 *   ISO 4017 — Hex-head bolts, full thread (≡ DIN 933 dimensionally)
 *   ISO 4032 — Hex nuts, type 1 (≡ DIN 934)
 *   ISO 7089 — Plain washers, normal series (≡ DIN 125)
 *   ISO 7090 — Spring lock washers (≡ DIN 127)
 *   ISO 273  — Clearance holes for bolts (close / medium / coarse)
 *
 * Dimensions are millimetres unless suffixed. Thread pitch is coarse-thread
 * (ISO 261). Grades follow ISO 898-1.
 */

// ISO 4762 socket head cap screw — head + socket dimensions per size.
//   D    nominal thread diameter (mm)
//   P    coarse-thread pitch (mm)
//   dk   head outside diameter (mm)
//   k    head height (mm)
//   s    hex-socket across-flats (mm)
//   tk   hex-socket engagement depth (mm)
//   minor minor (root) thread diameter d3 (mm) — for visual modelling
export const ISO_4762 = {
  M3:  { D: 3,  P: 0.5,  dk: 5.5,  k: 3,    s: 2.5, tk: 1.3,  minor: 2.39  },
  M4:  { D: 4,  P: 0.7,  dk: 7,    k: 4,    s: 3,   tk: 2.0,  minor: 3.14  },
  M5:  { D: 5,  P: 0.8,  dk: 8.5,  k: 5,    s: 4,   tk: 2.5,  minor: 4.02  },
  M6:  { D: 6,  P: 1.0,  dk: 10,   k: 6,    s: 5,   tk: 3.0,  minor: 4.77  },
  M8:  { D: 8,  P: 1.25, dk: 13,   k: 8,    s: 6,   tk: 4.0,  minor: 6.47  },
  M10: { D: 10, P: 1.5,  dk: 16,   k: 10,   s: 8,   tk: 5.0,  minor: 8.16  },
  M12: { D: 12, P: 1.75, dk: 18,   k: 12,   s: 10,  tk: 6.0,  minor: 9.85  },
  M14: { D: 14, P: 2.0,  dk: 21,   k: 14,   s: 12,  tk: 7.0,  minor: 11.55 },
  M16: { D: 16, P: 2.0,  dk: 24,   k: 16,   s: 14,  tk: 8.0,  minor: 13.55 },
  M20: { D: 20, P: 2.5,  dk: 30,   k: 20,   s: 17,  tk: 10.0, minor: 16.93 },
  M24: { D: 24, P: 3.0,  dk: 36,   k: 24,   s: 19,  tk: 12.0, minor: 20.32 },
  M30: { D: 30, P: 3.5,  dk: 45,   k: 30,   s: 22,  tk: 15.5, minor: 25.71 },
};

// ISO 4014 hex bolt, partial thread.
//   k    head height (across the bolt axis)
//   s    head across-flats (wrench size)
//   e    head across-corners (circumscribed dia)
//   minThreadLength varies with grip; modelled as length - (length/3) for now
export const ISO_4014 = {
  M3:  { D: 3,  P: 0.5,  k: 2,    s: 5.5, e: 6.01  },
  M4:  { D: 4,  P: 0.7,  k: 2.8,  s: 7,   e: 7.66  },
  M5:  { D: 5,  P: 0.8,  k: 3.5,  s: 8,   e: 8.79  },
  M6:  { D: 6,  P: 1.0,  k: 4,    s: 10,  e: 11.05 },
  M8:  { D: 8,  P: 1.25, k: 5.3,  s: 13,  e: 14.38 },
  M10: { D: 10, P: 1.5,  k: 6.4,  s: 16,  e: 17.77 },
  M12: { D: 12, P: 1.75, k: 7.5,  s: 18,  e: 20.03 },
  M14: { D: 14, P: 2.0,  k: 8.8,  s: 21,  e: 23.36 },
  M16: { D: 16, P: 2.0,  k: 10,   s: 24,  e: 26.75 },
  M20: { D: 20, P: 2.5,  k: 12.5, s: 30,  e: 33.53 },
  M24: { D: 24, P: 3.0,  k: 15,   s: 36,  e: 39.98 },
  M30: { D: 30, P: 3.5,  k: 18.7, s: 46,  e: 51.28 },
};

// ISO 4017 hex bolt, full thread (≡ DIN 933 dimensions).
// Head dimensions match ISO 4014; only thread-coverage rule differs (full
// shank threaded). The builder uses the same head profile.
export const ISO_4017 = { ...ISO_4014 };

// ISO 4032 hex nut, type 1.
//   s    across-flats (wrench size)
//   e    across-corners
//   m    nut height (mm)
export const ISO_4032 = {
  M3:  { D: 3,  s: 5.5, e: 6.01,  m: 2.4  },
  M4:  { D: 4,  s: 7,   e: 7.66,  m: 3.2  },
  M5:  { D: 5,  s: 8,   e: 8.79,  m: 4.7  },
  M6:  { D: 6,  s: 10,  e: 11.05, m: 5.2  },
  M8:  { D: 8,  s: 13,  e: 14.38, m: 6.8  },
  M10: { D: 10, s: 16,  e: 17.77, m: 8.4  },
  M12: { D: 12, s: 18,  e: 20.03, m: 10.8 },
  M14: { D: 14, s: 21,  e: 23.36, m: 12.8 },
  M16: { D: 16, s: 24,  e: 26.75, m: 14.8 },
  M20: { D: 20, s: 30,  e: 33.53, m: 18.0 },
  M24: { D: 24, s: 36,  e: 39.98, m: 21.5 },
  M30: { D: 30, s: 46,  e: 51.28, m: 25.6 },
};

// ISO 7089 plain washer, normal series.
//   d1   inner diameter (clearance hole)
//   d2   outer diameter
//   h    thickness
export const ISO_7089 = {
  M3:  { D: 3,  d1: 3.2,  d2: 7,   h: 0.5 },
  M4:  { D: 4,  d1: 4.3,  d2: 9,   h: 0.8 },
  M5:  { D: 5,  d1: 5.3,  d2: 10,  h: 1.0 },
  M6:  { D: 6,  d1: 6.4,  d2: 12,  h: 1.6 },
  M8:  { D: 8,  d1: 8.4,  d2: 16,  h: 1.6 },
  M10: { D: 10, d1: 10.5, d2: 20,  h: 2.0 },
  M12: { D: 12, d1: 13,   d2: 24,  h: 2.5 },
  M14: { D: 14, d1: 15,   d2: 28,  h: 2.5 },
  M16: { D: 16, d1: 17,   d2: 30,  h: 3.0 },
  M20: { D: 20, d1: 21,   d2: 37,  h: 3.0 },
  M24: { D: 24, d1: 25,   d2: 44,  h: 4.0 },
  M30: { D: 30, d1: 31,   d2: 56,  h: 4.0 },
};

// ISO 7090 spring lock washer (split-ring helical).
//   d1   inner diameter
//   d2   outer diameter
//   h    free height (the split makes this slightly larger than the ring
//        thickness)
//   t    ring thickness (cross-section square side)
export const ISO_7090 = {
  M3:  { D: 3,  d1: 3.1,  d2: 6.2,  h: 0.8, t: 0.8 },
  M4:  { D: 4,  d1: 4.1,  d2: 7.6,  h: 0.9, t: 0.9 },
  M5:  { D: 5,  d1: 5.1,  d2: 8.7,  h: 1.2, t: 1.0 },
  M6:  { D: 6,  d1: 6.1,  d2: 11.8, h: 1.6, t: 1.6 },
  M8:  { D: 8,  d1: 8.1,  d2: 14.8, h: 2.0, t: 2.0 },
  M10: { D: 10, d1: 10.2, d2: 18.1, h: 2.2, t: 2.2 },
  M12: { D: 12, d1: 12.2, d2: 21.1, h: 2.5, t: 2.5 },
  M14: { D: 14, d1: 14.2, d2: 24.1, h: 3.0, t: 3.0 },
  M16: { D: 16, d1: 16.2, d2: 27.4, h: 3.5, t: 3.5 },
  M20: { D: 20, d1: 20.2, d2: 33.6, h: 4.0, t: 4.0 },
  M24: { D: 24, d1: 24.5, d2: 40,   h: 5.0, t: 5.0 },
  M30: { D: 30, d1: 30.5, d2: 48,   h: 6.0, t: 6.0 },
};

// ISO 273 clearance holes for bolt sizes.
//   close   close fit (tight assembly)
//   medium  medium fit (general assembly)
//   coarse  coarse fit (where alignment is approximate)
export const ISO_273 = {
  M3:  { D: 3,  close: 3.2,  medium: 3.4,  coarse: 3.6  },
  M4:  { D: 4,  close: 4.3,  medium: 4.5,  coarse: 4.8  },
  M5:  { D: 5,  close: 5.3,  medium: 5.5,  coarse: 5.8  },
  M6:  { D: 6,  close: 6.4,  medium: 6.6,  coarse: 7.0  },
  M8:  { D: 8,  close: 8.4,  medium: 9.0,  coarse: 10.0 },
  M10: { D: 10, close: 10.5, medium: 11.0, coarse: 12.0 },
  M12: { D: 12, close: 13.0, medium: 13.5, coarse: 14.5 },
  M14: { D: 14, close: 15.0, medium: 15.5, coarse: 16.5 },
  M16: { D: 16, close: 17.0, medium: 17.5, coarse: 18.5 },
  M20: { D: 20, close: 21.0, medium: 22.0, coarse: 24.0 },
  M24: { D: 24, close: 25.0, medium: 26.0, coarse: 28.0 },
  M30: { D: 30, close: 31.0, medium: 33.0, coarse: 35.0 },
};

// ISO 898-1 mechanical-property classes for carbon-steel bolts (proof
// strength S_p, yield S_y, ultimate S_ut — MPa).
export const ISO_898_GRADES = {
  '4.6':  { Sp: 225, Sy: 240,  Sut: 400  },
  '4.8':  { Sp: 310, Sy: 340,  Sut: 420  },
  '5.8':  { Sp: 380, Sy: 420,  Sut: 520  },
  '8.8':  { Sp: 600, Sy: 660,  Sut: 830  },
  '10.9': { Sp: 830, Sy: 940,  Sut: 1040 },
  '12.9': { Sp: 970, Sy: 1100, Sut: 1220 },
};

export const ISO_SIZES = Object.keys(ISO_4762);
