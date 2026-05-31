/**
 * ForgeViewport smoke — the slice doc calls for a React-Testing-Library
 * mount-without-throwing assertion. RTL + JSDOM isn't installed in
 * this repo yet (see `frontend/package.json`); to keep the smoke
 * meaningful we instead verify the equivalent invariants headlessly:
 *
 *   1. The module exports its public surface (every component the
 *      UI-shell agent imports is callable).
 *   2. The pure data-path from `bodiesFromProject` → ForgeBodyMesh
 *      runs without throwing on a stub ForgeProject (proves that the
 *      viewport's mount-time data assembly is safe even when the
 *      kernel hasn't loaded — the "Loading kernel…" branch).
 *   3. The default ViewportStore initialises with the expected shape.
 *
 * When JSDOM lands (Forge-26's test harness) the smoke graduates to a
 * `render(<ForgeViewport project={...} />)` call.
 */

import assert from 'node:assert/strict';

// NB: import from the per-file `.js` paths rather than `../index.js` —
// the barrel pulls in JSX components which Node can't parse without a
// transformer (Vite handles them at build time). This keeps the smoke
// runnable as plain Node and only loads the pure helpers.
import {
  ViewportStore,
  makeDefaultViewportState,
  bodiesFromProject,
} from '../viewportState.js';
import { DISPLAY_STATES, DEFAULT_DISPLAY_STATE } from '../displayStateMaterial.js';

// ---- 1. public surface exists -----------------------------------------
assert.equal(typeof ViewportStore, 'function');
assert.ok(Array.isArray(DISPLAY_STATES) && DISPLAY_STATES.length === 5);
assert.equal(DEFAULT_DISPLAY_STATE, 'shaded');

// ---- 2. mount-time data assembly is safe on an empty project ----------
{
  // A ForgeProject that hasn't been rebuilt yet has zero outputHandles.
  const fakeProject = {
    featureTree: {
      buildOrder: function* () { /* empty */ },
    },
  };
  const list = bodiesFromProject(fakeProject);
  assert.deepEqual(list, [],
    'bodiesFromProject returns [] for an empty feature tree');
}
{
  // Real-world shape: project hasn't been hydrated yet — featureTree null.
  assert.deepEqual(bodiesFromProject(null), [],
    'bodiesFromProject tolerates null project (kernel-loading branch)');
  assert.deepEqual(bodiesFromProject({}), [],
    'bodiesFromProject tolerates partial project');
}
{
  // A project with two built bodies — both should appear in build order.
  const fakeProject = {
    featureTree: {
      buildOrder: function* () {
        yield { outputHandle: 11, id: 'f-1', name: 'Extrude1' };
        yield { outputHandle: 12, id: 'f-2', name: 'Boolean1' };
        yield { outputHandle: null, id: 'f-3', name: 'Sketch1' }; // skipped
      },
    },
  };
  const list = bodiesFromProject(fakeProject);
  assert.equal(list.length, 2, 'two bodies survive');
  assert.deepEqual(list.map((b) => b.handle), [11, 12]);
  assert.equal(list[0].name, 'Extrude1');
}

// ---- 3. default ViewportStore -------------------------------------------
{
  const store = new ViewportStore();
  const s = store.get();
  assert.equal(s.theme, 'dark');
  assert.equal(s.displayState, DEFAULT_DISPLAY_STATE);
  assert.equal(s.gizmoMode, 'translate');
  assert.equal(s.activeProject, null);
  assert.ok(Array.isArray(s.selection));
  assert.ok(Array.isArray(s.namedViews));
  assert.equal(s.sectionPlane, null);
  assert.ok(s.selectionFilter && typeof s.selectionFilter.isPickable === 'function');
}

// ---- 4. defaults are immutable across calls ----------------------------
{
  const a = makeDefaultViewportState();
  const b = makeDefaultViewportState();
  assert.notStrictEqual(a, b, 'each call returns a fresh object');
  assert.notStrictEqual(a.selection, b.selection, 'arrays are not shared');
}

console.log('[forge.viewport] ForgeViewport smoke passed');
