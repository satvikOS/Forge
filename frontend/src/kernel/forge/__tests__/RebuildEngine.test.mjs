import assert from 'node:assert/strict';
import { FeatureTree } from '../FeatureTree.js';
import { RebuildEngine, inputHashFor, fnv1a } from '../RebuildEngine.js';

// Stub executor counter — every kind shares one counter so a test can
// assert "only N nodes re-ran" after an edit.
function makeExecutors(calls) {
  return {
    box: ({ feature }) => {
      calls.push(feature.id);
      // Return a synthetic ShapeHandle (any non-null value works).
      return 10 + parseInt(feature.id.split('-')[1], 10);
    },
    extrude: ({ feature, inputs }) => {
      calls.push(feature.id);
      return inputs[0] * 1000 + (feature.params.depth || 1);
    },
    fillet: ({ feature, inputs }) => {
      calls.push(feature.id);
      return -inputs[0] * (feature.params.radius || 1);
    },
  };
}

// ---- initial rebuild executes every node ----------------------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'box', params: { dx: 1, dy: 1, dz: 1 } });
  const b = t.add({ kind: 'extrude', params: { depth: 5 }, dependsOn: [a.id] });
  const c = t.add({ kind: 'fillet',  params: { radius: 1 }, dependsOn: [b.id] });

  const calls = [];
  const eng = new RebuildEngine(t, makeExecutors(calls));
  const r = await eng.rebuild();
  assert.deepEqual(r.ranIds, [a.id, b.id, c.id], 'first rebuild runs all');
  assert.equal(r.skippedIds.length, 0);
  assert.equal(calls.length, 3);
  assert.equal(eng.stats.executions, 3);
  assert.equal(eng.stats.cacheHits, 0);
  assert.equal(a.outputHandle !== null && b.outputHandle !== null && c.outputHandle !== null, true);
  eng.detach();
}

// ---- second rebuild with no edits hits cache entirely ----------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'box', params: { dx: 1, dy: 1, dz: 1 } });
  const b = t.add({ kind: 'extrude', params: { depth: 5 }, dependsOn: [a.id] });
  const c = t.add({ kind: 'fillet',  params: { radius: 1 }, dependsOn: [b.id] });

  const calls = [];
  const eng = new RebuildEngine(t, makeExecutors(calls));
  await eng.rebuild();
  calls.length = 0;

  const r = await eng.rebuild();
  assert.equal(r.ranIds.length, 0, 'second rebuild runs nothing');
  assert.deepEqual(r.skippedIds, [a.id, b.id, c.id]);
  assert.equal(calls.length, 0);
  assert.equal(eng.stats.cacheHits, 3);
  eng.detach();
}

// ---- editing a leaf re-runs only that leaf --------------------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'box', params: { dx: 1, dy: 1, dz: 1 } });
  const b = t.add({ kind: 'extrude', params: { depth: 5 }, dependsOn: [a.id] });
  const c = t.add({ kind: 'fillet',  params: { radius: 1 }, dependsOn: [b.id] });

  const calls = [];
  const eng = new RebuildEngine(t, makeExecutors(calls));
  await eng.rebuild();
  calls.length = 0;

  // Edit only the leaf (c). Engine listens to tree.onChange and marks c
  // dirty. a + b should hit cache; c re-executes.
  t.edit(c.id, { radius: 2 });
  const r = await eng.rebuild();
  assert.deepEqual(r.ranIds, [c.id], 'only edited leaf reruns');
  assert.deepEqual(r.skippedIds, [a.id, b.id], 'upstream cached');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], c.id);
  eng.detach();
}

// ---- editing an upstream re-runs that node + downstream -------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'box', params: { dx: 1, dy: 1, dz: 1 } });
  const b = t.add({ kind: 'extrude', params: { depth: 5 }, dependsOn: [a.id] });
  const c = t.add({ kind: 'fillet',  params: { radius: 1 }, dependsOn: [b.id] });
  // sibling chain that doesn't depend on a — must stay cached on edit of a.
  const d = t.add({ kind: 'box', params: { dx: 9, dy: 9, dz: 9 } });

  const calls = [];
  const eng = new RebuildEngine(t, makeExecutors(calls));
  await eng.rebuild();
  calls.length = 0;

  t.edit(a.id, { dx: 7 });
  const r = await eng.rebuild();
  // a, b, c rerun; d skipped.
  assert.deepEqual(r.ranIds.sort(), [a.id, b.id, c.id].sort());
  assert.deepEqual(r.skippedIds, [d.id]);
  assert.equal(calls.length, 3);
  eng.detach();
}

// ---- inputHashFor sanity --------------------------------------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'box', params: { dx: 1, dy: 1, dz: 1 } });
  const h1 = inputHashFor(a, t);
  a.params.dx = 2;
  const h2 = inputHashFor(a, t);
  assert.notEqual(h1, h2, 'param change should change input hash');
  // FNV-1a is order-stable across strings.
  assert.equal(fnv1a('forge'), fnv1a('forge'));
}

console.log('[forge.RebuildEngine] all tests passed');
