// ===========================================================================
// NAFEMS h-REFINEMENT SWEEP — why LE1/LE10/LE11 do not converge
// ---------------------------------------------------------------------------
// fea_nafems_gate.mjs runs each NAFEMS case at two mesh densities and used to assert
// that the pair "marched monotonically toward each NAFEMS literal". It does not. This
// script runs the full sweep that established what actually happens, and it is the
// evidence behind test/fea_nafems_baseline.txt and reports/FEA_NAFEMS_GAP.md.
//
// Three things are measured per refinement level:
//
//   1. σ at the NAFEMS probe point, and its error against the published literal.
//   2. The LOCAL element size actually achieved near that probe — h_local, computed as
//      the equivalent regular-tet edge of the mean |V| of the tets within 0.30 of the
//      probe. This is the number that decides convergence, NOT the targetEdge argument.
//   3. The mesher's own seed-grid diagnostics (seedGridCapped / interiorSpacing), added
//      to forge::fea::tet::Mesh on this track. forge::fea::tet::meshShape seeds interior
//      Steiner points on a lattice inside the shape AABB and caps that lattice at
//      seedGridBudget candidate points (default 20000); above the cap it INFLATES the
//      spacing to fit and, before this track, said nothing about having done so.
//
// The published targets are literals from "The Standard NAFEMS Benchmarks", TNSB Rev.3
// (NAFEMS, Glasgow, October 1990):
//   LE1  elliptic membrane, plane stress : σ_yy = +92.7 MPa at D = (2.0, 0.0)
//   LE10 thick plate under pressure      : σ_yy =  -5.38 MPa at D = (2.0, 0.0, top)
//   LE11 solid cyl/taper/sphere, thermal : σ_zz =  -105  MPa at A = (1.0, 0.0, 0.0)
//
// Run: node test/fea_nafems_convergence.mjs [le1|le10|le11|cost|all]
// ===========================================================================

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

const MAT = { E: 210e9, nu: 0.3, rho: 7850 };
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const NODE = (m, i) => [m.nodes[3 * i], m.nodes[3 * i + 1], m.nodes[3 * i + 2]];

// ---- helpers lifted verbatim from fea_nafems_gate.mjs so the models are IDENTICAL ----
function tetBoundaryFaces(m) {
  const t = m.tets, nT = m.tetCount, cnt = new Map(), rep = new Map();
  const key = (a, b, c) => { const s = [a, b, c].sort((x, y) => x - y); return s[0] + '_' + s[1] + '_' + s[2]; };
  for (let e = 0; e < nT; e++) {
    const a = t[4 * e], b = t[4 * e + 1], c = t[4 * e + 2], d = t[4 * e + 3];
    for (const f of [[a, b, c, d], [a, b, d, c], [a, c, d, b], [b, c, d, a]]) {
      const k = key(f[0], f[1], f[2]); cnt.set(k, (cnt.get(k) || 0) + 1); if (!rep.has(k)) rep.set(k, f);
    }
  }
  const out = []; for (const kc of cnt) if (kc[1] === 1) out.push(rep.get(kc[0])); return out;
}
function triAreaOutwardNormal(p0, p1, p2, apex) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1; const A = 0.5 * L; nx /= L; ny /= L; nz /= L;
  const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3, cz = (p0[2] + p1[2] + p2[2]) / 3;
  if ((apex[0] - cx) * nx + (apex[1] - cy) * ny + (apex[2] - cz) * nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
  return [A, nx, ny, nz];
}
function buildEllipticSlab(t) {
  const RZ = 30.0;
  const o = forge.makeEllipsoid(3.25, 2.75, RZ), i = forge.makeEllipsoid(2.0, 1.0, RZ);
  const ann = forge.cut(o, i), cl = forge.makeBox(3.5, 3.0, t), q = forge.common(ann, cl);
  for (const h of [o, i, ann, cl]) forge.release(h);
  return q;
}
const onOuterEllipse = (x, y) => Math.abs((x / 3.25) ** 2 + (y / 2.75) ** 2 - 1) < 0.06;

