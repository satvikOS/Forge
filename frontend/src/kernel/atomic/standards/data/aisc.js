/**
 * ArchDisc Kernel — AISC structural-steel section catalog.
 *
 * Pure-data section properties for structural shapes used in the SP-1
 * Falcon 9 octaweb e2e (cross-bracing struts, strut-attachment plates,
 * lateral stiffeners).
 *
 * Source: AISC Steel Construction Manual, 14th edition.
 *
 *   W-shapes (wide-flange I-beams) — full ASTM A992 series subset
 *   L-shapes (single angles)       — equal + unequal legs
 *   HSS rectangular hollow         — ASTM A500 grade B
 *
 * Dimensions in inches (per AISC standard); area in², moment of inertia
 * in in⁴, plastic section modulus in in³. INCH_TO_MM applies when the
 * builder sketches the profile.
 */

// W-shape — wide-flange I-beam.
//   d   depth (in)
//   bf  flange width (in)
//   tw  web thickness (in)
//   tf  flange thickness (in)
//   A   gross area (in²)
//   Ix  moment of inertia about major axis (in⁴)
//   Iy  moment of inertia about minor axis (in⁴)
//   Zx  plastic section modulus, major (in³)
//   weight  weight per ft (lb)
export const AISC_W_SHAPES = {
  W4x13:   { d: 4.16,  bf: 4.06,   tw: 0.280, tf: 0.345, A: 3.83,  Ix: 11.3,  Iy: 3.86, Zx: 6.28,  weight: 13 },
  W5x16:   { d: 5.01,  bf: 5.000,  tw: 0.240, tf: 0.360, A: 4.71,  Ix: 21.4,  Iy: 7.51, Zx: 9.59,  weight: 16 },
  W5x19:   { d: 5.15,  bf: 5.030,  tw: 0.270, tf: 0.430, A: 5.56,  Ix: 26.3,  Iy: 9.13, Zx: 11.6,  weight: 19 },
  W6x9:    { d: 5.90,  bf: 3.940,  tw: 0.170, tf: 0.215, A: 2.68,  Ix: 16.4,  Iy: 2.20, Zx: 6.23,  weight: 9 },
  W6x12:   { d: 6.03,  bf: 4.000,  tw: 0.230, tf: 0.280, A: 3.55,  Ix: 22.1,  Iy: 2.99, Zx: 8.30,  weight: 12 },
  W6x16:   { d: 6.28,  bf: 4.030,  tw: 0.260, tf: 0.405, A: 4.74,  Ix: 32.1,  Iy: 4.43, Zx: 11.7,  weight: 16 },
  W6x20:   { d: 6.20,  bf: 6.020,  tw: 0.260, tf: 0.365, A: 5.87,  Ix: 41.4,  Iy: 13.3, Zx: 14.9,  weight: 20 },
  W6x25:   { d: 6.38,  bf: 6.080,  tw: 0.320, tf: 0.455, A: 7.34,  Ix: 53.4,  Iy: 17.1, Zx: 18.9,  weight: 25 },
  W8x10:   { d: 7.89,  bf: 3.940,  tw: 0.170, tf: 0.205, A: 2.96,  Ix: 30.8,  Iy: 2.09, Zx: 8.87,  weight: 10 },
  W8x13:   { d: 7.99,  bf: 4.000,  tw: 0.230, tf: 0.255, A: 3.84,  Ix: 39.6,  Iy: 2.73, Zx: 11.4,  weight: 13 },
  W8x15:   { d: 8.11,  bf: 4.015,  tw: 0.245, tf: 0.315, A: 4.44,  Ix: 48.0,  Iy: 3.41, Zx: 13.6,  weight: 15 },
  W8x18:   { d: 8.14,  bf: 5.250,  tw: 0.230, tf: 0.330, A: 5.26,  Ix: 61.9,  Iy: 7.97, Zx: 17.0,  weight: 18 },
  W8x21:   { d: 8.28,  bf: 5.270,  tw: 0.250, tf: 0.400, A: 6.16,  Ix: 75.3,  Iy: 9.77, Zx: 20.4,  weight: 21 },
  W8x24:   { d: 7.93,  bf: 6.495,  tw: 0.245, tf: 0.400, A: 7.08,  Ix: 82.7,  Iy: 18.3, Zx: 23.1,  weight: 24 },
  W8x31:   { d: 8.00,  bf: 7.995,  tw: 0.285, tf: 0.435, A: 9.13,  Ix: 110,   Iy: 37.1, Zx: 30.4,  weight: 31 },
  W10x12:  { d: 9.87,  bf: 3.960,  tw: 0.190, tf: 0.210, A: 3.54,  Ix: 53.8,  Iy: 2.18, Zx: 12.6,  weight: 12 },
  W10x15:  { d: 9.99,  bf: 4.000,  tw: 0.230, tf: 0.270, A: 4.41,  Ix: 68.9,  Iy: 2.89, Zx: 16.0,  weight: 15 },
  W10x22:  { d: 10.17, bf: 5.750,  tw: 0.240, tf: 0.360, A: 6.49,  Ix: 118,   Iy: 11.4, Zx: 26.0,  weight: 22 },
  W10x33:  { d: 9.73,  bf: 7.960,  tw: 0.290, tf: 0.435, A: 9.71,  Ix: 171,   Iy: 36.6, Zx: 38.8,  weight: 33 },
  W12x14:  { d: 11.91, bf: 3.970,  tw: 0.200, tf: 0.225, A: 4.16,  Ix: 88.6,  Iy: 2.36, Zx: 17.4,  weight: 14 },
  W12x16:  { d: 11.99, bf: 3.990,  tw: 0.220, tf: 0.265, A: 4.71,  Ix: 103,   Iy: 2.82, Zx: 20.1,  weight: 16 },
  W12x26:  { d: 12.22, bf: 6.490,  tw: 0.230, tf: 0.380, A: 7.65,  Ix: 204,   Iy: 17.3, Zx: 37.2,  weight: 26 },
  W12x40:  { d: 11.94, bf: 8.005,  tw: 0.295, tf: 0.515, A: 11.7,  Ix: 307,   Iy: 44.1, Zx: 57.0,  weight: 40 },
  W14x22:  { d: 13.74, bf: 5.000,  tw: 0.230, tf: 0.335, A: 6.49,  Ix: 199,   Iy: 7.00, Zx: 33.2,  weight: 22 },
  W14x30:  { d: 13.84, bf: 6.730,  tw: 0.270, tf: 0.385, A: 8.85,  Ix: 291,   Iy: 19.6, Zx: 47.3,  weight: 30 },
  W14x53:  { d: 13.92, bf: 8.060,  tw: 0.370, tf: 0.660, A: 15.6,  Ix: 541,   Iy: 57.7, Zx: 87.1,  weight: 53 },
  W16x26:  { d: 15.69, bf: 5.500,  tw: 0.250, tf: 0.345, A: 7.68,  Ix: 301,   Iy: 9.59, Zx: 44.2,  weight: 26 },
  W16x36:  { d: 15.86, bf: 6.985,  tw: 0.295, tf: 0.430, A: 10.6,  Ix: 448,   Iy: 24.5, Zx: 64.0,  weight: 36 },
  W18x35:  { d: 17.70, bf: 6.000,  tw: 0.300, tf: 0.425, A: 10.3,  Ix: 510,   Iy: 15.3, Zx: 66.5,  weight: 35 },
  W18x55:  { d: 18.11, bf: 7.530,  tw: 0.390, tf: 0.630, A: 16.2,  Ix: 890,   Iy: 44.9, Zx: 112,   weight: 55 },
  W21x44:  { d: 20.66, bf: 6.500,  tw: 0.350, tf: 0.450, A: 13.0,  Ix: 843,   Iy: 20.7, Zx: 95.4,  weight: 44 },
  W21x83:  { d: 21.43, bf: 8.355,  tw: 0.515, tf: 0.835, A: 24.4,  Ix: 1830,  Iy: 81.4, Zx: 196,   weight: 83 },
  W24x55:  { d: 23.57, bf: 7.005,  tw: 0.395, tf: 0.505, A: 16.2,  Ix: 1350,  Iy: 29.1, Zx: 134,   weight: 55 },
  W24x84:  { d: 24.10, bf: 9.020,  tw: 0.470, tf: 0.770, A: 24.7,  Ix: 2370,  Iy: 94.4, Zx: 224,   weight: 84 },
  W27x84:  { d: 26.71, bf: 9.960,  tw: 0.460, tf: 0.640, A: 24.8,  Ix: 2850,  Iy: 106,  Zx: 244,   weight: 84 },
  W30x90:  { d: 29.53, bf: 10.400, tw: 0.470, tf: 0.610, A: 26.4,  Ix: 3610,  Iy: 115,  Zx: 283,   weight: 90 },
  W33x118: { d: 32.86, bf: 11.480, tw: 0.550, tf: 0.740, A: 34.7,  Ix: 5900,  Iy: 187,  Zx: 415,   weight: 118 },
  W36x150: { d: 35.85, bf: 11.975, tw: 0.625, tf: 0.940, A: 44.2,  Ix: 9040,  Iy: 270,  Zx: 581,   weight: 150 },
  W40x167: { d: 38.59, bf: 11.810, tw: 0.650, tf: 0.830, A: 49.3,  Ix: 11600, Iy: 228,  Zx: 693,   weight: 167 },
  W40x593: { d: 43.00, bf: 16.700, tw: 1.790, tf: 2.950, A: 174,   Ix: 50400, Iy: 2290, Zx: 2760,  weight: 593 },
};

