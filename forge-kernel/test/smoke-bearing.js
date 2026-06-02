// Forge-226 — bearing L10 life smoke.
//
// Reference: deep-groove ball bearing C = 30 kN, pure radial F_r = 5 kN,
// 1500 rpm, 90% reliability.
//   P = 1 · 5000 + 0 = 5000 N
//   L10 = (30000/5000)^3 = 216 × 10^6 rev
//   L10 (h) = 216 · 1e6 / (60 · 1500) = 2400 h

const kernel = require('../build/Release/forge-kernel.node');
const br = kernel.bearing;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

let r = br.analyse({
  C: 30000, Fr: 5000, Fa: 0, X: 1, Y: 0,
  kind: 'ball', reliabilityPercent: 90, rpm: 1500,
});
close(r.equivalentLoad, 5000, 1e-9, 'P');
close(r.L10MegaRev, 216, 1e-9, 'L10 (10^6 rev)');
close(r.L10Hours, 216 * 1e6 / (60 * 1500), 1e-6, 'L10 (h)');
close(r.reliabilityFactor, 1.0, 1e-9, 'a1 @ 90%');
close(r.LnaMegaRev, r.L10MegaRev, 1e-9, 'Lna = L10 @ 90%');

// (2) Roller bearing: exponent 10/3.
//   L10 = (30000/5000)^(10/3) = 6^(10/3) ≈ 388.46
r = br.analyse({
  C: 30000, Fr: 5000, Fa: 0, X: 1, Y: 0,
  kind: 'roller', reliabilityPercent: 90,
});
close(r.L10MegaRev, Math.pow(6, 10/3), 1e-6, 'roller L10');

// (3) Higher reliability reduces life. 95% → a1 = 0.62.
r = br.analyse({
  C: 30000, Fr: 5000, Fa: 0, X: 1, Y: 0,
  kind: 'ball', reliabilityPercent: 95,
});
close(r.reliabilityFactor, 0.62, 1e-9, 'a1 @ 95%');
close(r.LnaMegaRev, 216 * 0.62, 1e-6, 'Lna @ 95%');

// (4) Combined load: P = X·Fr + Y·Fa
r = br.analyse({
  C: 30000, Fr: 5000, Fa: 2000, X: 0.56, Y: 1.5,
  kind: 'ball', reliabilityPercent: 90,
});
const expected_P = 0.56 * 5000 + 1.5 * 2000;
close(r.equivalentLoad, expected_P, 1e-9, 'combined load P');
close(r.L10MegaRev, Math.pow(30000 / expected_P, 3), 1e-9, 'L10 combined');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-226 bearing L10 smoke: OK');
console.log(`  ball C=30k Fr=5k → L10 = 216 × 10⁶ rev, 2400 h`);
console.log(`  roller same load → L10 = ${Math.pow(6, 10/3).toFixed(1)} × 10⁶ rev`);
