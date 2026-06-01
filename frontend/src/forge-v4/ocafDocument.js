// Forge-155 — OCAF document + transaction layer (JS port).
//
// Open CASCADE Application Framework (TDocStd_Document / TDF_Label /
// TFunction_Function) re-implemented in JavaScript so the Forge v4 shell
// has the same hierarchical attribute store + transaction stack +
// parametric recomputation graph that CATIA / FreeCAD / OpenCASCADE
// ship in C++.
//
// The op-graph (Forge-115) becomes one consumer of this transaction
// stack — every push() opens a new transaction, every commit() seals
// it as a TDF_Delta the user can undo / redo.
//
// Data model:
//   - Document holds a single root Label (the "root" of the TDF tree).
//   - Each Label has child labels indexed by integer "tag" (FreeCAD/OCAF
//     convention), plus a string-keyed attribute store.
//   - Attributes can hold any JS value; framework-defined ones are
//     declared with a constructor so downstream tools can do
//     instance-of dispatch.
//   - Functions (TFunction_Function) are recomputation drivers that
//     observe specific attributes and re-execute when the attribute
//     changes. A topological sort drives the regen order.

const ROOT_TAG = 1;

/** Globally unique label IDs. */
let _nextLabelId = 0;
function newLabelId() { _nextLabelId += 1; return `lbl-${_nextLabelId}`; }

class TDF_Label {
  constructor(parent = null, tag = 1) {
    this.id = newLabelId();
    this.parent = parent;
    this.tag = tag;
    this.children = new Map();    // tag → TDF_Label
    this.attributes = new Map();  // string key → attribute object
  }
  findChild(tag, create = false) {
    if (this.children.has(tag)) return this.children.get(tag);
    if (!create) return null;
    const c = new TDF_Label(this, tag);
    this.children.set(tag, c);
    return c;
  }
  newChild(tag = null) {
    const next = tag != null ? tag : (1 + Math.max(0, ...this.children.keys()));
    return this.findChild(next, true);
  }
  setAttribute(key, value) {
    const prev = this.attributes.get(key);
    this.attributes.set(key, value);
    return prev;
  }
  getAttribute(key) { return this.attributes.get(key); }
  removeAttribute(key) {
    const prev = this.attributes.get(key);
    this.attributes.delete(key);
    return prev;
  }
  path() {
    const tags = [];
    let l = this;
    while (l) { tags.unshift(l.tag); l = l.parent; }
    return tags.join(':');
  }
}

class TDF_Delta {
  constructor() {
    this.creates = [];      // { labelId, parentId, tag }
    this.destroys = [];     // { labelId, parentId, tag }
    this.attrSets = [];     // { labelId, key, before, after }
    this.timestamp = Date.now();
    this.label = '';
  }
}

class TFunctionDriver {
  /**
   * @param {string} name — function identifier
   * @param {function} execute — (label, document) → void; can read attributes,
   *                              write attributes, walk children.
   * @param {string[]} watches — attribute keys this function depends on
   */
  constructor(name, execute, watches = []) {
    this.name = name;
    this.execute = execute;
    this.watches = new Set(watches);
  }
}

/** The transaction stack: undo / redo. */
class TransactionStack {
  constructor(maxDepth = 200) {
    this.deltas = [];
    this.head = -1;
    this.maxDepth = maxDepth;
    this.current = null;       // active TDF_Delta during open transaction
  }
  open(label = '') {
    if (this.current) {
      throw new Error('TransactionStack.open: transaction already open');
    }
    this.current = new TDF_Delta();
    this.current.label = label;
  }
  recordCreate(labelId, parentId, tag) {
    if (this.current) this.current.creates.push({ labelId, parentId, tag });
  }
  recordDestroy(labelId, parentId, tag) {
    if (this.current) this.current.destroys.push({ labelId, parentId, tag });
  }
  recordAttr(labelId, key, before, after) {
    if (this.current) this.current.attrSets.push({ labelId, key, before, after });
  }
  commit() {
    if (!this.current) return null;
    // Truncate any redo stack past the current head.
    if (this.head < this.deltas.length - 1) {
      this.deltas.splice(this.head + 1);
    }
    this.deltas.push(this.current);
    while (this.deltas.length > this.maxDepth) {
      this.deltas.shift();
    }
    this.head = this.deltas.length - 1;
    const sealed = this.current;
    this.current = null;
    return sealed;
  }
  rollback() {
    const dropped = this.current;
    this.current = null;
    return dropped;
  }
  canUndo() { return this.head >= 0; }
  canRedo() { return this.head < this.deltas.length - 1; }
  undoDelta() {
    if (!this.canUndo()) return null;
    const d = this.deltas[this.head];
    this.head -= 1;
    return d;
  }
  redoDelta() {
    if (!this.canRedo()) return null;
    this.head += 1;
    return this.deltas[this.head];
  }
}

/** The Document — owns the root label + transaction stack + function drivers. */
export class TDocStd_Document {
  constructor(name = 'forge-doc') {
    this.name = name;
    this.root = new TDF_Label(null, ROOT_TAG);
    this.txStack = new TransactionStack();
    this.drivers = new Map();    // name → TFunctionDriver
    this.labelsById = new Map();
    this.labelsById.set(this.root.id, this.root);
    this._observerHooks = new Set();   // (event) => void
  }

  /** Register a recomputation function. */
  registerDriver(driver) {
    if (!(driver instanceof TFunctionDriver))
      throw new Error('registerDriver: expected TFunctionDriver');
    this.drivers.set(driver.name, driver);
  }

