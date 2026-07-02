#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  cadgen_mm_pipeline.mjs — MULTIMODAL drawing→CAD pipeline (CADGenBench gen).
//
//  The official CADGenBench generation fixtures are engineering-drawing PNGs with
//  NO input.step — the geometry/dims live ENTIRELY in the drawing. The text→CAD
//  backend (cadgen-v7) can't read drawings. This pipeline bolts a Qwen2.5-VL
//  FRONT-END onto the proven text backend:
//
//      input.png ─[Qwen2.5-VL: extract dimensioned spec]→ TEXT spec
//                ─[cadgen-v7 text→CAD: live HERMES_FORGE_SYSTEM]→ Forge tool-calls
//                ─[native forge-kernel.node dispatch]→ solid body
//                ─[io.exportStep]→ <fixture>/output.step
//
//  SERVE STRATEGY (36 GB box — the two models do NOT co-fit):
//    PHASE 1  load Qwen2.5-VL ALONE (~9 GB), extract EVERY spec to a jsonl,
//             then EXIT the python process → GPU freed.
//    PHASE 2  boot mlx_lm.server with the 14B-4bit + cadgen-v7 adapter (~9 GB),
//             drive each spec, build+export in a FRESH child kernel per fixture
//             (the native handle counter is process-global), then kill the serve.
//  Sequential, never co-resident. This is the documented memory-safe choice.
//
//  Reuses (no new heavy deps):
//    - scripts/cadgen_mm_vlm_extract.py            (PHASE 1 VLM front-end)
//    - forge-kernel/test/cadscore_harness.mjs      (makeHeadlessForge, child build)
//    - frontend/src/ai/ForgeToolBridge.js          (dispatchSequence verb registry)
//    - frontend/src/ai/ForgeRunner.js              (live HERMES_FORGE_SYSTEM — byte-identical)
//    - forge-kernel.node io.exportStep             (STEP writer, already built)
//
//  Usage:
//    node scripts/cadgen_mm_pipeline.mjs --ids 101,110,120,135,140        # verify a few
//    node scripts/cadgen_mm_pipeline.mjs --all                            # produce all 49 output.step
//    node scripts/cadgen_mm_pipeline.mjs --ids 101 --skip-vlm --specs F   # reuse cached specs
//
//  Flags: --ids a,b,c | --all | --adapter <id> | --max-tokens N | --specs <jsonl>
//         --skip-vlm (PHASE 1 already done, reuse --specs) | --skip-build (PHASE 1 only)
//         --models-dir <path> | --data-dir <path> | --out-subdir output.step
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MECH_REPO = path.resolve(__dirname, '..');                       // ~/archdisc-Mech
const MODELS_REPODEFAULT = path.resolve(os.homedir(), 'archdisc-Models');
const HARNESS = path.resolve(MECH_REPO, 'forge-kernel', 'test', 'cadscore_harness.mjs');
const FORGE_RUNNER = path.resolve(MECH_REPO, 'frontend', 'src', 'ai', 'ForgeRunner.js');
const VLM_SCRIPT = path.resolve(__dirname, 'cadgen_mm_vlm_extract.py');

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);
const MODELS_REPO = flag('--models-dir', MODELS_REPODEFAULT);
const DATA_DIR = flag('--data-dir', path.join(MODELS_REPO, 'data', 'cadgenbench-data'));
// mlx_lm.server treats the per-request `adapters` field as a path RELATIVE TO the
// serve's cwd (~/archdisc-Models) — so it must be the full adapters/archie/<id> path,
// exactly as cadgen_eval_v2.sh / cadgenbench_eval.mjs --adapter pass it. The serve is
// booted on the BASE model with NO --adapter-path; the field selects the LoRA per call.
const ADAPTER = flag('--adapter', 'adapters/archie/archie-14b-cadgen-v7-20260625');
const BASE_MODEL = flag('--base-model', 'models/archie-14b-v2-4bit');
const MAX_TOKENS = parseInt(flag('--max-tokens', '900'), 10);
const VLM_MAX_TOKENS = parseInt(flag('--vlm-max-tokens', '1200'), 10);
const OUT_NAME = flag('--out-subdir', 'output.step');
const SKIP_VLM = has('--skip-vlm');
const SKIP_BUILD = has('--skip-build');
const ALL = has('--all');
const PORT = parseInt(flag('--port', '8080'), 10);
const HOST = flag('--host', '127.0.0.1');
const SPECS_FILE = flag('--specs', path.join(os.tmpdir(), 'cadgen_mm_specs.jsonl'));

