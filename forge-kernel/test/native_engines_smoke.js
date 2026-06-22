// forge-kernel native_engines_smoke.js  (Task #46)
//
// Cross-checks every NEWLY-BOUND forge::native engine op against the SAME
// deterministic known-answer its standalone native gate asserts
// (test/native/<engine>/<engine>_test.cpp). Each assertion mirrors a check()
// in the gate, so a green run here proves the bound JS path returns the real
// native result — not a stub.
//
// Engines: tolstack, vvuq, materials, am, composites, surfit, cam.
//
// Run:  node forge-kernel/test/native_engines_smoke.js   (exit 0 on success)

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
let forge;
try {
  forge = require(KERNEL);
} catch (e) {
  console.error('[engines-smoke] FAILED to load kernel at', KERNEL);
  console.error(e);
  process.exit(1);
}
const N = forge.native;
assert.ok(N && typeof N === 'object', 'forge.native namespace must exist');

const approx = (a, b, tol = 1e-7) => Math.abs(a - b) <= tol * (1 + Math.abs(a) + Math.abs(b));

// ─────────────────────────────── tolstack ───────────────────────────────────
// Gate (tolstack_test.cpp §1): 3 contributors 10(+1),20(+1),25(-1), each ±0.10
// NORMAL, LSL 4.8 USL 5.2 -> wcNominal 5, wcTol 0.30, wcMin 4.7, wcMax 5.3,
// rssSigma = sqrt(3·(0.10/3)^2), rssYield ~ 0.99947, cp = cpk ~ 1.1547.
{
  const r = N.tolstackAnalyze({
    contributors: [
      { nominal: 10, plusTol: 0.10, minusTol: 0.10, sensitivity: +1, dist: 'NORMAL' },
      { nominal: 20, plusTol: 0.10, minusTol: 0.10, sensitivity: +1, dist: 'NORMAL' },
      { nominal: 25, plusTol: 0.10, minusTol: 0.10, sensitivity: -1, dist: 'NORMAL' },
    ],
    LSL: 4.8, USL: 5.2, k: 3.0, mcSamples: 200000, mcSeed: 0xABCDEF01,
    cltMinContributors: 3,
  });
  const sig1 = 0.10 / 3.0;
  const rssSig = Math.sqrt(3.0 * sig1 * sig1);
  const refCp = 0.4 / (6.0 * rssSig);
  assert.ok(approx(r.wcNominal, 5.0), `tolstack wcNominal ${r.wcNominal} != 5`);
  assert.ok(approx(r.wcTol, 0.30), `tolstack wcTol ${r.wcTol} != 0.30`);
  assert.ok(approx(r.wcMin, 4.7), `tolstack wcMin ${r.wcMin} != 4.7`);
  assert.ok(approx(r.wcMax, 5.3), `tolstack wcMax ${r.wcMax} != 5.3`);
  assert.ok(approx(r.rssSigma, rssSig, 1e-9), `tolstack rssSigma ${r.rssSigma} != ${rssSig}`);
  assert.ok(r.rssYield > 0.999 && r.rssYield < 1.0, `tolstack rssYield ${r.rssYield} !~ 0.99947`);
  assert.ok(approx(r.cp, refCp), `tolstack cp ${r.cp} != ${refCp}`);
  assert.ok(approx(r.cp, 1.1547, 1e-3), `tolstack cp ${r.cp} != 1.1547`);
  assert.ok(approx(r.cpk, refCp), `tolstack cpk ${r.cpk} != cp`);
  assert.strictEqual(r.rssValid, true, 'tolstack rssValid must be true (linear all-normal)');
  assert.strictEqual(r.authoritativeMc, false, 'tolstack MC not authoritative when RSS valid');
  assert.ok(Math.abs(r.mcYield - r.rssYield) < 0.003, 'tolstack mcYield ~ rssYield');
  console.log(`[engines-smoke] tolstack: wcTol=${r.wcTol.toFixed(4)} rssSigma=${r.rssSigma.toExponential(4)} cp=${r.cp.toFixed(4)} rssYield=${r.rssYield.toFixed(5)} OK`);
}