  /** Find or create a child label under parent by tag. */
  newChild(parent, tag = null) {
    const child = parent.newChild(tag);
    this.labelsById.set(child.id, child);
    this.txStack.recordCreate(child.id, parent.id, child.tag);
    this._emit({ kind: 'create', label: child });
    return child;
  }

  /** Set an attribute, recording the previous value into the open delta. */
  setAttribute(label, key, value) {
    const prev = label.setAttribute(key, value);
    this.txStack.recordAttr(label.id, key, prev, value);
    this._emit({ kind: 'attr', label, key, before: prev, after: value });
    return prev;
  }

  getAttribute(label, key) { return label.getAttribute(key); }

  /** Drop a child, recording the destroy into the open delta. */
  destroyChild(parent, tag) {
    const child = parent.findChild(tag, false);
    if (!child) return null;
    parent.children.delete(tag);
    this.labelsById.delete(child.id);
    this.txStack.recordDestroy(child.id, parent.id, tag);
    this._emit({ kind: 'destroy', label: child });
    return child;
  }

  /** Find label by tag-path (e.g. "1:2:5"). */
  findByPath(path) {
    const tags = String(path).split(':').map((s) => parseInt(s, 10));
    let l = this.root;
    if (tags.length === 0) return null;
    if (tags[0] !== this.root.tag) return null;
    for (let i = 1; i < tags.length; i++) {
      const next = l.findChild(tags[i], false);
      if (!next) return null;
      l = next;
    }
    return l;
  }

  // ---- transaction API ----
  newCommand(label = '') { this.txStack.open(label); }
  commitCommand() { return this.txStack.commit(); }
  abortCommand() { return this.txStack.rollback(); }
  undo() {
    const d = this.txStack.undoDelta();
    if (!d) return null;
    // Roll changes back in reverse order.
    for (let i = d.attrSets.length - 1; i >= 0; i--) {
      const r = d.attrSets[i];
      const l = this.labelsById.get(r.labelId);
      if (l) l.attributes.set(r.key, r.before);
    }
    for (let i = d.creates.length - 1; i >= 0; i--) {
      const c = d.creates[i];
      const parent = this.labelsById.get(c.parentId);
      if (parent) parent.children.delete(c.tag);
      this.labelsById.delete(c.labelId);
    }
    for (const x of d.destroys) {
      const parent = this.labelsById.get(x.parentId);
      if (parent) {
        const restored = new TDF_Label(parent, x.tag);
        restored.id = x.labelId;
        parent.children.set(x.tag, restored);
        this.labelsById.set(restored.id, restored);
      }
    }
    this._emit({ kind: 'undo', delta: d });
    return d;
  }
  redo() {
    const d = this.txStack.redoDelta();
    if (!d) return null;
    // Re-apply in forward order.
    for (const c of d.creates) {
      const parent = this.labelsById.get(c.parentId);
      if (parent) {
        const child = new TDF_Label(parent, c.tag);
        child.id = c.labelId;
        parent.children.set(c.tag, child);
        this.labelsById.set(child.id, child);
      }
    }
    for (const x of d.destroys) {
      const parent = this.labelsById.get(x.parentId);
      if (parent) parent.children.delete(x.tag);
      this.labelsById.delete(x.labelId);
    }
    for (const r of d.attrSets) {
      const l = this.labelsById.get(r.labelId);
      if (l) l.attributes.set(r.key, r.after);
    }
    this._emit({ kind: 'redo', delta: d });
    return d;
  }

  // ---- TFunction-style recomputation ----
  recompute() {
    // Topologically sort labels that have functions; for each in order,
    // execute the driver. Cycles bail with an error.
    const tagged = [];
    const visit = (l) => {
      if (l.getAttribute('TFunction.driver')) tagged.push(l);
      for (const c of l.children.values()) visit(c);
    };
    visit(this.root);
    const visited = new Set();
    const inStack = new Set();
    const out = [];
    const dependsOn = (l) => {
      const deps = l.getAttribute('TFunction.dependencies') || [];
      return deps.map((p) => this.findByPath(p)).filter(Boolean);
    };
    const dfs = (l) => {
      if (visited.has(l.id)) return;
      if (inStack.has(l.id)) throw new Error('TFunction cycle at ' + l.path());
      inStack.add(l.id);
      for (const d of dependsOn(l)) dfs(d);
      inStack.delete(l.id);
      visited.add(l.id);
      out.push(l);
    };
    for (const l of tagged) dfs(l);
    for (const l of out) {
      const name = l.getAttribute('TFunction.driver');
      const drv = this.drivers.get(name);
      if (drv) {
        try { drv.execute(l, this); }
        catch (err) { console.warn('[ocaf] driver', name, 'threw:', err.message); }
      }
    }
    return out.length;
  }

  // ---- observer hooks (renderer subscribes to delta events) ----
  subscribe(cb) {
    this._observerHooks.add(cb);
    return () => this._observerHooks.delete(cb);
  }
  _emit(event) {
    for (const cb of this._observerHooks) {
      try { cb(event); } catch {}
    }
  }
}

// Module-singleton — the v4 shell uses one document at a time.
let _activeDoc = null;
export function activeDocument() {
  if (!_activeDoc) _activeDoc = new TDocStd_Document('forge-shell');
  return _activeDoc;
}
export function newDocument(name) {
  _activeDoc = new TDocStd_Document(name);
  return _activeDoc;
}
export function disposeActiveDocument() { _activeDoc = null; }

export { TDF_Label, TDF_Delta, TFunctionDriver };
