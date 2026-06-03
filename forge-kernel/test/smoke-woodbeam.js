// Forge-272 — wood beam bending smoke (NDS 2018 §3.3 + §4.3).
//
// Reference: DF-L No. 2, 2×12 nominal joist (38×286 mm dressed).
//   F_b = 6.21 MPa (≈900 psi), E_min = 4480 MPa (≈650 ksi).
//   Joists @16" o.c. → C_r = 1.15. Snow load → C_D = 1.15.
//   Beam continuously laterally supported by sheathing → l_e ≈ 0 in practice,
//   but we use a small value (l_e = 100 mm) just to compute R_B.

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const r = kernel.woodbeam.analyse({
    referenceFbMPa: 6.21, emin_MPa: 4480,
    widthMm: 38, depthMm: 286,
    effectiveLengthMm: 100,
    cD: 1.15, cM: 1.0, cT: 1.0,
    cF: 1.0,  cFu: 1.0, cI: 1.0, cR: 1.15,
});
console.log(JSON.stringify(r, null, 2));

const Sx_exp = 38 * 286 * 286 / 6;
assert(Math.abs(r.sectionModulusMm3 - Sx_exp) < 1, 'S_x = b·d²/6');

const Fbstar_exp = 6.21 * 1.15 * 1.15;
assert(Math.abs(r.fbStarMPa - Fbstar_exp) < 1e-6, 'F*_b without C_L');

// Short laterally supported beam → R_B very small, C_L → 1.
assert(r.cL > 0.99, 'C_L ≈ 1 when laterally supported');
assert(Math.abs(r.fbPrimeMPa - r.fbStarMPa * r.cL) < 1e-9, 'F\'_b identity');
assert(Math.abs(r.mAllowNmm - r.fbPrimeMPa * r.sectionModulusMm3) < 1e-6, 'M_allow identity');

// Long unbraced length → R_B grows, C_L drops.
const long = kernel.woodbeam.analyse({
    referenceFbMPa: 6.21, emin_MPa: 4480,
    widthMm: 38, depthMm: 286,
    effectiveLengthMm: 4000,
    cD: 1.0, cM: 1.0, cT: 1.0,
    cF: 1.0, cFu: 1.0, cI: 1.0, cR: 1.0,
});
console.log('long', JSON.stringify(long));
assert(long.slendernessRb > r.slendernessRb, 'R_B grows with l_e');
assert(long.cL < r.cL, 'C_L drops');
assert(long.mAllowNmm < r.fbStarMPa * r.sectionModulusMm3, 'unstable: M_allow drops');

// C_D = 1.6 (wind/earthquake) — F*_b scales linearly.
const cd16 = kernel.woodbeam.analyse({
    referenceFbMPa: 6.21, emin_MPa: 4480,
    widthMm: 38, depthMm: 286, effectiveLengthMm: 100,
    cD: 1.6, cM: 1.0, cT: 1.0, cF: 1.0, cFu: 1.0, cI: 1.0, cR: 1.0,
});
const cd10 = kernel.woodbeam.analyse({
    referenceFbMPa: 6.21, emin_MPa: 4480,
    widthMm: 38, depthMm: 286, effectiveLengthMm: 100,
    cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cFu: 1.0, cI: 1.0, cR: 1.0,
});
assert(Math.abs(cd16.fbStarMPa / cd10.fbStarMPa - 1.6) < 1e-6, 'C_D scales F*_b');

// Wider beam → R_B drops (b² in denominator inverse), C_L grows.
const wide = kernel.woodbeam.analyse({
    referenceFbMPa: 6.21, emin_MPa: 4480,
    widthMm: 100, depthMm: 286, effectiveLengthMm: 4000,
    cD: 1.0, cM: 1.0, cT: 1.0, cF: 1.0, cFu: 1.0, cI: 1.0, cR: 1.0,
});
assert(wide.slendernessRb < long.slendernessRb, 'wider beam smaller R_B');
assert(wide.cL > long.cL, 'wider beam larger C_L');

console.log('Forge-272 wood beam smoke OK');
