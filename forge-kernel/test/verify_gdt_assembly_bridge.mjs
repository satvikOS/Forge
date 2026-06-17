#!/usr/bin/env node
/**
 * Headless verification of the GD&T + assembly-context bridge:
 *   (a) part.annotate-pmi  → exportStepWithPmi round-trips with the PMI comment
 *   (b) simulate.tolerance-stack → sensible nominal/min/max + Cpk on a 3-dim chain
 *   (c) scoreMate → running fit PASS, press fit FAIL/press
 *
 * Fresh Node + native kernel only. No Electron, no extra deps.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { makeHeadlessForge, scoreMate } = await import(path.join(__dirname, 'cadscore_harness.mjs'));
const bridge = await import(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'ai', 'ForgeToolBridge.js'));

const forge = makeHeadlessForge();
let fails = 0;
const log = (...a) => console.log(...a);
const PASS = (c, m) => { log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

// ─── (a) part.annotate-pmi ──────────────────────────────────────────────────
log('\n=== (a) part.annotate-pmi — PMI round-trip ===');
{
  const box = forge.makeBox(40, 30, 20);
  const step = path.join(os.tmpdir(), `verify_pmi_${process.pid}_${Date.now()}.step`);
  const notes = [
    { text: '|⌖|⌀0.05|A|B|', anchorKind: 'face', anchorId: 3 },
    { text: 'DATUM A', anchorKind: 'face', anchorId: 0 },
  ];
  const resp = await bridge.dispatchToolCall(
    { name: 'part.annotate-pmi', arguments: { shape: box, notes, filepath: step } },
    { forge },
  );
  log('  dispatch ok:', resp.ok, '| produces:', resp.produces, '| result:', JSON.stringify(resp.result));
  PASS(resp.ok && resp.produces === 'report', 'annotate-pmi dispatched as report verb');
  PASS(fs.existsSync(step), 'STEP file written');
  const body = fs.existsSync(step) ? fs.readFileSync(step, 'utf8') : '';
  PASS(body.includes('/* PMI_FCF: |⌖|⌀0.05|A|B|'), 'PMI_FCF comment present in STEP');
  PASS(body.includes('/* PMI_BLOCK_BEGIN') && body.includes('PMI_BLOCK_END */'), 'PMI block delimiters present');
  PASS(body.includes('face#3'), 'face anchor recorded');
  // Round-trip: re-import the STEP, confirm geometry survives AND comment survives.
  const h2 = forge.io.importStep(step);
  PASS(typeof h2 === 'number' && h2 > 0, `STEP re-imports to a handle (${h2})`);
  // Re-read the on-disk bytes after import to prove the comment is still there.
  PASS(fs.readFileSync(step, 'utf8').includes('/* PMI_FCF:'), 'PMI comment survives on disk through round-trip');
  try { fs.unlinkSync(step); } catch { /* ignore */ }
}

// ─── (b) simulate.tolerance-stack ───────────────────────────────────────────
log('\n=== (b) simulate.tolerance-stack — 3-dim chain ===');
{
  // A 3-link stack: 25 ±0.05, 10 ±0.02, 8 ±0.03 → nominal 43, worst ±0.10.
  const chain = [
    { name: 'A', nominal: 25, plus: 0.05, minus: 0.05 },
    { name: 'B', nominal: 10, plus: 0.02, minus: 0.02 },
    { name: 'C', nominal: 8,  plus: 0.03, minus: 0.03 },
  ];
  const resp = await bridge.dispatchToolCall(
    { name: 'simulate.tolerance-stack', arguments: { chain, USL: 43.12, LSL: 42.88 } },
    { forge },
  );
  log('  result:', JSON.stringify(resp.result));
  const r = resp.result || {};
  PASS(resp.ok && resp.produces === 'report', 'tolerance-stack dispatched as report verb');
  PASS(Math.abs(r.nominal - 43) < 1e-6, `worst-case nominal = 43 (got ${r.nominal})`);
  PASS(Math.abs(r.max - 43.10) < 1e-6, `worst-case max = 43.10 (got ${r.max})`);
  PASS(Math.abs(r.min - 42.90) < 1e-6, `worst-case min = 42.90 (got ${r.min})`);
  PASS(typeof r.Cpk === 'number' && isFinite(r.Cpk) && r.Cpk > 0, `RSS Cpk finite & positive (got ${r.Cpk})`);
  PASS(typeof r.mcCpk === 'number' && isFinite(r.mcCpk), `Monte-Carlo Cpk finite (got ${r.mcCpk})`);
  PASS(r.note.includes('not a geometric'), 'honest note present (numeric, not geometric)');
}

