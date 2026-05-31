/**
 * ForgeSketch — JS facade around the native planegcs constraint solver.
 *
 * The native side exposes `window.forge.sketcher.*` via the Electron preload
 * (see `electron/preload.js`). This class wraps the imperative C API with a
 * small object-oriented surface so feature code never has to remember the
 * sketch handle. The handle is held internally and freed in `dispose()`.
 *
 * Usage:
 *   const sk = new ForgeSketch();
 *   const a = sk.addPoint(0, 0);
 *   const b = sk.addPoint(3, 4);
 *   sk.addConstraint('Distance', [a, b], 10);
 *   const r = sk.solve();             // { status, dof, iterations }
 *   console.log(sk.getPoint(b));      // { x, y } at the post-solve position
 *   sk.dispose();
 *
 * No UI; pure API. Wrappers are intentionally thin — every method maps
 * 1-for-1 onto a native call. The class also surfaces `kinds` / `statuses`
 * lookup tables so callers can pass either a string ("Distance") or the
 * numeric enum value.
 */

import { getForge } from './index.js';

export class ForgeSketch {
  constructor() {
    const forge = getForge();
    if (!forge.sketcher) {
      throw new Error('[forge] sketcher API unavailable (native addon missing planegcs?)');
    }
    this._sk = forge.sketcher;
    this._h = this._sk.createSketch();
    this._disposed = false;
  }

  /** Numeric handle to the native sketch — exposed for diagnostics. */
  get handle() { return this._h; }

  /** Lookup tables (frozen) — `ForgeSketch.kinds.Distance` etc. */
  get kinds()    { return this._sk.kinds; }
  get statuses() { return this._sk.statuses; }

  _assertLive() {
    if (this._disposed) {
      throw new Error('[forge] sketch already disposed');
    }
  }

  _resolveKind(kind) {
    if (typeof kind === 'number') return kind;
    if (typeof kind !== 'string') {
      throw new TypeError(`[forge] constraint kind must be string or number; got ${typeof kind}`);
    }
    const v = this._sk.kinds[kind];
    if (typeof v !== 'number') {
      throw new Error(`[forge] unknown constraint kind: ${kind}`);
    }
    return v;
  }

  // -------------------------------------------------- geometry
  addPoint(x, y) {
    this._assertLive();
    return this._sk.addPoint(this._h, x, y);
  }
  addLine(p0, p1) {
    this._assertLive();
    return this._sk.addLine(this._h, p0, p1);
  }
  addCircle(center, radius) {
    this._assertLive();
    return this._sk.addCircle(this._h, center, radius);
  }
  addArc(center, p0, p1) {
    this._assertLive();
    return this._sk.addArc(this._h, center, p0, p1);
  }

  // -------------------------------------------------- constraints
  /**
   * @param {string|number} kind   one of ForgeSketch.kinds (or its key)
   * @param {number[]}      refs   entity / point IDs (see Sketcher.hpp for shape)
   * @param {number}        [value=0] target scalar for value-bearing kinds
   * @returns {number}     tag id of the registered constraint
   */
  addConstraint(kind, refs, value = 0) {
    this._assertLive();
    return this._sk.addConstraint(this._h, this._resolveKind(kind), refs, value);
  }

  // -------------------------------------------------- solve / inspect
  solve() {
    this._assertLive();
    return this._sk.solve(this._h);
  }
  getPoint(pid) {
    this._assertLive();
    return this._sk.readPoint(this._h, pid);
  }
  setPoint(pid, x, y) {
    this._assertLive();
    this._sk.writePoint(this._h, pid, x, y);
  }

  // -------------------------------------------------- lifecycle
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { this._sk.destroySketch(this._h); } catch { /* ignore */ }
    this._h = 0;
  }
}

export default ForgeSketch;
