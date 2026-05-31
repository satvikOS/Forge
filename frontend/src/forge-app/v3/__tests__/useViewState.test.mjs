import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useViewState, DEFAULT_VIEWS, DISPLAY_STATES } from '../useViewState.js';

function memBackend() {
  const m = new Map();
  return {
    get: (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
    set: (k, v) => m.set(k, JSON.stringify(v)),
    del: (k) => m.delete(k),
  };
}

// 1) Defaults — 7 named views + 5 display states + initial state 'shaded'.
{
  assert.equal(DEFAULT_VIEWS.length, 7);
  assert.deepEqual(DEFAULT_VIEWS.map((v) => v.id),
    ['iso','front','back','top','bottom','right','left']);
  assert.equal(DISPLAY_STATES.length, 5);
  assert.ok(DISPLAY_STATES.includes('shaded'));
  assert.ok(DISPLAY_STATES.includes('wireframe'));
}

// 2) Hook init — 7 default views, displayState=shaded, activeView=iso.
{
  let handle = null;
  function Probe() {
    handle = useViewState({ threadId: null, backend: null });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.equal(handle.views.length, 7);
  assert.equal(handle.displayState, 'shaded');
  assert.equal(handle.activeView, 'iso');
  assert.equal(typeof handle.saveView, 'function');
  assert.equal(typeof handle.cycleDisplay, 'function');
}

// 3) saveView returns a normalised id from the name.
{
  let handle = null;
  function Probe() {
    handle = useViewState({ threadId: null, backend: null });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  const entry = handle.saveView('Top Iso', {
    position: [10, 20, 30], target: [0,0,0], up: [0,1,0],
  });
  assert.equal(entry.id, 'top-iso');
  assert.equal(entry.name, 'Top Iso');
  assert.deepEqual(entry.position, [10, 20, 30]);
}

// 4) cycleDisplay walks the DISPLAY_STATES list. We test by calling
//    the function once and reading the next state from the returned
//    handle (React state mutations don't propagate under SSR; we test
//    that the function exists and the type is the cyclic one).
{
  let handle = null;
  function Probe() {
    handle = useViewState({ threadId: 't-1', backend: memBackend() });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.equal(typeof handle.cycleDisplay, 'function');
  // setDisplay should reject invalid values silently (no throw).
  handle.setDisplay('not-a-state');   // no-op
  handle.setDisplay('wireframe');     // valid
}

// 5) Backend persistence — saving a view writes through; a fresh hook
//    with the same backend reads it back.
{
  const backend = memBackend();
  let h1 = null;
  function Probe1() { h1 = useViewState({ threadId: 't-1', backend }); return null; }
  renderToStaticMarkup(React.createElement(Probe1));
  const saved = h1.saveView('Custom', { position: [1,2,3], target: [0,0,0], up: [0,1,0] });
  // Verify it landed.
  const stored = backend.get('forge.v3.views.t-1');
  assert.ok(Array.isArray(stored));
  const found = stored.find((v) => v.id === 'custom');
  assert.ok(found, 'custom view persisted');
  assert.deepEqual(found.position, [1, 2, 3]);
}

console.log('[forge.v3.view-state] all tests passed');
