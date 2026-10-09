// ===========================================================================
// fea_nafems_bc_sets_test.mjs — the LE1/LE10 constraint sets are SURFACE sets.
// ---------------------------------------------------------------------------
// Pure JS, no addon. Builds structured tet meshes of the NAFEMS quarter elliptic annulus
// (inner 2.0/1.0, outer 3.25/2.75) whose outer surface is known exactly by construction,
// then asserts which nodes fea_nafems_bc.mjs constrains and loads:
//   * every outer-surface node is clamped, and NO interior node is, however close it sits;
//   * a faceted outer surface (nodes on chords, sagged off the analytic curve) is still
//     found in full;
//   * the LE10 u_z support is the mid-plane line of the outer face, not a band;
//   * the LE1 pressure resultant is exactly p·t·(Δy, −Δx) of the arc and has no z part;
//   * near() honours its tolerance (the gate's copy ignored it).
// POSITIVE CONTROL: the predicate the gate used until this change, |f − 1| < 0.06, is run
// through the same contract and MUST be caught clamping interior nodes. If it is not, the
// fixture no longer exercises the defect and the run is RED.
// ===========================================================================
import { near, NODE, OUTER, INNER, tetBoundaryFaces, triAreaOutwardNormal, outerEllipseSurface, ellipticPlateModel } from './fea_nafems_bc.mjs';

let P = 0, F = 0;
const ck = (desc, cond, detail = '') => {
  if (cond) { P++; console.log(`  ok   ${desc}`); }
  else { F++; console.log(`  FAIL ${desc}${detail ? `  [${detail}]` : ''}`); }
};

// Structured quarter-annulus slab: s ∈ [0,1] from inner to outer ellipse, θ ∈ [0, π/2],
// z ∈ [0, t]. Each hex is split into the 6 Kuhn tets around its main diagonal, which is
// conforming across neighbours. sOf(i) lets a caller place radial rings anywhere; chordOdd
// puts every odd-θ OUTER node on the chord between its even neighbours (a faceted surface
// whose densification points were never projected back onto the curve).
function annulusMesh({ nr, nt, nz, t, sOf = i => i / nr, chordOdd = false }) {
  const idx = (i, j, k) => (k * (nt + 1) + j) * (nr + 1) + i;
  const nodes = [], meta = [];
  const curve = (s, th) => [(INNER.a + (OUTER.a - INNER.a) * s) * Math.cos(th), (INNER.b + (OUTER.b - INNER.b) * s) * Math.sin(th)];
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= nt; j++) for (let i = 0; i <= nr; i++) {
    const s = sOf(i), th = (Math.PI / 2) * j / nt, z = t * k / nz;
    let [x, y] = curve(s, th);
    if (chordOdd && i === nr && j % 2 === 1) {
      const a = curve(1, (Math.PI / 2) * (j - 1) / nt), b = curve(1, (Math.PI / 2) * (j + 1) / nt);
      x = (a[0] + b[0]) / 2; y = (a[1] + b[1]) / 2;
    }
    if (j === 0) y = 0;                 // exact symmetry planes
    if (j === nt) x = 0;
    nodes.push(x, y, z); meta.push({ i, j, k });
  }
  const tets = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (let k = 0; k < nz; k++) for (let j = 0; j < nt; j++) for (let i = 0; i < nr; i++) {
    for (const p of perms) {
      const c = [i, j, k], v = [idx(...c)];
      for (const ax of p) { c[ax]++; v.push(idx(...c)); }
      tets.push(...v);
    }
  }
  const nodeCount = nodes.length / 3;
  return { nodes, tets, nodeCount, tetCount: tets.length / 4, ids: Array.from({ length: nodeCount }, (_, q) => q + 1), meta, nr, nt, nz, t };
}

const setOf = (m, pred) => new Set(m.meta.map((q, n) => (pred(q) ? n : -1)).filter(n => n >= 0));
const sameSet = (a, b) => a.size === b.size && [...a].every(v => b.has(v));
const legacyBand = (x, y) => Math.abs((x / 3.25) ** 2 + (y / 2.75) ** 2 - 1) < 0.06;

// The contract every outer-face clamp set must satisfy on a mesh whose surface is known.
function clampContract(m, chosen) {
  const truth = setOf(m, q => q.i === m.nr);
  const interior = [...chosen].filter(n => !truth.has(n));
  const missed = [...truth].filter(n => !chosen.has(n));
  return { truth, interior, missed };
}

