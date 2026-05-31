/**
 * Selection filter — restricts what topological entities the viewport
 * picker is allowed to return.
 *
 * Default = everything pickable (vertex / edge / face / body / component).
 * Filters compose multiplicatively: enabling `face` only means the
 * picker returns faces, blocking the others. The renderer subscribes
 * to `onChange()` and updates its picking config; the rest of the app
 * reads `isPickable(kind)` synchronously.
 */

const KINDS = Object.freeze(['vertex', 'edge', 'face', 'body', 'component']);
export { KINDS as SELECTION_KINDS };

export class SelectionFilter {
  constructor(initial = null) {
    this._enabled = new Set(initial || KINDS);
    this._listeners = new Set();
  }
  isPickable(kind) { return this._enabled.has(kind); }
  enabledKinds() { return [...this._enabled]; }
  enable(...kinds)  { for (const k of kinds) this._touch(k, true); }
  disable(...kinds) { for (const k of kinds) this._touch(k, false); }
  only(...kinds) {
    this._enabled = new Set(kinds.filter((k) => KINDS.includes(k)));
    this._notify();
  }
  reset() {
    this._enabled = new Set(KINDS);
    this._notify();
  }
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _touch(kind, on) {
    if (!KINDS.includes(kind)) {
      throw new Error(`[forge.sel] unknown selection kind: ${kind}`);
    }
    const had = this._enabled.has(kind);
    if (on && !had) { this._enabled.add(kind); this._notify(); }
    else if (!on && had) { this._enabled.delete(kind); this._notify(); }
  }
  _notify() {
    for (const fn of this._listeners) {
      try { fn(this.enabledKinds()); } catch (e) { console.error('[forge.sel] listener', e); }
    }
  }
}
