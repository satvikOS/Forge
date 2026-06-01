// Forge-166 — REAL thread parameter tables (ISO 261/68-1, ASME B1.1, B1.20.1).
//
// All values from the published spec tables. No interpolation, no
// guess-fits, no marketing "nominal" rounding. Tap drill columns come
// from ISO 2306 (metric) and ASME B1.1 Table 5 (inch).
//
// Geometric relations (ISO 68-1 §3 / ASME B1.1 §2):
//   H        = √3/2 · P                 (fundamental V-triangle height)
//   D        = nominal major diameter
//   D2       = D − 0.6495 P             (pitch diameter, basic)
//   D1       = D − 1.0825 P             (minor diameter, basic, internal)
//   d3       = D − 1.2269 P             (external thread root, ISO)
//   Crest truncation:  H/8   (external + internal)
//   Root truncation:   H/4   (external, rounded), H/8 (internal)
//
// For ASME B1.1 (Unified) the same V-form applies with H = √3/2 · P,
// pitch P = 1/n (inch) where n = threads per inch.
//
// For ASME B1.20.1 (NPT) the V-form is the same but the entire thread
// envelope is conical, tapered 3/4 inch on diameter per foot of length
// → half-angle α = arctan((3/4)/(12)/2) = arctan(1/32) = 1°47'24.474".

// ─── Unit constants ─────────────────────────────────────────────────
export const SQRT3_2 = Math.sqrt(3) / 2;   // 0.86602540378…
export const INCH    = 25.4;               // mm per inch (exact, ASME B1.1).

/** Compute fundamental triangle height H from pitch P (mm). */
export function fundamentalHeight(pitchMm) {
  return SQRT3_2 * pitchMm;
}

/** Basic pitch diameter D2 from major D and pitch P, ISO 68-1 / ASME B1.1. */
export function basicPitchDiameter(majorMm, pitchMm) {
  return majorMm - 0.6495 * pitchMm;
}

/** Basic minor diameter D1 (internal) — ISO 68-1 §3. */
export function basicMinorDiameter(majorMm, pitchMm) {
  return majorMm - 1.0825 * pitchMm;
}

/** External thread root d3 — ISO 68-1 figure 2 (rounded root). */
export function basicExternalRoot(majorMm, pitchMm) {
  return majorMm - 1.2269 * pitchMm;
}

// ─── ISO 261 / 68-1 Metric thread table ─────────────────────────────
// Columns: nominal, coarsePitch, finePitch (mm), tapDrillCoarse (mm).
// finePitch === null → no fine series defined at this size.
// Source: ISO 261:1998 Tables 1–3; ISO 2306:1985 Table 1.
//
// All 25 sizes M1.6 → M48 per spec.
export const ISO_METRIC = [
  { size: 'M1.6',  major: 1.6,  coarse: 0.35, fine: null, tapDrill: 1.25 },
  { size: 'M2',    major: 2.0,  coarse: 0.40, fine: null, tapDrill: 1.60 },
  { size: 'M2.5',  major: 2.5,  coarse: 0.45, fine: null, tapDrill: 2.05 },
  { size: 'M3',    major: 3.0,  coarse: 0.50, fine: null, tapDrill: 2.50 },
  { size: 'M3.5',  major: 3.5,  coarse: 0.60, fine: null, tapDrill: 2.90 },
  { size: 'M4',    major: 4.0,  coarse: 0.70, fine: null, tapDrill: 3.30 },
  { size: 'M5',    major: 5.0,  coarse: 0.80, fine: null, tapDrill: 4.20 },
  { size: 'M6',    major: 6.0,  coarse: 1.00, fine: 0.75, tapDrill: 5.00 },
  { size: 'M8',    major: 8.0,  coarse: 1.25, fine: 1.00, tapDrill: 6.80 },
  { size: 'M10',   major: 10.0, coarse: 1.50, fine: 1.25, tapDrill: 8.50 },
  { size: 'M12',   major: 12.0, coarse: 1.75, fine: 1.25, tapDrill: 10.20 },
  { size: 'M14',   major: 14.0, coarse: 2.00, fine: 1.50, tapDrill: 12.00 },
  { size: 'M16',   major: 16.0, coarse: 2.00, fine: 1.50, tapDrill: 14.00 },
  { size: 'M18',   major: 18.0, coarse: 2.50, fine: 1.50, tapDrill: 15.50 },
  { size: 'M20',   major: 20.0, coarse: 2.50, fine: 1.50, tapDrill: 17.50 },
  { size: 'M22',   major: 22.0, coarse: 2.50, fine: 1.50, tapDrill: 19.50 },
  { size: 'M24',   major: 24.0, coarse: 3.00, fine: 2.00, tapDrill: 21.00 },
  { size: 'M27',   major: 27.0, coarse: 3.00, fine: 2.00, tapDrill: 24.00 },
  { size: 'M30',   major: 30.0, coarse: 3.50, fine: 2.00, tapDrill: 26.50 },
  { size: 'M33',   major: 33.0, coarse: 3.50, fine: 2.00, tapDrill: 29.50 },
  { size: 'M36',   major: 36.0, coarse: 4.00, fine: 3.00, tapDrill: 32.00 },
  { size: 'M39',   major: 39.0, coarse: 4.00, fine: 3.00, tapDrill: 35.00 },
  { size: 'M42',   major: 42.0, coarse: 4.50, fine: 3.00, tapDrill: 37.50 },
  { size: 'M45',   major: 45.0, coarse: 4.50, fine: 3.00, tapDrill: 40.50 },
  { size: 'M48',   major: 48.0, coarse: 5.00, fine: 3.00, tapDrill: 43.00 },
];

