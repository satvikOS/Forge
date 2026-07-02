#!/usr/bin/env node
/**
 * realparts_draw_worker.mjs — STAGE A of the real-parts drawing corpus.
 *
 * A PERSISTENT worker: loads the native kernel ONCE, then for each task in its
 * shard rebuilds meta.render_seq and HLR-projects front/top/right/iso, streaming
 * one NDJSON view-record per row to fd 3 (or --out file) for the PIL rasterizer
 * (realparts_render_sheet.py) to compose into a CADGenBench-style sheet.
 *
 * HANDLE ISOLATION WITHOUT PER-ROW PROCESS SPAWN:
 *   The kernel's handle counter is process-global + monotonic (no reset). The
 *   corpus encodes handles as "count up from 1 per row". Instead of a fresh node
 *   child per row (slow: re-loads OCCT each time), this worker stays warm and
 *   REMAPS each row's handle-valued args (shape, a, b — the ONLY handle keys in
 *   this corpus) by a per-row base = the live counter just before the row, read
 *   via a throwaway probe box. PROVEN EQUIVALENT to fresh-process isolation
 *   (bbox/volume identical). After each row every handle in [base, after] is
 *   `release`d, so the registry stays small (build time stays flat).
 *
 * Tasks file (NDJSON, one per line): { id, family, asst, png, calls }
 *   calls = the build-only render_seq (io.export-step / part.check-validity
 *   stripped). asst = the corpus assistant message (build-seq), passed through.
 *
 * Out record (NDJSON to fd 3): { id, family, asst, png, ok, dims:{x,y,z},
 *   views:{ front, top, right, iso } }  with each view straight off the kernel
 *   drawings.projectView -> { visibleEdges, hiddenEdges, bbox }.
 *
 * USAGE:
 *   node realparts_draw_worker.mjs --tasks shard.jsonl            # NDJSON -> fd 3
 *   node realparts_draw_worker.mjs --tasks shard.jsonl --out f    # NDJSON -> file
 */
import fs from 'fs';
import readline from 'readline';
import { makeHeadlessForge } from './cadscore_harness.mjs';

const BRIDGE = '/Users/account_clawteam1/archdisc-Mech/frontend/src/ai/ForgeToolBridge.js';
const VIEWS = ['front', 'top', 'right', 'iso'];
const HKEYS = ['shape', 'a', 'b'];
const DROP = new Set(['io.export-step', 'part.check-validity', 'part.mass-properties', 'part.tessellate']);

const argv = process.argv.slice(2);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const TASKS = arg('--tasks');
const OUTFILE = arg('--out');           // if set, write NDJSON here; else fd 3

function remap(calls, base) {
  return calls.map((c) => {
    const a = { ...(c.arguments || {}) };
    for (const k of HKEYS) if (typeof a[k] === 'number') a[k] += base;
    return { name: c.name, arguments: a };
  });
}

function viewBoundsDims(views) {
  const ext = (v) => {
    const b = v && v.bbox;
    if (!b) return null;
    return { w: b.maxX - b.minX, h: b.maxY - b.minY };
  };
  const f = ext(views.front), t = ext(views.top), r = ext(views.right);
  const x = (f && f.w) || (t && t.w) || 1;
  const z = (f && f.h) || (r && r.h) || 1;
  const y = (r && r.w) || (t && t.h) || 1;
  return { x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3) };
}

async function main() {
  const forge = makeHeadlessForge();
  const { dispatchSequence } = await import(BRIDGE);
  const probe = () => forge.makeBox(1, 1, 1);   // returns the live counter value

  // output sink: a WriteStream on fd 3 (or --out file) with backpressure.
  const out = OUTFILE ? fs.createWriteStream(OUTFILE) : fs.createWriteStream(null, { fd: 3 });
  // If the downstream rasterizer goes away (pipe closes / OOM-killed), writing to
  // fd 3 raises EPIPE. Handle it gracefully (exit clean) instead of crashing with
  // an unhandled 'error' — the run is resumable (PNG-existence skip), so a re-run
  // resumes exactly where this shard stopped.
  let broken = false;
  out.on('error', (e) => {
    broken = true;
    process.stderr.write(`\n[worker ${String(TASKS).split('/').pop()}] downstream pipe closed (${e.code || e.message}); exiting for resume\n`);
    process.exit(0);
  });
  const write = (s) => new Promise((res) => {
    if (broken) return res();
    if (!out.write(s)) out.once('drain', res); else res();
  });

  // bound this process's lifetime to MAX_RENDER actual renders, then exit cleanly,
  // so OCCT/heap growth over a long shard can't accumulate to an OS OOM-kill. The
  // orchestrator relaunches (resume skips done PNGs) until the shard is exhausted.
  const MAX_RENDER = parseInt(arg('--max-render') || '0', 10) || Infinity;
  const rl = readline.createInterface({ input: fs.createReadStream(TASKS), crlfDelay: Infinity });
  let n = 0, ok = 0, fail = 0, rendered = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let task;
    try { task = JSON.parse(line); } catch { continue; }
    n++;
    // resume: skip rows whose PNG already exists (idempotent re-runs).
    if (task.png && fs.existsSync(task.png)) { ok++; continue; }
    if (rendered >= MAX_RENDER) break;          // hand off to a fresh process
    rendered++;
    const calls = (task.calls || []).filter((c) => !DROP.has(c.name));
    const base = probe();
    let rec;
    try {
      const { lastHandle, current } = await dispatchSequence(remap(calls, base), forge);
      const h = (typeof current === 'number' && current > 0) ? current : lastHandle;
      if (!h) {
        rec = { id: task.id, family: task.family, png: task.png, ok: false, err: 'no body' };
        fail++;
      } else {
        const views = {};
        for (const v of VIEWS) {
          try { views[v] = forge.drawings.projectView(h, v); }
          catch (e) { views[v] = null; }
        }
        const dims = viewBoundsDims(views);
        rec = { id: task.id, family: task.family, asst: task.asst, png: task.png,
                ok: true, dims, views };
        ok++;
      }
    } catch (e) {
      rec = { id: task.id, family: task.family, png: task.png, ok: false, err: e.message || String(e) };
      fail++;
    }
    // release everything allocated since the probe (keeps the registry small).
    const after = probe();
    for (let x = base; x <= after; x++) { try { forge.release(x); } catch { /* ignore */ } }

    await write(JSON.stringify(rec) + '\n');
    if (n % 20 === 0) process.stderr.write(`[worker ${TASKS.split('/').pop()}] ${n} ok=${ok} fail=${fail}\r`);
  }
  await new Promise((res) => out.end(res));
  process.stderr.write(`\n[worker ${TASKS.split('/').pop()}] DONE ${n} rows ok=${ok} fail=${fail}\n`);
}

main().catch((e) => { process.stderr.write('[worker fatal] ' + (e.stack || e) + '\n'); process.exit(1); });
