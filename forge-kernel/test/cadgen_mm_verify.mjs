// ─────────────────────────────────────────────────────────────────────────────
// cadgen_mm_verify.mjs — RIGOROUS LOCAL VERIFICATION HARNESS for CADGenBench
//
// The official CADGenBench ground truth is PRIVATE (a separate gated repo); the
// leaderboard's server-side scorer is the only path to a real number. That makes
// blind iteration impossible. This harness is the strongest evidence we CAN
// produce LOCALLY, with NO private GT, to A/B pipelines and catch regressions
// before we spend a leaderboard submission.
//
// It measures each submission's `<id>.step` directly off disk (a fresh kernel
// child per file, so the OCCT handle counter and BREP state are isolated) and
// reports four orthogonal views:
//
//   (a) VALIDITY GATE — forge.heal.checkValidity on the imported solid. This is
//       the SAME hard gate the official scorer applies first (closed + manifold +
//       oriented + no self-intersection + no bad faces). Anything that fails this
//       scores cad_score = 0 on the leaderboard, so % valid is a true ceiling.
//
//   (b) GT-FREE FEATURE-MATCH — parse the stated features for each fixture and
//       compare to the KERNEL-MEASURED build, needing no private GT:
//         GEN  : parse the VLM spec (specs49.jsonl) for overall dims + hole count.
//                Compare stated L×W×H (or D×H) to the measured bbox, and the
//                stated through-hole count to the measured Betti b1 (b1 = 2·#tunnels,
//                exactly as the harness/official topology axis counts genus). This
//                directly catches the dominant failure: a VALID-but-FEATURELESS
//                base solid (b1 = 0 when the drawing calls for holes) — the
//                "holes dropped to the corner / never cut" defect.
//         EDIT : measure BOTH input.step and output.step and compare the DELTA
//                (Δb1, Δvolume, Δb0) to the intent parsed from edit_description.txt
//                (remove N holes ⇒ Δb1≈-2N & Δvol>0; add ⇒ Δb1>0 & Δvol<0; shrink
//                ⇒ Δvol<0). Also flags the cheap cheat: output ≈ copy of input
//                (Δvol≈0 ∧ Δb1=0 when a change was requested) → NO-OP.
//
//   (c) GT-BACKED PROXY — folds in the official-metric-calibrated proxy over our
//       internal labelled fixtures (the 29 cases produced by cadgen_eval_v2.sh /
//       cadgen_aggregate). This harness does NOT run the model; pass a finished
//       --proxy <jsonl> (e.g. logs/cadgen_v2_eval/v7.jsonl) and it reproduces the
//       per-dimension means so the GT-free numbers can be read next to a real
//       4-dim score. (Producing a fresh proxy needs a GPU serve — done later.)
//
//   (d) A/B MODE — point --sub at the new pipeline dir and --sub-b at the old one;
//       every fixture present in both is measured and classified IMPROVED /
//       REGRESSED / SAME on validity, feature-match and topology. This is the
//       multi-times-repeatable, GT-free evidence that a pipeline change helped.
//
// HARDWARE: this is CPU-ONLY. It loads the native OCCT kernel (forge-kernel.node)
// in short-lived children to import+measure STEP files. It NEVER starts a model
// serve, a VLM, or any GPU process. Safe to run while a train holds the GPU.
//
// USAGE
//   # GEN + EDIT validity + GT-free feature-match over one submission dir:
//   node cadgen_mm_verify.mjs --sub ../cadgenbench_deliverables/multimodal_clean
//
//   # A/B two submission dirs (new vs old), write a JSON report:
//   node cadgen_mm_verify.mjs --sub <new_dir> --sub-b <old_dir> \
//        --out /tmp/mm_verify_ab.json
//
//   # Fold in the GT-backed proxy for calibration:
//   node cadgen_mm_verify.mjs --sub <dir> --proxy ~/archdisc-Models/logs/cadgen_v2_eval/v7.jsonl
//
//   # Scope: --gen-only | --edit-only | --only 101,120,205 | --limit 5
//
// FLAGS
//   --sub <dir>      submission A dir of <id>.step (REQUIRED unless --proxy only)
//   --sub-b <dir>    submission B dir → enables A/B comparison
//   --specs <jsonl>  VLM spec jsonl (id→spec) for GEN feature-match
//                    [default ~/archdisc-Models/data/forge/cadgen_mm/specs49.jsonl]
//   --data <dir>     cadgenbench-data root (GEN/EDIT classification + edit text + input.step)
//                    [default ~/archdisc-Models/data/cadgenbench-data]
//   --proxy <jsonl>  cadgen_eval_v2 --json-out JSONL to summarise alongside
//   --out <json>     write the full machine-readable report here
//   --gen-only | --edit-only | --only <ids> | --limit <n>
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODELS = path.resolve(__dirname, '..', '..', '..', 'archdisc-Models');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);

