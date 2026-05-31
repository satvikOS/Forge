import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tooltip, ContextMenu, viewportContextItems } from '../Tooltip.jsx';

// 1) Tooltip SSR: trigger is rendered, no tooltip body (it gates on
//    open=true, which only becomes true after mouseenter + delay).
{
  const html = renderToStaticMarkup(React.createElement(Tooltip,
    { label: 'Fillet edges', hint: 'F' },
    React.createElement('button', null, 'Fillet')));
  assert.ok(html.includes('Fillet'),  'trigger rendered');
  assert.ok(!html.includes('forge-v3-tooltip'), 'tooltip body absent');
}

// 2) ContextMenu SSR: open=false → empty; open=true → menu w/ items.
{
  const closed = renderToStaticMarkup(React.createElement(ContextMenu, {
    open: false, x: 0, y: 0, items: [], onPick: () => {}, onClose: () => {},
  }));
  assert.equal(closed, '', 'closed → empty');

  const open = renderToStaticMarkup(React.createElement(ContextMenu, {
    open: true, x: 100, y: 100,
    items: [
      { id: 'a', label: 'Alpha', shortcut: 'A' },
      { divider: true },
      { id: 'b', label: 'Beta', icon: '✦' },
    ],
    onPick: () => {}, onClose: () => {},
  }));
  assert.ok(open.includes('data-testid="forge-v3-context-menu"'));
  assert.ok(open.includes('Alpha'));
  assert.ok(open.includes('Beta'));
  assert.ok(open.includes('role="separator"'));
  assert.ok(open.includes('A'), 'shortcut label rendered');
}

// 3) viewportContextItems shape — body selection produces edit/fillet/
//    chamfer/hide/isolate/delete; empty selection produces create+import.
{
  const sel = viewportContextItems({ kind: 'body', ids: [42] });
  const ids = sel.filter((i) => !i.divider).map((i) => i.id);
  assert.deepEqual(ids, ['edit', 'fillet', 'chamfer', 'hide', 'isolate', 'delete']);
  const empty = viewportContextItems({ kind: 'none', ids: [] });
  const eids = empty.filter((i) => !i.divider).map((i) => i.id);
  assert.deepEqual(eids, ['create.box', 'create.cyl', 'import', 'paste']);
  // Disabled flag survives.
  const paste = empty.find((i) => i.id === 'paste');
  assert.equal(paste.disabled, true);
}

console.log('[forge.v3.tooltip-context-menu] all tests passed');
