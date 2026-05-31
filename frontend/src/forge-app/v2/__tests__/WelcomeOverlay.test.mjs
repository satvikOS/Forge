import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WelcomeOverlay } from '../overlays/WelcomeOverlay.jsx';

// open=false → empty.
{
  const html = renderToStaticMarkup(React.createElement(WelcomeOverlay, {
    open: false, onClose: () => {},
  }));
  assert.equal(html, '');
}

// open=true → renders brand + actions + sample cards.
{
  const html = renderToStaticMarkup(React.createElement(WelcomeOverlay, {
    open: true, onClose: () => {}, recent: [],
  }));
  assert.ok(html.includes('Welcome to'));
  assert.ok(html.includes('Forge'));
  assert.ok(html.includes('New project'));
  assert.ok(html.includes('Open existing'));
  assert.ok(html.includes('60-second tour'));
  // 3 sample part cards.
  assert.ok(html.includes('L-bracket'));
  assert.ok(html.includes('Steel frame'));
  assert.ok(html.includes('Enclosure'));
  // No recent projects → empty-recent placeholder visible.
  assert.ok(html.includes('No recent projects'));
}

// open=true + recent → recent list renders.
{
  const html = renderToStaticMarkup(React.createElement(WelcomeOverlay, {
    open: true, onClose: () => {},
    recent: [{ id: 'r1', name: 'bracket-v3.forge', path: '~/Forge/bracket-v3.forge' }],
  }));
  assert.ok(html.includes('bracket-v3.forge'));
  assert.ok(html.includes('~/Forge/bracket-v3.forge'));
  assert.ok(!html.includes('No recent projects'));
}

console.log('[v2.WelcomeOverlay] all tests passed');