console.log('== near() honours its tolerance ==');
ck('near(0, 5e-5, 1e-4) is true (the gate copy returned false: it compared against 1e-6)', near(0, 5e-5, 1e-4));
ck('near(0, 2e-4, 1e-4) is false', !near(0, 2e-4, 1e-4));
ck('near(a, b) still defaults to 1e-6', near(1, 1 + 5e-7) && !near(1, 1 + 5e-6));

for (const nr of [12, 24, 48]) {
  const m = annulusMesh({ nr, nt: 32, nz: 4, t: 0.6 });
  console.log(`\n== structured mesh nr=${nr} nt=32 nz=4: ${m.nodeCount} nodes, ${m.tetCount} tets ==`);
  const sel = outerEllipseSurface(m);
  const c = clampContract(m, sel.nodes);
  ck(`outer surface found in full (${c.truth.size} nodes)`, c.missed.length === 0, `${c.missed.length} surface nodes missed`);
  ck('no interior node is selected', c.interior.length === 0, `${c.interior.length} interior nodes`);
  ck('the admitted deviation is round-off (surface nodes lie on the curve)', sel.worstDev < 1e-9, `worstDev=${sel.worstDev}`);
  const old = new Set(); for (let n = 0; n < m.nodeCount; n++) if (legacyBand(m.nodes[3 * n], m.nodes[3 * n + 1])) old.add(n);
  const co = clampContract(m, old);
  if (nr >= 24) {
    ck(`POSITIVE CONTROL: the old |f-1|<0.06 band clamps interior material here (${co.interior.length} interior of ${old.size})`,
      co.interior.length > 0, 'the fixture no longer reaches the defect');
  } else {
    console.log(`  info the old band at nr=${nr} happens to clamp ${co.interior.length} interior nodes (radial step ${(1.25 / nr).toFixed(3)} m at θ=0)`);
  }
}

console.log('\n== a node 0.005 m under the surface is NOT clamped (closeness is not membership) ==');
{
  const nr = 6, m = annulusMesh({ nr, nt: 32, nz: 4, t: 0.6, sOf: i => (i === nr - 1 ? 1 - 0.005 / 1.25 : i / nr) });
  const sel = outerEllipseSurface(m), c = clampContract(m, sel.nodes);
  ck('outer surface found in full', c.missed.length === 0, `${c.missed.length} missed`);
  ck('the ring 0.004–0.007 m below it is left free', c.interior.length === 0, `${c.interior.length} interior nodes`);
  const old = new Set(); for (let n = 0; n < m.nodeCount; n++) if (legacyBand(m.nodes[3 * n], m.nodes[3 * n + 1])) old.add(n);
  ck('POSITIVE CONTROL: the old band clamps that whole ring', clampContract(m, old).interior.length === (m.nt + 1) * (m.nz + 1));
}

console.log('\n== a FACETED outer surface (odd nodes on chords, sagged off the curve) is still found ==');
{
  const m = annulusMesh({ nr: 8, nt: 8, nz: 4, t: 0.6, chordOdd: true });
  const sel = outerEllipseSurface(m), c = clampContract(m, sel.nodes);
  ck('every faceted-surface node is clamped', c.missed.length === 0, `${c.missed.length} missed`);
  ck('and nothing below it', c.interior.length === 0, `${c.interior.length} interior`);
  ck(`the sag it had to admit is real (${sel.worstDev.toFixed(4)} m)`, sel.worstDev > 0.02, `worstDev=${sel.worstDev}`);
}

{
  // a deeper sag than any measured (odd nodes pushed 0.3 m in): still the surface, still found
  const m = annulusMesh({ nr: 2, nt: 8, nz: 2, t: 0.6, chordOdd: true });   // rings ≥ 0.62 m apart: the push inverts no tet
  for (let n = 0; n < m.nodeCount; n++) if (m.meta[n].i === m.nr && m.meta[n].j % 2 === 1) {
    const [x, y] = [m.nodes[3 * n], m.nodes[3 * n + 1]], r = Math.hypot(x, y);
    m.nodes[3 * n] = x * (1 - 0.3 / r); m.nodes[3 * n + 1] = y * (1 - 0.3 / r);
  }
  const sel = outerEllipseSurface(m), c = clampContract(m, sel.nodes);
  ck(`a 0.3 m sag is still the outer face (${c.truth.size} nodes, worst ${sel.worstDev.toFixed(3)} m)`, c.missed.length === 0 && c.interior.length === 0, `${c.missed.length} missed, ${c.interior.length} interior`);
  const tight = outerEllipseSurface(m, undefined, { maxDev: 0.1 });
  ck('and a tolerance too tight for it COUNTS the facets it could not place (never a silent miss)', tight.unassigned > 0, `${tight.unassigned}`);
}

