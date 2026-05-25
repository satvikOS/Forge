/**
 * EquationStore — global parametric variable store for UX Tier 10
 * (Equation Manager / Global Variables).
 *
 *   variables: Map<name, { expression, value, type, comment }>
 *
 *   - `expression` is the raw input as the user typed it. A leading `=`
 *     is OPTIONAL but conventional ("=width*0.6" or "width*0.6" both work);
 *     it is preserved on the row so the UI round-trips faithfully.
 *   - `value` is the evaluated finite Number (or null when the expression
 *     fails to evaluate; the row carries an `error` string in that case).
 *   - `type` is one of 'literal' | 'expression'. 'literal' means the
 *     expression is a bare number (no identifiers); 'expression' means
 *     it references at least one variable or function.
 *
 * Public API (singleton via `equationStore()`):
 *
 *   set(name, expression, opts?)   — parse + evaluate + store; cascade
 *                                    re-evaluation to dependents.
 *   get(name)                       — evaluated numeric value (or undefined)
 *   getExpression(name)             — raw expression text
 *   getRow(name)                    — full {expression, value, type, comment, error}
 *   delete(name)                    — remove; cascade re-eval (deps may now error)
 *   list()                          — array of {name, expression, value, type, ...}
 *   evaluate(expression)            — eval an arbitrary expression in the
 *                                    current variable scope (used by the
 *                                    sketch-dim `=expr` hook).
 *   clear()                         — wipe everything (test convenience)
 *
 * Persistence: every mutating call writes the full state to localStorage
 * under `archdisc.equationStore.v1`. On first construction, the store
 * hydrates from that key.
 *
 * Dependency tracking + topological order:
 *
 *   Each row remembers `deps: string[]` (variables it references) and
 *   each variable remembers `dependents: Set<string>` (variables that
 *   reference it). `set()` builds the full dependency graph, runs a
 *   topological sort starting from the changed name + each direct
 *   dependent, and re-evaluates rows in that order. Circular references
 *   are detected (DFS with grey nodes) and rejected — the change is
 *   reverted and the call returns `{ ok: false, reason: 'circular' }`.
 *
 * Events:
 *   - 'archdisc:equation-store:changed' fires on every mutation with a
 *     snapshot {names, mutated:[name], cascade:[name,...]}.
 *   - 'archdisc:equation-store:error'   fires when an expression fails
 *     to evaluate (parse error or non-finite).
 *
 * The store also publishes `window.__archdiscEquationStore` so e2e specs
 * and the AI orchestration layer can introspect it without import cycles.
 */

import {
  evaluateExpression,
  collectVariableReferences,
} from './ExpressionEvaluator.js';

const STORAGE_KEY = 'archdisc.equationStore.v1';

