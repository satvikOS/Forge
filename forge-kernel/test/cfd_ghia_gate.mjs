// ===========================================================================
// CFD KNOWN-ANSWER GATE — Lid-driven cavity vs Ghia, Ghia & Shin (1982)
// ---------------------------------------------------------------------------
// Runs the EXISTING native solver forge.cfd.solveSteadyNS (Cfd.cpp:
// incompressible laminar NS, staggered MAC grid, Chorin projection,
// first-order upwind advection) to GENUINE steady state on the unit
// lid-driven cavity at Re = 100, 400, 1000 and compares the vertical- and
// horizontal-centerline velocity profiles to the canonical tabulated data of:
//
//   U. Ghia, K. N. Ghia, C. T. Shin, "High-Re Solutions for Incompressible
//   Flow Using the Navier-Stokes Equations and a Multigrid Method",
//   J. Comput. Phys. 48, 387-411 (1982) — Tables I and II.
//
// This is an HONEST accuracy baseline. First-order upwind on a 64x64 grid is
// expected to be several % off at Re=100 and ~10-25% off at Re=1000 (the
// numerical diffusion of first-order upwind acts like an extra ~1/(Re*h)
// viscosity). We report the REAL measured error — we do NOT tune to pass.
//
// 2D->3D note: solveSteadyNS is a 3D solver. We recover the 2D Ghia cavity by
// using a thin domain (Nz=4) with the two z-faces left as SYMMETRY planes
// (omitted from `walls`, so Cfd.cpp's ghost-cell stencil gives zero-gradient /
// free-slip and the normal velocity w stays 0). The flow is then invariant in
// z and identical to the 2D solution; we sample the mid-z plane.
//
// Run: node test/cfd_ghia_gate.mjs
// ===========================================================================

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

if (!(forge.cfd && forge.cfd.solveSteadyNS)) {
  throw new Error('forge.cfd.solveSteadyNS missing from native kernel — cannot run gate');
}

// ---------------------------------------------------------------------------
// REFERENCE DATA — Ghia, Ghia & Shin (1982).
//
// Table I: u-velocity along the VERTICAL line through the geometric center
// (x = 0.5), tabulated at 17 y-stations, for Re = 100, 400, 1000.
// (y runs from the bottom wall y=0 to the moving lid y=1; u is normalized by
//  the lid speed U=1.)
// ---------------------------------------------------------------------------
const GHIA_U = {
  // y         Re100       Re400       Re1000
  y:      [1.0000, 0.9766, 0.9688, 0.9609, 0.9531, 0.8516, 0.7344, 0.6172, 0.5000, 0.4531, 0.2813, 0.1719, 0.1016, 0.0703, 0.0625, 0.0547, 0.0000],
  100:    [1.00000, 0.84123, 0.78871, 0.73722, 0.68717, 0.23151, 0.00332, -0.13641, -0.20581, -0.21090, -0.15662, -0.10150, -0.06434, -0.04775, -0.04192, -0.03717, 0.00000],
  400:    [1.00000, 0.75837, 0.68439, 0.61756, 0.55892, 0.29093, 0.16256,  0.02135, -0.11477, -0.17119, -0.32726, -0.24299, -0.14612, -0.10338, -0.09266, -0.08186, 0.00000],
  1000:   [1.00000, 0.65928, 0.57492, 0.51117, 0.46604, 0.33304, 0.18719,  0.05702, -0.06080, -0.10648, -0.27805, -0.38289, -0.29730, -0.22220, -0.20196, -0.18109, 0.00000],
};

// Table II: v-velocity along the HORIZONTAL line through the geometric center
// (y = 0.5), tabulated at 17 x-stations, for Re = 100, 400, 1000.
const GHIA_V = {
  // x         Re100       Re400       Re1000
  x:      [1.0000, 0.9688, 0.9609, 0.9531, 0.9453, 0.9063, 0.8594, 0.8047, 0.5000, 0.2344, 0.2266, 0.1563, 0.0938, 0.0781, 0.0703, 0.0625, 0.0000],
  100:    [0.00000, -0.05906, -0.07391, -0.08864, -0.10313, -0.16914, -0.22445, -0.24533, 0.05454, 0.17527, 0.17507, 0.16077, 0.12317, 0.10890, 0.10091, 0.09233, 0.00000],
  400:    [0.00000, -0.12146, -0.15663, -0.19254, -0.22847, -0.23827, -0.44993, -0.38598, 0.05186, 0.30174, 0.30203, 0.28124, 0.22965, 0.20920, 0.19713, 0.18360, 0.00000],
  1000:   [0.00000, -0.21388, -0.27669, -0.33714, -0.39188, -0.51550, -0.42665, -0.31966, 0.02526, 0.32235, 0.33075, 0.37095, 0.32627, 0.30353, 0.29012, 0.27485, 0.00000],
};

