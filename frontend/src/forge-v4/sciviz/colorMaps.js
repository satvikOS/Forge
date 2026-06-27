// sciviz/colorMaps.js — ParaView-parity canonical color presets + TransferFunction.
// ============================================================================
// Task #65 (ParaView→Forge native sci-viz), Increment 0.
//
// This module consolidates the scattered colour ramps that lived in
// cfdVisualisation.js (jet / viridis polynomial fits) and caeViz.js (a 6-stop
// turbo) into ONE canonical, control-point based set of the ParaView presets,
// plus a real ParaView-style TransferFunction:
//
//   • editable COLOR control points (piece-wise linear RGB interpolation — the
//     ParaView "RGB" colour-space mode),
//   • a SEPARATE piece-wise-linear OPACITY (alpha) map,
//   • linear / log / symlog data-range scaling,
//   • N-band discretisation,
//   • fixed-vs-auto range,
//   • an explicit NaN colour,
//   • bake-to-LUT (Float32Array RGBA, optional THREE.DataTexture) for the GPU.
//
// Pure JS — no THREE required to evaluate colours or bake the Float32 LUT, so
// every gate runs head-less. THREE is only touched (optionally) to wrap the
// baked LUT in a DataTexture, mirroring the inject-THREE pattern used across
// the forge-v4 viz modules.
//
// No new deps. No fabricated colour science: the Cool-to-Warm table below is
// the canonical Kenneth Moreland diverging map shipped as ParaView's default
// "Cool to Warm" preset (33 RGBPoints, normalised 0..1).
// ============================================================================

// ───────────────────────────────────────────────────────────────────────────
//  Preset colour control points.  Each preset = { name, space, points }
//  where points = [{ x, rgb:[r,g,b] }, …] sorted by x ∈ [0,1], rgb ∈ [0,1].
//  `space` is informational ('diverging' | 'sequential' | 'rainbow').
// ───────────────────────────────────────────────────────────────────────────

// ParaView default "Cool to Warm" — Moreland diverging map (the genuine
// 33-point RGBPoints table; endpoints + the 0.5 grey are exact).
const COOL_TO_WARM_POINTS = [
  [0.00000, 0.2298057, 0.298717966, 0.753683153],
  [0.03125, 0.26623388, 0.353094838, 0.801466763],
  [0.06250, 0.30386891, 0.406535296, 0.84495867],
  [0.09375, 0.342804478, 0.458757618, 0.883725899],
  [0.12500, 0.38301334, 0.50941904, 0.917387822],
  [0.15625, 0.424369608, 0.558148092, 0.945619588],
  [0.18750, 0.46666708, 0.604562568, 0.968154911],
  [0.21875, 0.509635204, 0.648280772, 0.98478814],
  [0.25000, 0.552953156, 0.688929332, 0.995375608],
  [0.28125, 0.596262162, 0.726149107, 0.999836203],
  [0.31250, 0.639176211, 0.759599947, 0.998151185],
  [0.34375, 0.681291281, 0.788964712, 0.990363227],
  [0.37500, 0.722193294, 0.813952739, 0.976574709],
  [0.40625, 0.761464949, 0.834302879, 0.956945269],
  [0.43750, 0.798691636, 0.849786142, 0.931688648],
  [0.46875, 0.833466556, 0.860207984, 0.901068838],
  [0.50000, 0.865395256, 0.865395256, 0.865395256],
  [0.53125, 0.897787179, 0.848937047, 0.820880546],
  [0.56250, 0.924127593, 0.827384882, 0.774508472],
  [0.59375, 0.944468518, 0.800927443, 0.726736146],
  [0.62500, 0.958852946, 0.769767752, 0.678007945],
  [0.65625, 0.96732803, 0.734132809, 0.628751763],
  [0.68750, 0.969954137, 0.694266682, 0.579375448],
  [0.71875, 0.966811177, 0.650421156, 0.530263762],
  [0.75000, 0.958003065, 0.602842431, 0.481775914],
  [0.78125, 0.943660866, 0.551750968, 0.434243684],
  [0.81250, 0.923944917, 0.49730856, 0.387970225],
  [0.84375, 0.89904617, 0.439559467, 0.343229596],
  [0.87500, 0.869186849, 0.378313092, 0.300267182],
  [0.90625, 0.834620542, 0.312874446, 0.259301199],
  [0.93750, 0.795631745, 0.24128379, 0.220525627],
  [0.96875, 0.752534934, 0.157246067, 0.184115123],
  [1.00000, 0.705673158, 0.01555616, 0.150232812],
];

