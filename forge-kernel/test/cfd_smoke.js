// forge-kernel CFD smoke (Forge-12b) — lid-driven cavity at Re ≈ 100.
//
// Geometry: unit cube (1 × 1 × 1 m) with no-slip walls on all faces except
// the top (+Y), which moves with tangential velocity (1, 0, 0) m/s. The
// cavity flow is the canonical incompressible Navier-Stokes verification
// problem; with ν = 0.01, ρ = 1 the Reynolds number based on the lid speed
// and box length is U·L/ν = 100.
//
// Asserts:
//   * max |u| approaching the lid speed (within ±20 % of 1 m/s) — the lid
//     imposes u = 1 directly and the cell adjacent to the lid converges to
//     that boundary value as the simulation runs. With 100 explicit
//     projection iterations on a 32³ grid the boundary layer is only
//     partially developed (steady-state takes ~10·L²/ν ≈ 1000 s, we've
//     simulated ~5 s), so we accept anything above 0.8 m/s as physical
//     evidence the lid BC is propagating correctly. A future slice with
//     semi-implicit momentum + under-relaxation will converge in 100
//     iterations exactly.
//   * Final divergence residual drops at least 3 orders of magnitude below
//     the initial divergence — i.e. the projection step actually drives ∇·u
//     toward zero. (Initial residual is taken just after the first predictor
//     step where ∇·u* is O(0.1); after pressure projection it sits at
//     machine precision, so the drop is in fact 12+ orders of magnitude.)
//   * Wall-time under 30 s.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge  = require(KERNEL);

assert.ok(forge.cfd && forge.cfd.solveSteadyNS, 'forge.cfd.solveSteadyNS missing');

const cfg = {
  domain: new Float64Array([0, 0, 0, 1, 1, 1]),
  Nx: 32, Ny: 32, Nz: 32,
  rho: 1.0,
  nu:  0.01,
  maxIter: 100,
  residualTol: 1e-9, // velocity-change tolerance; keep tiny so we run to
                     // the 100-iter cap and can measure residual drop
  walls:   [0, 1, 2, 4, 5],   // all faces no-slip except +Y (the lid)
  lid:     { faceId: 3, vx: 1.0, vy: 0.0, vz: 0.0 },
};

const t0 = Date.now();
const result = forge.cfd.solveSteadyNS(cfg);
const ms = Date.now() - t0;

console.log(`[cfd-smoke] grid ${cfg.Nx}×${cfg.Ny}×${cfg.Nz}, ν=${cfg.nu}, ρ=${cfg.rho}, lid=(1,0,0)`);
console.log(`[cfd-smoke] iterations = ${result.iterations}, wall-time = ${ms} ms (kernel ${result.cpuMs.toFixed(1)} ms)`);
console.log(`[cfd-smoke] max |u| (cell-centre) = ${result.maxVelocity.toFixed(4)} m/s`);
console.log(`[cfd-smoke] Reynolds estimate = ${result.reynolds.toFixed(1)}`);
console.log(`[cfd-smoke] divergence residual: initial ${result.initialResidual.toExponential(3)} → final ${result.finalResidual.toExponential(3)}`);

// === ASSERTIONS ===
assert.ok(ms < 30000, `wall-time ${ms} ms exceeds 30 s budget`);
// The lid imposes u = 1 m/s. In the developing cavity flow at Re=100 with
// 100 explicit-projection outer iterations on a 32³ grid we expect the cell
// row adjacent to the lid to reach ~0.85 m/s. Accept anything ≥ 0.8 (so the
// lid BC is propagating) and ≤ 1.2 (so the solver isn't overshooting). A
// future slice with semi-implicit momentum + under-relaxation can tighten
// this to ±5%.
assert.ok(result.maxVelocity > 0.8 && result.maxVelocity < 1.2,
  `max |u| ${result.maxVelocity.toFixed(3)} outside [0.8, 1.2] m/s window`);

// 3 orders of magnitude residual drop (incompressibility error).
// The projection drives divergence to machine epsilon after the first step,
// so the drop is in fact 10+ orders of magnitude — we conservatively assert
// at least 3.
const drop = result.initialResidual / result.finalResidual;
console.log(`[cfd-smoke] residual drop factor = ${drop.toExponential(2)}`);
assert.ok(drop > 1e3,
  `residual drop ${drop.toExponential(2)} < 1000x — projection not converging`);

// Sanity: pressure field should be non-trivial (max-min > 0).
let pmin = +Infinity, pmax = -Infinity;
for (const p of result.p) { if (p < pmin) pmin = p; if (p > pmax) pmax = p; }
console.log(`[cfd-smoke] pressure range: [${pmin.toExponential(3)}, ${pmax.toExponential(3)}] Pa`);
assert.ok(pmax - pmin > 0, 'pressure field is flat — projection broken');

console.log('\n[cfd-smoke] ALL PASS');
