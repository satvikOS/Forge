/**
 * ArchDisc Topology Spine — Lump
 *
 * SP-1 Stage S0. A NEW entity: one maximally-connected chunk of a Body,
 * disjoint from its sibling lumps — ACIS LUMP, Parasolid REGION.
 *
 * The pre-spine model had no lump concept: `TopoSolid` was implicitly a single
 * solid lump, and `innerShells` modelled voids. A multi-lump body arises when a
 * boolean falls into disjoint pieces, or for a deliberately multi-piece body.
 *
 * A Lump owns one or more Shells: exactly one PERIPHERAL shell bounding the
 * lump outward, plus zero or more VOID shells bounding internal cavities.
 */

let _transientCounter = 0;

export default class Lump {
  /**
   * @param {import('./Shell.js').default[]} [shells]
   * @param {object} [opts]
   * @param {string} [opts.persistentId]
   */
  constructor(shells = [], opts = {}) {
    this.type = 'lump';
    this.transientId = ++_transientCounter;
    this.persistentId = opts.persistentId || null;
    this.shells = [];
    this.body = null;          // owning Body
    this.attributes = {};      // SP-2 hook
    this.userData = {};
    for (const s of shells) this.addShell(s);
  }

  /** Add a shell, taking ownership (sets `shell.lump`). */
  addShell(shell) {
    if (!shell) return;
    shell.lump = this;
    this.shells.push(shell);
  }

  /** The single peripheral (outward-bounding) shell, or null. */
  peripheralShell() {
    return this.shells.find(s => s.role === 'peripheral') || this.shells[0] || null;
  }

  /** The void (internal-cavity) shells. */
  voidShells() {
    return this.shells.filter(s => s.role === 'void');
  }

  /** Every distinct face across all shells of this lump. */
  faces() {
    const seen = new Set();
    for (const s of this.shells) { for (const f of s.faces) seen.add(f); }
    return [...seen];
  }

  /** Distinct edges across all shells. */
  edges() {
    const es = new Set();
    for (const s of this.shells) { for (const e of s.edges()) es.add(e); }
    return [...es];
  }

  /** Distinct vertices across all shells. */
  vertices() {
    const vs = new Set();
    for (const s of this.shells) { for (const v of s.vertices()) vs.add(v); }
    return [...vs];
  }

  /** Euler characteristic χ = V − E + F over all shells of the lump. */
  eulerCharacteristic() {
    return this.vertices().length - this.edges().length + this.faces().length;
  }

  /** True if every shell of the lump is closed (a solid lump). */
  isClosed() {
    if (this.shells.length === 0) return false;
    return this.shells.every(s => s.isClosed());
  }

  /** True if every shell of the lump is manifold. */
  isManifold() {
    return this.shells.every(s => s.isManifold());
  }

  toString() {
    return `Lump#${this.persistentId || this.transientId}` +
      `(${this.shells.length} shell${this.shells.length === 1 ? '' : 's'}: ` +
      `${this.shells.filter(s => s.role === 'peripheral').length} peripheral, ` +
      `${this.voidShells().length} void)`;
  }
}
