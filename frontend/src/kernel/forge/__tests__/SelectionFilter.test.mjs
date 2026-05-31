import assert from 'node:assert/strict';
import { SelectionFilter, SELECTION_KINDS } from '../SelectionFilter.js';

// ---- defaults: everything pickable ---------------------------------
{
  const f = new SelectionFilter();
  for (const k of SELECTION_KINDS) assert.equal(f.isPickable(k), true);
}

// ---- only() restricts ---------------------------------------------
{
  const f = new SelectionFilter();
  f.only('face', 'edge');
  assert.equal(f.isPickable('face'), true);
  assert.equal(f.isPickable('edge'), true);
  assert.equal(f.isPickable('vertex'), false);
  assert.equal(f.isPickable('body'),   false);
}

// ---- reset restores everything ------------------------------------
{
  const f = new SelectionFilter();
  f.only('vertex');
  f.reset();
  for (const k of SELECTION_KINDS) assert.equal(f.isPickable(k), true);
}

// ---- onChange listener fires once per change -----------------------
{
  const f = new SelectionFilter();
  let calls = 0;
  f.onChange(() => { calls++; });
  f.disable('vertex');
  f.disable('vertex'); // already off → no event
  f.enable('vertex');
  assert.equal(calls, 2);
}

// ---- error path on unknown kind -----------------------------------
{
  const f = new SelectionFilter();
  assert.throws(() => f.disable('atom'), /unknown selection kind/);
}

console.log('[forge.sel] all tests passed');
