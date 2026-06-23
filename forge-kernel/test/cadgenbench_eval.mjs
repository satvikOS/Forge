#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  cadgenbench_eval.mjs — CADGenBench end-to-end EVAL HARNESS (Task #15, inc.1)
//
//  REAL, no mocks: drives the LIVE v3 serve (http://127.0.0.1:8080), parses the
//  model's tool-calls (both <tool_call> tags AND OpenAI-structured tool_calls),
//  DISPATCHES them against the native forge-kernel.node via the ForgeToolBridge
//  verb registry to build the model's body, tessellates it, replays a deterministic
//  reference build for the same prompt, and scores both through ForgeCADScore's 5
//  axes (gate · shape · interface · topology · dimL1). Each case is built+scored in
//  a FRESH child node process (the native handle counter is process-global with no
//  reset), so two cases never collide.
//
//  Aggregation: per-dimension MEAN across the set, the WORST-DIMENSION MIN (the
//  ≥0.85-on-all-dims mission gate is min-over-dimension MEANS), the overall CADGenBench
//  scalar (0.4·shape + 0.4·interface + 0.2·topology, gated by validity), the weakest
//  dimension, and the lowest-scoring cases — so the next increment knows what to fix.
//
//  Usage:
//    node forge-kernel/test/cadgenbench_eval.mjs [--adapter <id>] [--max-tokens N]
//                                                [--replay] [--limit N] [--edit-only] [--gen-only]
//    --replay  : dispatch each case's referenceCalls AS the model output (no serve)
//                → discrimination floor; must score ≈1.0 on every axis.
//
//  Exit: 0 if the worst-dimension MEAN ≥ GATE (default 0.85), else 1. This is a
//  MEASUREMENT increment — a non-zero exit is the honest expected baseline, not a bug.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  runJobInChild, callsFromAssistant, surfaceF1, volumeIoU, bboxDiag,
} from './cadscore_harness.mjs';
import { GEN_CASES, EDIT_CASES } from './cadgenbench_set.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..', '..');
const FORGE_RUNNER = path.resolve(REPO, 'frontend', 'src', 'ai', 'ForgeRunner.js');

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getFlag = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);
const ADAPTER = getFlag('--adapter', null);          // mlx_lm.server per-request LoRA; null → base served model
const MAX_TOKENS = parseInt(getFlag('--max-tokens', '700'), 10);
const HOST = getFlag('--host', '127.0.0.1');
const PORT = parseInt(getFlag('--port', '8080'), 10);
const REPLAY = has('--replay');
const LIMIT = getFlag('--limit', null) ? parseInt(getFlag('--limit'), 10) : null;
const OFFSET = parseInt(getFlag('--offset', '0'), 10) || 0;
const EDIT_ONLY = has('--edit-only');
const GEN_ONLY = has('--gen-only');
const GATE = parseFloat(getFlag('--gate', '0.85'));
const SOTA = 0.45;   // public CADGenBench SOTA reference — UNVERIFIED (see CADGENBENCH_SPEC.md)

// ─────────────────────────────────────────────────────────────────────────────
//  1. LIVE system prompt — extract HERMES_FORGE_SYSTEM from ForgeRunner.js so the
//     eval prompt is BYTE-IDENTICAL to what the headed app sends. Refuse the old
//     "lead" variant (train≠inference would invalidate every score).
// ─────────────────────────────────────────────────────────────────────────────
function loadLiveSystem() {
  const src = fs.readFileSync(FORGE_RUNNER, 'utf8');
  const m = src.match(/const HERMES_FORGE_SYSTEM\s*=\s*\n`([\s\S]*?)`;/);
  if (!m) throw new Error(`could not extract HERMES_FORGE_SYSTEM from ${FORGE_RUNNER}`);
  const sys = m[1];
  if (!sys.includes('No prose outside the tags')) {
    throw new Error('extracted system prompt missing the no-lead sentinel "No prose outside the tags"');
  }
  if (sys.includes('Begin with exactly ONE brief')) {
    throw new Error('extracted system prompt is the OLD lead variant — refusing (train≠inference)');
  }
  return sys;
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. Drive the live model — dual-transport tool-call parse.
//     Returns { calls, raw, transport, error }. Handles:
//       (a) <tool_call>{…}</tool_call> tags (Hermes-style)  via callsFromAssistant
//       (b) message.tool_calls[].function {name, arguments:JSONstr} (OpenAI structured)
//       (c) bare {"name":…,"arguments":…} JSON objects in the text (fallback)
// ─────────────────────────────────────────────────────────────────────────────
function postRaw(systemStr, userStr) {
  return new Promise((resolve, reject) => {
    const payload = {
      messages: [
        { role: 'system', content: systemStr },
        { role: 'user', content: userStr },
      ],
      max_tokens: MAX_TOKENS,
      temperature: 0,   // reproducible scoring
    };
    if (ADAPTER) payload.adapters = ADAPTER;
    const body = JSON.stringify(payload);
    const req = http.request(
      { host: HOST, port: PORT, path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000 },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`bad JSON from serve (HTTP ${res.statusCode}): ${e.message}`)); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('model request timed out')));
    req.write(body);
    req.end();
  });
}

