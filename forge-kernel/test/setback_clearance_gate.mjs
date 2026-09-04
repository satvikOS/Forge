#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// setback_clearance_gate.mjs — THE BIDIRECTIONAL GATE on the minimum-clearance
// half of setbackFitsFaces (src/native/brep/NativeFilletChamfer.cpp).
//
// WHAT IT GUARDS. Before that guard existed, forge::occtfillet returned a
// BRepCheck-INVALID solid on the IDENTICAL 91 parts of the 600-part corpus in
// BOTH families, with mass properties and shell/solid counts matching OCCT to
// ~1e-6 (PR #241's census: 69 FACE/IntersectingWires, 22 FACE/UnorientableShape
// + WIRE/SelfIntersectingWire, 0 statuses of any kind on the 312 valid).
//
// A GUARD HAS TWO WAYS TO BE WORTHLESS AND THIS GATE CLOSES BOTH.
//   * It can fail to fire — then the 91 are answered INVALID again. Checks 3/4/5
//     and 9/10/11 go red.
//   * It can always fire — then the engine is destroyed. Checks 1/2/7/8 and the
//     exact-count checks 6/12 go red the moment ONE part of the valid baseline
//     stops being answered.
// Both directions are asserted against a PINNED baseline measured from the
// PRE-FIX engine, so neither can be satisfied by moving the bar.
//
// THE BASELINE IS NOT A TARGET, IT IS A RECORD. reports/corpus_ab/
// setback_clearance_baseline.json lists, per family, the exact parts the
// pre-fix engine answered VALID (they must all still be answered) and the exact
// parts it answered INVALID (they must all now DEFER), each of the latter tagged
// with the BRepCheck class the probe measured for it. Check 5/11 requires the
// deferral reason to MATCH that class part-by-part — a guard that deferred the
// right 91 parts for the wrong reasons would not be measuring what it claims to.
//
// usage:
//   node test/setback_clearance_gate.mjs <results.jsonl> [--baseline=<path>]
//   node test/setback_clearance_gate.mjs --selftest [--baseline=<path>]
//
// --selftest is the POSITIVE CONTROL: it feeds each check an input built to trip
// exactly that check and requires RED back. A check that has never been seen to
// fire is indistinguishable from one that cannot.
//
// Exit 0 iff every check passed.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.join(HERE, '..', 'reports', 'corpus_ab',
                                   'setback_clearance_baseline.json');

// The two reason substrings the engine emits. Matched as SUBSTRINGS of the row's
// `note`, which corpus_ab_coverage fills from forge::occtfillet::Result::reason.
const REASON = {
  HOLE:     'inner (hole) wire of the adjacent face',
  RINGFOLD: "non-adjacent segment of the adjacent face's",
};
// probe BRepCheck class -> the reason the guard must give for it
const CLASS_TO_REASON = { IntersectingWires: 'HOLE', SelfIntersecting: 'RINGFOLD' };

function readRows(p) {
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* an {"error":...} row is data */ }
  }
  return out;
}

function indexFamily(rows, fam) {
  const m = new Map();
  for (const r of rows) if (r.family === fam && r.applicable) m.set(r.part, r);
  return m;
}

function reasonOf(row) {
  const n = (row && row.native && row.native.note) || '';
  for (const [k, sub] of Object.entries(REASON)) if (n.includes(sub)) return k;
  return null;
}

// ── the check runner. `nrun` is INCREMENTED HERE, never declared ahead of time:
//    the count this prints is the number of checks that actually executed.
function makeRunner() {
  const st = { nrun: 0, nbad: 0, lines: [] };
  st.check = (name, ok, detail) => {
    st.nrun += 1;
    if (!ok) st.nbad += 1;
    const line = `  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`;
    st.lines.push(line);
    console.log(line);
  };
  return st;
}

