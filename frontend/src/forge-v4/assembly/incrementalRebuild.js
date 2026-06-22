// Task #24 — Large-Assembly INCREMENTAL REBUILD engine.
//
// WHAT THIS IS
// ────────────
// A genuine dependency-graph (associativity-DAG) rebuilder for ASSEMBLIES —
// the assembly-level analogue of the part-level RebuildEngine.js that already
// ships. Where RebuildEngine memoises single-part FeatureNodes, this engine
// memoises assembly nodes: parts, sub-assemblies, mates, and — critically —
// INSTANCED nodes (one master geometry reference + N per-instance 4×4
// transforms) and GRAPHICS-ONLY proxies (bbox / decimated mesh, full BRep
// deferred). markDirty(id) flags a node and topologically propagates dirty to
// DOWNSTREAM dependents only; rebuild() recomputes only the dirty frontier and
// reuses every clean node's cached output, so the incrementally-rebuilt model
// is bit-identical to a from-scratch rebuild while touching a tiny fraction of
// the nodes.
//
// PUBLISHED-TECHNIQUE CONFORMANCE (hard rule — each MUST-rule cited inline)
// ──────────────────────────────────────────────────────────────────────────
// [1] History-based / associativity DAG with topological dirty propagation and
//     reuse of clean (memoised) outputs. This is the standard parametric-CAD
//     "feature/associativity graph" rebuild used by every history-based modeler;
//     see Hoffmann & Joan-Arinyo, "On user-defined features" (CAD 1998) and
//     Shapiro & Vossler, "What is a parametric family of solids?" on persistent
//     naming + dependency rebuild. We mirror the SAME proven model the in-repo
//     RebuildEngine.js implements for a single part, lifted to instances/subs.
// [2] Incremental computation / dirty-flagging where the incrementally-rebuilt
//     result is IDENTICAL to a from-scratch rebuild. This is self-adjusting /
//     incremental computation (Acar et al., "Adaptive Functional Programming",
//     POPL 2002; "Self-Adjusting Computation"). The clean-node cache is a
//     memo table keyed by a content hash of (kind, params, upstream versions).
//     An ancestor edit bumps the ancestor's outputVersion, which changes every
//     descendant's content hash → no stale cache is ever served.
// [3] SolidWorks Large Assembly Mode / NX Lightweight + GPU instancing: a copy
//     is ONE reference to a master geometry + a per-instance 4×4 transform
//     (hardware/instanced rendering — Akenine-Möller, "Real-Time Rendering",
//     instancing chapter; GL/THREE.InstancedMesh), NOT a full BRep per copy.
//     A 'graphics' node carries only a lightweight display proxy (bbox or
//     decimated mesh from a coarse tessellation deflection) and defers full
//     BRep realization until promoteToSolid() asks for it (lazy evaluation).
//     10k copies cost ~1 master + 10k transforms.
// [4] Benchmark: 10k-instance grid with sub-assembly grouping; markDirty ONE
//     subtree's master; rebuild < 1s wall-clock (performance.now()); recomputed
//     count ≈ dirty-subtree size (NOT all 10k); and incremental == full.
//
// REUSE (no duplication — the recon mandate):
//   • fnv1a + stableStringify imported from ../../kernel/forge/RebuildEngine.js
//     (the exact same content-hash the part-level engine is proven on).
//   • bodyAabb from ../octreeIndex.js for the graphics-body bounds path.
//   • mul4 column-major compose mirrors assemblyHierarchy.js's worldTransform.
//
// Pure JS/ESM, no new npm packages, no React, no DOM. Kernel-optional: every
// executor calls only forge.bounds / forge.tessellate / forge.makeBox-style
// surfaces, all of which a stub forge object can supply in a plain node test.

import { fnv1a, stableStringify } from '../../kernel/forge/RebuildEngine.js';
import { bodyAabb } from '../octreeIndex.js';

// ─────────────────────────────────────────────────────────────────────
// Matrix helpers (column-major 4×4, matching assemblyHierarchy.js).

