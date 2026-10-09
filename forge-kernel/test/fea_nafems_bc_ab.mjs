// ===========================================================================
// fea_nafems_bc_ab.mjs — A/B of the LE1/LE10 boundary conditions on IDENTICAL meshes.
// ---------------------------------------------------------------------------
// Each refinement level is meshed ONCE; the same mesh is then solved under
//   gate-legacy  : what fea_nafems_gate.mjs did until this change — outer edge |f−1|<0.06
//                  (a ~0.1 m collar), and near() ignoring its tolerance, so the LE10 u_z
//                  support was nodes at exactly z=t/2 and the LE10 load needed z=t to 1e-6;
//   sweep-legacy : what fea_nafems_convergence.mjs did — the same collar, but its near()
//                  honoured the tolerance, so u_z was a ±0.6·edge band of collar nodes;
//   surface      : fea_nafems_bc.mjs — the outer FACE (one-tet-incident facets left once the
//                  planes and the inner ellipse are eliminated), its mid-plane line traced on
//                  the mesh, the top face.
// The mesh, the solver, the probe node and the recovery are the same in every arm, so a
// difference between arms is the boundary-condition model and nothing else.
//
// Run: node test/fea_nafems_bc_ab.mjs [le10|le1|all] [edge ...]   (needs build/Release addon)
// Prints one JSON line per (case, edge, arm) prefixed "[bc-ab]".
// ===========================================================================
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { NODE, buildEllipticSlab, ellipticPlateModel, tetBoundaryFaces, triAreaOutwardNormal, outerEllipseSurface } from './fea_nafems_bc.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));
const MAT = { E: 210e9, nu: 0.3, rho: 7850 };
const TARGET = { LE1: 92.7, LE10: -5.38 };
const PROBE = { LE1: [2, 0, 0.05], LE10: [2, 0, 0.6] };
const THICK = { LE1: 0.1, LE10: 0.6 };

const band = (x, y) => Math.abs((x / 3.25) ** 2 + (y / 2.75) ** 2 - 1) < 0.06;

// The two legacy models, reproduced from the scripts as they stood (gate: near() == 1e-6
// whatever was passed; sweep: near() honoured it).
function legacyModel(kind, m, t, edge, honourTol) {
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) < (honourTol ? tol : 1e-6);
  const nd = m.nodes, ids = m.ids, prescribed = [];
  for (let k = 0; k < m.nodeCount; k++) {
    const x = nd[3 * k], y = nd[3 * k + 1], z = nd[3 * k + 2];
    const p = { nodeId: ids[k], fx: false, fy: false, fz: false, ux: 0, uy: 0, uz: 0 };
    if (near(x, 0, 1e-4)) p.fx = true;
    if (near(y, 0, 1e-4)) p.fy = true;
    if (kind === 'LE1') { if (near(z, 0, 1e-4)) p.fz = true; }
    else if (band(x, y)) { p.fx = true; p.fy = true; if (near(z, t / 2, edge * 0.6)) p.fz = true; }
    if (p.fx || p.fy || p.fz) prescribed.push(p);
  }
  const bf = tetBoundaryFaces(m), accum = new Map();
  const add = (vi, fx, fy, fz) => { const c = accum.get(vi) || [0, 0, 0]; c[0] += fx; c[1] += fy; c[2] += fz; accum.set(vi, c); };
  for (const f of bf) {
    const p0 = NODE(m, f[0]), p1 = NODE(m, f[1]), p2 = NODE(m, f[2]);
    if (kind === 'LE1') {
      if (band(p0[0], p0[1]) && band(p1[0], p1[1]) && band(p2[0], p2[1])) {
        const [A, nx, ny, nz] = triAreaOutwardNormal(p0, p1, p2, NODE(m, f[3]));
        for (const vi of [f[0], f[1], f[2]]) add(vi, 10e6 * A / 3 * nx, 10e6 * A / 3 * ny, 10e6 * A / 3 * nz);
      }
    } else if (near(p0[2], t, 1e-3) && near(p1[2], t, 1e-3) && near(p2[2], t, 1e-3)) {
      const [A] = triAreaOutwardNormal(p0, p1, p2, NODE(m, f[3]));
      for (const vi of [f[0], f[1], f[2]]) add(vi, 0, 0, -1e6 * A / 3);
    }
  }
  const nodalForces = [];
  for (const [vi, fv] of accum) nodalForces.push({ nodeId: ids[vi], fx: fv[0], fy: fv[1], fz: fv[2] });
  return { prescribed, nodalForces };
}