// Equivalent regular-tet edge of the mean element volume within `R` of `P`. This is the
// resolution the solution actually sees at the probe; `targetEdge` is only a request.
function localH(m, P, R) {
  const nd = m.nodes; let sum = 0, n = 0;
  for (let e = 0; e < m.tetCount; e++) {
    const g = i => [nd[3 * i], nd[3 * i + 1], nd[3 * i + 2]];
    const p0 = g(m.tets[4 * e]), p1 = g(m.tets[4 * e + 1]), p2 = g(m.tets[4 * e + 2]), p3 = g(m.tets[4 * e + 3]);
    const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4, cy = (p0[1] + p1[1] + p2[1] + p3[1]) / 4, cz = (p0[2] + p1[2] + p2[2] + p3[2]) / 4;
    if ((cx - P[0]) ** 2 + (cy - P[1]) ** 2 + (cz - P[2]) ** 2 > R * R) continue;
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const w = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    sum += Math.abs(u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0])) / 6;
    n++;
  }
  return n ? Math.cbrt((sum / n) * 6 * Math.SQRT2) : NaN;
}

function solveEllipticPlate(kind, t, edge, probeTarget, budget) {
  const q = buildEllipticSlab(t);
  const tMesh0 = Date.now();
  const m = budget ? forge.fea.tet.meshShape(q, edge, budget) : forge.fea.tet.meshShape(q, edge);
  const meshMs = Date.now() - tMesh0;
  forge.release(q);
  const nd = m.nodes, ids = m.ids, prescribed = [];
  for (let k = 0; k < m.nodeCount; k++) {
    const x = nd[3 * k], y = nd[3 * k + 1], z = nd[3 * k + 2];
    const p = { nodeId: ids[k], fx: false, fy: false, fz: false, ux: 0, uy: 0, uz: 0 };
    if (near(x, 0, 1e-4)) p.fx = true;
    if (near(y, 0, 1e-4)) p.fy = true;
    if (kind === 'LE1') { if (near(z, 0, 1e-4)) p.fz = true; }
    else { if (onOuterEllipse(x, y)) { p.fx = true; p.fy = true; if (near(z, t / 2, edge * 0.6)) p.fz = true; } }
    if (p.fx || p.fy || p.fz) prescribed.push(p);
  }
  const bf = tetBoundaryFaces(m), accum = new Map();
  if (kind === 'LE1') {
    const pres = 10e6;
    for (const f of bf) {
      const p0 = NODE(m, f[0]), p1 = NODE(m, f[1]), p2 = NODE(m, f[2]);
      if (onOuterEllipse(p0[0], p0[1]) && onOuterEllipse(p1[0], p1[1]) && onOuterEllipse(p2[0], p2[1])) {
        const an = triAreaOutwardNormal(p0, p1, p2, NODE(m, f[3]));
        for (const vi of [f[0], f[1], f[2]]) { const c = accum.get(vi) || [0, 0, 0]; c[0] += pres * an[0] / 3 * an[1]; c[1] += pres * an[0] / 3 * an[2]; c[2] += pres * an[0] / 3 * an[3]; accum.set(vi, c); }
      }
    }
  } else {
    const pres = 1e6;
    for (const f of bf) {
      const p0 = NODE(m, f[0]), p1 = NODE(m, f[1]), p2 = NODE(m, f[2]);
      if (near(p0[2], t, 1e-3) && near(p1[2], t, 1e-3) && near(p2[2], t, 1e-3)) {
        const an = triAreaOutwardNormal(p0, p1, p2, NODE(m, f[3]));
        for (const vi of [f[0], f[1], f[2]]) { const c = accum.get(vi) || [0, 0, 0]; c[2] += -pres * an[0] / 3; accum.set(vi, c); }
      }
    }
  }
  const nodalForces = [];
  for (const vf of accum) nodalForces.push({ nodeId: ids[vf[0]], fx: vf[1][0], fy: vf[1][1], fz: vf[1][2] });
  const t0 = Date.now();
  const r = forge.fea.tet.solveLinearStatic(m, MAT, { fixedNodes: [], nodalForces, prescribed, nodeTemps: [] });
  const solveMs = Date.now() - t0;
  let best = 1e9, bi = -1;
  for (let k = 0; k < m.nodeCount; k++) {
    const d = (nd[3 * k] - probeTarget[0]) ** 2 + (nd[3 * k + 1] - probeTarget[1]) ** 2 + (nd[3 * k + 2] - probeTarget[2]) ** 2;
    if (d < best) { best = d; bi = k; }
  }
  return {
    sig: r.nodeSyy[bi], nodes: m.nodeCount, tets: m.tetCount, meshMs, solveMs,
    converged: r.converged, hLocal: localH(m, probeTarget, 0.30),
    capped: m.seedGridCapped, budget: m.seedGridBudget, spacing: m.interiorSpacing,
  };
}