// ──────────────────────────────── vvuq ──────────────────────────────────────
// Gate (vvuq_test.cpp §2a): 2nd-order seq f(h)=12.5+0.5 h^2 at h=0.4,0.2,0.1 ->
// cls CONVERGING, orderP ~ 2.0, convergedValue ~ 12.5, gci < 0.05.
{
  const fInf = 12.5, C = 0.5, fOf = h => fInf + C * h * h;
  const r = N.vvuqConvergence([
    { h: 0.4, value: fOf(0.4) },
    { h: 0.2, value: fOf(0.2) },
    { h: 0.1, value: fOf(0.1) },
  ]);
  assert.strictEqual(r.cls, 'CONVERGING', `vvuq cls ${r.cls} != CONVERGING`);
  assert.ok(approx(r.orderP, 2.0, 0.05), `vvuq orderP ${r.orderP} !~ 2.0`);
  assert.ok(approx(r.convergedValue, fInf, 1e-4), `vvuq convergedValue ${r.convergedValue} !~ 12.5`);
  assert.ok(r.gci >= 0 && r.gci < 0.05, `vvuq gci ${r.gci} not in [0,0.05)`);
  assert.strictEqual(r.monotone, true, 'vvuq monotone');
  console.log(`[engines-smoke] vvuq convergence: cls=${r.cls} orderP=${r.orderP.toFixed(4)} converged=${r.convergedValue.toFixed(4)} gci=${r.gci.toFixed(4)} OK`);
}
// Gate (vvuq_test.cpp §3): hourglass 12% of IE -> RED, pct == 12.
{
  const r = N.vvuqEnergyAudit({ internalEnergy: 100.0, hourglassEnergy: 12.0 });
  assert.ok(approx(r.hourglassPct, 12.0), `vvuq hourglassPct ${r.hourglassPct} != 12`);
  assert.strictEqual(r.level, 'RED', `vvuq hourglass 12% level ${r.level} != RED`);
  assert.ok(r.reasons.length > 0, 'vvuq RED audit has reasons');
  // sanity: 3% -> GREEN
  const g = N.vvuqEnergyAudit({ internalEnergy: 100.0, hourglassEnergy: 3.0 });
  assert.strictEqual(g.level, 'GREEN', `vvuq hourglass 3% level ${g.level} != GREEN`);
  console.log(`[engines-smoke] vvuq energy: 12% HG -> ${r.level} (pct=${r.hourglassPct}); 3% -> ${g.level} OK`);
}

// ────────────────────────────── materials ───────────────────────────────────
// Gate (materials_test.cpp §1): Ti6Al4V LPBF HIP (isotropic) E_eff ~ 114 GPa,
// direction-independent -> dir-x == dir-(1,1,1). In-plane axis -> HIGH confidence.
{
  const key = (loadDir) => ({ material: 'Ti6Al4V', process: 'LPBF', buildOrient: 'NA', postProcess: 'HIP', loadDir });
  const ex = N.materialsQuery(key([1, 0, 0]));
  const e111 = N.materialsQuery(key([1, 1, 1]));
  assert.strictEqual(ex.ok, true, 'materials Ti query ok');
  assert.ok(approx(ex.E_eff, e111.E_eff, 1e-9), 'materials iso E_eff dir-independent');
  assert.ok(approx(ex.E_eff, 114.0e9, 1e-3), `materials E_eff ${ex.E_eff} !~ 114 GPa`);
  // Gate §2: ABS FDM in-plane axis-1 -> HIGH; Z stiffness 40-75% of in-plane.
  const absKey = (loadDir) => ({ material: 'ABS', process: 'FDM_FFF', buildOrient: 'XY_INPLANE', postProcess: 'AS_BUILT', loadDir });
  const axy = N.materialsQuery(absKey([1, 0, 0]));
  const az  = N.materialsQuery(absKey([0, 0, 1]));
  assert.strictEqual(axy.confidence, 'HIGH', `ABS in-plane confidence ${axy.confidence} != HIGH`);
  const stiffRatio = az.E_eff / axy.E_eff;
  assert.ok(stiffRatio >= 0.40 && stiffRatio <= 0.75, `ABS Z stiffness ratio ${stiffRatio} not 40-75%`);
  console.log(`[engines-smoke] materials: Ti E_eff=${(ex.E_eff/1e9).toFixed(1)} GPa (iso), ABS Z/XY stiffness=${stiffRatio.toFixed(3)}, conf=${axy.confidence} OK`);
}