class EquationStoreImpl {
  constructor() {
    this.variables = new Map();   // name → { expression, value, type, comment, error?, deps:string[] }
    this.dependents = new Map();  // name → Set<string>  (variables referencing this name)
    this._hydrated = false;
    this._hydrate();
    this._publish();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Add or update a variable. Re-evaluates the variable + every
   * downstream dependent in topological order. Rejects circular refs.
   *
   * @param {string} name
   * @param {string|number} expression
   * @param {{ comment?: string }} [opts]
   * @returns {{ ok: boolean, name?: string, value?: number, type?: string,
   *             error?: string, reason?: string, cascade?: string[] }}
   */
  set(name, expression, opts = {}) {
    const validName = validateName(name);
    if (!validName.ok) return { ok: false, reason: validName.reason };
    const rawExpr = expression === null || expression === undefined ? '' : String(expression);
    const exprBody = stripLeadingEquals(rawExpr);
    if (!exprBody.trim()) {
      return { ok: false, reason: 'expression must not be empty' };
    }

    // Collect dependencies + check for circular reference BEFORE we
    // mutate, so the caller sees a clean rejection.
    let deps;
    try { deps = collectVariableReferences(exprBody); }
    catch (e) { return { ok: false, reason: `parse failed: ${e.message}` }; }

    // Detect self-reference + transitive cycles via a hypothetical graph
    // built from the *would-be* state.
    if (deps.includes(name)) {
      return { ok: false, reason: `circular: "${name}" references itself` };
    }
    const cycle = this._wouldFormCycle(name, deps);
    if (cycle) {
      return { ok: false, reason: `circular: ${cycle.join(' → ')}` };
    }

    // Save previous row for rollback on eval failure.
    const prev = this.variables.get(name) || null;
    const prevDeps = prev ? (prev.deps || []) : [];

    // Install the new row tentatively so `_evaluateRow` can recurse.
    const row = {
      expression: rawExpr,
      value: null,
      type: deps.length === 0 ? 'literal' : 'expression',
      comment: typeof opts.comment === 'string' ? opts.comment : (prev ? prev.comment : ''),
      deps,
      error: null,
    };
    this.variables.set(name, row);

    // Update reverse-dependent index.
    this._removeDependentEdges(name, prevDeps);
    this._addDependentEdges(name, deps);

    // Evaluate this row + cascade to direct + transitive dependents in
    // topological order.
    const cascade = this._topologicalOrderFrom(name);
    const evalErrors = [];
    for (const n of cascade) {
      const r = this._evaluateRow(n);
      if (!r.ok && n === name) {
        // Roll back to the previous state for the originating row.
        if (prev) {
          this.variables.set(name, prev);
          this._removeDependentEdges(name, deps);
          this._addDependentEdges(name, prevDeps);
        } else {
          this.variables.delete(name);
          this._removeDependentEdges(name, deps);
        }
        this._persist();
        this._publish();
        return { ok: false, reason: r.error, error: r.error };
      }
      if (!r.ok) evalErrors.push({ name: n, error: r.error });
    }

    this._persist();
    this._publish({ mutated: [name], cascade });
    return {
      ok: true,
      name,
      value: row.value,
      type: row.type,
      cascade,
      downstreamErrors: evalErrors,
    };
  }

  /** Get the evaluated numeric value of a variable, or undefined. */
  get(name) {
    const r = this.variables.get(name);
    return r ? r.value : undefined;
  }

  /** Get the raw expression text for a variable (or null). */
  getExpression(name) {
    const r = this.variables.get(name);
    return r ? r.expression : null;
  }

  /** Get the full row record (or null). */
  getRow(name) {
    const r = this.variables.get(name);
    if (!r) return null;
    return {
      name,
      expression: r.expression,
      value: r.value,
      type: r.type,
      comment: r.comment,
      deps: [...r.deps],
      error: r.error || null,
    };
  }

  /**
   * Remove a variable. Cascade-re-evaluates every direct + transitive
   * dependent (which will now error since the variable is gone — the
   * UI surfaces the errored rows).
   */
  delete(name) {
    const r = this.variables.get(name);
    if (!r) return { ok: false, reason: `unknown variable "${name}"` };
    const directDependents = [...(this.dependents.get(name) || [])];
    this._removeDependentEdges(name, r.deps);
    this.variables.delete(name);
    this.dependents.delete(name);

    // Cascade-re-evaluate downstream rows so they pick up the missing-ref
    // error and the UI shows what broke.
    const cascade = [];
    const seen = new Set();
    const walk = (n) => {
      if (seen.has(n)) return;
      seen.add(n);
      const node = this.variables.get(n);
      if (!node) return;
      cascade.push(n);
      for (const d of (this.dependents.get(n) || [])) walk(d);
    };
    for (const d of directDependents) walk(d);
    for (const n of cascade) this._evaluateRow(n);

    this._persist();
    this._publish({ mutated: [name], cascade, removed: [name] });
    return { ok: true, removed: name, cascade };
  }

  /**
   * Evaluate an arbitrary expression in the current variable scope.
   * Used by the sketch dimension hook (`=expr` strings) and by any AI
   * orchestration layer that wants to resolve a parametric expression.
   *
   * @param {string} expression
   * @returns {{ ok: boolean, value?: number, error?: string }}
   */
  evaluate(expression) {
    const body = stripLeadingEquals(String(expression || ''));
    if (!body.trim()) return { ok: false, error: 'empty expression' };
    try {
      const v = evaluateExpression(body, (name) => this._resolve(name));
      return { ok: true, value: v };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Snapshot every variable as an array (UI table source-of-truth). */
  list() {
    const out = [];
    for (const [name, r] of this.variables.entries()) {
      out.push({
        name,
        expression: r.expression,
        value: r.value,
        type: r.type,
        comment: r.comment,
        deps: [...r.deps],
        error: r.error || null,
      });
    }
    // Preserve insertion order (Map iteration is insertion-order); also
    // sort by name for the e2e to assert stable output.
    return out;
  }

  /** Wipe the entire store (test helper). */
  clear() {
    this.variables.clear();
    this.dependents.clear();
    this._persist();
    this._publish({ cleared: true });
    return { ok: true };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  _resolve(name) {
    const r = this.variables.get(name);
    if (!r) return undefined;
    return Number.isFinite(r.value) ? r.value : undefined;
  }

  _evaluateRow(name) {
    const row = this.variables.get(name);
    if (!row) return { ok: false, error: `unknown "${name}"` };
    const body = stripLeadingEquals(row.expression);
    try {
      const v = evaluateExpression(body, (n) => this._resolve(n));
      row.value = v;
      row.error = null;
      return { ok: true, value: v };
    } catch (e) {
      row.value = null;
      row.error = e.message;
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('archdisc:equation-store:error', {
            detail: { name, expression: row.expression, error: e.message },
          }));
        }
      } catch (_) {}
      return { ok: false, error: e.message };
    }
  }

  _addDependentEdges(name, deps) {
    for (const d of deps) {
      if (!this.dependents.has(d)) this.dependents.set(d, new Set());
      this.dependents.get(d).add(name);
    }
  }

  _removeDependentEdges(name, deps) {
    for (const d of deps) {
      const set = this.dependents.get(d);
      if (!set) continue;
      set.delete(name);
      if (set.size === 0) this.dependents.delete(d);
    }
  }

  /**
   * Check whether installing (name → deps) would form a cycle in the
   * dependency graph. Returns the cycle as an array of names, or null
   * if no cycle. DFS from each dep upward through reverse-dependent
   * edges — if any path reaches `name`, that's a cycle.
   */
  _wouldFormCycle(name, deps) {
    if (deps.length === 0) return null;
    // For every dep `d`, look at what depends on `name` already. If any
    // transitive dependent of `name` is `d` itself, adding edge `name → d`
    // (via `name`'s expression referencing `d`) closes a cycle.
    // Equivalently: BFS through `dependents` starting at `name`; if we
    // hit any `d ∈ deps`, that's the cycle.
    const queue = [{ node: name, path: [name] }];
    const seen = new Set([name]);
    while (queue.length) {
      const { node, path } = queue.shift();
      const set = this.dependents.get(node);
      if (!set) continue;
      for (const next of set) {
        const newPath = [...path, next];
        if (deps.includes(next)) {
          return [...newPath, name];
        }
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({ node: next, path: newPath });
        }
      }
    }
    return null;
  }