function runChecks(st, rows, baseline) {
  for (const fam of ['FILLET', 'CHAMFER']) {
    const b = baseline.families[fam];
    const idx = indexFamily(rows, fam);
    const okRows = [...idx.values()].filter(r => r.native.status === 'OK');

    // 1. NOT OVER-FIRING: every part the pre-fix engine answered VALID is still answered.
    const lost = b.valid.filter(p => !(idx.get(p) && idx.get(p).native.status === 'OK'));
    st.check(`${fam}: all ${b.valid.length} baseline-VALID parts are still ANSWERED`,
             lost.length === 0, `lost ${lost.length}${lost.length ? ': ' + lost.slice(0, 8).join(',') : ''}`);

    // 2. and each of them is still BRepCheck-VALID (answered is not the same as right).
    const degraded = b.valid.filter(p => idx.get(p) && idx.get(p).native.status === 'OK'
                                      && idx.get(p).native.valid !== 1);
    st.check(`${fam}: all ${b.valid.length} baseline-VALID parts are still BRepCheck-VALID`,
             degraded.length === 0, `degraded ${degraded.length}${degraded.length ? ': ' + degraded.slice(0, 8).join(',') : ''}`);

    // 3. NOT UNDER-FIRING: the engine returns NO BRepCheck-invalid answer at all.
    const invalid = okRows.filter(r => r.native.valid === 0).map(r => r.part);
    st.check(`${fam}: the native arm returns ZERO BRepCheck-INVALID answers`,
             invalid.length === 0, `invalid ${invalid.length}${invalid.length ? ': ' + invalid.slice(0, 8).join(',') : ''}`);

    // 4. every part the pre-fix engine answered INVALID now DEFERS.
    const stillAnswered = b.invalid.map(e => e.part)
      .filter(p => !(idx.get(p) && idx.get(p).native.status === 'DEFER'));
    st.check(`${fam}: all ${b.invalid.length} baseline-INVALID parts now DEFER`,
             stillAnswered.length === 0,
             `still answered ${stillAnswered.length}${stillAnswered.length ? ': ' + stillAnswered.slice(0, 8).join(',') : ''}`);

    // 5. and each defers for the reason its measured BRepCheck class demands.
    const mismatched = [];
    for (const e of b.invalid) {
      const row = idx.get(e.part);
      const want = CLASS_TO_REASON[e.brepcheck_class];
      if (!row || row.native.status !== 'DEFER' || reasonOf(row) !== want)
        mismatched.push(`${e.part}(want ${want}, got ${row ? reasonOf(row) : 'no-row'})`);
    }
    st.check(`${fam}: each of the ${b.invalid.length} defers with the reason its BRepCheck class demands`,
             mismatched.length === 0,
             `mismatched ${mismatched.length}${mismatched.length ? ': ' + mismatched.slice(0, 6).join(' ') : ''}`);

    // 6. THE COUNT IS EXACT. Coverage may not silently GROW either: a part the
    //    pre-fix engine declined that now builds is a change this gate has no
    //    baseline for, and it would mask a valid part lost elsewhere.
    st.check(`${fam}: the native arm answers EXACTLY the ${b.valid.length} baseline-VALID parts and no others`,
             okRows.length === b.valid.length, `answered ${okRows.length}, baseline ${b.valid.length}`);
  }
}

