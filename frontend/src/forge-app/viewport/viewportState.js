/**
 * viewportState — the AppState contract this slice expects.
 *
 * Forge-26 (UI-shell agent) owns the actual AppState provider. We
 * defensively define the same shape here as a fallback + a tiny
 * subscribable store so this slice's components work in isolation
 * (and in the headless test runner) without depending on a global
 * context.
 *
 * Shape:
 *   {
 *     activeProject:   ForgeProject | null,
 *     selection:       Array<{ handle, kind }>,
 *     selectionFilter: SelectionFilter,
 *     namedViews:      Array<{ id, name, state, thumbnail }>,
 *     displayState:    one of DISPLAY_STATES,
 *     theme:           'dark' | 'light',
 *     sectionPlane:    { enabled, normal:[x,y,z], offset:number } | null,
 *     gizmoMode:       'translate' | 'rotate' | 'scale',
 *     measurement:     { active: bool, points: [], summary: {…} },
 *     motionPlayer:    MotionPlayer | null,
 *   }
 */

import { SelectionFilter } from '../../kernel/forge/SelectionFilter.js';
import { DEFAULT_DISPLAY_STATE } from './displayStateMaterial.js';

let nextNamedViewId = 1;

export function makeDefaultViewportState() {
  return {
    activeProject:   null,
    selection:       [],
    selectionFilter: new SelectionFilter(),
    namedViews:      [],
    displayState:    DEFAULT_DISPLAY_STATE,
    theme:           'dark',
    sectionPlane:    null,
    gizmoMode:       'translate',
    measurement:     { active: false, points: [], summary: null },
    motionPlayer:    null,
  };
}

/**
 * Tiny pub-sub store — mirrors the rxjs-style stores Forge-26 will
 * expose so this slice can plug directly in once the shell lands.
 */
export class ViewportStore {
  constructor(initial = null) {
    this._state = initial || makeDefaultViewportState();
    this._listeners = new Set();
  }
  get() { return this._state; }
  set(partial) {
    this._state = { ...this._state, ...partial };
    this._emit();
  }
  update(fn) {
    const next = fn({ ...this._state });
    this._state = next;
    this._emit();
  }
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _emit() {
    for (const fn of this._listeners) {
      try { fn(this._state); } catch (e) { console.error('[viewportStore]', e); }
    }
  }

  // ---- named views helpers ---------------------------------------
  pushNamedView({ name, state, thumbnail }) {
    const v = { id: `nv-${nextNamedViewId++}`, name, state, thumbnail };
    this._state = { ...this._state, namedViews: [...this._state.namedViews, v] };
    this._emit();
    return v;
  }
  removeNamedView(id) {
    this._state = {
      ...this._state,
      namedViews: this._state.namedViews.filter((v) => v.id !== id),
    };
    this._emit();
  }
  renameNamedView(id, name) {
    this._state = {
      ...this._state,
      namedViews: this._state.namedViews.map((v) => v.id === id ? { ...v, name } : v),
    };
    this._emit();
  }
}

/**
 * Pull the build-order body list from a ForgeProject. Defensive: a
 * project whose kernel hasn't loaded yet returns an empty list so the
 * viewport just shows the empty grid rather than crashing.
 */
export function bodiesFromProject(project) {
  if (!project || !project.featureTree) return [];
  const out = [];
  try {
    for (const f of project.featureTree.buildOrder()) {
      // Each yielded feature stored its native output handle in `outputHandle`.
      // Features that resolve to bodies (extrudes, booleans, imports…) get
      // rendered; sketches / planes / params don't.
      if (f.outputHandle && Number.isInteger(f.outputHandle) && f.outputHandle > 0) {
        out.push({ handle: f.outputHandle, featureId: f.id, name: f.name });
      }
    }
  } catch (e) {
    console.warn('[forge.viewport] bodiesFromProject', e);
  }
  return out;
}

/**
 * Filter a list of raw picks (`[{ handle, kind }, …]`) through the
 * active SelectionFilter. Used by both the click picker and the
 * box-select code path so they agree on what's selectable.
 */
export function gatePicks(picks, filter) {
  if (!filter || typeof filter.isPickable !== 'function') return picks || [];
  return (picks || []).filter((p) => filter.isPickable(p.kind));
}