// ─── ASME B1.1 Unified Inch table (UNC coarse + UNF fine) ──────────
// Columns: name, major(in), tpiCoarse, tpiFine, tapDrillCoarse(in).
// Source: ASME B1.1-2003 Tables 1B/1C; tap drill column = B1.1 Table 5
//   (75 % thread engagement).
export const ASME_UNIFIED = [
  { size: '#4',   major: 0.1120, tpiC: 40, tpiF: 48, tapC: 0.0890 },
  { size: '#6',   major: 0.1380, tpiC: 32, tpiF: 40, tapC: 0.1065 },
  { size: '#8',   major: 0.1640, tpiC: 32, tpiF: 36, tapC: 0.1360 },
  { size: '#10',  major: 0.1900, tpiC: 24, tpiF: 32, tapC: 0.1495 },
  { size: '1/4',  major: 0.2500, tpiC: 20, tpiF: 28, tapC: 0.2010 },
  { size: '5/16', major: 0.3125, tpiC: 18, tpiF: 24, tapC: 0.2570 },
  { size: '3/8',  major: 0.3750, tpiC: 16, tpiF: 24, tapC: 0.3125 },
  { size: '1/2',  major: 0.5000, tpiC: 13, tpiF: 20, tapC: 0.4219 },
  { size: '5/8',  major: 0.6250, tpiC: 11, tpiF: 18, tapC: 0.5312 },
  { size: '3/4',  major: 0.7500, tpiC: 10, tpiF: 16, tapC: 0.6562 },
  { size: '1',    major: 1.0000, tpiC: 8,  tpiF: 12, tapC: 0.8750 },
];

// ─── ASME B1.20.1 NPT tapered pipe table ───────────────────────────
// Columns: name (nominal pipe size), pipeOD(in), tpi, threadLength(in),
// effectiveLength L2 (engaged threads, in). Source: ASME B1.20.1-2013
// Table 2.
export const ASME_NPT = [
  { size: '1/16', pipeOD: 0.3125, tpi: 27,   threadLen: 0.2611, l2: 0.1615 },
  { size: '1/8',  pipeOD: 0.4050, tpi: 27,   threadLen: 0.2639, l2: 0.1615 },
  { size: '1/4',  pipeOD: 0.5400, tpi: 18,   threadLen: 0.4018, l2: 0.2278 },
  { size: '3/8',  pipeOD: 0.6750, tpi: 18,   threadLen: 0.4078, l2: 0.2400 },
  { size: '1/2',  pipeOD: 0.8400, tpi: 14,   threadLen: 0.5337, l2: 0.3200 },
  { size: '3/4',  pipeOD: 1.0500, tpi: 14,   threadLen: 0.5457, l2: 0.3390 },
  { size: '1',    pipeOD: 1.3150, tpi: 11.5, threadLen: 0.6828, l2: 0.4000 },
  { size: '1-1/4',pipeOD: 1.6600, tpi: 11.5, threadLen: 0.7068, l2: 0.4200 },
  { size: '1-1/2',pipeOD: 1.9000, tpi: 11.5, threadLen: 0.7235, l2: 0.4200 },
  { size: '2',    pipeOD: 2.3750, tpi: 11.5, threadLen: 0.7565, l2: 0.4360 },
];

// ASME B1.20.1 §3.1.1 — pipe-thread taper is 3/4 inch on diameter per
// foot of length → 1°47'24" half-angle. Used by NPT generator.
export const NPT_TAPER_PER_FOOT      = 0.75;        // inches diameter / foot
export const NPT_TAPER_HALF_ANGLE_DEG = Math.atan(NPT_TAPER_PER_FOOT / 12 / 2)
                                        * 180 / Math.PI;
// Truncations per ASME B1.20.1 §3.1.4: crest+root truncated 0.033 P.
export const NPT_TRUNCATION_FACTOR = 0.033;

/**
 * Resolve a metric size + series to its computed parameter block.
 * Returns null if size unknown or series not defined.
 *   series: 'coarse' | 'fine'
 */
export function resolveMetric(sizeName, series = 'coarse') {
  const row = ISO_METRIC.find((r) => r.size === sizeName);
  if (!row) return null;
  const pitch = series === 'fine' ? row.fine : row.coarse;
  if (pitch == null) return null;
  const H  = fundamentalHeight(pitch);
  const D2 = basicPitchDiameter(row.major, pitch);
  const D1 = basicMinorDiameter(row.major, pitch);
  const d3 = basicExternalRoot(row.major, pitch);
  return {
    standard: 'ISO 261',
    profile:  'ISO-68-1-V60',
    flankAngleDeg: 60,
    size:     row.size,
    series,
    pitch,
    major:    row.major,
    pitchDia: D2,
    minorDia: D1,
    rootDia:  d3,
    H,
    tapDrill: row.tapDrill,
    tapered:  false,
  };
}