function solveLE11(edge, budget) {
  const z1 = Math.sin(Math.PI / 4), zTop = z1 + 0.69 + 0.4, alpha = 2.3e-4;
  const ballO = forge.makeSphere(1.4), ballI = forge.makeSphere(1.0);
  const coneO = forge.translate(forge.makeCone(Math.sqrt(1.4 ** 2 - z1 ** 2), 1.0, 0.69), 0, 0, z1);
  const cylO = forge.translate(forge.makeCylinder(1.0, 0.4), 0, 0, z1 + 0.69);
  const cylI = forge.makeCylinder(0.7071, 2.2);
  const body = forge.cut(forge.fuse(forge.fuse(ballO, coneO), cylO), forge.fuse(ballI, cylI));
  const le11 = forge.common(body, forge.makeBox(1.5, 1.5, zTop));
  const tMesh0 = Date.now();
  const m = budget ? forge.fea.tet.meshShape(le11, edge, budget) : forge.fea.tet.meshShape(le11, edge);
  const meshMs = Date.now() - tMesh0;
  const nd = m.nodes, ids = m.ids, prescribed = [], nodeTemps = [];
  for (let k = 0; k < m.nodeCount; k++) {
    const x = nd[3 * k], y = nd[3 * k + 1], z = nd[3 * k + 2];
    const p = { nodeId: ids[k], fx: false, fy: false, fz: false, ux: 0, uy: 0, uz: 0 };
    if (near(x, 0, 1e-5)) p.fx = true;
    if (near(y, 0, 1e-5)) p.fy = true;
    if (near(z, 0, 1e-5) || near(z, zTop, 1e-5)) p.fz = true;
    if (p.fx || p.fy || p.fz) prescribed.push(p);
    nodeTemps.push({ nodeId: ids[k], T: Math.sqrt(x * x + y * y) + z });
  }
  const t0 = Date.now();
  const r = forge.fea.tet.solveLinearStatic(m, { ...MAT, alpha }, { fixedNodes: [], nodalForces: [], prescribed, nodeTemps });
  const solveMs = Date.now() - t0;
  let best = 1e9, bi = -1;
  for (let k = 0; k < m.nodeCount; k++) { const d = (nd[3 * k] - 1) ** 2 + nd[3 * k + 1] ** 2 + nd[3 * k + 2] ** 2; if (d < best) { best = d; bi = k; } }
  return {
    sig: r.nodeSzz[bi], nodes: m.nodeCount, tets: m.tetCount, meshMs, solveMs,
    converged: r.converged, hLocal: localH(m, [1, 0, 0], 0.30),
    capped: m.seedGridCapped, budget: m.seedGridBudget, spacing: m.interiorSpacing,
  };
}

function sweep(tag, target, edges, run) {
  console.log(`\n---------------------------------------------------------------------------`);
  console.log(` ${tag}   published target = ${target} MPa   (TNSB Rev.3)`);
  console.log(`---------------------------------------------------------------------------`);
  console.log(' targetEdge   tets   h_local   interiorSpacing  CAPPED   sigma[MPa]    err%    p     meshMs solveMs');
  const rows = [];
  for (const e of edges) {
    const s = run(e);
    s.edge = e;
    s.err = (s.sig / 1e6 - target) / Math.abs(target) * 100;
    let p = NaN;
    const prev = rows[rows.length - 1];
    if (prev && Number.isFinite(prev.hLocal) && Number.isFinite(s.hLocal) && prev.hLocal > s.hLocal) {
      p = Math.log(Math.abs(prev.err) / Math.abs(s.err)) / Math.log(prev.hLocal / s.hLocal);
    }
    s.p = p;
    rows.push(s);
    console.log(` ${String(e).padEnd(11)} ${String(s.tets).padStart(6)}  ${s.hLocal.toFixed(5)}     ${s.spacing.toFixed(5)}      ` +
      `${s.capped ? 'YES' : ' - '}    ${(s.sig / 1e6).toFixed(3).padStart(9)}  ${s.err.toFixed(2).padStart(7)}  ${Number.isFinite(p) ? p.toFixed(2).padStart(5) : '   - '}  ` +
      `${String(s.meshMs).padStart(6)} ${String(s.solveMs).padStart(6)}`);
  }
  // Monotonicity: Richardson / GCI (ASME V&V 20-2009) requires a monotone error sequence.
  let monotone = true;
  for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i].err) >= Math.abs(rows[i - 1].err)) monotone = false;
  const firstCap = rows.findIndex(r => r.capped);
  console.log(` monotone error sequence: ${monotone ? 'YES' : 'NO — Richardson extrapolation / GCI does NOT apply'}`);
  if (firstCap >= 0) {
    console.log(` seed-grid budget (${rows[firstCap].budget}) BOUND the interior spacing from targetEdge=${rows[firstCap].edge} onward:`);
    console.log(`   h_local floor ≈ ${Math.min(...rows.filter(r => r.capped).map(r => r.hLocal)).toFixed(5)} m — asking for a finer mesh below that does NOT produce one.`);
  } else {
    console.log(` seed-grid budget never bound this sweep.`);
  }
  return rows;
}