// ─────────────────────────────────────────────────────────────────────────────
//  WORKER MODE — measure ONE STEP in a fresh kernel and emit JSON.
//  Uses its OWN flag (--mm-measure), NOT --worker, so importing cadscore_harness
//  does not trip that file's `--worker` auto-run guard.
// ─────────────────────────────────────────────────────────────────────────────
async function runMeasureWorker() {
  const stepPath = arg('--step');
  const outFile = arg('--out');
  let result;
  try {
    // makeHeadlessForge only require()s the kernel when CALLED, so this import is
    // cheap; tess/bboxOf/bettiNumbers/checkValid are the EXACT routines the GT
    // scorer uses, keeping our topology axis byte-comparable to the leaderboard's.
    const { makeHeadlessForge, tess, bboxOf, bettiNumbers, checkValid } =
      await import('./cadscore_harness.mjs');
    const forge = makeHeadlessForge();
    const h = forge.io.importStep(stepPath);
    if (typeof h !== 'number' || h <= 0) {
      result = { ok: false, error: 'importStep returned no handle (unreadable / not a solid)' };
    } else {
      const cv = checkValid(forge, h);
      const t = tess(forge, h);
      const bb = bboxOf(t);
      const betti = bettiNumbers(t);
      let volume = 0, area = 0, com = null;
      try { const mp = forge.massProps(h); volume = mp.volume; area = mp.area; com = mp.centerOfMass; } catch { /* keep zeros */ }
      const ext = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
      const bboxVol = ext[0] * ext[1] * ext[2];
      result = {
        ok: true,
        valid: cv.valid,
        validity: {
          isClosed: !!cv.raw.isClosed, isManifold: !!cv.raw.isManifold,
          isOriented: !!cv.raw.isOriented, hasSelfIntersect: !!cv.raw.hasSelfIntersect,
          badFaces: cv.badFaces, badEdges: cv.badEdges,
        },
        betti, bbox: bb, ext,
        dimsSorted: [...ext].sort((a, b) => b - a),
        volume, area, com,
        bboxVol, bboxFill: bboxVol > 1e-9 ? volume / bboxVol : null,
        nSolids: betti.b0, nTris: t.indices.length / 3,
      };
    }
  } catch (e) {
    result = { ok: false, error: e.message || String(e) };
  }
  fs.writeFileSync(outFile, JSON.stringify(result));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator: spawn a fresh child to measure each STEP off disk.
// ─────────────────────────────────────────────────────────────────────────────
function measureStep(stepPath) {
  if (!fs.existsSync(stepPath)) return { ok: false, error: 'file not found', missing: true };
  const outFile = path.join(os.tmpdir(), `mmv_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.json`);
  try {
    const r = spawnSync(process.execPath, [__filename, '--mm-measure', '--step', stepPath, '--out', outFile],
      { stdio: ['ignore', 'ignore', 'inherit'], timeout: 120000 });
    if (!fs.existsSync(outFile)) {
      return { ok: false, error: `worker produced no output (exit ${r.status}${r.signal ? ' ' + r.signal : ''})` };
    }
    return JSON.parse(fs.readFileSync(outFile, 'utf8'));
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (fs.existsSync(outFile)) { try { fs.unlinkSync(outFile); } catch { /* ignore */ } }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Topology credit — IDENTICAL to cadscore_harness.topologyCredit (line ~366):
//  per-axis ((min+1)/(max+1))² so b1 of 2 vs 4 → (3/5)² = 0.36. Inlined to keep
//  the orchestrator from loading the kernel at import time.
// ─────────────────────────────────────────────────────────────────────────────
function topologyCredit(got, exp) {
  const a = Math.min(got, exp), b = Math.max(got, exp);
  const r = (a + 1) / (b + 1);
  return r * r;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Feature parsing (GT-FREE) — heuristic over the VLM spec text. These numbers
//  are noisy (the spec is model-extracted), so they drive SOFT expectations and
//  are always reported next to what was actually parsed for auditability.
// ─────────────────────────────────────────────────────────────────────────────
const NUMWORD = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};
function wordsToDigits(s) {
  return s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (m) => String(NUMWORD[m.toLowerCase()]));
}

function parseGenFeatures(specRaw) {
  const spec = wordsToDigits(String(specRaw || ''));
  const out = {
    overallDims: null,      // [L,W,H] from "L x W x H mm"
    cyl: null,              // {d,h} from a cylinder phrasing
    statedHoleCount: 0,     // best-effort sum of through-hole-like features
    holeMentions: [],       // raw matched fragments (audit)
    diameters: [],          // every Ø/diameter value seen
    hasBoltCircle: false,
    flags: [],
  };

  // Overall L×W×H (first occurrence wins).
  const m3 = spec.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/i);
  if (m3) out.overallDims = [parseFloat(m3[1]), parseFloat(m3[2]), parseFloat(m3[3])];

  // Cylinder: "<D> mm diameter ... <H> mm high" OR "diameter of <D> mm ... height of <H> mm".
  if (!out.overallDims) {
    let d = null, h = null;
    let mm = spec.match(/diameter\s+of\s+(\d+(?:\.\d+)?)\s*mm/i) || spec.match(/(\d+(?:\.\d+)?)\s*mm\s+diameter/i);
    if (mm) d = parseFloat(mm[1]);
    mm = spec.match(/height\s+of\s+(\d+(?:\.\d+)?)\s*mm/i) || spec.match(/(\d+(?:\.\d+)?)\s*mm\s+(?:high|tall|height)/i);
    if (mm) h = parseFloat(mm[1]);
    if (d && h) out.cyl = { d, h };
  }

  // Every Ø / "<n> mm diameter" value (audit + diversity signal).
  for (const m of spec.matchAll(/(?:Ø|diameter\s+of\s+)\s*(\d+(?:\.\d+)?)/gi)) out.diameters.push(parseFloat(m[1]));

  // Through-hole-ish features with an explicit leading count. Allow up to a few
  // descriptor words between the number and the noun (e.g. "4 bolt holes",
  // "two 10 mm diameter holes"). Sum the counts.
  const HOLE_NOUN = /(holes?|bores?|counterbores?|countersinks?|bolt\s+holes?|thru[-\s]?holes?|through[-\s]?holes?)/i;
  const countRe = /(\d+)\s+((?:[A-Za-z.,°Ø\-]+\s+){0,4})?(holes?|bores?|counterbores?|countersinks?|bolt\s+holes?|thru[-\s]?holes?|through[-\s]?holes?)/gi;
  for (const m of spec.matchAll(countRe)) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 200) { out.statedHoleCount += n; out.holeMentions.push(m[0].trim().slice(0, 60)); }
  }
  // Singular un-numbered hole mentions ("a central hole", "the bore") → +1 each,
  // but only if no counted holes captured them (avoid double counting).
  if (out.statedHoleCount === 0) {
    const sing = spec.match(/\b(a|the|central|one)\s+(?:[\w.,°Ø-]+\s+){0,3}?(hole|bore)\b/i);
    if (sing) { out.statedHoleCount = 1; out.holeMentions.push(sing[0].trim().slice(0, 60)); }
  }
  out.hasBoltCircle = /bolt\s*circle/i.test(spec);
  return out;
}

