/**
 * ArchDisc Body Registry.
 *
 * Tracks every foundation manifold that addFoundationManifoldToScene
 * has placed in the Three.js scene, so the right-aside Part Browser
 * can list them, hide/show them, focus on one, and delete them.
 *
 * What "body" means here: one Three.js group with userData
 * .foundationManifold === true, holding a manifold-3d mesh scaled
 * 0.001 from mm to scene meters.
 *
 * Storage: in-memory only. On reload, registry starts empty (the
 * scene reload also drops the THREE objects). SessionMemory holds
 * the persisted design intent — this is purely the live scene index.
 */

class BodyRegistry {
  constructor() {
    this.bodies = [];      // [{ id, name, sourceTool, group, manifold, brepShapeRef, volume_mm3, createdAt, visible }]
    this._listeners = new Set();
    this._counter = 0;
    this.selectedId = null;          // legacy single-select (backwards-compat)
    this._selectedIds = new Set();   // multi-select set
  }

  // ── Single-select (legacy, backwards-compat) ───────────────────────────────

  /**
   * Mark a body as selected (drives PropertyManager).
   *
   * Extended signature: `select(id, additive=false)`
   * - If `additive` is false (default) the selection set is cleared first,
   *   matching the original single-select behaviour.
   * - If `additive` is true the id is added to the existing selection.
   *
   * Pass `null` to clear all selection.
   */
  select(id, additive = false) {
    if (id !== null && !this.bodies.some(b => b.id === id)) return false;
    if (!additive) {
      this._selectedIds.clear();
    }
    if (id !== null) {
      this._selectedIds.add(id);
    }
    // Keep legacy selectedId in sync with the primary (first) selection.
    this.selectedId = id;
    this._notify();
    return true;
  }

  /** Return the first selected body record (full, not snapshot). Backwards-compat. */
  selectedBody() {
    // Use _selectedIds so multi-select paths also populate this correctly.
    const first = this._selectedIds.values().next().value ?? null;
    return this.bodies.find(b => b.id === first) ?? null;
  }

  // ── Multi-select API ───────────────────────────────────────────────────────

  /** Replace the current selection with the given ids. */
  selectMany(ids) {
    this._selectedIds = new Set(ids.filter(id => this.bodies.some(b => b.id === id)));
    // Keep legacy selectedId pointing to the first selected body (or null).
    const first = this._selectedIds.values().next().value ?? null;
    this.selectedId = first;
    this._notify();
  }

  /** Remove a single id from the selection without clearing others. */
  deselect(id) {
    this._selectedIds.delete(id);
    if (this.selectedId === id) {
      this.selectedId = this._selectedIds.values().next().value ?? null;
    }
    this._notify();
  }

  /** Empty the selection set. */
  clearSelection() {
    this._selectedIds.clear();
    this.selectedId = null;
    this._notify();
  }

  /** Return all currently-selected body ids. */
  selectedIds() {
    return [...this._selectedIds];
  }

  /** Return the full BodyEntry objects for all selected bodies. */
  selectedBodies() {
    return this.bodies.filter(b => this._selectedIds.has(b.id));
  }

  /**
   * Return the live BrepShape objects for all selected bodies.
   *
   * Each BodyEntry may carry a `brepShapeRef` property stashed at registration
   * time by `registerBody({ ..., brepShape })`. Falls back to
   * `entry.group.userData.brepShapeRef` if the entry property is absent.
   *
   * Note: `addBrepShapeToScene` sets `group.userData.brepShape = true`
   * (a boolean flag for picking), not the live object. The live BrepShape
   * reference must be passed explicitly to `registerBody` as `brepShape`.
   *
   * @returns {Array} — array of BrepShape objects (may contain undefined entries
   *   if a body was created before this API existed and has no ref stored).
   */
  selectedBrepShapes() {
    return this.selectedBodies().map(
      b => b.brepShapeRef ?? b.group?.userData?.brepShapeRef ?? undefined,
    ).filter(Boolean);
  }

