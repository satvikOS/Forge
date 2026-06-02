// Forge-242 — Open-channel flow smoke (Chow / Sturm textbook).
//
// Trapezoidal: b = 3 m, m = 2, n = 0.025, S = 0.0015.
// Direct Q at y = 2 m:
//   A = (3 + 2·2)·2 = 14 m²
//   P = 3 + 2·2·√(1+4) = 3 + 4·2.2361 = 11.944 m
//   R = 14 / 11.944 = 1.172 m
//   Q = (1/0.025)·14·1.172^(2/3)·√0.0015
//     = 40·14·1.111·0.0387
//     ≈ 24.10 m³/s
//
// Reverse: target Q = 24.10 m³/s → y_n ≈ 2.00 m.
//
// Critical depth for Q = 24.10 m³/s, g = 9.81:
//   Solve Q²·T/(g·A³) = 1.
//   y_c will be < y_n for mild slope ⇒ subcritical.
//   Check Fr at y_n is < 1.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const geom = { bottomWidthM: 3, sideSlopeM: 2 };

const sect = kernel.openchannel.sectionAtDepth({ geom, depthM: 2.0 });
console.log('section:', sect);
if (!approx(sect.area, 14.0, 1e-6))       throw new Error('A off');
if (!approx(sect.wetPerim, 3 + 4 * Math.sqrt(5), 1e-6)) throw new Error('P off');
if (!approx(sect.hydraulicRadius, 14.0 / (3 + 4 * Math.sqrt(5)), 1e-6))
  throw new Error('R off');
if (!approx(sect.topWidth, 11.0, 1e-6))   throw new Error('T off');

const Q = kernel.openchannel.manningDischarge({
  geom, manningN: 0.025, slope: 0.0015, depthM: 2.0,
});
console.log('Q:', Q);
if (!approx(Q, 24.10, 0.01)) throw new Error('Q off, got ' + Q);

const yn = kernel.openchannel.normalDepth({
  geom, manningN: 0.025, slope: 0.0015, targetDischarge: Q,
});
console.log('y_n:', yn);
if (!approx(yn, 2.0, 1e-3)) throw new Error('y_n off');

const yc = kernel.openchannel.criticalDepth({
  geom, dischargeQ: Q, gravityG: 9.81,
});
console.log('y_c:', yc);
if (!(yc > 0 && yc < yn)) throw new Error('y_c should be less than y_n for mild slope');

const regime = kernel.openchannel.flowRegime({
  geom, depthM: yn, dischargeQ: Q, gravityG: 9.81,
});
console.log('regime:', regime);
if (regime.regime !== 1) throw new Error('expected subcritical at normal depth');
if (!(regime.froude < 1.0)) throw new Error('expected Fr < 1');

// Supercritical check: at y_c, Fr = 1 (within tolerance).
const at_yc = kernel.openchannel.flowRegime({
  geom, depthM: yc, dischargeQ: Q, gravityG: 9.81,
});
console.log('at y_c:', at_yc);
if (!approx(at_yc.froude, 1.0, 1e-3)) throw new Error('Fr at y_c should = 1');

console.log('OK — openchannel smoke green');
