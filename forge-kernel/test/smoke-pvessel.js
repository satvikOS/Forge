// Forge-228 — Pressure vessel smoke.
//
// Textbook: thin-wall cylindrical tank, D = 1.0 m, t = 10 mm, p = 2 MPa.
//   σ_h = p·D/(2t) = 2e6 · 1.0 / 0.02 = 100 MPa
//   σ_l = p·D/(4t) = 50 MPa
//
// ASME VIII Div 1 wall thickness for p = 2 MPa, R = 0.5 m,
// S = 120 MPa, E = 0.85:
//   t = p·R/(S·E − 0.6p) = 2e6 · 0.5 / (120e6·0.85 − 0.6·2e6)
//     = 1e6 / (102e6 − 1.2e6) = 1e6 / 100.8e6 ≈ 0.00992 m = 9.92 mm

const kernel = require('../build/Release/forge-kernel.node');
const pv = kernel.pvessel;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) cylinder stress
let r = pv.stress({ pressure: 2e6, diameter: 1.0, wallThickness: 0.01, geometry: 'cylinder' });
close(r.hoopStress, 100e6, 1, 'σ_h cyl');
close(r.longitudinalStress, 50e6, 1, 'σ_l cyl');

// (2) sphere stress
r = pv.stress({ pressure: 2e6, diameter: 1.0, wallThickness: 0.01, geometry: 'sphere' });
close(r.hoopStress, 50e6, 1, 'σ_membrane sphere');
close(r.longitudinalStress, 0, 1e-9, 'σ_l sphere = 0');

// (3) ASME cylinder thickness
const t_cyl = pv.requiredThickness({
  pressure: 2e6, insideRadius: 0.5, allowableStress: 120e6,
  jointEfficiency: 0.85, geometry: 'cylinder',
});
const t_expected = 2e6 * 0.5 / (120e6 * 0.85 - 0.6 * 2e6);
close(t_cyl, t_expected, 1e-9, 'cyl thickness');
ck(t_cyl > 0.009 && t_cyl < 0.011, `t cyl reasonable: ${t_cyl * 1000} mm`);

// (4) ASME sphere thickness (lower because hoop stress is half)
const t_sphere = pv.requiredThickness({
  pressure: 2e6, insideRadius: 0.5, allowableStress: 120e6,
  jointEfficiency: 0.85, geometry: 'sphere',
});
ck(t_sphere < t_cyl, `sphere thinner than cyl (${t_sphere * 1000} < ${t_cyl * 1000})`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-228 pressure vessel smoke: OK');
console.log(`  cyl D=1m t=10mm p=2MPa → σ_h=100 MPa, σ_l=50 MPa`);
console.log(`  cyl thickness req: ${(t_cyl * 1000).toFixed(2)} mm`);
console.log(`  sphere thickness req: ${(t_sphere * 1000).toFixed(2)} mm`);
