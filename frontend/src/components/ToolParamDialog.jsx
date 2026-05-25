import { useEffect, useState } from 'react';
import { onParamRequest, resolveOpen } from '../foundation/ToolParamDialog.js';
import { DOCKED_TOOLS } from './SwUxOverlays';
import { equationStore } from '../foundation/EquationStore.js';
import { resolveParamValue, formatResolvedValue } from '../foundation/ParamValueResolver.js';

/**
 * Generic modal that renders fields from a ToolParamSchema and
 * resolves the handler's `requestToolParams` promise on Run/Cancel.
 * Mounted once at the app root — listens for open events.
 *
 * Tier-1 PropertyManagerDock takes precedence for tools in
 * `DOCKED_TOOLS`; this floating dialog only handles the rest.
 *
 * UX Tier 10b: every numeric field now accepts `=expr` strings — the
 * input is rendered as `text` whenever the user has typed an expression
 * so the literal `=`/`*`/identifier characters survive React's number
 * normalisation; a Σ badge + a subtle "= 12.4" subtitle confirms the
 * evaluated value. Re-evaluation on `archdisc:equation-store:changed`
 * keeps every expression-driven field live while the dialog is open.
 */
export default function ToolParamDialog() {
  const [state, setState] = useState({
    open: false, schema: null, toolName: null,
    /** raw user input per field (string for expressions, number otherwise) */
    rawInputs: {},
    /** resolved {value, source, expression?, error?} per field */
    resolved: {},
  });

  useEffect(() => {
    const unsub = onParamRequest(({ toolName, schema }) => {
      if (DOCKED_TOOLS.has(toolName)) return;
      const rawInputs = {};
      const resolved = {};
      const store = equationStore();
      for (const f of schema.fields) {
        rawInputs[f.name] = f.default;
        if (f.type === 'number') {
          resolved[f.name] = resolveParamValue(f.default, f, store);
        }
      }
      setState({ open: true, schema, toolName, rawInputs, resolved });
    });
    return unsub;
  }, []);

  // Re-evaluate every expression-driven field when the equation store
  // changes. Does NOT re-fire the tool — the user still has to hit Run.
  useEffect(() => {
    if (!state.open) return undefined;
    const handler = () => {
      setState((s) => {
        if (!s.open || !s.schema) return s;
        const store = equationStore();
        const nextResolved = { ...s.resolved };
        let changed = false;
        for (const f of s.schema.fields) {
          if (f.type !== 'number') continue;
          const raw = s.rawInputs[f.name];
          if (typeof raw === 'string' && raw.trim().startsWith('=')) {
            nextResolved[f.name] = resolveParamValue(raw, f, store);
            changed = true;
          }
        }
        return changed ? { ...s, resolved: nextResolved } : s;
      });
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('archdisc:equation-store:changed', handler);
      return () => window.removeEventListener('archdisc:equation-store:changed', handler);
    }
    return undefined;
  }, [state.open]);

  const handleChange = (name, raw) => {
    setState((s) => {
      const field = s.schema.fields.find(f => f.name === name);
      const nextRaw = { ...s.rawInputs, [name]: raw };
      const nextResolved = { ...s.resolved };
      if (field?.type === 'number') {
        nextResolved[name] = resolveParamValue(raw, field, equationStore());
      }
      return { ...s, rawInputs: nextRaw, resolved: nextResolved };
    });
  };

  const handleRun = () => {
    // Build the values payload — handlers consume `values.fieldName` as
    // a NUMBER for numeric fields. The sidecar `__expressions` slot
    // carries the source `=...` string for any expression-driven field
    // so design-history / param-record persistence can round-trip it.
    const values = {};
    const expressions = {};
    for (const f of state.schema.fields) {
      if (f.type === 'number') {
        const r = state.resolved[f.name];
        values[f.name] = r ? r.value : (f.default ?? 0);
        if (r && r.source === 'expression' && r.expression) {
          expressions[f.name] = r.expression;
        }
      } else {
        values[f.name] = state.rawInputs[f.name];
      }
    }
    if (Object.keys(expressions).length > 0) {
      values.__expressions = expressions;
    }
    setState({ open: false, schema: null, toolName: null, rawInputs: {}, resolved: {} });
    resolveOpen(values);
  };
  const handleCancel = () => {
    setState({ open: false, schema: null, toolName: null, rawInputs: {}, resolved: {} });
    resolveOpen(null);
  };

  if (!state.open || !state.schema) return null;
  return (
    <div className="tpd-backdrop" onClick={handleCancel}>
      <div className="tpd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="tpd-header">
          <span className="tpd-title">{state.schema.title}</span>
          <button className="tpd-close" onClick={handleCancel} title="Cancel">×</button>
        </div>
        {state.schema.blurb && <div className="tpd-blurb">{state.schema.blurb}</div>}
        <div className="tpd-fields">
          {state.schema.fields.map((f) => {
            const raw = state.rawInputs[f.name];
            const isExpr = f.type === 'number'
              && typeof raw === 'string' && raw.trim().startsWith('=');
            const resolved = state.resolved[f.name];
            return (
              <div key={f.name} className="tpd-row"
                   style={isExpr ? { alignItems: 'flex-start' } : undefined}>
                <label className="tpd-label">
                  {f.label}
                  {f.hint && <span className="tpd-hint">{f.hint}</span>}
                </label>
                <div className="tpd-input-wrap"
                     style={isExpr ? { flexDirection: 'column', alignItems: 'stretch', gap: 2 } : undefined}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  {f.type === 'enum' && Array.isArray(f.options) ? (
                    <select
                      className="tpd-input"
                      value={raw}
                      onChange={(e) => handleChange(f.name, e.target.value)}
                      data-field={f.name}
                    >
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : f.type === 'number' ? (
                    // UX Tier 10b: numeric fields use type=text so the user
                    // can freely type `=expr` parametric strings. Numeric
                    // literals still parse via parseFloat in the resolver.
                    <input
                      className="tpd-input"
                      type="text"
                      inputMode="decimal"
                      value={raw ?? ''}
                      onChange={(e) => handleChange(f.name, e.target.value)}
                      data-field={f.name}
                      data-expr={isExpr ? 'true' : 'false'}
                      style={isExpr ? { fontStyle: 'italic', color: '#bcd0ee' } : undefined}
                    />
                  ) : (
                    <input
                      className="tpd-input"
                      type="text"
                      value={raw ?? ''}
                      onChange={(e) => handleChange(f.name, e.target.value)}
                      data-field={f.name}
                    />
                  )}
                  {isExpr && (
                    <span
                      title="Parametric expression"
                      data-archdisc-expr-badge={f.name}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, marginLeft: 2, borderRadius: 3,
                        background: '#3a5a8c', color: '#cfe2ff', fontSize: 11,
                        fontFamily: 'Consolas, monospace', fontWeight: 700, lineHeight: 1,
                      }}>Σ</span>
                  )}
                  {f.unit && <span className="tpd-unit">{f.unit}</span>}
                  </div>{/* close inner input-row */}
                  {isExpr && (
                    <div
                      data-archdisc-expr-eval={f.name}
                      style={{
                        marginTop: 0, paddingLeft: 2,
                        fontSize: 11, fontFamily: 'Consolas, monospace',
                        color: resolved && resolved.error ? '#e08a8a' : '#8aa9d8',
                      }}>
                      {resolved && !resolved.error
                        ? `= ${formatResolvedValue(resolved.value)}${f.unit ? ' ' + f.unit : ''}`
                        : (resolved && resolved.error ? `⚠ ${resolved.error}` : '—')}
                    </div>
                  )}
                </div>{/* close tpd-input-wrap */}
              </div>
            );
          })}
        </div>
        <div className="tpd-footer">
          <button className="tpd-btn-cancel" onClick={handleCancel}>Cancel</button>
          <button className="tpd-btn-run" onClick={handleRun}>Run</button>
        </div>
      </div>
    </div>
  );
}