// matplotlib viridis (perceptually-uniform sequential) — 11 genuine samples.
const VIRIDIS_POINTS = [
  [0.0, 0.267004, 0.004874, 0.329415],
  [0.1, 0.282623, 0.140926, 0.457517],
  [0.2, 0.253935, 0.265254, 0.529983],
  [0.3, 0.206756, 0.371758, 0.553117],
  [0.4, 0.163625, 0.471133, 0.558148],
  [0.5, 0.127568, 0.566949, 0.550556],
  [0.6, 0.134692, 0.658636, 0.517649],
  [0.7, 0.266941, 0.748751, 0.440573],
  [0.8, 0.477504, 0.821444, 0.318195],
  [0.9, 0.741388, 0.873449, 0.149561],
  [1.0, 0.993248, 0.906157, 0.143936],
];

// matplotlib inferno.
const INFERNO_POINTS = [
  [0.0, 0.001462, 0.000466, 0.013866],
  [0.125, 0.087411, 0.044556, 0.224813],
  [0.25, 0.258234, 0.038571, 0.406485],
  [0.375, 0.416331, 0.090203, 0.432943],
  [0.5, 0.578304, 0.148039, 0.404411],
  [0.625, 0.735683, 0.215906, 0.330245],
  [0.75, 0.865006, 0.316822, 0.226055],
  [0.875, 0.954506, 0.468744, 0.099874],
  [1.0, 0.988362, 0.998364, 0.644924],
];

// matplotlib plasma.
const PLASMA_POINTS = [
  [0.0, 0.050383, 0.029803, 0.527975],
  [0.125, 0.243113, 0.014439, 0.610526],
  [0.25, 0.417642, 0.000564, 0.65839],
  [0.375, 0.578304, 0.110588, 0.620644],
  [0.5, 0.69284, 0.165141, 0.564522],
  [0.625, 0.798216, 0.280197, 0.469538],
  [0.75, 0.881443, 0.392529, 0.383229],
  [0.875, 0.949217, 0.517763, 0.295662],
  [1.0, 0.940015, 0.975158, 0.131326],
];

// Google "Turbo" — improved rainbow (anchors from the published map).
const TURBO_POINTS = [
  [0.0, 0.18995, 0.07176, 0.23217],
  [0.142857, 0.27543, 0.38730, 0.83926],
  [0.285714, 0.20860, 0.66386, 0.93409],
  [0.428571, 0.21662, 0.89703, 0.61721],
  [0.571429, 0.56541, 0.99425, 0.27867],
  [0.714286, 0.91499, 0.83158, 0.20654],
  [0.857143, 0.99314, 0.49419, 0.10026],
  [1.0, 0.79610, 0.10342, 0.03575],
];

// Classic MATLAB "jet" as control points (rainbow; kept for legacy parity).
const JET_POINTS = [
  [0.0, 0.0, 0.0, 0.5],
  [0.125, 0.0, 0.0, 1.0],
  [0.375, 0.0, 1.0, 1.0],
  [0.625, 1.0, 1.0, 0.0],
  [0.875, 1.0, 0.0, 0.0],
  [1.0, 0.5, 0.0, 0.0],
];

// ParaView "Black-Body Radiation" — black → red → orange → yellow → white.
const BLACK_BODY_POINTS = [
  [0.0, 0.0, 0.0, 0.0],
  [0.333, 0.901961, 0.0, 0.0],
  [0.666, 0.901961, 0.901961, 0.0],
  [1.0, 1.0, 1.0, 1.0],
];

// Grayscale (sequential).
const GRAYSCALE_POINTS = [
  [0.0, 0.0, 0.0, 0.0],
  [1.0, 1.0, 1.0, 1.0],
];

function toPoints(rows) {
  return rows.map(([x, r, g, b]) => ({ x, rgb: [r, g, b] }));
}

export const COLOR_PRESETS = {
  'Cool to Warm': { name: 'Cool to Warm', space: 'diverging', points: toPoints(COOL_TO_WARM_POINTS) },
  Viridis: { name: 'Viridis', space: 'sequential', points: toPoints(VIRIDIS_POINTS) },
  Inferno: { name: 'Inferno', space: 'sequential', points: toPoints(INFERNO_POINTS) },
  Plasma: { name: 'Plasma', space: 'sequential', points: toPoints(PLASMA_POINTS) },
  Turbo: { name: 'Turbo', space: 'rainbow', points: toPoints(TURBO_POINTS) },
  Jet: { name: 'Jet', space: 'rainbow', points: toPoints(JET_POINTS) },
  'Black-Body': { name: 'Black-Body', space: 'sequential', points: toPoints(BLACK_BODY_POINTS) },
  Grayscale: { name: 'Grayscale', space: 'sequential', points: toPoints(GRAYSCALE_POINTS) },
};

