import { useEffect, useState } from 'react';
import { onParamRequest, resolveOpen } from '../foundation/ToolParamDialog.js';
import { DOCKED_TOOLS } from './SwUxOverlays';

/**
 * Generic modal that renders fields from a ToolParamSchema and
 * resolves the handler's `requestToolParams` promise on Run/Cancel.
 * Mounted once at the app root — listens for open events.
 *
 * Tier-1 PropertyManagerDock takes precedence for tools in
 * `DOCKED_TOOLS`; this floating dialog only handles the rest.
 */
export default function ToolParamDialog() {
  const [state, setState] = useState({ open: false, schema: null, toolName: null, values: {} });

  useEffect(() => {
    const unsub = onParamRequest(({ toolName, schema }) => {
      // Migrated tools render via PropertyManagerDock — don't double up.
      if (DOCKED_TOOLS.has(toolName)) return;
      const initial = {};
      for (const f of schema.fields) initial[f.name] = f.default;
      setState({ open: true, schema, toolName, values: initial });
    });
    return unsub;
  }, []);

  const handleChange = (name, raw) => {
    setState((s) => {
      const field = s.schema.fields.find(f => f.name === name);
      let value = raw;
      if (field?.type === 'number') {
        const n = parseFloat(raw);
        value = Number.isFinite(n) ? n : field.default;
      }
      return { ...s, values: { ...s.values, [name]: value } };
    });
  };

  const handleRun = () => {
    const v = state.values;
    setState({ open: false, schema: null, toolName: null, values: {} });
    resolveOpen(v);
  };
  const handleCancel = () => {
    setState({ open: false, schema: null, toolName: null, values: {} });
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
          {state.schema.fields.map((f) => (
            <div key={f.name} className="tpd-row">
              <label className="tpd-label">
                {f.label}
                {f.hint && <span className="tpd-hint">{f.hint}</span>}
              </label>
              <div className="tpd-input-wrap">
                <input
                  className="tpd-input"
                  type="number"
                  step={f.step ?? 'any'}
                  min={f.min}
                  max={f.max}
                  value={state.values[f.name]}
                  onChange={(e) => handleChange(f.name, e.target.value)}
                  data-field={f.name}
                />
                {f.unit && <span className="tpd-unit">{f.unit}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="tpd-footer">
          <button className="tpd-btn-cancel" onClick={handleCancel}>Cancel</button>
          <button className="tpd-btn-run" onClick={handleRun}>Run</button>
        </div>
      </div>
    </div>
  );
}
