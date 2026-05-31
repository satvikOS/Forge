/**
 * UndoRedo — the action-history layer that every parametric mutation in
 * Forge funnels through (Forge-28).
 *
 * Design contract:
 *   - The stack stores *actions*, not snapshots. Each action has a
 *     pure `do(state)` and a paired `undo(state)`. State is passed by
 *     reference so callers (FeatureTree, ConfigurationSet, sketch
 *     solver, etc.) can mutate it in place — the action is the diff.
 *   - Branching is queued: this slice keeps a single linear ancestor,
 *     so any new push() after an undo() truncates the redo tail.
 *     The data model leaves room (`_branchPoint`) for Forge-29+ to
 *     reintroduce side-branches without breaking callers.
 *   - `mergeCoalescing(intervalMs)` collapses consecutive `setParam`
 *     actions on the same `mergeKey` within N ms into one undo step.
 *     This is what stops "drag the slider" from producing 200 undo
 *     entries: the kernel emits one action per tick, the stack merges
 *     them, and the user gets one Ctrl+Z back to the original value.
 *
 * No React, no DOM. UI sits above via `onChange()`.
 */

let _nextActionId = 1;

/**
 * Action — the smallest undoable unit.
 *
 * @param {object} opts
 * @param {string} [opts.id]    — unique id (auto-generated if omitted)
 * @param {string} opts.label   — human label for menus / tooltips
 * @param {(state:any)=>any} opts.do — apply the action; may return a "memo"
 *                                     captured for undo
 * @param {(state:any, memo:any)=>void} opts.undo — reverse the action
 * @param {(state:any, memo:any)=>void} [opts.redo] — defaults to `do`
 * @param {string} [opts.mergeKey] — actions with the same mergeKey within
 *                                   `coalesceMs` collapse into one entry
 * @param {number} [opts.ts]    — timestamp (test-injectable)
 */
export class Action {
  constructor({ id, label, do: doFn, undo: undoFn, redo, mergeKey = null, ts = null }) {
    if (!label) throw new Error('[forge.undo] Action.label required');
    if (typeof doFn !== 'function') throw new Error('[forge.undo] Action.do must be a function');
    if (typeof undoFn !== 'function') throw new Error('[forge.undo] Action.undo must be a function');
    this.id = id || `act-${_nextActionId++}`;
    this.label = label;
    this.do = doFn;
    this.undo = undoFn;
    this.redo = typeof redo === 'function' ? redo : doFn;
    this.mergeKey = mergeKey;
    this.ts = ts == null ? Date.now() : ts;
    this.memo = undefined;
  }
}

export class UndoStack {
  constructor({ maxDepth = 200, coalesceMs = 0 } = {}) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new Error('[forge.undo] maxDepth must be a positive integer');
    }
    this.maxDepth = maxDepth;
    this.coalesceMs = coalesceMs;     // 0 disables coalescing
    this._past = [];                  // applied actions, oldest → newest
    this._future = [];                // undone actions, newest first
    this._branchPoint = null;         // reserved for Forge-29 branching
    this._listeners = new Set();
  }

  // ---- introspection ------------------------------------------------
  get canUndo() { return this._past.length > 0; }
  get canRedo() { return this._future.length > 0; }
  depth() { return this._past.length; }
  futureDepth() { return this._future.length; }
  peek() { return this._past.length ? this._past[this._past.length - 1] : null; }
  list() { return [...this._past]; }

  // ---- mutation -----------------------------------------------------
  /**
   * Apply `action` to `state` and push onto the undo stack. Any redo tail
   * is dropped. If coalescing is enabled and the previous entry shares a
   * `mergeKey` within `coalesceMs`, the previous entry's redo callback is
   * replaced by the new one (so a single undo() reverses the whole burst).
   */
  push(action, state) {
    if (!(action instanceof Action)) action = new Action(action);
    action.memo = action.do(state);

    // Drop any redo tail — a new push branches the history.
    if (this._future.length) this._future.length = 0;

    const prev = this.peek();
    const shouldMerge = this.coalesceMs > 0
      && prev
      && prev.mergeKey
      && prev.mergeKey === action.mergeKey
      && (action.ts - prev.ts) <= this.coalesceMs;

    if (shouldMerge) {
      // Keep the older undo (so a single Ctrl+Z snaps back to the
      // pre-burst state) but adopt the newer redo + label + timestamp.
      prev.redo = action.redo;
      prev.label = action.label;
      prev.ts = action.ts;
      // We don't replace prev.memo — its memo points at the *original*
      // pre-burst state needed by undo().
    } else {
      this._past.push(action);
      while (this._past.length > this.maxDepth) this._past.shift();
    }
    this._notify('push', action);
    return action;
  }

  undo(state) {
    const a = this._past.pop();
    if (!a) return null;
    a.undo(state, a.memo);
    this._future.push(a);
    this._notify('undo', a);
    return a;
  }

  redo(state) {
    const a = this._future.pop();
    if (!a) return null;
    const memo = a.redo(state, a.memo);
    if (memo !== undefined) a.memo = memo;
    this._past.push(a);
    this._notify('redo', a);
    return a;
  }

  clear() {
    this._past.length = 0;
    this._future.length = 0;
    this._branchPoint = null;
    this._notify('clear', null);
  }

  // ---- config -------------------------------------------------------
  /** Enable / disable coalescing. `intervalMs = 0` disables it. */
  mergeCoalescing(intervalMs) {
    if (!(intervalMs >= 0)) throw new Error('[forge.undo] coalesce interval must be >= 0');
    this.coalesceMs = intervalMs;
    return this;
  }

  // ---- listeners ----------------------------------------------------
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _notify(kind, action) {
    for (const fn of this._listeners) {
      try { fn({ kind, action, canUndo: this.canUndo, canRedo: this.canRedo }); }
      catch (e) { console.error('[forge.undo] listener', e); }
    }
  }
}

