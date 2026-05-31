/**
 * ParamValueResolver — UX Tier 10b
 *
 * Centralises the "`=expr` in any numeric param field" resolution path
 * used by both `ToolParamDialog` (floating dialog for legacy tools) and
 * `PropertyManagerDock` (SW-convention dock for migrated tools).
 *
 * The Equation Manager (UX Tier 10) shipped a global parametric variable
 * store (`EquationStore`) + an expression evaluator (`ExpressionEvaluator`).
 * Tier 10b extends the same `=expr` hook the sketch dimension editor has
 * to every numeric input on every tool param schema — Extrude depth,
 * Hole Wizard radius, Circular Pattern count, Fillet radius, etc. So:
 *
 *   user types `=flangeThickness` in the Extrude `height` field
 *      → resolver evaluates `flangeThickness` via EquationStore.get
 *      → returns {value: 8, source: 'expression', expression: '=flangeThickness'}
 *      → the DIALOG keeps showing the source expression with a Σ badge +
 *        a subtle subtitle that mirrors the evaluated number
 *      → on Run/OK the EXPRESSION is preserved on the param record AND
 *        the numeric VALUE flows to the handler as if the user had typed
 *        the plain number (so every existing handler keeps working).
 *
 * The resolver accepts a string OR a number. Numbers pass through as
 * `{value, source: 'literal'}`. Strings starting with `=` are evaluated
 * through `ExpressionEvaluator.evaluateExpression`, with the variable
 * scope coming from `EquationStore.get`. Strings that DON'T start with
 * `=` are parsed as plain `parseFloat` literals (same as the legacy path);
 * empty / NaN values fall back to the schema's `default`.
 *
 * Re-evaluation: the dialog subscribes to `archdisc:equation-store:changed`
 * and re-invokes the resolver for every field whose current source is
 * an expression — so editing `flangeThickness=12` in the Equation
 * Manager while the Extrude dock is open instantly reflows the displayed
 * depth value. The handler is NOT re-fired automatically; the user must
 * re-confirm.
 *
 * Output shape:
 *
 *   {
 *     value:      Number,                  // evaluated finite number, or schema default on error
 *     source:     'literal' | 'expression',
 *     expression?: String,                 // the raw `=...` source when source === 'expression'
 *     error?:      String,                 // diagnostic message on eval failure
 *   }
 *
 * The dialog uses `source === 'expression'` to decide whether to render
 * the Σ badge + subtitle; the executor reads `expression` from a sidecar
 * `__expressions` slot the dialog adds to the values dict so the
 * design-history record can persist the parametric source.
 */

import { evaluateExpression } from './ExpressionEvaluator.js';

/**
 * Resolve a raw user input into a numeric value + provenance.
 *
 * @param {string|number|null|undefined} rawValue   raw field input
 * @param {{ type?: string, default?: number }} schemaField  schema row
 * @param {{ get: (name: string) => number | undefined } | null} equationStore
 *        store instance (typically `equationStore()` singleton). May be
 *        null/undefined — in which case every variable resolves to
 *        undefined and any non-literal expression errors out.
 * @returns {{ value: number, source: 'literal' | 'expression',
 *             expression?: string, error?: string }}
 */
export function resolveParamValue(rawValue, schemaField, equationStore) {
  const fallback = (schemaField && Number.isFinite(schemaField.default))
    ? schemaField.default
    : 0;

  // Numbers pass through untouched (already a literal).
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue)
      ? { value: rawValue, source: 'literal' }
      : { value: fallback, source: 'literal', error: 'non-finite number' };
  }

  // null / undefined → schema default.
  if (rawValue === null || rawValue === undefined) {
    return { value: fallback, source: 'literal' };
  }

  // Anything that's not a string at this point → coerce via Number.
  if (typeof rawValue !== 'string') {
    const n = Number(rawValue);
    return Number.isFinite(n)
      ? { value: n, source: 'literal' }
      : { value: fallback, source: 'literal', error: 'unparseable input' };
  }

  const trimmed = rawValue.trim();
  if (!trimmed) return { value: fallback, source: 'literal' };

  // Expression path — anything starting with `=`. Strip the leading `=`
  // and evaluate through the shared expression evaluator. Variable
  // resolution comes from the equation store; a missing store still
  // lets pure-numeric `=2*3` expressions evaluate (resolveVar returns
  // undefined → ExpressionEvaluator throws on identifier references).
  if (trimmed.startsWith('=')) {
    const body = trimmed.slice(1).trim();
    if (!body) {
      return { value: fallback, source: 'expression', expression: trimmed, error: 'empty expression' };
    }
    const resolveVar = (name) => {
      if (!equationStore) return undefined;
      try {
        const v = equationStore.get(name);
        return Number.isFinite(v) ? v : undefined;
      } catch (_) {
        return undefined;
      }
    };
    try {
      const v = evaluateExpression(body, resolveVar);
      if (!Number.isFinite(v)) {
        return {
          value: fallback,
          source: 'expression',
          expression: trimmed,
          error: `non-finite result (${v})`,
        };
      }
      return {
        value: v,
        source: 'expression',
        expression: trimmed,
      };
    } catch (err) {
      return {
        value: fallback,
        source: 'expression',
        expression: trimmed,
        error: err && err.message ? err.message : String(err),
      };
    }
  }

  // Plain literal — parseFloat (matches the legacy code path so a stray
  // unit suffix like "12mm" still parses to 12).
  const n = parseFloat(trimmed);
  if (Number.isFinite(n)) {
    return { value: n, source: 'literal' };
  }
  return { value: fallback, source: 'literal', error: `unparseable "${rawValue}"` };
}

/**
 * Format the resolved value for the "= 120" subtitle the dialog shows
 * under an expression-driven field. Picks a sensible precision based on
 * magnitude so e.g. `=count` showing as integer "= 6" reads cleanly
 * while `=width*0.04` showing "= 2.4" doesn't lose precision.
 */
export function formatResolvedValue(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (Number.isInteger(value)) return String(value);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(3).replace(/\.?0+$/, '');
  return value.toPrecision(3).replace(/\.?0+(e|$)/, '$1');
}