export const PRESET_NAMES = Object.keys(COLOR_PRESETS);

// ───────────────────────────────────────────────────────────────────────────
//  Low-level helpers.
// ───────────────────────────────────────────────────────────────────────────

function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }

/**
 * Piece-wise-linear lookup over a sorted control-point list.
 * `points` = [{ x, rgb:[r,g,b] }]; t already in [0,1]. Returns [r,g,b].
 */
export function sampleControlPoints(points, t) {
  const x = clamp01(t);
  const n = points.length;
  if (n === 0) return [0, 0, 0];
  if (x <= points[0].x) return points[0].rgb.slice();
  if (x >= points[n - 1].x) return points[n - 1].rgb.slice();
  // binary search for the bracketing interval
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const span = b.x - a.x;
  const f = span > 0 ? (x - a.x) / span : 0;
  return [
    a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f,
    a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f,
    a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f,
  ];
}

/** Piece-wise-linear scalar lookup (used for the opacity map). */
export function sampleScalarPoints(points, t) {
  const x = clamp01(t);
  const n = points.length;
  if (n === 0) return 1;
  if (x <= points[0].x) return points[0].a;
  if (x >= points[n - 1].x) return points[n - 1].a;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid; else hi = mid;
  }
  const a = points[lo], b = points[hi];
  const span = b.x - a.x;
  const f = span > 0 ? (x - a.x) / span : 0;
  return a.a + (b.a - a.a) * f;
}

/** Convenience: evaluate a named preset at t ∈ [0,1]. Returns [r,g,b]. */
export function samplePreset(name, t) {
  const preset = COLOR_PRESETS[name];
  if (!preset) throw new Error(`colorMaps: unknown preset "${name}"`);
  return sampleControlPoints(preset.points, t);
}

// ───────────────────────────────────────────────────────────────────────────
//  TransferFunction — the ParaView colour+opacity transfer function.
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_OPACITY_POINTS = [
  { x: 0, a: 1 },
  { x: 1, a: 1 },
];

export class TransferFunction {
  /**
   * @param {object} opts
   *   preset        preset name (default 'Cool to Warm') — sets colorPoints
   *   colorPoints   explicit [{x,rgb}] (overrides preset)
   *   opacityPoints explicit [{x,a}]   (default flat α=1)
   *   range         [lo,hi] data range mapped to [0,1] (default [0,1])
   *   scale         'linear' | 'log' | 'symlog' (default 'linear')
   *   symlogLinThresh  linear-region half-width for symlog (default 1)
   *   discretize    integer band count, 0 = continuous (default 0)
   *   nanColor      [r,g,b] for NaN / non-finite values (default mid-grey)
   *   nanOpacity    α for NaN (default 1)
   */
  constructor(opts = {}) {
    const presetName = opts.preset || 'Cool to Warm';
    const preset = COLOR_PRESETS[presetName];
    this.presetName = preset ? presetName : null;
    this.colorPoints = (opts.colorPoints
      ? opts.colorPoints.map((p) => ({ x: p.x, rgb: p.rgb.slice() }))
      : (preset ? preset.points.map((p) => ({ x: p.x, rgb: p.rgb.slice() })) : []));
    this.opacityPoints = (opts.opacityPoints
      ? opts.opacityPoints.map((p) => ({ x: p.x, a: p.a }))
      : DEFAULT_OPACITY_POINTS.map((p) => ({ ...p })));
    this.range = Array.isArray(opts.range) && opts.range.length === 2
      ? [opts.range[0], opts.range[1]] : [0, 1];
    this.scale = opts.scale || 'linear';
    this.symlogLinThresh = Number.isFinite(opts.symlogLinThresh) ? opts.symlogLinThresh : 1;
    this.discretize = (opts.discretize | 0) || 0;
    this.nanColor = opts.nanColor ? opts.nanColor.slice() : [0.5, 0.5, 0.5];
    this.nanOpacity = Number.isFinite(opts.nanOpacity) ? opts.nanOpacity : 1;
    this._autoRange = false;
  }

  // ── range handling ────────────────────────────────────────────────────
  setRange(lo, hi) { this.range = [lo, hi]; this._autoRange = false; return this; }