/** Resolve an ASME B1.1 Unified-inch size + series → parameter block. */
export function resolveUnified(sizeName, series = 'UNC') {
  const row = ASME_UNIFIED.find((r) => r.size === sizeName);
  if (!row) return null;
  const tpi = series === 'UNF' ? row.tpiF : row.tpiC;
  if (!tpi) return null;
  const pitchIn = 1 / tpi;
  const pitch   = pitchIn * INCH;
  const major   = row.major * INCH;
  const H       = fundamentalHeight(pitch);
  const D2      = basicPitchDiameter(major, pitch);
  const D1      = basicMinorDiameter(major, pitch);
  const d3      = basicExternalRoot(major, pitch);
  return {
    standard: 'ASME B1.1',
    profile:  'UN-60',
    flankAngleDeg: 60,
    size:     row.size,
    series,
    tpi,
    pitch,
    major,
    pitchDia: D2,
    minorDia: D1,
    rootDia:  d3,
    H,
    tapDrill: series === 'UNC' ? row.tapC * INCH : null,
    tapered:  false,
  };
}

/** Resolve an ASME B1.20.1 NPT pipe size → parameter block (tapered). */
export function resolveNpt(sizeName) {
  const row = ASME_NPT.find((r) => r.size === sizeName);
  if (!row) return null;
  const pitchIn = 1 / row.tpi;
  const pitch   = pitchIn * INCH;
  const major   = row.pipeOD * INCH;
  const H       = fundamentalHeight(pitch);
  return {
    standard: 'ASME B1.20.1',
    profile:  'NPT-60-tapered',
    flankAngleDeg: 60,
    size:     row.size,
    series:   'NPT',
    tpi:      row.tpi,
    pitch,
    major,
    threadLen:   row.threadLen * INCH,
    effectiveLen: row.l2 * INCH,
    halfAngleDeg: NPT_TAPER_HALF_ANGLE_DEG,
    taperPerFoot: NPT_TAPER_PER_FOOT,
    crestTrunc:  NPT_TRUNCATION_FACTOR * pitch,
    rootTrunc:   NPT_TRUNCATION_FACTOR * pitch,
    H,
    tapered:  true,
  };
}

/**
 * Universal entry point — pick the right resolver by standard family.
 *   standard: 'ISO_METRIC' | 'UNC' | 'UNF' | 'NPT'
 */
export function resolveThread({ standard, size, series } = {}) {
  if (standard === 'ISO_METRIC') {
    return resolveMetric(size, series || 'coarse');
  }
  if (standard === 'UNC') return resolveUnified(size, 'UNC');
  if (standard === 'UNF') return resolveUnified(size, 'UNF');
  if (standard === 'NPT') return resolveNpt(size);
  return null;
}

/** Return the catalogue of known standard families + their sizes. */
export const STANDARDS = [
  { id: 'ISO_METRIC', label: 'ISO Metric (M)',
    sizes: ISO_METRIC.map((r) => r.size),
    seriesOptions: ['coarse', 'fine'] },
  { id: 'UNC',        label: 'ASME UNC (inch coarse)',
    sizes: ASME_UNIFIED.map((r) => r.size),
    seriesOptions: ['UNC'] },
  { id: 'UNF',        label: 'ASME UNF (inch fine)',
    sizes: ASME_UNIFIED.map((r) => r.size),
    seriesOptions: ['UNF'] },
  { id: 'NPT',        label: 'ASME NPT (tapered pipe)',
    sizes: ASME_NPT.map((r) => r.size),
    seriesOptions: ['NPT'] },
];

/** Sum of distinct sizes across all four standards (for HUD + tests). */
export function countSizes() {
  return ISO_METRIC.length + ASME_UNIFIED.length + ASME_NPT.length;
}

// Expose tables on window for tests + DevTools.
if (typeof window !== 'undefined') {
  window.__forgeThreadStandards = {
    ISO_METRIC, ASME_UNIFIED, ASME_NPT, STANDARDS,
    resolveMetric, resolveUnified, resolveNpt, resolveThread, countSizes,
    NPT_TAPER_HALF_ANGLE_DEG, NPT_TAPER_PER_FOOT, NPT_TRUNCATION_FACTOR,
  };
}

export default {
  ISO_METRIC, ASME_UNIFIED, ASME_NPT, STANDARDS,
  resolveMetric, resolveUnified, resolveNpt, resolveThread,
  fundamentalHeight, basicPitchDiameter, basicMinorDiameter,
  basicExternalRoot, countSizes,
  NPT_TAPER_HALF_ANGLE_DEG, NPT_TAPER_PER_FOOT, NPT_TRUNCATION_FACTOR,
  SQRT3_2, INCH,
};