  /**
   * Topological order starting at `root`: yields root itself first, then
   * every transitive dependent in an order where every node's
   * predecessors (rows it depends on) have already been evaluated.
   *
   * Kahn's algorithm restricted to the subgraph rooted at `root`.
   */
  _topologicalOrderFrom(root) {
    // Collect the reachable subgraph + in-degree counts (in the original
    // dependents direction: edge dep→dependent).
    const inDegree = new Map();
    const nodes = new Set();
    const queue = [root];
    while (queue.length) {
      const n = queue.shift();
      if (nodes.has(n)) continue;
      nodes.add(n);
      inDegree.set(n, 0);
      const set = this.dependents.get(n);
      if (!set) continue;
      for (const next of set) {
        if (!nodes.has(next)) queue.push(next);
      }
    }
    // Compute in-degrees restricted to the subgraph.
    for (const n of nodes) {
      const row = this.variables.get(n);
      if (!row) continue;
      for (const dep of row.deps) {
        if (nodes.has(dep)) {
          inDegree.set(n, (inDegree.get(n) || 0) + 1);
        }
      }
    }
    // Kahn — start with zero-in-degree nodes.
    const order = [];
    const ready = [];
    for (const [n, d] of inDegree.entries()) if (d === 0) ready.push(n);
    while (ready.length) {
      const n = ready.shift();
      order.push(n);
      const set = this.dependents.get(n);
      if (!set) continue;
      for (const next of set) {
        if (!inDegree.has(next)) continue;
        const d = inDegree.get(next) - 1;
        inDegree.set(next, d);
        if (d === 0) ready.push(next);
      }
    }
    // If the algo deadlocks (residual cycle — should not happen given
    // _wouldFormCycle gate), append remaining nodes in deterministic
    // order so we don't silently drop them.
    if (order.length < nodes.size) {
      for (const n of nodes) if (!order.includes(n)) order.push(n);
    }
    return order;
  }