function parseBareJsonCalls(text) {
  // Pull every top-level {...} that has a "name" and "arguments" key.
  const calls = [];
  const re = /\{[^{}]*"name"\s*:\s*"[^"]+"[\s\S]*?\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // greedily extend to a balanced brace from m.index
    let depth = 0, end = -1;
    for (let i = m.index; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) continue;
    const chunk = text.slice(m.index, end);
    try {
      const o = JSON.parse(chunk);
      if (o && typeof o.name === 'string' && o.arguments && typeof o.arguments === 'object') calls.push(o);
    } catch { /* skip */ }
    re.lastIndex = end;
  }
  return calls;
}

async function driveModel(liveSystem, prompt) {
  let resp;
  try { resp = await postRaw(liveSystem, prompt); }
  catch (e) { return { calls: [], raw: '', transport: 'error', error: e.message }; }

  const msg = resp?.choices?.[0]?.message ?? {};
  const text = msg.content ?? '';

  // (a) <tool_call> tags (canonical Hermes-Forge format)
  let calls = callsFromAssistant(text);
  let transport = calls.length ? 'tool_call' : null;

  // (a2) <tool> tags — the live v3 serve actually emits this shorter variant.
  // Parse it explicitly so the build calls are captured cleanly (and the bare-JSON
  // fallback does not over-grab trailing <plan>/report/simulate.* objects).
  if (!calls.length) {
    const re = /<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const o = JSON.parse(m[1]);
        if (o && typeof o.name === 'string') calls.push({ name: o.name, arguments: o.arguments || {} });
      } catch { /* skip malformed */ }
    }
    if (calls.length) transport = 'tool';
  }

  // (b) structured tool_calls
  if (!calls.length && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    for (const t of msg.tool_calls) {
      const fn = t.function || t;
      if (!fn || !fn.name) continue;
      let args = fn.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      calls.push({ name: fn.name, arguments: args || {} });
    }
    if (calls.length) transport = 'structured';
  }

  // (c) bare-JSON fallback
  if (!calls.length) {
    calls = parseBareJsonCalls(text);
    if (calls.length) transport = 'bare-json';
  }

  return { calls, raw: text, transport: transport || 'none', error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
//  3. Label + score helpers — all kernel work in a FRESH child.
// ─────────────────────────────────────────────────────────────────────────────
const zeroScore = (reason) => ({
  cad_score: 0, gate: 0, validity: null, stepRoundTripOk: false,
  shape: 0, interface: 0, topology: 0, dimL1: 0, detail: { reason },
});

function labelCase(calls) {
  const res = runJobInChild({ op: 'label', calls });
  return res && res.ok && res.gt ? res.gt : null;
}

function scoreBuild(modelCalls, gt, features) {
  // gt must carry tessSnapshot (from labelCase). Score the model's build vs gt.
  const res = runJobInChild({ op: 'score', calls: modelCalls, emittedCalls: modelCalls, gt, features: features || [] });
  if (!res) return zeroScore('child returned nothing');
  if (res.ok && res.score) return res.score;
  return res.score || zeroScore(res.error || 'child failed');
}

function rehydrateTess(gt) {
  if (!gt || !gt.tessSnapshot) return null;
  return {
    positions: Float32Array.from(gt.tessSnapshot.positions),
    indices: Uint32Array.from(gt.tessSnapshot.indices),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  4. Per-case evaluation.
// ─────────────────────────────────────────────────────────────────────────────
async function evalGenCase(c, liveSystem, idx, total) {
  process.stdout.write(`  [${idx}/${total}] ${c.id} (${c.category}) … `);

  // (a) reference ground truth — replay the deterministic reference in a fresh kernel
  const gt = labelCase(c.referenceCalls);
  if (!gt) {
    process.stdout.write('REFERENCE FAILED TO BUILD\n');
    return { ...baseRow(c), error: 'reference build failed', built: false, ...zeroScore('reference build failed') };
  }

  // (b) the model's calls (or the reference itself in --replay floor mode)
  let modelCalls, transport, raw;
  if (REPLAY) { modelCalls = c.referenceCalls; transport = 'replay'; raw = '(replay)'; }
  else {
    const d = await driveModel(liveSystem, c.prompt);
    modelCalls = d.calls; transport = d.transport; raw = d.raw;
    if (d.error) { process.stdout.write(`DRIVE ERROR: ${d.error}\n`); }
  }

  if (!modelCalls || !modelCalls.length) {
    process.stdout.write(`no calls [${transport}]\n`);
    return { ...baseRow(c), transport, nCalls: 0, built: false, ...zeroScore('no tool-calls from model') };
  }

  // (c) dispatch + score in a fresh child
  let s;
  try { s = scoreBuild(modelCalls, gt, c.features); }
  catch (e) { s = zeroScore('score crashed: ' + (e.message || e)); }

  const built = !!s.gate;
  process.stdout.write(`${transport} ${modelCalls.length}call gate=${s.gate ? 'Y' : 'N'} ` +
    `shape=${(s.shape || 0).toFixed(2)} iface=${(s.interface || 0).toFixed(2)} ` +
    `topo=${(s.topology || 0).toFixed(2)} CAD=${(s.cad_score || 0).toFixed(2)}\n`);

  return { ...baseRow(c), transport, nCalls: modelCalls.length, built, raw, ...s,
    validity_axis: s.gate ? 1 : 0 };
}

async function evalEditCase(c, liveSystem, idx, total) {
  process.stdout.write(`  [edit ${idx}/${total}] ${c.id} … `);

  // gt_input (the base / no-op echo) and gt_target (base+edit, the correct answer)
  const gtInput = labelCase(c.inputCalls);
  const gtTarget = labelCase(c.referenceCalls);
  if (!gtInput || !gtTarget) {
    process.stdout.write('REFERENCE FAILED\n');
    return { ...baseRow(c), error: 'edit reference failed', built: false, editing_cad_score: 0,
      shape: 0, interface: 0, topology: 0, validity_axis: 0, sRenorm: 0 };
  }
  // no-op baseline shape = similarity(input, target)
  const aTess = rehydrateTess(gtInput), bTess = rehydrateTess(gtTarget);
  const tauAbs = gtTarget.bbox ? 0.005 * bboxDiag(gtTarget.bbox) : 0.5;
  const volIoU = (aTess && bTess) ? volumeIoU(aTess, bTess) : 1;
  const f1 = (aTess && bTess) ? surfaceF1(aTess, bTess, 8000, tauAbs) : 1;
  const bShape = 0.5 * (f1 + volIoU);

  // drive the model (or replay the reference)
  let modelCalls, transport, raw;
  if (REPLAY) { modelCalls = c.referenceCalls; transport = 'replay'; raw = '(replay)'; }
  else {
    const d = await driveModel(liveSystem, c.prompt);
    modelCalls = d.calls; transport = d.transport; raw = d.raw;
  }
  if (!modelCalls || !modelCalls.length) {
    process.stdout.write(`no calls [${transport}]\n`);
    return { ...baseRow(c), transport, nCalls: 0, built: false, editing_cad_score: 0,
      shape: 0, interface: 0, topology: 0, validity_axis: 0, sRenorm: 0, bShape };
  }

  const s = scoreBuild(modelCalls, gtTarget, c.features);
  const shape = s.shape || 0;
  const sRenorm = bShape >= 1 ? (shape >= 0.999 ? 1 : 0) : Math.max(0, (shape - bShape) / (1 - bShape));
  const editing_cad_score = (s.gate ? 1 : 0) * (0.6 * sRenorm + 0.3 * s.interface + 0.1 * s.topology);
  const built = !!s.gate;
  process.stdout.write(`${transport} ${modelCalls.length}call gate=${s.gate ? 'Y' : 'N'} ` +
    `b=${bShape.toFixed(2)} sRen=${sRenorm.toFixed(2)} EDIT=${editing_cad_score.toFixed(2)}\n`);

  return { ...baseRow(c), transport, nCalls: modelCalls.length, built, raw, bShape,
    shape, interface: s.interface || 0, topology: s.topology || 0, sRenorm,
    editing_cad_score, cad_score: editing_cad_score, validity_axis: s.gate ? 1 : 0 };
}

const baseRow = (c) => ({ id: c.id, category: c.category });

// ─────────────────────────────────────────────────────────────────────────────
//  5. Aggregation + report.
// ─────────────────────────────────────────────────────────────────────────────
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
const f3 = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(3) : String(x));

function reportGen(rows) {
  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log(' GENERATION SCORECARD (per case)');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  const hdr = ['id', 'category', 'tx', 'calls', 'gate', 'valid', 'shape', 'iface', 'topo', 'dimL1', 'CAD'];
  const w = [24, 17, 6, 6, 5, 6, 7, 7, 7, 7, 7];
  console.log(hdr.map((h, i) => pad(h, w[i])).join(''));
  console.log('─'.repeat(w.reduce((a, b) => a + b, 0)));
  for (const r of rows) {
    console.log([
      pad(r.id, w[0]), pad(r.category, w[1]), pad(r.transport || '-', w[2]),
      pad(r.nCalls ?? 0, w[3]), pad(r.gate ? 1 : 0, w[4]),
      pad(r.gate ? 'Y' : 'N', w[5]),
      pad(f3(r.shape || 0), w[6]), pad(f3(r.interface || 0), w[7]),
      pad(f3(r.topology || 0), w[8]), pad(f3(r.dimL1 || 0), w[9]),
      pad(f3(r.cad_score || 0), w[10]),
    ].join(''));
  }

  // per-dimension aggregation (the 4 CADGenBench-gate axes; dimL1 reported separate)
  const DIMS = [
    ['validity', (r) => r.validity_axis || 0],
    ['shape', (r) => r.shape || 0],
    ['interface', (r) => r.interface || 0],
    ['topology', (r) => r.topology || 0],
  ];
  const perMean = {}, perMin = {};
  for (const [name, get] of DIMS) {
    const vals = rows.map(get);
    perMean[name] = mean(vals);
    perMin[name] = Math.min(...vals);
  }
  const dimL1Mean = mean(rows.map((r) => r.dimL1 || 0));
  const overall = mean(rows.map((r) => r.cad_score || 0));
  const builtCount = rows.filter((r) => r.gate).length;

  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log(' PER-DIMENSION AGGREGATE  (gate = MIN over dimension MEANS ≥ ' + GATE.toFixed(2) + ')');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  const dh = ['dimension', 'MEAN', 'MIN(case)', 'vs gate'];
  const dw = [16, 10, 12, 10];
  console.log(dh.map((h, i) => pad(h, dw[i])).join(''));
  console.log('─'.repeat(dw.reduce((a, b) => a + b, 0)));
  for (const [name] of DIMS) {
    const ok = perMean[name] >= GATE;
    console.log([pad(name, dw[0]), pad(f3(perMean[name]), dw[1]), pad(f3(perMin[name]), dw[2]),
      pad(ok ? 'PASS' : 'fail', dw[3])].join(''));
  }
  console.log('─'.repeat(dw.reduce((a, b) => a + b, 0)));
  console.log(pad('dimL1 (diag)', dw[0]) + pad(f3(dimL1Mean), dw[1]) + pad('—', dw[2]) + pad('(not gated)', dw[3]));

  const worstDim = DIMS.map(([n]) => [n, perMean[n]]).sort((a, b) => a[1] - b[1])[0];
  const worstDimMean = worstDim[1];
  const gatePass = worstDimMean >= GATE;

  console.log('\n──────────────────────────────────────────────────────────────────────────────');
  console.log(` OVERALL mean cad_score      = ${f3(overall)}   (CADGenBench scalar: 0.4·shape+0.4·iface+0.2·topo, gated)`);
  console.log(` WORST-DIMENSION mean        = ${f3(worstDimMean)}  [${worstDim[0]}]   ← the binding constraint`);
  console.log(` ≥${GATE.toFixed(2)}-all-dims GATE         = ${gatePass ? 'PASS ✓' : 'FAIL ✗'}`);
  console.log(` vs public SOTA ~${SOTA.toFixed(2)} (UNVERIFIED) : overall is ${overall >= SOTA ? 'above' : 'below'} it`);
  console.log(` Valid builds                = ${builtCount}/${rows.length} (${(100 * builtCount / rows.length).toFixed(0)}%)`);
  console.log(` WEAKEST dimension to fix    = ${worstDim[0]} (mean ${f3(worstDimMean)})`);

  const worst = [...rows].sort((a, b) => (a.cad_score || 0) - (b.cad_score || 0)).slice(0, 6);
  console.log('\n LOWEST-SCORING cases (next-increment targets):');
  for (const r of worst) {
    console.log(`   ${pad(r.id, 24)} CAD=${f3(r.cad_score || 0)}  ` +
      `gate=${r.gate ? 'Y' : 'N'} shape=${f3(r.shape || 0)} iface=${f3(r.interface || 0)} topo=${f3(r.topology || 0)}` +
      `${r.error ? '  [' + r.error + ']' : ''}` +
      `${r.transport === 'none' ? '  [model emitted no calls]' : ''}`);
  }
  return { gatePass, worstDimMean, overall, perMean, perMin, builtCount };
}

function reportEdit(rows) {
  if (!rows.length) return null;
  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log(' EDIT SCORECARD (no-op-renormalized: 0.6·s_renorm + 0.3·iface + 0.1·topo)');
  console.log('══════════════════════════════════════════════════════════════════════════════');
  const hdr = ['id', 'tx', 'calls', 'gate', 'b_shape', 'shape', 's_renorm', 'iface', 'topo', 'EDIT'];
  const w = [22, 7, 6, 5, 9, 8, 9, 8, 7, 8];
  console.log(hdr.map((h, i) => pad(h, w[i])).join(''));
  console.log('─'.repeat(w.reduce((a, b) => a + b, 0)));
  for (const r of rows) {
    console.log([
      pad(r.id, w[0]), pad(r.transport || '-', w[1]), pad(r.nCalls ?? 0, w[2]),
      pad(r.built ? 'Y' : 'N', w[3]), pad(f3(r.bShape || 0), w[4]),
      pad(f3(r.shape || 0), w[5]), pad(f3(r.sRenorm || 0), w[6]),
      pad(f3(r.interface || 0), w[7]), pad(f3(r.topology || 0), w[8]),
      pad(f3(r.editing_cad_score || 0), w[9]),
    ].join(''));
  }
  const meanEdit = mean(rows.map((r) => r.editing_cad_score || 0));
  const built = rows.filter((r) => r.built).length;
  console.log(`\n mean EDIT score = ${f3(meanEdit)}   valid builds = ${built}/${rows.length}`);
  return { meanEdit, built };
}

// ─────────────────────────────────────────────────────────────────────────────
//  main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  CADGenBench end-to-end eval harness — Task #15 increment 1                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

  let liveSystem = null;
  if (!REPLAY) {
    liveSystem = loadLiveSystem();
    console.log(`\n live system prompt : extracted from ForgeRunner.js (${liveSystem.length} chars, no-lead variant ✓)`);
    console.log(` serve              : http://${HOST}:${PORT}  adapter=${ADAPTER || '(base)'}  max_tokens=${MAX_TOKENS}  temp=0`);
  } else {
    console.log('\n MODE: --replay  (dispatch referenceCalls AS the model output — discrimination floor; expect ≈1.0 all dims)');
  }

  let genCases = GEN_ONLY || !EDIT_ONLY ? GEN_CASES : [];
  let editCases = EDIT_ONLY || !GEN_ONLY ? EDIT_CASES : [];
  if (GEN_ONLY) editCases = [];
  if (EDIT_ONLY) genCases = [];
  // --offset N + --limit M select cases [N, N+M) — lets a multi-case run be split
  // into small fresh-serve batches (mlx_lm.server degrades over a long session).
  if (OFFSET) { genCases = genCases.slice(OFFSET); editCases = editCases.slice(OFFSET); }
  if (LIMIT) { genCases = genCases.slice(0, LIMIT); editCases = editCases.slice(0, LIMIT); }

  console.log(`\n test set : ${genCases.length} generation + ${editCases.length} edit cases`);

  // ── generation ──
  const genRows = [];
  if (genCases.length) {
    console.log('\n──── driving generation cases ────');
    for (let i = 0; i < genCases.length; i++) {
      genRows.push(await evalGenCase(genCases[i], liveSystem, i + 1, genCases.length));
    }
  }

  // ── edit ──
  const editRows = [];
  if (editCases.length) {
    console.log('\n──── driving edit cases ────');
    for (let i = 0; i < editCases.length; i++) {
      editRows.push(await evalEditCase(editCases[i], liveSystem, i + 1, editCases.length));
    }
  }

  // ── report ──
  let gen = null;
  if (genRows.length) gen = reportGen(genRows);
  if (editRows.length) reportEdit(editRows);

  console.log('\n══════════════════════════════════════════════════════════════════════════════');
  console.log(` HONEST NOTE: this is a measurement increment. The deliverable is the harness +`);
  console.log(`              the real baseline numbers above, NOT a passing gate. A FAIL here`);
  console.log(`              identifies the weakest axis for the next training increment.`);
  console.log('══════════════════════════════════════════════════════════════════════════════');

  const gatePass = gen ? gen.gatePass : false;
  process.exit(gatePass ? 0 : 1);
}

main().catch((e) => { console.error('\n[eval fatal]', e.stack || e); process.exit(2); });
