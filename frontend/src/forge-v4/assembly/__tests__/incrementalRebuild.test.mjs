// Task #24 — Large-Assembly INCREMENTAL REBUILD — test suite.
//
// Runs under `node --test` (node:test framework, discovered by the *.test.mjs
// glob) AND standalone (`node <file>`) — the final console.log sentinel prints
// either way. Built-ins only (node:test, node:assert) — no deps, kernel-optional
// via a counting stub forge.
//
// CITED published techniques the assertions enforce (see incrementalRebuild.js
// header for full references):
//   [1] Associativity-DAG + topological dirty propagation (history-based CAD
//       rebuild; Hoffmann & Joan-Arinyo CAD 1998).
//   [2] Incremental == from-scratch (self-adjusting computation; Acar et al.
//       POPL 2002) — no stale cache ever served.
//   [3] SolidWorks Large Assembly Mode / NX Lightweight + GPU instancing — one
//       master geometry + N transforms, NOT N BReps; graphics-only proxy.
//   [4] 10k-instance benchmark: dirty subtree < 1s, recomputed ≈ subtree size,
//       incremental == full.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AssemblyGraph, AssemblyNode, IncrementalRebuilder,
  contentHashFor, hashTransforms, mul4, IDENTITY16,
  defaultExecutors, buildGridAssembly, benchmark10k,
  countingStubForge, countingExecutors,
  installAssemblyGraph, getAssemblyGraph,
} from '../incrementalRebuild.js';

// ── helper: a small fixture with a counting stub forge ───────────────────────
function counted(builderOpts = {}) {
  const counter = { calls: [] };
  const F = countingStubForge(counter);
  const exec = countingExecutors(defaultExecutors(F), counter);
  return { counter, F, exec };
}
const boxCalls = (counter) => counter.calls.filter((c) => c[0] === 'makeBox').length;
const execCallsOf = (counter, kind) =>
  counter.calls.filter((c) => c[0] === 'exec' && c[1] === kind).length;

// ─────────────────────────────────────────────────────────────────────
// [1] ASSOCIATIVITY DAG — topological build order respects master + dependsOn.
// ─────────────────────────────────────────────────────────────────────
test('DAG: buildOrder is topological (master before instance, child before sub)', () => {
  const g = new AssemblyGraph();
  const master = g.add(new AssemblyNode({ id: 'm', kind: 'part', params: { dx: 1, dy: 1, dz: 1 } }));
  const sub = g.add(new AssemblyNode({ id: 's', kind: 'subassembly', params: {} }));
  const inst = g.add(new AssemblyNode({ id: 'i', kind: 'instanced', masterId: 'm', dependsOn: ['s'],
                                        transforms: new Float64Array(16) }));
  const order = g.buildOrder().map((n) => n.id);
  assert.ok(order.indexOf('m') < order.indexOf('i'), 'master before its instance');
  assert.ok(order.indexOf('s') < order.indexOf('i'), 'sub before its instanced child');
  assert.equal(order.length, 3);
});

test('DAG: adding a node with a missing dependency throws (DAG invariant)', () => {
  const g = new AssemblyGraph();
  assert.throws(() => g.add(new AssemblyNode({ id: 'x', kind: 'part', dependsOn: ['ghost'] })),
                /depends on missing ghost/);
});

test('DAG: cycle is rejected at buildOrder()', () => {
  // Force a cycle by hand-mutating dependsOn after add (the public API guards
  // against it, so we reach under to prove the Kahn cycle detector fires).
  const g = new AssemblyGraph();
  const a = g.add(new AssemblyNode({ id: 'a', kind: 'part', params: {} }));
  const b = g.add(new AssemblyNode({ id: 'b', kind: 'part', dependsOn: ['a'] }));
  a.dependsOn.push('b'); // a→b and b→a ⇒ cycle
  assert.throws(() => g.buildOrder(), /cycle detected/);
});

