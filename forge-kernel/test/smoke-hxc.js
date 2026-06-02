// Forge-218 — heat exchanger LMTD smoke.

const kernel = require('../build/Release/forge-kernel.node');
const hx = kernel.hxc;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) Counter-flow: Th = 100 → 60°C, Tc = 20 → 50°C.
//     ΔT₁ = 100 - 50 = 50, ΔT₂ = 60 - 20 = 40.
//     LMTD = (50 - 40)/ln(50/40) = 10/0.2231 ≈ 44.81
let r = hx.lmtd({ thIn: 100, thOut: 60, tcIn: 20, tcOut: 50, flow: 'counter' });
close(r.dT1, 50, 1e-12, 'cf dT1');
close(r.dT2, 40, 1e-12, 'cf dT2');
close(r.lmtd, 10/Math.log(50/40), 1e-9, 'cf LMTD');

// (2) Parallel-flow: same temps.
//     ΔT₁ = 100 - 20 = 80, ΔT₂ = 60 - 50 = 10.
//     LMTD = (80 - 10)/ln(80/10) = 70/2.079 ≈ 33.66
r = hx.lmtd({ thIn: 100, thOut: 60, tcIn: 20, tcOut: 50, flow: 'parallel' });
close(r.dT1, 80, 1e-12, 'pf dT1');
close(r.dT2, 10, 1e-12, 'pf dT2');
close(r.lmtd, 70/Math.log(80/10), 1e-9, 'pf LMTD');

// (3) Equal-ΔT case: thIn = 100, thOut = 70, tcIn = 30, tcOut = 60 (counter).
//     ΔT₁ = 100 - 60 = 40, ΔT₂ = 70 - 30 = 40 → LMTD = 40.
r = hx.lmtd({ thIn: 100, thOut: 70, tcIn: 30, tcOut: 60, flow: 'counter' });
close(r.lmtd, 40, 1e-6, 'equal dT case');

// (4) Required area: Q = 50 kW, U = 500 W/(m²·K), LMTD = 44.81, F = 1.
//     A = Q/(U·LMTD) = 50000/(500·44.81) ≈ 2.232 m²
const A = hx.requiredArea({ Q: 50000, U: 500, lmtd: 44.81, F: 1.0 });
close(A, 50000 / (500 * 44.81), 1e-9, 'area');

// (5) NTU effectiveness: counter, Cmin = 100 W/K, Cmax = 200 W/K, UA = 200.
//     NTU = 2, Cr = 0.5 → ε = (1-e^(-2*0.5))/(1 - 0.5·e^(-2*0.5))
//                          = (1-e^-1)/(1 - 0.5·e^-1) ≈ 0.6321/0.8161 ≈ 0.7744
const eps = hx.effectiveness({ UA: 200, cMin: 100, cMax: 200, flow: 'counter' });
const e_expected = (1 - Math.exp(-1)) / (1 - 0.5 * Math.exp(-1));
close(eps, e_expected, 1e-9, 'effectiveness counter Cr=0.5 NTU=2');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-218 heat exchanger smoke: OK');
console.log(`  CF LMTD = ${r.lmtd.toFixed(3)} K`);
console.log(`  Required area = ${A.toFixed(3)} m²`);
console.log(`  ε (counter, Cr=0.5, NTU=2) = ${eps.toFixed(4)}`);
