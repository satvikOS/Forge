// Forge-239 — Soil bearing capacity smoke (Meyerhof, Das textbook).
//
// Strip footing, B = 1.5 m, D = 1.0 m, c = 30 kPa, γ = 18 kN/m³,
// φ = 25°, FS = 3.
//
// Meyerhof N-factors at φ = 25°:
//   N_q = e^(π·tan25°)·tan²(45°+12.5°) ≈ 10.66
//   N_c = (10.66−1)/tan25° ≈ 20.72
//   N_γ = (10.66−1)·tan(1.4·25°) ≈ (9.66)·tan(35°) ≈ 9.66·0.7002 ≈ 6.76
//
// Strip: all shape factors = 1.
// Depth factors at D/B = 1/1.5 = 0.667:
//   d_c = 1 + 0.4·0.667 = 1.267
//   d_q = 1 + 2·tan25°·(1−sin25°)²·0.667
//       = 1 + 2·0.4663·(0.5774)²·0.667 = 1 + 0.2074 = 1.207
//   d_γ = 1
//
// q = 18000·1.0 = 18,000 Pa
// q_ult = 30000·20.72·1.267 + 18000·10.66·1.207 + 0.5·18000·1.5·6.76·1
//       = 787,397 + 231,564 + 91,260
//       ≈ 1,110,221 Pa ≈ 1.110 MPa
// q_a   = 1.110 MPa / 3 ≈ 370 kPa

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) {
  return Math.abs(a - b) <= rel * Math.abs(b);
}

const r = kernel.bearingcap.analyse({
  shape: 'strip', widthM: 1.5, depthM: 1.0,
  cohesionPa: 30000, surchargeKnPerM3: 18000,
  frictionAngleDeg: 25, factorOfSafety: 3,
});
console.log(r);

if (!approx(r.Nq, 10.66, 0.01)) throw new Error('N_q off');
if (!approx(r.Nc, 20.72, 0.01)) throw new Error('N_c off');
if (!approx(r.Ngamma, 6.76, 0.02)) throw new Error('N_γ off');
if (r.shapeFactorC !== 1) throw new Error('strip s_c should be 1');
if (!approx(r.depthFactorC, 1.267, 0.01)) throw new Error('d_c off');
if (!approx(r.depthFactorQ, 1.207, 0.01)) throw new Error('d_q off');
if (!approx(r.ultimateBearingPa / 1000, 1110.0, 0.02))
  throw new Error('q_ult off');
if (!approx(r.allowableBearingPa / 1000, 370.0, 0.02))
  throw new Error('q_a off');

// Square footing → s_c > 1, s_q > 1, s_γ = 0.6.
const sq = kernel.bearingcap.analyse({
  shape: 'square', widthM: 1.5, depthM: 1.0,
  cohesionPa: 30000, surchargeKnPerM3: 18000,
  frictionAngleDeg: 25, factorOfSafety: 3,
});
if (sq.shapeFactorGamma !== 0.6) throw new Error('square s_γ should be 0.6');
if (!(sq.shapeFactorC > 1.0))     throw new Error('square s_c should be > 1');

// φ = 0 limit: N_c = 5.14, N_q = 1, N_γ = 0.
const phi0 = kernel.bearingcap.analyse({
  shape: 'strip', widthM: 1.5, depthM: 1.0,
  cohesionPa: 30000, surchargeKnPerM3: 18000,
  frictionAngleDeg: 0, factorOfSafety: 3,
});
if (!approx(phi0.Nc, 5.14, 0.001)) throw new Error('φ=0 N_c should be 5.14');
if (!approx(phi0.Nq, 1.0,  0.001)) throw new Error('φ=0 N_q should be 1');
if (!approx(phi0.Ngamma, 0.0, 1e-3)) throw new Error('φ=0 N_γ should be 0');

console.log('OK — bearingcap smoke green');
