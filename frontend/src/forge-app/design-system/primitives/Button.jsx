/**
 * Button + IconButton — Forge primitives.
 *
 * Variants: primary (copper accent), secondary (raised surface), ghost
 * (transparent), danger (red), success (green). Sizes: sm / md / lg.
 * Loading state replaces the button content with a spinner while keeping
 * the same width. Disabled buttons show a tooltip-friendly aria-disabled,
 * not the disabled attribute, so focus order stays predictable.
 */

import React, { forwardRef } from 'react';

const BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-3)',
  fontFamily: 'var(--font-sans)',
  fontWeight: 'var(--weight-medium)',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  transition: 'background-color var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out)',
  textDecoration: 'none',
  lineHeight: 1,
};

const SIZES = {
  sm: { height: '24px', padding: '0 var(--space-5)', fontSize: 'var(--text-sm)' },
  md: { height: '30px', padding: '0 var(--space-7)', fontSize: 'var(--text-base)' },
  lg: { height: '36px', padding: '0 var(--space-8)', fontSize: 'var(--text-base)' },
};

const VARIANTS = {
  primary: {
    background: 'var(--accent-bg)',
    color: 'var(--accent-text)',
    borderColor: 'var(--accent-bg)',
  },
  secondary: {
    background: 'var(--surface-raised)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-default)',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    borderColor: 'transparent',
  },
  danger: {
    background: 'var(--danger-bg)',
    color: 'var(--text-inverse)',
    borderColor: 'var(--danger-bg)',
  },
  success: {
    background: 'var(--success-bg)',
    color: 'var(--text-inverse)',
    borderColor: 'var(--success-bg)',
  },
};

function makeStyle({ size = 'md', variant = 'primary', disabled, fullWidth }) {
  return {
    ...BASE,
    ...SIZES[size],
    ...VARIANTS[variant],
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: fullWidth ? '100%' : 'auto',
  };
}

export const Button = forwardRef(function Button(
  {
    children, leftIcon, rightIcon, variant = 'primary', size = 'md',
    loading = false, disabled = false, fullWidth = false,
    type = 'button', onClick, className = '', ...rest
  },
  ref,
) {
  const handle = (e) => {
    if (disabled || loading) { e.preventDefault(); return; }
    onClick?.(e);
  };
  return (
    <button
      ref={ref}
      type={type}
      className={`forge-btn forge-btn-${variant} forge-btn-${size} ${className}`}
      style={makeStyle({ size, variant, disabled: disabled || loading, fullWidth })}
      aria-disabled={disabled || loading || undefined}
      aria-busy={loading || undefined}
      onClick={handle}
      {...rest}
    >
      {loading ? <span className="forge-spinner" aria-hidden /> : leftIcon}
      {children && <span className="forge-btn-label">{children}</span>}
      {!loading && rightIcon}
    </button>
  );
});

export const IconButton = forwardRef(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', selected = false, onClick, className = '', ...rest },
  ref,
) {
  if (!label) {
    if (typeof console !== 'undefined') {
      console.warn('[forge.IconButton] missing `label` — required for screen readers');
    }
  }
  const dim = size === 'sm' ? '24px' : size === 'lg' ? '36px' : '30px';
  const style = {
    ...BASE,
    ...VARIANTS[selected ? 'primary' : variant],
    width: dim,
    height: dim,
    padding: 0,
    borderRadius: 'var(--radius-md)',
  };
  return (
    <button
      ref={ref}
      type="button"
      className={`forge-iconbtn forge-iconbtn-${variant} ${selected ? 'is-selected' : ''} ${className}`}
      style={style}
      aria-label={label}
      aria-pressed={typeof selected === 'boolean' ? selected : undefined}
      onClick={onClick}
      {...rest}
    >
      {icon}
    </button>
  );
});