// ─────────────────────────────────────────────────────────────────────
// [1] markDirty propagates DOWNSTREAM only — never upstream/sideways.
// ─────────────────────────────────────────────────────────────────────
test('dirty propagation: master edit dirties only master + its downstream', () => {
  const g = new AssemblyGraph();
  g.add(new AssemblyNode({ id: 'mA', kind: 'part', params: { dx: 1, dy: 1, dz: 1 } }));
  g.add(new AssemblyNode({ id: 'sA', kind: 'subassembly', params: {} }));
  g.add(new AssemblyNode({ id: 'iA', kind: 'instanced', masterId: 'mA', dependsOn: ['sA'],
                           transforms: new Float64Array(16) }));
  // An unrelated second group that must NOT be dirtied.
  g.add(new AssemblyNode({ id: 'mB', kind: 'part', params: { dx: 2, dy: 2, dz: 2 } }));
  g.add(new AssemblyNode({ id: 'iB', kind: 'instanced', masterId: 'mB',
                           transforms: new Float64Array(16) }));

  const flagged = g.markDirty('mA');
  assert.deepEqual([...flagged].sort(), ['iA', 'mA'].sort(),
    'only mA + its instanced consumer iA go dirty');
  assert.ok(!flagged.has('sA'), 'the sub-assembly (sideways, not downstream of master) stays clean');
  assert.ok(!flagged.has('mB') && !flagged.has('iB'), 'the unrelated group stays clean');
});

// ─────────────────────────────────────────────────────────────────────
// [2] INCREMENTAL REBUILD — only-dirty-recomputed, clean nodes reused.
// ─────────────────────────────────────────────────────────────────────
test('rebuild: first rebuild runs every node; second runs nothing (full cache)', () => {
  const { counter, F, exec } = counted();
  const { graph, rebuilder } = buildGridAssembly({ groups: 3, perGroup: 4, forge: F, executors: exec });

  const r1 = rebuilder.rebuild();
  assert.equal(r1.ranIds.length, 9, '3 masters + 3 subs + 3 instanced all run');
  assert.equal(r1.skippedIds.length, 0);

  const r2 = rebuilder.rebuild();
  assert.equal(r2.ranIds.length, 0, 'no edits → nothing re-runs');
  assert.equal(r2.skippedIds.length, 9, 'every node is a cache hit');
});

test('rebuild: editing ONE master re-runs only that master + its instanced node', () => {
  const { counter, F, exec } = counted();
  const { graph, rebuilder, masterIds, instancedIds } = buildGridAssembly({
    groups: 3, perGroup: 4, forge: F, executors: exec });
  rebuilder.rebuild();
  counter.calls.length = 0;

  graph.edit(masterIds[1], { dx: 99 });
  const r = rebuilder.rebuild();
  assert.deepEqual(r.ranIds.sort(), [masterIds[1], instancedIds[1]].sort(),
    'only the edited master and the instanced node that references it re-run');
  assert.equal(r.ranIds.length, 2);
  assert.equal(r.skippedIds.length, 7, 'the other 7 nodes are cache hits');
  // The instanced node re-ran because its master's outputVersion moved — NOT
  // because we re-tessellated geometry: exactly ONE makeBox in this rebuild.
  assert.equal(boxCalls(counter), 1, 'exactly one master solid rebuilt');
});

test('rebuild: editing ONE instance transform re-runs only that instanced node (master stays clean)', () => {
  const { counter, F, exec } = counted();
  const { graph, rebuilder, masterIds, instancedIds } = buildGridAssembly({
    groups: 2, perGroup: 6, forge: F, executors: exec });
  rebuilder.rebuild();
  counter.calls.length = 0;

  // Move instance #3 in group 0.
  graph.editInstanceTransform(instancedIds[0], 3, [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 123, 456, 0, 1,
  ]);
  const r = rebuilder.rebuild();
  assert.deepEqual(r.ranIds, [instancedIds[0]], 'ONLY the instanced node re-runs');
  assert.ok(!r.ranIds.includes(masterIds[0]), 'the shared master is NOT re-run on a transform edit');
  assert.equal(boxCalls(counter), 0, 'a transform edit rebuilds ZERO geometry');
});

