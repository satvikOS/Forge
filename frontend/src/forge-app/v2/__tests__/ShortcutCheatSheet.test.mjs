import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShortcutCheatSheet } from '../overlays/ShortcutCheatSheet.jsx';

// open=true → renders the categorised shortcut list.
{
  const html = renderToStaticMarkup(React.createElement(ShortcutCheatSheet, {
    open: true, onClose: () => {},
  }));
  // Headings (groups).
  ['Application', 'Edit', 'View', 'Sketch', 'Part', 'Assembly', 'Drawing', 'Simulate', 'Archie'].forEach((g) => {
    assert.ok(html.includes(g), `missing group: ${g}`);
  });
  // A handful of representative commands.
  ['Command palette', 'Undo', 'Frame all', 'Extrude', 'Mate', 'Focus Archie composer'].forEach((c) => {
    assert.ok(html.includes(c), `missing command: ${c}`);
  });
  // Key symbols rendered.
  assert.ok(html.includes('⌘')); // Cmd glyph
  assert.ok(html.includes('?'));  // help shortcut self-references
}

// open=false → renders nothing.
{
  const html = renderToStaticMarkup(React.createElement(ShortcutCheatSheet, {
    open: false, onClose: () => {},
  }));
  assert.equal(html, '');
}

console.log('[v2.ShortcutCheatSheet] all tests passed');
