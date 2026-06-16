#!/usr/bin/env node
/**
 * ladder_probe.mjs — measure where the LIVE Forge model falls off the cadskills
 * 10-task difficulty cliff, to aim the next training fold.
 *
 * For each of the 10 cadskills benchmark-ladder tasks (CADSKILLS_ARTIFACTS.md §2):
 *   1. POST the task prompt to localhost:8080 with the canonical SYSTEM, routed to
 *      the live adapter (adapters/archie/hermes_forge == caps2). temp 0, 640 tok.
 *      Parse <tool_call> blocks via callsFromAssistant (REUSED from the harness).
 *   2. Dispatch the emitted calls through the native kernel in a FRESH CHILD
 *      process (kernel handle counter is process-global, no reset) — same isolation
 *      pattern as cadscore_harness.mjs / label_rows.mjs. The child returns, for the
 *      build: validity (heal.checkValidity), union bbox, terminal body count, and
 *      summed b1 (loops/holes) over terminal bodies.
 *   3. Score against THIS task's numeric criteria from §2:
 *        VALIDITY  — hard gate (closed && manifold && oriented && !self-intersect).
 *        BBOX      — all 3 dims within ~8% relative error of the criteria bbox.
 *        BODY-COUNT— terminal solids got vs want (task 10 = 8, gears NOT fused).
 *        b1 (holes)— Betti-1 loop count where countable (planar through-hole groups);
 *                    tooth/blade/fin counts are best-effort and flagged "n/m".
 *   4. Print a per-task scorecard + a 0..1 ladder_score + one-line failure reason.
 *   Then: mean ladder_score, the DIFFICULTY CLIFF (first failing task index), and a
 *   prioritized list of SPECIFIC capability gaps.
 *
 * MEASUREMENT ONLY — promotes/trains nothing.
 *
 * USAGE:
 *   node forge-kernel/test/ladder_probe.mjs                       # live caps2
 *   node forge-kernel/test/ladder_probe.mjs --adapter <path>      # other adapter
 *   node forge-kernel/test/ladder_probe.mjs --worker --job f --out f   # internal
 *
 * Dependency-free: pure Node builtins + native kernel + the harness it reuses.
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

import {
  makeHeadlessForge, tess, bboxOf, bettiNumbers, checkValid,
  postToModel, callsFromAssistant, CANONICAL_SYSTEM,
} from './cadscore_harness.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..', '..');
const BRIDGE_PATH = path.resolve(REPO, 'frontend', 'src', 'ai', 'ForgeToolBridge.js');

const ADAPTER_DEFAULT = 'adapters/archie/hermes_forge'; // caps2 (live)
const BBOX_TOL = 0.08; // 8% relative bbox tolerance per the deliverable spec

// ───────────────────────────────────────────────────────────────────────────
//  The 10-task cadskills ladder — prompts (corpus-style) + §2 numeric oracle.
//  bbox = overall [X,Y,Z] extents in mm. bodies = expected separate solids.
//  b1   = expected planar through-hole loop count where it is a meaningful,
//         countable Betti-1 contribution (null = not a clean Betti target).
//  featureCounts = best-effort named counts we *note* but cannot always measure
//         topologically (teeth/blades/fins) — reported, lightly weighted.
// ───────────────────────────────────────────────────────────────────────────
const TASKS = [
  { i: 1, name: 'rect-calib-block',
    prompt: 'Rectangular calibration block: bounding box 100 x 60 x 20 mm, centered in XY with the bottom face at Z=0. Add 4 through-holes of diameter 8 mm at X=+/-35, Y=+/-20. Apply a 2 mm chamfer to the top outer perimeter edges only. One solid.',
    bbox: [100, 60, 20], bodies: 1, b1: 4,
    featureCounts: { holes: 4, chamfer_edges: 4 } },

  { i: 2, name: 'circular-flange',
    prompt: 'Circular flange: outer diameter 80 mm, thickness 10 mm, axis along +Z. Central bore diameter 30 mm through. 6 through-holes diameter 6 mm on a 60 mm bolt circle, 60 degrees apart. Add a 1.5 mm fillet to the top and bottom outer edges. One solid.',
    bbox: [80, 80, 10], bodies: 1, b1: 7,
    featureCounts: { bore: 1, bolt_holes: 6 } },

  { i: 3, name: 'l-bracket',
    prompt: 'L-bracket: base plate 80 x 50 x 8 mm and a back plate 80 x 8 x 50 mm meeting at the corner. 2 vertical through-holes diameter 6 in the base at X=+/-25, Y=-10. 2 horizontal through-holes diameter 6 in the back at X=+/-25, Z=30. 2 triangular gussets 8 mm thick (30 x 30). Add a 2 mm fillet at the base/back inner corner. Single fused solid.',
    bbox: [80, 50, 50], bodies: 1, b1: 4,
    featureCounts: { holes: 4, gussets: 2 } },

  { i: 4, name: 'stepped-shaft-keyway',
    prompt: 'Stepped shaft along the X axis, total length 120 mm: diameter 20 over 30, then diameter 30 over 60, then diameter 20 over 30, coaxial. 1 mm chamfer at both ends. A keyway on the top of the middle section from X=40 to X=80 (40 long, 6 wide, 3 deep), not through. One solid.',
    bbox: [120, 30, 30], bodies: 1, b1: 0,
    featureCounts: { steps: 3, keyway: 1 } },

  { i: 5, name: 'open-top-enclosure',
    prompt: 'Open-top enclosure: outer box 100 x 70 x 30 mm centered in XY with the bottom at Z=0, open top, wall thickness 3 mm and floor 3 mm. 4 internal standoffs diameter 10 mm, 12 mm tall at X=+/-35, Y=+/-25, each with a blind hole diameter 3 mm depth 8 mm that must not pierce the floor. Apply a 2 mm fillet to the 4 outer vertical edges. One solid.',
    bbox: [100, 70, 30], bodies: 1, b1: null,
    featureCounts: { standoffs: 4, blind_holes: 4 } },

  { i: 6, name: 'clevis-bracket',
    prompt: 'Clevis bracket: base plate 120 x 60 x 10 mm symmetric about the XZ plane. 2 lugs 18 mm thick (Y), 42 mm tall, spaced 36 mm along X with a 16 mm gap, lug tops rounded R18. A horizontal through-hole diameter 14 along Y at X=0, Z=34. 4 base holes diameter 7 at X=+/-45, Y=+/-20. 2 triangular lightening cuts (R3 corners). 2 diagonal ribs 6 mm thick. Base fillet 3, lug fillet 2. Fused solid.',
    bbox: [120, 60, 52], bodies: 1, b1: 5,
    featureCounts: { lug_hole: 1, base_holes: 4, lightening_cuts: 2, ribs: 2 } },

  { i: 7, name: 'radial-engine-cylinder',
    prompt: 'Radial-engine cylinder: barrel diameter 36 x 70 mm, axis +Z. 12 cooling fins outer diameter 62, 2 mm thick, 5 mm spacing from Z=10 to Z=65. Base flange outer diameter 70 thickness 8 with 6 holes diameter 5 on a 56 mm bolt circle. Top cap diameter 44 x 8. A spark-plug boss diameter 12 x 24 at 35 degrees toward +X with a diameter 5 axial hole. 1 mm fillets. Fused solid.',
    bbox: [70, 70, 86], bodies: 1, b1: null,
    featureCounts: { fins: 12, flange_holes: 6, boss: 1 } },

  { i: 8, name: 'centrifugal-impeller',
    prompt: 'Centrifugal impeller: backplate outer diameter 90 x 6 mm, central hub diameter 26 x 22 mm, a through-bore diameter 8. 12 backward-curved blades 30 degrees apart, from R18 to R43, height 16 mm, about 3 mm thick with roughly a 45 degree curve. Root and edge fillets. Fused solid.',
    bbox: [90, 90, 28], bodies: 1, b1: null,
    featureCounts: { blades: 12, bore: 1 } },

  { i: 9, name: 'spiral-staircase',
    prompt: 'Spiral staircase: 20 wedge treads 4 mm thick, inner R10 to outer R62, 24 degree width, 6 mm rise and 18 degrees rotation per step. Central column diameter 14 x 140 mm. Base disk diameter 90 x 5 mm. A helical handrail tube diameter 5 at R66 from Z=14 to Z=130 over about 360 degrees. 20 balusters diameter 3.',
    bbox: [124, 124, 145], bodies: 1, b1: null,
    featureCounts: { treads: 20, balusters: 20, handrail: 1 } },

  { i: 10, name: 'planetary-gear-stage',
    prompt: 'Planetary gear stage with trapezoidal teeth, lying flat in the XY plane. Sun gear 24 teeth, pitch diameter 48. 3 planet gears 18 teeth, pitch diameter 36, on a R42 circle 120 degrees apart. Ring gear 60 teeth, internal, outer diameter 140. A carrier disk diameter 105 x 4. 3 pins diameter 6 x 14. The gears must NOT be fused: 8 separate solids total.',
    bbox: [140, 140, 14], bodies: 8, b1: null,
    featureCounts: { sun: 1, planets: 3, ring: 1, carrier: 1, pins: 3, teeth_total: 24 + 3 * 18 + 60 } },
];

// ───────────────────────────────────────────────────────────────────────────
//  Fresh-child orchestration (kernel handle counter is process-global)
// ───────────────────────────────────────────────────────────────────────────
function runJobInChild(job) {
  const jobFile = path.join(os.tmpdir(), `ladder_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.json`);
  const outFile = jobFile.replace('.json', '.out.json');
  fs.writeFileSync(jobFile, JSON.stringify(job));
  try {
    const r = spawnSync(process.execPath, [__filename, '--worker', '--job', jobFile, '--out', outFile], {
      stdio: ['ignore', 'ignore', 'inherit'], // discard OCCT stdout chatter; keep stderr
      timeout: 180000,
    });
    if (!fs.existsSync(outFile)) {
      return { ok: false, error: `worker exited ${r.status}${r.signal ? ' (' + r.signal + ')' : ''}` };
    }
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    for (const f of [jobFile, outFile]) if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  }
}

/**
 * Worker: build the emitted calls in a fresh kernel, then determine TERMINAL
 * bodies (produced solid handles never consumed as a handle-arg by a later call)
 * and measure validity + union bbox + summed b1 over them.
 */
