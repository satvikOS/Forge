/**
 * ArchDisc Kernel — History & Rollback
 *
 * SP-3a — kernel-level history with forward / inverse deltas, named marks,
 * roll back / roll forward, replay. Mirrors the ACIS bulletin board / Parasolid
 * macro-and-rollback machinery enumerated at line 312 of
 * `docs/ARCHDISC_VISION_AND_ROADMAP.md` ("the bulletin-board history /
 * rollback system; transaction macros") and called out as Area L of the
 * kernel-parity program (`docs/superpowers/plans/2026-05-21-kernel-parity-
 * program.md`).
 *
 * Two prior sub-projects supply the substrate this module needs:
 *   - SP-1 §2.3 — persistent ids on every spine entity, namespaced to the
 *     body. The history log keys body-level deltas on
 *     `SpineBody.body.persistentId`, NOT on a transient pointer or a
 *     React-state reference. A body that is removed + re-created during
 *     replay therefore re-attaches under the same id and downstream
 *     lookups (`findBodyByPersistentId`) keep working.
 *   - SP-2 — persistent attributes on every spine entity. SP-3a's delta
 *     contract is "topology + attributes round-trip exactly"; the inverse
 *     of a body-create therefore removes the entity AND its attribute
 *     payload by id, and the forward re-creates both.
 *
 * ── The mental model ───────────────────────────────────────────────────────
 *
 *   entries   — an APPEND-ONLY array of per-op records.
 *   cursor    — index of the LAST APPLIED entry. Cursor === -1 ⇔ the log is
 *               at its empty baseline; cursor === entries.length - 1 ⇔ every
 *               recorded op is applied; cursor === k (k < length-1) ⇔ ops
 *               (k+1)…(length-1) have been ROLLED BACK and are eligible for
 *               roll-forward.
 *   marks     — named pointers into entries[]. `mark(name)` creates an entry
 *               at the current cursor whose `mark` is the name. `rollBackTo`
 *               / `rollForwardTo` accept a mark name OR an entry id.
 *
 * The cursor convention is the classic undo/redo timeline:
 *
 *     [ entry-0 ][ entry-1 ][ entry-2 ][ entry-3 ]
 *                     ^cursor=1
 *
 *   - rollBackTo(entry-0)   → walk inverses of entry-2, entry-1 (newest first
 *                             of the "applied above target" set), cursor → 0.
 *   - rollForwardTo(entry-3)→ apply forwards of entry-2, entry-3 in order,
 *                             cursor → 3.
 *
 * ── Rollback-then-act invalidates the redo stack ───────────────────────────
 *
 * Classic undo/redo. After `rollBackTo(target)` the cursor sits at `target`'s
 * index; if the NEXT op recorded is `recordOp(...)`, every entry AFTER the
 * cursor at that moment is discarded — the new branch supersedes the old.
 * This matches every editor / kernel users expect.
 *
 * ── Delta format ───────────────────────────────────────────────────────────
 *
 * Each entry's `forward` and `inverse` are pure functions of a `scene`
 * context object the caller supplies to `rollBackTo`/`rollForwardTo`/`replay`.
 * The context is delivered AS-IS — the log does not interpret it. The
 * caller's `scene` is typically `{ scene, viewport, kernel }` so a delta can:
 *   - forward: build / register a body in the THREE scene + BodyRegistry,
 *     populating the persistent slots.
 *   - inverse: remove the body BY PERSISTENT ID from the registry, which
 *     also detaches its Three.js group from the scene (BodyRegistry.remove).
 *
 * `dependsOn` is an optional array of prior entry ids the entry depends on;
 * the log does not enforce dependency-ordering itself (the caller chooses
 * the recording order), but `dependsOn` is exposed on entries for
 * downstream visualisers (a future Design History pane that shows the
 * feature DAG).
 *
 * ── Edge cases handled ─────────────────────────────────────────────────────
 *
 *   - Rollback past the first entry → cursor clamps to -1 (the baseline);
 *     no-op if already at -1.
 *   - Forward past the tail → cursor clamps to entries.length-1; no-op if
 *     already at the tail.
 *   - `rollBackTo(currentEntry)` → no-op (cursor unchanged, no inverses run).
 *   - `rollForwardTo(currentEntry)` → no-op (already there).
 *   - Recording after a partial rollback truncates the future — the redo
 *     stack is invalidated.
 *   - `entryById` / `markByName` for an unknown identifier → null.
 *   - Inverse / forward throw → the error propagates; cursor is NOT
 *     advanced past the failing step (the log refuses to lie about state).
 */

