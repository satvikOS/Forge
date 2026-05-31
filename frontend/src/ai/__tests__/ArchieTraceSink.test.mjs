import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { serializeTrace, flushTrace } from '../ArchieTraceSink.js';

// serializeTrace produces a single newline-terminated JSON line.
{
  const trace = {
    runId: 'forge-test-1',
    ts: '2026-05-31T18:00:00.000Z',
    discipline: 'part',
    prompt: 'make a 10mm cube',
    iterations: [{
      turn: 0,
      completion: '<plan>...</plan><tool_call>{"name":"makeBox","arguments":{"dx":10,"dy":10,"dz":10}}</tool_call>',
      parsed: { plan: '...', toolCalls: [{ name: 'makeBox', arguments: { dx: 10, dy: 10, dz: 10 } }] },
      toolResponses: [{
        ok: true,
        mesh: {
          positions: new Array(300).fill(0),   // 100 vertices
          indices:   new Array(150).fill(0),   //  50 triangles
          bbox: [0, 0, 0, 10, 10, 10],
        },
      }],
    }],
    final: { status: 'done', text: 'Built a 10mm cube.' },
  };
  const line = serializeTrace(trace);
  assert.ok(line.endsWith('\n'), 'JSONL terminator');
  const parsed = JSON.parse(line);
  assert.equal(parsed.runId, 'forge-test-1');
  // Mesh summarised, not inlined.
  const resp = parsed.iterations[0].toolResponses[0];
  assert.equal(resp.mesh.kind, 'mesh-summary');
  assert.equal(resp.mesh.vertices, 100);
  assert.equal(resp.mesh.triangles, 50);
  assert.deepEqual(resp.mesh.bbox, [0, 0, 0, 10, 10, 10]);
  // Final intact.
  assert.equal(parsed.final.status, 'done');
}

// flushTrace appends to <dir>/forge-trace-YYYY-MM-DD.jsonl and returns
// {path, bytes}.
{
  const dir = path.join(os.tmpdir(), 'forge-trace-test-' + Date.now());
  const trace = {
    runId: 'forge-test-2',
    ts: '2026-05-31T19:00:00.000Z',
    discipline: 'assembly',
    prompt: 'mate the two blocks',
    iterations: [],
    final: { status: 'done', text: 'ok' },
  };
  const result = await flushTrace(trace, { dir });
  assert.ok(result, 'flushTrace returned a result');
  assert.ok(result.path.endsWith('forge-trace-2026-05-31.jsonl'),
            `unexpected path ${result.path}`);
  const text = await fs.readFile(result.path, 'utf8');
  assert.ok(text.includes('"runId":"forge-test-2"'));

  // A second flush should append, not overwrite.
  const result2 = await flushTrace({ ...trace, runId: 'forge-test-3' }, { dir });
  const text2 = await fs.readFile(result2.path, 'utf8');
  assert.equal(text2.split('\n').filter(Boolean).length, 2,
               'two JSONL lines after second flush');

  await fs.rm(dir, { recursive: true, force: true });
}

console.log('[forge.archie-trace-sink] all tests passed');
