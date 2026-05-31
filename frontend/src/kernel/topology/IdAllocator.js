/**
 * ArchDisc Topology Spine — IdAllocator
 *
 * SP-1 Stage S0. Per-body persistent-ID namespace.
 *
 * The pre-spine `Topo*` classes used module-level incrementing counters
 * (`let _faceId = 0`) with global `resetFaceIds()` exports — NOT persistent:
 * not stable across rebuilds, not namespaced to a body, globally resettable.
 *
 * The spine replaces that with a per-`Body` `IdAllocator`: a monotone counter
 * that never reuses a value within the body's lifetime, plus a high-water mark
 * so a rebuilt body can RESUME numbering rather than restart it. Every spine
 * entity gets `body.allocId(kind)` at creation, yielding a string persistent
 * id like `b3:f17` (body tag + entity-kind tag + ordinal). The id is stable for
 * the entity's whole life and is what the UI selection, the `window.__last*`
 * slots, and e2e assertions key on after SP-1 — replacing the brittle 1-based
 * explorer index.
 *
 * Kept additive in S0: no op constructs entities yet, so this class changes no
 * behaviour. It is unit-exercisable directly.
 */

let _bodyOrdinal = 0;

/**
 * Reset the global body-tag counter. Test-only — production never calls this.
 * (Body tags must stay unique within a session; only tests that build many
 *  throwaway bodies and assert on tag strings need a reset.)
 */
export function _resetBodyOrdinal() { _bodyOrdinal = 0; }

export default class IdAllocator {
  /**
   * @param {object} [opts]
   * @param {string} [opts.bodyTag]  explicit body tag (e.g. 'b3'); auto if omitted.
   * @param {number} [opts.highWater] resume numbering above this ordinal
   *        (used when a body is rebuilt and must not collide with prior ids).
   */
  constructor(opts = {}) {
    this.bodyTag = opts.bodyTag || `b${++_bodyOrdinal}`;
    // Per-kind monotone counters. A high-water mark seeds resumed numbering.
    this._counters = Object.create(null);
    this._highWater = Math.max(0, opts.highWater | 0);
    // Every id ever issued by this allocator — uniqueness audit for validateSpine.
    this._issued = new Set();
  }

  /**
   * Allocate the next persistent id for an entity of `kind`.
   * @param {'lump'|'shell'|'face'|'loop'|'coedge'|'edge'|'vertex'|'wire'} kind
   * @returns {string} a persistent id, e.g. 'b3:f17'
   */
  allocId(kind) {
    const tag = KIND_TAG[kind];
    if (!tag) throw new Error(`IdAllocator.allocId: unknown entity kind '${kind}'`);
    // Resume above the high-water mark on the first allocation of any kind.
    if (this._counters[kind] === undefined) {
      this._counters[kind] = this._highWater;
    }
    const ordinal = ++this._counters[kind];
    const id = `${this.bodyTag}:${tag}${ordinal}`;
    if (this._issued.has(id)) {
      // Defensive — a monotone counter cannot collide, but assert the invariant.
      throw new Error(`IdAllocator: duplicate persistent id '${id}'`);
    }
    this._issued.add(id);
    return id;
  }

  /** The current high-water ordinal across all kinds — for serialising a body. */
  highWaterMark() {
    let hi = this._highWater;
    for (const k of Object.keys(this._counters)) {
      if (this._counters[k] > hi) hi = this._counters[k];
    }
    return hi;
  }

  /** Total count of ids issued so far. */
  issuedCount() { return this._issued.size; }

  /** True if `id` was issued by this allocator. */
  owns(id) { return this._issued.has(id); }
}

/** Single-letter entity-kind tag used in the persistent-id string. */
export const KIND_TAG = Object.freeze({
  lump: 'L',
  shell: 'S',
  face: 'f',
  loop: 'lp',
  coedge: 'ce',
  edge: 'e',
  vertex: 'v',
  wire: 'w',
});
