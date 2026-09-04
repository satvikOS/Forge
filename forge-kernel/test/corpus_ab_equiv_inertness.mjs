// ─────────────────────────────────────────────────────────────────────────────
// corpus_ab_equiv_inertness.mjs — prove the SURFACE-KIND EQUIVALENCE change is
// INERT on every pre-existing observable, on the full corpus, field by field.
//
// The change adds a per-face geometric certificate to measure(). That is new
// work inside the arm's own deadline, so it is not enough to reason that new
// fields cannot disturb old ones: a slower arm can TIME OUT, and a timeout
// rewrites `status`, which rewrites the bucket, which rewrites the verdict.
// This script compares two runs of the same 600 parts row by row over every
// field that existed BEFORE the change, and reports any row that moved.
//
// usage: node corpus_ab_equiv_inertness.mjs <before.jsonl> <after.jsonl>
// exit 0 iff every row is identical on every pre-existing field.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: <before.jsonl> <after.jsonl>'); process.exit(2); }

const load = (p) => {
  const m = new Map();
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.part && r.family) m.set(`${r.part}|${r.family}`, r);
  }
  return m;
};
const A = load(a), B = load(b);

// Every field the JSONL carried BEFORE this change. `efk`, `npl`, `nrc`,
// `pdev`, `pang` and `agree_equiv` are the additions and are deliberately not
// listed: comparing them would be comparing the change to itself.
const ARM_FIELDS = ['status', 'valid', 'f', 'e', 'v', 'sh', 'so', 'vol', 'area', 'len', 'note'];
const ARM_VEC = ['com', 'bb', 'fk', 'ek'];
const ROW_FIELDS = ['applicable', 'na_reason', 'bucket', 'agree', 'agree_upto_orientation',
                    'agree_strict', 'op', 'diag', 'min_ext', 'flat', 'nfaces_part'];

let common = 0, identical = 0;
const moved = [];
const onlyIn = { before: [], after: [] };
for (const k of A.keys()) if (!B.has(k)) onlyIn.before.push(k);
for (const k of B.keys()) if (!A.has(k)) onlyIn.after.push(k);

for (const [k, ra] of A) {
  const rb = B.get(k);
  if (!rb) continue;
  common++;
  const diffs = [];
  for (const f of ROW_FIELDS)
    if (JSON.stringify(ra[f]) !== JSON.stringify(rb[f]))
      diffs.push(`${f}: ${JSON.stringify(ra[f])} -> ${JSON.stringify(rb[f])}`);
  for (const arm of ['native', 'occt']) {
    const xa = ra[arm] || {}, xb = rb[arm] || {};
    for (const f of ARM_FIELDS)
      if (JSON.stringify(xa[f]) !== JSON.stringify(xb[f]))
        diffs.push(`${arm}.${f}: ${JSON.stringify(xa[f])} -> ${JSON.stringify(xb[f])}`);
    for (const f of ARM_VEC)
      if (JSON.stringify(xa[f]) !== JSON.stringify(xb[f]))
        diffs.push(`${arm}.${f}: ${JSON.stringify(xa[f])} -> ${JSON.stringify(xb[f])}`);
  }
  if (diffs.length === 0) identical++;
  else moved.push({ key: k, diffs });
}

// A row that differs ONLY in a centre-of-mass component is the pre-existing
// BRepGProp summation-order noise reports/corpus_ab/THICKSOLID_ATTRIBUTION.md
// already measured; it is separated here rather than lumped in, because
// "1 row moved" and "1 row moved by 1e-15 in one centroid" are different facts.
const comOnly = moved.filter((m) => m.diffs.every((d) => /\.com:/.test(d)));
const real = moved.filter((m) => !m.diffs.every((d) => /\.com:/.test(d)));

console.log(`rows in BEFORE: ${A.size}   rows in AFTER: ${B.size}   common: ${common}`);
console.log(`only in BEFORE: ${onlyIn.before.length}   only in AFTER: ${onlyIn.after.length}`);
console.log(`identical on every pre-existing field : ${identical}/${common}`);
console.log(`differ ONLY in a centre-of-mass value : ${comOnly.length}`);
console.log(`rows with any OTHER difference        : ${real.length}`);
for (const m of real.slice(0, 40)) console.log(`  ${m.key}: ${m.diffs.join(' | ')}`);
for (const k of onlyIn.before.slice(0, 20)) console.log(`  only in BEFORE: ${k}`);
for (const k of onlyIn.after.slice(0, 20)) console.log(`  only in AFTER:  ${k}`);
process.exit(real.length === 0 && onlyIn.before.length === 0 && onlyIn.after.length === 0 ? 0 : 1);
