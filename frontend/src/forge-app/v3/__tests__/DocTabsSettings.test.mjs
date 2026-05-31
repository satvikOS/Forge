import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocTabs } from '../DocTabs.jsx';
import { SettingsOverlay } from '../SettingsOverlay.jsx';

// 1) DocTabs renders one button per tab + a "new" button. Active tab
//    has aria-selected=true; dirty tab shows the unsaved marker.
{
  const html = renderToStaticMarkup(React.createElement(DocTabs, {
    tabs: [
      { id: 't1', title: 'bracket.forge', dirty: true },
      { id: 't2', title: 'frame.forge',   dirty: false },
    ],
    activeId: 't2',
    onSwitch: () => {}, onClose: () => {}, onNew: () => {},
  }));
  assert.ok(html.includes('bracket.forge'));
  assert.ok(html.includes('frame.forge'));
  assert.ok(html.includes('aria-selected="true"'), 'active tab marked');
  assert.ok(html.includes('aria-label="unsaved"'), 'dirty marker on bracket');
  assert.ok(html.includes('data-testid="forge-v3-doc-tabs-new"'));
}

// 2) SettingsOverlay open=false renders nothing.
{
  const closed = renderToStaticMarkup(React.createElement(SettingsOverlay, {
    open: false, onClose: () => {},
  }));
  assert.equal(closed, '');
}

// 3) SettingsOverlay open=true renders all 5 categories + the active
//    panel ('Appearance' by default → theme/reducedMotion/accent fields).
{
  const html = renderToStaticMarkup(React.createElement(SettingsOverlay, {
    open: true, onClose: () => {}, onThemeChange: () => {},
  }));
  assert.ok(html.includes('data-testid="forge-v3-settings"'));
  ['Appearance', 'Units', 'AI / Archie', 'Storage', 'About'].forEach((c) => {
    assert.ok(html.includes(c), `category visible: ${c}`);
  });
  // Default panel — Appearance.
  assert.ok(html.includes('Theme'), 'theme field in Appearance panel');
  assert.ok(html.includes('Reduce motion'), 'reduced-motion field');
  assert.ok(html.includes('Accent'), 'accent field');
}

console.log('[forge.v3.doc-tabs-settings] all tests passed');
