import assert from 'node:assert/strict';
import { ArchieThreadStore } from '../ArchieThreadStore.js';

function memBackend() {
  const m = new Map();
  return {
    get: (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
    set: (k, v) => m.set(k, JSON.stringify(v)),
    del: (k) => m.delete(k),
  };
}

// create + index + load round-trip
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({ projectId: 'proj-1', discipline: 'simulate', model: 'archie-7b-base' });
  assert.ok(t.id);
  assert.equal(t.discipline, 'simulate');
  const idx = store.index();
  assert.equal(idx.length, 1);
  assert.equal(idx[0].id, t.id);

  const back = store.load(t.id);
  assert.equal(back.discipline, 'simulate');
}

// user + archie messages stream
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({ projectId: 'p' });

  store.appendUserMessage(t, 'Make a 10 mm cube', []);
  assert.equal(t.messages.length, 1);
  assert.equal(t.messages[0].role, 'user');
  assert.equal(t.title.startsWith('Make a 10 mm cube'), true,
               'title auto-derives from first user message');

  const msg = store.startArchieMessage(t);
  store.appendSegment(t, msg.id, { kind: 'plan', plan: { goal: 'cube' } });
  store.appendSegment(t, msg.id, { kind: 'tool_call', call: { name: 'part.make-box', arguments: { dx:10,dy:10,dz:10 } }, status: 'done', response: { ok: true } });
  store.appendSegment(t, msg.id, { kind: 'text', text: 'Done.' });
  store.finalizeArchieMessage(t, msg.id, 'done');

  assert.equal(t.messages[1].segments.length, 3);
  assert.equal(t.messages[1].status, 'done');
}

// pinning + project lookup
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const a = store.create({ projectId: 'p1' });
  const b = store.create({ projectId: 'p1' });
  const c = store.create({ projectId: 'p2' });
  store.setPinned(a, true);
  store.setPinned(c, true);
  assert.equal(store.pinnedForProject('p1').length, 1);
  assert.equal(store.pinnedForProject('p2').length, 1);
}

// delete drops the thread + its index entry
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({});
  store.delete(t.id);
  assert.equal(store.load(t.id), null);
  assert.equal(store.index().length, 0);
}

// markdown export covers each segment kind
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  const t = store.create({});
  store.appendUserMessage(t, 'Build something');
  const m = store.startArchieMessage(t);
  store.appendSegment(t, m.id, { kind: 'plan', plan: { goal: 'g' } });
  store.appendSegment(t, m.id, { kind: 'tool_call', call: { name: 'x', arguments: {} }, response: { ok: true } });
  store.appendSegment(t, m.id, { kind: 'text', text: 'Done.' });
  const md = store.exportMarkdown(t);
  assert.ok(md.includes('# '));
  assert.ok(md.includes('Build something'));
  assert.ok(md.includes('**Plan**'));
  assert.ok(md.includes('Done.'));
}

// onChange listener fires
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  let n = 0;
  const off = store.onChange(() => { n++; });
  store.create({});
  store.create({});
  off();
  store.create({});
  assert.equal(n, 2);
}

console.log('[archie.ThreadStore] all tests passed');