let _entryOrdinal = 0;

/**
 * Reset the global entry-ordinal counter — TEST-ONLY. Production never calls
 * this; the ordinal is the durable id used in named-mark references.
 */
export function _resetEntryOrdinal() { _entryOrdinal = 0; }

/**
 * @typedef {object} HistoryEntry
 * @property {string}   id         monotone string id, e.g. 'h-7'.
 * @property {string}   opName     human label, e.g. 'makeBox'.
 * @property {string=}  mark       if present, this entry is a NAMED MARK;
 *                                 its forward + inverse default to no-ops.
 * @property {number}   time       Date.now() at record time.
 * @property {function} forward    forward delta: (sceneCtx) → any | Promise.
 * @property {function} inverse    inverse delta: (sceneCtx) → any | Promise.
 * @property {string[]} dependsOn  optional prior entry ids this depends on.
 * @property {object=}  meta       opaque caller payload (op params, ids, ...).
 */

export default class HistoryLog {
  constructor() {
    /** @type {HistoryEntry[]} */
    this.entries = [];
    /** Cursor — index of the LAST APPLIED entry; -1 ⇔ empty/baseline. */
    this.cursor = -1;
    /** name → entry index lookup (only marks; populated by `mark()`). */
    this._markIndex = new Map();
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Append a new op entry and advance the cursor.
   *
   * If the cursor is NOT at the tail (i.e. we are mid-rollback), every
   * entry after the cursor is DISCARDED first — the classic rollback-then-
   * act invalidates the redo stack rule. Any named marks that pointed into
   * the discarded tail are dropped from the mark index.
   *
   * The entry is recorded AS-IF the forward has just run — the caller has
   * already executed the op; `recordOp` is the bookkeeping of that fact, not
   * the trigger to run it. (The forward is re-run on roll-forward.)
   *
   * @param {{opName:string, forward:Function, inverse:Function,
   *          dependsOn?:string[], meta?:object}} spec
   * @returns {HistoryEntry}
   */
  recordOp(spec) {
    if (!spec || typeof spec.forward !== 'function' || typeof spec.inverse !== 'function') {
      throw new Error('HistoryLog.recordOp: spec.forward and spec.inverse must be functions');
    }
    this._truncateRedo();
    const entry = this._makeEntry({
      opName: String(spec.opName || 'op'),
      forward: spec.forward,
      inverse: spec.inverse,
      dependsOn: Array.isArray(spec.dependsOn) ? spec.dependsOn.slice() : [],
      meta: spec.meta && typeof spec.meta === 'object' ? { ...spec.meta } : {},
    });
    this.entries.push(entry);
    this.cursor = this.entries.length - 1;
    return entry;
  }

  /**
   * Drop the partial-rollback "future" branch — every entry above the cursor.
   * Marks pointing into the discarded range are also removed.
   * No-op if the cursor is already at the tail.
   */
  _truncateRedo() {
    if (this.cursor === this.entries.length - 1) return;
    const keep = this.cursor + 1;
    if (keep < 0) {
      // Everything is going — clear marks too.
      this.entries.length = 0;
      this._markIndex.clear();
      return;
    }
    const discarded = this.entries.splice(keep);
    if (discarded.length === 0) return;
    // Rebuild the mark index without the discarded marks. Cheaper than
    // iterating discarded entries: just rescan the kept ones.
    this._markIndex.clear();
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e && e.mark) this._markIndex.set(e.mark, i);
    }
  }

  /**
   * Create a named mark at the CURRENT cursor position. A mark is a special
   * entry whose forward + inverse are no-ops by default — it exists purely
   * to be referenced by `rollBackTo` / `rollForwardTo`. Recording a mark
   * advances the cursor onto the mark itself.
   *
   * Duplicate mark names overwrite the prior occurrence — the most-recent
   * mark of that name is the one `rollBackTo(name)` resolves to. (This
   * matches ACIS BULLETIN_BOARD::set_state(label) semantics — labels are
   * not unique across the timeline; the latest wins.)
   *
   * @param {string} name
   * @param {object} [meta]
   * @returns {HistoryEntry} the mark entry just appended.
   */
  mark(name, meta) {
    if (!name || typeof name !== 'string') {
      throw new Error('HistoryLog.mark: name must be a non-empty string');
    }
    this._truncateRedo();
    const entry = this._makeEntry({
      opName: 'mark',
      mark: name,
      forward: NOOP,
      inverse: NOOP,
      dependsOn: [],
      meta: meta && typeof meta === 'object' ? { ...meta } : {},
    });
    this.entries.push(entry);
    this.cursor = this.entries.length - 1;
    this._markIndex.set(name, this.cursor);
    return entry;
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  /** Find an entry by its id. Null if no match. */
  entryById(id) {
    if (!id) return null;
    for (const e of this.entries) { if (e.id === id) return e; }
    return null;
  }

  /** Find a mark entry by its name. Null if no match. */
  markByName(name) {
    const idx = this._markIndex.get(name);
    return (typeof idx === 'number' && idx >= 0 && idx < this.entries.length)
      ? this.entries[idx] : null;
  }

  /** Return every named mark in cursor order. */
  listMarks() {
    return this.entries.filter(e => e && e.mark);
  }

  /**
   * The entry at the current cursor — either an op or a mark. null if the
   * log is at its empty baseline.
   */
  currentMarkOrEntry() {
    if (this.cursor < 0 || this.cursor >= this.entries.length) return null;
    return this.entries[this.cursor];
  }

  // ── Roll back / roll forward ──────────────────────────────────────────────

  /**
   * Walk inverses of every entry currently ABOVE the target (newest first),
   * landing the cursor on `target`'s index. Accepts a mark-name string, an
   * entry id, or an entry object.
   *
   * Edge cases:
   *   - target unknown → throws (loud, not silent — the caller's reference
   *     is wrong; better to fail than to drift).
   *   - target IS the current cursor → no-op.
   *   - target is ABOVE the current cursor → caller meant `rollForwardTo`;
   *     we accept it as a forward call (symmetric, matches Parasolid
   *     PK_PARTITION_set_history_state which moves in either direction).
   *   - target index -1 (the "baseline" pseudo-target) supported by passing
   *     the literal string '__baseline'.
   *   - an inverse throws → cursor stays at the last-successfully-rolled
   *     entry; the error propagates. Honest, non-lying state.
   *
   * @param {string|HistoryEntry} target
   * @param {object} [sceneCtx]  passed through to each inverse.
   * @returns {Promise<{from:number,to:number,steps:number}>}
   */
  async rollBackTo(target, sceneCtx) {
    const toIdx = this._resolveIndex(target, /*allowBaseline*/ true);
    if (toIdx === this.cursor) return { from: toIdx, to: toIdx, steps: 0 };
    if (toIdx > this.cursor) {
      // Caller meant forward — symmetric, accept.
      return this.rollForwardTo(target, sceneCtx);
    }
    const from = this.cursor;
    let steps = 0;
    // Walk inverses newest-first of entries (toIdx, cursor].
    while (this.cursor > toIdx) {
      const entry = this.entries[this.cursor];
      if (!entry) break;
      // mark entries have NOOP inverses; they still count as a cursor step.
      try {
        await entry.inverse(sceneCtx);
      } catch (err) {
        // The inverse failed — cursor stays where it is so state is honest.
        const wrapped = new Error(
          `HistoryLog.rollBackTo: inverse of '${entry.opName}' (id=${entry.id}) ` +
          `failed at step ${steps + 1} → cursor=${this.cursor}. Cause: ${err && err.message || err}`,
        );
        wrapped.cause = err;
        throw wrapped;
      }
      this.cursor -= 1;
      steps += 1;
    }
    return { from, to: this.cursor, steps };
  }

  /**
   * Re-apply forwards from the entry RIGHT AFTER the current cursor up to
   * `target`'s index (inclusive). Accepts a mark name, entry id, or entry.
   *
   * Edge cases: symmetric to rollBackTo. Forward past the tail is clamped
   * (no-op past the end). Backwards target re-routes to rollBackTo.
   *
   * @param {string|HistoryEntry} target
   * @param {object} [sceneCtx]
   * @returns {Promise<{from:number,to:number,steps:number}>}
   */
  async rollForwardTo(target, sceneCtx) {
    const toIdx = this._resolveIndex(target, /*allowBaseline*/ false);
    if (toIdx === this.cursor) return { from: toIdx, to: toIdx, steps: 0 };
    if (toIdx < this.cursor) return this.rollBackTo(target, sceneCtx);
    const from = this.cursor;
    let steps = 0;
    while (this.cursor < toIdx) {
      const next = this.cursor + 1;
      const entry = this.entries[next];
      if (!entry) break;
      try {
        await entry.forward(sceneCtx);
      } catch (err) {
        const wrapped = new Error(
          `HistoryLog.rollForwardTo: forward of '${entry.opName}' (id=${entry.id}) ` +
          `failed at step ${steps + 1} → cursor=${this.cursor}. Cause: ${err && err.message || err}`,
        );
        wrapped.cause = err;
        throw wrapped;
      }
      this.cursor = next;
      steps += 1;
    }
    return { from, to: this.cursor, steps };
  }

  /**
   * Re-apply forwards from `from` (exclusive) up to `to` (inclusive). Both
   * accept a string id / name or an entry. Used when rebuilding a session's
   * state from a serialised log — start at cursor=-1, call replay(null, tail).
   *
   * @param {string|HistoryEntry|null} from  null ⇔ start at the baseline.
   * @param {string|HistoryEntry} to
   * @param {object} [sceneCtx]
   */
  async replay(from, to, sceneCtx) {
    const fromIdx = from == null ? -1 : this._resolveIndex(from, /*allowBaseline*/ true);
    const toIdx = this._resolveIndex(to, /*allowBaseline*/ false);
    if (fromIdx > toIdx) {
      throw new Error(
        `HistoryLog.replay: from (${fromIdx}) is AFTER to (${toIdx}) — replay only runs forwards`,
      );
    }
    // Position cursor at fromIdx without running any deltas, then forward.
    this.cursor = fromIdx;
    return this.rollForwardTo(this.entries[toIdx], sceneCtx);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Resolve a target reference (mark name | entry id | entry object | the
   * literal '__baseline') to its array index. Throws on unknown targets.
   */
  _resolveIndex(target, allowBaseline) {
    if (target == null) {
      throw new Error('HistoryLog: target is required');
    }
    // The literal '__baseline' string means "before any entries".
    if (target === '__baseline') {
      if (!allowBaseline) {
        throw new Error('HistoryLog: cannot roll forward to the baseline');
      }
      return -1;
    }
    // An entry object directly.
    if (typeof target === 'object' && target.id) {
      const idx = this.entries.indexOf(target);
      if (idx < 0) throw new Error(`HistoryLog: entry '${target.id}' not in log`);
      return idx;
    }
    // String — try mark name first, then entry id.
    if (typeof target === 'string') {
      if (this._markIndex.has(target)) return this._markIndex.get(target);
      for (let i = 0; i < this.entries.length; i++) {
        if (this.entries[i].id === target) return i;
      }
    }
    throw new Error(`HistoryLog: unknown target '${target}'`);
  }

  _makeEntry(fields) {
    return {
      id: `h-${++_entryOrdinal}`,
      time: Date.now(),
      mark: null,
      ...fields,
    };
  }
}

const NOOP = () => undefined;

// ─── Singleton + canonical delta shapes ──────────────────────────────────────
//
// The kernel needs ONE shared HistoryLog per session — the timeline-scrubber
// UI, the AI plan replay, every op's recording shim all read and write the
// same log. This module owns the singleton; the barrel just re-exports.
// A future per-document scope (multi-tab editor, comparison sandbox) replaces
// `getHistoryLog()` with a per-doc map — concentrated here.

let _singletonLog = null;

/**
 * When true, `recordBodyCreate` (and any SP-3b helper that consults this flag)
 * silently skips appending an entry — used by callers that want to drive their
 * own custom delta (e.g. wrapping "make + position" as a single forward/inverse
 * pair, rather than two separate entries). Defaults to false; set/reset around
 * the suppressed section. The flag is global and synchronous — no concurrent
 * recording assumed.
 */
let _recordingSuppressed = false;

/** The shared kernel HistoryLog. Lazily allocated on first access. */
export function getHistoryLog() {
  if (!_singletonLog) {
    _singletonLog = new HistoryLog();
    // Expose the singleton so e2e specs and AI introspection can drive it
    // without bundling kernel/history separately. The name is distinct from
    // `window.__archdiscHistory` (which is the legacy app-level Design
    // History stack) — the kernel log is the new SP-3a bulletin-board over
    // the spine. SP-3b will widen the API here; SP-3c wires the timeline
    // scrubber to it.
    if (typeof globalThis !== 'undefined' && globalThis.window) {
      globalThis.window.__archdiscKernelHistory = _singletonLog;
      // Suppression toggle on the window so callers that record a
      // multi-op aggregate (an e2e, an AI plan-step) can disable the
      // inner-op auto-record cleanly.
      globalThis.window.__archdiscSuppressKernelHistory = (flag) => {
        _recordingSuppressed = !!flag;
        return _recordingSuppressed;
      };
    }
  }
  return _singletonLog;
}

/** True if recording is currently suppressed (see `setRecordingSuppressed`). */
export function isRecordingSuppressed() { return _recordingSuppressed; }

/** Set / unset the recording-suppressed flag. Returns the new value. */
export function setRecordingSuppressed(flag) {
  _recordingSuppressed = !!flag;
  return _recordingSuppressed;
}

/**
 * Replace the singleton — TEST-ONLY. Production never calls this.
 * (e2e specs that need a fresh log per `test()` use this; live code
 * always gets the same instance.)
 */
export function setHistoryLogForTest(log) {
  _singletonLog = log || new HistoryLog();
  return _singletonLog;
}

/**
 * Record a "body created" op on the shared log.
 *
 * The standard SP-3a delta contract for any op that PRODUCES a brand-new
 * spine body (every primitive in SP-3a; every boolean / feature / surfacing
 * op in SP-3b):
 *
 *   forward(sceneCtx)
 *     1. Re-run the op constructor (the caller-supplied `rebuild` thunk),
 *        producing a fresh SpineBody whose persistent id matches the
 *        originally-built one (the rebuild thunk seeds bindSpine with the
 *        same bodyTag so the IdAllocator's namespace is identical).
 *     2. Hand the SpineBody to the caller-supplied `register` thunk, which
 *        places it in the scene + registers in BodyRegistry. The scene
 *        layer (ToolExecutionEngine.addBrepShapeToScene) handles the
 *        Three.js group, mesh, `window.__last*` mirroring.
 *
 *   inverse(sceneCtx)
 *     1. Caller-supplied `remove` thunk locates the body in the registry
 *        by its persistent id and calls BodyRegistry.remove — which also
 *        detaches the Three.js group from the scene and clears it from
 *        selection (one atomic departure).
 *
 * The thunks let this module stay decoupled from the scene / registry layer
 * (no React imports here). The SP-3a hook in BrepPrimitives.makeBox supplies
 * a `rebuild` that calls the same kernel op the user clicked, and a
 * `register` that delegates to `window.__archdiscAddBrepShape` (the canonical
 * scene-add path the SP-1 S3 hook installed). e2e specs can also drive
 * `recordBodyCreate` directly when they want to time-travel through a
 * pre-built body without going via the ribbon.
 *
 * @param {{
 *   opName:    string,
 *   persistentBodyId: string,
 *   rebuild:   () => Promise<object>|object,
 *   register:  (body:object, sceneCtx?:object) => Promise<any>|any,
 *   remove:    (persistentBodyId:string, sceneCtx?:object) => Promise<any>|any,
 *   meta?:     object,
 *   dependsOn?: string[],
 * }} spec
 * @returns {object|null} the HistoryEntry just appended, or null if
 *   recording was suppressed.
 */
export function recordBodyCreate(spec) {
  if (!spec || typeof spec.rebuild !== 'function'
      || typeof spec.register !== 'function'
      || typeof spec.remove !== 'function'
      || !spec.persistentBodyId) {
    throw new Error(
      'recordBodyCreate: spec must include {opName, persistentBodyId, rebuild, register, remove}',
    );
  }
  // Honour the global suppression flag — used by callers that want to
  // record a custom aggregate delta and not double-record the inner op.
  if (_recordingSuppressed) return null;
  const log = getHistoryLog();
  return log.recordOp({
    opName: spec.opName,
    dependsOn: spec.dependsOn || [],
    meta: { ...(spec.meta || {}), persistentBodyId: spec.persistentBodyId },
    // Forward = rebuild + register. The original op has already run when the
    // hook records the entry, so on first invocation the forward is NOT
    // re-run; the forward is replay-only.
    forward: async (sceneCtx) => {
      const body = await spec.rebuild();
      await spec.register(body, sceneCtx);
      return body;
    },
    inverse: async (sceneCtx) => {
      await spec.remove(spec.persistentBodyId, sceneCtx);
    },
  });
}
