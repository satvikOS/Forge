// Task #21 — pure-function tests for the selection-filter logic + the
// imperative window API (no-setState round-trip). Run via node.

import assert from 'node:assert/strict';
import {
  FILTER_KINDS, isFilterKind, filterNoun, nextFilterKind, filterMenuId,
  getFilter, setFilter, cycleFilter, installSelectionFilterApi,
} from '../selectionFilterApi.js';

// ── kind validation ───────────────────────────────────────────────────
assert.deepEqual(FILTER_KINDS, ['body', 'face', 'edge', 'vertex']);
assert.equal(isFilterKind('face'), true);
assert.equal(isFilterKind('faces'), false);
assert.equal(isFilterKind(null), false);

// ── noun map (singular/plural) ────────────────────────────────────────
assert.equal(filterNoun('body', 1), 'Body');
assert.equal(filterNoun('body', 0), 'Bodies');
assert.equal(filterNoun('face', 1), 'Face');
assert.equal(filterNoun('face', 2), 'Faces');
assert.equal(filterNoun('vertex', 1), 'Vertex');
assert.equal(filterNoun('vertex', 3), 'Vertices');
assert.equal(filterNoun('edge', 0), 'Edges');

// ── cycle order (Body→Face→Edge→Vertex→Body) ─────────────────────────
assert.equal(nextFilterKind('body'), 'face');
assert.equal(nextFilterKind('face'), 'edge');
assert.equal(nextFilterKind('edge'), 'vertex');
assert.equal(nextFilterKind('vertex'), 'body');
assert.equal(nextFilterKind('garbage'), 'body'); // unknown → default to first kind

// ── menu id map (drives ForgeShellV4.onMenuAction) ───────────────────
assert.equal(filterMenuId('body'), 'edit.filterBody');
assert.equal(filterMenuId('face'), 'edit.filterFace');
assert.equal(filterMenuId('edge'), 'edit.filterEdge');
assert.equal(filterMenuId('vertex'), 'edit.filterVert');
assert.equal(filterMenuId('nope'), null);

// ── imperative setFilter round-trips through BOTH buses (no setState) ──
{
  const fired = [];
  globalThis.window = {
    __forgeSelectionFilter: 'body',
    dispatchEvent: (e) => { fired.push(e); return true; },
  };
  globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };

  const out = setFilter('edge', 'unit');
  assert.equal(out, 'edge');
  // canonical string contract preserved
  assert.equal(globalThis.window.__forgeSelectionFilter, 'edge');
  // menu-action fired with the right id + source
  const menu = fired.find((e) => e.type === 'forge:menu-action');
  assert.ok(menu, 'menu-action dispatched');
  assert.equal(menu.detail.id, 'edit.filterEdge');
  assert.equal(menu.detail.source, 'unit');
  // filter-changed fired with the kind
  const changed = fired.find((e) => e.type === 'forge:filter-changed');
  assert.ok(changed, 'filter-changed dispatched');
  assert.equal(changed.detail.kind, 'edge');

  // invalid set is a no-op (returns current, no clobber)
  fired.length = 0;
  const same = setFilter('bogus');
  assert.equal(same, 'edge');
  assert.equal(fired.length, 0, 'invalid kind dispatches nothing');

  // getFilter prefers the published string
  globalThis.window.__forgeSelectionFilter = 'vertex';
  assert.equal(getFilter(), 'vertex');

  // cycle advances from the current published kind
  cycleFilter();
  assert.equal(globalThis.window.__forgeSelectionFilter, 'body', 'vertex → body');

  // install namespace + verify shape
  const uninstall = installSelectionFilterApi();
  assert.equal(typeof globalThis.window.__forgeSelectionFilterApi.set, 'function');
  assert.equal(typeof globalThis.window.__forgeSelectionFilterApi.cycle, 'function');
  globalThis.window.__forgeSelectionFilterApi.set('face');
  assert.equal(globalThis.window.__forgeSelectionFilter, 'face');
  assert.deepEqual(globalThis.window.__forgeSelectionFilterApi.kinds(), FILTER_KINDS);
  uninstall();
  assert.equal(globalThis.window.__forgeSelectionFilterApi, undefined, 'uninstall removes namespace');

  delete globalThis.window;
  delete globalThis.CustomEvent;
}

console.log('[task-21] selectionFilterApi — all tests passed');
