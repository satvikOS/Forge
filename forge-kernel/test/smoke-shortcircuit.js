// Forge-251 — Short-circuit study smoke.
//
// Simple 2-bus: gen at bus 0 (X_d'' = 0.20), transmission line 0→1 with
// X = 0.10 pu (R = 0). Fault at bus 1.
//
//   Z_eq from bus 1 looking back = X_d'' + X_line = j0.30 pu
//   Z_11 in pu = j0.30 (since just one path).
//   |Z_11| = 0.30; I_F = 1/0.30 = 3.333 pu; S_F = 1/0.30 = 3.333 pu.
//
// Bus 0 (generator bus): |Z_00| should be just X_d'' = 0.20 paralleled with
// (X_d'' + X_line) seen through the line. Actually the driving-point sees
// X_d'' || (some), but for simple radial system Z_00 = X_d'' = 0.20.
// → I_F at bus 0 = 1/0.20 = 5.0 pu; bigger because closer to source.
//
// 3-bus radial: gen at 0 + 2 lines.
//   X_d'' = 0.20; X_01 = X_12 = 0.10.
//   At bus 2: |Z_22| = 0.20 + 0.10 + 0.10 = 0.40; I_F = 2.5; S_F = 2.5.
//   At bus 1: |Z_11| = 0.30; I_F = 3.33.
//   At bus 0: |Z_00| = 0.20; I_F = 5.0.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const r2 = kernel.shortcircuit.analyse({
  numBuses: 2,
  prefaultVoltagePu: 1.0,
  generators: [{ busIndex: 0, subtransientX: 0.20 }],
  branches:   [{ from: 0, to: 1, R: 0, X: 0.10 }],
});
console.log('2-bus:', r2);
if (!approx(r2.buses[0].zDriveMag, 0.20, 0.001))
  throw new Error('Z_00 should be 0.20 (generator shunt)');
if (!approx(r2.buses[1].zDriveMag, 0.30, 0.001))
  throw new Error('Z_11 should be 0.30 (X_d\'\' + X_line)');
if (!approx(r2.buses[0].faultCurrentPu, 5.0, 0.001))
  throw new Error('I_F at bus 0 should be 5.0');
if (!approx(r2.buses[1].faultCurrentPu, 1.0 / 0.30, 0.001))
  throw new Error('I_F at bus 1 should be 1/0.30');

const r3 = kernel.shortcircuit.analyse({
  numBuses: 3,
  prefaultVoltagePu: 1.0,
  generators: [{ busIndex: 0, subtransientX: 0.20 }],
  branches: [
    { from: 0, to: 1, R: 0, X: 0.10 },
    { from: 1, to: 2, R: 0, X: 0.10 },
  ],
});
console.log('3-bus:', r3);
if (!approx(r3.buses[2].zDriveMag, 0.40, 0.001))
  throw new Error('Z_22 should be 0.40 (radial sum)');
if (!approx(r3.buses[2].faultCurrentPu, 2.5, 0.001))
  throw new Error('I_F at bus 2 should be 2.5');

console.log('OK — shortcircuit smoke green');