console.log('\n== top/bottom, symmetry and inner faces are never taken for the outer face ==');
{
  const m = annulusMesh({ nr: 2, nt: 4, nz: 1, t: 0.6 });   // coarse: rim facets of every surface share outer-ring nodes
  const sel = outerEllipseSurface(m);
  const outerOnly = sel.faces.every(({ f }) => f.slice(0, 3).every(v => m.meta[v].i === m.nr));
  ck(`all ${sel.faces.length} selected faces lie on the outer ring`, outerOnly);
  ck('and they are all 2·nt·nz = 8 outer facets', sel.faces.length === 2 * m.nt * m.nz, `${sel.faces.length}`);
}

console.log('\n== LE10: the u_z support is the mid-plane LINE of the outer face ==');
{
  const m = annulusMesh({ nr: 24, nt: 32, nz: 4, t: 0.6 });
  const model = ellipticPlateModel('LE10', m, 0.6);
  const row = setOf(m, q => q.i === m.nr && q.k === 2);
  const fz = new Set(model.prescribed.filter(p => p.fz).map(p => p.nodeId - 1));
  ck(`with a node row at z=t/2 it is exactly that row (${row.size} nodes)`, sameSet(fz, row), `got ${fz.size}`);
  ck('the trace sits on the line', model.diag.midWorstDz < 1e-12, `${model.diag.midWorstDz}`);
  const fxy = new Set(model.prescribed.filter(p => p.fx && p.fy).map(p => p.nodeId - 1));
  const outer = setOf(m, q => q.i === m.nr);
  ck('u_x = u_y = 0 on exactly the outer surface (plus the x=0∩y=0 line, of which there is none here)', sameSet(fxy, outer), `got ${fxy.size} want ${outer.size}`);
  const symOnly = model.prescribed.filter(p => !outer.has(p.nodeId - 1));
  ck('every other constrained node is a symmetry-plane node with one component', symOnly.every(p => (p.fx !== p.fy) && !p.fz && (p.fx ? m.meta[p.nodeId - 1].j === m.nt : m.meta[p.nodeId - 1].j === 0)));
  const Fz = model.nodalForces.reduce((s, q) => s + q.fz, 0);
  let topArea = 0;
  for (const f of tetBoundaryFaces(m)) {
    const zs = f.slice(0, 3).map(v => m.nodes[3 * v + 2]);
    if (zs.every(z => z === 0.6)) {
      const [a, b, c] = f.slice(0, 3).map(v => [m.nodes[3 * v], m.nodes[3 * v + 1]]);
      topArea += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    }
  }
  ck(`1 MPa on the top face: ΣF_z = −p·A_top (${(-1e6 * topArea).toExponential(6)} N)`, Math.abs(Fz + 1e6 * topArea) < 1e-6 * 1e6 * topArea, `ΣFz=${Fz}`);
  ck('and no in-plane load', model.nodalForces.every(q => q.fx === 0 && q.fy === 0));

  const m3 = annulusMesh({ nr: 24, nt: 32, nz: 3, t: 0.6 });
  const model3 = ellipticPlateModel('LE10', m3, 0.6);
  const rows = setOf(m3, q => q.i === m3.nr && (q.k === 1 || q.k === 2));
  const fz3 = new Set(model3.prescribed.filter(p => p.fz).map(p => p.nodeId - 1));
  ck('with no row at z=t/2 it is the two nearest rows, symmetric about the line', sameSet(fz3, rows), `got ${fz3.size} want ${rows.size}`);
  ck('and it says how far the trace is from the line (0.1 m)', Math.abs(model3.diag.midWorstDz - 0.1) < 1e-12, `${model3.diag.midWorstDz}`);
  const legacyFz = new Set(); for (let n = 0; n < m3.nodeCount; n++) { const z = m3.nodes[3 * n + 2]; if (legacyBand(m3.nodes[3 * n], m3.nodes[3 * n + 1]) && Math.abs(z - 0.3) < 1e-6) legacyFz.add(n); }
  ck('POSITIVE CONTROL: the gate\'s old rule (near() ignoring 0.6·edge) supports NOTHING in z on this mesh', legacyFz.size === 0, `${legacyFz.size}`);

  const m8 = annulusMesh({ nr: 24, nt: 32, nz: 8, t: 0.6 });
  const fz8 = new Set(ellipticPlateModel('LE10', m8, 0.6).prescribed.filter(p => p.fz).map(p => p.nodeId - 1));
  const row8 = setOf(m8, q => q.i === m8.nr && q.k === 4);
  ck('on a finer z grid (rows 0.075 m apart) it is still ONE row, not the ±0.6·edge band the sweep used', sameSet(fz8, row8), `got ${fz8.size} want ${row8.size}`);
}

