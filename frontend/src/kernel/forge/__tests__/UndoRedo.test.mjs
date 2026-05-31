import assert from 'node:assert/strict';
import { UndoStack, Action, setParam, undoable, wireFeatureTree, wireConfigurationSet } from '../UndoRedo.js';
import { FeatureTree } from '../FeatureTree.js';
import { Configuration, ConfigurationSet } from '../Configurations.js';

// ---- push / undo / redo basics ------------------------------------
{
  const state = { n: 0 };
  const stack = new UndoStack();
  const mk = (n) => new Action({
    label: `set ${n}`,
    do: (s) => { const prev = s.n; s.n = n; return { prev }; },
    undo: (s, m) => { s.n = m.prev; },
  });
  for (let i = 1; i <= 5; i++) stack.push(mk(i), state);
  assert.equal(state.n, 5, 'after 5 pushes');
  assert.equal(stack.depth(), 5);
  assert.equal(stack.canUndo, true);
  assert.equal(stack.canRedo, false);

  // undo 3
  for (let i = 0; i < 3; i++) stack.undo(state);
  assert.equal(state.n, 2, 'after 3 undos');
  assert.equal(stack.depth(), 2);
  assert.equal(stack.futureDepth(), 3);

  // redo 2
  for (let i = 0; i < 2; i++) stack.redo(state);
  assert.equal(state.n, 4, 'after 2 redos');

  // new push truncates redo tail
  stack.push(mk(99), state);
  assert.equal(state.n, 99);
  assert.equal(stack.canRedo, false, 'redo tail dropped on new push');
}

// ---- maxDepth eviction --------------------------------------------
{
  const state = { v: 0 };
  const stack = new UndoStack({ maxDepth: 3 });
  for (let i = 1; i <= 10; i++) {
    stack.push(new Action({
      label: `+${i}`,
      do: (s) => { const p = s.v; s.v += 1; return { p }; },
      undo: (s, m) => { s.v = m.p; },
    }), state);
  }
  assert.equal(stack.depth(), 3, 'maxDepth caps stack');
  assert.equal(state.v, 10);
}

// ---- coalescing 10 rapid edits collapse to one undo ---------------
{
  const state = { target: { params: { r: 0 } } };
  const stack = new UndoStack({ maxDepth: 100 });
  stack.mergeCoalescing(50);

  let t = 1000;
  for (let i = 1; i <= 10; i++) {
    const a = setParam('boss-1', state.target, 'r', i, { ts: t });
    stack.push(a, state);
    t += 10;          // within 50ms window
  }
  assert.equal(state.target.params.r, 10, 'all 10 applied');
  assert.equal(stack.depth(), 1, '10 edits coalesced to 1');
  stack.undo(state);
  assert.equal(state.target.params.r, 0, 'single undo reverts to original');
}

// ---- coalescing respects window ----------------------------------
{
  const state = { target: { params: { r: 0 } } };
  const stack = new UndoStack().mergeCoalescing(20);
  stack.push(setParam('boss', state.target, 'r', 1, { ts: 0 }), state);
  stack.push(setParam('boss', state.target, 'r', 2, { ts: 10 }), state);
  stack.push(setParam('boss', state.target, 'r', 3, { ts: 100 }), state); // outside window
  assert.equal(stack.depth(), 2, 'gap > window creates new entry');
  stack.undo(state);
  assert.equal(state.target.params.r, 2);
  stack.undo(state);
  assert.equal(state.target.params.r, 0);
}

// ---- wireFeatureTree funnels mutations through stack -------------
{
  const tree = new FeatureTree();
  const stack = new UndoStack();
  wireFeatureTree(tree, stack);

  const a = tree.add({ kind: 'box', params: { dx: 1, dy: 1, dz: 1 } });
  assert.equal(tree.size(), 1);
  assert.equal(stack.depth(), 1, 'add → 1 action');

  tree.edit(a.id, { dx: 5 });
  assert.equal(tree.byId(a.id).params.dx, 5);
  assert.equal(stack.depth(), 2);

  // Undo the edit → params restored.
  stack.undo();
  assert.equal(tree.byId(a.id).params.dx, 1);

  // Redo the edit.
  stack.redo();
  assert.equal(tree.byId(a.id).params.dx, 5);

  // Suppress → undo
  tree.suppress(a.id);
  assert.equal(tree.byId(a.id).suppressed, true);
  stack.undo();
  assert.equal(tree.byId(a.id).suppressed, false);
}

// ---- wireConfigurationSet -----------------------------------------
{
  const set = new ConfigurationSet();
  const stack = new UndoStack();
  wireConfigurationSet(set, stack);
  const cfg = new Configuration({ name: 'Big' });
  set.add(cfg);
  assert.equal(set.list().length, 2);
  stack.undo();
  assert.equal(set.list().length, 1, 'undo removes added config');
  stack.redo();
  assert.equal(set.list().length, 2);
}

// ---- onChange notifications --------------------------------------
{
  const stack = new UndoStack();
  const events = [];
  stack.onChange((e) => events.push(e.kind));
  stack.push(new Action({
    label: 'noop',
    do: () => null, undo: () => null,
  }));
  stack.undo();
  stack.redo();
  stack.clear();
  assert.deepEqual(events, ['push', 'undo', 'redo', 'clear']);
}

// ---- error paths --------------------------------------------------
{
  assert.throws(() => new Action({}), /label/);
  assert.throws(() => new Action({ label: 'x' }), /Action\.do/);
  assert.throws(() => new UndoStack({ maxDepth: 0 }), /maxDepth/);
}

console.log('[forge.undo] all tests passed');
