// ===========================================================================
// Tet4 ELEMENT CONVERGENCE STUDY — Lamé thick-walled cylinder, exact solution
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//   fea_nafems_gate.mjs misses LE1/LE10/LE11 by 43-62 % and the errors GROW under
//   refinement. Before that can be blamed on the ELEMENT ("linear Tet4 on a faceted
//   boundary under-resolves the curved stress concentration"), the element has to be
//   measured on its own. This script does that: it builds a STRUCTURED Tet4 mesh in JS
//   and feeds it straight to forge.fea.tet.solveLinearStatic, bypassing
//   forge::fea::tet::meshShape entirely. So it measures the element + assembly + CG
//   solver and NOTHING else, on a problem that has a curved boundary and a real stress
//   gradient — the same class as the NAFEMS cases.
//
// THE BENCHMARK
//   Thick-walled cylinder, internal pressure, plane strain. Exact solution: Lamé, and
//   Timoshenko & Goodier, "Theory of Elasticity", 3rd ed. (McGraw-Hill 1970), §28
//   eqs. (60)-(62). For inner radius a, outer radius b, internal pressure p, no external
//   pressure:
//       σ_rr(r) = a²p/(b²-a²) · (1 - b²/r²)
//       σ_θθ(r) = a²p/(b²-a²) · (1 + b²/r²)
//       u_r(r)  = (1+ν) a²p / (E (b²-a²)) · [ (1-2ν) r + b²/r ]      (plane strain)
//   A quarter model (0 ≤ θ ≤ π/2) with symmetry planes at θ=0 and θ=π/2 and u_z=0 on
//   both z faces reproduces plane strain exactly.
//
// THE MESH
//   Structured (nr × nt × nz) hexahedral lattice in cylindrical coordinates with the
//   nodes placed EXACTLY on the true radii — so the only geometric error is the chord
//   of each element face, which is the same O(h²) faceting a conforming mesher leaves.
//   Each hex is split into 6 tets by the standard Freudenthal / Kuhn triangulation
//   (Freudenthal, Ann. Math. 46 (1945) 580; the "6-tet subdivision of a cube"), which is
//   conforming across faces when the diagonal is chosen by a consistent vertex ordering.
//
// WHAT IS REPORTED
//   Observed order of accuracy p from successive refinements, ASME V&V 20-2009 §2.3 /
//   Roache (1998):  p = ln(e_coarse/e_fine) / ln(r),  r = h_coarse/h_fine.
//   Theory (Strang & Fix, "An Analysis of the Finite Element Method", 1973; Ciarlet 1978)
//   for a linear (P1) tetrahedron on a smooth solution: displacement error in L2/at a
//   point is O(h²), stress (a first derivative) is O(h). Those are the numbers this
//   script must reproduce for the element to be exonerated.
//
// Run: node test/fea_tet4_convergence.mjs
// ===========================================================================

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

if (!(forge.fea && forge.fea.tet && forge.fea.tet.solveLinearStatic)) {
  throw new Error('forge.fea.tet.solveLinearStatic missing from native kernel');
}

// ---------------------------------------------------------------- problem
const A = 0.10;      // inner radius (m)
const B = 0.20;      // outer radius (m)
const T = 0.05;      // axial length  (m)
const P = 10e6;      // internal pressure (Pa)
const E = 210e9, NU = 0.3, RHO = 7850;

const k = A * A * P / (B * B - A * A);
const sigRR = (r) => k * (1 - B * B / (r * r));
const sigTT = (r) => k * (1 + B * B / (r * r));
const uR = (r) => (1 + NU) * A * A * P / (E * (B * B - A * A)) * ((1 - 2 * NU) * r + B * B / r);

