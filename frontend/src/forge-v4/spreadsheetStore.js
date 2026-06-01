// Forge-153 — Parametric spreadsheet store.
//
// FreeCAD-style spreadsheet workbench: A1..ZZ100 (676 columns × 100
// rows = 67 600 cells, lazy — only touched cells are persisted). Each
// cell holds a literal `value`, an optional `formula` (string, the
// raw user input including the leading '='), and the live `dependents`
// / `dependencies` sets used to schedule a topological re-eval whenever
// an upstream cell changes.
//
// Public surface:
//
//   • setCell(id, raw)          — write a cell. raw is the user-typed
//                                 string. If it starts with '=' it is
//                                 parsed as a formula, dependencies
//                                 are rebuilt, and downstream cells are
//                                 re-evaluated in topological order.
//                                 Otherwise the literal (number or text)
//                                 is stored verbatim.
//   • bindCellName(id, name)    — attach a named binding to a cell so
//                                 the EquationManager can read it as a
//                                 variable. Names are unique; passing
//                                 '' or null removes the binding.
//   • clearCell(id)             — drop the cell and rewire neighbours.
//   • getCell(id), getValue(id) — read APIs.
//   • listBindings()            — { name -> { cellId, value } } for
//                                 EquationManager consumption.
//   • subscribe(cb)             — React useSyncExternalStore contract.
//   • snapshot()                — CACHED with version counter. The same
//                                 object reference is returned until
//                                 notify() bumps _version. This is the
//                                 exact React #185 trap pdmStore.js hit
//                                 in Forge-143 — every store on the
//                                 surface follows the same contract.
//
// Persistence: localStorage key `forge.v4.spreadsheet`. Only non-empty
// cells and the bindings map are written. Dependency sets are rebuilt
// from each cell's formula on load — they are not persisted.
//
// Circular dependency detection: a Kahn's algorithm topological walk
// over the dependency closure of the changed cell. If a cycle is
// detected, every cell in the cycle is flagged with `error: '#CYCLE!'`
// and the user-visible value becomes that string.

import { evaluateFormula, parseFormulaDeps } from './spreadsheetFormulas.js';

const LS_KEY        = 'forge.v4.spreadsheet';
const SCHEMA_VERSION = 1;

export const NUM_COLS = 676;   // A, B, …, Z, AA, AB, …, ZZ.
export const NUM_ROWS = 100;

// ── id helpers ───────────────────────────────────────────────────────

/** colIndex(0)  → 'A', colIndex(25) → 'Z', colIndex(26) → 'AA', … */
export function colIndexToLabel(index) {
  if (!Number.isInteger(index) || index < 0 || index >= NUM_COLS) {
    throw new Error(`colIndexToLabel: out of range (${index})`);
  }
  // 1-based base-26 with letters as digits (A=1 .. Z=26).
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** colLabelToIndex('A')  → 0, colLabelToIndex('Z') → 25,
 *  colLabelToIndex('AA') → 26, colLabelToIndex('ZZ') → 701. */
export function colLabelToIndex(label) {
  const s = String(label || '').toUpperCase();
  if (!/^[A-Z]+$/.test(s)) {
    throw new Error(`colLabelToIndex: invalid label "${label}"`);
  }
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n - 1;
}

const CELL_RE = /^([A-Z]+)([0-9]+)$/;

/** Parse "A1" or "AB23" into { col, row } 0-indexed. Returns null
 *  on a malformed id — callers decide whether to throw. */
export function parseCellId(id) {
  const m = String(id || '').toUpperCase().match(CELL_RE);
  if (!m) return null;
  const col = colLabelToIndex(m[1]);
  const row = parseInt(m[2], 10) - 1;
  if (col < 0 || col >= NUM_COLS) return null;
  if (row < 0 || row >= NUM_ROWS) return null;
  return { col, row };
}

/** cellId(0, 0) → 'A1', cellId(701, 99) → 'ZZ100'. */
export function cellId(col, row) {
  return `${colIndexToLabel(col)}${row + 1}`;
}

// ── state ────────────────────────────────────────────────────────────

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    // Sparse map: cellId -> { value, formula, error }.
    // Dependency sets live on a side map (_deps / _depsRev) because
    // they're cheap to rebuild and we don't want to persist them.
    cells:    {},
    // name -> cellId. Reverse lookup is cellId -> name (rebuilt on load).
    bindings: {},
  };
}

let _state    = emptyState();
let _deps     = new Map();   // cellId -> Set<cellId> the cell depends on
let _depsRev  = new Map();   // cellId -> Set<cellId> that depend on this
let _nameByCell = new Map(); // cellId -> binding name

const _subs   = new Set();
let _cachedSnap        = null;
let _cachedSnapVersion = -1;
let _version           = 0;

// ── persistence ──────────────────────────────────────────────────────