// ──────────────────────────────── am ────────────────────────────────────────
// Gate (am_test.cpp §0): a free 20mm cube with uniform iso eigenstrain -1e-3 ->
// stress-free (maxVonMises < 1e3), body displaces (maxWarp > 1e-6),
// recovered eps_xx ~ -1e-3. Build the same 2x2x2 box tet mesh + plate below.
{
  const Lx = 0.02, Ly = 0.02, Lz = 0.02, nx = 2, ny = 2, nz = 2;
  const NX = nx + 1, NY = ny + 1, NZ = nz + 1;
  const nidx = (i, j, k) => i + NX * (j + NY * k);
  const nodes = [];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
    nodes.push(Lx * i / nx, Ly * j / ny, Lz * k / nz);
  const TET = [[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6],[0,5,1,6]];
  const node = (idx) => [nodes[idx*3], nodes[idx*3+1], nodes[idx*3+2]];
  const tets = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = [nidx(i,j,k), nidx(i+1,j,k), nidx(i+1,j+1,k), nidx(i,j+1,k),
               nidx(i,j,k+1), nidx(i+1,j,k+1), nidx(i+1,j+1,k+1), nidx(i,j+1,k+1)];
    for (const t of TET) {
      let q = [c[t[0]], c[t[1]], c[t[2]], c[t[3]]];
      const p0 = node(q[0]), p1 = node(q[1]), p2 = node(q[2]), p3 = node(q[3]);
      const d = (p1[0]-p0[0])*((p2[1]-p0[1])*(p3[2]-p0[2])-(p2[2]-p0[2])*(p3[1]-p0[1]))
              - (p1[1]-p0[1])*((p2[0]-p0[0])*(p3[2]-p0[2])-(p2[2]-p0[2])*(p3[0]-p0[0]))
              + (p1[2]-p0[2])*((p2[0]-p0[0])*(p3[1]-p0[1])-(p2[1]-p0[1])*(p3[0]-p0[0]));
      if (d < 0) { const tmp = q[1]; q[1] = q[2]; q[2] = tmp; }
      tets.push(q[0], q[1], q[2], q[3]);
    }
  }
  const w = N.amWarp({
    nodes, tets,
    material: { material: 'Ti6Al4V', process: 'LPBF', buildOrient: 'NA', postProcess: 'HIP' },
    inherent: { exx: -1e-3, eyy: -1e-3, ezz: -1e-3, calibrated: true },
    orientation: [1,0,0, 0,1,0, 0,0,1],
    plateZ: -1.0,    // plate below the box -> free body (no clamp)
  });
  assert.strictEqual(w.ok, true, 'am free-body warp solved');
  assert.ok(w.maxVonMises < 1.0e3, `am free uniform eigenstrain stress-free, vM=${w.maxVonMises}`);
  assert.ok(w.maxWarp > 1e-6, `am free body displaces, maxWarp=${w.maxWarp}`);
  // recovered eps_xx along the lowest +x edge (node 0 vs node 2)
  const dx = w.nodeDisp[2*3+0] - w.nodeDisp[0*3+0];
  const exx = dx / 0.02;
  assert.ok(exx < 0.0, `am recovered eps_xx contraction (negative), got ${exx}`);
  assert.ok(Math.abs(exx - (-1e-3)) < 3e-4, `am recovered eps_xx ${exx} !~ -1e-3`);
  console.log(`[engines-smoke] am: maxVonMises=${w.maxVonMises.toExponential(2)} maxWarp=${w.maxWarp.toExponential(3)} eps_xx=${exx.toExponential(3)} OK`);
}

