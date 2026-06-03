// Forge-271 — anchor bolt shear smoke (ACI 318-19 §17.7).
//
// Reference: ¾" cast-in headed bolt at c_a1 = 150 mm, h_a = 300 mm, f'_c = 30,
//   A_se,V = 283 mm², d_a = 19.05 mm, le = h_ef = 150 mm (capped at 8·d_a≈152).
// Steel: V_sa = 0.6·283·830 = 140 934 N; φ = 0.65·V_sa = 91 607 N.
// V_b = 0.6·(150/19.05)^0.2·√19.05·1·√30·150^1.5
//     = 0.6·1.5135·4.365·5.477·1837.117
//     ≈ 39 902 N (kernel computed)
// A_Vco = 4.5·150² = 101 250 mm²
// h_a = 300 ≥ 1.5·150 = 225 ⇒ A_Vc = A_Vco
// ψ_ed,V: c_a2 = 1000 (large) → 1.0
// ψ_c,V = 1.0 (cracked)
// ψ_h,V = √(225/300) < 1 → clipped to 1.0
// V_cb = V_b = 39 902 N; φ = 27 931 N → GOVERNS as breakout.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.anchorshear.analyse({
    effectiveShearAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    anchorDiameterMm: 19.05,
    loadBearingLengthMm: 150,
    concreteStrengthMPa: 30,
    edgeDistanceCa1Mm: 150,
    edgeDistanceCa2Mm: 1000,
    memberThicknessHaMm: 300,
    lambdaLightweight: 1.0,
    crackedConcrete: true,
});
console.log(JSON.stringify(r, null, 2));

const V_b_expected = 0.6
    * Math.pow(150 / 19.05, 0.2)
    * Math.sqrt(19.05)
    * Math.sqrt(30)
    * Math.pow(150, 1.5);

assert(Math.abs(r.cappedFutaMPa - 830) < 0.01, 'f_uta');
assert(Math.abs(r.steelNominalN - 0.6 * 283 * 830) < 1, 'V_sa');
assert(Math.abs(r.phiSteelN - 0.65 * r.steelNominalN) < 1, 'φV_sa');
assert(r.aVcMm2 === r.aVcoMm2, 'A_Vc = A_Vco when h_a ≥ 1.5·c_a1');
assert(r.psiEdV === 1.0, 'ψ_ed=1');
assert(r.psiHV === 1.0, 'ψ_h clipped at 1');
assert(Math.abs(r.vBN - V_b_expected) < 1, 'V_b matches closed form');
assert(r.governingMode === 'breakout', 'breakout governs at small c_a1');

// Larger c_a1 — breakout grows ∝ c_a1^1.5, eventually steel governs.
const big = kernel.anchorshear.analyse({
    effectiveShearAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    anchorDiameterMm: 19.05,
    loadBearingLengthMm: 150,
    concreteStrengthMPa: 30,
    edgeDistanceCa1Mm: 600,
    edgeDistanceCa2Mm: 1000,
    memberThicknessHaMm: 1000,
    lambdaLightweight: 1.0,
    crackedConcrete: true,
});
console.log('big', JSON.stringify(big));
assert(big.governingMode === 'steel', 'steel governs when c_a1 is large');
assert(Math.abs(big.vBN / r.vBN - Math.pow(600/150, 1.5)) < 1e-6, 'V_b ∝ c_a1^1.5');

// Close perpendicular edge: c_a2 < 1.5·c_a1 → ψ_ed < 1.
const edge = kernel.anchorshear.analyse({
    effectiveShearAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    anchorDiameterMm: 19.05,
    loadBearingLengthMm: 150,
    concreteStrengthMPa: 30,
    edgeDistanceCa1Mm: 150,
    edgeDistanceCa2Mm: 100,
    memberThicknessHaMm: 300,
    lambdaLightweight: 1.0,
    crackedConcrete: true,
});
console.log('edge', JSON.stringify(edge));
assert(Math.abs(edge.psiEdV - (0.7 + 0.3 * 100/225)) < 1e-6, 'ψ_ed,V formula');
assert(edge.breakoutNominalN < r.breakoutNominalN, 'breakout reduced near c_a2');

// Thin slab: h_a < 1.5·c_a1 → A_Vc shrinks + ψ_h,V > 1 boost.
const thin = kernel.anchorshear.analyse({
    effectiveShearAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    anchorDiameterMm: 19.05,
    loadBearingLengthMm: 150,
    concreteStrengthMPa: 30,
    edgeDistanceCa1Mm: 150,
    edgeDistanceCa2Mm: 1000,
    memberThicknessHaMm: 150,
    lambdaLightweight: 1.0,
    crackedConcrete: true,
});
console.log('thin', JSON.stringify(thin));
assert(thin.aVcMm2 < thin.aVcoMm2, 'A_Vc reduced');
assert(thin.psiHV > 1.0, 'ψ_h,V > 1');

// Uncracked: ψ_c,V = 1.4.
const uc = kernel.anchorshear.analyse({
    effectiveShearAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    anchorDiameterMm: 19.05,
    loadBearingLengthMm: 150,
    concreteStrengthMPa: 30,
    edgeDistanceCa1Mm: 150,
    edgeDistanceCa2Mm: 1000,
    memberThicknessHaMm: 300,
    lambdaLightweight: 1.0,
    crackedConcrete: false,
});
assert(uc.psiCV === 1.4, 'ψ_c,V uncracked');
assert(Math.abs(uc.breakoutNominalN / r.breakoutNominalN - 1.4) < 1e-6, 'breakout +40%');

console.log('Forge-271 anchor shear smoke OK');
