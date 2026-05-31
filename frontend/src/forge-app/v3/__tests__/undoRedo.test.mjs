import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useArchieDriver } from '../useArchieDriver.js';
import { ArchieThreadStore } from '../../archie-portal/ArchieThreadStore.js';

function memBackend() {
  const m = new Map();
  return {
    get: (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
    set: (k, v) => m.set(k, JSON.stringify(v)),
    del: (k) => m.delete(k),
  };
}

// Driver shape exposes undo/redo/canUndo/canRedo/clearRedo.
{
  const store = new ArchieThreadStore({ backend: memBackend() });
  let driver = null;
  function Probe() { driver = useArchieDriver({ store }); return null; }
  renderToStaticMarkup(React.createElement(Probe));
  assert.equal(typeof driver.undo, 'function');
  assert.equal(typeof driver.redo, 'function');
  assert.equal(typeof driver.clearRedo, 'function');
  assert.equal(typeof driver.canUndo, 'boolean');
  assert.equal(typeof driver.canRedo, 'boolean');
  // Initial state: empty steps → no undo, no redo.
  assert.equal(driver.canUndo, false);
  assert.equal(driver.canRedo, false);
  // Undo on empty is a no-op (no throw).
  driver.undo();
  driver.redo();
}

console.log('[forge.v3.undo-redo] all tests passed');