// GEN feature-match: combine the GT-free sub-signals into one [0,1] score.
function genFeatureMatch(feat, meas) {
  const parts = [];   // {name, score, weight, detail}
  // (1) DIMENSIONS — firm signal: overall extents are explicit in the drawing/spec.
  let stated = null;
  if (feat.overallDims) stated = [...feat.overallDims];
  else if (feat.cyl) stated = [feat.cyl.d, feat.cyl.d, feat.cyl.h];
  if (stated && meas.dimsSorted) {
    const s = [...stated].sort((a, b) => b - a);
    const d = [...meas.dimsSorted];
    let prod = 1;
    for (let i = 0; i < 3; i++) {
      const a = Math.min(s[i], d[i]), b = Math.max(s[i], d[i]);
      prod *= b > 1e-9 ? a / b : 1;
    }
    parts.push({ name: 'dims', score: prod, weight: 0.55, detail: { stated: s.map(r2), measured: d.map(r2) } });
  }
  // (2) HOLE TOPOLOGY — directional: b1 = 2·#through-tunnels. Blind holes/pockets
  //     do NOT raise b1, so this is an UPPER expectation; its strongest use is the
  //     binary "featureless" catch (stated holes > 0 but measured b1 == 0).
  if (feat.statedHoleCount > 0) {
    const expB1 = 2 * feat.statedHoleCount;
    const score = topologyCredit(meas.betti.b1, expB1);
    const featureless = meas.betti.b1 === 0;
    parts.push({
      name: 'holeTopo', score, weight: 0.30,
      detail: { statedHoles: feat.statedHoleCount, expectedB1: expB1, measuredB1: meas.betti.b1, featureless },
    });
  }
  // (3) SOLIDITY — a single machined part should be ONE solid body (b0 == 1).
  //     Fragmentation (b0 > 1) usually means parts landed disjoint (the same
  //     "feature placed at the corner / detached" failure family).
  {
    const b0 = meas.betti.b0;
    const score = b0 === 1 ? 1 : (b0 >= 1 ? 1 / b0 : 0);
    parts.push({ name: 'solidity', score, weight: 0.15, detail: { b0 } });
  }
  const wsum = parts.reduce((a, p) => a + p.weight, 0);
  const featureMatch = wsum > 0 ? parts.reduce((a, p) => a + p.score * p.weight, 0) / wsum : null;
  const featureless = parts.some((p) => p.name === 'holeTopo' && p.detail.featureless);
  return { featureMatch, parts, featureless };
}

