// Forge-260 — Vibration isolation smoke (Rao Ex 9.3).
//
// Compressor: m = 200 kg, design frequency = 50 Hz (3000 rpm).
//
// Sizing for 90% isolation, ζ = 0.05:
//   TR_target = 0.10
//   r² = 1 + 1/0.10 = 11; r = √11 = 3.317
//   ω_n = ω/r = (2π·50)/3.317 = 94.7 rad/s
//   f_n = 15.07 Hz
//   k = m·ω_n² = 200·94.7² = 1,793,510 N/m ≈ 1.794 MN/m
//
// Response with k = 1.794e6:
//   ω_n = √(1.794e6/200) = √8970 = 94.7 rad/s, f_n = 15.07 Hz
//   r = 50/15.07 = 3.317
//   ζ = 0.05 → 2ζr = 0.332
//   TR = √((1+0.110)/((1−11)² + 0.110)) = √(1.110/100.110) = 0.1054
//   isolation = 89.5%

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const sz = kernel.vibiso.sizeIsolator({
  massKg: 200, drivingFrequencyHz: 50,
  targetIsolationPct: 90, dampingRatio: 0.05,
});
console.log('size:', sz);
if (!approx(sz.requiredFrequencyRatio, 3.317, 0.01))
  throw new Error('r off');
if (!approx(sz.requiredNaturalFrequencyHz, 15.07, 0.01))
  throw new Error('f_n off');
if (!approx(sz.requiredStiffnessNPerM, 1.794e6, 0.01))
  throw new Error('k off');

const resp = kernel.vibiso.response({
  massKg: 200, stiffnessNPerM: 1.794e6,
  dampingCoefficientNsm: 2 * 0.05 * Math.sqrt(200 * 1.794e6),  // ζ=0.05
  drivingFrequencyHz: 50,
});
console.log('response:', resp);
if (!approx(resp.naturalFrequencyHz, 15.07, 0.01))
  throw new Error('response f_n off');
if (!approx(resp.dampingRatio, 0.05, 1e-9))
  throw new Error('damping ratio off');
if (!approx(resp.frequencyRatio, 3.317, 0.01))
  throw new Error('response r off');
if (!approx(resp.transmissibility, 0.1054, 0.02))
  throw new Error('TR off');
if (!approx(resp.isolationPct, 89.5, 0.01))
  throw new Error('isolation% off');

// r < √2: no isolation (TR > 1, isolation = 0).
const noiso = kernel.vibiso.response({
  massKg: 200, stiffnessNPerM: 2e8,  // very stiff → f_n high → r low
  dampingCoefficientNsm: 0, drivingFrequencyHz: 50,
});
console.log('no iso:', noiso);
if (!(noiso.frequencyRatio < Math.sqrt(2)))
  throw new Error('expected r < √2');
if (!(noiso.isolationPct === 0))
  throw new Error('expected isolation% = 0');

console.log('OK — vibiso smoke green');
