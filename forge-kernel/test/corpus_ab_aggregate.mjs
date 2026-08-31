#!/usr/bin/env node
// corpus_ab_aggregate.mjs — turn a corpus_ab_coverage JSONL into the per-family
// coverage table that the drop options' flip gate is written against.
//
// The gate, quoted from forge-kernel/CMakeLists.txt:432/:475/:555 (which quote
// reports/TKOFFSET_DECOMPOSITION.md §5 step 6):
//
//     "native success rate >= the measured OCCT baseline"
//
// PER FAMILY, NEVER AGGREGATED. Each drop option is flipped on its own, so an
// aggregate rate would let a family with wide coverage pay for one with none —
// which is exactly the capability deletion the gate exists to prevent.
//
// WHAT IS REPORTED, and why each column is there:
//   N            applicable parts. NOT_APPLICABLE parts are excluded and
//                counted separately: a rate over an unstated denominator is
//                not a measurement.
//   both         both engines produced a result the call site would accept
//   nat only     native built where OCCT did not          (a capability ADD)
//   OCCT only    OCCT built where native declined         <- THE DELETION
//   neither      neither built (says nothing about either engine)
//   nat %, occt % (both + own-only) / N
//   delta        native % - occt %, with a 95% CI. A difference without an
//                interval is not a result, and these samples are small.
//   McNemar p    exact two-sided binomial test on the DISCORDANT pairs only —
//                the correct test for paired binary outcomes. The concordant
//                pairs carry no information about which engine is better and
//                including them (a two-proportion z) would understate the
//                uncertainty.
//   verdict      PASS iff native % >= occt %; the gate's own words.
//                UNDERPOWERED is printed alongside when the CI straddles zero:
//                "not significantly worse" is not "not worse", and this repo
//                has already been burnt once by reading an underpowered
//                held-out set as an answer.
//
// Also reported per family: agreement inside the `both` bucket (a vector of
// observables, not volume alone) and the per-arm status histogram, so a family
// whose OCCT arm is mostly CRASH is not silently read as a native win.
//
// usage: node corpus_ab_aggregate.mjs <results.jsonl> [--json <out.json>] [--md <out.md>]

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('usage: corpus_ab_aggregate.mjs <results.jsonl> [--json out.json] [--md out.md]');
  process.exit(2);
}
const inPath = args[0];
let jsonOut = null, mdOut = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--json') jsonOut = args[++i];
  else if (args[i] === '--md') mdOut = args[++i];
}

const rows = [];
let malformed = 0;
for (const line of readFileSync(inPath, 'utf8').split('\n')) {
  const s = line.trim();
  if (!s || s.startsWith('#')) continue;
  try { rows.push(JSON.parse(s)); } catch { malformed++; }
}

// ── statistics ──────────────────────────────────────────────────────────────
function logChoose(n, k) {
  // log C(n,k) via lgamma, so a 600-row discordant count does not overflow.
  const lg = (x) => {
    // Lanczos approximation, plenty for the integer arguments used here.
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
               771.32342877765313, -176.61502916214059, 12.507343278686905,
               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lg(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  };
  return lg(n + 1) - lg(k + 1) - lg(n - k + 1);
}

// Exact two-sided McNemar: b and c are the two discordant counts.
function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1.0;
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) + n * Math.log(0.5));
  return Math.min(1.0, 2 * tail);
}

// 95% CI for the paired difference in proportions (native - occt).
// d = (c - b)/N; Var(d) = ((b + c) - (b - c)^2 / N) / N^2  (the standard paired
// binary variance; the concordant cells contribute nothing to the difference).
function pairedCI(b, c, N) {
  if (N === 0) return [0, 0, 0];
  const d = (c - b) / N;
  const v = ((b + c) - ((b - c) * (b - c)) / N) / (N * N);
  const se = Math.sqrt(Math.max(0, v));
  return [d, d - 1.96 * se, d + 1.96 * se];
}