async function runWorker(jobFile, outFile) {
  let result;
  try {
    const forge = makeHeadlessForge();
    const { dispatchSequence } = await import(BRIDGE_PATH);
    const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    const calls = job.calls || [];

    const { handles, lastHandle, errors, dispatched } = await dispatchSequence(calls, forge);

    // ── terminal-body detection ────────────────────────────────────────────
    // A produced solid handle is CONSUMED if it appears as an integer argument
    // value in any LATER call (fuse a/b, cut a/b, translate/fillet/chamfer shape,
    // assembly add-instance shape, etc.). Un-consumed produced solids are the
    // terminal bodies = the emitted body count. We collect handles in dispatch
    // order from successful handle-producing calls.
    const producedAt = [];      // [{handle, callIndex}]
    {
      // re-walk dispatched to know which call index produced which handle
      let di = 0;
      for (let ci = 0; ci < calls.length; ci++) {
        const res = dispatched[di++];
        if (!res || !res.ok || res.produces !== 'handle') continue;
        const rr = res.result || {};
        let h = null;
        if (typeof rr.shape === 'number' && rr.shape > 0) h = rr.shape;
        else for (const k of ['shape', 'sketchId', 'instanceId', 'face']) {
          if (typeof rr[k] === 'number' && rr[k] > 0) { h = rr[k]; break; }
        }
        if (h != null) producedAt.push({ handle: h, callIndex: ci });
      }
    }
    const consumed = new Set();
    for (let ci = 0; ci < calls.length; ci++) {
      const args = calls[ci].arguments || calls[ci].args || {};
      for (const v of Object.values(args)) {
        if (typeof v === 'number' && Number.isInteger(v) && v > 0) {
          // mark any produced handle equal to v that was produced BEFORE this call
          for (const p of producedAt) if (p.handle === v && p.callIndex < ci) consumed.add(v);
        }
      }
    }
    // terminal = produced handles not consumed later. Dedup by handle, keep the
    // LAST production of each handle value (a handle id is monotonic & unique here).
    const terminalHandles = [];
    const seen = new Set();
    for (let k = producedAt.length - 1; k >= 0; k--) {
      const h = producedAt[k].handle;
      if (consumed.has(h) || seen.has(h)) continue;
      seen.add(h);
      terminalHandles.push(h);
    }
    terminalHandles.reverse();

    // Measure each terminal body. Gate = ALL terminal bodies individually valid.
    const bodies = [];
    let allValid = terminalHandles.length > 0;
    let unionMin = [Infinity, Infinity, Infinity];
    let unionMax = [-Infinity, -Infinity, -Infinity];
    let b1Sum = 0;
    for (const h of terminalHandles) {
      let v = null, bb = null, bt = null, vol = 0;
      try { v = checkValid(forge, h); } catch (e) { v = { valid: false, raw: { err: String(e) } }; }
      try { const t = tess(forge, h); bb = bboxOf(t); bt = bettiNumbers(t); } catch (e) { /* leave null */ }
      try { vol = forge.massProps(h).volume; } catch { /* ignore */ }
      if (!v || !v.valid) allValid = false;
      if (bb) {
        for (let a = 0; a < 3; a++) {
          if (bb.min[a] < unionMin[a]) unionMin[a] = bb.min[a];
          if (bb.max[a] > unionMax[a]) unionMax[a] = bb.max[a];
        }
      }
      if (bt) b1Sum += bt.b1;
      bodies.push({ handle: h, valid: !!(v && v.valid), bbox: bb, betti: bt, volume: vol });
    }

    const unionBbox = (isFinite(unionMin[0]))
      ? { min: unionMin, max: unionMax,
          size: [unionMax[0] - unionMin[0], unionMax[1] - unionMin[1], unionMax[2] - unionMin[2]] }
      : null;

    // classify error signatures (for honest gap attribution)
    const errStr = JSON.stringify(errors);
    const hasUnknownTool = /unknown tool id/.test(errStr);
    const hasBadHandle = /invalid handle|ShapeRegistry/.test(errStr);
    const hasMissingArg = /missing required arg|required/.test(errStr);

    result = {
      ok: true,
      dispatchedCount: calls.length,
      successfulCalls: dispatched.filter((d) => d && d.ok).length,
      errors,
      errorCount: errors.length,
      hasUnknownTool, hasBadHandle, hasMissingArg,
      lastHandle,
      bodyCount: terminalHandles.length,
      allValid,
      unionBbox,
      b1Sum,
      bodies,
    };
  } catch (e) {
    result = { ok: false, error: e.stack || String(e) };
  }
  fs.writeFileSync(outFile, JSON.stringify(result));
}

