// ===========================================================================
// calculix_io_gate.mjs — KNOWN-ANSWER + PARITY gate for the CalculiX .inp
// reader / .frd writer subset (task #62).
//
// Proves three things, with REAL measured numbers (no kernel rebuild — uses the
// prebuilt build/Release/forge-kernel.node):
//   (1) .inp PATH == NATIVE PATH. Generate a forge mesh, emit it as a CalculiX
//       deck (writeInp), read it back (parseInp) and solve it (solveInp); the
//       displacement field is IDENTICAL (machine precision) to a direct
//       forge.fea.solveStatic / solveModal / tet.solveLinearStatic on the same
//       mesh+BCs. The .inp marshalling adds nothing but I/O.
//   (2) .inp PATH == ANALYTIC. Hand-transcribed CalculiX decks (a uniaxial bar
//       with sigma=F/A, a slender cantilever with delta=PL^3/3EI, an Euler-
//       Bernoulli modal frequency) match their closed-form answers.
//   (3) .frd ROUND-TRIPS. writeFrd output is a well-formed CalculiX result file
//       whose DISP records read back to the solved displacement (machine eps).
//
// Run: node test/calculix_io_gate.mjs
// ===========================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { parseInp, solveInp, writeFrd, writeInp, readFrdDisp } from './calculix_io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const pct = (x) => (x * 100).toFixed(4) + ' %';

let hardFail = false;
const fail = (m) => { hardFail = true; console.log(`  [HARD-FAIL] ${m}`); };
const ok = (m) => console.log(`  [pass] ${m}`);

console.log('============================================================');
console.log(' CalculiX .inp reader + .frd writer — known-answer + parity gate');
console.log('============================================================');

// ===========================================================================
// (1) ROUND-TRIP HEX: .inp path == native path  (machine precision)
// ===========================================================================
console.log('\n(1) Round-trip HEX — .inp path vs native solveStatic on the SAME mesh');
{
  const L = 0.2, b = 0.01, h = 0.01, E = 210e9, nu = 0.3, rho = 7850, P = 1000;
  const box = forge.makeBox(L, b, h);
  const m = forge.fea.meshFromBrep(box, 0.005);
  forge.release(box);
  const nd = m.nodes, nN = m.nodeCount;
  // BCs: fix x=0 face; tip load -y on x=L face
  const rootIdx = [], tipIdx = [];
  for (let i = 0; i < nN; i++) { if (near(nd[3 * i], 0)) rootIdx.push(i); if (near(nd[3 * i], L)) tipIdx.push(i); }
  const pf = -P / tipIdx.length;
  const bcs = rootIdx.map(i => ({ nodeId: i, fx: true, fy: true, fz: true }));
  const loads = tipIdx.map(i => ({ nodeId: i, fx: 0, fy: pf, fz: 0 }));
  const native = forge.fea.solveStatic(m, { E, nu, rho }, loads, [], bcs);

  // emit the SAME mesh+BCs as a CalculiX deck, read it back, solve.
  const elems = [];
  const ec = m.elemCount, conn = m.tets;
  for (let e = 0; e < ec; e++) elems.push({ label: e + 1, type: 'C3D8', conn: Array.from(conn.slice(8 * e, 8 * e + 8)).map(v => v + 1) });
  const inp = writeInp({
    nodes: nd, elements: elems, material: { name: 'STEEL', E, nu, rho },
    boundaries: [{ nodes: rootIdx.map(i => i + 1), d1: 1, d2: 3 }],
    cloads: [{ nodes: tipIdx.map(i => i + 1), dof: 2, mag: pf }],
    step: 'static',
  });
  const deck = parseInp(inp);
  const r = solveInp(forge, deck);
  // compare by node LABEL (= origIndex+1)
  let maxAbs = 0, maxRel = 0, refMax = 0;
  for (let i = 0; i < nN; i++) {
    const j = r.labelToIndex.get(i + 1);
    for (let c = 0; c < 3; c++) {
      const a = native.u[3 * i + c], bv = r.disp[3 * j + c];
      maxAbs = Math.max(maxAbs, Math.abs(a - bv)); refMax = Math.max(refMax, Math.abs(a));
    }
  }
  maxRel = maxAbs / (refMax || 1);
  console.log(`  ${m.elemCount} hex / ${nN} nodes; max|Δu| = ${maxAbs.toExponential(3)} m (ref ${refMax.toExponential(3)}), rel = ${pct(maxRel)}`);
  if (maxRel < 1e-9) ok('hex .inp path reproduces native solveStatic to machine precision'); else fail(`hex round-trip rel error ${pct(maxRel)} > 1e-9`);
}

