/**
 * Forge-26 — FeatureTreePanel React test.
 *
 * Exercises (a) SSR markup contains the feature names, and (b) the
 * underlying `tree.suppress(id)` data flow the suppress checkbox writes
 * to. The render path subscribes to `tree.onChange`; we confirm the
 * tree itself fires the listener as expected so the re-render guarantee
 * holds when the slice that wires up RTL+jsdom lands.
 */
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeatureTree } from '../../kernel/forge/FeatureTree.js';
import FeatureTreePanel from '../panels/FeatureTreePanel.jsx';

// ---- empty state renders ------------------------------------------
{
  const html = renderToStaticMarkup(
    React.createElement(FeatureTreePanel, { tree: null })
  );
  assert.ok(html.includes('No active document'), 'empty placeholder shown');
}

// ---- features render in order -------------------------------------
{
  const tree = new FeatureTree();
  tree.add({ kind: 'sketch', name: 'Sketch1' });
  tree.add({ kind: 'extrude', name: 'Boss-Extrude1' });
  tree.add({ kind: 'fillet',  name: 'Fillet1' });

  const html = renderToStaticMarkup(
    React.createElement(FeatureTreePanel, { tree })
  );
  assert.ok(html.includes('Sketch1'),         'first feature rendered');
  assert.ok(html.includes('Boss-Extrude1'),   'second feature rendered');
  assert.ok(html.includes('Fillet1'),         'third feature rendered');
  assert.ok(html.includes('3 features'),      'count shown in header');
  // Rollback bar should be present when ≥1 feature exists.
  assert.ok(html.includes('Rollback'),        'rollback bar shown');
}

// ---- suppress toggle flows through the data model -----------------
{
  const tree = new FeatureTree();
  const sketch = tree.add({ kind: 'sketch', name: 'Sketch1' });
  let notifies = 0;
  tree.onChange(() => { notifies++; });

  // Initial render — suppress checkbox checked (i.e. NOT suppressed).
  let html = renderToStaticMarkup(
    React.createElement(FeatureTreePanel, { tree })
  );
  assert.ok(html.includes('checked'), 'unsuppressed feature has checked box');

  // Toggle suppress through the model (mirror what the checkbox onChange does).
  tree.suppress(sketch.id, true);
  assert.equal(sketch.suppressed, true);
  assert.equal(notifies, 1, 'tree change listener fired once');

  // Render again — class should now include the suppressed marker.
  html = renderToStaticMarkup(
    React.createElement(FeatureTreePanel, { tree })
  );
  assert.ok(html.includes('suppressed'), 'row now styled as suppressed');
}

// ---- rollback marker drives buildOrder ----------------------------
{
  const tree = new FeatureTree();
  const a = tree.add({ kind: 'sketch', name: 'A' });
  const b = tree.add({ kind: 'extrude', name: 'B' });
  const c = tree.add({ kind: 'fillet',  name: 'C' });
  tree.rollbackTo(b.id);

  const html = renderToStaticMarkup(
    React.createElement(FeatureTreePanel, { tree })
  );
  // 'C' should still appear (rolled-back features stay in the list,
  // just dimmed via the rolled-back class).
  assert.ok(html.includes('C'), 'rolled-back feature still visible');
  assert.ok(html.includes('rolled-back'), 'rolled-back css class present');
  void a; // satisfies no-unused-vars
}

console.log('[forge-app.tree] all tests passed');
