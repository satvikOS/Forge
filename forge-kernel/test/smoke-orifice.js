// Forge-266 — Orifice plate smoke (Sandwiched-corner taps, water).
//
// Water in 100 mm pipe, 50 mm orifice → β = 0.5.
// ΔP = 50 kPa, ρ = 1000 kg/m³, μ = 1e-3 Pa·s, incompressible.
//
// β⁴ = 0.0625; 1−β⁴ = 0.9375; √(1−β⁴) = 0.9683.
// A_d = π/4·(0.05)² = 1.963e-3 m²
// Initial C ≈ 0.61. Iterate Re_D.
//
// Approximate first guess:
//   ṁ ≈ (0.61/0.9683)·1.963e-3·√(2·1000·50000) = 0.630·1.963e-3·316.2 = 0.391 kg/s
//   Re_D = 4·0.391/(π·0.1·1e-3) = 4970 — borderline.
// At Re_D ≈ 5000 R-H/G C ≈ 0.61 (close to initial). Iteration converges.
// ṁ ≈ 0.39 kg/s; Q ≈ 3.9e-4 m³/s = 0.39 L/s. (Small pipe, sharp ΔP).
//
// To get clearly inside Re range, use larger ΔP:
//   ΔP = 500 kPa → ṁ ≈ 1.24 kg/s, Re ≈ 15700.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r = kernel.orificeplate.analyse({
  pipeDiameterM: 0.1, orificeDiameterM: 0.05,
  upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
  differentialPressurePa: 500000,
  compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
});
console.log(r);

if (!approx(r.betaRatio, 0.5, 1e-9)) throw new Error('β off');
if (!approx(r.throatAreaM2, Math.PI / 4 * 0.05 * 0.05, 1e-9))
  throw new Error('A off');
if (!(r.dischargeCoefficient > 0.59 && r.dischargeCoefficient < 0.62))
  throw new Error('C out of range');
if (r.expansibilityFactor !== 1.0)
  throw new Error('liquid ε should be 1');
// ṁ closed form: (C·ε/√(1−β⁴))·A·√(2·ρ·ΔP)
//   = (0.604/0.9683)·1.963e-3·√(2·1000·5e5)
//   = 0.624·1.963e-3·31623 = 38.7 kg/s
if (!(r.massFlowKgS > 30 && r.massFlowKgS < 45))
  throw new Error('ṁ off');
if (!(r.reynoldsNumberD > 100000))
  throw new Error('Re too low');

// Gas case (air at p_1 = 200 kPa, ΔP = 20 kPa, κ = 1.4):
const gas = kernel.orificeplate.analyse({
  pipeDiameterM: 0.1, orificeDiameterM: 0.05,
  upstreamDensityKgM3: 2.38, dynamicViscosityPas: 1.8e-5,
  differentialPressurePa: 20000,
  compressible: true, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 200000,
});
console.log('gas:', gas);
if (gas.expansibilityFactor >= 1.0)
  throw new Error('gas ε should be < 1');
if (gas.expansibilityFactor < 0.9)
  throw new Error('ε too low for 10% ΔP');

// β > 0.75 should throw.
let threw = false;
try {
  kernel.orificeplate.analyse({
    pipeDiameterM: 0.1, orificeDiameterM: 0.09,
    upstreamDensityKgM3: 1000, dynamicViscosityPas: 1e-3,
    differentialPressurePa: 50000,
    compressible: false, kappaSpecHeatRatio: 1.4, upstreamPressurePa: 0,
  });
} catch (e) { threw = true; }
if (!threw) throw new Error('β > 0.75 should throw');

console.log('OK — orifice smoke green');
