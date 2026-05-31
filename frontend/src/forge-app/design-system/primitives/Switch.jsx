/**
 * Switch — boolean toggle. Industry convention: switches for settings,
 * checkboxes for selecting items in a list. We default everything to
 * Switch in the property manager.
 */

import React from 'react';

export function Switch({ checked = false, onChange, disabled = false, label, ariaLabel, size = 'md' }) {
  const dims = size === 'sm'
    ? { w: 28, h: 16, k: 12 }
    : { w: 34, h: 20, k: 16 };
  const trackStyle = {
    position: 'relative',
    display: 'inline-block',
    width: `${dims.w}px`,
    height: `${dims.h}px`,
    background: checked ? 'var(--accent-bg)' : 'var(--surface-active)',
    borderRadius: 'var(--radius-full)',
    transition: 'background var(--motion-fast) var(--ease-out)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    flexShrink: 0,
  };
  const knobStyle = {
    position: 'absolute',
    top: 2,
    left: checked ? `${dims.w - dims.k - 2}px` : '2px',
    width: `${dims.k}px`,
    height: `${dims.k}px`,
    background: '#fff',
    borderRadius: 'var(--radius-full)',
    boxShadow: 'var(--shadow-sm)',
    transition: 'left var(--motion-fast) var(--ease-out)',
  };
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-5)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={ariaLabel || label}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        style={trackStyle}
      >
        <span style={knobStyle} />
      </button>
      {label && <span style={{ color: 'var(--text-primary)', fontSize: 'var(--text-base)' }}>{label}</span>}
    </label>
  );
}

export function Checkbox({ checked = false, indeterminate = false, onChange, disabled = false, label, ariaLabel }) {
  const box = {
    width: 16, height: 16,
    border: '1.5px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    background: checked || indeterminate ? 'var(--accent-bg)' : 'var(--surface-app)',
    borderColor: checked || indeterminate ? 'var(--accent-bg)' : 'var(--border-default)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--accent-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--motion-fast) var(--ease-out)',
    flexShrink: 0,
  };
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-5)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : !!checked}
        aria-label={ariaLabel || label}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        style={box}
      >
        {indeterminate ? (
          <span style={{ width: 8, height: 1.5, background: 'currentColor' }} />
        ) : checked ? (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7"/></svg>
        ) : null}
      </button>
      {label && <span style={{ color: 'var(--text-primary)', fontSize: 'var(--text-base)' }}>{label}</span>}
    </label>
  );
}
