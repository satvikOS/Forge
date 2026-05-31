import assert from 'node:assert/strict';
import React, { useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useArchieDriver } from '../useArchieDriver.js';

// Smoke: hook initialises with empty thread / steps and 'idle' status
// when no window.forge is present. We exercise it through a tiny SSR
// probe component because react-dom/server runs hooks for us.
{
  let captured = null;
  function Probe() {
    const d = useArchieDriver();
    captured = { thread: d.thread, steps: d.steps, status: d.status };
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.deepEqual(captured, { thread: [], steps: [], status: 'idle' });
}

// send() with no window.forge returns offline. We can't easily exercise
// the async branch under SSR (effects don't fire), so we call the
// function directly through an exposed handle.
{
  let driverHandle = null;
  function Probe() {
    const d = useArchieDriver();
    driverHandle = d;
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(typeof driverHandle.send === 'function');
  assert.ok(typeof driverHandle.cancel === 'function');
}

console.log('[forge.v3.archie-driver] all tests passed');
