import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewportSurface } from '../ViewportSurface.jsx';

// 1) SSR — viewport renders the empty-state (r3f canvas only mounts
//    client-side, so the server-rendered markup must show the kbd hint).
{
  const html = renderToStaticMarkup(React.createElement(ViewportSurface, {
    selection: { kind: 'none', ids: [] },
    onSelect: () => {},
  }));
  assert.ok(html.includes('data-testid="forge-v3-viewport"'), 'viewport root');
  assert.ok(html.includes('data-testid="forge-v3-viewport-empty"'),
            'SSR shows empty-state placeholder');
  assert.ok(html.includes('⌘K'), 'Cmd+K hint visible');
  assert.ok(html.includes('blank canvas'), 'brand line');
  // The r3f canvas testid must NOT appear at SSR (it's behind
  // canvasReady which is set in a useEffect).
  assert.ok(!html.includes('forge-v3-viewport-canvas'),
            'r3f canvas absent in SSR');
}

// 2) With steps + selection prop, SSR still falls back to empty-state
//    (the canvas isn't mounted until client-side useEffect fires).
//    This test guards against accidentally trying to render Canvas
//    server-side, which would crash on the missing webgl context.
{
  const html = renderToStaticMarkup(React.createElement(ViewportSurface, {
    selection: { kind: 'body', ids: [42] },
    onSelect: () => {},
    steps: [{ id: 's1', label: 'box 10mm', handle: 42 }],
  }));
  assert.ok(html.includes('data-testid="forge-v3-viewport-empty"'));
  assert.ok(!html.includes('forge-v3-viewport-canvas'));
}

console.log('[forge.v3.viewport] all tests passed');
