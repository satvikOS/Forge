// Forge-270 — steel beam LTB smoke (AISC 360-22 §F2).
//
// Reference W18×50 (Fy = 345 MPa, E = 200000 MPa). Approximate
// AISC manual properties (metric):
//   Z_x ≈ 1.557 × 10⁶ mm³,  S_x ≈ 1.376 × 10⁶ mm³
//   r_y ≈ 41.4 mm,  r_ts ≈ 49.0 mm,  J ≈ 0.788 × 10⁶ mm⁴
//   h_o ≈ 442 mm,   c   = 1   (doubly symmetric)
//
//   M_p = F_y·Z_x = 345·1.557e6 = 537 165 000 N·mm = 537 kN·m
//   L_p = 1.76·41.4·√(200000/345) = 1755 mm
//   L_r ≈ ~5500 mm (computed by code; we just bracket it)
//
//   Plastic regime at L_b = 1500 mm < L_p ⇒ M_n = M_p.
//   Inelastic LTB at L_b = 3000 mm (between L_p and L_r).
//   Elastic LTB at L_b = 8000 mm > L_r.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const base = {
    yieldMPa: 345, elasticModulusMPa: 200000,
    sectionModulusXMm3: 1376e3, plasticModulusXMm3: 1557e3,
    torsionConstantMm4: 0.788e6,
    radiusYMm: 41.4, radiusTsMm: 49.0,
    distanceBetweenFlangeCentroidsMm: 442,
    warpingCoefficient: 1.0,
    cb: 1.0,
};

const plastic = kernel.steelbeam.analyse({ ...base, unbracedLengthMm: 1500 });
console.log('plastic', JSON.stringify(plastic, null, 2));
assert(Math.abs(plastic.mPlasticNmm - 345 * 1557e3) < 1, 'M_p');
assert(Math.abs(plastic.lpMm - 1755) < 5, 'L_p ≈ 1755 mm');
assert(plastic.regime === 'plastic', 'plastic regime');
assert(plastic.mNnominalNmm === plastic.mPlasticNmm, 'M_n = M_p in plastic regime');
assert(Math.abs(plastic.phiMnNmm - 0.9 * plastic.mPlasticNmm) < 1, 'φ = 0.9');

const inelastic = kernel.steelbeam.analyse({ ...base, unbracedLengthMm: 3000 });
console.log('inelastic', JSON.stringify(inelastic, null, 2));
assert(inelastic.regime === 'inelastic-LTB', 'inelastic regime');
assert(inelastic.mNnominalNmm < inelastic.mPlasticNmm, 'M_n < M_p');
assert(inelastic.mNnominalNmm > 0.7 * 345 * 1376e3, 'M_n > 0.7·F_y·S_x');

const elastic = kernel.steelbeam.analyse({ ...base, unbracedLengthMm: 8000 });
console.log('elastic', JSON.stringify(elastic, null, 2));
assert(elastic.regime === 'elastic-LTB', 'elastic regime');
assert(elastic.fCrMPa > 0, 'F_cr > 0');
assert(elastic.mNnominalNmm < inelastic.mNnominalNmm, 'elastic M_n < inelastic M_n');

// C_b doubles → M_n increases (clipped to M_p in elastic / plastic regimes).
const cb2 = kernel.steelbeam.analyse({ ...base, unbracedLengthMm: 3000, cb: 2.0 });
console.log('cb=2', JSON.stringify(cb2));
assert(cb2.mNnominalNmm >= inelastic.mNnominalNmm, 'C_b=2 ≥ C_b=1');
assert(cb2.mNnominalNmm <= cb2.mPlasticNmm, 'C_b·M_n ≤ M_p');

console.log('Forge-270 steel beam LTB smoke OK');