  /** Auto-fit the range to a field's [min,max] (fixed-vs-auto support). */
  setAutoRange(field) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < field.length; i++) {
      const v = field[i];
      if (!Number.isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!Number.isFinite(mn)) { mn = 0; mx = 1; }
    if (mx <= mn) mx = mn + 1e-12;
    this.range = [mn, mx];
    this._autoRange = true;
    return this;
  }

  setScale(scale) { this.scale = scale; return this; }
  setDiscretize(n) { this.discretize = n | 0; return this; }
  setColorPreset(name) {
    const p = COLOR_PRESETS[name];
    if (!p) throw new Error(`colorMaps: unknown preset "${name}"`);
    this.presetName = name;
    this.colorPoints = p.points.map((q) => ({ x: q.x, rgb: q.rgb.slice() }));
    return this;
  }

  // ── data value → normalised t ∈ [0,1] under the chosen scale ──────────
  mapToUnit(value) {
    if (!Number.isFinite(value)) return null;
    const [lo, hi] = this.range;
    if (this.scale === 'log') {
      // log requires strictly positive bounds; clamp value into (lo,hi].
      const l0 = lo > 0 ? lo : 1e-12;
      const l1 = hi > l0 ? hi : l0 * 10;
      const v = value <= 0 ? l0 : value;
      const t = (Math.log(v) - Math.log(l0)) / (Math.log(l1) - Math.log(l0));
      return clamp01(t);
    }
    if (this.scale === 'symlog') {
      // symmetric log: linear in [-lt,lt], log outside; map symmetric range.
      const lt = this.symlogLinThresh > 0 ? this.symlogLinThresh : 1;
      const f = (x) => {
        const s = Math.sign(x);
        const a = Math.abs(x);
        return a <= lt ? x / lt : s * (1 + Math.log(a / lt));
      };
      const flo = f(lo), fhi = f(hi), fv = f(value);
      const span = fhi - flo;
      return clamp01(span !== 0 ? (fv - flo) / span : 0);
    }
    // linear
    const span = hi - lo;
    return clamp01(span !== 0 ? (value - lo) / span : 0);
  }

  /** Apply band discretisation to a unit value (returns the band-centre t). */
  _discretizeUnit(t) {
    const n = this.discretize;
    if (!n || n < 1) return t;
    let band = Math.floor(t * n);
    if (band >= n) band = n - 1;
    if (band < 0) band = 0;
    return (band + 0.5) / n;
  }

  // ── colour / opacity sampling ─────────────────────────────────────────
  /** Sample colour for a *unit* value t ∈ [0,1] (already range-mapped). */
  sampleColorUnit(t) {
    return sampleControlPoints(this.colorPoints, this._discretizeUnit(clamp01(t)));
  }

  /** Sample colour for a raw data value (applies range, scale, discretise, NaN). */
  sampleColor(value) {
    const t = this.mapToUnit(value);
    if (t === null) return this.nanColor.slice();
    return this.sampleColorUnit(t);
  }

  /** Sample opacity for a raw data value. */
  sampleOpacity(value) {
    const t = this.mapToUnit(value);
    if (t === null) return this.nanOpacity;
    return sampleScalarPoints(this.opacityPoints, this._discretizeUnit(t));
  }

  /** Sample RGBA for a raw data value → [r,g,b,a]. */
  sampleRGBA(value) {
    const t = this.mapToUnit(value);
    if (t === null) return [...this.nanColor, this.nanOpacity];
    const dt = this._discretizeUnit(t);
    const rgb = sampleControlPoints(this.colorPoints, dt);
    const a = sampleScalarPoints(this.opacityPoints, dt);
    return [rgb[0], rgb[1], rgb[2], a];
  }

  // ── bake to a 1-D LUT (Float32Array RGBA) + optional DataTexture ───────
  /**
   * @param {number} size   LUT width (default 256)
   * @param {object} [THREE] inject THREE to also build a DataTexture
   * @returns {{ rgba: Float32Array, size:number, texture?: object }}
   */
  bakeLUT(size = 256, THREE = null) {
    const n = Math.max(2, size | 0);
    const rgba = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const dt = this._discretizeUnit(t);
      const rgb = sampleControlPoints(this.colorPoints, dt);
      const a = sampleScalarPoints(this.opacityPoints, dt);
      rgba[i * 4 + 0] = rgb[0];
      rgba[i * 4 + 1] = rgb[1];
      rgba[i * 4 + 2] = rgb[2];
      rgba[i * 4 + 3] = a;
    }
    const out = { rgba, size: n };
    if (THREE) {
      const tex = new THREE.DataTexture(rgba, n, 1, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      out.texture = tex;
    }
    return out;
  }
}

export function makeTransferFunction(opts) { return new TransferFunction(opts); }

export default {
  COLOR_PRESETS, PRESET_NAMES,
  sampleControlPoints, sampleScalarPoints, samplePreset,
  TransferFunction, makeTransferFunction,
};
