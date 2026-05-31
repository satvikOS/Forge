// Forge-72 — universal Tool Parameter Dialog.
//
// Renders as a left-side dock (260 px) when activeTool has a schema.
// Drives every tool's parameter UI from one component — no bespoke
// dialogs needed per op.
//
// Also renders the Confirmation Corner (✓ / ✗) at viewport top-right
// while the dialog is open. Enter confirms; Esc cancels.

import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { schemaFor } from './toolSchemas.js';

function defaultsFor(schema) {
  const v = {};
  for (const f of schema.fields) {
    if (f.default !== undefined) v[f.id] = f.default;
    else if (f.type === 'vec3') v[f.id] = [0, 0, 0];
    else if (f.type === 'bool') v[f.id] = false;
    else if (f.type === 'number') v[f.id] = 0;
    else v[f.id] = null;
  }
  return v;
}

export function ToolParamDialog({ activeTool, onConfirm, onCancel, selection }) {
  const schema = activeTool ? schemaFor(activeTool) : null;
  const [values, setValues] = useState({});
  useEffect(() => {
    if (schema) setValues(defaultsFor(schema));
  }, [activeTool]);

  const update = useCallback((id, v) => {
    setValues((s) => ({ ...s, [id]: v }));
  }, []);

  // Esc cancel, Enter confirm (only when focus isn't inside an input that's
  // currently being typed in).
  useEffect(() => {
    if (!schema) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { onCancel?.(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { onConfirm?.(activeTool, values); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [schema, activeTool, values, onConfirm, onCancel]);

  if (!schema) return null;
  return (
    <>
      <aside className="forge-tool-dock"
             role="dialog"
             aria-label={schema.title}
             data-testid="forge-tool-dock">
        <header className="forge-tool-dock-header">
          <span>{schema.title}</span>
          <button type="button"
                  onClick={onCancel}
                  aria-label="Close"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute)', cursor: 'pointer',
                    display: 'inline-flex', padding: 2,
                  }}>
            <Icon name="select.clear" size={12} />
          </button>
        </header>
        <div className="forge-tool-dock-body">
          {schema.fields.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--forge-ink-2)' }}>
              No parameters — confirm to apply.
            </div>
          ) : (
            schema.fields.map((f) => (
              <Field key={f.id} field={f}
                     value={values[f.id]}
                     onChange={(v) => update(f.id, v)}
                     selection={selection} />
            ))
          )}
        </div>
        <footer className="forge-tool-dock-footer">
          <button type="button"
                  className="forge-tool-dock-btn"
                  data-kind="cancel"
                  onClick={onCancel}>
            Cancel
            <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                           marginLeft: 6, color: 'var(--forge-ink-mute)' }}>Esc</span>
          </button>
          <button type="button"
                  className="forge-tool-dock-btn"
                  data-kind="confirm"
                  data-testid="forge-tool-confirm"
                  onClick={() => onConfirm?.(activeTool, values)}>
            Confirm
            <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                           marginLeft: 6, color: 'var(--forge-ink-mute)' }}>⌘↵</span>
          </button>
        </footer>
      </aside>
      <ConfirmationCorner toolLabel={schema.title}
                          onConfirm={() => onConfirm?.(activeTool, values)}
                          onCancel={onCancel} />
    </>
  );
}

function Field({ field, value, onChange, selection }) {
  return (
    <label className="forge-tool-field">
      <span className="forge-tool-field-label">{field.label}</span>
      <FieldInput field={field} value={value} onChange={onChange} selection={selection} />
    </label>
  );
}

function FieldInput({ field, value, onChange, selection }) {
  if (field.type === 'number') {
    return (
      <span className="forge-tool-field-row">
        <input type="number" value={value ?? 0}
               min={field.min} max={field.max} step={field.step ?? 0.01}
               onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
               className="forge-tool-input" />
        {field.unit && <span className="forge-tool-field-unit">{field.unit}</span>}
      </span>
    );
  }
  if (field.type === 'vec3') {
    const v = Array.isArray(value) ? value : [0,0,0];
    return (
      <span className="forge-tool-field-row" style={{ display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {[0,1,2].map((i) => (
          <input key={i} type="number" value={v[i] ?? 0} step={0.1}
                 onChange={(e) => { const n = [...v]; n[i] = parseFloat(e.target.value) || 0; onChange(n); }}
                 className="forge-tool-input" />
        ))}
      </span>
    );
  }
  if (field.type === 'bool') {
    return (
      <input type="checkbox" checked={!!value}
             onChange={(e) => onChange(e.target.checked)} />
    );
  }
  if (field.type === 'enum') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
              className="forge-tool-input">
        {(field.options || []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'ref') {
    const ref = value;
    const selKind = selection?.kind || 'none';
    return (
      <span className="forge-tool-field-row">
        <button type="button" className="forge-tool-input forge-tool-pick"
                onClick={() => onChange({ kind: selKind, ids: selection?.ids || [] })}>
          {ref && ref.ids?.length
            ? `${ref.kind} (${ref.ids.length})`
            : 'Pick in viewport'}
        </button>
      </span>
    );
  }
  // text
  return (
    <input type="text" value={value || ''}
           onChange={(e) => onChange(e.target.value)}
           className="forge-tool-input" />
  );
}

function ConfirmationCorner({ toolLabel, onConfirm, onCancel }) {
  return (
    <div className="forge-confirmation-corner"
         data-testid="forge-confirmation-corner"
         aria-label={`Confirm ${toolLabel}`}>
      <span className="forge-confirmation-label">{toolLabel}</span>
      <button type="button"
              className="forge-confirmation-btn"
              data-kind="confirm"
              onClick={onConfirm}
              aria-label="Confirm">
        <Icon name="sketch.finish" size={14} />
      </button>
      <button type="button"
              className="forge-confirmation-btn"
              data-kind="cancel"
              onClick={onCancel}
              aria-label="Cancel">
        <Icon name="archie.cancel" size={14} />
      </button>
    </div>
  );
}
