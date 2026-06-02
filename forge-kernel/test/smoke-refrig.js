// Forge-230 — Refrigeration / heat-pump COP smoke.
//
// Carnot at T_hot = 308 K (35°C), T_cold = 268 K (−5°C):
//   COP_refrig = 268 / (308 − 268) = 6.7
//   COP_HP = 308 / 40 = 7.7
//
// Vapor cycle with typical R-134a-ish enthalpies (kJ/kg):
//   h1 = 245, h2 = 280, h3 = 100
//   q_L = 145, w_c = 35, q_H = 180
//   COP_refrig = 145/35 ≈ 4.14
//   COP_HP     = 180/35 ≈ 5.14
//
// 10 kW cooling at COP=4.14 → W = 10/4.14 ≈ 2.42 kW

const kernel = require('../build/Release/forge-kernel.node');
const rf = kernel.refrig;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const carnot_R = rf.carnotCOP(308, 268, 'refrig');
const carnot_HP = rf.carnotCOP(308, 268, 'heatpump');
close(carnot_R, 268 / 40, 1e-9, 'Carnot refrig');
close(carnot_HP, 308 / 40, 1e-9, 'Carnot HP');
close(carnot_HP - carnot_R, 1.0, 1e-9, 'Carnot identity');

const v_R = rf.vaporCycle({ h1: 245000, h2: 280000, h3: 100000, mode: 'refrig' });
close(v_R.refrigerationEffect, 145000, 1e-9, 'q_L');
close(v_R.compressorWork, 35000, 1e-9, 'w_c');
close(v_R.condenserRejection, 180000, 1e-9, 'q_H');
close(v_R.cop, 145 / 35, 1e-9, 'cycle COP refrig');

const v_HP = rf.vaporCycle({ h1: 245000, h2: 280000, h3: 100000, mode: 'heatpump' });
close(v_HP.cop, 180 / 35, 1e-9, 'cycle COP HP');
close(v_HP.cop - v_R.cop, 1.0, 1e-9, 'COP_HP = COP_R + 1 (ideal)');

const W = rf.compressorPower(10000, v_R.cop);
close(W, 10000 / v_R.cop, 1e-9, 'compressor W');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-230 refrigeration smoke: OK');
console.log(`  Carnot refrig = ${carnot_R.toFixed(2)}, HP = ${carnot_HP.toFixed(2)}`);
console.log(`  Cycle refrig = ${v_R.cop.toFixed(2)}, HP = ${v_HP.cop.toFixed(2)}`);
console.log(`  W for 10 kW cool = ${(W/1000).toFixed(2)} kW`);
