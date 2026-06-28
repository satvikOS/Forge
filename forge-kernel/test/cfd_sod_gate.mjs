// ===========================================================================
// CFD COMPRESSIBLE GATE — 1D Euler vs the EXACT Sod shock-tube Riemann solution
// ---------------------------------------------------------------------------
// Runs the native solver  forge.cfd.solveCompressible1D  (CfdCompressible.cpp:
// conservative 1D Euler, Roe approximate Riemann flux + Harten–Hyman entropy
// fix, SSP-RK2, optional MUSCL/van-Leer) and compares against the EXACT
// solution of the classic Sod problem.
//
// Standard Sod problem (Toro, "Riemann Solvers and Numerical Methods for Fluid
// Dynamics", 3rd ed., Springer 2009 — Test 1, Table 4.1 / §4.3.3):
//   domain [0,1], diaphragm x=0.5, γ=1.4, t=0.2
//   LEFT  ρ=1.0,   u=0, p=1.0
//   RIGHT ρ=0.125, u=0, p=0.1
// Resulting structure (left→right): rarefaction, contact, right shock.
//
// EXACT star-region values (Toro, Test 1):
//   p*    ≈ 0.30313   u*    ≈ 0.92745
//   ρ*_L  ≈ 0.42632   ρ*_R  ≈ 0.26557
//   contact x ≈ 0.6857   shock x ≈ 0.8504   (at t=0.2)
// These are reproduced here by an independent exact Riemann solver (Newton on
// p*) and cross-checked against the cited literals; the gate asserts the
// NUMERICAL solution matches the exact one. We report the REAL measured error.
//
// Run: node test/cfd_sod_gate.mjs
// ===========================================================================

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

if (!(forge.cfd && forge.cfd.solveCompressible1D)) {
  throw new Error('forge.cfd.solveCompressible1D missing from native kernel — cannot run gate');
}

// ---------------------------------------------------------------------------
// Cited reference literals (Toro, Test 1) — used as an independent sanity check
// against our own exact Riemann solver.
// ---------------------------------------------------------------------------
const CITED = {
  pStar: 0.30313, uStar: 0.92745, rhoStarL: 0.42632, rhoStarR: 0.26557,
  xContact: 0.6857, xShock: 0.8504,
};

// ---------------------------------------------------------------------------
// Exact Riemann solver for the 1D Euler equations (ideal gas).
// Standard Newton iteration on the star pressure (Toro Ch. 4).
// ---------------------------------------------------------------------------
function exactSod(gamma, L, R, x0, t) {
  const g = gamma;
  const { rho: rL, u: uL, p: pL } = L;
  const { rho: rR, u: uR, p: pR } = R;
  const aL = Math.sqrt(g * pL / rL);
  const aR = Math.sqrt(g * pR / rR);
  const G1 = (g - 1) / (2 * g);
  const G2 = (g + 1) / (2 * g);

  // pressure function for one side: f_K(p) and f'_K(p)
  function f(p, rK, pK, aK) {
    if (p > pK) { // shock
      const AK = 2 / ((g + 1) * rK);
      const BK = (g - 1) / (g + 1) * pK;
      const sq = Math.sqrt(AK / (p + BK));
      const val = (p - pK) * sq;
      const der = sq * (1 - 0.5 * (p - pK) / (p + BK));
      return [val, der];
    } else { // rarefaction
      const val = (2 * aK / (g - 1)) * (Math.pow(p / pK, G1) - 1);
      const der = (1 / (rK * aK)) * Math.pow(p / pK, -G2);
      return [val, der];
    }
  }

  // Newton solve  f_L(p) + f_R(p) + (uR - uL) = 0
  let p = 0.5 * (pL + pR); // initial guess
  if (p < 1e-8) p = 1e-8;
  for (let it = 0; it < 100; ++it) {
    const [fL, dfL] = f(p, rL, pL, aL);
    const [fR, dfR] = f(p, rR, pR, aR);
    const fn = fL + fR + (uR - uL);
    const dfn = dfL + dfR;
    const pNew = p - fn / dfn;
    if (Math.abs(pNew - p) / (0.5 * (p + pNew)) < 1e-12) { p = pNew; break; }
    p = Math.max(1e-9, pNew);
  }
  const pStar = p;
  const [fL] = f(pStar, rL, pL, aL);
  const [fR] = f(pStar, rR, pR, aR);
  const uStar = 0.5 * (uL + uR) + 0.5 * (fR - fL);

  // star densities
  const rhoStarL = (pStar > pL)
    ? rL * ((pStar / pL + (g - 1) / (g + 1)) / ((g - 1) / (g + 1) * pStar / pL + 1))
    : rL * Math.pow(pStar / pL, 1 / g);
  const rhoStarR = (pStar > pR)
    ? rR * ((pStar / pR + (g - 1) / (g + 1)) / ((g - 1) / (g + 1) * pStar / pR + 1))
    : rR * Math.pow(pStar / pR, 1 / g);

  // wave positions at time t
  const xContact = x0 + uStar * t;
  // right shock speed (right state is a shock for Sod)
  const Sr = uR + aR * Math.sqrt(G2 * (pStar / pR) + G1);
  const xShock = x0 + Sr * t;
  // left rarefaction head/tail (left state is a rarefaction for Sod)
  const aStarL = aL * Math.pow(pStar / pL, G1);
  const xHead = x0 + (uL - aL) * t;
  const xTail = x0 + (uStar - aStarL) * t;

  return { pStar, uStar, rhoStarL, rhoStarR, xContact, xShock, xHead, xTail, Sr };
}