// ─────────────────────────────────────────────────────────────────────────────
//  EDIT intent parsing + delta verification (GT-FREE, uses input.step as the
//  reference instead of private GT).
// ─────────────────────────────────────────────────────────────────────────────
function parseEditIntent(text) {
  const t = wordsToDigits(String(text || '').toLowerCase());
  const intent = { kind: 'unknown', holeCount: 0, mm: null, raw: text };
  const holeM = t.match(/(\d+)\s+(?:[\w.,°-]+\s+){0,4}?(holes?|bores?)/);
  if (holeM) intent.holeCount = parseInt(holeM[1], 10);
  const mmM = t.match(/by\s+(\d+(?:\.\d+)?)\s*mm/) || t.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (mmM) intent.mm = parseFloat(mmM[1]);
  if (/\b(remove|delete|eliminate|fill\s+in)\b/.test(t)) intent.kind = 'remove';
  else if (/\b(add|new|drill|introduce|insert)\b/.test(t) && /\b(hole|bore|pocket|slot|boss)\b/.test(t)) intent.kind = 'add';
  else if (/\b(inward|reduce|shrink|smaller|thinner|narrower|decrease)\b/.test(t)) intent.kind = 'shrink';
  else if (/\b(outward|enlarge|bigger|wider|thicker|increase|extend)\b/.test(t)) intent.kind = 'grow';
  return intent;
}

