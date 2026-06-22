// Task #21 — pure-function tests for the sub-entity pre-highlight store.
// No DOM, no React. Run: node preHighlightStore.test.mjs

import assert from 'node:assert/strict';
import {
  normalizeHover, setHover, getHover, clearHover,
  setCandidates, getCandidates, hasQuickPick, hoverLabel,
  PREHIGHLIGHT_EVENT,
} from '../preHighlightStore.js';

// ── normalizeHover: valid kinds ───────────────────────────────────────
{
  const f = normalizeHover({ kind: 'face', handle: 7, subIdx: 3, name: 'Plate' });
  assert.equal(f.kind, 'face');
  assert.equal(f.handle, 7);
  assert.equal(f.subType, 'face');
  assert.equal(f.subIdx, 3);
  assert.equal(f.name, 'Plate');
}
{
  // body pick has no subType / subIdx
  const b = normalizeHover({ kind: 'body', handle: 1, name: 'Block' });
  assert.equal(b.kind, 'body');
  assert.equal(b.subType, null);
  assert.equal(b.subIdx, null);
}
{
  // alt index aliases resolve (faceIdx / edgeIdx / vertexIdx / idx)
  assert.equal(normalizeHover({ kind: 'edge', edgeIdx: 5 }).subIdx, 5);
  assert.equal(normalizeHover({ kind: 'vertex', idx: 9 }).subIdx, 9);
  assert.equal(normalizeHover({ kind: 'face', faceIdx: 0 }).subIdx, 0); // 0 is valid
}

// ── normalizeHover: bad input → null (conservative no-op) ─────────────
assert.equal(normalizeHover(null), null);
assert.equal(normalizeHover(undefined), null);
assert.equal(normalizeHover('face'), null);
assert.equal(normalizeHover({}), null);
assert.equal(normalizeHover({ kind: 'banana' }), null);
assert.equal(normalizeHover({ kind: 'FACE', handle: 2 }).kind, 'face'); // case-insensitive

// ── set / get / clear round-trip (no window → dispatch is a no-op) ────
assert.equal(getHover(), null);
const set = setHover({ kind: 'edge', handle: 4, edgeIdx: 2, name: 'Rib' });
assert.equal(set.kind, 'edge');
assert.equal(getHover().subIdx, 2);
// invalid input clears
assert.equal(setHover({ kind: 'nope' }), null);
assert.equal(getHover(), null);

// ── candidates / QuickPick gating ────────────────────────────────────
assert.equal(hasQuickPick(), false);
setCandidates([
  { kind: 'face', handle: 1, subIdx: 0 },
  { kind: 'edge', handle: 1, subIdx: 3 },
  { kind: 'garbage' },          // dropped by normalize
]);
assert.equal(getCandidates().length, 2, 'non-normalizable candidates drop');
assert.equal(hasQuickPick(), true, '2 candidates → QuickPick warranted');
setCandidates([{ kind: 'body', handle: 5 }]);
assert.equal(hasQuickPick(), false, '1 candidate → no QuickPick');
clearHover();
assert.equal(getCandidates().length, 0);
assert.equal(getHover(), null);

// ── hoverLabel formatting ────────────────────────────────────────────
assert.equal(hoverLabel(normalizeHover({ kind: 'body', name: 'Hub' })), 'Body · Hub');
assert.equal(hoverLabel(normalizeHover({ kind: 'body' })), 'Body');
assert.equal(hoverLabel(normalizeHover({ kind: 'face', subIdx: 4, name: 'Top' })),
  'Face 4 · Top');
assert.equal(hoverLabel(normalizeHover({ kind: 'edge', subIdx: 0 })), 'Edge 0');
assert.equal(hoverLabel(null), '');

// ── event payload shape (simulate window) ────────────────────────────
{
  const events = [];
  globalThis.window = {
    dispatchEvent: (e) => { events.push(e); return true; },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // shim CustomEvent for the node env
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  setHover({ kind: 'face', handle: 2, subIdx: 1, name: 'F' });
  const last = events[events.length - 1];
  assert.equal(last.type, PREHIGHLIGHT_EVENT);
  assert.equal(last.detail.hover.kind, 'face');
  assert.equal(last.detail.hover.subIdx, 1);
  assert.ok(Array.isArray(last.detail.candidates));
  clearHover();
  delete globalThis.window;
  delete globalThis.CustomEvent;
}

console.log('[task-21] preHighlightStore — all tests passed');