// ---------------------------------------------------------------------------
// Measurement helpers on a numerical (x, rho, u, p) profile.
// ---------------------------------------------------------------------------
function nearestIndex(x, xq) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < x.length; ++i) {
    const d = Math.abs(x[i] - xq);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// shock position: interface with the largest pressure jump (pressure is flat
// across the contact, smooth in the rarefaction, jumps only at the shock).
function findShock(x, p) {
  let bi = 0, bj = -Infinity;
  for (let i = 0; i < p.length - 1; ++i) {
    const dj = Math.abs(p[i + 1] - p[i]);
    if (dj > bj) { bj = dj; bi = i; }
  }
  return 0.5 * (x[bi] + x[bi + 1]);
}

// contact position: largest density jump strictly between the rarefaction tail
// and just left of the shock (so the shock's own density jump is excluded).
function findContact(x, rho, xLo, xHi) {
  let bi = -1, bj = -Infinity;
  for (let i = 0; i < rho.length - 1; ++i) {
    const xm = 0.5 * (x[i] + x[i + 1]);
    if (xm < xLo || xm > xHi) continue;
    const dj = Math.abs(rho[i + 1] - rho[i]);
    if (dj > bj) { bj = dj; bi = i; }
  }
  return bi < 0 ? NaN : 0.5 * (x[bi] + x[bi + 1]);
}

function run(label, cfg, ex, gate) {
  const r = forge.cfd.solveCompressible1D(cfg);
  const { x, rho, u, p } = { x: [...r.x], rho: [...r.rho], u: [...r.u], p: [...r.p] };

  const xShockN   = findShock(x, p);
  const xContactN = findContact(x, rho, ex.xTail + 0.01, xShockN - 0.03);

  // sample plateau star states at the MIDDLE of each constant region
  const iR = nearestIndex(x, 0.5 * (ex.xContact + ex.xShock)); // right star
  const iL = nearestIndex(x, 0.5 * (ex.xTail + ex.xContact));  // left star
  const pStarN    = p[iR];
  const uStarN    = u[iR];
  const rhoStarRN = rho[iR];
  const rhoStarLN = rho[iL];

  const dom = cfg.xR - cfg.xL;
  const posErr = (a, b) => Math.abs(a - b) / dom * 100;      // % of domain
  const relErr = (a, b) => Math.abs(a - b) / Math.abs(b) * 100;

  const rows = [
    ['shock position', xShockN,   ex.xShock,   posErr(xShockN,   ex.xShock),   gate.pos, '% dom'],
    ['contact position', xContactN, ex.xContact, posErr(xContactN, ex.xContact), gate.pos, '% dom'],
    ['p*  (star pressure)', pStarN,    ex.pStar,    relErr(pStarN,    ex.pStar),    gate.puv, '% rel'],
    ['u*  (star velocity)', uStarN,    ex.uStar,    relErr(uStarN,    ex.uStar),    gate.puv, '% rel'],
    ['ρ*_L (rarefn side)',  rhoStarLN, ex.rhoStarL, relErr(rhoStarLN, ex.rhoStarL), gate.rho, '% rel'],
    ['ρ*_R (shock side)',   rhoStarRN, ex.rhoStarR, relErr(rhoStarRN, ex.rhoStarR), gate.rho, '% rel'],
  ];

  console.log(`\n── ${label}  (N=${cfg.N}, order=${cfg.order}, steps=${r.steps}, ${r.cpuMs.toFixed(1)} ms) ──`);
  console.log('  quantity'.padEnd(24) + 'measured'.padStart(12) + 'exact'.padStart(12) + 'error'.padStart(12) + '   verdict');
  let pass = true;
  for (const [name, meas, exact, err, thr, unit] of rows) {
    const ok = err <= thr;
    if (!ok) pass = false;
    console.log(
      '  ' + name.padEnd(22) +
      meas.toFixed(5).padStart(12) +
      exact.toFixed(5).padStart(12) +
      (err.toFixed(2) + ' ' + unit).padStart(12) +
      `   ${ok ? 'PASS' : 'FAIL'} (≤${thr}${unit.includes('dom') ? '% dom' : '% rel'})`
    );
  }
  console.log(`  → ${label}: ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ---------------------------------------------------------------------------
const GAMMA = 1.4;
const L = { rho: 1.0, u: 0.0, p: 1.0 };
const R = { rho: 0.125, u: 0.0, p: 0.1 };
const X0 = 0.5, T = 0.2;

const ex = exactSod(GAMMA, L, R, X0, T);

console.log('============================================================');
console.log(' Sod shock tube — exact Riemann solution (independent solver)');
console.log('   vs cited Toro Test-1 literals');
console.log('------------------------------------------------------------');
const chk = (n, a, b) => console.log(
  `   ${n.padEnd(10)} computed=${a.toFixed(5)}  cited=${b.toFixed(5)}  Δ=${(Math.abs(a - b)).toExponential(2)}`);
chk('p*',       ex.pStar,    CITED.pStar);
chk('u*',       ex.uStar,    CITED.uStar);
chk('rho*_L',   ex.rhoStarL, CITED.rhoStarL);
chk('rho*_R',   ex.rhoStarR, CITED.rhoStarR);
chk('x_contact',ex.xContact, CITED.xContact);
chk('x_shock',  ex.xShock,   CITED.xShock);
console.log(`   x_head=${ex.xHead.toFixed(5)}  x_tail=${ex.xTail.toFixed(5)}  shockSpeed=${ex.Sr.toFixed(5)}`);

// sanity: our exact solver must match the cited literals to <2e-3
for (const [n, a, b] of [
  ['p*', ex.pStar, CITED.pStar], ['u*', ex.uStar, CITED.uStar],
  ['rho*_L', ex.rhoStarL, CITED.rhoStarL], ['rho*_R', ex.rhoStarR, CITED.rhoStarR],
  ['x_contact', ex.xContact, CITED.xContact], ['x_shock', ex.xShock, CITED.xShock],
]) {
  if (Math.abs(a - b) > 2e-3) {
    console.error(`FATAL: exact solver disagrees with cited ${n}: ${a} vs ${b}`);
    process.exit(1);
  }
}
console.log('   (exact solver agrees with cited Toro literals — OK)');

// gate thresholds
const GATE = { pos: 2.0, puv: 2.0, rho: 3.0 }; // % domain (pos), % rel (states)

const base = { xL: 0, xR: 1, x0: X0, gamma: GAMMA, tEnd: T, cfl: 0.4,
  rhoL: L.rho, uL: L.u, pL: L.p, rhoR: R.rho, uR: R.u, pR: R.p };

// PRIMARY verdict: 2nd-order MUSCL on a fine grid.
const primary = run('PRIMARY  MUSCL/van-Leer (2nd order)', { ...base, N: 800, order: 2 }, ex, GATE);
// Honest comparison: first-order on the same grid + a coarser MUSCL grid.
const foN800 = run('first-order Roe (reference)', { ...base, N: 800, order: 1 }, ex, GATE);
const muN400 = run('MUSCL 2nd order (coarser)',   { ...base, N: 400, order: 2 }, ex, GATE);

console.log('\n============================================================');
console.log(` GATE VERDICT (primary = MUSCL N=800): ${primary ? 'PASS' : 'FAIL'}`);
console.log(`   first-order N=800: ${foN800 ? 'pass' : 'fail'} | MUSCL N=400: ${muN400 ? 'pass' : 'fail'}`);
console.log('============================================================');

if (!primary) {
  console.error('\nSod shock-tube gate FAILED (primary MUSCL N=800 did not meet the bar).');
  process.exit(1);
}
console.log('\nSod shock-tube gate PASSED.');