// ===========================================================================
// (2) ROUND-TRIP TET (C3D4): .inp path == native tet path
// ===========================================================================
console.log('\n(2) Round-trip TET C3D4 — .inp path vs native tet.solveLinearStatic');
{
  const L = 0.2, b = 0.02, h = 0.02, E = 210e9, nu = 0.3, rho = 7850, P = 1000;
  const box = forge.makeBox(L, b, h);
  const m = forge.fea.tet.meshShape(box, 0.012);
  forge.release(box);
  const nd = m.nodes, nN = m.nodeCount;
  const rootIdx = [], tipIdx = [];
  for (let i = 0; i < nN; i++) { if (near(nd[3 * i], 0, 1e-5)) rootIdx.push(i); if (near(nd[3 * i], L, 1e-5)) tipIdx.push(i); }
  const pf = -P / tipIdx.length;
  // native: mesh built directly (id==index since no ids passed)
  const meshDirect = { nodes: Float64Array.from(nd), tets: Int32Array.from(m.tets ? flattenTets(m) : []) };
  const native = forge.fea.tet.solveLinearStatic(meshDirect, { E, nu, rho },
    { fixedNodes: rootIdx, nodalForces: tipIdx.map(i => ({ nodeId: i, fx: 0, fy: pf, fz: 0 })), prescribed: [], nodeTemps: [] });

  // emit C3D4 deck (corner connectivity from the tet mesh)
  const elems = [];
  for (let e = 0; e < m.tetCount; e++) elems.push({ label: e + 1, type: 'C3D4', conn: [m.tets[4 * e] + 1, m.tets[4 * e + 1] + 1, m.tets[4 * e + 2] + 1, m.tets[4 * e + 3] + 1] });
  const inp = writeInp({
    nodes: nd, elements: elems, material: { name: 'STEEL', E, nu, rho },
    boundaries: [{ nodes: rootIdx.map(i => i + 1), d1: 1, d2: 3 }],
    cloads: [{ nodes: tipIdx.map(i => i + 1), dof: 2, mag: pf }],
    step: 'static',
  });
  const deck = parseInp(inp);
  const r = solveInp(forge, deck);
  let maxAbs = 0, refMax = 0;
  for (let i = 0; i < nN; i++) {
    const j = r.labelToIndex.get(i + 1);
    for (let c = 0; c < 3; c++) { const a = native.displacement[3 * i + c], bv = r.disp[3 * j + c]; maxAbs = Math.max(maxAbs, Math.abs(a - bv)); refMax = Math.max(refMax, Math.abs(a)); }
  }
  const rel = maxAbs / (refMax || 1);
  console.log(`  ${m.tetCount} tet / ${nN} nodes; max|Δu| = ${maxAbs.toExponential(3)} m (ref ${refMax.toExponential(3)}), rel = ${pct(rel)}, converged=${r.converged}`);
  if (rel < 1e-7) ok('tet C3D4 .inp path reproduces native tet solve'); else fail(`tet round-trip rel error ${pct(rel)} > 1e-7`);
}
function flattenTets(m) { const a = new Array(m.tetCount * 4); for (let e = 0; e < m.tetCount; e++) { a[4 * e] = m.tets[4 * e]; a[4 * e + 1] = m.tets[4 * e + 1]; a[4 * e + 2] = m.tets[4 * e + 2]; a[4 * e + 3] = m.tets[4 * e + 3]; } return a; }

