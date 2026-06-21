// Forge-72 — universal Tool Parameter Dialog.
//
// Renders as a left-side dock (260 px) when activeTool has a schema.
// Drives every tool's parameter UI from one component — no bespoke
// dialogs needed per op.
//
// Also renders the Confirmation Corner (✓ / ✗) at viewport top-right
// while the dialog is open. Enter confirms; Esc cancels.
//
// Visual layer: engineering-grade form chrome from the Forge Design
// System (`fds-*` classes in theme/forge-dialogs.css) — a consistent modal
// frame (header / body / footer), an aligned label : control grid,
// compact inputs / steppers / toggles with focus rings and inline
// validation, and a clear primary / secondary button hierarchy. The
// legacy `forge-tool-*` class names are kept verbatim so existing CSS,
// e2e selectors, and the Archie CUA bindings stay intact — only markup
// and styling are refined; no logic / handler / testid changes.

import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { schemaFor } from './toolSchemas.js';
import './theme/forge-dialogs.css';

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

// Inline validation: out-of-range numeric value → message (display only;
// does not block dispatch, mirroring the existing toast-after-commit flow).
function fieldError(field, value) {
  if (field.type === 'number') {
    if (value === '' || value === null || value === undefined || Number.isNaN(value)) {
      return 'Enter a value';
    }
    if (field.min !== undefined && value < field.min) return `Min ${field.min}`;
    if (field.max !== undefined && value > field.max) return `Max ${field.max}`;
  }
  return null;
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
      <aside className="forge-tool-dock fds-tool-dock"
             role="dialog"
             aria-label={schema.title}
             data-testid="forge-tool-dock">
        <header className="forge-tool-dock-header fds-tool-dock-header">
          <span className="fds-tool-dock-title">{schema.title}</span>
          <button type="button"
                  className="fds-tool-dock-close"
                  onClick={onCancel}
                  aria-label="Close">
            <Icon name="select.clear" size={12} />
          </button>
        </header>
        <div className="forge-tool-dock-body fds-tool-dock-body">
          {schema.fields.length === 0 ? (
            <div className="fds-tool-empty">
              No parameters — confirm to apply.
            </div>
          ) : (
            <div className="fds-form-grid">
              {schema.fields.map((f) => (
                <Field key={f.id} field={f}
                       value={values[f.id]}
                       onChange={(v) => update(f.id, v)}
                       selection={selection} />
              ))}
            </div>
          )}
        </div>
        <footer className="forge-tool-dock-footer fds-tool-dock-footer">
          <button type="button"
                  className="forge-tool-dock-btn fds-tool-dock-btn"
                  data-kind="cancel"
                  onClick={onCancel}>
            Cancel
            <kbd className="fds-tool-dock-kbd">Esc</kbd>
          </button>
          <button type="button"
                  className="forge-tool-dock-btn fds-tool-dock-btn"
                  data-kind="confirm"
                  data-testid="forge-tool-confirm"
                  onClick={() => onConfirm?.(activeTool, values)}>
            Confirm
            <kbd className="fds-tool-dock-kbd">⌘↵</kbd>
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
  const error = fieldError(field, value);
  // bool renders as an inline-control row (label sits beside the toggle);
  // everything else uses the aligned label : control two-row stack.
  const isBool = field.type === 'bool';
  return (
    <label className={`forge-tool-field fds-field-block${isBool ? ' fds-field-block--inline' : ''}`}
           data-invalid={error ? 'true' : undefined}>
      <span className="forge-tool-field-label fds-field-label">{field.label}</span>
      <FieldInput field={field} value={value} onChange={onChange}
                  selection={selection} invalid={!!error} />
      {error && <span className="fds-field-error" role="alert">{error}</span>}
    </label>
  );
}

function FieldInput({ field, value, onChange, selection, invalid }) {
  if (field.type === 'number') {
    return (
      <span className="forge-tool-field-row fds-field-row">
        <input type="number" value={value ?? 0}
               min={field.min} max={field.max} step={field.step ?? 0.01}
               onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
               data-field={field.id}
               aria-invalid={invalid || undefined}
               className="forge-tool-input fds-tool-input fds-tool-input--num" />
        {field.unit && <span className="forge-tool-field-unit fds-field-unit">{field.unit}</span>}
      </span>
    );
  }
  if (field.type === 'vec3') {
    const v = Array.isArray(value) ? value : [0,0,0];
    const axes = ['X', 'Y', 'Z'];
    return (
      <span className="forge-tool-field-row fds-field-row fds-vec3">
        {[0,1,2].map((i) => (
          <span key={i} className="fds-vec3-cell">
            <span className="fds-vec3-axis" aria-hidden="true">{axes[i]}</span>
            <input type="number" value={v[i] ?? 0} step={0.1}
                   onChange={(e) => { const n = [...v]; n[i] = parseFloat(e.target.value) || 0; onChange(n); }}
                   data-field={field.id}
                   aria-label={`${field.label} ${axes[i]}`}
                   className="forge-tool-input fds-tool-input fds-tool-input--num" />
          </span>
        ))}
        {field.unit && <span className="forge-tool-field-unit fds-field-unit">{field.unit}</span>}
      </span>
    );
  }
  if (field.type === 'bool') {
    return (
      <span className="fds-toggle" data-on={value ? 'true' : 'false'}>
        <input type="checkbox" checked={!!value}
               onChange={(e) => onChange(e.target.checked)}
               data-field={field.id}
               className="fds-toggle-input" />
        <span className="fds-toggle-track" aria-hidden="true">
          <span className="fds-toggle-thumb" />
        </span>
      </span>
    );
  }
  if (field.type === 'enum') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}
              data-field={field.id}
              aria-invalid={invalid || undefined}
              className="forge-tool-input fds-tool-input fds-tool-select">
        {(field.options || []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'ref') {
    const ref = value;
    const selKind = selection?.kind || 'none';
    const picked = ref && ref.ids?.length;
    return (
      <span className="forge-tool-field-row fds-field-row">
        <button type="button"
                className={`forge-tool-input forge-tool-pick fds-tool-input fds-tool-pick${picked ? ' fds-tool-pick--set' : ''}`}
                data-picked={picked ? 'true' : 'false'}
                onClick={() => onChange({ kind: selKind, ids: selection?.ids || [] })}>
          <Icon name="sketch.point" size={13} />
          <span className="fds-tool-pick-label">
            {picked ? `${ref.kind} (${ref.ids.length})` : 'Pick in viewport'}
          </span>
        </button>
      </span>
    );
  }
  // text
  return (
    <input type="text" value={value || ''}
           onChange={(e) => onChange(e.target.value)}
           aria-invalid={invalid || undefined}
           className="forge-tool-input fds-tool-input" />
  );
}

function ConfirmationCorner({ toolLabel, onConfirm, onCancel }) {
  return (
    <div className="forge-confirmation-corner fds-confirm-corner"
         data-testid="forge-confirmation-corner"
         aria-label={`Confirm ${toolLabel}`}>
      <span className="forge-confirmation-label fds-confirm-label">{toolLabel}</span>
      <button type="button"
              className="forge-confirmation-btn fds-confirm-btn"
              data-kind="confirm"
              onClick={onConfirm}
              aria-label="Confirm">
        <Icon name="sketch.finish" size={14} />
      </button>
      <button type="button"
              className="forge-confirmation-btn fds-confirm-btn"
              data-kind="cancel"
              onClick={onCancel}
              aria-label="Cancel">
        <Icon name="archie.cancel" size={14} />
      </button>
    </div>
  );
}