function selectIds() {
  if (has('--ids')) return flag('--ids', '').split(',').map((s) => s.trim()).filter(Boolean);
  // all generation fixtures = input.png present, input.step absent
  const ids = [];
  for (const name of fs.readdirSync(DATA_DIR).sort()) {
    if (!/^\d+$/.test(name)) continue;
    const d = path.join(DATA_DIR, name);
    if (fs.existsSync(path.join(d, 'input.png')) && !fs.existsSync(path.join(d, 'input.step'))) ids.push(name);
  }
  return ids;
}
const IDS = selectIds();
if (!IDS.length) { console.error('[mm] no fixture ids selected (use --ids or --all)'); process.exit(2); }

// ─────────────────────────────────────────────────────────────────────────────
//  Live system prompt — byte-identical to what the headed app sends (lockstep
//  with the eval harness). Refuse the old "lead" variant.
// ─────────────────────────────────────────────────────────────────────────────
function loadLiveSystem() {
  const src = fs.readFileSync(FORGE_RUNNER, 'utf8');
  const m = src.match(/const HERMES_FORGE_SYSTEM\s*=\s*\n`([\s\S]*?)`;/);
  if (!m) throw new Error(`could not extract HERMES_FORGE_SYSTEM from ${FORGE_RUNNER}`);
  const sys = m[1];
  if (!sys.includes('No prose outside the tags')) throw new Error('system prompt missing no-lead sentinel');
  return sys;
}

// ── tool-call parse (mirrors cadgenbench_eval.driveModel) ─────────────────────
// Handles all four transports the live v3 serve uses:
//   (a) <tool_call>{…}</tool_call> tags     (b2) <tool>{…}</tool> short tags
//   (b) message.tool_calls[] OpenAI-structured  (c) bare balanced {"name":…} JSON
// The structured channel (finish_reason:"tool_calls") is what cadgen-v7 actually
// emits for terse prompts — calls live in msg.tool_calls[], NOT msg.content.
function callsFromMessage(msg) {
  const text = msg?.content ?? '';
  let { calls, transport } = callsFromText(text);
  if (calls.length) return { calls, transport };
  if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length) {
    for (const t of msg.tool_calls) {
      const fn = t.function || t;
      if (!fn || !fn.name) continue;
      let args = fn.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      calls.push({ name: fn.name, arguments: args || {} });
    }
    if (calls.length) return { calls, transport: 'structured' };
  }
  return { calls: [], transport: 'none' };
}

function callsFromText(text) {
  const calls = [];
  // (a) <tool_call>{…}</tool_call>
  let re = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g, m;
  while ((m = re.exec(text)) !== null) {
    try { const o = JSON.parse(m[1]); if (o && o.name) calls.push({ name: o.name, arguments: o.arguments || {} }); } catch { /* skip */ }
  }
  if (calls.length) return { calls, transport: 'tool_call' };
  // (a2) <tool>{…}</tool>
  re = /<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/g;
  while ((m = re.exec(text)) !== null) {
    try { const o = JSON.parse(m[1]); if (o && o.name) calls.push({ name: o.name, arguments: o.arguments || {} }); } catch { /* skip */ }
  }
  if (calls.length) return { calls, transport: 'tool' };
  // (c) bare balanced {"name":…} objects
  re = /\{[^{}]*"name"\s*:\s*"[^"]+"[\s\S]*?\}/g;
  while ((m = re.exec(text)) !== null) {
    let depth = 0, end = -1;
    for (let i = m.index; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) continue;
    try { const o = JSON.parse(text.slice(m.index, end)); if (o && typeof o.name === 'string') calls.push({ name: o.name, arguments: o.arguments || {} }); } catch { /* skip */ }
    re.lastIndex = end;
  }
  return { calls, transport: calls.length ? 'bare-json' : 'none' };
}

