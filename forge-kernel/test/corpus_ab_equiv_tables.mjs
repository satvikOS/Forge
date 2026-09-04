// Generates section 4 of SURFACE_KIND_EQUIVALENCE_2026-09-03.md from the two
// aggregations of the SAME rows: BEFORE = PR #224's aggregator (reads
// agree_strict), AFTER = this change's aggregator (reads agree_equiv).
import { readFileSync } from 'node:fs';
const [beforeP, afterP, jsonlP] = process.argv.slice(2);
const B = JSON.parse(readFileSync(beforeP, 'utf8'));
const A = JSON.parse(readFileSync(afterP, 'utf8'));
const bm = new Map(B.families.map((f) => [f.family, f]));
const L = [];
L.push('### T4 — the SAME rows, aggregated twice');
L.push('');
L.push('| family | N | both | agree (loose) | **strict** | **equiv** | rescued by the rule | BEFORE verdict (#224, reads `agree_strict`) | AFTER verdict (reads `agree_equiv`) | changed |');
L.push('|---|---:|---:|---:|---:|---:|---:|---|---|---|');
let changed = 0;
for (const a of A.families) {
  const b = bm.get(a.family);
  const bv = b ? `${b.verdict}${b.failed_terms.length ? ' (' + b.failed_terms.join(', ') + ')' : ''}` : '?';
  const av = `${a.verdict}${a.failed_terms.length ? ' (' + a.failed_terms.join(', ') + ')' : ''}`;
  const ch = b && b.verdict !== a.verdict;
  if (ch) changed++;
  L.push(`| ${ch ? '**' + a.family + '**' : a.family} | ${a.N} | ${a.both_ok} | ${a.both_ok_agree} | ` +
         `${a.both_ok_agree_strict} | ${a.both_ok_agree_equiv} | ${a.equiv_only} | ${bv} | ` +
         `${ch ? '**' + av + '**' : av} | ${ch ? '**YES**' : 'no'} |`);
}
L.push('');
L.push(`${changed} of ${A.families.length} rows changed status.`);
L.push('');
L.push('### T5 — the rule\'s own evidence, per family');
L.push('');
L.push('| family | pairs rescued | faces reclassified | worst deviation from the plane (mm) | worst normal swing (rad) | chain violations |');
L.push('|---|---:|---:|---:|---:|---:|');
for (const a of A.families)
  L.push(`| ${a.family} | ${a.equiv_only} | ${a.equiv_reclassified_faces} | ` +
         `${a.equiv_worst_planarity_dev.toExponential(3)} | ` +
         `${a.equiv_worst_normal_swing_rad.toExponential(3)} | ${a.implication_chain_violations} |`);

// The kind SIGNATURES of the strict-disagreeing pairs, measured from this run's
// own rows rather than quoted from an earlier report.
const KS = ['Plane','Cylinder','Cone','Sphere','Torus','Bezier','BSpline','SurfRev','SurfExtr','OffsetSurf','Other'];
const KC = ['Line','Circle','Ellipse','Hyperbola','Parabola','Bezier','BSpline','Offset','Other'];
const rows = readFileSync(jsonlP, 'utf8').split('\n').filter((l) => l.trim())
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const hist = (a, N) => (a || []).map((x, i) => (x ? `${N[i]}x${x}` : '')).filter(Boolean).join('+') || '-';
L.push('');
L.push('### T6 — what the strict-vector disagreement actually IS, per family');
L.push('');
L.push('| family | pairs | faces native -> OCCT | edges native -> OCCT | n | rescued? |');
L.push('|---|---:|---|---|---:|---|');
for (const fam of ['FILLING', 'THRUSECTIONS']) {
  const sig = new Map();
  let tot = 0;
  for (const r of rows) {
    if (r.family !== fam || r.bucket !== 'BOTH_OK' || r.agree_strict) continue;
    tot++;
    const k = JSON.stringify([hist(r.native.fk, KS), hist(r.occt.fk, KS),
                              hist(r.native.ek, KC), hist(r.occt.ek, KC),
                              !!r.agree_equiv]);
    sig.set(k, (sig.get(k) || 0) + 1);
  }
  const top = [...sig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  let first = true;
  for (const [k, n] of top) {
    const [nf, of_, ne, oe, resc] = JSON.parse(k);
    L.push(`| ${first ? `**${fam}** (${tot} pairs)` : ''} | ${first ? tot : ''} | ` +
           `\`${nf}\` -> \`${of_}\` | \`${ne}\` -> \`${oe}\` | ${n} | ${resc ? '**yes**' : 'no'} |`);
    first = false;
  }
}
console.log(L.join('\n'));