console.log('===========================================================================');
console.log(' Tet4 ELEMENT CONVERGENCE — Lamé thick-walled cylinder (exact solution)');
console.log(' Timoshenko & Goodier, Theory of Elasticity 3rd ed. §28; plane strain');
console.log('===========================================================================');
console.log(` a=${A} m  b=${B} m  t=${T} m  p=${P / 1e6} MPa  E=${E / 1e9} GPa  ν=${NU}`);
console.log(` EXACT at r=a: σ_θθ = ${(sigTT(A) / 1e6).toFixed(4)} MPa, σ_rr = ${(sigRR(A) / 1e6).toFixed(4)} MPa, u_r = ${(uR(A) * 1e6).toFixed(5)} µm`);
console.log(` EXACT at r=b: σ_θθ = ${(sigTT(B) / 1e6).toFixed(4)} MPa, σ_rr = ${(sigRR(B) / 1e6).toFixed(4)} MPa, u_r = ${(uR(B) * 1e6).toFixed(5)} µm`);

// ---------------------------------------------------------------- structured mesh
// Freudenthal/Kuhn 6-tet split of the hex with corner ids
//   n0=(i,j,k) n1=(i+1,j,k) n2=(i+1,j+1,k) n3=(i,j+1,k)  (bottom, k)
//   n4..n7 the same at k+1.
// The split below is the standard one that is CONFORMING across shared faces because
// every tet uses the n0-n6 main diagonal.
const HEX6 = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];

function buildQuarterCylinder(nr, nt, nz) {
  const nodes = [], idx = [];
  let id = 0;
  for (let i = 0; i <= nr; i++) {
    idx.push([]);
    const r = A + (B - A) * i / nr;
    for (let j = 0; j <= nt; j++) {
      idx[i].push([]);
      const th = (Math.PI / 2) * j / nt;
      for (let kk = 0; kk <= nz; kk++) {
        const z = T * kk / nz;
        nodes.push({ x: r * Math.cos(th), y: r * Math.sin(th), z, r, th, i, j, k: kk, id });
        idx[i][j].push(id);
        id++;
      }
    }
  }
  const tets = [];
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nt; j++) {
      for (let kk = 0; kk < nz; kk++) {
        const c = [
          idx[i][j][kk], idx[i + 1][j][kk], idx[i + 1][j + 1][kk], idx[i][j + 1][kk],
          idx[i][j][kk + 1], idx[i + 1][j][kk + 1], idx[i + 1][j + 1][kk + 1], idx[i][j + 1][kk + 1],
        ];
        for (const t of HEX6) tets.push([c[t[0]], c[t[1]], c[t[2]], c[t[3]]]);
      }
    }
  }
  return { nodes, tets, idx, nr, nt, nz };
}

function toKernelMesh(m) {
  const nodes = new Float64Array(m.nodes.length * 3);
  const ids = new Int32Array(m.nodes.length);
  for (let i = 0; i < m.nodes.length; i++) {
    nodes[3 * i] = m.nodes[i].x; nodes[3 * i + 1] = m.nodes[i].y; nodes[3 * i + 2] = m.nodes[i].z;
    ids[i] = i;
  }
  const tets = new Int32Array(m.tets.length * 4);
  const tetIds = new Int32Array(m.tets.length);
  for (let e = 0; e < m.tets.length; e++) {
    tets[4 * e] = m.tets[e][0]; tets[4 * e + 1] = m.tets[e][1];
    tets[4 * e + 2] = m.tets[e][2]; tets[4 * e + 3] = m.tets[e][3];
    tetIds[e] = e;
  }
  return { nodes, ids, tets, tetIds, nodeCount: m.nodes.length, tetCount: m.tets.length };
}