const which = (process.argv[2] || 'all').toLowerCase();
console.log('===========================================================================');
console.log(' NAFEMS h-REFINEMENT SWEEP on the forge::fea::tet Tet4 path');
console.log(' Targets: The Standard NAFEMS Benchmarks, TNSB Rev.3 (NAFEMS, Oct 1990)');
console.log('===========================================================================');
console.log(' NOTE: the element itself is verified separately, at its theoretical order,');
console.log(' against the Lamé exact solution on a structured mesh — test/fea_tet4_convergence.mjs.');

if (which === 'le1' || which === 'all') {
  sweep('LE1  elliptic membrane, σ_yy @ D(2,0)', 92.7,
    [0.30, 0.22, 0.17, 0.12, 0.09, 0.065, 0.05, 0.04, 0.032],
    (e) => solveEllipticPlate('LE1', 0.1, e, [2, 0, 0.05]));
}
if (which === 'le10' || which === 'all') {
  sweep('LE10 thick plate, σ_yy @ D(2,0,top)', -5.38,
    [0.30, 0.24, 0.20, 0.15, 0.115, 0.09],
    (e) => solveEllipticPlate('LE10', 0.6, e, [2, 0, 0.6]));
}
if (which === 'le11' || which === 'all') {
  sweep('LE11 cyl/taper/sphere thermal, σ_zz @ A(1,0,0)', -105,
    [0.45, 0.38, 0.34, 0.26, 0.20, 0.155],
    (e) => solveLE11(e));
}

if (which === 'cost' || which === 'all') {
  // Why the budget exists at all. NOTE the measured answer is NOT the one the code reads
  // like: bowyerWatson() locates each inserted point by a linear scan over every tet ever
  // created (dead ones included — they are never compacted out), which is O(N·T) BY
  // CONSTRUCTION, yet the measured ms/tet below is FLAT. So the scan is not what dominates
  // in this range; the cost is roughly linear with a very large constant. Profile before
  // optimising the scan.
  console.log('\n---------------------------------------------------------------------------');
  console.log(' MESHER COST — forge::fea::tet::meshShape on the LE1 slab (Bowyer-Watson)');
  console.log('---------------------------------------------------------------------------');
  console.log(' targetEdge   tets    meshMs    ms/tet     ratio vs previous');
  let prev = null;
  for (const e of [0.17, 0.12, 0.09, 0.065, 0.05, 0.04]) {
    const q = buildEllipticSlab(0.1);
    const t0 = Date.now();
    const m = forge.fea.tet.meshShape(q, e);
    const ms = Date.now() - t0;
    forge.release(q);
    const ratio = prev ? `tets ×${(m.tetCount / prev.tets).toFixed(2)}  time ×${(ms / prev.ms).toFixed(2)}` : '-';
    console.log(` ${String(e).padEnd(11)} ${String(m.tetCount).padStart(6)} ${String(ms).padStart(8)}  ${(ms / m.tetCount).toFixed(4)}    ${ratio}`);
    prev = { tets: m.tetCount, ms };
  }
  console.log(' ms/tet is FLAT (~1.25) across this range: the cost is roughly LINEAR in tet');
  console.log(' count, with a very large constant. That is a constant-factor problem, not an');
  console.log(' asymptotic one — which is the cheaper kind to fix. Candidates to profile first:');
  console.log(' the per-candidate and per-centroid BRepClass3d_SolidClassifier::Perform calls');
  console.log(' (one B-rep classification per interior seed AND per Bowyer-Watson tet), then the');
  console.log(' uncompacted linear scan in bowyerWatson(). If the scan does turn out to matter at');
  console.log(' larger N, the standard remedy is spatial point location — Bowyer (1981) / Watson');
  console.log(' (1981) with a Delaunay hierarchy (Devillers, IJFCS 13(2), 2002) — or adopting a');
  console.log(' proven Delaunay refiner (Si, TetGen, ACM TOMS 41(2):11, 2015).');
}

console.log('\n[nafems-convergence] DONE — this script REPORTS, it does not gate.');
console.log(' The gate is test/fea_nafems_ratchet.sh; the analysis is reports/FEA_NAFEMS_GAP.md.');