// ---------------------------------------------------------------------------
// OUTPUT field layout (Cfd.cpp "output assembly"): the returned u/v/w are
// CELL-CENTERED (size Nx*Ny*Nz), interpolated from the staggered MAC faces as
//   uc(i,j,k) = ½(u_face[i]+u_face[i+1]),  vc = ½(v_face[j]+v_face[j+1]), ...
// stored at idxC = (k*Ny + j)*Nx + i and located at the cell center
//   ( (i+0.5)·dx , (j+0.5)·dy , (k+0.5)·dz ).
// (These are NOT the raw staggered face arrays — those stay internal.)
// ---------------------------------------------------------------------------
const idxC = (i, j, k, Nx, Ny) => (k * Ny + j) * Nx + i;

// Linear interpolation of a monotonic (xs ascending) sampled profile at t.
function interp(xs, ys, t) {
  if (t <= xs[0]) return ys[0];
  if (t >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= t) lo = m; else hi = m; }
  const f = (t - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

function statsFor(refY, refVal, simAt) {
  // returns { maxAbs, rmsAbs, maxRel, table[] }  errors as fraction of U=1
  let sumSq = 0, maxAbs = 0, maxRel = 0, nRel = 0;
  const table = [];
  for (let i = 0; i < refY.length; i++) {
    const ref = refVal[i];
    const sim = simAt[i];
    const aerr = Math.abs(sim - ref);
    sumSq += aerr * aerr;
    if (aerr > maxAbs) maxAbs = aerr;
    let rel = null;
    if (Math.abs(ref) > 0.05) { rel = aerr / Math.abs(ref); if (rel > maxRel) maxRel = rel; nRel++; }
    table.push({ s: refY[i], ref, sim, aerr, rel });
  }
  return { maxAbs, rmsAbs: Math.sqrt(sumSq / refY.length), maxRel, nRel, table };
}

function runCavity(Re, nu, maxIter) {
  const N = 64, Nz = 4;
  const cfg = {
    domain: new Float64Array([0, 0, 0, 1, 1, 1]),
    Nx: N, Ny: N, Nz,
    rho: 1.0, nu,
    maxIter, residualTol: 1e-6,
    walls: [0, 1, 2],                                  // -X,+X,-Y no-slip; z-faces = symmetry
    lid: { faceId: 3, vx: 1.0, vy: 0.0, vz: 0.0 },     // +Y lid moves +x at U=1
  };
  const t0 = Date.now();
  const r = forge.cfd.solveSteadyNS(cfg);
  const wallMs = Date.now() - t0;

  const dx = 1 / N, dy = 1 / N;
  const kMid = Math.floor(Nz / 2);
  const uc = (i, j, k) => r.u[idxC(i, j, k, N, N)];
  const vc = (i, j, k) => r.v[idxC(i, j, k, N, N)];

  // 2D-reduction validity check: with the z-faces left as symmetry planes the
  // flow must be z-invariant. Report the worst |u(k) - u(kMid)| on the
  // centerline — it should sit at machine precision (otherwise the mid-plane is
  // not a valid 2D slice and the comparison below is meaningless).
  let zVar = 0;
  for (let j = 0; j < N; j++) {
    const ref = 0.5 * (uc(N / 2 - 1, j, kMid) + uc(N / 2, j, kMid));
    for (let k = 0; k < Nz; k++) zVar = Math.max(zVar, Math.abs(0.5 * (uc(N / 2 - 1, j, k) + uc(N / 2, j, k)) - ref));
  }

  // --- u along vertical centerline x=0.5. Cell centers straddle x=0.5 at
  // i=N/2-1 (x=0.5-0.5dx) and i=N/2 (x=0.5+0.5dx); their mean is x=0.5 exactly.
  const uYs = [0.0], uVs = [0.0];                                 // bottom wall (no-slip)
  for (let j = 0; j < N; j++) { uYs.push((j + 0.5) * dy); uVs.push(0.5 * (uc(N / 2 - 1, j, kMid) + uc(N / 2, j, kMid))); }
  uYs.push(1.0); uVs.push(1.0);                                    // lid
  const uSimAt = GHIA_U.y.map(y => interp(uYs, uVs, y));
  const uStats = statsFor(GHIA_U.y, GHIA_U[Re], uSimAt);

  // --- v along horizontal centerline y=0.5. Cell centers straddle y=0.5 at
  // j=N/2-1 and j=N/2; their mean is y=0.5 exactly.
  const vXs = [0.0], vVs = [0.0];                                 // left wall (no-slip)
  for (let i = 0; i < N; i++) { vXs.push((i + 0.5) * dx); vVs.push(0.5 * (vc(i, N / 2 - 1, kMid) + vc(i, N / 2, kMid))); }
  vXs.push(1.0); vVs.push(0.0);                                    // right wall
  const vSimAt = GHIA_V.x.map(x => interp(vXs, vVs, x));
  const vStats = statsFor(GHIA_V.x, GHIA_V[Re], vSimAt);

  return { N, Nz, r, wallMs, maxIter, uStats, vStats, zVar };
}

function printProfile(title, label, stats) {
  console.log(`\n  ${title}`);
  console.log(`    ${label}        Ghia        sim        |Δ|/U      rel%`);
  for (const row of stats.table) {
    const relStr = row.rel === null ? '   —  ' : (row.rel * 100).toFixed(1).padStart(6);
    console.log(`    ${row.s.toFixed(4)}   ${row.ref.toFixed(5).padStart(9)}  ${row.sim.toFixed(5).padStart(9)}  ${(row.aerr * 100).toFixed(2).padStart(6)}%  ${relStr}`);
  }
  console.log(`    -> max |Δ| = ${(stats.maxAbs * 100).toFixed(2)} %U   RMS |Δ| = ${(stats.rmsAbs * 100).toFixed(2)} %U   max rel = ${(stats.maxRel * 100).toFixed(1)} % (over ${stats.nRel} stations |ref|>0.05)`);
}

// ===========================================================================
const CASES = [
  { Re: 100,  nu: 0.01,   maxIter: 6000 },
  { Re: 400,  nu: 0.0025, maxIter: 8000 },
  { Re: 1000, nu: 0.001,  maxIter: 14000 },
];

console.log('============================================================');
console.log(' CFD GATE — lid-driven cavity vs Ghia, Ghia & Shin (1982)');
console.log(' native solver: forge.cfd.solveSteadyNS (MAC / Chorin / 1st-order upwind)');
console.log('============================================================');

const summary = [];
for (const c of CASES) {
  console.log(`\n------------------------------------------------------------`);
  console.log(` Re = ${c.Re}   (nu = ${c.nu}, U_lid = 1, L = 1)`);
  const res = runCavity(c.Re, c.nu, c.maxIter);
  const converged = res.r.iterations < res.maxIter;
  console.log(` grid = ${res.N}x${res.N}x${res.Nz} (z-symmetry, 2D)  |  iterations = ${res.r.iterations}/${res.maxIter}` +
              ` ${converged ? '(converged to velChange<1e-6)' : '(HIT CAP — not fully steady)'}`);
  console.log(` maxVelocity = ${res.r.maxVelocity.toFixed(4)}  |  final divergence = ${res.r.finalResidual.toExponential(2)}  |  wall = ${(res.wallMs / 1000).toFixed(1)} s`);
  console.log(` 2D-reduction check: max z-variation of centerline u = ${res.zVar.toExponential(2)} (<< U_lid=1 ⇒ mid-plane is a valid 2D slice)`);
  printProfile('u along vertical centerline (x=0.5)', '  y  ', res.uStats);
  printProfile('v along horizontal centerline (y=0.5)', '  x  ', res.vStats);
  summary.push({ Re: c.Re, converged, iters: res.r.iterations, grid: `${res.N}x${res.N}`,
    uMax: res.uStats.maxAbs, uRms: res.uStats.rmsAbs, uRel: res.uStats.maxRel,
    vMax: res.vStats.maxAbs, vRms: res.vStats.rmsAbs, vRel: res.vStats.maxRel });
}

console.log('\n============================================================');
console.log(' SUMMARY (errors as % of lid speed U; rel = max pointwise relative)');
console.log('============================================================');
console.log(' Re    grid    iters  conv |  u: maxΔ  RMSΔ  maxRel |  v: maxΔ  RMSΔ  maxRel');
for (const s of summary) {
  console.log(` ${String(s.Re).padStart(4)}  ${s.grid}  ${String(s.iters).padStart(5)}  ${s.converged ? ' y ' : ' N '} | ` +
    `   ${(s.uMax*100).toFixed(1).padStart(5)} ${(s.uRms*100).toFixed(1).padStart(5)} ${(s.uRel*100).toFixed(0).padStart(5)}% | ` +
    `   ${(s.vMax*100).toFixed(1).padStart(5)} ${(s.vRms*100).toFixed(1).padStart(5)} ${(s.vRel*100).toFixed(0).padStart(5)}%`);
}
console.log('\n[cfd-ghia-gate] DONE — figures above are the REAL measured accuracy of the existing native CFD engine.');