// Helper: build a bushing (annular sleeve) whose bore Ø = boreDia, OD = boreDia+10.
function makeBushing(boreDia, len) {
  const outer = forge.makeCylinder(boreDia / 2 + 5, len);
  let inner = forge.makeCylinder(boreDia / 2, len + 20);
  inner = forge.translate(inner, 0, 0, -10);
  return forge.cut(outer, inner);
}

// ─── (c) scoreMate — running PASS, press FAIL/press ─────────────────────────
log('\n=== (c) scoreMate — running clearance vs press fit ===');
{
  const LEN = 40;
  // Running fit: shaft Ø19.98 in bore Ø20.02 → diametral clearance 0.04.
  const shaftR = forge.makeCylinder(19.98 / 2, LEN);
  const boreR = makeBushing(20.02, LEN);
  const running = scoreMate(forge, {
    shaftHandle: shaftR, boreBodyHandle: boreR,
    shaftDia: 19.98, boreDia: 20.02,
    expect: 'running', clearance: { min: 0.01, max: 0.10 },
  });
  log('  running:', JSON.stringify(running));
  PASS(running.fitClass === 'running', 'running fit classified as running (no interference)');
  PASS(running.mate === 1, `running fit scores 1 (PASS) (got ${running.mate})`);
  PASS(running.withinBand === true, 'running diametral clearance in band');
  PASS(running.interferenceVolume === 0, 'running fit: zero interference volume');
  PASS(running.ringGapOpen > 0.75, `ring witnesses open annulus (gapOpen=${running.ringGapOpen})`);

  // Press fit: shaft Ø20.05 in bore Ø20.00 → diametral interference 0.05.
  const shaftP = forge.makeCylinder(20.05 / 2, LEN);
  const boreP = makeBushing(20.00, LEN);
  // Score against a 'running' EXPECTATION so a press fit reads as a FAILURE
  // (the design wanted a running clearance but got an interference).
  const pressVsRunning = scoreMate(forge, {
    shaftHandle: shaftP, boreBodyHandle: boreP,
    shaftDia: 20.05, boreDia: 20.00,
    expect: 'running', clearance: { min: 0.01, max: 0.10 },
  });
  log('  press-vs-running:', JSON.stringify(pressVsRunning));
  PASS(pressVsRunning.fitClass === 'press', 'interference fit classified as press');
  PASS(pressVsRunning.mate === 0, `press measured against running-expectation scores 0 (FAIL) (got ${pressVsRunning.mate})`);
  PASS(pressVsRunning.interferenceVolume > 0, `press fit: non-zero interference volume (${pressVsRunning.interferenceVolume})`);

  // And the same press geometry scored against a CORRECT press expectation → PASS.
  const shaftP2 = forge.makeCylinder(20.05 / 2, LEN);
  const boreP2 = makeBushing(20.00, LEN);
  const pressOk = scoreMate(forge, {
    shaftHandle: shaftP2, boreBodyHandle: boreP2,
    shaftDia: 20.05, boreDia: 20.00,
    expect: 'press', press: { min: 0.01, max: 0.10 },
  });
  log('  press-vs-press:', JSON.stringify(pressOk));
  PASS(pressOk.mate === 1, `press fit against press-expectation scores 1 (PASS) (got ${pressOk.mate})`);
  PASS(pressOk.withinBand === true, 'press interference magnitude (0.05) in band');
}

log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
