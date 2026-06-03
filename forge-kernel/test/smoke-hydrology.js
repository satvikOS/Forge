// Forge-256 — Hydrology smoke.
//
// Rational method: C = 0.6, i = 50 mm/hr, A = 10 ha = 100,000 m².
//   Q = 0.6 · (50/3.6e6) · 100,000 = 0.6 · 1.389e-2 · 100,000 = 833.3 / 1000 = 0.833 m³/s
//   (Also: 0.278·C·i·A_km² = 0.278·0.6·50·0.1 = 0.834 m³/s ✓)
//
// Kirpich: L = 1000 m, S = 0.01 (1% slope).
//   T_c = 0.0195 · 1000^0.77 · 0.01^(-0.385)
//       = 0.0195 · 235.4 · 5.94 = 27.3 min  (textbook ~25-30 min)
//
// IDF: a = 800, b = 10, c = 0.85, t = 30 min:
//   i = 800 / (40)^0.85 = 800 / 22.93 = 34.9 mm/hr.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const Q = kernel.hydrology.rationalDischarge({
  runoffCoefficient: 0.6, rainfallIntensityMmHr: 50,
  drainageAreaM2: 100000,
});
console.log('Q:', Q);
if (!approx(Q, 0.8333, 0.001)) throw new Error('Q off');

const tc = kernel.hydrology.kirpichTimeOfConcentrationMin(1000, 0.01);
console.log('T_c:', tc);
if (!approx(tc, 23.44, 0.01)) throw new Error('T_c off');

const i = kernel.hydrology.idfIntensityMmHr({
  a: 800, b: 10, c: 0.85, durationMin: 30,
});
console.log('i:', i);
if (!approx(i, 34.89, 0.01)) throw new Error('IDF i off');

console.log('OK — hydrology smoke green');