// Consistent nodal force vector for a uniform pressure on the inner cylindrical surface.
// The surface is the faceted i=0 quad ring; each quad's two triangles contribute p·Area/3
// to each of their vertices along the FACET normal — the standard lumping of a constant
// traction over a linear triangle (Zienkiewicz & Taylor, "The Finite Element Method",
// vol.1 6th ed., §5.5). Using the facet normal, not the analytic radial direction, is
// deliberate: it is what a real faceted-boundary solve does, so the faceting error is
// INCLUDED in the measurement rather than idealised away.
function innerPressureForces(m) {
  const acc = new Map();
  const add = (n, fx, fy, fz) => {
    const c = acc.get(n) || [0, 0, 0];
    c[0] += fx; c[1] += fy; c[2] += fz; acc.set(n, c);
  };
  const N = (id) => m.nodes[id];
  for (let j = 0; j < m.nt; j++) {
    for (let kk = 0; kk < m.nz; kk++) {
      const q = [m.idx[0][j][kk], m.idx[0][j + 1][kk], m.idx[0][j + 1][kk + 1], m.idx[0][j][kk + 1]];
      for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        const p0 = N(tri[0]), p1 = N(tri[1]), p2 = N(tri[2]);
        const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
        const vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
        const L = Math.hypot(nx, ny, nz2);
        const area = 0.5 * L;
        nx /= L; ny /= L; nz2 /= L;
        // outward from the material = pointing toward the axis (-r) on the inner bore
        const cx = (p0.x + p1.x + p2.x) / 3, cy = (p0.y + p1.y + p2.y) / 3;
        if (nx * cx + ny * cy > 0) { nx = -nx; ny = -ny; nz2 = -nz2; }
        // pressure pushes the material AWAY from the bore, i.e. along -n (outward normal
        // of the solid points into the bore), so the traction is -p·n_solid = +p·(+r).
        const f = P * area / 3;
        for (const v of tri) add(v, -f * nx, -f * ny, -f * nz2);
      }
    }
  }
  const out = [];
  for (const e of acc) out.push({ nodeId: e[0], fx: e[1][0], fy: e[1][1], fz: e[1][2] });
  return out;
}

function solveLevel(nr, nt, nz) {
  const g = buildQuarterCylinder(nr, nt, nz);
  const km = toKernelMesh(g);
  const prescribed = [];
  for (const n of g.nodes) {
    const p = { nodeId: n.id, fx: false, fy: false, fz: false, ux: 0, uy: 0, uz: 0 };
    if (n.j === 0) p.fy = true;              // θ=0 plane  -> u_y = 0 (symmetry)
    if (n.j === g.nt) p.fx = true;           // θ=π/2 plane -> u_x = 0 (symmetry)
    if (n.k === 0 || n.k === g.nz) p.fz = true; // plane strain
    if (p.fx || p.fy || p.fz) prescribed.push(p);
  }
  const t0 = Date.now();
  const r = forge.fea.tet.solveLinearStatic(km, { E, nu: NU, rho: RHO },
    { fixedNodes: [], nodalForces: innerPressureForces(g), prescribed, nodeTemps: [] });
  const ms = Date.now() - t0;

  // Probe on the θ=45° ray, mid-thickness in z, at the inner bore and at mid-wall.
  // 45° is chosen so the probe is far from both symmetry planes.
  const jMid = Math.round(g.nt / 2), kMid = Math.round(g.nz / 2);
  const probe = (i) => {
    const id = g.idx[i][jMid][kMid];
    const n = g.nodes[id];
    const ct = Math.cos(n.th), st = Math.sin(n.th);
    const ur = r.displacement ? 0 : 0; // (displacement typed array read below)
    void ur;
    const ux = r.displacement[3 * id], uy = r.displacement[3 * id + 1];
    // σ_θθ = t^T σ t with t = (-sinθ, cosθ, 0)
    const sxx = r.nodeSxx[id], syy = r.nodeSyy[id], sxy = r.nodeSxy[id];
    return {
      r: n.r,
      urFE: ux * ct + uy * st,
      urEx: uR(n.r),
      sttFE: sxx * st * st - 2 * sxy * st * ct + syy * ct * ct,
      sttEx: sigTT(n.r),
    };
  };
  return {
    nr, nt, nz, nodes: km.nodeCount, tets: km.tetCount, ms, converged: r.converged,
    bore: probe(0), mid: probe(Math.round(nr / 2)),
    h: (B - A) / nr,   // radial element size — the mesh is refined uniformly, so any
                       // consistent length scale gives the same refinement ratio r
  };
}

// `displacement` arrives as a Float64Array of 3N; alias it so the probe above can index it.
// (solveLinearStatic returns `displacement`, not `u`, on the tet path.)

