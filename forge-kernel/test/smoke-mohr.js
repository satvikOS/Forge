// Forge-220 — Mohr's circle smoke.

const kernel = require('../build/Release/forge-kernel.node');
const m = kernel.mohr;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) Pure tension: σ_x = 100, σ_y = 0, τ_xy = 0.
//     σ_1 = 100, σ_2 = 0, τ_max = 50, θ_p = 0.
let r = m.principal2D({ sx: 100, sy: 0, txy: 0 });
close(r.sigma1, 100, 1e-12, 'pure tension σ1');
close(r.sigma2, 0,   1e-12, 'pure tension σ2');
close(r.tauMax, 50,  1e-12, 'pure tension τ_max');
close(r.thetaPRad, 0, 1e-12, 'pure tension θ_p');

// (2) Pure shear: σ_x = 0, σ_y = 0, τ_xy = 50.
//     σ_1 = 50, σ_2 = -50, τ_max = 50, θ_p = π/4.
r = m.principal2D({ sx: 0, sy: 0, txy: 50 });
close(r.sigma1, 50, 1e-12, 'shear σ1');
close(r.sigma2, -50, 1e-12, 'shear σ2');
close(r.thetaPRad, Math.PI / 4, 1e-12, 'shear θ_p');

// (3) Combined: σ_x = 80, σ_y = 20, τ_xy = 30.
//     R = √((30)² + 30²) = 30√2 ≈ 42.43
//     σ_1 = 50 + 42.43 ≈ 92.43, σ_2 = 50 - 42.43 ≈ 7.57
r = m.principal2D({ sx: 80, sy: 20, txy: 30 });
const R = Math.sqrt(900 + 900);
close(r.sigma1, 50 + R, 1e-12, 'combined σ1');
close(r.sigma2, 50 - R, 1e-12, 'combined σ2');

// (4) Stress at angle — at principal angle should give σ_1 and τ = 0.
const r4 = m.stressAtAngle({ sx: 80, sy: 20, txy: 30 }, r.thetaPRad);
close(r4.sigma, r.sigma1, 1e-9, 'stress at θ_p = σ1');
close(r4.tau, 0, 1e-9, 'stress at θ_p has zero shear');

// (5) 3D principal eigenvalues — uniaxial 100 along x.
const r5 = m.principal3D({ sx: 100, sy: 0, sz: 0, txy: 0, tyz: 0, tzx: 0 });
close(r5.sigma1, 100, 1e-9, '3D uniaxial σ1');
close(r5.sigma3, 0, 1e-9, '3D uniaxial σ3');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-220 Mohr smoke: OK');
console.log(`  combined: σ1 = ${(50 + R).toFixed(2)}, σ2 = ${(50 - R).toFixed(2)}, τ_max = ${R.toFixed(2)}`);