/**
 * Convenience: build an Action that mutates a single param on a target
 * object. Used by FeatureTree.edit + sketch parameter edits to feed the
 * UndoStack without per-call boilerplate.
 *
 *   undoStack.push(setParam('boss-1', tree.byId('boss-1'), 'r', 5));
 */
export function setParam(targetKey, target, prop, nextValue, { label, ts } = {}) {
  const prev = target.params ? target.params[prop] : target[prop];
  const apply = (st) => {
    if (target.params) target.params[prop] = nextValue;
    else target[prop] = nextValue;
    return { prev };
  };
  const revert = (st, memo) => {
    if (target.params) target.params[prop] = memo.prev;
    else target[prop] = memo.prev;
  };
  return new Action({
    label: label || `Set ${prop}`,
    do: apply,
    undo: revert,
    redo: apply,
    mergeKey: `setParam:${targetKey}:${prop}`,
    ts,
  });
}

/**
 * `undoable(name, do, undo, opts?)` — the funnel every parametric
 * mutation flows through. Pairs with `wireFeatureTree()` below so a
 * single source of truth feeds the stack.
 */
export function undoable(name, doFn, undoFn, opts = {}) {
  return new Action({ label: name, do: doFn, undo: undoFn, ...opts });
}

/**
 * Wire a FeatureTree's mutating methods through the UndoStack. Returns a
 * disposer that restores the original methods. Every `add / remove / edit
 * / suppress / reorder / rollbackTo` becomes an undoable Action.
 *
 * Callers that need raw access bypass this by using `tree._byId` directly,
 * but normal user-driven mutations now hit the stack automatically.
 */