// ===========================================================================
// (3) TRANSCRIBED CalculiX DECK — uniaxial bar, sigma = F/A (exact)
// ===========================================================================
console.log('\n(3) Transcribed CalculiX deck — uniaxial bar (calculix_uniaxial_bar.inp)');
{
  const deck = parseInp(readFileSync(path.join(__dirname, 'fixtures', 'calculix_uniaxial_bar.inp'), 'utf8'));
  const r = solveInp(forge, deck);
  const E = 210e9, Lbar = 4, sigma = 1000, A = 1;
  const exactUx = sigma * Lbar / E;
  const tipUx = [17, 18, 19, 20].map(l => r.disp[3 * r.labelToIndex.get(l)]);
  const errU = (tipUx[0] - exactUx) / exactUx;
  const sxxTip = r.nodeStress.sxx[r.labelToIndex.get(17)];
  const errS = (sxxTip - sigma) / sigma;
  console.log(`  tip u_x = ${tipUx[0].toExponential(6)}  (exact sigma*L/E = ${exactUx.toExponential(6)}),  err = ${pct(errU)}`);
  console.log(`  sigma_xx@tip = ${sxxTip.toFixed(4)}  (exact F/A = ${sigma}),  err = ${pct(errS)}, residual ${r.residual.toExponential(2)}`);
  if (Math.abs(errU) < 1e-6 && Math.abs(errS) < 1e-6) ok('uniaxial bar matches sigma=F/A and u=sigma L/E to machine precision');
  else fail(`uniaxial bar off: u err ${pct(errU)}, sigma err ${pct(errS)}`);
}

// ===========================================================================
// (4) TRANSCRIBED CalculiX DECK — slender cantilever vs Euler-Bernoulli
// ===========================================================================
console.log('\n(4) Transcribed CalculiX deck — cantilever (calculix_cantilever_c3d8.inp)');
{
  const deck = parseInp(readFileSync(path.join(__dirname, 'fixtures', 'calculix_cantilever_c3d8.inp'), 'utf8'));
  const r = solveInp(forge, deck);
  const L = 0.2, b = 0.01, h = 0.01, E = 210e9, nu = 0.3, P = 1000;
  const I = b * h * h * h / 12, A = b * h;
  const dEB = P * L * L * L / (3 * E * I);
  const G = E / (2 * (1 + nu)), ks = 5 / 6;
  const dTimo = dEB + P * L / (ks * G * A);
  // tip deflection = -u_y at tip nodes (41..44), take the section centre avg
  const tip = [41, 42, 43, 44].map(l => -r.disp[3 * r.labelToIndex.get(l) + 1]);
  const dFE = tip.reduce((a, v) => a + v, 0) / tip.length;
  const errEB = (dFE - dEB) / dEB, errT = (dFE - dTimo) / dTimo;
  console.log(`  Euler-Bernoulli delta = ${(dEB * 1e6).toFixed(3)} um | Timoshenko = ${(dTimo * 1e6).toFixed(3)} um | FE = ${(dFE * 1e6).toFixed(3)} um`);
  console.log(`  err vs E-B = ${pct(errEB)},  err vs Timoshenko = ${pct(errT)}, residual ${r.residual.toExponential(2)}`);
  if (Math.abs(errEB) < 0.03) ok('cantilever .inp deflection within 3% of Euler-Bernoulli (slender bending captured)');
  else fail(`cantilever deflection err vs E-B = ${pct(errEB)} > 3%`);
}

