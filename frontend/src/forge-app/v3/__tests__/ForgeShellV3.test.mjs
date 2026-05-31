import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForgeShellV3 } from '../ForgeShellV3.jsx';
import { VerbRail, verbsFor } from '../VerbRail.jsx';
import { TimelineStrip } from '../TimelineStrip.jsx';
import { ArchieSidebar } from '../ArchieSidebar.jsx';
import { CommandBar } from '../CommandBar.jsx';

// 1) ForgeShellV3 SSR renders the five grid zones — no crash, all
//    test-ids present.
{
  const html = renderToStaticMarkup(React.createElement(ForgeShellV3));
  assert.ok(html.includes('data-testid="forge-v3-app"'), 'app root');
  assert.ok(html.includes('data-testid="forge-v3-verbs"'), 'verb rail');
  assert.ok(html.includes('data-testid="forge-v3-viewport"'), 'viewport');
  assert.ok(html.includes('data-testid="forge-v3-timeline"'), 'timeline');
  assert.ok(html.includes('data-testid="forge-v3-archie"'), 'archie');
  assert.ok(html.includes('data-testid="forge-v3-cmdbar"'), 'command bar');
  // Forge branding present.
  assert.ok(html.includes('Forge'), 'Forge brand');
  // No SolidWorks / Office ribbon vocab leaks in.
  assert.ok(!html.includes('Ribbon'), 'no Ribbon class — Forge IP, not Office IP');
  assert.ok(!html.includes('workbench-tab'), 'no workbench tabs');
  // Cmd+K hint visible in empty viewport.
  assert.ok(html.includes('⌘K'), 'Cmd+K hint rendered');
}

// 2) verbsFor returns selection-contextual verbs — none → creation
//    verbs; face → modify verbs incl. Fillet; body → boolean verbs.
{
  const none = verbsFor('none').map((v) => v.id);
  assert.ok(none.includes('create.sketch'));
  assert.ok(none.includes('create.box'));
  assert.ok(!none.includes('modify.fillet'),
            'fillet only appears when something is selected');

  const face = verbsFor('face').map((v) => v.id);
  assert.ok(face.includes('modify.fillet'));
  assert.ok(face.includes('modify.shell'));
  assert.ok(face.includes('pattern'));

  const body = verbsFor('body').map((v) => v.id);
  assert.ok(body.includes('bool.cut'));
  assert.ok(body.includes('bool.fuse'));
  assert.ok(body.includes('modify.move'));

  // Every kind ≤ 12 verbs (the discoverability ceiling).
  for (const k of ['none', 'face', 'edge', 'body']) {
    assert.ok(verbsFor(k).length <= 12, `${k} has ≤ 12 verbs`);
  }
}

// 3) VerbRail SSR renders the contextual verbs with aria-pressed for
//    the active one + a divider when groups change.
{
  const html = renderToStaticMarkup(React.createElement(VerbRail, {
    selection: { kind: 'face', ids: [42] },
    activeVerb: 'modify.fillet',
    onVerb: () => {},
  }));
  assert.ok(html.includes('data-verb="modify.fillet"'));
  assert.ok(html.includes('aria-pressed="true"'), 'fillet pressed');
  assert.ok(html.includes('forge-v3-verb-divider'), 'group divider rendered');
}

// 4) TimelineStrip shows empty-state with no steps, and renders one
//    card per step with the playhead at the active step.
{
  const empty = renderToStaticMarkup(React.createElement(TimelineStrip, {
    steps: [], activeStepId: null, onPick: () => {},
  }));
  assert.ok(empty.includes('No steps yet'));

  const populated = renderToStaticMarkup(React.createElement(TimelineStrip, {
    steps: [
      { id: 'a', label: 'box 10mm', meta: 'create' },
      { id: 'b', label: 'fillet 2mm', meta: 'modify' },
    ],
    activeStepId: 'b',
    onPick: () => {},
  }));
  assert.ok(populated.includes('box 10mm'));
  assert.ok(populated.includes('fillet 2mm'));
  assert.ok(populated.includes('forge-v3-timeline-head'), 'playhead present');
  assert.ok(populated.includes('aria-current="step"'), 'active step marked');
}

// 5) ArchieSidebar collapsed/expanded — collapsed hides the thread
//    panel; expanded shows the thread.
{
  const collapsed = renderToStaticMarkup(React.createElement(ArchieSidebar, {
    collapsed: true, onToggle: () => {}, thread: [{ id: 'x', role: 'user', text: 'hi' }],
  }));
  assert.ok(collapsed.includes('data-collapsed="true"'));
  assert.ok(!collapsed.includes('data-testid="forge-v3-archie-thread"'),
            'collapsed hides thread body');

  const open = renderToStaticMarkup(React.createElement(ArchieSidebar, {
    collapsed: false, onToggle: () => {},
    thread: [
      { id: 'a', role: 'user', text: 'cube 10mm' },
      { id: 'b', role: 'archie', text: 'Done.' },
    ],
  }));
  assert.ok(open.includes('cube 10mm'));
  assert.ok(open.includes('Done.'));
  assert.ok(open.includes('data-role="archie"'));
}

// 6) CommandBar renders with the prompt glyph + placeholder, and shows
//    the Cmd+K hint.
{
  const html = renderToStaticMarkup(React.createElement(CommandBar, {
    onSubmit: () => {},
  }));
  assert.ok(html.includes('class="forge-v3-cmdbar-prompt"'));
  assert.ok(html.includes('Tell Archie what to build'));
  assert.ok(html.includes('⌘K'));
}

console.log('[forge.v3.shell] all tests passed');
