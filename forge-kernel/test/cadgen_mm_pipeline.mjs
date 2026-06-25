// ─────────────────────────────────────────────────────────────────────────────
// cadgen_mm_pipeline.mjs — multimodal drawing→CAD backend stage (CORRECTED harness)
//
// Stage 2 of the official-CADGenBench pipeline: VLM-extracted spec → cadgen-v7
// (text→CAD backend) → Forge tool-calls → kernel build → validity + STEP export.
// (Stage 1, drawing→spec via Qwen2.5-VL, runs separately and writes the specs jsonl.)
//
// CORRECTED HARNESS (the prior pipeline's "0 tool-calls" was a harness bug):
//   • serve started WITH --adapter-path (adapter baked) → do NOT pass per-request
//     `adapters` (that 404s against an --adapter-path serve → empty content)
//   • the HERMES_FORGE_SYSTEM system prompt is MANDATORY (without it the model
//     emits generic JS pseudo-code, not <plan>/<tool_call>)
//   • imperative wrapper rescues the hardest multi-feature specs (A-raw 0 → 14)
//
// Ground truth for the official fixtures is PRIVATE, so locally we verify only
// build-VALIDITY + STEP round-trip (the 4-dim score comes from leaderboard submit).
//
// Run: node cadgen_mm_pipeline.mjs --specs /tmp/cadgen_mm_specs.jsonl \
//        --out ../cadgenbench_deliverables/multimodal
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runJobInChild, callsFromAssistant } from './cadscore_harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SPECS = arg('--specs', '/tmp/cadgen_mm_specs.jsonl');
const OUT = path.resolve(__dirname, arg('--out', '../cadgenbench_deliverables/multimodal'));
const PORT = parseInt(arg('--port', '8080'), 10), HOST = '127.0.0.1';
const FORGE_RUNNER = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'ai', 'ForgeRunner.js');

function liveSystem() {
  const src = fs.readFileSync(FORGE_RUNNER, 'utf8');
  const m = src.match(/const HERMES_FORGE_SYSTEM\s*=\s*\n`([\s\S]*?)`;/);
  if (!m) throw new Error('no HERMES_FORGE_SYSTEM in ForgeRunner.js');
  return m[1];
}
function post(systemStr, userStr) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ messages: [{ role: 'system', content: systemStr },
      { role: 'user', content: userStr }], max_tokens: 1200, temperature: 0 });  // NO `adapters` (baked via --adapter-path)
    const req = http.request({ host: HOST, port: PORT, path: '/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 180000 },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  });
}
function extractCalls(text) {
  let calls = callsFromAssistant(text);                    // <tool_call>{…}</tool_call>
  if (!calls.length) {                                     // <tool>{…}</tool> short variant
    const re = /<tool>\s*(\{[\s\S]*?\})\s*<\/tool>/g; let m;
    while ((m = re.exec(text)) !== null) { try { const o = JSON.parse(m[1]); if (o && o.name) calls.push({ name: o.name, arguments: o.arguments || {} }); } catch {} }
  }
  return calls;
}
async function driveBackend(sys, spec) {
  // A-raw first; if 0 calls, fall back to the imperative wrapper (rescues hard specs).
  for (const user of [spec, `Build this part in Forge. Emit ONLY tool-calls (no prose). Part: ${spec}`]) {
    let r; try { r = await post(sys, user); } catch (e) { return { calls: [], err: e.message }; }
    const text = r?.choices?.[0]?.message?.content ?? '';
    const calls = extractCalls(text);
    if (calls.length) return { calls, variant: user === spec ? 'A-raw' : 'B-imper', textLen: text.length };
  }
  return { calls: [], variant: 'none' };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const sys = liveSystem();
  const specs = fs.readFileSync(SPECS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  console.log(`[mm] ${specs.length} specs → backend (cadgen-v7, corrected harness) → build → STEP\n`);
  const rows = [];
  for (const s of specs) {
    const id = String(s.id ?? s.fixture ?? '?');
    const spec = s.spec ?? s.text ?? '';
    process.stdout.write(`  ${id} … `);
    const d = await driveBackend(sys, spec);
    if (!d.calls.length) { console.log(`NO CALLS (${d.err || 'empty'})`); rows.push({ id, calls: 0, valid: false, stepOk: false }); continue; }
    const outPath = path.join(OUT, `${id}.step`);
    const r = runJobInChild({ op: 'buildexport', calls: d.calls, outPath });
    const valid = !!r.valid, stepOk = !!r.stepOk;
    const b = r.betti ? `b0=${r.betti.b0} b1=${r.betti.b1} b2=${r.betti.b2}` : 'b=-';
    console.log(`${d.variant} ${d.calls.length}call valid=${valid ? 'Y' : 'N'} step=${stepOk ? 'Y' : 'N'} ${b} vol=${r.volume ? r.volume.toFixed(0) : '-'}`);
    rows.push({ id, variant: d.variant, calls: d.calls.length, valid, stepOk, betti: r.betti, volume: r.volume, outPath: stepOk ? outPath : null });
  }
  const built = rows.filter(r => r.valid).length, stepped = rows.filter(r => r.stepOk).length;
  console.log(`\n[mm] valid solids ${built}/${rows.length} · STEP exported ${stepped}/${rows.length}`);
  fs.writeFileSync(path.join(OUT, 'mm_pipeline_results.json'), JSON.stringify({ specs: SPECS, rows, built, stepped }, null, 2));
  console.log(`[mm] results + STEP files → ${OUT}`);
})();