console.log('\n== LE1: the outward pressure resultant is exact and planar ==');
{
  const t = 0.1, m = annulusMesh({ nr: 24, nt: 32, nz: 1, t });
  const model = ellipticPlateModel('LE1', m, t);
  const S = model.nodalForces.reduce((s, q) => [s[0] + q.fx, s[1] + q.fy, s[2] + q.fz], [0, 0, 0]);
  const want = [10e6 * t * OUTER.b, 10e6 * t * OUTER.a];   // p·t·(Δy, −Δx) along the arc
  ck(`ΣF = p·t·(2.75, 3.25) = (${want[0].toExponential(4)}, ${want[1].toExponential(4)}) N`,
    Math.abs(S[0] - want[0]) < 1e-9 * want[0] && Math.abs(S[1] - want[1]) < 1e-9 * want[1], `got ${S[0]}, ${S[1]}`);
  ck('with no z component', Math.abs(S[2]) < 1e-6, `${S[2]}`);
  ck('loaded nodes are outer-surface nodes only', model.nodalForces.every(q => m.meta[q.nodeId - 1].i === m.nr));
  const fz = model.prescribed.filter(p => p.fz).map(p => m.meta[p.nodeId - 1].k);
  ck('membrane rigid-z is the z=0 face', fz.length === (m.nr + 1) * (m.nt + 1) && fz.every(k => k === 0), `${fz.length}`);
}

console.log('\n== a RAGGED outer boundary (no boundary recovery: tets missing at the rim) ==');
{
  // Drop 3 of the 6 Kuhn tets in every other outer-layer cell: the discrete outer boundary
  // becomes a staircase whose exposed facets face every which way -- what meshShape's
  // centroid filter leaves at coarse targetEdge. Cells touching a symmetry plane are kept,
  // so the planes stay whole and the in-plane identity applies.
  const t = 0.1, m = annulusMesh({ nr: 6, nt: 16, nz: 1, t });
  const keep = [];
  for (let e = 0; e < m.tetCount; e++) {
    const cell = Math.floor(e / 6), within = e % 6;
    const i = cell % m.nr, j = Math.floor(cell / m.nr) % m.nt;
    if (i === m.nr - 1 && j % 2 === 1 && j < m.nt - 1 && within < 3) continue;
    keep.push(...m.tets.slice(4 * e, 4 * e + 4));
  }
  m.tets = keep; m.tetCount = keep.length / 4;
  const model = ellipticPlateModel('LE1', m, t);
  ck(`the LE1 in-plane resultant is still exact on it (error ${(model.diag.resultantErr * 100).toExponential(2)} %; the staircase carries F_z = ${(model.diag.resultant[2] / 1e6).toFixed(3)}e6 N)`, model.diag.resultantErr < 1e-9, `${model.diag.resultantErr}`);
  ck('and nothing was left unassigned', model.diag.outerUnassigned === 0, `${model.diag.outerUnassigned}`);
  const sel = outerEllipseSurface(m);
  ck('no inner-ellipse node is taken for the outer face', [...sel.nodes].every(n => m.meta[n].i !== 0));
  // POSITIVE CONTROL: selecting outer facets by normal (cos ≥ 0.7 to the ellipse normal)
  // drops the staircase risers and under-loads the edge -- the defect measured on the real
  // mesh at targetEdge 0.20 (resultant (2.38, 2.14)e6 of (2.75, 3.25)e6).
  const R = [0, 0];
  for (const f of tetBoundaryFaces(m)) {
    const p0 = NODE(m, f[0]), p1 = NODE(m, f[1]), p2 = NODE(m, f[2]);
    const [A, nx, ny] = triAreaOutwardNormal(p0, p1, p2, NODE(m, f[3]));
    const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3;
    const gx = cx / OUTER.a ** 2, gy = cy / OUTER.b ** 2, gl = Math.hypot(gx, gy);
    if ((nx * gx + ny * gy) / gl >= 0.7 && Math.abs(Math.hypot(cx / OUTER.a, cy / OUTER.b) - 1) < 0.2) { R[0] += 10e6 * A * nx; R[1] += 10e6 * A * ny; }
  }
  const exact = [10e6 * t * OUTER.b, 10e6 * t * OUTER.a], errN = Math.hypot(R[0] - exact[0], R[1] - exact[1]) / Math.hypot(...exact);
  ck(`POSITIVE CONTROL: a normal-based selection misses load here (resultant off by ${(errN * 100).toFixed(2)} %)`, errN > 1e-3, `${errN}`);
}

console.log(`\n[nafems-bc-sets] ${P} passed, ${F} failed`);
process.exit(F === 0 ? 0 : 1);
