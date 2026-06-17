#!/usr/bin/env node
/**
 * label_rows.mjs — GT-label a JSONL of Forge corpus rows by replaying each row's
 * <tool_call> sequence through the native kernel, then write the rows back with
 *   meta.gt = { bbox, volume, betti, bodyCount, valid }
 *
 * REUSE, NOT DUPLICATE: imports the labeler surface from cadscore_harness.mjs
 * (runJobInChild, parseRow). Each row is replayed in its OWN fresh `node` child
 * (handled by runJobInChild's {op:'label'} path) so the kernel's process-global
 * monotonic handle counter restarts at 1 — matching the corpus convention that
 * "handles count up from 1 in creation order". Rows are NEVER batched into one
 * child (that would desync the handle counter).
 *
 * USAGE:
 *   node forge-kernel/test/label_rows.mjs --in rows.jsonl --out labeled.jsonl
 *   node forge-kernel/test/label_rows.mjs --in - --out -            # stdin → stdout
 *   cat rows.jsonl | node forge-kernel/test/label_rows.mjs          # defaults to -/-
 *
 * Dependency-free: pure Node builtins + the native kernel (via the harness).
 */
import fs from 'fs';
import { runJobInChild, parseRow, shapeFromTess } from './cadscore_harness.mjs';

const argv = process.argv.slice(2);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const inPath = arg('--in') || '-';
const outPath = arg('--out') || '-';
const quiet = argv.includes('--quiet');

const EMPTY_GT = () => ({
  bbox: null, volume: 0, betti: { b0: 0, b1: 0, b2: 0 }, bodyCount: 0, valid: false,
});

function gtFromResult(res) {
  if (!res || !res.ok || !res.gt) return EMPTY_GT();
  const g = res.gt;
  return {
    bbox: g.bbox ?? null,
    volume: g.volume ?? 0,
    betti: g.betti ?? { b0: 0, b1: 0, b2: 0 },
    bodyCount: typeof g.bodyCount === 'number' ? g.bodyCount : (g.betti ? g.betti.b0 : 0),
    valid: g.valid === true,
  };
}

const raw = inPath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(inPath, 'utf8');
const lines = raw.split('\n').filter((l) => l.trim());
const outLines = [];
let nValid = 0, nTotal = 0;

// Rehydrate a label-op gt's tessSnapshot → a {positions,indices} the shape-sim
// math consumes (the no-op-renorm b_shape baseline for editing rows).
function tessOf(res) {
  const ts = res && res.ok && res.gt && res.gt.tessSnapshot;
  if (!ts) return null;
  return { positions: Float32Array.from(ts.positions), indices: Uint32Array.from(ts.indices) };
}

let nEdit = 0;
for (const line of lines) {
  let row;
  try { row = JSON.parse(line); } catch { continue; }   // pass-through-skip malformed JSON

  let calls = [];
  try { calls = parseRow(line).calls; } catch { /* leave empty → invalid gt */ }

  let gt, fullRes = null;
  if (calls.length) {
    fullRes = runJobInChild({ op: 'label', calls });    // fresh child; handles restart at 1
    gt = gtFromResult(fullRes);
  } else {
    gt = EMPTY_GT();
  }

  row.meta = { ...(row.meta || {}), gt };

  // EDITING no-op-renorm: if the row carries meta.input_calls (the BASE-only
  // build of an editing row), ALSO label the base in its OWN fresh child →
  //   meta.gt_input = { bbox, volume, betti, bodyCount }
  //   meta.b_shape  = scoreShape(gt_input.tess vs gt.tess)  — the no-op baseline
  // shape-similarity (how similar the UNEDITED input is to the EDITED target).
  // A correct edit moves the body away from the input ⇒ shape≫b_shape ⇒ s_renorm→1;
  // a no-op echo returns the input unchanged ⇒ shape≈b_shape ⇒ s_renorm→0.
  const inputCalls = Array.isArray(row.meta.input_calls) ? row.meta.input_calls : null;
  if (inputCalls && inputCalls.length) {
    const baseCalls = inputCalls.map((c) => ({ name: c.name, arguments: c.arguments || {} }));
    const baseRes = runJobInChild({ op: 'label', calls: baseCalls });   // fresh child; handles restart at 1
    const gtInputFull = gtFromResult(baseRes);
    row.meta.gt_input = {
      bbox: gtInputFull.bbox, volume: gtInputFull.volume,
      betti: gtInputFull.betti, bodyCount: gtInputFull.bodyCount,
    };
    const tIn = tessOf(baseRes), tTgt = tessOf(fullRes);
    if (tIn && tTgt) {
      row.meta.b_shape = shapeFromTess(
        { volume: gtInputFull.volume, bbox: gtInputFull.bbox, tess: tIn },
        { volume: gt.volume, bbox: gt.bbox, tess: tTgt },
      ).shape;
    } else {
      row.meta.b_shape = null;   // base or target failed to build → no baseline
    }
    nEdit++;
  }

  outLines.push(JSON.stringify(row));
  nTotal++;
  if (gt.valid) nValid++;
  if (!quiet && outPath !== '-') {
    process.stderr.write(`\r[label_rows] ${nTotal}/${lines.length} (valid=${nValid})`);
  }
}

const out = outLines.join('\n') + (outLines.length ? '\n' : '');
if (outPath === '-') process.stdout.write(out);
else fs.writeFileSync(outPath, out);

if (!quiet && outPath !== '-') {
  process.stderr.write(`\n[label_rows] wrote ${nTotal} labeled rows → ${outPath}  valid=${nValid}/${nTotal}` +
    ` (${nTotal ? (100 * nValid / nTotal).toFixed(1) : '0'}%)` +
    (nEdit ? `  editing(gt_input+b_shape)=${nEdit}` : '') + '\n');
}
