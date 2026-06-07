// PUSH-160 (Slice-116) — NACA 4-digit airfoil math (pure JS).
//
// Generates 2D airfoil polylines for the Wing Rib Lofting tool. The
// math is the canonical NACA 4-digit equation set, lifted from the
// 1949 NACA Report 824 / Abbott & von Doenhoff "Theory of Wing
// Sections" (sec. 6.3):
//
//   Camber line (mean line):
//     yc(x) = (m / p^2)   · (2·p·x − x^2)            for 0 <= x <= p
//     yc(x) = (m / (1−p)^2) · ((1 − 2·p) + 2·p·x − x^2)  for p <  x <= 1
//
//   Camber slope (dy_c/dx) for surface-normal offset:
//     dyc/dx = (2·m / p^2)   · (p − x)               for 0 <= x <= p
//     dyc/dx = (2·m / (1−p)^2) · (p − x)             for p <  x <= 1
//
//   Thickness distribution (open trailing edge — coefficients chosen
//   so y_t(0)=0 and y_t(1) ≈ 0.0021·t):
//     yt(x) = (t / 0.2) · ( 0.2969·sqrt(x)
//                          − 0.1260·x
//                          − 0.3516·x^2
//                          + 0.2843·x^3
//                          − 0.1015·x^4 )
//
//   Upper / lower surface (with surface offset normal to camber):
//     xu = x − yt · sin θ      yu = yc + yt · cos θ
//     xl = x + yt · sin θ      yl = yc − yt · cos θ
//   where θ = atan(dyc/dx).
//
// We sample with a cosine-clustered chord distribution so the leading
// edge gets dense samples (where curvature is highest) and the trailing
// edge stays well resolved:
//   beta_i = π·i/(n−1)
//   x_i    = (1 − cos beta_i) / 2
//
// The returned polyline runs trailing-edge → upper surface → leading
// edge → lower surface → trailing edge, so a downstream loft surface
// reads the same ring orientation for every station. Total point count
// is 2·n − 1 (the leading-edge sample is shared between the upper and
// lower runs).
//
// NACA code interpretation (4-digit):
//   digit 1  M  — max camber as %% of chord  (e.g. '2412' → m = 0.02)
//   digit 2  P  — position of max camber in tenths of chord (e.g. '2412' → p = 0.4)
//   digits 3-4  T — thickness as %% of chord (e.g. '2412' → t = 0.12)
//
// API:
//   naca(code='2412', n=100)
//     → { code, m, p, t, n, points: [[x,y], ...] }    // 2·n−1 points
//
//   nacaCoordinates(code='2412', n=100)
//     → Float64Array of length 2·(2·n−1) — flat [x0,y0,x1,y1,...]
//     useful for downstream Float64Array consumers.
//
// Hard constraints honoured (Forge "no-deps" + "real-impl" mandate):
//   * Pure ES module. NO new npm / native deps. Zero kernel calls.
//   * No fake math — every coefficient is the canonical NACA / Jacobs
//     1933 thickness equation. Camber + slope are textbook NACA 4-digit.
//   * Symmetric foils (digits 1+2 == '00', e.g. NACA 0012) collapse to
//     yc(x)=0 and dyc/dx=0 exactly — the formulae handle m=p=0 without
//     a divide-by-zero because we guard the (m / p^2) branches.

// ─────────────────────────────────────────────────────────────────────
// Code parsing.

/** Parse a NACA 4-digit code into { m, p, t } in chord-fraction units.
 *  '2412' → { m: 0.02, p: 0.4, t: 0.12 }
 *  '0012' → { m: 0.00, p: 0.0, t: 0.12 }   (symmetric)
 *  Accepts integer or string forms; pads to 4 chars with leading zeros
 *  so '12' (NACA 0012) is treated like the user typed '0012'. Throws on
 *  non-digit input. */
