#!/usr/bin/env node
/**
 * render_views.mjs — STAGE A of the self-labeling multimodal drawing→STEP pipeline.
 *
 * Reads a JSONL of Forge corpus rows; for EACH row, replays its <tool_call>
 * sequence in a FRESH kernel child (so the process-global, monotonic handle
 * counter restarts at 1 — matching the corpus "handles count up from 1 in
 * creation order" convention), then runs the kernel's hidden-line-removal
 * projector `drawings.projectView(handle, dir)` for front/top/right. Each view
 * is { visibleEdges:[[{x,y},…],…], hiddenEdges:[…], bbox:{minX,minY,maxX,maxY} }
 * (pure 2D polylines). The result is written to a sidecar JSONL, one object per
 * input row:  { rowId, ok, views:{ front, top, right } }.
 *
 * REUSE, NOT DUPLICATE: the kernel-load + fresh-child machinery is imported from
 * cadscore_harness.mjs (makeHeadlessForge, runJobInChild, parseRow). We add ONE
 * new worker op — 'project' — by delegating to a tiny inline child here rather
 * than touching the harness (it already discards OCCT stdout chatter into a JSON
 * out-file, which we mirror).
 *
 * USAGE:
 *   node forge-kernel/test/render_views.mjs --in rows.jsonl --out views.jsonl
 *   node forge-kernel/test/render_views.mjs --in rows.jsonl --out views.jsonl --views front,top,right
 *
 * Dependency-free: pure Node builtins + the native kernel (via the harness).
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { makeHeadlessForge, parseRow } from './cadscore_harness.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const BRIDGE_PATH = path.resolve(
  __filename, '..', '..', '..', 'frontend', 'src', 'ai', 'ForgeToolBridge.js',
);

const DEFAULT_VIEWS = ['front', 'top', 'right'];

// ───────────────────────────────────────────────────────────────────────────
//  Fresh-kernel child: replay one row's calls, project the requested views.
//  Mirrors cadscore_harness.runJobInChild's contract (job-file in, out-file out,
//  child stdout discarded so OCCT transfer chatter never corrupts the JSON).
// ───────────────────────────────────────────────────────────────────────────
function projectInChild(calls, views) {
  const jobFile = path.join(os.tmpdir(),
    `frv_job_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}.json`);
  const outFile = jobFile.replace('.json', '.out.json');
  fs.writeFileSync(jobFile, JSON.stringify({ calls, views }));
  try {
    const r = spawnSync(process.execPath,
      [__filename, '--worker', '--job', jobFile, '--out', outFile],
      { stdio: ['ignore', 'ignore', 'inherit'], timeout: 120000 });
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

/** Worker entrypoint: build in a fresh kernel, project each view, emit JSON. */
async function runWorker(jobFile, outFile) {
  const forge = makeHeadlessForge();
  const { dispatchSequence } = await import(BRIDGE_PATH);
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  let result;
  try {
    const { lastHandle, errors } = await dispatchSequence(job.calls, forge);
    if (!lastHandle) {
      result = { ok: false, error: 'no solid body', errors };
    } else if (!forge.drawings || typeof forge.drawings.projectView !== 'function') {
      result = { ok: false, error: 'kernel has no drawings.projectView' };
    } else {
      const views = {};
      for (const dir of job.views) {
        // raw kernel signature: projectView(handle, direction) → {visibleEdges,hiddenEdges,bbox}
        views[dir] = forge.drawings.projectView(lastHandle, dir);
      }
      result = { ok: true, errors, views };
    }
  } catch (e) {
    result = { ok: false, error: e.stack || String(e) };
  }
  fs.writeFileSync(outFile, JSON.stringify(result));
}

// ───────────────────────────────────────────────────────────────────────────
//  Orchestrator
// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  const inPath = arg('--in');
  const outPath = arg('--out');
  const quiet = argv.includes('--quiet');
  const views = (arg('--views') || DEFAULT_VIEWS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!inPath || !outPath) {
    console.error('usage: render_views.mjs --in rows.jsonl --out views.jsonl [--views front,top,right]');
    process.exit(2);
  }

  const raw = fs.readFileSync(inPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  const outLines = [];
  let nOk = 0, nTotal = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let row, calls = [];
    try { row = JSON.parse(line); } catch { continue; }
    try { calls = parseRow(line).calls; } catch { /* leave empty */ }
    const rowId = (row.meta && row.meta.rowId) ?? i;

    let rec;
    if (!calls.length) {
      rec = { rowId, ok: false, error: 'no tool_calls', views: {} };
    } else {
      const res = projectInChild(calls, views);   // fresh child; handles restart at 1
      rec = res.ok
        ? { rowId, ok: true, views: res.views }
        : { rowId, ok: false, error: res.error, views: {} };
    }
    outLines.push(JSON.stringify(rec));
    nTotal++;
    if (rec.ok) nOk++;
    if (!quiet) process.stderr.write(`\r[render_views] ${nTotal}/${lines.length} (ok=${nOk})`);
  }

  fs.writeFileSync(outPath, outLines.join('\n') + (outLines.length ? '\n' : ''));
  if (!quiet) {
    process.stderr.write(`\n[render_views] wrote ${nTotal} view-records → ${outPath}  ok=${nOk}/${nTotal}` +
      ` (${nTotal ? (100 * nOk / nTotal).toFixed(1) : '0'}%)\n`);
  }
}

// Entry: worker vs orchestrator (only auto-runs as program entry, not on import).
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
  main().catch((e) => { console.error('[render_views error]', e.stack || e); process.exit(1); });
}

export { projectInChild };