export function wireFeatureTree(tree, stack, state = null) {
  const orig = {
    add: tree.add.bind(tree),
    remove: tree.remove.bind(tree),
    edit: tree.edit.bind(tree),
    suppress: tree.suppress.bind(tree),
    reorder: tree.reorder.bind(tree),
    rollbackTo: tree.rollbackTo.bind(tree),
  };

  tree.add = (spec) => {
    let createdId = null;
    let snapshot = null;
    const action = undoable(
      `Add ${spec.kind || 'feature'}`,
      () => {
        const node = orig.add(spec);
        createdId = node.id;
        return { id: node.id };
      },
      (st, memo) => {
        snapshot = tree._byId.get(memo.id);
        orig.remove(memo.id);
      },
      {
        // redo re-creates with the same id by injecting through _byId.
        redo: (st, memo) => {
          if (snapshot) {
            tree._byId.set(memo.id, snapshot);
            tree._order.push(memo.id);
            tree._notify();
          } else {
            orig.add(spec);
          }
        },
      },
    );
    stack.push(action, state);
    return tree._byId.get(createdId);
  };

  tree.edit = (id, paramUpdates) => {
    const node = tree.byId(id);
    if (!node) throw new Error(`[forge.tree] edit: unknown id ${id}`);
    const before = { ...node.params };
    const action = undoable(
      `Edit ${node.name}`,
      () => { orig.edit(id, paramUpdates); return { before }; },
      (st, memo) => { node.params = { ...memo.before }; tree._notify(); },
      { mergeKey: `edit:${id}:${Object.keys(paramUpdates).sort().join(',')}` },
    );
    stack.push(action, state);
  };

  tree.suppress = (id, on = true) => {
    const node = tree.byId(id);
    if (!node) throw new Error(`[forge.tree] suppress: unknown id ${id}`);
    if (node.suppressed === on) return;
    const action = undoable(
      `${on ? 'Suppress' : 'Unsuppress'} ${node.name}`,
      () => { orig.suppress(id, on); },
      () => { orig.suppress(id, !on); },
    );
    stack.push(action, state);
  };

  tree.remove = (id) => {
    const node = tree.byId(id);
    if (!node) return false;
    const idx = tree._order.indexOf(id);
    const snapshot = node;
    const action = undoable(
      `Remove ${node.name}`,
      () => { orig.remove(id); return { idx }; },
      (st, memo) => {
        tree._byId.set(id, snapshot);
        tree._order.splice(memo.idx, 0, id);
        tree._notify();
      },
    );
    stack.push(action, state);
    return true;
  };

  tree.reorder = (id, newIndex) => {
    const oldIdx = tree._order.indexOf(id);
    const action = undoable(
      `Reorder ${tree.byId(id)?.name || id}`,
      () => { orig.reorder(id, newIndex); return { oldIdx }; },
      (st, memo) => { orig.reorder(id, memo.oldIdx); },
    );
    stack.push(action, state);
  };

  tree.rollbackTo = (id) => {
    const before = tree.rollbackAfterId;
    const action = undoable(
      `Rollback to ${id ? (tree.byId(id)?.name || id) : 'tip'}`,
      () => { orig.rollbackTo(id); return { before }; },
      (st, memo) => { orig.rollbackTo(memo.before); },
    );
    stack.push(action, state);
  };

  return function disposeWire() {
    tree.add = orig.add;
    tree.remove = orig.remove;
    tree.edit = orig.edit;
    tree.suppress = orig.suppress;
    tree.reorder = orig.reorder;
    tree.rollbackTo = orig.rollbackTo;
  };
}

/**
 * Wire a ConfigurationSet through the stack. Forge-28 covers add / remove
 * / setActive — Forge-29 will extend to per-config override edits.
 */
export function wireConfigurationSet(set, stack, state = null) {
  const orig = {
    add: set.add.bind(set),
    remove: set.remove.bind(set),
    setActive: set.setActive.bind(set),
  };
  set.add = (cfg) => {
    const action = undoable(
      `Add configuration ${cfg.name}`,
      () => { orig.add(cfg); return { id: cfg.id }; },
      (st, memo) => { set.configs.delete(memo.id); },
    );
    stack.push(action, state);
    return cfg;
  };
  set.remove = (id) => {
    const cfg = set.configs.get(id);
    if (!cfg) return false;
    const prevActive = set.activeId;
    const action = undoable(
      `Remove configuration ${cfg.name}`,
      () => { orig.remove(id); return {}; },
      () => {
        set.configs.set(id, cfg);
        set.activeId = prevActive;
      },
    );
    stack.push(action, state);
    return true;
  };
  set.setActive = (id) => {
    const before = set.activeId;
    if (before === id) { orig.setActive(id); return; }
    const action = undoable(
      `Activate configuration ${set.configs.get(id)?.name || id}`,
      () => { orig.setActive(id); return { before }; },
      (st, memo) => { orig.setActive(memo.before); },
    );
    stack.push(action, state);
  };
  return function disposeWire() {
    set.add = orig.add;
    set.remove = orig.remove;
    set.setActive = orig.setActive;
  };
}

export default { Action, UndoStack, setParam, undoable, wireFeatureTree, wireConfigurationSet };