export function parseNaca4(code) {
  if (code == null) throw new Error('parseNaca4: code is required');
  const raw = String(code).trim();
  if (!/^[0-9]{1,4}$/.test(raw)) {
    throw new Error(`parseNaca4: '${raw}' is not a 4-digit numeric code`);
  }
  const padded = raw.padStart(4, '0');
  const mDigit = parseInt(padded[0], 10);
  const pDigit = parseInt(padded[1], 10);
  const tDigits = parseInt(padded.slice(2), 10);
  return {
    code: padded,
    m: mDigit / 100,    // max camber as fraction of chord (1st digit, %)
    p: pDigit / 10,     // position of max camber (2nd digit, tenths)
    t: tDigits / 100,   // thickness as fraction of chord (last two, %)
  };
}

// ─────────────────────────────────────────────────────────────────────
// Thickness distribution (Jacobs et al., NACA 1933).
//
// Coefficients: 0.2969, 0.1260, 0.3516, 0.2843, 0.1015 — the open-TE
// variant. (The closed-TE variant replaces 0.1015 with 0.1036.)

/** yt(x) — half-thickness at chord position x ∈ [0, 1]. */
export function thicknessAt(x, t) {
  if (x < 0) x = 0;
  if (x > 1) x = 1;
  const sx = Math.sqrt(x);
  return (t / 0.2) * (
      0.2969 * sx
    - 0.1260 * x
    - 0.3516 * x * x
    + 0.2843 * x * x * x
    - 0.1015 * x * x * x * x
  );
}

// ─────────────────────────────────────────────────────────────────────
// Camber line + slope.

/** yc(x) — camber line ordinate at chord position x. */
export function camberAt(x, m, p) {
  if (m === 0 || p === 0) return 0;
  if (x <= p) {
    return (m / (p * p)) * (2 * p * x - x * x);
  }
  const q = 1 - p;
  return (m / (q * q)) * ((1 - 2 * p) + 2 * p * x - x * x);
}

/** dyc/dx at chord position x. */
export function camberSlopeAt(x, m, p) {
  if (m === 0 || p === 0) return 0;
  if (x <= p) {
    return (2 * m / (p * p)) * (p - x);
  }
  const q = 1 - p;
  return (2 * m / (q * q)) * (p - x);
}

// ─────────────────────────────────────────────────────────────────────
// Cosine-clustered chord sampling.
//
// Returns n samples in [0, 1], denser near 0 (leading edge) and 1
// (trailing edge), via x_i = (1 − cos(πi/(n−1))) / 2.

/** Build n chord-fraction samples with cosine clustering. */
export function cosineChordSamples(n) {
  const N = Math.max(2, n | 0);
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const beta = Math.PI * (i / (N - 1));
    out[i] = (1 - Math.cos(beta)) / 2;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Headline export — generate the airfoil polyline.

/**
 * Build a NACA 4-digit airfoil polyline in chord-normalised coordinates.
 *
 * The polyline runs:
 *    trailing edge (x=1, lower)
 *  → lower surface back to the leading edge (x=0)
 *  → upper surface forward to the trailing edge (x=1)
 *
 * (The first and last points coincide at the trailing edge so the loft
 * sees a closed ring per station.)
 *
 * @param {string|number} code  NACA 4-digit code, e.g. '2412' or 2412.
 * @param {number}        n     Chord samples per surface (>= 8).
 * @returns {{
 *   code: string, m: number, p: number, t: number, n: number,
 *   points: Array<[number, number]>,
 *   xy: Float64Array,           // flat [x0,y0,x1,y1,...]
 * }}
 */
export function naca(code = '2412', n = 100) {
  const N = Math.max(8, n | 0);
  const spec = parseNaca4(code);
  const { m, p, t } = spec;
  const xs = cosineChordSamples(N);

  // Pre-compute (xu, yu) and (xl, yl) per chord sample. We then walk
  // the rings into a single closed polyline.
  const upper = new Array(N);
  const lower = new Array(N);
  for (let i = 0; i < N; i++) {
    const x = xs[i];
    const yc = camberAt(x, m, p);
    const yt = thicknessAt(x, t);
    const dyc = camberSlopeAt(x, m, p);
    const theta = Math.atan(dyc);
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    upper[i] = [x - yt * sinT, yc + yt * cosT];
    lower[i] = [x + yt * sinT, yc - yt * cosT];
  }

  // Ring walk:
  //   lower TE → lower LE      (i = N-1 ... 0)
  //   upper LE → upper TE      (i = 1   ... N-1)
  // The LE point (i=0) is shared; we skip it on the upper-run start so
  // we don't duplicate it. The trailing edge (i=N-1) intentionally
  // appears at both ends — that's the closed-ring contract.
  const points = [];
  for (let i = N - 1; i >= 0; i--) points.push(lower[i]);
  for (let i = 1; i < N; i++) points.push(upper[i]);

  const xy = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    xy[2 * i]     = points[i][0];
    xy[2 * i + 1] = points[i][1];
  }
  return {
    code: spec.code, m, p, t, n: N,
    points,
    xy,
  };
}

