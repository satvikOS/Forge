// Forge-268 — anchor bolt tension smoke (cast-in headed, ACI 318-19 §17.6).
//
// Reference case: A325 ¾" cast-in headed anchor, h_ef = 150 mm, f'_c = 30 MPa,
// remote (c_a,min ≥ 1.5·h_ef), cracked, normal weight.
//   A_se ≈ 283 mm², f_uta = 830 MPa (uncapped), f_ya = 660 MPa.
//   1.9·f_ya = 1254 → capped futa = min(830, 1254, 860) = 830 MPa.
//   N_sa = 283·830 = 234 890 N; φ = 0.75·N_sa = 176 168 N.
//   N_b  = 10·1·√30·150^1.5 = 10·5.477·1837.1 = 100 612 N
//   A_Nco = 9·150² = 202 500 mm²
//   c_a,min = 300 mm > 1.5·h_ef=225 → A_Nc=A_Nco, ψ_ed=1.
//   ψ_c,N = 1 (cracked); N_cb = 1·1·1·N_b = 100 612 N; φ = 70 428 N.
//   N_p  = 8·A_brg·f'_c; A_brg ≈ 287 mm² → N_p = 8·287·30 = 68 880 N
//   ψ_c,P = 1; N_pn = 68 880; φ = 48 216 N → GOVERNS.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.anchorbolt.analyse({
    effectiveTensileAreaMm2: 283,
    steelUltimateMPa: 830,
    steelYieldMPa:    660,
    embedmentDepthMm: 150,
    concreteStrengthMPa: 30,
    minEdgeDistanceMm: 300,
    bearingAreaMm2:    287,
    lambdaLightweight: 1.0,
    crackedConcrete:   true,
    castInAnchor:      true,
});

console.log(JSON.stringify(r, null, 2));
assert(Math.abs(r.cappedFutaMPa - 830) < 0.01, 'futa not capped');
assert(Math.abs(r.steelNominalN - 234890) < 1, 'N_sa ≈ 234 890');
assert(Math.abs(r.phiSteelN     - 176167.5) < 1, 'φN_sa');
assert(r.psiEdN === 1.0, 'ψ_ed = 1 remote edge');
assert(r.psiCN  === 1.0, 'ψ_c,N = 1 cracked');
assert(Math.abs(r.nBN - 100623) < 5, 'N_b ≈ 100 623');
assert(Math.abs(r.breakoutNominalN - r.nBN) < 1e-6, 'N_cb = N_b (no edge)');
assert(Math.abs(r.nPN - 68880) < 1, 'N_p = 68 880');
assert(r.governingMode === 'pullout', 'pullout should govern for shallow head');

// Edge-controlled case: c_a,min < 1.5·h_ef triggers ψ_ed < 1, A_Nc < A_Nco.
const e = kernel.anchorbolt.analyse({
    effectiveTensileAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    embedmentDepthMm: 150, concreteStrengthMPa: 30,
    minEdgeDistanceMm: 100, bearingAreaMm2: 287,
    lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: true,
});
console.log('edge', JSON.stringify(e));
assert(e.psiEdN > 0.7 && e.psiEdN < 1.0, 'ψ_ed reduced near edge');
assert(Math.abs(e.psiEdN - (0.7 + 0.3 * 100/225)) < 1e-6, 'ψ_ed formula');
assert(e.aNcMm2 < e.aNcoMm2, 'A_Nc reduced');
assert(e.breakoutNominalN < r.breakoutNominalN, 'breakout reduced near edge');

// Uncracked concrete bumps both ψ_c,N (1.25) and ψ_c,P (1.4).
const uc = kernel.anchorbolt.analyse({
    effectiveTensileAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    embedmentDepthMm: 150, concreteStrengthMPa: 30,
    minEdgeDistanceMm: 300, bearingAreaMm2: 287,
    lambdaLightweight: 1.0, crackedConcrete: false, castInAnchor: true,
});
assert(uc.psiCN === 1.25, 'ψ_c,N uncracked');
assert(uc.psiCP === 1.4,  'ψ_c,P uncracked');
assert(Math.abs(uc.breakoutNominalN / r.breakoutNominalN - 1.25) < 1e-6, 'breakout +25%');
assert(Math.abs(uc.pulloutNominalN  / r.pulloutNominalN  - 1.4 ) < 1e-6, 'pullout +40%');

// Post-installed gives k_c = 7 (smaller N_b).
const post = kernel.anchorbolt.analyse({
    effectiveTensileAreaMm2: 283,
    steelUltimateMPa: 830, steelYieldMPa: 660,
    embedmentDepthMm: 150, concreteStrengthMPa: 30,
    minEdgeDistanceMm: 300, bearingAreaMm2: 287,
    lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: false,
});
assert(Math.abs(post.nBN / r.nBN - 0.7) < 1e-6, 'post-installed k_c=7');

// High-strength steel capped at 1.9·f_ya.
const cap = kernel.anchorbolt.analyse({
    effectiveTensileAreaMm2: 283,
    steelUltimateMPa: 2000,        // huge — should be capped
    steelYieldMPa:    400,         // 1.9·400 = 760 → governs
    embedmentDepthMm: 150, concreteStrengthMPa: 30,
    minEdgeDistanceMm: 300, bearingAreaMm2: 287,
    lambdaLightweight: 1.0, crackedConcrete: true, castInAnchor: true,
});
assert(Math.abs(cap.cappedFutaMPa - 760) < 1e-6, 'f_uta capped at 1.9·f_ya');

console.log('Forge-268 anchor bolt smoke OK');