// ===========================================================================
// (5) MODAL — *FREQUENCY .inp vs native solveModal vs Euler-Bernoulli f1
// ===========================================================================
console.log('\n(5) Modal *FREQUENCY — .inp path vs native solveModal + analytic f1');
{
  const L = 0.2, b = 0.01, h = 0.01, E = 210e9, nu = 0.3, rho = 7850;
  const I = b * h * h * h / 12, A = b * h, beta1 = 1.875104;
  const f1 = (beta1 * beta1 / (2 * Math.PI)) * Math.sqrt(E * I / (rho * A * L ** 4));
  const box = forge.makeBox(L, b, h);
  const m = forge.fea.meshFromBrep(box, 0.01);
  forge.release(box);
  if (m.nodeCount > 500) { console.log(`  (skip native modal: ${m.nodeCount} nodes > 500-node dense cap)`); }
  const nd = m.nodes, nN = m.nodeCount, rootIdx = [];
  for (let i = 0; i < nN; i++) if (near(nd[3 * i], 0)) rootIdx.push(i);
  const bcs = rootIdx.map(i => ({ nodeId: i, fx: true, fy: true, fz: true }));
  const native = forge.fea.solveModal(m, { E, nu, rho }, bcs, 4);
  const nativeF = Array.from(native.eigenvalues).map(w2 => Math.sqrt(Math.max(0, w2)) / (2 * Math.PI));

  const elems = [];
  for (let e = 0; e < m.elemCount; e++) elems.push({ label: e + 1, type: 'C3D8', conn: Array.from(m.tets.slice(8 * e, 8 * e + 8)).map(v => v + 1) });
  const inp = writeInp({ nodes: nd, elements: elems, material: { name: 'STEEL', E, nu, rho }, boundaries: [{ nodes: rootIdx.map(i => i + 1), d1: 1, d2: 3 }], step: 'frequency', numEigen: 4 });
  const r = solveInp(forge, parseInp(inp));
  const errF1native = (r.frequencies[0] - nativeF[0]) / nativeF[0];
  const errF1analytic = (r.frequencies[0] - f1) / f1;
  console.log(`  analytic f1 = ${f1.toFixed(2)} Hz | native f = [${nativeF.slice(0, 3).map(x => x.toFixed(1)).join(', ')}] | .inp f = [${r.frequencies.slice(0, 3).map(x => x.toFixed(1)).join(', ')}]`);
  console.log(`  .inp f1 vs native = ${pct(errF1native)},  vs Euler-Bernoulli = ${pct(errF1analytic)}`);
  if (Math.abs(errF1native) < 1e-6 && Math.abs(errF1analytic) < 0.05) ok('modal .inp path == native solveModal and within 5% of analytic f1');
  else fail(`modal mismatch: vs native ${pct(errF1native)}, vs analytic ${pct(errF1analytic)}`);
}

// ===========================================================================
// (6) DLOAD pressure — face pressure -> equivalent nodal forces, uniaxial check
// ===========================================================================
console.log('\n(6) DLOAD pressure on a hex face -> equivalent nodal forces (uniaxial)');
{
  // 4-hex bar, x in [0,4], section 1x1. For tip element 4's local node order
  // the +x end face is Abaqus face P4. Abaqus +pressure pushes INWARD, so a
  // NEGATIVE pressure of -1000 on P4 pulls outward -> tension sigma_xx = +1000.
  const inp = [
    '*NODE, NSET=NALL',
    '1, 0,0,0', '2, 0,1,0', '3, 0,1,1', '4, 0,0,1',
    '5, 1,0,0', '6, 1,1,0', '7, 1,1,1', '8, 1,0,1',
    '9, 2,0,0', '10, 2,1,0', '11, 2,1,1', '12, 2,0,1',
    '13, 3,0,0', '14, 3,1,0', '15, 3,1,1', '16, 3,0,1',
    '17, 4,0,0', '18, 4,1,0', '19, 4,1,1', '20, 4,0,1',
    '*ELEMENT, TYPE=C3D8, ELSET=EALL',
    '1, 1,5,6,2,4,8,7,3', '2, 5,9,10,6,8,12,11,7',
    '3, 9,13,14,10,12,16,15,11', '4, 13,17,18,14,16,20,19,15',
    '*ELSET, ELSET=TIPEL', '4',
    '*NSET, NSET=FIXED', '1,2,3,4',
    '*MATERIAL, NAME=STEEL', '*ELASTIC', '210.0e9, 0.3', '*DENSITY', '7850',
    '*SOLID SECTION, ELSET=EALL, MATERIAL=STEEL',
    '*STEP', '*STATIC',
    '*BOUNDARY', 'FIXED, 1, 1', '1, 2, 3', '2, 3, 3',
    '*DLOAD', 'TIPEL, P4, -1000.0',
    '*END STEP',
  ].join('\n');
  const r = solveInp(forge, parseInp(inp));
  const sxx = r.nodeStress.sxx[r.labelToIndex.get(17)];
  const err = (sxx - 1000) / 1000;
  console.log(`  sigma_xx@tip from P4=-1000 pressure = ${sxx.toFixed(4)}  (expect +1000),  err = ${pct(err)}, residual ${r.residual.toExponential(2)}`);
  if (Math.abs(err) < 1e-4) ok('DLOAD pressure -> equivalent nodal forces reproduces the uniaxial stress');
  else fail(`DLOAD pressure stress err ${pct(err)} > 1e-4`);
}

