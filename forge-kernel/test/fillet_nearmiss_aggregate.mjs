#!/usr/bin/env node
// fillet_nearmiss_aggregate.mjs — turn a fillet_nearmiss_probe JSONL into the
// three tables the question needs answered:
//   1. is the harness's volume integrator CONVERGED on each arm's answer?
//   2. does the volume difference sit in the BLEND or in the bulk?
//   3. does each arm's removed volume match the CLOSED FORM read off the input?
//
// It also reports the error against part size, because "scales with the part"
// and "scales with the operation" are different causes and only one of them is
// an integration artefact.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: fillet_nearmiss_aggregate.mjs <results.jsonl> [--near <ab.jsonl>]'); process.exit(2); }
const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const errs = rows.filter(r => r.error);
const ok = rows.filter(r => !r.error && r.paired);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
const fmt = x => (x === undefined || x === null || Number.isNaN(x)) ? 'n/a' : (Math.abs(x) >= 1e-4 && Math.abs(x) < 1e6 ? x.toPrecision(6) : x.toExponential(3));
const stat = (a) => a.length ? `min ${fmt(Math.min(...a))}  p50 ${fmt(q(a, .5))}  max ${fmt(Math.max(...a))}  n=${a.length}` : 'n=0';

console.log(`rows ${rows.length}   errors ${errs.length}   both-arms-built ${ok.length}`);
if (errs.length) {
  const by = {};
  for (const e of errs) by[e.error] = (by[e.error] || 0) + 1;
  console.log('  errors: ' + Object.entries(by).map(([k, v]) => `${k} x${v}`).join(', '));
}

// the population under study: both arms built, both BRepCheck-valid, volumes differ
const rel = r => Math.abs(r.native.v_fixed - r.occt.v_fixed) / Math.max(Math.abs(r.native.v_fixed), Math.abs(r.occt.v_fixed));
const both = ok.filter(r => r.native_valid === 1 && r.occt_valid === 1);
const dis = both.filter(r => rel(r) > 1e-6);
const agr = both.filter(r => rel(r) <= 1e-6);
console.log(`\nboth valid ${both.length}   volume-disagreeing (>1e-6 rel) ${dis.length}   agreeing ${agr.length}`);
console.log(`  disagreeing volume ratio native/occt: ${stat(dis.map(r => r.native.v_fixed / r.occt.v_fixed))}`);

// ── 1. INTEGRATOR CONVERGENCE ───────────────────────────────────────────────
console.log('\n1. IS THE INTEGRATOR CONVERGED?  |v_fixed - v_gk| / v, per arm, over the disagreeing parts');
for (const arm of ['input', 'native', 'occt']) {
  const a = dis.filter(r => r[arm]).map(r => Math.abs(r[arm].v_fixed - r[arm].v_gk) / Math.abs(r[arm].v_fixed));
  const b = dis.filter(r => r[arm]).map(r => Math.abs(r[arm].v_fixed - r[arm].v_adaptive) / Math.abs(r[arm].v_fixed));
  console.log(`   ${arm.padEnd(7)} fixed-vs-GK      ${stat(a)}`);
  console.log(`   ${''.padEnd(7)} fixed-vs-adaptive ${stat(b)}`);
}
console.log('   (the two arms differ by 2-5e-6; if EITHER of these is smaller than that, the');
console.log('    integrator is converged and the difference is not integration error)');

// ── 2. THE CLOSED FORM ──────────────────────────────────────────────────────
const cf = dis.filter(r => r.closed_form > 0);
console.log(`\n2. AGAINST THE CLOSED FORM READ OFF THE INPUT'S OWN CAP RING (${cf.length} of ${dis.length} have a G1 rim)`);
console.log(`   native removed / closed form  ${stat(cf.map(r => r.native_over_closed))}`);
console.log(`   occt   removed / closed form  ${stat(cf.map(r => r.occt_over_closed))}`);
console.log(`   1 - occt/closed               ${stat(cf.map(r => 1 - r.occt_over_closed))}`);
console.log(`   ring: lines ${[...new Set(cf.map(r => r.ring_lines))].join('/')}  arcs ${[...new Set(cf.map(r => r.ring_arcs))].join('/')}  worst tangent ${fmt(Math.max(...cf.map(r => r.ring_worst_tangent)))}`);

// ── 3. WHERE THE VOLUME DIFFERENCE SITS ─────────────────────────────────────
console.log('\n3. WHERE THE DIFFERENCE SITS');
const dvTot = cf.map(r => r.occt.v_fixed - r.native.v_fixed);
const dvBlend = cf.map(r => r.removed_native - r.removed_occt);
console.log(`   whole-solid volume gap  V_occt - V_native   ${stat(dvTot)}`);
console.log(`   blend gap  removed_native - removed_occt    ${stat(dvBlend)}`);
console.log(`   ratio (they are the same quantity iff 1)    ${stat(dvTot.map((v, i) => v / dvBlend[i]))}`);
const wallMax = cf.map(r => (r.pairs || []).filter(p => p.kn !== p.ko && p.ko === 'SurfExtr').map(p => p.maxdist)).flat();
console.log(`   native-vs-OCCT surface distance on the RE-SPELLED WALLS  ${stat(wallMax)}`);
console.log(`   OCCT blend vs the exact radius-R rolling-ball surface    ${stat(cf.map(r => r.blenddev_occt).filter(x => x > 0))}`);
console.log(`   ...in multiples of R                                     ${stat(cf.map(r => r.blenddev_occt_over_R).filter(x => x > 0))}`);
console.log(`   native blend vs the same surface (0 by construction)     ${stat(cf.map(r => r.blenddev_native).filter(x => x >= 0))}`);
console.log(`   OCCT blend curvature miss  max | |k|R - 1 |              ${stat(cf.map(r => r.curvmiss_occt).filter(x => x >= 0))}`);
console.log(`   native blend curvature miss                              ${stat(cf.map(r => r.curvmiss_native).filter(x => x >= 0))}`);

// ── 4. THE ERROR AGAINST PART SIZE ──────────────────────────────────────────
const corr = (x, y) => {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; ++i) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sx * sy);
};
console.log('\n4. THE ERROR AGAINST PART SIZE  (an integration error scales with what is INTEGRATED;');
console.log('   a geometric error scales with the OPERATION)');
if (cf.length > 2) {
  const abs = cf.map(r => Math.abs(r.occt.v_fixed - r.native.v_fixed));
  console.log(`   corr( |dV| , part volume )        ${corr(abs, cf.map(r => r.input.v_fixed)).toFixed(4)}`);
  console.log(`   corr( |dV| , part diagonal )      ${corr(abs, cf.map(r => r.diag)).toFixed(4)}`);
  console.log(`   corr( |dV| , closed form (blend)) ${corr(abs, cf.map(r => r.closed_form)).toFixed(4)}`);
  console.log(`   |dV| / part volume                ${stat(cf.map(r => Math.abs(r.occt.v_fixed - r.native.v_fixed) / r.input.v_fixed))}`);
  console.log(`   |dV| / closed form                ${stat(cf.map(r => Math.abs(r.occt.v_fixed - r.native.v_fixed) / r.closed_form))}`);
}
