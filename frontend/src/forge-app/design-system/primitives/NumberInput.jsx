/**
 * NumberInput — numeric input with optional unit suffix. Spinner arrows
 * (↑/↓ keys) step by the configured `step`; mouse wheel disabled by
 * default. Unit selector dropdown when `units` is provided.
 */

import React, { forwardRef, useState, useCallback } from 'react';
import { Input } from './Input.jsx';

export const NumberInput = forwardRef(function NumberInput(
  {
    value, onChange,
    min, max, step = 1,
    unit, units = null,
    onUnitChange = null,
    precision = 3,
    placeholder = '0',
    disabled = false,
    error = false,
    ariaLabel,
    style,
  },
  ref,
) {
  const [draft, setDraft] = useState(value === undefined || value === null ? '' : String(value));

  // sync from parent
  React.useEffect(() => {
    setDraft(value === undefined || value === null ? '' : String(value));
  }, [value]);

  const commit = useCallback((raw) => {
    if (raw === '' || raw === '-' || raw === '.') return; // skip mid-edit
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    let v = n;
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    onChange?.(v);
  }, [min, max, onChange]);

  const handleKey = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = Number(draft) || 0;
      commit(Number((cur + step).toFixed(precision)));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = Number(draft) || 0;
      commit(Number((cur - step).toFixed(precision)));
    }
  };

  const handleChange = (e) => {
    setDraft(e.target.value);
    commit(e.target.value);
  };

  return (
    <Input
      ref={ref}
      value={draft}
      onChange={handleChange}
      onKeyDown={handleKey}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      ariaLabel={ariaLabel}
      style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', ...(style || {}) }}
      suffix={units && units.length > 1 && onUnitChange ? (
        <select
          value={unit}
          onChange={(e) => onUnitChange(e.target.value)}
          aria-label="unit"
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-secondary)',
            font: 'inherit', cursor: 'pointer', appearance: 'none', paddingRight: 'var(--space-2)',
          }}
        >
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      ) : unit}
    />
  );
});