// ───────────────────────────────────────────────────────────────────────────
//  Per-task scoring against §2 numeric criteria
// ───────────────────────────────────────────────────────────────────────────
function bboxMatch(gotSize, wantSize, tol = BBOX_TOL) {
  if (!gotSize) return { ok: false, perAxis: [false, false, false], relErr: [1, 1, 1] };
  const relErr = [0, 0, 0];
  const perAxis = [false, false, false];
  for (let a = 0; a < 3; a++) {
    const e = Math.abs(gotSize[a] - wantSize[a]) / Math.max(Math.abs(wantSize[a]), 1e-9);
    relErr[a] = e;
    perAxis[a] = e <= tol;
  }
  return { ok: perAxis.every(Boolean), perAxis, relErr };
}

/**
 * ladder_score in 0..1, weighting the criteria the task actually cares about:
 *   validity 0.40 (hard gate — if invalid, the whole score is 0)
 *   bbox     0.30 (all dims within 8%; partial credit = fraction of axes in tol)
 *   body-cnt 0.20 (exact match = full; else falloff 1/(1+|Δ|))
 *   b1/feat  0.10 (where countable; else neutral 1.0, noted as n/m)
 */
function scoreTask(task, build) {
  if (!build.ok || build.bodyCount === 0) {
    let why = 'no solid body built';
    if (build.hasUnknownTool) why = 'no body — hallucinated a non-existent verb (single-shot asset that does not exist)';
    else if (build.error) why = `no body built (${String(build.error).slice(0, 50)})`;
    else if (build.hasBadHandle) why = 'no body — all calls referenced invalid handles';
    else if (build.hasMissingArg) why = 'no body — calls missing required args';
    return {
      valid: false, bboxRes: { ok: false, perAxis: [false, false, false], relErr: [1, 1, 1] },
      bodyCount: build.bodyCount || 0, b1Got: 0,
      ladder: 0, reason: why,
    };
  }

  const valid = !!build.allValid;
  const bboxRes = bboxMatch(build.unionBbox && build.unionBbox.size, task.bbox);
  const gotBodies = build.bodyCount;
  const b1Got = build.b1Sum;

  // component scores
  const validScore = valid ? 1 : 0;
  const bboxScore = bboxRes.perAxis.filter(Boolean).length / 3;
  const bodyScore = 1 / (1 + Math.abs(gotBodies - task.bodies));
  let featScore = 1, featMeasurable = false;
  if (task.b1 != null) {
    featMeasurable = true;
    featScore = 1 / (1 + Math.abs(b1Got - task.b1)); // hole-loop count via Betti-1
  }

  // hard gate: invalid → 0
  let ladder = 0;
  if (valid) {
    ladder = 0.40 * validScore + 0.30 * bboxScore + 0.20 * bodyScore + 0.10 * featScore;
  }

  // one-line failure reason (most-impactful first)
  const reasons = [];
  if (!valid) reasons.push('INVALID (gate failed: not closed/manifold/oriented)');
  if (gotBodies !== task.bodies) {
    if (task.bodies > 1 && gotBodies < task.bodies)
      reasons.push(`collapsed ${task.bodies} bodies -> ${gotBodies} (fused/lost separate solids)`);
    else if (task.bodies === 1 && gotBodies > 1)
      reasons.push(`failed to fuse -> ${gotBodies} disconnected solids (broken handle/fuse calls)`);
    else reasons.push(`body count ${gotBodies}/${task.bodies}`);
  }
  if (!bboxRes.ok) {
    const worst = bboxRes.relErr.map((e, a) => `${'XYZ'[a]}${(e * 100).toFixed(0)}%`).join(' ');
    reasons.push(`bbox off (${worst})`);
  }
  if (featMeasurable && b1Got !== task.b1)
    reasons.push(`holes b1=${b1Got}/${task.b1}`);
  const reason = reasons.length ? reasons.join('; ') : 'all criteria met';

  return { valid, bboxRes, bodyCount: gotBodies, b1Got, featMeasurable, ladder, reason };
}