function postChat(systemStr, userStr) {
  return new Promise((resolve, reject) => {
    const payload = { messages: [{ role: 'system', content: systemStr }, { role: 'user', content: userStr }],
      max_tokens: MAX_TOKENS, temperature: 0 };
    if (ADAPTER) payload.adapters = ADAPTER;
    const body = JSON.stringify(payload);
    const req = http.request({ host: HOST, port: PORT, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 180000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`bad JSON (HTTP ${res.statusCode}): ${e.message}`)); } }); });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('chat request timed out')));
    req.write(body); req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE 1 — VLM extraction (python, model loaded alone, exits → GPU freed).
// ─────────────────────────────────────────────────────────────────────────────
function runVlmPhase(ids) {
  const venvPy = path.join(MODELS_REPO, '.venv', 'bin', 'python');
  const py = fs.existsSync(venvPy) ? venvPy : 'python3';
  console.log(`\n[PHASE 1] VLM extraction — ${ids.length} fixture(s) via ${py}`);
  console.log(`          model loaded ALONE; writing specs → ${SPECS_FILE}`);
  const args = [VLM_SCRIPT, '--data-dir', DATA_DIR, '--out', SPECS_FILE,
    '--max-tokens', String(VLM_MAX_TOKENS), '--ids', ids.join(',')];
  const r = spawnSync(py, args, { cwd: MODELS_REPO, stdio: 'inherit', timeout: 60 * 60 * 1000 });
  if (r.status !== 0) throw new Error(`VLM phase exited ${r.status}${r.signal ? ' (' + r.signal + ')' : ''}`);
  if (!fs.existsSync(SPECS_FILE)) throw new Error('VLM phase produced no specs file');
}

