// Forge-223 — Wind load (ASCE 7) smoke.
//
// Reference: V = 50 m/s (≈ 112 mph), 10 m roof, Exposure C, flat
// terrain, standard directionality.
//   K_z @ 10 m, C = 2.01 · (10 / 274.32)^(2/9.5)
//             ≈ 2.01 · 0.5326 ≈ 1.0706
//   q_z = 0.613 · 1.0706 · 1.0 · 0.85 · 1.0 · 50² = 1394 Pa
//   p (windward, Cp = +0.8) = 1394 · 0.85 · 0.8 ≈ 948 Pa

const kernel = require('../build/Release/forge-kernel.node');
const wl = kernel.windload;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const Kz = wl.kzCoefficient(10, 'C');
const expected_Kz = 2.01 * Math.pow(10 / 274.32, 2/9.5);
close(Kz, expected_Kz, 1e-9, 'Kz @ 10 m, C');

// Kz_min should kick in for z < 4.6 m.
const Kz_low = wl.kzCoefficient(2.0, 'C');
const Kz_min = wl.kzCoefficient(4.6, 'C');
close(Kz_low, Kz_min, 1e-9, 'Kz min clamp at 4.6 m');

// Kz capped at 2.01 above zg.
const Kz_high = wl.kzCoefficient(500, 'C');
close(Kz_high, 2.01, 1e-9, 'Kz cap at zg');

// q_z full formula
const qz = wl.velocityPressure({
  V: 50, z: 10, exposure: 'C', Kzt: 1.0, Kd: 0.85, Ke: 1.0,
});
const expected_qz = 0.613 * Kz * 1.0 * 0.85 * 1.0 * 50 * 50;
close(qz, expected_qz, 1e-9, 'q_z');
ck(qz > 1000 && qz < 2000, `q_z reasonable: ${qz}`);

// Design pressure
const p = wl.designPressure({ qz, G: 0.85, Cp: 0.8 });
close(p, qz * 0.85 * 0.8, 1e-9, 'design p');

// Exposure D should give higher Kz than C at same height
const Kz_D = wl.kzCoefficient(10, 'D');
const Kz_C = wl.kzCoefficient(10, 'C');
ck(Kz_D > Kz_C, `Kz(D) > Kz(C) at z=10 (${Kz_D} vs ${Kz_C})`);

// Exposure B should give lower Kz than C
const Kz_B = wl.kzCoefficient(10, 'B');
ck(Kz_B < Kz_C, `Kz(B) < Kz(C) at z=10 (${Kz_B} vs ${Kz_C})`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-223 wind load smoke: OK');
console.log(`  Kz (10m, C) = ${Kz.toFixed(4)}`);
console.log(`  q_z = ${qz.toFixed(1)} Pa`);
console.log(`  p (Cp=0.8) = ${p.toFixed(1)} Pa`);
