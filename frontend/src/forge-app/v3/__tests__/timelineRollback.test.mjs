import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useArchieDriver } from '../useArchieDriver.js';
import { TimelineStrip } from '../TimelineStrip.jsx';

// 1) Driver returns rollbackTo + activeStepId + setActiveStepId in its
//    shape — the timeline needs these to scrub.
{
  let driver = null;
  function Probe() { driver = useArchieDriver(); return null; }
  renderToStaticMarkup(React.createElement(Probe));
  assert.equal(typeof driver.rollbackTo, 'function');
  assert.equal(typeof driver.setActiveStepId, 'function');
  assert.equal(driver.activeStepId, null);
}

// 2) TimelineStrip renders the rollback-affordance hint in title +
//    aria-label so users can discover it.
{
  const html = renderToStaticMarkup(React.createElement(TimelineStrip, {
    steps: [
      { id: 'a', label: 'box 10mm', meta: 'create' },
      { id: 'b', label: 'fillet 2mm', meta: 'modify' },
    ],
    activeStepId: 'b',
    onPick: () => {},
    onRollback: () => {},
  }));
  assert.ok(html.includes('rollback'), 'rollback affordance surfaced in label');
  assert.ok(html.includes('Shift-click or double-click to rollback'),
            'aria-label spells out the gesture');
}

// 3) Calling rollbackTo directly through the driver truncates `steps`
//    + flips activeStepId. We can't exercise React state directly here,
//    but we can verify the function exists and returns something
//    reasonable (no throw) when called with an unknown id.
{
  let driver = null;
  function Probe() { driver = useArchieDriver(); return null; }
  renderToStaticMarkup(React.createElement(Probe));
  // No throw on unknown id.
  driver.rollbackTo('nope-not-real');
  // Idempotent: nothing thrown, nothing changed.
  assert.equal(driver.steps.length, 0);
}

console.log('[forge.v3.timeline-rollback] all tests passed');
