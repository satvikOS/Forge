#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  cadgen_aggregate.mjs — combine batched --json-out JSONL from cadgenbench_eval
//  and reproduce the official CADGenBench per-dimension gate EXACTLY as
//  reportGen()/reportEdit() do, with ZERO serve degradation (each batch ran on a
//  fresh mlx_lm.server). Usage:
//     node cadgen_aggregate.mjs results.jsonl [more.jsonl ...]
//  Dedups by (kind,id) keeping the LAST record (so a re-run batch overrides).
//  Gate axes: validity, shape, interface, topology  (mean ≥ GATE) ; plus the
//  derived generation (gen overall cad_score) + editing (edit mean) axes. The
//  Forge bible holds validity to ≥0.97; everything else to ≥0.85.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';

const GATE = parseFloat(process.env.CADGEN_GATE || '0.85');
const VALIDITY_GATE = parseFloat(process.env.CADGEN_VALIDITY_GATE || '0.97');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('usage: cadgen_aggregate.mjs <results.jsonl> [...]'); process.exit(2); }

// Collect ALL records per (kind:id) and AVERAGE them. Repeat eval runs (noise
// bracketing — mlx 4-bit temp-0 still drifts run-to-run) append multiple records
// per case; averaging makes the gate the MEAN over runs, not one noisy draw.
// Single-run = 1 record per key = its own value (unchanged behaviour).
const byKey = new Map();
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  for (const line of txt.split('\n')) {
    const s = line.trim(); if (!s) continue;
    let r; try { r = JSON.parse(s); } catch { continue; }
    if (!r.kind || !r.id) continue;
    const k = `${r.kind}:${r.id}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
}
const NUMF = ['validity_axis', 'shape', 'interface', 'topology', 'dimL1', 'cad_score', 'sRenorm', 'editing_cad_score'];
const avgRec = (arr) => {
  const o = { ...arr[arr.length - 1] };          // template keeps kind/id/category
  for (const fld of NUMF) o[fld] = arr.reduce((a, r) => a + (r[fld] || 0), 0) / arr.length;
  o.gate = arr.reduce((a, r) => a + (r.gate ? 1 : 0), 0) / arr.length >= 0.5;   // majority-valid
  o.built = arr.reduce((a, r) => a + (r.built ? 1 : 0), 0) / arr.length >= 0.5;
  o._runs = arr.length;
  return o;
};
const all = [...byKey.values()].map(avgRec);
const MAXRUNS = Math.max(1, ...all.map((r) => r._runs || 1));
const gen = all.filter((r) => r.kind === 'gen');
const edit = all.filter((r) => r.kind === 'edit');

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const min = (xs) => (xs.length ? Math.min(...xs) : 0);
const f3 = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(3) : String(x));
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };

console.log('\n════════════════════════════════════════════════════════════════════');
console.log(` CADGenBench AGGREGATE  (${gen.length} gen + ${edit.length} edit cases` +
  (MAXRUNS > 1 ? `, ${MAXRUNS}-run averaged for noise` : '') + `)`);
console.log('════════════════════════════════════════════════════════════════════');

// ── gen dimensions ──
const DIMS = [
  ['validity', (r) => r.validity_axis || 0, VALIDITY_GATE],
  ['shape', (r) => r.shape || 0, GATE],
  ['interface', (r) => r.interface || 0, GATE],
  ['topology', (r) => r.topology || 0, GATE],
];
const genOverall = mean(gen.map((r) => r.cad_score || 0));
const editMean = mean(edit.map((r) => r.editing_cad_score || 0));

console.log(pad('dimension', 14) + pad('MEAN', 9) + pad('MIN', 9) + pad('sub-gate', 10) + 'vs');
console.log('─'.repeat(50));
let allPass = true;
for (const [name, get, g] of DIMS) {
  const vals = gen.map(get);
  const m = mean(vals); const ok = m >= g;
  if (!ok) allPass = false;
  console.log(pad(name, 14) + pad(f3(m), 9) + pad(f3(min(vals)), 9) + pad('≥' + g.toFixed(2), 10) + (ok ? 'PASS' : 'FAIL ✗'));
}
// derived axes
const genOk = genOverall >= GATE, editOk = editMean >= GATE;
if (!genOk) allPass = false; if (edit.length && !editOk) allPass = false;
console.log('─'.repeat(50));
console.log(pad('generation', 14) + pad(f3(genOverall), 9) + pad('—', 9) + pad('≥' + GATE.toFixed(2), 10) + (genOk ? 'PASS' : 'FAIL ✗'));
if (edit.length)
  console.log(pad('editing', 14) + pad(f3(editMean), 9) + pad('—', 9) + pad('≥' + GATE.toFixed(2), 10) + (editOk ? 'PASS' : 'FAIL ✗'));

const builtGen = gen.filter((r) => r.gate).length;
console.log('\n Valid gen builds  = ' + builtGen + '/' + gen.length + ' (' + (100 * builtGen / Math.max(1, gen.length)).toFixed(0) + '%)');
if (edit.length) console.log(' Valid edit builds = ' + edit.filter((r) => r.built).length + '/' + edit.length);

// worst-scoring cases — the next increment targets
const worst = [...gen].sort((a, b) => (a.cad_score || 0) - (b.cad_score || 0)).slice(0, 8);
console.log('\n LOWEST gen cases (next-increment targets):');
for (const r of worst)
  console.log('   ' + pad(r.id, 26) + 'CAD=' + f3(r.cad_score || 0) + '  gate=' + (r.gate ? 'Y' : 'N') +
    ' shape=' + f3(r.shape || 0) + ' iface=' + f3(r.interface || 0) + ' topo=' + f3(r.topology || 0));

console.log('\n════════════════════════════════════════════════════════════════════');
console.log(' ALL-DIMS ≥ gate  = ' + (allPass ? 'PASS ✓' : 'FAIL ✗') +
  '   (validity≥' + VALIDITY_GATE.toFixed(2) + ', rest≥' + GATE.toFixed(2) + ')');
console.log('════════════════════════════════════════════════════════════════════');
process.exit(allPass ? 0 : 1);
