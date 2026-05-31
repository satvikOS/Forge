import assert from 'node:assert/strict';
import { FeatureTree, FeatureNode } from '../FeatureTree.js';

// ---- add / list / byId --------------------------------------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'sketch' });
  const b = t.add({ kind: 'extrude', dependsOn: [a.id] });
  assert.equal(t.size(), 2);
  assert.equal(t.byId(a.id), a);
  assert.deepEqual(t.list().map((f) => f.kind), ['sketch', 'extrude']);
}

// ---- suppress + edit + change events ------------------------------
{
  const t = new FeatureTree();
  let events = 0;
  t.onChange(() => { events++; });

  const a = t.add({ kind: 'box', params: { dx: 1, dy: 1, dz: 1 } });
  assert.equal(events, 1);

  t.edit(a.id, { dx: 5 });
  assert.equal(a.params.dx, 5);
  assert.equal(events, 2);

  t.suppress(a.id);
  assert.equal(a.suppressed, true);
  t.suppress(a.id);  // no-op when already in state
  assert.equal(events, 3, 'suppress is idempotent');
}

// ---- reorder rejects DAG violation --------------------------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'sketch' });
  const b = t.add({ kind: 'extrude', dependsOn: [a.id] });
  assert.throws(() => t.reorder(b.id, 0), /before its dependency/);
  // Reordering a non-dependent feature is fine.
  const c = t.add({ kind: 'plane' });
  t.reorder(c.id, 0);
  assert.deepEqual(t.list().map((f) => f.kind), ['plane', 'sketch', 'extrude']);
}

// ---- rollback bar -------------------------------------------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'sketch' });
  const b = t.add({ kind: 'extrude', dependsOn: [a.id] });
  const c = t.add({ kind: 'fillet', dependsOn: [b.id] });

  t.rollbackTo(b.id);
  assert.equal(t.isRolledBack(c.id), true);
  assert.equal(t.isRolledBack(b.id), false);
  assert.equal(t.appliedList().length, 2);

  // buildOrder respects rollback.
  const orderKinds = [...t.buildOrder()].map((f) => f.kind);
  assert.deepEqual(orderKinds, ['sketch', 'extrude']);
}

// ---- buildOrder blocks downstream on suppressed/error -------------
{
  const t = new FeatureTree();
  const a = t.add({ kind: 'sketch' });
  const b = t.add({ kind: 'extrude', dependsOn: [a.id] });
  t.suppress(a.id);
  const built = [...t.buildOrder()];
  // Sketch suppressed → extrude blocked → both skipped.
  assert.deepEqual(built.map((f) => f.kind), []);
  // The blocked node carries the error.
  assert.equal(b.error, `blocked by ${a.id}`);
}

// ---- serialize / deserialize round-trip --------------------------
{
  const t = new FeatureTree();
  t.add({ kind: 'sketch' });
  const b = t.add({ kind: 'extrude', params: { depth: 10 } });
  t.suppress(b.id);
  t.rollbackTo(b.id);
  const json = t.serialize();
  const t2 = FeatureTree.deserialize(json);
  assert.equal(t2.size(), 2);
  assert.equal(t2.byId(b.id).suppressed, true);
  assert.equal(t2.rollbackAfterId, b.id);
}

// ---- error paths --------------------------------------------------
{
  assert.throws(() => new FeatureNode({}), /kind/);
  const t = new FeatureTree();
  assert.throws(() => t.suppress('nope'), /unknown id/);
  assert.throws(() => t.edit('nope', {}), /unknown id/);
  assert.throws(() => t.reorder('nope', 0), /reorder: unknown id/);
}

console.log('[forge.tree] all tests passed');
