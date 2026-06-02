// Forge-234 — Seismic ELF smoke (ASCE 7 §12.8).
//
// Textbook 5-story steel MRF: h_n = 20 m, S_DS = 1.0g, S_D1 = 0.6g,
// T_L = 8 s, R = 8, I_e = 1.0.
//
//   T_a = 0.0724 · 20^0.8 = 0.0724 · 10.99 ≈ 0.796 s   (steel MRF)
//   Cs_basic = 1.0 / (8/1) = 0.125
//   Cs_max (T ≤ T_L) = 0.6 / (0.796 · 8) = 0.0942
//   Cs_min = max(0.044·1·1, 0.01) = 0.044
//   Cs_governing = min(0.125, 0.0942) = 0.0942
//
// W = 5000 kN → V = 0.0942 · 5000 = 471 kN

const kernel = require('../build/Release/forge-kernel.node');
const sm = kernel.seismic;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) Period
const Ta = sm.approximateFundamentalPeriod('steel-mrf', 20);
close(Ta, 0.0724 * Math.pow(20, 0.8), 1e-9, 'T_a steel MRF');

// Concrete uses its own C_t / x — verify the closed form directly.
const Ta_concrete = sm.approximateFundamentalPeriod('concrete-mrf', 20);
close(Ta_concrete, 0.0466 * Math.pow(20, 0.9), 1e-9, 'T_a concrete MRF');

// (2) Cs response: textbook above
const cs = sm.seismicResponseCoefficient({
  SDS: 1.0, SD1: 0.6, T: Ta, TL: 8, R: 8, Ie: 1.0,
});
close(cs.CsBasic, 0.125, 1e-9, 'Cs basic');
close(cs.CsMax, 0.6 / (Ta * 8), 1e-9, 'Cs max');
close(cs.CsMin, 0.044, 1e-9, 'Cs min');
close(cs.CsGoverning, cs.CsMax, 1e-9, 'governing = max (clamped down)');

// (3) Tall building T > T_L: switches to second branch
const csTall = sm.seismicResponseCoefficient({
  SDS: 1.0, SD1: 0.6, T: 10, TL: 8, R: 8, Ie: 1.0,
});
const expectedTallMax = 0.6 * 8 / (10 * 10 * 8);  // S_D1·T_L/(T²·R/Ie)
close(csTall.CsMax, expectedTallMax, 1e-9, 'Cs max T>TL');

// (4) Small earthquake: governing = min
const csSmall = sm.seismicResponseCoefficient({
  SDS: 0.05, SD1: 0.04, T: 0.5, TL: 8, R: 8, Ie: 1.0,
});
ck(csSmall.CsGoverning >= csSmall.CsMin, 'min clause kicks in');
ck(csSmall.CsGoverning === csSmall.CsMin || csSmall.CsGoverning === csSmall.CsBasic,
   'governing is either min or basic');

// (5) Base shear
const V = sm.baseShear(cs.CsGoverning, 5e6);
close(V, cs.CsGoverning * 5e6, 1e-6, 'V');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-234 seismic smoke: OK');
console.log(`  T_a (steel, 20m) = ${Ta.toFixed(3)} s`);
console.log(`  C_s basic = ${cs.CsBasic}, max = ${cs.CsMax.toFixed(4)}, min = ${cs.CsMin}, gov = ${cs.CsGoverning.toFixed(4)}`);
console.log(`  V = ${(V/1000).toFixed(0)} kN`);
