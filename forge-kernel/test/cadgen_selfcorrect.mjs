// cadgen_selfcorrect.mjs — kernel-verified self-correction loop.
//
// Hypothesis: SFT is exhausted single-shot (6× confirmed), but the model can fix
// its own errors when the KERNEL measures the build and feeds the mismatch back.
// This is the agentic "harness the kernel" direction and needs NO retrain.
//
// Per case: spec -> model -> calls -> kernel build+MEASURE (Betti/bbox/vol) ->
// compare to the reference snapshot -> if wrong, feed the DELTA back -> model
// re-emits corrected calls -> rebuild -> ... up to N rounds. We log whether the
// Betti (topology — the binding-weak dim, 0.668) and validity converge over rounds.
//
// GT-free in spirit: the feedback is the kernel's ground-truth MEASUREMENT of the
// model's OWN build; here we ALSO compare to the proxy reference purely to SCORE
// whether the loop works (the reference is NOT shown to the model).
//
// Usage: node test/cadgen_selfcorrect.mjs --adapter <path> [--system-file <f>]
//        [--cases hole-plate-center,pattern-grid,shell-box] [--rounds 3]
//        [--port 8080] [--max-tokens 1200]

import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runJobInChild, callsFromAssistant } from './cadscore_harness.mjs';
import { GEN_CASES } from './cadgenbench_set.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ADAPTER = arg('--adapter', null);
const SYSTEM_FILE = arg('--system-file', null);
const ROUNDS = parseInt(arg('--rounds', '3'), 10);
const PORT = parseInt(arg('--port', '8080'), 10);
const MAXTOK = parseInt(arg('--max-tokens', '1200'), 10);
const TARGET = (arg('--cases', 'hole-plate-center,pattern-grid,shell-box,prim-cone,fillet-block') || '').split(',').filter(Boolean);

// system prompt: reasoning corpus prompt if given, else live HERMES from ForgeRunner
function loadSystem() {
  if (SYSTEM_FILE) return fs.readFileSync(SYSTEM_FILE, 'utf8');
  const runner = path.resolve(__dirname, '../../frontend/src/ai/ForgeRunner.js');
  const src = fs.readFileSync(runner, 'utf8');
  const m = src.match(/const HERMES_FORGE_SYSTEM\s*=\s*\n`([\s\S]*?)`;/);
  if (!m) throw new Error('could not extract HERMES_FORGE_SYSTEM');
  return m[1];
}

function postChat(messages) {
  return new Promise((resolve, reject) => {
    const payload = { messages, max_tokens: MAXTOK, temperature: 0 };
    if (ADAPTER) payload.adapters = ADAPTER;
    const body = JSON.stringify(payload);
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 180000 },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body); req.end();
  });
}

const bstr = (b) => b ? `b0=${b.b0} b1=${b.b1} b2=${b.b2}` : 'b?';
const bEq = (a, b) => a && b && a.b0 === b.b0 && a.b1 === b.b1 && a.b2 === b.b2;
const bbstr = (bb) => bb ? `${Math.round(bb.max[0]-bb.min[0])}×${Math.round(bb.max[1]-bb.min[1])}×${Math.round(bb.max[2]-bb.min[2])}mm` : 'bbox?';
const volOk = (m, g) => g > 0 && Math.abs(m - g) / g < 0.08;   // within 8% by volume
const geomMatch = (meas, gt) => meas.valid && bEq(meas.betti, gt.betti) && volOk(meas.volume, gt.volume);

async function buildMeasure(calls) {
  if (!calls || !calls.length) return { ok: false, valid: false, betti: null, vol: 0, bbox: null, nCalls: 0 };
  const r = await runJobInChild({ op: 'buildexport', calls, outPath: `/tmp/sc_${Date.now()}.step` });
  return { ok: !!r.ok, valid: !!r.valid, betti: r.betti, vol: r.bbox ? (r.volume ?? r.vol ?? 0) : 0,
           volume: r.volume ?? r.vol ?? 0, bbox: r.bbox, nCalls: calls.length };
}

