// ===========================================================================
// CFD COMPRESSIBLE C1 GATE — 2D Euler vs the analytic OBLIQUE-SHOCK θ-β-M law
// ---------------------------------------------------------------------------
// Runs the native solver  forge.cfd.solveCompressible2D  (CfdCompressible.cpp:
// cell-centred structured FV, the C0 Roe flux rotated into the face-normal
// frame + a tangential shear wave, slip-wall flow-tangency, supersonic
// inflow/far-field/outflow, local-time-stepping to steady state) on the
// canonical supersonic-wedge problem and compares the captured shock against
// the EXACT oblique-shock theory.
//
// Problem:  freestream M₁ = 2.0 over a θ = 15° compression wedge, γ = 1.4.
//
// Analytic (Anderson, "Modern Compressible Flow", 3rd ed., McGraw-Hill 2003,
// Ch. 4) — the WEAK-shock root of the θ-β-M relation
//     tan θ = 2 cot β (M₁² sin²β − 1) / ( M₁²(γ + cos 2β) + 2 )
// then Rankine–Hugoniot across the shock with M₁ₙ = M₁ sin β:
//     β ≈ 45.34°,  M₂ ≈ 1.446,  p₂/p₁ ≈ 2.195,  ρ₂/ρ₁ ≈ 1.729.
//
//   NOTE on the task literals: the task brief quoted p₂/p₁≈1.7066 and
//   ρ₂/ρ₁≈1.4584 for this case — those are in fact the θ=10° values; for the
//   specified θ=15° (β=45.34°) the self-consistent Rankine–Hugoniot ratios are
//   2.195 / 1.729 (β and M₂≈1.45 match the brief). This gate computes the
//   analytic values FROM the relations and asserts the solver against THOSE.
//
// Run: node test/cfd_oblique_shock_gate.mjs
// ===========================================================================

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

if (!(forge.cfd && forge.cfd.solveCompressible2D)) {
  throw new Error('forge.cfd.solveCompressible2D missing from native kernel — cannot run gate');
}

// ---------------------------------------------------------------------------
// Analytic oblique-shock solution (θ-β-M weak root + Rankine–Hugoniot).
// ---------------------------------------------------------------------------
function obliqueShock(gamma, M1, thetaDeg) {
  const g = gamma, theta = thetaDeg * Math.PI / 180;
  const thetaOf = (beta) => {
    const s = Math.sin(beta), c2 = Math.cos(2 * beta);
    return Math.atan(2 / Math.tan(beta) * (M1 * M1 * s * s - 1) /
                     (M1 * M1 * (g + c2) + 2));
  };
  const muA = Math.asin(1 / M1);            // Mach angle (β where θ=0)
  // locate β_max (detachment) to bracket the weak root on [muA, β_max]
  let bmax = muA, tmax = -1;
  for (let b = muA; b < Math.PI / 2; b += 1e-4) {
    const t = thetaOf(b); if (t > tmax) { tmax = t; bmax = b; }
  }
  if (theta > tmax + 1e-9)
    throw new Error(`θ=${thetaDeg}° exceeds detachment angle for M=${M1}`);
  let lo = muA + 1e-7, hi = bmax;           // weak root: θ monotone increasing
  for (let it = 0; it < 200; ++it) {
    const m = 0.5 * (lo + hi);
    if (thetaOf(m) < theta) lo = m; else hi = m;
  }
  const beta = 0.5 * (lo + hi);
  const betaDeg = beta * 180 / Math.PI;
  const M1n = M1 * Math.sin(beta), M1n2 = M1n * M1n;
  const p2p1 = 1 + 2 * g / (g + 1) * (M1n2 - 1);
  const r2r1 = (g + 1) * M1n2 / ((g - 1) * M1n2 + 2);
  const T2T1 = p2p1 / r2r1;
  const M2n  = Math.sqrt((1 + (g - 1) / 2 * M1n2) / (g * M1n2 - (g - 1) / 2));
  const M2   = M2n / Math.sin(beta - theta);
  return { betaDeg, M1n, p2p1, r2r1, T2T1, M2, betaRad: beta };
}

