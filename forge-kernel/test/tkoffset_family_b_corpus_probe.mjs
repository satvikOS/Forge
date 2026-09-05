#!/usr/bin/env node
// test/tkoffset_family_b_corpus_probe.mjs — TKOffset FAMILY B liveness measurement.
//
//   node test/tkoffset_family_b_corpus_probe.mjs [N]
//
// WHAT THIS MEASURES (and why it exists)
// --------------------------------------
// TKOffset family B is BRepOffsetAPI_MakeFilling, 5 symbols, ONE call site:
// src/Healing.cpp:477 inside heal::autoFillMissingFaces. Before reimplementing it we
// must know whether that path is LIVE, and — for Law 9 — what geometry it is actually
// asked to cap. Two questions, measured separately:
//
//   Q1 "AS-BUILT": run autoFillMissingFaces on each corpus solid as the compiler emits
//      it. facesAdded > 0 means a closed free wire existed and MakeFilling capped it.
//      A watertight solid has no free boundary, so this is expected to be 0 everywhere;
//      it is the control.
//
//   Q2 "DELETE-FACE": the ONLY internal caller of autoFillMissingFaces is
//      direct::deleteFaceAndHeal (DirectModeling.cpp:651), which strips faces from the
//      shell and hands the open shell to the filler. This drives MakeFilling with REAL
//      corpus boundaries — bore circles, fillet-tangent splines, torus-derived edges —
//      not the planar rectangle the smoke test uses. For each part we delete each face
//      in turn (capped per part) and record whether the result came back a closed solid.
//
// The output is the Law 9 baseline: any native replacement must cap at least the wires
// OCCT caps here, on the same parts.
//
// Read-only: builds shapes in-process, writes nothing.

import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const KERNEL = process.env.FORGE_KERNEL ||
  new URL('../build/Release/forge-kernel.node', import.meta.url).pathname;
const f = require(KERNEL);

const CORPUS = process.env.FORGE_CORPUS ||
  '/Users/account_clawteam1/archdisc-Models/data/forge/complex_all.jsonl';
const LIMIT = Number(process.argv[2] || 382);
const MAX_FACES_PER_PART = Number(process.env.MAX_FACES || 12);

if (!fs.existsSync(CORPUS)) {
  console.error(`[famB] corpus not found: ${CORPUS}`);
  process.exit(2);
}

const rows = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

// Take the first LIMIT rows whose STEP exists on disk — the same "first N
// kernel-verified trees" selection the family A sweep used.
const parts = [];
for (const r of rows) {
  if (parts.length >= LIMIT) break;
  if (r.step && fs.existsSync(r.step)) parts.push(r);
}
console.log(`[famB] corpus ${CORPUS}`);
console.log(`[famB] parts with a STEP on disk: ${parts.length} (limit ${LIMIT})`);
console.log(`[famB] deleting up to ${MAX_FACES_PER_PART} faces per part\n`);

let loaded = 0, loadFail = 0;
let q1Parts = 0, q1FacesAdded = 0;                 // Q1: as-built free wires
let delAttempts = 0, delClosed = 0, delOpen = 0, delThrew = 0;
let capsMade = 0;                                  // total MakeFilling successes
const byFamily = new Map();
const openExamples = [];

function bump(fam, key) {
  if (!byFamily.has(fam)) byFamily.set(fam, { attempts: 0, closed: 0, open: 0, threw: 0, caps: 0 });
  byFamily.get(fam)[key]++;
}

for (const p of parts) {
  let h;
  try {
    h = f.io.importStep(p.step);
    if (typeof h === 'object' && h !== null) h = h.handle ?? h.shape ?? h;
  } catch (e) { loadFail++; continue; }
  if (typeof h !== 'number') { loadFail++; continue; }
  loaded++;
  const fam = p.family || '?';

  // ---- Q1: as-built ----
  try {
    const r = f.heal.autoFillMissingFaces(h, 1e-3);
    if (r.report.facesAdded > 0) { q1Parts++; q1FacesAdded += r.report.facesAdded; }
  } catch (e) { /* record nothing; Q1 is a control */ }

  // ---- Q2: delete a face, let autoFillMissingFaces cap the hole ----
  let nFaces = 0;
  try { nFaces = f.direct.faceCount(h); } catch (e) { nFaces = 0; }
  const step = Math.max(1, Math.floor(nFaces / MAX_FACES_PER_PART));
  for (let id = 1; id <= nFaces; id += step) {
    delAttempts++; bump(fam, 'attempts');
    try {
      const out = f.direct.deleteFaceAndHeal(h, [id]);
      const v = f.heal.checkValidity(out);
      if (v.isClosed) { delClosed++; bump(fam, 'closed'); capsMade++; bump(fam, 'caps'); }
      else {
        delOpen++; bump(fam, 'open');
        if (openExamples.length < 12) openExamples.push(`${p.id}/${fam} face#${id}`);
      }
    } catch (e) { delThrew++; bump(fam, 'threw'); }
  }
}

console.log('================ Q1: AS-BUILT free wires (control) ================');
console.log(`  parts loaded            : ${loaded}   (STEP load failures ${loadFail})`);
console.log(`  parts with facesAdded>0 : ${q1Parts}`);
console.log(`  total caps fabricated   : ${q1FacesAdded}`);
console.log('');
console.log('================ Q2: DELETE-FACE -> MakeFilling cap ================');
console.log(`  delete attempts         : ${delAttempts}`);
console.log(`  came back CLOSED solid  : ${delClosed}   <- MakeFilling capped the hole`);
console.log(`  came back OPEN          : ${delOpen}`);
console.log(`  threw                   : ${delThrew}`);
console.log('');
console.log('  per family  attempts / closed / open / threw');
for (const [fam, s] of [...byFamily.entries()].sort()) {
  console.log(`    ${fam.padEnd(22)} ${String(s.attempts).padStart(5)} ${String(s.closed).padStart(7)} ${String(s.open).padStart(6)} ${String(s.threw).padStart(6)}`);
}
if (openExamples.length) {
  console.log('\n  examples that stayed OPEN (OCCT MakeFilling did NOT recover a solid):');
  for (const e of openExamples) console.log(`    ${e}`);
}
console.log(`\n[famB] TOTAL successful MakeFilling caps on corpus geometry: ${capsMade}`);
