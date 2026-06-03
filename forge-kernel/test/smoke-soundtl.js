// Forge-263 — Sound transmission loss smoke.
//
// Mass-law: 16 mm gypsum board, ρ_s = 12.5 kg/m², f = 500 Hz.
//   TL = 20·log₁₀(12.5·500) − 47 = 20·log₁₀(6250) − 47
//      = 20·3.7959 − 47 = 75.92 − 47 = 28.9 dB
//
// Doubling mass adds 6 dB:
//   ρ_s = 25 → TL = 20·log₁₀(12500) − 47 = 81.94 − 47 = 34.9 dB
//
// Doubling f adds 6 dB:
//   f = 1000 → TL = 20·log₁₀(12500) − 47 = 34.9 dB
//
// Composite: 8 m² wall at 50 dB + 0.5 m² door at 30 dB.
//   τ_wall = 10^(-5) = 1e-5
//   τ_door = 10^(-3) = 1e-3
//   τ_total = (8·1e-5 + 0.5·1e-3)/8.5 = (8e-5 + 5e-4)/8.5
//           = 5.8e-4/8.5 = 6.824e-5
//   TL = -10·log₁₀(6.824e-5) = 41.66 dB
//   (Heavy wall dragged down by leaky door.)

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

const tl = kernel.soundtl.massLawTL({
  surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 0,
});
console.log('TL:', tl);
if (!approx(tl, 28.92, 0.05)) throw new Error('mass law off');

const tlHeavy = kernel.soundtl.massLawTL({
  surfaceDensityKgPerM2: 25, frequencyHz: 500, coincidenceLossDb: 0,
});
if (!approx(tlHeavy - tl, 6.02, 0.01)) throw new Error('mass doubling not +6 dB');

const tlHigh = kernel.soundtl.massLawTL({
  surfaceDensityKgPerM2: 12.5, frequencyHz: 1000, coincidenceLossDb: 0,
});
if (!approx(tlHigh - tl, 6.02, 0.01)) throw new Error('f doubling not +6 dB');

// Coincidence loss.
const tlCoincide = kernel.soundtl.massLawTL({
  surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 8,
});
if (!approx(tlCoincide, tl - 8, 1e-6)) throw new Error('coincidence loss off');

const composite = kernel.soundtl.compositeTL({
  elements: [
    { areaM2: 8.0, transmissionLossDb: 50 },
    { areaM2: 0.5, transmissionLossDb: 30 },
  ],
});
console.log('composite:', composite);
if (!approx(composite, 41.66, 0.05)) throw new Error('composite off');

// Heavy wall alone: TL stays at element value.
const wallOnly = kernel.soundtl.compositeTL({
  elements: [{ areaM2: 8.0, transmissionLossDb: 50 }],
});
if (!approx(wallOnly, 50, 1e-6)) throw new Error('single-element TL not preserved');

console.log('OK — soundtl smoke green');