// ===========================================================================
// (7) .frd WRITER round-trip — well-formed CalculiX result; DISP reads back
// ===========================================================================
console.log('\n(7) .frd writer round-trip — DISP records read back to solved field');
{
  const deck = parseInp(readFileSync(path.join(__dirname, 'fixtures', 'calculix_uniaxial_bar.inp'), 'utf8'));
  const r = solveInp(forge, deck);
  const frd = writeFrd(r, { jobName: 'BAR' });
  // structural sanity
  const hasNodes = frd.includes('\n    2C'), hasElems = frd.includes('\n    3C');
  const hasDisp = frd.includes(' -4  DISP'), hasStress = frd.includes(' -4  STRESS'), hasEnd = frd.trim().endsWith('9999');
  if (!(hasNodes && hasElems && hasDisp && hasStress && hasEnd)) fail('.frd missing a required block (2C/3C/DISP/STRESS/9999)'); else ok('.frd has 2C nodes, 3C elements, DISP, STRESS and 9999 terminator');
  const back = readFrdDisp(frd);
  let maxAbs = 0, refMax = 0;
  for (let k = 0; k < r.nodeLabels.length; k++) {
    const lab = r.nodeLabels[k]; const d = back.get(lab);
    if (!d) { fail(`.frd DISP missing node ${lab}`); break; }
    for (let c = 0; c < 3; c++) { maxAbs = Math.max(maxAbs, Math.abs(d[c] - r.disp[3 * k + c])); refMax = Math.max(refMax, Math.abs(r.disp[3 * k + c])); }
  }
  const rel = maxAbs / (refMax || 1);
  console.log(`  ${back.size} DISP records; max|Δu| read-vs-solved = ${maxAbs.toExponential(3)} (rel ${pct(rel)} at E12.5 precision)`);
  if (rel < 1e-4) ok('.frd DISP round-trips to E12.5 precision'); else fail(`.frd DISP read-back rel error ${pct(rel)} > 1e-4`);
}

// ===========================================================================
console.log('\n============================================================');
console.log(' SUMMARY — CalculiX .inp/.frd subset on Forge native FEA');
console.log('============================================================');
console.log(` Round-trip hex / tet / modal : .inp path == native path (machine precision)`);
console.log(` Transcribed decks            : uniaxial sigma=F/A exact; cantilever <3% E-B; modal <5% f1`);
console.log(` DLOAD pressure               : equiv nodal forces reproduce the analytic stress`);
console.log(` .frd writer                  : well-formed CalculiX result; DISP round-trips`);
console.log(`\n[calculix-io-gate] DONE. hardFail=${hardFail}.`);
process.exitCode = hardFail ? 1 : 0;
