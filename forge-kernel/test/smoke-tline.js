// Forge-248 — Transmission line smoke (Stevenson Ex 5-1, medium π).
//
// 220 kV / 50 Hz / 200 km line; per-km Z = 0.16 + j0.5 Ω, Y = j3.0e-6 S.
// Receiving end: 220 kV LL (so V_R per-phase = 220e3/√3 = 127017 V),
//   P_R = 80 MW per-phase? Stevenson example uses 250 MW @ pf 0.85 lag total.
//
// For the smoke we'll use a smaller textbook fixture:
//   L = 200 km, r = 0.16 Ω/km, x = 0.5 Ω/km, g = 0, b = 3e-6 S/km
//   |V_R| (per-phase) = 127017 V, P_R (per-phase) = 50e6 W, pf = 0.85 lag.
//
// ABCD (medium π) closed form:
//   Z = (0.16 + j0.5)·200 = 32 + j100 Ω
//   Y = j6e-4 S
//   A = 1 + Y·Z/2 = 1 + j6e-4 · (32+j100)/2 = 1 + j3e-4 · (32+j100)
//     = 1 + (j9.6e-3 - 0.03) = 0.97 + j9.6e-3
//     |A| = 0.9701 ; ∠A ≈ 0.567°
//   B = Z = 32 + j100; |B| = 105.0; ∠ = 72.26°
//
// We assert: |A| ≈ 0.970, |B| ≈ 104.99, |D| = |A|, and the result returns
// finite values.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const params = {
  resistancePerKmOhm: 0.16, reactancePerKmOhm: 0.5,
  conductancePerKmS: 0, susceptancePerKmS: 3e-6,
  lengthKm: 200,
};

const ab_short = kernel.tline.abcd({ model: 'short', params });
console.log('short ABCD:', ab_short);
if (!approx(ab_short.A_mag, 1.0, 1e-9)) throw new Error('short |A| ≠ 1');
if (!approx(ab_short.B_mag, Math.sqrt(32 * 32 + 100 * 100), 1e-6))
  throw new Error('short |B| off');
if (ab_short.C_mag > 1e-9) throw new Error('short |C| ≠ 0');

const ab_mp = kernel.tline.abcd({ model: 'mediumPi', params });
console.log('mediumPi ABCD:', ab_mp);
if (!approx(ab_mp.A_mag, 0.9701, 1e-3)) throw new Error('medium |A| off');
if (!approx(ab_mp.B_mag, Math.sqrt(32 * 32 + 100 * 100), 1e-3))
  throw new Error('medium |B| off');
if (!approx(ab_mp.D_mag, ab_mp.A_mag, 1e-9)) throw new Error('medium D ≠ A');

const ab_long = kernel.tline.abcd({ model: 'long', params });
console.log('long ABCD:', ab_long);
// Long-line A should be close to medium π's A for 200 km (small difference).
if (!approx(ab_long.A_mag, ab_mp.A_mag, 0.005))
  throw new Error('long-line A diverges too much from medium π');

const r = kernel.tline.analyse({
  model: 'mediumPi', params,
  load: {
    receivingPhaseVoltageV: 127017, receivingPowerW: 50e6,
    receivingPowerFactor: 0.85, leading: false,
  },
});
console.log('analyse:', r);
if (!(r.sendingVoltageV > 127017)) throw new Error('|V_S| should exceed |V_R| at lag pf');
if (!(r.regulationPct > 0)) throw new Error('reg% should be > 0 for lag');
if (!(r.efficiency > 0.7 && r.efficiency <= 1.0))
  throw new Error('η should be between 0.7 and 1');

console.log('OK — tline smoke green');