// ───────────────────────────── composites ───────────────────────────────────
// Gate (composites_test.cpp §2): symmetric cross-ply [0/90/90/0] (= [0/90]s)
// of CFRP UD (E1~135 GPa, E2~9.5 GPa) -> B matrix == 0, symmetric flag true.
{
  const cfrp = { E1: 135e9, E2: 9.5e9, G12: 4.8e9, nu12: 0.3 };
  const ply = (deg) => ({ ...cfrp, thickness: 0.125e-3, angleDeg: deg });
  const r = N.compositesClt({ plies: [ply(0), ply(90), ply(90), ply(0)] });
  assert.strictEqual(r.ok, true, 'composites CLT solved');
  assert.strictEqual(r.Bmax, 0.0, `composites [0/90]s B matrix must be 0, Bmax=${r.Bmax}`);
  assert.strictEqual(r.symmetric, true, 'composites symmetric flag true for [0/90]s');
  assert.ok(r.Ex > 0 && r.Ey > 0, 'composites effective moduli positive');
  // 45deg single ply must have a real Q16 shear coupling -> Ex distinct from 0/90.
  const off = N.compositesClt({ plies: [ply(45)] });
  assert.ok(off.ok && off.Ex > 0 && off.Ex < r.Ex, 'composites 45deg ply softer than cross-ply');
  console.log(`[engines-smoke] composites: [0/90]s Bmax=${r.Bmax} symmetric=${r.symmetric} Ex=${(r.Ex/1e9).toFixed(1)} GPa OK`);
}

// ─────────────────────────────── surfit ─────────────────────────────────────
// Gate (surfit_test.cpp §2): an affine plane cloud z=0.7x-0.4y+1.25 over a 16x16
// grid on [0,3]^2 -> ok, rms < 1e-6, maxDist < 1e-6 (a degree>=1 net is exact).
{
  const L = 3.0, n = 16;
  const pts = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = L * i / (n - 1), y = L * j / (n - 1);
    pts.push(x, y, 0.7 * x - 0.4 * y + 1.25);
  }
  const r = N.surfitFit(pts);
  assert.strictEqual(r.ok, true, `surfit fit ok (${r.reason})`);
  assert.ok(r.rms < 1e-6, `surfit affine plane rms ${r.rms} not < 1e-6`);
  assert.ok(r.maxDist < 1e-6, `surfit affine plane maxDist ${r.maxDist} not < 1e-6`);
  console.log(`[engines-smoke] surfit: affine plane rms=${r.rms.toExponential(2)} maxDist=${r.maxDist.toExponential(2)} net=${r.nU}x${r.nV} OK`);
}

// ──────────────────────────────── cam ───────────────────────────────────────
// Gate (cam_test.cpp §A): stock 40x20x10, flat-end r=3 tool, straight slot
// y=10, x in [10,30], tip z=8 (d=2 deep). stockVolume0 ~ 8000; fine spacing
// removedVolume within 5% of analytic stadium-prism (2rL + pi r^2)·d.
{
  const r = 3.0, d = 2.0, L = 20.0;
  const args = (spacing) => ({
    stock: { lo: [0, 0, 0], hi: [40, 20, 10] },
    tool: { radius: r, length: 30.0, cornerRadius: 0.0 },
    path: [
      { p: [10, 10, 8], rapid: false },
      { p: [10 + L, 10, 8], rapid: false },
    ],
    spacing,
  });
  const analytic = (2.0 * r * L + Math.PI * r * r) * d;
  const fine = N.camRemoveMaterial(args(0.25));
  assert.strictEqual(fine.ok, true, `cam removeMaterial ok (${fine.reason})`);
  assert.ok(approx(fine.voxelResolution, 0.25, 1e-12), `cam resolution ${fine.voxelResolution} != 0.25`);
  assert.ok(Math.abs(fine.stockVolume0 - 8000) < 0.02 * 8000, `cam stockVolume0 ${fine.stockVolume0} !~ 8000`);
  const errFine = Math.abs(fine.removedVolume - analytic) / analytic;
  assert.ok(errFine < 0.05, `cam fine removedVolume ${fine.removedVolume} not within 5% of analytic ${analytic.toFixed(2)} (err ${(errFine*100).toFixed(2)}%)`);
  // honest precondition failure: spacing <= 0 -> ok false (never a fake success)
  const bad = N.camRemoveMaterial(args(0));
  assert.strictEqual(bad.ok, false, 'cam spacing<=0 must return ok=false (honest)');
  console.log(`[engines-smoke] cam: stockVolume0=${fine.stockVolume0.toFixed(1)} removed=${fine.removedVolume.toFixed(2)} ~ analytic=${analytic.toFixed(2)} (err ${(errFine*100).toFixed(2)}%), spacing<=0 ok=${bad.ok} OK`);
}

console.log('\n[engines-smoke] ALL Task #46 bound-engine cross-checks PASS (vs native gate known-answers)');
process.exit(0);
