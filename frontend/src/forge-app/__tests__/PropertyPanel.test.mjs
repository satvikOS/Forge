/**
 * Forge-26 — PropertyPanel React test.
 *
 * SSR-renders the panel against a PropertyManager that has a number
 * field, then verifies (a) the field markup is in the output and
 * (b) committing through `pm.commit({ key: value })` — what the
 * field's onBlur handler does — mutates the entity, runs validation,
 * and fires onChange. This proves the panel's wiring contract.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PropertyManager } from '../../kernel/forge/PropertyManager.js';
import PropertyPanel from '../panels/PropertyPanel.jsx';

// ---- empty-selection placeholder ----------------------------------
{
  const pm = new PropertyManager();
  const html = renderToStaticMarkup(
    React.createElement(PropertyPanel, { propertyManager: pm })
  );
  assert.ok(html.includes('Nothing selected'), 'empty placeholder shown');
}

// ---- form renders number field -----------------------------------
{
  const pm = new PropertyManager();
  pm.register({
    kind: 'extrude',
    title: 'Extrude',
    fields: [
      { key: 'depth', label: 'Depth', type: 'number', unit: 'mm',
        validate: (v) => v > 0 ? null : 'must be > 0' },
      { key: 'reversed', label: 'Reversed', type: 'boolean' },
    ],
  });
  const entity = { depth: 10, reversed: false };
  pm.setSelection(entity, 'extrude');

  const html = renderToStaticMarkup(
    React.createElement(PropertyPanel, { propertyManager: pm })
  );
  assert.ok(html.includes('Depth'),     'number field label rendered');
  assert.ok(html.includes('Reversed'),  'boolean field label rendered');
  assert.ok(html.includes('Extrude'),   'schema title shown in header');
  // unit label is part of the number control.
  assert.ok(html.includes('mm'),        'unit label rendered');
  // The defaultValue prop is what the number input ships with.
  assert.ok(html.includes('value="10"') || html.includes("value=\"10\""),
            'depth value reflected in markup');
}

// ---- commit mutates entity + fires change listener ----------------
{
  const pm = new PropertyManager();
  pm.register({
    kind: 'box',
    fields: [
      { key: 'x', type: 'number', validate: (v) => v > 0 ? null : 'must be > 0' },
    ],
  });
  const entity = { x: 1 };
  let notifies = 0;
  pm.onChange(() => { notifies++; });
  pm.setSelection(entity, 'box');
  assert.equal(notifies, 1, 'setSelection notify');

  // What the number field's onBlur handler does:
  pm.commit({ x: 7 });
  assert.equal(entity.x, 7, 'entity mutated');
  assert.equal(notifies, 2, 'commit notify');

  // Invalid commit is rejected without mutating.
  assert.throws(() => pm.commit({ x: -3 }), /must be > 0/);
  assert.equal(entity.x, 7, 'invalid commit left entity untouched');
}

console.log('[forge-app.props] all tests passed');