export const IDENTITY16 = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/** Column-major 4×4 multiply: returns A · B. Mirrors assemblyHierarchy.mul4. */
export function mul4(A, B) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/**
 * Digest of a flat transform buffer (Float64Array | number[]) so an instanced
 * node's content hash changes when ANY of its N transforms changes — but the
 * MASTER node's hash does not (the master only sees its own params). This is
 * what makes "edit one instance's transform → only that instanced node dirty"
 * hold while the shared master stays a clean cache hit. We fold the whole
 * buffer through fnv1a; for 10k×16 doubles this is a cheap linear pass, far
 * cheaper than re-tessellating any geometry.
 */
export function hashTransforms(buf) {
  if (!buf) return '0';
  const n = buf.length;
  // FNV-1a over the numeric content. We stringify each value with a fixed
  // precision so -0 / +0 and float noise don't spuriously change the hash.
  let s = `t${n}|`;
  for (let i = 0; i < n; i++) {
    const v = buf[i];
    // Normalise -0 → 0 and keep full double precision deterministically.
    s += (Object.is(v, -0) ? 0 : v).toString();
    s += ',';
  }
  return fnv1a(s);
}

// ─────────────────────────────────────────────────────────────────────
// AssemblyNode — one vertex of the associativity DAG.
//
// kind:
//   'part'        — a single leaf body produced by an executor (e.g. a box).
//                   output: { handle }
//   'subassembly' — a grouping node: composes a local transform onto its
//                   children's outputs. output: { transform, childIds }
//   'instanced'   — ONE masterId (a 'part' node) + a flat transforms buffer of
//                   16·N. output: { masterId, masterHandle, count,
//                   transforms, instancedRef } — NEVER N BReps. [MUST-3]
//   'graphics'    — a lightweight display proxy of a master: { bounds,
//                   coarseMesh, fullBRep:null }. Defers solid realization
//                   until promoteToSolid(id). [MUST-3]
//   'mate'        — a constraint node depending on two instances; output is a
//                   solved relative transform. (Modelled as a DAG node so a
//                   mate edit propagates to the bodies it positions.)
//
// Every node carries:
//   contentHash   — fnv1a(kind | params | upstream output VERSIONS | transform
//                   digest). Stable across rebuilds when nothing it depends on
//                   changed → cache hit. [MUST-1, MUST-2]
//   outputVersion — bumped each time the node actually re-executes. Downstream
//                   nodes fold this into THEIR content hash, so an ancestor
//                   edit invalidates every descendant with zero stale risk.
//   output        — the cached payload (see per-kind above).
//   dirty         — explicit dirty flag (markDirty sets it; rebuild clears it).

let _autoId = 1;
function autoId(prefix) { return `${prefix}-${_autoId++}`; }

