// Forge-243 — Weir / orifice smoke.
//
// Rectangular: L = 2 m, H = 0.3 m, C_d = 0.62, no contractions.
//   Q = (2/3)·0.62·2·√(19.62)·0.3^1.5
//     = 0.8267·2·4.4294·0.1643
//     = 0.4496·1.7173·1.0 ... let me redo carefully:
//   0.6667 · 0.62 = 0.4133
//   · 2 = 0.8267
//   · √(2·9.81) = · 4.4294 = 3.6610
//   · 0.3^1.5 = · 0.16432 = 0.6015 m³/s
//
// V-notch: θ = 90°, H = 0.2, C_d = 0.58:
//   Q = (8/15)·0.58·√(19.62)·tan(45°)·0.2^2.5
//     = 0.5333·0.58·4.4294·1·0.01789
//     = 0.02451 m³/s
//
// Orifice: A = 0.01 m², H = 1.5 m, C_d = 0.62:
//   Q = 0.62·0.01·√(2·9.81·1.5)
//     = 0.62·0.01·5.4239 = 0.03363 m³/s

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const Qr = kernel.weir.rectWeirDischarge({
  crestLengthM: 2.0, headM: 0.3, dischargeCoeff: 0.62,
  endContractions: 0, gravityG: 9.81,
});
console.log('rect:', Qr);
if (!approx(Qr, 0.6015, 0.01)) throw new Error('rect Q off, got ' + Qr);

// End contractions reduce flow.
const Qr2 = kernel.weir.rectWeirDischarge({
  crestLengthM: 2.0, headM: 0.3, dischargeCoeff: 0.62,
  endContractions: 2, gravityG: 9.81,
});
if (!(Qr2 < Qr)) throw new Error('end contractions should reduce Q');

const Qv = kernel.weir.vNotchDischarge({
  notchAngleDeg: 90, headM: 0.2, dischargeCoeff: 0.58, gravityG: 9.81,
});
console.log('v-notch:', Qv);
if (!approx(Qv, 0.02451, 0.01)) throw new Error('v-notch off, got ' + Qv);

const Qo = kernel.weir.orificeDischarge({
  areaM2: 0.01, headM: 1.5, dischargeCoeff: 0.62, gravityG: 9.81,
});
console.log('orifice:', Qo);
if (!approx(Qo, 0.03363, 0.01)) throw new Error('orifice off, got ' + Qo);

// Q ∝ H^1.5 for rect: H × 4 → Q × 8.
const Qr_4H = kernel.weir.rectWeirDischarge({
  crestLengthM: 2.0, headM: 1.2, dischargeCoeff: 0.62,
  endContractions: 0, gravityG: 9.81,
});
if (!approx(Qr_4H / Qr, 8.0, 0.01)) throw new Error('Q/H^1.5 scaling off');

// Q ∝ √H for orifice: H × 4 → Q × 2.
const Qo_4H = kernel.weir.orificeDischarge({
  areaM2: 0.01, headM: 6.0, dischargeCoeff: 0.62, gravityG: 9.81,
});
if (!approx(Qo_4H / Qo, 2.0, 0.001)) throw new Error('Q/√H scaling off');

console.log('OK — weir smoke green');
