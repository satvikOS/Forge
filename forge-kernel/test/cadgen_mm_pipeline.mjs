// ─────────────────────────────────────────────────────────────────────────────
// cadgen_mm_pipeline.mjs — multimodal drawing→CAD backend stage (CORRECTED harness)
//
// Stage 2 of the official-CADGenBench pipeline: VLM-extracted spec → cadgen-v7
// (text→CAD backend) → Forge tool-calls → POSITION-DISCIPLINE post-process →
// kernel build → validity + topology + STEP export.
// (Stage 1, drawing→spec via Qwen2.5-VL, runs separately and writes the specs jsonl.)
//
// CORRECTED HARNESS (the prior pipeline's "0 tool-calls" was a harness bug):
//   • serve started WITH --adapter-path (adapter baked) → do NOT pass per-request
//     `adapters` (that 404s against an --adapter-path serve → empty content)
//   • the HERMES_FORGE_SYSTEM system prompt is MANDATORY (without it the model
//     emits generic JS pseudo-code, not <plan>/<tool_call>)
//   • imperative wrapper rescues the hardest multi-feature specs (A-raw 0 → 14)
//
// ─── 2026-06-27 FIDELITY UPGRADE (CPU/code-only; backend = cadgen-v7, NOT retrained) ──
// ROOT CAUSE (proven on multimodal_full3: 28/49 valid but 22 of those have b1=0 —
//   i.e. a VALID solid with NO through-holes): the backend DROPS the explicit
//   at:[cx,cy,z] on single-feature part.subtract → the cylinder cutter sits at the
//   box CORNER (origin) → it only clips a quarter of the bore → no through-hole →
//   topology (Betti b1) collapses to 0. The corrected corpus (build_cadgen_fixed.mjs)
//   fixes this by EMITTING explicit positions; here we reuse that POSITION DISCIPLINE
//   as a pipeline-level post-process so it works WITHOUT retraining the backend.
//
// THREE CHANGES (this file's whole purpose now):
//   (a) POSITION DISCIPLINE — fillPositions() post-processes the model's tool-calls so
//       every part.subtract/part.add/part.intersect carries an explicit at:[x,y,z]
//       BEFORE the build. Default centre = the base's centre (box: lower corner at the
//       origin ⇒ centre [L/2,W/2]; cylinder/cone: axis-centred ⇒ [0,0]). Box cutters
//       are placed by their lower corner; cutters open the top face for shallow pockets.
//       Clean explicit "(x, y)" coordinates in the spec override the centre default.
//   (b) STRONGER try-both-keep-valid — variants raw / imperative / stepwise /
//       position-explicit (and a material-safe SIMPLIFIED rescue ONLY if all full-spec
//       variants fail to build). Every variant is position-disciplined, built, and the
//       winner is the valid+STEP solid whose Betti best matches the spec's stated
//       feature count (prefers through-holes existing — the dominant failure is b1=0).
//   (c) NO over-aggressive pre-simplify — the FULL spec is always tried first (variants
//       A–D); simplifySpec() is now a material-safe LAST-RESORT variant that never
//       strips a sentence naming a hole/pocket/boss/bore/slot or any dimension. The old
//       behaviour (globally simplify, stripping material detail → lower fidelity) is gone.
//
// Ground truth for the official fixtures is PRIVATE, so locally we verify only
// build-VALIDITY + topology (Betti) + STEP round-trip (the 4-dim score comes from
// leaderboard submit). Use --selfcheck for an offline spec→calls fixture check that
// needs NO model/GPU.
//
// Run (model serve on :PORT must be up — that step happens in a CPT pause, NOT here):
//   node cadgen_mm_pipeline.mjs --specs /tmp/cadgen_mm_specs.jsonl \
//        --out ../cadgenbench_deliverables/multimodal
// Offline check (no model, no GPU):
//   node cadgen_mm_pipeline.mjs --selfcheck            # logic-only
//   node cadgen_mm_pipeline.mjs --selfcheck --build    # also build in the kernel (CPU)
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
// --simplify now only ALLOWS the material-safe SIMPLIFIED rescue variant (last resort).
// It NEVER pre-strips the spec for the primary attempts (full fidelity is always tried).
const ALLOW_SIMPLIFY_RESCUE = !process.argv.includes('--no-simplify-rescue');
const FORGE_RUNNER = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'ai', 'ForgeRunner.js');
const r1 = (x) => Math.round(x * 10) / 10;