// editMatch: does the measured delta agree in SIGN (and roughly magnitude) with
// the parsed instruction? Returns {score, expectation, observed, flags}.
function editMatch(intent, mi, mo) {
  const dB1 = mo.betti.b1 - mi.betti.b1;
  const dVol = mo.volume - mi.volume;
  const dB0 = mo.betti.b0 - mi.betti.b0;
  const volEps = Math.max(1e-6 * Math.max(Math.abs(mi.volume), 1), Math.abs(mi.volume) * 0.001);
  const observed = { dB1, dVol: r2(dVol), dB0 };
  const flags = [];
  // NO-OP cheat detector: nothing changed but a change was requested.
  const isNoop = Math.abs(dVol) <= volEps && dB1 === 0 && dB0 === 0;
  if (isNoop && intent.kind !== 'unknown') flags.push('NO-OP (output ≈ copy of input)');

  let score = null, expectation = null;
  if (intent.kind === 'remove') {
    const expB1 = intent.holeCount ? -2 * intent.holeCount : '<0';
    expectation = `Δb1≈${expB1}, Δvol>0`;
    let s = 0;
    if (dB1 < 0) s += 0.5;                                  // tunnels removed
    if (intent.holeCount) s += 0.3 * topologyCredit(Math.abs(dB1), 2 * intent.holeCount);
    else if (dB1 < 0) s += 0.3;
    if (dVol > volEps) s += 0.2;                            // material filled back in
    score = Math.min(1, s);
  } else if (intent.kind === 'add') {
    expectation = 'Δb1>0 (if through), Δvol<0';
    let s = 0;
    if (dB1 > 0) s += 0.5;
    if (dVol < -volEps) s += 0.5;                           // material removed
    score = Math.min(1, s);
  } else if (intent.kind === 'shrink') {
    expectation = 'Δvol<0, bbox ≈ same';
    score = dVol < -volEps ? 1 : (Math.abs(dVol) <= volEps ? 0 : 0.2);
  } else if (intent.kind === 'grow') {
    expectation = 'Δvol>0';
    score = dVol > volEps ? 1 : (Math.abs(dVol) <= volEps ? 0 : 0.2);
  } else {
    expectation = 'unparsed intent — change-only check';
    score = (!isNoop) ? 0.5 : 0;                            // can only confirm SOMETHING changed
  }
  return { score, expectation, observed, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fixture classification (GEN vs EDIT) from the data dir.
// ─────────────────────────────────────────────────────────────────────────────
function classify(dataDir, id) {
  const d = path.join(dataDir, id);
  const hasStep = fs.existsSync(path.join(d, 'input.step'));
  const hasPng = fs.existsSync(path.join(d, 'input.png'));
  if (hasStep) return 'edit';
  if (hasPng) return 'gen';
  return 'unknown';
}
function listSubmissionIds(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.step')).map((f) => f.replace(/\.step$/, '')).sort(numCmp);
}
function numCmp(a, b) { const na = parseInt(a, 10), nb = parseInt(b, 10); return (isFinite(na) && isFinite(nb)) ? na - nb : String(a).localeCompare(String(b)); }
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
function loadSpecs(p) {
  const map = {};
  if (!p || !fs.existsSync(p)) return map;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { const r = JSON.parse(s); if (r.id != null) map[String(r.id)] = r.spec ?? r.text ?? ''; } catch { /* skip */ }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-fixture evaluation of ONE submission dir.
// ─────────────────────────────────────────────────────────────────────────────
function evalFixture(id, kind, subDir, specs, dataDir) {
  const stepPath = path.join(subDir, `${id}.step`);
  const present = fs.existsSync(stepPath);
  const row = { id, kind, present };
  if (!present) { row.note = 'no STEP submitted (scores 0 on leaderboard)'; return row; }

  const m = measureStep(stepPath);
  row.measureOk = m.ok;
  if (!m.ok) { row.error = m.error; row.valid = false; return row; }

  row.valid = m.valid;
  row.validity = m.validity;
  row.betti = m.betti;
  row.dimsSorted = m.dimsSorted.map(r2);
  row.volume = r2(m.volume);
  row.bboxFill = m.bboxFill == null ? null : r2(m.bboxFill);
  row.nSolids = m.nSolids;
  row.nTris = m.nTris;
  if (!m.valid) row.validReason = invalidReason(m.validity);

  if (kind === 'gen') {
    const feat = parseGenFeatures(specs[id] || '');
    row.stated = { overallDims: feat.overallDims, cyl: feat.cyl, statedHoleCount: feat.statedHoleCount, hasBoltCircle: feat.hasBoltCircle };
    const fm = genFeatureMatch(feat, m);
    row.featureMatch = fm.featureMatch == null ? null : r2(fm.featureMatch);
    row.fmParts = fm.parts.map((p) => ({ name: p.name, score: r2(p.score), weight: p.weight, detail: p.detail }));
    row.featureless = fm.featureless;
    if (fm.featureless) (row.flags ??= []).push('FEATURELESS (spec has holes, measured b1=0)');
  } else if (kind === 'edit') {
    const inStep = path.join(dataDir, id, 'input.step');
    const editTxt = readMaybe(path.join(dataDir, id, 'edit_description.txt'))
      || readMaybe(path.join(dataDir, id, 'description.yaml'));
    const intent = parseEditIntent(editTxt);
    row.intent = { kind: intent.kind, holeCount: intent.holeCount, mm: intent.mm };
    if (!fs.existsSync(inStep)) { row.editNote = 'input.step missing — cannot delta-verify'; return row; }
    const mi = measureStep(inStep);
    if (!mi.ok) { row.editNote = `input.step measure failed: ${mi.error}`; return row; }
    row.inputBetti = mi.betti; row.inputVolume = r2(mi.volume);
    const em = editMatch(intent, mi, m);
    row.editMatch = em.score == null ? null : r2(em.score);
    row.editExpectation = em.expectation;
    row.editObserved = em.observed;
    if (em.flags.length) (row.flags ??= []).push(...em.flags);
  }
  return row;
}

function invalidReason(v) {
  const r = [];
  if (!v.isClosed) r.push('not closed (not watertight)');
  if (!v.isManifold) r.push('non-manifold');
  if (!v.isOriented) r.push('mis-oriented');
  if (v.hasSelfIntersect) r.push('self-intersecting');
  if (v.badFaces) r.push(`${v.badFaces} bad face(s)`);
  if (v.badEdges) r.push(`${v.badEdges} bad edge(s)`);
  return r.join(', ') || 'unknown';
}
function readMaybe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

// ─────────────────────────────────────────────────────────────────────────────
//  GT-backed proxy summary (reads an existing cadgen_eval_v2 --json-out JSONL).
// ─────────────────────────────────────────────────────────────────────────────
function summariseProxy(p) {
  if (!p || !fs.existsSync(p)) return null;
  const rows = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { rows.push(JSON.parse(s)); } catch { /* skip */ }
  }
  if (!rows.length) return null;
  const mean = (f) => { const xs = rows.map(f).filter((x) => typeof x === 'number'); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const gateFrac = rows.filter((r) => r.gate).length / rows.length;
  return {
    file: p, n: rows.length, gatePct: r2(100 * gateFrac),
    validity: r2(mean((r) => r.validity_axis)),
    shape: r2(mean((r) => r.shape)),
    interface: r2(mean((r) => r.interface)),
    topology: r2(mean((r) => r.topology)),
    cad_score: r2(mean((r) => r.cad_score)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  A/B classification per fixture (B is the BASELINE; A is the candidate/new).
// ─────────────────────────────────────────────────────────────────────────────
function classifyAB(a, b) {
  // Validity is the dominant axis (gate → 0). Then feature-match, then topology b1.
  const av = a.valid ? 1 : 0, bv = b.valid ? 1 : 0;
  if (av !== bv) return av > bv ? 'IMPROVED (gained validity)' : 'REGRESSED (lost validity)';
  const afm = a.featureMatch ?? a.editMatch, bfm = b.featureMatch ?? b.editMatch;
  if (typeof afm === 'number' && typeof bfm === 'number') {
    if (afm - bfm > 0.03) return 'IMPROVED';
    if (bfm - afm > 0.03) return 'REGRESSED';
  }
  const ab1 = a.betti?.b1, bb1 = b.betti?.b1;
  if (typeof ab1 === 'number' && typeof bb1 === 'number' && ab1 !== bb1) {
    // more tunnels usually = features actually cut (only meaningful when both valid)
    if (av === 1 && bv === 1) return ab1 > bb1 ? 'IMPROVED (more features)' : 'REGRESSED (fewer features)';
  }
  return 'SAME';
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const subA = arg('--sub');
  const subB = arg('--sub-b');
  const specsPath = arg('--specs', path.join(MODELS, 'data', 'forge', 'cadgen_mm', 'specs49.jsonl'));
  const dataDir = arg('--data', path.join(MODELS, 'data', 'cadgenbench-data'));
  const proxyPath = arg('--proxy');
  const outPath = arg('--out');
  const genOnly = has('--gen-only'), editOnly = has('--edit-only');
  const onlyList = (arg('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const limit = parseInt(arg('--limit', '0'), 10);

  console.log('════════════════════════════════════════════════════════════════════');
  console.log(' CADGenBench LOCAL VERIFICATION  (GT-free; private GT NOT required)');
  console.log('════════════════════════════════════════════════════════════════════');

  const proxy = summariseProxy(proxyPath);
  if (!subA) {
    if (proxy) { printProxy(proxy); return; }
    console.error('\n  usage: --sub <dir> [--sub-b <dir>] [--specs j] [--proxy j] [--out j]');
    process.exit(2);
  }
  if (!fs.existsSync(dataDir)) console.log(`  [warn] data dir not found: ${dataDir} (GEN/EDIT class + edit-delta will be limited)`);
  const specs = loadSpecs(specsPath);
  console.log(`  submission A : ${subA}`);
  if (subB) console.log(`  submission B : ${subB}  (A/B mode — B = baseline)`);
  console.log(`  specs        : ${fs.existsSync(specsPath) ? specsPath + ` (${Object.keys(specs).length} specs)` : '(none — GEN feature-match skipped)'}`);
  console.log(`  data         : ${dataDir}`);

  // Universe of ids = A's STEPs (∩ B's when A/B), filtered by scope.
  let ids = listSubmissionIds(subA);
  if (subB) { const bset = new Set(listSubmissionIds(subB)); ids = ids.filter((x) => bset.has(x)); }
  ids = ids.map((id) => ({ id, kind: classify(dataDir, id) }));
  if (genOnly) ids = ids.filter((x) => x.kind === 'gen');
  if (editOnly) ids = ids.filter((x) => x.kind === 'edit');
  if (onlyList.length) ids = ids.filter((x) => onlyList.includes(x.id));
  if (limit > 0) ids = ids.slice(0, limit);

  if (!ids.length) { console.log('\n  no fixtures in scope.'); if (proxy) printProxy(proxy); return; }
  console.log(`  fixtures     : ${ids.length} (${ids.filter((x) => x.kind === 'gen').length} gen, ${ids.filter((x) => x.kind === 'edit').length} edit)\n`);

  const rowsA = [], rowsB = [], abRows = [];
  for (const { id, kind } of ids) {
    process.stdout.write(`  ${id} (${kind}) … `);
    const ra = evalFixture(id, kind, subA, specs, dataDir);
    rowsA.push(ra);
    let rb = null;
    if (subB) { rb = evalFixture(id, kind, subB, specs, dataDir); rowsB.push(rb); }
    console.log(fmtRow(ra));
    if (rb) {
      const verdict = (ra.present && rb.present && ra.measureOk !== false && rb.measureOk !== false)
        ? classifyAB(ra, rb) : (ra.present && !rb.present ? 'IMPROVED (A only)' : (!ra.present && rb.present ? 'REGRESSED (B only)' : 'SAME'));
      abRows.push({ id, kind, verdict, A: digest(ra), B: digest(rb) });
      console.log(`        ↳ B: ${fmtRow(rb)}   ⇒ ${verdict}`);
    }
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const agg = aggregate(rowsA);
  console.log('\n────────────────────────────────────────────────────────────────────');
  console.log(' AGGREGATE — submission A');
  console.log('────────────────────────────────────────────────────────────────────');
  printAgg(agg);

  let aggB = null;
  if (subB) {
    aggB = aggregate(rowsB);
    console.log('\n AGGREGATE — submission B (baseline)');
    console.log('────────────────────────────────────────────────────────────────────');
    printAgg(aggB);
    const tally = { IMPROVED: 0, REGRESSED: 0, SAME: 0 };
    for (const r of abRows) {
      const key = r.verdict.startsWith('IMPROVED') ? 'IMPROVED' : r.verdict.startsWith('REGRESSED') ? 'REGRESSED' : 'SAME';
      tally[key]++;
    }
    console.log('\n A/B VERDICT (A vs baseline B)');
    console.log('────────────────────────────────────────────────────────────────────');
    console.log(`  IMPROVED ${tally.IMPROVED}   REGRESSED ${tally.REGRESSED}   SAME ${tally.SAME}   (of ${abRows.length})`);
    const moved = abRows.filter((r) => !r.verdict.startsWith('SAME'));
    for (const r of moved) console.log(`    ${pad(r.id, 8)} ${r.verdict}`);
  }

  if (proxy) printProxy(proxy);

  // ── Caveats ─────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────');
  console.log(' WHAT THIS PROVES / CANNOT PROVE');
  console.log('────────────────────────────────────────────────────────────────────');
  console.log('  PROVES (no private GT): the hard validity gate (true leaderboard');
  console.log('    pre-condition); that stated overall dims match the measured solid;');
  console.log('    that holes called for in the drawing actually became tunnels (b1>0),');
  console.log('    catching VALID-but-FEATURELESS bodies; that edits moved geometry in');
  console.log('    the right direction and are not a copy of the input (NO-OP).');
  console.log('  CANNOT PROVE: the exact shape_F1+IoU vs the hidden solid, the interface');
  console.log('    sub-volume match, or absolute leaderboard rank. Feature counts come');
  console.log('    from noisy VLM spec text; treat featureMatch as a RELATIVE A/B signal,');
  console.log('    not an absolute CAD Score. The GT-backed proxy (--proxy) is the only');
  console.log('    official-metric-calibrated number here, over internal labelled cases.');

  if (outPath) {
    const report = {
      generatedAt: new Date().toISOString(),
      subA, subB: subB || null, specsPath, dataDir, proxyPath: proxyPath || null,
      scope: { genOnly, editOnly, only: onlyList, limit, count: ids.length },
      aggregateA: agg, aggregateB: aggB, proxy,
      rowsA, rowsB: subB ? rowsB : null, ab: subB ? abRows : null,
    };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n  report → ${outPath}`);
  }
}

function digest(r) {
  if (!r.present) return { present: false };
  return { valid: r.valid, b1: r.betti?.b1, featureMatch: r.featureMatch ?? null, editMatch: r.editMatch ?? null, featureless: !!r.featureless };
}
function aggregate(rows) {
  const gen = rows.filter((r) => r.kind === 'gen'), edit = rows.filter((r) => r.kind === 'edit');
  const present = rows.filter((r) => r.present);
  const valid = present.filter((r) => r.valid);
  const fmVals = gen.filter((r) => typeof r.featureMatch === 'number').map((r) => r.featureMatch);
  const emVals = edit.filter((r) => typeof r.editMatch === 'number').map((r) => r.editMatch);
  const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return {
    total: rows.length, present: present.length,
    gen: gen.length, edit: edit.length,
    validCount: valid.length,
    validPct: present.length ? r2(100 * valid.length / present.length) : null,
    featureless: gen.filter((r) => r.featureless).length,
    noop: edit.filter((r) => (r.flags || []).some((f) => f.startsWith('NO-OP'))).length,
    meanFeatureMatch: r2(mean(fmVals)),
    meanEditMatch: r2(mean(emVals)),
    measureErrors: rows.filter((r) => r.present && r.measureOk === false).length,
  };
}
function printAgg(a) {
  console.log(`  present     : ${a.present}/${a.total}   (${a.gen} gen, ${a.edit} edit)`);
  console.log(`  VALID (gate): ${a.validCount}/${a.present}  ${a.validPct != null ? '(' + a.validPct + '%)' : ''}   ← leaderboard hard pre-condition`);
  if (a.gen) console.log(`  GEN  featureMatch mean : ${a.meanFeatureMatch ?? '—'}   featureless: ${a.featureless}/${a.gen}`);
  if (a.edit) console.log(`  EDIT editMatch    mean : ${a.meanEditMatch ?? '—'}   no-op: ${a.noop}/${a.edit}`);
  if (a.measureErrors) console.log(`  measure errors: ${a.measureErrors}`);
}
function printProxy(p) {
  console.log('\n────────────────────────────────────────────────────────────────────');
  console.log(' GT-BACKED PROXY (official-metric-calibrated, internal labelled cases)');
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(`  file      : ${p.file}`);
  console.log(`  n=${p.n}   gate ${p.gatePct}%   validity ${p.validity}  shape ${p.shape}  interface ${p.interface}  topology ${p.topology}`);
  console.log(`  cad_score : ${p.cad_score}   (published SOTA Fable5 = 0.4514)`);
}
function fmtRow(r) {
  if (!r.present) return 'MISSING';
  if (r.measureOk === false) return `MEASURE-FAIL (${r.error})`;
  const v = r.valid ? 'valid=Y' : `valid=N[${r.validReason}]`;
  const b = r.betti ? `b0=${r.betti.b0} b1=${r.betti.b1}` : '';
  if (r.kind === 'gen') {
    const fm = r.featureMatch != null ? `FM=${r.featureMatch}` : 'FM=—';
    const fl = r.featureless ? ' FEATURELESS' : '';
    return `${v} ${b} ${fm} vol=${r.volume}${fl}`;
  }
  if (r.kind === 'edit') {
    const em = r.editMatch != null ? `EM=${r.editMatch}` : 'EM=—';
    const o = r.editObserved ? `Δb1=${r.editObserved.dB1} Δvol=${r.editObserved.dVol}` : '';
    const fl = (r.flags || []).some((f) => f.startsWith('NO-OP')) ? ' NO-OP' : '';
    return `${v} ${b} ${em}[${r.intent?.kind}] ${o}${fl}`;
  }
  return `${v} ${b} vol=${r.volume}`;
}
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

// ─────────────────────────────────────────────────────────────────────────────
//  Entry dispatch — placed LAST so every top-level const/function is initialized
//  before main() (which is async-but-await-free and runs to completion eagerly).
// ─────────────────────────────────────────────────────────────────────────────
if (has('--mm-measure')) {
  runMeasureWorker().catch((e) => {
    try { fs.writeFileSync(arg('--out'), JSON.stringify({ ok: false, error: e.stack || String(e) })); } catch { /* ignore */ }
    process.exit(1);
  });
} else {
  main().catch((e) => { console.error('[mm-verify fatal]', e.stack || e); process.exit(1); });
}
