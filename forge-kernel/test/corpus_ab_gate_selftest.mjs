#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// corpus_ab_gate_selftest.mjs — THE POSITIVE CONTROL FOR THE FLIP GATE'S OWN
// VERDICT.
//
// WHY THIS FILE EXISTS. test/corpus_ab_aggregate.mjs decides whether a native
// engine may replace OCCT. Until 2026-09-03 that decision was one line —
// `natOk >= occtOk` — which counts only WHETHER EACH ARM RETURNED A SHAPE. It
// was measured wrong in three separate ways on the same corpus:
//
//   * OFFSETSHAPE was told to clear a bar of 38 OCCT answers, 33 of which fail
//     BRepCheck.
//   * THICKSOLID was told to clear a bar of 133, ALL of which fail BRepCheck.
//   * PIPE and PIPESHELL read as one part from parity while agreeing with OCCT
//     on ZERO of 599 parts, at a constant volume ratio of 2/(1+cos30).
//
// Three terms were added — validity, agreement, replaceability. AN ADDED TERM
// THAT CANNOT FAIL IS INDISTINGUISHABLE FROM ONE THAT IS NOT THERE, and this
// repo has shipped exactly that mistake before (a merge gate that grepped the
// wrong API for a token it never contained; a guard whose escape hatch nobody
// could open). So each term is driven to FAIL here, on a fixture built for it,
// and then driven to PASS on the same fixture with the one offending field
// changed — because a term stuck at FAIL is just as useless as one stuck at
// PASS, and only the pair of results distinguishes them.
//
// AND THE DIRECTION IS ASSERTED. The change is only permitted to make the gate
// STRICTER. That is not a claim, it is check M below: over every fixture (and
// over any real results.jsonl passed with --corpus), `verdict == PASS` must
// imply `coverage_only_verdict == PASS`. If a family ever passes the new gate
// that would have failed the old one, this file goes red.
//
// The aggregator is invoked AS A SUBPROCESS, on a real JSONL, through the same
// entry point the harness uses. Nothing here re-implements the gate; a self-test
// that reimplements what it is testing tests only itself.
//
// usage: node corpus_ab_gate_selftest.mjs [--corpus <results.jsonl>]
// exit 0 = every check green.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGG = join(HERE, 'corpus_ab_aggregate.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'ab-gate-selftest-'));