  /**
   * Register a body.
   *
   * @param {object} args
   * @param {THREE.Group} args.group        Three.js group already in the scene
   * @param {object} args.manifold          manifold-3d Manifold (or shim with volume())
   * @param {object=} args.brepShape        live B-rep BrepShape (optional) — stored as
   *                                         brepShapeRef for selectedBrepShapes()
   * @param {string=} args.sourceTool        which ribbon tool created it
   * @param {string=} args.name              override default name
   * @returns {string}                        generated body id
   */
  register({ group, manifold, brepShape, sourceTool, name }) {
    if (!group || !manifold) return null;
    const id = `body-${(++this._counter).toString().padStart(3, '0')}`;
    let volume_mm3 = null;
    try {
      volume_mm3 = typeof manifold.volume === 'function' ? manifold.volume() : null;
    } catch { /* manifold may be disposed */ }
    const entry = {
      id,
      name: name ?? `${sourceTool ?? 'Body'} ${this._counter}`,
      sourceTool: sourceTool ?? null,
      group,
      manifold,
      brepShapeRef: brepShape ?? null,
      volume_mm3,
      createdAt: new Date().toISOString(),
      visible: true,
    };
    group.userData.bodyId = id;
    // Also store on group.userData so selectedBrepShapes can access it
    // even without the BodyEntry in hand. Stored as a NON-ENUMERABLE
    // property so it survives `Object3D.copy()`'s `JSON.parse(JSON.stringify(
    // userData))` round-trip without dragging the brepShape graph through a
    // JSON serializer (SP-1 S2: a SpineBody's spine has back-reference cycles
    // — Lump↔Shell, Shell↔Face, Loop↔Coedge, Edge↔Coedge — that JSON.stringify
    // legitimately rejects, but a non-enumerable property is skipped so the
    // clone works; the reference itself can still be read via the explicit
    // `group.userData.brepShapeRef` read path used by selectedBrepShapes()).
    if (brepShape) {
      Object.defineProperty(group.userData, 'brepShapeRef', {
        value: brepShape,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    this.bodies.push(entry);
    this._notify();
    return id;
  }

  remove(id) {
    const i = this.bodies.findIndex(b => b.id === id);
    if (i < 0) return false;
    const [removed] = this.bodies.splice(i, 1);
    // Remove from scene as well
    if (removed.group?.parent) removed.group.parent.remove(removed.group);
    // Clean from both selection stores
    if (this.selectedId === id) this.selectedId = null;
    this._selectedIds.delete(id);
    this._notify();
    return true;
  }

  setVisible(id, visible) {
    const b = this.bodies.find(x => x.id === id);
    if (!b) return false;
    b.visible = !!visible;
    if (b.group) b.group.visible = b.visible;
    this._notify();
    return true;
  }

  rename(id, newName) {
    const b = this.bodies.find(x => x.id === id);
    if (!b || !newName.trim()) return false;
    b.name = newName.trim();
    this._notify();
    return true;
  }

  isolate(id) {
    for (const b of this.bodies) {
      const target = b.id === id;
      b.visible = target;
      if (b.group) b.group.visible = target;
    }
    this._notify();
  }

  /**
   * Tier 8b — body-level attribute system (partNumber / material /
   * description / vendor / cost / mass / etc.). The kernel topology
   * `attachAttribute` operates on spine entities (Face/Edge/Vertex);
   * for BOM rendering we need attributes at the BODY level. Each entry
   * gets a lazy `.attributes` object; helpers below mutate it without
   * disturbing the rest of the BodyEntry shape.
   *
   * Survives op-time mutations because BodyRegistry entries persist
   * for the lifetime of the body in the scene; if a body is removed
   * and re-registered (sculpt rebuild), the caller must re-attach.
   */
  attachAttribute(id, key, value) {
    const b = this.bodies.find(x => x.id === id);
    if (!b) return false;
    if (!b.attributes) b.attributes = {};
    if (typeof key !== 'string' || !key.length) return false;
    b.attributes[key] = value;
    this._notify();
    return true;
  }

  /** Attach multiple attributes at once (object spread). */
  attachAttributes(id, kv) {
    const b = this.bodies.find(x => x.id === id);
    if (!b || !kv || typeof kv !== 'object') return false;
    if (!b.attributes) b.attributes = {};
    for (const [k, v] of Object.entries(kv)) {
      if (typeof k === 'string' && k.length) b.attributes[k] = v;
    }
    this._notify();
    return true;
  }

  /** Read one attribute value (or undefined). */
  getAttribute(id, key) {
    const b = this.bodies.find(x => x.id === id);
    return b?.attributes?.[key];
  }

  /** Return the full attribute bag (a shallow copy), or {}. */
  getAttributes(id) {
    const b = this.bodies.find(x => x.id === id);
    return b?.attributes ? { ...b.attributes } : {};
  }

  showAll() {
    for (const b of this.bodies) {
      b.visible = true;
      if (b.group) b.group.visible = true;
    }
    this._notify();
  }

  clear() {
    for (const b of this.bodies) {
      if (b.group?.parent) b.group.parent.remove(b.group);
    }
    this.bodies = [];
    this._counter = 0;
    this.selectedId = null;
    this._selectedIds.clear();
    this._notify();
  }

  list() { return [...this.bodies]; }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() {
    const snapshot = this.bodies.map(b => ({
      id: b.id, name: b.name, sourceTool: b.sourceTool,
      volume_mm3: b.volume_mm3, createdAt: b.createdAt, visible: b.visible,
      // `selected` is true if in either the legacy single-select OR the multi-select set.
      selected: this._selectedIds.has(b.id) || b.id === this.selectedId,
    }));
    for (const fn of this._listeners) {
      try { fn(snapshot); } catch (err) { console.warn('body registry listener', err); }
    }
  }
}

const REGISTRY = new BodyRegistry();

if (typeof window !== 'undefined') window.__archdiscBodies = REGISTRY;

export function getBodyRegistry() { return REGISTRY; }
export function registerBody(args) { return REGISTRY.register(args); }