// ── tally ───────────────────────────────────────────────────────────────────
const fams = new Map();
const errs = [];
for (const r of rows) {
  if (r.error) { errs.push(r); continue; }
  if (!r.family) continue;
  if (!fams.has(r.family)) {
    fams.set(r.family, {
      family: r.family, rows: 0, na: 0, naReasons: {},
      BOTH_OK: 0, NATIVE_ONLY: 0, OCCT_ONLY: 0, NEITHER: 0,
      agree: 0, agreeOrient: 0, disagree: 0,
      natStatus: {}, occtStatus: {},
      natValid: 0, occtValid: 0,
      occtOnlyParts: [],
    });
  }
  const f = fams.get(r.family);
  f.rows++;
  if (!r.applicable) {
    f.na++;
    f.naReasons[r.na_reason || '?'] = (f.naReasons[r.na_reason || '?'] || 0) + 1;
    continue;
  }
  f[r.bucket] = (f[r.bucket] || 0) + 1;
  if (r.bucket === 'BOTH_OK') {
    if (r.agree) f.agree++; else f.disagree++;
    if (r.agree_upto_orientation) f.agreeOrient++;
  }
  if (r.bucket === 'OCCT_ONLY' && f.occtOnlyParts.length < 12) f.occtOnlyParts.push(r.part);
  const ns = r.native?.status || '?', os = r.occt?.status || '?';
  f.natStatus[ns] = (f.natStatus[ns] || 0) + 1;
  f.occtStatus[os] = (f.occtStatus[os] || 0) + 1;
  if (r.native?.valid === 1) f.natValid++;
  if (r.occt?.valid === 1) f.occtValid++;
}

const order = ['FILLET', 'MAKEOFFSET', 'THICKSOLID', 'OFFSETSHAPE', 'THRUSECTIONS',
               'PIPE', 'PIPESHELL', 'FILLING', 'THICKEN', 'DRAFT'];
const famList = [...fams.values()].sort(
  (a, b) => (order.indexOf(a.family) + 1000 * (order.indexOf(a.family) < 0)) -
            (order.indexOf(b.family) + 1000 * (order.indexOf(b.family) < 0)));

const OPTION = {
  FILLET:       'FORGE_FILLET_DROP_NATIVE',
  MAKEOFFSET:   'FORGE_OFFSET_DROP_MAKEOFFSET',
  THICKSOLID:   'FORGE_THICKSOLID_DROP_NATIVE',
  OFFSETSHAPE:  'FORGE_OFFSETSHAPE_DROP_NATIVE',
  THRUSECTIONS: 'FORGE_THRUSECTIONS_DROP_NATIVE',
  PIPE:         'FORGE_PIPE_DROP_NATIVE',
  PIPESHELL:    'FORGE_PIPESHELL_DROP_NATIVE',
  FILLING:      'FORGE_FILLING_DROP_NATIVE',
  THICKEN:      'FORGE_THICKEN_DROP_NATIVE',
  DRAFT:        'FORGE_DRAFT_DROP_NATIVE',
};

const summary = [];
for (const f of famList) {
  const N = f.BOTH_OK + f.NATIVE_ONLY + f.OCCT_ONLY + f.NEITHER;
  const natOk = f.BOTH_OK + f.NATIVE_ONLY;
  const occtOk = f.BOTH_OK + f.OCCT_ONLY;
  const [d, lo, hi] = pairedCI(f.OCCT_ONLY, f.NATIVE_ONLY, N);
  const p = mcnemarExact(f.OCCT_ONLY, f.NATIVE_ONLY);
  const pass = natOk >= occtOk;
  summary.push({
    family: f.family, option: OPTION[f.family] || '?',
    N, not_applicable: f.na, na_reasons: f.naReasons,
    both_ok: f.BOTH_OK, native_only: f.NATIVE_ONLY, occt_only: f.OCCT_ONLY, neither: f.NEITHER,
    native_rate: N ? natOk / N : 0, occt_rate: N ? occtOk / N : 0,
    delta: d, ci95: [lo, hi], mcnemar_p: p,
    verdict: N === 0 ? 'NO DATA' : (pass ? 'PASS' : 'FAIL'),
    // UNDERPOWERED means "the data cannot distinguish the two engines", which
    // requires there to BE discordant pairs whose split is uncertain. With zero
    // discordant pairs the CI is the degenerate [0,0] and the two engines agreed
    // on every single part -- that is the strongest possible tie, not a weak
    // one, and labelling it "underpowered" would misreport it.
    underpowered: N > 0 && (f.OCCT_ONLY + f.NATIVE_ONLY) > 0 && lo <= 0 && hi >= 0,
    discordant: f.OCCT_ONLY + f.NATIVE_ONLY,
    deficit_parts: f.OCCT_ONLY,
    both_ok_agree: f.agree, both_ok_agree_upto_orientation: f.agreeOrient,
    both_ok_disagree: f.disagree,
    native_status: f.natStatus, occt_status: f.occtStatus,
    native_valid: f.natValid, occt_valid: f.occtValid,
    occt_only_examples: f.occtOnlyParts,
  });
}

const parts = new Set(rows.filter((r) => r.part).map((r) => r.part));

const pct = (x) => (100 * x).toFixed(1).padStart(5) + '%';
const lines = [];
lines.push(`# Corpus A/B coverage — native vs OCCT, per dropped family`);
lines.push('');
lines.push(`parts: ${parts.size}   rows: ${rows.length}   part-level errors: ${errs.length}` +
           (malformed ? `   malformed lines: ${malformed}` : ''));