function loadSpecs() {
  const map = new Map();
  if (!fs.existsSync(SPECS_FILE)) return map;
  for (const line of fs.readFileSync(SPECS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); if (o && o.id) map.set(String(o.id), o); } catch { /* skip */ }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE 2a — boot the cadgen-v7 text serve, wait until /v1/models answers.
// ─────────────────────────────────────────────────────────────────────────────
function bootTextServe() {
  const venvServe = path.join(MODELS_REPO, '.venv', 'bin', 'mlx_lm.server');
  const bin = fs.existsSync(venvServe) ? venvServe : 'mlx_lm.server';
  const adapterPath = path.join('adapters', 'archie', ADAPTER);
  const logFile = path.join(MODELS_REPO, 'logs', 'cadgen_mm_serve.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'a');
  console.log(`\n[PHASE 2] booting text serve — ${BASE_MODEL} + adapter ${ADAPTER}`);
  console.log(`          (mlx_lm.server :${PORT}, log → ${logFile})`);
  // NO --adapter-path at boot: the per-request `adapters` field hot-swaps the LoRA,
  // matching the proven cadgen_eval_v2.sh path. A boot-time --adapter-path would be
  // OVERRIDDEN by the per-request field anyway (and a bad relative path 404s).
  void adapterPath;
  const child = spawn(bin, ['--model', BASE_MODEL,
    '--host', HOST, '--port', String(PORT), '--log-level', 'INFO'],
    { cwd: MODELS_REPO, stdio: ['ignore', out, out], detached: true });
  child.unref();
  return { child, logFile };
}

function ping() {
  return new Promise((resolve) => {
    const req = http.request({ host: HOST, port: PORT, path: '/v1/models', method: 'GET', timeout: 3000 },
      (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitServe(maxMs = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (await ping()) return true; await sleep(2500); }
  return false;
}

// already-running serve check
async function serveAlreadyUp() { return await ping(); }

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE 2b — build one fixture's STEP in a FRESH child kernel via the harness.
//  We reuse runJobInChild's pattern but need exportStep, so we run a tiny inline
//  worker: dispatchSequence(calls) → io.exportStep(lastHandle, outPath) → validity.
// ─────────────────────────────────────────────────────────────────────────────
function buildStepInChild(calls, outStepPath) {
  const worker = `
import { makeHeadlessForge, tess, bboxOf, bettiNumbers, checkValid } from ${JSON.stringify(pathToFileURL(HARNESS).href)};
import fs from 'node:fs';
const BRIDGE = ${JSON.stringify(pathToFileURL(path.resolve(MECH_REPO, 'frontend', 'src', 'ai', 'ForgeToolBridge.js')).href)};
const calls = ${JSON.stringify(calls)};
const outPath = ${JSON.stringify(outStepPath)};
const result = { ok:false };
try {
  const forge = makeHeadlessForge();
  const { dispatchSequence } = await import(BRIDGE);
  const { lastHandle, errors } = await dispatchSequence(calls, forge, { current: null });
  result.errors = errors;
  if (!lastHandle) { result.error = 'no solid body'; }
  else {
    const v = checkValid(forge, lastHandle);
    const t = tess(forge, lastHandle);
    const bb = bboxOf(t);
    const betti = bettiNumbers(t);
    const mp = forge.massProps(lastHandle);
    let exported = false;
    try { exported = !!forge.io.exportStep(lastHandle, outPath); } catch (e) { result.exportError = String(e.message||e); }
    // STEP round-trip validity: re-import what we just wrote.
    let roundTrip = false;
    try { const h2 = forge.io.importStep(outPath); if (typeof h2==='number' && h2>0) roundTrip = checkValid(forge, h2).valid; } catch { /* */ }
    result.ok = true;
    result.exported = exported && fs.existsSync(outPath);
    result.valid = v.valid; result.badFaces = v.badFaces; result.badEdges = v.badEdges;
    result.stepRoundTripOk = roundTrip;
    result.volume = mp.volume; result.area = mp.area;
    result.bbox = { min: bb.min, max: bb.max };
    result.betti = betti;
    result.bytes = result.exported ? fs.statSync(outPath).size : 0;
  }
} catch (e) { result.error = e.stack || String(e); }
process.stdout.write('@@RESULT@@' + JSON.stringify(result) + '@@END@@');
`;
  const tmp = path.join(os.tmpdir(), `mm_build_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.mjs`);
  fs.writeFileSync(tmp, worker);
  try {
    const r = spawnSync(process.execPath, [tmp], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '');
    const m = out.match(/@@RESULT@@([\s\S]*?)@@END@@/);
    if (!m) return { ok: false, error: `worker no result (status ${r.status}); stderr: ${(r.stderr || '').slice(-400)}` };
    return JSON.parse(m[1]);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  MULTIMODAL drawing→CAD pipeline  (CADGenBench generation fixtures)     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(` fixtures : ${IDS.length}  [${IDS.slice(0, 10).join(', ')}${IDS.length > 10 ? ' …' : ''}]`);
  console.log(` data-dir : ${DATA_DIR}`);
  console.log(` adapter  : ${ADAPTER}   base : ${BASE_MODEL}`);
  console.log(` specs    : ${SPECS_FILE}`);

  // PHASE 1 — VLM extraction (skippable if cached).
  if (!SKIP_VLM) runVlmPhase(IDS);
  else console.log('\n[PHASE 1] SKIPPED (--skip-vlm) — reusing cached specs');
  const specs = loadSpecs();
  console.log(`\n specs loaded: ${specs.size} record(s) from ${SPECS_FILE}`);
  const nonEmpty = [...specs.values()].filter((s) => (s.spec || '').length > 40).length;
  console.log(` non-empty specs: ${nonEmpty}/${specs.size}`);

  if (SKIP_BUILD) { console.log('\n[PHASE 2] SKIPPED (--skip-build) — PHASE 1 specs done.'); return; }

  // PHASE 2a — bring up the text serve (skip boot if one is already answering).
  let serveHandle = null;
  if (await serveAlreadyUp()) {
    console.log(`\n[PHASE 2] a serve is already answering on :${PORT} — using it (NOT booting a second).`);
  } else {
    serveHandle = bootTextServe();
    const up = await waitServe();
    if (!up) { console.error(`[PHASE 2] serve did not come up on :${PORT} — see ${serveHandle.logFile}`); process.exit(3); }
    console.log(`[PHASE 2] serve up on :${PORT}`);
  }

  const liveSystem = loadLiveSystem();
  console.log(` live system prompt: ${liveSystem.length} chars (no-lead ✓)`);

  // PHASE 2b — drive each spec → calls → build → output.step.
  const rows = [];
  try {
    for (let i = 0; i < IDS.length; i++) {
      const id = String(IDS[i]);
      const rec = specs.get(id);
      const spec = rec ? (rec.spec || '') : '';
      process.stdout.write(`  [${i + 1}/${IDS.length}] ${id} … `);
      if (!spec || spec.length < 40) { process.stdout.write('NO SPEC from VLM\n'); rows.push({ id, ok: false, reason: 'no spec' }); continue; }

      // Feed the terse VLM build-sentence DIRECTLY as the user prompt — same register
      // as cadgenbench_set prompts. A wrapper like "Reproduce this part…" or a long
      // markdown spec flips cadgen-v7 into explanation mode and it emits NO tool-calls.
      const userPrompt = spec.trim();
      let resp;
      try { resp = await postChat(liveSystem, userPrompt); }
      catch (e) { process.stdout.write(`CHAT ERROR ${e.message}\n`); rows.push({ id, ok: false, reason: 'chat error: ' + e.message }); continue; }
      const msg = resp?.choices?.[0]?.message ?? {};
      const { calls, transport } = callsFromMessage(msg);
      if (!calls.length) { process.stdout.write(`no calls [${transport}]\n`); rows.push({ id, ok: false, reason: 'no tool-calls', transport }); continue; }

      const outStep = path.join(DATA_DIR, id, OUT_NAME);
      const b = buildStepInChild(calls, outStep);
      const builtValid = b.ok && b.exported && b.valid;
      process.stdout.write(`${transport} ${calls.length}call → exported=${b.exported ? 'Y' : 'N'} valid=${b.valid ? 'Y' : 'N'} ` +
        `rt=${b.stepRoundTripOk ? 'Y' : 'N'} b0=${b.betti ? b.betti.b0 : '?'} vol=${b.volume ? b.volume.toFixed(0) : '?'} ` +
        `${b.bytes ? (b.bytes / 1024).toFixed(0) + 'KB' : ''}${b.error ? ' ERR:' + b.error.slice(0, 80) : ''}\n`);
      rows.push({ id, ok: builtValid, transport, nCalls: calls.length, exported: b.exported, valid: b.valid,
        stepRoundTripOk: b.stepRoundTripOk, betti: b.betti, volume: b.volume, bbox: b.bbox, bytes: b.bytes,
        outStep, error: b.error, calls, specChars: spec.length });
    }
  } finally {
    if (serveHandle && serveHandle.child && serveHandle.child.pid) {
      console.log(`\n[PHASE 2] stopping the text serve we booted (pid ${serveHandle.child.pid})`);
      try { process.kill(-serveHandle.child.pid, 'SIGTERM'); } catch { try { process.kill(serveHandle.child.pid, 'SIGTERM'); } catch { /* */ } }
    }
  }

  // ── report ──
  const built = rows.filter((r) => r.exported).length;
  const validC = rows.filter((r) => r.valid).length;
  const rt = rows.filter((r) => r.stepRoundTripOk).length;
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(' MULTIMODAL PIPELINE RESULT');
  console.log('══════════════════════════════════════════════════════════════════════');
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(6)} ${(r.ok ? 'VALID-STEP' : (r.exported ? 'built/invalid' : 'FAILED')).padEnd(14)}` +
      ` calls=${r.nCalls ?? 0} valid=${r.valid ? 'Y' : 'N'} rt=${r.stepRoundTripOk ? 'Y' : 'N'}` +
      ` b0=${r.betti ? r.betti.b0 : '-'}${r.reason ? '  (' + r.reason + ')' : ''}`);
  }
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(` exported output.step : ${built}/${rows.length}`);
  console.log(` VALID solids         : ${validC}/${rows.length}`);
  console.log(` STEP round-trip OK   : ${rt}/${rows.length}`);
  console.log(`\n NOTE: ground truth is PRIVATE — we can only verify build-VALIDITY + plausibility`);
  console.log(`       locally, NOT the 4-dim CADGenBench score (shape/iface/topo vs GT).`);

  // machine-readable dump
  const dump = path.join(os.tmpdir(), 'cadgen_mm_result.json');
  fs.writeFileSync(dump, JSON.stringify({ fixtures: IDS, rows, built, validC, rt }, null, 2));
  console.log(`\n [json] ${dump}`);
}

main().catch((e) => { console.error('\n[mm fatal]', e.stack || e); process.exit(2); });
