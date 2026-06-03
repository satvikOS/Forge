// Forge-265 — Tuned mass damper smoke (Den Hartog).
//
// Building floor: m_p = 1000 kg, f_p = 2.5 Hz, μ = 0.05.
//   m_a = 0.05·1000 = 50 kg
//   f_opt = 1/(1+0.05) = 0.9524 → f_a = 0.9524·2.5 = 2.381 Hz
//   ζ_opt = √(3·0.05 / (8·1.05³)) = √(0.15/9.261) = √0.01619 = 0.1273
//   ω_a = 2π·2.381 = 14.96 rad/s
//   k_a = 50·14.96² = 11,190 N/m
//   c_a = 2·0.1273·50·14.96 = 190.4 Ns/m
//   TR_peak = √(1 + 2/0.05) = √41 = 6.403  (≈ μ → ∞: 1; μ → 0: ∞)

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r = kernel.tmd.sizeAbsorber({
  primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: 0.05,
});
console.log(r);
if (!approx(r.absorberMassKg, 50, 1e-9)) throw new Error('m_a off');
if (!approx(r.frequencyRatioOptimum, 0.9524, 0.001)) throw new Error('f_opt off');
if (!approx(r.dampingRatioOptimum, 0.1273, 0.01)) throw new Error('ζ_opt off');
if (!approx(r.absorberFrequencyHz, 2.381, 0.01)) throw new Error('f_a off');
if (!approx(r.absorberStiffnessNPerM, 11190, 0.005)) throw new Error('k_a off');
if (!approx(r.absorberDampingNsm, 190.4, 0.02)) throw new Error('c_a off');
if (!approx(r.peakTransmissibility, 6.403, 0.001)) throw new Error('TR_peak off');

// Higher mass ratio reduces TR_peak.
const r10 = kernel.tmd.sizeAbsorber({
  primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: 0.10,
});
if (!(r10.peakTransmissibility < r.peakTransmissibility))
  throw new Error('higher μ should reduce TR_peak');

console.log('OK — tmd smoke green');