// ---------------------------------------------------------------------------
const GAMMA = 1.4, M1 = 2.0, THETA = 15.0;
const an = obliqueShock(GAMMA, M1, THETA);

console.log('============================================================');
console.log(' Oblique shock — analytic θ-β-M (weak root) + Rankine–Hugoniot');
console.log('   freestream M₁=2.0, wedge θ=15°, γ=1.4');
console.log('------------------------------------------------------------');
console.log(`   β      = ${an.betaDeg.toFixed(3)} °   (brief: 45.34°)`);
console.log(`   M₁ₙ    = ${an.M1n.toFixed(4)}`);
console.log(`   M₂     = ${an.M2.toFixed(4)}   (brief: 1.4512)`);
console.log(`   p₂/p₁  = ${an.p2p1.toFixed(4)}   (brief literal 1.7066 = θ=10° value)`);
console.log(`   ρ₂/ρ₁  = ${an.r2r1.toFixed(4)}   (brief literal 1.4584 = θ=10° value)`);

// sanity: our θ-β-M root must reproduce the cited 45.34°
if (Math.abs(an.betaDeg - 45.34) > 0.05) {
  console.error(`FATAL: analytic β=${an.betaDeg} disagrees with cited 45.34°`);
  process.exit(1);
}
console.log('   (analytic β agrees with the cited 45.34° literal — OK)');

// ---------------------------------------------------------------------------
// Run the native 2D solver to steady state.
// ---------------------------------------------------------------------------
const X_INLET = 0.0, X_RAMP = 1.0, X_OUTLET = 3.0, Y_TOP = 2.2;