function loadLS() {
  if (typeof localStorage === 'undefined') return emptyState();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyState();
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return emptyState();
    if (v.schemaVersion !== SCHEMA_VERSION) {
      // Archive stale schemas rather than silently mangle.
      try {
        localStorage.setItem(`${LS_KEY}.archive.${v.schemaVersion ?? 0}`, raw);
      } catch { /* quota — best effort */ }
      return emptyState();
    }
    const base = emptyState();
    return {
      schemaVersion: SCHEMA_VERSION,
      cells:    (v.cells    && typeof v.cells    === 'object') ? v.cells    : base.cells,
      bindings: (v.bindings && typeof v.bindings === 'object') ? v.bindings : base.bindings,
    };
  } catch {
    return emptyState();
  }
}

function saveLS() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); }
  catch { /* quota or denied — in-memory only */ }
}

function rebuildIndexes() {
  _deps    = new Map();
  _depsRev = new Map();
  _nameByCell = new Map();
  // Bindings reverse map.
  for (const [name, id] of Object.entries(_state.bindings)) {
    _nameByCell.set(id, name);
  }
  // Dependency graph from each cell's formula.
  for (const [id, c] of Object.entries(_state.cells)) {
    if (c && typeof c.formula === 'string' && c.formula.startsWith('=')) {
      const deps = parseFormulaDeps(c.formula.slice(1));
      _deps.set(id, new Set(deps));
      for (const d of deps) {
        if (!_depsRev.has(d)) _depsRev.set(d, new Set());
        _depsRev.get(d).add(id);
      }
    }
  }
}

function _bumpVersion() { _version++; _cachedSnap = null; }

function notify() {
  _bumpVersion();
  for (const s of _subs) {
    try { s(); } catch { /* keep going */ }
  }
}

function persist() {
  saveLS();
  notify();
}

// ── boot ─────────────────────────────────────────────────────────────

_state = loadLS();
rebuildIndexes();

// ── read API ─────────────────────────────────────────────────────────

/** Return the literal cell record or a fresh empty cell sentinel. */
export function getCell(id) {
  const c = _state.cells[id];
  if (c) return { id, value: c.value, formula: c.formula || null, error: c.error || null };
  return { id, value: null, formula: null, error: null };
}

/** Return the evaluated value (number/string/null) for a cell. */
export function getValue(id) {
  return _state.cells[id]?.value ?? null;
}

/** Return all populated cells (id -> record) — used by snapshot + tests. */
export function listCells() {
  const out = {};
  for (const [id, c] of Object.entries(_state.cells)) {
    out[id] = { id, value: c.value, formula: c.formula || null, error: c.error || null };
  }
  return out;
}

/** Return { name -> { cellId, value } }. Consumed by EquationManager so
 *  spreadsheet bindings show up as solvable variables. */
export function listBindings() {
  const out = {};
  for (const [name, id] of Object.entries(_state.bindings)) {
    out[name] = { cellId: id, value: _state.cells[id]?.value ?? null };
  }
  return out;
}

/** Reverse binding lookup — given a cellId, return its binding name (or null). */
export function bindingNameFor(id) {
  return _nameByCell.get(id) || null;
}

// ── dependency graph maintenance ─────────────────────────────────────

function unregisterDeps(id) {
  const prev = _deps.get(id);
  if (!prev) return;
  for (const d of prev) {
    const rev = _depsRev.get(d);
    if (rev) {
      rev.delete(id);
      if (rev.size === 0) _depsRev.delete(d);
    }
  }
  _deps.delete(id);
}

function registerDeps(id, deps) {
  if (!deps || deps.size === 0) {
    _deps.delete(id);
    return;
  }
  _deps.set(id, new Set(deps));
  for (const d of deps) {
    if (!_depsRev.has(d)) _depsRev.set(d, new Set());
    _depsRev.get(d).add(id);
  }
}

/** Build the env object the formula evaluator consumes. We include both
 *  cells and named bindings so a formula can read "=my_width" as well
 *  as "=A1". The env is a plain map for O(1) reads. */
function buildEvalEnv() {
  const env = {
    cell(id) { return _state.cells[id]?.value ?? null; },
    name(n)  {
      const target = _state.bindings[n];
      if (!target) return null;
      return _state.cells[target]?.value ?? null;
    },
  };
  return env;
}

/** Re-evaluate `id` plus every cell transitively downstream in
 *  topological order. Cells that participate in a cycle are flagged
 *  with `#CYCLE!`. */
