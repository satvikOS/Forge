/**
 * Input — text + helper text + error state. Honours `prefix`/`suffix` for
 * units / icons. Underlies Field, NumberInput, Select's search input.
 */

import React, { forwardRef } from 'react';
import { useUniqueId } from '../a11y.js';

const WRAP = {
  display: 'inline-flex',
  alignItems: 'center',
  height: '28px',
  padding: '0 var(--space-5)',
  gap: 'var(--space-3)',
  background: 'var(--surface-app)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-base)',
  color: 'var(--text-primary)',
  transition: 'border-color var(--motion-fast) var(--ease-out)',
  width: '100%',
};

const NATIVE = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  padding: 0,
};

export const Input = forwardRef(function Input(
  {
    value, defaultValue, onChange, onBlur, onKeyDown,
    placeholder = '', type = 'text', autoFocus,
    prefix, suffix, error = false, disabled = false,
    name, ariaLabel, ariaDescribedBy, className = '',
    style: styleOverride = {},
  },
  ref,
) {
  const id = useUniqueId('forge-input');
  const wrap = {
    ...WRAP,
    borderColor: error
      ? 'var(--danger-bg)'
      : disabled
        ? 'var(--border-subtle)'
        : 'var(--border-default)',
    opacity: disabled ? 0.55 : 1,
    ...styleOverride,
  };
  return (
    <span className={`forge-input ${className}`} style={wrap}>
      {prefix && <span className="forge-input-prefix" style={{ color: 'var(--text-tertiary)' }}>{prefix}</span>}
      <input
        ref={ref}
        id={id}
        name={name}
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={error || undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        style={NATIVE}
      />
      {suffix && <span className="forge-input-suffix" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>{suffix}</span>}
    </span>
  );
});