// L-shape single-angle (equal + unequal legs).
//   leg1  long leg (in)
//   leg2  short leg (in, equals leg1 for equal angles)
//   t     thickness (in)
//   A     area (in²)
//   weight  weight per ft (lb)
export const AISC_L_SHAPES = {
  'L3x3x1/4':   { leg1: 3,  leg2: 3,  t: 0.250, A: 1.44, weight: 4.9 },
  'L3x3x3/8':   { leg1: 3,  leg2: 3,  t: 0.375, A: 2.11, weight: 7.2 },
  'L3x3x1/2':   { leg1: 3,  leg2: 3,  t: 0.500, A: 2.75, weight: 9.4 },
  'L4x4x1/4':   { leg1: 4,  leg2: 4,  t: 0.250, A: 1.94, weight: 6.6 },
  'L4x4x3/8':   { leg1: 4,  leg2: 4,  t: 0.375, A: 2.86, weight: 9.8 },
  'L4x4x1/2':   { leg1: 4,  leg2: 4,  t: 0.500, A: 3.75, weight: 12.8 },
  'L4x4x5/8':   { leg1: 4,  leg2: 4,  t: 0.625, A: 4.61, weight: 15.7 },
  'L5x5x5/16':  { leg1: 5,  leg2: 5,  t: 0.3125, A: 3.07, weight: 10.4 },
  'L5x5x3/8':   { leg1: 5,  leg2: 5,  t: 0.375, A: 3.65, weight: 12.3 },
  'L5x5x1/2':   { leg1: 5,  leg2: 5,  t: 0.500, A: 4.79, weight: 16.2 },
  'L5x5x5/8':   { leg1: 5,  leg2: 5,  t: 0.625, A: 5.90, weight: 20.0 },
  'L6x6x3/8':   { leg1: 6,  leg2: 6,  t: 0.375, A: 4.38, weight: 14.9 },
  'L6x6x1/2':   { leg1: 6,  leg2: 6,  t: 0.500, A: 5.77, weight: 19.6 },
  'L6x6x5/8':   { leg1: 6,  leg2: 6,  t: 0.625, A: 7.13, weight: 24.2 },
  'L6x6x3/4':   { leg1: 6,  leg2: 6,  t: 0.750, A: 8.46, weight: 28.7 },
  'L8x8x1/2':   { leg1: 8,  leg2: 8,  t: 0.500, A: 7.84, weight: 26.4 },
  'L8x8x5/8':   { leg1: 8,  leg2: 8,  t: 0.625, A: 9.69, weight: 32.7 },
  'L8x8x3/4':   { leg1: 8,  leg2: 8,  t: 0.750, A: 11.5, weight: 38.9 },
  'L8x8x1':     { leg1: 8,  leg2: 8,  t: 1.000, A: 15.0, weight: 51.0 },
  'L4x3x1/4':   { leg1: 4,  leg2: 3,  t: 0.250, A: 1.69, weight: 5.8 },
  'L4x3x3/8':   { leg1: 4,  leg2: 3,  t: 0.375, A: 2.48, weight: 8.5 },
  'L5x3x1/4':   { leg1: 5,  leg2: 3,  t: 0.250, A: 1.94, weight: 6.6 },
  'L5x3x3/8':   { leg1: 5,  leg2: 3,  t: 0.375, A: 2.86, weight: 9.8 },
  'L6x4x3/8':   { leg1: 6,  leg2: 4,  t: 0.375, A: 3.61, weight: 12.3 },
  'L6x4x1/2':   { leg1: 6,  leg2: 4,  t: 0.500, A: 4.75, weight: 16.2 },
  'L7x4x3/8':   { leg1: 7,  leg2: 4,  t: 0.375, A: 3.99, weight: 13.6 },
  'L7x4x1/2':   { leg1: 7,  leg2: 4,  t: 0.500, A: 5.25, weight: 17.9 },
  'L8x4x1/2':   { leg1: 8,  leg2: 4,  t: 0.500, A: 5.75, weight: 19.6 },
  'L8x4x3/4':   { leg1: 8,  leg2: 4,  t: 0.750, A: 8.46, weight: 28.7 },
  'L8x6x3/4':   { leg1: 8,  leg2: 6,  t: 0.750, A: 9.99, weight: 33.8 },
};