// ─────────────────────────────────────────────────────────────────────────────
//  POSITION DISCIPLINE  (the core fidelity fix — mirrors build_cadgen_fixed.mjs +
//  the LIVE kernel dispatcher ForgeToolBridge.buildPrimitive)
//
//  Grounding (ForgeToolBridge.buildPrimitive):
//    • box      → makeBox(dx,dy,dz): LOWER CORNER at origin ⇒ centre (dx/2,dy/2,dz/2).
//                 arg keys dx|width|w , dy|depth|d , dz|height|h|thickness|t.
//    • cylinder → makeCylinder(r,len): AXIS-CENTRED on origin, base z=0.
//                 arg keys diameter|dia|d , depth|height|h|length|len|thickness|t.
//    • cone     → makeCone(r1,r2,h): frustum, base z=0, axis-centred.
//    • at:[x,y,z] is applied as translate(h,x,y,z) AFTER the primitive is built, so a
//      BOX cutter's lower corner lands at (x,y,z) and a CYLINDER/CONE cutter's AXIS
//      lands at (x,y) with base at z. (subtract cutters get a +4mm overhang, auto
//      dropped −2mm, so a through-cut at z=0 pierces both faces.)
// ─────────────────────────────────────────────────────────────────────────────
const numFrom = (a, keys) => { for (const k of keys) if (typeof a[k] === 'number') return a[k]; return undefined; };
const primKind = (a) => String(a?.primitive || a?.prim || 'box').toLowerCase();
const isAxisPrim = (p) => p === 'cylinder' || p === 'cyl' || p === 'hole' || p === 'cone' || p === 'frustum' || p === 'sphere' || p === 'ball';
const isMaterialOp = (name) => name === 'part.subtract' || name === 'part.add' || name === 'part.intersect';
const hasExplicitAt = (a) => Array.isArray(a.at) && a.at.length >= 2 && a.at.slice(0, 3).some((v) => typeof v === 'number' && Number.isFinite(v));

// Identify the call that OPENS the body and return its base frame {centre, top, z0}.
function baseFromCall(c) {
  const a = c.arguments || {};
  let prim = null;
  if (c.name === 'part.begin') prim = primKind(a);
  else if (c.name === 'part.make-box') prim = 'box';
  else if (c.name === 'part.make-cylinder') prim = 'cylinder';
  else if (c.name === 'part.make-cone') prim = 'cone';
  else if (c.name === 'part.make-sphere') prim = 'sphere';
  else return null;
  const at = Array.isArray(a.at) ? a.at : [0, 0, 0];
  const bx = +at[0] || 0, by = +at[1] || 0, bz = +at[2] || 0;
  if (prim === 'box') {
    const L = numFrom(a, ['dx', 'width', 'w']) ?? 10;
    const W = numFrom(a, ['dy', 'depth', 'd']) ?? 10;
    const T = numFrom(a, ['dz', 'height', 'h', 'thickness', 't']) ?? 10;
    return { kind: 'box', L, W, T, cx: bx + L / 2, cy: by + W / 2, z0: bz, top: bz + T };
  }
  if (prim === 'cylinder' || prim === 'cyl' || prim === 'hole') {
    const dia = numFrom(a, ['diameter', 'dia', 'd']);
    const r = dia != null ? dia / 2 : (numFrom(a, ['radius', 'r']) ?? 5);
    const len = numFrom(a, ['depth', 'height', 'h', 'length', 'len', 'thickness', 't']) ?? 10;
    return { kind: 'cyl', OD: r * 2, L: r * 2, W: r * 2, T: len, cx: bx, cy: by, z0: bz, top: bz + len };
  }
  if (prim === 'cone' || prim === 'frustum') {
    const r1v = numFrom(a, ['r1', 'radius1']) ?? (numFrom(a, ['diameter1', 'd1']) != null ? numFrom(a, ['diameter1', 'd1']) / 2 : 5);
    const hh = numFrom(a, ['h', 'height', 'depth', 'length']) ?? 10;
    return { kind: 'cone', OD: r1v * 2, L: r1v * 2, W: r1v * 2, T: hh, cx: bx, cy: by, z0: bz, top: bz + hh };
  }
  if (prim === 'sphere' || prim === 'ball') {
    const dia = numFrom(a, ['diameter', 'dia', 'd']);
    const r = dia != null ? dia / 2 : (numFrom(a, ['radius', 'r']) ?? 5);
    return { kind: 'sphere', OD: r * 2, L: r * 2, W: r * 2, T: r * 2, cx: bx, cy: by, z0: bz - r, top: bz + r };
  }
  return null;
}