function runCase(label, cfg) {
  const t0 = Date.now();
  const r = forge.cfd.solveCompressible2D(cfg);
  const ni = r.ni, nj = r.nj;
  const x = r.x, y = r.y, p = r.p, rho = r.rho, mach = r.mach;
  const at = (i, j) => i + j * ni;

  // --- shock angle: per-row max-pressure-jump → fit a line through the jumps -
  const pts = [];
  const jLo = Math.floor(nj * 0.18), jHi = Math.floor(nj * 0.72);
  for (let j = jLo; j <= jHi; ++j) {
    let bi = -1, bj = -Infinity;
    for (let i = 1; i < ni - 1; ++i) {
      const dj = p[at(i + 1, j)] - p[at(i, j)];   // compression: p rises in +x
      if (dj > bj) { bj = dj; bi = i; }
    }
    if (bi < 0 || bj < 0.05 * cfg.pInf) continue;   // require a real jump
    const xm = 0.5 * (x[at(bi, j)] + x[at(bi + 1, j)]);
    const ym = 0.5 * (y[at(bi, j)] + y[at(bi + 1, j)]);
    // keep jumps comfortably inside the domain (away from corner / outflow)
    if (xm > X_RAMP + 0.25 && xm < X_OUTLET - 0.25) pts.push([xm, ym]);
  }
  // least-squares line  y = m x + c  →  β = atan(m)
  let n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [px, py] of pts) { sx += px; sy += py; sxx += px * px; sxy += px * py; }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const betaMeas = Math.atan(m) * 180 / Math.PI;

  // --- post-shock plateau (region II): deep behind the shock, near the wall --
  let sR = 0, sP = 0, sM = 0, sU = 0, sV = 0, cnt = 0;
  for (let j = 0; j < nj; ++j)
    for (let i = 0; i < ni; ++i) {
      const c = at(i, j);
      if (x[c] < X_RAMP + 0.8 || x[c] > X_OUTLET - 0.3) continue;
      if (y[c] < 0.10 || y[c] > 0.70) continue;        // near wall, below shock
      if (p[c] < 1.5 * cfg.pInf) continue;             // clearly post-shock
      sR += rho[c]; sP += p[c]; sM += mach[c];
      sU += r.u[c]; sV += r.v[c]; ++cnt;
    }
  const rho2 = sR / cnt, p2 = sP / cnt, M2 = sM / cnt;
  const uMean = sU / cnt, vMean = sV / cnt;
  const deflDeg = Math.atan2(vMean, uMean) * 180 / Math.PI;

  const p2p1M = p2 / cfg.pInf, r2r1M = rho2 / cfg.rhoInf;
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // --- report ---------------------------------------------------------------
  const degErr = Math.abs(betaMeas - an.betaDeg);
  const rel = (a, b) => Math.abs(a - b) / Math.abs(b) * 100;
  const rows = [
    ['β  shock angle (°)', betaMeas, an.betaDeg, degErr, 1.0, '°  abs', degErr <= 1.0],
    ['M₂ post-shock',      M2,       an.M2,      rel(M2, an.M2),       3.0, '% rel', rel(M2, an.M2) <= 3.0],
    ['p₂/p₁',              p2p1M,    an.p2p1,    rel(p2p1M, an.p2p1),  3.0, '% rel', rel(p2p1M, an.p2p1) <= 3.0],
    ['ρ₂/ρ₁',              r2r1M,    an.r2r1,    rel(r2r1M, an.r2r1),  3.0, '% rel', rel(r2r1M, an.r2r1) <= 3.0],
  ];
  console.log(`\n── ${label}  (ni=${ni}, nj=${nj}, order=${cfg.order}, iters=${r.iters}, res ${r.res0.toExponential(2)}→${r.resFinal.toExponential(2)}, ${dt}s) ──`);
  console.log(`   shock-fit points = ${n};  region-II samples = ${cnt};  flow deflection = ${deflDeg.toFixed(2)}° (θ=${THETA}°)`);
  console.log('   ' + 'quantity'.padEnd(20) + 'measured'.padStart(11) + 'analytic'.padStart(11) + 'error'.padStart(12) + '   verdict');
  let pass = true;
  for (const [name, meas, exact, err, thr, unit, ok] of rows) {
    if (!ok) pass = false;
    console.log('   ' + name.padEnd(20) +
      meas.toFixed(4).padStart(11) + exact.toFixed(4).padStart(11) +
      (err.toFixed(3) + unit.slice(0, 2)).padStart(12) +
      `   ${ok ? 'PASS' : 'FAIL'} (≤${thr}${unit.slice(2)})`);
  }
  console.log(`   → ${label}: ${pass ? 'PASS' : 'FAIL'}`);
  return { pass, betaMeas, M2, p2p1M, r2r1M };
}

const base = {
  gamma: GAMMA, machInf: M1, wedgeDeg: THETA,
  xInlet: X_INLET, xRamp: X_RAMP, xOutlet: X_OUTLET, yTop: Y_TOP,
  rhoInf: 1.0, pInf: 1.0, cfl: 0.5, resTol: 1e-6, maxIter: 40000,
};

// PRIMARY verdict: 1st-order on a fine structured grid (robust, honest).
const primary = runCase('PRIMARY  1st-order Roe (fine grid)',
  { ...base, ni: 360, nj: 180, order: 1 });
// Honest comparison: MUSCL (sharper shock) + a coarser 1st-order grid.
const muscl = runCase('MUSCL/van-Leer (2nd order)',
  { ...base, ni: 360, nj: 180, order: 2 });
const coarse = runCase('1st-order Roe (coarse grid)',
  { ...base, ni: 200, nj: 100, order: 1 });

console.log('\n============================================================');
console.log(` GATE VERDICT (primary = 1st-order ni=360): ${primary.pass ? 'PASS' : 'FAIL'}`);
console.log(`   MUSCL ni=360: ${muscl.pass ? 'pass' : 'fail'} | 1st-order ni=200: ${coarse.pass ? 'pass' : 'fail'}`);
console.log('============================================================');

if (!primary.pass) {
  console.error('\nOblique-shock gate FAILED (primary 1st-order did not meet the bar).');
  process.exit(1);
}
console.log('\nOblique-shock θ-β-M gate PASSED.');
