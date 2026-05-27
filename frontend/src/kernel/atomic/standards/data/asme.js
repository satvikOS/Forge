/**
 * ArchDisc Kernel — ASME imperial fastener catalog.
 *
 * Pure-data dimension tables for the ASME B18 series used by the SP-1
 * Falcon 9 octaweb e2e (Falcon 9 is American-spec → ASME hardware).
 *
 * Standards covered:
 *   ASME B18.2.1 — Hex cap screws (1/4" through 1") — UNC + UNF threads
 *   ASME B18.3   — Hex socket head cap screws (1/4" through 1")
 *   ASME B18.21.1 (companion, future session) — lock washers
 *
 * All dimensions are inches unless suffixed. UNC = Unified Coarse Thread
 * per ASME B1.1.
 */

// ASME B18.2.1 hex cap screw — body + head per published table.
//   D    nominal thread diameter (in)
//   TPI  threads per inch (UNC)
//   F    head across-flats (wrench width, in)
//   G    head across-corners (circumscribed dia, in)
//   H    head height (in)
export const ASME_B18_2_1 = {
  '1/4-20':  { D: 0.250, TPI: 20, F: 0.4375, G: 0.505, H: 0.156 },
  '5/16-18': { D: 0.3125, TPI: 18, F: 0.500,  G: 0.577, H: 0.203 },
  '3/8-16':  { D: 0.375, TPI: 16, F: 0.5625, G: 0.650, H: 0.234 },
  '7/16-14': { D: 0.4375, TPI: 14, F: 0.625, G: 0.722, H: 0.281 },
  '1/2-13':  { D: 0.500, TPI: 13, F: 0.750, G: 0.866, H: 0.313 },
  '9/16-12': { D: 0.5625, TPI: 12, F: 0.8125, G: 0.938, H: 0.359 },
  '5/8-11':  { D: 0.625, TPI: 11, F: 0.9375, G: 1.083, H: 0.391 },
  '3/4-10':  { D: 0.750, TPI: 10, F: 1.125, G: 1.299, H: 0.469 },
  '7/8-9':   { D: 0.875, TPI: 9,  F: 1.3125, G: 1.516, H: 0.578 },
  '1-8':     { D: 1.000, TPI: 8,  F: 1.500, G: 1.732, H: 0.672 },
  '1-1/4-7': { D: 1.250, TPI: 7,  F: 1.875, G: 2.165, H: 0.844 },
  '1-1/2-6': { D: 1.500, TPI: 6,  F: 2.250, G: 2.598, H: 1.000 },
  '2-4.5':   { D: 2.000, TPI: 4.5,F: 3.000, G: 3.464, H: 1.344 },
};

// ASME B18.3 socket head cap screw — head + socket per published table.
//   D    nominal thread diameter (in)
//   TPI  threads per inch (UNC)
//   A    head diameter (in)
//   H    head height (in)
//   S    hex-socket across-flats (in)
//   T    socket engagement depth (in)
export const ASME_B18_3 = {
  '#4-40':   { D: 0.112, TPI: 40, A: 0.183, H: 0.112, S: 0.094, T: 0.060 },
  '#6-32':   { D: 0.138, TPI: 32, A: 0.226, H: 0.138, S: 0.078, T: 0.073 },
  '#8-32':   { D: 0.164, TPI: 32, A: 0.270, H: 0.164, S: 0.094, T: 0.087 },
  '#10-24':  { D: 0.190, TPI: 24, A: 0.312, H: 0.190, S: 0.156, T: 0.101 },
  '1/4-20':  { D: 0.250, TPI: 20, A: 0.375, H: 0.250, S: 0.188, T: 0.125 },
  '5/16-18': { D: 0.3125, TPI: 18, A: 0.469, H: 0.3125, S: 0.250, T: 0.156 },
  '3/8-16':  { D: 0.375, TPI: 16, A: 0.562, H: 0.375, S: 0.3125, T: 0.188 },
  '7/16-14': { D: 0.4375, TPI: 14, A: 0.656, H: 0.4375, S: 0.375, T: 0.219 },
  '1/2-13':  { D: 0.500, TPI: 13, A: 0.750, H: 0.500, S: 0.375, T: 0.250 },
  '5/8-11':  { D: 0.625, TPI: 11, A: 0.938, H: 0.625, S: 0.500, T: 0.313 },
  '3/4-10':  { D: 0.750, TPI: 10, A: 1.125, H: 0.750, S: 0.625, T: 0.375 },
  '7/8-9':   { D: 0.875, TPI: 9,  A: 1.312, H: 0.875, S: 0.750, T: 0.438 },
  '1-8':     { D: 1.000, TPI: 8,  A: 1.500, H: 1.000, S: 0.750, T: 0.500 },
};

// SAE J429 grade equivalents (proof strength S_p, yield S_y, ultimate S_ut
// — ksi). Grade-5 ≈ ISO 8.8, Grade-8 ≈ ISO 10.9.
export const SAE_GRADES = {
  '2': { Sp: 55,  Sy: 57,  Sut: 74  },
  '5': { Sp: 85,  Sy: 92,  Sut: 120 },
  '8': { Sp: 120, Sy: 130, Sut: 150 },
};

export const ASME_HEX_SIZES = Object.keys(ASME_B18_2_1);
export const ASME_SHCS_SIZES = Object.keys(ASME_B18_3);

// 1 inch = 25.4 mm — the builders use mm internally so they share the same
// atomic-CAD sketch language as ISO catalogs.
export const INCH_TO_MM = 25.4;
