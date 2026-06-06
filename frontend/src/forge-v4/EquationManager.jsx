// Forge-74 — Equation Manager.
//
// Parametric variable + equation editor (industry-standard MCAD
// feature — SolidWorks Equations, Fusion Parameters, NX Expressions).
// User defines named variables like W = 25 mm, then references them
// from any tool parameter as "=W" or "=W*2". Equation rows can
// reference earlier variables.
//
// Cmd+E or Tools menu → opens. Persists to forge.v4.equations.

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Icon } from './icons/Icon.jsx';
import { subscribe as subscribeSheet,
         snapshot as snapshotSheet } from './spreadsheetStore.js';

const STORAGE_KEY = 'forge.v4.equations';

const DEFAULT_VARS = [
  { id: 'W',         expr: '25',          unit: 'mm', kind: 'global' },
  { id: 'L',         expr: '50',          unit: 'mm', kind: 'global' },
  { id: 'T',         expr: '3',           unit: 'mm', kind: 'global' },
  { id: 'H',         expr: '20',          unit: 'mm', kind: 'global' },
  { id: 'BOLT_DIA',  expr: '6',           unit: 'mm', kind: 'global' },
  { id: 'BOLT_HOLE', expr: 'BOLT_DIA+0.4',unit: 'mm', kind: 'global' },
  { id: 'CORNER_R',  expr: 'T*2',         unit: 'mm', kind: 'global' },
];

function loadVars() {
  if (typeof localStorage === 'undefined') return DEFAULT_VARS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VARS;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? arr : DEFAULT_VARS;
  } catch { return DEFAULT_VARS; }
}
function saveVars(vars) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vars)); } catch {}
}

// Tiny expression evaluator — supports numbers, +-*/(), variable refs,
// dotted Math.* function calls (Math.sin, Math.PI, Math.pow, etc.).
// Deliberately not eval(): walks an explicit recursive-descent parser
// so it can't escape into JS land.
//
// PUSH-66 — extended tokenizer to recognise '.' and ',' so dotted
// identifiers like Math.sin and function calls Math.pow(2, 3) parse.
// The atom production now resolves `Math.<name>` against a whitelist
// of pure-math constants & unary/binary functions.
const MATH_WHITELIST = {
  PI: Math.PI, E: Math.E, LN2: Math.LN2, LN10: Math.LN10,
  LOG2E: Math.LOG2E, LOG10E: Math.LOG10E, SQRT2: Math.SQRT2,
  abs: Math.abs, sign: Math.sign, sqrt: Math.sqrt, cbrt: Math.cbrt,
  exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  ceil: Math.ceil, floor: Math.floor, round: Math.round, trunc: Math.trunc,
  // Variadic-arity functions get clamped to their natural arity below.
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot, atan2: Math.atan2,
};
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      // A leading '.' that isn't followed by a digit is a member-access
      // separator, not a number — emit it as its own token.
      if (c === '.' && !/[0-9]/.test(s[i + 1] || '')) {
        out.push({ k: '.' }); i++; continue;
      }
      let j = i;
      let sawDot = false;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      if (s[j] === '.' && /[0-9]/.test(s[j + 1] || '')) {
        sawDot = true; j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      out.push({ k: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      out.push({ k: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    if ('+-*/(),.'.includes(c)) { out.push({ k: c }); i++; continue; }
    throw new Error('unexpected char: ' + c);
  }
  return out;
}
function evalExpr(s, env) {
  const toks = tokenize(s);
  let p = 0;
  function peek() { return toks[p]; }
  function eat(k) { const t = toks[p++]; if (k && t?.k !== k) throw new Error(`expected ${k}`); return t; }
  function expr()   { let v = term(); while (peek()?.k === '+' || peek()?.k === '-') { const op = eat().k; const r = term(); v = op === '+' ? v + r : v - r; } return v; }
  function term()   { let v = unary(); while (peek()?.k === '*' || peek()?.k === '/') { const op = eat().k; const r = unary(); v = op === '*' ? v * r : v / r; } return v; }
  function unary()  { if (peek()?.k === '-') { eat(); return -unary(); } if (peek()?.k === '+') { eat(); return unary(); } return atom(); }
  function callArgs() {
    eat('(');
    const args = [];
    if (peek()?.k !== ')') {
      args.push(expr());
      while (peek()?.k === ',') { eat(','); args.push(expr()); }
    }
    eat(')');
    return args;
  }
  function atom() {
    const t = peek();
    if (t?.k === 'num') { eat('num'); return t.v; }
    if (t?.k === 'id')  {
      eat('id');
      // Dotted reference: only `Math.<name>` is allowed. Anything else
      // is an explicit error so users get a real message rather than
      // silent NaN propagation.
      if (peek()?.k === '.') {
        if (t.v !== 'Math') throw new Error('only Math.* is allowed: ' + t.v);
        eat('.');
        const fn = eat('id').v;
        const m = MATH_WHITELIST[fn];
        if (m === undefined) throw new Error('Math.' + fn + ' not allowed');
        // Function call vs constant — depends on the next token.
        if (peek()?.k === '(') {
          if (typeof m !== 'function') throw new Error('Math.' + fn + ' is not a function');
          const args = callArgs();
          return m(...args);
        }
        if (typeof m === 'function') throw new Error('Math.' + fn + ' needs ()');
        return m;
      }
      if (env[t.v] === undefined) throw new Error('undefined: ' + t.v);
      return env[t.v];
    }
    if (t?.k === '(')   { eat('('); const v = expr(); eat(')'); return v; }
    throw new Error('unexpected');
  }
  const v = expr();
  if (p !== toks.length) throw new Error('extra tokens');
  return v;
}

/** Resolve every variable in `vars` against a shared env so vars can
 *  reference each other. Returns { values, errors } — both keyed by var id.
 *
 *  Forge-153 — `extraEnv` is mixed into the variable lookup BEFORE the
 *  equation rows run. We use this to surface SpreadsheetWorkbench cell
 *  bindings as solvable parameters: any cell tagged with a name in the
 *  Spreadsheet becomes readable as that name from an equation row. */
export function solveEquations(vars, extraEnv = null) {
  const env = {};
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === 'number' && Number.isFinite(v)) env[k] = v;
    }
  }
  const errors = {};
  // Naive O(N²) — each pass resolves whatever's solvable.
  let changed = true;
  let safety = vars.length * 2 + 4;
  while (changed && safety-- > 0) {
    changed = false;
    for (const v of vars) {
      if (env[v.id] !== undefined) continue;
      try {
        env[v.id] = evalExpr(v.expr, env);
        changed = true;
      } catch (e) { errors[v.id] = e.message; }
    }
  }
  // Anything still missing is an error.
  for (const v of vars) if (env[v.id] === undefined && !errors[v.id]) errors[v.id] = 'unresolved';
  return { values: env, errors };
}