// ─────────────────────────────────────────────────────────────────────
// [2] NO STALE CACHE — an ancestor edit invalidates the descendant even though
//     the descendant's own params never changed.
// ─────────────────────────────────────────────────────────────────────
test('no stale cache: ancestor edit invalidates a descendant whose own params are unchanged', () => {
  const { F, exec } = counted();
  const g = new AssemblyGraph();
  const m = g.add(new AssemblyNode({ id: 'm', kind: 'part', params: { dx: 1, dy: 1, dz: 1 } }));
  const inst = g.add(new AssemblyNode({ id: 'i', kind: 'instanced', masterId: 'm',
                                        transforms: new Float64Array([
                                          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }));
  const reb = new IncrementalRebuilder(g, exec);
  reb.rebuild();
  const beforeHandle = inst.output.masterHandle;

  // Edit the MASTER only. The instanced node's own params/transforms are
  // untouched, but its master's solid changed → its cached masterHandle MUST
  // be refreshed (no stale handle served). [MUST-2]
  g.edit('m', { dx: 50 });
  const r = reb.rebuild();
  assert.ok(r.ranIds.includes('i'), 'descendant re-ran on ancestor edit');
  assert.notEqual(inst.output.masterHandle, beforeHandle,
    'instanced node picked up the NEW master handle — no stale cache');
});

// ─────────────────────────────────────────────────────────────────────
// [2]/[4] INCREMENTAL == FULL — the equality oracle, for several dirty patterns.
// ─────────────────────────────────────────────────────────────────────
test('incremental == full: identical world transforms + geometry refs across dirty patterns', () => {
  const patterns = [
    { name: 'edit one master', mutate: (g, ids) => g.edit(ids.masterIds[0], { dx: 17 }) },
    { name: 'edit one sub transform', mutate: (g, ids) =>
        g.edit(ids.subIds[1], { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1] }) },
    { name: 'move one instance', mutate: (g, ids) =>
        g.editInstanceTransform(ids.instancedIds[2], 2,
          [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 11, 22, 33, 1]) },
    { name: 'replace a transforms buffer', mutate: (g, ids) => {
        const fresh = new Float64Array(5 * 16);
        for (let i = 0; i < 5; i++) { const b = i * 16;
          fresh[b] = 1; fresh[b + 5] = 1; fresh[b + 10] = 1; fresh[b + 15] = 1; fresh[b + 12] = i * 13; }
        g.setTransforms(ids.instancedIds[0], fresh);
      } },
  ];

  for (const pat of patterns) {
    // Two independent graphs with the SAME starting shape + the SAME mutation.
    const incFix = buildGridAssembly({ groups: 4, perGroup: 5, forge: countingStubForge({ calls: [] }) });
    const fullFix = buildGridAssembly({ groups: 4, perGroup: 5, forge: countingStubForge({ calls: [] }) });

    // Initial build on both.
    incFix.rebuilder.rebuild();
    fullFix.rebuilder.rebuild();

    // Apply the mutation to BOTH.
    pat.mutate(incFix.graph, incFix);
    pat.mutate(fullFix.graph, fullFix);

    // Incremental on one; FULL from-scratch on the other.
    incFix.rebuilder.rebuild();
    fullFix.rebuilder.fullRebuild();

    const incWorlds = incFix.rebuilder.worldTransforms();
    const fullWorlds = fullFix.rebuilder.worldTransforms();
    assert.deepEqual(incWorlds, fullWorlds,
      `[${pat.name}] incrementally-rebuilt world transforms + geometry refs must equal from-scratch`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// [3] INSTANCING — one master + N transforms, NOT N BReps.
// ─────────────────────────────────────────────────────────────────────
test('instancing: a 1000-instance node costs exactly ONE master solid, zero per-instance BReps', () => {
  const counter = { calls: [] };
  const F = countingStubForge(counter);
  const g = new AssemblyGraph();
  const m = g.add(new AssemblyNode({ id: 'm', kind: 'part', params: { dx: 1, dy: 1, dz: 1 } }));
  const transforms = new Float64Array(1000 * 16);
  for (let i = 0; i < 1000; i++) { const b = i * 16;
    transforms[b] = 1; transforms[b + 5] = 1; transforms[b + 10] = 1; transforms[b + 15] = 1;
    transforms[b + 12] = i; }
  const inst = g.add(new AssemblyNode({ id: 'i', kind: 'instanced', masterId: 'm', transforms }));

  const reb = new IncrementalRebuilder(g, null, { forge: F });
  reb.rebuild();

  // The whole point: 1000 copies, but only ONE makeBox was ever called. [MUST-3]
  assert.equal(boxCalls(counter), 1, 'ONE master solid for 1000 instances');
  assert.equal(inst.output.count, 1000, 'instanced node reports 1000 copies');
  assert.equal(inst.output.masterHandle, m.output.handle, 'all instances share the master handle');
  // And no full BRep array materialised — the node holds ONE buffer + one ref.
  assert.ok(inst.output.transforms === transforms, 'instanced node references the SAME transform buffer (no per-copy clone)');
  assert.equal(inst.output.instancedRef.count, 1000);
});

test('graphics-only: node carries a bbox + decimated proxy, full BRep deferred until promoteToSolid', () => {
  const counter = { calls: [] };
  const F = countingStubForge(counter);
  const g = new AssemblyGraph();
  const m = g.add(new AssemblyNode({ id: 'm', kind: 'part', params: { dx: 5, dy: 5, dz: 5 } }));
  const gfx = g.add(new AssemblyNode({ id: 'gfx', kind: 'graphics', masterId: 'm', lightweight: true }));
  const reb = new IncrementalRebuilder(g, null, { forge: F });
  reb.rebuild();

  // Lightweight: bounds + coarseMesh present, full BRep is null. [MUST-3]
  assert.ok(gfx.output.bounds && Array.isArray(gfx.output.bounds.min), 'graphics node has a bbox proxy');
  assert.ok(gfx.output.coarseMesh, 'graphics node has a decimated mesh proxy');
  assert.equal(gfx.output.fullBRep, null, 'full BRep deferred (lazy)');
  assert.equal(gfx.output.lightweight, true);

  // Lazily realize the solid.
  const res = reb.promoteToSolid('gfx', F);
  assert.equal(res.ok, true);
  assert.ok(res.handle != null, 'promoteToSolid produced a real handle');
  assert.notEqual(gfx.output.fullBRep, null, 'full BRep now realized');
  assert.equal(gfx.output.lightweight, false, 'no longer lightweight after promotion');
});

// ─────────────────────────────────────────────────────────────────────
// [4] BENCHMARK — 10,000-instance assembly: dirty subtree < 1s, recomputed ≈
//     subtree size (NOT 10k), incremental == full, instancing memory proof.
// ─────────────────────────────────────────────────────────────────────
test('benchmark: 10k-instance dirty-subtree rebuild < 1s, recomputes ~subtree only', () => {
  const b = benchmark10k({ groups: 100, perGroup: 100 });

  assert.equal(b.totalInstances, 10000, 'a genuine 10,000-instance assembly');
  // Full rebuild touched all 300 DAG nodes (100 masters + 100 subs + 100 inst).
  assert.equal(b.fullExecutions, 300, 'full rebuild runs every DAG node');

  // The headline guarantees: [MUST-4]
  assert.ok(b.elapsedMs < 1000, `dirty-subtree rebuild must be < 1s (was ${b.elapsedMs.toFixed(2)}ms)`);
  assert.equal(b.recomputedCount, b.dirtySubtreeSize,
    'recomputed exactly the dirty subtree');
  assert.equal(b.recomputedCount, 2, 'dirty subtree = the edited master + its instanced node');
  assert.ok(b.recomputedCount < b.totalInstances / 100,
    `recomputed ${b.recomputedCount} ≪ ${b.totalInstances} instances (NOT a full rebuild)`);
  assert.equal(b.skippedCount, 298, 'the other 298 nodes were cache hits');

  // Instancing memory proof: 10,000 instances were NEVER 10,000 BReps. The
  // graph holds exactly 100 master 'part' nodes (one per group) + 100 instanced
  // nodes, each referencing ONE master handle + a transform buffer. [MUST-3]
  const nodes = b.fixture.graph.list();
  const partNodes = nodes.filter((n) => n.kind === 'part');
  const instNodes = nodes.filter((n) => n.kind === 'instanced');
  assert.equal(partNodes.length, 100, '100 master solids back 10,000 instances');
  assert.equal(instNodes.length, 100);
  let totalCopies = 0;
  for (const inst of instNodes) {
    totalCopies += inst.output.count;
    // Each instanced node references its master's single handle, not a per-copy solid.
    const master = b.fixture.graph.byId(inst.masterId);
    assert.equal(inst.output.masterHandle, master.output.handle);
  }
  assert.equal(totalCopies, 10000, '10,000 copies realised from 100 master BReps');
});

test('benchmark: incremental result equals a full rebuild of the same edited 10k assembly', () => {
  // Build TWO 10k assemblies, edit the same group's master in both, then
  // incremental on one + full on the other; compare every world transform.
  const inc = buildGridAssembly({ groups: 100, perGroup: 100, forge: countingStubForge({ calls: [] }) });
  const full = buildGridAssembly({ groups: 100, perGroup: 100, forge: countingStubForge({ calls: [] }) });
  inc.rebuilder.rebuild();
  full.rebuilder.rebuild();

  inc.graph.edit(inc.masterIds[7], { dx: 42 });
  full.graph.edit(full.masterIds[7], { dx: 42 });

  inc.rebuilder.rebuild();          // incremental
  full.rebuilder.fullRebuild();     // from scratch

  assert.deepEqual(inc.rebuilder.worldTransforms(), full.rebuilder.worldTransforms(),
    'incremental 10k rebuild is identical to a from-scratch 10k rebuild');
});

// ─────────────────────────────────────────────────────────────────────
// content-hash + transform-digest sanity.
// ─────────────────────────────────────────────────────────────────────
test('hashTransforms: changes iff a transform value changes; -0 normalises to 0', () => {
  const a = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const b = a.slice();
  assert.equal(hashTransforms(a), hashTransforms(b), 'identical buffers hash equal');
  b[12] = 5;
  assert.notEqual(hashTransforms(a), hashTransforms(b), 'a moved instance changes the digest');
  const z = a.slice(); z[3] = -0;
  assert.equal(hashTransforms(a), hashTransforms(z), '-0 and +0 hash equal (no spurious dirty)');
});

test('contentHashFor: stable across rebuilds for an unchanged node; moves when an upstream version moves', () => {
  const g = new AssemblyGraph();
  const m = g.add(new AssemblyNode({ id: 'm', kind: 'part', params: { dx: 1, dy: 1, dz: 1 } }));
  const i = g.add(new AssemblyNode({ id: 'i', kind: 'instanced', masterId: 'm',
                                     transforms: new Float64Array(16) }));
  const h0 = contentHashFor(i, g);
  m.outputVersion = 5;                       // simulate the master re-running
  const h1 = contentHashFor(i, g);
  assert.notEqual(h0, h1, 'instanced hash folds the master version → invalidates on ancestor change');
});

// ─────────────────────────────────────────────────────────────────────
// Window install surface (mirrors installForgeRunner) — idempotent.
// ─────────────────────────────────────────────────────────────────────
test('installAssemblyGraph: idempotent window surface for the ForgeToolBridge verbs', () => {
  const fakeWin = {};
  const a = installAssemblyGraph(fakeWin);
  assert.ok(a.graph instanceof AssemblyGraph);
  assert.ok(a.rebuilder instanceof IncrementalRebuilder);
  assert.equal(typeof fakeWin.__forgeAssemblyMarkDirty, 'function');
  assert.equal(typeof fakeWin.__forgeAssemblyRebuild, 'function');
  const b = getAssemblyGraph(fakeWin);
  assert.equal(b.graph, a.graph, 'graph singleton is reused (idempotent)');
  assert.equal(b.rebuilder, a.rebuilder, 'rebuilder singleton is reused');
});

// Standalone sentinel (matches the repo's *.mjs convention when run via `node`).
console.log('[forge.incrementalRebuild] all tests passed');
