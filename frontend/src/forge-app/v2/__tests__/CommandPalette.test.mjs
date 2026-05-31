import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandPalette } from '../overlays/CommandPalette.jsx';

const COMMANDS = [
  { id: 'part.extrude',  label: 'Extrude',  category: 'Part',  icon: 'extrude' },
  { id: 'part.fillet',   label: 'Fillet',   category: 'Part',  icon: 'fillet' },
  { id: 'file.export',   label: 'Export STEP', category: 'File', icon: 'fileExport' },
  { id: 'sim.static',    label: 'Run static FEA', category: 'Simulate', icon: 'simulateTab' },
];

// open=false → renders nothing.
{
  const html = renderToStaticMarkup(React.createElement(CommandPalette, {
    open: false, commands: COMMANDS,
  }));
  assert.equal(html, '');
}

// open=true → modal with role=dialog + listbox + 4 options.
{
  const html = renderToStaticMarkup(React.createElement(CommandPalette, {
    open: true, commands: COMMANDS,
  }));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('role="listbox"'));
  assert.ok(html.includes('Extrude'));
  assert.ok(html.includes('Fillet'));
  assert.ok(html.includes('Export STEP'));
  assert.ok(html.includes('Run static FEA'));
  // Mode hint row visible.
  assert.ok(html.includes('commands'));
  assert.ok(html.includes('features'));
  assert.ok(html.includes('settings'));
}

// Recent commands raise the corresponding item up the ranking (boost
// applied on no-query state). We can't simulate typing in SSR, but we
// can check the boost is present on the items prop indirectly: the
// recent list should be honoured in the rendered list order.
{
  const html = renderToStaticMarkup(React.createElement(CommandPalette, {
    open: true, commands: COMMANDS, recent: ['sim.static'],
  }));
  // SSR renders the order; "Run static FEA" should appear before "Extrude"
  // because boost > 0 on no query.
  const idxSim = html.indexOf('Run static FEA');
  const idxExt = html.indexOf('Extrude');
  assert.ok(idxSim > 0 && idxExt > 0 && idxSim < idxExt,
            'recent items should rank ahead');
}

console.log('[v2.CommandPalette] all tests passed');
