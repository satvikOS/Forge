import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * PropertyPanel — drives the docked editor off PropertyManager.currentForm().
 *
 * Each field's `type` selects the control:
 *   'number'   — single numeric input + unit label
 *   'boolean'  — checkbox
 *   'vector3'  — three small numeric inputs
 *   'enum'     — <select> seeded from `field.options`
 *   'color'    — color input
 *   'string'   — text input
 *   'shape-ref'— read-only id badge (cannot be hand-edited yet)
 *
 * On blur / change the new value is fed through `pm.commit({ key: v })`
 * which runs the field's validator. Errors propagate inline.
 *
 * Subscribes to `pm.onChange` so external selection swaps (e.g. picking
 * a different feature in the viewport) rerender the form.
 */
export default function PropertyPanel({ propertyManager }) {
  const [form, setForm] = useState(() => propertyManager?.currentForm() || null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!propertyManager) return undefined;
    const refresh = () => { setForm(propertyManager.currentForm()); setErrors({}); };
    refresh();
    return propertyManager.onChange(refresh);
  }, [propertyManager]);

  if (!propertyManager) {
    return (
      <div className="forge-panel">
        <div className="forge-panel-header">Properties</div>
        <div className="forge-panel-body" style={{ color: 'var(--muted)' }}>
          Property manager unavailable.
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="forge-panel">
        <div className="forge-panel-header">Properties</div>
        <div className="forge-panel-body" style={{ color: 'var(--muted)' }}>
          Nothing selected. Pick a feature to edit its properties.
        </div>
      </div>
    );
  }

  function commit(key, value) {
    try {
      propertyManager.commit({ [key]: value });
      setErrors((e) => { const { [key]: _drop, ...rest } = e; return rest; });
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: String(err.message || err).replace(/^\[[^\]]+\]\s*/, '') }));
    }
  }

  return (
    <div className="forge-panel">
      <div className="forge-panel-header">
        Properties
        <div className="spacer" />
        <span style={{ color: 'var(--muted)', textTransform: 'none', fontSize: 11 }}>
          {form.schema.title}
        </span>
      </div>
      <div className="forge-panel-body">
        {form.schema.fields.map((f) => (
          <PropertyField
            key={f.key}
            field={f}
            value={form.values[f.key]}
            error={errors[f.key]}
            onCommit={(v) => commit(f.key, v)}
          />
        ))}
      </div>
    </div>
  );
}

PropertyPanel.propTypes = {
  propertyManager: PropTypes.object,
};

function PropertyField({ field, value, error, onCommit }) {
  return (
    <div className="forge-prop-field">
      <span className="label" title={field.key}>{field.label}</span>
      <FieldControl field={field} value={value} onCommit={onCommit} />
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
PropertyField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.any,
  error: PropTypes.string,
  onCommit: PropTypes.func.isRequired,
};

function FieldControl({ field, value, onCommit }) {
  switch (field.type) {
    case 'number': {
      return (
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number"
            defaultValue={value ?? ''}
            min={field.min ?? undefined}
            max={field.max ?? undefined}
            step={field.step ?? undefined}
            aria-label={field.label}
            onBlur={(e) => {
              const num = Number(e.target.value);
              onCommit(Number.isFinite(num) ? num : 0);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
          {field.unit ? <span style={{ color: 'var(--muted)' }}>{field.unit}</span> : null}
        </span>
      );
    }
    case 'boolean': {
      return (
        <input
          type="checkbox"
          checked={!!value}
          aria-label={field.label}
          onChange={(e) => onCommit(e.target.checked)}
        />
      );
    }
    case 'vector3': {
      const v = value || { x: 0, y: 0, z: 0 };
      return (
        <span className="vec3">
          {['x', 'y', 'z'].map((k) => (
            <input
              key={k}
              type="number"
              defaultValue={v[k] ?? 0}
              aria-label={`${field.label} ${k}`}
              onBlur={(e) => {
                const next = { ...v, [k]: Number(e.target.value) || 0 };
                onCommit(next);
              }}
            />
          ))}
        </span>
      );
    }
    case 'enum': {
      const opts = field.options || [];
      return (
        <select
          defaultValue={value ?? ''}
          aria-label={field.label}
          onChange={(e) => onCommit(e.target.value)}
        >
          {opts.map((o) => {
            const val = typeof o === 'object' ? o.value : o;
            const lab = typeof o === 'object' ? (o.label || o.value) : o;
            return <option key={val} value={val}>{lab}</option>;
          })}
        </select>
      );
    }
    case 'color': {
      return (
        <input
          type="color"
          defaultValue={value || '#888888'}
          aria-label={field.label}
          onBlur={(e) => onCommit(e.target.value)}
        />
      );
    }
    case 'shape-ref': {
      return (
        <span style={{ color: 'var(--muted)', fontFamily: 'monospace' }}>
          {value ? String(value) : '∅'}
        </span>
      );
    }
    case 'string':
    default: {
      return (
        <input
          type="text"
          defaultValue={value ?? ''}
          aria-label={field.label}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      );
    }
  }
}
FieldControl.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.any,
  onCommit: PropTypes.func.isRequired,
};