let bad = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}   got ${JSON.stringify(got)}` +
              (ok ? '' : `  want ${JSON.stringify(want)}`));
  if (!ok) bad++;
};

// ── fixture construction ────────────────────────────────────────────────────
// One row is one (part, family) pair, in exactly the shape the harness emits.
// `undefined` fields are omitted, which is how a pre-agree_strict JSONL looks.
function arm({ status = 'OK', valid = 1, com = [5, 5, 5] } = {}) {
  return { status, valid, f: 6, e: 12, v: 8, sh: 1, so: 1,
           vol: 1000, area: 600, len: 0, com, bb: [0, 0, 0, 10, 10, 10],
           fk: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ek: [12, 0, 0, 0, 0, 0, 0, 0, 0], note: '' };
}
function row(part, family, o) {
  const nat = o.native === null ? arm({ status: 'DEFER', valid: -1 }) : arm(o.native || {});
  const oc = o.occt === null ? arm({ status: 'DEFER', valid: -1 }) : arm(o.occt || {});
  const nOK = nat.status === 'OK', oOK = oc.status === 'OK';
  const r = {
    part, family, applicable: true, na_reason: '', op: 'fixture',
    diag: 17.32, min_ext: 10, flat: false, nfaces_part: 6,
    native: nat, occt: oc,
    bucket: nOK && oOK ? 'BOTH_OK' : nOK ? 'NATIVE_ONLY' : oOK ? 'OCCT_ONLY' : 'NEITHER',
    agree: o.agree ?? false,
    agree_upto_orientation: o.agree ?? false,
  };
  if (o.agree_strict !== undefined) r.agree_strict = o.agree_strict;
  return r;
}
function runGate(name, rows) {
  const jl = join(TMP, `${name}.jsonl`);
  const js = join(TMP, `${name}.json`);
  writeFileSync(jl, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  execFileSync(process.execPath, [AGG, jl, '--json', js], { stdio: ['ignore', 'ignore', 'inherit'] });
  const out = JSON.parse(readFileSync(js, 'utf8'));
  const by = {};
  for (const f of out.families) by[f.family] = f;
  return by;
}
const many = (n, family, o, prefix = 'p') =>
  Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, family, typeof o === 'function' ? o(i) : o));

const allSummaries = [];
const collect = (by) => { for (const k of Object.keys(by)) allSummaries.push(by[k]); return by; };

console.log('corpus_ab_gate_selftest — driving each added term to FAIL and back to PASS\n');

// ── A. AGREEMENT — coverage parity, zero agreement ──────────────────────────
// This is families E and F exactly: both arms answer on every part, both answers
// are valid, and the two shapes are different. The old gate called it PASS.
console.log('A. a family that passes COVERAGE and disagrees on every part (E/F)');
{
  const by = collect(runGate('A_disagree', many(10, 'PIPE', { agree: false, agree_strict: false })));
  const f = by.PIPE;
  check('A1 old gate (coverage only) would PASS', f.coverage_only_verdict, 'PASS');
  check('A2 new verdict FAILs',                   f.verdict, 'FAIL');
  check('A3 and names the terms',                 f.failed_terms, ['agreement', 'replaceability']);
  check('A4 all 10 valid pairs counted as disagreeing', f.deficit_disagree, 10);
  check('A5 valid bar is the full 10',            f.valid_bar, 10);
  check('A6 nothing was replaced',                f.replaced, 0);
}
// The SAME fixture with the one offending field flipped must go green, or the
// term is stuck at FAIL and proves nothing.
console.log('A(+). the same fixture, agreeing');
{
  const by = collect(runGate('A_agree', many(10, 'PIPE', { agree: true, agree_strict: true })));
  const f = by.PIPE;
  check('A7 verdict PASSes',        f.verdict, 'PASS');
  check('A8 no failed terms',       f.failed_terms, []);
  check('A9 all 10 replaced',       f.replaced, 10);
  check('A10 deficit 0',            f.deficit_valid, 0);
}
// And the gate must read agree_strict, not agree: a pair the loose vector calls
// equal and the strict vector calls different is a DISAGREEMENT.
console.log('A(strict). agree=true but agree_strict=false is a disagreement');
{
  const by = collect(runGate('A_strictonly', many(10, 'PIPE', { agree: true, agree_strict: false })));
  const f = by.PIPE;
  check('A11 verdict FAILs on the strict vector', f.verdict, 'FAIL');
  check('A12 counted as disagreements',           f.deficit_disagree, 10);
  check('A13 the loose column still reports 10 agreeing', f.both_ok_agree, 10);
}

// ── B. VALIDITY — an invalid OCCT answer must not inflate the VALID bar ─────
// This is THICKSOLID: 133 OCCT "successes", every one BRepCheck-invalid, and a
// native arm at zero. The coverage bar is NOT lowered (term 1 still counts all
// 133) but the valid bar, reported beside it, is 0.
console.log('\nB. every OCCT answer is BRepCheck-INVALID (THICKSOLID)');
{
  const by = collect(runGate('B_invalid',
    many(10, 'THICKSOLID', { native: null, occt: { status: 'OK', valid: 0 } })));
  const f = by.THICKSOLID;
  check('B1 OCCT returned 10 shapes',             f.occt_ok, 10);
  check('B2 all 10 reported INVALID, not dropped', f.occt_ok_invalid, 10);
  check('B3 the VALID bar is 0',                  f.valid_bar, 0);
  check('B4 deficit against the valid bar is 0',  f.deficit_valid, 0);
  check('B5 the COVERAGE bar is NOT lowered — term 1 still fails',
        f.coverage_only_verdict, 'FAIL');
  check('B6 so the verdict still FAILs, on coverage', f.failed_terms, ['coverage']);
  check('B7 and the row is labelled vacuous',     f.vacuous, true);
}
// The mixed case is the one that matters for OFFSETSHAPE: a bar of 10 of which
// 7 are invalid, and a native arm that reproduces exactly the 3 valid ones.
console.log('B(mixed). 10 OCCT answers, 7 invalid; native reproduces the 3 valid ones');
{
  const by = collect(runGate('B_mixed', many(10, 'OFFSETSHAPE', (i) => (
    i < 3 ? { occt: { valid: 1 }, native: { valid: 1 }, agree: true, agree_strict: true }
          : { occt: { valid: 0 }, native: null }))));
  const f = by.OFFSETSHAPE;
  check('B8 coverage bar still counts all 10',    f.occt_ok, 10);
  check('B9 valid bar is 3',                      f.valid_bar, 3);
  check('B10 all 3 replaced, deficit 0',          [f.replaced, f.deficit_valid], [3, 0]);
  check('B11 replaceability term PASSes',         f.term_replaceable, true);
  check('B12 but coverage still FAILs (3 < 10) — the bar was not lowered',
        f.coverage_only_verdict, 'FAIL');
  check('B13 verdict FAILs on coverage alone',    f.failed_terms, ['coverage']);
}

// ── C. VALIDITY of the NATIVE arm ───────────────────────────────────────────
// A native arm that answers everywhere with an INVALID solid used to score a
// clean coverage PASS.
console.log('\nC. native answers on every part, and every answer is INVALID');
{
  const by = collect(runGate('C_natinvalid', many(10, 'THICKEN',
    { native: { valid: 0 }, occt: { valid: 1 }, agree: true, agree_strict: true })));
  const f = by.THICKEN;
  check('C1 old gate would PASS (10 >= 10)',      f.coverage_only_verdict, 'PASS');
  check('C2 new verdict FAILs',                   f.verdict, 'FAIL');
  check('C3 on validity and replaceability',      f.failed_terms, ['validity', 'replaceability']);
  check('C4 all 10 in the native-invalid deficit', f.deficit_native_invalid, 10);
}

// ── D. the legacy fallback is VISIBLE, never silent ─────────────────────────
console.log('\nD. a JSONL with no agree_strict field falls back, loudly');
{
  const by = collect(runGate('D_legacy', many(10, 'FILLING', { agree: true })));  // no agree_strict
  const f = by.FILLING;
  check('D1 every row counted as missing the field', f.rows_missing_agree_strict, 10);
  check('D2 the observable set is labelled LEGACY',
        f.agreement_observables.startsWith('LEGACY'), true);
  check('D3 and the fallback uses the strongest vector that run measured',
        f.deficit_disagree, 0);
}

// ── E. the wrong-code-path CENTRE-OF-MASS fingerprint ───────────────────────
// A 50 mm part with a centre of mass at 1e33 is a signature this repo has hit
// twice, both times with the VOLUME clean or exact, so no volume check saw it.
console.log('\nE. a centre of mass 1e33 on a 10 mm part');
{
  const by = collect(runGate('E_com', many(10, 'THICKSOLID',
    { native: { com: [1e33, 5, 5] }, occt: { valid: 1 }, agree: true, agree_strict: true })));
  const f = by.THICKSOLID;
  check('E1 old gate would PASS (10 >= 10)',       f.coverage_only_verdict, 'PASS');
  check('E2 new verdict FAILs',                    f.verdict, 'FAIL');
  check('E3 on sanity',                            f.failed_terms.includes('sanity'), true);
  check('E4 all 10 native answers fingerprinted',  f.native_com_fingerprint, 10);
  check('E5 OCCT arm is clean',                    f.occt_com_fingerprint, 0);
}
// AND IT MUST NOT FIRE ON CURVATURE. `bb` is VERTEX-derived, so a full cylinder's
// vertex bbox is its seam LINE and the centroid is legitimately outside it. The
// first version of this term used "outside the bbox at all" and fired on 12 of 61
// real THICKEN rows and 1 of 45 real FILLING rows. A term that reds a valid
// cylinder is not a stricter gate, it is a wrong one.
console.log('E(-). a centroid one diagonal outside a VERTEX bbox is curvature, not a defect');
{
  const by = collect(runGate('E_bulge', many(10, 'FILLING',
    { native: { com: [-17, 5, 5] }, occt: { valid: 1 }, agree: true, agree_strict: true })));
  const f = by.FILLING;
  check('E6 not counted as a fingerprint',   f.native_com_fingerprint, 0);
  check('E7 but reported as a bulge',        f.native_com_outside_vertex_bbox, 10);
  check('E8 and the sanity term still PASSes', f.term_sanity, true);
}

// ── M. MONOTONICITY — the gate may only get STRICTER ────────────────────────
console.log('\nM. the added terms can only remove PASSes, never create them');
{
  let violations = 0;
  for (const f of allSummaries) {
    if (f.verdict === 'PASS' && f.coverage_only_verdict !== 'PASS') violations++;
  }
  check(`M1 over ${allSummaries.length} fixture families: PASS implies old-PASS`, violations, 0);
}

// ── optional: the same monotonicity check over a REAL corpus run ────────────
const ci = process.argv.indexOf('--corpus');
if (ci >= 0 && process.argv[ci + 1]) {
  const src = process.argv[ci + 1];
  console.log(`\nR. the same check over a real run: ${src}`);
  const js = join(TMP, 'real.json');
  execFileSync(process.execPath, [AGG, src, '--json', js], { stdio: ['ignore', 'ignore', 'inherit'] });
  const out = JSON.parse(readFileSync(js, 'utf8'));
  let violations = 0, flipped = 0;
  for (const f of out.families) {
    if (f.verdict === 'PASS' && f.coverage_only_verdict !== 'PASS') violations++;
    if (f.verdict !== f.coverage_only_verdict) flipped++;
  }
  check(`R1 over ${out.families.length} real families: PASS implies old-PASS`, violations, 0);
  console.log(`  --   ${flipped} of ${out.families.length} families changed status ` +
              `under the added terms (all in the FAIL direction, by R1)`);

  // ── A MUTATION ON REAL ROWS ─────────────────────────────────────────────
  // The fixtures above prove the terms fire on data built to make them fire.
  // That is not the same as proving they fire on THIS corpus. So one real row
  // is mutated in each direction and the verdict is required to move:
  //   R2  a family that PASSES loses one agreement -> must FAIL
  //   R3  a family that fails ONLY on the added terms, with every one of its
  //       offending rows repaired -> must PASS
  // If the gate were insensitive to the corpus it reads, both would be silent.
  const real = readFileSync(src, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const rerun = (rowsIn, tag) => {
    const jl = join(TMP, `${tag}.jsonl`), js2 = join(TMP, `${tag}.json`);
    writeFileSync(jl, rowsIn.map((r) => JSON.stringify(r)).join('\n') + '\n');
    execFileSync(process.execPath, [AGG, jl, '--json', js2], { stdio: ['ignore', 'ignore', 'inherit'] });
    const o = JSON.parse(readFileSync(js2, 'utf8'));
    const by = {}; for (const f of o.families) by[f.family] = f;
    return by;
  };
  const strict = (r) => (r.agree_strict !== undefined ? !!r.agree_strict : !!r.agree);

  const passing = out.families.find((f) => f.verdict === 'PASS' && f.replaced > 0);
  if (!passing) {
    console.log('  --   R2 SKIPPED: no family passes the new gate on this run, so there is');
    console.log('       no PASS to break. Reported, not silently omitted.');
  } else {
    let done = false;
    const mutated = real.map((r) => {
      if (done || r.family !== passing.family || !r.applicable) return r;
      if (r.native?.status !== 'OK' || r.occt?.status !== 'OK') return r;
      if (r.occt?.valid !== 1 || r.native?.valid !== 1 || !strict(r)) return r;
      done = true;
      return { ...r, agree: false, agree_upto_orientation: false, agree_strict: false };
    });
    check(`R2 ${passing.family} PASSes; break ONE real part's agreement -> FAIL`,
          done ? rerun(mutated, 'R2')[passing.family].verdict : 'no-row-found', 'FAIL');
  }

  const addedOnly = out.families.find((f) => f.verdict === 'FAIL' && f.term_coverage &&
                                             f.deficit_valid > 0);
  if (!addedOnly) {
    console.log('  --   R3 SKIPPED: no family fails on the ADDED terms alone in this run.');
  } else {
    let n = 0;
    const repaired = real.map((r) => {
      if (r.family !== addedOnly.family || !r.applicable) return r;
      if (r.occt?.valid !== 1 || r.occt?.status !== 'OK') return r;
      if (r.native?.status === 'OK' && r.native?.valid === 1 && strict(r)) return r;
      n++;
      return { ...r,
               native: { ...r.native, status: 'OK', valid: 1 },
               bucket: 'BOTH_OK', agree: true, agree_upto_orientation: true, agree_strict: true };
    });
    const after = rerun(repaired, 'R3')[addedOnly.family];
    check(`R3 ${addedOnly.family} fails only on added terms; repair its ${n} offending ` +
          `real row(s) -> PASS`, after.verdict, 'PASS');
  }
}

rmSync(TMP, { recursive: true, force: true });
console.log(`\n${bad ? 'FAIL' : 'PASS'}: corpus_ab_gate_selftest, ${bad} check(s) red`);
process.exit(bad ? 1 : 0);
