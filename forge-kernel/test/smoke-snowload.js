// Forge-225 — Snow load (ASCE 7) smoke.
//
// Reference: p_g = 1.5 kPa (typical New England), partially exposed,
// heated structure, Risk Cat II, 20° slope.
//   p_f = 0.7 · 1.0 · 1.0 · 1.0 · 1500 = 1050 Pa
//   C_s (warm, 20°) = 1.0
//   p_s = 1050 Pa

const kernel = require('../build/Release/forge-kernel.node');
const sl = kernel.snowload;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

let r = sl.analyse({
  groundSnowPa: 1500, exposure: 'partially', thermal: 'heated',
  risk: 'II', slopeDeg: 20,
});
close(r.flatRoofPa, 0.7 * 1.0 * 1.0 * 1.0 * 1500, 1e-9, 'p_f');
close(r.slopeFactor, 1.0, 1e-12, 'C_s @ 20°');
close(r.slopedRoofPa, r.flatRoofPa, 1e-12, 'p_s = p_f @ low slope');

// (2) Steep warm roof at 70°: C_s = 0
r = sl.analyse({
  groundSnowPa: 1500, exposure: 'partially', thermal: 'heated',
  risk: 'II', slopeDeg: 70,
});
close(r.slopeFactor, 0.0, 1e-12, 'C_s @ 70°');

// (3) 50° warm roof: C_s = 1 - 20/40 = 0.5
r = sl.analyse({
  groundSnowPa: 1500, exposure: 'partially', thermal: 'heated',
  risk: 'II', slopeDeg: 50,
});
close(r.slopeFactor, 0.5, 1e-12, 'C_s @ 50°');

// (4) Sheltered + unheated + Risk IV → much higher p_f
r = sl.analyse({
  groundSnowPa: 1500, exposure: 'sheltered', thermal: 'unheated',
  risk: 'IV', slopeDeg: 0,
});
const expected = 0.7 * 1.2 * 1.2 * 1.2 * 1500;  // C_e=1.2, C_t=1.2, Is=1.2
close(r.flatRoofPa, expected, 1e-9, 'p_f sheltered unheated risk IV');

// (5) Cold roof breakpoint shift: at 40°, warm gives 1-10/40=0.75 but
//     cold gives 1.0 (since 40 < 45).
const warm = sl.analyse({
  groundSnowPa: 1000, exposure: 'partially', thermal: 'heated',
  risk: 'II', slopeDeg: 40,
});
const cold = sl.analyse({
  groundSnowPa: 1000, exposure: 'partially', thermal: 'unheated',
  risk: 'II', slopeDeg: 40,
});
close(warm.slopeFactor, 0.75, 1e-12, 'warm C_s at 40°');
close(cold.slopeFactor, 1.0,  1e-12, 'cold C_s at 40°');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-225 snow load smoke: OK');
console.log(`  p_f base = ${(0.7 * 1.0 * 1.0 * 1.0 * 1500).toFixed(1)} Pa`);
console.log(`  C_s @ 50° warm = 0.5; @ 70° = 0`);