// HSS rectangular tube (Hollow Structural Section) — wall thickness in
// `t`; cross-section dimensions in `a × b`.
//   a   outer width (in)
//   b   outer depth (in)
//   t   nominal wall thickness (in, design value)
//   A   area (in²)
//   weight  weight per ft (lb)
export const AISC_HSS_RECT = {
  'HSS3x3x1/4':       { a: 3,  b: 3,  t: 0.233, A: 2.44, weight: 8.3 },
  'HSS3x3x3/16':      { a: 3,  b: 3,  t: 0.174, A: 1.89, weight: 6.4 },
  'HSS3x3x1/8':       { a: 3,  b: 3,  t: 0.116, A: 1.30, weight: 4.4 },
  'HSS4x4x1/4':       { a: 4,  b: 4,  t: 0.233, A: 3.37, weight: 11.5 },
  'HSS4x4x3/8':       { a: 4,  b: 4,  t: 0.349, A: 4.78, weight: 16.3 },
  'HSS4x4x1/2':       { a: 4,  b: 4,  t: 0.465, A: 6.02, weight: 20.5 },
  'HSS5x5x1/4':       { a: 5,  b: 5,  t: 0.233, A: 4.30, weight: 14.7 },
  'HSS5x5x3/8':       { a: 5,  b: 5,  t: 0.349, A: 6.18, weight: 21.0 },
  'HSS5x5x1/2':       { a: 5,  b: 5,  t: 0.465, A: 7.88, weight: 26.8 },
  'HSS6x6x1/4':       { a: 6,  b: 6,  t: 0.233, A: 5.24, weight: 17.8 },
  'HSS6x6x3/8':       { a: 6,  b: 6,  t: 0.349, A: 7.58, weight: 25.8 },
  'HSS6x6x1/2':       { a: 6,  b: 6,  t: 0.465, A: 9.74, weight: 33.1 },
  'HSS6x6x5/8':       { a: 6,  b: 6,  t: 0.581, A: 11.7, weight: 39.8 },
  'HSS8x8x1/4':       { a: 8,  b: 8,  t: 0.233, A: 7.10, weight: 24.2 },
  'HSS8x8x3/8':       { a: 8,  b: 8,  t: 0.349, A: 10.4, weight: 35.2 },
  'HSS8x8x1/2':       { a: 8,  b: 8,  t: 0.465, A: 13.5, weight: 45.7 },
  'HSS8x8x5/8':       { a: 8,  b: 8,  t: 0.581, A: 16.4, weight: 55.7 },
  'HSS10x10x3/8':     { a: 10, b: 10, t: 0.349, A: 13.2, weight: 44.8 },
  'HSS10x10x1/2':     { a: 10, b: 10, t: 0.465, A: 17.2, weight: 58.7 },
  'HSS10x10x5/8':     { a: 10, b: 10, t: 0.581, A: 21.0, weight: 71.6 },
  'HSS12x12x3/8':     { a: 12, b: 12, t: 0.349, A: 16.0, weight: 54.3 },
  'HSS12x12x1/2':     { a: 12, b: 12, t: 0.465, A: 21.0, weight: 71.6 },
  'HSS12x12x5/8':     { a: 12, b: 12, t: 0.581, A: 25.7, weight: 87.4 },
  'HSS12x12x3/4':     { a: 12, b: 12, t: 0.696, A: 30.3, weight: 103 },
  'HSS16x16x1/2':     { a: 16, b: 16, t: 0.465, A: 28.4, weight: 96.7 },
  'HSS16x16x5/8':     { a: 16, b: 16, t: 0.581, A: 35.0, weight: 119 },
  'HSS16x16x3/4':     { a: 16, b: 16, t: 0.696, A: 41.3, weight: 141 },
  'HSS20x20x1/2':     { a: 20, b: 20, t: 0.465, A: 35.9, weight: 122 },
  'HSS20x20x5/8':     { a: 20, b: 20, t: 0.581, A: 44.4, weight: 151 },
  'HSS20x20x3/4':     { a: 20, b: 20, t: 0.696, A: 52.6, weight: 179 },
};

export const AISC_W_SIZES = Object.keys(AISC_W_SHAPES);
export const AISC_L_SIZES = Object.keys(AISC_L_SHAPES);
export const AISC_HSS_SIZES = Object.keys(AISC_HSS_RECT);

// Inch-to-mm conversion lives once in asme.js; AISC consumers import it
// directly from there. (Re-defining it here used to collide with asme.js
// in data/index.js's star-export — native ESM rejects duplicate named
// exports across `export *` re-exports.)
