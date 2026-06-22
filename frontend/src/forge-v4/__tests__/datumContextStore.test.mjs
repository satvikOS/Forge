// Task #21 — pure-function tests for the datum-context store.
// No DOM, no React. Run: node datumContextStore.test.mjs

import assert from 'node:assert/strict';
import {
  normalizeDatum, normalizeSnap, setActiveDatum, getActiveDatum,
  setSnapTarget, getSnapTarget, setFilterKind, getFilterKind,
  clearDatumContext, datumLabel, snapLabel, DATUM_CONTEXT_EVENT,
} from '../datumContextStore.js';

// ── normalizeDatum ────────────────────────────────────────────────────
{
  const d = normalizeDatum({ name: 'DATUM_A', type: 'plane' });
  assert.deepEqual(d, { name: 'DATUM_A', type: 'plane' });
}
assert.equal(normalizeDatum({ name: 'X', type: 'axis' }).type, 'axis');
assert.equal(normalizeDatum({ name: 'X', type: 'CSYS' }).type, 'csys'); // case-insensitive
assert.equal(normalizeDatum({ name: 'X', type: 'weird' }).type, 'csys'); // unknown → csys fallback
assert.equal(normalizeDatum({ type: 'plane' }), null, 'no name → null');
assert.equal(normalizeDatum(null), null);
assert.equal(normalizeDatum('plane'), null);
// name sanitization
assert.ok(!/[<>]/.test(normalizeDatum({ name: '<b>A</b>', type: 'plane' }).name));

// ── normalizeSnap ─────────────────────────────────────────────────────
{
  const s = normalizeSnap({ type: 'midpoint', coords: [1, 2, 3] });
  assert.equal(s.type, 'midpoint');
  assert.deepEqual(s.coords, [1, 2, 3]);
}
assert.equal(normalizeSnap({ type: 'endpoint' }).coords, null, 'coords optional');
assert.equal(normalizeSnap({ type: 'bogus' }), null, 'unknown snap type → null');
assert.equal(normalizeSnap({ type: 'center', coords: [1, 2] }).coords, null, 'bad coords dropped');
assert.equal(normalizeSnap(null), null);

// ── set / get / clear datum ───────────────────────────────────────────
assert.equal(getActiveDatum(), null);
setActiveDatum({ name: 'DATUM_B', type: 'plane' });
assert.equal(getActiveDatum().name, 'DATUM_B');
setActiveDatum(null);  // clears
assert.equal(getActiveDatum(), null);
setActiveDatum({ type: 'plane' }); // invalid (no name) → clears to null
assert.equal(getActiveDatum(), null);

// ── set / get / clear snap ────────────────────────────────────────────
setSnapTarget({ type: 'intersection', coords: [5, 5, 0] });
assert.equal(getSnapTarget().type, 'intersection');
setSnapTarget(null);
assert.equal(getSnapTarget(), null);

// ── filter kind mirror ────────────────────────────────────────────────
assert.equal(setFilterKind('face'), 'face');
assert.equal(getFilterKind(), 'face');
assert.equal(setFilterKind('bogus'), null, 'invalid filter kind → null');
assert.equal(setFilterKind('BODY'), 'body', 'case-insensitive');

// ── clearDatumContext resets both ─────────────────────────────────────
setActiveDatum({ name: 'D', type: 'point' });
setSnapTarget({ type: 'grid' });
clearDatumContext();
assert.equal(getActiveDatum(), null);
assert.equal(getSnapTarget(), null);

// ── labels ────────────────────────────────────────────────────────────
assert.equal(datumLabel({ name: 'A', type: 'plane' }), 'Plane A');
assert.equal(datumLabel({ name: 'WCS', type: 'csys' }), 'CSYS WCS');
assert.equal(datumLabel(null), '');
assert.equal(snapLabel({ type: 'midpoint', coords: null }), 'Midpoint');
assert.equal(snapLabel({ type: 'center', coords: [1, 2, 3] }), 'Center (1.0, 2.0, 3.0)');
assert.equal(snapLabel(null), '');

// ── event payload (simulate window) ───────────────────────────────────
{
  const events = [];
  globalThis.window = { dispatchEvent: (e) => { events.push(e); return true; } };
  globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
  setActiveDatum({ name: 'DATUM_C', type: 'axis' });
  const last = events[events.length - 1];
  assert.equal(last.type, DATUM_CONTEXT_EVENT);
  assert.equal(last.detail.datum.name, 'DATUM_C');
  assert.equal(last.detail.datum.type, 'axis');
  clearDatumContext();
  delete globalThis.window;
  delete globalThis.CustomEvent;
}

console.log('[task-21] datumContextStore — all tests passed');
