// Forge-222 — hydraulic cylinder smoke.
//
// Standard 50/22 (50 mm bore, 22 mm rod) cylinder at 21 MPa with
// 10 L/min flow → 1.667e-4 m³/s. Stroke = 200 mm. Rod E = 200 GPa.
//   A_p = π·0.05²/4 = 1.963e-3 m²
//   A_r = π·0.022²/4 = 3.801e-4
//   A_a = 1.583e-3
//   F_ext = 21e6 · 1.963e-3 = 41,233 N
//   F_ret = 21e6 · 1.583e-3 = 33,243 N
//   v_ext = 1.667e-4 / 1.963e-3 = 0.0849 m/s = 84.9 mm/s
//   v_ret = 1.667e-4 / 1.583e-3 = 0.1053 m/s = 105.3 mm/s
//   I_rod = π·0.022⁴/64 = 1.149e-8 m⁴
//   P_cr (Euler, K=1, L=0.2) = π² · 200e9 · 1.149e-8 / 0.04 = 567,058 N
//   SF = 567058 / 41233 ≈ 13.75

const kernel = require('../build/Release/forge-kernel.node');
const hc = kernel.hydcyl;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const r = hc.analyse({
  bore: 0.050, rodDiameter: 0.022,
  pressure: 21e6, flowRate: 1.667e-4,
  strokeLength: 0.200,
  rodE: 200e9, bucklingK: 1.0,
});

close(r.pistonArea,  Math.PI * 0.050 * 0.050 / 4, 1e-12, 'A_p');
close(r.rodArea,     Math.PI * 0.022 * 0.022 / 4, 1e-12, 'A_r');
close(r.annulusArea, r.pistonArea - r.rodArea,    1e-12, 'A_a');
close(r.extendForce,  21e6 * r.pistonArea,  1e-6, 'F_ext');
close(r.retractForce, 21e6 * r.annulusArea, 1e-6, 'F_ret');
close(r.extendSpeed,  1.667e-4 / r.pistonArea, 1e-9, 'v_ext');
close(r.retractSpeed, 1.667e-4 / r.annulusArea, 1e-9, 'v_ret');
close(r.volumePerCycle, r.pistonArea * 0.200, 1e-12, 'V_cycle');
ck(r.retractSpeed > r.extendSpeed, 'retract faster than extend');
ck(r.extendForce > r.retractForce, 'extend stronger than retract');
ck(r.bucklingSafetyFactor > 10, `SF ${r.bucklingSafetyFactor} > 10`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-222 hydraulic cylinder smoke: OK');
console.log(`  F_ext = ${(r.extendForce/1000).toFixed(2)} kN, F_ret = ${(r.retractForce/1000).toFixed(2)} kN`);
console.log(`  v_ext = ${(r.extendSpeed*1000).toFixed(1)} mm/s, v_ret = ${(r.retractSpeed*1000).toFixed(1)} mm/s`);
console.log(`  Buckling SF = ${r.bucklingSafetyFactor.toFixed(2)}`);