const LEVELS = [[2, 4, 1], [4, 8, 2], [8, 16, 4], [16, 32, 8]];
const rows = [];
console.log('\n---------------------------------------------------------------------------');
console.log(' h-refinement (uniform, ratio 2 per level)');
console.log('---------------------------------------------------------------------------');
console.log(' nr×nt×nz     nodes    tets      h[m]     u_r(bore)[µm]   err%      σ_θθ(bore)[MPa]  err%     ms');
for (const L of LEVELS) {
  const s = solveLevel(L[0], L[1], L[2]);
  if (!s.converged) throw new Error(`CG did not converge at level ${L.join('x')} — measurement untrustworthy`);
  s.errU = (s.bore.urFE - s.bore.urEx) / s.bore.urEx;
  s.errS = (s.bore.sttFE - s.bore.sttEx) / s.bore.sttEx;
  rows.push(s);
  console.log(` ${String(L.join('×')).padEnd(11)} ${String(s.nodes).padStart(7)} ${String(s.tets).padStart(7)}` +
    `  ${s.h.toFixed(5)}   ${(s.bore.urFE * 1e6).toFixed(5).padStart(11)}  ${(s.errU * 100).toFixed(3).padStart(8)}` +
    `   ${(s.bore.sttFE / 1e6).toFixed(4).padStart(13)}  ${(s.errS * 100).toFixed(3).padStart(7)}  ${String(s.ms).padStart(6)}`);
}

// ---------------------------------------------------------------- observed order
// ASME V&V 20-2009 §2.3 / Roache 1998: p = ln(e1/e2) / ln(r), r = h1/h2.
function order(rows, key) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const e1 = Math.abs(rows[i - 1][key]), e2 = Math.abs(rows[i][key]);
    const rr = rows[i - 1].h / rows[i].h;
    out.push({ from: rows[i - 1].h, to: rows[i].h, e1, e2, r: rr, p: Math.log(e1 / e2) / Math.log(rr) });
  }
  return out;
}
console.log('\n---------------------------------------------------------------------------');
console.log(' OBSERVED ORDER OF ACCURACY  p = ln(e_coarse/e_fine)/ln(h_coarse/h_fine)');
console.log(' (ASME V&V 20-2009 §2.3; Roache, Verification and Validation in CS&E, 1998)');
console.log('---------------------------------------------------------------------------');
let ok = true;
for (const spec of [
  { key: 'errU', label: 'u_r  (displacement)', theory: 2.0, lo: 1.5, hi: 2.6 },
  { key: 'errS', label: 'σ_θθ (stress)      ', theory: 1.0, lo: 0.6, hi: 1.8 },
]) {
  const os = order(rows, spec.key);
  const last = os[os.length - 1];
  console.log(` ${spec.label}  theory O(h^${spec.theory.toFixed(0)}) for a linear P1 tetrahedron`);
  for (const o of os) {
    console.log(`     h ${o.from.toFixed(5)} -> ${o.to.toFixed(5)} (r=${o.r.toFixed(2)}):` +
      ` |e| ${(o.e1 * 100).toFixed(4)}% -> ${(o.e2 * 100).toFixed(4)}%   p = ${o.p.toFixed(3)}`);
  }
  const pass = Number.isFinite(last.p) && last.p >= spec.lo && last.p <= spec.hi;
  if (!pass) ok = false;
  console.log(`     ASYMPTOTIC p = ${last.p.toFixed(3)}  -> ${pass ? 'PASS' : 'FAIL'} (accepted band [${spec.lo}, ${spec.hi}])`);
}

console.log('\n===========================================================================');
if (ok) {
  console.log(' VERDICT: the Tet4 element, assembly and CG solver converge AT THEIR THEORETICAL');
  console.log(' ORDER on a curved-boundary problem with an exact solution. The NAFEMS LE1/LE10/');
  console.log(' LE11 misses are therefore NOT an element-order defect, and quadratic Tet10 is');
  console.log(' not the indicated remedy. See reports/FEA_NAFEMS_GAP.md.');
} else {
  console.log(' VERDICT: the Tet4 path did NOT reach its theoretical order. This is a KERNEL');
  console.log(' defect in the element / assembly / solver, not a mesher budget problem.');
}
console.log('===========================================================================');
console.log(`[tet4-convergence] levels=${rows.length} ok=${ok}`);
process.exitCode = ok ? 0 : 1;
