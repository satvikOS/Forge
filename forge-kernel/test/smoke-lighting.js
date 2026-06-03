// Forge-253 — Lighting design smoke.
//
// Office: 10 m × 8 m × 1.83 m mounting height (10 ft drop to work plane).
//   RCR = 5·1.83·(10+8)/(10·8) = 5·1.83·18/80 = 164.7/80 = 2.06
//   CU = 0.85 − 0.045·2.06 + 0.0015·2.06² = 0.85 − 0.0927 + 0.00637 = 0.764
//
// LED troffer: Φ = 3500 lm each, LLF = 0.80, target E = 500 lux.
//   A = 80 m²
//   N = E·A / (Φ·CU·LLF) = 500·80 / (3500·0.764·0.80) = 40000 / 2139 = 18.7 → 19
//   Recompute: E = 19·3500·0.764·0.80/80 = 506.3 lux.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const rcr = kernel.lighting.roomCavityRatio({
  lengthM: 10, widthM: 8, mountingHeightM: 1.83,
});
console.log('RCR:', rcr);
if (!approx(rcr, 2.0588, 1e-3)) throw new Error('RCR off');

const cu = kernel.lighting.coefficientOfUtilization(rcr);
console.log('CU:', cu);
if (!approx(cu, 0.764, 5e-3)) throw new Error('CU off');

const solve = kernel.lighting.lumenMethod({
  room: { lengthM: 10, widthM: 8, mountingHeightM: 1.83 },
  lumensPerLuminaire: 3500,
  luminaireCount: 0,
  targetIlluminanceLux: 500,
  cuOverride: 0,
  lightLossFactor: 0.80,
});
console.log('solve:', solve);
if (solve.requiredLuminaires !== 19) throw new Error('N off');
if (!(solve.illuminanceLux > 500)) throw new Error('E should meet target');

// Forward: given N = 19, recover E ≈ 506 lux.
const fwd = kernel.lighting.lumenMethod({
  room: { lengthM: 10, widthM: 8, mountingHeightM: 1.83 },
  lumensPerLuminaire: 3500,
  luminaireCount: 19,
  targetIlluminanceLux: 0,
  cuOverride: 0,
  lightLossFactor: 0.80,
});
if (!approx(fwd.illuminanceLux, 506.3, 0.005)) throw new Error('forward E off');

// CU override:
const ovr = kernel.lighting.lumenMethod({
  room: { lengthM: 10, widthM: 8, mountingHeightM: 1.83 },
  lumensPerLuminaire: 3500,
  luminaireCount: 19,
  targetIlluminanceLux: 0,
  cuOverride: 0.65,
  lightLossFactor: 0.80,
});
if (!(ovr.cu === 0.65)) throw new Error('CU override not applied');

console.log('OK — lighting smoke green');