// ── --selftest: prove every check above can go RED ───────────────────────────
function selftest(baseline) {
  // A synthetic result set that satisfies every check, then one mutation per check.
  const clean = [];
  for (const fam of ['FILLET', 'CHAMFER']) {
    const b = baseline.families[fam];
    for (const p of b.valid)
      clean.push({ part: p, family: fam, applicable: true,
                   native: { status: 'OK', valid: 1, note: '' } });
    for (const e of b.invalid)
      clean.push({ part: e.part, family: fam, applicable: true,
                   native: { status: 'DEFER', valid: -1,
                             note: 'refused:' + REASON[CLASS_TO_REASON[e.brepcheck_class]] } });
  }
  const dup = () => JSON.parse(JSON.stringify(clean));
  const find = (rows, fam, part) => rows.find(r => r.family === fam && r.part === part);

  const mutations = [
    ['1 over-fire: a baseline-VALID part starts deferring', (r, b) => {
      const row = find(r, 'FILLET', b.families.FILLET.valid[0]);
      row.native.status = 'DEFER'; row.native.valid = -1;
    }],
    ['2 degrade: a baseline-VALID part is answered but BRepCheck-INVALID', (r, b) => {
      find(r, 'FILLET', b.families.FILLET.valid[1]).native.valid = 0;
    }],
    ['3 under-fire: a part comes back OK and BRepCheck-INVALID', (r, b) => {
      const row = find(r, 'CHAMFER', b.families.CHAMFER.invalid[0].part);
      row.native.status = 'OK'; row.native.valid = 0; row.native.note = '';
    }],
    ['4 under-fire: a baseline-INVALID part is answered again (validly)', (r, b) => {
      const row = find(r, 'FILLET', b.families.FILLET.invalid[0].part);
      row.native.status = 'OK'; row.native.valid = 1; row.native.note = '';
    }],
    ['5 wrong reason: a HOLE part defers with the RINGFOLD reason', (r, b) => {
      const e = b.families.FILLET.invalid.find(x => x.brepcheck_class === 'IntersectingWires');
      find(r, 'FILLET', e.part).native.note = 'refused:' + REASON.RINGFOLD;
    }],
    ['6 silent gain: an extra part is answered on top of the baseline', (r) => {
      r.push({ part: '__extra__', family: 'CHAMFER', applicable: true,
               native: { status: 'OK', valid: 1, note: '' } });
    }],
  ];

  console.log('=== SELFTEST: the positive control — every check must be seen to fire ===');
  const base = makeRunner();
  console.log('-- unmutated input (every check must be GREEN) --');
  runChecks(base, clean, baseline);
  let bad = base.nbad === 0 ? 0 : 1;
  if (base.nbad !== 0) console.log(`  !! the unmutated control is not green (${base.nbad} red)`);

  let fired = 0;
  for (const [name, mutate] of mutations) {
    const rows = dup();
    mutate(rows, baseline);
    const st = makeRunner();
    st.lines = []; // suppress per-check noise for the mutant
    const realLog = console.log; console.log = () => {};
    runChecks(st, rows, baseline);
    console.log = realLog;
    const ok = st.nbad > 0;
    if (ok) fired += 1; else bad = 1;
    console.log(`  [${ok ? 'FIRED' : 'INERT'}] mutation ${name} — ${st.nbad} check(s) red of ${st.nrun}`);
  }
  console.log(`SELFTEST: ${fired}/${mutations.length} mutations made the gate RED; ` +
              `unmutated control ran ${base.nrun} check(s), ${base.nbad} red`);
  if (fired !== mutations.length) bad = 1;
  console.log(bad ? 'SELFTEST FAIL' : 'SELFTEST PASS');
  return bad;
}

// ── main ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let resultsPath = null, baselinePath = DEFAULT_BASELINE, wantSelftest = false;
for (const a of argv) {
  if (a === '--selftest') wantSelftest = true;
  else if (a.startsWith('--baseline=')) baselinePath = a.slice(11);
  else if (a.startsWith('--')) { console.error(`unknown flag ${a}`); process.exit(2); }
  else resultsPath = a;
}
if (!fs.existsSync(baselinePath)) {
  console.error(`FATAL: baseline not found: ${baselinePath}`);
  process.exit(2);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

if (wantSelftest) process.exit(selftest(baseline));

if (!resultsPath) {
  console.error('usage: setback_clearance_gate.mjs <results.jsonl> [--baseline=<path>]');
  console.error('       setback_clearance_gate.mjs --selftest');
  process.exit(2);
}
const rows = readRows(resultsPath);
console.log(`=== SETBACK MINIMUM-CLEARANCE GATE ===`);
console.log(`  results : ${resultsPath} (${rows.length} row(s))`);
console.log(`  baseline: ${baselinePath} (measured at ${baseline.measured_at_head} on ${baseline.measured_utc})`);
const st = makeRunner();
runChecks(st, rows, baseline);
console.log(`=== RESULT: ${st.nrun - st.nbad} / ${st.nrun} checks passed ===`);
process.exit(st.nbad ? 1 : 0);
