/**
 * Headless tests for ContextMenu (Forge-28). The pure logic — edge-clamp
 * + per-kind registry — lives in `ContextMenu.logic.js`; the JSX widget
 * is exercised end-to-end by Playwright's Electron suite.
 */

import assert from 'node:assert/strict';
import {
  clampToViewport,
  registerContextMenu,
  getContextMenuItems,
  listRegisteredKinds,
} from '../ContextMenu.logic.js';

// ---- clampToViewport ---------------------------------------------
{
  const r = clampToViewport({ x: 950, y: 700, w: 200, h: 250,
                               viewportW: 1024, viewportH: 768 });
  assert.ok(r.x + 200 <= 1024 - 4, 'right edge clamped within margin');
  assert.ok(r.y + 250 <= 768 - 4, 'bottom edge clamped within margin');
}
{
  // Negative origin is pushed back to margin.
  const r = clampToViewport({ x: -50, y: -50, w: 100, h: 100,
                               viewportW: 1024, viewportH: 768 });
  assert.ok(r.x >= 4);
  assert.ok(r.y >= 4);
}
{
  // Interior click is unchanged.
  const r = clampToViewport({ x: 200, y: 200, w: 150, h: 150,
                               viewportW: 1024, viewportH: 768 });
  assert.equal(r.x, 200);
  assert.equal(r.y, 200);
}
{
  // Menu larger than viewport collapses to top-left.
  const r = clampToViewport({ x: 500, y: 500, w: 2000, h: 2000,
                               viewportW: 1024, viewportH: 768 });
  assert.equal(r.x, 4);
  assert.equal(r.y, 4);
}

// ---- per-kind registry -------------------------------------------
const kinds = listRegisteredKinds();
for (const k of ['body', 'face', 'edge', 'vertex', 'feature', 'component']) {
  assert.ok(kinds.includes(k), `default kind ${k} preregistered`);
}

registerContextMenu('body', (ctx) => [
  { id: 'hide', label: 'Hide', shortcut: 'H', run: (c) => { c.hidden = true; } },
  { id: 'isolate', label: 'Isolate', when: (c) => c.kind === 'body',
    run: (c) => { c.isolated = true; } },
  { id: 'gone', label: 'Gone', when: () => false, run: () => {} },
]);

const ctx = { kind: 'body', hidden: false };
const items = getContextMenuItems('body', ctx);
assert.equal(items.length, 2, 'when:false items are filtered out');
items.find((i) => i.id === 'hide').run(ctx);
assert.equal(ctx.hidden, true, 'item.run mutates ctx');

assert.deepEqual(getContextMenuItems('nope', {}), [], 'unknown kind → empty');

assert.throws(() => registerContextMenu('', () => []), /kind \+ builder/);
assert.throws(() => registerContextMenu('x', null), /kind \+ builder/);

console.log('[forge.menu] all tests passed');
