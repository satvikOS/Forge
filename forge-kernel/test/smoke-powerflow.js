// Forge-250 — NR power flow smoke (classic 3-bus / textbook).
//
// 3-bus per-unit system (slack at bus 0, PQ load at bus 1, PV gen at bus 2).
// All branches Z = 0.05 + j0.20 pu, shunt B/2 = 0 pu.
//
// Bus 0 (slack):  V = 1.05, θ = 0°.
// Bus 1 (PQ):     P_load = 0.60, Q_load = 0.25 → P_spec = −0.60, Q_spec = −0.25.
// Bus 2 (PV):     V = 1.04, P_gen = 0.40 → P_spec = +0.40, Q_spec = 0 (placeholder).
//
// Expect: converges in <15 iterations to small mismatch, bus 1 voltage drops
// below 1.0 pu, slack bus 0 reports positive real power.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, abs) { return Math.abs(a - b) <= abs; }

const Z = { R: 0.05, X: 0.20, halfB: 0 };
const r = kernel.powerflow.solve({
  buses: [
    { kind: 'slack', V_init: 1.05, angleDegInit: 0,
      P_specified: 0, Q_specified: 0 },
    { kind: 'pq',    V_init: 1.00, angleDegInit: 0,
      P_specified: -0.60, Q_specified: -0.25 },
    { kind: 'pv',    V_init: 1.04, angleDegInit: 0,
      P_specified: 0.40, Q_specified: 0 },
  ],
  branches: [
    { from: 0, to: 1, ...Z },
    { from: 0, to: 2, ...Z },
    { from: 1, to: 2, ...Z },
  ],
  settings: { tolerance: 1e-6, maxIterations: 30 },
});
console.log(r);

if (!r.converged) throw new Error('expected convergence');
if (r.iterations > 15) throw new Error('took too many NR iterations');
if (r.finalMaxMismatch >= 1e-5) throw new Error('mismatch too large');
if (!(r.buses[1].V > 0.9 && r.buses[1].V < 1.05))
  throw new Error('PQ bus voltage out of physical range');
if (!(r.buses[0].P > 0))
  throw new Error('slack must inject real power for net load');
if (!(Math.abs(r.buses[2].V - 1.04) < 1e-6))
  throw new Error('PV bus V should stay at specified 1.04');

console.log('OK — powerflow smoke green');