export class AssemblyNode {
  constructor({ id, kind, params = {}, dependsOn = [],
                masterId = null, transforms = null, lightweight = false } = {}) {
    if (!kind) throw new Error('[incrementalRebuild] AssemblyNode requires kind');
    this.id = id || autoId('n');
    this.kind = kind;
    this.params = { ...params };
    this.dependsOn = [...dependsOn];
    this.masterId = masterId;              // 'instanced'/'graphics' → master node id
    this.transforms = transforms;          // Float64Array | number[] of 16·N
    this.lightweight = !!lightweight;      // graphics-only proxy until promoted
    // Cache state.
    this.contentHash = null;
    this.outputVersion = 0;
    this.output = null;
    this.dirty = true;                     // fresh node must build once
    this.error = null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// contentHashFor — the memo key. [MUST-1, MUST-2]
//
// Mirrors RebuildEngine.inputHashFor but folds upstream OUTPUT VERSIONS
// (not raw handles, which are unstable across kernels) plus the instanced
// transform digest. Using versions means: ancestor re-executes → its version
// bumps → this node's hash changes → guaranteed invalidation (no stale cache).

export function contentHashFor(node, graph) {
  const depVersions = node.dependsOn.map((id) => {
    const dep = graph.byId(id);
    return dep ? dep.outputVersion : -1;
  });
  let masterVersion = -1;
  if (node.masterId != null) {
    const m = graph.byId(node.masterId);
    masterVersion = m ? m.outputVersion : -1;
  }
  const tDigest = node.transforms ? hashTransforms(node.transforms) : '0';
  return fnv1a(
    `${node.kind}|${stableStringify(node.params)}|` +
    `${stableStringify(depVersions)}|m${masterVersion}|${tDigest}`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// AssemblyGraph — the DAG container + topological build order.

export class AssemblyGraph {
  constructor() {
    this._byId = new Map();
    this._order = [];          // insertion order (topo-respecting)
    this._listeners = new Set();
  }

  size() { return this._byId.size; }
  byId(id) { return this._byId.get(id) || null; }
  list() { return this._order.map((id) => this._byId.get(id)); }

  add(spec) {
    const node = spec instanceof AssemblyNode ? spec : new AssemblyNode(spec);
    // Refuse a node that depends on something not yet present — that would
    // break the topological invariant the rebuild relies on.
    for (const dep of node.dependsOn) {
      if (!this._byId.has(dep)) {
        throw new Error(`[incrementalRebuild] node ${node.id} depends on missing ${dep}`);
      }
    }
    if (node.masterId != null && !this._byId.has(node.masterId)) {
      throw new Error(`[incrementalRebuild] node ${node.id} references missing master ${node.masterId}`);
    }
    this._byId.set(node.id, node);
    this._order.push(node.id);
    this._notify();
    return node;
  }

  /** Update params on a node → mark it (and downstream) dirty. [MUST-1] */
  edit(id, paramUpdates) {
    const node = this._byId.get(id);
    if (!node) throw new Error(`[incrementalRebuild] edit: unknown id ${id}`);
    node.params = { ...node.params, ...paramUpdates };
    this.markDirty(id);
    this._notify();
    return node;
  }

  /**
   * Replace the ENTIRE transforms buffer of an instanced node (e.g. a pattern
   * re-laid-out). Only this node goes dirty (+ its downstream); the shared
   * master stays clean. [MUST-3]
   */
  setTransforms(id, transforms) {
    const node = this._byId.get(id);
    if (!node) throw new Error(`[incrementalRebuild] setTransforms: unknown id ${id}`);
    node.transforms = transforms;
    this.markDirty(id);
    this._notify();
    return node;
  }

  /**
   * Edit ONE instance's 4×4 inside an instanced node, in place. Marks ONLY this
   * instanced node dirty (the master is untouched). This is the canonical
   * "moved one bolt in a 10k pattern" edit. [MUST-3, MUST-4]
   * @param {string} id        instanced node id
   * @param {number} i         instance index
   * @param {number[]|Float64Array} m  16-element column-major transform
   */
  editInstanceTransform(id, i, m) {
    const node = this._byId.get(id);
    if (!node) throw new Error(`[incrementalRebuild] editInstanceTransform: unknown id ${id}`);
    if (!node.transforms) throw new Error(`[incrementalRebuild] node ${id} has no transforms`);
    const base = i * 16;
    if (base < 0 || base + 16 > node.transforms.length) {
      throw new Error(`[incrementalRebuild] instance index ${i} out of range`);
    }
    for (let k = 0; k < 16; k++) node.transforms[base + k] = m[k];
    this.markDirty(id);
    this._notify();
    return node;
  }

  // ---- dirty propagation -------------------------------------------
  // Identical structure to RebuildEngine._downstreamOf: build the reverse
  // adjacency (consumers of each node) from dependsOn + masterId, then DFS
  // from the edited root. Marks the root and every transitive DOWNSTREAM
  // dependent dirty — and NOTHING upstream or sideways. [MUST-1]

  markDirty(rootId) {
    if (!this._byId.has(rootId)) return new Set();
    const adj = this._reverseAdjacency();
    const flagged = new Set([rootId]);
    this._byId.get(rootId).dirty = true;
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      const consumers = adj.get(id) || [];
      for (const c of consumers) {
        if (!flagged.has(c)) {
          flagged.add(c);
          const n = this._byId.get(c);
          if (n) n.dirty = true;
          stack.push(c);
        }
      }
    }
    return flagged;
  }

  _reverseAdjacency() {
    const adj = new Map();
    const link = (from, to) => {
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from).push(to);
    };
    for (const node of this.list()) {
      for (const dep of node.dependsOn) link(dep, node.id);
      if (node.masterId != null) link(node.masterId, node.id);
    }
    return adj;
  }

  /**
   * Topological build order (Kahn's algorithm) over dependsOn + masterId edges.
   * A master must build before its instances; a child before its sub-assembly.
   * Throws on a cycle (the DAG invariant the rebuild depends on). [MUST-1]
   */
  buildOrder() {
    const indeg = new Map();
    const adj = new Map();
    for (const n of this.list()) indeg.set(n.id, 0);
    const edge = (from, to) => {
      if (!adj.has(from)) adj.set(from, []);
      adj.get(from).push(to);
      indeg.set(to, (indeg.get(to) || 0) + 1);
    };
    for (const n of this.list()) {
      for (const dep of n.dependsOn) edge(dep, n.id);
      if (n.masterId != null) edge(n.masterId, n.id);
    }
    // Seed the queue with insertion order among zero-indegree nodes so the
    // result is deterministic (stable across runs → stable diffs in tests).
    const queue = this._order.filter((id) => (indeg.get(id) || 0) === 0);
    const out = [];
    while (queue.length) {
      const id = queue.shift();
      out.push(this._byId.get(id));
      for (const next of (adj.get(id) || [])) {
        indeg.set(next, indeg.get(next) - 1);
        if (indeg.get(next) === 0) queue.push(next);
      }
    }
    if (out.length !== this._byId.size) {
      throw new Error('[incrementalRebuild] dependency cycle detected — DAG invariant violated');
    }
    return out;
  }

  onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
  _notify() {
    for (const fn of this._listeners) {
      try { fn(this); } catch (e) { console.error('[incrementalRebuild]', e); }
    }
  }

  serialize() {
    return {
      version: 1,
      nodes: this._order.map((id) => {
        const n = this._byId.get(id);
        return {
          id: n.id, kind: n.kind, params: n.params, dependsOn: n.dependsOn,
          masterId: n.masterId,
          transforms: n.transforms ? Array.from(n.transforms) : null,
          lightweight: n.lightweight,
        };
      }),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Default executors. Each is kernel-optional: it calls only the small forge
// surface a stub can supply (makeBox/box, bounds, tessellate). An executor
// returns the node's OUTPUT payload; the engine handles caching + versioning.
//
// `inputsOf(node, graph)` resolves the cached outputs of a node's deps so the
// executor never reaches back into the graph itself.

function inputsOf(node, graph) {
  return node.dependsOn.map((id) => {
    const dep = graph.byId(id);
    return dep ? dep.output : null;
  });
}

/**
 * The instancing-cost guarantee. A 'part' executor produces exactly ONE
 * handle. An 'instanced' executor produces ONE reference to that handle +
 * the transform buffer — it does NOT call any per-instance geometry op, so
 * 10k instances = 1 makeBox + 0 extra BReps. [MUST-3]
 */
export function defaultExecutors(forge) {
  const F = forge || (typeof window !== 'undefined' ? window.forge : null);

  const makeBox = (dx, dy, dz) => {
    if (F && typeof F.makeBox === 'function') return F.makeBox(dx, dy, dz);
    if (F && typeof F.box === 'function') return F.box(dx, dy, dz);
    throw new Error('[incrementalRebuild] no forge.makeBox available for part node');
  };
  const makeCyl = (r, h) => {
    if (F && typeof F.makeCylinder === 'function') return F.makeCylinder(r, h);
    if (F && typeof F.cylinder === 'function') return F.cylinder(r, h);
    return makeBox(2 * r, 2 * r, h); // fall back to a bbox-equivalent solid
  };
  const boundsOf = (handle, params) => {
    if (F && typeof F.bounds === 'function') {
      try { const b = F.bounds(handle); if (b && b.min && b.max) return b; } catch { /* fall through */ }
    }
    // Synthetic bounds from a spec/params body so the graphics proxy still has
    // an AABB with no kernel present. Mirrors octreeIndex.bodyAabb fallback.
    const synth = bodyAabb({ handle: undefined, params });
    return synth || { min: [-12.5, -12.5, 0], max: [12.5, 12.5, 25] };
  };
  const coarseMeshOf = (handle, params) => {
    if (F && typeof F.tessellate === 'function') {
      try {
        // Coarse deflection (2.0mm lin / 0.5rad ang) = a decimated display
        // proxy, the same "coarse" LOD lodMath.js produces. [MUST-3]
        const m = F.tessellate(handle, 2.0, 0.5);
        if (m && m.positions) {
          return { triangleCount: m.triangleCount ?? (m.indices ? m.indices.length / 3 : 0) };
        }
      } catch { /* fall through */ }
    }
    // No kernel: a bbox-cube proxy (12 triangles) is the lightweight display.
    return { triangleCount: 12, synthetic: true, params: params || null };
  };

  return {
    part: ({ node }) => {
      const p = node.params;
      let handle;
      if (p.kind === 'cylinder' || (p.r != null && p.h != null)) {
        handle = makeCyl(p.r, p.h);
      } else {
        handle = makeBox(p.dx ?? 1, p.dy ?? 1, p.dz ?? 1);
      }
      return { handle, params: { ...p } };
    },

    // ONE master ref + N transforms. No per-instance geometry. [MUST-3]
    instanced: ({ node, graph }) => {
      const master = graph.byId(node.masterId);
      const masterHandle = master && master.output ? master.output.handle : null;
      const count = node.transforms ? Math.floor(node.transforms.length / 16) : 0;
      return {
        masterId: node.masterId,
        masterHandle,
        count,
        // We keep a reference to the SAME transform buffer (no copy) — the
        // instanced render path (THREE.InstancedMesh.setMatrixAt) reads it
        // directly. The transform digest in contentHashFor is what versions it.
        transforms: node.transforms,
        instancedRef: { masterHandle, count },
      };
    },

    // Sub-assembly: compose a local transform onto its children (BFS world
    // transforms are derived on demand by worldTransforms()). [MUST-1]
    subassembly: ({ node }) => {
      const local = node.params.transform || IDENTITY16;
      return { transform: Array.from(local), childIds: [...node.dependsOn] };
    },

    // Graphics-only proxy: bbox + decimated mesh, full BRep deferred. [MUST-3]
    graphics: ({ node, graph }) => {
      const master = graph.byId(node.masterId);
      const masterHandle = master && master.output ? master.output.handle : null;
      const params = master ? master.params : node.params;
      return {
        masterId: node.masterId,
        bounds: boundsOf(masterHandle, params),
        coarseMesh: coarseMeshOf(masterHandle, params),
        fullBRep: null,           // lazy — promoteToSolid() fills this
        lightweight: true,
      };
    },

    // Mate: a solved relative transform between two instance/part outputs.
    // Modelled as the product of the two inputs' transforms (placeholder solve
    // that is deterministic + order-stable so incremental == full holds).
    mate: ({ node, inputs }) => {
      const a = (inputs[0] && inputs[0].transform) || IDENTITY16;
      const b = (inputs[1] && inputs[1].transform) || IDENTITY16;
      return { transform: mul4(a, b), kind: node.params.kind || 'Coincident' };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// IncrementalRebuilder — walks buildOrder, skips clean cache hits, runs only
// the dirty frontier, versions outputs. [MUST-1, MUST-2]

export class IncrementalRebuilder {
  /**
   * @param {AssemblyGraph} graph
   * @param {object} [executors]  kind → ({node, inputs, graph}) => output.
   *   Defaults to defaultExecutors(forge).
   * @param {object} [opts] { forge }
   */
  constructor(graph, executors = null, opts = {}) {
    this.graph = graph;
    this.executors = executors || defaultExecutors(opts.forge);
    this.stats = { executions: 0, cacheHits: 0, rebuilds: 0, lastMs: 0 };
  }

  registerExecutor(kind, fn) { this.executors[kind] = fn; }

  /**
   * Recompute ONLY dirty nodes (and nodes whose content hash changed because an
   * ancestor's outputVersion moved), in topological order; reuse every clean
   * node's cached output. Returns { ranIds, skippedIds, errors, stats, elapsedMs }.
   * [MUST-1, MUST-2]
   */
  rebuild() {
    const t0 = now();
    this.stats.rebuilds++;
    const ranIds = [];
    const skippedIds = [];
    const errors = [];

    for (const node of this.graph.buildOrder()) {
      const wanted = contentHashFor(node, this.graph);
      const isDirty = node.dirty;
      const hashMatches = node.contentHash === wanted;
      const hasOutput = node.output != null;

      // Clean cache hit: not explicitly dirty, hash unchanged, output present.
      // (When an ancestor re-ran this pass, its version moved → `wanted`
      // differs → we DON'T take this branch, so no stale cache is served.)
      if (!isDirty && hashMatches && hasOutput) {
        skippedIds.push(node.id);
        this.stats.cacheHits++;
        continue;
      }

      const exec = this.executors[node.kind];
      if (!exec) {
        node.error = `no executor for kind "${node.kind}"`;
        errors.push({ id: node.id, error: node.error });
        continue;
      }

      const inputs = inputsOf(node, this.graph);
      try {
        const output = exec({ node, inputs, graph: this.graph });
        node.output = output ?? null;
        node.contentHash = wanted;
        node.outputVersion++;        // downstream folds this → invalidation
        node.dirty = false;
        node.error = null;
        ranIds.push(node.id);
        this.stats.executions++;
      } catch (e) {
        node.error = e.message || String(e);
        node.output = null;
        node.contentHash = null;
        errors.push({ id: node.id, error: node.error });
      }
    }

    this.stats.lastMs = now() - t0;
    return { ranIds, skippedIds, errors, stats: { ...this.stats }, elapsedMs: this.stats.lastMs };
  }

  /**
   * Force a FULL from-scratch rebuild: clear every cache + version + dirty,
   * then rebuild. The equality oracle for [MUST-2/MUST-4] — the incremental
   * result must deep-equal what fullRebuild() produces from the same params.
   */
  fullRebuild() {
    for (const node of this.graph.list()) {
      node.output = null;
      node.contentHash = null;
      node.outputVersion = 0;
      node.dirty = true;
      node.error = null;
    }
    return this.rebuild();
  }

  /**
   * Lazy BRep realization for a graphics-only node. Computes/attaches the full
   * solid handle (or marks intent) + re-versions so any downstream re-resolves.
   * Until called, the node only ever held a bbox + decimated proxy. [MUST-3]
   */
  promoteToSolid(nodeId, forge = null) {
    const node = this.graph.byId(nodeId);
    if (!node) throw new Error(`[incrementalRebuild] promoteToSolid: unknown ${nodeId}`);
    if (node.kind !== 'graphics') return { ok: false, error: 'not a graphics node' };
    const master = this.graph.byId(node.masterId);
    const F = forge || (typeof window !== 'undefined' ? window.forge : null);
    let handle = master && master.output ? master.output.handle : null;
    if (handle == null && master) {
      // Realize the master solid now if it was never built.
      const exec = this.executors.part;
      const out = exec({ node: master, inputs: [], graph: this.graph });
      master.output = out;
      master.outputVersion++;
      handle = out.handle;
    }
    if (!node.output) node.output = {};
    node.output.fullBRep = handle;
    node.output.lightweight = false;
    node.lightweight = false;
    node.outputVersion++;
    this.graph.markDirty(nodeId); // downstream re-resolve, this node already solid
    node.dirty = false;           // we just produced its output
    return { ok: true, handle };
  }

  /**
   * Resolve every INSTANCE's world transform across the whole graph — the
   * comparable artefact for incremental-vs-full equality. For an instanced
   * node we compose its sub-assembly chain (if any) onto each per-instance 4×4.
   * Returns a deterministic, JSON-comparable structure:
   *   { [nodeId]: { masterHandle, worlds: number[][16] } }
   * [MUST-4]
   */
  worldTransforms() {
    const out = {};
    for (const node of this.graph.list()) {
      if (node.kind !== 'instanced' || !node.output) continue;
      const parentWorld = this._subassemblyWorld(node);
      const buf = node.output.transforms || node.transforms;
      const count = node.output.count ?? Math.floor((buf ? buf.length : 0) / 16);
      const worlds = [];
      for (let i = 0; i < count; i++) {
        const local = Array.from(buf.subarray ? buf.subarray(i * 16, i * 16 + 16)
                                              : buf.slice(i * 16, i * 16 + 16));
        worlds.push(parentWorld ? mul4(parentWorld, local) : local);
      }
      out[node.id] = { masterHandle: node.output.masterHandle, worlds };
    }
    return out;
  }

  /** Compose the transform chain of the sub-assemblies an instanced node depends on. */
  _subassemblyWorld(node) {
    let world = null;
    for (const depId of node.dependsOn) {
      const dep = this.graph.byId(depId);
      if (dep && dep.kind === 'subassembly' && dep.output) {
        const t = dep.output.transform || IDENTITY16;
        world = world ? mul4(world, t) : Array.from(t);
      }
    }
    return world;
  }
}

function now() {
  return (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
}

// ─────────────────────────────────────────────────────────────────────
// buildGridAssembly — construct an N-instance grid with sub-assembly grouping,
// the canonical large-assembly benchmark fixture. [MUST-4]
//
// Layout: `groups` sub-assemblies, each owning ONE shared master part + an
// instanced node of `perGroup` transforms (a square-ish grid). Total instances
// = groups × perGroup. Editing ONE group's master dirties only that group's
// instanced node (+ that master) — the dirty subtree — not the other groups.
//
// Returns { graph, rebuilder, masterIds, instancedIds, subIds, totalInstances }.

export function buildGridAssembly({
  groups = 100, perGroup = 100, spacing = 50, forge = null, executors = null,
} = {}) {
  const graph = new AssemblyGraph();
  const masterIds = [];
  const instancedIds = [];
  const subIds = [];

  const cols = Math.max(1, Math.round(Math.sqrt(perGroup)));
  for (let g = 0; g < groups; g++) {
    // One shared master part per group (a small box — the "bolt").
    const master = graph.add(new AssemblyNode({
      id: `master-${g}`, kind: 'part',
      params: { dx: 4 + (g % 3), dy: 4, dz: 8 },
    }));
    masterIds.push(master.id);

    // Sub-assembly grouping node (carries the group's placement transform).
    const gx = (g % 10) * spacing * cols;
    const gy = Math.floor(g / 10) * spacing * cols;
    const sub = graph.add(new AssemblyNode({
      id: `sub-${g}`, kind: 'subassembly',
      params: { transform: [
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, gx, gy, 0, 1,
      ] },
    }));
    subIds.push(sub.id);

    // ONE instanced node: perGroup transforms, ONE master ref. [MUST-3]
    const transforms = new Float64Array(perGroup * 16);
    for (let i = 0; i < perGroup; i++) {
      const ix = (i % cols) * spacing;
      const iy = Math.floor(i / cols) * spacing;
      const base = i * 16;
      // Column-major translation-only 4×4.
      transforms[base + 0] = 1; transforms[base + 5] = 1;
      transforms[base + 10] = 1; transforms[base + 15] = 1;
      transforms[base + 12] = ix; transforms[base + 13] = iy; transforms[base + 14] = 0;
    }
    const inst = graph.add(new AssemblyNode({
      id: `inst-${g}`, kind: 'instanced',
      masterId: master.id, dependsOn: [sub.id], transforms,
    }));
    instancedIds.push(inst.id);
  }

  const rebuilder = new IncrementalRebuilder(graph, executors, { forge });
  return {
    graph, rebuilder, masterIds, instancedIds, subIds,
    totalInstances: groups * perGroup,
  };
}

// ─────────────────────────────────────────────────────────────────────
// benchmark10k — build a 10k-instance assembly, full-rebuild, then markDirty
// ONE group's master + rebuild; measures wall-clock + recomputed-node count.
// Returns the numbers the test asserts against. [MUST-4]

export function benchmark10k({ groups = 100, perGroup = 100, forge = null } = {}) {
  const counter = { calls: [] };
  const F = forge || countingStubForge(counter);
  const exec = countingExecutors(defaultExecutors(F), counter);

  const fixture = buildGridAssembly({ groups, perGroup, forge: F, executors: exec });
  const { graph, rebuilder, masterIds } = fixture;

  const full = rebuilder.fullRebuild();
  const fullExecutions = full.ranIds.length;

  // Dirty ONE group's master → that master + its instanced node form the
  // dirty subtree (the sub-assembly is untouched). [MUST-4]
  counter.calls.length = 0;
  rebuilder.stats.executions = 0;
  rebuilder.stats.cacheHits = 0;
  const dirtied = graph.markDirty(masterIds[0]);

  const t0 = now();
  const inc = rebuilder.rebuild();
  const elapsedMs = now() - t0;

  return {
    totalInstances: fixture.totalInstances,
    fullExecutions,
    dirtySubtreeSize: dirtied.size,
    recomputedCount: inc.ranIds.length,
    skippedCount: inc.skippedIds.length,
    elapsedMs,
    ranIds: inc.ranIds,
    skippedIds: inc.skippedIds,
    fixture,
  };
}

/**
 * Counting stub forge — every geometry op pushes to counter.calls so a test
 * can assert "only ONE makeBox per master, ZERO per instance". Kernel-optional.
 *
 * Handles are CONTENT-ADDRESSED: identical box/cylinder dimensions return the
 * SAME handle regardless of call order. This mirrors a real kernel's identical-
 * solid cache AND makes the incremental-vs-full geometry-ref comparison
 * meaningful: a full rebuild (which re-runs every master) and an incremental
 * rebuild (which re-runs one) must agree on each master's geometry identity,
 * not on a volatile monotonic counter. Each DISTINCT geometry still costs one
 * real op (counted), so the instancing/only-dirty proofs are unaffected.
 */
export function countingStubForge(counter) {
  const handleByKey = new Map();
  let next = 1;
  const handleFor = (key) => {
    if (!handleByKey.has(key)) handleByKey.set(key, next++);
    return handleByKey.get(key);
  };
  return {
    makeBox: (dx, dy, dz) => { counter.calls.push(['makeBox', dx, dy, dz]); return handleFor(`box|${dx}|${dy}|${dz}`); },
    makeCylinder: (r, hh) => { counter.calls.push(['makeCylinder', r, hh]); return handleFor(`cyl|${r}|${hh}`); },
    bounds: (handle) => { counter.calls.push(['bounds', handle]); return { min: [0, 0, 0], max: [10, 10, 10] }; },
    tessellate: (handle) => { counter.calls.push(['tessellate', handle]); return { positions: [], indices: [], triangleCount: 12 }; },
  };
}

/** Wrap executors so each executor invocation is counted by kind. */
export function countingExecutors(base, counter) {
  const wrapped = {};
  for (const [kind, fn] of Object.entries(base)) {
    wrapped[kind] = (ctx) => { counter.calls.push(['exec', kind, ctx.node.id]); return fn(ctx); };
  }
  return wrapped;
}

// ─────────────────────────────────────────────────────────────────────
// Window install — mirrors installForgeRunner / installOctreeWindowApi so the
// shell + e2e + the ForgeToolBridge verbs reach ONE live graph. Idempotent.

export function installAssemblyGraph(globalObj = (typeof window !== 'undefined' ? window : globalThis)) {
  if (!globalObj.__forgeAssemblyGraph) {
    globalObj.__forgeAssemblyGraph = new AssemblyGraph();
  }
  if (!globalObj.__forgeAssemblyRebuilder) {
    globalObj.__forgeAssemblyRebuilder = new IncrementalRebuilder(
      globalObj.__forgeAssemblyGraph, null,
      { forge: globalObj.forge },
    );
  }
  globalObj.__forgeAssemblyMarkDirty = (id) => globalObj.__forgeAssemblyGraph.markDirty(id);
  globalObj.__forgeAssemblyRebuild = () => globalObj.__forgeAssemblyRebuilder.rebuild();
  return {
    graph: globalObj.__forgeAssemblyGraph,
    rebuilder: globalObj.__forgeAssemblyRebuilder,
  };
}

/** Resolve the live graph+rebuilder a ForgeToolBridge verb operates on. */
export function getAssemblyGraph(globalObj = (typeof window !== 'undefined' ? window : globalThis)) {
  if (!globalObj.__forgeAssemblyGraph || !globalObj.__forgeAssemblyRebuilder) {
    return installAssemblyGraph(globalObj);
  }
  return {
    graph: globalObj.__forgeAssemblyGraph,
    rebuilder: globalObj.__forgeAssemblyRebuilder,
  };
}