// ───────────────────────────────────────────────────────────────────────────
//  Output formatting
// ───────────────────────────────────────────────────────────────────────────
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s; }

// ───────────────────────────────────────────────────────────────────────────
//  Main (orchestrator)
// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const adapter = arg('--adapter') || ADAPTER_DEFAULT;

  // kernel-load probe
  try {
    const forge = makeHeadlessForge();
    if (typeof forge.makeBox(1, 1, 1) !== 'number') throw new Error('makeBox returned no handle');
  } catch (e) {
    console.error('[fatal] native kernel did not load headless:', e.message);
    process.exit(2);
  }
  console.log('Headless kernel loaded OK.');
  console.log(`LADDER PROBE → live model on localhost:8080, adapter="${adapter}" (caps2), temp=0, max_tokens=640.`);
  console.log(`System = CANONICAL_SYSTEM (${CANONICAL_SYSTEM.length} chars). bbox tol = ${(BBOX_TOL * 100).toFixed(0)}%.\n`);

  const rows = [];
  for (const task of TASKS) {
    let calls = [];
    let modelErr = null;
    try {
      const text = await postToModel(CANONICAL_SYSTEM, task.prompt, { adapter, maxTokens: 640 });
      calls = callsFromAssistant(text);
      if (calls.length === 0) modelErr = 'no <tool_call> blocks emitted';
    } catch (e) {
      modelErr = `model request failed: ${e.message}`;
    }

    let build;
    if (modelErr && calls.length === 0) {
      build = { ok: false, bodyCount: 0, error: modelErr };
    } else {
      build = runJobInChild({ calls });
      if (!build.ok && build.bodyCount == null) build.bodyCount = 0;
    }

    const sc = scoreTask(task, build);
    rows.push({ task, calls, build, sc });
    // progress line to stderr so the final table is clean
    process.stderr.write(`  [${task.i}] ${pad(task.name, 24)} calls=${padL(calls.length, 2)} ` +
      `valid=${sc.valid ? 'Y' : 'N'} bodies=${sc.bodyCount}/${task.bodies} score=${sc.ladder.toFixed(2)}\n`);
  }

  // ── SCORECARD ──────────────────────────────────────────────────────────
  console.log('=== LADDER SCORECARD (caps2 = adapters/archie/hermes_forge, live :8080) ===\n');
  const H = ['task', 'name', '#calls', 'valid', 'bbox', 'body g/w', 'b1 g/w', 'score', 'failure reason'];
  const W = [4, 24, 6, 5, 5, 9, 8, 6, 52];
  console.log(H.map((h, i) => pad(h, W[i])).join(' '));
  console.log('-'.repeat(W.reduce((a, b) => a + b + 1, 0)));
  for (const { task, calls, sc } of rows) {
    const b1cell = task.b1 != null ? `${sc.b1Got}/${task.b1}` : `${sc.b1Got}/-`;
    console.log([
      padL(task.i, W[0]),
      pad(task.name, W[1]),
      padL(calls.length, W[2]),
      pad(sc.valid ? 'Y' : 'N', W[3]),
      pad(sc.valid ? (sc.bboxRes.ok ? 'Y' : 'N') : '-', W[4]),
      pad(`${sc.bodyCount}/${task.bodies}`, W[5]),
      pad(b1cell, W[6]),
      pad(sc.ladder.toFixed(2), W[7]),
      pad(sc.reason, W[8]),
    ].join(' '));
  }

  // ── MEAN ───────────────────────────────────────────────────────────────
  const mean = rows.reduce((a, r) => a + r.sc.ladder, 0) / rows.length;
  console.log('\n' + '-'.repeat(W.reduce((a, b) => a + b + 1, 0)));
  console.log(`MEAN ladder_score = ${mean.toFixed(3)}  (over ${rows.length} tasks)`);

  // ── DIFFICULTY CLIFF ─────────────────────────────────────────────────────
  // "Starts failing" = first task whose ladder_score drops below a pass bar AND
  // does not recover to a pass on the very next task (i.e. sustained failure).
  const PASS = 0.70;
  let cliff = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sc.ladder < PASS) {
      const next = rows[i + 1];
      if (!next || next.sc.ladder < PASS) { cliff = rows[i].task.i; break; }
    }
  }
  // simple "first below bar" for reference
  const firstBelow = rows.find((r) => r.sc.ladder < PASS);
  console.log('\n=== DIFFICULTY CLIFF ===');
  console.log(`pass bar = ${PASS.toFixed(2)} ladder_score.`);
  console.log(`first task below bar : ${firstBelow ? `#${firstBelow.task.i} (${firstBelow.task.name}, ${firstBelow.sc.ladder.toFixed(2)})` : 'none — all pass'}`);
  console.log(`SUSTAINED CLIFF at   : ${cliff != null ? `task #${cliff} (${TASKS[cliff - 1].name})` : 'none — model holds across the ladder'}`);
  const lastPass = [...rows].reverse().find((r) => r.sc.ladder >= PASS);
  console.log(`highest task passed  : ${lastPass ? `#${lastPass.task.i} (${lastPass.task.name})` : 'none'}`);

  // ── CAPABILITY GAPS (prioritized) ────────────────────────────────────────
  console.log('\n=== PRIORITIZED CAPABILITY GAPS ===');
  const gaps = [];
  // tally evidence across tasks
  let invalidCount = 0, multibodyCollapse = 0, bboxFails = 0, holeFails = 0, noBody = 0;
  let disconnectedFails = 0, hallucinatedVerb = 0, brokenHandle = 0;
  let everPattern = false, everHelical = false, everRevolve = false;
  const verbHist = {};
  for (const { task, calls, sc, build } of rows) {
    if (build.bodyCount === 0) noBody++;
    if (build.hasUnknownTool) hallucinatedVerb++;
    if (build.hasBadHandle || build.hasMissingArg) brokenHandle++;
    if (!sc.valid) invalidCount++;
    if (task.bodies > 1 && sc.bodyCount < task.bodies) multibodyCollapse++;
    if (task.bodies === 1 && sc.bodyCount > 1) disconnectedFails++;
    if (sc.valid && !sc.bboxRes.ok) bboxFails++;
    if (sc.featMeasurable && sc.b1Got !== task.b1) holeFails++;
    for (const c of calls) {
      verbHist[c.name] = (verbHist[c.name] || 0) + 1;
      if (c.name === 'part.circular-pattern' || c.name === 'part.linear-pattern') everPattern = true;
      if (c.name === 'part.revolve') everRevolve = true;
      if (c.name === 'part.pipe' || c.name === 'part.variable-fillet') everHelical = true;
    }
  }
  if (brokenHandle > 0 || disconnectedFails > 0)
    gaps.push(`BROKEN MULTI-STEP COMPOSITION (top defect) — on ${Math.max(brokenHandle, disconnectedFails)}/${rows.length} tasks the model emits boxes/cylinders then fuse/cut calls with WRONG handle ids or missing args, so the booleans fail and the part survives as a pile of disconnected solids instead of one fused body. The model does not track the kernel's monotonic handle counter across steps.`);
  if (hallucinatedVerb > 0)
    gaps.push(`HALLUCINATES NON-EXISTENT ONE-SHOT ASSET VERBS on ${hallucinatedVerb}/${rows.length} tasks (e.g. asset.make-impeller, asset.make-planetary-gear-stage) — on the hardest tasks it invents a single fake tool instead of decomposing into real kernel calls → no body at all.`);
  if (invalidCount > 0)
    gaps.push(`INVALID GEOMETRY (hard-gate fail) on ${invalidCount}/${rows.length} tasks — emits non-watertight/self-intersecting bodies; shells + blind holes + thin walls (task 5 enclosure) break the manifold gate.`);
  if (multibodyCollapse > 0)
    gaps.push(`CANNOT PRODUCE INTENDED MULTI-BODY — task 10 (planetary, 8 separate gears that must NOT be fused) yields 0 bodies; no concept of authoring N distinct un-fused solids.`);
  if (holeFails > 0)
    gaps.push(`WRONG HOLE COUNT (Betti-1 mismatch) on ${holeFails} measurable tasks — fails to emit the required N through-holes / patterned cuts (often cuts never land because of the handle defect above).`);
  if (bboxFails > 0)
    gaps.push(`WRONG OVERALL SIZE (bbox off >8%) on ${bboxFails} otherwise-valid tasks — drops features that set extents, or wrong axis (e.g. stepped shaft built along Z not X → Z extent 415% off).`);
  if (!everPattern)
    gaps.push('NO PATTERNED FEATURES — only 1 linear-pattern across all 10 tasks; never circular-patterns fins/teeth/bolt-circles/treads/blades; produces repeated geometry by hand-placing boxes (which then fail to fuse).');
  if (!everHelical)
    gaps.push('NO HELICAL / SWEPT FEATURES — never emits pipe/sweep for the helical handrail (task 9); curved blades (task 8) are punted to a fake asset verb.');
  // verb diversity note
  const topVerbs = Object.entries(verbHist).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([k, v]) => `${k}:${v}`).join(', ');
  if (gaps.length === 0) gaps.push('No systemic gaps detected at this bar — model holds across the ladder.');
  gaps.forEach((g, i) => console.log(`  ${i + 1}. ${g}`));
  console.log(`\n  verb usage across all 10 tasks: ${topVerbs || '(none)'}`);

  // emitted-verb-per-task appendix (evidence)
  console.log('\n=== EMITTED VERBS PER TASK (evidence) ===');
  for (const { task, calls } of rows) {
    const hist = {};
    for (const c of calls) hist[c.name] = (hist[c.name] || 0) + 1;
    const s = Object.entries(hist).map(([k, v]) => `${k.replace('part.', '').replace('asset.', 'A:')}x${v}`).join(' ');
    console.log(`  [${padL(task.i, 2)}] ${pad(task.name, 24)} ${s || '(no calls)'}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Entry: worker vs orchestrator
// ───────────────────────────────────────────────────────────────────────────
const _argv = process.argv.slice(2);
const _isEntry = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (_argv.includes('--worker')) {
  const jobFile = _argv[_argv.indexOf('--job') + 1];
  const outFile = _argv[_argv.indexOf('--out') + 1];
  runWorker(jobFile, outFile).catch((e) => {
    try { fs.writeFileSync(outFile, JSON.stringify({ ok: false, error: e.stack || String(e) })); } catch { /* ignore */ }
    process.exit(1);
  });
} else if (_isEntry) {
  main().catch((e) => { console.error('[ladder_probe error]', e.stack || e); process.exit(1); });
}
