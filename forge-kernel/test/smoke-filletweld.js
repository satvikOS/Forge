// Forge-237 — Fillet weld smoke (AISC J2 + AWS D1.1).
//
// Textbook: w = 6 mm, L = 200 mm (single line), E70xx F_EXX = 480 MPa,
// t_thicker = 12 mm, t_edge = 10 mm.
//   t_e   = 0.707·0.006 = 4.243e-3 m
//   F_nw  = 0.60·480 MPa = 288 MPa
//   r_n   = 288e6 · 4.243e-3 = 1.222e6 N/m = 1222 N/mm
//   φr_n  = 0.75 · 1222 = 916.5 N/mm
//   φR_n  = 916.5 · 200 = 183,300 N ≈ 183 kN
//
// AWS min for t_thicker = 12 mm → 5 mm.   w = 6 mm > 5 mm → OK.
// AISC max for t_edge   = 10 mm  → 10 − 1.6 = 8.4 mm.   w = 6 mm < 8.4 → OK.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

const r = kernel.filletweld.analyse({
  legSizeM: 0.006, weldLengthM: 0.200, electrodeFexxPa: 480e6,
  thickerPlateM: 0.012, edgePlateM: 0.010, phi: 0.75,
});
console.log(r);
if (!approx(r.effectiveThroatM, 4.243e-3, 1e-5)) throw new Error('throat off');
if (!approx(r.designPerUnitNPerM / 1000, 916.5, 1.0)) throw new Error('φr_n off');
if (!approx(r.totalDesignN / 1000, 183.3, 0.5)) throw new Error('φR_n off');
if (!approx(r.awsMinLegM, 5e-3, 1e-9))     throw new Error('AWS min off');
if (!approx(r.aiscMaxLegM, 8.4e-3, 1e-9))   throw new Error('AISC max off');
if (r.legBelowAwsMin !== false)             throw new Error('AWS min flag wrong');
if (r.legAboveAiscMax !== false)            throw new Error('AISC max flag wrong');

// Negative case: undersized weld on 20 mm plate.
const r2 = kernel.filletweld.analyse({
  legSizeM: 0.004, weldLengthM: 0.200, electrodeFexxPa: 480e6,
  thickerPlateM: 0.020, edgePlateM: 0.020, phi: 0.75,
});
if (r2.awsMinLegM !== 8e-3) throw new Error('AWS min 20 mm plate wrong');
if (r2.legBelowAwsMin !== true) throw new Error('expected below-min flag');

console.log('OK — filletweld smoke green');
