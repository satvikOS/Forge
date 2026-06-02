// Forge-232 — Steel column smoke (AISC 360 §E3).
//
// Reference: W10×49 pin-pin, L = 4 m, A36 steel.
//   A = 9290 mm² = 9.29e-3 m²
//   r_y = 51.6 mm = 0.0516 m (weak axis)
//   E = 200 GPa, F_y = 250 MPa
//   K = 1.0 (pin-pin)
//
//   λ = 1·4/0.0516 = 77.5
//   λ_lim = 4.71·√(200000/250) ≈ 4.71·√800 = 4.71·28.28 = 133.2
//   λ < λ_lim → inelastic
//   F_e = π²·200e9 / 77.5² = 1.973e12 / 6006 ≈ 328.5 MPa
//   F_cr = 0.658^(F_y/F_e)·F_y = 0.658^(250/328.5)·250
//        = 0.658^0.761·250 ≈ 0.732·250 ≈ 183 MPa
//   P_n = 183e6·9.29e-3 ≈ 1700 kN
//   φPn = 0.9·1700 = 1530 kN

const kernel = require('../build/Release/forge-kernel.node');
const sc = kernel.steelcol;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const r = sc.analyse({
  effectiveLengthK: 1.0, unbracedLength: 4.0,
  radiusOfGyration: 0.0516, area: 9.29e-3,
  youngsModulus: 200e9, yieldStress: 250e6,
});

close(r.slenderness, 4.0 / 0.0516, 1e-9, 'λ');
close(r.slendernessLimit, 4.71 * Math.sqrt(200e9 / 250e6), 1e-9, 'λ_lim');
ck(r.inelasticRegime === true, 'inelastic regime');
ck(r.criticalStress > 150e6 && r.criticalStress < 200e6, `F_cr ${r.criticalStress/1e6} MPa`);
ck(r.nominalStrength > 1500000 && r.nominalStrength < 1900000, `P_n ${r.nominalStrength/1000} kN`);
close(r.designStrengthLRFD, 0.9 * r.nominalStrength, 1e-6, 'φPn');
close(r.allowableStrengthASD, r.nominalStrength / 1.67, 1e-6, 'P_n/Ω');

// (2) Elastic regime: very slender column λ >> λ_lim
const slender = sc.analyse({
  effectiveLengthK: 1.0, unbracedLength: 10.0,
  radiusOfGyration: 0.0516, area: 9.29e-3,
  youngsModulus: 200e9, yieldStress: 250e6,
});
ck(slender.inelasticRegime === false, 'elastic regime');
close(slender.criticalStress, 0.877 * slender.eulerStress, 1e-6, 'F_cr elastic');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-232 steel column smoke: OK');
console.log(`  λ = ${r.slenderness.toFixed(1)}, λ_lim = ${r.slendernessLimit.toFixed(1)} → inelastic`);
console.log(`  F_cr = ${(r.criticalStress/1e6).toFixed(1)} MPa`);
console.log(`  P_n = ${(r.nominalStrength/1000).toFixed(0)} kN, φPn = ${(r.designStrengthLRFD/1000).toFixed(0)} kN`);
