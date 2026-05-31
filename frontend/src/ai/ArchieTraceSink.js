// frontend/src/ai/ArchieTraceSink.js — Forge-46
//
// Persists ForgeRunner traces to disk so a run can be replayed, diffed,
// or audited later. Matches the JSONL contract at
// ~/archdisc-Models/runtime/trace.md (one line per run; the line is the
// full trace object).
//
// Two writers:
//   1. Electron renderer — uses `window.forge.trace.write(...)` (preload
//      handles fs access; the renderer has no fs).
//   2. Node-side test/loader — uses `fs.promises.appendFile` directly.
// The module sniffs which world it's in via `typeof window`.
//
// The traces directory defaults to `~/.forge/traces/`. Each calendar day
// gets one `forge-trace-YYYY-MM-DD.jsonl`. Callers can override via the
// `dir` option.

const DAY = (iso) => (iso || new Date().toISOString()).slice(0, 10);

function defaultFilename(trace) {
  return `forge-trace-${DAY(trace?.ts)}.jsonl`;
}

/**
 * Serialize a trace into a single JSONL line + newline. Drops any non-
 * serialisable fields (functions, kernel handles) so the line stays
 * `JSON.parse`-able. Mesh blobs are summarised by vertex count so a
 * 100k-triangle response doesn't bloat the log to GB.
 */
export function serializeTrace(trace) {
  const summariseResp = (r) => {
    if (!r || typeof r !== 'object') return r;
    const out = { ...r };
    if (out.mesh && Array.isArray(out.mesh.positions)) {
      out.mesh = {
        kind: 'mesh-summary',
        vertices: out.mesh.positions.length / 3,
        triangles: (out.mesh.indices?.length || 0) / 3,
        bbox: out.mesh.bbox || null,
      };
    }
    return out;
  };
  const safe = {
    runId: trace.runId,
    ts: trace.ts,
    discipline: trace.discipline,
    prompt: trace.prompt,
    iterations: (trace.iterations || []).map((iter) => ({
      turn: iter.turn,
      completion: iter.completion,
      parsed: iter.parsed ? {
        plan: iter.parsed.plan,
        toolCalls: iter.parsed.toolCalls,
        clarify: iter.parsed.clarify,
      } : null,
      clarifyHandled: iter.clarifyHandled,
      toolResponses: (iter.toolResponses || []).map(summariseResp),
    })),
    final: trace.final,
  };
  return JSON.stringify(safe) + '\n';
}

/**
 * Flush one trace to the day's JSONL file. Best-effort — failures log
 * but never throw (the model is not the place to surface fs problems).
 */
export async function flushTrace(trace, opts = {}) {
  if (!trace || typeof trace !== 'object') return null;
  const line = serializeTrace(trace);
  const filename = opts.filename || defaultFilename(trace);

  // -- Electron renderer path
  if (typeof window !== 'undefined' && window.forge && window.forge.trace) {
    try {
      const out = await window.forge.trace.write(filename, line);
      return { path: out?.path || filename, bytes: line.length };
    } catch (err) {
      console.error('[forge.trace] renderer flush failed:', err.message);
      return null;
    }
  }

  // -- Node path (tests, headless CLI, jsx-loader)
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const dir = opts.dir || path.join(os.homedir(), '.forge', 'traces');
    await fs.mkdir(dir, { recursive: true });
    const full = path.join(dir, filename);
    await fs.appendFile(full, line, 'utf8');
    return { path: full, bytes: line.length };
  } catch (err) {
    console.error('[forge.trace] node flush failed:', err.message);
    return null;
  }
}
