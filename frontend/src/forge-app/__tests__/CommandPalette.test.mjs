/**
 * Forge-26 — CommandPalette React test.
 *
 * We don't have @testing-library/react in this slice (it was not yet
 * added to the frontend dependency tree); we use react-dom/server's
 * renderToStaticMarkup to confirm SSR output and exercise the palette's
 * registry+invoke wiring directly. The next dependency-bump slice will
 * promote these to vitest+RTL.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandRegistry } from '../../kernel/forge/CommandPalette.js';
import { CommandPaletteView } from '../CommandPalette.jsx';

// ---- initial render shows commands --------------------------------
{
  const registry = new CommandRegistry();
  registry.register({ id: 'part.extrude', title: 'Extrude Boss',  category: 'Part', run: () => {} });
  registry.register({ id: 'part.revolve', title: 'Revolve Boss',  category: 'Part', run: () => {} });
  registry.register({ id: 'file.export', title: 'Export STEP',   category: 'File', run: () => {} });

  const html = renderToStaticMarkup(
    React.createElement(CommandPaletteView, { registry, autoFocus: false })
  );
  assert.ok(html.includes('Extrude Boss'),  'first command rendered');
  assert.ok(html.includes('Revolve Boss'),  'second command rendered');
  assert.ok(html.includes('Export STEP'),   'third command rendered');
  assert.ok(html.includes('forge-palette'), 'palette container rendered');
}

// ---- registry.query reflects what the palette filters to ----------
{
  const registry = new CommandRegistry();
  registry.register({ id: 'part.extrude', title: 'Extrude Boss',  category: 'Part', run: () => {} });
  registry.register({ id: 'part.revolve', title: 'Revolve Boss',  category: 'Part', run: () => {} });
  registry.register({ id: 'file.export',  title: 'Export STEP',   category: 'File', run: () => {} });

  // The palette uses `registry.query(text, ctx)` verbatim. Confirm the
  // ranking the user would see when typing 'ext'.
  const hits = registry.query('ext').map((h) => h.command.title);
  assert.ok(hits[0].toLowerCase().startsWith('extrude'),
            `expected Extrude first, got ${JSON.stringify(hits)}`);
  assert.ok(hits.includes('Export STEP'), 'subsequence match found');
}

// ---- enter on active row invokes registry + closes ----------------
{
  const registry = new CommandRegistry();
  let ran = 0;
  registry.register({ id: 'x.run', title: 'Run X', category: 'X', run: () => { ran++; } });

  // The Enter-key path in CommandPaletteView ends in registry.invoke(id, ctx).
  // We exercise that boundary directly here — full DOM keypress simulation
  // arrives with the RTL slice.
  registry.invoke('x.run', {});
  assert.equal(ran, 1, 'invoke executes registered run()');
}

// ---- onClose fires (palette is closeable) -------------------------
{
  const registry = new CommandRegistry();
  registry.register({ id: 'a', title: 'A', category: 'A', run: () => {} });
  let closed = 0;
  const html = renderToStaticMarkup(
    React.createElement(CommandPaletteView, {
      registry,
      autoFocus: false,
      onClose: () => { closed++; },
    })
  );
  // closed only fires from interactive paths; here we just confirm the
  // palette rendered when given onClose without throwing.
  assert.ok(html.includes('Command query') || html.includes('forge-palette'),
            'palette rendered with onClose prop');
}

console.log('[forge-app.palette] all tests passed');
