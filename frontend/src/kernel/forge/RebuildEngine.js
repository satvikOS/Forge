/**
 * RebuildEngine — parametric dirty-propagation rebuilder over FeatureTree.
 *
 * Each FeatureNode caches `outputHandle` (last-known native shape handle)
 * alongside `_inputHash` (hash of the inputs that produced it). The
 * engine walks `tree.buildOrder()` and skips any node whose inputs hash
 * to the same value it cached, so an unrelated downstream edit doesn't
 * force every upstream feature to re-run through OCCT.
 *
 * Wire-up:
 *   const engine = new RebuildEngine(tree, executors);
 *   engine.markDirty(featureId)    // edit triggered upstream
 *   await engine.rebuild()         // re-runs only dirty + downstream
 *
 * `executors` maps `feature.kind` → async function ({ feature, inputs }) =>
 * outputHandle. The engine handles caching; executors stay stateless.
 *
 * Tested in __tests__/RebuildEngine.test.mjs:
 *   - cache hits on un-edited downstream (executor count stays the same)
 *   - cache misses on edited node + all downstream of it
 *   - hashing covers dependsOn outputHandles so swapping an upstream
 *     re-runs everyone who consumed it
 */

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Fast 32-bit non-cryptographic string hash (FNV-1a). */
function fnv1a(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/** Hash that mixes a feature's params with the outputs of its dependsOn. */
function inputHashFor(node, tree) {
  const depOutputs = node.dependsOn.map((id) => {
    const dep = tree.byId(id);
    return dep ? (dep.outputHandle ?? null) : null;
  });
  return fnv1a(`${node.kind}|${stableStringify(node.params)}|${stableStringify(depOutputs)}`);
}

export class RebuildEngine {
  /**
   * @param {FeatureTree} tree
   * @param {Object<string, (ctx:{feature,inputs}) => any|Promise<any>>} executors
   */
  constructor(tree, executors = {}) {
    this.tree = tree;
    this.executors = { ...executors };
    /** Feature ids that need re-execution on next rebuild(). */
    this.dirtySet = new Set();
    /** Optional stat counter — perf_smoke uses this to verify hits/misses. */
    this.stats = { executions: 0, cacheHits: 0, rebuilds: 0 };

    // Auto-subscribe: any tree.edit / suppress / reorder marks the affected
    // node + all downstream dirty. We do this by tracking the tree's
    // change events; the listener is removed by `detach()`.
    this._lastSeenParams = new Map();
    this._unsub = tree.onChange(() => this._diffParamsAndPropagate());
    for (const f of tree.list()) {
      this._lastSeenParams.set(f.id, stableStringify(f.params));
    }
  }

  detach() {
    if (this._unsub) this._unsub();
    this._unsub = null;
  }

  registerExecutor(kind, fn) {
    this.executors[kind] = fn;
  }

  /** Mark a feature dirty and propagate downstream. */
  markDirty(featureId) {
    if (!this.tree.byId(featureId)) return;
    const downstream = this._downstreamOf(featureId);
    this.dirtySet.add(featureId);
    for (const id of downstream) this.dirtySet.add(id);
  }

  _diffParamsAndPropagate() {
    for (const f of this.tree.list()) {
      const sig = stableStringify(f.params);
      const prev = this._lastSeenParams.get(f.id);
      if (prev !== sig) {
        this._lastSeenParams.set(f.id, sig);
        if (prev !== undefined) this.markDirty(f.id);
      }
    }
    // Remove signatures for deleted features so we don't leak.
    const live = new Set(this.tree.list().map((f) => f.id));
    for (const id of [...this._lastSeenParams.keys()]) {
      if (!live.has(id)) this._lastSeenParams.delete(id);
    }
  }

  _downstreamOf(rootId) {
    const out = new Set();
    const adj = new Map();
    for (const f of this.tree.list()) {
      for (const dep of f.dependsOn) {
        if (!adj.has(dep)) adj.set(dep, []);
        adj.get(dep).push(f.id);
      }
    }
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      const kids = adj.get(id) || [];
      for (const k of kids) {
        if (!out.has(k)) { out.add(k); stack.push(k); }
      }
    }
    return out;
  }

  /**
   * Walk buildOrder. For each feature, compute the input hash; if it
   * matches `feature._inputHash` and the node isn't in dirtySet, reuse
   * the cached `outputHandle`. Otherwise call the executor, cache the
   * fresh handle + hash, and clear it from dirtySet.
   *
   * Returns { ranIds, skippedIds, errors }.
   */
  async rebuild() {
    this.stats.rebuilds++;
    const ranIds = [];
    const skippedIds = [];
    const errors = [];

    for (const node of this.tree.buildOrder()) {
      const wanted = inputHashFor(node, this.tree);
      const isDirty = this.dirtySet.has(node.id);
      const hashUnchanged = node._inputHash === wanted;

      if (!isDirty && hashUnchanged && node.outputHandle !== null) {
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

      const inputs = node.dependsOn.map((id) => {
        const dep = this.tree.byId(id);
        return dep ? dep.outputHandle : null;
      });

      try {
        const handle = await exec({ feature: node, inputs });
        node.outputHandle = handle ?? null;
        node._inputHash   = wanted;
        node.error        = null;
        this.dirtySet.delete(node.id);
        ranIds.push(node.id);
        this.stats.executions++;
      } catch (e) {
        node.error        = e.message || String(e);
        node.outputHandle = null;
        node._inputHash   = null;
        errors.push({ id: node.id, error: node.error });
      }
    }

    return { ranIds, skippedIds, errors };
  }
}

export { inputHashFor, stableStringify, fnv1a };