function reEvalCascade(rootId) {
  // 1. Walk forward to enumerate the affected cells (root + transitive
  //    dependents). We use BFS over _depsRev.
  const affected = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift();
    const rev = _depsRev.get(cur);
    if (!rev) continue;
    for (const next of rev) {
      if (!affected.has(next)) {
        affected.add(next);
        queue.push(next);
      }
    }
  }

  // 2. Compute in-degree restricted to the affected sub-graph so we
  //    can do Kahn's algorithm. Cells with non-zero in-degree at the
  //    end of the loop are exactly the ones inside a cycle.
  const inDeg = new Map();
  for (const id of affected) inDeg.set(id, 0);
  for (const id of affected) {
    const deps = _deps.get(id);
    if (!deps) continue;
    for (const d of deps) {
      if (affected.has(d)) inDeg.set(id, (inDeg.get(id) || 0) + 1);
    }
  }

  const ready = [];
  for (const [id, deg] of inDeg) if (deg === 0) ready.push(id);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    const rev = _depsRev.get(id);
    if (!rev) continue;
    for (const next of rev) {
      if (!affected.has(next)) continue;
      inDeg.set(next, inDeg.get(next) - 1);
      if (inDeg.get(next) === 0) ready.push(next);
    }
  }

  // 3. Re-evaluate in topological order.
  const env = buildEvalEnv();
  for (const id of order) {
    const c = _state.cells[id];
    if (!c) continue;
    if (c.formula && c.formula.startsWith('=')) {
      try {
        const v = evaluateFormula(c.formula.slice(1), env);
        _state.cells[id] = { ...c, value: v, error: null };
      } catch (err) {
        _state.cells[id] = { ...c, value: null, error: String(err?.message || err) };
      }
    }
    // Literal cells (no leading '=') keep their stored value.
  }

  // 4. Anything left with non-zero in-degree is in a cycle — flag it.
  for (const [id, deg] of inDeg) {
    if (deg !== 0) {
      const c = _state.cells[id];
      if (c) _state.cells[id] = { ...c, value: null, error: '#CYCLE!' };
    }
  }
}

// ── write API ────────────────────────────────────────────────────────

/** Write a cell. `raw` is the user-typed string:
 *    "=A1*2"   → formula, parsed + evaluated.
 *    "42"      → literal number.
 *    "hello"   → literal string.
 *    ""        → equivalent to clearCell(id).
 */
export function setCell(id, raw) {
  if (!parseCellId(id)) throw new Error(`setCell: invalid cell id "${id}"`);
  const text = raw == null ? '' : String(raw);

  if (text === '') {
    return clearCell(id);
  }

  // Re-wire dependencies first.
  unregisterDeps(id);

  if (text.startsWith('=')) {
    const formula = text;
    const deps    = new Set(parseFormulaDeps(text.slice(1)));
    registerDeps(id, deps);
    _state.cells = {
      ..._state.cells,
      [id]: { value: null, formula, error: null },
    };
  } else {
    // Literal — try a strict numeric parse first; fall back to string.
    let value;
    const trimmed = text.trim();
    if (trimmed !== '' && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      value = parseFloat(trimmed);
    } else {
      value = text;
    }
    _state.cells = {
      ..._state.cells,
      [id]: { value, formula: null, error: null },
    };
  }

  // Re-evaluate this cell + every transitive downstream cell.
  reEvalCascade(id);
  persist();
  return getCell(id);
}

/** Drop a cell entirely. Downstream cells are re-evaluated and will
 *  surface `null` for the now-empty reference. */
export function clearCell(id) {
  if (!_state.cells[id]) return getCell(id);
  unregisterDeps(id);
  const next = { ..._state.cells };
  delete next[id];
  _state.cells = next;
  // Also remove any binding pointing at this cell.
  for (const [name, target] of Object.entries(_state.bindings)) {
    if (target === id) {
      const nb = { ..._state.bindings };
      delete nb[name];
      _state.bindings = nb;
      _nameByCell.delete(id);
    }
  }
  reEvalCascade(id);
  persist();
  return getCell(id);
}

/** Attach (or detach with `name === ''`) a named binding to a cell.
 *  Names must be valid identifiers; collisions throw. */
export function bindCellName(id, name) {
  if (!parseCellId(id)) throw new Error(`bindCellName: invalid cell id "${id}"`);
  const n = String(name || '').trim();
  // Strip any previous binding for this cell.
  const prev = _nameByCell.get(id);
  const nextBindings = { ..._state.bindings };
  if (prev) {
    delete nextBindings[prev];
    _nameByCell.delete(id);
  }
  if (n === '') {
    _state.bindings = nextBindings;
    persist();
    return null;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
    throw new Error(`bindCellName: "${n}" is not a valid identifier`);
  }
  if (nextBindings[n] && nextBindings[n] !== id) {
    throw new Error(`bindCellName: name "${n}" already bound to ${nextBindings[n]}`);
  }
  nextBindings[n] = id;
  _state.bindings = nextBindings;
  _nameByCell.set(id, n);
  persist();
  return n;
}

// ── subscription / snapshot ──────────────────────────────────────────

export function subscribe(cb) {
  _subs.add(cb);
  return () => _subs.delete(cb);
}

/** React-store snapshot. Returns the SAME object reference until
 *  notify() bumps _version — this is the exact contract that prevented
 *  React #185 in pdmStore.js. The shape covers everything a consumer
 *  could need without forcing them to call N getters. */
export function snapshot() {
  if (_cachedSnap && _cachedSnapVersion === _version) return _cachedSnap;
  _cachedSnap = {
    cells:    listCells(),
    bindings: { ..._state.bindings },
    version:  _version,
  };
  _cachedSnapVersion = _version;
  return _cachedSnap;
}

// ── test / dev helpers ───────────────────────────────────────────────

/** Wipe persisted state. Used by e2e specs that need a clean slate. */
export function _resetForTests() {
  _state = emptyState();
  rebuildIndexes();
  saveLS();
  notify();
}

export const __SCHEMA_VERSION = SCHEMA_VERSION;
export const __LS_KEY = LS_KEY;
