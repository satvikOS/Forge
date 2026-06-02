// Forge-241 — Pile capacity smoke (Das textbook 9.3 style).
//
// d = 0.5 m. Two layers:
//   1. Stiff clay, t = 10 m, γ' = 17 kN/m³, c_u = 50 kPa, α = 0.8
//   2. Dense sand, t = 5 m, γ' = 10 kN/m³, φ = 36°, β = 0.5
// N_q at tip = 100 (Meyerhof for φ=36° loose-to-medium)
// q_p,limit = 11000 kPa.
// FS = 3.
//
// Geometry:
//   A_p = π·0.5²/4 = 0.1963 m²
//   perim = π·0.5 = 1.5708 m
//
// Layer 1 (clay):
//   σ'_v_mid = 0 + 17000·5 = 85000 Pa (used by sand only; OK)
//   f_s = 0.8·50000 = 40000 Pa
//   Q_s,1 = 40000·1.5708·10 = 628319 N ≈ 628 kN
// σ'_v after L1 = 17000·10 = 170000 Pa
//
// Layer 2 (sand):
//   σ'_v_mid = 170000 + 10000·2.5 = 195000 Pa
//   f_s = 0.5·195000 = 97500 Pa
//   Q_s,2 = 97500·1.5708·5 = 765767 N ≈ 766 kN
// σ'_v at tip = 170000 + 10000·5 = 220000 Pa
//
// Q_s total ≈ 628 + 766 = 1394 kN
//
// Tip in sand: q_p,raw = 100·220000 = 22,000,000 Pa
//   capped at 11,000,000 Pa.
// Q_p = 11e6 · 0.1963 = 2,159,000 N ≈ 2159 kN
// Q_ult = 1394 + 2159 = 3553 kN; Q_a = 3553/3 ≈ 1184 kN.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r = kernel.pilecap.analyse({
  diameterM: 0.5,
  waterTableDepthM: -1,
  factorOfSafety: 3,
  Nq_tip: 100, limitTipBearingPa: 11000000,
  layers: [
    { type: 'clay', thicknessM: 10, effectiveUnitWeightNPerM3: 17000,
      undrainedShearStrengthPa: 50000, alpha: 0.8,
      frictionAngleDeg: 0, beta: 0 },
    { type: 'sand', thicknessM: 5, effectiveUnitWeightNPerM3: 10000,
      undrainedShearStrengthPa: 0, alpha: 0,
      frictionAngleDeg: 36, beta: 0.5 },
  ],
});
console.log(r);

if (!approx(r.layers[0].skinForceN/1000, 628, 0.01)) throw new Error('Q_s,1 off');
if (!approx(r.layers[1].skinForceN/1000, 766, 0.01)) throw new Error('Q_s,2 off');
if (!approx(r.tipBearingPa/1e6, 11.0, 1e-6)) throw new Error('q_p cap not applied');
if (!approx(r.tipForceN/1000, 2160, 0.01)) throw new Error('Q_p off');
if (!approx(r.ultimateCapacityN/1000, 3553, 0.01)) throw new Error('Q_ult off');
if (!approx(r.allowableCapacityN/1000, 1184, 0.01)) throw new Error('Q_a off');

console.log('OK — pilecap smoke green');