// Subscribe to the spreadsheet store with a cached snapshot so cell
// bindings flow into the equation env without triggering React #185
// (the snapshot function caches by a version counter — see
// spreadsheetStore.js for the contract). We only need the bindings
// portion; we derive it via useMemo to keep the env object stable.
function useSheetEnv() {
  const get = useCallback(() => snapshotSheet(), []);
  const sheet = useSyncExternalStore(subscribeSheet, get, get);
  // Build { name: number } from { name: cellId } — skip bindings whose
  // underlying cell is empty or non-numeric so the EquationManager only
  // sees clean parameters. Memoize on the snapshot version so the env
  // object reference is stable across renders.
  return useMemo(() => {
    const env = {};
    for (const [name, cellRef] of Object.entries(sheet.bindings || {})) {
      // bindings map is { name: cellId } in spreadsheetStore.
      const id = typeof cellRef === 'string' ? cellRef : cellRef?.cellId;
      const v = id ? (sheet.cells?.[id]?.value ?? null) : null;
      if (typeof v === 'number' && Number.isFinite(v)) env[name] = v;
    }
    return env;
  }, [sheet]);
}

export function EquationManager({ open, onClose }) {
  const [vars, setVars] = useState(() => loadVars());
  const sheetEnv = useSheetEnv();
  const { values, errors } = solveEquations(vars, sheetEnv);

  useEffect(() => { saveVars(vars); }, [vars]);

  // PUSH-66 — expose the resolved variable env as `window.__forgeEquations`
  // (a live Map) and fire `forge:equations-changed` whenever the env shifts.
  // Other panels (workbenches, the spreadsheet store, mate solver, etc.)
  // listen to this event to re-derive feature parameters from variables.
  // The Map is single-instance — we mutate it rather than replace it so
  // downstream consumers that captured a reference at mount time keep
  // seeing fresh values.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!(window.__forgeEquations instanceof Map)) {
      window.__forgeEquations = new Map();
    }
    const m = window.__forgeEquations;
    const next = new Set();
    for (const v of vars) {
      const val = values[v.id];
      if (typeof val === 'number' && Number.isFinite(val)) {
        m.set(v.id, val);
        next.add(v.id);
      }
    }
    // Drop entries that are no longer defined so stale variable names
    // can't ghost-drive features after they're deleted.
    for (const key of Array.from(m.keys())) {
      if (!next.has(key)) m.delete(key);
    }
    // The event detail carries a plain { [name]: number } snapshot so
    // listeners don't have to clone the Map themselves.
    const snapshot = {};
    for (const [k, v] of m.entries()) snapshot[k] = v;
    try {
      window.dispatchEvent(new CustomEvent('forge:equations-changed', {
        detail: { values: snapshot, errors: { ...errors } },
      }));
    } catch {}
  }, [vars, values, errors]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const addVar = useCallback(() => {
    setVars((arr) => [...arr, { id: `var${arr.length + 1}`, expr: '0', unit: 'mm', kind: 'global' }]);
  }, []);
  const removeVar = useCallback((i) => {
    setVars((arr) => arr.filter((_, j) => j !== i));
  }, []);
  const updateVar = useCallback((i, patch) => {
    setVars((arr) => arr.map((v, j) => j === i ? { ...v, ...patch } : v));
  }, []);

  if (!open) return null;
  return (
    <div role="dialog"
         aria-label="Equation Manager"
         data-testid="forge-equations"
         onClick={onClose}
         style={{
           position: 'fixed', inset: 0,
           background: 'var(--forge-overlay)',
           display: 'flex', alignItems: 'center', justifyContent: 'center',
           zIndex: 2200,
         }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{
             width: 720, maxWidth: '92vw', maxHeight: '82vh',
             background: 'var(--forge-canvas-3)',
             border: '1px solid var(--forge-rail-edge)',
             borderRadius: 'var(--forge-radius-lg)',
             boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
             display: 'flex', flexDirection: 'column',
           }}>
        <header style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--forge-rail-edge)',
          background: 'var(--forge-canvas)',
          borderRadius: 'var(--forge-radius-lg) var(--forge-radius-lg) 0 0',
        }}>
          <Icon name="archie.formula" size={14} />
          <h2 style={{ margin: 0, fontSize: 13 }}>Equation Manager</h2>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} aria-label="Close"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute)', cursor: 'pointer',
                    display: 'inline-flex', padding: 2,
                  }}>
            <Icon name="select.clear" size={12} />
          </button>
        </header>
        <div style={{ overflowY: 'auto', padding: '8px 16px', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse',
                          fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--forge-ink-mute)' }}>
                <th style={{ padding: '4px 6px', fontWeight: 500, fontSize: 10,
                             textTransform: 'uppercase', letterSpacing: '0.06em' }}>Name</th>
                <th style={{ padding: '4px 6px', fontWeight: 500, fontSize: 10,
                             textTransform: 'uppercase', letterSpacing: '0.06em' }}>Expression</th>
                <th style={{ padding: '4px 6px', fontWeight: 500, fontSize: 10,
                             textTransform: 'uppercase', letterSpacing: '0.06em' }}>Unit</th>
                <th style={{ padding: '4px 6px', fontWeight: 500, fontSize: 10,
                             textTransform: 'uppercase', letterSpacing: '0.06em' }}>Evaluates to</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v, i) => {
                const err = errors[v.id];
                const value = values[v.id];
                return (
                  <tr key={i}
                      data-testid={`forge-eq-row-${v.id}`}
                      data-eq-row-index={i}
                      style={{ borderTop: '1px solid var(--forge-rail-edge)' }}>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="text" value={v.id}
                             data-testid={`forge-eq-name-${v.id}`}
                             onChange={(e) => updateVar(i, { id: e.target.value })}
                             className="forge-tool-input"
                             style={{ width: '100%', fontFamily: 'var(--forge-mono)' }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="text" value={v.expr}
                             data-testid={`forge-eq-expr-${v.id}`}
                             onChange={(e) => updateVar(i, { expr: e.target.value })}
                             className="forge-tool-input"
                             style={{ width: '100%', fontFamily: 'var(--forge-mono)' }} />
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <input type="text" value={v.unit}
                             data-testid={`forge-eq-unit-${v.id}`}
                             onChange={(e) => updateVar(i, { unit: e.target.value })}
                             className="forge-tool-input"
                             style={{ width: 60, fontFamily: 'var(--forge-mono)' }} />
                    </td>
                    <td data-testid={`forge-eq-value-${v.id}`}
                        data-eq-value={err ? '' : String(value)}
                        style={{ padding: '4px 6px',
                                 fontFamily: 'var(--forge-mono)',
                                 color: err ? 'var(--forge-err)' : 'var(--forge-ok)' }}>
                      {err ? `⚠ ${err}` : `${(Math.round(value * 1000) / 1000)} ${v.unit}`}
                    </td>
                    <td style={{ padding: '4px 6px' }}>
                      <button type="button" onClick={() => removeVar(i)}
                              aria-label="Remove"
                              data-testid={`forge-eq-remove-${v.id}`}
                              style={{
                                background: 'transparent', border: 'none',
                                color: 'var(--forge-ink-mute)', cursor: 'pointer',
                                display: 'inline-flex', padding: 2,
                              }}>
                        <Icon name="edit.delete" size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer style={{
          display: 'flex', gap: 8, padding: '10px 16px',
          borderTop: '1px solid var(--forge-rail-edge)',
          background: 'var(--forge-canvas)',
          borderRadius: '0 0 var(--forge-radius-lg) var(--forge-radius-lg)',
        }}>
          <button type="button" onClick={addVar}
                  data-testid="forge-eq-add"
                  className="forge-tool-dock-btn">+ Add variable</button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose}
                  data-testid="forge-eq-done"
                  className="forge-tool-dock-btn"
                  data-kind="confirm">Done</button>
        </footer>
      </div>
    </div>
  );
}