  _hydrate() {
    if (this._hydrated) return;
    this._hydrated = true;
    if (typeof window === 'undefined') return;
    let raw;
    try { raw = window.localStorage.getItem(STORAGE_KEY); }
    catch (_) { return; }
    if (!raw) return;
    let snap;
    try { snap = JSON.parse(raw); }
    catch (_) { return; }
    if (!snap || !Array.isArray(snap.variables)) return;
    // Restore in two passes: install rows (without eval) so the dep map
    // is complete, then evaluate every row.
    for (const v of snap.variables) {
      if (!v || typeof v.name !== 'string') continue;
      const exprBody = stripLeadingEquals(String(v.expression || ''));
      let deps = [];
      try { deps = collectVariableReferences(exprBody); }
      catch (_) { deps = []; }
      const row = {
        expression: String(v.expression || ''),
        value: null,
        type: deps.length === 0 ? 'literal' : 'expression',
        comment: typeof v.comment === 'string' ? v.comment : '',
        deps,
        error: null,
      };
      this.variables.set(v.name, row);
      this._addDependentEdges(v.name, deps);
    }
    // Pass 2 — evaluate in a stable order: every literal first (no deps),
    // then variables whose deps are already evaluated, repeating until
    // fixed point.
    const names = [...this.variables.keys()];
    let safety = names.length * 3 + 5;
    let changed = true;
    while (changed && safety-- > 0) {
      changed = false;
      for (const n of names) {
        const r = this.variables.get(n);
        if (!r || r.value !== null || r.error) continue;
        const allResolved = r.deps.every((d) => {
          const dr = this.variables.get(d);
          return dr && Number.isFinite(dr.value);
        });
        if (r.deps.length === 0 || allResolved) {
          this._evaluateRow(n);
          changed = true;
        }
      }
    }
    // Any still-unresolved row gets evaluated once to surface its error.
    for (const n of names) {
      const r = this.variables.get(n);
      if (r && r.value === null && !r.error) this._evaluateRow(n);
    }
  }

  _persist() {
    if (typeof window === 'undefined') return;
    try {
      const snap = {
        version: 1,
        variables: this.list().map((v) => ({
          name: v.name,
          expression: v.expression,
          comment: v.comment,
        })),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    } catch (_) { /* localStorage unavailable — ignore */ }
  }

  _publish(detail) {
    if (typeof window === 'undefined') return;
    window.__archdiscEquationStore = this;
    try {
      window.dispatchEvent(new CustomEvent('archdisc:equation-store:changed', {
        detail: { ...detail, names: [...this.variables.keys()] },
      }));
    } catch (_) {}
  }
}

// Singleton
let _instance = null;
export function equationStore() {
  if (!_instance) _instance = new EquationStoreImpl();
  return _instance;
}

/** Test-only: reset the singleton (used in unit tests so each test
 *  starts with an empty store). */
export function __resetEquationStoreForTests() {
  _instance = null;
}

// ── helpers ──────────────────────────────────────────────────────────────

function validateName(name) {
  if (typeof name !== 'string') return { ok: false, reason: 'name must be a string' };
  const n = name.trim();
  if (!n) return { ok: false, reason: 'name must not be empty' };
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
    return { ok: false, reason: `name "${n}" is not a valid identifier (use letters, digits, underscore; start with letter or underscore)` };
  }
  return { ok: true, name: n };
}

function stripLeadingEquals(s) {
  return s.startsWith('=') ? s.slice(1) : s;
}

// Eagerly publish the singleton when this module is imported in a
// browser context so consumers (the EquationManager modal, the sketch
// dim hook) see `window.__archdiscEquationStore` immediately.
if (typeof window !== 'undefined') {
  try { equationStore(); } catch (_) {}
}