// GT-FREE feedback: only the kernel's measurement of the model's OWN build + the
// spec the model already has + generic error guidance. NO reference/target numbers.
function feedback(meas, gt, spec) {
  const holes = meas.betti ? meas.betti.b1 / 2 : 0;
  const L = [];
  L.push('KERNEL CHECK — I built your tool-calls and measured the ACTUAL solid you produced:');
  L.push(`  valid=${meas.valid}; through-holes=${holes} (b1=${meas.betti?.b1}); enclosed-voids=${meas.betti?.b2}; volume=${Math.round(meas.volume)} mm³; bounding size=${bbstr(meas.bbox)}.`);
  L.push('Now RE-READ YOUR SPEC and compare it to that measurement. If they disagree, your calls are wrong. Common causes + fixes:');
  L.push(' • A subtract that produced 0 (or too few) through-holes, or barely changed the volume, is MIS-POSITIONED — it landed at a corner/edge instead of penetrating. FIX: give EVERY subtract an explicit centre position at:[cx,cy,z]; for a feature centred on an L×W face that is at:[L/2,W/2,0].');
  L.push(' • A bounding size or volume that does not match the spec mm values = wrong primitive DIMENSIONS — re-emit with the exact numbers from the spec.');
  L.push(' • A truncated/tapered cone is ONE primitive with two radii (part.make-cone r1=baseDia/2, r2=topDia/2, h), NOT a full cone minus another cone.');
  L.push('Emit ONLY corrected <tool_call>s for the COMPLETE part, every feature with an explicit at:[...] and exact dimensions.');
  L.push(`SPEC: ${spec}`);
  return L.join('\n');
}

(async () => {
  const system = loadSystem();
  console.log(`self-correct loop — adapter=${ADAPTER} rounds=${ROUNDS} system=${SYSTEM_FILE ? 'reason' : 'hermes'} cases=${TARGET.join(',')}`);
  const summary = [];
  for (const id of TARGET) {
    const cs = GEN_CASES.find((c) => c.id === id);
    if (!cs) { console.log(`\n[${id}] NOT FOUND`); continue; }
    // reference snapshot (NOT shown to the model) — label nests under .gt
    const gtRaw = await runJobInChild({ op: 'label', calls: cs.referenceCalls });
    const g = gtRaw.gt || {};
    const gt = { betti: g.betti, volume: g.volume ?? 0, bbox: g.bbox };
    if (!gt.betti) { console.log(`\n[${id}] reference build failed — skip`); continue; }
    console.log(`\n===== ${id} =====  reference ${bstr(gt.betti)} vol≈${Math.round(gt.volume)}`);
    const messages = [{ role: 'system', content: system }, { role: 'user', content: cs.prompt }];
    let bestRound = -1, converged = false, rounds = [];
    for (let r = 0; r < ROUNDS; r++) {
      const resp = await postChat(messages);
      const msg = resp?.choices?.[0]?.message ?? {};
      const text = msg.content ?? '';
      // calls arrive EITHER as <tool_call> text tags OR (what this serve does) as
      // structured message.tool_calls[].function{name,arguments:JSONstr}
      let calls = callsFromAssistant(text);
      if (!calls.length && Array.isArray(msg.tool_calls)) {
        calls = msg.tool_calls.map((t) => {
          let a = t.function?.arguments ?? {};
          if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = {}; } }
          return { name: t.function?.name, arguments: a };
        }).filter((c) => c.name);
      }
      const meas = await buildMeasure(calls);
      const match = geomMatch(meas, gt);
      rounds.push({ r, nCalls: meas.nCalls, valid: meas.valid, betti: bstr(meas.betti), bettiMatch: bEq(meas.betti, gt.betti), volOk: volOk(meas.volume, gt.volume), match });
      console.log(`  round ${r}: nCalls=${meas.nCalls} valid=${meas.valid} ${bstr(meas.betti)} bettiMatch=${bEq(meas.betti, gt.betti)} vol≈${Math.round(meas.volume)} volOk=${volOk(meas.volume, gt.volume)} GEOM=${match}`);
      if (match) { converged = true; bestRound = r; break; }
      // faithful assistant turn = text + the calls rendered as tags (so the model sees what it emitted)
      const asst = text + '\n' + calls.map((c) => `<tool_call>${JSON.stringify(c)}</tool_call>`).join('\n');
      messages.push({ role: 'assistant', content: asst }, { role: 'user', content: feedback(meas, gt, cs.prompt) });
    }
    summary.push({ id, converged, atRound: bestRound, round0Match: rounds[0]?.match || false, rounds });
  }
  console.log('\n===== SELF-CORRECTION SUMMARY =====');
  let fixed = 0, already = 0;
  for (const s of summary) {
    if (s.round0Match) already++;
    else if (s.converged) fixed++;
    console.log(`  ${s.id.padEnd(20)} round0=${s.round0Match ? 'OK' : 'wrong'} -> ${s.converged ? `CONVERGED@round${s.atRound}` : 'still-wrong'}`);
  }
  console.log(`\n  ${already} already-correct, ${fixed} FIXED-by-loop, ${summary.length - already - fixed} still-wrong (of ${summary.length})`);
  console.log(`  VERDICT: kernel-feedback self-correction ${fixed > 0 ? 'WORKS — fixed ' + fixed + ' previously-wrong case(s)' : 'did NOT fix the failing cases'}`);
  fs.writeFileSync('/tmp/selfcorrect_summary.json', JSON.stringify(summary, null, 2));
})().catch((e) => { console.error('[selfcorrect fatal]', e.message); process.exit(1); });
