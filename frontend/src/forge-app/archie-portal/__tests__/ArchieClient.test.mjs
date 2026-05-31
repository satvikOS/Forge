import assert from 'node:assert/strict';
import { ArchieThreadStore } from '../ArchieThreadStore.js';
import { ArchieClient } from '../ArchieClient.js';

function memBackend() {
  const m = new Map();
  return {
    get: (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
    set: (k, v) => m.set(k, JSON.stringify(v)),
    del: (k) => m.delete(k),
  };
}

// 1) A normal two-iteration run emits user message + archie message with
//    plan + tool_call + text segments, in order.
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({});
  const mockRun = async ({ onTrace }) => {
    onTrace({
      kind: 'tool',
      call: { name: 'part.make-box', arguments: { dx: 1, dy: 1, dz: 1 } },
      response: { ok: true, tool: 'part.make-box', produces: 'handle', result: { shape: 7 } },
    });
    onTrace({
      kind: 'done',
      iter: {
        completion: '<plan>{"goal":"cube"}</plan>\nDone.',
        parsed: { think: [], plan: { goal: 'cube' }, toolCalls: [], clarify: null },
      },
    });
    return { final: { status: 'done' } };
  };
  const client = new ArchieClient({ store, run: mockRun, forge: {} });
  await client.send({ threadId: t.id, prompt: 'cube it' });
  const fresh = store.load(t.id);
  assert.equal(fresh.messages.length, 2);
  const segs = fresh.messages[1].segments.map((s) => s.kind);
  assert.deepEqual(segs, ['tool_call', 'plan', 'text']);
  assert.equal(fresh.messages[1].status, 'done');
}

// 2) AbortController cancels mid-stream; status flips to 'cancelled'.
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({});
  const mockRun = async ({ signal }) => {
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
      });
    });
  };
  const client = new ArchieClient({ store, run: mockRun, forge: {} });
  const ac = new AbortController();
  const promise = client.send({ threadId: t.id, prompt: 'long task', signal: ac.signal });
  ac.abort();
  await promise.catch(() => {});
  const fresh = store.load(t.id);
  assert.equal(fresh.messages.at(-1).status, 'cancelled');
}

// 3) Mesh responses are summarised — no giant typed arrays in storage.
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({});
  const huge = new Float32Array(100000);
  const mockRun = async ({ onTrace }) => {
    onTrace({
      kind: 'tool',
      call: { name: 'part.tessellate', arguments: { shape: 1 } },
      response: { ok: true, tool: 'part.tessellate', produces: 'mesh',
        result: { positions: huge, normals: huge, triangleCount: 12, vertexCount: 24 } },
    });
    onTrace({ kind: 'done', iter: { completion: '', parsed: {} } });
    return { final: { status: 'done' } };
  };
  const client = new ArchieClient({ store, run: mockRun, forge: {} });
  await client.send({ threadId: t.id, prompt: 'mesh it' });
  const fresh = store.load(t.id);
  const seg = fresh.messages[1].segments[0];
  assert.equal(seg.response.result.kind, 'mesh');
  assert.equal(seg.response.result.triangleCount, 12);
  assert.equal(seg.response.result.positions, undefined,
               'raw positions buffer must not survive in storage');
}

// 4) Destructive tools land in 'awaiting-confirm' status when the
//    onConfirmDestructive callback returns false.
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({});
  const mockRun = async ({ onTrace }) => {
    onTrace({
      kind: 'tool',
      call: { name: 'io.exportStep', arguments: { path: '/tmp/x.step' } },
      response: { ok: true, tool: 'io.exportStep' },
    });
    onTrace({ kind: 'done', iter: { completion: '', parsed: {} } });
    return { final: { status: 'done' } };
  };
  const client = new ArchieClient({
    store, run: mockRun, forge: {},
    onConfirmDestructive: () => false,
  });
  await client.send({ threadId: t.id, prompt: 'export' });
  const fresh = store.load(t.id);
  const seg = fresh.messages[1].segments[0];
  assert.equal(seg.kind, 'tool_call');
  assert.equal(seg.status, 'cancelled');
}

console.log('[archie.Client] all tests passed');
