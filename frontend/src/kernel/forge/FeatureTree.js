/**
 * Feature tree — the authoring history of a Forge part / assembly.
 *
 * Every parametric operation (sketch, extrude, fillet, mate…) appears
 * as a FeatureNode in topological order. The active rollback marker
 * splits the tree into "applied" features (above) and "rolled-back"
 * features (below, dimmed in the UI). Suppressed features are skipped
 * during rebuild but stay in the tree so the user can flip them back
 * on without losing their parameters.
 *
 * No React. The UI sits above this through `onChange()` notifications;
 * the model is fully testable in plain node and used by Configurations
 * (Forge-11) when resolving per-config overrides.
 */

let nextId = 1;
function uid(prefix) { return `${prefix}-${nextId++}`; }

export class FeatureNode {
  constructor({ kind, params = {}, name = null, parent = null,
                children = [], dependsOn = [] }) {
    if (!kind) throw new Error('[forge.tree] FeatureNode requires kind');
    this.id = uid('f');
    this.kind = kind;
    this.name = name || kind;
    this.params = { ...params };
    this.parent = parent;
    this.children = [...children];
    this.dependsOn = [...dependsOn]; // ids of features that must rebuild first
    this.suppressed = false;
    this.error = null;       // last-rebuild error, if any
    this.outputHandle = null; // last-known native handle (ShapeHandle | SketchHandle | …)
  }
}

export class FeatureTree {
  constructor() {
    this._byId = new Map();
    this._order = [];             // feature ids in topological/insertion order
    this.rollbackAfterId = null;  // null = nothing rolled back
    this._listeners = new Set();
  }
  size() { return this._byId.size; }
  byId(id) { return this._byId.get(id) || null; }
  list() { return this._order.map((id) => this._byId.get(id)); }

  // ---- mutation -----------------------------------------------------
  add(spec) {
    const node = spec instanceof FeatureNode ? spec : new FeatureNode(spec);
    this._byId.set(node.id, node);
    this._order.push(node.id);
    this._notify();
    return node;
  }
  remove(id) {
    if (!this._byId.has(id)) return false;
    this._byId.delete(id);
    this._order = this._order.filter((x) => x !== id);
    if (this.rollbackAfterId === id) this.rollbackAfterId = null;
    this._notify();
    return true;
  }
  /** Move feature `id` to a new index in the order (clamped). */
  reorder(id, newIndex) {
    const i = this._order.indexOf(id);
    if (i < 0) throw new Error(`[forge.tree] reorder: unknown id ${id}`);
    const node = this._byId.get(id);
    // Reorder must not violate dependsOn — refuse if it would.
    const targetIdx = Math.max(0, Math.min(this._order.length - 1, newIndex));
    const tentative = [...this._order];
    tentative.splice(i, 1);
    tentative.splice(targetIdx, 0, id);
    const seen = new Set();
    for (const fid of tentative) {
      const f = this._byId.get(fid);
      for (const dep of f.dependsOn) {
        if (!seen.has(dep)) {
          throw new Error(`[forge.tree] reorder would put ${fid} before its dependency ${dep}`);
        }
      }
      seen.add(fid);
    }
    this._order = tentative;
    this._notify();
  }
  suppress(id, on = true) {
    const node = this._byId.get(id);
    if (!node) throw new Error(`[forge.tree] suppress: unknown id ${id}`);
    if (node.suppressed === on) return;
    node.suppressed = on;
    this._notify();
  }
  /** Update params on an existing feature. Triggers a rebuild downstream. */
  edit(id, paramUpdates) {
    const node = this._byId.get(id);
    if (!node) throw new Error(`[forge.tree] edit: unknown id ${id}`);
    node.params = { ...node.params, ...paramUpdates };
    this._notify();
  }

  // ---- rollback bar -------------------------------------------------
  rollbackTo(id) {
    if (id && !this._byId.has(id)) {
      throw new Error(`[forge.tree] rollbackTo: unknown id ${id}`);
    }
    this.rollbackAfterId = id;
    this._notify();
  }
  isRolledBack(id) {
    if (this.rollbackAfterId === null) return false;
    const cutIdx = this._order.indexOf(this.rollbackAfterId);
    const nodeIdx = this._order.indexOf(id);
    return nodeIdx > cutIdx;
  }
  appliedList() {
    const cutIdx = this.rollbackAfterId === null ? this._order.length - 1
                 : this._order.indexOf(this.rollbackAfterId);
    return this._order.slice(0, cutIdx + 1).map((x) => this._byId.get(x));
  }

  // ---- rebuild traversal ------------------------------------------
  /**
   * Yield features in build order, skipping suppressed + rolled-back.
   * The rebuilder calls each feature's executor and stores the returned
   * native handle on `outputHandle`. Errors are recorded; downstream
   * features get `error = "blocked by ancestor"` and skip their build.
   */
  *buildOrder() {
    for (const id of this._order) {
      if (this.rollbackAfterId !== null && this.isRolledBack(id)) break;
      const node = this._byId.get(id);
      if (!node) continue;
      if (node.suppressed) continue;
      const blockedBy = node.dependsOn.find((dep) => {
        const d = this._byId.get(dep);
        return !d || d.suppressed || d.error;
      });
      if (blockedBy) {
        node.error = `blocked by ${blockedBy}`;
        node.outputHandle = null;
        continue;
      }
      yield node;
    }
  }

  // ---- change notification ----------------------------------------
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _notify() {
    for (const fn of this._listeners) {
      try { fn(this); } catch (e) { console.error('[forge.tree]', e); }
    }
  }

  // ---- persistence -------------------------------------------------
  serialize() {
    return {
      version: 1,
      rollbackAfterId: this.rollbackAfterId,
      features: this._order.map((id) => {
        const f = this._byId.get(id);
        return { id: f.id, kind: f.kind, name: f.name, params: f.params,
                 suppressed: f.suppressed, dependsOn: f.dependsOn };
      }),
    };
  }
  static deserialize(json) {
    const t = new FeatureTree();
    for (const f of json.features || []) {
      const n = new FeatureNode({ kind: f.kind, name: f.name, params: f.params,
                                  dependsOn: f.dependsOn });
      n.id = f.id;
      n.suppressed = !!f.suppressed;
      t._byId.set(n.id, n);
      t._order.push(n.id);
    }
    t.rollbackAfterId = json.rollbackAfterId || null;
    return t;
  }
}