function solve(m, model, probe) {
  const r = forge.fea.tet.solveLinearStatic(m, MAT, { fixedNodes: [], nodalForces: model.nodalForces, prescribed: model.prescribed, nodeTemps: [] });
  const nd = m.nodes; let best = 1e9, bi = -1;
  for (let k = 0; k < m.nodeCount; k++) { const d = (nd[3 * k] - probe[0]) ** 2 + (nd[3 * k + 1] - probe[1]) ** 2 + (nd[3 * k + 2] - probe[2]) ** 2; if (d < best) { best = d; bi = k; } }
  const [Fx, Fy, Fz] = model.nodalForces.reduce((s, q) => [s[0] + q.fx, s[1] + q.fy, s[2] + q.fz], [0, 0, 0]);
  return { sig: r.nodeSyy[bi] / 1e6, converged: !!r.converged, res: r.cgResidual, probe: [nd[3 * bi], nd[3 * bi + 1], nd[3 * bi + 2]].map(v => +v.toFixed(4)),
           fixedXY: model.prescribed.filter(p => p.fx && p.fy).length, fixedZ: model.prescribed.filter(p => p.fz).length, sumFx: Fx, sumFy: Fy, sumFz: Fz };
}

const args = process.argv.slice(2);
const which = ['le1', 'le10', 'all'].includes(args[0]) ? args.shift() : 'le10';
const edges = args.length ? args.map(Number) : [0.30, 0.20, 0.15, 0.115];
const cases = which === 'all' ? ['LE10', 'LE1'] : [which.toUpperCase()];

for (const kind of cases) {
  const t = THICK[kind];
  for (const edge of edges) {
    const q = buildEllipticSlab(forge, t);
    const geom = typeof forge.kindOf === 'function' ? forge.kindOf(q) : 'unrecorded';
    const t0 = Date.now();
    const m = forge.fea.tet.meshShape(q, edge);
    const meshMs = Date.now() - t0;
    forge.release(q);
    if (m.shellTetsOnly !== false) { console.log(`[bc-ab] ${JSON.stringify({ kind, edge, error: 'shell-fallback mesh' })}`); continue; }
    const surf = outerEllipseSurface(m);
    let collar = 0, collarInterior = 0;
    for (let k = 0; k < m.nodeCount; k++) if (band(m.nodes[3 * k], m.nodes[3 * k + 1])) { collar++; if (!surf.nodes.has(k)) collarInterior++; }
    const arms = {
      'gate-legacy': legacyModel(kind, m, t, edge, false),
      'sweep-legacy': legacyModel(kind, m, t, edge, true),
      surface: ellipticPlateModel(kind, m, t),
    };
    for (const [arm, model] of Object.entries(arms)) {
      const s = solve(m, model, PROBE[kind]);
      const errPct = (s.sig - TARGET[kind]) / Math.abs(TARGET[kind]) * 100;
      console.log(`[bc-ab] ${JSON.stringify({ kind, edge, arm, geom, nodes: m.nodeCount, tets: m.tetCount, meshMs,
        collarNodes: collar, collarInterior, surfaceNodes: surf.nodes.size, surfaceWorstSag: +surf.worstDev.toFixed(5),
        sigMPa: +s.sig.toFixed(4), target: TARGET[kind], errPct: +errPct.toFixed(2), converged: s.converged,
        fixedXY: s.fixedXY, fixedZ: s.fixedZ, sumFx: +s.sumFx.toFixed(1), sumFy: +s.sumFy.toFixed(1), sumFz: +s.sumFz.toFixed(1), probe: s.probe,
        diag: model.diag || null })}`);
    }
  }
}