lines.push('');
lines.push('| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | **agree** | delta (95% CI) | McNemar p | verdict |');
lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|');
for (const s of summary) {
  // AGREE, on the headline row and not only in the detail below it. The verdict
  // is a COVERAGE comparison — it asks whether each arm returned a shape and
  // never whether the two shapes are the same. Families E and F measured 99.8%
  // vs 100.0% ("one part from parity") while agreeing on ZERO of 599 parts,
  // because the native engine mitres the section through the spine corner and
  // OCCT's default BRepBuilderAPI_Transformed does not: the volume ratio is a
  // constant 2/(1+cos30) = 1.071797 on every part. A reader of the old table had
  // no way to see that from the row that carries the verdict.
  // NOTHING ABOUT THE VERDICT CHANGES HERE — this column is additive reporting.
  const agr = s.both_ok > 0
    ? `${s.both_ok_agree}/${s.both_ok} (${(100 * s.both_ok_agree / s.both_ok).toFixed(1)}%)`
    : '-';
  lines.push(`| ${s.family} | \`${s.option}\` | ${s.N} | ${s.both_ok} | ${s.native_only} | ` +
    `**${s.occt_only}** | ${s.neither} | ${pct(s.native_rate).trim()} | ${pct(s.occt_rate).trim()} | ` +
    `${agr} | ` +
    `${(100 * s.delta).toFixed(1)}% [${(100 * s.ci95[0]).toFixed(1)}, ${(100 * s.ci95[1]).toFixed(1)}] | ` +
    `${s.mcnemar_p < 1e-4 ? s.mcnemar_p.toExponential(1) : s.mcnemar_p.toFixed(4)} | ` +
    `${s.verdict}${s.underpowered && s.verdict === 'PASS' ? ' (CI straddles 0)' : ''}` +
    `${s.verdict === 'PASS' && s.discordant === 0 ? ' (0 discordant pairs)' : ''} |`);
}
lines.push('');
lines.push('**OCCT only** is the capability the drop deletes: OCCT built a result the call site');
lines.push('would have accepted and the native engine declined, on the same input. Under the drop');
lines.push('option that decline becomes a thrown error at every one of those call sites.');
lines.push('');
lines.push('**agree** is how many of the `both` pairs match on the full observable vector');
lines.push('(volume, bbox, face/edge/vertex/shell/solid counts, centre of mass). THE VERDICT DOES');
lines.push('NOT READ IT. A family can be one part from a green coverage gate and still return');
lines.push('different geometry on every part it builds — measured for E and F, which agree on 0 of');
lines.push('599 while reading 99.8% vs 100.0%. A LOW agree COLUMN NEXT TO A NEAR-PASS VERDICT MEANS');
lines.push('THE TWO ARMS ARE COMPUTING DIFFERENT OPERATIONS, and the coverage number is not a');
lines.push('statement about how close the drop is.');
lines.push('');
lines.push('## Per-family detail');
for (const s of summary) {
  lines.push('');
  lines.push(`### ${s.family} — \`${s.option}\``);
  lines.push(`- applicable ${s.N}, not applicable ${s.not_applicable} ` +
             `(${Object.entries(s.na_reasons).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'})`);
  lines.push(`- native arm statuses: ${Object.entries(s.native_status).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`- OCCT arm statuses:   ${Object.entries(s.occt_status).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  lines.push(`- BRepCheck_Analyzer valid results: native ${s.native_valid}, OCCT ${s.occt_valid}`);
  lines.push(`- inside \`both\`: ${s.both_ok_agree} agree on the full observable vector, ` +
             `${s.both_ok_agree_upto_orientation} agree up to solid orientation (|volume|), ` +
             `${s.both_ok_disagree} disagree`);
  if (s.occt_only_examples.length)
    lines.push(`- parts in the deletion bucket (first ${s.occt_only_examples.length}): ${s.occt_only_examples.join(', ')}`);
}
if (errs.length) {
  lines.push('');
  lines.push('## Part-level errors');
  const byErr = {};
  for (const e of errs) byErr[e.error] = (byErr[e.error] || 0) + 1;
  for (const [k, v] of Object.entries(byErr)) lines.push(`- ${k}: ${v}`);
}

const md = lines.join('\n') + '\n';
process.stdout.write(md);
if (mdOut) writeFileSync(mdOut, md);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    generated_from: inPath,
    parts: parts.size, rows: rows.length, part_errors: errs.length, malformed,
    families: summary,
  }, null, 2) + '\n');
}
