import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Icon, ICON_NAMES } from '../icons/Icon.jsx';

// Forge ships its own icon set — every name listed in ICON_NAMES must
// render to a non-empty SVG. This catches typos in the PATHS map and
// asserts the ≥80-icon coverage that the design system promises.
{
  assert.ok(ICON_NAMES.length >= 80,
            `expected ≥80 icons, got ${ICON_NAMES.length}`);
  for (const name of ICON_NAMES) {
    const html = renderToStaticMarkup(React.createElement(Icon, { name, size: 16 }));
    assert.ok(html.startsWith('<svg'), `${name}: did not render an svg`);
    assert.ok(html.includes('viewBox="0 0 16 16"'),
              `${name}: missing 16-native viewBox`);
    assert.ok(html.includes('aria-hidden="true"'),
              `${name}: should be aria-hidden by default`);
  }
}

// Decorative icons hide from AT, labelled ones expose role="img".
{
  const decor = renderToStaticMarkup(React.createElement(Icon, { name: 'box' }));
  assert.ok(decor.includes('aria-hidden="true"'));
  const labelled = renderToStaticMarkup(React.createElement(Icon, {
    name: 'box', decorative: false, label: 'Box body',
  }));
  assert.ok(labelled.includes('role="img"'));
  assert.ok(labelled.includes('aria-label="Box body"'));
}

// Unknown icon name should warn and render nothing (not throw).
{
  const html = renderToStaticMarkup(React.createElement(Icon, { name: 'definitely-not-an-icon' }));
  assert.equal(html, '');
}

console.log('[design-system.Icon] all tests passed');