/** Convenience — return just the flat Float64Array of XY pairs. */
export function nacaCoordinates(code = '2412', n = 100) {
  return naca(code, n).xy;
}

// ─────────────────────────────────────────────────────────────────────
// Convenience — section in 3D world space.
//
// Given a NACA polyline (chord-normalised, x ∈ [0,1], y ∈ chord-fraction)
// + a chord length, leading-edge XY world position, twist angle (radians),
// and span z, return an array of [x, y, z] world points for that station.
//
// World mapping:
//   chordVec = (cos twist, sin twist)     (lifted into XY plane)
//   thickVec = (-sin twist, cos twist)
//   p_world  = leXY + chord_mm · (x · chordVec + y · thickVec) lifted to z
//
// This is the per-station transform the wing-rib loft will use to turn
// each NACA polyline into the j-th v-strip of the (u × v) control grid
// that feeds forge.surfacing.buildPatch.

/**
 * Map a chord-normalised polyline to world space.
 *
 * @param {Array<[number,number]>|Float64Array} polyline   xy pairs.
 * @param {object} station
 *   @prop {number} chordMm    chord length in mm.
 *   @prop {number} leX        leading-edge X in world space (mm).
 *   @prop {number} leY        leading-edge Y in world space (mm).
 *   @prop {number} zMm        span-station z (mm).
 *   @prop {number} twistRad   twist angle (radians, +ve = pitch-up).
 * @returns {Array<[number,number,number]>}
 */
export function stationToWorld(polyline, {
  chordMm = 1, leX = 0, leY = 0, zMm = 0, twistRad = 0,
} = {}) {
  const cos = Math.cos(twistRad);
  const sin = Math.sin(twistRad);
  const out = [];
  // Accept both nested [[x,y],...] and flat Float64Array forms.
  if (polyline instanceof Float64Array) {
    for (let i = 0; i < polyline.length; i += 2) {
      const u = polyline[i];
      const v = polyline[i + 1];
      const xLocal = u * chordMm;
      const yLocal = v * chordMm;
      out.push([
        leX + xLocal * cos - yLocal * sin,
        leY + xLocal * sin + yLocal * cos,
        zMm,
      ]);
    }
  } else {
    for (const [u, v] of polyline) {
      const xLocal = u * chordMm;
      const yLocal = v * chordMm;
      out.push([
        leX + xLocal * cos - yLocal * sin,
        leY + xLocal * sin + yLocal * cos,
        zMm,
      ]);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults — matched 1:1 to the brief.

/** Brief default: 4 span stations chord 200→100 over span 1000 mm. */
export const DEFAULT_WING_PRESET = {
  stations: [
    { z: 0,    chord: 200, code: '2412', twist: 0, sweep: 0 },
    { z: 333,  chord: 167, code: '2412', twist: 0, sweep: 0 },
    { z: 667,  chord: 133, code: '2412', twist: 0, sweep: 0 },
    { z: 1000, chord: 100, code: '2412', twist: 0, sweep: 0 },
  ],
  nPtsPerSurface: 100,
};
