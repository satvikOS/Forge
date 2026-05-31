import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useArchieDriver } from '../useArchieDriver.js';
import { ArchieThreadStore } from '../../archie-portal/ArchieThreadStore.js';

// Forge-51: a fresh driver creates a thread on the underlying store
// when one doesn't exist, and exposes `newThread`. We can't easily
// exercise useEffect under SSR (effects don't fire), so we test the
// store-level behaviour directly + driver shape.
{
  function memBackend() {
    const m = new Map();
    return {
      get: (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
      set: (k, v) => m.set(k, JSON.stringify(v)),
      del: (k) => m.delete(k),
    };
  }
  const store = new ArchieThreadStore({ backend: memBackend() });
  // No threads yet.
  assert.equal(store.index().length, 0);
  // Driver shape: newThread + activeThreadId are present.
  let driver = null;
  function Probe() { driver = useArchieDriver({ store }); return null; }
  renderToStaticMarkup(React.createElement(Probe));
  assert.equal(typeof driver.newThread, 'function');
  assert.ok('activeThreadId' in driver);
}

// Forge-51: store round-trip — appending messages persists across a
// fresh load via the same backend.
{
  function memBackend() {
    const m = new Map();
    return {
      get: (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
      set: (k, v) => m.set(k, JSON.stringify(v)),
      del: (k) => m.delete(k),
    };
  }
  const backend = memBackend();
  const store = new ArchieThreadStore({ backend });
  const t = store.create({ discipline: 'part', title: 'cube test' });
  store.appendUserMessage(t, 'make a 10mm cube');
  // New store on same backend should load the message.
  const store2 = new ArchieThreadStore({ backend });
  const t2 = store2.load(t.id);
  assert.ok(t2);
  assert.equal(t2.messages.length, 1);
  assert.equal(t2.messages[0].text, 'make a 10mm cube');
}

console.log('[forge.v3.persistence] all tests passed');
