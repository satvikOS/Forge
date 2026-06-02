// Forge-216 — beam deflection smoke.

const kernel = require('../build/Release/forge-kernel.node');
const beam = kernel.beam;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// Standard test: cantilever with 100 N tip load, L = 1 m, EI = 1000.
//   δ = PL³ / (3EI) = 100 / 3000 = 0.03333 m
//   θ = PL² / (2EI) = 100 / 2000 = 0.05 rad
//   M = PL = 100 N·m
let r = beam.solve({
  config: 'cantilever-point', length: 1.0, load: 100,
  youngsModulus: 1000, secondMomentI: 1.0,
});
close(r.deflectionMax, 100/3000, 1e-12, 'cant point δ');
close(r.slopeMax, 0.05, 1e-12, 'cant point θ');
close(r.momentMax, 100, 1e-12, 'cant point M');

// Cantilever UDL w=10 N/m: δ = wL⁴/8EI = 10/8000 = 0.00125
r = beam.solve({
  config: 'cantilever-udl', length: 1.0, load: 10,
  youngsModulus: 1000, secondMomentI: 1.0,
});
close(r.deflectionMax, 10 / 8000, 1e-12, 'cant udl δ');
close(r.momentMax, 5, 1e-12, 'cant udl M = wL²/2');

// SS point at midspan: δ = PL³/48EI = 100 / 48000
r = beam.solve({
  config: 'ss-point', length: 1.0, load: 100,
  youngsModulus: 1000, secondMomentI: 1.0,
});
close(r.deflectionMax, 100 / 48000, 1e-12, 'ss point δ');
close(r.momentMax, 25, 1e-12, 'ss point M = PL/4');

// SS UDL: δ = 5wL⁴/384EI
r = beam.solve({
  config: 'ss-udl', length: 1.0, load: 10,
  youngsModulus: 1000, secondMomentI: 1.0,
});
close(r.deflectionMax, 5 * 10 / 384000, 1e-12, 'ss udl δ');
close(r.momentMax, 10 / 8, 1e-12, 'ss udl M = wL²/8');

// Fixed-fixed UDL: δ = wL⁴/384EI (5× stiffer than SS)
r = beam.solve({
  config: 'ff-udl', length: 1.0, load: 10,
  youngsModulus: 1000, secondMomentI: 1.0,
});
close(r.deflectionMax, 10 / 384000, 1e-12, 'ff udl δ');
close(r.momentMax, 10 / 12, 1e-12, 'ff udl M = wL²/12');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-216 beam smoke: OK');
console.log(`  cantilever P=100, L=1, EI=1000 → δ = 33.33 mm, θ = 0.05 rad, M = 100 N·m`);
console.log(`  fixed-fixed δ_max ratio vs SS = ${(10/384000) / (5*10/384000)}× (= 0.2 stiffer)`);
