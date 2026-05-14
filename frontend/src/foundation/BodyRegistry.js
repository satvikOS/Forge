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
    this.bodies = [];      // [{ id, name, sourceTool, group, manifold, volume_mm3, createdAt, visible }]
    this._listeners = new Set();
    this._counter = 0;
    this.selectedId = null;
  }

  /** Mark a body as selected (drives PropertyManager). Pass null to clear. */
  select(id) {
    if (id !== null && !this.bodies.some(b => b.id === id)) return false;
    this.selectedId = id;
    this._notify();
    return true;
  }

  /** Return the currently-selected body record (full, not snapshot). */
  selectedBody() {
    return this.bodies.find(b => b.id === this.selectedId) ?? null;
  }

  /**
   * Register a manifold body.
   *
   * @param {object} args
   * @param {THREE.Group} args.group       Three.js group already in the scene
   * @param {object} args.manifold         manifold-3d Manifold
   * @param {string=} args.sourceTool       which ribbon tool created it
   * @param {string=} args.name             override default name
   * @returns {string}                       generated body id
   */
  register({ group, manifold, sourceTool, name }) {
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
      volume_mm3,
      createdAt: new Date().toISOString(),
      visible: true,
    };
    group.userData.bodyId = id;
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
    if (this.selectedId === id) this.selectedId = null;
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
    this._notify();
  }

  list() { return [...this.bodies]; }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() {
    const snapshot = this.bodies.map(b => ({
      id: b.id, name: b.name, sourceTool: b.sourceTool,
      volume_mm3: b.volume_mm3, createdAt: b.createdAt, visible: b.visible,
      selected: b.id === this.selectedId,
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