// Parse ONLY unambiguous absolute "(x, y)" coordinate pairs that fall on the base
// (best-effort spec-position override; ambiguous "top center"/edge-relative cues are
// intentionally ignored — a wrong position hurts shape/topology more than the safe
// centre default helps). Returns an ordered list of [x,y] in base-frame coordinates.
function parseSpecPositions(spec, base) {
  if (!spec || !base) return [];
  const out = [];
  const re = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  let m;
  // Plate bounds: box spans [0,L]x[0,W]; cyl/cone span [-OD/2,OD/2] about axis.
  const inBounds = (x, y) => {
    if (base.kind === 'box') return x >= 0 && x <= base.L && y >= 0 && y <= base.W;
    const R = (base.OD || 0) / 2 + 1e-6;
    return Math.hypot(x, y) <= R;
  };
  while ((m = re.exec(spec)) !== null) {
    const x = parseFloat(m[1]), y = parseFloat(m[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && inBounds(x, y)) out.push([r1(x), r1(y)]);
  }
  return out;
}

// THE post-processor: ensure every material op carries an explicit, on-base at:[].
// Returns { calls (new array, deep-cloned), base, injections:[…] }.
function fillPositions(calls, specText) {
  const out = calls.map((c) => ({ name: c.name, arguments: { ...(c.arguments || {}) } }));
  const injections = [];
  let base = null;
  for (const c of out) { const b = baseFromCall(c); if (b) { base = b; break; } }
  if (!base) return { calls: out, base: null, injections };       // no base ⇒ cannot derive a centre; leave as-is

  const specPos = parseSpecPositions(specText, base);
  let posCursor = 0;

  // Pre-count at-less AXIS cutters (cyl/cone) with NO spec position so multiple of
  // them fan out on a ring instead of stacking at the exact centre (1 merged hole).
  const atless = [];
  for (let i = 0; i < out.length; i++) {
    if (!isMaterialOp(out[i].name)) continue;
    if (hasExplicitAt(out[i].arguments)) continue;
    atless.push(i);
  }
  const defaultAxisCount = atless.filter((i) => isAxisPrim(primKind(out[i].arguments))).length - Math.min(specPos.length, atless.length);
  const fanOut = specPos.length === 0 && defaultAxisCount > 1;
  let ringIdx = 0;

  for (const i of atless) {
    const c = out[i], a = c.arguments, p = primKind(a);
    const isAdd = c.name === 'part.add';
    let xy = posCursor < specPos.length ? specPos[posCursor++] : null;   // clean explicit coord override
    if (p === 'box') {
      const dx = numFrom(a, ['dx', 'width', 'w']) ?? 10;
      const dy = numFrom(a, ['dy', 'depth', 'd']) ?? 10;
      const dz = numFrom(a, ['dz', 'height', 'h', 'thickness', 't']) ?? 10;
      const cx = xy ? xy[0] : base.cx, cy = xy ? xy[1] : base.cy;
      // box cutter is placed by its LOWER CORNER ⇒ corner = centre − half-size.
      // z: add ⇒ on top; shallow subtract ⇒ open the top face (z = top − dz);
      //    through/deep subtract ⇒ from the base (z0) so it pierces.
      let z;
      if (isAdd) z = base.top;
      else z = (base.kind === 'box' && dz < base.T - 1e-6) ? r1(base.top - dz) : base.z0;
      a.at = [r1(cx - dx / 2), r1(cy - dy / 2), r1(z)];
    } else {
      // axis primitive (cylinder/cone/sphere): the AXIS lands at (cx,cy).
      let cx, cy;
      if (xy) { cx = xy[0]; cy = xy[1]; }
      else if (fanOut && isAxisPrim(p)) {
        const R = Math.min(base.L || base.OD || 20, base.W || base.OD || 20) / 4;
        const ang = (2 * Math.PI * ringIdx) / defaultAxisCount; ringIdx++;
        cx = r1(base.cx + R * Math.cos(ang)); cy = r1(base.cy + R * Math.sin(ang));
      } else { cx = base.cx; cy = base.cy; }
      const z = isAdd ? base.top : base.z0;
      a.at = [r1(cx), r1(cy), r1(z)];
    }
    injections.push({ index: i, op: c.name, primitive: p, at: a.at, source: xy ? 'spec-coord' : (fanOut ? 'ring' : 'centre') });
  }
  return { calls: out, base, injections };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Spec → expected topology (soft variant-selection target). Best-effort count of
//  THROUGH-HOLE features so we can prefer the build whose Betti b1 ≈ 2·holes. VLM
//  specs are noisy ⇒ this is a PREFERENCE, never a hard gate.
// ─────────────────────────────────────────────────────────────────────────────
function expectedHoles(spec) {
  if (!spec) return null;
  const s = spec.toLowerCase();
  let total = 0, matched = false;
  // explicit "b1=N" if the spec states it
  const b1 = s.match(/b1\s*=\s*(\d+)/);
  if (b1) return Math.round(parseInt(b1[1], 10) / 2);
  // "N ... holes" / "N bolt holes" / "N × Ø.. holes" / "N counterbores"
  const countRe = /(\d+)\s*(?:×|x|\bof\b)?\s*[^.]*?\b(through-holes?|bolt holes?|holes?|bores?|counterbores?)\b/g;
  let m;
  while ((m = countRe.exec(s)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 64) { total += n; matched = true; }
  }
  // word-number bolt circles ("four bolt holes")
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
  for (const [w, n] of Object.entries(words)) {
    const re = new RegExp(`\\b${w}\\b[^.]*?\\b(holes?|bolt holes?|bores?)\\b`, 'g');
    if (re.test(s)) { total += n; matched = true; }
  }
  return matched ? total : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Material-safe simplify (LAST-RESORT rescue variant only). Drops a sentence ONLY
//  when it is PURELY edge-cosmetic (fillet/chamfer/thread/radius/draft) with NO
//  material feature word AND no Ø / diameter dimension. Never strips a hole, pocket,
//  bore, boss, slot, rib, flange, step, wall, etc. — those are load-bearing for shape
//  and topology. (The old global pre-simplify that lowered fidelity is removed.)
// ─────────────────────────────────────────────────────────────────────────────
const MATERIAL = /\b(hole|bore|counterbore|countersink|recess|pocket|slot|boss|flange|rib|step|cut|wall|thickness|tab|notch|groove|spigot|lug|web|gusset|standoff|bolt)\b/i;
const HAS_DIM = /[Ø⌀]|\bdiameter\b|\bbolt circle\b|\bdeep\b|\bdepth\b/i;
const EDGE_ONLY = /\b(fillet|chamfer|thread|radius|draft|deburr)\b/i;
function simplifySpec(spec) {
  const sentences = spec.split(/(?<=\.)\s+/).filter(Boolean);
  if (sentences.length <= 1) return spec;
  const out = [sentences[0]];                                   // base shape (always)
  for (let i = 1; i < sentences.length; i++) {
    const s = sentences[i];
    if (MATERIAL.test(s) || HAS_DIM.test(s)) { out.push(s); continue; }   // material / dimensioned ⇒ KEEP
    if (EDGE_ONLY.test(s)) continue;                            // ONLY cosmetic edge detail ⇒ drop
    out.push(s);                                                // anything else ⇒ keep
  }
  return out.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Model plumbing
// ─────────────────────────────────────────────────────────────────────────────
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

// Quality score for variant selection. Valid+STEP is required to win outright; among
// those prefer the Betti that matches the spec's stated hole count, else prefer a
// build that HAS through-holes (the dominant failure is b1=0) and a single body.
function variantScore(rec, exp) {
  if (!(rec.valid && rec.stepOk)) return -Infinity;
  let s = 0;
  const b1 = rec.betti?.b1 ?? 0, b0 = rec.betti?.b0 ?? 1, b2 = rec.betti?.b2 ?? 0;
  if (exp != null && exp > 0) s -= Math.abs(b1 / 2 - exp) * 3;    // match stated through-hole count
  else s += b1 > 0 ? 4 : 0;                                       // else: having through-holes beats b1=0
  s -= Math.max(0, b0 - 1) * 2;                                   // one connected body is normally right
  s += Math.min(b2, 2) * 0.5;                                     // closed solid(s) → real volume
  s += Math.min(rec.calls, 30) * 0.02;                           // tie-break: a touch more detail
  return s;
}

// Build one variant: post-process positions, build in a fresh kernel to its OWN
// candidate STEP path (so variants never overwrite each other's STEP). The winner's
// candidate is copied to the canonical outPath by the caller.
function buildVariant(label, user, sys, spec, candPath, postFn) {
  return (async () => {
    let r; try { r = await postFn(sys, user); } catch { return null; }
    const text = r?.choices?.[0]?.message?.content ?? '';
    const raw = extractCalls(text);
    if (!raw.length) return { variant: label, calls: 0, valid: false, stepOk: false, injected: 0, candPath };
    const { calls, injections } = fillPositions(raw, spec);       // POSITION DISCIPLINE
    const b = runJobInChild({ op: 'buildexport', calls, outPath: candPath });
    return { variant: label, calls: calls.length, injected: injections.length,
      valid: !!b.valid, stepOk: !!b.stepOk, betti: b.betti, volume: b.volume, candPath };
  })();
}

// Try-both-keep-valid: position-disciplined variants, pick the best-scoring valid solid.
// `postFn` is injectable so the offline self-check can stub the model.
async function buildBestVariant(sys, spec, outPath, postFn = post) {
  const exp = expectedHoles(spec);
  const cand = (label) => `${outPath}.cand-${label}.step`;
  const variants = [
    ['A-raw', spec],
    ['B-imper', `Build this part in Forge. Emit ONLY tool-calls (no prose). Part: ${spec}`],
    ['C-stepwise', `Build this part step by step using Forge tool-calls only. Start with the base solid, then cut/add each feature in turn. Part: ${spec}`],
    ['D-pos', `Build this part in Forge with tool-calls only. For EVERY hole/bore/pocket/slot/boss include an EXPLICIT at:[x,y,z]. A box base has its lower corner at the origin, so a feature centred on an L×W×T base goes at at:[L/2, W/2, 0] — NEVER leave a single feature at the origin (that puts it at the corner). Part: ${spec}`],
  ];
  const allCands = [];
  let best = null, bestScore = -Infinity, bestEffort = null;
  const consider = (rec) => {
    if (!rec) return;
    if (rec.candPath) allCands.push(rec.candPath);
    const sc = variantScore(rec, exp);
    if (sc > bestScore) { bestScore = sc; best = rec; }
    if (!bestEffort || rec.calls > bestEffort.calls) bestEffort = rec;
  };
  for (const [label, user] of variants) consider(await buildVariant(label, user, sys, spec, cand(label), postFn));
  // Material-safe SIMPLIFIED rescue — only if no full-spec variant built a valid solid.
  if (!(best && best.valid && best.stepOk) && ALLOW_SIMPLIFY_RESCUE) {
    const simp = simplifySpec(spec);
    if (simp && simp !== spec) {
      const rec = await buildVariant('E-simpl', `Build this part in Forge. Emit ONLY tool-calls. Part: ${simp}`, sys, simp, cand('E-simpl'), postFn);
      consider(rec);
    }
  }
  // Pick the winner (best valid+STEP, else best-effort) and copy ITS candidate STEP to
  // the canonical outPath, then clean up the other candidates.
  const chosen = (best && best.valid && best.stepOk) ? best
    : (bestEffort && (bestEffort.valid || bestEffort.calls)) ? bestEffort : best;
  const result = chosen ? { ...chosen, score: bestScore, bestEffort: !(chosen.valid && chosen.stepOk) }
    : { variant: 'none', calls: 0, valid: false, stepOk: false };
  try {
    if (chosen && chosen.stepOk && chosen.candPath && fs.existsSync(chosen.candPath)) fs.copyFileSync(chosen.candPath, outPath);
  } catch { /* leave outPath absent → row.outPath stays null */ }
  for (const c of allCands) { try { if (fs.existsSync(c)) fs.unlinkSync(c); } catch { /* ignore */ } }
  delete result.candPath;
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Offline self-check — proves the position discipline WITHOUT the model/GPU.
//  Reads a saved spec→calls fixture (the model's raw output WITH the corner-drop
//  bug) and asserts fillPositions injects on-base positions. With --build it also
//  builds before/after in the kernel (CPU) to show b1: 0 (corner) → 2 (centred).
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURE = path.resolve(__dirname, 'fixtures', 'cadgen_mm_speccalls_fixture.json');
function selfCheck() {
  const doBuild = process.argv.includes('--build');
  const fx = JSON.parse(fs.readFileSync(arg('--fixture', FIXTURE), 'utf8'));
  let pass = 0, fail = 0;
  const fails = [];
  const assert = (cond, msg) => { if (cond) pass++; else { fail++; fails.push(msg); } };
  console.log(`[selfcheck] ${fx.length} spec→calls fixtures · build=${doBuild ? 'ON (kernel CPU)' : 'off (logic only)'}\n`);
  for (const t of fx) {
    const { id, spec, calls, expect } = t;
    const before = calls.filter((c) => isMaterialOp(c.name));
    const beforeAtless = before.filter((c) => !hasExplicitAt(c.arguments || {})).length;
    const { calls: fixed, base, injections } = fillPositions(calls, spec);
    const after = fixed.filter((c) => isMaterialOp(c.name));
    const afterAtless = after.filter((c) => !hasExplicitAt(c.arguments || {})).length;
    console.log(`  ${id}: base=${base ? base.kind + ' ' + [base.L, base.W, base.T].map((x) => x ?? '-').join('x') : 'none'} · material ops ${before.length} · at-less ${beforeAtless}→${afterAtless} · injected ${injections.length}`);
    for (const inj of injections) console.log(`        ${inj.op} ${inj.primitive} → at=[${inj.at.join(', ')}] (${inj.source})`);

    // every material op must now carry an explicit at
    assert(afterAtless === 0 || base === null, `${id}: ${afterAtless} material ops still lack at`);
    // a single central feature on a box base must land at the plate centre
    if (expect?.firstAt && injections.length) {
      const got = injections[0].at;
      const okxy = Math.abs(got[0] - expect.firstAt[0]) < 0.6 && Math.abs(got[1] - expect.firstAt[1]) < 0.6;
      assert(okxy, `${id}: first injected at=[${got}] expected centre ≈ [${expect.firstAt}]`);
    }
    if (doBuild) {
      const outB = path.join(os_tmp(), `selfcheck_${id}_before.step`);
      const outA = path.join(os_tmp(), `selfcheck_${id}_after.step`);
      const bb = runJobInChild({ op: 'buildexport', calls, outPath: outB });
      const ba = runJobInChild({ op: 'buildexport', calls: fixed, outPath: outA });
      const b1b = bb.betti?.b1 ?? '-', b1a = ba.betti?.b1 ?? '-';
      console.log(`        BUILD before: valid=${!!bb.valid} b1=${b1b}  →  after: valid=${!!ba.valid} b1=${b1a}`);
      if (expect?.b1After != null) assert((ba.betti?.b1 ?? -1) === expect.b1After, `${id}: b1 after = ${b1a}, expected ${expect.b1After}`);
      if (expect?.b1Before != null) assert((bb.betti?.b1 ?? -1) === expect.b1Before, `${id}: b1 before = ${b1b}, expected ${expect.b1Before}`);
    }
  }
  console.log(`\n[selfcheck] ${pass} passed · ${fail} failed`);
  if (fail) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
  console.log('[selfcheck] OK — position discipline injects on-base positions for every at-less material op.');
}
function os_tmp() { return process.env.TMPDIR || '/tmp'; }

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes('--selfcheck')) { selfCheck(); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const sys = liveSystem();
  const specs = fs.readFileSync(SPECS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  console.log(`[mm] ${specs.length} specs → backend (cadgen-v7) → position-discipline → build → STEP`);
  console.log(`[mm] full spec tried first (A/B/C/D); simplified rescue ${ALLOW_SIMPLIFY_RESCUE ? 'ENABLED (last resort, material-safe)' : 'disabled'}\n`);
  const rows = [];
  for (const s of specs) {
    const id = String(s.id ?? s.fixture ?? '?');
    const spec = s.spec ?? s.text ?? '';
    process.stdout.write(`  ${id} … `);
    const outPath = path.join(OUT, `${id}.step`);
    const r = await buildBestVariant(sys, spec, outPath);
    const b = r.betti ? `b0=${r.betti.b0} b1=${r.betti.b1} b2=${r.betti.b2}` : 'b=-';
    console.log(`${r.variant} ${r.calls}call inj=${r.injected ?? 0} valid=${r.valid ? 'Y' : 'N'} step=${r.stepOk ? 'Y' : 'N'} ${b} vol=${r.volume ? r.volume.toFixed(0) : '-'}`);
    rows.push({ id, variant: r.variant, calls: r.calls, injected: r.injected ?? 0, valid: r.valid, stepOk: r.stepOk, betti: r.betti, volume: r.volume, outPath: (r.valid && r.stepOk) ? outPath : null });
  }
  const built = rows.filter(r => r.valid).length, stepped = rows.filter(r => r.stepOk).length;
  const withHoles = rows.filter(r => (r.betti?.b1 ?? 0) > 0).length;
  console.log(`\n[mm] valid solids ${built}/${rows.length} · STEP exported ${stepped}/${rows.length} · with through-holes (b1>0) ${withHoles}/${rows.length}`);
  fs.writeFileSync(path.join(OUT, 'mm_pipeline_results.json'), JSON.stringify({ specs: SPECS, rows, built, stepped, withHoles }, null, 2));
  console.log(`[mm] results + STEP files → ${OUT}`);
}

// Only auto-run when invoked directly (so importing the exports for tests/other
// harnesses never fires the model-driving pipeline).
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

export { fillPositions, baseFromCall, parseSpecPositions, expectedHoles, simplifySpec, variantScore, buildBestVariant, extractCalls };
